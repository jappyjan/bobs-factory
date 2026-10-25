// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-io-b6.mjs
// Real CLI tracker/EdgeWorker/registry with a scripted Git provider; no paid calls.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = process.cwd(),
	home = mkdtempSync(join(tmpdir(), "f1-io-b6-")),
	repo = join(home, "repo");
mkdirSync(repo);
const git = (...args) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git("init", "-qb", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.test");
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "README"), "Isolated B6 fixture\n");
git("add", ".");
git("commit", "-qm", "fixture");
git("remote", "add", "origin", repo);
git("fetch", "origin");
const socket = createServer();
await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
process.env.BOBS_FACTORY_FACTORY_PORT = "0";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"empty-legacy-capacity",
);
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
await import(
	join(root, "packages/edge-worker/node_modules/reflect-metadata/Reflect.js")
);
const { createCLIIssueTracker } = await import(
	join(root, "packages/core/dist/index.js")
);
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { f1AgentHandlers } = await import(
	join(root, "apps/f1/dist/src/MockAgentRunner.js")
);
const worker = new EdgeWorker({
	issueTrackerFactory: createCLIIssueTracker,
	platform: "cli",
	factoryHome: home,
	serverPort: port,
	serverHost: "127.0.0.1",
	defaultRunner: "claude",
	handlers: f1AgentHandlers("mock", "{}"),
	repositories: [
		{
			id: "fixture",
			name: "IO F1",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			githubUrl: "https://github.com/f1/fixture",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
});
const runtime = worker.getFactoryRuntime();
runtime.updateWorkflows([
	...runtime.workflows,
	{
		id: "io-b6",
		name: "IO B6",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		labels: ["workflow:io-b6"],
		allowedTriggers: ["ticket-assignment"],
		steps: [
			{
				id: "agent",
				name: "Mock fixture",
				type: "agent",
				prompt: "Return {} for this controlled fixture.",
			},
			{ id: "read", name: "Read ticket", type: "ticket", op: "read" },
			{
				id: "comment",
				name: "Explicit comment",
				type: "ticket",
				op: "comment",
				reads: { body: "read/title" },
			},
			{
				id: "status",
				name: "Explicit status",
				type: "ticket",
				op: "set-status",
				statusType: "started",
			},
			{
				id: "exec",
				name: "Command",
				type: "exec",
				command: "/bin/echo",
				args: ['{"value":42}'],
				json: true,
			},
			{
				id: "merge",
				name: "Merge",
				type: "merge",
				requests: [
					{
						repositoryId: "fixture",
						url: "https://github.com/f1/fixture/pull/1",
						headSha: "fixture-head",
					},
				],
				pollInterval: 1,
			},
		],
	},
]);
let merged = false,
	mergeCalls = 0;
runtime.hooks.ioGitProvider = async () => ({
	readiness: async () => ({ mergeMethod: "squash" }),
	view: async () => ({
		state: merged ? "MERGED" : "OPEN",
		headRefOid: "fixture-head",
		mergeCommitSha: merged ? "fixture-merge" : undefined,
		isDraft: false,
	}),
	merge: async () => {
		mergeCalls++;
		merged = true;
	},
});
const exec = promisify(execFile);
const f1 = async (...args) =>
	(
		await exec(join(root, "apps/f1/f1"), args, {
			cwd: root,
			env: { ...process.env, BOBS_FACTORY_PORT: String(port) },
			timeout: 20000,
		})
	).stdout.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
let id;
try {
	await worker.start();
	await f1("ping");
	const created = await f1(
		"create-issue",
		"--title",
		"B6 explicit IO",
		"--description",
		"Exercise registered IO nodes.",
		"--labels",
		"workflow:io-b6,claude",
	);
	const issueId = created.match(/ID: (issue-\d+)/)?.[1];
	assert.ok(issueId, created);
	const started = await f1("start-session", "--issue-id", issueId);
	id = started.match(/Session ID: (session-\d+)/)?.[1];
	assert.ok(id, started);
	for (let count = 0; count < 1200; count++) {
		const run = runtime.runs.get(id);
		assert.notEqual(run?.status, "failed", run?.error);
		if (run?.status === "completed") break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const run = runtime.get(id);
	assert.equal(run.status, "completed", run.error);
	assert.equal(run.outputs.exec.json.value, 42);
	assert.equal(run.outputs.comment.ok, true);
	assert.equal(run.outputs.status.ok, true);
	assert.deepEqual(run.outputs.merge.repositories, [
		{
			repositoryId: "fixture",
			merged: true,
			sha: "fixture-merge",
			url: "https://github.com/f1/fixture/pull/1",
		},
	]);
	assert.equal(mergeCalls, 1);
	assert.equal(run.ticketSync, undefined);
	const ticket = await (
		await worker.factoryTicketIO(
			run,
			run.ticketReference,
			new AbortController().signal,
		)
	).read();
	assert.equal(
		ticket.comments.filter((comment) =>
			comment.body.includes("<!-- factory-ticket:"),
		).length,
		1,
	);
	assert.equal(ticket.state.type, "started");
	const activities = await f1("view-session", "--session-id", id);
	assert.ok(activities.includes("claude/f1-mock"), activities);
	const receipt = {
		result: "PASS",
		home,
		id,
		nodes: run.history.map((item) => item.step),
		commentCount: 1,
		mergeCalls,
		implicitMilestones: 0,
		paidCalls: 0,
	};
	writeFileSync(join(home, "result.json"), JSON.stringify(receipt, null, 2));
	writeFileSync(join(home, "activities.txt"), activities);
	console.log(JSON.stringify(receipt));
} finally {
	if (id) {
		try {
			await f1("stop-session", "--session-id", id);
		} catch {
			runtime.stop(id);
		}
	}
	await worker.stop();
}
