import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { ResolvedCodexSandbox } from "../backend/types.js";
import type {
	CodexConfigOverrides,
	CodexConfigValue,
	CodexRunnerConfig,
} from "../types.js";
import { buildCodexMcpServersConfig } from "./mcpConfigTranslator.js";

export const CONTEXT_ONLY_PROFILE = "bobs-factory-context-only";
export const CONTEXT_ONLY_TOOLS = ["list_context", "read_context"];

// Native Codex 0.163 feature names. apply_patch has no public disable switch:
// its filesystem effects are denied by the independent native permission profile.
const DISABLED_FEATURES = [
	"shell_tool",
	"unified_exec",
	"unified_exec_tty",
	"experimental_use_unified_exec_tool",
	"view_image",
	"apps",
	"connectors",
	"enable_mcp_apps",
	"codex_apps_mcp_2026_07_28",
	"browser_use",
	"browser_use_external",
	"browser_use_full_cdp_access",
	"browser_annotation_api",
	"in_app_browser",
	"computer_use",
	"in_app_local_automation",
	"plugins",
	"remote_plugin",
	"remote_control",
	"plugin_hooks",
	"plugin_sharing",
	"recommended_plugins",
	"hooks",
	"codex_hooks",
	"image_generation",
	"imagegenext",
	"code_mode",
	"code_mode_only",
	"code_mode_only_strict_3p_tools",
	"code_mode_buffered_exec",
	"code_mode_interrupt",
	"code_mode_prewarm",
	"code_mode_tool_search",
	"code_mode_host",
	"code_mode_host_grpc",
	"js_repl",
	"js_repl_tools_only",
	"multi_agent",
	"multi_agent_mode",
	"multi_agent_v2",
	"multi_agent_v2_dynamic_tools",
	"collab",
	"enable_fanout",
	"agent_message_board",
	"send_async_message",
	"memory_tool",
	"memories",
	"external_agent_memory_import",
	"web_search",
	"web_search_cached",
	"web_search_request",
	"standalone_web_search",
	"request_permissions",
	"request_permissions_tool",
	"request_rule",
	"guardian_approval",
	"exec_permission_approvals",
	"skill_search",
	"skill_mcp_dependency_install",
	"tool_suggest",
	"tool_search",
	"search_tool",
	"shell_snapshot",
	"shell_snapshot_v2",
] as const;

const HOOK_EVENTS = [
	"Interrupt",
	"PermissionRequest",
	"PostCompact",
	"PostToolUse",
	"PreCompact",
	"PreToolUse",
	"SessionEnd",
	"SessionStart",
	"Stop",
	"SubagentStart",
	"SubagentStop",
	"UserPromptSubmit",
];

/** The caller owns this stable empty directory; native auth remains in CODEX_HOME. */
export function contextOnlySandbox(
	cwd: string | undefined,
	codexHome: string,
): ResolvedCodexSandbox {
	if (
		!cwd ||
		!isAbsolute(cwd) ||
		resolve(cwd) !== cwd ||
		cwd === "/" ||
		cwd === homedir() ||
		cwd === resolve(codexHome)
	)
		throw new Error(
			"Context-only Codex requires a private empty working directory",
		);
	const stat = lstatSync(cwd);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		realpathSync(cwd) !== cwd ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid()) ||
		readdirSync(cwd).length !== 0
	)
		throw new Error(
			"Context-only Codex working directory must be owned, private and empty",
		);
	return {
		kind: "profile",
		profileId: CONTEXT_ONLY_PROFILE,
		filesystem: {
			":root": "deny",
			":minimal": "read",
			":workspace_roots": "deny",
			":tmpdir": "deny",
			":slash_tmp": "deny",
			[cwd]: "read",
		},
		networkAccess: false,
	};
}

