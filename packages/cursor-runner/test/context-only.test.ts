import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ create: vi.fn(), resume: vi.fn() }));
vi.mock("../src/sdk.js", () => ({
	loadCursorSdk: async () => ({ Agent: native }),
}));

import { CursorRunner } from "../src/CursorRunner.js";

const directories: string[] = [];
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe("Cursor context-only native hooks", () => {
	it.each([
		undefined,
		"native-existing",
	])("executes the installed fail-closed hook for native new/resume requests (%s)", async (resumeSessionId) => {
		const directory = mkdtempSync(join(tmpdir(), "cursor-context-profile-"));
		directories.push(directory);
		vi.stubEnv("HOME", join(directory, "native-home"));
		mkdirSync(join(directory, ".cursor"));
		const inherited = JSON.stringify({
			permissions: { allow: ["Shell(*)", "Read(**)"] },
		});
		writeFileSync(join(directory, ".cursor/cli.json"), inherited);
		let observed = false;
		const inspectNativeOptions = async (options: Record<string, unknown>) => {
			observed = true;
			expect(options.model).toEqual({ id: "selected-model" });
			expect(options.mcpServers).toEqual({
				"factory-context": { type: "http", url: "http://127.0.0.1:1/context" },
			});
			const hooks = JSON.parse(
				readFileSync(join(directory, ".cursor/hooks.json"), "utf8"),
			);
			for (const matchers of Object.values(hooks.hooks) as Array<
				Array<{ failClosed: boolean }>
			>)
				expect(matchers.every((matcher) => matcher.failClosed)).toBe(true);
			const permissionsPath = join(
				directory,
				".cursor/bobs-factory-permissions.json",
			);
			const permissions = JSON.parse(readFileSync(permissionsPath, "utf8"));
			expect(permissions.toolProfile).toBe("context-only");
			expect(permissions.allow).toEqual([
				"Mcp(factory-context:list_context)",
				"Mcp(factory-context:read_context)",
			]);
			const execute = (payload: Record<string, unknown>) => {
				const result = spawnSync(
					process.execPath,
					[join(directory, ".cursor/bobs-factory-permission-check.mjs")],
					{
						input: JSON.stringify(payload),
						encoding: "utf8",
					},
				);
				expect(result.status).toBe(0);
				return JSON.parse(result.stdout).permission;
			};
			for (const payload of [
				{
					hook_event_name: "beforeShellExecution",
					command: "cat /private/secret",
				},
				{ hook_event_name: "beforeReadFile", file_path: "/private/secret" },
				...[
					"Read",
					"Write",
					"Shell",
					"Task",
					"WebFetch",
					"WebSearch",
					"Skill",
					"Unknown",
					"MCP:read_repository",
					"MCP:publish_artifact",
				].map((tool_name) => ({ hook_event_name: "preToolUse", tool_name })),
				{ hook_event_name: "unknownFutureHook", tool_name: "read_context" },
				{
					hook_event_name: "beforeMCPExecution",
					tool_name: "read_context",
					url: "http://127.0.0.1:1/untrusted",
				},
				{
					hook_event_name: "beforeMCPExecution",
					tool_name: "read_repository",
					url: "http://127.0.0.1:1/context",
				},
				{
					hook_event_name: "beforeMCPExecution",
					tool_name: "read_context_extra",
					url: "http://127.0.0.1:1/context",
				},
				{ hook_event_name: "beforeMCPExecution", tool_name: "read_context" },
				{},
			])
				expect(execute(payload), JSON.stringify(payload)).toBe("deny");
			for (const tool of ["list_context", "read_context"]) {
				expect(
					execute({ hook_event_name: "preToolUse", tool_name: `MCP:${tool}` }),
				).toBe("allow");
				expect(
					execute({
						hook_event_name: "beforeMCPExecution",
						tool_name: tool,
						url: "http://127.0.0.1:1/context",
					}),
				).toBe("allow");
			}
			const original = readFileSync(permissionsPath, "utf8");
			writeFileSync(permissionsPath, "invalid JSON");
			expect(
				execute({ hook_event_name: "preToolUse", tool_name: "Read" }),
			).toBe("deny");
			writeFileSync(permissionsPath, original);
			return {
				agentId: resumeSessionId ?? "new-context-native",
				close: vi.fn(),
				send: async () => ({ stream: async function* () {}, cancel: vi.fn() }),
			};
		};
		native.create.mockImplementation(inspectNativeOptions);
		native.resume.mockImplementation(async (sessionId, options) => {
			expect(sessionId).toBe(resumeSessionId);
			return inspectNativeOptions(options);
		});
		const runner = new CursorRunner({
			factoryHome: directory,
			workingDirectory: directory,
			toolProfile: "context-only",
			model: "selected-model",
			resumeSessionId,
			allowedTools: ["Read", "Bash", "Task", "mcp__factory-context__*"],
			allowedDirectories: ["/private"],
			mcpConfig: {
				"factory-context": { type: "http", url: "http://127.0.0.1:1/context" },
				untrusted: { command: "malicious" },
			},
			onError: (error) => {
				throw error;
			},
		});
		const session = await runner.start("Read the accepted context only.");
		expect(observed).toBe(true);
		expect(session.sessionId).toBe(resumeSessionId ?? "new-context-native");
		expect(readFileSync(join(directory, ".cursor/cli.json"), "utf8")).toBe(
			inherited,
		);
	});

	it.each([
		"cursor",
		"claude",
	])("refuses inherited %s startup hooks before creating or resuming the native agent", async (source) => {
		const directory = mkdtempSync(join(tmpdir(), "cursor-startup-boundary-"));
		directories.push(directory);
		const home = join(directory, "native-home");
		vi.stubEnv("HOME", home);
		mkdirSync(join(home, `.${source}`), { recursive: true });
		writeFileSync(
			join(
				home,
				source === "cursor" ? ".cursor/hooks.json" : ".claude/settings.json",
			),
			JSON.stringify({
				hooks: { sessionStart: [{ command: "must-not-execute" }] },
			}),
		);
		const errors: Error[] = [];
		const runner = new CursorRunner({
			workingDirectory: directory,
			factoryHome: directory,
			toolProfile: "context-only",
			resumeSessionId: "native-existing",
			onError: (error) => {
				errors.push(error);
			},
		});
		const session = await runner.start("Do not execute inherited hooks");
		expect(session.sessionId).toBe("native-existing");
		expect(native.create).not.toHaveBeenCalled();
		expect(native.resume).not.toHaveBeenCalled();
		expect(errors.map((error) => error.message)).toContain(
			"Context-only Cursor cannot run inherited startup hooks. Native settings are preserved; refusing to start the agent.",
		);
		await vi.waitFor(() =>
			expect(
				readdirSync(join(directory, "logs"), { recursive: true }).some((name) =>
					String(name).endsWith(".jsonl"),
				),
			).toBe(true),
		);
	});
});
