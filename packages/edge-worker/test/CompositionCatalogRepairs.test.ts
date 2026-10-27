import { mkdtempSync, rmSync } from "node:fs";
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

it("preserves compatible route entries and saves Finish, sibling and Return edits through reload", () => {
	const { instance, home } = runtime();
	const leaf = (id) => ({
		id,
		name: id,
		type: "transform",
		transform: { ok: { literal: true } },
		branches: [],
		maxVisits: 8,
	});
	const child = {
		engineVersion: "nodes-v1",
		id: "route-child",
		name: "Route child",
		steps: [leaf("entry")],
		outcomes: ["returned"],
		allowedTriggers: ["workflow"],
	};
	const local = {
		engineVersion: "nodes-v1",
		id: "route-local",
		name: "Route local",
		outcomes: ["returned"],
		steps: [
			{
				id: "call",
				name: "Call",
				type: "workflow",
				workflow: child.id,
				branches: [],
				maxVisits: 8,
			},
			leaf("sibling"),
			{
				...leaf("route"),
				branches: [
					{
						when: { path: "repair", equals: true },
						next: "call",
						entry: "entry",
					},
				],
			},
		],
	};
	instance.updateWorkflows([...instance.listWorkflows(), child, local]);
	const original = local.steps[2].branches[0];
	expect(
		changeRouteTarget(original, "call", local.steps, instance.listWorkflows()),
	).toEqual(original);
	for (const next of ["end", "sibling", "returned"]) {
		local.steps[2].branches[0] = changeRouteTarget(
			original,
			next,
			local.steps,
			instance.listWorkflows(),
		);
		expect(local.steps[2].branches[0].entry).toBeUndefined();
		instance.updateWorkflows(
			instance.listWorkflows().map((w) => (w.id === local.id ? local : w)),
		);
		expect(
			runtime(home)
				.instance.listWorkflows()
				.find((w) => w.id === local.id).steps[2].branches[0],
		).toEqual(local.steps[2].branches[0]);
	}
});
