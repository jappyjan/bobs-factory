// Real EdgeWorker/Git/retention setup; every provider and title turn is mocked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { f1AgentHandlers } from "../../../src/MockAgentRunner.ts";

const home = mkdtempSync(join(tmpdir(), "f1-takeover-reuse-"));
const repo = join(home, "repo");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
git("init", "-b", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "# Existing work must survive\n");
git("add", ".");
git(
	"-c",
	"commit.gpgsign=false",
	"-c",
	"core.hooksPath=/dev/null",
	"commit",
	"-m",
	"Fixture",
);
git("remote", "add", "origin", repo);
const repository = {
	id: "fixture",
	name: "Reuse fixture",
	repositoryPath: repo,
	baseBranch: "main",
	workspaceBaseDir: join(home, "worktrees"),
	isActive: true,
	linearWorkspaceId: "cli-workspace",
};
const port = Number(process.env.BOBS_FACTORY_F1_REUSE_PORT ?? 3640);
const previousPort = process.env.BOBS_FACTORY_FACTORY_PORT;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
const worker: any = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: port + 1,
	serverHost: "localhost",
	defaultRunner: "codex",
	issueTrackerFactory: createCLIIssueTracker,
	repositories: [repository],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: f1AgentHandlers(
		"mock",
		JSON.stringify({
			decisions: [],
			requirements: ["Preserve existing work"],
			completed: ["Existing commit retained"],
			remaining: [],
			risks: [],
			assets: [],
			questions: ["Fixture: wait for human decision"],
		}),
	),
});
try {
	await worker.start();
	const tracker = worker.issueTrackers.get("cli-workspace");
	const ticket = await tracker.createIssue({
		teamId: "team-default",
		title: "Continue existing work",
		description: "Preserve this branch and worktree",
	});
	const original = await worker.gitService.createGitWorktree(
		{ ...ticket, id: "old-run", identifier: "OLD-1" },
		[repository],
	);
	writeFileSync(
		join(original.path, "retained.txt"),
		"uncommitted work stays intact\n",
	);
	const head = execFileSync("git", ["-C", original.path, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	const runtime = worker.getFactoryRuntime();
	// The isolated ticket has no hosted PR provider. Supply only that read-only
	// existing-work observation; Git preparation, retention and tracker binding stay real.
	const tool = runtime.hooks.tool;
	runtime.hooks.tool = async (context: any) =>
		context.step.tool === "inspect-existing"
			? {
					ticket: context.run.ticketSnapshot,
					branch: ticket.branchName,
					head,
					diff: "",
					status: "retained worktree",
				}
			: tool(context);
	const version = await (
		await fetch(`http://localhost:${port}/api/version`)
	).json();
	const response = await fetch(`http://localhost:${port}/api/runs`, {
		method: "POST",
		headers: {
			Origin: `http://localhost:${port}`,
			"X-Factory-Request": "1",
			"X-Factory-Build": version.build,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			repositoryId: "fixture",
			workflow: "takeover",
			source: ticket.url,
			prompt: "Continue this ticket's existing work and retain its branch.",
			runner: "codex",
			model: "gpt-6.1-sol",
		}),
	});
	const receipt = await response.json();
	assert.equal(response.status, 202, JSON.stringify(receipt));
	const run = runtime.get(receipt.id);
	const deadline = Date.now() + 30000;
	while (run.status === "running" && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(run.setupComplete, true, run.error);
	assert.equal(run.workspace, original.path);
	assert.equal(run.ticketReference.id, ticket.id);
	assert.equal(run.status, "waiting", run.error);
	assert.ok(run.history.some((entry: any) => entry.step === "assess-existing"));
	assert.equal(
		readFileSync(join(original.path, "retained.txt"), "utf8"),
		"uncommitted work stays intact\n",
	);
	assert.equal(
		execFileSync("git", ["-C", original.path, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		head,
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			home,
			runId: run.id,
			setupComplete: true,
			existingWorkspacePreserved: true,
			head,
			trackerBound: true,
			reachedHumanQuestions: true,
			inferenceCalls: 0,
		}),
	);
} finally {
	process.env.BOBS_FACTORY_FACTORY_PORT = previousPort;
	await worker.stop();
}
