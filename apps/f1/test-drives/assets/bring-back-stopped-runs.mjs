// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/bring-back-stopped-runs.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import {
	active,
	attention,
	settleReason,
} from "../../../../packages/edge-worker/dist/factory/RunAttention.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-bring-back-"));
const workspace = join(home, "repo");
mkdirSync(workspace);
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		id: "bring-back-fixture",
		name: "Checkpoint recovery",
		steps: [
			{
				id: "prepare",
				name: "Prepare",
				type: "agent",
				prompt: "Mock preparation",
			},
			{
				id: "finish",
				name: "Finish",
				type: "agent",
				prompt: "Mock completion",
			},
		],
	},
]).at(-1);
const calls = [];
let paused = true;
const hooks = {
	agent: async (ctx) => {
		calls.push(ctx.step.id);
		if (ctx.step.id === "finish") {
			if (paused) {
				await ctx.checkpointAgent?.({
					sessionId: "mock-native-checkpoint",
					runner: "codex",
					cwd: workspace,
				});
				return new Promise((resolve) =>
					ctx.signal.addEventListener("abort", () => resolve({}), {
						once: true,
					}),
				);
			}
			assert.equal(ctx.resumeAgent?.sessionId, "mock-native-checkpoint");
		}
		return { summary: `${ctx.step.id} completed by controlled mock` };
	},
	script: async () => {
		throw Error("No script execution expected");
	},
	tool: async () => {
		throw Error("No external tools expected");
	},
};
let runtime = new WorkflowRuntime(home, hooks);
runtime.updateWorkflows([...defaultWorkflows, workflow], workflow.id);
const run = runtime.create({
	title: "Bring back a stopped run",
	repositoryId: "fixture",
	workspace,
	input: "Controlled recovery",
	workflow,
	triggerOrigin: {
		type: "manual",
		workflowId: workflow.id,
		at: new Date().toISOString(),
	},
});
const until = async (check) => {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.ok(Date.now() < end, "Fixture timeout");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
void runtime.launch(run);
await until(() => calls.length === 2);
runtime.stop(run.id);
await until(() => !runtime.isExecuting(run.id));
const history = structuredClone(run.history);
runtime.updateViewState(run.id, { keptOpen: true });
await runtime.shutdown();
runtime = new WorkflowRuntime(home, hooks);
runtime.resumeAll();
assert.equal(runtime.get(run.id).status, "stopped");
assert.deepEqual(calls, ["prepare", "finish"]);
const server = new FactoryServer(
	runtime,
	{
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {},
		stop: (id) => runtime.stop(id),
	},
	"http://localhost:3600",
);
const request = async (method, url, payload) => {
	const result = await server.app.inject({
		method,
		url,
		payload,
		headers: { "x-factory-request": "1" },
	});
	assert.ok(result.statusCode < 300, result.body);
	return result.json();
};
await request("PUT", `/api/runs/${run.id}/view`, { keptOpen: true });
const list = await request("GET", "/api/runs");
assert.equal(settleReason(list[0], list), undefined);
assert.equal(attention(list[0]), "stuck");
assert.equal(active(list[0].status), false);
const dashboard = await request("GET", `/api/runs/${run.id}?view=dashboard`);
assert.equal(dashboard.resumeAvailable, true);
assert.equal(dashboard.checkpoint, undefined);
assert.deepEqual(
	calls,
	["prepare", "finish"],
	"Bring back must not start work",
);
await request("PUT", `/api/runs/${run.id}/view`, {});
paused = false;
console.log(
	JSON.stringify({
		ready: true,
		home,
		runId: run.id,
		port: 3600,
		calls,
		assertions:
			"stopped survives restart; API bring-back stays visible without execution; dashboard retains resume capability without exposing checkpoint",
	}),
);
const verifyCompletion = () => {
	assert.deepEqual(calls, ["prepare", "finish", "finish"]);
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(runtime.get(run.id).history.slice(0, history.length)),
		),
		JSON.parse(JSON.stringify(history)),
	);
	console.log(
		JSON.stringify({
			completed: true,
			preservedNativeCheckpoint: true,
			completedStepsNotReplayed: true,
			calls,
		}),
	);
};
if (process.argv.includes("--api-only")) {
	await request("POST", `/api/runs/${run.id}/resume`);
	await until(() => runtime.get(run.id).status === "completed");
	verifyCompletion();
	await server.stop();
	await runtime.shutdown();
} else {
	await server.start(3600, "127.0.0.1");
	const watch = setInterval(() => {
		if (runtime.get(run.id).status !== "completed") return;
		clearInterval(watch);
		verifyCompletion();
	}, 100);
	process.on("SIGTERM", async () => {
		clearInterval(watch);
		await server.stop();
		await runtime.shutdown();
		process.exit(0);
	});
}
