import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryReference } from "./GitProviderReference.js";
import { decisionFor } from "./Impact.js";
import { delay } from "./MergeReadiness.js";
import {
	groupedOutput,
	repositoryRun,
	runRepositories,
} from "./RepositoryScope.js";
import { deliveryTargetLabel } from "./RunAttention.js";
import { takeoverSource } from "./RunContextSources.js";
import {
	accessMode,
	consumesImpact,
	hasCheck,
	readOutput,
	resolveStepConfig,
} from "./StepConfig.js";
import { outputForTool } from "./ToolBindings.js";
import type { WorkflowStep } from "./Workflow.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** Instance-owned coordination, persisted with the run rather than a process lease. */
export interface DeliveryCoordination {
	waitingSince?: string;
	priority?: "completion" | "normal";
	readiness?: "checking" | "blocked" | "active" | "released" | "unknown";
	waitReason?: string;
	operation?: string;
	blockers?: { runId: string; operation: string; targets: string[] }[];
	scopes: string[];
	/** Already owned targets remain exclusive while an operation expands its scope. */
	heldScopes?: string[];
	queuedAt: string;
	phase: "queued" | "active" | "released";
	admittedAt?: string;
	releasedAt?: string;
	reason?: string;
	/** Per-operation state for the existing run summary, including concurrent waits. */
	reservations?: (Omit<DeliveryCoordination, "reservations"> & {
		runId: string;
		operation: string;
	})[];
}
/** After one minute of continuous eligibility, FIFO takes precedence over priority. */
export const DELIVERY_AGING_MS = 60_000;
const unconfirmedCancellation =
	"External execution cancellation is unconfirmed; resource retained";
const terminal = (run: FactoryRun) =>
	!["running", "waiting"].includes(run.status);
function cancellationUnconfirmed(
	run: FactoryRun,
	operation: string,
	claim: DeliveryCoordination,
): boolean {
	const leaf =
		run.capacityLeaves?.[operation.replace(/:(mutation|resources)$/, "")];
	return (
		(claim.phase === "active" || Boolean(claim.heldScopes?.length)) &&
		leaf?.phase === "stopping" &&
		Boolean(leaf.request)
	);
}
const repositoryIdentities = new Map<string, string>();
function localRepository(path: string): string {
	const normalized = existsSync(path) ? realpathSync(path) : resolve(path);
	const cached = repositoryIdentities.get(normalized);
	if (cached) return cached;
	let identity = `local:${normalized}`;
	if (existsSync(path)) {
		try {
			const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
				cwd: path,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			}).trim();
			identity = `local:${realpathSync(resolve(path, common))}`;
		} catch {
			/* A fixture or unpublished repository may not yet be a Git checkout. */
		}
	}
	repositoryIdentities.set(normalized, identity);
	if (repositoryIdentities.size > 200)
		repositoryIdentities.delete(repositoryIdentities.keys().next().value!);
	return identity;
}
/** Publication receipts and native worktree changes define targets, never selection alone. */
export function deliveryScopes(run: FactoryRun): string[] {
	return [
		...new Set(
			runRepositories(run)
				.filter((repository) => {
					const projected = repositoryRun(run, repository);
					if (
						[
							takeoverSource(projected),
							outputForTool(projected, "draft-pr"),
							outputForTool(projected, "merge"),
						].some(
							(value) =>
								typeof (value as { url?: unknown } | undefined)?.url ===
								"string",
						)
					)
						return true;
					if (
						groupedOutput(outputForTool(run, "draft-pr"))?.deliveries.some(
							(d) => d.repositoryId === repository.id,
						)
					)
						return true;
					const git = (...args: string[]) =>
						execFileSync("git", args, {
							cwd: repository.workspace,
							encoding: "utf8",
							timeout: 5000,
							stdio: ["ignore", "pipe", "ignore"],
						}).trim();
					try {
						if (git("status", "--porcelain")) return true;
						const base =
							(
								takeoverSource(projected) as
									| { baseRefName?: string }
									| undefined
							)?.baseRefName ?? repository.baseBranch;
						let ref = `refs/remotes/origin/${base}`;
						try {
							git("rev-parse", "--verify", ref);
						} catch {
							ref = `refs/heads/${base}`;
						}
						return Boolean(git("diff", "--name-only", `${ref}...HEAD`));
					} catch {
						// An unreadable/missing base is uncertainty, not proof of unchanged context.
						return true;
					}
				})
				.map((repository) => {
					const url =
						repository.providerSnapshot?.repositoryUrl ??
						repository.githubUrl ??
						repository.gitlabUrl ??
						(repository.gitProvider?.type === "custom"
							? repository.gitProvider.repositoryUrl
							: undefined);
					const identity = url
						? repositoryReference(url).url
						: localRepository(repository.repositoryPath);
					const base =
						(
							takeoverSource(repositoryRun(run, repository)) as
								| { baseRefName?: string }
								| undefined
						)?.baseRefName ?? repository.baseBranch;
					return JSON.stringify([identity, base]);
				}),
		),
	].sort();
}

