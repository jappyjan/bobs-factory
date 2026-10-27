import { readOutput, readStep } from "./StepConfig.js";

import type { ExecutionContext } from "./WorkflowRuntime.js";

/** Read a declared partner from the current lexical output frame. */
export function boundOutput(
	context: ExecutionContext,
	name: string,
	path?: string,
): unknown {
	const value = readOutput(
		context.step,
		name,
		context.outputs ?? context.run.outputs,
	);
	return path
		? path
				.split(".")
				.reduce<unknown>(
					(value, key) =>
						value && typeof value === "object" && Object.hasOwn(value, key)
							? (value as Record<string, unknown>)[key]
							: undefined,
					value,
				)
		: value;
}

/** Qualified provenance/history key for a declared partner in the same frame. */
export function boundStepKey(
	context: Pick<ExecutionContext, "run" | "step" | "stepKey">,
	name: string,
): string | undefined {
	const target = readStep(context.step, name);
	if (!target) return undefined;
	const prefix = (
		context.stepKey ??
		context.run.step ??
		context.step.id
	).replace(/[^/]+$/, "");
	return producerKey(context.run, prefix, target);
}

/** Resolve a declared port to its configured producer, never by comparing JSON. */
export function producerKey(
	run: ExecutionContext["run"],
	prefix: string,
	target: string,
): string {
	const local = `${prefix}${target}`;
	let scope = prefix;
	while (scope) {
		const callKey = scope.replace(/\/$/, "");
		const call = stepForRun(run, callKey);
		const binding =
			call?.type === "workflow" ? call.bindings?.[target] : undefined;
		if (binding) {
			const parentPrefix = callKey.replace(/[^/]+$/, "");
			return binding.startsWith("@bindings/")
				? producerKey(run, parentPrefix, binding.slice("@bindings/".length))
				: `${parentPrefix}${binding}`;
		}
		if (scope === prefix && stepForRun(run, local)) return local;
		scope = callKey.replace(/[^/]+$/, "");
	}
	return local;
}

/** Only a configured, executed source can supply a port's current value. */
export function producerValue(
	run: ExecutionContext["run"],
	key: string,
): unknown {
	if (!stepForRun(run, key) || !run.history.some((entry) => entry.step === key))
		return undefined;
	return Object.hasOwn(run.outputs, key) ? run.outputs[key] : undefined;
}

/** Follow declared local/outcome routes to the next executed producer. */
function stepsForRun(run: ExecutionContext["run"]) {
	const entries: { key: string; step: ExecutionContext["step"] }[] = [];
	if (!run.workflow) return entries;
	const definitions = new Map(
		(run.workflowDefinitions ?? [run.workflow]).map((workflow) => [
			workflow.id,
			workflow,
		]),
	);
	const visit = (
		steps: ExecutionContext["run"]["workflow"]["steps"],
		prefix: string,
		active: Set<string>,
	) => {
		for (const step of steps) {
			const key = `${prefix}${step.id}`;
			entries.push({ key, step });
			for (const [index, group] of (step.groups ?? []).entries())
				visit(group, `${key}/${index}/`, active);
			if (step.type === "foreach") {
				const ids = new Set([
					...(run.foreach?.[key]?.items ?? []).map((item) => item.id),
					...(run.foreachIterations ?? [])
						.filter((iteration) => iteration.key === key)
						.flatMap((iteration) =>
							iteration.snapshot.items.map((item) => item.id),
						),
				]);
				for (const id of ids) visit(step.body ?? [], `${key}/${id}/`, active);
			}
			if (
				step.type === "workflow" &&
				step.workflow &&
				!active.has(step.workflow)
			) {
				const called = definitions.get(step.workflow);
				if (called)
					visit(called.steps ?? [], `${key}/`, new Set([...active, called.id]));
			}
		}
	};
	visit(run.workflow.steps ?? [], "", new Set([run.workflow.id]));
	return entries;
}

export function stepForRun(
	run: ExecutionContext["run"],
	key: string | undefined,
): ExecutionContext["step"] | undefined {
	return stepsForRun(run).find((entry) => entry.key === key)?.step;
}

/** Resolve an active action through the accepted graph, including called frames. */
