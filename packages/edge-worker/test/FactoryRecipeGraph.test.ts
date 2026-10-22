import { describe, expect, it } from "vitest";
import { layoutRecipeCanvas } from "../src/factory/web/recipe-canvas.js";
import {
	calledNodeId,
	calledRecipeOf,
	draftProblems,
	editableOf,
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

const pipeline = recipe(
	[
		step("clarify"),
		step("plan"),
		step("plan-review", {
			branches: [{ when: { path: "approved", equals: false }, next: "plan" }],
		}),
		step("architecture-review"),
		step("implement"),
		step("specialist-review", {
			type: "fanout",
			groups: [[step("architecture-review")]],
		}),
		step("human-fix", { next: "end" }),
		step("external-apply"),
	],
	"pipeline",
);

describe("recipe graph", () => {
	it("retains call boundaries, mapped inputs and outcome routes without changing definitions", () => {
		const callee = recipe([step("a"), step("b", { next: "end" })], "callee");
		const caller = recipe([
			step("start"),
			step("call", {
				type: "workflow",
				workflow: "callee",
				next: "wrap",
				inputMapping: { topic: "/input/topic" },
				branches: [{ when: { path: "rework", equals: true }, next: "start" }],
			}),
			step("skipped"),
			step("wrap", {
				branches: [{ when: { path: "x", equals: 1 }, next: "call" }],
			}),
		]);
		const original = structuredClone([caller, callee]);
		const graph = recipeGraph(caller, [caller, callee]);
		expect(graph.steps).toEqual(caller.steps);
		expect(graph.included).toEqual(["callee"]);
		expect(graph.owners).toEqual({
			start: "local",
			call: "local",
			skipped: "local",
			wrap: "local",
		});
		expect(mainPath(graph.steps)).toEqual(["start", "call", "wrap"]);
		expect(
			routesOf(graph.steps).filter((route) => route.from === "call"),
		).toEqual([
			{
				from: "call",
				to: "start",
				kind: "branch",
				label: "Rework needed",
				back: true,
				index: 0,
			},
			{
				from: "call",
				to: "wrap",
				kind: "flow",
				label: "Otherwise",
				back: false,
			},
		]);
		expect([caller, callee]).toEqual(original);
	});

	it("resolves repeated calls and private fork dependencies from the supplied catalog", () => {
		const callee = recipe([step("start")], "private-worker");
		const caller = recipe([
			step("start"),
			step("first", { type: "workflow", workflow: "private-worker" }),
			step("second", { type: "workflow", workflow: "private-worker" }),
		]);
		const graph = recipeGraph(caller, [caller, callee]);
		expect(graph.steps.map((s) => s.id)).toEqual(["start", "first", "second"]);
		expect(graph.included).toEqual(["private-worker"]);
		expect(calledRecipeOf(caller.steps[1]!, [callee]).recipe).toBe(callee);
		expect(calledNodeId("first", "start")).not.toBe(
			calledNodeId("second", "start"),
		);
		expect(calledNodeId(calledNodeId("first", "call"), "start")).not.toBe(
			calledNodeId("first", "call/start"),
		);
	});

	it("shows missing, recursive and empty calls honestly without unbounded expansion", () => {
		const call = step("call", { type: "workflow", workflow: "worker" });
		const worker = recipe([call], "worker");
		expect(calledRecipeOf(call, []).problem).toBeDefined();
		expect(calledRecipeOf(call, [worker], ["worker"]).problem).toBeDefined();
		expect(
			calledRecipeOf(call, [{ ...worker, steps: [] }]).problem,
		).toBeDefined();
		const layout = layoutRecipeCanvas(
			[call],
			[worker],
			new Set(["call", calledNodeId("call", "call")]),
		);
		expect(layout.calls.call!.graph!.calls.call!.problem).toBeDefined();
		expect(layout.calls.call!.graph!.calls.call!.graph).toBeUndefined();
	});

	it("expands the real child graph per call instance and retains child loops and returns", () => {
		const calls = ["first", "second"].map((id) =>
			step(id, { type: "workflow", workflow: "pipeline" }),
		);
		const original = structuredClone(pipeline);
		const collapsed = layoutRecipeCanvas(calls, [pipeline], new Set());
		expect(collapsed.calls.first!.graph).toBeUndefined();
		const expanded = layoutRecipeCanvas(calls, [pipeline], new Set(["second"]));
		expect(expanded.calls.first!.graph).toBeUndefined();
		const inner = expanded.calls.second!.graph!;
		expect(Object.keys(inner.sizes)).toEqual(pipeline.steps.map((s) => s.id));
		expect(inner.positions.end).toBeDefined();
		expect(inner.positions.plan).toBeDefined();
		expect(expanded.sizes.second!.width).toBeGreaterThan(
			collapsed.sizes.second!.width,
		);
		for (const [id, position] of Object.entries(inner.positions)) {
			expect(
				Number.isFinite(position.x) && Number.isFinite(position.y),
				id,
			).toBe(true);
			expect(position.x).toBeGreaterThanOrEqual(0);
			expect(position.y).toBeGreaterThanOrEqual(0);
		}
		expect(pipeline).toEqual(original);
	});

	it("lays out phone compositions vertically with readable collapsed call sizes", () => {
		const calls = ["first", "second", "third"].map((id) =>
			step(id, { type: "workflow", workflow: "pipeline" }),
		);
		const graph = layoutRecipeCanvas(
			calls,
			[pipeline],
			new Set(),
			undefined,
			[],
			true,
		);
		expect(graph.positions.second!.y).toBeGreaterThan(
			graph.positions.first!.y + graph.sizes.first!.height,
		);
		expect(graph.positions.third!.y).toBeGreaterThan(
			graph.positions.second!.y + graph.sizes.second!.height,
		);
		expect(graph.width).toBeLessThan(360);
		expect(graph.sizes.first).toEqual({ width: 220, height: 112 });
	});

	it("renders declared return outcomes and route entries without dangling edges or losing edited ports", () => {
		const callee = {
			...recipe(
				[
					step("review", {
						branches: [{ when: { path: "fix", equals: true }, next: "rework" }],
						next: "qa",
					}),
				],
				"worker",
			),
			inputs: ["brief"],
			outcomes: ["rework", "qa"],
		};
		const calls = [
			step("call", {
				type: "workflow",
				workflow: "worker",
				bindings: { brief: "source" },
			}),
			step("source", {
				branches: [
					{
						when: { path: "again", equals: true },
						next: "call",
						entry: "review",
					},
				],
			}),
		];
		const graph = layoutRecipeCanvas(calls, [callee], new Set(["call"]));
		const inner = graph.calls.call!.graph!;
		expect(inner.terminals).toEqual([
			{ id: "end", missing: false },
			{ id: "rework", missing: false },
			{ id: "qa", missing: false },
		]);
		for (const outcome of callee.outcomes) {
			expect(Number.isFinite(inner.positions[outcome]!.x)).toBe(true);
			expect(Number.isFinite(inner.positions[outcome]!.y)).toBe(true);
		}
		expect(routesOf(callee.steps).map((route) => route.back)).toEqual([
			false,
			false,
		]);
		expect(routesOf(calls)[1]).toMatchObject({
			entry: "review",
			label: "again is true · enter review",
			back: true,
		});
		expect(editableOf(callee)).toMatchObject({
			inputs: ["brief"],
			outcomes: ["rework", "qa"],
		});
		expect(
			layoutRecipeCanvas([step("bad", { next: "missing" })], [], new Set())
				.terminals,
		).toContainEqual({ id: "missing", missing: true });
	});

	it("marks review loops as loops and keeps the main path forward", () => {
		const steps = pipeline.steps;
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
		const steps = pipeline.steps;
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
