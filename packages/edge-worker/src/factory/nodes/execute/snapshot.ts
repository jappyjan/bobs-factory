import { randomUUID } from "node:crypto";
import { digest } from "../../Delivery.js";
import {
	captureRepositorySnapshot,
	snapshotOutput,
} from "../../RepositorySnapshot.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const context = ctx;
	const { engine, frame: checkpoint } = ctx;

	const { run, step, signal } = context;
	const active = checkpoint.active!;
	if (!active.actionId) {
		active.actionId = randomUUID();
		await engine.save(run);
	}
	const actionId = active.actionId;
	signal.throwIfAborted();
	run.repositorySnapshots ??= {};
	if (!run.repositorySnapshots[actionId]) {
		run.repositorySnapshots[actionId] = await captureRepositorySnapshot(
			run,
			actionId,
			step.snapshot ?? {},
			engine.runs.values(),
			signal,
			{
				key: context.stepKey!,
				iteration: context.iteration && {
					frame: context.iteration.frame,
					id: context.iteration.id,
					index: context.iteration.index,
					itemDigest: digest(context.iteration.value),
				},
			},
		);
		await engine.save(run);
	}
	return snapshotOutput(run.repositorySnapshots[actionId]!);
}
