// Invoked by DiagnosticsF1.test.ts. Real runtime/reservations/authenticated API;
// deterministic capacity notifications, agent hooks and provider wait. No native/provider I/O.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { acquireDelivery } from "../../src/factory/DeliveryCoordination.ts";
import { defaultWorkflows } from "../../src/factory/defaultWorkflows.ts";
import { timingOperation } from "../../src/factory/RunDiagnostics.ts";
import { validateWorkflows } from "../../src/factory/Workflow.ts";
import { WorkflowRuntime } from "../../src/factory/WorkflowRuntime.ts";
import { FactoryServer } from "../fixtures/authenticated-factory.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const resultFile = process.env.F1_RESULT;
assert.ok(
	resultFile &&
		!relative(resolve(tmpdir()), resolve(resultFile)).startsWith(".."),
);
const directory = mkdtempSync(join(tmpdir(), "f1-task148-"));
const gate = () => {
	let release;
	const promise = new Promise((done) => {
		release = done;
	});
	return { promise, release };
};
const admission = { left: gate(), right: gate() },
	completion = { left: gate(), right: gate(), ci: gate() };
const invoked = [],
	entered = new Set();
let wall = Date.now(),
	mono = 0,
	runtime,
	restarted,
	server;
const clock = { wall: () => wall, mono: () => mono };
const hooks = {
	agentExecutionBoundary: true,
	agent: async (context) => {
		const id = context.step.id;
		invoked.push(context.stepKey);
		context.capacity.onChange({
			phase: "queued",
			identity: `mock-${id}`,
			queuedAt: new Date(wall).toISOString(),
		});
		await context.save();
		await admission[id].promise;
		context.capacity.onChange({ phase: "executing", identity: `mock-${id}` });
		await context.save();
		const release = await context.reserveExecution?.();
		try {
			timingOperation(context.run, context.stepKey, {
				kind: "execution",
				role: true,
			});
			await context.checkpointAgent({
				runner: "codex",
				sessionId: `synthetic-native-${id}`,
			});
			entered.add(id);
			await context.save();
			await completion[id].promise;
			return { observed: id };
		} finally {
			await release?.();
			context.capacity.onChange(undefined);
		}
	},
	script: async () => {
		throw new Error("Unexpected script");
	},
	tool: async (context) => {
		assert.equal(context.step.tool, "ci");
		invoked.push(context.stepKey);
		entered.add("ci");
		await context.save();
		await completion.ci.promise;
		return { passed: true };
	},
};
let observedPhase = 0;
function observe(instance, predicate) {
	const phase = ++observedPhase;
	if (predicate()) return Promise.resolve();
	return new Promise((done, reject) => {
		const timer = setTimeout(() => {
			off();
			reject(
				new Error(
					`Diagnostics F1 phase ${phase} timeout: ${JSON.stringify([...instance.runs.values()].map((r) => ({ status: r.status, error: r.error, step: r.step, leaves: r.capacityLeaves, active: r.diagnostics?.active, events: r.events.slice(-2) })))}`,
				),
			);
		}, 5000);
		const off = instance.subscribe(() => {
			if (predicate()) {
				clearTimeout(timer);
				off();
				done();
			}
		});
		if (predicate()) {
			clearTimeout(timer);
			off();
			done();
		}
	});
}
const definitions = validateWorkflows([
	...defaultWorkflows,
	{
		id: "diagnostic-child",
		name: "Diagnostic child",
		steps: [
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [
					[
						{
							id: "left",
							name: "Left",
							type: "agent",
							prompt: "Scripted left",
							next: "end",
							access: { mode: "read-only" },
						},
					],
					[
						{
							id: "right",
							name: "Right",
							type: "agent",
							prompt: "Scripted right",
							next: "end",
							resources: ["docker"],
							access: { mode: "read-only" },
						},
					],
				],
				next: "end",
			},
		],
	},
	{
		id: "diagnostic-parent",
		name: "Diagnostics",
		steps: [
			{
				id: "nested",
				name: "Nested recipe",
				type: "workflow",
				workflow: "diagnostic-child",
				next: "verify",
			},
			{
				id: "verify",
				name: "Check",
				type: "check",
				check: { results: { observed: { path: "/inputs", exists: true } } },
				next: "provider",
			},
			{
				id: "provider",
				name: "Mock provider CI",
				type: "tool",
				tool: "ci",
				next: "decision",
			},
			{
				id: "decision",
				name: "Exact human decision",
				type: "approve",
				view: {
					version: "view-v1",
					components: [
						{
							id: "brief",
							type: "markdown",
							data: { literal: { text: "Synthetic accepted artifact" } },
						},
					],
				},
				next: "end",
			},
		],
	},
]);
const create = (instance, title) =>
	instance.create({
		title,
		repositoryId: "fixture",
		workspace: directory,
		workflow: definitions.at(-1),
		workflowDefinitions: definitions,
		input: "Synthetic diagnostic fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: "diagnostic-parent",
			at: new Date(wall).toISOString(),
		},
	});
