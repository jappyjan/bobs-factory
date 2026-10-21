// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/workflow-stall-recovery.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryTools } from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import {
	aggregateForContext,
	validateInventory,
} from "../../../../packages/edge-worker/dist/factory/SpecialistReview.js";
import { stepVisitLimit } from "../../../../packages/edge-worker/dist/factory/StepVisitBudget.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-workflow-stalls-")),
);
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
git(repo, "config", "user.email", "fixture@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\n.opencode/\nAGENTS.md\nCLAUDE.md\n",
);
writeFileSync(join(repo, "source.txt"), "Committed source\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Historical target");
const historicalTarget = git(repo, "rev-parse", "HEAD");
writeFileSync(join(repo, "target.txt"), "Advanced live target\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Advance live target");
const liveTarget = git(repo, "rev-parse", "HEAD");
git(repo, "remote", "add", "origin", repo);
async function freePort() {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}
const rpcPort = await freePort(),
	factoryPort = await freePort();
const rpcOrigin = `http://127.0.0.1:${rpcPort}`;
const factoryOrigin = `http://localhost:${factoryPort}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-capacity",
);
const agent = (id, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	runner: "codex",
	prompt: "Return the deterministic fixture reply.",
	...extra,
});
const fixtureWorkflow = {
	id: "stall-fixture",
	name: "Stall recovery fixture",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		agent("entry", { askQuestions: true, next: "end" }),
		agent("inventory", { reviewContract: "inventory-v1", askQuestions: true }),
		{
			id: "specialist-review",
			name: "Specialist review",
			type: "fanout",
			review: { inventory: "inventory" },
			groups: [[agent("business", { reviewContract: "coverage-v1" })]],
		},
		{
			id: "review-gate",
			name: "Required independent review",
			type: "tool",
			tool: "review-gate",
			review: { inventory: "inventory", fanout: "specialist-review" },
			next: "end",
		},
		agent("code-fix", {
			askQuestions: true,
			inputs: ["input"],
			next: "review-gate",
		}),
	],
};
const providerWorkflow = {
	id: "provider-fixture",
	name: "Provider target fixture",
	allowedTriggers: ["manual"],
	steps: [
		{ id: "ci", name: "Inspect provider CI", type: "tool", tool: "ci" },
		agent("hold", { askQuestions: true, next: "end" }),
	],
};
const turns = [],
	providerRequests = [],
	contexts = [];
let worker, runtime;
const tracker = createCLIIssueTracker();
const config = {
	factoryHome: home,
	serverPort: rpcPort,
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
		createAgentRunner: (_type, runnerConfig) => {
			const run = [...runtime.runs.values()].find(
				(candidate) =>
					candidate.status === "running" &&
					candidate.workspace === runnerConfig.workingDirectory,
			);
			if (!run)
				return new MockAgentRunner(
					runnerConfig,
					JSON.stringify({ title: "F1 workflow recovery" }),
				);
			const role = run.step.split("/").at(-1);
			const context = loadFactoryContextSnapshot(
				runnerConfig.mcpConfig["factory-context"].args.at(-1),
			);
			turns.push({
				run: run.id,
				role,
				nativeSessionId: runnerConfig.resumeSessionId,
			});
			let output = {
				summary: "Controlled workflow checkpoint",
				questions: ["Inspect fixture evidence before proceeding"],
			};
			if (role === "code-fix") {
				assert.equal(context.reviewFix.review.status, "incomplete");
				assert.deepEqual(
					context.reviewFix.findings.map((finding) => finding.id),
					["business:F1"],
				);
				contexts.push({
					role,
					review: context.reviewFix.review,
					findingIds: context.reviewFix.findings.map((finding) => finding.id),
				});
				output = {
					summary:
						"Correction received retained findings; verification remains pending",
					dispositions: [],
					questions: [
						"Provide the controlled fixture needed to resolve the finding",
					],
				};
			}
			if (role === "clarify")
				output = {
					questions: ["Inspect fixture evidence before proceeding"],
					decisions: [],
					requirements: ["Preserve the controlled fixture behavior"],
				};
			return new MockAgentRunner(runnerConfig, JSON.stringify(output));
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
	const tools = new FactoryTools({
		command: async (context, executable, args) => {
			if (executable === "git") {
				assert(
					["rev-parse", "status", "fetch", "update-ref"].includes(args[0]),
					`Unexpected Git operation ${args[0]}`,
				);
				return git(context.run.workspace, ...args);
			}
			assert.equal(executable, "bobs-factory:github-api");
			const request = JSON.parse(args[0]);
			providerRequests.push({ method: request.method, path: request.path });
			if (request.path !== "graphql") {
				assert.equal(request.method, "GET");
				return "[]";
			}
			assert.match(request.body.query, /^query/);
			return JSON.stringify({
				data: {
					repository: {
						squashMergeAllowed: true,
						mergeCommitAllowed: true,
						rebaseMergeAllowed: false,
						pullRequest: {
							url: "https://github.com/fixture/repository/pull/1",
							title: "Fixture",
							headRefOid: git(context.run.workspace, "rev-parse", "HEAD"),
							baseRefOid: historicalTarget,
							baseRefName: "main",
							baseRef: { name: "main", target: { oid: liveTarget } },
							state: "OPEN",
							isDraft: true,
							mergeable: "MERGEABLE",
							mergeStateStatus: "BLOCKED",
							reviewDecision: "REVIEW_REQUIRED",
							reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
							statusCheckRollup: {
								contexts: {
									nodes: [{ name: "fixture-check", conclusion: "SUCCESS" }],
									pageInfo: { hasNextPage: false },
								},
							},
						},
					},
				},
			});
		},
	});
	// Keep EdgeWorker's native agent/finalizer and real runtime graph; script only
	// provider I/O while the CI tool executes its production implementation.
	runtime.hooks.tool = (context) => tools.tool(context);
}
async function until(check, message) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(message);
}
async function rpc(method, params = {}) {
	const response = await fetch(`${rpcOrigin}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const result = await response.json();
	assert(!result.error, JSON.stringify(result));
	return result.result;
}
async function retry(id) {
	const response = await fetch(`${factoryOrigin}/api/runs/${id}/retry`, {
		method: "POST",
		headers: {
			Origin: factoryOrigin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: "{}",
	});
	assert.equal(response.status, 202, await response.text());
}
function waiting(id, step) {
	const run = runtime.runs.get(id);
	if (!run) return false;
	assert.notEqual(run.status, "failed", run.error);
	return run.status === "waiting" && run.step === step;
}
try {
	construct();
	runtime.updateWorkflows(
		[...runtime.listWorkflows(), fixtureWorkflow, providerWorkflow],
		fixtureWorkflow.id,
	);
	await worker.start();
	assert(await rpc("ping"));
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Recover retained workflow state",
		description: "Deterministic workflow recovery and approval boundaries",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	await until(
		() => waiting(session.sessionId, "entry"),
		"Issue session did not reach its fixture checkpoint",
	);
	const retained = runtime.get(session.sessionId),
		workspace = retained.workspace;
	const at = retained.updatedAt,
		headSha = git(workspace, "rev-parse", "HEAD");
	const source = { source: "originalInput", reference: "/input" };
	const inventory = validateInventory({
		schemaVersion: 1,
		requirements: [
			{
				id: "R1",
				criterion: "Preserve the required fixture behavior",
				classification: "active",
				sources: [source],
			},
		],
		decisions: [],
		conflicts: [],
		sourceReceipt: { considered: [source], unavailable: [] },
		questions: [],
	});
	const baseline = {
		schemaVersion: 1,
		round: 1,
		key: "specialist-review",
		inventory,
		headSha,
		baseSha: liveTarget,
		historyLength: 0,
		reviewers: [
			{
				id: "business",
				key: "specialist-review/0/business",
				group: 0,
				contract: "coverage-v1",
			},
		],
		context: {},
		at,
	};
	const specialist = {
		status: "completed",
		blockers: [],
		summary: "Controlled unresolved fixture finding",
		findings: [
			{
				id: "F1",
				rating: 2,
				status: "open",
				summary: "Required fixture result is absent",
				evidence: "source.txt omits the fixture result",
				requirementIds: ["R1"],
			},
		],
		coverage: [
			{
				requirementId: "R1",
				status: "not_met",
				evidence: ["source.txt"],
				reason: "Fixture result is absent",
			},
		],
		stamp: {
			reviewer: "business",
			stepKey: "specialist-review/0/business",
			round: 1,
			inventoryDigest: inventory.digest,
			inventoryVersion: inventory.version,
			headSha,
			baseSha: liveTarget,
		},
	};
	retained.outputs = {
		inventory,
		"specialist-review": [{ business: specialist }],
	};
	retained.reviewRounds = [baseline];
	retained.history = [
		{ step: "specialist-review/0/business", output: specialist, at },
	];
	retained.questions = [];
	retained.status = "failed";
	retained.step = "code-fix";
	retained.error =
		"Latest configured specialist round has no complete aggregate; approval is blocked";
	retained.checkpoint = {
		current: "code-fix",
		visits: { "code-fix": 1 },
		active: {
			phase: "executing",
			agent: { runner: "codex", sessionId: "retained-code-fix" },
		},
	};
	await runtime.save(retained);
	const oldStock = structuredClone(defaultWorkflows);
	const halve = (steps) => {
		for (const step of steps) {
			if ([16, 200].includes(step.maxVisits)) step.maxVisits /= 2;
			for (const group of step.groups ?? []) halve(group);
		}
	};
	for (const workflow of oldStock) halve(workflow.steps);
	const budget = runtime.create({
		id: "saved-stock-budget",
		repositoryId: "fixture",
		workspace,
		workflow: oldStock.find((workflow) => workflow.id === "factory"),
		workflowDefinitions: oldStock,
		input: "Clarify the controlled fixture",
		triggerOrigin: { type: "manual", workflowId: "factory", at },
	});
	// New admissions intentionally resolve installed stock. Seed the historical
	// accepted snapshot directly to model an existing run loaded after an update.
	budget.workflow = structuredClone(
		oldStock.find((workflow) => workflow.id === "factory"),
	);
	budget.workflowDefinitions = oldStock;
	budget.status = "failed";
	budget.step = "pipeline/clarify";
	budget.error = "Iteration limit reached at pipeline/clarify (8 passes)";
	budget.iterationLimit = { step: budget.step, visits: 9, limit: 8 };
	budget.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "clarify",
					visits: { clarify: 9 },
					additionalVisits: { clarify: 4 },
					active: {
						phase: "executing",
						agent: { runner: "codex", sessionId: "retained-clarification" },
					},
				},
			],
		},
	};
	const acceptedWorkflow = JSON.stringify(budget.workflowDefinitions);
	const savedCheckpoint = JSON.stringify(budget.checkpoint);
	await runtime.save(budget);
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	const restoredBudget = runtime.get(budget.id);
	assert.equal(
		JSON.stringify(restoredBudget.workflowDefinitions),
		acceptedWorkflow,
	);
	assert.equal(JSON.stringify(restoredBudget.checkpoint), savedCheckpoint);
	assert.equal(
		restoredBudget.stepVisitBudget.additionalVisits["pipeline/clarify"],
		8,
	);
	const savedAllowance = structuredClone(restoredBudget.stepVisitBudget);
	const clarify = restoredBudget.workflowDefinitions
		.find((workflow) => workflow.id === "factory-pipeline")
		.steps.find((step) => step.id === "clarify");
	assert.equal(
		stepVisitLimit(restoredBudget, "pipeline/clarify", clarify, 4),
		20,
	);
	await retry(retained.id);
	await until(
		() => waiting(retained.id, "code-fix"),
		"Retained correction did not reach the native mocked role",
	);
	const corrected = runtime.get(retained.id);
	assert.equal(
		turns.filter((turn) => turn.run === retained.id && turn.role === "code-fix")
			.length,
		1,
	);
	assert.equal(
		turns.find((turn) => turn.run === retained.id && turn.role === "code-fix")
			.nativeSessionId,
		"retained-code-fix",
	);
	assert.equal(
		corrected.history.at(-1).output.reviewAssessment.unchangedCode,
		true,
	);
	assert.throws(
		() =>
			aggregateForContext({
				run: corrected,
				step: corrected.workflow.steps.find(
					(step) => step.id === "review-gate",
				),
				stepKey: "review-gate",
			}),
		/no complete aggregate/,
	);
	assert.equal(corrected.humanDecisions?.length ?? 0, 0);
	await retry(budget.id);
	await until(
		() => waiting(budget.id, "pipeline/clarify"),
		"Saved stock budget did not resume its original clarification role",
	);
	assert.equal(
		turns.find((turn) => turn.run === budget.id && turn.role === "clarify")
			.nativeSessionId,
		"retained-clarification",
	);
	assert.equal(
		runtime.get(budget.id).checkpoint.active.children[0].additionalVisits
			.clarify,
		4,
	);
	const provider = runtime.create({
		id: "live-target",
		repositoryId: "fixture",
		workspace,
		input: "Inspect the scripted provider target",
		workflow: runtime
			.listWorkflows()
			.find((workflow) => workflow.id === providerWorkflow.id),
		workflowDefinitions: runtime.listWorkflows(),
		triggerOrigin: { type: "manual", workflowId: providerWorkflow.id, at },
	});
	provider.outputs["draft-pr"] = {
		url: "https://github.com/fixture/repository/pull/1",
	};
	void runtime.launch(provider);
	await until(
		() => waiting(provider.id, "hold"),
		"Provider workflow did not retain its human review checkpoint",
	);
	assert.equal(provider.outputs.ci.baseSha, liveTarget);
	assert.notEqual(provider.outputs.ci.baseSha, historicalTarget);
	assert.equal(provider.outputs.ci.approved, false);
	assert.equal(
		git(workspace, "rev-parse", "refs/remotes/origin/main"),
		liveTarget,
	);
	assert(providerRequests.length >= 3);
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	assert.deepEqual(runtime.get(budget.id).stepVisitBudget, savedAllowance);
	assert.equal(
		JSON.stringify(runtime.get(budget.id).workflowDefinitions),
		acceptedWorkflow,
	);
	const activities = await rpc("viewSession", {
		sessionId: session.sessionId,
		limit: 200,
		offset: 0,
	});
	assert(JSON.stringify(activities).includes("Provide the controlled fixture"));
	writeFileSync(
		join(directory, "receipt.json"),
		JSON.stringify(
			{
				mode: "mock/scripted",
				issueId: issue.id,
				assertions: {
					issueSessionAndActivities: true,
					incompleteCorrectionNativeSessionResumed: true,
					correctionProvenanceRecorded: true,
					approvalRemainsBlocked: true,
					existingStockBudgetDoubledWithoutGraphChanges: true,
					priorAdditionalPassesPreserved: true,
					restartDoesNotDoubleAgain: true,
					ciUsesLiveTarget: true,
					localTargetRemainsStable: true,
				},
				turns,
				providerRequests,
				contexts,
			},
			null,
			2,
		),
	);
	console.log(`PASS ${directory}`);
} finally {
	await worker?.stop();
}
