import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { stockWorkflowMetadata } from "../src/factory/stockFactorySteps.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

it("keeps Simple on its original direct conversation path", async () => {
	const home = mkdtempSync(join(tmpdir(), "simple-smoke-"));
	const workflow = defaultWorkflows.find((w) => w.id === "simple")!;
	expect(workflow).toEqual(
		WorkflowSchema.parse({
			...stockWorkflowMetadata.simple,
			engineVersion: "nodes-v1",
			steps: [],
		}),
	);
	const simple = vi.fn(async (run) => {
		expect(run.input).toBe("Explain this codebase");
	});
	const agent = vi.fn(async () => ({}));
	const runtime = new WorkflowRuntime(home, {
		simple,
		agent,
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Explain this codebase",
			workflow,
			workflowDefinitions: defaultWorkflows,
			triggerOrigin: {
				type: "manual",
				workflowId: "simple",
				at: new Date().toISOString(),
			},
		});
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(simple).toHaveBeenCalledOnce();
		expect(agent).not.toHaveBeenCalled();
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

// Old Simple conversations have no graph and predate the engine marker.
it.each([
	"completed",
	"running",
	"waiting",
])("reloads an unmarked %s Simple session and continues it", async (status) => {
	const home = mkdtempSync(join(tmpdir(), "simple-reload-"));
	const workflow = defaultWorkflows.find((w) => w.id === "simple")!;
	const simple = vi.fn(async () => {});
	const hooks = {
		simple,
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	};
	let runtime = new WorkflowRuntime(home, hooks);
	try {
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Original request",
			triggerOrigin: {
				type: "manual",
				workflowId: "simple",
				at: new Date().toISOString(),
			},
			workflow,
		});
		await runtime.launch(run);
		run.workflow.engineVersion = undefined;
		run.status = status as typeof run.status;
		await runtime.save(run);
		await runtime.shutdown();
		runtime = new WorkflowRuntime(home, hooks);
		const restored = runtime.get(run.id);
		expect(restored.status).toBe(status);
		expect(restored.workflow.engineVersion).toBeUndefined();
		if (status === "completed") runtime.continueSimple(run.id, "Follow up");
		else runtime.resumeAll();
		await waitForRuntime(() => {
			expect(runtime.isExecuting(run.id)).toBe(false);
			expect(restored.status, restored.error).toBe("completed");
		});
		expect(simple).toHaveBeenCalledTimes(2);
		if (status === "completed") expect(restored.simplePrompt).toBe("Follow up");
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("rejects unavailable Simple continuation before changing or persisting run state", async () => {
	const home = mkdtempSync(join(tmpdir(), "simple-unavailable-"));
	const simple = vi.fn(async () => {});
	let runtime = new WorkflowRuntime(home, {
		simple,
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Original",
			triggerOrigin: {
				type: "manual",
				workflowId: "simple",
				at: new Date().toISOString(),
			},
			workflow: defaultWorkflows.find((w) => w.id === "simple")!,
		});
		await runtime.launch(run);
		runtime.setWorkflowEnabled("simple", false);
		expect(() => runtime.continueSimple(run.id, "Follow up")).toThrow(
			"unavailable",
		);
		expect(run.status).toBe("completed");
		expect(run.simplePrompt).toBeUndefined();
		expect(runtime.viewState(run.id).keptOpen).toBeUndefined();
		expect(() => runtime.launch(run)).toThrow("unavailable");
		await runtime.shutdown();
		runtime = new WorkflowRuntime(home, {
			simple,
			agent: async () => ({}),
			script: async () => ({}),
			tool: async () => ({}),
		});
		expect(runtime.get(run.id).status).toBe("completed");
		expect(simple).toHaveBeenCalledOnce();
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
