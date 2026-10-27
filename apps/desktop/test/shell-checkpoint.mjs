import assert from "node:assert/strict";
import { defaultWorkflows } from "../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { nodeDisplay } from "../../f1/test-drives/assets/node-display.mjs";

// Both scripted and packaged shell drives retain a real node-engine human gate.
// Running this shared seed in the controlled drive also checks the native fixture's
// graph before packaging; all provider work is a deterministic checkpoint hook.
export async function shellCheckpoint(
	home,
	workspace,
	{ id, title, sessionId },
) {
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			assert.equal(context.step.id, "prepare", "No other agent permitted");
			context.checkpointAgent?.({ runner: "codex", sessionId, cwd: workspace });
			return { prepared: true, scope: "mock checkpoint only" };
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "fixture",
			name: "Shell checkpoint fixture",
			entry: "prepare",
			steps: [
				{
					id: "prepare",
					name: "Mock completed checkpoint",
					type: "agent",
					runner: "codex",
					prompt: "Mock only",
					next: "review",
				},
				nodeDisplay("review", "Retained human review", undefined),
			],
		},
	]).at(-1);
	const run = runtime.create({
		id,
		title,
		repositoryId: "fixture",
		workspace,
		input: "fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		workflow,
	});
	run.titleGeneration = {
		...run.titleGeneration,
		state: "failed",
		error: "Fixture disables title inference",
	};
	run.setupComplete = true;
	runtime.save(run);
	void runtime.launch(run);
	const deadline = Date.now() + 10_000;
	while (run.status !== "waiting" || !run.viewDecision?.documentDigest) {
		assert.notEqual(run.status, "failed", run.error);
		assert.ok(Date.now() < deadline, "Shell checkpoint seed timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(run.status, "waiting", run.error);
	assert.ok(
		run.viewDecision?.documentDigest,
		"A real Display must await an answer",
	);
	assert.ok(
		JSON.stringify(run).includes(sessionId),
		"Native checkpoint retained",
	);
	return { runtime, run };
}
