import type { EdgeConfig, EdgeWorkerConfig } from "bobs-factory-core";

function parseToolEnv(value: string | undefined): string[] | undefined {
	const tools = value
		?.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools && tools.length > 0 ? tools : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	return value.toLowerCase().trim() === "true";
}

/** Shared environment precedence for every production startup. Values remain runtime-only. */
export function runtimeAgentSettings(
	edgeConfig: EdgeConfig,
): Partial<EdgeWorkerConfig> {
	const overrides: Partial<EdgeWorkerConfig> = {
		linearAllowedTools:
			parseToolEnv(process.env.LINEAR_ALLOWED_TOOLS) ??
			edgeConfig.linearAllowedTools,
		defaultDisallowedTools:
			parseToolEnv(process.env.DISALLOWED_TOOLS) ??
			edgeConfig.defaultDisallowedTools,
		// Model configuration: environment variables take precedence over config file.
		// Legacy env vars/keys are still accepted for backwards compatibility.
		claudeDefaultModel:
			process.env.BOBS_FACTORY_CLAUDE_DEFAULT_MODEL ||
			process.env.BOBS_FACTORY_DEFAULT_MODEL ||
			edgeConfig.claudeDefaultModel ||
			edgeConfig.defaultModel,
		claudeDefaultFallbackModel:
			process.env.BOBS_FACTORY_CLAUDE_DEFAULT_FALLBACK_MODEL ||
			process.env.BOBS_FACTORY_DEFAULT_FALLBACK_MODEL ||
			edgeConfig.claudeDefaultFallbackModel ||
			edgeConfig.defaultFallbackModel,
		geminiDefaultModel:
			process.env.BOBS_FACTORY_GEMINI_DEFAULT_MODEL ||
			edgeConfig.geminiDefaultModel,
		codexDefaultModel:
			process.env.BOBS_FACTORY_CODEX_DEFAULT_MODEL ||
			edgeConfig.codexDefaultModel,
		opencodeDefaultModel:
			process.env.BOBS_FACTORY_OPENCODE_DEFAULT_MODEL ||
			edgeConfig.opencodeDefaultModel,
		opencodeDefaultFallbackModel:
			process.env.BOBS_FACTORY_OPENCODE_DEFAULT_FALLBACK_MODEL ||
			edgeConfig.opencodeDefaultFallbackModel,
		inferOpenCodeRunnerFromProviderModel:
			parseBooleanEnv(
				process.env.BOBS_FACTORY_INFER_OPENCODE_RUNNER_FROM_PROVIDER_MODEL,
			) ?? edgeConfig.inferOpenCodeRunnerFromProviderModel,
		defaultRunner:
			(process.env.BOBS_FACTORY_DEFAULT_RUNNER as
				| "claude"
				| "gemini"
				| "codex"
				| "cursor"
				| "opencode"
				| undefined) || edgeConfig.defaultRunner,
	};
	return Object.fromEntries(
		Object.entries(overrides).filter(([, value]) => value !== undefined),
	);
}
