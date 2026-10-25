// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/node-registry.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCLIIssueTracker,
	type EdgeWorkerConfig,
} from "bobs-factory-core";
import { z } from "../../../../packages/edge-worker/node_modules/zod/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.ts";
import { digest } from "../../../../packages/edge-worker/src/factory/Delivery.ts";
import {
	nodeRegistry,
	stepFields,
} from "../../../../packages/edge-worker/src/factory/nodes/index.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"Only mocked agents are authorized",
);
const root = mkdtempSync(join(tmpdir(), "f1-node-registry-"));
const repo = join(root, "repo"),
	home = join(root, "home");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repo, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "README.md"), "# Node registry fixture\n");
git("add", ".");
git("commit", "-qm", "Fixture");
git("clone", "-q", "--bare", repo, join(root, "origin.git"));
git("remote", "add", "origin", join(root, "origin.git"));
const port = Number(process.env.F1_NODE_PORT ?? 3600);
const origin = `http://localhost:${port}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
const schema = z.object({
	...stepFields,
	type: z.literal("f1-value"),
	value: z.number().default(7),
});
nodeRegistry.register({
	type: "f1-value",
	schema,
	category: "logic",
	effect: "pure",
	builder: {
		label: "F1 value",
		icon: "◇",
		paletteGroup: "logic",
		defaults: { value: 7 },
	},
	execute: (ctx) => ({ value: ctx.reads.value ?? ctx.step.value }),
});
const view = {
	version: "view-v1",
	components: [
		{
			id: "text",
			type: "markdown",
			data: { literal: { text: "Registry checkpoint" } },
		},
	],
};
const child = WorkflowSchema.parse({
	id: "registry-child",
	name: "Child",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	steps: [
		{
			id: "check",
			name: "Check",
			type: "check",
			reads: { value: "@callInputs/value" },
			check: { results: { ready: { path: "/inputs/value", equals: 7 } } },
		},
	],
});
const parent = WorkflowSchema.parse({
	id: "registry-fixture",
	name: "Registry fixture",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["manual"],
	steps: [
		{ id: "snapshot", name: "Snapshot", type: "snapshot" },
		{
			id: "loop",
			name: "Loop",
			type: "foreach",
			items: {
				values: [
					{ id: "one", value: 1 },
					{ id: "two", value: 2 },
				],
			},
			body: [
				{
					id: "value",
					name: "Value",
					type: "f1-value",
					reads: { value: "@item/value" },
				},
				{
					id: "check",
					name: "Check",
					type: "check",
					reads: { value: "value/value" },
					check: { results: { valid: { path: "/inputs/value", min: 1 } } },
				},
			],
		},
		{
			id: "parallel",
			name: "Parallel",
			type: "fanout",
			groups: [
				[{ id: "left", name: "Left", type: "f1-value" }],
				[{ id: "right", name: "Right", type: "f1-value" }],
			],
		},
		{
			id: "call",
			name: "Call",
			type: "workflow",
			workflow: child.id,
			inputMapping: { value: "/parallel/0/left/value" },
		},
		{ id: "show", name: "Show", type: "show", view },
		{ id: "approve", name: "Approve", type: "approve", view },
		{
			id: "file",
			name: "File",
			type: "file-issues",
			fileIssues: {
				items: { values: [] },
				fields: { title: "/title", body: "/body" },
			},
		},
		{
			id: "launch",
			name: "Launch",
			type: "launch-runs",
			launchRuns: {
				items: { values: [] },
				workflow: child.id,
				inputMapping: { prompt: "/prompt" },
				wait: true,
			},
		},
		{
			id: "finish",
			name: "Finish",
			type: "agent",
			prompt: "Return the fixture value.",
		},
	],
});
const config: EdgeWorkerConfig = {
	platform: "cli",
	factoryHome: home,
	issueTrackerFactory: createCLIIssueTracker,
	serverHost: "127.0.0.1",
	serverPort: port + 1,
	defaultRunner: "claude",
	linearWorkspaces: { "cli-workspace": { linearToken: "fixture-no-provider" } },
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(root, "worktrees"),
			baseBranch: "main",
			isActive: true,
			linearWorkspaceId: "cli-workspace",
		},
	],
	handlers: f1AgentHandlers(
		"mock",
		JSON.stringify({ value: 7, questions: [] }),
	),
};
let worker: EdgeWorker | undefined;
let passed = false;
const runtime = () =>
	(
		worker as unknown as { getFactoryRuntime(): WorkflowRuntime }
	).getFactoryRuntime();
async function request(path: string, body?: unknown) {
	const response = await fetch(`${origin}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			Origin: origin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
	const value = await response.json();
	assert(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
	return value as any;
}
async function wait(check: () => boolean | Promise<boolean>, label: string) {
	const deadline = Date.now() + 60000;
	while (!(await check())) {
		assert(Date.now() < deadline, label);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
try {
	worker = new EdgeWorker(config);
	await worker.start();
	runtime().updateWorkflows([...runtime().listWorkflows(), child, parent]);
	const catalog = await request("/api/config?view=recipes");
	const meta = catalog.nodeTypes.find((node: any) => node.type === "f1-value");
	assert.equal(meta.builder.label, "F1 value");
	assert(!("execute" in meta) && !("schema" in meta));
	const started = await request("/api/runs", {
		workflow: parent.id,
		repositoryId: "fixture",
		prompt: "Exercise registered nodes",
	});
	await wait(
		() => ["waiting", "failed"].includes(runtime().get(started.id).status),
		"Approval checkpoint not reached",
	);
	let run = runtime().get(started.id);
	assert.equal(run.status, "waiting", run.error);
	assert.equal(run.step, "approve");
	assert.equal((run.outputs.call as any).outputs.check.ready, true);
	assert(run.history.every((record) => record.inputDigest?.length === 64));
	assert.equal(
		run.history.find((record) => record.step === "loop/one/value")?.inputDigest,
		digest({ value: 1 }),
	);
	const completedBefore = run.history.map((record) => record.step);
	await worker.stop();
	worker = new EdgeWorker(config);
	await worker.start();
	await wait(
		() =>
			runtime().get(started.id).status === "waiting" &&
			runtime().get(started.id).viewDecision?.kind === "approve",
		"Saved approval not restored",
	);
	run = runtime().get(started.id);
	const decision = run.viewDecision!;
	await request(`/api/runs/${run.id}/view-answer`, {
		batchId: decision.id,
		digest: decision.digest,
		approved: true,
		accepted: true,
	});
	await wait(
		() => ["completed", "failed"].includes(runtime().get(started.id).status),
		"Final registered actions did not settle",
	);
	run = runtime().get(started.id);
	assert.equal(run.status, "completed", run.error);
	assert.deepEqual(
		run.history.slice(0, completedBefore.length).map((record) => record.step),
		completedBefore,
	);
	assert.equal(Object.keys(run.issueActions ?? {}).length, 1);
	assert.equal(Object.keys(run.launchActions ?? {}).length, 1);
	assert(run.history.every((record) => record.inputDigest?.length === 64));
	assert.equal((run.outputs.finish as any).value, 7);
	const activity = await request(`/api/runs/${run.id}/activity?limit=50`);
	assert(JSON.stringify(activity).includes("finish"));
	console.log(
		JSON.stringify(
			{
				result: "PASS",
				mode: "mock",
				source: execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
				runId: run.id,
				history: run.history.map(({ step, inputDigest }) => ({
					step,
					inputDigest,
				})),
				checks: [
					"JSON-only node metadata",
					"snapshot",
					"foreach and scoped reads",
					"check",
					"fanout",
					"workflow call",
					"show and approve",
					"cold checkpoint recovery",
					"empty file/launch actions",
					"native mock final response",
					"all output stamps",
				],
			},
			null,
			2,
		),
	);
	passed = true;
} finally {
	await worker?.stop();
	if (passed) rmSync(root, { recursive: true, force: true });
	else console.error(`Failed fixture retained at ${root}`);
}
