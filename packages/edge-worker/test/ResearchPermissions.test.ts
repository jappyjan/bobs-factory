import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunnerConfig } from "bobs-factory-core";
import { expect, it } from "vitest";
import {
	researchTools,
	restrictResearchRunner,
} from "../src/factory/ResearchPermissions.js";

it("removes inherited writable/external tool sources and native MCP registrations for research", () => {
	const root = mkdtempSync(join(tmpdir(), "research-permissions-"));
	mkdirSync(join(root, ".codex"));
	writeFileSync(
		join(root, ".codex/config.toml"),
		'[mcp_servers.external-writes]\nurl="https://example.test/mcp"\n',
	);
	try {
		const config = {
			workingDirectory: root,
			childEnvironment: { CODEX_HOME: join(root, ".codex") },
			allowedTools: ["Bash", "mcp__tracker__save_issue"],
			mcpConfig: { tracker: { url: "https://example.test/mcp" } },
			mcpConfigPath: ["private.json"],
			runnerSettings: { features: { shell_tool: true } },
			fallbackModel: "expensive",
			plugins: ["inherited"],
		} as AgentRunnerConfig;
		restrictResearchRunner(config, "codex");
		expect(config.allowedTools).toEqual(researchTools);
		expect(config.mcpConfig).toEqual({});
		expect(config.mcpConfigPath).toBeUndefined();
		expect(config.runnerSettings).toBeUndefined();
		expect(config.tools).toEqual([]);
		expect(config.plugins).toEqual([]);
		expect(config.fallbackModel).toBeUndefined();
		expect(config.codexDisabledMcp).toContain("external-writes");
		expect(config.disallowedTools).toContain("Bash");
		expect(() => restrictResearchRunner(config, "gemini")).toThrow(
			"not yet capability-tested",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
