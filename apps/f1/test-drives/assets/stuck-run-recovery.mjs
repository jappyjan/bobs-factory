// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/stuck-run-recovery.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import {
	digest,
	freezeDelivery,
} from "../../../../packages/edge-worker/dist/factory/Delivery.js";
import { collectImpactSnapshot } from "../../../../packages/edge-worker/dist/factory/Impact.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { proposal } from "../../../../packages/edge-worker/test/fixtures/architecture.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-stuck-recovery-")),
);
const home = join(directory, "home"),
	repo = join(directory, "repo"),
	worktrees = join(directory, "worktrees");
mkdirSync(home);
mkdirSync(repo);
mkdirSync(worktrees);
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
	".claude/\n.codex/\n.opencode/\nCLAUDE.md\nAGENTS.md\n",
);
writeFileSync(join(repo, "source.txt"), "Committed fixture source\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Initial fixture");
git(repo, "remote", "add", "origin", repo);
process.env.BOBS_FACTORY_FACTORY_PORT = "3540";
const providerFile = join(directory, "provider.json"),
	providerCalls = join(directory, "provider-calls.jsonl"),
	providerScript = join(directory, "provider.mjs");
writeFileSync(
	providerScript,
	`import {readFileSync,appendFileSync} from 'node:fs';
const [state,calls,operation]=process.argv.slice(2);appendFileSync(calls,JSON.stringify({operation})+'\\n');
const data=JSON.parse(readFileSync(state,'utf8'));if(!['view','inspect','readiness'].includes(operation))throw Error('Unexpected provider mutation: '+operation);
process.stdout.write(JSON.stringify(operation==='readiness'?data.readiness:data.pr));`,
);
const url = "https://forge.example/team/repo/pull/1";
const provider = {
	type: "custom",
	repositoryUrl: "https://forge.example/team/repo",
	command: process.execPath,
	args: [providerScript, providerFile, providerCalls],
};
const source = { source: "originalInput", reference: "/input" };
const inventory = {
	schemaVersion: 1,
	requirements: [
		{
			id: "R1",
			criterion: "Preserve the required source behavior",
			classification: "active",
			sources: [source],
		},
	],
	decisions: [],
	conflicts: [],
	sourceReceipt: { considered: [source], unavailable: [] },
	questions: [],
};
const agent = (id, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	runner: "codex",
	prompt: "Return the deterministic fixture response for this role.",
	...extra,
});
const tool = (id, name = id, extra = {}) => ({
	id,
	name: id,
	type: "tool",
	tool: name,
	...extra,
});
const workflows = [
	{ id: "intake-fixture", name: "Intake fixture", steps: [agent("role")] },
	{
		id: "architecture-fixture",
		name: "Architecture fixture",
		steps: [
			agent("design", { architectureContract: "architecture-v1" }),
			agent("candidate-review", {
				architectureContract: "architecture-review-v1",
				architectureSource: "design",
				branches: [
					{ when: { path: "approved", equals: false }, next: "design" },
				],
			}),
			tool("decision", "architecture-decision", {
				arguments: {
					proposal: "design",
					review: "candidate-review",
					planOutput: "plan",
					revise: "design",
					approval: "meaningful",
				},
			}),
			agent("implement"),
		],
	},
	{
		id: "plan-fixture",
		name: "Delivery fixture",
		steps: [
			agent("plan"),
			agent("plan-review"),
			tool("delivery", "delivery-route", { next: "end" }),
		],
	},
	{
		id: "specialist-fixture",
		name: "Specialist fixture",
		steps: [
			agent("inventory", {
				reviewContract: "inventory-v1",
				askQuestions: true,
			}),
			{
				id: "experts",
				name: "Experts",
				type: "fanout",
				review: { inventory: "inventory" },
				groups: [
					[agent("business", { reviewContract: "coverage-v1" })],
					[agent("integration", { reviewContract: "specialist-v1" })],
				],
			},
			tool("gate", "review-gate", {
				review: { inventory: "inventory", fanout: "experts" },
			}),
		],
	},
	{
		id: "restore-fixture",
		name: "Worktree fixture",
		steps: [agent("guide"), tool("ci", "ci", { next: "end" })],
	},
];
let worker,
	runtime,
	designReviews = 0,
	specialistTurns = 0;
