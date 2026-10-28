import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
	factoryRuntimeIdentity,
	publishStorageJson,
	readStorageJson,
	StorageRetentionStore,
} from "bobs-factory-core";
import { z } from "zod";
import { compareReleaseVersions } from "../../../../scripts/lib/binary-release.mjs";
import { commitBackup } from "../migrations/MigrationBackup.js";
import type { DataBaseline } from "./DataSummary.js";
import { acquireStateLock, StateLockBusyError } from "./StateLock.js";
import {
	type JournalIo,
	type JournalStep,
	MAX_FAILED_ATTEMPTS,
	stepAtLeast,
	UpdateJournal,
} from "./UpdateJournal.js";
import { UpdateOperationLock } from "./UpdateOperationLock.js";

export const UpdateSettingsSchema = z
	.object({
		channel: z.enum(["stable", "nightly"]).default("stable"),
		overrides: z
			.object({
				stable: z.enum(["manual", "idle-auto"]).optional(),
				nightly: z.enum(["manual", "idle-auto"]).optional(),
			})
			.default({}),
		paused: z.boolean().default(false),
		pin: z
			.string()
			.regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
			.optional(),
	})
	.strict();
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
export const UpdateSettingsPatchSchema = z
	.object({
		channel: z.enum(["stable", "nightly"]).optional(),
		policy: z.enum(["manual", "idle-auto", "default"]).optional(),
		paused: z.boolean().optional(),
		pin: z
			.string()
			.regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
			.nullable()
			.optional(),
	})
	.strict();
export type UpdateSettingsPatch = z.infer<typeof UpdateSettingsPatchSchema>;
const CandidateSchema = z.object({
	version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
	commit: z.string().regex(/^[a-f0-9]{40}$/),
	channel: z.enum(["stable", "nightly"]),
	target: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
	manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
	publishedAt: z.string().datetime(),
});
export type UpdateCandidate = z.infer<typeof CandidateSchema>;
const InstalledSchema = z.object({
	version: z.string(),
	commit: z.string().nullable(),
	target: z.string().nullable(),
});
export type InstalledUpdate = z.infer<typeof InstalledSchema>;
const StagedSchema = z.object({
	candidate: CandidateSchema,
	executable: z.string(),
	previousExecutable: z.string(),
});
export type StagedUpdate = z.infer<typeof StagedSchema>;
const OutcomeSchema = z.enum(["succeeded", "rolled-back", "cancelled"]);
const TransactionSchema = z
	.object({
		id: z.string(),
		candidate: CandidateSchema,
		staged: StagedSchema,
		previous: InstalledSchema,
		snapshot: z.string().optional(),
		revision: z.number().int(),
		phase: z.enum([
			"draining",
			"preflight",
			"snapshot",
			"stopping",
			"activating",
			"starting",
			"health",
			"rollback",
			"recovery-required",
			"succeeded",
			"rolled-back",
			"cancelled",
		]),
		switchStarted: z.boolean().default(false),
		startedAt: z.string(),
		error: z.string().optional(),
		release: z
			.object({
				transactionId: z.string(),
				outcome: OutcomeSchema,
				status: z.enum(["pending", "acknowledged"]),
			})
			.optional(),
	})
	.superRefine((transaction, ctx) => {
		if (
			transaction.release &&
			transaction.release.transactionId !== transaction.id
		)
			ctx.addIssue({
				code: "custom",
				message: "Maintenance release must belong to its transaction",
			});
	});
export const UpdateTransactionSchema = TransactionSchema;
export type UpdateTransaction = z.infer<typeof TransactionSchema>;
const StateSchema = z.object({
	schemaVersion: z.literal(1),
	revision: z.number().int().nonnegative(),
	settings: UpdateSettingsSchema,
	installed: InstalledSchema,
	pending: z
		.object({
			candidate: CandidateSchema,
			since: z.string(),
			staged: StagedSchema.optional(),
			consentRevision: z.number().optional(),
		})
		.optional(),
	transaction: TransactionSchema.optional(),
	// Retain the last successful rollback even while a newer attempt drains/fails.
	rollbackSnapshot: z
		.object({ transactionId: z.string(), path: z.string() })
		.optional(),
	badCandidates: z.array(z.string()),
	nextCheckAt: z.number(),
	failures: z.number().int(),
	lastCheckedAt: z.string().optional(),
	error: z.string().optional(),
	blocked: z
		.object({
			code: z.literal("worker-ownership"),
			reason: z.string(),
			remedy: z.string(),
		})
		.optional(),
});
export const UpdateStateSchema = StateSchema;
export type UpdateState = z.infer<typeof StateSchema>;
/** Persisted beside state.json (updates/recovery.json), never inside it: a v2
 * supervisor rewrites state.json through a schema that strips unknown keys. */
const RecoverySchema = z.object({
	code: z.literal("unexpected-runtime"),
	transactionId: z.string(),
	phase: z.string(),
	expected: z.array(InstalledSchema),
	observed: InstalledSchema,
	detectedAt: z.string(),
	steps: z.array(z.string()),
});
export type UpdateRecovery = z.infer<typeof RecoverySchema>;
export interface UpdateSource {
	discover(
		settings: UpdateSettings,
		installed: InstalledUpdate,
	): Promise<UpdateCandidate | undefined>;
	stage(candidate: UpdateCandidate): Promise<StagedUpdate>;
}
/** What `prepare` decided before any worker is touched. */
export interface PreparePlan {
	/** Opaque path stored as `transaction.snapshot`; the desktop shell keeps its switch record there. */
	record?: string;
	/** Pre-created links, so switching and rolling back are renames that allocate nothing. */
	links?: { next: string; prev: string };
	/** Set when the candidate's data format differs; its worker migrates at startup. */
	migration?: { from: number; to: number } | null;
}
export interface HealthExpectation {
	transactionId: string;
	/** What the previous worker had loaded at idle time. */
	baseline?: DataBaseline | null;
	migration?: { from: number; to: number } | null;
}
export type IdleObservation =
	| boolean
	| { idle: boolean; baseline?: DataBaseline };
