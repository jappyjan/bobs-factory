import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";
import { configuration, executeExec } from "../src/factory/nodes/exec.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

// On supported hosts enforcement tests must run; missing bubblewrap is a failure.
const supportedPlatform = ["darwin", "linux"].includes(process.platform);
beforeAll(() => {
	if (process.platform === "linux")
		expect(
			spawnSync("bwrap", ["--version"]).status,
			"Install bubblewrap to validate Linux exec access enforcement",
		).toBe(0);
});
const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function setup() {
	const home = mkdtempSync(join(tmpdir(), "factory-exec-"));
	homes.push(home);
	return {
		home,
		run: { id: "test", workspace: home } as ExecutionContext["run"],
	};
}
it.runIf(supportedPlatform)(
	"exec captures separate streams, nonzero exit, JSON and only allowed environment variables",
	async () => {
		const { run, home } = setup();
		process.env.B6_TEST_ALLOWED = "visible";
		process.env.B6_TEST_SECRET = "hidden";
		const context = {
			run,
			signal: new AbortController().signal,
		} as ExecutionContext;
		const result = await executeExec(
			context,
			configuration.parse({
				command: "/bin/sh",
				args: [
					"-c",
					'printf \'{"allowed":"%s","secret":"%s"}\' "$B6_TEST_ALLOWED" "$B6_TEST_SECRET"; printf error >&2; exit 7',
				],
				env: ["B6_TEST_ALLOWED"],
				json: true,
			}),
		);
		expect(result).toEqual({
			exitCode: 7,
			stdout: '{"allowed":"visible","secret":""}',
			stderr: "error",
			json: { allowed: "visible", secret: "" },
		});
		expect(existsSync(join(home, "unused"))).toBe(false);
		delete process.env.B6_TEST_ALLOWED;
		delete process.env.B6_TEST_SECRET;
		await expect(
			executeExec(
				context,
				configuration.parse({
					command: "/bin/echo",
					args: ["invalid"],
					json: true,
				}),
			),
		).rejects.toThrow();
	},
);
it.runIf(supportedPlatform)(
	"exec enforces read-only/workspace writes and terminates a timed-out process group",
	async () => {
		const { run, home } = setup();
		const context = {
			run,
			signal: new AbortController().signal,
		} as ExecutionContext;
		const outside = join(tmpdir(), `b6-outside-${Date.now()}`);
		const denied = await executeExec(
			context,
			configuration.parse({
				command: "/bin/sh",
				args: ["-c", "echo forbidden > blocked"],
			}),
		);
		expect(denied.exitCode).not.toBe(0);
		expect(existsSync(join(home, "blocked"))).toBe(false);
		const permitted = await executeExec(
			context,
			configuration.parse({
				command: "/bin/sh",
				args: ["-c", `echo allowed > allowed; echo forbidden > ${outside}`],
				access: "workspace",
			}),
		);
		expect(permitted.exitCode).not.toBe(0);
		expect(readFileSync(join(home, "allowed"), "utf8")).toBe("allowed\n");
		expect(existsSync(outside)).toBe(false);
		await expect(
			executeExec(
				context,
				configuration.parse({
					command: "/bin/sh",
					args: ["-c", "sleep 10"],
					timeout: 2000,
				}),
			),
		).rejects.toThrow("timed out");
	},
);

it.runIf(supportedPlatform)(
	"workspace exec commits in a linked worktree and writes only its private TMPDIR",
	async () => {
		const { run, home } = setup();
		const repo = join(home, "repo"),
			workspace = join(home, "linked");
		const git = (...args: string[]) =>
			execFileSync("git", args, {
				cwd: home,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		git("init", "-q", repo);
		git(
			"-C",
			repo,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--allow-empty",
			"-qm",
			"initial",
		);
		git("-C", repo, "worktree", "add", "-qb", "linked", workspace);
		run.workspace = workspace;
		const result = await executeExec(
			{ run, signal: new AbortController().signal } as ExecutionContext,
			configuration.parse({
				command: "/bin/sh",
				args: [
					"-ec",
					`
			printf test > file
			git add file
			git -c user.name=Test -c user.email=test@example.test -c commit.gpgsign=false commit -qm changed
			printf scratch > "$TMPDIR/scratch"
			printf '%s' "$TMPDIR"
		`,
				],
				access: "workspace",
			}),
		);
		expect(result, result.stderr).toMatchObject({ exitCode: 0 });
		expect(git("-C", workspace, "log", "-1", "--format=%s").trim()).toBe(
			"changed",
		);
		expect(existsSync(result.stdout)).toBe(false); // Scratch is removed after the command.
		expect(readFileSync(join(workspace, "file"), "utf8")).toBe("test");
	},
);
it.runIf(supportedPlatform)(
	"read-only exec blocks network writes while retaining host file reads",
	async () => {
		const { run, home } = setup();
		const secret = join(home, "host-readable");
		writeFileSync(secret, "host data");
		let requests = 0;
		const server = createServer((_request, response) => {
			requests++;
			response.end("written");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = server.address() as { port: number };
			const result = await executeExec(
				{ run, signal: new AbortController().signal } as ExecutionContext,
				configuration.parse({
					command: process.execPath,
					args: [
						"-e",
						`
				const fs = require('node:fs');
				if (fs.readFileSync(${JSON.stringify(secret)}, 'utf8') !== 'host data') process.exit(2);
				fetch('http://127.0.0.1:${address.port}', {method:'POST', signal: AbortSignal.timeout(1000)})
					.then(() => process.exit(3)).catch(() => process.exit(0));
			`,
					],
				}),
			);
			expect(result, result.stderr).toMatchObject({ exitCode: 0 });
			expect(requests).toBe(0);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	},
);
