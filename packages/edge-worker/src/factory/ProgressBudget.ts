import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { passiveTools } from "./CapacityPolicy.js";
import { digest } from "./Delivery.js";
import type { ProgressPolicy } from "./ProgressPolicy.js";
import { runRepositories } from "./RepositoryScope.js";
import type {
	AgentCheckpoint,
	ExecutionContext,
	FactoryRun,
} from "./WorkflowRuntime.js";

const exec = promisify(execFile);
const MAX_OBSERVATIONS = 4096;
export interface ProgressObservation {
	operation: string;
	identity: string;
	attempts: number;
	additional: number;
	step: string;
	lastFailure?: { kind: string; reason: string };
}
export interface ProgressBudget {
	version: 1;
	policy: ProgressPolicy;
	acceptedAt: string;
	window: { kind: "new-run" | "legacy-from-now"; historyLength: number };
	observations: Record<string, ProgressObservation>;
	observationCount: number;
	observationAllowance: number;
	/** Incremental trusted evidence/input identities, never the run history. */
	facts: Record<string, string>;
	recent: {
		step: string;
		operation: string;
		identity: string;
		reason: string;
	}[];
	blocked?: ProgressObservation & {
		key: string;
		reason: string;
		limit: number;
	};
	grants: { at: string; key: string; attempts: number; limit: number }[];
	grantCount: number;
	sessions: Record<
		string,
		Pick<AgentCheckpoint, "runner" | "sessionId" | "idleRetries">
	>;
}
export class NonConvergenceError extends Error {}

export function initializeProgressBudget(run: FactoryRun, legacy = false) {
	if (run.progressBudget || !run.workflow.convergence) return;
	run.progressBudget = {
		version: 1,
		policy: { ...run.workflow.convergence },
		acceptedAt: new Date().toISOString(),
		window: {
			kind: legacy ? "legacy-from-now" : "new-run",
			historyLength: run.history.length,
		},
		observations: {},
		observationCount: 0,
		observationAllowance: MAX_OBSERVATIONS,
		facts: {},
		recent: [],
		grants: [],
		grantCount: 0,
		sessions: {},
	};
}

export function observesProgress(context: ExecutionContext) {
	return (
		!!context.run.progressBudget &&
		!["workflow", "foreach", "fanout", "decide", "approve", "show"].includes(
			context.step.type,
		) &&
		!passiveTools.includes(context.step.tool ?? "")
	);
}

/** Accepted human input is explicit authority; repeated submission is not new work. */
export function recordProgressInput(run: FactoryRun, value: string) {
	const state = run.progressBudget;
	if (state) state.facts.human = digest(value.trim());
}

/** Only consequences/provenance count; prose, dates, rounds and attempt IDs do not. */
export function progressEvidence(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(progressEvidence);
	if (!value || typeof value !== "object")
		return typeof value === "boolean" ? value : undefined;
	const fields = new Set([
		"status",
		"outcome",
		"rating",
		"exitCode",
		"treeSha",
		"workspaceDigest",
		"environmentDigest",
		"dependencyDigest",
		"sourceDigest",
		"sha256",
		"bodySha256",
		"requirementId",
		"criterionId",
		"disposition",
		"category",
	]);
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, item]) => {
			if (
				fields.has(key) &&
				(typeof item === "string" || typeof item === "number")
			)
				return [[key, item]];
			if (typeof item === "boolean") return [[key, item]];
			if (item && typeof item === "object") {
				const nested = progressEvidence(item);
				return JSON.stringify(nested) === "{}" ||
					JSON.stringify(nested) === "[]"
					? []
					: [[key, nested]];
			}
			return [];
		}),
	);
}

/** Callers supply only validated runtime evidence, never arbitrary role prose. */
export function recordProgressEvidence(
	context: ExecutionContext,
	value: unknown,
) {
	const state = context.run.progressBudget;
	if (!state || !context.progressOperation) return;
	const key = digest(context.progressOperation);
	if (Object.hasOwn(state.facts, key) || Object.keys(state.facts).length < 256)
		state.facts[key] = digest(value);
}