/** Not the candidate's fault (data format, disk): the candidate is not marked bad. */
export class UpdateRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UpdateRejectedError";
	}
}
/** Disk-full style failures say nothing about the candidate. */
export function isEnvironmentalError(error: unknown, depth = 0): boolean {
	const value = error as
		| { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }
		| undefined;
	if (!value || depth > 3) return false;
	if (value.code === "ENOSPC" || value.code === "EDQUOT") return true;
	if (
		value.name === "InsufficientSpaceError" ||
		value.name === "UpdateRejectedError"
	)
		return true;
	if (
		/\b(ENOSPC|EDQUOT)\b|no space left|disk quota exceeded/i.test(
			String(value.message ?? ""),
		)
	)
		return true;
	return isEnvironmentalError(value.cause, depth + 1);
}
/** Runs in the lifecycle supervisor, never in the worker being replaced.
 * Every method must be idempotent for the persisted transaction. Maintenance freezes
 * all intake and suppresses old-runtime auto-restart. isIdle includes descendant leases.
 * prepare verifies and pre-creates; it must not copy state. rollback must confirm failed
 * replacement exit before starting the previous worker. The data stays in place: only a
 * migration backup bound to the transaction is ever restored, never native stores.
 */
export interface UpdateLifecycle {
	/** Allows an owner supervisor to stop waiting without switching runtimes. */
	signal?: AbortSignal;
	acquireMaintenance(transactionId: string): Promise<void>;
	isIdle(): Promise<IdleObservation>;
	prepare(
		staged: StagedUpdate,
		installed: InstalledUpdate,
		transactionId: string,
	): Promise<PreparePlan>;
	stop(): Promise<void>;
	activate(staged: StagedUpdate): Promise<void>;
	start(): Promise<void>;
	health(candidate: UpdateCandidate, expect?: HealthExpectation): Promise<void>;
	rollback(
		transaction: UpdateTransaction,
		expect?: HealthExpectation,
	): Promise<void>;
	/** Remove what `prepare` pre-created once the transaction is over. */
	discard?(transactionId: string): Promise<void> | void;
	releaseMaintenance(transactionId: string): Promise<void>;
}
export function effectiveUpdatePolicy(settings: UpdateSettings) {
	return (
		settings.overrides[settings.channel] ??
		(settings.channel === "nightly" ? "idle-auto" : "manual")
	);
}
export function candidateKey(candidate: UpdateCandidate) {
	return [
		candidate.channel,
		candidate.version,
		candidate.commit,
		candidate.target,
		candidate.manifestSha256,
	].join(":");
}
const UpdateStateLockBusyError = StateLockBusyError;

