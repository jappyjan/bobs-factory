import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);
vi.mock("../src/executable.js", () => ({
	resolveClaudeExecutable: () => "/prepared/claude",
}));

import { ClaudeRunner } from "../src/ClaudeRunner.js";

const directories: string[] = [];
afterEach(async () => {
	vi.clearAllMocks();
	for (const directory of directories.splice(0)) {
		await vi.waitFor(() =>
			expect(
				readdirSync(join(directory, "logs", basename(directory))),
			).toHaveLength(2),
		);
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("Claude context-only native query boundary", () => {
	it.each([
		{
			toolProfile: "context-only" as const,
			resumeSessionId: "unknown-original-model",
			expected: undefined,
		},
		{
			toolProfile: "context-only" as const,
			resumeSessionId: undefined,
			expected: "opus",
		},
		{
			toolProfile: undefined,
			resumeSessionId: "ordinary-native",
			expected: "opus",
		},
	])("preserves native model selection for $toolProfile resume=$resumeSessionId", async ({
		toolProfile,
		resumeSessionId,
		expected,
	}) => {
		const directory = mkdtempSync(join(tmpdir(), "claude-resume-model-"));
		directories.push(directory);
		sdk.query.mockImplementation(async function* () {});
		await new ClaudeRunner({
			factoryHome: directory,
			workingDirectory: directory,
			toolProfile,
			resumeSessionId,
		}).start("Continue the exact native conversation");
		const { options } = sdk.query.mock.calls[0][0];
		expect(options.resume).toBe(resumeSessionId);
		expect(options.model).toBe(expected);
		if (expected === undefined) {
			expect(Object.hasOwn(options, "model")).toBe(false);
			expect(options.fallbackModel).toBeUndefined();
		}
		await vi.waitFor(() =>
			expect(
				readdirSync(join(directory, "logs", basename(directory))),
			).toHaveLength(2),
		);
	});
	it.each([
		undefined,
		"native-conversation",
	])("denies inherited tools and project MCP after native merges (resume=%s)", async (resumeSessionId) => {
		const directory = mkdtempSync(join(tmpdir(), "claude-context-profile-"));
		directories.push(directory);
		mkdirSync(join(directory, ".claude"));
		writeFileSync(
			join(directory, ".mcp.json"),
			JSON.stringify({ mcpServers: { project: { command: "malicious" } } }),
		);
		writeFileSync(
			join(directory, ".claude/settings.json"),
			JSON.stringify({ permissions: { allow: ["Bash", "Read", "Task"] } }),
		);
		const explicitMcp = join(directory, "explicit-mcp.json");
		writeFileSync(
			explicitMcp,
			JSON.stringify({ mcpServers: { inherited: { command: "malicious" } } }),
		);
		sdk.query.mockImplementation(async function* () {});
		const onAskUserQuestion = vi.fn();
		const runner = new ClaudeRunner({
			factoryHome: directory,
			workingDirectory: directory,
			toolProfile: "context-only",
			model: "selected-model",
			resumeSessionId,
			allowedTools: ["Bash", "Read", "Task", "mcp__factory-context__*"],
			allowedDirectories: ["/private"],
			additionalDirectories: ["/private"],
			tools: ["Bash", "Read", "Task", "WebFetch", "Skill"],
			skills: "all",
			plugins: [{ type: "local", path: "/private/plugin" }],
			settingSources: ["user", "project", "local"],
			strictMcpConfig: false,
			mcpConfigPath: explicitMcp,
			mcpConfig: {
				"factory-context": { type: "http", url: "http://127.0.0.1:1/context" },
				other: { command: "malicious" },
			},
			runnerSettings: { permissions: { defaultMode: "bypassPermissions" } },
			extraArgs: { "dangerously-skip-permissions": null },
			onAskUserQuestion,
		});
		await runner.start("Read only the accepted input context.");
		const { options } = sdk.query.mock.calls[0][0];
		expect(options.model).toBe("selected-model");
		expect(options.resume).toBe(resumeSessionId);
		expect(options.fallbackModel).toBeUndefined();
		expect(options.tools).toEqual([]);
		expect(options.skills).toEqual([]);
		expect(options.plugins).toBeUndefined();
		expect(options.settingSources).toEqual([]);
		expect(options.strictMcpConfig).toBe(true);
		expect(options.mcpServers).toEqual({
			"factory-context": { type: "http", url: "http://127.0.0.1:1/context" },
		});
		expect(options.additionalDirectories).toBeUndefined();
		expect(options.settings).toBeUndefined();
		expect(options.extraArgs).toBeUndefined();
		expect(options.allowedTools).toEqual([
			"mcp__factory-context__list_context",
			"mcp__factory-context__read_context",
		]);
		const permissionOptions = {
			signal: new AbortController().signal,
			toolUseID: "native-tool-request",
		};
		for (const tool of [
			"Read",
			"Glob",
			"Grep",
			"Bash",
			"Write",
			"Edit",
			"Task",
			"Agent",
			"WebFetch",
			"WebSearch",
			"Skill",
			"AskUserQuestion",
			"UnknownTool",
			"mcp__other__read_context",
			"mcp__factory-context__read_repository",
			"mcp__factory-context__publish_artifact",
			"mcp__factory-context__read_context_extra",
		]) {
			expect(
				await options.canUseTool(
					tool,
					{ path: "/private", command: "id" },
					permissionOptions,
				),
			).toMatchObject({ behavior: "deny" });
			// This hook also blocks calls already granted by native saved rules.
			expect(
				await options.hooks.PreToolUse[0].hooks[0](
					{ hook_event_name: "PreToolUse", tool_name: tool },
					"native-tool-request",
					{ signal: permissionOptions.signal },
				),
			).toMatchObject({
				hookSpecificOutput: { permissionDecision: "deny" },
			});
		}
		for (const tool of [
			"mcp__factory-context__list_context",
			"mcp__factory-context__read_context",
		]) {
			const input = { path: "accepted" };
			expect(await options.canUseTool(tool, input, permissionOptions)).toEqual({
				behavior: "allow",
				updatedInput: input,
			});
			expect(
				await options.hooks.PreToolUse[0].hooks[0](
					{ hook_event_name: "PreToolUse", tool_name: tool },
					"native-tool-request",
					{ signal: permissionOptions.signal },
				),
			).toEqual({});
		}
		expect(onAskUserQuestion).not.toHaveBeenCalled();
		// Real log streams open asynchronously; let their queued opens finish
		// before removing this disposable home.
		await vi.waitFor(() =>
			expect(
				readdirSync(join(directory, "logs", basename(directory))),
			).toHaveLength(2),
		);
	});
});
