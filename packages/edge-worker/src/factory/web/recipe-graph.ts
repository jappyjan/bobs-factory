import { layout as dagreLayout, graphlib } from "@dagrejs/dagre";
import {
	FileIssuesConfigurationSchema,
	LaunchRunsConfigurationSchema,
	SnapshotConfigurationSchema,
} from "../ActionSteps.js";
import { ForeachSettingsSchema, prepareForeach } from "../Foreach.js";
import { DecideConfigurationSchema } from "../HumanStep.js";
import { ViewSourceSchema } from "../View.js";
import type { WorkflowStep } from "../Workflow.js";
import { DEFAULT_STEP_MAX_VISITS } from "../WorkflowLimits.js";

export type Step = WorkflowStep;
export type Recipe = {
	stepConfigVersion?: "step-config-v1";
	id: string;
	name: string;
	icon?: string;
	description: string;
	labels: string[];
	steps: Step[];
	inputs?: string[];
	outcomes?: string[];
	internal?: boolean;
	chat?: boolean;
	allowedTriggers: string[];
	launchFields?: {
		name: string;
		label: string;
		type?: string;
		required?: boolean;
	}[];
	ownership?: "bundled" | "local";
	enabled?: boolean;
	provenance?: { kind: string; source: string; version?: string };
	unavailable?: string[];
};

/** Fields a recipe owns; catalog metadata (enabled, provenance…) is not edited here. */
const editableKeys = [
	"stepConfigVersion",
	"id",
	"name",
	"icon",
	"description",
	"labels",
	"steps",
	"inputs",
	"outcomes",
	"internal",
	"chat",
	"allowedTriggers",
	"launchFields",
] as const;
export function editableOf(recipe: Recipe): Partial<Recipe> {
	return Object.fromEntries(
		editableKeys
			.filter((key) => recipe[key] !== undefined)
			.map((key) => [key, structuredClone(recipe[key])]),
	);
}

export const triggers = [
	{ id: "manual", icon: "✋", label: "Start manually", short: "Manual" },
	{
		id: "ticket-assignment",
		icon: "🎫",
		label: "Start from a Linear ticket",
		short: "Ticket",
	},
	{
		id: "workflow",
		icon: "🧩",
		label: "Called by another recipe",
		short: "Callable",
	},
];

const conditionText: Record<string, string> = {
	"approved=false": "Changes requested",
	"approved=true": "Approved",
	"fix=true": "Needs a fix",
	'decision="reject"': "Rejected",
	'decision="revise"': "Revision requested",
	"rework=true": "Rework needed",
	"reviewRequired=false": "No re-review needed",
	"impactRequired=true": "Impact changed",
	"retainQa=true": "QA still valid",
	"correctionRequired=true": "Correction needed",
	"readinessOnly=true": "Only readiness changed",
	"extractRequirements=true": "Requirements changed",
	"externalPending=true": "External work pending",
	'mode="external"': "External delivery",
	'mode="mixed"': "Mixed delivery",
	"deferred=true": "Deferred",
	"repositoryComplete=true": "Repository done",
	"drift=true": "External state drifted",
	"hasFollowUps=true": "Has follow-ups",
	"hasFollowUps=false": "No follow-ups",
};
export function describeCondition(when: { path: string; equals?: unknown }) {
	if (!when.path) return "New condition";
	return (
		conditionText[`${when.path}=${JSON.stringify(when.equals)}`] ??
		`${when.path} is ${JSON.stringify(when.equals) ?? "unset"}`
	);
}

export type Kind = { icon: string; label: string; tone: string; hint: string };
export const kinds: Record<
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
	Kind