const calls = [];
const config = {
	factoryHome: home,
	serverPort: 3600,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	issueTrackerFactory: createCLIIssueTracker,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "fixture-no-provider-token" },
	},
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: worktrees,
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		createAgentRunner: (type, config) => {
			const current = [...runtime.runs.values()].find(
				(r) =>
					r.status === "running" && r.workspace === config.workingDirectory,
			);
			let response = { summary: "Fixture complete", questions: [] };
			if (current) {
				calls.push({
					run: current.id,
					step: current.step,
					resume: config.resumeSessionId,
				});
				if (current.id === "architecture") {
					if (current.step === "design") {
						response = proposal();
						if (current.architectureProposals?.length)
							response.changes = [
								{ text: "Recorded the explicit privacy answer", from: "you" },
							];
					}
					if (current.step === "candidate-review")
						response =
							++designReviews === 1
								? {
										approved: false,
										feedback: ["Record the privacy choice"],
										questions: [
											"May eligible users browse minimal supervisor names?",
										],
									}
								: { approved: true, feedback: [] };
					if (current.step === "implement")
						response = {
							status: "completed",
							summary: "Implemented accepted choice",
							checks: [],
							questions: [],
						};
				}
				if (current.id === "delivery") {
					if (current.step === "plan")
						response = {
							plan: "Revised plan preserves the explicit privacy answer",
							assets: [],
							deliveryContract: {
								...current.outputs.plan.deliveryContract,
								version: 2,
							},
						};
					if (current.step === "plan-review")
						response = {
							approved: true,
							feedback: [],
							deliveryContractDigest: digest(
								current.outputs.plan.deliveryContract,
							),
						};
				}
				if (current.id === "stale" && current.step === "pipeline/assess-impact")
					response = {
						impactContract: "impact-v1",
						status: "blocked",
						summary: "Fresh evidence needs fixture access",
						classification: "full",
						rationale: "Environment changed",
						uncertainty: ["Fixture access"],
						extractRequirements: true,
						specialists: current.workflowDefinitions
							.find((w) => w.id === "factory-pipeline")
							.steps.find((s) => s.id === "specialist-review")
							.groups.flat()
							.map((s) => s.id),
						requirementIds: [],
						checks: [],
						qaCriteria: [],
						reuse: [],
						invalidate: [],
						targetCompatible: true,
						testAssertions: {
							inspected: true,
							weakened: false,
							evidence: "No assertions weakened",
						},
						humanReview: "no-prior-approval",
						approvalRationale: "No approval supplied",
						questions: ["Restore fixture access"],
					};
			}
			// The system instruction identifies each concurrent role independently of the shared run cursor.
			if (current?.id === "specialists") {
				if (current.step === "inventory") response = inventory;
				const instruction = `${config.systemPrompt ?? ""}\n${config.appendSystemPrompt ?? ""}`;
				if (instruction.includes("step: integration.")) {
					specialistTurns++;
					response = {
						status: "completed",
						blockers: [],
						summary: "Reviewed integration",
						findings: [
							{
								id: "F1",
								rating: 3,
								status: "open",
								requirementIds: ["R1"],
								summary: "Integration is missing",
								evidence: "source.txt:1 lacks its caller",
								remedy: "Wire the caller",
								duplicateOf: "business:F5",
							},
						],
						evidenceBoundary: {
							requirementIds: ["R1"],
							areas: ["source"],
							independence: "Read fixture source and callers",
							dependencies:
								specialistTurns === 1
									? ["/progress/newHistory/7/output/comments"]
									: ["source.txt"],
						},
					};
				} else if (instruction.includes("step: business."))
					response = {
						status: "completed",
						blockers: [],
						summary: "Reviewed acceptance",
						findings: [
							{
								id: "F5",
								rating: 3,
								status: "open",
								requirementIds: ["R1"],
								summary: "Required behavior is missing",
								evidence: "source.txt:1 omits the required result",
								remedy: "Return the required result",
							},
						],
						coverage: [
							{
								requirementId: "R1",
								status: "not_met",
								reason: "Missing behavior",
								evidence: ["source.txt:1 omits the required result"],
							},
						],
					};
			}
			return f1AgentHandlers(
				"mock",
				JSON.stringify(response),
			).createAgentRunner(type, config);
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
}
async function until(check, message) {
	const end = Date.now() + 20000;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 20));
	}
	throw Error(message);
}
async function rpc(method, params = {}) {
	const response = await fetch("http://localhost:3600/cli/rpc", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const result = await response.json();
	assert(!result.error, JSON.stringify(result));
	return result.result;
}
async function action(id, path, body) {
	const response = await fetch(`http://localhost:3540/api/runs/${id}/${path}`, {
		method: "POST",
		headers: {
			Origin: "http://localhost:3540",
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	assert(response.ok, await response.text());
}
function create(id, workflowId, workspace) {
	return runtime.create({
		id,
		repositoryId: "fixture",
		workspace,
		input: "Sanitized recovery fixture",
		workflow: runtime.listWorkflows().find((w) => w.id === workflowId),
		workflowDefinitions: runtime.listWorkflows(),
		triggerOrigin: { type: "manual", workflowId, at: new Date().toISOString() },
	});
}
function publish(headSha, branch, state = "OPEN") {
	writeFileSync(
		providerFile,
		JSON.stringify({
			pr: {
				url,
				number: 1,
				title: "Fixture",
				body: "",
				headRefName: branch,
				headRefOid: headSha,
				baseRefName: "main",
				state,
				isDraft: true,
				isCrossRepository: false,
				comments: [],
				reviews: [],
				reviewComments: [],
			},
			readiness: {
				headSha,
				baseSha: git(repo, "rev-parse", "main"),
				url,
				state,
				isDraft: true,
				approved: false,
				reviewReady: true,
				fix: false,
				blockers: [],
				checks: [],
				comments: [],
				reviews: [],
				threads: [],
				queued: false,
				mergeMethod: "merge",
			},
		}),
	);
}
async function complete(run) {
	await runtime.launch(run);
	assert.equal(run.status, "completed", run.error);
}
try {
	construct();
	runtime.updateWorkflows(
		validateWorkflows([...runtime.listWorkflows(), ...workflows]),
		"intake-fixture",
	);
	await worker.start();
	assert(await rpc("ping"));
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Recover deterministic stuck workflows",
		description: "Exercise persisted correction and approval boundaries",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	await until(
		() => runtime.runs.get(session.sessionId)?.status === "completed",
		"Intake did not complete",
	);
	const intake = runtime.get(session.sessionId),
		workspace = intake.workspace,
		head = git(workspace, "rev-parse", "HEAD");
	const revision = {
		headSha: head,
		dirty: false,
		historyLength: 1,
		at: new Date().toISOString(),
	};
	const architecture = create(
		"architecture",
		"architecture-fixture",
		workspace,
	);
	void runtime.launch(architecture);
	await until(
		() => architecture.status === "waiting",
		"Architecture did not ask its question",
	);
	assert.equal(architecture.step, "candidate-review");
	assert.equal(designReviews, 1);
	assert.equal(architecture.architectureGate, undefined);
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	await until(
		() => runtime.get("architecture").status === "waiting",
		"Question did not survive restart",
	);
	const restored = runtime.get("architecture");
	assert.equal(designReviews, 1);
	await action(restored.id, "answer", {
		answer: "Allow eligible users to browse minimal names",
		context: {
			questions: restored.questions,
			questionBatchId: restored.questionBatchId,
			step: restored.step,
		},
	});
	await until(
		() => !!restored.architectureGate && restored.status === "waiting",
		"Revised proposal did not require acceptance",
	);
	assert.equal(restored.architectureProposals.length, 2);
	assert.equal(restored.architectureDecisions?.length ?? 0, 0);
	assert(
		!calls.some((c) => c.run === "architecture" && c.step === "implement"),
	);
	const candidate = restored.architectureProposals.at(-1);
	await action(restored.id, "architecture-decision", {
		proposalId: candidate.id,
		version: candidate.version,
		digest: candidate.digest,
		decision: "accept",
	});
	await until(
		() => restored.status === "completed",
		"Accepted architecture did not complete",
	);
	const delivery = create("delivery", "plan-fixture", workspace);
	const contract = {
		format: "delivery-v1",
		version: 1,
		mode: "repository",
		targets: [],
		authorization: { status: "authorized", reference: "Original instruction" },
		executionReference: digest({
			runner: delivery.runner,
			repositoryId: delivery.repositoryId,
		}),
	};
	freezeDelivery(delivery, contract);
	const changed = {
		...contract,
		authorization: {
			status: "authorized",
			reference: "Explicit privacy answer",
		},
	};
	delivery.outputs.plan = {
		plan: "Revised plan",
		assets: [],
		deliveryContract: changed,
	};
	delivery.outputs["plan-review"] = {
		approved: true,
		feedback: [],
		deliveryContractDigest: digest(changed),
	};
	delivery.outputs.clarify = { deliveryMode: "repository" };
	delivery.history = [
		{ step: "plan", output: delivery.outputs.plan, at: revision.at },
	];
	delivery.roleRevisions = { plan: revision };
	delivery.checkpoint = {
		current: "delivery",
		visits: { plan: 1, "plan-review": 1, delivery: 1 },
		agentSessions: { plan: { runner: "codex", sessionId: "retained-planner" } },
		active: { phase: "executing" },
	};
	await complete(delivery);
	assert.equal(delivery.delivery.contract.version, 2);
	assert.equal(delivery.deliveryContracts[0].contract.version, 1);
	assert.deepEqual(
		calls.filter((c) => c.run === "delivery").map((c) => c.step),
		["plan", "plan-review"],
	);
	assert.equal(
		calls.find((c) => c.run === "delivery").resume,
		"retained-planner",
	);
	const specialists = create("specialists", "specialist-fixture", workspace);
	await complete(specialists);
	assert.equal(specialistTurns, 2);
	assert.equal(specialists.outputs.gate.approved, false);
	assert.deepEqual(
		specialists.outputs.gate.findings.map((f) => f.id),
		["business:F5", "integration:F1"],
	);
	assert.equal(
		specialists.outputs.gate.rawFindings[1].duplicateOf,
		"business:F5",
	);
	const deleted = join(worktrees, "deleted");
	git(repo, "worktree", "add", "-b", "recovery-branch", deleted);
	const recovery = create("worktree", "restore-fixture", deleted);
	recovery.gitProvider = provider;
	recovery.outputs["draft-pr"] = { url };
	recovery.history = [
		{ step: "guide", output: { summary: "Saved clean work" }, at: revision.at },
	];
	recovery.roleRevisions = { guide: revision };
	recovery.checkpoint = {
		current: "ci",
		visits: { ci: 1 },
		active: { phase: "executing" },
	};
	rmSync(deleted, { recursive: true });
	publish(head, "recovery-branch");
	await complete(recovery);
	assert(existsSync(deleted));
	assert.equal(git(deleted, "rev-parse", "HEAD"), head);
	const merged = create("merged", "factory", join(worktrees, "gone-merged"));
	merged.gitProvider = provider;
	merged.step = "pipeline/handoff";
	merged.outputs["draft-pr"] = { url };
	const approval = {
		reviewId: "exact-human-review",
		decision: "approve",
		headSha: head,
		url,
		at: revision.at,
	};
	merged.humanDecisions = [approval];
	merged.reviewGate = {
		id: approval.reviewId,
		status: "approve",
		headSha: head,
		url,
	};
	merged.history = [
		{ step: "pipeline/human-review", output: approval, at: revision.at },
	];
	merged.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "handoff",
					visits: { handoff: 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	publish(head, "recovery-branch", "MERGED");
	await complete(merged);
	assert.equal(merged.outputs.merge.headSha, head);
	assert.equal(merged.humanDecisions.length, 1);
	assert(!existsSync(merged.workspace));
	const stale = create("stale", "factory", workspace);
	const pipeline = stale.workflowDefinitions.find(
			(w) => w.id === "factory-pipeline",
		),
		fanout = pipeline.steps.find((s) => s.id === "specialist-review");
	const snapshot = await collectImpactSnapshot(
		{
			run: stale,
			step: pipeline.steps.find((s) => s.id === "assess-impact"),
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: directory,
		},
		fanout,
		"pipeline/specialist-review",
	);
	stale.impactDecisions = [
		{ snapshot, extractRequirements: false, status: "completed" },
	];
	stale.model = "changed-binding";
	stale.outputs.retained = { work: "Preserved" };
	stale.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "impact-checks",
					visits: { "impact-checks": 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	void runtime.launch(stale);
	await until(
		() => stale.status === "waiting" || stale.status === "failed",
		"Stale assessment did not renew",
	);
	assert.equal(stale.status, "waiting", stale.error);
	assert.equal(stale.step, "pipeline/assess-impact");
	assert.deepEqual(stale.questions, ["Restore fixture access"]);
	assert.deepEqual(stale.outputs.retained, { work: "Preserved" });
	assert.equal(stale.humanDecisions?.length ?? 0, 0);
	runtime.stop(stale.id);
	const activities = await (
		await fetch(
			`http://localhost:3540/api/runs/${delivery.id}/activity?limit=200`,
		)
	).json();
	assert(activities.entries.some((entry) => entry.type === "result"));
	assert(
		activities.entries.every((entry) =>
			Number.isFinite(
				Date.parse(
					JSON.parse(Buffer.from(entry.activityCursor, "base64url").toString())
						.at,
				),
			),
		),
	);
	assert(
		readFileSync(providerCalls, "utf8")
			.trim()
			.split("\n")
			.every((line) =>
				["view", "inspect", "readiness"].includes(JSON.parse(line).operation),
			),
	);
	await runtime.flush();
	writeFileSync(
		join(directory, "evidence.json"),
		JSON.stringify(
			{
				issue: issue.id,
				calls,
				specialistTurns,
				designReviews,
				providerCalls: readFileSync(providerCalls, "utf8"),
				activities,
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			directory,
			assertions: [
				"issue intake and activities",
				"architecture question survives restart",
				"explicit answer then independent review and human acceptance",
				"saved delivery candidate corrected to v2 and independently reviewed",
				"invalid specialist boundary corrected",
				"unproven duplicate remains actionable",
				"deleted clean committed worktree restored",
				"exact approved merged delivery reconciled without mutation",
				"stale impact automatically renewed with blockers preserved",
			],
		}),
	);
} finally {
	await worker?.stop();
}
