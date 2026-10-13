import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentRunnerConfig,
	executionScope,
	type RunnerType,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	checkOperatorTransport,
	inspectOperatorTransport,
	type OperatorTransport,
} from "../src/factory/OperatorTransport.js";
import {
	capacityRunStatus,
	type FactoryRun,
} from "../src/factory/WorkflowRuntime.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";

const { nativeCall, directCall, nativeList, directList } = vi.hoisted(() => ({
	nativeCall: vi.fn(),
	nativeList: vi.fn(),
	directCall: vi.fn(),
	directList: vi.fn(),
}));
vi.mock("bobs-factory-codex-runner", async (original) => ({
	...(await original<object>()),
	callCodexMcpTool: nativeCall,
	listCodexMcpTools: nativeList,
}));
vi.mock("bobs-factory-mcp-tools", async (original) => ({
	...(await original<object>()),
	callConfiguredTool: directCall,
	listConfiguredTools: directList,
}));

const homes: string[] = [];
const workers: EdgeWorker[] = [];
afterEach(async () => {
	for (const worker of workers.splice(0)) await worker.stop();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function fixture(runner: RunnerType, acceptedRunner?: RunnerType) {
	const home = mkdtempSync(join(tmpdir(), "factory-oauth-"));
	homes.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				repositoryPath: home,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
				linearWorkspaceId: "cli-workspace",
			},
		],
	});
	workers.push(worker);
	const edge = worker as unknown as {
		getFactoryRuntime(): { create(input: Partial<FactoryRun>): FactoryRun };
		runnerSlots: MachineCapacity;
		agentSessionManager: { createChatSession(...args: unknown[]): unknown };
		buildAgentRunnerConfig(): Promise<{
			runnerType: RunnerType;
			config: AgentRunnerConfig;
		}>;
		factoryMcpConfig(run: FactoryRun): Promise<OperatorTransport>;
		factoryTicketAdapter(
			run: FactoryRun,
			signal?: AbortSignal,
		): Promise<{ read(): Promise<unknown> }>;
	};
	const run = edge.getFactoryRuntime().create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
		workspace: home,
		input: "https://taskbot.example/p/fixture/t/77",
		runner: acceptedRunner,
	});
	run.ticketReference = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://taskbot.example",
		project: "fixture",
		id: 77,
		url: run.input,
	};
	edge.agentSessionManager.createChatSession(
		run.id,
		{ path: home, isGitWorktree: false },
		"manual",
		[],
	);
	const config: AgentRunnerConfig = {
		factoryHome: home,
		workingDirectory: home,
		allowedTools: ["mcp__taskbot__get_ticket"],
		mcpConfig: {
			taskbot: { type: "http", url: "https://taskbot.example/mcp" },
		},
	};
	vi.spyOn(edge, "buildAgentRunnerConfig").mockResolvedValue({
		runnerType: runner,
		config,
	});
	return { edge, run, config };
}

it.each([
	"claude",
	"codex",
] as const)("keeps the admitted %s check cancellation signal through transport execution", async (runner) => {
	const f = fixture(runner);
	const resolved = await f.edge.factoryMcpConfig(f.run);
	const controller = new AbortController();
	const used = runner === "codex" ? nativeList : directList;
	await checkOperatorTransport(f.run, resolved, "taskbot", controller.signal);
	expect(used).toHaveBeenCalledOnce();
	expect(used.mock.calls[0]).toContain(controller.signal);
	used.mockClear();
	controller.abort(new Error("check expired during preparation"));
	await expect(
		checkOperatorTransport(f.run, resolved, "taskbot", controller.signal),
	).rejects.toThrow("check expired during preparation");
	expect(used).not.toHaveBeenCalled();
});

it.each([
	["codex", undefined],
	["claude", "codex"],
] as const)("uses native OAuth for %s defaults and %s accepted runs", async (runner, acceptedRunner) => {
	const { edge, run } = fixture(runner, acceptedRunner);
	const ticket = {
		id: 77,
		project: "fixture",
		status: "in_progress",
		comments: [],
		attachments: [],
	};
	nativeCall.mockResolvedValue(ticket);
	directCall.mockRejectedValue(new Error("401 Unauthorized"));
	expect(await (await edge.factoryTicketAdapter(run)).read()).toEqual({
		...ticket,
		url: run.input,
	});
	expect(nativeCall).toHaveBeenCalledWith(
		expect.objectContaining({ workingDirectory: run.workspace }),
		"taskbot",
		{ type: "http", url: "https://taskbot.example/mcp" },
		"get_ticket",
		{ project: "fixture", id: 77 },
		expect.any(AbortSignal),
	);
	expect(directCall).not.toHaveBeenCalled();
});

