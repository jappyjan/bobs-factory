// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/role-finalization-recovery.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { FactoryTools } from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { STALE_IMPACT_MESSAGE } from "../../../../packages/edge-worker/dist/factory/Impact.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-role-publication-")),
);
const home = join(directory, "home"),
	repo = join(directory, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (...args) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "f1@example.invalid");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\n.opencode/\nCLAUDE.md\nAGENTS.md\n",
);
git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "-qm", "Initial fixture");
git("remote", "add", "origin", repo);
process.env.BOBS_FACTORY_FACTORY_PORT = "3540";
const tracker = createCLIIssueTracker();
const output = {
	questions: [],
	summary: "Fixture role completed",
	decisions: [
		{
			question: "Which target?",
			answer: "Keep the fixture target",
			reason: "Accepted fixture instruction",
		},
	],
};
let agentTurns = 0,
	worker,
	runtime;
const mock = f1AgentHandlers("mock", JSON.stringify(output));
const config = {
	factoryHome: home,
	serverPort: 3600,
	serverHost: "127.0.0.1",
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
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		createAgentRunner: (type, config) => {
			if (!config.workingDirectory?.includes("/title-jobs/")) agentTurns++;
			const stale = runtime?.runs.get("stale-impact");
			if (
				stale?.step === "pipeline/assess-impact" &&
				config.workingDirectory === stale.workspace
			) {
				const pipeline = stale.workflowDefinitions.find(
					(w) => w.id === "factory-pipeline",
				);
				const reviewers = pipeline.steps
					.find((s) => s.id === "specialist-review")
					.groups.flat()
					.map((s) => s.id);
				return f1AgentHandlers(
					"mock",
					JSON.stringify({
						impactContract: "impact-v1",
						status: "blocked",
						summary: "Fresh fixture assessment needs access",
						classification: "full",
						rationale: "Environment changed; require fresh verification",
						uncertainty: ["Fixture environment access"],
						extractRequirements: true,
						specialists: reviewers,
						requirementIds: [],
						checks: [],
						qaCriteria: [],
						reuse: [],
						invalidate: [],
						targetCompatible: true,
						testAssertions: {
							inspected: true,
							weakened: false,
							evidence: "Mock fixture inspection",
						},
						humanReview: "no-prior-approval",
						approvalRationale: "No human approval supplied",
						questions: ["Restore the fixture environment"],
					}),
				).createAgentRunner(type, config);
			}
			return mock.createAgentRunner(type, config);
		},
	},
};
const workflow = {
	id: "publication-fixture",
	name: "Publication fixture",
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		{
			id: "clarify",
			name: "Fixture role",
			type: "agent",
			runner: "codex",
			askQuestions: true,
			prompt: "Return the deterministic fixture response.",
		},
		{
			id: "decisions",
			name: "Record decisions",
			type: "tool",
			tool: "record-decisions",
		},
		{ id: "after", name: "Advance", type: "script", script: "printf advanced" },
	],
};
async function until(check, message) {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(message);
}
async function rpc(method, params = {}) {
	const response = await fetch("http://localhost:3600/cli/rpc", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const result = await response.json();
	assert(!result.error, JSON.stringify(result.error));
	return result.result;
}
let rejectPublication,
	publicationStarted = false;
const publication = new Promise((_, reject) => {
	rejectPublication = reject;
});
void publication.catch(() => {});
function construct(blocked) {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
	const adapter = worker.factoryTicketAdapter.bind(worker);
	worker.factoryTicketAdapter = async (run) => {
		const native = await adapter(run);
		return {
			...native,
			publish: async (_receipt, body) => {
				if (blocked) {
					publicationStarted = true;
					await publication;
				} else await native.comment(body);
			},
		};
	};
}
try {
	construct(true);
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow], workflow.id);
	await worker.start();
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Role finalization with stalled publication",
		description:
			"Exercise deterministic role output, decision persistence and continuation.",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	await until(
		() => runtime.runs.get(session.sessionId)?.status === "completed",
		"Fresh role stalled behind publication",
	);
	const fresh = runtime.get(session.sessionId);
	assert(publicationStarted);
	assert.equal(fresh.outputs.after.stdout, "advanced");
	assert.equal(agentTurns, 1);
	assert(
		fresh.ticketSync.receipts.some((r) => r.key.startsWith("role-outcome:")),
	);
	assert(fresh.ticketSync.receipts.some((r) => r.key.startsWith("comment:")));
	assert(fresh.ticketSync.receipts.every((r) => !r.delivered));
	await runtime.flush();
	writeFileSync(join(directory, "fresh.json"), JSON.stringify(fresh, null, 2));
	const activity = await (
		await fetch(`http://localhost:3540/api/runs/${fresh.id}/activity?limit=200`)
	).json();
	assert(activity.entries.some((entry) => entry.type === "result"));
	writeFileSync(
		join(directory, "activity.json"),
		JSON.stringify(activity, null, 2),
	);
	const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: fresh.workspace,
		encoding: "utf8",
	}).trim();
	const saved = runtime.create({
		id: "saved-finalizing-role",
		repositoryId: "fixture",
		workspace: fresh.workspace,
		workflow: fresh.workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	saved.outputs.ticket = structuredClone(fresh.outputs.ticket);
	saved.ticketReference = structuredClone(fresh.ticketReference);
	saved.checkpoint = {
		current: "clarify",
		visits: { clarify: 1 },
		active: {
			phase: "executing",
			agent: {
				runner: "codex",
				sessionId: "retained-fixture-conversation",
				result: {
					output,
					revision: {
						headSha,
						dirty: false,
						historyLength: 0,
						at: saved.createdAt,
					},
					finalizing: true,
				},
			},
		},
	};
	await runtime.save(saved);
	await worker.stop();
	rejectPublication(new Error("Controlled publication outage"));
	await until(
		() => !worker.getTicketTracking().isBusy(),
		"Old publication queue did not settle",
	);
	await runtime.flush();
	construct(false);
	await worker.start();
	await until(
		() => runtime.get(saved.id).status === "completed",
		"Saved result did not recover",
	);
	await until(
		() =>
			!runtime.isExecuting(saved.id) &&
			runtime
				.get(saved.id)
				.ticketSync.receipts.every(
					(receipt) => receipt.delivered || receipt.superseded,
				),
		"Retained publications did not finish",
	);
	const recovered = runtime.get(saved.id);
	assert.equal(agentTurns, 1, "Completed role was replayed");
	assert.equal(
		recovered.checkpoint.agentSessions.clarify.sessionId,
		"retained-fixture-conversation",
	);
	assert.deepEqual(
		recovered.history.map((r) => r.step),
		["clarify", "decisions", "after"],
	);
	assert(
		recovered.ticketSync.receipts.every((r) => r.delivered || r.superseded),
	);
	await runtime.flush();
	writeFileSync(
		join(directory, "recovered.json"),
		JSON.stringify(recovered, null, 2),
	);
	const factory = runtime.selectWorkflow([], "manual", "factory");
	const stale = runtime.create({
		id: "stale-impact",
		input: "Reassess the retained fixture work after the environment changed.",
		repositoryId: "fixture",
		workspace: fresh.workspace,
		workflow: factory,
		workflowDefinitions: runtime.listWorkflows(),
		triggerOrigin: {
			type: "manual",
			workflowId: factory.id,
			at: new Date().toISOString(),
		},
	});
	stale.outputs.retained = { implementation: "Existing work" };
	stale.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "visual-gate",
					visits: { "visual-gate": 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	stale.status = "failed";
	stale.error = STALE_IMPACT_MESSAGE;
	await runtime.save(stale);
	const retry = await fetch(
		"http://localhost:3540/api/runs/stale-impact/retry",
		{
			method: "POST",
			headers: {
				Origin: "http://localhost:3540",
				"X-Factory-Request": "1",
				"Content-Type": "application/json",
			},
			body: "{}",
		},
	);
	assert.equal(retry.status, 202);
	await until(() => {
		const current = runtime.get(stale.id);
		assert.notEqual(current.status, "failed", current.error);
		return current.status === "waiting";
	}, "Stale impact retry did not renew assessment");
	const renewed = runtime.get(stale.id);
	assert.equal(renewed.step, "pipeline/assess-impact");
	assert.deepEqual(renewed.outputs.retained, {
		implementation: "Existing work",
	});
	assert.deepEqual(renewed.questions, ["Restore the fixture environment"]);
	assert.equal(renewed.impactDecisions.at(-1).status, "blocked");
	assert.equal(
		renewed.history.some((receipt) => receipt.step === "pipeline/visual-gate"),
		false,
	);
	assert.equal(
		agentTurns,
		2,
		"Only the independent assessor should execute for Retry",
	);
	await runtime.flush();
	writeFileSync(
		join(directory, "stale-retry.json"),
		JSON.stringify(renewed, null, 2),
	);
	runtime.stop(stale.id);
	const branch = execFileSync("git", ["branch", "--show-current"], {
		cwd: fresh.workspace,
		encoding: "utf8",
	}).trim();
	const takeover = runtime.create({
		id: "takeover-base",
		repositoryId: "fixture",
		workspace: fresh.workspace,
		workflow: runtime.selectWorkflow([], "manual", "takeover"),
		input: "Continue the existing fixture PR",
		repositories: [
			{
				id: "fixture",
				name: "Fixture",
				repositoryPath: repo,
				workspace: fresh.workspace,
				baseBranch: branch,
			},
		],
		triggerOrigin: {
			type: "manual",
			workflowId: "takeover",
			at: new Date().toISOString(),
		},
	});
	takeover.outputs.source = {
		url: "https://github.com/fixture/repo/pull/1",
		number: 1,
		headRefName: branch,
		baseRefName: "main",
		isDraft: true,
	};
	const tools = new FactoryTools({ postComment: async () => {} });
	await tools.tool({
		run: takeover,
		step: {
			id: "existing-work",
			name: "Inspect",
			type: "tool",
			tool: "inspect-existing",
			branches: [],
			maxVisits: 8,
		},
		input: {},
		signal: new AbortController().signal,
		evidenceDir: directory,
		log: (message) => runtime.log(takeover, "existing-work", message),
	});
	assert.equal(takeover.repositories[0].baseBranch, "main");
	assert.equal(
		execFileSync("git", ["branch", "--show-current"], {
			cwd: fresh.workspace,
			encoding: "utf8",
		}).trim(),
		branch,
	);
	assert.equal(
		takeover.outputs.source.url,
		"https://github.com/fixture/repo/pull/1",
	);
	await runtime.save(takeover);
	writeFileSync(
		join(directory, "takeover-base.json"),
		JSON.stringify(takeover, null, 2),
	);
	runtime.stop(takeover.id);
	console.log(
		`PASS: publication-independent fresh/saved roles and decisions; durable delivery recovery; stale-impact Retry renews its assessor and assistance gate; takeover retains the PR base and working branch. Evidence: ${directory}`,
	);
} finally {
	rejectPublication(new Error("Fixture cleanup"));
	await worker?.stop();
}
