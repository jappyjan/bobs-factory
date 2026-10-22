// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/impact-feedback-recovery.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-impact-feedback-")),
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
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "feature.txt"), "Fixture feature\n");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\nAGENTS.md\nCLAUDE.md\n",
);
git("add", ".");
git("commit", "-qm", "Initial fixture");
git("remote", "add", "origin", repo);
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
	"unused-legacy-capacity",
);
const tracker = createCLIIssueTracker();
const turns = [],
	contexts = [];
let worker, runtime;
const agent = (id, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	runner: "codex",
	prompt: "Execute only this deterministic fixture role.",
	...extra,
});
const pipeline = {
	id: "feedback-pipeline",
	name: "Feedback pipeline",
	allowedTriggers: ["workflow"],
	steps: [
		agent("assess-impact", {
			impactContract: "impact-v1",
			askQuestions: true,
			impact: { inventory: "scope", fanout: "experts", maxUnchangedCycles: 3 },
			next: "scope",
			branches: [
				{
					when: { path: "extractRequirements", equals: false },
					next: "impact-checks",
				},
			],
		}),
		agent("scope", {
			reviewContract: "inventory-v1",
			askQuestions: true,
			next: "impact-checks",
		}),
		{
			id: "impact-checks",
			name: "Selected checks",
			type: "tool",
			tool: "impact-checks",
			impactSource: "assess-impact",
			next: "experts",
		},
		agent("hold", { askQuestions: true, next: "end" }),
		{
			id: "experts",
			name: "Experts",
			type: "fanout",
			impactSource: "assess-impact",
			review: { inventory: "scope" },
			groups: [[agent("security", { reviewContract: "coverage-v1" })]],
			next: "gate",
		},
		{
			id: "gate",
			name: "Aggregate review",
			type: "tool",
			tool: "review-gate",
			review: { inventory: "scope", fanout: "experts" },
			impactSource: "assess-impact",
			next: "hold",
		},
	],
};
const workflow = {
	id: "feedback-fixture",
	name: "Feedback recovery fixture",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		{
			id: "pipeline",
			name: "Pipeline",
			type: "workflow",
			workflow: pipeline.id,
		},
	],
};
const invalidComment = {
	id: "ticket-notice",
	repositoryId: "fixture",
	bodySha256: "a".repeat(64),
	disposition: "informational",
	reason: "Originating tracker session notice",
};
// Completed outputs belong to their exact producer receipt, not a root alias.
function producedOutput(run, stepKey) {
	return run.history.findLast((entry) => entry.step === stepKey)?.output;
}
function assessment(run, correction) {
	const inventory = producedOutput(run, "pipeline/gate")?.baseline.inventory;
	return {
		impactContract: "impact-v1",
		status: "completed",
		summary: "Execute independent checks and review",
		classification: "full",
		rationale: `Independent assessment turn ${turns.length}`,
		uncertainty: [],
		extractRequirements: !inventory,
		...(inventory
			? {
					scopeReuse: {
						inventoryDigest: inventory.digest,
						originalSourceDigest: inventory.sourceContextDigest,
						reason:
							"The original inventory and session notice retain the same accepted fixture requirement",
					},
				}
			: {}),
		specialists: ["security"],
		requirementIds: [],
		checks: [
			{
				id: "feature-present",
				repositoryId: "fixture",
				command: "test -f feature.txt",
				reason: "Verify the fixture independently",
				environment: { isolation: "worktree" },
			},
		],
		qaCriteria: [],
		reuse: [],
		invalidate: [],
		targetCompatible: true,
		testAssertions: {
			inspected: true,
			weakened: false,
			evidence: "Controlled fixture diff inspected",
		},
		humanReview: "no-prior-approval",
		approvalRationale: "Review and human acceptance remain required",
		questions: [],
		commentAssessments: correction ? [] : [invalidComment],
	};
}
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
				(r) =>
					r.status === "running" &&
					r.workspace === runnerConfig.workingDirectory,
			);
			if (!run)
				return new MockAgentRunner(
					runnerConfig,
					JSON.stringify({ title: "F1 recovery" }),
				);
			const context = loadFactoryContextSnapshot(
				runnerConfig.mcpConfig["factory-context"].args.at(-1),
			);
			const role = run.step.split("/").at(-1);
			turns.push({
				run: run.id,
				role,
				resumeSessionId: runnerConfig.resumeSessionId,
			});
			contexts.push({ run: run.id, role, context });
			let output;
			if (role === "assess-impact") {
				assert(
					context.feedback,
					"Impact roles must receive runtime feedback even with restricted inputs",
				);
				output = assessment(run, context.outputCorrection);
			} else if (role === "scope")
				output = {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion: "Preserve the fixture feature",
							classification: "active",
							sources: [
								{
									source: "context",
									reference: "/outputs/assess-impact/rationale",
								},
							],
						},
					],
					decisions: [],
					conflicts: [],
					sourceReceipt: {
						considered: [
							{
								source: "context",
								reference: "/outputs/assess-impact/rationale",
							},
						],
						unavailable: [],
					},
					questions: [],
				};
			else if (role === "security")
				output = {
					status: "completed",
					summary: "Fixture requirement independently checked",
					findings: [],
					disagreements: [],
					coverage: [
						{
							requirementId: "R1",
							status: "met",
							reason: "Fixture feature remains present",
							evidence: ["feature.txt"],
						},
					],
				};
			else if (role === "hold")
				output = {
					summary:
						"Checks passed; independent review and acceptance still required",
					questions: [
						"Inspect the retained fixture evidence before further work",
					],
				};
			else throw new Error(`Unexpected agent role ${role}`);
			return new MockAgentRunner(runnerConfig, JSON.stringify(output));
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
}
async function until(check, message) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 30));
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
function passed(id) {
	const run = runtime.runs.get(id);
	if (!run) return false;
	assert.notEqual(run.status, "failed", run.error);
	return run.status === "waiting" && run.step === "pipeline/hold";
}
try {
	construct();
	runtime.updateWorkflows(
		[...runtime.listWorkflows(), pipeline, workflow],
		workflow.id,
	);
	await worker.start();
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Recover impact feedback without a self-invalidating source",
		description:
			"Exercise scoped comment correction and immutable requirement evidence.",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	await until(
		() => passed(session.sessionId),
		"Fresh issue did not pass impact checks",
	);
	const fresh = runtime.get(session.sessionId);
	const freshImpact = producedOutput(fresh, "pipeline/assess-impact");
	const freshTurns = turns.filter(
		(t) => t.run === fresh.id && t.role === "assess-impact",
	);
	assert.equal(freshTurns.length, 2);
	assert(freshTurns[1].resumeSessionId);
	assert.equal(fresh.impactDecisions.length, 1);
	assert.equal(fresh.impactDecisions[0].checkResults[0].exitCode, 0);
	assert.deepEqual(freshImpact.commentAssessments, []);
	assert(
		fresh.events.some((e) =>
			e.message.includes("Output validation rejected assess-impact"),
		),
	);
	const recovered = runtime.create({
		id: "saved-impact-result",
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
	recovered.outputs = structuredClone(fresh.outputs);
	recovered.history = structuredClone(fresh.history);
	recovered.impactDecisions = structuredClone(fresh.impactDecisions);
	recovered.reviewRounds = structuredClone(fresh.reviewRounds);
	recovered.outputs.ticket = {
		comments: [{ id: invalidComment.id, body: "Agent session notice" }],
	};
	// A pending result resumes in the same lexical output frame that produced it.
	// Copy actual persisted outputs; do not recreate them as root-level aliases.
	const originalFrame = structuredClone(fresh.checkpoint.active.children[0]);
	originalFrame.outputs.ticket = structuredClone(recovered.outputs.ticket);
	recovered.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					...originalFrame,
					current: "assess-impact",
					visits: { "assess-impact": 1 },
					active: {
						phase: "executing",
						agent: {
							runner: "codex",
							sessionId: "retained-impact-conversation",
							result: {
								output: {
									...freshImpact,
									commentAssessments: [invalidComment],
								},
								revision: {
									headSha:
										fresh.impactDecisions[0].snapshot.repositories[0].headSha,
									dirty: false,
									historyLength: recovered.history.length,
									at: recovered.createdAt,
								},
							},
						},
					},
				},
			],
		},
	};
	recovered.status = "failed";
	recovered.error =
		"Comment ticket-notice assessment must match the supplied content hash; assess the current unassessedComments entry";
	// The recovery fixture reuses this exact workspace. Retain the original run
	// explicitly stopped so startup cannot dispatch both owners concurrently.
	runtime.stop(fresh.id);
	await runtime.save(fresh);
	await runtime.save(recovered);
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	const retry = await fetch(
		`${factoryOrigin}/api/runs/saved-impact-result/retry`,
		{
			method: "POST",
			headers: {
				Origin: factoryOrigin,
				"X-Factory-Request": "1",
				"Content-Type": "application/json",
			},
			body: "{}",
		},
	);
	assert.equal(retry.status, 202, await retry.text());
	await until(
		() => passed(recovered.id),
		"Retained result did not recover through correction and selected checks",
	);
	const saved = runtime.get(recovered.id);
	const savedTurns = turns.filter(
		(t) => t.run === saved.id && t.role === "assess-impact",
	);
	assert.equal(savedTurns.length, 1);
	assert.equal(
		turns.filter((t) => t.run === saved.id && t.role === "scope").length,
		0,
		"The unchanged inventory must be reused",
	);
	assert.equal(savedTurns[0].resumeSessionId, "retained-impact-conversation");
	assert.equal(saved.impactDecisions.at(-1).checkResults[0].exitCode, 0);
	assert.equal(
		saved.history.filter((h) => h.step === "pipeline/impact-checks").length,
		2,
	);
	assert.equal(saved.humanDecisions?.length ?? 0, 0);
	const activities = await rpc("viewSession", {
		sessionId: session.sessionId,
		limit: 200,
		offset: 0,
	});
	writeFileSync(
		join(directory, "activities.json"),
		JSON.stringify(activities, null, 2),
	);
	writeFileSync(
		join(directory, "contexts.json"),
		JSON.stringify(contexts, null, 2),
	);
	writeFileSync(
		join(directory, "runs.json"),
		JSON.stringify([fresh, saved], null, 2),
	);
	writeFileSync(
		join(directory, "receipt.json"),
		JSON.stringify(
			{
				mode: "mock/scripted",
				directory,
				fresh: fresh.id,
				saved: saved.id,
				turns,
				assertions: [
					"fresh comment corrected in original conversation",
					"saved result corrected after worker restart and Retry",
					"both self-referencing inventories pass selected checks",
					"human acceptance remains required",
				],
			},
			null,
			2,
		),
	);
	console.log(`PASS ${directory}`);
} finally {
	await worker?.stop();
}
