import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { changeRouteTarget } from "../src/factory/web/recipe-graph.js";

const roots: string[] = [],
	runtimes: WorkflowRuntime[] = [];
const hooks = {
	agent: async () => {
		throw new Error("No agent effects authorized");
	},
	tool: async () => ({}),
	script: async () => ({}),
};
function runtime(home?: string) {
	if (!home) {
		home = mkdtempSync(join(tmpdir(), "composition-catalog-"));
		roots.push(home);
	}
	const instance = new WorkflowRuntime(home, hooks);
	runtimes.push(instance);
	return { instance, home };
}
afterEach(async () => {
	for (const instance of runtimes.splice(0)) await instance.shutdown();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it("R5 preserves compatible correction entries and saves Finish, sibling and Return edits through catalog reload", () => {
	const { instance, home } = runtime();
	const fork = instance.forkWorkflow("factory", "Editable correction routes");
	const step = fork.steps.find((s) => s.id === "review")!;
	const index = step.branches.findIndex((b) => b.when.equals === "to-ci-fix");
	const original = structuredClone(step.branches[index]!);
	const recipes = instance.listWorkflows();
	expect(changeRouteTarget(original, "ci", fork.steps, recipes)).toEqual(
		original,
	);
	const saved: unknown[] = [];
	for (const next of ["end", "qa", "to-architecture"]) {
		// A declared Return is tested on its owning recipe, not as a sibling step.
		const owner =
			next === "to-architecture"
				? instance.forkWorkflow("route-delivery", "Return editing")
				: fork;
		const targetStep =
			next === "to-architecture"
				? owner.steps.find((s) => s.id === "delivery-route")!
				: step;
		if (next === "to-architecture")
			targetStep.branches.push(structuredClone(original));
		const targetIndex =
			next === "to-architecture" ? targetStep.branches.length - 1 : index;
		targetStep.branches[targetIndex] = changeRouteTarget(
			original,
			next,
			owner.steps,
			instance.listWorkflows(),
		);
		expect(targetStep.branches[targetIndex]!.entry).toBeUndefined();
		instance.updateWorkflows(
			instance.listWorkflows().map((w) => (w.id === owner.id ? owner : w)),
		);
		const reloaded = runtime(home)
			.instance.listWorkflows()
			.find((w) => w.id === owner.id)!;
		expect(
			reloaded.steps.find((s) => s.id === targetStep.id)!.branches[targetIndex],
		).toEqual(targetStep.branches[targetIndex]);
		saved.push({ next, recipe: reloaded });
	}
	writeFileSync(
		"/tmp/taskbot142-r2-route-entry.json",
		JSON.stringify(
			{
				original,
				saved,
				configuration: JSON.parse(
					readFileSync(join(home, "factory", "workflows.json"), "utf8"),
				),
			},
			null,
			2,
		),
	);
});

it("R6 retains legacy planning settings at every actual role owner and preserves explicit overrides visibly", () => {
	const { instance, home } = runtime();
	const path = join(home, "factory", "workflows.json");
	const state = instance.catalog.read();
	const settings = {
		runner: "codex" as const,
		model: "gpt-6.1-sol",
		reasoningEffort: "xhigh",
		serviceTier: "fast",
	};
	const current = { ...settings, model: "current-choice" };
	state.preferences["factory-pipeline"] = {
		clarify: settings,
		plan: settings,
		"plan-review": settings,
	};
	state.preferences["clarify-plan"] = { plan: current };
	state.preferences["external-delivery"] = { clarify: current };
	writeFileSync(path, JSON.stringify(state));
	const migrated = runtime(home).instance;
	for (const owner of ["clarify-plan", "route-delivery", "external-delivery"]) {
		for (const role of ["clarify", "plan", "plan-review"]) {
			const expected =
				(owner === "clarify-plan" && role === "plan") ||
				(owner === "external-delivery" && role === "clarify")
					? current
					: settings;
			expect(
				migrated
					.listWorkflows()
					.find((w) => w.id === owner)!
					.steps.find((s) => s.id === role),
			).toMatchObject(expected);
		}
	}
	expect(migrated.catalog.read().inactive).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				role: "plan",
				settings,
				reason: expect.stringContaining("clarify-plan/plan"),
			}),
			expect.objectContaining({
				role: "clarify",
				settings,
				reason: expect.stringContaining("external-delivery/clarify"),
			}),
		]),
	);
	const preferences = migrated.catalog.read().preferences;
	// Persist and reload through the same catalog write API used by the product.
	migrated.updatePreferences("clarify-plan", preferences["clarify-plan"]!);
	expect(runtime(home).instance.catalog.read().preferences).toEqual(
		preferences,
	);
	writeFileSync(
		"/tmp/taskbot142-r2-preferences.json",
		JSON.stringify(migrated.catalog.read(), null, 2),
	);
});