export function contextOnlyOverrides(
	config: CodexRunnerConfig,
): CodexConfigOverrides {
	const context = config.mcpConfig?.["factory-context"];
	if (!context)
		throw new Error(
			"Context-only Codex requires the factory-context transport",
		);
	// Translate only the trusted context transport. Never read project/file MCP config,
	// inherited native filters, tool policies or arbitrary runner overrides.
	const translated = buildCodexMcpServersConfig({
		childEnvironment: {},
		mcpConfig: { "factory-context": context },
	});
	const server = translated?.["factory-context"];
	if (!server)
		throw new Error(
			"Context-only Codex requires a serializable factory-context transport",
		);
	delete server.disabled_tools;
	delete server.tools;
	server.enabled = true;
	server.required = true;
	server.enabled_tools = [...CONTEXT_ONLY_TOOLS];
	server.default_tools_approval_mode = "approve";
	const mcp: Record<string, CodexConfigValue> = Object.fromEntries(
		(config.codexDisabledMcp ?? [])
			.filter((name) => name !== "factory-context")
			.map((name) => [name, { enabled: false }]),
	);
	mcp["factory-context"] = server;
	return {
		features: {
			...Object.fromEntries(DISABLED_FEATURES.map((name) => [name, false])),
			skip_host_skill_discovery: true,
		},
		agents: { enabled: false },
		web_search: "disabled",
		allow_login_shell: false,
		notify: [],
		hooks: Object.fromEntries(HOOK_EVENTS.map((name) => [name, []])),
		skills: {
			config: [],
			bundled: { enabled: false },
			include_instructions: false,
		},
		memories: {
			generate_memories: false,
			use_memories: false,
			dedicated_tools: false,
		},
		project_doc_max_bytes: 0,
		project_doc_fallback_filenames: [],
		instructions: "",
		include_environment_context: false,
		include_apps_instructions: false,
		tools: {
			experimental_request_user_input: { enabled: false },
			update_plan: { enabled: false },
		},
		mcp_servers: mcp,
		...(config.modelReasoningEffort
			? { model_reasoning_effort: config.modelReasoningEffort }
			: {}),
		...(config.serviceTier
			? { service_tier: config.serviceTier === "fast" ? "fast" : "default" }
			: {}),
	};
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

// Native config/read serializes optional TOML fields as null. Absence grants
// nothing; every non-null path, mode and network option still participates.
function omitNulls(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(omitNulls);
	const record = object(value);
	return record
		? Object.fromEntries(
				Object.entries(record)
					.filter(([, item]) => item !== null && item !== undefined)
					.map(([name, item]) => [name, omitNulls(item)]),
			)
		: value;
}

/** CLI config merges tables recursively. Check the effective native result before
 * any start/resume can load inherited MCP servers or begin model work. */
export function assertContextOnlyNativeConfig(
	response: unknown,
	expected: CodexConfigOverrides,
): void {
	const effective = object(omitNulls(object(response)?.config));
	if (!effective)
		throw new Error(
			"Context-only Codex cannot verify the native configuration",
		);
	const features = object(effective.features);
	for (const name of DISABLED_FEATURES) {
		const feature = features?.[name];
		if (feature !== false && object(feature)?.enabled !== false)
			throw new Error(
				`Context-only Codex native feature is not disabled: ${name}`,
			);
	}
	if (
		features?.skip_host_skill_discovery !== true ||
		effective.web_search !== "disabled" ||
		effective.allow_login_shell !== false ||
		effective.project_doc_max_bytes !== 0
	)
		throw new Error("Context-only Codex native restrictions were not applied");
	const same = (left: unknown, right: unknown): boolean => {
		if (Array.isArray(right))
			return (
				Array.isArray(left) &&
				left.length === right.length &&
				right.every((value, index) => same(left[index], value))
			);
		const rightObject = object(right);
		if (rightObject) {
			const leftObject = object(left);
			return (
				!!leftObject &&
				Object.keys(leftObject).length === Object.keys(rightObject).length &&
				Object.entries(rightObject).every(([name, value]) =>
					same(leftObject[name], value),
				)
			);
		}
		return left === right;
	};
	const expectedProfile = object(expected.permissions)?.[CONTEXT_ONLY_PROFILE];
	if (
		effective.default_permissions !== CONTEXT_ONLY_PROFILE ||
		!expectedProfile ||
		!same(
			object(effective.permissions)?.[CONTEXT_ONLY_PROFILE],
			expectedProfile,
		)
	)
		throw new Error(
			"Context-only Codex native filesystem/network profile was not applied exactly",
		);
	if (
		!same(effective.notify, []) ||
		Object.values(object(effective.hooks) ?? {}).some(
			(value) => Array.isArray(value) && value.length > 0,
		)
	)
		throw new Error(
			"Context-only Codex inherited a native notification or hook",
		);
	for (const name of [
		"model_instructions_file",
		"experimental_compact_prompt_file",
	]) {
		if (effective[name])
			throw new Error(`Context-only Codex cannot inherit ${name}`);
	}
	const mcp = object(effective.mcp_servers);
	if (!mcp)
		throw new Error("Context-only Codex cannot verify native MCP isolation");
	for (const [name, value] of Object.entries(mcp)) {
		const server = object(value);
		if (name !== "factory-context" && server?.enabled !== false)
			throw new Error(
				`Context-only Codex inherited MCP server is enabled: ${name}`,
			);
	}
	const server = object(mcp["factory-context"]);
	const expectedServer = object(
		object(expected.mcp_servers)?.["factory-context"],
	);
	if (
		!server ||
		!expectedServer ||
		server.enabled !== true ||
		server.required !== true ||
		JSON.stringify(server.enabled_tools) !== JSON.stringify(CONTEXT_ONLY_TOOLS)
	)
		throw new Error(
			"Context-only Codex native context tool ceiling was not applied",
		);
	if (
		Object.keys(object(server.tools) ?? {}).length > 0 ||
		(Array.isArray(server.disabled_tools) && server.disabled_tools.length > 0)
	)
		throw new Error(
			"Context-only Codex inherited a native context tool policy",
		);
	for (const field of [
		"command",
		"args",
		"url",
		"http_headers",
		"env_http_headers",
		"bearer_token_env_var",
		"env",
		"env_vars",
		"cwd",
	])
		if (
			!same(
				server[field] ?? (field === "args" ? [] : undefined),
				expectedServer[field] ?? (field === "args" ? [] : undefined),
			)
		)
			throw new Error(
				`Context-only Codex inherited context transport field: ${field}`,
			);
}
