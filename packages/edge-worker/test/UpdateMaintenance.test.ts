import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

import { OperatorGrants } from "../src/factory/OperatorGrants.js";
import { OperatorServer } from "../src/factory/OperatorServer.js";
import { OperatorService } from "../src/factory/OperatorService.js";

import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

import { UpdateDrain } from "../src/updates/UpdateDrain.js";
import { UpdateManager } from "../src/updates/UpdateManager.js";
import { UpdatePausedError } from "../src/updates/UpdatePausedError.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
function setup(_tool: RuntimeHooks["tool"] = async () => ({})) {
	const home = mkdtempSync(join(tmpdir(), "update-maintenance-regression-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			if (context.step.prompt === "fixture-script")
				return (async () => ({}))(context);
			return (async () => ({}))(context);
		},
	});
	const run = runtime.create({
		id: "waiting",
		title: "Waiting",
		repositoryId: "fixture",
		workspace: home,
		input: "fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: "fixture",
			at: new Date().toISOString(),
		},
		workflow: WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "fixture",
			name: "Fixture",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "pause",
					name: "Pause",
					type: "agent",
					prompt: "fixture",
					next: "end",
				},
			],
		}),
	});
	run.status = "waiting";
	run.viewDecision = {
		id: "preserved-batch",
		kind: "display",
		digest: "preserved",
		view: { version: "view-v1", components: [] },
	} as any;
	runtime.save(run);
	const manager = new UpdateManager(home);
	manager.configure({}, 0);
	const candidate = {
		version: "1.1.0",
		channel: "stable",
		commit: "b".repeat(40),
		manifestSha256: "c".repeat(64),
		target: "darwin-arm64",
		publishedAt: "2026-10-10T16:00:00.000Z",
	};
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction = {
		id: "exact-transaction",
		candidate,
		staged: {
			candidate,
			executable: "/fixture/new",
			previousExecutable: "/fixture/old",
		},
		previous: {
			version: "1.0.0",
			commit: "a".repeat(40),
			target: "darwin-arm64",
		},
		revision: 1,
		phase: "snapshot",
		switchStarted: false,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(manager.file, JSON.stringify(state));
	const capacity = {
		pauseAdmissionsForUpdate: vi.fn(async () => ({ active: 0, stopping: 0 })),
		resumeAdmissionsAfterUpdate: vi.fn(async () => {}),
	};
	const resume = vi.fn();
	const drain = new UpdateDrain(
		home,
		runtime,
		capacity as any,
		() => runtime.hasExecutingWork(),
		resume,
	);
	const finish = () => {
		const state = JSON.parse(readFileSync(manager.file, "utf8"));
		state.transaction.phase = "succeeded";
		state.transaction.release = {
			transactionId: "exact-transaction",
			outcome: "succeeded",
			status: "pending",
		};
		writeFileSync(manager.file, JSON.stringify(state));
	};
	cleanups.push(async () => {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	return { home, runtime, run, drain, capacity, resume, finish };
}

function operator(
	fixture: ReturnType<typeof setup>,
	update = vi.fn(async () => ({ applied: true })),
) {
	const grants = new OperatorGrants(fixture.home);
	const issued = grants.issue("Regression", [
		"inspect",
		"operate",
		"configure",
	]);
	const client = JSON.parse(readFileSync(issued.credentialFile, "utf8"));
	const service = new OperatorService(
		fixture.runtime,
		{ stop: (id) => fixture.runtime.stop(id), update },
		issued.instance,
		fixture.drain,
	);
	const server = new OperatorServer(grants, service);
	cleanups.unshift(async () => {
		await server.stop();
	});
	const call = (name: string, args: unknown) =>
		server.app.inject({
			method: "POST",
			url: "/call",
			headers: {
				authorization: `Bearer ${client.token}`,
				"x-factory-instance": issued.instance,
				"x-factory-grant": issued.id,
			},
			payload: { name, arguments: args },
		});
	return { call, service };
}
function integrationWorker(home: string) {
	const worker = new EdgeWorker({
		issueTrackerFactory: createCLIIssueTracker,
		factoryHome: home,
		repositories: [],
		handlers: {
			createAgentRunner: () => {
				throw new Error("No native agent permitted");
			},
		},
	});
	const edge = worker as any;
	cleanups.unshift(async () => {
		await edge.runnerSlots.ready();
		await edge.stateSaveQueue;
		await edge.runnerSlots.shutdown();
	});
	return edge;
}
it("preserves the update receipt across bundled workflow changes and a runtime reload", async () => {
	const f = setup();
	await f.runtime.shutdown();
	const before = f.drain.receipt();
	const bundled = defaultWorkflows.find(
		(workflow) => workflow.id === "factory",
	)!;
	const original = bundled.description;
	let restored: WorkflowRuntime | undefined;
	try {
		bundled.description = `${original} Updated bundled behavior.`;
		restored = new WorkflowRuntime(f.home, {
			agent: async () => {
				throw new Error("No agent permitted");
			},
		});
		expect(restored.listWorkflows()).not.toEqual(f.runtime.listWorkflows());
		const drain = new UpdateDrain(
			f.home,
			restored,
			f.capacity as any,
			() => false,
			() => {},
		);
		expect(drain.receipt()).toEqual(before);
	} finally {
		bundled.description = original;
		await restored?.shutdown();
	}
});

it.each([
	"preferences",
	"availability",
	"local workflow",
	"frozen run",
])("rejects changed %s in update preservation receipts", async (change) => {
	const f = setup();
	const before = f.drain.receipt();
	if (change === "preferences")
		f.runtime.updatePreferences("simple", {
			native: { runner: "codex", model: "fixture" },
		});
	else if (change === "availability")
		f.runtime.setWorkflowEnabled("simple", false);
	else if (change === "local workflow")
		f.runtime.forkWorkflow("factory", "Local recipe");
	else f.run.workflow.name = "Changed accepted recipe";
	expect(f.drain.receipt().preservedStateSha256).not.toBe(
		before.preservedStateSha256,
	);
});
it("preserves token-free integration input across restart and dispatches it once after release", async () => {
	const f = setup();
	const edge = integrationWorker(f.home);
	const event = {
		deliveryId: "paused-before-session",
		payload: { task: "Retained input" },
		installationToken: "not-persisted",
	};
	await edge.retainIntegrationEvent("github", event);
	const state = await edge.persistenceManager.loadEdgeWorkerState();
	expect(Object.values(state.pendingIntegrationEvents)).toEqual([
		{
			platform: "github",
			event: { deliveryId: event.deliveryId, payload: event.payload },
		},
	]);
	const restored = integrationWorker(f.home);
	restored.restoreMappings(state);
	restored.updateDrain = f.drain;
	let finish!: () => void;
	const hold = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const dispatch = vi
		.spyOn(restored, "handleGitHubWebhook")
		.mockImplementation(async () => {
			await hold;
		});
	await f.drain.begin("exact-transaction");
	restored.recoverIntegrationEvents();
	expect(dispatch).not.toHaveBeenCalled();
	f.resume.mockImplementation(() => restored.recoverIntegrationEvents());
	f.finish();
	await f.drain.end("exact-transaction");
	restored.recoverIntegrationEvents();
	expect(dispatch).toHaveBeenCalledTimes(1);
	expect(dispatch).toHaveBeenCalledWith({
		deliveryId: event.deliveryId,
		payload: event.payload,
	});
	finish();
	await vi.waitFor(() =>
		expect(restored.pendingIntegrationEvents.size).toBe(0),
	);
	await restored.stateSaveQueue;
	expect(
		(await restored.persistenceManager.loadEdgeWorkerState())
			.pendingIntegrationEvents,
	).toBeUndefined();
});
it("does not replay deferred input already checkpointed by a native session", async () => {
	const f = setup();
	const edge = integrationWorker(f.home);
	const event = {
		deliveryId: "checkpointed",
		payload: { task: "Already accepted" },
	};
	await edge.retainIntegrationEvent("github", event);
	const session = edge.agentSessionManager.createChatSession(
		"saved-native",
		{ path: f.home, isGitWorktree: false },
		"github",
		[],
	);
	session.metadata = {
		pendingExecution: {
			runner: "codex",
			prompt: "Saved input",
			systemPrompt: "Saved instructions",
			replyEvent: event,
		},
	};
	const dispatch = vi.spyOn(edge, "handleGitHubWebhook");
	edge.recoverIntegrationEvents();
	await vi.waitFor(() => expect(edge.pendingIntegrationEvents.size).toBe(0));
	expect(dispatch).not.toHaveBeenCalled();
});
it.each([
	"createGitHubWorkspace",
	"createGitLabWorkspace",
])("%s preserves update suspension instead of turning it into workspace failure", async (method) => {
	const f = setup();
	const edge = integrationWorker(f.home);
	const paused = new UpdatePausedError();
	vi.spyOn(edge.gitService, "createGitWorktree").mockRejectedValue(paused);
	await expect(edge[method]({ id: "fixture" }, "main", 1)).rejects.toBe(paused);
});
it("rejects all new operator mutations during maintenance while authenticated inspection remains available", async () => {
	const f = setup(),
		{ call, service } = operator(f);
	await f.drain.begin("exact-transaction");
	const before = JSON.stringify(f.run),
		receipt = f.drain.receipt();
	for (const name of [
		"stop_run",
		"resume_run",
		"retry_run",
		"steer_run",
		"retry_ticket_sync",
		"update_mcp_connection",
		"check_mcp_connection",
		"inspect_mcp_connections",
	]) {
		const response = await call(name, {
			runId: f.run.id,
			expectedRevision: service.revision(f.run),
		});
		expect(response.json()).toMatchObject({
			ok: false,
			error: { code: "update_maintenance" },
		});
	}
	expect((await call("inspect_run", { runId: f.run.id })).json()).toMatchObject(
		{ ok: true, result: { status: "waiting" } },
	);
	expect(JSON.stringify(f.run)).toBe(before);
	expect(f.drain.receipt()).toEqual(receipt);
	expect((await f.drain.inspect()).idle).toBe(true);
});
it.each([
	"inspect_run",
	"inspect_mcp_connections",
	"check_mcp_connection",
])("counts admitted %s through awaited preparation and refuses live inspection after freeze", async (name) => {
	const f = setup(),
		{ call, service } = operator(f);
	let done!: () => void;
	const hold = new Promise<void>((resolve) => {
		done = resolve;
	});
	const preparation = vi.fn(async () => {
		await hold;
		return { connected: true };
	});
	service.hooks.mcp = preparation;
	service.hooks.check = preparation;
	const accepted = call(name, {
		runId: f.run.id,
		...(name === "check_mcp_connection" ? { server: "fixture" } : {}),
	});
	await vi.waitFor(() => expect(preparation).toHaveBeenCalledTimes(1));
	await f.drain.begin("exact-transaction");
	expect((await f.drain.inspect()).idle).toBe(false);
	expect(f.capacity.pauseAdmissionsForUpdate).toHaveBeenCalledWith(
		"exact-transaction",
	);
	const stored = (await call("inspect_run", { runId: f.run.id })).json();
	expect(stored).toMatchObject({
		ok: true,
		result: {
			status: "waiting",
			mcp: { error: { code: "update_maintenance" } },
		},
	});
	for (const tool of ["check_mcp_connection", "inspect_mcp_connections"])
		expect((await call(tool, { runId: f.run.id })).json()).toMatchObject({
			ok: false,
			error: { code: "update_maintenance" },
		});
	expect(preparation).toHaveBeenCalledTimes(1);
	done();
	expect((await accepted).json().ok).toBe(true);
	expect((await f.drain.inspect()).idle).toBe(true);
});
it("drains an authenticated configuration operation admitted before freeze through its final awaited mutation", async () => {
	const f = setup();
	let done!: () => void;
	const hold = new Promise<void>((resolve) => {
		done = resolve;
	});
	const update = vi.fn(async () => {
		await hold;
		writeFileSync(join(f.home, "config.json"), '{"applied":true}');
		return { applied: true };
	});
	const { call } = operator(f, update);
	const accepted = call("update_mcp_connection", {
		runId: f.run.id,
		server: "fixture",
		expectedConfigRevision: "a".repeat(64),
		connection: { type: "http", url: "https://example.test/mcp" },
		permissions: ["inspect"],
	});
	await vi.waitFor(() => expect(update).toHaveBeenCalled());
	await f.drain.begin("exact-transaction");
	expect((await f.drain.inspect()).idle).toBe(false);
	expect(f.capacity.pauseAdmissionsForUpdate).toHaveBeenCalledWith(
		"exact-transaction",
	);
	const before = f.drain.receipt();
	done();
	expect((await accepted).json().ok).toBe(true);
	expect((await f.drain.inspect()).idle).toBe(true);
	expect(f.drain.receipt().preservedStateSha256).not.toBe(
		before.preservedStateSha256,
	);
});
it("fences reboot dispatch and preflight, then resumes pending receipts only after exact successful release", async () => {
	const f = setup();
	const worker = new EdgeWorker({
		issueTrackerFactory: createCLIIssueTracker,
		factoryHome: f.home,
		repositories: [],
		handlers: {
			createAgentRunner: () => {
				throw new Error("No native agent permitted");
			},
		},
	});
	const edge = worker as any;
	edge.updateDrain = f.drain;
	const admission = edge.getLaunchAdmission();
	const result = admission.reserve(
		{
			issueKey: "fixture-issue",
			sessionId: "pending",
			webhook: {
				organizationId: "fixture",
				agentSession: { id: "pending", issue: { id: "issue" } },
			},
			origin: {
				type: "ticket-assignment",
				workflowId: "simple",
				at: new Date().toISOString(),
				ticket: { provider: "cli", workspaceId: "fixture", issueId: "issue" },
			},
		},
		() => false,
	);
	const preflight = vi
		.spyOn(edge, "preflightTicketLaunch")
		.mockResolvedValue(undefined);
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockImplementation(async () => {
			admission.update(result.receipt, { phase: "settled" });
		});
	vi.spyOn(edge, "recoverFactoryRuns").mockImplementation(() => {});
	cleanups.unshift(async () => {
		await edge.runnerSlots.ready();
		await edge.factoryRuntime?.shutdown();
		await edge.stateSaveQueue;
		edge.ticketTracking?.stop();
		await edge.runnerSlots.shutdown();
	});
	await f.drain.begin("exact-transaction");
	const before = readFileSync(
		join(f.home, "factory", "ticket-deliveries.json"),
		"utf8",
	);
	edge.recoverPendingTicketLaunches();
	await edge.startAcceptedTicketLaunch(result.receipt, []);
	expect(preflight).not.toHaveBeenCalled();
	expect(route).not.toHaveBeenCalled();
	expect(
		readFileSync(join(f.home, "factory", "ticket-deliveries.json"), "utf8"),
	).toBe(before);
	await expect(f.drain.end("wrong-transaction")).rejects.toThrow("mismatch");
	expect(f.resume).not.toHaveBeenCalled();
	f.finish();
	f.resume.mockImplementation(() => edge.recoverAfterUpdate());
	await f.drain.end("exact-transaction");
	await vi.waitFor(() => expect(route).toHaveBeenCalledTimes(1));
	expect(preflight).toHaveBeenCalledTimes(1);
	expect(f.resume).toHaveBeenCalledTimes(1);
	await f.drain.end("exact-transaction");
	expect(f.resume).toHaveBeenCalledTimes(1);
});
it("includes accepted ticket preflight and its final persistence in the drain barrier", async () => {
	const f = setup();
	const edge = Object.assign(Object.create(EdgeWorker.prototype), {
		updateDrain: f.drain,
		inFlightTicketStarts: new Set(),
		pendingTriggerOrigins: new Map(),
		savePersistedState: vi.fn(async () => {}),
	});
	let done!: () => void;
	const hold = new Promise<void>((resolve) => {
		done = resolve;
	});
	edge.preflightTicketLaunch = vi.fn(async () => {
		await hold;
	});
	edge.getLaunchAdmission = () => ({ get: () => ({ phase: "pending" }) });
	edge.routeAcceptedTicketLaunch = vi.fn(async () => {});
	const accepted = edge.startAcceptedTicketLaunch(
		{
			key: "receipt",
			sessionId: "pending",
			phase: "pending",
			origin: {},
			webhook: { organizationId: "fixture" },
		},
		[],
	);
	await f.drain.begin("exact-transaction");
	expect((await f.drain.inspect()).idle).toBe(false);
	done();
	await accepted;
	expect(edge.routeAcceptedTicketLaunch).toHaveBeenCalledTimes(1);
	expect((await f.drain.inspect()).idle).toBe(true);
});
