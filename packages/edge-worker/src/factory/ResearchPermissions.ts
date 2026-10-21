import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentRunnerConfig, RunnerType } from "bobs-factory-core";
import { codexSystemMcp } from "./CodexSystemSources.js";

export const researchTools = [
	"list_context",
	"read_context",
	"list_repository",
	"read_repository",
].map((t) => `mcp__factory-context__${t}`);
/** Researchers inspect pinned blobs via the scoped server; no native shell/delegation or external writes. */
export function restrictResearchRunner(
	config: AgentRunnerConfig,
	runner: RunnerType,
) {
	if (!["claude", "codex", "cursor", "opencode"].includes(runner))
		throw new Error(
			`Read-only research is not yet capability-tested for ${runner}; configure a Claude, Codex, Cursor or OpenCode research role`,
		);
	config.allowedTools = [...researchTools];
	config.tools = [];
	config.skills = [];
	config.plugins = [];
	config.mcpConfigPath = undefined;
	config.mcpConfig = {};
	config.strictMcpConfig = true;
	config.allowedDirectories = [];
	config.additionalDirectories = [];
	config.fallbackModel = undefined;
	config.runnerSettings = undefined;
	config.disallowedTools = [
		...(config.disallowedTools ?? []),
		"Bash",
		"Shell",
		"Read",
		"Glob",
		"Grep",
		"Write",
		"Edit",
		"NotebookEdit",
		"Task",
		...(runner === "opencode" ? [] : ["Agent"]),
		"WebFetch",
		"WebSearch",
	];
	const native = config as AgentRunnerConfig & {
		sandbox?: string;
		sandboxSettings?: unknown;
		configOverrides?: Record<string, unknown>;
		webSearchMode?: string;
		includeWebSearch?: boolean;
		settingSources?: string[];
	};
	if (runner === "codex") {
		const env = config.childEnvironment ?? process.env;
		const paths = [
			join(
				env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex"),
				"config.toml",
			),
		];
		for (let root = config.workingDirectory; root; ) {
			paths.push(join(root, ".codex", "config.toml"));
			const parent = dirname(root);
			if (parent === root) break;
			root = parent;
		}
		const names = new Set([
			...(config.codexDisabledMcp ?? []),
			...codexSystemMcp(),
		]);
		for (const path of paths)
			if (existsSync(path)) {
				const data = readFileSync(path, "utf8");
				for (const m of data.matchAll(
					/^\s*\[mcp_servers\.(?:"([^"]+)"|([a-zA-Z0-9_-]+))(?:\.[^\]]+)?\]/gm,
				))
					names.add(m[1] ?? m[2]!);
			}
		config.codexDisabledMcp = [...names].filter((n) => n !== "factory-context");
		native.sandbox = "read-only";
		native.sandboxSettings = undefined;
		native.includeWebSearch = false;
		native.webSearchMode = "disabled";
		native.configOverrides = {
			...native.configOverrides,
			features: {
				shell_tool: false,
				apply_patch_tool: false,
				multi_agent: false,
			},
			web_search: "disabled",
		};
	}
	if (runner === "claude") config.settingSources = [];
	if (runner === "opencode") {
		config.opencodeGlobalConfig = {};
		config.opencodeRepositoryConfig = {};
	}
}