const now = () => new Date().toISOString();
const terminal = (transaction?: UpdateTransaction) =>
	!transaction ||
	(["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
		transaction.release?.status === "acknowledged");

/** Per-home durable state. Short sync writes serialize policy/consent independently
 * of network/staging. Long operations use a fenced owner lock with a nonce and process start identity.
 * recover() requires explicit operator confirmation, then verifies stale ownership
 * under an exclusive reclaim guard. Legacy live PID-only records fail closed.
 */
export interface UpdateManagerOptions {
	/** Test seams: fail the journal's writes like a full volume. */
	journalIo?: JournalIo;
	/** Called after each journal step is durable; throwing simulates process death. */
	afterStep?: (step: JournalStep, transactionId: string) => void;
}
export class UpdateManager {
	readonly directory: string;
	readonly file: string;
	private readonly journal: UpdateJournal;
	private crashed = false;
	constructor(
		readonly home: string,
		private readonly source?: UpdateSource,
		private readonly lifecycle?: UpdateLifecycle,
		private readonly initial: InstalledUpdate = factoryRuntimeIdentity,
		private readonly options: UpdateManagerOptions = {},
	) {
		this.directory = join(resolve(home), "updates");
		this.file = join(this.directory, "state.json");
		this.journal = new UpdateJournal(this.directory, options.journalIo);
	}
	private read(): UpdateState {
		if (
			existsSync(this.directory) &&
			(!lstatSync(this.directory).isDirectory() ||
				lstatSync(this.directory).isSymbolicLink())
		)
			throw new Error("Update directory must be a real owned directory");
		if (existsSync(this.file) && !lstatSync(this.file).isFile())
			throw new Error("Update state must be a regular file");
		if (existsSync(this.file) && lstatSync(this.file).isSymbolicLink())
			throw new Error("Update state cannot be a symlink");
		if (existsSync(this.file))
			return StateSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
		return StateSchema.parse({
			schemaVersion: 1,
			revision: 0,
			settings: {},
			installed: this.initial,
			badCandidates: [],
			nextCheckAt: 0,
			failures: 0,
		});
	}
	private change<T>(
		mutate: (state: UpdateState) => T,
		shouldWrite: (state: UpdateState) => boolean = () => true,
	): T | undefined {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		this.read();
		const releaseLock = acquireStateLock(join(this.directory, "state.lock"));
		try {
			const state = this.read();
			if (!shouldWrite(state)) return;
			const result = mutate(state);
			StateSchema.parse(state);
			const temporary = `${this.file}.${randomUUID()}.tmp`;
			const fd = openSync(temporary, "wx", 0o600);
			try {
				writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			renameSync(temporary, this.file);
			const directoryFd = openSync(this.directory, "r");
			try {
				fsyncSync(directoryFd);
			} finally {
				closeSync(directoryFd);
			}
			return result;
		} finally {
			releaseLock();
		}
	}
	private get recoveryFile() {
		return join(this.directory, "recovery.json");
	}
	private storedRecovery(): UpdateRecovery | undefined {
		try {
			return RecoverySchema.parse(
				JSON.parse(readFileSync(this.recoveryFile, "utf8")),
			);
		} catch {
			return undefined;
		}
	}
	/** Only meaningful while the transaction it was recorded for is unresolved. */
	private activeRecovery(state: UpdateState) {
		const stored = this.storedRecovery();
		return stored &&
			!terminal(state.transaction) &&
			state.transaction?.id === stored.transactionId
			? stored
			: undefined;
	}
	private writeJson(file: string, value: unknown) {
		mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
		const temporary = `${file}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			mode: 0o600,
			flush: true,
		});
		renameSync(temporary, file);
	}
	/** Immutable audit of an identity change nobody asked the updater to make. */
	private audit(kind: string, record: Record<string, unknown>) {
		const at = now();
		try {
			this.writeJson(
				join(
					this.directory,
					"history",
					`${kind.split("-")[0]}-${at.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`,
				),
				{ kind, at, ...record },
			);
		} catch (error) {
			console.warn(`Update audit record deferred: ${(error as Error).message}`);
		}
	}
	private expectedInstalled(transaction: UpdateTransaction) {
		const outcome = transaction.release?.outcome;
		return outcome
			? outcome === "succeeded"
				? [transaction.candidate]
				: [transaction.previous]
			: ["starting", "health", "succeeded"].includes(transaction.phase)
				? [transaction.candidate]
				: ["activating", "recovery-required"].includes(transaction.phase)
					? [transaction.previous, transaction.candidate]
					: [transaction.previous];
	}
	private sameIdentity(left: InstalledUpdate, right: InstalledUpdate) {
		return (
			left.version === right.version &&
			left.commit === right.commit &&
			left.target === right.target
		);
	}
	/** A newer installed build supersedes the candidate that was waiting for it. */
	private settlePending(state: UpdateState, observed: InstalledUpdate) {
		if (!state.pending) return;
		let superseded = state.pending.candidate.commit === observed.commit;
		try {
			superseded ||=
				compareReleaseVersions(
					state.pending.candidate.version,
					observed.version,
				) <= 0;
		} catch {
			// Unknown identity ordering: keep the candidate, it needs consent anyway.
		}
		if (superseded) delete state.pending;
		else {
			// The staged copy was prepared against the previous executable.
			delete state.pending.staged;
			delete state.pending.consentRevision;
		}
	}
	private recoverySteps(
		observed: InstalledUpdate,
		expected: InstalledUpdate[],
		transaction: UpdateTransaction,
		adoptHint?: string,
	) {
		const label = (value: InstalledUpdate) =>
			`${value.version}${value.commit ? ` (${value.commit.slice(0, 8)})` : ""}`;
		return [
			`Installed build ${label(observed)} is not what update ${transaction.id.slice(0, 8)} (${transaction.phase}) expects: ${expected.map(label).join(" or ")}. The server is running and the update is paused.`,
			adoptHint ??
				"To keep the installed build and close that update: bobs-factory update recover --adopt-installed --yes",
			`To resume that update instead, reinstall ${expected.map(label).join(" or ")}; this notice clears itself when the expected build starts.`,
		];
	}
	/** Reconcile what is actually installed with the update history without ever
	 * blocking startup. A completed, acknowledged history never constrains a
	 * deliberate (manual) installation. An unresolved transaction is not touched:
	 * a foreign identity is recorded as `recovery` with steps and activation is refused.
	 * Only lock contention is deferred (bounded, asynchronous); malformed state still throws.
	 */
	async observeInstalled(
		identity: InstalledUpdate,
		options: { adoptHint?: string } = {},
	) {
		InstalledSchema.parse(identity);
		if (!identity.target || !identity.commit) return;
		const observed = InstalledSchema.extend({
			version: CandidateSchema.shape.version,
			commit: CandidateSchema.shape.commit,
			target: CandidateSchema.shape.target,
		}).parse(identity);
		const decide = (state: UpdateState) => {
			const stored = this.storedRecovery();
			const transaction = state.transaction;
			if (terminal(transaction))
				return this.sameIdentity(observed, state.installed)
					? stored
						? ({ kind: "clear" } as const)
						: ({ kind: "none" } as const)
					: ({ kind: "adopt" } as const);
			const expected = this.expectedInstalled(transaction!);
			if (expected.some((value) => this.sameIdentity(observed, value)))
				return stored
					? ({ kind: "clear" } as const)
					: ({ kind: "none" } as const);
			const recovery: UpdateRecovery = {
				code: "unexpected-runtime",
				transactionId: transaction!.id,
				phase: transaction!.phase,
				expected,
				observed,
				detectedAt: stored?.detectedAt ?? now(),
				steps: this.recoverySteps(
					observed,
					expected,
					transaction!,
					options.adoptHint,
				),
			};
			return stored &&
				stored.transactionId === recovery.transactionId &&
				stored.phase === recovery.phase &&
				this.sameIdentity(stored.observed, observed)
				? ({ kind: "none" } as const)
				: ({ kind: "recovery", recovery } as const);
		};
		// Only an identity change rewrites state.json. The recovery notice is a
		// sidecar that activeRecovery() validates against the live transaction, so
		// writing it needs no lock and can never clobber a supervisor's view.
		const adopting = (state: UpdateState) => decide(state).kind === "adopt";
		const deadline = Date.now() + 1_000;
		while (true) {
			const state = this.read();
			const decision = decide(state);
			if (decision.kind === "recovery")
				return this.writeJson(this.recoveryFile, decision.recovery);
			if (decision.kind === "clear")
				return rmSync(this.recoveryFile, { force: true });
			if (decision.kind === "none") return;
			try {
				// Recheck under the writer lock: a supervisor may have started a
				// transaction while this observer waited. Never overwrite its view.
				this.change((current) => {
					this.audit("observed-install", {
						from: current.installed,
						to: observed,
						reason: "manual-or-external",
					});
					current.installed = observed;
					this.settlePending(current, observed);
					rmSync(this.recoveryFile, { force: true });
				}, adopting);
				return;
			} catch (error) {
				if (!(error instanceof UpdateStateLockBusyError)) throw error;
				if (Date.now() >= deadline) {
					console.warn(
						`Installed runtime observation deferred. ${error.message}`,
					);
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
	}
	/** Operator-confirmed resolution of an `unexpected-runtime` recovery: the
	 * installed build is the truth. Candidate == installed completes the update;
	 * anything else is closed as superseded. Never rolls back over a deliberate
	 * installation. Maintenance is released through the lifecycle when there is
	 * one, otherwise through `release` (shell fence), otherwise just acknowledged.
	 */
	async adoptInstalled(
		identity: InstalledUpdate,
		options: { release?: (transactionId: string) => Promise<void> } = {},
	) {
		InstalledSchema.parse(identity);
		return this.operation(async () => {
			const before = this.read();
			const recovery = this.activeRecovery(before);
			if (!recovery)
				throw new Error("There is no unexpected runtime to adopt.");
			if (!this.sameIdentity(recovery.observed, identity))
				throw new Error(
					`Recovery was recorded for build ${recovery.observed.version} but this is ${identity.version}. Run the command with the installed build.`,
				);
			const transaction = before.transaction!;
			const completes = this.sameIdentity(identity, transaction.candidate);
			this.audit("adopted-install", {
				transactionId: transaction.id,
				from: before.installed,
				to: identity,
				outcome: completes ? "succeeded" : "cancelled",
			});
			this.change((state) => {
				const current = state.transaction;
				if (!current || current.id !== transaction.id)
					throw new Error("Update transaction changed; retry.");
				state.installed = identity;
				current.phase = completes ? "succeeded" : "cancelled";
				if (!completes) current.error = "superseded-by-manual-install";
				else delete current.error;
				this.prepareRelease(current);
				if (completes) delete state.pending;
				else this.settlePending(state, identity);
			});
			if (this.lifecycle) await this.releaseMaintenance(transaction.id);
			else {
				await options.release?.(transaction.id);
				this.change((state) => {
					if (state.transaction?.release)
						state.transaction.release.status = "acknowledged";
				});
			}
			rmSync(this.recoveryFile, { force: true });
			return this.status();
		}, true);
	}

	status() {
		const state = this.read();
		return {
			...state,
			recovery: this.activeRecovery(state),
			instance: resolve(this.home),
			effectivePolicy: effectiveUpdatePolicy(state.settings),
			activationSupported: Boolean(this.lifecycle),
			operationOwner: this.operationOwner(),
		};
	}
	/** Supervisor observation is separate from candidate errors and consent revisions. */
	reportWorkerOwnership(reason?: string) {
		const blocked = reason
			? {
					code: "worker-ownership" as const,
					reason,
					remedy:
						"Use the desktop “Stop local Factory” action, then reopen local Factory and retry the update. If Stop cannot verify the worker, reconcile ownership with the installation owner first; do not remove locks or start a replacement.",
				}
			: undefined;
		this.change(
			(state) => {
				state.blocked = blocked;
			},
			(state) => JSON.stringify(state.blocked) !== JSON.stringify(blocked),
		);
	}
	private operationOwner() {
		const file = join(this.directory, "operation.lock");
		return existsSync(file) ? readFileSync(file, "utf8") : undefined;
	}
	configure(input: UpdateSettingsPatch, expectedRevision: number) {
		const patch = UpdateSettingsPatchSchema.parse(input);
		this.change((state) => {
			if (state.revision !== expectedRevision)
				throw new Error("Update settings changed; refresh before saving.");
			// The irreversible boundary was already authorized. Report rather than pretending
			// a newly selected policy can undo a switch in progress.
			if (
				state.transaction &&
				[
					"stopping",
					"activating",
					"starting",
					"health",
					"rollback",
					"recovery-required",
				].includes(state.transaction.phase)
			)
				throw new Error(
					"Update switch/recovery is in progress; recover it before changing policy.",
				);
			if (patch.channel) state.settings.channel = patch.channel;
			if (patch.policy === "default")
				delete state.settings.overrides[state.settings.channel];
			else if (patch.policy)
				state.settings.overrides[state.settings.channel] = patch.policy;
			if (patch.paused !== undefined) state.settings.paused = patch.paused;
			if (patch.pin === null) delete state.settings.pin;
			else if (patch.pin !== undefined) state.settings.pin = patch.pin;
			state.revision++;
			state.nextCheckAt = 0;
			if (state.pending) {
				delete state.pending.consentRevision;
				if (!this.matches(state, state.pending.candidate)) delete state.pending;
			}
		});
		return this.status();
	}
	private matches(state: UpdateState, candidate: UpdateCandidate) {
		return (
			candidate.channel === state.settings.channel &&
			(!state.settings.pin || state.settings.pin === candidate.version) &&
			(!state.installed.target || candidate.target === state.installed.target)
		);
	}
	private downgrade(installed: InstalledUpdate, candidate: UpdateCandidate) {
		// Returning from nightly to stable remains an intentional channel change.
		if (
			installed.version.includes("-nightly.") &&
			candidate.channel === "stable"
		)
			return true;
		try {
			return compareReleaseVersions(candidate.version, installed.version) < 0;
		} catch {
			return true;
		} // Unknown development/legacy identity requires consent.
	}
	private authorized(state: UpdateState, candidate: UpdateCandidate) {
		return (
			this.matches(state, candidate) &&
			!state.settings.paused &&
			state.pending &&
			candidateKey(state.pending.candidate) === candidateKey(candidate) &&
			!state.badCandidates.includes(candidateKey(candidate)) &&
			(state.pending.consentRevision === state.revision ||
				(!state.settings.pin &&
					effectiveUpdatePolicy(state.settings) === "idle-auto" &&
					!this.downgrade(state.installed, candidate)))
		);
	}
	/** Same policy gate for external product supervisors; consent is never inferred from exit. */
	activationEligible() {
		const state = this.read();
		return Boolean(
			terminal(state.transaction) &&
				state.pending &&
				this.authorized(state, state.pending.candidate),
		);
	}
	async check() {
		if (!this.source)
			throw new Error("No verified update source is configured.");
		const source = this.source;
		return this.operation(async () => {
			const before = this.read();
			try {
				const candidate = await source.discover(
					before.settings,
					before.installed,
				);
				this.change((state) => {
					if (state.revision !== before.revision) return;
					state.lastCheckedAt = now();
					state.failures = 0;
					state.nextCheckAt = Date.now() + 15 * 60_000;
					delete state.error;
					if (candidate) {
						CandidateSchema.parse(candidate);
						if (!this.matches(state, candidate))
							throw new Error(
								"Release does not match selected channel/pin/target.",
							);
						if (
							candidate.version === state.installed.version &&
							candidate.commit === state.installed.commit
						) {
							delete state.pending;
							return;
						}
						if (
							!state.pending ||
							candidateKey(state.pending.candidate) !== candidateKey(candidate)
						)
							state.pending = { candidate, since: now() };
					} else delete state.pending;
				});
			} catch (error) {
				this.change((state) => {
					if (state.revision !== before.revision) return;
					state.failures++;
					state.nextCheckAt =
						Date.now() +
						Math.min(
							6 * 60 * 60_000,
							60_000 * 2 ** Math.min(state.failures, 9),
						);
					state.error = (error as Error).message;
				});
			}
			return this.status();
		});
	}
	/** Explicit Install is bound to the currently displayed exact candidate + revision. */
	requestInstall(key: string, expectedRevision: number, retry = false) {
		this.change((state) => {
			if (this.activeRecovery(state))
				throw new Error(
					"An unexpected runtime is installed; resolve the recovery notice before installing.",
				);
			if (
				state.revision !== expectedRevision ||
				!state.pending ||
				candidateKey(state.pending.candidate) !== key
			)
				throw new Error(
					"Update candidate/settings changed; refresh before Install.",
				);
			if (state.settings.paused)
				throw new Error("Updates are paused; resume before Install.");
			if (retry)
				state.badCandidates = state.badCandidates.filter(
					(value) => value !== key,
				);
			if (state.badCandidates.includes(key))
				throw new Error(
					"This candidate previously failed; use explicit retry after inspecting the result.",
				);
			state.pending.consentRevision = state.revision;
		});
		return this.status();
	}
	private async operation<T>(
		work: (releaseFailureReserve: () => void) => Promise<T>,
		recover = false,
	): Promise<T> {
		const state = this.read();
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		// Allocate before taking operation.lock. A full volume must still permit
		// terminal state writes, maintenance release and the lock's release guard.
		const reserve = join(this.directory, `operation-reserve-${randomUUID()}`);
		const releaseFailureReserve = () => rmSync(reserve, { force: true });
		try {
			writeFileSync(
				reserve,
				Buffer.alloc(
					Math.max(1024 * 1024, Buffer.byteLength(JSON.stringify(state)) * 3),
				),
				{
					flag: "wx",
					mode: 0o600,
					flush: true,
				},
			);
			const result = await new UpdateOperationLock(
				join(this.directory, "operation.lock"),
			).run(async () => {
				try {
					return await work(releaseFailureReserve);
				} finally {
					releaseFailureReserve();
				}
			}, recover);
			const completed = this.read().transaction;
			if (
				completed?.phase === "succeeded" &&
				completed.release?.status === "acknowledged" &&
				(completed.id !== state.transaction?.id ||
					state.transaction?.release?.status !== "acknowledged")
			) {
				// Legacy: wakes the storage coordinator for snapshots that older
				// supervisors registered. This updater creates none.
				try {
					await publishStorageJson(
						join(this.home, "storage-retention", "update-completed.json"),
						{ transactionId: completed.id, at: now() },
					);
				} catch (error) {
					console.error(
						`Update snapshot cleanup notification deferred: ${(error as Error).message}`,
					);
				}
			}
			return result;
		} finally {
			releaseFailureReserve();
		}
	}
	/** Environmental failures never mark a candidate bad, but a candidate that
	 * keeps interrupting or failing the same way eventually does. */
	private noteFailure(candidate: UpdateCandidate): boolean {
		try {
			return (
				this.journal.recordFailure(candidateKey(candidate)) >=
				MAX_FAILED_ATTEMPTS
			);
		} catch {
			return false;
		}
	}
	private markBad(state: UpdateState, candidate: UpdateCandidate) {
		state.badCandidates = [
			...new Set([...state.badCandidates, candidateKey(candidate)]),
		];
	}
	async stage() {
		return this.operation(async () => {
			if (!this.source)
				throw new Error("No verified update source is configured.");
			const before = this.read();
			if (!before.pending)
				throw new Error("Check for an available update first.");
			try {
				const staged = StagedSchema.parse(
					await this.source.stage(before.pending.candidate),
				);
				if (
					candidateKey(staged.candidate) !==
					candidateKey(before.pending.candidate)
				)
					throw new Error("Staged release identity changed.");
				this.change((state) => {
					if (
						state.pending &&
						candidateKey(state.pending.candidate) ===
							candidateKey(staged.candidate) &&
						this.matches(state, staged.candidate)
					) {
						state.pending.staged = staged;
						delete state.error;
					}
				});
			} catch (error) {
				// A full disk says nothing about the release: keep it, retry later.
				const environmental = isEnvironmentalError(error);
				if (environmental)
					try {
						this.journal.recordFailure(
							`stage:${candidateKey(before.pending.candidate)}`,
						);
					} catch {}
				this.change((state) => {
					state.error = (error as Error).message;
					if (!environmental) this.markBad(state, before.pending!.candidate);
				});
				throw error;
			}
			return this.status();
		});
	}
	private phase(
		phase: UpdateTransaction["phase"],
		extra: Partial<UpdateTransaction> = {},
	) {
		this.change((state) => {
			if (!state.transaction) throw new Error("Missing update transaction");
			Object.assign(state.transaction, extra, { phase });
			this.prepareRelease(state.transaction);
		});
	}
	private prepareRelease(transaction: UpdateTransaction) {
		const outcome = OutcomeSchema.safeParse(transaction.phase);
		if (outcome.success)
			transaction.release = {
				transactionId: transaction.id,
				outcome: outcome.data,
				status: "pending",
			};
	}
	/** Persist the step (always before the side effect it names, except `healthy`). */
	private reach(id: string, step: JournalStep, baseline?: DataBaseline) {
		this.journal.step(id, step, (journal) => {
			if (baseline) journal.baseline = baseline;
		});
		try {
			this.options.afterStep?.(step, id);
		} catch (error) {
			this.crashed = true;
			throw error;
		}
	}
	/** The commit point is the journal; `state.json` is repaired from it. */
	private commit(transaction: UpdateTransaction) {
		this.change((current) => {
			current.installed = transaction.candidate;
			current.transaction!.phase = "succeeded";
			this.prepareRelease(current.transaction!);
			delete current.pending;
			delete current.error;
		});
		try {
			commitBackup(this.home, transaction.id);
		} catch (error) {
			console.error(
				`Migration backup commit deferred: ${(error as Error).message}`,
			);
		}
		try {
			this.journal.clearFailures(candidateKey(transaction.candidate));
		} catch {}
	}
	private async discard(transactionId: string) {
		try {
			await this.lifecycle?.discard?.(transactionId);
		} catch (error) {
			console.error(
				`Update link cleanup deferred: ${(error as Error).message}`,
			);
		}
	}
	private async releaseMaintenance(transactionId: string) {
		// Persist before the external call, including migration of legacy terminal
		// records. A crash or lost response must retry only this exact release.
		this.change((state) => {
			const transaction = state.transaction;
			if (!transaction || transaction.id !== transactionId)
				throw new Error("Maintenance transaction changed");
			if (!transaction.release) this.prepareRelease(transaction);
			if (!transaction.release)
				throw new Error("Maintenance release has no completed outcome");
		});
		const transaction = this.read().transaction!;
		if (transaction.release!.status === "acknowledged") return;
		try {
			await this.lifecycle!.releaseMaintenance(transactionId);
			this.change((state) => {
				if (state.transaction?.id !== transactionId)
					throw new Error("Maintenance transaction changed");
				state.transaction.phase = state.transaction.release!.outcome;
				state.transaction.release!.status = "acknowledged";
				if (
					state.transaction.phase === "succeeded" &&
					state.transaction.snapshot
				)
					state.rollbackSnapshot = {
						transactionId,
						path: state.transaction.snapshot,
					};
			});
		} catch (error) {
			this.phase("recovery-required", {
				error: `Maintenance release failed: ${(error as Error).message}`,
			});
			throw error;
		}
		try {
			this.journal.remove(transactionId);
		} catch {}
		await this.reconcileLegacySnapshots(transaction);
	}
	/** Legacy: snapshots registered by older supervisors become disposable once a
	 * later update succeeds. This updater registers none; PR d removes this. */
	private async reconcileLegacySnapshots(transaction: UpdateTransaction) {
		const transactionId = transaction.id;
		// Retention publication is independent of maintenance acknowledgment. A
		// failed cleanup must never turn a healthy installed update into recovery.
		try {
			const retention = new StorageRetentionStore(this.home);
			const count = await retention.inventoryCount();
			for (let offset = 0; offset < count; offset += 100) {
				for (const id of await retention.inventoryPage(offset)) {
					const artifact = await retention.record(id);
					if (artifact.category !== "snapshot") continue;
					const receipt = (await readStorageJson(
						join(retention.directory, "receipts", `${id}.json`),
					)) as { phase?: string } | undefined;
					if (receipt?.phase === "completed") continue;
					if (artifact.operation === transactionId)
						await retention.revise(id, (record) => {
							record.reconciledAt = new Date().toISOString();
						});
					else if (
						transaction.release!.outcome === "succeeded" &&
						artifact.producer === "OwnedUpdateLifecycle" &&
						/^[\w-]{1,100}$/.test(artifact.operation) &&
						artifact.root === join(retention.home, "updates", "snapshots") &&
						artifact.path === join(artifact.root, artifact.operation) &&
						artifact.rollback !== "disposable" &&
						artifact.operation !== transactionId
					) {
						const previous = UpdateTransactionSchema.safeParse(
							await readStorageJson(
								join(this.directory, "history", `${artifact.operation}.json`),
							),
						);
						if (
							previous.success &&
							previous.data.id === artifact.operation &&
							terminal(previous.data) &&
							previous.data.snapshot === artifact.path &&
							artifact.verifiedAt &&
							artifact.completedAt
						)
							await retention.revise(id, (record) => {
								record.rollback = "disposable";
								record.reconciledAt = now();
							});
					}
				}
			}
		} catch (error) {
			console.error(
				`Update snapshot retention deferred: ${(error as Error).message}`,
			);
		}
	}
	async reconcile() {
		if (this.read().blocked) return this.status();
		if (!this.lifecycle)
			throw new Error(
				"Activation needs the owned lifecycle supervisor. Checkout/Nix/external installations must use their owner; no executable was switched.",
			);
		const lifecycle = this.lifecycle;
		return this.operation(async (releaseFailureReserve) => {
			const state = this.read();
			if (!terminal(state.transaction))
				throw new Error(
					"Interrupted update requires recovery before another activation.",
				);
			const pending = state.pending;
			if (!pending || !this.authorized(state, pending.candidate))
				return this.status();
			if (!pending.staged)
				throw new Error(
					"Stage and verify the selected update before activation.",
				);
			if (state.transaction) {
				await publishStorageJson(
					join(this.directory, "history", `${state.transaction.id}.json`),
					state.transaction,
				);
			}
			const transaction: UpdateTransaction = {
				id: randomUUID(),
				candidate: pending.candidate,
				staged: pending.staged,
				previous: state.installed,
				revision: state.revision,
				phase: "draining",
				switchStarted: false,
				startedAt: now(),
			};
			this.change((current) => {
				if (!this.authorized(current, transaction.candidate))
					throw new Error("Update policy changed");
				if (
					current.transaction?.phase === "succeeded" &&
					current.transaction.snapshot
				)
					current.rollbackSnapshot = {
						transactionId: current.transaction.id,
						path: current.transaction.snapshot,
					};
				current.transaction = transaction;
			});
			const identity = (value: InstalledUpdate) => ({
				version: value.version,
				commit: value.commit,
				target: value.target,
			});
			this.journal.create({
				id: transaction.id,
				candidateKey: candidateKey(transaction.candidate),
				plan: {
					candidate: identity(transaction.candidate),
					previous: identity(transaction.previous),
				},
				baseline: null,
			});
			this.options.afterStep?.("claimed", transaction.id);
			let maintenance = false;
			let acquiring = false;
			let baseline: DataBaseline | null = null;
			let migration: PreparePlan["migration"] = null;
			try {
				const eligible = () => {
					if (
						lifecycle.signal?.aborted ||
						!this.authorized(this.read(), transaction.candidate)
					)
						throw new Error(
							"Update activation cancelled by current policy/candidate.",
						);
				};
				eligible();
				// Verify and pre-create everything while the old worker still serves.
				// A rejected candidate or a full disk costs nothing.
				const plan = await lifecycle.prepare(
					transaction.staged,
					transaction.previous,
					transaction.id,
				);
				migration = plan.migration ?? null;
				this.journal.update(transaction.id, (journal) => {
					journal.plan.nextLink = plan.links?.next;
					journal.plan.prevLink = plan.links?.prev;
					journal.plan.migration = migration;
				});
				if (plan.record) this.phase("draining", { snapshot: plan.record });
				eligible();
				acquiring = true;
				await lifecycle.acquireMaintenance(transaction.id);
				acquiring = false;
				maintenance = true;
				this.reach(transaction.id, "maintenance");
				// Keep admission closed across busy observations. Releasing it
				// between checks lets an unending queue refill every freed slot.
				while (true) {
					eligible();
					const observed = await lifecycle.isIdle();
					const idle = typeof observed === "boolean" ? observed : observed.idle;
					if (idle) {
						if (typeof observed !== "boolean" && observed.baseline)
							baseline = observed.baseline;
						break;
					}
					await delay(1000);
				}
				eligible();
				this.reach(transaction.id, "drained", baseline ?? undefined);
				// This short write is the atomic authorization boundary. A policy mutation
				// can occur during any preceding await, but never slip between authorization
				// and committing the stopping phase.
				this.change((current) => {
					if (!this.authorized(current, transaction.candidate))
						throw new Error(
							"Update activation cancelled by current policy/candidate.",
						);
					current.transaction!.phase = "stopping";
					current.transaction!.switchStarted = true;
				});
				this.reach(transaction.id, "stopped");
				await lifecycle.stop();
				this.phase("activating");
				this.reach(transaction.id, "switched");
				await lifecycle.activate(transaction.staged);
				this.phase("starting");
				this.reach(transaction.id, "started");
				await lifecycle.start();
				this.phase("health");
				await lifecycle.health(transaction.candidate, {
					transactionId: transaction.id,
					baseline,
					migration,
				});
				this.reach(transaction.id, "healthy");
				this.reach(transaction.id, "committed");
				this.commit(transaction);
				await this.discard(transaction.id);
			} catch (error) {
				// A simulated or real process death runs nothing further.
				if (this.crashed) throw error;
				releaseFailureReserve();
				const current = this.read().transaction!;
				const message = (error as Error).message;
				const environmental = isEnvironmentalError(error);
				const cancelled = message.startsWith("Update activation cancelled");
				if (acquiring && !maintenance) {
					this.phase("recovery-required", {
						error: `Maintenance acquisition outcome uncertain: ${message}`,
					});
				} else if (!current.switchStarted) {
					const exhausted =
						environmental && this.noteFailure(transaction.candidate);
					this.phase("cancelled", { error: message });
					this.change((value) => {
						value.error = message;
						if (!cancelled && (!environmental || exhausted))
							this.markBad(value, transaction.candidate);
					});
					await this.discard(transaction.id);
				} else {
					this.phase("rollback", { error: message });
					this.journal.update(transaction.id, (journal) => {
						journal.intent = "rollback";
					});
					try {
						await lifecycle.rollback(this.read().transaction!, {
							transactionId: transaction.id,
							baseline,
						});
						const exhausted =
							environmental && this.noteFailure(transaction.candidate);
						this.change((value) => {
							value.installed = transaction.previous;
							value.transaction!.phase = "rolled-back";
							this.prepareRelease(value.transaction!);
							if (!environmental || exhausted)
								this.markBad(value, transaction.candidate);
							value.error = message;
							if (value.pending) delete value.pending.consentRevision;
						});
						await this.discard(transaction.id);
					} catch (rollbackError) {
						this.phase("recovery-required", {
							error: `${message}; rollback failed: ${(rollbackError as Error).message}`,
						});
						maintenance = false;
					}
				}
			} finally {
				releaseFailureReserve();
				if (maintenance && !this.crashed) {
					try {
						await this.releaseMaintenance(transaction.id);
					} catch (error) {
						this.phase("recovery-required", {
							error: `Maintenance release failed: ${(error as Error).message}`,
						});
					}
				} else if (!maintenance && !this.crashed) {
					// Rejected while still serving: intake was never frozen, nothing to release.
					const ended = this.read().transaction;
					if (
						ended?.id === transaction.id &&
						ended.release?.status === "pending" &&
						ended.phase === ended.release.outcome
					) {
						this.change((value) => {
							value.transaction!.release!.status = "acknowledged";
						});
						try {
							this.journal.remove(transaction.id);
						} catch {}
					}
				}
			}
			return this.status();
		});
	}
	/** Caller must stop the recorded operation owner first. Retains the transaction.
	 * One rule: anything the journal does not show as committed rolls back (or, if
	 * nothing destructive had started, is cancelled); the retry is a new transaction. */
	async recover(confirm: string) {
		if (confirm !== "operation owner stopped")
			throw new Error(
				'Confirm "operation owner stopped" only after checking the retained owner is no longer running.',
			);
		if (!this.lifecycle)
			throw new Error("Recovery needs the owned lifecycle supervisor.");
		const lifecycle = this.lifecycle;
		return this.operation(async () => {
			const transaction = this.read().transaction;
			const journal = transaction && this.journal.read(transaction.id);
			if (transaction && journal && stepAtLeast(journal.step, "committed")) {
				// The journal says committed: repair state.json and the backup, then release.
				if (transaction.phase !== "succeeded" || !transaction.release)
					this.commit(transaction);
				else
					try {
						commitBackup(this.home, transaction.id);
					} catch {}
				await this.discard(transaction.id);
				await this.releaseMaintenance(transaction.id);
				return this.status();
			}
			if (
				transaction &&
				(transaction.release?.status === "pending" ||
					(OutcomeSchema.safeParse(transaction.phase).success &&
						!transaction.release))
			) {
				await this.releaseMaintenance(transaction.id);
				return this.status();
			}
			if (!terminal(transaction)) {
				await lifecycle.acquireMaintenance(transaction!.id);
				// Without a journal (a transaction written by an older supervisor) the
				// persisted authorization boundary is the best evidence there is.
				const destructive = journal
					? stepAtLeast(journal.step, "stopped")
					: transaction!.switchStarted;
				const exhausted = this.noteFailure(transaction!.candidate);
				if (!destructive) {
					this.phase("cancelled", {
						error: "Interrupted before switching; previous runtime retained.",
					});
					if (exhausted)
						this.change((state) => this.markBad(state, transaction!.candidate));
				} else {
					this.phase("rollback");
					try {
						await lifecycle.rollback(transaction!, {
							transactionId: transaction!.id,
							baseline: journal?.baseline,
						});
						const untouched = journal && !stepAtLeast(journal.step, "switched");
						this.change((state) => {
							state.installed = transaction!.previous;
							state.transaction!.phase = untouched
								? "cancelled"
								: "rolled-back";
							if (untouched)
								state.transaction!.error =
									"Interrupted before switching; previous runtime retained.";
							this.prepareRelease(state.transaction!);
							if (exhausted) this.markBad(state, transaction!.candidate);
							if (state.pending) delete state.pending.consentRevision;
						});
					} catch (error) {
						this.phase("recovery-required", {
							error: (error as Error).message,
						});
						throw error;
					}
				}
				await this.discard(transaction!.id);
				await this.releaseMaintenance(transaction!.id);
			}
			return this.status();
		}, true);
	}
	/** Supervisor timer: 15-minute release checks, capped exponential offline
	 * backoff; pending candidates coalesce to the current validated channel target. */
	async tick() {
		const current = this.read();
		if (current.blocked || this.activeRecovery(current)) return this.status();
		if (Date.now() >= this.read().nextCheckAt) await this.check();
		const state = this.read();
		if (state.pending && this.authorized(state, state.pending.candidate)) {
			const key = candidateKey(state.pending.candidate);
			if (!state.pending.staged) {
				if (this.journal.notBefore(`stage:${key}`) > Date.now())
					return this.status();
				await this.stage();
			}
			// A candidate that was interrupted or hit a full disk waits before retrying.
			if (this.lifecycle && this.journal.notBefore(key) <= Date.now())
				await this.reconcile();
		}
		return this.status();
	}
}