/** Concrete mutations, including renamed correction branches in frozen definitions. */
export function deliveryStep(run: FactoryRun, step: WorkflowStep): boolean {
	if (accessMode(step) === "push") return true;
	if (step.tool === "draft-pr") return true;
	// Merge owns short inspect/mutation reservations internally, releasing between provider polls.
	if (step.tool === "merge") return false;
	if (["fanout", "workflow", "foreach"].includes(step.type)) return false;
	// New recipes opt into the mutation lease through access; graph inference is legacy-only.
	if (resolveStepConfig(step).explicit) return false;
	const definitions = [run.workflow, ...(run.workflowDefinitions ?? [])];
	const correction = (steps: WorkflowStep[]): boolean =>
		steps.some(
			(item) =>
				([
					"ci",
					"merge",
					"handoff",
					"review-gate",
					"visual-gate",
					"human-review",
				].includes(item.tool ?? "") &&
					item.branches.some(
						(branch) =>
							branch.next === step.id &&
							((branch.when.path === "fix" && branch.when.equals === true) ||
								(branch.when.path === "approved" &&
									branch.when.equals === false) ||
								(branch.when.path === "decision" &&
									branch.when.equals === "reject")),
					)) ||
				(item.groups ?? []).some(correction) ||
				(item.body ? correction(item.body) : false),
		);
	return definitions.some((definition) => correction(definition.steps));
}

/** Shared QA is distinct from repository integration; legacy plans remain conservative. */
export function resourceScopes(context: ExecutionContext): string[] {
	if (context.step.resources?.length)
		return context.step.resources
			.map((resource) => JSON.stringify(["resource", resource]))
			.sort();
	if (context.step.tool === "impact-checks" && consumesImpact(context.step)) {
		const decision = context.impactKey
			? decisionFor(context.run, context.impactKey)
			: undefined;
		if (!decision)
			throw new Error(
				"Selected checks require persisted impact/resource decisions",
			);
		const scopes = new Set<string>();
		for (const check of decision.checks.filter((c) =>
			decision.pending.checks.includes(c.id),
		)) {
			if (check.environment?.isolation === "worktree") continue;
			if (check.environment?.isolation === "shared") {
				for (const resource of check.environment.resources)
					scopes.add(JSON.stringify(["resource", resource]));
			} else {
				const repository = runRepositories(context.run).find(
					(r) => r.id === check.repositoryId,
				)!;
				const url =
					repository.providerSnapshot?.repositoryUrl ??
					repository.githubUrl ??
					repository.gitlabUrl;
				scopes.add(
					JSON.stringify([
						"qa",
						url
							? repositoryReference(url).url
							: localRepository(repository.repositoryPath),
					]),
				);
			}
		}
		return [...scopes].sort();
	}
	if (!hasCheck(context.step, "qa-environment")) return [];
	const environment = (
		readOutput(context.step, "scope", context.outputs ?? context.run.outputs) as
			| {
					environment?: { isolation: string; resources?: string[] };
			  }
			| undefined
	)?.environment;
	if (environment?.isolation === "worktree") return [];
	if (environment?.isolation === "shared") {
		if (!environment.resources?.length)
			throw new Error(
				"Shared QA requires explicit resource identities before execution",
			);
		return environment.resources
			.map((resource) => JSON.stringify(["resource", resource]))
			.sort();
	}
	return runRepositories(context.run)
		.map((repository) => {
			const url =
				repository.providerSnapshot?.repositoryUrl ??
				repository.githubUrl ??
				repository.gitlabUrl;
			return JSON.stringify([
				"qa",
				url
					? repositoryReference(url).url
					: localRepository(repository.repositoryPath),
			]);
		})
		.sort();
}