const makeServer = (instance) =>
	new FactoryServer(instance, {
		repositories: () => [{ id: "fixture", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => instance.stop(id),
		start: async () => {
			throw new Error("Unexpected launch");
		},
	});
try {
	runtime = new WorkflowRuntime(directory, hooks, clock);
	runtime.updateWorkflows(definitions);
	const blocker = create(runtime, "Resource owner");
	await acquireDelivery(
		blocker,
		() => runtime.runs.values(),
		new AbortController().signal,
		() => runtime.save(blocker),
		() => {},
		{ key: "held:resources", scopes: ['["resource","docker"]'] },
	);
	const run = create(runtime, "Ten-day-old run, short execution");
	run.createdAt = new Date(wall - 10 * 86400000).toISOString();
	void runtime.launch(run);
	await observe(
		runtime,
		() =>
			Object.values(run.capacityLeaves ?? {}).filter(
				(leaf) => leaf.phase === "queued",
			).length === 2,
	);
	const tick = async (ms) => {
		wall += ms;
		mono += ms;
		await runtime.save(run);
	};
	await tick(1000);
	admission.left.release();
	await observe(runtime, () => entered.has("left"));
	await tick(2000);
	admission.right.release();
	await observe(runtime, () =>
		Object.values(run.diagnostics.active).some(
			(state) => state.kind === "qa-resource",
		),
	);
	await tick(1000);
	completion.left.release();
	await observe(runtime, () => !run.capacityLeaves?.["nested/parallel/0/left"]);
	await tick(1000);
	const resourceWait = JSON.parse(JSON.stringify(run.diagnostics));
	runtime.stop(blocker.id);
	await runtime.flush(blocker.id);
	await observe(runtime, () => entered.has("right"));
	await tick(2000);
	completion.right.release();
	await observe(runtime, () => entered.has("ci"));
	await tick(1000);
	completion.ci.release();
	await observe(runtime, () => run.status === "waiting" && run.viewDecision);
	await tick(2000);
	assert.equal(run.diagnostics.executionMs, 5000);
	assert.equal(run.diagnostics.roleWallMs, 5000);
	assert.equal(run.diagnostics.waitMs, 5000);
	assert.equal(run.diagnostics.waits.capacity, 3000); // Union: both queue for 1s, then right alone for 2s.
	assert.equal(run.diagnostics.waits["qa-resource"], 2000);
	assert.equal(run.diagnostics.waits["provider-ci"], 1000);
	assert.equal(run.diagnostics.waits.human, 2000);
	server = makeServer(runtime);
	const api = await server.app.inject({
		url: `/api/runs/${run.id}/diagnostics?limit=999999`,
	});
	assert.equal(api.statusCode, 200, api.body);
	assert.equal(api.json().limit, 32);
	assert.ok(api.body.length < 32000);
	assert.equal(api.json().recentChecks, 1);
	const original = {
		workflow: JSON.stringify(run.workflow),
		history: JSON.stringify(run.history),
		decision: JSON.stringify(run.viewDecision),
		checkpoint: JSON.stringify(run.checkpoint),
	};
	const counts = {
		...run.diagnostics,
		operations: undefined,
		active: undefined,
	};
	const id = run.id;
	await runtime.shutdown();
	await server.stop();
	server = undefined;
	wall += 86400000;
	mono = 0;
	restarted = new WorkflowRuntime(directory, hooks, clock);
	const restored = restarted.get(id);
	assert.equal(restored.diagnostics.executionMs, counts.executionMs);
	assert.deepEqual(restored.diagnostics.active, {});
	assert.equal(JSON.stringify(restored.workflow), original.workflow);
	assert.equal(JSON.stringify(restored.history), original.history);
	assert.equal(JSON.stringify(restored.viewDecision), original.decision);
	assert.equal(JSON.stringify(restored.checkpoint), original.checkpoint);
	restarted.resumeAll();
	await observe(restarted, () =>
		Object.values(restored.diagnostics.active).some(
			(state) => state.kind === "human",
		),
	);
	assert.deepEqual(invoked, [
		"nested/parallel/0/left",
		"nested/parallel/1/right",
		"provider",
	]);
	server = makeServer(restarted);
	const beforeApproval = await server.app.inject({
		url: `/api/runs/${id}/diagnostics`,
	});
	assert.ok(beforeApproval.json().unobservedMs >= 11 * 86400000);
	const denied = await server.app.inject({
		method: "POST",
		url: `/api/runs/${id}/view-answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			batchId: restored.viewDecision.id,
			digest: "f".repeat(64),
			accepted: true,
			approved: true,
		},
	});
	assert.equal(denied.statusCode, 409);
	const accepted = await server.app.inject({
		method: "POST",
		url: `/api/runs/${id}/view-answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			batchId: restored.viewDecision.id,
			digest: restored.viewDecision.digest,
			accepted: true,
			approved: true,
		},
	});
	assert.equal(accepted.statusCode, 200, accepted.body);
	await observe(restarted, () => restored.status === "completed");
	assert.equal(restored.history.at(-1).output.approved, true);
	assert.equal(restored.diagnostics.executionMs, 5000);
	await restarted.shutdown();
	await server.stop();
	server = undefined;
	writeFileSync(
		resultFile,
		JSON.stringify(
			{
				mode: "mock",
				invoked,
				resourceWait: {
					executionMs: resourceWait.executionMs,
					waitMs: resourceWait.waitMs,
					active: resourceWait.active,
				},
				executionMs: restored.diagnostics.executionMs,
				waitMs: restored.diagnostics.waitMs,
				roleWallMs: restored.diagnostics.roleWallMs,
				waits: restored.diagnostics.waits,
				restartPreserved: true,
				noReplay: true,
				staleHumanDigestRejected: true,
				diagnosticBytes: api.body.length,
				providerCalls: 0,
				nativeCalls: 0,
				inferenceCalls: 0,
			},
			null,
			2,
		),
	);
} finally {
	for (const value of Object.values(admission)) value.release();
	for (const value of Object.values(completion)) value.release();
	await server?.stop();
	await restarted?.shutdown();
	await runtime?.shutdown();
	rmSync(directory, { recursive: true, force: true });
}
