import { execFileSync } from "node:child_process";
import { resolveClaudeExecutable } from "bobs-factory-claude-runner";
import { resolveCodexAppServerLaunch } from "bobs-factory-codex-runner";
import type { AgentRunnerConfig, RunnerType } from "bobs-factory-core";
import { resolveCursorInstallation } from "bobs-factory-cursor-runner";
import type { ExecutionSnapshot } from "./ExecutionProfiles.js";

/** Reject older CLIs; newer releases still undergo the normal profile checks. */
export function executionCapabilities(runner: RunnerType): {
	binary: string;
	version: string;
} {
	let binary = runner as string;
	const args = ["--version"];
	if (runner === "cursor") {
		const { sdk, node, version } = resolveCursorInstallation();
		if (node) {
			const nodeVersion = execFileSync(node, ["--version"], {
				encoding: "utf8",
				timeout: 15000,
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
			const match = /^v(\d+)\.(\d+)\./.exec(nodeVersion);
			if (!match || Number(match[1]) !== 24)
				throw new Error(
					"Prepared Cursor SDK requires Node 24; configure BOBS_FACTORY_CURSOR_NODE",
				);
		}
		return {
			binary: `${sdk} (isolated worker${node ? `; ${node}` : ""})`,
			version,
		};
	}
	if (runner === "codex") binary = resolveCodexAppServerLaunch().command;
	else if (runner === "claude") binary = resolveClaudeExecutable();

	let version: string;
	try {
		version = execFileSync(binary, args, {
			encoding: "utf8",
			timeout: 15000,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		throw new Error(
			`${runner} executable unavailable. Install a supported CLI before selecting an execution profile`,
		);
	}
	const minimum = {
		claude: "2.1.281",
		codex: "0.159.2",
		gemini: "0.17.0",
		opencode: "1.18.33",
	}[runner];
	const parsed = version.match(
		/(?:^|\s)v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([\w.-]+))?(?:\+[\w.-]+)?(?=$|\s)/,
	);
	const actual = parsed?.[1]?.split(".").map(Number);
	const floor = minimum.split(".").map(Number);
	const difference = actual
		?.map((part, index) => part - floor[index]!)
		.find((part) => part !== 0);
	if (
		!actual?.every(Number.isSafeInteger) ||
		(difference ?? 0) < 0 ||
		(!difference && parsed?.[2])
	)
		throw new Error(
			`${runner} version ${version} does not meet the execution-profile minimum; requires ${minimum} or newer`,
		);
	return { binary, version };
}

/** Reject requests the installed adapter cannot faithfully enforce, before constructing a runner. */
export function validateProfileRunner(
	config: AgentRunnerConfig,
	snapshot: ExecutionSnapshot,
	runner: RunnerType,
): void {
	const auth = snapshot.identity?.runners[runner];
	const expected = {
		claude: "anthropic",
		codex: "openai",
		gemini: "google",
		cursor: "cursor",
	};
	if (!auth || (runner !== "opencode" && auth.provider !== expected[runner]))
		throw new Error(
			`${runner} requires its matching explicit API credential binding`,
		);
	if (
		auth.kind === "native-login" &&
		(!["claude", "codex"].includes(runner) ||
			auth.mode !== "share" ||
			snapshot.tools?.mode !== "share")
	)
		throw new Error(
			"Native login Share is supported only for Claude/Codex with Share tools. Select an API binding for private tools",
		);
	if (runner === "opencode" && auth.provider === "cursor")
		throw new Error(
			"OpenCode profiles require a first-party Anthropic, OpenAI or Google API binding",
		);
	if (
		runner === "opencode" &&
		config.model &&
		!config.model.startsWith(`${auth.provider}/`)
	)
		throw new Error(
			"OpenCode model provider differs from the accepted identity binding",
		);
}
