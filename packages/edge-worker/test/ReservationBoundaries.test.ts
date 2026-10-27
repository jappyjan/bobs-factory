import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { AccessSchema } from "../src/factory/StepConfig.js";
import { validateWorkflows, type Workflow } from "../src/factory/Workflow.js";
import type {
	ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import { resourceRuntime } from "./fixtures/resource-node.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
function home() {
	const path = mkdtempSync(join(tmpdir(), "reservation-boundary-"));
	homes.push(path);
	return path;
}
function definition(steps: unknown[]): Workflow {
	return validateWorkflows([
		...defaultWorkflows,
		{ engineVersion: "nodes-v1", id: "boundaries", name: "Boundaries", steps },
	]).at(-1)!;
}
function create(runtime: WorkflowRuntime, workflow: Workflow, input: string) {
	const run = runtime.create({
		title: input,
		input,
		repositoryId: "repo",
		workspace: home(),
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.repositories = [
		{
			id: "repo",
			name: "Fixture",
			repositoryPath: run.workspace,
			workspace: run.workspace,
			githubUrl: "https://github.com/fixture/shared",
			baseBranch: "main",
		},
	];
	run.outputs.repository = {
		githubUrl: "https://github.com/fixture/shared",
		baseBranch: "main",
	};
	return run;
}
const qa = (computeIntensive = false) =>
	definition([
		{
			id: "inspect",
			name: "Shared QA",
			type: computeIntensive ? "agent" : "fixture-resource",
			prompt: "Fixture resource",
			resources: ["docker:fixture/database"],
			next: "end",
		},
	]);

it("does not acquire a shared environment while its intensive action awaits capacity", async () => {
	const capacity = new SessionSemaphore(1);
	const blocker = await capacity.acquireLease();
	const visits: string[] = [];
	const runtime = resourceRuntime(home(), {
		capacity,
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ run }) => {
			visits.push(run.input);
			return {};
		},
	});
	const queued = create(runtime, qa(true), "capacity-waiter");
	const a = runtime.launch(queued);
	await waitFor(() => expect(capacity.waiting).toBe(1));
	expect(queued.deliveryCoordination).toBeUndefined();
	const ready = create(runtime, qa(), "ready-resource-user");
	await runtime.launch(ready);
	expect(visits).toEqual(["ready-resource-user"]);
	await blocker.release();
	await a;
	expect(visits).toEqual(["ready-resource-user", "capacity-waiter"]);
	expect(capacity.active).toBe(0);
	await runtime.shutdown();
});

it("holds a stopped mutator's resource until its hook cleanup actually settles", async () => {
	const held = deferred(),
		entered = deferred(),
		stopping = deferred();
	const visits: string[] = [];
	const runtime = resourceRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ run, signal }) => {
			visits.push(run.input);
			if (run.input === "first") {
				entered.resolve();
				signal.addEventListener("abort", stopping.resolve, { once: true });
				await held.promise;
			}
			return {};
		},
	});
	const first = create(runtime, qa(), "first"),
		second = create(runtime, qa(), "second");
	const a = runtime.launch(first);
	await entered.promise;
	runtime.stop(first.id);
	await stopping.promise;
	const b = runtime.launch(second);
	try {
		await waitFor(() =>
			expect(second.deliveryCoordination?.phase).toBe("queued"),
		);
		expect(visits).toEqual(["first"]);
		await waitFor(() =>
			expect(second.deliveryCoordination?.blockers?.[0]?.runId).toBe(first.id),
		);
	} finally {
		held.resolve();
		await Promise.all([a, b]);
		await runtime.shutdown();
	}
	expect(visits).toEqual(["first", "second"]);
});

