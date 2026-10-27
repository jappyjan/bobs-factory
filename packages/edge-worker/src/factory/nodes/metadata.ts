import type { WorkflowStep as Step } from "../Workflow.js";
import { DEFAULT_STEP_MAX_VISITS } from "../WorkflowLimits.js";

export type NodeCategory = "agent" | "display" | "logic" | "flow" | "io";
export type NodeEffect =
	| "pure"
	| "read-only"
	| "human"
	| "agent"
	| "effect"
	| "flow";
export interface NodeBuilderMetadata {
	label: string;
	icon: string;
	paletteGroup: string;
	tone?: string;
	hint?: string;
	/** JSON template; $id and $callable are replaced when inserted. */
	defaults?: object;
	/** Optional client-registered settings component key. */
	settings?: string;
}
export interface NodeMetadata {
	type: string;
	category: NodeCategory;
	effect: NodeEffect;
	/** Serializable per-operation classification used by polling and the builder. */
	operationEffects?: Record<string, NodeEffect>;
	accessEffects?: Record<string, NodeEffect>;
	builder: NodeBuilderMetadata;
}
export type Kind = { icon: string; label: string; tone: string; hint: string };
const kinds: Record<string, Kind> = {
	snapshot: {
		icon: "◈",
		label: "Snapshot repository",
		tone: "blue",
		hint: "Pins tracked repository revisions for read-only agents",
	},
	"file-issues": {
		icon: "🎫",
		label: "File issues",
		tone: "blue",
		hint: "Creates backlog-only, unassigned tickets with durable receipts",
	},
	"launch-runs": {
		icon: "↗",
		label: "Launch runs",
		tone: "orange",
		hint: "Starts independent runs with dependency waves and durable tracking",
	},
	agent: {
		icon: "✦",
		label: "Agent",
		tone: "violet",
		hint: "An AI agent does the work with a prompt",
	},
	check: {
		icon: "✓",
		label: "Check",
		tone: "green",
		hint: "Evaluates named rules; the recipe routes on their results",
	},
	fanout: {
		icon: "⫘",
		label: "In parallel",
		tone: "orange",
		hint: "Runs several branches at the same time",
	},
	foreach: {
		icon: "↻",
		label: "For each",
		tone: "orange",
		hint: "Runs a body for every item, with durable per-item progress",
	},
	workflow: {
		icon: "🧩",
		label: "Recipe",
		tone: "yellow",
		hint: "Runs another recipe, then continues",
	},
};
function builtinNewStep(
	kind:
		| "agent"
		| "check"
		| "fanout"
		| "foreach"
		| "snapshot"
		| "file-issues"
		| "launch-runs"
		| "workflow",

	id: string,
	callable?: string,
): Step {
	const base = {
		id,
		configVersion: "step-config-v1" as const,
		branches: [],
		maxVisits: DEFAULT_STEP_MAX_VISITS,
	};
	switch (kind) {
		case "snapshot":
			return {
				...base,
				name: "Snapshot repositories",
				type: "snapshot",
				snapshot: {},
			};
		case "file-issues":
			return {
				...base,
				name: "File issues",
				type: "file-issues",
				fileIssues: {
					items: { values: [] },
					itemId: "/id",
					maxItems: 100,
					fields: { title: "/title", body: "/body" },
				},
			};
		case "launch-runs":
			return {
				...base,
				name: "Launch runs",
				type: "launch-runs",
				launchRuns: {
					items: { values: [] },
					itemId: "/id",
					maxItems: 100,
					workflow: callable ?? "factory",
					inputMapping: { prompt: "/prompt" },
					wait: true,
				},
			};
		case "check":
			return {
				...base,
				name: "Check results",
				type: "check",
				reads: {},
				check: {
					results: {
						approved: { path: "/inputs/review/approved", equals: true },
					},
				},
			};
		case "agent":
			return {
				...base,
				name: "New agent step",
				type: "agent",
				prompt: "Describe what this agent should do and what it returns.",
			};
		case "fanout":
			return {
				...base,
				name: "Parallel review",
				type: "fanout",
				groups: [
					[
						{
							id: `${id}-a`,
							name: "Reviewer A",
							type: "agent",
							branches: [],
							maxVisits: DEFAULT_STEP_MAX_VISITS,
							prompt: "Review the change and return findings.",
						},
					],
				],
			};
		case "foreach":
			return {
				...base,
				name: "For each item",
				type: "foreach",
				items: { values: [{ id: "first", name: "First item" }] },
				itemId: "/id",
				concurrency: 4,
				maxItems: 100,
				failure: "all-must-succeed",
				body: [
					{
						...base,
						id: `${id}-work`,
						type: "agent",
						name: "Process item",
						prompt: "Process /item at /index. Return the result for this item.",
					},
				],
			};
		case "workflow":
			return {
				...base,
				name: "Run another recipe",
				type: "workflow",
				workflow: callable ?? "",
			};
	}
}