it("retains direct transport for other runners", async () => {
	const { edge, run } = fixture("claude");
	directCall.mockResolvedValue({
		id: 77,
		status: "backlog",
		comments: [],
		attachments: [],
	});
	await (await edge.factoryTicketAdapter(run)).read();
	expect(directCall).toHaveBeenCalledOnce();
	expect(nativeCall).not.toHaveBeenCalled();
});

it("checks configured tool restrictions before native OAuth calls", async () => {
	const { edge, run, config } = fixture("codex");
	config.disallowedTools = ["mcp__taskbot__get_ticket"];
	await expect((await edge.factoryTicketAdapter(run)).read()).rejects.toThrow(
		"restricted by configured tool permissions",
	);
	expect(nativeCall).not.toHaveBeenCalled();
	expect(directCall).not.toHaveBeenCalled();
});

it.each([
	undefined,
	{ HOME: "/selected/home", SELECTED_ACCOUNT: "fixture" },
])("keeps intensive stdio tool descendants attached to their execution lease with child environment %j", async (childEnvironment) => {
	const { edge, run, config } = fixture("codex");
	config.childEnvironment = childEnvironment;
	config.mcpConfig = {
		taskbot: { command: "fixture-tool", env: { CONFIGURED: "retained" } },
	};
	directCall.mockResolvedValue({ ok: true });
	await executionScope.run({ token: "capacity-test-lease" }, async () => {
		const { callTool } = await edge.factoryMcpConfig(run);
		await callTool("taskbot", "get_ticket", {}, new AbortController().signal);
	});
	expect(directCall).toHaveBeenCalledWith(
		expect.objectContaining({
			env: {
				CONFIGURED: "retained",
				BOBS_FACTORY_EXECUTION_LEASE: "capacity-test-lease",
			},
		}),
		"get_ticket",
		{},
		expect.any(AbortSignal),
		run.workspace,
		childEnvironment,
	);
	expect(nativeCall).not.toHaveBeenCalled();
});

it("operator diagnosis and connectivity share native Codex selection while direct authentication rejects", async () => {
	const codex = fixture("claude", "codex");
	nativeCall.mockResolvedValue({
		id: 77,
		status: "in_progress",
		comments: [],
		attachments: [],
	});
	const resolved = await codex.edge.factoryMcpConfig(codex.run);
	expect(inspectOperatorTransport(codex.run, resolved)).toMatchObject({
		runner: "codex",
		connections: [
			{
				server: "taskbot",
				authentication: "codex_native",
				permissionForTicketRead: true,
			},
		],
	});
	expect(await checkOperatorTransport(codex.run, resolved)).toMatchObject({
		connected: true,
		runner: "codex",
		authentication: "codex_native",
	});
	const direct = fixture("opencode");
	directCall.mockRejectedValue(new Error("401 Unauthorized"));
	await expect(
		checkOperatorTransport(
			direct.run,
			await direct.edge.factoryMcpConfig(direct.run),
		),
	).rejects.toThrow("Unauthorized");
	expect(nativeCall).toHaveBeenCalledOnce();
});
it("operator diagnosis distinguishes missing, ambiguous and denied ticket transports", async () => {
	const f = fixture("codex");
	f.config.mcpConfig = {};
	expect(
		inspectOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run))
			.selection?.error?.code,
	).toBe("missing_transport");
	f.config.mcpConfig = {
		taskbot: { type: "http", url: "https://taskbot.example/mcp" },
		duplicate: { type: "sse", url: "https://taskbot.example/other" },
	};
	expect(
		inspectOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run))
			.selection?.error?.code,
	).toBe("ambiguous_transport");
	delete f.config.mcpConfig.duplicate;
	f.config.disallowedTools = ["mcp__taskbot__*"];
	const resolved = await f.edge.factoryMcpConfig(f.run);
	expect(
		inspectOperatorTransport(f.run, resolved).connections[0]
			?.permissionForTicketRead,
	).toBe(false);
	await expect(checkOperatorTransport(f.run, resolved)).rejects.toThrow(
		"restricted",
	);
	expect(nativeCall).not.toHaveBeenCalled();
});

