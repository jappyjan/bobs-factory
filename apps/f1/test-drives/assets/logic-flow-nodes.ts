// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/logic-flow-nodes.ts
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
const root = mkdtempSync(join(tmpdir(), "f1-logic-flow-"));
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
const port = Number(process.env.F1_LOGIC_PORT ?? 3653);
const origin = `http://localhost:${port}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
let sends = 0;
const schema = z.object({
	...stepFields,
	type: z.literal("f1-read-state"),
	op: z.enum(["read", "write"]).default("read"),
	readyAfter: z.number().default(2),
	fail: z.boolean().default(false),
	transientPoll: z.number().default(0),
	uncertain: z.boolean().default(false),
});
nodeRegistry.register({
	type: "f1-read-state",
	schema,
	category: "io",
	effect: "effect",
	operationEffects: { read: "pure", write: "effect" },
	builder: { label: "Fixture read", icon: "◇", paletteGroup: "io" },
	execute(ctx) {
		if (ctx.step.uncertain)
			return ctx.effect("create", { title: "accepted" }, async () => {
				sends++;
				throw new Error("Response lost after creation");
			});
		if (
			ctx.step.transientPoll &&
			ctx.frame.active?.wait?.polls === ctx.step.transientPoll
		)
			throw new Error("Transient poll failure");
		if (ctx.step.fail) throw new Error("Fixture read failed");
		return {
			ready: (ctx.frame.active?.wait?.polls ?? 0) >= ctx.step.readyAfter,
			value: 7,
		};
	},
});
const parent = WorkflowSchema.parse({
	id: "logic-fixture",
	name: "Logic fixture",
	engineVersion: "nodes-v1",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "seed",
			name: "Seed",
			type: "transform",
			transform: {
				items: {
					literal: [
						{ id: "a", enabled: true },
						{ id: "b", enabled: false },
					],
				},
			},
		},
		{
			id: "shape",
			name: "Shape",
			type: "transform",
			reads: { items: "seed/items" },
			transform: {
				rows: {
					map: "/inputs/items",
					where: { path: "/enabled", equals: true },
					template: { id: { select: "/id" } },
				},
				count: {
					aggregate: "count",
					path: "/inputs/items",
					where: { path: "/enabled", equals: true },
				},
			},
		},
		{
			id: "check",
			name: "Check",
			type: "check",
			reads: { value: "shape/count" },
			check: { results: { ready: { path: "/inputs/value", equals: 1 } } },
		},
		{
			id: "wait",
			name: "Wait",
			type: "wait",
			body: {
				id: "poll",
				name: "Poll",
				type: "f1-read-state",
				transientPoll: 2,
				readyAfter: 3,
			},
			interval: 2000,
			timeout: 60000,
			until: { path: "/output/ready", equals: true },
		},
		{
			id: "failure",
			name: "Failure",
			type: "f1-read-state",
			fail: true,
			retry: { max: 2, backoff: 10 },
			onError: "handle",
		},
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			reads: { error: "@error" },
			transform: { error: { select: "/inputs/error" } },
		},
		{
			id: "finish",
			name: "Finish",
			type: "agent",
			prompt: "Return the fixture value.",
		},
	],
});
const timeoutRecipe = WorkflowSchema.parse({
	id: "timeout-fixture",
	name: "Timeout fixture",
	engineVersion: "nodes-v1",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "wait",
			name: "Wait",
			type: "wait",
			body: {
				id: "poll",
				name: "Poll",
				type: "f1-read-state",
				readyAfter: 999,
			},
			interval: 5000,
			timeout: 2000,
			until: { path: "/output/ready", equals: true },
		},
	],
});
const effectRecipe = WorkflowSchema.parse({
	id: "uncertain-fixture",
	name: "Uncertain fixture",
	engineVersion: "nodes-v1",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "send",
			name: "Send",
			type: "f1-read-state",
			op: "write",
			uncertain: true,
			retry: { max: 2, backoff: 0 },
			onError: "handle",
		},
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			transform: { handled: true },
			next: "send",
		},
	],
});
const progressRecipe = WorkflowSchema.parse({
	id: "progress-fixture",
	name: "Progress fixture",
	engineVersion: "nodes-v1",
	allowedTriggers: ["manual"],
	convergence: { maxUnchangedAttempts: 2, continueAttempts: 1 },
	steps: [
		{
			id: "proof",
			name: "Proof",
			type: "check",
			maxVisits: 100,
			check: { results: { ok: { path: "/inputs/absent", exists: false } } },
			retry: { max: 2, backoff: 0 },
			onError: "handle",
			next: "proof",
		},
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			transform: { handled: true },
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
	runtime().updateWorkflows([
		...runtime().listWorkflows(),
		parent,
		timeoutRecipe,
		effectRecipe,
		progressRecipe,
	]);
	const catalog = await request("/api/config?view=recipes");
	for (const type of ["transform", "wait"]) {
		const meta = catalog.nodeTypes.find((node: any) => node.type === type);
		assert.equal(meta.builder.settings, type);
		assert(!("execute" in meta) && !("schema" in meta));
	}
	const simulated = await request("/api/workflows/transform/simulate", {
		step: parent.steps[1],
		inputs: {
			items: [
				{ id: "a", enabled: true },
				{ id: "b", enabled: false },
			],
		},
	});
	assert.deepEqual(simulated.output, { rows: [{ id: "a" }], count: 1 });
	const started = await request("/api/runs", {
		workflow: parent.id,
		repositoryId: "fixture",
		prompt: "Exercise logic and flow nodes",
	});
	await wait(() => {
		const run = runtime().get(started.id);
		assert.notEqual(run.status, "failed", run.error);
		return (
			run.checkpoint?.active?.wait?.output !== undefined &&
			run.capacityLeaves?.wait?.phase === "waiting-ci"
		);
	}, "First poll did not checkpoint");
	let run = runtime().get(started.id);
	const deadline = run.checkpoint!.active!.wait!.deadline;
	assert.equal(run.checkpoint!.active!.wait!.polls, 1);
	assert.equal(
		run.history.filter((entry) => entry.step.startsWith("wait")).length,
		0,
	);
	assert.equal(run.capacityLeaves?.wait?.request, undefined);
	await worker.stop();
	worker = new EdgeWorker(config);
	await worker.start();
	await wait(
		() => ["completed", "failed"].includes(runtime().get(started.id).status),
		"Restored run did not complete",
	);
	run = runtime().get(started.id);
	assert.equal(run.status, "completed", run.error);
	assert.deepEqual(run.outputs.wait, {
		ready: true,
		value: 7,
		timedOut: false,
		polls: 3,
	});
	assert.equal(run.history.filter((entry) => entry.step === "wait").length, 1);
	assert.deepEqual(run.outputs.handle, {
		error: { message: "Fixture read failed", kind: "Error" },
	});
	assert.equal(
		run.stepAttempts?.filter((attempt) => attempt.step === "failure").length,
		3,
	);
	assert.equal((run.outputs.finish as any).value, 7);
	const timed = await request("/api/runs", {
		workflow: timeoutRecipe.id,
		repositoryId: "fixture",
		prompt: "Exercise timeout",
	});
	await wait(
		() => ["completed", "failed"].includes(runtime().get(timed.id).status),
		"Timeout run did not settle",
	);
	const timedRun = runtime().get(timed.id);
	assert.equal(timedRun.status, "completed", timedRun.error);
	assert.deepEqual(timedRun.outputs.wait, {
		ready: false,
		value: 7,
		timedOut: true,
		polls: 1,
	});
	assert.equal(run.checkpoint?.error, undefined);
	assert(
		run.events.some((event) =>
			event.message.includes("Transient poll failure"),
		),
	);
	const aggregate = await request("/api/workflows/transform/simulate", {
		step: {
			id: "aggregate",
			name: "Aggregate",
			type: "transform",
			transform: {
				findings: {
					map: ["/inputs/reviewers/*/findings/*", "/inputs/optional"],
					missingAsEmpty: true,
					distinctBy: "/id",
					where: {
						all: [
							{ path: "/rating", min: 2 },
							{ path: "/status", equals: "open" },
						],
					},
					template: {
						id: { select: "/id" },
						reviewer: { select: "^/name" },
						reviewerKey: { select: "^@key" },
						index: { select: "@index" },
						prior: {
							find: { collection: "$/inputs/prior", key: "/id", value: "/id" },
						},
					},
				},
			},
		},
		inputs: {
			reviewers: {
				alice: {
					name: "Alice",
					findings: [{ id: "a", rating: 3, status: "open" }],
				},
				failed: {},
				bob: {
					name: "Bob",
					findings: [{ id: "a", rating: 3, status: "open" }],
				},
			},
			prior: [{ id: "a", disposition: "confirmed" }],
		},
	});
	assert.deepEqual(aggregate.output, {
		findings: [
			{
				id: "a",
				reviewer: "Alice",
				reviewerKey: "alice",
				index: 0,
				prior: { id: "a", disposition: "confirmed" },
			},
		],
	});
	const merged = await request("/api/workflows/transform/simulate", {
		step: {
			id: "merge",
			name: "Merge disposition",
			type: "transform",
			transform: {
				finding: {
					merge: [
						{ select: "/inputs/finding" },
						{
							find: {
								collection: "/inputs/prior",
								key: "/id",
								value: "/inputs/finding/id",
							},
						},
					],
				},
			},
		},
		inputs: {
			finding: { id: "a", rating: 3, status: "open", body: "Retained body" },
			prior: [{ id: "a", status: "resolved" }],
		},
	});
	assert.deepEqual(merged.output.finding, {
		id: "a",
		rating: 3,
		status: "resolved",
		body: "Retained body",
	});
	const actionable = await request("/api/workflows/transform/simulate", {
		step: {
			id: "filter",
			name: "Actionable",
			type: "transform",
			transform: {
				findings: {
					aggregate: "filter",
					path: "/inputs/findings",
					where: {
						all: [
							{ path: "/rating", min: 2 },
							{ path: "/status", equals: "open" },
						],
					},
				},
			},
		},
		inputs: { findings: [merged.output.finding] },
	});
	assert.deepEqual(actionable.output, { findings: [] });

	const uncertain = await request("/api/runs", {
		workflow: effectRecipe.id,
		repositoryId: "fixture",
		prompt: "Exercise uncertain send",
	});
	await wait(
		() => runtime().get(uncertain.id).status === "failed",
		"Uncertain effect did not block",
	);
	const uncertainRun = runtime().get(uncertain.id);
	assert.equal(sends, 1);
	assert.equal(uncertainRun.outputs.handle, undefined);
	assert(uncertainRun.checkpoint?.active?.actionId);
	assert.equal(Object.values(uncertainRun.nodeEffects!)[0]!.phase, "uncertain");
	const progress = await request("/api/runs", {
		workflow: progressRecipe.id,
		repositoryId: "fixture",
		prompt: "Exercise convergence pause",
	});
	await wait(
		() =>
			runtime().get(progress.id).status === "failed" &&
			!runtime().isExecuting(progress.id),
		"Convergence did not pause",
	);
	const progressRun = runtime().get(progress.id);
	assert.equal(progressRun.progressBudget?.blocked?.attempts, 2);
	assert.equal(progressRun.outputs.handle, undefined);
	assert.equal(progressRun.checkpoint?.active?.retries, undefined);
	const before = progressRun.history.length;
	await request(`/api/runs/${progress.id}/retry`, {});
	await wait(
		() =>
			progressRun.status === "failed" && !runtime().isExecuting(progress.id),
		"Continue did not settle",
	);
	assert.equal(progressRun.progressBudget?.grants.length, 1);
	assert.equal(progressRun.history.length, before + 1);
	assert.equal(progressRun.outputs.handle, undefined);
	const activity = await request(`/api/runs/${run.id}/activity?limit=100`);
	assert(JSON.stringify(activity).includes("finish"));
	assert.equal(
		run.events.filter(
			(event) => event.message === "Waiting for the configured condition",
		).length,
		1,
	);
	console.log(
		JSON.stringify(
			{
				result: "PASS",
				mode: "mock",
				source: execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
				deadline,
				runId: run.id,
				timeoutRunId: timedRun.id,
				history: run.history.map((entry) => entry.step),
				checks: [
					"registry palette metadata",
					"production HTTP transform simulation",
					"map/filter/count",
					"keyed reviewer aggregation and disposition lookup",
					"apply prior disposition before actionable filtering",
					"transient failed poll recovery",
					"uncertain effect refuses error routing",
					"non-convergence requires explicit Continue",
					"routed error cleared after handler",
					"pure check",
					"read-only wait",
					"capacity-free sleep",
					"cold restart retains wait visit",
					"one wait history receipt",
					"timeout retains last output",
					"retry exhaustion and @error routing",
					"mocked final agent",
					"activity API",
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
