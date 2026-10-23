import type { Workflow, WorkflowStep } from "../../src/factory/Workflow.js";

/** Rebind every graph identity, including nested specialists, while preserving semantic read names. */
export function renamedFactory(baseWorkflows: Workflow[]): {
	definitions: Workflow[];
	original: (key: string) => string;
} {
	// Rename the stock roots together with every recipe they call.
	const closure = new Set(["factory", "takeover", "factory-pipeline"]);
	const calls = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			if (step.workflow && !closure.has(step.workflow)) {
				closure.add(step.workflow);
				calls(baseWorkflows.find((w) => w.id === step.workflow)!.steps);
			}
			for (const group of step.groups ?? []) calls(group);
			if (step.body) calls(step.body);
		}
	};
	for (const workflow of baseWorkflows)
		if (closure.has(workflow.id)) calls(workflow.steps);
	const definitions = structuredClone(baseWorkflows).filter((workflow) =>
		closure.has(workflow.id),
	);
	// Steps sharing a name with a declared input port keep it: reads of that name
	// resolve to the port when called and to the step when started on its own.
	const portNames = new Set(definitions.flatMap((w) => w.inputs ?? []));
	const ids = new Map<string, string>();
	const collect = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			if (!ids.has(step.id))
				ids.set(step.id, portNames.has(step.id) ? step.id : `node_${ids.size}`);
			for (const group of step.groups ?? []) collect(group);
			if (step.body) collect(step.body);
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
	const read = reference;
	const rewrite = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			step.id = ids.get(step.id)!;
			// Recipe outcomes are port names, not step identities.
			if (step.next) step.next = ids.get(step.next) ?? step.next;
			for (const branch of step.branches) {
				branch.next = ids.get(branch.next) ?? branch.next;
				if (branch.entry) branch.entry = ids.get(branch.entry)!;
			}
			if (step.bindings)
				for (const [name, source] of Object.entries(step.bindings))
					step.bindings[name] = reference(source);
			// Inputs naming a read binding keep the binding's semantic name.
			step.inputs = step.inputs?.map((value) =>
				step.reads && Object.hasOwn(step.reads, value) ? value : read(value),
			);
			if (step.workflow) step.workflow = `renamed-${step.workflow}`;
			for (const [name, binding] of Object.entries(step.reads ?? {}))
				step.reads![name] =
					typeof binding === "string"
						? read(binding)
						: { ...binding, from: read(binding.from) };
			if (step.arguments)
				step.arguments = argumentsValue(step.arguments) as Record<
					string,
					unknown
				>;
			if (step.args) step.args = argumentsValue(step.args) as string[];
			for (const group of step.groups ?? []) rewrite(group);
			if (step.body) rewrite(step.body);
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
