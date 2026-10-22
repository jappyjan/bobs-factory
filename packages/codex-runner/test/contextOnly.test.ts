import { EventEmitter } from "node:events";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerCodexBackend } from "../src/backend/AppServerCodexBackend.js";
import type {
	AppServerClientOptions,
	IAppServerClient,
	NotificationHandler,
	ServerRequestHandler,
} from "../src/backend/appServerClient.js";
import { AppServerClient } from "../src/backend/appServerClient.js";
import { AppServerProcessManager } from "../src/backend/appServerProcess.js";
import { buildCodexThreadConfig } from "../src/backend/threadConfig.js";
import type { CodexBackend } from "../src/backend/types.js";
import { CodexRunner } from "../src/CodexRunner.js";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";
import { CONTEXT_ONLY_PROFILE } from "../src/config/contextOnly.js";
import type { CodexRunnerConfig } from "../src/types.js";

class FakeClient extends EventEmitter implements IAppServerClient {
	notification: NotificationHandler = () => {};
	serverRequest: ServerRequestHandler = () => ({});
	requests: { method: string; params: unknown }[] = [];
	closed = false;
	constructor(
		private nativeConfig: unknown,
		private tools = ["list_context", "read_context"],
		private extraServer = false,
	) {
		super();
	}
	setNotificationHandler(handler: NotificationHandler) {
		this.notification = handler;
	}
	setServerRequestHandler(handler: ServerRequestHandler) {
		this.serverRequest = handler;
	}
	start() {}
	async close() {
		this.closed = true;
	}
	async request<T>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });
		let result: unknown = {};
		if (method === "config/read") result = { config: this.nativeConfig };
		if (method === "thread/start" || method === "thread/resume")
			result = { thread: { id: "native-ask-thread" } };
		if (method === "mcpServerStatus/list")
			result = {
				data: [
					{
						name: "factory-context",
						runtimeStatus: "connected",
						tools: Object.fromEntries(
							this.tools.map((name) => [name, { name }]),
						),
					},
					...(this.extraServer
						? [
								{
									name: "danger",
									runtimeStatus: "connected",
									tools: { shell: { name: "shell" } },
								},
							]
						: []),
				],
			};
		if (method === "turn/start") {
			queueMicrotask(() => {
				this.notification("turn/started", {
					threadId: "native-ask-thread",
					turn: { id: "turn-1" },
				});
				this.notification("item/completed", {
					threadId: "native-ask-thread",
					item: {
						type: "agentMessage",
						id: "answer",
						text: "The displayed item needs a test.",
					},
				});
				this.notification("turn/completed", {
					threadId: "native-ask-thread",
					turn: { id: "turn-1", status: "completed" },
				});
			});
			result = { turn: { id: "turn-1" } };
		}
		return result as T;
	}
}

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function config(resume = false): CodexRunnerConfig {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-context-test-")));
	roots.push(root);
	const cwd = join(root, "empty");
	mkdirSync(cwd, { mode: 0o700 });
	return {
		toolProfile: "context-only",
		factoryHome: root,
		workingDirectory: cwd,
		codexHome: join(root, "auth"),
		codexPath: "/bin/true",
		model: "accepted-model",
		modelReasoningEffort: "high",
		serviceTier: "fast",
		fallbackModel: "different-model",
		...(resume ? { resumeSessionId: "native-ask-thread" } : {}),
		appendSystemPrompt: "Answer only from the supplied item context.",
		childEnvironment: {
			HOME: root,
			PATH: "/usr/bin:/bin",
			OPENAI_API_KEY: "fake-only-never-sent",
		},
		allowedTools: ["Bash", "mcp__danger", "mcp__factory-context"],
		skills: "all",
		plugins: [{ type: "local", path: root }],
		sandbox: "danger-full-access",
		askForApproval: "on-request",
		includeWebSearch: true,
		allowedDirectories: ["/"],
		additionalDirectories: ["/"],
		sandboxSettings: { allowRead: ["/"], allowWrite: ["/"] },
		runnerSettings: {
			features: { shell_tool: true, multi_agent: true },
			notify: ["danger"],
			mcp_servers: { danger: { command: "danger" } },
		},
		configOverrides: {
			features: { shell_tool: true, apps: true },
			sandbox_workspace_write: { network_access: true },
			model: "different-model",
		},
		mcpConfigPath: "/does-not-exist/unsafe.json",
		codexDisabledMcp: ["native-user", "native-system"],
		mcpConfig: {
			"factory-context": {
				command: "context-fixture",
				args: ["read-only"],
				enabled_tools: ["write_file"],
				tools: { write_file: { enabled: true } },
			},
			danger: { command: "danger" },
		},
	};
}

