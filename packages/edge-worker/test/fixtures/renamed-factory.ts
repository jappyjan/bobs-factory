import type { Workflow, WorkflowStep } from "../../src/factory/Workflow.js";

/** Rebind every graph identity, including nested specialists, while preserving semantic read names. */
export function renamedFactory(baseWorkflows: Workflow[]): {
	definitions: Workflow[];
	original: (key: string) => string;
} {
	const definitions = structuredClone(baseWorkflows).filter((workflow) =>
		["factory", "takeover", "factory-pipeline"].includes(workflow.id),
	);
	const ids = new Map<string, string>();
	const collect = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			if (!ids.has(step.id)) ids.set(step.id, `node_${ids.size}`);
			for (const group of step.groups ?? []) collect(group);
		}
	};
	for (const workflow of definitions) collect(workflow.steps);
	const reference = (value: string) =>
		value.startsWith("@")
			? value
			: value
					.split("/")
					.map((part) => ids.get(part) ?? part)
					.join("/");
	const argumentsValue = (value: unknown): unknown =>
		typeof value === "string"
			? (ids.get(value) ??
				value.replace(
					/outputs\.([\w-]+)/g,
					(_match, id: string) => `outputs.${ids.get(id) ?? id}`,
				))
			: Array.isArray(value)
				? value.map(argumentsValue)
				: value && typeof value === "object"
					? Object.fromEntries(
							Object.entries(value).map(([key, item]) => [
								key,
								argumentsValue(item),
							]),
						)
					: value;
	const rewrite = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			step.id = ids.get(step.id)!;
			if (step.next && step.next !== "end") step.next = ids.get(step.next)!;
			for (const branch of step.branches)
				if (branch.next !== "end") branch.next = ids.get(branch.next)!;
			step.inputs = step.inputs?.map(reference);
			if (step.workflow) step.workflow = `renamed-${step.workflow}`;
			for (const [name, binding] of Object.entries(step.reads ?? {}))
				step.reads![name] =
					typeof binding === "string"
						? reference(binding)
						: { ...binding, from: reference(binding.from) };
			if (step.arguments)
				step.arguments = argumentsValue(step.arguments) as Record<
					string,
					unknown
				>;
			if (step.args) step.args = argumentsValue(step.args) as string[];
			for (const group of step.groups ?? []) rewrite(group);
		}
	};
	for (const workflow of definitions) {
		workflow.id = `renamed-${workflow.id}`;
		workflow.name = `Renamed ${workflow.name}`;
		workflow.labels = [];
		rewrite(workflow.steps);
	}
	const originals = new Map([...ids].map(([old, current]) => [current, old]));
	return {
		definitions: [...baseWorkflows, ...definitions],
		original: (key) =>
			key
				.split("/")
				.map((part) => originals.get(part) ?? part)
				.join("/"),
	};
}
