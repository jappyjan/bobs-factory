import { layout as dagreLayout, graphlib } from "@dagrejs/dagre";
import {
	FileIssuesConfigurationSchema,
	LaunchRunsConfigurationSchema,
	SnapshotConfigurationSchema,
} from "../ActionSteps.js";
import { displayMayInteract } from "../DisplayDocument.js";
import { ForeachSettingsSchema, prepareForeach } from "../Foreach.js";

import { createNodeStep, type Kind, nodeKind } from "../nodes/metadata.js";

import type { WorkflowStep } from "../Workflow.js";

export type Step = WorkflowStep;
export type Recipe = {
	engineVersion?: "nodes-v1";
	stepConfigVersion?: "step-config-v1";
	convergence?: import("../ProgressPolicy.js").ProgressPolicy;
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
	disabledReason?: string;
};

/** Keep a correction entry only when it is a real entry in the new destination. */
export function changeRouteTarget(
	branch: Step["branches"][number],
	next: string,
	steps: Step[],
	recipes: Recipe[],
): Step["branches"][number] {
	const updated = { ...branch, next };
	if (!updated.entry) return updated;
	const call = steps.find((step) => step.id === next);
	const callee = recipes.find((recipe) => recipe.id === call?.workflow);
	if (
		call?.type !== "workflow" ||
		!callee?.outcomes?.length ||
		!callee.steps.some((step) => step.id === updated.entry)
	)
		delete updated.entry;
	return updated;
}

/** Fields a recipe owns; catalog metadata (enabled, provenance…) is not edited here. */
const editableKeys = [
	"engineVersion",
	"convergence",
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

const conditionText: Record<string, string> = {};
export function describeCondition(when: { path: string; equals?: unknown }) {
	if (!when.path) return "New condition";
	return (
		conditionText[`${when.path}=${JSON.stringify(when.equals)}`] ??
		`${when.path} is ${JSON.stringify(when.equals) ?? "unset"}`
	);
}

export type { Kind } from "../nodes/metadata.js";
export const kinds = new Proxy(
	{} as Record<string, Kind> & { human: Kind; workflow: Kind },
	{
		get: (_target, type: string) => nodeKind(type),
	},
);
export function kindOf(step: Step): Kind {
	return nodeKind(step.type);
}
export function stepSummary(step: Step, recipes: Recipe[]): string {
	if (step.type === "snapshot")
		return `Pins every repository in scope.${step.snapshot?.history ? " Includes dated, repository-matched run history." : ""}`;
	if (step.type === "file-issues")
		return "Creates backlog-only, unassigned tickets. Retries reconcile accepted item identities before sending.";
	if (step.type === "launch-runs")
		return `Launches “${recipes.find((r) => r.id === (step.launchRuns?.workflow ?? "factory"))?.name ?? step.launchRuns?.workflow ?? "factory"}” in dependency waves. ${step.launchRuns?.wait === false ? "Returns child links; tracking continues." : "Waits for child outcomes."}`;
	if (step.type === "check")
		return `Evaluates ${Object.keys(step.check?.results ?? {}).length} named results. Routes on passed and those results.`;
	if (step.type === "workflow")
		return `Runs “${recipes.find((r) => r.id === step.workflow)?.name ?? step.workflow}”, then continues.`;
	if (step.type === "foreach")
		return `${itemSourceSummary(step)} · up to ${step.concurrency ?? 4} at once · ${step.failure === "keep-successful" ? "keep successful items" : "all must succeed"}.`;
	if (step.type === "fanout")
		return `${step.groups?.length ?? 0} branches run at the same time.`;

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
	{ id: "steps", label: "Steps", color: "#7b61ff" },
];
export function phasesOf(steps: Step[]): Record<string, Phase> {
	return Object.fromEntries(steps.map((step) => [step.id, phases[0]!]));
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
export const newStep = createNodeStep;
/** Problems the editor can explain before the server rejects a save. */
export function draftProblems(
	recipe: Recipe,
	recipes: Recipe[] = [recipe],
): string[] {
	const problems: string[] = [];
	const hasBlockingView = (steps: Step[], seen = new Set<string>()): boolean =>
		steps.some((step) => {
			if (step.type === "display" && displayMayInteract(step)) return true;
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
					`“${s.name}”: Interactive displays belong outside For each and parallel branches, including called recipes.`,
				);

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
