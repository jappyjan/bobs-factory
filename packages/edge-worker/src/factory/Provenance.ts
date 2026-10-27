import { createHash, randomUUID } from "node:crypto";
import {
	factoryRuntimeIdentity,
	type RuntimeIdentity,
} from "bobs-factory-core";

import { diagnosticAttempt } from "./RunDiagnostics.js";
import { resolveStepConfig } from "./StepConfig.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

export type AttemptReason =
	| "initial"
	| "workflow-transition"
	| "resume"
	| "new-feedback"
	| "code-change"
	| "base-change"
	| "infrastructure-retry"
	| "output-correction"
	| "human-direction";
export type AttemptOutcome =
	| "running"
	| "completed"
	| "failed"
	| "blocked"
	| "interrupted";
export interface StepAttempt {
	id: string;
	parentAttemptId?: string;
	kind: "step" | "agent-turn";
	step: string;
	type: string;
	iteration?: { frame: string; id: string; index: number; itemDigest: string };
	startedAt: string;
	endedAt?: string;
	reason: AttemptReason;
	outcome: AttemptOutcome;
	runtime: RuntimeIdentity;
	workflowHash: string;
	contract: {
		validator: string;
		version: number | null;
		architecture?: string | null;
		review: string | null;
		qa: string | null;
		video: string | null;
		hash: string;
	};
	instructionsHash: string;
	instructionsSource: "recipe" | "effective";
	contextHashes: { human: string; feedback: string };
	revision?: { headSha: string; baseSha?: string };
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export function beginStepAttempt(
	context: ExecutionContext,
	options: {
		reason?: AttemptReason;
		kind?: StepAttempt["kind"];
		parentAttemptId?: string;
	} = {},
): string {
	const { run, step } = context;
	const prior = run.stepAttempts?.find((a) => a.id === context.attemptId);
	if (prior && options.kind !== "agent-turn") {
		// A process crash cannot run native-turn finalizers. Replacing its graph
		// attempt also closes linked running turns, without touching other branches
		// or completed evidence. Set iteration includes newly discovered descendants.
		const replaced = new Set([prior.id]);
		for (const id of replaced)
			for (const attempt of run.stepAttempts ?? [])
				if (attempt.parentAttemptId === id) replaced.add(attempt.id);
		const endedAt = new Date().toISOString();
		for (const attempt of run.stepAttempts ?? [])
			if (replaced.has(attempt.id) && attempt.outcome === "running") {
				attempt.outcome = "interrupted";
				attempt.endedAt = endedAt;
				diagnosticAttempt(run, attempt);
			}
	}
	const contract = {
		validator: "nodes-v1",
		version: 1,
		review: null,
		qa: null,
		video: null,
	};
	const contextHashes = {
		human: digest(
			canonical({
				input: run.input,

				messages: context.chatMessages ?? [],
				decisions:
					run.viewRecords
						?.filter((record) => record.answer)
						.map((record) => record.answer) ?? [],
			}),
		),
		feedback: digest(
			canonical(
				(context.input as { feedback?: unknown } | null)?.feedback ?? null,
			),
		),
	};
	const previous = [...(run.stepAttempts ?? [])]
		.reverse()
		.find(
			(a) =>
				a.step === (context.stepKey ?? run.step ?? step.id) &&
				a.kind === (options.kind ?? "step"),
		);
	const reason =
		previous?.contextHashes &&
		previous.contextHashes.human !== contextHashes.human
			? "human-direction"
			: previous?.contextHashes &&
					previous.contextHashes.feedback !== contextHashes.feedback
				? "new-feedback"
				: undefined;
	const attempt: StepAttempt = {
		id: randomUUID(),
		...(options.parentAttemptId
			? { parentAttemptId: options.parentAttemptId }
			: {}),
		kind: options.kind ?? "step",
		step: context.stepKey ?? run.step ?? step.id,
		type: step.type,
		...(context.iteration
			? {
					iteration: {
						frame: context.iteration.frame,
						id: context.iteration.id,
						index: context.iteration.index,
						itemDigest: digest(canonical(context.iteration.value)),
					},
				}
			: {}),
		startedAt: new Date().toISOString(),
		reason:
			options.reason ??
			(context.resumeAgent?.infrastructureFailure
				? "infrastructure-retry"
				: undefined) ??
			reason ??
			(context.resumeAgent
				? "resume"
				: run.history.length
					? "workflow-transition"
					: "initial"),
		outcome: "running",
		runtime: { ...factoryRuntimeIdentity },
		workflowHash: digest(
			canonical({
				workflow: run.workflow,
				definitions: run.workflowDefinitions ?? [],
			}),
		),
		contract: {
			...contract,
			hash: digest(
				canonical({
					...contract,
					json: step.json,
					config: resolveStepConfig(step),
				}),
			),
		},
		instructionsHash: digest(step.prompt ?? ""),
		instructionsSource: "recipe",
		contextHashes,
	};
	run.stepAttempts ??= [];
	run.stepAttempts.push(attempt);
	diagnosticAttempt(run, attempt, true);
	context.attemptId = attempt.id;
	context.save?.();
	return attempt.id;
}

export function finishStepAttempt(
	context: ExecutionContext,
	outcome: Exclude<AttemptOutcome, "running">,
): void {
	const attempt = context.run.stepAttempts?.find(
		(a) => a.id === context.attemptId,
	);
	if (!attempt || attempt.outcome !== "running") return;
	attempt.outcome = outcome;
	attempt.endedAt = new Date().toISOString();
	diagnosticAttempt(context.run, attempt);
	context.save?.();
}

export function recordAttemptInstructions(
	context: ExecutionContext,
	instructions: string,
): void {
	const attempt = context.run.stepAttempts?.find(
		(a) => a.id === context.attemptId,
	);
	if (!attempt) return;
	attempt.instructionsHash = digest(instructions);
	attempt.instructionsSource = "effective";
	const progress = context.progress;
	if (progress?.currentRevision)
		attempt.revision = {
			headSha: progress.currentRevision.headSha,
		};
	if (attempt.reason === "resume" || attempt.reason === "workflow-transition") {
		if (context.resumeAgent?.rejected) attempt.reason = "output-correction";
		else if (progress && !progress.uncertain && !progress.unchangedCode)
			attempt.reason = "code-change";
	}
	diagnosticAttempt(context.run, attempt);
	context.save?.();
}

/** Deliberately excludes task text, outputs, configuration, accounts and credentials. */
export function runProvenance(run: FactoryRun) {
	return {
		schemaVersion: 1,
		runId: run.id,
		currentRuntime: { ...factoryRuntimeIdentity },
		knownSource: null,
		legacyProvenance: run.stepAttempts === undefined,
		attempts: (run.stepAttempts ?? []).map((attempt) => ({
			id: attempt.id,
			parentAttemptId: attempt.parentAttemptId,
			kind: attempt.kind,
			step: attempt.step,
			type: attempt.type,
			startedAt: attempt.startedAt,
			endedAt: attempt.endedAt,
			reason: attempt.reason,
			outcome: attempt.outcome,
			runtime: {
				version: attempt.runtime.version,
				commit: attempt.runtime.commit,
				dirty: attempt.runtime.dirty,
				target: attempt.runtime.target,
				resourceDigest: attempt.runtime.resourceDigest,
				packaged: attempt.runtime.packaged,
			},
			workflowHash: attempt.workflowHash,
			contract: {
				validator: attempt.contract.validator,
				version: attempt.contract.version,
				architecture: attempt.contract.architecture ?? null,
				review: attempt.contract.review,
				qa: attempt.contract.qa,
				video: attempt.contract.video,
				hash: attempt.contract.hash,
			},
			instructionsHash: attempt.instructionsHash,
			instructionsSource: attempt.instructionsSource,
			contextHashes: attempt.contextHashes
				? {
						human: attempt.contextHashes.human,
						feedback: attempt.contextHashes.feedback,
					}
				: undefined,
			revision: attempt.revision
				? {
						headSha: attempt.revision.headSha,
						baseSha: attempt.revision.baseSha,
					}
				: undefined,
		})),
	};
}
