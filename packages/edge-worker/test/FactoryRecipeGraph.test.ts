import { describe, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	draftProblems,
	fallbackOf,
	insertStepAfter,
	mainPath,
	phasesOf,
	type Recipe,
	recipeGraph,
	removeStep,
	routesOf,
	type Step,
	updateStep,
} from "../src/factory/web/recipe-graph.js";

const recipes = defaultWorkflows as unknown as Recipe[];
const byId = (id: string) => recipes.find((r) => r.id === id)!;
const step = (id: string, extra: Partial<Step> = {}): Step => ({
	id,
	name: id,
	type: "agent",
	prompt: "p",
	branches: [],
	maxVisits: 8,
	...extra,
});
const recipe = (steps: Step[], id = "local"): Recipe => ({
	id,
	name: id,
	description: "",
	labels: [],
	allowedTriggers: ["manual"],
	steps,
});
/** Follows routes like WorkflowRuntime.nextStep, choosing the default each time. */
const defaultRun = (steps: Step[]) => {
	const path: string[] = [];
	let id = steps[0]?.id ?? "end";
	while (id !== "end" && path.length < 100) {
		path.push(id);
		id = fallbackOf(steps, steps.find((s) => s.id === id)!);
	}
	return path;
};

describe("recipe graph", () => {
	it("shows the called factory pipeline inline with every step owned by it", () => {
		const graph = recipeGraph(byId("factory"), recipes);
		const pipeline = byId("factory-pipeline");
		expect(graph.included).toEqual(["factory-pipeline"]);
		expect(graph.steps.map((s) => s.id)).toEqual(
			pipeline.steps.map((s) => s.id),
		);
		expect(new Set(Object.values(graph.owners))).toEqual(
			new Set(["factory-pipeline"]),
		);
		expect(mainPath(graph.steps)).toEqual(defaultRun(pipeline.steps));
	});

	it("keeps takeover's own steps and continues into the pipeline", () => {
		const graph = recipeGraph(byId("takeover"), recipes);
		expect(graph.steps.slice(0, 3).map((s) => s.id)).toEqual([
			"existing-work",
			"assess-existing",
			"clarify",
		]);
		expect(graph.owners["assess-existing"]).toBe("takeover");
		expect(graph.owners.clarify).toBe("factory-pipeline");
	});

	it("continues after a call where the caller would have continued", () => {
		const callee = recipe([step("a"), step("b", { next: "end" })], "callee");
		const caller = recipe([
			step("start"),
			step("call", { type: "workflow", workflow: "callee", next: "wrap" }),
			step("skipped"),
			step("wrap", {
				branches: [{ when: { path: "x", equals: 1 }, next: "call" }],
			}),
		]);
		const graph = recipeGraph(caller, [caller, callee]);
		const ids = graph.steps.map((s) => s.id);
		expect(ids).toEqual(["start", "a", "b", "skipped", "wrap"]);
		expect(graph.steps.find((s) => s.id === "b")!.next).toBe("wrap");
		expect(graph.steps.find((s) => s.id === "wrap")!.branches[0]!.next).toBe(
			"a",
		);
		expect(mainPath(graph.steps)).toEqual(["start", "a", "b", "wrap"]);
	});

	it("leaves calls with colliding step IDs as a single step", () => {
		const callee = recipe([step("start")], "callee");
		const caller = recipe([
			step("start"),
			step("call", { type: "workflow", workflow: "callee" }),
		]);
		expect(
			recipeGraph(caller, [caller, callee]).steps.map((s) => s.id),
		).toEqual(["start", "call"]);
	});

	it("marks review loops as loops and keeps the main path forward", () => {
		const steps = byId("factory-pipeline").steps;
		const routes = routesOf(steps);
		const main = new Set(mainPath(steps));
		const loop = routes.find(
			(r) => r.from === "plan-review" && r.to === "plan",
		)!;
		expect(loop).toMatchObject({
			kind: "branch",
			back: true,
			label: "Changes requested",
		});
		for (const r of routes)
			if (r.kind === "flow" && main.has(r.from) && main.has(r.to))
				expect(r.back, `${r.from} → ${r.to}`).toBe(false);
	});

	it("puts every pipeline step in a phase and new steps beside their neighbours", () => {
		const steps = byId("factory-pipeline").steps;
		const phases = phasesOf(steps);
		expect(phases.clarify!.label).toBe("Understand");
		expect(phases["human-fix"]!.label).toBe("Fix loops");
		expect(phases["external-apply"]!.label).toBe("External delivery");
		const edited = insertStepAfter(recipe(steps), "implement", step("lint"));
		expect(phasesOf(edited.steps).lint!.label).toBe("Build");
	});
});

describe("recipe editing", () => {
	it("inserts a step without changing where the run goes afterwards", () => {
		const base = recipe([
			step("a"),
			step("b", { next: "d" }),
			step("c"),
			step("d"),
		]);
		const afterImplicit = insertStepAfter(base, "a", step("x"));
		expect(defaultRun(afterImplicit.steps)).toEqual(["a", "x", "b", "d"]);
		const afterExplicit = insertStepAfter(base, "b", step("y"));
		expect(defaultRun(afterExplicit.steps)).toEqual(["a", "b", "y", "d"]);
		const atEnd = insertStepAfter(base, undefined, step("z"));
		expect(defaultRun(atEnd.steps)).toEqual(["a", "b", "d", "z"]);
	});

	it("removes a step and routes its callers to where it continued", () => {
		const base = recipe([
			step("a", {
				branches: [{ when: { path: "p", equals: true }, next: "b" }],
			}),
			step("b", { next: "d" }),
			step("c"),
			step("d"),
		]);
		const edited = removeStep(base, "b");
		expect(defaultRun(edited.steps)).toEqual(["a", "d"]);
		expect(edited.steps[0]!.branches[0]!.next).toBe("d");
		expect(edited.steps.find((s) => s.id === "c")!.next).toBeUndefined();
	});

	it("edits a parallel branch without touching a top-level step sharing its ID", () => {
		const pipeline = byId("factory-pipeline");
		expect(draftProblems(pipeline)).toEqual([]);
		const edited = updateStep(
			pipeline,
			"architecture-review",
			{ runner: "codex" },
			"specialist-review",
		);
		const top = edited.steps.find((s) => s.id === "architecture-review")!;
		const branch = edited.steps
			.find((s) => s.id === "specialist-review")!
			.groups!.flat()
			.find((s) => s.id === "architecture-review")!;
		expect(top.runner).toBeUndefined();
		expect(branch.runner).toBe("codex");
	});
});
