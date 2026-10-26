import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { stockWorkflowMetadata } from "../src/factory/stockFactorySteps.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

it("keeps Simple on its original direct conversation path", async () => {
	const home = mkdtempSync(join(tmpdir(), "simple-smoke-"));
	const workflow = defaultWorkflows.find((w) => w.id === "simple")!;
	expect(workflow).toEqual(
		WorkflowSchema.parse({ ...stockWorkflowMetadata.simple, steps: [] }),
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