async function progressIdentity(context: ExecutionContext) {
	const run = context.run;
	const repositories = await Promise.all(
		runRepositories(run).map(async (repository) => {
			try {
				// Committed source, not commit UUID, target ancestry, or transient runner files.
				const tree = (
					await exec("git", ["rev-parse", "HEAD^{tree}"], {
						cwd: repository.workspace,
						timeout: 10000,
						maxBuffer: 4096,
					})
				).stdout.trim();
				return [repository.id, tree];
			} catch {
				// Missing source cannot fabricate progress or reset a retained budget.
				return [repository.id, "unavailable"];
			}
		}),
	);
	return digest({
		repositories,
		input: run.input,
		launchInputs: run.launchInputs,
		facts: run.progressBudget!.facts,
	});
}

/** Persist before side effects. New frames, route names, times and UUIDs are absent. */
export async function beginProgressAttempt(
	context: ExecutionContext,
	reason = "execution",
) {
	if (!observesProgress(context)) return;
	const state = context.run.progressBudget!;
	const operation = context.progressOperation!;
	const identity = await progressIdentity(context);
	context.signal.throwIfAborted();
	const key = digest({ operation, identity });
	let observation = state.observations[key];
	if (!observation) {
		if (state.observationCount >= state.observationAllowance) {
			// Do not evict old budgets: cycling through new identities cannot earn unlimited credit.
			observation = {
				operation,
				identity,
				attempts: 0,
				additional: 0,
				step: context.stepKey!,
			};
			state.blocked = {
				...observation,
				key,
				reason: "observation-window-full",
				limit: 0,
			};
			await context.save?.();
			throw new NonConvergenceError(
				"Convergence observation window is full; earlier identities and budgets are retained. Inspect its saved progress, then Continue grants bounded additional observation slots without resetting any counter or waiving quality.",
			);
		}
		state.observationCount++;
		observation = state.observations[key] = {
			operation,
			identity,
			attempts: 0,
			additional: 0,
			step: context.stepKey!,
		};
	}
	const limit = state.policy.maxUnchangedAttempts + observation.additional;
	if (observation.attempts >= limit) {
		state.blocked = {
			...observation,
			key,
			reason: observation.lastFailure?.kind ?? "unchanged-work",
			limit,
		};
		await context.save?.();
		throw new NonConvergenceError(
			`No progress at ${context.stepKey}: ${observation.attempts} attempted executions of ${operation} at relevant identity ${identity}. Repeated blocker: ${observation.lastFailure?.reason ?? "the same accepted source, inputs and valid evidence returned through correction routes"}. Inspect retained work/checkpoints and restore the blocker, then Continue grants ${state.policy.continueAttempts} attempts for this exact state. Review, checks, human approval and provider proof remain required.`,
		);
	}
	observation.attempts++;
	observation.step = context.stepKey!;
	state.recent.push({ step: context.stepKey!, operation, identity, reason });
	state.recent = state.recent.slice(-16);
	context.progressObservation = key;
	await context.save?.();
	context.signal.throwIfAborted();
}

export function recordProgressFailure(
	context: ExecutionContext,
	kind: string,
	reason: string,
) {
	const state = context.run.progressBudget;
	const observation = state?.observations[context.progressObservation ?? ""];
	if (observation && !context.run.progressBudget?.blocked)
		observation.lastFailure = { kind, reason: reason.slice(0, 1600) };
}

export function continueProgress(run: FactoryRun) {
	const state = run.progressBudget;
	const blocked = state?.blocked;
	if (!state || !blocked || blocked.reason === "observation-window-full")
		return;
	const observation = state.observations[blocked.key];
	if (!observation)
		throw new Error(
			"Retained convergence observation is missing; restore its state before continuing",
		);
	observation.additional += state.policy.continueAttempts;
	state.grants.push({
		at: new Date().toISOString(),
		key: blocked.key,
		attempts: state.policy.continueAttempts,
		limit: state.policy.maxUnchangedAttempts + observation.additional,
	});
	state.grants = state.grants.slice(-32);
	state.grantCount++;
	delete state.blocked;
}