> = {
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
export const humanTools = [
	"human-review",
	"architecture-decision",
	"external-human-review",
];
export function kindOf(step: Step): Kind {
	if (step.type === "tool" && humanTools.includes(step.tool ?? ""))
		return kinds.human;
	return kinds[step.type];
}

export const toolText: Record<string, string> = {
	"record-decisions":
		"Saves the clarified decisions so later steps can rely on them.",
	"inspect-existing": "Reads the existing branch, PR and discussion.",
	"draft-pr": "Pushes the branch and opens a draft pull request.",
	"accept-delivery":
		"Records the accepted, independently reviewed delivery contract.",
	"review-gate":
		"Collects reviewer findings, drops nitpicks and decides whether fixes are needed.",
	ci: "Watches CI, mergeability and PR comments until the PR is ready.",
	"ci-fix-readiness": "Refreshes provider readiness before a queued CI fix.",
	"inspect-review-readiness":
		"Inspects current revision, feedback and provider evidence for review rules.",
	"review-after-fix":
		"Decides whether a fix changed enough to need another review.",
	"visual-gate": "Checks QA results and screenshots before hand-off.",
	"impact-checks": "Runs the checks the impact assessment selected.",
	handoff: "Verifies the reviewed revision and hands it over.",
	"human-review": "Waits for you to approve or request changes.",
	merge: "Merges the approved revision.",
	"architecture-decision":
		"Waits for you to accept the architecture when it matters.",
	"delivery-route":
		"Checks the accepted delivery contract and picks the route.",
	"delivery-mode": "Routes based on repository, external or mixed delivery.",
	"external-apply": "Applies authorized changes to external tickets.",
	"external-verify":
		"Independently re-reads ticket state to verify the changes.",
	"external-guide": "Prepares the review of external work.",
	"external-human-review": "Waits for you to accept the external work.",
	"external-final": "Confirms accepted external state before finishing.",
};
/** Retained descriptions explain saved graphs; new recipes use Check instead. */
export const legacyDecisionTools = new Set([
	"review-gate",
	"visual-gate",
	"delivery-mode",
	"delivery-route",
	"review-after-fix",
]);
export const authorableTools = Object.keys(toolText).filter(
	(tool) => !legacyDecisionTools.has(tool),
);
export function stepSummary(step: Step, recipes: Recipe[]): string {
	if (step.type === "decide")
		return `Choose an action for each item. Routes can use hasFollowUps or itemsByAction.${step.decide?.actions[0]?.id ?? "action"}.`;
	if (step.type === "approve")
		return "Waits for explicit acceptance of the exact displayed content. Routes on approved; requested changes include feedback.";
	if (step.type === "show")
		return "Displays the configured view without pausing the recipe.";
	if (step.type === "snapshot")
		return `Pins every repository in scope.${step.snapshot?.history ? " Includes dated, repository-matched run history." : ""}`;
	if (step.type === "file-issues")
		return "Creates backlog-only, unassigned tickets. Retries reconcile accepted item identities before sending.";
	if (step.type === "launch-runs")
		return `Launches “${recipes.find((r) => r.id === (step.launchRuns?.workflow ?? "factory"))?.name ?? step.launchRuns?.workflow ?? "factory"}” in dependency waves. ${step.launchRuns?.wait === false ? "Returns child links; tracking continues." : "Waits for child outcomes."}`;
	if (step.type === "check")
		return `Evaluates ${Object.keys(step.check?.results ?? {}).length} named results. Routes on passed and those results.`;
	if (step.type === "tool")
		return toolText[step.tool ?? ""] ?? `Built-in action “${step.tool}”.`;
	if (step.type === "workflow")
		return `Runs “${recipes.find((r) => r.id === step.workflow)?.name ?? step.workflow}”, then continues.`;
	if (step.type === "foreach")
		return `${itemSourceSummary(step)} · up to ${step.concurrency ?? 4} at once · ${step.failure === "keep-successful" ? "keep successful items" : "all must succeed"}.`;
	if (step.type === "fanout")
		return `${step.groups?.length ?? 0} branches run at the same time.`;
	if (step.type === "script") return step.script ?? "";
	return (step.prompt ?? "").split(/(?<=\.)\s/)[0] ?? "";
}
export function itemSourceSummary(step: Step): string {
	return step.items && "from" in step.items
		? `Items from ${step.items.from}`
		: `${step.items && "values" in step.items ? step.items.values.length : 0} inline items`;
}
/** Direct children retain their lexical container scope. */
export function childrenOf(step: Step): Step[] {
	return step.type === "foreach"
		? (step.body ?? [])
		: (step.groups ?? []).flat();
}
export function findStepPath(steps: Step[], path: string[]): Step | undefined {
	const step = steps.find((s) => s.id === path[0]);
	return path.length <= 1 || !step
		? step
		: findStepPath(childrenOf(step), path.slice(1));
}
export function agentSummary(step: Step, defaultRunner: string) {
	if (step.type !== "agent") return undefined;
	const runner = step.runner ?? defaultRunner;
	return [
		runner[0]!.toUpperCase() + runner.slice(1),
		step.model,
		step.reasoningEffort,
	]
		.filter(Boolean)
		.join(" · ");
}

/* ----------------------------------------------------------------- routing */

export type Route = {
	from: string;
	to: string;
	kind: "flow" | "branch";
	label?: string;
	/** Points back to a step that already ran, i.e. a loop. */
	back: boolean;
	index?: number;
	entry?: string;
};
/** The runtime's next step: first matching branch, then next, then array order. */
export function fallbackOf(steps: Step[], step: Step): string {
	return step.next ?? steps[steps.indexOf(step) + 1]?.id ?? "end";
}
/** The path a run takes when no branch condition matches. */
export function mainPath(steps: Step[]): string[] {
	const seen: string[] = [];
	let current = steps[0]?.id;
	while (current && current !== "end" && !seen.includes(current)) {
		const step = steps.find((s) => s.id === current);
		if (!step) break;
		seen.push(current);
		current = fallbackOf(steps, step);
	}
	return seen;
}
/** Main path first, then steps in the order they are reachable from it. */
export function runOrder(steps: Step[]): string[] {
	const order = mainPath(steps);
	for (let i = 0; i < order.length; i++) {
		const step = steps.find((s) => s.id === order[i]);
		if (!step) continue;
		for (const to of [
			...step.branches.map((b) => b.next),
			fallbackOf(steps, step),
		])
			if (to !== "end" && !order.includes(to) && steps.some((s) => s.id === to))
				order.push(to);
	}
	for (const s of steps) if (!order.includes(s.id)) order.push(s.id);
	return order;
}
export function routesOf(steps: Step[]): Route[] {
	const position = new Map(runOrder(steps).map((id, i) => [id, i]));
	const back = (from: string, to: string) =>
		position.has(to) && (position.get(to) ?? 0) <= (position.get(from) ?? 0);
	return steps.flatMap((step) => {
		const fallback = fallbackOf(steps, step);
		return [
			...step.branches.map((b, index) => ({
				from: step.id,
				to: b.next,
				kind: "branch" as const,
				label: `${describeCondition(b.when)}${b.entry ? ` · enter ${b.entry}` : ""}`,
				back: back(step.id, b.next),
				index,
				...(b.entry ? { entry: b.entry } : {}),
			})),
			{
				from: step.id,
				to: fallback,
				kind: "flow" as const,
				label: step.branches.length ? "Otherwise" : undefined,
				back: back(step.id, fallback),
			},
		];
	});
}
export function stepName(steps: Step[], id: string) {
	return id === "end" ? "Finish" : (steps.find((s) => s.id === id)?.name ?? id);
}
export function findStep(steps: Step[], id: string): Step | undefined {
	for (const step of steps) {
		if (step.id === id) return step;
		const found = findStep(childrenOf(step), id);
		if (found) return found;
	}
	return undefined;
}
export function agentSteps(steps: Step[]): Step[] {
	return steps.flatMap((s) =>
		s.type === "agent" ? [s] : agentSteps(childrenOf(s)),
	);
}

/* ---------------------------------------------------------- called recipes */

export type RecipeGraph = {
	/** The caller's real steps. Calls retain their inputs, outcomes and routes. */
	steps: Step[];
	/** Recipe that owns (and saves) each displayed top-level step. */
	owners: Record<string, string>;
	/** Directly called catalog recipes, in call order. */
	included: string[];
};
/** Displaying a graph must never rewrite the accepted definition or erase calls. */
export function recipeGraph(recipe: Recipe, recipes: Recipe[]): RecipeGraph {
	return {
		steps: recipe.steps,
		owners: Object.fromEntries(
			recipe.steps.map((step) => [step.id, recipe.id]),
		),
		included: [
			...new Set(
				recipe.steps.flatMap((step) =>
					step.type === "workflow" &&
					recipes.some((target) => target.id === step.workflow)
						? [step.workflow!]
						: [],
				),
			),
		],
	};
}

/** Resolve from the supplied definitions, including private forked dependencies. */
export function calledRecipeOf(
	step: Step,
	recipes: Recipe[],
	ancestors: string[] = [],
): { recipe?: Recipe; problem?: string } {
	if (step.type !== "workflow") return {};
	const recipe = recipes.find((candidate) => candidate.id === step.workflow);
	if (!recipe) return { problem: "Called recipe is unavailable" };
	if (ancestors.includes(recipe.id))
		return { recipe, problem: "Recursive call · open recipe to inspect" };
	if (!recipe.steps.length) return { recipe, problem: "No configured steps" };
	return { recipe };
}

/** Canvas IDs identify a call instance; definition IDs remain unchanged. */
export function calledNodeId(callId: string, stepId: string): string {
	return JSON.stringify([callId, stepId]);
}

/* ------------------------------------------------------------------ phases */

export type Phase = { id: string; label: string; color: string };
export const phases: Phase[] = [
	{ id: "understand", label: "Understand", color: "#4cc9f0" },
	{ id: "plan", label: "Plan", color: "#7b61ff" },
	{ id: "architecture", label: "Architecture", color: "#c77dff" },
	{ id: "build", label: "Build", color: "#3ddc97" },
	{ id: "review", label: "Review", color: "#ff9f43" },
	{ id: "ready", label: "Merge readiness", color: "#ffd23f" },
	{ id: "qa", label: "QA", color: "#4cc9f0" },
	{ id: "handoff", label: "Hand-off", color: "#ff5d73" },
	{ id: "fix", label: "Fix loops", color: "#a79fc6" },
	{ id: "external", label: "External delivery", color: "#5ec4b6" },
	{ id: "steps", label: "Steps", color: "#7b61ff" },
];
const knownPhases: Record<string, string> = {
	clarify: "understand",
	decisions: "understand",
	"existing-work": "understand",
	"assess-existing": "understand",
	plan: "plan",
	"plan-review": "plan",
	"delivery-route": "plan",
	"delivery-deferred": "plan",
	architecture: "architecture",
	"architecture-review": "architecture",
	"architecture-decision": "architecture",
	implement: "build",
	"draft-pr": "build",
	"assess-impact": "review",
	"extract-requirements": "review",
	"impact-checks": "review",
	"specialist-review": "review",
	"review-gate": "review",
	ci: "ready",
	"visual-scope": "qa",
	capture: "qa",
	"visual-review": "qa",
	"visual-gate": "qa",
	guide: "handoff",
	handoff: "handoff",
	"human-review": "handoff",
	merge: "handoff",
	"code-fix": "fix",
	"ci-fix": "fix",
	"after-ci-fix": "fix",
	"visual-fix": "fix",
	"human-fix": "fix",
	"delivery-feedback-route": "fix",
};
/** Stock steps have known phases; other steps join the phase run before them. */
export function phasesOf(steps: Step[]): Record<string, Phase> {
	const result: Record<string, Phase> = {};
	let previous = "steps";
	for (const id of runOrder(steps)) {
		const known =
			knownPhases[id] ?? (id.startsWith("external-") ? "external" : undefined);
		previous = known ?? previous;
		result[id] = phases.find((p) => p.id === previous)!;
	}
	return result;
}

/* ------------------------------------------------------------------ layout */

export function layoutSteps(
	steps: Step[],
	options: {
		size: (step: Step) => { width: number; height: number };
		end?: { width: number; height: number };
		terminal?: { width: number; height: number };
		nodesep?: number;
		ranksep?: number;
		direction?: "LR" | "TB";
	},
): Record<string, { x: number; y: number }> {
	const g = new graphlib.Graph();
	g.setGraph({
		rankdir: options.direction ?? "LR",
		nodesep: options.nodesep ?? 36,
		ranksep: options.ranksep ?? 56,
		edgesep: 20,
	});
	g.setDefaultEdgeLabel(() => ({}));
	const main = new Set(mainPath(steps));
	for (const s of steps) g.setNode(s.id, { ...options.size(s) });
	g.setNode("end", { ...(options.end ?? { width: 60, height: 60 }) });
	const routes = routesOf(steps);
	for (const route of routes)
		if (!g.hasNode(route.to))
			g.setNode(route.to, {
				...(options.terminal ?? options.end ?? { width: 60, height: 60 }),
			});
	// Loops are drawn around the layout; ranking only follows forward routes.
	for (const r of routes)
		if (!r.back)
			g.setEdge(r.from, r.to, {
				weight:
					r.kind === "flow" &&
					main.has(r.from) &&
					(main.has(r.to) || r.to === "end")
						? 8
						: 1,
			});
	dagreLayout(g);
	const positions: Record<string, { x: number; y: number }> = {};
	for (const id of g.nodes()) {
		const n = g.node(id) as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		positions[id] = { x: n.x - n.width / 2, y: n.y - n.height / 2 };
	}
	return positions;
}

/* ---------------------------------------------------------------- editing */

function patchInContainer(
	step: Step,
	path: string[],
	patch: Partial<Step>,
): Step {
	const update = (list: Step[]): Step[] =>
		list.map((child) =>
			child.id !== path[0]
				? child
				: path.length === 1
					? { ...child, ...patch }
					: patchInContainer(child, path.slice(1), patch),
		);
	return step.type === "foreach"
		? { ...step, body: update(step.body ?? []) }
		: { ...step, groups: step.groups?.map(update) };
}
/** Updates a top-level step or an exact lexical path inside a container. */
export function updateStep(
	recipe: Recipe,
	id: string,
	patch: Partial<Step>,
	parent?: string,
): Recipe {
	const path = parent ? [...parent.split("/"), id] : [id];
	return {
		...recipe,
		steps: recipe.steps.map((step) =>
			step.id !== path[0]
				? step
				: path.length === 1
					? { ...step, ...patch }
					: patchInContainer(step, path.slice(1), patch),
		),
	};
}
/** Inserts a step so the run goes `after → step → (after's previous next)`. */
export function insertStepAfter(
	recipe: Recipe,
	after: string | undefined,
	step: Step,
): Recipe {
	const steps = recipe.steps.map((s) => ({ ...s }));
	const index = after
		? steps.findIndex((s) => s.id === after)
		: steps.length - 1;
	const previous = steps[index];
	const target = previous
		? fallbackOf(recipe.steps, recipe.steps[index]!)
		: "end";
	const inserted = { ...step };
	if (target !== (steps[index + 1]?.id ?? "end")) inserted.next = target;
	if (previous?.next !== undefined) previous.next = inserted.id;
	steps.splice(index + 1, 0, inserted);
	return { ...recipe, steps };
}
/** Removes a step; routes into it continue where it would have continued. */
export function removeStep(recipe: Recipe, id: string): Recipe {
	const removed = recipe.steps.find((s) => s.id === id);
	if (!removed) return recipe;
	let continuation = fallbackOf(recipe.steps, removed);
	if (continuation === id) continuation = "end";
	const before = new Map(
		recipe.steps.map((s) => [s.id, fallbackOf(recipe.steps, s)]),
	);
	const steps = recipe.steps.filter((s) => s.id !== id);
	return {
		...recipe,
		steps: steps.map((s, i) => {
			const next = { ...s, branches: s.branches.map((b) => ({ ...b })) };
			for (const b of next.branches) if (b.next === id) b.next = continuation;
			let target = before.get(s.id)!;
			if (target === id) target = continuation;
			const implicit = steps[i + 1]?.id ?? "end";
			if (target === implicit) delete next.next;
			else next.next = target;
			return next;
		}),
	};
}
export function connect(recipe: Recipe, from: string, to: string): Recipe {
	const step = recipe.steps.find((s) => s.id === from);
	if (!step || from === to) return recipe;
	return updateStep(recipe, from, {
		branches: [
			...step.branches,
			{ when: { path: "", equals: true }, next: to },
		],
	});
}
export function uniqueStepId(taken: Iterable<string>, base: string) {
	const used = new Set(taken);
	let i = 1;
	while (used.has(`${base}-${i}`)) i++;
	return `${base}-${i}`;
}
export function newStep(
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
/** Problems the editor can explain before the server rejects a save. */
export function draftProblems(
	recipe: Recipe,
	recipes: Recipe[] = [recipe],
): string[] {
	const problems: string[] = [];
	const hasBlockingView = (steps: Step[], seen = new Set<string>()): boolean =>
		steps.some((step) => {
			if (step.type === "decide" || step.type === "approve") return true;
			if (hasBlockingView(childrenOf(step), seen)) return true;
			if (step.type !== "workflow" || !step.workflow || seen.has(step.workflow))
				return false;
			const target = recipes.find(
				(candidate) => candidate.id === step.workflow,
			);
			return Boolean(
				target && hasBlockingView(target.steps, new Set([...seen, target.id])),
			);
		});
	// Step IDs are unique within each list; parallel branches have their own scope.
	const walk = (steps: Step[]) => {
		const ids = new Set<string>();
		for (const s of steps) {
			if (
				(s.type === "foreach" || s.type === "fanout") &&
				hasBlockingView(childrenOf(s))
			)
				problems.push(
					`“${s.name}”: Decide and Approve belong outside For each and parallel branches, including called recipes.`,
				);
			if (["decide", "approve", "show"].includes(s.type)) {
				const view = ViewSourceSchema.safeParse(s.view);
				if (!view.success)
					problems.push(
						`“${s.name}”: ${view.error.issues.map((issue) => `${issue.path.join("/")}: ${issue.message}`).join("; ")}`,
					);
				if (s.type === "decide") {
					const decision = DecideConfigurationSchema.safeParse(s.decide);
					if (!decision.success)
						problems.push(
							`“${s.name}”: ${decision.error.issues.map((issue) => `${issue.path.join("/")}: ${issue.message}`).join("; ")}`,
						);
				}
			}
			const actionSchema =
				s.type === "snapshot"
					? SnapshotConfigurationSchema
					: s.type === "file-issues"
						? FileIssuesConfigurationSchema
						: s.type === "launch-runs"
							? LaunchRunsConfigurationSchema
							: undefined;
			if (actionSchema) {
				const value =
					s.type === "snapshot"
						? (s.snapshot ?? {})
						: s.type === "file-issues"
							? s.fileIssues
							: s.launchRuns;
				const parsed = actionSchema.safeParse(value);
				if (!parsed.success)
					problems.push(
						`“${s.name}”: ${parsed.error.issues.map((issue) => `${issue.path.join("/")}: ${issue.message}`).join("; ")}`,
					);
			}
			if (ids.has(s.id)) problems.push(`Two steps use the ID “${s.id}”.`);
			ids.add(s.id);
			if (!s.name.trim()) problems.push(`Step “${s.id}” needs a name.`);
			for (const b of s.branches)
				if (!b.when.path.trim())
					problems.push(`“${s.name}” has a route without a condition.`);
			if (s.type === "foreach") {
				if (!s.body?.length) problems.push(`“${s.name}” needs a body.`);
				const settings = ForeachSettingsSchema.safeParse(s);
				if (!settings.success)
					problems.push(
						`“${s.name}”: ${settings.error.issues.map((issue) => issue.message).join("; ")}`,
					);
				if (s.items && "values" in s.items && settings.success) {
					try {
						prepareForeach(s, { outputs: {} });
					} catch (error) {
						problems.push(
							`“${s.name}”: ${error instanceof Error ? error.message : "Invalid items"}`,
						);
					}
				}
				walk(s.body ?? []);
			}
			for (const g of s.groups ?? []) walk(g);
		}
	};
	walk(recipe.steps);
	if (!recipe.name.trim()) problems.push("The recipe needs a name.");
	if (recipe.id !== "simple" && !recipe.steps.length)
		problems.push("A recipe needs at least one step.");
	return problems;
}

/* --------------------------------------------------------------- simulate */

export type Outcome = { label: string; to: string; branch: boolean };
export function outcomesOf(steps: Step[], id: string): Outcome[] {
	const step = steps.find((s) => s.id === id);
	if (!step) return [];
	return [
		{
			label: step.branches.length ? "All good" : "Done",
			to: fallbackOf(steps, step),
			branch: false,
		},
		...step.branches.map((b) => ({
			label: `${describeCondition(b.when)}${b.entry ? ` · enter ${b.entry}` : ""}`,
			to: b.next,
			branch: true,
		})),
	];
}