function claims(run: FactoryRun): [string, DeliveryCoordination][] {
	return Object.entries(run.deliveryReservations ?? {}).filter(
		([, claim]) => claim.phase !== "released",
	);
}
function updateSummary(run: FactoryRun, last: DeliveryCoordination): void {
	const entries = claims(run);
	const pending = entries.map(([, claim]) => claim);
	const active = pending.find((claim) => claim.phase === "active");
	run.deliveryCoordination = pending.length
		? {
				...(active ?? pending[0]!),
				scopes: [...new Set(pending.flatMap((claim) => claim.scopes))].sort(),
				reservations: entries.map(([operation, claim]) => ({
					...claim,
					runId: run.id,
					operation,
				})),
			}
		: { ...last, reservations: [] };
}

function continuousWait(
	claim: DeliveryCoordination | undefined,
	now: number,
): string | undefined {
	if (claim?.phase !== "queued" || claim.admittedAt || claim.releasedAt)
		return undefined;
	const queued = Date.parse(claim.queuedAt);
	const waiting = Date.parse(claim.waitingSince ?? claim.queuedAt);
	const since = Math.max(queued, waiting);
	return Number.isFinite(since) && since <= now
		? new Date(since).toISOString()
		: undefined;
}

function queueOrder(
	claim: DeliveryCoordination,
	owner: string,
	other: DeliveryCoordination,
	otherOwner: string,
	now: number,
): number {
	const since = Date.parse(
		continuousWait(claim, now) ?? new Date(now).toISOString(),
	);
	const otherSince = Date.parse(
		continuousWait(other, now) ?? new Date(now).toISOString(),
	);
	const aged = now - since >= DELIVERY_AGING_MS;
	const otherAged = now - otherSince >= DELIVERY_AGING_MS;
	if (aged !== otherAged) return aged ? -1 : 1;
	if (!aged && claim.priority !== other.priority) {
		const priority = claim.priority === "completion" ? 0 : 1;
		const otherPriority = other.priority === "completion" ? 0 : 1;
		if (priority !== otherPriority) return priority - otherPriority;
	}
	return (
		since - otherSince || (owner < otherOwner ? -1 : owner > otherOwner ? 1 : 0)
	);
}

/** Restart only: retain proven queued waits for unfinished leaves, not old admissions. */
export function restoreDelivery(run: FactoryRun): void {
	const executing = new Set<string>();
	const visit = (
		frame: FactoryRun["checkpoint"],
		steps: WorkflowStep[],
		prefix: string,
	) => {
		if (!frame || frame.active?.phase !== "executing") return;
		const step = steps.find((candidate) => candidate.id === frame.current);
		if (!step) return;
		const key = `${prefix}${step.id}`;
		if (step.type === "workflow") {
			const definition = run.workflowDefinitions?.find(
				(candidate) => candidate.id === step.workflow,
			);
			if (definition)
				visit(frame.active.children?.[0], definition.steps, `${key}/`);
		} else if (step.type === "foreach" && frame.active.foreach) {
			frame.active.foreach.snapshot.items.forEach((item, index) => {
				visit(
					frame.active?.children?.[index],
					frame.active!.foreach!.body,
					`${key}/${item.id}/`,
				);
			});
		} else if (step.type === "fanout") {
			step.groups?.forEach((group, index) => {
				visit(frame.active?.children?.[index], group, `${key}/${index}/`);
			});
		} else {
			executing.add(`${key}:mutation`);
			executing.add(`${key}:resources`);
		}
	};
	if (["running", "waiting", "interrupted"].includes(run.status))
		visit(run.checkpoint, run.workflow.steps, "");
	const pending = Object.entries(run.deliveryReservations ?? {}).map(
		([key, claim]): [string, DeliveryCoordination] => [key, { ...claim }],
	);
	const now = Date.now();
	releaseDelivery(run, "Restart requires operation admission");
	for (const [key, claim] of pending) {
		if (cancellationUnconfirmed(run, key, claim)) continue;
		if (!executing.has(key) || claim.phase === "released") continue;
		claim.queuedAt = continuousWait(claim, now) ?? new Date(now).toISOString();
		claim.waitingSince = claim.queuedAt;
		claim.priority ??= "normal";
		claim.phase = "queued";
		claim.readiness = "checking";
		claim.waitReason = "Restart requires operation admission";
		delete claim.admittedAt;
		delete claim.releasedAt;
		delete claim.heldScopes;
		delete claim.blockers;
		delete claim.reservations;
		run.deliveryReservations![key] = claim;
		updateSummary(run, claim);
	}
}

