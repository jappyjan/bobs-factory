// F1 dashboard + retained-run signing recovery. No live inference or hosted Git writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-git-agent-"));
const repository = join(home, "repository");
const evidence = process.env.F1_EVIDENCE_DIR!;
mkdirSync(repository);
mkdirSync(evidence, { recursive: true });
const agents: number[] = [];
function agent(name: string) {
	const socket = join(home, name);
	const output = execFileSync("ssh-agent", ["-a", socket, "-s"], {
		encoding: "utf8",
	});
	agents.push(Number(/SSH_AGENT_PID=(\d+)/.exec(output)![1]));
	return socket;
}
const emptySocket = agent("empty.sock");
const socket = agent("signing.sock");
const key = join(home, "signing-key");
execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", key], {
	stdio: "ignore",
});
execFileSync("ssh-add", [key], {
	env: { ...process.env, SSH_AUTH_SOCK: socket },
	stdio: "ignore",
});
process.env.SSH_AUTH_SOCK = emptySocket;
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repository, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.invalid");
writeFileSync(join(repository, "README.md"), "# Git agent recovery fixture\n");
git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "-qm", "Fixture");
git("config", "gpg.format", "ssh");
git("config", "user.signingkey", readFileSync(`${key}.pub`, "utf8").trim());
git("config", "commit.gpgsign", "true");
git("remote", "add", "origin", repository);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"old-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3649";
process.env.BOBS_FACTORY_FACTORY_ORIGIN = "https://git-agent.fixture.invalid";
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
const repositories = [
	{
		id: "fixture",
		name: "Git signing fixture",
		repositoryPath: repository,
		workspaceBaseDir: join(home, "worktrees"),
		baseBranch: "main",
		linearWorkspaceId: "cli-workspace",
		isActive: true,
	},
];
writeFileSync(join(home, "config.json"), JSON.stringify({ repositories }));
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	repositories,
	serverPort: 3650,
	serverHost: "127.0.0.1",
	handlers: f1AgentHandlers("mock"),
});
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await worker.stop();
	for (const pid of agents) process.kill(pid, "SIGTERM");
	process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await worker.start();
const runtime = (worker as any).getFactoryRuntime();
runtime.updateWorkflows([
	...runtime.listWorkflows(),
	{
		id: "signing-check",
		name: "Signing recovery check",
		description: "Sign an empty fixture commit",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "sign",
				name: "Signed commit",
				type: "tool",
				tool: "exec",
				args: [
					"git",
					"commit",
					"--allow-empty",
					"--no-verify",
					"-m",
					"test: agent recovery",
				],
			},
		],
	},
]);
const server = (worker as any).factoryServer;
for (const [method, url, payload] of [
	["PUT", "/api/git-settings", { socket, expectedRevision: 0 }],
	["POST", "/api/git-settings/test", { socket }],
] as const) {
	const response = await server.app.inject({
		method,
		url,
		payload,
		headers: {
			host: "git-agent.fixture.invalid",
			origin: "https://git-agent.fixture.invalid",
			"x-factory-request": "1",
		},
	});
	assert.equal(response.statusCode, 401);
}
const response = await fetch("http://localhost:3649/api/runs", {
	method: "POST",
	headers: {
		origin: "http://localhost:3649",
		"content-type": "application/json",
		"x-factory-request": "1",
	},
	body: JSON.stringify({
		repositoryId: "fixture",
		workflow: "signing-check",
		prompt: "Test signing with the configured agent",
	}),
});
assert.equal(response.status, 202, await response.clone().text());
const run = await response.json();
for (let attempt = 0; attempt < 100; attempt++) {
	if (runtime.get(run.id).status === "failed") break;
	await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(runtime.get(run.id).status, "failed");
assert.match(runtime.get(run.id).error, /Couldn't find key in agent/);
writeFileSync(
	join(evidence, "fixture.json"),
	JSON.stringify(
		{
			home,
			repository,
			socket,
			emptySocket,
			runId: run.id,
			workspace: runtime.get(run.id).workspace,
		},
		null,
		2,
	),
);
console.log(
	`READY http://localhost:3649 Run ${run.id}; inherited empty agent reproduced signing failure.`,
);
await new Promise(() => {});
