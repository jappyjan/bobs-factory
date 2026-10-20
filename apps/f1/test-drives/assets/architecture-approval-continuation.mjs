// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/architecture-approval-continuation.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { proposal } from "../../../../packages/edge-worker/test/fixtures/architecture.ts";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";
import { reserveLoopbackPorts } from "../../src/ports.mjs";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-architecture-continuation-")),
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
writeFileSync(join(repo, "feature.txt"), "Fixture behavior\n");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\nAGENTS.md\nCLAUDE.md\n",
);
git("add", ".");
git("commit", "-qm", "Initial fixture");
git("remote", "add", "origin", repo);
const portLease = await reserveLoopbackPorts(2);
const [factoryPort, rpcPort] = portLease.ports;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
console.log("F1_PORTS", JSON.stringify({ factoryPort, rpcPort }));
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);
const stock = defaultWorkflows.find((w) => w.id === "factory-pipeline");
const pipeline = {
	id: "architecture-fixture-pipeline",
	name: "Architecture fixture pipeline",
	allowedTriggers: ["workflow"],
	steps: [
		"architecture",
		"architecture-review",
		"architecture-decision",
		"implement",
	].map((id) => {
		const step = structuredClone(stock.steps.find((s) => s.id === id));
		if (id === "implement") step.next = "end";
		return step;
	}),
};
const workflow = {
	id: "architecture-fixture",
	name: "Architecture continuation fixture",
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
const tracker = createCLIIssueTracker(),
	turns = [];
let worker, runtime;
function design(version) {
	const value = proposal();
	value.title = "Preserve behavior while completing caller tests";
	value.summary = "Add necessary caller tests within the approved behavior.";
	value.changes =
		version > 1
			? [
					{
						text:
							version < 4
								? "Include another caller test."
								: "Change the external interface.",
						from: "bob",
					},
				]
			: [];
	value.evidence[0].paths = ["feature.txt"];
	value.problem[0].paths = ["feature.txt"];
	value.candidate.plan =
		"Preserve fixture behavior and complete necessary tests. External interface changes require acceptance.";
	value.candidate.steps[0].files = [{ path: "feature.txt", change: "edit" }];
	value.map.parts[0].file = "feature.txt";
	return value;
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
					JSON.stringify({ title: "Architecture fixture" }),
				);
			const context = loadFactoryContextSnapshot(
				runnerConfig.mcpConfig["factory-context"].args.at(-1),
			);
			const role = run.step.split("/").at(-1);
			const record = {
				run: run.id,
				role,
				resumeSessionId: runnerConfig.resumeSessionId,
			};
			turns.push(record);
			let output;
			if (role === "architecture")
				output = design((run.architectureProposals?.length ?? 0) + 1);
			else if (role === "architecture-review") {
				const instruction =
					runnerConfig.appendSystemPrompt ?? runnerConfig.systemPrompt;
				assert(
					instruction.includes(
						"compare the COMPLETE current candidate cumulatively",
					),
				);
				const accepted = context.architectureDecisions.find(
					(d) => d.decision === "accept",
				);
				const version = run.architectureProposals.at(-1).version;
				output = {
					approved: true,
					feedback: [],
					...(accepted && version < 4
						? {
								continuation: {
									proposalId: accepted.proposalId,
									version: accepted.version,
									digest: accepted.digest,
									reason:
										"Cumulative revisions add necessary caller tests without changing behavior or boundaries.",
								},
							}
						: {}),
				};
			} else {
				assert.equal(role, "implement");
				assert.equal(
					context.workflowExecution.architectureDecisions.at(-1).decision,
					"accept",
				);
				const visit = turns.filter(
					(t) => t.run === run.id && t.role === role,
				).length;
				if (visit < 3 || visit === 4)
					output = {
						status: "blocked",
						architectureRevision: true,
						summary:
							visit === 4
								? "External interface change."
								: "Discovered caller tests.",
						checks: [],
						questions: [],
					};
				else if (visit === 3)
					output = {
						status: "blocked",
						summary: "Restart fixture wait",
						checks: [],
						questions: ["Continue the restart fixture?"],
					};
				else {
					assert.equal(
						context.answers.at(-1).answer,
						"Continue the restart fixture.",
					);
					writeFileSync(
						join(run.workspace, "caller.test.txt"),
						"Necessary caller coverage completed\n",
					);
					output = {
						status: "completed",
						summary: "Caller tests completed after reviewed design change.",
						checks: ["caller.test.txt created and inspected"],
						questions: [],
					};
				}
			}
			const delegate = new MockAgentRunner(
				runnerConfig,
				JSON.stringify(output),
			);
			const start = delegate.start.bind(delegate);
			delegate.start = async (prompt) => {
				const result = await start(prompt);
				record.sessionId = result.sessionId;
				return result;
			};
			return delegate;
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
}
async function until(check) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Architecture fixture timed out");
}
const ui = `http://localhost:${factoryPort}`;
async function api(path, body) {
	const response = await fetch(ui + path, {
		method: body ? "POST" : "GET",
		headers: {
			Origin: ui,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const value = await response.json();
	assert(response.ok, JSON.stringify(value));
	return value;
}
async function rpc(method, params) {
	const response = await fetch(`http://localhost:${rpcPort}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const value = await response.json();
	assert(!value.error, JSON.stringify(value));
	return value.result;
}
function waiting(id, step) {
	const run = runtime.runs.get(id);
	if (!run) return;
	assert.notEqual(run.status, "failed", run.error);
	return run.status === "waiting" && run.step === `pipeline/${step}` && run;
}
async function accept(run) {
	const p = run.architectureProposals.at(-1);
	await api(`/api/runs/${run.id}/architecture-decision`, {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision: "accept",
	});
}
try {
	construct();
	runtime.updateWorkflows(
		[...runtime.listWorkflows(), pipeline, workflow],
		workflow.id,
	);
	await portLease.release();
	await worker.start();
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Prevent repeated architecture approvals",
		description: "Preserve behavior while adding necessary caller tests.",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	const id = session.sessionId;
	const initial = await until(() => waiting(id, "architecture-decision"));
	assert.equal(turns.filter((t) => t.role === "implement").length, 0);
	await accept(initial);
	const held = await until(() => waiting(id, "implement"));
	assert.equal(held.architectureProposals.length, 3);
	assert.equal(held.architectureDecisions.length, 1);
	const anchor = structuredClone(held.architectureDecisions[0]);
	assert.equal(
		held.architectureProposals.at(-1).continuation.proposalId,
		anchor.proposalId,
	);
	const definitions = structuredClone(held.workflowDefinitions);
	await worker.stop();
	construct();
	await worker.start();
	const restored = await until(() => waiting(id, "implement"));
	assert.deepEqual(
		JSON.parse(JSON.stringify(restored.workflowDefinitions)),
		definitions,
	);
	assert.deepEqual(JSON.parse(JSON.stringify(restored.architectureDecisions)), [
		anchor,
	]);
	assert.equal(
		restored.architectureProposals.at(-1).continuation.digest,
		anchor.digest,
	);
	await api(`/api/runs/${id}/answer`, {
		answer: "Continue the restart fixture.",
		context: {
			questions: restored.questions,
			questionBatchId: restored.questionBatchId,
			step: restored.step,
		},
	});
	const changed = await until(() => waiting(id, "architecture-decision"));
	assert.equal(changed.architectureProposals.at(-1).version, 4);
	assert.equal(changed.architectureDecisions.length, 1);
	assert.equal(changed.architectureProposals.at(-1).continuation, undefined);
	await accept(changed);
	const complete = await until(() => {
		const run = runtime.get(id);
		assert.notEqual(run.status, "failed", run.error);
		return run.status === "completed" && run;
	});
	assert.equal(complete.architectureDecisions.length, 2);
	assert.equal(
		readFileSync(join(complete.workspace, "caller.test.txt"), "utf8"),
		"Necessary caller coverage completed\n",
	);
	const implementations = turns.filter((t) => t.role === "implement");
	assert.equal(implementations.length, 5);
	assert.equal(
		implementations[3].resumeSessionId,
		implementations[2].sessionId,
	);
	const timeline = await rpc("viewSession", { sessionId: id });
	assert(timeline.totalCount > 0);
	for (const activity of timeline.activities) {
		assert(activity.type && activity.content.trim() && activity.createdAt);
	}
	const result = {
		status: "passed",
		scope:
			"mocked F1 EdgeWorker, native conversation continuation and protected API",
		directory,
		id,
		proposals: complete.architectureProposals.length,
		explicitApprovals: complete.architectureDecisions.length,
		turns,
	};
	writeFileSync(
		join(directory, "result.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await portLease.release();
	await worker?.stop();
}
