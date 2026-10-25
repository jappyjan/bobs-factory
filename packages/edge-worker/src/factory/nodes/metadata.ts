import type { WorkflowStep as Step } from "../Workflow.js";
import { DEFAULT_STEP_MAX_VISITS } from "../WorkflowLimits.js";

export type NodeCategory = "agent" | "display" | "logic" | "flow" | "io";
export type NodeEffect = "pure" | "agent" | "human" | "effect" | "flow";
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
	builder: NodeBuilderMetadata;
}
export type Kind = { icon: string; label: string; tone: string; hint: string };
const kinds: Record<string, Kind> = {
	decide: {
		icon: "☷",
		label: "Decide per item",
		tone: "red",
		hint: "Choose a configured action for each item, then route the results",
	},
	approve: {
		icon: "✓",
		label: "Approve",
		tone: "red",
		hint: "Explicitly approve the displayed content or request changes",
	},
	show: {
		icon: "▤",
		label: "Show",
		tone: "blue",
		hint: "Displays a declarative view and immediately continues",
	},
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
	tool: {
		icon: "⚙",
		label: "Built-in",
		tone: "blue",
		hint: "Bob runs a built-in action",
	},
	script: {
		icon: "›_",
		label: "Script",
		tone: "green",
		hint: "Runs a shell script in the worktree",
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
	human: {
		icon: "🙋",
		label: "You",
		tone: "red",
		hint: "Waits for a human decision",
	},
};
function legacyNewStep(
	kind:
		| "agent"
		| "check"
		| "decide"
		| "approve"
		| "show"
		| "tool"
		| "script"
		| "fanout"
		| "foreach"
		| "snapshot"
		| "file-issues"
		| "launch-runs"
		| "workflow"
		| "human",
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
		case "decide":
			return {
				...base,
				name: "Decide per item",
				type: "decide",
				view: {
					version: "view-v1",
					components: [
						{
							id: "intro",
							type: "markdown",
							data: {
								literal: { text: "Choose what should happen to each item." },
							},
						},
					],
				},
				decide: {
					items: { literal: [{ id: "first", title: "First item" }] },
					itemId: "/id",
					title: "/title",
					details: [],
					actions: [
						{ id: "fix", label: "Fix", comment: true },
						{ id: "skip", label: "Skip", comment: true },
						{
							id: "followUp",
							label: "Follow up",
							comment: true,
							followUp: true,
						},
					],
				},
			};
		case "approve":
		case "show":
			return {
				...base,
				name: kind === "approve" ? "Approve artifact" : "Show summary",
				type: kind,
				view: {
					version: "view-v1",
					components: [
						{
							id: "intro",
							type: "markdown",
							data: {
								literal: {
									text:
										kind === "approve"
											? "Review this artifact before approving it."
											: "The recipe continues after displaying this summary.",
								},
							},
						},
					],
				},
			};
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
		case "human":
			return {
				...base,
				name: "Your review",
				type: "tool",
				tool: "human-review",
			};
		case "tool":
			return {
				...base,
				name: "New built-in step",
				type: "tool",
				tool: "draft-pr",
			};
		case "script":
			return {
				...base,
				name: "New script",
				type: "script",
				script: "pnpm test",
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
	decide: "display",
	approve: "display",
	show: "display",
	human: "display",
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
				settings: ["decide", "approve", "show"].includes(type)
					? "human"
					: ["snapshot", "file-issues", "launch-runs"].includes(type)
						? "action"
						: ["check", "foreach"].includes(type)
							? type
							: "inline",
				defaults: legacyNewStep(
					type as Parameters<typeof legacyNewStep>[0],
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
	"decide",
	"approve",
	"show",
	"human",
	"tool",
	"script",
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
