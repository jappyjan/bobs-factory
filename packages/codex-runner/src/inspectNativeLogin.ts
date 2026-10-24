import { AppServerClient } from "./backend/appServerClient.js";
import { resolveCodexAppServerLaunch } from "./backend/codexBinary.js";
import type { CodexConfigOverrides } from "./types.js";

/** Process-only suppression; the selected native login/config store stays intact. */
export const CODEX_NATIVE_SHARE_CONFIG = {
	notify: [],
	"features.hooks": false,
	"features.plugins": false,
	"features.apps": false,
} satisfies CodexConfigOverrides;

/** Read native login/configuration without starting a thread, tools or a model turn. */
export async function inspectCodexNativeLogin(
	env: Record<string, string>,
): Promise<{
	account: string;
	mcp: string[];
}> {
	const { command, args } = resolveCodexAppServerLaunch(
		undefined,
		CODEX_NATIVE_SHARE_CONFIG,
	);
	const client = new AppServerClient({
		binaryPath: command,
		args,
		env,
		requestTimeoutMs: 15000,
		// Native errors/configuration may contain secrets. Return only safe diagnostics.
		logger: { warn() {}, error() {} },
	});
	client.on("error", () => {});
	client.setServerRequestHandler(() => {
		throw new Error("No interaction permitted during native login inspection");
	});
	try {
		client.start();
		await client.request("initialize", {
			clientInfo: { name: "factory-native-login", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const { account } = await client.request<{
			account?: { type: string; email?: string };
		}>("account/read", { refreshToken: false });
		if (account?.type !== "chatgpt" || !account.email)
			throw new Error(
				"Native Codex Share requires an existing ChatGPT login in the selected root",
			);
		const { config } = await client.request<{
			config: Record<string, unknown>;
		}>("config/read", { includeLayers: false });
		if (
			config.openai_base_url ||
			(config.chatgpt_base_url &&
				config.chatgpt_base_url !== "https://chatgpt.com/backend-api/") ||
			Object.keys((config.model_providers as object) ?? {}).length ||
			config.forced_login_method === "api"
		)
			throw new Error(
				"Native Codex Share rejects competing provider endpoints or API-only authentication policy",
			);
		const features = config.features as Record<string, unknown> | undefined;
		if (
			(config.hooks && features?.hooks !== false) ||
			(config.notify != null &&
				(!Array.isArray(config.notify) || config.notify.length > 0)) ||
			(Object.values(
				(config.plugins as Record<string, { enabled?: boolean }>) ?? {},
			).some((plugin) => plugin.enabled !== false) &&
				features?.plugins !== false) ||
			(config.apps && features?.apps !== false)
		)
			throw new Error(
				"Native Codex Share requires a root without automatic hooks, notification commands, plugins or app connectors; declare MCP sources instead",
			);
		return {
			account: account.email,
			mcp: Object.keys((config.mcp_servers as object) ?? {}),
		};
	} catch {
		throw new Error(
			"Native Codex login inspection failed. Select an existing first-party ChatGPT login without competing provider policy, hooks, notification commands, enabled plugins or app connectors",
		);
	} finally {
		await client.close();
	}
}
