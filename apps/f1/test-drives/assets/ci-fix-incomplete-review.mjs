// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/ci-fix-incomplete-review.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { FactoryTools } from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { githubApiReceipt } from "../../../../packages/edge-worker/test/fixtures/github-api.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(mkdtempSync(join(tmpdir(), "f1-ci-review-")));
const home = join(directory, "home"),
	repo = join(directory, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "F1 fixture");
git(repo, "config", "user.email", "f1@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(join(repo, "feature.txt"), "Fixture feature\n");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\nAGENTS.md\nCLAUDE.md\n",
);
git(repo, "add", ".");
git(repo, "commit", "-qm", "Initial fixture");
git(repo, "remote", "add", "origin", repo);
const base = git(repo, "rev-parse", "HEAD");
process.env.BOBS_FACTORY_FACTORY_PORT = "3541";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-capacity",
);
const tracker = createCLIIssueTracker(),
	turns = [],
	receipts = [];
const conflicts = new Set();
let worker, runtime;
const agent = (id, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	runner: "codex",
	prompt: "Execute only this fixture role.",
	...extra,
});
const workflow = {
	id: "ci-review-recovery",
	name: "CI review recovery",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		agent("scope", { reviewContract: "inventory-v1", askQuestions: true }),
		{
			id: "experts",
			name: "Experts",
			type: "fanout",
			review: { inventory: "scope" },
			groups: [[agent("business", { reviewContract: "coverage-v1" })]],
		},
		{
			id: "gate",
			name: "Aggregate review",
			type: "tool",
			tool: "review-gate",
			review: { inventory: "scope", fanout: "experts" },
		},
		agent("hold", { askQuestions: true, next: "end" }),
		{
			id: "ci",
			name: "CI",
			type: "tool",
			tool: "ci",
			next: "end",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
		},
		agent("ci-fix", { next: "after-ci-fix" }),
		{
			id: "after-ci-fix",
			name: "Review corrected work",
			type: "tool",
			tool: "review-after-fix",
			next: "end",
			branches: [
				{ when: { path: "reviewRequired", equals: true }, next: "scope" },
			],
		},
	],
};
const source = { source: "originalInput", reference: "/" };
const config = {
	factoryHome: home,
	serverHost: "127.0.0.1",
	serverPort: 3600,
	defaultRunner: "codex",
	issueTrackerFactory: () => tracker,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "fixture-no-provider-token" },
	},
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: "https://github.com/test/repo",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		createAgentRunner: (_type, runnerConfig) => {
			const run = [...runtime.runs.values()].find(
				(r) =>
					r.status === "running" &&
					r.workspace === runnerConfig.workingDirectory,
			);
			if (!run)
				return new MockAgentRunner(
					runnerConfig,
					JSON.stringify({ title: "F1 recovery" }),
				);
			const role = run.step.split("/").at(-1);
			turns.push({ run: run.id, role });
			let output;
			if (role === "scope")
				output = {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion: "Preserve fixture feature",
							classification: "active",
							sources: [source],
						},
					],
					decisions: [],
					conflicts: [],
					sourceReceipt: { considered: [source], unavailable: [] },
					questions: [],
				};
			else if (role === "business")
				output = {
					status: "completed",
					summary: "Fixture feature verified",
					findings: [],
					blockers: [],
					coverage: [
						{
							requirementId: "R1",
							status: "met",
							evidence: ["feature.txt"],
							reason: "Feature is retained",
						},
					],
				};
			else if (role === "ci-fix") {
				conflicts.delete(run.id); // Script the provider/correction boundary only.
				output = {
					summary: "Fixture conflict repaired",
					checks: [],
					reviewRequired: true,
				};
			} else if (role === "hold")
				output = {
					summary: "Review complete; acceptance remains separate",
					questions: ["Inspect fixture evidence"],
				};
			else throw new Error(`Unexpected role ${role}`);
			return new MockAgentRunner(runnerConfig, JSON.stringify(output));
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (context, exe, args) => {
			if (exe === "git") return git(context.run.workspace, ...args);
			assert.equal(exe, "bobs-factory:github-api");
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid: git(context.run.workspace, "rev-parse", "HEAD"),
					baseRefOid: base,
					mergeable: conflicts.has(context.run.id)
						? "CONFLICTING"
						: "MERGEABLE",
				}),
			);
		},
	});
	// Keep the real runtime, agent, tracking and server paths; script only forge I/O.
	runtime.hooks.tool = (context) => tools.tool(context);
}
async function rpc(method, params) {
	const response = await fetch("http://127.0.0.1:3600/cli/rpc", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const result = await response.json();
	assert(!result.error, JSON.stringify(result));
	return result.result;
}
async function waitForHold(id) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const run = runtime.runs.get(id);
		assert.notEqual(run?.status, "failed", run?.error);
		if (run?.status === "waiting" && run.step === "hold") return run;
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	throw new Error(`Run ${id} did not reach its review checkpoint`);
}
try {
	construct();
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow], workflow.id);
	await worker.start();
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Recover CI correction with unfinished specialist review",
		description: "Preserve fixture feature",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	const fresh = await waitForHold(session.sessionId);
	const original = JSON.parse(
		JSON.stringify(fresh.history.find((h) => h.step === "gate")),
	);
	for (const state of ["missing", "superseded"]) {
		const run = runtime.create({
			id: `saved-${state}`,
			repositoryId: "fixture",
			workspace: fresh.workspace,
			workflow: fresh.workflow,
			workflowDefinitions: fresh.workflowDefinitions,
			input: fresh.input,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
		run.setupComplete = true;
		run.repositories = structuredClone(fresh.repositories);
		run.outputs = structuredClone(fresh.outputs);
		run.outputs["draft-pr"] = { url: "https://github.com/test/repo/pull/1" };
		run.history = structuredClone(
			state === "missing"
				? fresh.history.filter((h) => h.step !== "gate")
				: fresh.history,
		);
		run.reviewRounds = structuredClone(fresh.reviewRounds);
		if (state === "superseded")
			run.reviewRounds.push({
				...structuredClone(run.reviewRounds[0]),
				round: 2,
			});
		run.checkpoint = {
			current: "ci-fix",
			visits: { "ci-fix": 1 },
			reviewKey: "experts",
			active: { phase: "executing" },
		};
		run.status = "failed";
		run.error =
			"Latest configured specialist round has no complete aggregate; approval is blocked";
		conflicts.add(run.id);
		await runtime.save(run);
	}
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	for (const state of ["missing", "superseded"]) {
		const id = `saved-${state}`;
		const response = await fetch(`http://127.0.0.1:3541/api/runs/${id}/retry`, {
			method: "POST",
			headers: {
				Origin: "http://127.0.0.1:3541",
				"X-Factory-Request": "1",
				"Content-Type": "application/json",
			},
			body: "{}",
		});
		assert.equal(response.status, 202, await response.text());
		const saved = await waitForHold(id);
		assert.deepEqual(
			turns.filter((t) => t.run === id).map((t) => t.role),
			["ci-fix", "scope", "business", "hold"],
		);
		assert.equal(
			saved.history.find((h) => h.step === "after-ci-fix").output
				.reviewRequired,
			true,
		);
		assert.equal(saved.outputs.gate.approved, true);
		assert.equal(
			saved.outputs.gate.baseline.round,
			state === "missing" ? 2 : 3,
		);
		assert.equal(saved.humanDecisions?.length ?? 0, 0);
		if (state === "superseded")
			assert.deepEqual(
				JSON.parse(
					JSON.stringify(saved.history.find((h) => h.step === "gate")),
				),
				original,
			);
		receipts.push({
			id,
			status: saved.status,
			round: saved.outputs.gate.baseline.round,
			historyPreserved: true,
			humanApprovals: 0,
		});
	}
	const activities = await rpc("viewSession", {
		sessionId: session.sessionId,
		limit: 200,
		offset: 0,
	});
	writeFileSync(
		join(directory, "receipt.json"),
		JSON.stringify({ receipts, turns, activities }, null, 2),
	);
	assert(
		activities.activities.some(
			(a) => a.type === "thought" && a.content.includes("Routing"),
		),
	);
	assert(
		activities.activities.some(
			(a) =>
				a.type === "response" && a.content.includes("Inspect fixture evidence"),
		),
	);
	console.log(JSON.stringify({ passed: true, directory, receipts }));
} finally {
	await worker?.stop();
}
