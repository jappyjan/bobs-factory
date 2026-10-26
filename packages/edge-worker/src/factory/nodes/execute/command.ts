import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnExecution as spawn } from "bobs-factory-core";
import {
	executeGithubApi,
	GITHUB_API_COMMAND,
	githubGitEnvironment,
} from "../../GithubApi.js";
import { gitAgentEnvironment } from "../../GitSettings.js";
import { runRepositories } from "../../RepositoryScope.js";
import type { ExecutionContext } from "../../WorkflowRuntime.js";
export type ProviderCommand = (
	command: string,
	args: string[],
	timeoutMs?: number,
) => Promise<string>;
const commandTimeoutMs = 20 * 60 * 1000;

export function executeCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs = commandTimeoutMs,
): Promise<string> {
	context.signal.throwIfAborted();
	if (command === GITHUB_API_COMMAND) return executeGithubApi(context, args);
	if (
		command === "git" &&
		["fetch", "push", "ls-remote", "clone"].includes(args[0] ?? "")
	)
		return githubGitEnvironment(context).then((environment) =>
			executeProcessCommand(context, command, args, timeoutMs, environment),
		);
	return executeProcessCommand(context, command, args, timeoutMs);
}

function executeProcessCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs: number,
	gitEnvironment?: NodeJS.ProcessEnv,
): Promise<string> {
	const input = JSON.stringify(context.input) ?? "null";
	const directory = mkdtempSync(join(tmpdir(), "cyrus-factory-command-"));
	const inputPath = join(directory, "input.json");
	try {
		writeFileSync(inputPath, input, { mode: 0o600 });
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: context.run.workspace,
			detached: process.platform !== "win32",
			env: {
				...(context.execution?.environment ?? process.env),
				...(!context.execution && context.factoryHome
					? gitAgentEnvironment(context.factoryHome)
					: {}),
				...gitEnvironment,
				// Large contexts cannot fit in the OS process argument/environment limit.
				FACTORY_INPUT: Buffer.byteLength(input) <= 16000 ? input : undefined,
				FACTORY_INPUT_FILE: inputPath,
				FACTORY_EVIDENCE_DIR: context.evidenceDir,
				FACTORY_REPOSITORIES: JSON.stringify(runRepositories(context.run)),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const terminate = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {
				/* Already exited. */
			}
			const kill = setTimeout(() => {
				try {
					if (process.platform !== "win32" && child.pid)
						process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {
					/* Already exited. */
				}
			}, 2000);
			kill.unref();
		};
		context.signal.addEventListener("abort", terminate, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeoutMs);
		const record = (chunk: Buffer) => {
			const text = chunk.toString();
			output = (output + text).slice(-1000000);
			// Wait until close to redact across arbitrary stdout chunk boundaries.
			if (!context.execution) context.log(text);
		};
		child.stdout.on("data", record);
		child.stderr.on("data", record);
		const cleanup = () => {
			clearTimeout(timer);
			context.signal.removeEventListener("abort", terminate);
			rmSync(directory, { recursive: true, force: true });
		};
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (context.execution) {
				output = context.execution.redact(output);
				context.log(output);
			}
			if (context.signal.aborted) reject(new Error("Run terminated"));
			else if (timedOut) reject(new Error(`Command timed out: ${command}`));
			else if (code !== 0) {
				const agentFailure =
					command === "git" &&
					!context.execution &&
					/Couldn't (?:find key in agent|get agent socket)/.test(output);
				reject(
					new Error(
						`${command} exited ${code}: ${output.slice(-12000)}${agentFailure ? "\nOpen Settings → Identity profiles → Host Git identity, select the SSH agent that holds your signing key, test and save it, then retry this step." : ""}`,
					),
				);
			} else resolve(output.trim());
		});
	});
}
