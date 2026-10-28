// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireInstanceLock,
	workerOwner,
} from "../../../../apps/cli/src/services/InstanceLock.ts";
import { JsonSnapshotStore } from "../../../../packages/core/dist/JsonSnapshotStore.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { preflightFactoryState } from "../../../../packages/edge-worker/dist/lifecycle/PreflightState.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";

import { displayAnswer, nodeDisplay } from "./node-display.mjs";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-desktop-lifecycle-"));
const workspace = join(home, "repo");
mkdirSync(workspace);
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		engineVersion: "nodes-v1",
		id: "lifecycle-fixture",
		name: "Lifecycle fixture",
		entry: "prepare",
		steps: [
			{
				id: "prepare",
				name: "Mock preparation",
				type: "agent",
				prompt: "Mock fixture",
				next: "clarify",
			},
			nodeDisplay("clarify", "Which color?", "finish"),
			{
				id: "finish",
				name: "Mock completion",
				type: "agent",
				prompt: "fixture-finish",
			},
		],
	},
]).at(-1);
let calls = 0,
	finishes = 0;
const hooks = {
	agent: async (ctx) => {
		calls++;
		if (ctx.step.id === "prepare") {
			ctx.checkpointAgent?.({
				sessionId: "mock-native-conversation-1",
				runner: "codex",
				cwd: workspace,
			});
			return { prepared: true };
		}
		finishes++;
		return { done: true };
	},
};
let release = await acquireInstanceLock(home),
	runtime = new WorkflowRuntime(home, hooks),
	server;
const run = runtime.create({
	triggerOrigin: {
		type: "manual",
		workflowId: workflow.id,
		at: new Date().toISOString(),
	},
	title: "Lifecycle recovery",
	repositoryId: "fixture",
	workspace,
	input: "Mock lifecycle",
	workflow,
});
void runtime.launch(run);
const until = async (check) => {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.notEqual(
			runtime.get(run.id).status,
			"failed",
			runtime.get(run.id).error,
		);
		assert.ok(Date.now() < end, "Fixture wait timeout");
		await new Promise((r) => setTimeout(r, 10));
	}
};
const durable = (key, value) => {
	const copy = JSON.parse(JSON.stringify(value));
	// A resumed node receives a new execution attempt; its retained inputs and
	// native conversation/checkpoint are the state that must survive unchanged.
	if (key === "checkpoint" && copy.active) delete copy.active.attemptId;
	return copy;
};
try {
	await until(
		() =>
			runtime.get(run.id).status === "waiting" &&
			runtime.get(run.id).viewDecision,
	);
	const before = runtime.get(run.id);
	const captured = {
		id: before.id,
		viewDecision: JSON.parse(JSON.stringify(before.viewDecision)),
		outputs: JSON.parse(JSON.stringify(before.outputs)),
		history: JSON.parse(JSON.stringify(before.history)),
		checkpoint: durable("checkpoint", before.checkpoint),
	};
	await assert.rejects(acquireInstanceLock(home), /already owned/);
	assert.equal(workerOwner(home).pid, process.pid);
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {},
		stop: (id) => runtime.stop(id),
	});
	let result = await server.app.inject({
		method: "GET",
		url: `/api/runs/${run.id}`,
	});
	assert.equal(result.statusCode, 200);
	assert.equal(result.json().status, "waiting");
	// Closing a UI connection does not own runtime shutdown or alter the wait.
	assert.equal(runtime.get(run.id).status, "waiting");
	await server.stop();
	await runtime.shutdown();
	const evidence = join(home, "factory/evidence", run.id);
	mkdirSync(evidence, { recursive: true });
	writeFileSync(join(evidence, "result.txt"), "retained mocked result");
	const linkedTool = join(evidence, "expired-tool"),
		target = join(home, "expired-external-tool");
	symlinkSync(target, linkedTool);
	// The v2 supervisor's validate-state probe reads the home without running work.
	assert.deepEqual(preflightFactoryState(home).runIds, [run.id]);
	assert.equal(calls, 1, "state validation must never execute workflow work");
	release();
	release = await acquireInstanceLock(home);
	runtime = new WorkflowRuntime(home, hooks);
	runtime.resumeAll();
	await until(() => runtime.get(run.id).status === "waiting");
	for (const [key, value] of Object.entries(captured))
		assert.deepEqual(durable(key, runtime.get(run.id)[key]), value);
	assert.equal(calls, 1, "completed preparation must not rerun");
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {},
		stop: (id) => runtime.stop(id),
	});
	result = await server.app.inject({
		method: "GET",
		url: `/api/runs/${run.id}`,
	});
	assert.equal(result.statusCode, 200);
	assert.equal(
		result.json().viewDecision.documentDigest,
		captured.viewDecision.documentDigest,
	);
	await runtime.answerView(run.id, displayAnswer(runtime.get(run.id), "Blue"));
	await until(() => runtime.get(run.id).status === "completed");
	assert.equal(finishes, 1);
	await runtime.flush(run.id);
	const persisted = new JsonSnapshotStore(
		join(home, "factory", "run-chunks"),
	).load(join(home, "factory", "runs", `${run.id}.json`)).value;
	assert.equal(persisted.id, run.id);
	assert.ok(persisted.events.length > 0);
	console.log(
		JSON.stringify(
			{
				passed: true,
				home,
				mode: "mock/scripted",
				assertions: [
					"one-home ownership",
					"client disconnect leaves human wait",
					"graceful stop/reopen same run/native checkpoint",
					"question/gates/outputs/history preserved",
					"linked evidence omitted from isolated preflight and retained verbatim for rollback",
					"accepted answer completes once",
					"authenticated activity/detail retained",
				],
				calls,
				finishes,
			},
			null,
			2,
		),
	);
} finally {
	await server?.stop();
	await runtime.shutdown();
	release();
}
