import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
process.env.BOBS_FACTORY_FACTORY_PORT = "3601";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
const root = process.cwd();
const home = mkdtempSync(join(tmpdir(), "frozen-workflow-context-"));
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"unused-legacy-capacity",
);
const repo = join(home, "repo");
mkdirSync(repo);
const git = (...args) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-b", "fixture-target");
git("config", "user.name", "F1 Fixture");
git("config", "user.email", "fixture@example.test");
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "feature.txt"), "Initial fixture\n");
git("add", ".");
git("commit", "-m", "Initial fixture");
git("remote", "add", "origin", repo);
git("fetch", "origin");
await import(
	join(root, "packages/edge-worker/node_modules/reflect-metadata/Reflect.js")
);
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { WorkflowRuntime } = await import(
	join(root, "packages/edge-worker/dist/factory/WorkflowRuntime.js")
);
const { defaultWorkflows } = await import(
	join(root, "packages/edge-worker/dist/factory/defaultWorkflows.js")
);
const { workflowExecutionInstructions } = await import(
	join(root, "packages/edge-worker/dist/factory/WorkflowExecution.js")
);
const { MockAgentRunner } = await import(
	join(root, "apps/f1/dist/src/MockAgentRunner.js")
);
const require = createRequire(join(root, "packages/mcp-tools/package.json"));
const { Client } = await import(
	require.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { StdioClientTransport } = await import(
	require.resolve("@modelcontextprotocol/sdk/client/stdio.js")
);
const agent = (id, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	runner: "codex",
	prompt: `[F1_ROLE=${id}] Execute only this fixture role.`,
	...extra,
});
const pipeline = {
	id: "context-pipeline",
	name: "Context pipeline",
	allowedTriggers: ["workflow"],
	steps: [
		agent("plan"),
		agent("plan-review"),
		agent("implement", { inputs: ["plan"], askQuestions: true }),
	],
};
const workflow = {
	id: "context-factory",
	name: "Context factory",
	labels: ["workflow:context-factory"],
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
const newer = {
	...pipeline,
	steps: [
		agent("design", { architectureContract: "architecture-v1" }),
		agent("candidate-review", {
			architectureContract: "architecture-review-v1",
			architectureSource: "design",
		}),
		{
			id: "decision",
			name: "Decision",
			type: "tool",
			tool: "architecture-decision",
			arguments: {
				proposal: "design",
				review: "candidate-review",
				planOutput: "plan",
				revise: "design",
				approval: "always",
			},
		},
		agent("implement", { inputs: ["plan"], askQuestions: true }),
	],
};
const proposal = {
	architectureContract: "architecture-v1",
	classification: "routine",
	rationale: "Established fixture behavior.",
	title: "Update the fixture",
	summary: "Use the existing file and interface.",
	changes: [],
	decisions: [],
	evidence: [
		{
			repository: "fixture",
			paths: ["feature.txt"],
			observation: "Existing fixture file.",
		},
	],
	risks: [],
	candidate: {
		plan: "Implement the fixture change.",
		steps: [{ title: "Update the fixture", files: ["feature.txt"] }],
		assets: [],
	},
};
const calls = [];
let repaired = false;
function scriptedRunner(_type, config) {
	let delegate = new MockAgentRunner(
		config,
		JSON.stringify({ title: "F1 context fixture" }),
	);
	return {
		supportsStreamingInput: false,
		stop: () => delegate.stop(),
		isRunning: () => delegate.isRunning(),
		getMessages: () => delegate.getMessages(),
		getFormatter: () => delegate.getFormatter(),
		async start(prompt) {
			const instruction =
				config.appendSystemPrompt ?? config.systemPrompt ?? "";
			const role = /\[F1_ROLE=([^\]]+)\]/.exec(instruction)?.[1];
			if (!role) return delegate.start(prompt);
			assert.ok(instruction.includes(workflowExecutionInstructions));
			const scoped = config.mcpConfig["factory-context"];
			const input = JSON.parse(readFileSync(scoped.args.at(-1), "utf8"));
			const client = new Client({ name: "f1-frozen-context", version: "1" });
			await client.connect(
				new StdioClientTransport({
					command: scoped.command,
					args: scoped.args,
					cwd: config.workingDirectory,
				}),
			);
			try {
				const response = await client.callTool({
					name: "read_context",
					arguments: { path: "/workflowExecution", limit: 16000 },
				});
				assert.notEqual(response.isError, true);
				const policy = JSON.parse(response.structuredContent.text);
				assert.deepEqual(policy, input.workflowExecution);
				assert.deepEqual(policy.missingWorkflowIds, []);
				assert.deepEqual(
					policy.workflows.map((w) => w.id),
					[workflow.id, pipeline.id],
				);
				const hasGate = policy.workflows[1].steps.some(
					(s) => s.tool === "architecture-decision",
				);
				let output;
				if (role === "plan")
					output = {
						plan: "Implement the fixture change. The architecture proposal must be accepted before implementation.",
						assets: [],
					};
				else if (role === "plan-review" || role === "candidate-review")
					output = { approved: true, feedback: [] };
				else if (role === "design") output = proposal;
				else {
					assert.equal(role, "implement");
					assert.equal(input.outputs, undefined);
					assert.ok(input.plan);
					if (hasGate) {
						assert.equal(
							policy.architectureDecisions.at(-1).decision,
							"accept",
						);
						assert.ok(
							input.plan.plan.includes(
								policy.architectureDecisions.at(-1).proposalId,
							),
						);
					} else {
						assert.deepEqual(policy.architectureDecisions, []);
						if (repaired) assert.equal(input.answers.length, 1);
					}
					output =
						!repaired && !hasGate
							? {
									status: "blocked",
									summary: "Scripted historical false prerequisite",
									checks: [],
									questions: [
										"Restore the nonexistent architecture acceptance?",
									],
								}
							: {
									status: "completed",
									summary: "Mock implementation completed",
									checks: [],
									questions: [],
								};
				}
				calls.push({
					role,
					hasGate,
					resumeSessionId: config.resumeSessionId ?? null,
				});
				delegate = new MockAgentRunner(config, JSON.stringify(output));
				const result = await delegate.start(prompt);
				calls.at(-1).sessionId = result.sessionId;
				return result;
			} finally {
				await client.close();
			}
		},
	};
}
const configRuntime = new WorkflowRuntime(home, {
	agent: async () => ({}),
	tool: async () => ({}),
	script: async () => ({}),
});
configRuntime.updateWorkflows([...defaultWorkflows, workflow, pipeline]);
await configRuntime.shutdown();
const config = {
	platform: "cli",
	factoryHome: home,
	serverHost: "127.0.0.1",
	serverPort: 3604,
	defaultRunner: "codex",
	handlers: { createAgentRunner: scriptedRunner },
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "fixture-target",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
};
const ui = "http://127.0.0.1:3601";
const api = async (path, method = "GET", body) => {
	const response = await fetch(ui + path, {
		method,
		headers: {
			origin: ui,
			"x-factory-request": "1",
			"content-type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const value = await response.json();
	assert.ok(response.ok, JSON.stringify(value));
	assert.notEqual(value.status, "failed", JSON.stringify(value.events?.at(-1)));
	return value;
};
const until = async (check) => {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Fixture timed out");
};
const exec = promisify(execFile);
const f1 = async (...args) =>
	(
		await exec(join(root, "apps/f1/f1"), args, {
			env: { ...process.env, BOBS_FACTORY_PORT: "3604" },
			timeout: 20000,
		})
	).stdout.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
let worker;
try {
	worker = new EdgeWorker(config);
	await worker.start();
	await f1("ping");
	const created = await f1(
		"create-issue",
		"--title",
		"Frozen workflow approval fixture",
		"--description",
		"Implement a fixture change.",
		"--labels",
		"workflow:context-factory,codex",
	);
	const issue = created.match(/ID: (issue-\d+)/)?.[1];
	assert.ok(issue, created);
	const started = await f1("start-session", "--issue-id", issue);
	const id = started.match(/Session ID: (session-\d+)/)?.[1];
	assert.ok(id, started);
	await until(async () =>
		(await api("/api/runs")).some(
			(run) => run.id === id && run.workflow === workflow.id,
		),
	);
	const waiting = await until(async () => {
		const r = await api(`/api/runs/${id}`);
		return r.status === "waiting" && r;
	});
	assert.equal(waiting.step, "pipeline/implement");
	assert.deepEqual(waiting.outputs["plan-review"], {
		approved: true,
		feedback: [],
	});
	assert.equal(waiting.architectureProposals, undefined);
	const timeline = await f1("view-session", "--session-id", id);
	assert.ok(timeline.includes("Factory clarification"), timeline);
	await worker.stop();
	const updated = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
	});
	updated.updateWorkflows([...defaultWorkflows, workflow, newer]);
	await updated.shutdown();
	worker = new EdgeWorker(config);
	await worker.start();
	const restored = await until(async () => {
		const r = await api(`/api/runs/${id}`);
		return r.status === "waiting" && r;
	});
	assert.deepEqual(restored.workflowDefinitions, waiting.workflowDefinitions);
	repaired = true;
	await api(`/api/runs/${id}/answer`, "POST", {
		answer:
			"Automated plan review is accepted. The saved graph has no architecture gate. Continue implementation; final delivery approval remains separate.",
		context: {
			questions: restored.questions,
			questionBatchId: restored.questionBatchId,
			step: restored.step,
		},
	});
	const complete = await until(async () => {
		const r = await api(`/api/runs/${id}`);
		return r.status === "completed" && r;
	});
	assert.equal(calls.filter((c) => c.role === "plan").length, 1);
	assert.equal(calls.filter((c) => c.role === "plan-review").length, 1);
	const implementations = calls.filter((c) => c.role === "implement");
	assert.equal(implementations.length, 2);
	assert.equal(
		implementations[1].resumeSessionId,
		implementations[0].sessionId,
	);
	assert.equal(complete.architectureDecisions, undefined);
	const fresh = await api("/api/runs", "POST", {
		repositoryId: "fixture",
		workflow: workflow.id,
		prompt: "Implement with the new approved design path.",
	});
	const gate = await until(async () => {
		const r = await api(`/api/runs/${fresh.id}`);
		return r.status === "waiting" && r.architectureGate && r;
	});
	assert.equal(calls.filter((c) => c.role === "implement").length, 2);
	const p = gate.architectureProposals.at(-1);
	await api(`/api/runs/${fresh.id}/architecture-decision`, "POST", {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision: "accept",
	});
	const approved = await until(async () => {
		const r = await api(`/api/runs/${fresh.id}`);
		return r.status === "completed" && r;
	});
	assert.equal(approved.architectureDecisions.at(-1).proposalId, p.id);
	assert.equal(calls.filter((c) => c.role === "implement").length, 3);
	writeFileSync(
		join(home, "results.json"),
		JSON.stringify(
			{
				legacyRun: id,
				gatedRun: fresh.id,
				calls,
				checks: [
					"actual scoped MCP policy",
					"automated plan review",
					"frozen graph recovery",
					"native conversation continuity",
					"real gate preserved",
				],
			},
			null,
			2,
		),
	);
	writeFileSync(join(home, "timeline.txt"), timeline);
	console.log(
		JSON.stringify({
			passed: true,
			evidence: home,
			legacyStatus: complete.status,
			gatedStatus: approved.status,
			calls,
		}),
	);
} finally {
	await worker?.stop();
}
