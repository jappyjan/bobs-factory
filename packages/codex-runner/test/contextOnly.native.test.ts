import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { AppServerClient } from "../src/backend/appServerClient.js";
import { resolveCodexAppServerLaunch } from "../src/backend/codexBinary.js";
import { buildCodexThreadConfig } from "../src/backend/threadConfig.js";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";
import {
	assertContextOnlyNativeConfig,
	CONTEXT_ONLY_PROFILE,
} from "../src/config/contextOnly.js";

const binary = process.env.BOBS_FACTORY_CODEX_CONTEXT_NATIVE_TEST;

// Explicit opt-in: no native CLI, auth store, or model turn in ordinary package tests.
it.runIf(process.platform === "darwin" && !!binary)(
	"enforces the exact context-only profile in the native Codex OS sandbox without model calls",
	async () => {
		const root = realpathSync(
			mkdtempSync(join(tmpdir(), "codex-context-native-")),
		);
		const evidence =
			process.env.BOBS_FACTORY_CODEX_CONTEXT_NATIVE_EVIDENCE ??
			`${root}-evidence`;
		mkdirSync(evidence, { recursive: true });
		const records: unknown[] = [];
		const env = {
			HOME: join(root, "home"),
			PATH: "/usr/bin:/bin",
			CODEX_HOME: join(root, "auth"),
		};
		const cwd = join(root, "empty");
		mkdirSync(cwd, { mode: 0o700 });
		mkdirSync(env.HOME, { mode: 0o700 });
		chmodSync(root, 0o700);
		const secret = join(root, "outside-secret");
		writeFileSync(secret, "isolated-test-secret");
		const run = promisify(execFile);
		const command = async (args: string[]) => {
			try {
				const result = await run(binary!, args, {
					env,
					cwd,
					timeout: 10_000,
					maxBuffer: 1_000_000,
				});
				const receipt = {
					binary,
					args,
					code: 0,
					stdout: result.stdout,
					stderr: result.stderr,
				};
				records.push(receipt);
				return receipt;
			} catch (error) {
				const failure = error as {
					code?: number | string;
					stdout?: string;
					stderr?: string;
				};
				const receipt = {
					binary,
					args,
					code: failure.code,
					stdout: failure.stdout ?? "",
					stderr: failure.stderr ?? "",
				};
				records.push(receipt);
				return receipt;
			}
		};
		const version = await command(["--version"]);
		const resolved = await new CodexConfigBuilder({
			toolProfile: "context-only",
			factoryHome: root,
			workingDirectory: cwd,
			codexHome: env.CODEX_HOME,
			codexPath: binary,
			childEnvironment: env,
			mcpConfig: { "factory-context": { command: "/usr/bin/true" } },
		}).build();
		const config = buildCodexThreadConfig(resolved);
		const launch = resolveCodexAppServerLaunch(binary, {
			...config,
			default_permissions: CONTEXT_ONLY_PROFILE,
		});
		const client = new AppServerClient({
			binaryPath: launch.command,
			args: launch.args,
			env,
			cwd,
			requestTimeoutMs: 10_000,
		});
		client.on("stderr", (text) => records.push({ appServerStderr: text }));
		client.on("error", (error) =>
			records.push({ appServerError: String(error) }),
		);
		let connections = 0;
		const server = createServer((_request, response) => {
			connections += 1;
			response.end("local-only");
		});
		try {
			client.start();
			records.push({ launch });
			records.push({
				method: "initialize",
				result: await client.request("initialize", {
					clientInfo: { name: "factory-context-proof", version: "1" },
					capabilities: { experimentalApi: true },
				}),
			});
			const effective = await client.request("config/read", {
				cwd,
				includeLayers: false,
			});
			records.push({ method: "config/read", result: effective });
			const nativeConfig = (
				effective as {
					config: { mcp_servers?: Record<string, { enabled?: boolean }> };
				}
			).config;
			const inherited = Object.entries(nativeConfig.mcp_servers ?? {})
				.filter(
					([name, server]) =>
						name !== "factory-context" && server.enabled !== false,
				)
				.map(([name]) => name);
			if (inherited.length) {
				expect(() => assertContextOnlyNativeConfig(effective, config)).toThrow(
					"inherited MCP server is enabled",
				);
				records.push({ inheritedMcpRejectedBeforeThread: inherited });
			} else assertContextOnlyNativeConfig(effective, config);
			await client.close();
			const permissions = launch.args.find((arg) =>
				arg.startsWith("permissions="),
			)!;
			const sandbox = [
				"sandbox",
				"-c",
				permissions,
				"-P",
				CONTEXT_ONLY_PROFILE,
				"-C",
				cwd,
				"--",
			];
			const runtime = await command([
				...sandbox,
				"/bin/echo",
				"minimal-runtime-works",
			]);
			expect(runtime.code).toBe(0);
			expect(runtime.stdout).toBe("minimal-runtime-works\n");
			const read = await command([...sandbox, "/bin/cat", secret]);
			expect(read.code).not.toBe(0);
			expect(read.stdout).toBe("");
			expect(read.stderr).toMatch(/permitted|denied/i);
			const write = await command([
				...sandbox,
				"/bin/sh",
				"-c",
				'printf unsafe > "$1"',
				"context-proof",
				secret,
			]);
			expect(write.code).not.toBe(0);
			expect(readFileSync(secret, "utf8")).toBe("isolated-test-secret");
			const cwdWrite = await command([
				...sandbox,
				"/bin/sh",
				"-c",
				'printf unsafe > "$1"',
				"context-proof",
				join(cwd, "new-file"),
			]);
			expect(cwdWrite.code).not.toBe(0);
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing local proof address");
			const target = `http://127.0.0.1:${address.port}/`;
			const control = await run(
				"/usr/bin/curl",
				["--silent", "--show-error", "--max-time", "2", target],
				{ env },
			);
			expect(control.stdout).toBe("local-only");
			expect(connections).toBe(1);
			const network = await command([
				...sandbox,
				"/usr/bin/curl",
				"--silent",
				"--show-error",
				"--max-time",
				"2",
				target,
			]);
			expect(network.code).not.toBe(0);
			expect(connections).toBe(1);
			records.push({
				result: "PASS",
				modelCalls: 0,
				threadStarts: 0,
				nativeVersion: version.stdout.trim(),
				binarySha256: createHash("sha256")
					.update(readFileSync(realpathSync(binary!)))
					.digest("hex"),
				scope:
					"native configuration and OS sandbox, not a live model/tool turn",
			});
		} finally {
			await client.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			writeFileSync(
				join(evidence, "receipt.json"),
				JSON.stringify(records, null, 2),
			);
			rmSync(root, { recursive: true, force: true });
		}
	},
	20_000,
);
