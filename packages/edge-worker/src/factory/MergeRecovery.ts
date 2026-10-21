import { immutableJson } from "bobs-factory-core";
import { readOutput } from "./StepConfig.js";
import { outputForTool } from "./ToolBindings.js";
import { readPath, type WorkflowStep } from "./Workflow.js";
import type { FactoryRun, GraphCheckpoint } from "./WorkflowRuntime.js";

/** Locate a merge candidate; the confirmed receipt must validate its terminal route. */
export function pendingMergeConfirmation(
	run: FactoryRun,
	output?: unknown,
):
	| {
			checkpoint: GraphCheckpoint;
			step: WorkflowStep;
			key: string;
			fromHandoff?: true;
	  }
	| undefined {
	const next = (steps: WorkflowStep[], step: WorkflowStep, output: unknown) =>
		step.branches.find(
			(branch) =>
				JSON.stringify(readPath(output, branch.when.path)) ===
				JSON.stringify(branch.when.equals),
		)?.next ??
		step.next ??
		steps[steps.indexOf(step) + 1]?.id ??
		"end";
	const finishes = (
		steps: WorkflowStep[],
		step: WorkflowStep,
		output: unknown,
	) =>
		next(steps, step, output) === "end" ||
		(step.tool === "merge" &&
			run.delivery?.contract.mode === "mixed" &&
			readPath(output, "merged") === true &&
			step.branches.some(
				(b) =>
					b.when.path === "externalPending" &&
					b.when.equals === true &&
					steps.find((candidate) => candidate.id === b.next)?.tool ===
						"external-final",
			));
	const find = (
		checkpoint: GraphCheckpoint | undefined,
		steps: WorkflowStep[],
		prefix: string,
	): ReturnType<typeof pendingMergeConfirmation> => {
		if (
			!checkpoint?.active ||
			!["executing", "result"].includes(checkpoint.active.phase)
		)
			return;
		const step = steps.find((item) => item.id === checkpoint.current);
		if (!step) return;
		const key = `${prefix}${step.id}`;
		if (
			step.type === "tool" &&
			step.tool === "merge" &&
			key === run.step &&
			(!output || finishes(steps, step, output))
		)
			return { checkpoint, step, key };
		// A replayed handoff may find delivery already complete. Only traverse the
		// exact human gate whose explicit approval was previously recorded, and
		// only when that gate leads directly to a terminal merge. Never skip custom
		// intervening work or manufacture a new readiness/approval receipt.
		if (
			step.tool === "handoff" &&
			key === run.step &&
			(run.repositories?.length ?? 0) <= 1
		) {
			const approval = run.humanDecisions?.at(-1);
			const url = readPath(readOutput(step, "draftPr", run.outputs), "url");
			const human = steps.find(
				(s) =>
					s.id ===
					next(steps, step, { ready: true, headSha: approval?.headSha, url }),
			);
			const merge =
				human && steps.find((s) => s.id === next(steps, human, approval));
			if (
				approval?.decision === "approve" &&
				human?.tool === "human-review" &&
				merge?.tool === "merge" &&
				run.reviewGate?.status === "approve" &&
				run.reviewGate.id === approval.reviewId &&
				run.reviewGate.headSha === approval.headSha &&
				run.reviewGate.url === url &&
				run.history.some(
					(h) =>
						h.step === `${prefix}${human.id}` &&
						readPath(h.output, "reviewId") === approval.reviewId &&
						readPath(h.output, "headSha") === approval.headSha &&
						readPath(h.output, "decision") === "approve",
				) &&
				(!output || finishes(steps, merge, output))
			)
				return {
					checkpoint,
					step: merge,
					key: `${prefix}${merge.id}`,
					fromHandoff: true,
				};
		}
		if (
			step.type === "workflow" &&
			checkpoint.active.phase === "executing" &&
			finishes(steps, step, { workflow: step.workflow, completed: true })
		) {
			const child = run.workflowDefinitions?.find(
				(item) => item.id === step.workflow,
			);
			if (child)
				return find(checkpoint.active.children?.[0], child.steps, `${key}/`);
		}
		return undefined;
	};
	return find(run.checkpoint, run.workflow.steps, "");
}

/** Save only the provider-confirmed merge receipt; retain earlier history verbatim. */
export function recordMergeConfirmation(
	run: FactoryRun,
	pending: NonNullable<ReturnType<typeof pendingMergeConfirmation>>,
	output: unknown,
): void {
	const alreadyRecorded =
		!pending.fromHandoff && pending.checkpoint.active?.phase === "result";
	run.outputs[pending.step.id] = output;
	if (!alreadyRecorded)
		run.history.push(
			immutableJson({
				step: pending.key,
				output,
				at: new Date().toISOString(),
			}),
		);
	pending.checkpoint.current = pending.step.id;
	pending.checkpoint.active = { phase: "result" };
	run.step = pending.key;
}

/** A merged provider revision is authoritative even after local cleanup. */
export function confirmedMerge(
	run: FactoryRun,
	pr: { state: string; headSha: string },
): { merged: true; url: string; headSha: string } | undefined {
	if (pr.state !== "MERGED") return;
	const approval = run.humanDecisions?.at(-1);
	const url = readPath(outputForTool(run, "draft-pr"), "url");
	if (
		approval?.decision !== "approve" ||
		typeof pr.headSha !== "string" ||
		!pr.headSha ||
		approval.headSha !== pr.headSha ||
		typeof url !== "string" ||
		!url
	)
		throw new Error(
			"Merged PR does not match the explicitly approved revision",
		);
	return { merged: true, url, headSha: pr.headSha };
}
