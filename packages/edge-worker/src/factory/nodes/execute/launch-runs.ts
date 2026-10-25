import { randomUUID } from "node:crypto";
import {
	launchBatchSettled,
	launchOutput,
	prepareLaunchRuns,
} from "../../LaunchRuns.js";
import { stepBindings } from "../../StepBindings.js";
import type { GraphCheckpoint } from "../../WorkflowRuntime.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const context = ctx;
	const { engine, frame: checkpoint, workflowId } = ctx;

	const { run, step, signal } = context;
	const active = checkpoint.active!;
	if (!active.actionId) {
		active.actionId = randomUUID();
		await engine.save(run);
	}
	const actionId = active.actionId;
	const scope = {
		outputs: context.outputs ?? run.outputs,
		inputs: stepBindings(context),
		item: checkpoint.iteration?.value,
		index: checkpoint.iteration?.index,
	};
	signal.throwIfAborted();
	if (!step.launchRuns) throw new Error("Launch runs configuration is missing");
	run.launchActions ??= {};
	if (!run.launchActions[actionId]) {
		const ancestors = [...(run.recipeParent?.ancestors ?? []), run.workflow.id];
		const visit = (frame: GraphCheckpoint | undefined) => {
			const call = frame?.active?.call;
			if (call && context.stepKey!.startsWith(`${call.key}/`))
				ancestors.push(call.callerWorkflowId, call.workflowId);
			for (const child of frame?.active?.children ?? []) visit(child);
		};
		visit(run.checkpoint);
		run.launchActions[actionId] = prepareLaunchRuns(
			run,
			step.launchRuns,
			scope,
			{
				key: context.stepKey!,
				actionId,
				workflowId,
				ancestors: [...new Set(ancestors)],
			},
		);
		await engine.save(run);
	}
	const batch = run.launchActions[actionId]!;
	if (!batch.accepted.wait) {
		await engine.reconcileLaunchBatch(run, batch, signal);
		return launchOutput(batch);
	}
	while (true) {
		let wake!: () => void;
		const changed = new Promise<void>((resolve) => {
			wake = resolve;
		});
		const unsubscribe = engine.subscribe((change) => {
			if (batch.accepted.items.some((item) => item.runId === change.id)) wake();
		});
		const abort = () => wake();
		signal.addEventListener("abort", abort, { once: true });
		try {
			await engine.reconcileLaunchBatch(run, batch, signal);
			signal.throwIfAborted();
			if (launchBatchSettled(batch)) return launchOutput(batch);
			run.status = "waiting";
			await engine.save(run);
			await changed;
			signal.throwIfAborted();
			run.status = "running";
		} finally {
			unsubscribe();
			signal.removeEventListener("abort", abort);
		}
	}
}
