import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aggregateForeach, prepareForeach } from "../src/factory/Foreach.js";
import { StepSchema } from "../src/factory/Workflow.js";
import { ForeachRunProgress } from "../src/factory/web/foreach-progress.js";
import {
	admitSimulatedItems,
	settleSimulatedItem,
} from "../src/factory/web/foreach-simulation.js";
import {
	bodyProblem,
	mappingProblem,
	pointerProblem,
} from "../src/factory/web/foreach-step-settings.js";
import {
	childrenOf,
	draftProblems,
	findStepPath,
	newStep,
	type Recipe,
	recipeGraph,
	updateStep,
} from "../src/factory/web/recipe-graph.js";

const iteration = () => StepSchema.parse(newStep("foreach", "perspectives"));

describe("For each authoring and simulation", () => {
	it("creates a valid editable container with an inline item and bounded body", () => {
		const step = iteration();
		expect(prepareForeach(step, { outputs: {} }).items).toEqual([
			{ id: "first", index: 0, value: { id: "first", name: "First item" } },
		]);
		expect(bodyProblem(step.body)).toBeUndefined();
		expect(childrenOf(step).map((child) => child.id)).toEqual([
			"perspectives-work",
		]);
	});
	it("keeps mapped call nodes visible with the input contract that actually executes", () => {
		const target = {
			id: "worker",
			name: "Worker",
			steps: [newStep("agent", "research")],
			description: "",
			labels: [],
			allowedTriggers: ["workflow"],
		} as Recipe;
		const call = {
			...newStep("workflow", "mapped-call", "worker"),
			inputMapping: { topic: "/item/name" },
		};
		const owner = { ...target, id: "owner", steps: [call] };
		expect(recipeGraph(owner, [owner, target]).steps).toEqual([call]);
	});

	it("rejects malformed pointers, call inputs, unsafe bodies and numeric limits", () => {
		for (const path of [
			"assignments",
			"/constructor/items",
			"/bad~escape",
			"/items/*",
		])
			expect(pointerProblem(path)).toBeDefined();
		for (const mapping of [
			{ item: "/item" },
			{ topic: "bad" },
			JSON.parse('{"__proto__":"/item"}'),
		])
			expect(mappingProblem(mapping)).toBeDefined();
		expect(
			mappingProblem({ topic: "/item/name", position: "/index" }),
		).toBeUndefined();
		expect(
			bodyProblem([{ ...newStep("agent", "ask"), askQuestions: true }]),
		).toBeDefined();
		expect(bodyProblem([newStep("human", "approve")])).toBeDefined();
		const invalid = { ...iteration(), concurrency: 1.5, maxItems: 0 };
		const recipe = {
			id: "local",
			name: "Local",
			steps: [invalid],
			description: "",
			labels: [],
			allowedTriggers: ["manual"],
		} as Recipe;
		expect(draftProblems(recipe).length).toBeGreaterThan(0);
		expect(StepSchema.safeParse(invalid).success).toBe(false);
	});
	it("edits the selected nested body without contaminating a sibling with the same child ID", () => {
		const outer = iteration();
		outer.body = ["left", "right"].map((id) => ({
			...newStep("foreach", id),
			body: [newStep("agent", "work")],
		}));
		const recipe = {
			id: "local",
			name: "Local",
			steps: [outer],
			description: "",
			labels: [],
			allowedTriggers: ["manual"],
		} as Recipe;
		const edited = updateStep(
			recipe,
			"work",
			{ prompt: "Only the right item changes" },
			"perspectives/right",
		);
		expect(
			findStepPath(edited.steps, ["perspectives", "right", "work"])?.prompt,
		).toBe("Only the right item changes");
		expect(
			findStepPath(edited.steps, ["perspectives", "left", "work"])?.prompt,
		).toBe(newStep("agent", "work").prompt);
		expect(
			findStepPath(recipe.steps, ["perspectives", "right", "work"])?.prompt,
		).toBe(newStep("agent", "work").prompt);
	});
	it("caps active simulated items and preserves completed receipts when failure stops siblings", () => {
		const snapshot = prepareForeach(
			{
				...iteration(),
				concurrency: 2,
				items: { values: ["a", "b", "c", "d"] },
				itemId: "",
			},
			{ outputs: {} },
		);
		let states = admitSimulatedItems(
			snapshot.items.map(() => ({ status: "pending" as const })),
			snapshot.concurrency,
		);
		expect(states.map((state) => state.status)).toEqual([
			"running",
			"running",
			"pending",
			"pending",
		]);
		states = settleSimulatedItem(snapshot, states, 1, "completed", {
			work: { approved: true },
		});
		expect(states.map((state) => state.status)).toEqual([
			"running",
			"completed",
			"running",
			"pending",
		]);
		states = settleSimulatedItem(
			snapshot,
			states,
			0,
			"failed",
			undefined,
			"Visit limit",
		);
		expect(states.map((state) => state.status)).toEqual([
			"failed",
			"completed",
			"cancelled",
			"cancelled",
		]);
		expect(aggregateForeach(snapshot, states).results).toEqual({
			b: { work: { approved: true } },
		});
		expect(aggregateForeach(snapshot, states).summary).toMatchObject({
			total: 4,
			completed: 1,
			failed: 1,
			cancelled: 2,
		});
	});
	it("keeps processing after synthetic failure and aggregates successes in original item order", () => {
		const snapshot = prepareForeach(
			{
				...iteration(),
				concurrency: 1,
				failure: "keep-successful",
				items: { values: ["a", "b"] },
				itemId: "",
			},
			{ outputs: {} },
		);
		let states = admitSimulatedItems(
			snapshot.items.map(() => ({ status: "pending" as const })),
			snapshot.concurrency,
		);
		states = settleSimulatedItem(
			snapshot,
			states,
			0,
			"failed",
			undefined,
			"Synthetic failure",
		);
		expect(states.map((state) => state.status)).toEqual(["failed", "running"]);
		states = settleSimulatedItem(snapshot, states, 1, "completed", {
			work: "retained",
		});
		expect(aggregateForeach(snapshot, states)).toEqual({
			results: { b: { work: "retained" } },
			summary: {
				total: 2,
				completed: 1,
				failed: 1,
				cancelled: 0,
				failures: [
					{ id: "a", index: 0, status: "failed", error: "Synthetic failure" },
				],
				limitations: ["a: Synthetic failure"],
			},
		});
	});
	it("renders actual retained per-item progress including failure details", () => {
		const html = renderToStaticMarkup(
			createElement(ForeachRunProgress, {
				progress: {
					"call/each": {
						key: "call/each",
						visit: 1,
						concurrency: 2,
						maxItems: 100,
						failure: "keep-successful",
						total: 3,
						completed: 1,
						failed: 1,
						items: [
							{ id: "security", index: 0, status: "completed" },
							{ id: "runtime", index: 1, status: "running" },
							{ id: "docs", index: 2, status: "failed", error: "Visit limit" },
						],
					},
				},
			}),
		);
		expect(html).toContain('aria-label="For each progress"');
		expect(html).toContain("1 of 3 completed · 1 failed");
		expect(html).toContain('data-status="running"');
		expect(html).toContain("Visit limit");
	});
});
