import { afterEach, expect, it, vi } from "vitest";
import { executionCapabilities } from "../src/factory/ExecutionCapabilities.js";

const { exec, claude, codex, cursor } = vi.hoisted(() => ({
	exec: vi.fn(),
	claude: vi.fn(() => "/prepared/claude"),
	codex: vi.fn(() => ({ command: "/prepared/codex", args: ["app-server"] })),
	cursor: vi.fn(() => ({
		sdk: "/prepared/cursor-sdk",
		node: "/prepared/node",
		version: "1.0.19",
	})),
}));
vi.mock("node:child_process", () => ({ execFileSync: exec }));
vi.mock("bobs-factory-claude-runner", () => ({
	resolveClaudeExecutable: claude,
}));
vi.mock("bobs-factory-codex-runner", () => ({
	resolveCodexAppServerLaunch: codex,
}));
vi.mock("bobs-factory-cursor-runner", () => ({
	resolveCursorInstallation: cursor,
}));
afterEach(() => {
	vi.clearAllMocks();
});

it.each([
	{ runner: "claude" as const, binary: "/prepared/claude", version: "2.1.281" },
	{
		runner: "codex" as const,
		binary: "/prepared/codex",
		version: "codex-cli 0.159.2",
	},
])("checks the executable selected by the $runner adapter", ({
	runner,
	binary,
	version,
}) => {
	exec.mockReturnValue(version);
	expect(executionCapabilities(runner)).toEqual({ binary, version });
	expect(exec).toHaveBeenCalledWith(
		binary,
		["--version"],
		expect.objectContaining({ timeout: 15000 }),
	);
});
it.each([
	["claude", "2.1.281"],
	["claude", "3.0.0"],
	["codex", "codex-cli 0.159.2"],
	["codex", "codex-cli 0.159.3"],
	["codex", "codex-cli 0.160.1"],
	["codex", "codex-cli 0.163.0"],
	["codex", "codex-cli 1.0.0"],
	["codex", "codex-cli 10.0.0"],
	["codex", "codex-cli 0.159.2+build.1"],
	["codex", "codex-cli 1.0.0-rc.1"],
	["gemini", "0.17.0"],
	["gemini", "1.0.0"],
	["opencode", "1.18.33"],
	["opencode", "2.0.0"],
] as const)("accepts %s at or above its CLI minimum: %s", (runner, version) => {
	exec.mockReturnValue(version);
	expect(executionCapabilities(runner).version).toBe(version);
});
it.each([
	["claude", "2.1.280", "2.1.281"],
	["codex", "codex-cli 0.159.1", "0.159.2"],
	["codex", "codex-cli 0.158.99", "0.159.2"],
	["codex", "codex-cli 0.159.2-rc.1", "0.159.2"],
	["codex", "codex-cli unavailable", "0.159.2"],
	["codex", "codex-cli 0.163", "0.159.2"],
	["codex", "codex-cli 0.163.0oops", "0.159.2"],
	["gemini", "0.16.99", "0.17.0"],
	["opencode", "0.99.99", "1.18.33"],
] as const)("rejects %s below its minimum or unreadable: %s", (runner, version, minimum) => {
	exec.mockReturnValue(version);
	expect(() => executionCapabilities(runner)).toThrow(
		`requires ${minimum} or newer`,
	);
});
it("reports the prepared Cursor SDK and checks its selected Node", () => {
	exec.mockReturnValue("v24.21.0");
	expect(executionCapabilities("cursor")).toEqual({
		binary: "/prepared/cursor-sdk (isolated worker; /prepared/node)",
		version: "1.0.19",
	});
	expect(exec).toHaveBeenCalledWith(
		"/prepared/node",
		["--version"],
		expect.any(Object),
	);
});
it.each([
	"v22.12.0",
	"v22.23.3",
	"v20.19.0",
	"v23.11.0",
	"v25.0.0",
	"invalid",
])("rejects unsupported prepared Cursor Node %s", (version) => {
	exec.mockReturnValue(version);
	expect(() => executionCapabilities("cursor")).toThrow("Node 24");
});