/** Atomic grouped admission in one Factory instance, without an agent/capacity slot. */
export async function acquireDelivery(
	run: FactoryRun,
	runs: () => Iterable<FactoryRun>,
	signal: AbortSignal,
	save: () => void | Promise<void>,
	log: (message: string) => void,
	options: {
		key?: string;
		assertSchedulingOpen?: () => void;
		/** Terminal owners keep active exclusion until their in-process hooks settle. */
		ownerExecuting?: (run: FactoryRun) => boolean;
		preserveQueued?: () => boolean;
		scopes?: string[] | (() => string[]);
		reason?: string;
		priority?: "completion" | "normal";
	} = {},
): Promise<void> {
	const key = options.key ?? "delivery";
	signal.throwIfAborted();
	options.assertSchedulingOpen?.();
	if (terminal(run)) throw new Error("Run cannot acquire delivery admission");
	run.deliveryReservations ??= {};
	const previous = run.deliveryReservations[key];
	if (previous && cancellationUnconfirmed(run, key, previous))
		throw new Error(unconfirmedCancellation);
	const now = Date.now();
	const waitingSince = continuousWait(previous, now);
	const heldScopes =
		previous?.phase === "active"
			? previous.scopes
			: previous?.phase === "queued"
				? previous.heldScopes
				: undefined;
	const currentScopes = () =>
		[
			...new Set([
				...(typeof options.scopes === "function"
					? options.scopes()
					: (options.scopes ?? deliveryScopes(run))),
				...(heldScopes ?? []),
			]),
		].sort();
	const claim: DeliveryCoordination = {
		scopes: currentScopes(),
		queuedAt: waitingSince ?? new Date(now).toISOString(),
		waitingSince: waitingSince ?? new Date(now).toISOString(),
		priority:
			options.priority ??
			(waitingSince ? previous?.priority : undefined) ??
			"normal",
		phase: "queued",
		readiness: "checking",
		...(heldScopes?.length ? { heldScopes: [...heldScopes] } : {}),
		operation: key,
		reason: options.reason ?? "Repository integration/publication",
	};
	const assertCurrent = () => {
		signal.throwIfAborted();
		options.assertSchedulingOpen?.();
		if (run.deliveryReservations?.[key] !== claim || claim.phase === "released")
			throw new Error("Delivery admission was released or replaced");
		if (terminal(run)) throw new Error("Run cannot acquire delivery admission");
	};
	// Reconcile the entire target set synchronously before admitting any mutation.
	run.deliveryReservations[key] = claim;
	updateSummary(run, claim);
	let reported = "";
	try {
		await save();
		for (;;) {
			assertCurrent();
			const now = Date.now();
			const blockers = [...runs()].flatMap((other) =>
				claims(other).flatMap(([operation, candidate]) => {
					if (other.id === run.id && operation === key) return [];
					if (
						terminal(other) &&
						!cancellationUnconfirmed(other, operation, candidate) &&
						((candidate.phase !== "active" && !candidate.heldScopes?.length) ||
							!options.ownerExecuting?.(other))
					)
						return [];
					const overlap = candidate.scopes.filter((scope) =>
						claim.scopes.includes(scope),
					);
					// A queued operation waiting on our owned targets cannot precede
					// our expansion: that would deadlock the waiter and its owner.
					const earlier =
						!terminal(other) &&
						!candidate.scopes.some((scope) =>
							claim.heldScopes?.includes(scope),
						) &&
						queueOrder(
							candidate,
							JSON.stringify([other.id, operation]),
							claim,
							JSON.stringify([run.id, key]),
							now,
						) < 0;
					const targets =
						candidate.phase === "active" || earlier
							? overlap
							: overlap.filter((scope) =>
									candidate.heldScopes?.includes(scope),
								);
					return targets.length
						? [{ runId: other.id, operation, targets }]
						: [];
				}),
			);
			if (!blockers.length) {
				// Refresh native targets only when eligible, keeping queued polling cheap.
				const current = currentScopes();
				assertCurrent();
				if (JSON.stringify(current) !== JSON.stringify(claim.scopes)) {
					claim.scopes = current;
					claim.readiness = "checking";
					delete claim.blockers;
					delete claim.waitReason;
					reported = "";
					updateSummary(run, claim);
					await save();
					continue;
				}
				claim.phase = "active";
				claim.readiness = "active";
				claim.admittedAt = new Date().toISOString();
				delete claim.blockers;
				delete claim.waitingSince;
				delete claim.waitReason;
				delete claim.heldScopes;
				updateSummary(run, claim);
				await save();
				assertCurrent();
				if (claim.scopes.length)
					log(
						`${claim.reason} admitted for ${claim.scopes.map(deliveryTargetLabel).join(", ")}.`,
					);
				return;
			}
			// Expansion may retain already-mutated targets. A cycle must unwind
			// through the owning operation's cleanup, never wait forever or release it early.
			if (claim.heldScopes?.length) {
				const owners = new Map([...runs()].map((owner) => [owner.id, owner]));
				const reachesSelf = (
					runId: string,
					operation: string,
					seen = new Set<string>(),
				): boolean => {
					if (runId === run.id && operation === key) return true;
					const identity = JSON.stringify([runId, operation]);
					if (seen.has(identity)) return false;
					seen.add(identity);
					return (
						owners.get(runId)?.deliveryReservations?.[operation]?.blockers ?? []
					).some((blocker) =>
						reachesSelf(blocker.runId, blocker.operation, seen),
					);
				};
				if (
					blockers.some((blocker) =>
						reachesSelf(blocker.runId, blocker.operation),
					)
				)
					throw new Error(
						"Delivery target expansion cycle; settle and clean up the owning operation before retrying",
					);
			}
			const fingerprint = JSON.stringify(blockers);
			if (reported !== fingerprint) {
				claim.blockers = blockers;
				claim.readiness = "blocked";
				claim.waitReason = blockers
					.map(
						(blocker) =>
							`run ${blocker.runId}, operation ${blocker.operation}, target ${blocker.targets.map(deliveryTargetLabel).join(", ")}`,
					)
					.join("; ");
				updateSummary(run, claim);
				await save();
				assertCurrent();
				log(
					`Waiting for ${claim.reason}: ${blockers.map((blocker) => `run ${blocker.runId}, operation ${blocker.operation.replace(/:(mutation|resources)$/, "")}, target ${blocker.targets.map(deliveryTargetLabel).join(", ")}`).join("; ")}.`,
				);
				reported = fingerprint;
			}
			await delay(signal, 200);
		}
	} catch (error) {
		// A superseded asynchronous admission never releases its replacement.
		if (
			run.deliveryReservations?.[key] === claim &&
			claim.phase !== "released"
		) {
			if (claim.heldScopes?.length) {
				claim.scopes = [...claim.heldScopes];
				claim.phase = "active";
				claim.readiness = "active";
				claim.reason =
					"Expansion interrupted; original targets retained until operation cleanup";
				delete claim.heldScopes;
				delete claim.blockers;
				delete claim.waitingSince;
			} else if (!(claim.phase === "queued" && options.preserveQueued?.()))
				releaseDelivery(run, "Admission cancelled", key);
			await save();
		}
		throw error;
	}
}
export function releaseDelivery(
	run: FactoryRun,
	reason: string,
	key?: string,
): void {
	const selected = key ? run.deliveryReservations?.[key] : undefined;
	const reservations: [string, DeliveryCoordination][] = key
		? selected
			? [[key, selected]]
			: []
		: Object.entries(run.deliveryReservations ?? {});
	// Explicit compatibility: a legacy broad reservation is never an operation lease.
	if (!key && run.deliveryCoordination)
		reservations.push([
			run.deliveryCoordination.operation ?? "delivery",
			run.deliveryCoordination,
		]);
	for (const [operation, reservation] of reservations) {
		if (cancellationUnconfirmed(run, operation, reservation)) {
			reservation.readiness = "unknown";
			reservation.reason = unconfirmedCancellation;
			reservation.waitReason = unconfirmedCancellation;
			continue;
		}
		reservation.phase = "released";
		reservation.readiness = "released";
		reservation.releasedAt = new Date().toISOString();
		reservation.reason = reason;
		delete reservation.blockers;
		delete reservation.waitingSince;
		delete reservation.waitReason;
		delete reservation.heldScopes;
	}
	const last = reservations.at(-1)?.[1];
	if (last) updateSummary(run, last);
}