describe("enforced context-only Codex assistance", () => {
	it.each([
		false,
		true,
	])("uses the production runner, native start/resume and tool handshake without inherited powers (resume=%s)", async (resume) => {
		const input = config(resume);
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const expected = await new CodexConfigBuilder(input).build();
		const native = {
			...buildCodexThreadConfig(expected),
			default_permissions: CONTEXT_ONLY_PROFILE,
		};
		// Native config/read expands table-backed feature booleans and optional fields.
		const nativeRead = structuredClone(native);
		(nativeRead.features as Record<string, unknown>).code_mode_host = {
			enabled: false,
			path: null,
		};
		(nativeRead.permissions as Record<string, Record<string, unknown>>)[
			CONTEXT_ONLY_PROFILE
		]!.extends = null;
		const client = new FakeClient(nativeRead);
		const launches: AppServerClientOptions[] = [];
		const manager = new AppServerProcessManager(
			(options) => {
				launches.push(options);
				return client;
			},
			{ idleCloseMs: 0 },
		);
		const runner = new CodexRunner(input);
		vi.spyOn(
			runner as unknown as { createBackend(): CodexBackend },
			"createBackend",
		).mockReturnValue(new AppServerCodexBackend(manager));
		const session = await runner.start(
			"Why does this displayed item need a test?",
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(session.sessionId).toBe("native-ask-thread");
		expect(
			runner.getMessages().some((message) => message.type === "assistant"),
		).toBe(true);
		expect(client.requests.map((request) => request.method)).toEqual([
			"initialize",
			"config/read",
			resume ? "thread/resume" : "thread/start",
			"mcpServerStatus/list",
			"turn/start",
		]);
		const thread = client.requests[2]?.params as Record<string, unknown>;
		expect(thread).toEqual({
			...(resume ? { threadId: "native-ask-thread" } : {}),
			...(!resume ? { allowProviderModelFallback: false } : {}),
			approvalsReviewer: "user",
			cwd: input.workingDirectory,
			approvalPolicy: "never",
			permissions: CONTEXT_ONLY_PROFILE,
			model: "accepted-model",
			developerInstructions: input.appendSystemPrompt,
			config: buildCodexThreadConfig(expected),
		});
		expect(expected.sandbox).toEqual({
			kind: "profile",
			profileId: CONTEXT_ONLY_PROFILE,
			filesystem: {
				":root": "deny",
				":minimal": "read",
				":workspace_roots": "deny",
				":tmpdir": "deny",
				":slash_tmp": "deny",
				[input.workingDirectory!]: "read",
			},
			networkAccess: false,
		});
		expect(native.mcp_servers).toEqual({
			"native-user": { enabled: false },
			"native-system": { enabled: false },
			"factory-context": {
				command: "context-fixture",
				args: ["read-only"],
				enabled: true,
				required: true,
				enabled_tools: ["list_context", "read_context"],
				default_tools_approval_mode: "approve",
			},
		});
		expect(native.model_reasoning_effort).toBe("high");
		expect(native.service_tier).toBe("fast");
		expect(launches[0]?.cwd).toBe(input.workingDirectory);
		expect(launches[0]?.env?.CODEX_HOME).toBe(input.codexHome);
		expect(launches[0]?.args).toContain(
			'default_permissions="bobs-factory-context-only"',
		);
		expect(launches[0]?.args).toContain('web_search="disabled"');
		expect(
			launches[0]?.args?.some(
				(arg) =>
					arg.startsWith("features=") &&
					arg.includes('"shell_tool" = false') &&
					arg.includes('"hooks" = false') &&
					arg.includes('"code_mode_host" = false'),
			),
		).toBe(true);
		expect(client.closed).toBe(true);
	});

	it.each([
		"unknown-mcp",
		"extra-permission",
		"native-shell",
		"native-hook",
		"unknown-tool",
		"cached-server",
		"missing-config",
	])("fails before model work on %s", async (kind) => {
		const resolved = await new CodexConfigBuilder(config()).build();
		const native = {
			...buildCodexThreadConfig(resolved),
			default_permissions: CONTEXT_ONLY_PROFILE,
		};
		if (kind === "unknown-mcp")
			native.mcp_servers = {
				...(native.mcp_servers as object),
				hidden: { command: "danger" },
			};
		if (kind === "extra-permission")
			(
				native.permissions as Record<
					string,
					{ filesystem: Record<string, string> }
				>
			)[CONTEXT_ONLY_PROFILE]!.filesystem["/private"] = "write";
		if (kind === "native-shell")
			(native.features as Record<string, boolean>).shell_tool = true;
		if (kind === "native-hook")
			native.hooks = { SessionStart: [{ command: "danger" }] };
		const client = new FakeClient(
			kind === "missing-config" ? undefined : native,
			kind === "unknown-tool"
				? ["list_context", "read_context", "write_file"]
				: undefined,
			kind === "cached-server",
		);
		const backend = new AppServerCodexBackend(() => client);
		await expect(backend.open(resolved)).rejects.toThrow(
			/Context-only|context-only/,
		);
		expect(
			client.requests.some((request) => request.method === "turn/start"),
		).toBe(false);
		if (!["unknown-tool", "cached-server"].includes(kind))
			expect(
				client.requests.some((request) => request.method.startsWith("thread/")),
			).toBe(false);
		expect(client.closed).toBe(true);
	});

	it("denies stray native command, file, permission, dynamic-tool and elicitation requests, and isolates the process pool", async () => {
		const resolved = await new CodexConfigBuilder(config()).build();
		const clients: FakeClient[] = [];
		const manager = new AppServerProcessManager(
			() => {
				const client = new FakeClient({});
				clients.push(client);
				return client;
			},
			{ idleCloseMs: 0 },
		);
		const restricted = await manager.acquire(resolved);
		const ordinary = await manager.acquire({
			...resolved,
			toolProfile: undefined,
		});
		expect(clients).toHaveLength(2);
		const handler = clients[0]!.serverRequest;
		for (const method of [
			"item/commandExecution/requestApproval",
			"item/fileChange/requestApproval",
		])
			expect(await handler(method, { command: "danger" })).toEqual({
				decision: "cancel",
			});
		for (const method of ["execCommandApproval", "applyPatchApproval"])
			expect(await handler(method, {})).toEqual({ decision: "abort" });
		expect(
			await handler("item/permissions/requestApproval", {
				permissions: { network: { enabled: true } },
			}),
		).toEqual({ permissions: {}, scope: "turn" });
		expect(
			await handler("item/tool/call", {
				tool: "shell",
				arguments: { command: "danger" },
			}),
		).toEqual({
			success: false,
			contentItems: [
				{
					type: "inputText",
					text: "Context-only Codex denied dynamic tool execution",
				},
			],
		});
		expect(
			await handler("mcpServer/elicitation/request", {
				url: "https://danger.invalid",
			}),
		).toEqual({ action: "decline" });
		expect(() => handler("unknown/capability", {})).toThrow(
			"Context-only Codex denied server request",
		);
		expect(
			await clients[1]!.serverRequest(
				"item/commandExecution/requestApproval",
				{},
			),
		).toEqual({ decision: "accept" });
		await restricted.release();
		await ordinary.release();
	});

	it("requires the stable private empty cwd and an explicit context transport", async () => {
		const input = config();
		writeFileSync(join(input.workingDirectory!, "secret"), "private");
		await expect(new CodexConfigBuilder(input).build()).rejects.toThrow(
			/private and empty/,
		);
		rmSync(join(input.workingDirectory!, "secret"));
		chmodSync(input.workingDirectory!, 0o755);
		await expect(new CodexConfigBuilder(input).build()).rejects.toThrow(
			/private and empty/,
		);
		chmodSync(input.workingDirectory!, 0o700);
		await expect(
			new CodexConfigBuilder({ ...input, mcpConfig: {} }).build(),
		).rejects.toThrow(/factory-context transport/);
	});

	it("returns a JSON-RPC error when a forbidden unknown server request is rejected", async () => {
		const client = new AppServerClient({
			binaryPath: "/unused",
			logger: { warn: vi.fn(), error: vi.fn() },
		});
		client.setServerRequestHandler(() => {
			throw new Error("Context-only denied unknown tool");
		});
		const transport = client as unknown as {
			write(message: unknown): void;
			handleServerRequest(
				id: number,
				method: string,
				params: unknown,
			): Promise<void>;
		};
		const write = vi.spyOn(transport, "write").mockImplementation(() => {});
		await transport.handleServerRequest(9, "unknown/mutate", {
			target: "/private",
		});
		expect(write.mock.calls).toEqual([
			[
				{
					jsonrpc: "2.0",
					id: 9,
					error: { code: -32603, message: "Server request denied" },
				},
			],
		]);
	});
});
