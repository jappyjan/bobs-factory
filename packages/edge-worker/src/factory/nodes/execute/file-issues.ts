import { randomUUID } from "node:crypto";
import { immutableJson } from "bobs-factory-core";
import { actionItems } from "../../ActionSteps.js";
import { digest } from "../../Delivery.js";
import { fileIssueBatch, prepareFileIssues } from "../../FileIssues.js";
import { stepBindings } from "../../StepBindings.js";
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
	const scope = {
		outputs: context.outputs ?? run.outputs,
		inputs: stepBindings(context),
		item: checkpoint.iteration?.value,
		index: checkpoint.iteration?.index,
	};
	signal.throwIfAborted();
	if (!step.fileIssues) throw new Error("File issues configuration is missing");
	run.issueActions ??= {};
	if (
		!run.issueActions[actionId] &&
		actionItems(step.fileIssues, scope).length === 0
	) {
		run.issueActions[actionId] = {
			actionId,
			inputDigest: digest([]),
			accepted: immutableJson([]),
			items: [],
		};
		await engine.save(run);
	}
	if (!run.issueActions[actionId]) {
		const available = await (engine.hooks.issueDestinations?.(run, signal) ??
			Promise.resolve({
				options: [],
				limitations: ["No configured issue destination is available"],
			}));
		const selected = step.fileIssues.destination;
		const matches = available.options.filter(({ destination }) =>
			selected
				? destination.provider === selected.provider &&
					(destination.provider === "linear" && selected.provider === "linear"
						? destination.teamId === selected.teamId &&
							destination.workspaceId === selected.workspaceId
						: digest(destination) === digest(selected))
				: true,
		);
		if (matches.length !== 1)
			throw new Error(
				"File issues needs one configured project destination. Select an accessible Linear team/project or Taskbot project in the recipe; no issues were sent.",
			);
		run.issueActions[actionId] = prepareFileIssues(
			run.id,
			actionId,
			step.fileIssues,
			scope,
			selected ?? matches[0]!.destination,
		);
		await engine.save(run);
	}
	const send = engine.hooks.fileIssue;
	if (!send && run.issueActions[actionId]!.items.length)
		throw new Error("Configured issue creation adapter is unavailable");
	return fileIssueBatch(
		run.issueActions[actionId]!,
		(intent, sendingSignal) => send!(run, intent, sendingSignal),
		() => engine.save(run),
		signal,
	);
}