it.each([
	"codex",
	"opencode",
] as const)("checks other connections on manual runs with the %s transport", async (runner) => {
	const f = fixture(runner);
	f.run.ticketReference = undefined;
	f.run.input = "ordinary manual request";
	f.config.mcpConfig = {
		other: {
			type: "http",
			url: "https://other.example/mcp",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: configuration credential reference
			headers: { Authorization: "${SELECTED_KEY}" },
		},
	};
	f.config.childEnvironment = { SELECTED_KEY: "fixture-secret" };
	const resolved = await f.edge.factoryMcpConfig(f.run);
	expect(await checkOperatorTransport(f.run, resolved, "other")).toMatchObject({
		connected: true,
		operation: "tools/list",
		server: "other",
		runner,
	});
	const used = runner === "codex" ? nativeList : directList;
	expect(used).toHaveBeenCalledOnce();
	expect(JSON.stringify(used.mock.calls)).toContain("fixture-secret");
	expect(runner === "codex" ? directList : nativeList).not.toHaveBeenCalled();
	expect(nativeCall).not.toHaveBeenCalled();
	expect(directCall).not.toHaveBeenCalled();
	await expect(
		checkOperatorTransport(f.run, resolved, "missing"),
	).rejects.toMatchObject({ code: "missing_transport" });
	used.mockRejectedValueOnce(new Error("401 Unauthorized"));
	await expect(checkOperatorTransport(f.run, resolved)).rejects.toThrow(
		"Unauthorized",
	);
	f.config.mcpConfig.duplicate = {
		type: "http",
		url: "https://duplicate.example/mcp",
	};
	await expect(
		checkOperatorTransport(f.run, await f.edge.factoryMcpConfig(f.run)),
	).rejects.toMatchObject({ code: "ambiguous_transport" });
});

// Compress only the transport budget; real coordinator admission and callbacks remain active.
function shortTransportBudget() {
	const timers: ReturnType<typeof setTimeout>[] = [];
	vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
		const controller = new AbortController();
		timers.push(
			setTimeout(() => controller.abort(new Error("transport timed out")), 40),
		);
		return controller.signal;
	});
	return () => timers.forEach(clearTimeout);
}
it.each([
	"codex",
	"claude",
] as const)("does not spend the %s ticket transport budget while queued and exposes the wait", async (runner) => {
	const { edge, run } = fixture(runner);
	await edge.runnerSlots.setLimit(1);
	const blocker = await edge.runnerSlots.acquireLease();
	const clearBudget = shortTransportBudget();
	const used = runner === "codex" ? nativeCall : directCall;
	used.mockImplementation(async (...args) => {
		const signal = args[runner === "codex" ? 5 : 3] as AbortSignal;
		signal.throwIfAborted();
		return { id: 77, status: "backlog", comments: [], attachments: [] };
	});
	try {
		const read = (await edge.factoryTicketAdapter(run)).read();
		// Attach immediately so the pre-fix timeout rejection is captured.
		const settled = read.then(
			(value) => ({ value, error: undefined }),
			(error) => ({ value: undefined, error }),
		);
		await vi.waitFor(async () =>
			expect((await edge.runnerSlots.snapshot()).queued).toBe(1),
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(used).not.toHaveBeenCalled();
		expect((await edge.runnerSlots.snapshot()).queued).toBe(1);
		expect(capacityRunStatus(run)).toBe("capacity-waiting");
		await blocker.release();
		expect((await settled).error).toBeUndefined();
		expect(used).toHaveBeenCalledOnce();
		expect(run.capacityLeaves).toEqual({});
		expect((await edge.runnerSlots.snapshot()).requests).toEqual([]);
	} finally {
		clearBudget();
		await blocker.release();
		await edge.runnerSlots.shutdown();
	}
});
it("canceling ticket setup removes queued transport without executing it", async () => {
	const { edge, run } = fixture("codex");
	await edge.runnerSlots.setLimit(1);
	const blocker = await edge.runnerSlots.acquireLease();
	const controller = new AbortController();
	try {
		const pending = (
			await edge.factoryTicketAdapter(run, controller.signal)
		).read();
		const rejected = expect(pending).rejects.toThrow();
		await vi.waitFor(async () =>
			expect((await edge.runnerSlots.snapshot()).queued).toBe(1),
		);
		controller.abort(new Error("run stopped"));
		await rejected;
		expect(nativeCall).not.toHaveBeenCalled();
		expect(run.capacityLeaves).toEqual({});
		expect((await edge.runnerSlots.snapshot()).queued).toBe(0);
	} finally {
		await blocker.release();
		await edge.runnerSlots.shutdown();
	}
});
it("still bounds admitted ticket transport and releases its capacity on timeout", async () => {
	const { edge, run } = fixture("codex");
	const clearBudget = shortTransportBudget();
	nativeCall.mockImplementation(
		(_config, _name, _server, _tool, _args, signal: AbortSignal) =>
			new Promise((_, reject) => {
				signal.throwIfAborted();
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			}),
	);
	try {
		await expect((await edge.factoryTicketAdapter(run)).read()).rejects.toThrow(
			"transport timed out",
		);
		expect(nativeCall).toHaveBeenCalledOnce();
		expect((await edge.runnerSlots.snapshot()).requests).toEqual([]);
		expect(run.capacityLeaves).toEqual({});
	} finally {
		clearBudget();
		await edge.runnerSlots.shutdown();
	}
});
