import { isUpdatePaused } from "../../../updates/UpdatePausedError.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const { run, step, signal, engine, frame, workflowId, graphChat } = ctx;
	const key = ctx.stepKey!;
	const state = frame.active!;
	const outputs = ctx.outputs!;
	state.children ??= (step.groups ?? []).map((group) => ({
		...engine.newCheckpoint(group),
		outputs: structuredClone(outputs),
		projectResults: true as const,
	}));
	frame.branches ??= {};
	frame.branches[step.id] = state.children;
	for (const child of state.children) {
		child.projectResults = true;
		child.iteration ??= frame.iteration;
		child.callInputs ??= frame.callInputs;
		child.progressInputs ??= frame.progressInputs;
		child.progressItem ??= frame.progressItem;
		child.snapshotInputs ??= frame.snapshotInputs;
	}
	await engine.save(run);
	signal.throwIfAborted();
	const controller = new AbortController();
	const cancel = () => controller.abort(signal.reason);
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	let failure: unknown;
	try {
		const results = await Promise.allSettled(
			(step.groups ?? []).map((group, index) => {
				const child = state.children![index]!;
				child.progressPath = `${ctx.progressOperation}/${index}`;
				return engine
					.graph(
						run,
						group,
						child.outputs!,
						controller.signal,
						`${key}/${index}/`,
						child,
						workflowId,
						graphChat,
						true,
					)
					.catch((error) => {
						if (!failure || !isUpdatePaused(error)) failure = error;
						if (!isUpdatePaused(error)) controller.abort(error);
						throw error;
					});
			}),
		);
		if (failure) throw failure;
		return results.map((result, index) =>
			result.status === "fulfilled"
				? engine.frameResults(
						run,
						step.groups![index]!,
						state.children![index]!,
						`${key}/${index}/`,
					)
				: undefined,
		);
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}