const groups: Record<string, NodeCategory> = {
	agent: "agent",
	check: "logic",
	fanout: "flow",
	foreach: "flow",
	workflow: "flow",
};
export const builtinMetadata: Record<string, NodeMetadata> = Object.fromEntries(
	Object.entries(kinds).map(([type, kind]) => [
		type,
		{
			type,
			category: groups[type] ?? "io",
			effect:
				type === "agent"
					? "agent"
					: type === "check"
						? "pure"
						: groups[type] === "display"
							? "human"
							: groups[type] === "flow"
								? "flow"
								: "effect",
			builder: {
				...kind,
				paletteGroup: groups[type] ?? "io",
				settings: ["snapshot", "file-issues", "launch-runs"].includes(type)
					? "action"
					: ["check", "foreach"].includes(type)
						? type
						: "inline",
				defaults: builtinNewStep(
					type as Parameters<typeof builtinNewStep>[0],
					"$id",
					"$callable",
				),
			},
		},
	]),
);
const builtinOrder = [
	"agent",
	"check",
	"fanout",
	"foreach",
	"snapshot",
	"file-issues",
	"launch-runs",
	"workflow",
];
const catalog = new Map(
	builtinOrder.map((type) => [type, builtinMetadata[type]!]),
);
/** Browser catalog is hydrated from the server; it never imports node executors. */
export function installNodeMetadata(nodes: NodeMetadata[]): void {
	for (const node of nodes) catalog.set(node.type, node);
}
export function nodeMetadata(type: string): NodeMetadata | undefined {
	return catalog.get(type);
}
export function paletteNodes(): NodeMetadata[] {
	return [...catalog.values()];
}
export function nodeKind(type: string): Kind {
	const node = nodeMetadata(type);
	return node
		? {
				...node.builder,
				tone: node.builder.tone ?? "blue",
				hint: node.builder.hint ?? node.builder.label,
			}
		: { icon: "◇", label: type, tone: "blue", hint: type };
}
export function createNodeStep(
	type: string,
	id: string,
	callable?: string,
): Step {
	const node = nodeMetadata(type);
	if (!node) throw new Error(`Unknown node type: ${type}`);
	const replace = (value: unknown): unknown => {
		if (typeof value === "string")
			return value
				.replaceAll("$id", id)
				.replaceAll(
					"$callable",
					callable ?? (type === "launch-runs" ? "factory" : ""),
				);
		if (Array.isArray(value)) return value.map(replace);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, child]) => [key, replace(child)]),
			);
		return value;
	};
	return {
		id,
		name: node.builder.label,
		type,
		configVersion: "step-config-v1",
		branches: [],
		maxVisits: DEFAULT_STEP_MAX_VISITS,
		...(replace(node.builder.defaults ?? {}) as object),
	};
}

/** Unknown operations retain the conservative node default. */
export function nodeEffect(step: {
	type: string;
	op?: unknown;
	access?: unknown;
}): NodeEffect {
	const node = nodeMetadata(step.type);
	return (
		(typeof step.op === "string" &&
		node?.operationEffects &&
		Object.hasOwn(node.operationEffects, step.op)
			? node?.operationEffects?.[step.op]
			: undefined) ??
		(typeof step.access === "string" &&
		node?.accessEffects &&
		Object.hasOwn(node.accessEffects, step.access)
			? node?.accessEffects?.[step.access]
			: undefined) ??
		node?.effect ??
		"effect"
	);
}