it("uses capable agent turn admission after capacity, and keeps cleanup exclusive", async () => {
	const capacity = new SessionSemaphore(1),
		blocker = await capacity.acquireLease();
	const executing = deferred(),
		cleanup = deferred(),
		releaseCleanup = deferred();
	const visits: string[] = [];
	const runtime = resourceRuntime(home(), {
		agentExecutionBoundary: true,
		capacity,
		agent: async (context: ExecutionContext) => {
			const lease = await capacity.acquireLease(
				context.signal,
				context.capacity,
			);
			let release: (() => Promise<void>) | undefined;
			try {
				release = await context.reserveExecution?.();
				visits.push(context.run.input);
				executing.resolve();
				await cleanup.promise;
			} finally {
				await lease.release();
				// Matches EdgeWorker: retain environment ownership through attempt cleanup.
				await releaseCleanup.promise;
				await release?.();
			}
			return {};
		},
		script: async () => ({}),
		tool: async ({ run }) => {
			visits.push(run.input);
			return {};
		},
	});
	const agentWorkflow = definition([
		{
			id: "agent-qa",
			name: "Agent QA",
			type: "agent",
			prompt: "Use declared shared fixture",
			resources: ["docker:fixture/database"],
			next: "end",
		},
	]);
	const first = create(runtime, agentWorkflow, "agent");
	const a = runtime.launch(first);
	await waitFor(() => expect(capacity.waiting).toBe(1));
	expect(first.deliveryCoordination).toBeUndefined();
	await blocker.release();
	await executing.promise;
	const second = create(runtime, qa(), "next");
	const b = runtime.launch(second);
	try {
		await waitFor(() =>
			expect(second.deliveryCoordination?.phase).toBe("queued"),
		);
		cleanup.resolve();
		await waitFor(() => expect(capacity.active).toBe(0));
		expect(visits).toEqual(["agent"]);
	} finally {
		cleanup.resolve();
		releaseCleanup.resolve();
		await Promise.all([a, b]);
		await runtime.shutdown();
	}
	expect(visits).toEqual(["agent", "next"]);
});

it("rejects a contradictory action publication access declaration", () => {
	expect(
		AccessSchema.safeParse({ mode: "push", publication: "action" }).success,
	).toBe(false);
	expect(
		AccessSchema.parse({
			mode: "workspace",
			publication: "action",
			priority: "normal",
		}),
	).toEqual({ mode: "workspace", publication: "action", priority: "normal" });
});

it("coordinates only concrete resource leaves through nested For each, Parallel and Call", async () => {
	const directory = home();
	let active = 0,
		peak = 0;
	const visits: string[] = [];
	const runtime = resourceRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async (context) => {
			peak = Math.max(peak, ++active);
			visits.push(context.stepKey!);
			try {
				await Promise.resolve();
				return { checked: true };
			} finally {
				active--;
			}
		},
	});
	const call = {
		id: "call",
		name: "Call QA",
		type: "workflow",
		workflow: "resource-child",
	};
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "resource-child",
			name: "QA leaf",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "qa",
					name: "Shared QA",
					type: "fixture-resource",
					resources: ["docker:shared/fixture"],
					next: "end",
				},
			],
		},
		{
			engineVersion: "nodes-v1",
			id: "nested-reservations",
			name: "Nested resources",
			steps: [
				{
					id: "items",
					name: "Items",
					type: "foreach",
					items: { values: [{ id: "a" }, { id: "b" }] },
					concurrency: 2,
					body: [
						{
							id: "parallel",
							name: "Parallel",
							type: "fanout",
							groups: [[call], [call]],
							next: "end",
						},
					],
					next: "end",
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const run = create(runtime, definitions.at(-1)!, "nested");
	try {
		await runtime.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(visits).toHaveLength(4);
		expect(new Set(visits).size).toBe(4);
		expect(peak).toBe(1);
		expect(active).toBe(0);
		expect(
			Object.values(run.deliveryReservations ?? {}).every(
				(c) => c.phase === "released",
			),
		).toBe(true);
		expect(run.deliveryCoordination?.scopes).toEqual([
			JSON.stringify(["resource", "docker:shared/fixture"]),
		]);
	} finally {
		await runtime.shutdown();
	}
});
