// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/ticket-backlog-recovery.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { WorkflowSchema } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-ticket-backlog-recovery-"));
execFileSync("git", ["init", "-q", home]);
const config = {
	issueTrackerFactory: createCLIIssueTracker,
	factoryHome: home,
	handlers: f1AgentHandlers("mock"),
	repositories: [
		{
			id: "repo",
			name: "Recovery fixture",
			repositoryPath: home,
			workspaceBaseDir: home,
			baseBranch: "main",
			isActive: true,
			linearWorkspaceId: "cli-workspace",
		},
	],
};
const workflow = WorkflowSchema.parse({
	id: "recovery-fixture",
	name: "Recovery fixture",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "before",
			name: "Already completed",
			type: "script",
			script: "exit 99",
		},
		{
			id: "after",
			name: "Resume saved work",
			type: "script",
			script: "printf recovered",
		},
	],
});
let worker = new EdgeWorker(config);
let runtime = worker.getFactoryRuntime();
const run = runtime.create({
	id: "saved-run",
	repositoryId: "repo",
	workspace: home,
	workflow,
	triggerOrigin: {
		type: "manual",
		workflowId: workflow.id,
		at: new Date().toISOString(),
	},
});
run.status = "running";
run.checkpoint = {
	current: "after",
	visits: { before: 1 },
	agentSessions: {
		before: { runner: "codex", sessionId: "retained-native-session" },
	},
};
run.outputs = { before: { retained: true }, ticket: { id: "ticket" } };
run.history = [
	{ step: "before", output: { retained: true }, at: new Date().toISOString() },
];
run.ticketReference = {
	provider: "native",
	platform: "linear",
	workspaceId: "cli-workspace",
	id: "ticket",
	url: "https://linear.example/issue/fixture",
};
run.ticketSync = {
	receipts: [{ key: "old-progress", body: "Retained delivery" }],
};
await runtime.save(run);
await runtime.shutdown();
await worker.runnerSlots.shutdown();

worker = new EdgeWorker(config);
runtime = worker.getFactoryRuntime();
let rejectDelivery;
let flushStarted = false;
const delivery = new Promise((_, reject) => {
	rejectDelivery = reject;
});
// A controlled external delivery boundary; preparation and recovery are production paths.
worker.getTicketTracking = () => ({
	flush: () => {
		flushStarted = true;
		return delivery;
	},
	record: async () => {},
});
try {
	runtime.resumeAll();
	const deadline = Date.now() + 3000;
	while (runtime.get(run.id).status !== "completed") {
		assert.notEqual(
			runtime.get(run.id).status,
			"failed",
			runtime.get(run.id).error,
		);
		assert.ok(
			Date.now() < deadline,
			"Saved work blocked behind pending ticket delivery",
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.ok(flushStarted);
	const recovered = runtime.get(run.id);
	assert.deepEqual(recovered.outputs.before, { retained: true });
	assert.equal(
		recovered.checkpoint.agentSessions.before.sessionId,
		"retained-native-session",
	);
	assert.deepEqual(
		recovered.history.map((entry) => entry.step),
		["before", "after"],
	);
	assert.equal(recovered.ticketSync.receipts[0].delivered, undefined);
	rejectDelivery(new Error("Controlled tracker unavailable"));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(recovered.status, "completed");
	assert.ok(
		recovered.events.some((event) =>
			event.message.includes("Controlled tracker unavailable"),
		),
	);
	console.log(
		"PASS: restarted saved work completes while ticket delivery stays pending; checkpoints, native ID and receipts survive; background rejection is reported.",
	);
} finally {
	// Let the unpatched reproduction terminate too, without an unhandled rejection.
	rejectDelivery(new Error("Controlled tracker unavailable"));
	await runtime.shutdown();
	await worker.runnerSlots.shutdown();
	rmSync(home, { recursive: true, force: true });
}
