import { type ChildProcess, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statfsSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { readStateFormat } from "bobs-factory-core";
import {
	backupSlot,
	type DataBaseline,
	type DataSummary,
	dataRegression,
	type HealthExpectation,
	InsufficientSpaceError,
	type PreparePlan,
	readManifest,
	requestFactoryTerminalSession,
	restoreMigrationBackupFor,
	UPDATE_TRANSACTION_ENV,
	UpdateRejectedError,
} from "bobs-factory-edge-worker";
import { FactoryClient, FactoryRequestError } from "../tui/client.js";
import { desktopStopped, lifecycleGuard } from "./DesktopLifecycle.js";
import {
	assertInstallationProof,
	type InstallationProof,
	installationProof,
} from "./InstallationOwnership.js";
import {
	acquireInstanceLock,
	ownerAlive,
	ownerProcessExited,
	reconcileChildWorkerOwner,
	type WorkerOwner,
	workerIdentityMatches,
	workerOwner,
} from "./InstanceLock.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";

const runFile = promisify(execFile);
export interface LifecycleCandidate {
	version: string;
	commit: string;
	target: string;
}
export interface LifecycleStaged {
	candidate: LifecycleCandidate;
	executable: string;
	previousExecutable: string;
}
export interface LifecycleTransaction {
	id: string;
	staged: LifecycleStaged;
	snapshot?: string;
}
/** `GET /api/updates/drain`: `baseline` from this build's workers, `runIds` from v2 workers. */
interface Drain {
	idle: boolean;
	baseline?: DataBaseline;
	runIds?: string[];
}
interface FormatProbe {
	writes: number;
	migratesFrom: number;
	plan?: Array<{ estimateBytes?: number }>;
}
const HEALTH_WINDOW_MS = 120_000;
const MIGRATION_EXTENSION_MS = 10 * 60_000;
const MIN_FREE_MARGIN = 64 * 1024 * 1024;
interface Owner {
	kind: "service" | "desktop";
	executable: string;
}
/** External owner adapter. Never replace a running worker from its own process. */
export class OwnedUpdateLifecycle {
	private childWorker?: { child: ChildProcess; owner: WorkerOwner };
	private transactionId?: string;
	/** An idle observation was already recorded for this transaction. */
	private drained = false;
	private staged?: LifecycleStaged;
	private readonly manager: ServiceLifecycle;
	private readonly client: FactoryClient;
	private readonly owner: Owner;
	private readonly installationOwner: InstallationProof | undefined;
	constructor(
		readonly home: string,
		port: number,
		readonly signal?: AbortSignal,
	) {
		this.manager = new ServiceLifecycle(home);
		this.home = this.manager.home;
		home = this.home;
		this.client = new FactoryClient({
			home,
			port,
			requestSession: requestFactoryTerminalSession,
		});
		const service = this.manager.record();
		const desktop = join(home, "runtime", "desktop-runtime.json");
		if (service)
			this.owner = { kind: "service", executable: service.executable };
		else if (existsSync(desktop)) {
			const record = JSON.parse(readFileSync(desktop, "utf8"));
			const link = join(
				home,
				"runtime",
				"desktop-installed",
				"bin",
				"bobs-factory",
			);
			if (
				record.schema !== 1 ||
				record.home !== realpathSync(home) ||
				record.executable !== link
			)
				throw new Error("Desktop installation ownership mismatch");
			this.owner = { kind: "desktop", executable: link };
		} else
			throw new Error(
				"Foreground/checkout/Nix/external owner: use its supported update handoff, not an owned replacement",
			);
		if (!lstatSync(this.owner.executable).isSymbolicLink())
			throw new Error(
				"Updates require the explicit owned executable link, never an app bundle/system executable",
			);
		this.installationOwner =
			service?.updateOwner ??
			(!service ? installationProof(home, this.owner.executable) : undefined);
		assertInstallationProof(
			home,
			this.owner.executable,
			this.installationOwner,
		);
		const current = workerOwner(home);
		if (current?.pid === process.pid)
			throw new Error(
				"Update supervisor must be outside the worker being replaced",
			);
	}
	get runtimeLink() {
		return this.owner.executable;
	}
	/** Never adopt a discovered process or replace an invalid/conflicting record.
	 * Only this adapter's still-live, previously verified child can regain its lock. */
	async reconcileChildOwnership() {
		const retained = this.childWorker;
		if (!retained) return false;
		const release = await lifecycleGuard(this.home);
		try {
			if (workerOwner(this.home)) return false;
			this.assertMayStart();
			return reconcileChildWorkerOwner(
				this.home,
				retained.child,
				retained.owner,
				this.owner.executable,
				Number(new URL(this.client.origin).port),
			);
		} finally {
			release();
		}
	}
	private fence() {
		return join(this.home, "runtime", "update-owner.json");
	}
	private save(value: unknown) {
		mkdirSync(dirname(this.fence()), { recursive: true, mode: 0o700 });
		writeFileSync(`${this.fence()}.tmp`, JSON.stringify(value), {
			mode: 0o600,
			flush: true,
		});
		renameSync(`${this.fence()}.tmp`, this.fence());
	}
	async acquireMaintenance(transactionId: string) {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			this.admitMaintenance(transactionId);
		} finally {
			release();
		}
		await this.beginMaintenance(transactionId);
	}
	private admitMaintenance(transactionId: string) {
		if (this.transactionId !== transactionId) {
			this.drained = false;
			this.staged = undefined;
		}
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another update owns lifecycle suppression");
			// A v2 supervisor's fence records its idle receipt as `preservation`.
			this.drained = Boolean(saved.drained || saved.preservation);
		}
		this.transactionId = transactionId;
		this.save({ transactionId, drained: this.drained || undefined });
	}
	private async beginMaintenance(transactionId: string) {
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			if (!this.drained) {
				const transaction = JSON.parse(
					readFileSync(join(this.home, "updates", "state.json"), "utf8"),
				).transaction;
				if (
					transaction?.id !== transactionId ||
					transaction.switchStarted ||
					realpathSync(this.owner.executable) !==
						realpathSync(transaction.staged.previousExecutable)
				)
					throw new Error(
						"Interrupted switch lacks a durable idle observation",
					);
			}
			const marker = process.env.BOBS_FACTORY_WORKER_ID;
			try {
				const release = await acquireInstanceLock(this.home);
				release();
			} finally {
				if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
				else process.env.BOBS_FACTORY_WORKER_ID = marker;
			}
			if (this.drained) return;
			if (this.owner.kind === "desktop") await this.start(false);
			else {
				for (let attempt = 0; attempt < 150; attempt++) {
					const live = workerOwner(this.home);
					if (live && ownerAlive(live)) break;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "begin",
		});
	}
	/** Run ids a v2 worker reports plus the run files on disk: both describe
	 * what the worker being replaced has loaded. */
	private legacyBaseline(runIds: string[] = []): DataBaseline {
		const ids = new Set(runIds);
		try {
			for (const name of readdirSync(join(this.home, "factory", "runs")))
				if (name.endsWith(".json")) ids.add(name.slice(0, -5));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return { runIds: [...ids].sort() };
	}
	async isIdle() {
		// `light` skips the whole-state digest; older workers ignore it and send runIds.
		const receipt = await this.client.get<Drain>("/api/updates/drain?light=1");
		if (!receipt.idle) return { idle: false };
		this.drained = true;
		this.save({ transactionId: this.transactionId, drained: true });
		return {
			idle: true,
			baseline: receipt.baseline ?? this.legacyBaseline(receipt.runIds),
		};
	}
	/** Ask the candidate which data format it writes. Read-only. A build from
	 * before the framework has no such command and writes format 1. */
	private async probeFormat(executable: string): Promise<FormatProbe> {
		try {
			const { stdout } = await runFile(
				executable,
				["--home", this.home, "--no-open", "service", "format", "--json"],
				{ timeout: 30000, env: { PATH: process.env.PATH, HOME: this.home } },
			);
			const probe = JSON.parse(stdout) as FormatProbe;
			if (
				!Number.isInteger(probe.writes) ||
				!Number.isInteger(probe.migratesFrom)
			)
				throw new Error("Candidate returned an unrecognised format report");
			return probe;
		} catch (error) {
			const text = `${(error as { stderr?: string }).stderr ?? ""} ${(error as Error).message}`;
			if (/unknown command|too many arguments/i.test(text))
				return { writes: 1, migratesFrom: 1 };
			throw error;
		}
	}
	private linkPath(kind: "next" | "prev", transactionId: string) {
		return `${this.owner.executable}.${kind}-${transactionId}`;
	}
	/** Links of abandoned transactions: only one update runs at a time. */
	private sweepLinks(keep: string) {
		const directory = dirname(this.owner.executable);
		const name = basename(this.owner.executable);
		for (const entry of readdirSync(directory))
			if (
				(entry.startsWith(`${name}.next-`) ||
					entry.startsWith(`${name}.prev-`)) &&
				!entry.endsWith(`-${keep}`)
			)
				rmSync(join(directory, entry), { force: true });
	}
	/** Verify and pre-create while the old worker still serves: no copies, so a
	 * rejected candidate or a full disk costs nothing. */
	async prepare(
		staged: LifecycleStaged,
		installed: { version: string },
		transactionId: string,
	): Promise<PreparePlan> {
		if (
			staged.candidate.version.split(".")[0] !== installed.version.split(".")[0]
		)
			throw new Error(
				"Cross-major state migration requires an explicit reviewed adapter",
			);
		const executable = realpathSync(staged.executable),
			previous = realpathSync(staged.previousExecutable);
		if (previous !== realpathSync(this.owner.executable))
			throw new Error("Staged previous runtime does not match selected owner");
		const metadata = JSON.parse(
			readFileSync(join(dirname(executable), "build.json"), "utf8"),
		);
		const bytes = readFileSync(executable);
		if (
			metadata.product !== "bobs-factory" ||
			metadata.dirty ||
			metadata.version !== staged.candidate.version ||
			metadata.commit !== staged.candidate.commit ||
			metadata.target !== staged.candidate.target ||
			metadata.executable?.sha256 !==
				createHash("sha256").update(bytes).digest("hex") ||
			metadata.executable.size !== bytes.length
		)
			throw new Error("Staged runtime identity/integrity mismatch");
		const probe = await this.probeFormat(executable);
		const onDisk = readStateFormat(this.home);
		if (probe.writes < onDisk || onDisk < probe.migratesFrom)
			throw new UpdateRejectedError(
				probe.writes < onDisk
					? `Candidate understands data format ${probe.writes}; yours is ${onDisk}.`
					: `Candidate migrates data from format ${probe.migratesFrom}; yours is ${onDisk}. Update through an intermediate version first.`,
			);
		const migration =
			onDisk < probe.writes ? { from: onDisk, to: probe.writes } : null;
		if (migration) {
			const estimate = (probe.plan ?? []).reduce(
				(sum, step) => sum + (step.estimateBytes ?? 0),
				0,
			);
			const needed =
				estimate + Math.max(MIN_FREE_MARGIN, Math.ceil(estimate * 0.1));
			const stats = statfsSync(this.home);
			const free = stats.bavail * stats.bsize;
			if (free < needed) throw new InsufficientSpaceError(needed, free);
		}
		assertInstallationProof(
			this.home,
			this.owner.executable,
			this.installationOwner,
		);
		this.sweepLinks(transactionId);
		// Switching and rolling back become renames of these links: no allocation.
		const links = {
			next: this.linkPath("next", transactionId),
			prev: this.linkPath("prev", transactionId),
		};
		rmSync(links.next, { force: true });
		rmSync(links.prev, { force: true });
		symlinkSync(executable, links.next);
		symlinkSync(previous, links.prev);
		this.transactionId = transactionId;
		this.staged = { ...staged, executable, previousExecutable: previous };
		return { links, migration };
	}
	/** Remove the links `prepare` created once the transaction is over. */
	discard(transactionId: string) {
		rmSync(this.linkPath("next", transactionId), { force: true });
		rmSync(this.linkPath("prev", transactionId), { force: true });
	}
	private async stopDesktopOwner() {
		const expected = workerOwner(this.home);
		if (
			!expected ||
			expected.owner !== "desktop" ||
			expected.executable !== realpathSync(this.owner.executable)
		)
			throw new Error("Desktop worker ownership mismatch");
		if (ownerAlive(expected)) {
			try {
				process.kill(expected.pid, "SIGTERM");
			} catch (error) {
				if (ownerAlive(expected)) throw error;
			}
		}
		for (let attempt = 0; attempt < 300; attempt++) {
			const current = workerOwner(this.home);
			if (!current) return;
			if (current.nonce !== expected.nonce)
				throw new Error(
					"Worker owner changed during shutdown; replacement forbidden",
				);
			if (!ownerAlive(current)) {
				const release = await acquireInstanceLock(this.home, {
					markWorker: false,
				});
				release();
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("Desktop worker still owns home; replacement forbidden");
	}
	async stop() {
		if (!this.transactionId) throw new Error("Maintenance required");
		// Still idle? Background writes are allowed; accepted work is not.
		const fresh = await this.client.get<Drain>("/api/updates/drain?light=1");
		if (!fresh.idle) throw new Error("Idle state changed before stop");
		if (this.owner.kind === "service") await this.manager.action("maintenance");
		else await this.stopDesktopOwner();
	}
	/** Rename a pre-created link over the runtime link (allocation-free). */
	private switchLink(kind: "next" | "prev", executable: string) {
		assertInstallationProof(
			this.home,
			this.owner.executable,
			this.installationOwner,
		);
		if (workerOwner(this.home))
			throw new Error("Existing worker ownership blocks runtime activation");
		const pre = this.linkPath(kind, this.transactionId!);
		if (realpathSync(this.owner.executable) === executable) {
			rmSync(pre, { force: true });
			return;
		}
		try {
			if (
				!lstatSync(pre, { throwIfNoEntry: false }) ||
				realpathSync(pre) !== executable
			) {
				rmSync(pre, { force: true });
				symlinkSync(executable, pre);
			}
			renameSync(pre, this.owner.executable);
		} catch (error) {
			rmSync(pre, { force: true });
			throw error;
		}
	}
	async activate(staged: LifecycleStaged) {
		if (
			!this.staged ||
			this.staged.executable !== realpathSync(staged.executable)
		)
			throw new Error("Candidate not prepared");
		this.switchLink("next", this.staged.executable);
	}
	/** Slow migrations keep the worker from answering. Extend the wait while a
	 * backup bound to this transaction shows one is in progress, up to a cap. */
	private waitWindow(baseMs: number) {
		const begun = Date.now();
		return () => {
			const now = Date.now();
			if (now < begun + baseMs) return false;
			try {
				const manifest = readManifest(backupSlot(this.home));
				if (
					manifest &&
					manifest.transactionId === this.transactionId &&
					["backing-up", "ready", "applying"].includes(manifest.status) &&
					now < begun + baseMs + MIGRATION_EXTENSION_MS
				)
					return false;
			} catch {}
			return true;
		};
	}
	private async readyRuntime() {
		const expected = JSON.parse(
			readFileSync(
				join(dirname(realpathSync(this.owner.executable)), "build.json"),
				"utf8",
			),
		);
		const readiness = new FactoryClient({
			home: this.home,
			port: Number(new URL(this.client.origin).port),
			requestSession: requestFactoryTerminalSession,
			requestTimeoutMs: 1000,
		});
		const expired = this.waitWindow(30000);
		while (!expired()) {
			try {
				const { runtime } = await readiness.get<{
					runtime: LifecycleCandidate;
				}>("/api/version");
				const owner = workerOwner(this.home);
				if (
					owner &&
					ownerAlive(owner) &&
					owner.executable === realpathSync(this.owner.executable) &&
					runtime.version === expected.version &&
					runtime.commit === expected.commit &&
					runtime.target === expected.target
				)
					return;
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			"Owned worker did not become ready with the exact runtime identity",
		);
	}
	private assertMayStart() {
		if (
			desktopStopped(this.home) ||
			["stopped"].includes(this.manager.record()?.desired ?? "")
		)
			throw new Error(
				"Deliberate Stop intent blocks automatic startup/recovery",
			);
	}
	/** `bind` hands the transaction to the worker so a migration at startup is
	 * backed up for exactly this transaction. Starting the previous worker never binds. */
	async start(bind = true) {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			await this.startOwned(bind);
		} finally {
			release();
		}
	}
	private async startOwned(bind: boolean) {
		if (this.owner.kind === "service") {
			await this.manager.resume();
			for (let attempt = 0; attempt < 300; attempt++) {
				const current = workerOwner(this.home);
				if (
					current &&
					current.owner === "service" &&
					current.executable === realpathSync(this.owner.executable) &&
					ownerAlive(current)
				) {
					await this.readyRuntime();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Managed replacement did not acquire its worker startup fence",
			);
		} else {
			const { spawn } = await import("node:child_process");
			const log = (await import("node:fs")).openSync(
				join(this.home, "runtime", "desktop-worker.log"),
				"a",
				0o600,
			);
			const child = spawn(
				this.owner.executable,
				[
					"--home",
					this.home,
					"--port",
					String(new URL(this.client.origin).port),
					"--no-open",
					"local",
				],
				{
					detached: true,
					cwd: this.home,
					stdio: ["ignore", log, log],
					env: {
						...process.env,
						BOBS_FACTORY_DESKTOP_OWNER: "1",
						...(bind && this.transactionId
							? { [UPDATE_TRANSACTION_ENV]: this.transactionId }
							: {}),
					},
				},
			);
			(await import("node:fs")).closeSync(log);
			let launchError: Error | undefined;
			child.on("error", (error) => {
				launchError = error;
			});
			child.unref();
			// A spawned process has not necessarily claimed its durable worker
			// fence yet. Never let immediate failure/rollback race that startup.
			for (let attempt = 0; attempt < 300; attempt++) {
				if (launchError) throw launchError;
				if (child.exitCode !== null || child.signalCode !== null)
					throw new Error("Owned worker exited before acquiring ownership");
				const current = workerOwner(this.home);
				if (current) {
					if (current.pid !== child.pid)
						throw new Error("Another worker acquired ownership during launch");
					if (ownerAlive(current)) {
						await this.readyRuntime();
						if (
							current.owner === "desktop" &&
							workerIdentityMatches(
								current,
								this.home,
								this.owner.executable,
								Number(new URL(this.client.origin).port),
							)
						)
							this.childWorker = { child, owner: current };
						return;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Owned worker did not acquire its startup fence; recovery must confirm its exit",
			);
		}
	}
	async restartCrashedDesktop() {
		if (
			this.owner.kind !== "desktop" ||
			existsSync(this.fence()) ||
			existsSync(join(this.home, "runtime", "desktop-stopped.json"))
		)
			return;
		const current = workerOwner(this.home);
		// Absence is not proof of exit: an unrecorded worker may still be running.
		if (!current || ownerAlive(current)) return;
		if (
			current.owner !== "desktop" ||
			current.executable !== realpathSync(this.owner.executable) ||
			current.dashboardPort !== Number(new URL(this.client.origin).port) ||
			!ownerProcessExited(current)
		)
			throw new Error(
				"Desktop crash ownership cannot be verified; replacement blocked",
			);
		const marker = process.env.BOBS_FACTORY_WORKER_ID;
		try {
			const release = await acquireInstanceLock(this.home);
			release();
		} finally {
			if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
			else process.env.BOBS_FACTORY_WORKER_ID = marker;
		}
		await this.start(false);
	}

	/** Identity of what loaded, never bytes: a token refresh or recipe
	 * re-serialization during the window cannot fail an update. */
	private async dataFailure(
		expect: HealthExpectation | undefined,
	): Promise<string | undefined> {
		let summary: DataSummary | undefined;
		try {
			summary = await this.client.get<DataSummary>("/api/updates/data");
		} catch (error) {
			if (!(error instanceof FactoryRequestError) || error.status !== 404)
				throw error;
		}
		if (!summary) {
			// A v2 worker (rollback target) has no data endpoint; its drain receipt
			// still lists the run ids it loaded.
			const receipt = await this.client.get<Drain>("/api/updates/drain");
			const have = new Set(receipt.runIds ?? []);
			const missing = (expect?.baseline?.runIds ?? []).filter(
				(id) => !have.has(id),
			);
			return missing.length
				? `Runs missing after update: ${missing.slice(0, 5).join(", ")}`
				: undefined;
		}
		const regression = dataRegression(summary, expect?.baseline);
		if (regression) return regression;
		if (expect?.migration && summary.stateFormat !== expect.migration.to)
			return `Data format ${summary.stateFormat} loaded; expected ${expect.migration.to}`;
		return undefined;
	}
	async health(candidate: LifecycleCandidate, expect?: HealthExpectation) {
		let failure = "Runtime did not respond";
		const expired = this.waitWindow(HEALTH_WINDOW_MS);
		while (true) {
			try {
				const identity = await this.client.get<{ runtime: LifecycleCandidate }>(
					"/api/version",
				);
				const owner = workerOwner(this.home);
				const liveOwner = Boolean(
					owner &&
						ownerAlive(owner) &&
						owner.executable === realpathSync(this.owner.executable),
				);
				const identical =
					identity.runtime.version === candidate.version &&
					identity.runtime.commit === candidate.commit &&
					identity.runtime.target === candidate.target;
				const data =
					identical && liveOwner ? await this.dataFailure(expect) : undefined;
				if (identical && liveOwner && !data) return;
				failure = `Observed ${identity.runtime.version}/${identity.runtime.commit}/${identity.runtime.target}; liveOwner=${liveOwner}${data ? `; ${data}` : ""}`;
			} catch (error) {
				failure = (error as Error).message;
			}
			if (expired()) break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			`Replacement failed exact runtime/data health check: ${failure}`,
		);
	}
	async rollback(
		transaction: LifecycleTransaction,
		expect?: HealthExpectation,
	) {
		this.transactionId = transaction.id;
		// Suppression stays active. Stop only the failed replacement, never a new external owner.
		if (workerOwner(this.home)) {
			if (this.owner.kind === "service")
				await this.manager.action("maintenance");
			else await this.stopDesktopOwner();
		}
		if (workerOwner(this.home))
			throw new Error("Replacement exit not confirmed");
		// The data stays where it is. Only a migration this transaction started
		// has files to put back, and they go back by rename from its own backup.
		restoreMigrationBackupFor(this.home, transaction.id);
		this.switchLink(
			"prev",
			realpathSync(transaction.staged.previousExecutable),
		);
		await this.start(false);
		const old = JSON.parse(
			readFileSync(
				join(
					dirname(realpathSync(transaction.staged.previousExecutable)),
					"build.json",
				),
				"utf8",
			),
		);
		await this.health(old, expect);
	}
	async releaseMaintenance(transactionId: string) {
		if (!this.transactionId) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			if (
				transaction?.id !== transactionId ||
				(transaction.release &&
					transaction.release.transactionId !== transactionId) ||
				(!transaction.release &&
					!["succeeded", "rolled-back", "cancelled"].includes(
						transaction.phase,
					))
			)
				throw new Error(
					"Maintenance release lacks exact durable terminal outcome",
				);
			this.transactionId = transactionId;
		}
		if (transactionId !== this.transactionId)
			throw new Error("Maintenance owner mismatch");
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another lifecycle owns maintenance");
			this.drained = Boolean(saved.drained || saved.preservation);
		} else if (!existsSync(join(this.home, "updates", "maintenance.json")))
			return;
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			const expected =
				(transaction.release?.outcome ?? transaction.phase) === "succeeded"
					? transaction.candidate
					: transaction.previous;
			await this.acquireMaintenance(transactionId);
			await this.start(false);
			await this.health(expected);
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "end",
		});
		rmSync(this.fence(), { force: true });
	}
}
