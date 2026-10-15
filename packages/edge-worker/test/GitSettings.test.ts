import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { executeCommand } from "../src/factory/FactoryTools.js";
import {
	GitSettings,
	gitAgentEnvironment,
} from "../src/factory/GitSettings.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const roots: string[] = [];
const agents: number[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const pid of agents.splice(0)) process.kill(pid, "SIGTERM");
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "git-agent-"));
	roots.push(home);
	const socket = join(home, "agent.sock");
	const output = execFileSync("ssh-agent", ["-a", socket, "-s"], {
		encoding: "utf8",
	});
	agents.push(Number(/SSH_AGENT_PID=(\d+)/.exec(output)![1]));
	return { home, socket };
}

it("tests and persists a UI-selected socket without changing the worker environment, rejects stale/invalid saves and restores inheritance", async () => {
	const { home, socket } = fixture();
	vi.stubEnv("SSH_AUTH_SOCK", join(home, "wrong-agent"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
	});
	try {
		const initial = (await server.app.inject({ url: "/api/config" })).json();
		expect(initial.gitSettings).toMatchObject({
			socket: null,
			revision: 0,
			effectiveSocket: process.env.SSH_AUTH_SOCK,
			available: false,
		});
		const empty = await server.app.inject({
			method: "POST",
			url: "/api/git-settings/test",
			headers: { "x-factory-request": "1" },
			payload: { socket },
		});
		expect(empty.json()).toMatchObject({ ready: false, keys: 0 });
		expect(gitAgentEnvironment(home)).toEqual({});
		const saved = await server.app.inject({
			method: "PUT",
			url: "/api/git-settings",
			headers: { "x-factory-request": "1" },
			payload: { socket, expectedRevision: 0 },
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json().gitSettings).toMatchObject({
			socket,
			revision: 1,
			effectiveSocket: socket,
		});
		expect(new GitSettings(home).read()).toEqual({ socket, revision: 1 });
		expect(gitAgentEnvironment(home)).toEqual({ SSH_AUTH_SOCK: socket });
		expect(process.env.SSH_AUTH_SOCK).toBe(join(home, "wrong-agent"));
		const stale = await server.app.inject({
			method: "PUT",
			url: "/api/git-settings",
			headers: { "x-factory-request": "1" },
			payload: { socket: null, expectedRevision: 0 },
		});
		expect(stale.statusCode).toBe(409);
		const invalid = await server.app.inject({
			method: "PUT",
			url: "/api/git-settings",
			headers: { "x-factory-request": "1" },
			payload: { socket: join(home, "missing"), expectedRevision: 1 },
		});
		expect(invalid.statusCode).toBe(409);
		const relative = await server.app.inject({
			method: "PUT",
			url: "/api/git-settings",
			headers: { "x-factory-request": "1" },
			payload: { socket: "relative/agent", expectedRevision: 1 },
		});
		expect(relative.statusCode).toBe(400);
		const clear = await server.app.inject({
			method: "PUT",
			url: "/api/git-settings",
			headers: { "x-factory-request": "1" },
			payload: { socket: null, expectedRevision: 1 },
		});
		expect(clear.statusCode).toBe(200);
		expect(gitAgentEnvironment(home)).toEqual({});
	} finally {
		await server.app.close();
	}
});

it("repairs signed Factory commands on retry while preserving an explicit execution environment", async () => {
	const { home, socket } = fixture();
	const key = join(home, "key");
	execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", key], {
		stdio: "ignore",
	});
	execFileSync("ssh-add", [key], {
		env: { ...process.env, SSH_AUTH_SOCK: socket },
		stdio: "ignore",
	});
	vi.stubEnv("SSH_AUTH_SOCK", fixture().socket);
	vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
	vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
	const repository = join(home, "repo");
	mkdirSync(repository);
	execFileSync("git", ["init", "-q", repository]);
	const tree = execFileSync("git", ["-C", repository, "mktree"], {
		input: "",
		encoding: "utf8",
	}).trim();
	const context = {
		factoryHome: home,
		run: {
			id: "retained",
			title: "Signing check",
			repositoryId: "fixture",
			workspace: repository,
			outputs: {},
		},
		input: {},
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: home,
	} as ExecutionContext;
	const args = [
		"-c",
		"user.name=F1",
		"-c",
		"user.email=f1@example.invalid",
		"-c",
		"gpg.format=ssh",
		"-c",
		`user.signingkey=${readFileSync(`${key}.pub`, "utf8").trim()}`,
		"commit-tree",
		"-S",
		tree,
		"-m",
		"Signing check",
	];
	await expect(executeCommand(context, "git", args)).rejects.toThrow(
		"Couldn't find key in agent",
	);
	const settings = new GitSettings(home);
	settings.save({ socket, expectedRevision: 0 });
	expect(await settings.test({ socket })).toMatchObject({
		ready: true,
		keys: 1,
	});
	const commit = await executeCommand(context, "git", args);
	expect(
		execFileSync("git", ["-C", repository, "cat-file", "commit", commit], {
			encoding: "utf8",
		}),
	).toContain("gpgsig -----BEGIN SSH SIGNATURE-----");
	context.execution = {
		environment: { ...process.env },
		redact: (value: string) => value,
	} as ExecutionContext["execution"];
	await expect(executeCommand(context, "git", args)).rejects.toThrow(
		"Couldn't find key in agent",
	);
	settings.save({ socket: null, expectedRevision: 1 });
	context.execution = undefined;
	await expect(executeCommand(context, "git", args)).rejects.toThrow(
		"Couldn't find key in agent",
	);
});
