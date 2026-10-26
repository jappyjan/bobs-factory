// Execute through ProgressBudgetF1.test.ts with F1_AGENT_MODE=mock.
// Production WorkflowRuntime, public schemas, isolated Git and authenticated API;
// agent execution is scripted. No CI, provider, credential or native-agent I/O.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { defaultWorkflows } from "../../src/factory/defaultWorkflows.ts";
import { validateWorkflows } from "../../src/factory/Workflow.ts";
import { WorkflowRuntime } from "../../src/factory/WorkflowRuntime.ts";
import { FactoryServer } from "../fixtures/authenticated-factory.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const resultFile = process.env.F1_RESULT;
const resultRelative =
	resultFile && relative(resolve(tmpdir()), resolve(resultFile));
assert.ok(
	resultRelative &&
		resultRelative !== ".." &&
		!resultRelative.startsWith(`..${sep}`),
	"F1_RESULT must use the root-supplied own TMPDIR",
);
const directory = mkdtempSync(join(tmpdir(), "f1-task147-progress-"));
const workspace = join(directory, "source");
mkdirSync(workspace);
const git = (...args) =>
	execFileSync("git", args, {
		cwd: workspace,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git("init", "-qb", "main");
writeFileSync(join(workspace, "source.ts"), "export const value = 1;\n");
git("add", "source.ts");
git(
	"-c",
	"user.name=F1",
	"-c",
	"user.email=f1@example.test",
	"-c",
	"commit.gpgsign=false",
	"-c",
	"core.hooksPath=/dev/null",
	"commit",
	"-qm",
	"Fixture [skip ci]",
);
const tree = git("rev-parse", "HEAD^{tree}");
const policy = { maxUnchangedAttempts: 2, continueAttempts: 1 };
const definitions = validateWorkflows([
	...defaultWorkflows,
	...["left", "right"].map((id) => ({
		id: `${id}-child`,
		engineVersion: "nodes-v1",
		name: `${id} child`,
		steps: [
			{
				id: "repair",
				name: "Repair",
				type: "agent",
				prompt: "Scripted unchanged attempt",
				session: "resume",
				next: "end",
				maxVisits: 100,
			},
		],
	})),
	{
		id: "progress-api",
		engineVersion: "nodes-v1",
		name: "Progress API",
		convergence: policy,
		steps: [
			{
				id: "left",
				name: "Left",
				type: "workflow",
				workflow: "left-child",
				next: "right",
				maxVisits: 100,
			},
			{
				id: "right",
				name: "Right",
				type: "workflow",
				workflow: "right-child",
				next: "left",
				maxVisits: 100,
			},
		],
	},
]);
const physical = [];
let releaseContinued;
const continued = new Promise((done) => {
	releaseContinued = done;
});
const hooks = {
	agent: async (context) => {
		const key = context.stepKey;
		const previous = physical.filter((entry) => entry === key).length;
		if (previous) assert.equal(context.resumeAgent?.sessionId, `native-${key}`);
		physical.push(key);
		await context.checkpointAgent({
			runner: "codex",
			sessionId: `native-${key}`,
		});
		if (physical.length === 5) await continued;
		return {
			summary: `Attempt ${physical.length}`,
			attemptUUID: `scripted-${physical.length}`,
		};
	},
	script: async () => {
		throw new Error("Unexpected script");
	},
	tool: async () => {
		throw new Error("Unexpected tool");
	},
};
function observe(runtime, predicate) {
	if (predicate()) return Promise.resolve();
	return new Promise((done, reject) => {
		const timer = setTimeout(() => {
			off();
			reject(new Error("Progress F1 transition timeout"));
		}, 60000);
		const off = runtime.subscribe(() => {
			if (predicate()) {
				clearTimeout(timer);
				off();
				done();
			}
		});
		if (predicate()) {
			clearTimeout(timer);
			off();
			done();
		}
	});
}
let runtime;
let restarted;
let server;
const serverFor = (instance) =>
	new FactoryServer(instance, {
		repositories: () => [{ id: "fixture", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => instance.stop(id),
		start: async (input) => {
			const workflow = definitions.at(-1);
			const run = instance.create({
				title: "Convergence F1",
				repositoryId: "fixture",
				workspace,
				input: input.prompt,
				workflow,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			void instance.launch(run);
			return run;
		},
	});
const request = (
	method,
	url,
	payload,
	headers = { "x-factory-request": "1" },
) => server.app.inject({ method, url, payload, headers });
try {
	runtime = new WorkflowRuntime(directory, hooks);
	runtime.updateWorkflows(definitions);
	server = serverFor(runtime);
	const created = await request("POST", "/api/runs", {
		repositoryId: "fixture",
		workflow: "progress-api",
		prompt: "Accepted unchanged input",
	});
	assert.equal(created.statusCode, 202, created.body);
	const run = runtime.get(created.json().id);
	await observe(runtime, () => run.status === "failed");
	await runtime.flush();
	assert.equal(physical.length, 4);
	assert.equal(run.progressBudget.blocked.step, "left/repair");
	assert.equal(run.progressBudget.blocked.attempts, 2);
	assert.equal(run.progressBudget.blocked.limit, 2);
	assert.match(run.error, /^No progress at left\/repair:/);
	assert.equal(run.iterationLimit, undefined);
	const retained = JSON.stringify(run.progressBudget);
	const history = JSON.stringify(run.history);
	const checkpoint = JSON.stringify(run.checkpoint);
	const id = run.id;
	await runtime.shutdown();
	await server.stop();
	server = undefined;
	restarted = new WorkflowRuntime(directory, hooks);
	const restored = restarted.get(id);
	assert.equal(JSON.stringify(restored.progressBudget), retained);
	assert.equal(JSON.stringify(restored.history), history);
	assert.equal(JSON.stringify(restored.checkpoint), checkpoint);
	restarted.resumeAll();
	assert.equal(physical.length, 4);
	assert.equal(restored.status, "failed");
	server = serverFor(restarted);
	const denied = await request("POST", `/api/runs/${id}/retry`, undefined, {});
	assert.equal(denied.statusCode, 403, denied.body);
	const accepted = await request("POST", `/api/runs/${id}/retry`);
	assert.equal(accepted.statusCode, 202, accepted.body);
	await observe(restarted, () => physical.length === 5);
	const duplicate = await request("POST", `/api/runs/${id}/retry`);
	assert.equal(duplicate.statusCode, 409, duplicate.body);
	assert.equal(restored.progressBudget.grantCount, 1);
	assert.equal(restored.progressBudget.grants.length, 1);
	assert.equal(restored.progressBudget.grants[0].attempts, 1);
	assert.equal(restored.progressBudget.grants[0].limit, 3);
	assert.equal(
		Object.values(restored.progressBudget.observations).find(
			(entry) => entry.step === "right/repair",
		).additional,
		0,
	);
	releaseContinued();
	await observe(restarted, () => restored.status === "failed");
	assert.equal(physical.length, 5);
	assert.equal(restored.progressBudget.blocked.step, "right/repair");
	assert.equal(restored.progressBudget.blocked.attempts, 2);
	assert.equal(restored.progressBudget.blocked.limit, 2);
	assert.equal(restored.progressBudget.grantCount, 1);
	assert.equal(
		restored.checkpoint.active.children[0].active.agent.sessionId,
		"native-right/repair",
	);
	assert.equal(git("rev-parse", "HEAD^{tree}"), tree);
	await restarted.shutdown();
	await server.stop();
	server = undefined;
	writeFileSync(
		resultFile,
		JSON.stringify(
			{
				mode: "mock",
				tree,
				policy,
				physical,
				initialPhysicalExecutions: 4,
				afterContinueExecutions: physical.length,
				retainedAfterRestart: true,
				otherObservationNotGranted: true,
				duplicateRetryRejected: true,
				nativeSessionsRetained: true,
				blocked: restored.progressBudget.blocked,
				grants: restored.progressBudget.grants,
				mocks: { nativeAgentCalls: 0, inferenceCalls: 0, providerCalls: 0 },
			},
			null,
			2,
		),
	);
} finally {
	releaseContinued();
	await restarted?.shutdown();
	await runtime?.shutdown();
	await server?.stop();
	rmSync(directory, { recursive: true, force: true });
}
