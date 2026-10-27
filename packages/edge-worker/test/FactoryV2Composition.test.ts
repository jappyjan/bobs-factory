import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowCatalog } from "../src/factory/WorkflowCatalog.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { layoutRecipeCanvas } from "../src/factory/web/recipe-canvas.js";
import { fixture, owned } from "./fixtures/factory-v2-composition.js";

it("renders bundled compositions as collapsible calls without recipe-specific presentation", () => {
	for (const id of ["factory", "takeover"]) {
		const recipe = defaultWorkflows.find((w) => w.id === id)!;
		const collapsed = layoutRecipeCanvas(
			recipe.steps,
			defaultWorkflows,
			new Set(),
		);
		expect(collapsed.calls.implementation!.graph).toBeUndefined();
		const expanded = layoutRecipeCanvas(
			recipe.steps,
			defaultWorkflows,
			new Set(["implementation"]),
		);
		expect(
			expanded.calls.implementation!.graph!.positions.implement,
		).toBeDefined();
	}
});

it.each([
	"running",
	"waiting",
	"interrupted",
	"blocked",
	"completed",
	"failed",
	"stopped",
])("gates loaded legacy %s runs without changing frozen history", async (status) => {
	const f = fixture("deferred");
	await f.runtime.shutdown();
	const old = {
		...f.run,
		workflow: { ...f.run.workflow, engineVersion: undefined },
		workflowDefinitions: [],
		status,
		history: [{ step: "old", output: { retained: true } }],
		events: [],
	};
	writeFileSync(
		join(f.runtime.directory, "runs", `${old.id}.json`),
		JSON.stringify(old),
	);
	const restored = new WorkflowRuntime(join(f.home, "state"), f.hooks);
	owned.at(-1)!.runtime = restored;
	const run = restored.get(old.id);
	const terminal = ["completed", "failed", "stopped"].includes(status);
	expect(run.status).toBe(terminal ? status : "stopped");
	if (!terminal)
		expect(run.error).toBe("Created by an older recipe engine; restart it");
	expect(run.history).toEqual(old.history);
	expect(restored.canResume(run.id)).toBe(false);
	expect(() => restored.resume(run.id)).toThrow(
		"Created by an older recipe engine; restart it",
	);
	restored.resumeAll();
	expect(f.agent).not.toHaveBeenCalled();
});
it("disables a saved legacy fork and directs the operator to fork the current recipe", async () => {
	const f = fixture("deferred"),
		catalog = new WorkflowCatalog(join(f.home, "catalog"));
	const legacy = WorkflowSchema.parse({
		id: "old-fork",
		name: "My old fork",
		steps: [{ id: "old", name: "Old agent", type: "agent", prompt: "Old" }],
	});
	catalog.save([...catalog.list(), legacy]);
	const loaded = new WorkflowCatalog(join(f.home, "catalog"));
	expect(loaded.metadata(legacy.id)).toMatchObject({
		enabled: false,
		disabledReason: "Fork again from current bundled recipe",
		unavailable: [legacy.id],
	});
	expect(() => loaded.requireAvailable(legacy, loaded.list())).toThrow(
		"Fork again from current bundled recipe",
	);
	const current = loaded.fork("factory");
	expect(loaded.metadata(current.id)).toMatchObject({
		enabled: true,
		unavailable: [],
	});
});
