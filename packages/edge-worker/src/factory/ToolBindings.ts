import {
	type CheckId,
	hasCheck,
	legacyToolOutput,
	legacyToolOutputKey,
	readOutput,
	readStep,
	resolveStepConfig,
} from "./StepConfig.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** Read a tool's declared partner, using the current workflow frame's outputs. */
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

/** Runtime refreshes replace the configured receipt; missing bindings fail closed. */
export function writeBoundOutput(
	context: ExecutionContext,
	name: string,
	value: unknown,
): void {
	const from = resolveStepConfig(context.step).reads[name]?.from;
	if (!from || from.startsWith("@"))
		throw new Error(
			`Tool ${context.step.tool} requires a reads.${name} step binding`,
		);
	const [target, ...parts] = from.split("/") as [string, ...string[]];
	const update = (outputs: Record<string, unknown>) => {
		if (!parts.length) {
			Object.defineProperty(outputs, target, {
				value,
				writable: true,
				enumerable: true,
				configurable: true,
			});
			return;
		}
		const root = structuredClone(outputs[target] ?? {});
		let cursor = root as Record<string, unknown>;
		if (!cursor || typeof cursor !== "object")
			throw new Error(
				`reads.${name} cannot refresh a path inside a scalar output`,
			);
		for (const part of parts.slice(0, -1)) {
			if (!Object.hasOwn(cursor, part))
				Object.defineProperty(cursor, part, {
					value: {},
					writable: true,
					enumerable: true,
					configurable: true,
				});
			const next = cursor[part];
			if (!next || typeof next !== "object")
				throw new Error(
					`reads.${name} cannot refresh a path inside a scalar output`,
				);
			cursor = next as Record<string, unknown>;
		}
		Object.defineProperty(cursor, parts.at(-1)!, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
		Object.defineProperty(outputs, target, {
			value: root,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	};
	update(context.run.outputs);
	if (context.outputs && context.outputs !== context.run.outputs)
		update(context.outputs);
}

/** Qualified provenance/history key for a declared partner in the same frame. */
export function boundStepKey(
	context: ExecutionContext,
	name: string,
): string | undefined {
	const target = readStep(context.step, name);
	if (!target) return undefined;
	const prefix = (
		context.stepKey ??
		context.run.step ??
		context.step.id
	).replace(/[^/]+$/, "");
	return `${prefix}${target}`;
}

/** Walk accepted graph identities once for background consumers without an active step. */
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

/** Accepted output slots, without reading artifact getters or cold history bodies. */
export function configuredOutputKeys(
	run: ExecutionContext["run"],
	selector: { check?: CheckId | CheckId[]; tool?: string | string[] },
): string[] {
	const checks = selector.check
		? Array.isArray(selector.check)
			? selector.check
			: [selector.check]
		: [];
	const tools = selector.tool
		? Array.isArray(selector.tool)
			? selector.tool
			: [selector.tool]
		: [];
	const keys = stepsForRun(run)
		.filter(
			({ step }) =>
				checks.some((check) => hasCheck(step, check)) ||
				(step.type === "tool" && tools.includes(step.tool ?? "")),
		)
		.flatMap(({ key }) => [key, key.split("/").at(-1)!])
		.filter((key) => Object.hasOwn(run.outputs, key));
	if (!keys.length && typeof selector.tool === "string") {
		const legacy = legacyToolOutputKey(run, selector.tool);
		if (legacy) keys.push(legacy);
	}
	return [...new Set(keys)];
}

/** Resolve an active action through the accepted graph, including called frames. */
export function toolForStep(
	run: ExecutionContext["run"],
	key: string | undefined,
): string | undefined {
	const step = stepsForRun(run).find((entry) => entry.key === key)?.step;
	return step?.type === "tool" ? step.tool : undefined;
}

/** History whose authored role explicitly owns the requested evidence adapter. */
export function historyForCheck(
	run: ExecutionContext["run"],
	check: CheckId | CheckId[],
) {
	const keys = new Set(
		stepsForRun(run)
			.filter(({ step }) =>
				(Array.isArray(check) ? check : [check]).some((id) =>
					hasCheck(step, id),
				),
			)
			.map(({ key }) => key),
	);
	return (run.history ?? []).filter((entry) => keys.has(entry.step));
}

/** History for code-backed actions, preserving its original order and exact frame keys. */
export function historyForTool(
	run: ExecutionContext["run"],
	tool: string | string[],
) {
	const names = Array.isArray(tool) ? tool : [tool];
	const keys = new Set(
		stepsForRun(run)
			.filter(
				({ step }) => step.type === "tool" && names.includes(step.tool ?? ""),
			)
			.map(({ key }) => key),
	);
	return (run.history ?? []).filter((entry) => keys.has(entry.step));
}

/** Locate an action by its declared tool kind when no active step is available. */
export function outputForTool(
	run: ExecutionContext["run"],
	tool: string,
): unknown {
	const keys = new Set(
		stepsForRun(run)
			.filter(({ step }) => step.type === "tool" && step.tool === tool)
			.map(({ key }) => key),
	);
	return keys.size ? outputForKeys(run, keys) : legacyToolOutput(run, tool);
}

/** Resolve a configured evidence-producing role without an active workflow frame. */
export function outputForCheck(
	run: ExecutionContext["run"],
	check: CheckId | CheckId[],
): unknown {
	const names = Array.isArray(check) ? check : [check];
	const keys = new Set(
		stepsForRun(run)
			.filter(({ step }) => names.some((id) => hasCheck(step, id)))
			.map(({ key }) => key),
	);
	return outputForKeys(run, keys);
}

function outputForKeys(
	run: ExecutionContext["run"],
	keys: Set<string>,
): unknown {
	for (let index = (run.history ?? []).length - 1; index >= 0; index--) {
		const entry = run.history[index]!;
		if (keys.has(entry.step)) return entry.output;
	}
	for (const key of keys) {
		const leaf = key.split("/").at(-1)!;
		if (Object.hasOwn(run.outputs, key)) return run.outputs[key];
		if (Object.hasOwn(run.outputs, leaf)) return run.outputs[leaf];
		const value = key
			.split("/")
			.reduce<unknown>(
				(value, part) =>
					value && typeof value === "object"
						? (value as Record<string, unknown>)[part]
						: undefined,
				run.outputs,
			);
		if (value !== undefined) return value;
	}
	return undefined;
}
