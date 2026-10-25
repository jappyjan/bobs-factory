import { immutableJson } from "bobs-factory-core";
import { digest } from "../../Delivery.js";
import { foreachPointer, foreachScope } from "../../Foreach.js";
import { acceptedProgressValue } from "../../ProgressBudget.js";
import { snapshotInputMappings } from "../../RepositorySnapshot.js";
import { stepBindings } from "../../StepBindings.js";
import { resolveStepConfig } from "../../StepConfig.js";
import { producerKey, producerValue } from "../../ToolBindings.js";
import { requireTrigger } from "../../Workflow.js";
import { snapshotWorkflowInput } from "../../WorkflowInput.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const context = ctx;
	const {
		run,
		step,
		signal,
		engine,
		frame: checkpoint,
		workflowId,
		chat = false,
		parallel,
		reviewBaseline,
	} = ctx;
	const key = ctx.stepKey!;
	const state = checkpoint.active!;
	const outputs = ctx.outputs!;
	const config = resolveStepConfig(step);

	const definition = run.workflowDefinitions?.find(
		(item) => item.id === step.workflow,
	);
	if (!definition) throw new Error(`Workflow unavailable: ${step.workflow}`);
	requireTrigger(definition, "workflow");
	if (!state.call) {
		state.call = {
			type: "workflow",
			callerWorkflowId: workflowId,
			step: step.id,
			key,
			workflowId: definition.id,
		};
		// Call receipts outlive the capped activity buffer, including interrupted calls.
		run.workflowCalls ??= run.events
			.filter((event) => event.call)
			.map((event) => ({ call: event.call!, at: event.at }));
		run.workflowCalls.push({
			call: state.call,
			at: new Date().toISOString(),
		});
		engine.log(
			run,
			key,
			`Calling ${definition.name} from ${workflowId}/${step.id}`,
			"workflow",
			state.call,
		);
	}
	const newVisit = !state.children;
	if (!state.children) {
		const retained = definition.outcomes?.length
			? checkpoint.calls?.[step.id]
			: undefined;
		const child = retained ?? engine.newCheckpoint(definition.steps);
		if (retained) {
			child.current = checkpoint.entry ?? definition.steps[0]!.id;
			child.active = undefined;
			delete child.outcome;
		}
		if (checkpoint.entry) child.current = checkpoint.entry;
		delete checkpoint.entry;
		state.children = [child];
	}
	// Recovery can already supply an active child. Retain that exact frame,
	// including visits and ownership, before its first resumed dispatch.
	if (config.explicit || definition.outcomes?.length) {
		checkpoint.calls ??= {};
		checkpoint.calls[step.id] = state.children[0]!;
	}
	// Calls of the same recipe in one enclosing body share work identity across routes.
	// Keep the enclosing structural scope, never its generated visit/frame identity.
	state.children[0]!.progressPath =
		`${checkpoint.progressPath ?? workflowId}/${definition.id}`;
	state.children[0]!.progressItem = checkpoint.progressItem;
	state.children[0]!.reviewKey ??= checkpoint.reviewKey;
	state.children[0]!.iteration ??= checkpoint.iteration;
	if (
		checkpoint.projectResults ||
		step.bindings ||
		definition.outcomes?.length ||
		step.inputMapping ||
		checkpoint.iteration
	)
		state.children[0]!.projectResults = true;
	const isolated =
		config.explicit ||
		!!step.inputMapping ||
		!!step.bindings ||
		!!checkpoint.iteration;
	if (isolated && (newVisit || !state.children[0]!.outputs)) {
		const mappings = Object.fromEntries(
			Object.entries(step.inputMapping ?? {}).map(([name, path]) => [
				name,
				structuredClone(
					foreachPointer(
						foreachScope({
							outputs,
							inputs: stepBindings(context),
							item: checkpoint.iteration?.value,
							index: checkpoint.iteration?.index,
						}),
						path,
					),
				),
			]),
		);
		state.children[0]!.outputs = {
			...(step.bindings ? {} : snapshotWorkflowInput(outputs)),
			...snapshotWorkflowInput(mappings),
			...Object.fromEntries(
				Object.entries(state.children[0]!.resultReceipts ?? {}).map(
					([id, receipt]) => [id, snapshotWorkflowInput(receipt.output)],
				),
			),
		};
		state.children[0]!.callInputs = step.inputMapping
			? immutableJson(mappings)
			: checkpoint.callInputs;
	}
	if (newVisit || !state.children[0]!.progressInputs)
		state.children[0]!.progressInputs = step.inputMapping
			? Object.fromEntries(
					Object.entries(step.inputMapping).flatMap(([name, path]) => {
						const value = acceptedProgressValue(
							context,
							path,
							state.children![0]!.callInputs?.[name],
						);
						return value === undefined ? [] : [[name, digest(value)]];
					}),
				)
			: checkpoint.progressInputs;
	if (step.bindings) {
		const child = state.children[0]!;
		child.outputs ??= {};
		for (const name of Object.keys(step.bindings)) {
			const source = producerKey(run, `${key}/`, name);
			const value = producerValue(run, source);
			if (value === undefined) delete child.outputs[name];
			else child.outputs[name] = snapshotWorkflowInput(value);
		}
	}
	if (newVisit || !state.children[0]!.snapshotInputs)
		state.children[0]!.snapshotInputs = step.inputMapping
			? immutableJson(
					snapshotInputMappings(
						context,
						step.inputMapping,
						state.children[0]!.callInputs ?? {},
						key,
					),
				)
			: checkpoint.snapshotInputs;
	await engine.save(run);
	signal.throwIfAborted();
	await engine.graph(
		run,
		definition.steps,
		isolated ? state.children[0]!.outputs! : outputs,
		signal,
		`${key}/`,
		state.children[0]!,
		definition.id,
		definition.chat ?? chat,
		parallel,
		config.explicit ? reviewBaseline : undefined,
	);
	const output = {
		workflow: definition.id,
		completed: true,
		...(definition.outcomes?.length
			? { outcome: state.children[0]!.outcome ?? "completed" }
			: {}),
		...(step.inputMapping ||
		step.bindings ||
		definition.outcomes?.length ||
		checkpoint.iteration
			? {
					outputs: engine.frameResults(
						run,
						definition.steps,
						state.children[0]!,
						`${key}/`,
					),
				}
			: {}),
	};
	checkpoint.reviewKey = state.children[0]!.reviewKey;

	return output;
}
