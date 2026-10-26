import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { JsonSnapshotStore } from "bobs-factory-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

import { validateWorkflows, type Workflow } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type GraphCheckpoint,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function create(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "factory-runtime-"));
	homes.push(home);
	return { runtime: reload(home, hooks), home };
}

function readJson(path: string): any {
	const stored = JSON.parse(readFileSync(path, "utf8"));
	return stored.format === "bobs-factory-json-snapshot-1"
		? new JsonSnapshotStore(join(dirname(dirname(path)), "run-chunks")).load(
				path,
			).value
		: stored;
}
function workflow(steps: unknown[], dependencies: unknown[] = []): Workflow {
	return validateWorkflows([
		...defaultWorkflows,
		...dependencies,
		{ engineVersion: "nodes-v1", id: "custom", name: "Custom", steps },
	]).at(-1)!;
}
const agent = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Do the task",
	...extra,
});
function failedCodexStartup(
	run: FactoryRun,
	key: string,
	frame: GraphCheckpoint,
) {
	const startup = {
		type: "result",
		is_error: true,
		session_id: "synthetic-startup-id",
		errors: ["initialize timed out after 60000ms"],
	};
	const missing = {
		...startup,
		errors: [
			"thread/resume failed: no rollout found for thread id synthetic-startup-id",
		],
	};
	run.status = "failed";
	run.step = key;
	run.error = `Agent step failed: ${JSON.stringify(missing)}`;
	frame.active = {
		phase: "executing",
		agent: { runner: "codex", sessionId: startup.session_id },
	};
	run.events.push({
		at: run.createdAt,
		step: key,
		source: "agent",
		message: JSON.stringify(startup),
	});
}
function start(runtime: WorkflowRuntime, definition: Workflow) {
	return runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: definition.id,
			at: new Date().toISOString(),
		},
		title: "Build a dashboard",
		repositoryId: "repo",
		workspace: "/tmp",
		input: "PRIVATE TICKET INPUT",
		workflow: definition,
	});
}

describe("workflow trigger permissions", () => {
	it("rejects selected disallowed explicit, first label and default without falling back", async () => {
		const { runtime, home } = create();
		const first = {
			...workflow([agent("work")]),
			allowedTriggers: [],
			labels: ["first"],
		};
		const second = {
			...first,
			id: "second",
			name: "Second",
			labels: ["second"],
			allowedTriggers: ["ticket-assignment"],
		};
		runtime.updateWorkflows([...defaultWorkflows, first, second], "custom");
		for (const [labels, explicit] of [
			[[], "custom"],
			[["second", "first"], undefined],
			[[], undefined],
		] as const)
			expect(() =>
				runtime.selectWorkflow([...labels], "ticket-assignment", explicit),
			).toThrow(/custom.*ticket-assignment.*Recipes/);
		expect(
			runtime.selectLaunch(["second"], "ticket-assignment").selectionMethod,
		).toBe("label");
		expect(
			runtime.selectWorkflow(["first"], "ticket-assignment", "second").id,
		).toBe("second");
		expect(() => runtime.selectWorkflow([], "manual", "unknown")).toThrow(
			"Unknown workflow",
		);
		expect(runtime.getDefaultWorkflow()).toBe("custom");
		expect(
			reload(home)
				.listWorkflows()
				.find((w) => w.id === "custom")!.allowedTriggers,
		).toEqual([]);
	});
	it("permits deliberate top-level access to an internal recipe and an ineligible saved default", async () => {
		const { runtime } = create();
		const saved = runtime.listWorkflows();
		const shared = {
			...workflow([agent("work")]),
			id: "internal-fixture",
			internal: true,
			allowedTriggers: ["workflow"],
		};
		saved.push(shared);
		shared.allowedTriggers.push("manual");
		runtime.updateWorkflows(saved, shared.id);
		expect(runtime.selectWorkflow([], "manual").id).toBe(shared.id);
		expect(() => runtime.selectWorkflow([], "ticket-assignment")).toThrow(
			"ticket-assignment",
		);
	});
	it.each(
		[["manual", "manual"], ["unknown"], ["workflow"]].map(
			(allowedTriggers) => ({ allowedTriggers }),
		),
	)("rejects invalid Simple permissions $allowedTriggers without partial save", ({
		allowedTriggers,
	}) => {
		const { runtime, home } = create();
		const saved = runtime.listWorkflows();
		const disk = readFileSync(join(home, "factory", "workflows.json"), "utf8");
		expect(() =>
			runtime.updateWorkflows(
				saved.map((w) => (w.id === "simple" ? { ...w, allowedTriggers } : w)),
			),
		).toThrow();
		expect(runtime.listWorkflows()).toEqual(saved);
		expect(readFileSync(join(home, "factory", "workflows.json"), "utf8")).toBe(
			disk,
		);
	});
	it("rejects disabling a called child, including fanout, while preserving config", async () => {
		const { runtime } = create();
		const child = {
			...workflow([agent("work")]),
			id: "child",
			internal: true,
			allowedTriggers: ["workflow"],
		};
		const parent = workflow(
			[
				{
					id: "fork",
					name: "Fork",
					type: "fanout",
					groups: [
						[{ id: "call", name: "Call", type: "workflow", workflow: "child" }],
					],
				},
			],
			[child],
		);
		runtime.updateWorkflows([...defaultWorkflows, parent, child]);
		const saved = runtime.listWorkflows();
		expect(() =>
			runtime.updateWorkflows(
				saved.map((w) =>
					w.id === "child" ? { ...w, allowedTriggers: [] } : w,
				),
			),
		).toThrow(/child.*workflow.*Recipes/);
		expect(runtime.listWorkflows()).toEqual(saved);
	});
	it.each([
		"manual",
		"ticket-assignment",
	] as const)("requires trusted root context and checks %s before saving a run", (type) => {
		const { runtime } = create();
		const definition = { ...workflow([agent("work")]), allowedTriggers: [] };
		expect(() =>
			runtime.create({
				title: "Denied",
				repositoryId: "repo",
				workspace: "/tmp",
				input: "",
				workflow: definition,
				triggerOrigin: {
					type,
					workflowId: definition.id,
					at: new Date().toISOString(),
				},
			}),
		).toThrow(`does not allow ${type}`);
		expect(runtime.runs.size).toBe(0);
	});
});

describe("workflow runtime", () => {
	it("batches agent event bursts while saving checkpoints immediately", async () => {
		vi.useFakeTimers();
		try {
			const { runtime, home } = create();
			const run = start(runtime, workflow([agent("review")]));
			await runtime.flush();
			const changed = vi.fn();
			runtime.subscribe(changed);
			const path = join(home, "factory", "runs", `${run.id}.json`);
			for (let index = 0; index < 500; index++)
				runtime.log(run, "review", `Tool result ${index}`, "agent");
			expect(run.events).toHaveLength(500);
			expect(changed).not.toHaveBeenCalled();
			expect(readJson(path).events).toEqual([]);
			await vi.advanceTimersByTimeAsync(250);
			await runtime.flush();
			expect(changed).toHaveBeenCalledTimes(1);
			expect(readJson(path).events).toEqual(run.events);

			runtime.log(run, "review", "Last tool result", "agent");
			run.checkpoint = { current: "end", visits: { review: 1 } };
			await runtime.save(run);
			const saved = readJson(path);
			expect(saved.checkpoint).toEqual(run.checkpoint);
			expect(saved.events).toEqual(run.events);
			await vi.advanceTimersByTimeAsync(250);
			await runtime.flush();
			expect(changed).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
	it("flushes pending agent activity on shutdown", async () => {
		vi.useFakeTimers();
		try {
			const { runtime, home } = create();
			const run = start(runtime, workflow([agent("review")]));
			runtime.log(run, "review", "Final activity", "agent");
			await runtime.shutdown();
			expect(
				readJson(join(home, "factory", "runs", `${run.id}.json`)).events,
			).toEqual(run.events);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("persists agent provenance before trimming an oversized event tail", async () => {
		const { runtime, home } = create();
		const run = start(runtime, workflow([agent("review")]));
		const message = JSON.stringify({
			type: "user",
			content: "Tool output ".repeat(3000),
		});
		runtime.log(run, "review", message, "agent");
		runtime.log(run, "review", "Build output ".repeat(3000));
		await runtime.flush();
		const recovered = reload(home, { agent: async () => ({}) }).get(run.id);
		expect(
			recovered.events.slice(-2).map((event) => ({
				source: event.source,
				length: event.message.length,
			})),
		).toEqual([
			{ source: "agent", length: 20000 },
			{ source: "workflow", length: 20000 },
		]);
	});
	it.each([
		false,
		true,
	])("retries only the failed step with preserved history (legacy=%s)", async (legacy) => {
		let fail = true;
		const execute = vi.fn(async (context: ExecutionContext) => {
			if (context.step.id === "publish" && fail)
				throw new Error("Commit hook rejected");
			return { summary: context.step.id };
		});
		const { runtime } = create({ agent: execute });
		const run = start(
			runtime,
			workflow([agent("implement"), agent("publish")]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toBe("Commit hook rejected");
		const history = structuredClone(run.history);
		if (legacy) delete run.checkpoint;
		fail = false;
		runtime.retry(run.id);
		expect(() => runtime.retry(run.id)).toThrow("Run is already executing");
		await waitFor(() => expect(run.status).toBe("completed"));
		expect(run.error).toBeUndefined();
		expect(run.history.slice(0, history.length)).toEqual(history);
		expect(run.history.map((item) => item.step)).toEqual([
			"implement",
			"publish",
		]);
		expect(execute.mock.calls.map(([context]) => context.step.id)).toEqual([
			"implement",
			"publish",
			"publish",
		]);
		expect(() => runtime.retry(run.id)).toThrow("Run is already executing");
		run.status = "stopped";
		expect(() => runtime.retry(run.id)).toThrow("Run is already executing");
	});
	it("resumes an explicitly stopped run from its native checkpoint without replaying finished steps", async () => {
		let paused = true;
		const execute = vi.fn(async (context: ExecutionContext) => {
			if (context.step.id === "publish") {
				if (paused) {
					await context.checkpointAgent?.({
						sessionId: "saved-native-session",
						runner: "codex",
						cwd: context.run.workspace,
					});
					return new Promise((resolve) =>
						context.signal.addEventListener("abort", () => resolve({}), {
							once: true,
						}),
					);
				}
				expect(context.resumeAgent?.sessionId).toBe("saved-native-session");
			}
			return { summary: context.step.id };
		});
		const { runtime } = create({ agent: execute });
		const run = start(
			runtime,
			workflow([agent("implement"), agent("publish")]),
		);
		void runtime.launch(run);
		await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
		runtime.stop(run.id);
		expect(runtime.canResume(run.id)).toBe(false);
		expect(() => runtime.resume(run.id)).toThrow("Only stopped");
		await waitFor(() => expect(runtime.isExecuting(run.id)).toBe(false));
		const checkpoint = structuredClone(run.checkpoint);
		const history = structuredClone(run.history);
		runtime.updateViewState(run.id, { keptOpen: true });
		runtime.resumeAll();
		expect(run.status).toBe("stopped");
		expect(execute).toHaveBeenCalledTimes(2);
		// Main's stopped-run recovery must still respect catalog availability.
		runtime.updateWorkflows([...defaultWorkflows, run.workflow]);
		runtime.setWorkflowEnabled(run.workflow.id, false);
		expect(runtime.canResume(run.id)).toBe(false);
		expect(() => runtime.resume(run.id)).toThrow("unavailable");
		expect(run.checkpoint).toEqual(checkpoint);
		expect(run.history).toEqual(history);
		runtime.setWorkflowEnabled(run.workflow.id, true);
		expect(runtime.canResume(run.id)).toBe(true);
		expect(run.status).toBe("stopped");
		expect(execute).toHaveBeenCalledTimes(2);
		paused = false;
		runtime.resume(run.id);
		expect(() => runtime.resume(run.id)).toThrow("Only stopped");
		await waitFor(() => expect(run.status).toBe("completed"));
		expect(run.history.slice(0, history.length)).toEqual(history);
		expect(execute.mock.calls.map(([context]) => context.step.id)).toEqual([
			"implement",
			"publish",
			"publish",
		]);
		expect(checkpoint?.current).toBe("publish");
		expect(() => runtime.resume(run.id)).toThrow("Only stopped");
	});
	it("uses the persisted default behind explicit choices and matching labels, including legacy config", async () => {
		const { runtime, home } = create();
		expect(runtime.getDefaultWorkflow()).toBe("simple");
		expect(runtime.selectWorkflow([], "manual").id).toBe("simple");
		writeFileSync(
			join(home, "factory", "workflows.json"),
			JSON.stringify(defaultWorkflows),
		);
		const hooks = { agent: async () => ({}) };
		await runtime.flush();
		const legacy = reload(home, hooks);
		expect(legacy.selectWorkflow([], "manual").id).toBe("simple");
		const custom = workflow([agent("work")]);
		legacy.updateWorkflows([...defaultWorkflows, custom], "custom");
		expect(legacy.selectWorkflow([], "manual").id).toBe("custom");
		expect(legacy.selectWorkflow(["unrelated"], "manual").id).toBe("custom");
		expect(legacy.selectWorkflow(["workflow:factory"], "manual").id).toBe(
			"factory",
		);
		expect(
			legacy.selectWorkflow(["workflow:factory"], "manual", "simple").id,
		).toBe("simple");
		expect(() => legacy.selectWorkflow([], "manual", "missing")).toThrow(
			"Unknown workflow",
		);
		await runtime.flush();
		const restarted = reload(home, hooks);
		expect(restarted.getDefaultWorkflow()).toBe("custom");
		expect(restarted.selectWorkflow([], "manual").id).toBe("custom");
		// Legacy API callers updating definitions retain the selected default.
		restarted.updateWorkflows(restarted.listWorkflows());
		expect(restarted.getDefaultWorkflow()).toBe("custom");
	});
	it("rejects missing or deleted defaults without changing the saved configuration or existing runs", async () => {
		const { runtime, home } = create();
		const custom = workflow([agent("work")]);
		runtime.updateWorkflows([...defaultWorkflows, custom], "custom");
		const run = start(runtime, runtime.selectWorkflow([], "manual"));
		const saved = readFileSync(join(home, "factory", "workflows.json"), "utf8");
		expect(() => runtime.updateWorkflows(defaultWorkflows, "missing")).toThrow(
			"Unknown default workflow",
		);
		expect(() => runtime.updateWorkflows(defaultWorkflows)).toThrow(
			"Unknown default workflow",
		);
		expect(readFileSync(join(home, "factory", "workflows.json"), "utf8")).toBe(
			saved,
		);
		expect(runtime.selectWorkflow([], "manual").id).toBe("custom");
		runtime.updateWorkflows(defaultWorkflows, "factory");
		expect(runtime.selectWorkflow([], "manual").id).toBe("factory");
		expect(run.workflow.id).toBe("custom");
	});

	it("passes the declared plan read while retaining generic source and history", async () => {
		const inputs: Record<string, unknown>[] = [];
		const { runtime } = create({
			agent: async (context) => {
				inputs.push({
					step: context.step.id,
					input: structuredClone(context.input),
				});
				return context.step.id === "plan"
					? { plan: "Build it", assets: [] }
					: { summary: "done" };
			},
		});
		const run = start(
			runtime,
			workflow([
				agent("plan"),
				agent("implement", { reads: { plan: "plan" } }),
				agent("review"),
			]),
		);
		run.launchInputs = { target: "customer dashboard" };
		await runtime.launch(run);
		expect(inputs[1]).toMatchObject({
			step: "implement",
			input: { plan: { plan: "Build it", assets: [] } },
		});
		expect(inputs[2]).toMatchObject({
			input: {
				originalInput: "PRIVATE TICKET INPUT",
				launchInputs: { target: "customer dashboard" },
				history: [{ step: "plan" }, { step: "implement" }],
			},
		});
	});
	it("executes conditional loops and stops visibly at the iteration cap", async () => {
		const { runtime } = create({ agent: async () => ({ approved: false }) });
		const run = start(
			runtime,
			workflow([
				agent("review", {
					maxVisits: 2,
					branches: [
						{ when: { path: "approved", equals: false }, next: "review" },
					],
				}),
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.history).toHaveLength(2);
		expect(run.error).toMatch(/Iteration limit/);
	});
	it("fans out concurrently and joins isolated branch outputs", async () => {
		let arrived = 0;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { runtime } = create({
			agent: async (context) => {
				arrived++;
				if (arrived === 2) release();
				await barrier;
				return { role: context.step.id };
			},
		});
		const run = start(
			runtime,
			workflow([
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [[agent("first")], [agent("second")]],
				},
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("completed");
		expect(run.outputs.parallel).toEqual([
			{ first: { role: "first" } },
			{ second: { role: "second" } },
		]);
	});
	it("cancels sibling fanout work when a branch fails", async () => {
		let siblingStopped = false;
		const { runtime } = create({
			agent: async (context) => {
				if (context.step.id === "fail") throw new Error("branch failed");
				return new Promise((resolve) =>
					context.signal.addEventListener("abort", () => {
						siblingStopped = true;
						resolve({});
					}),
				);
			},
		});
		const run = start(
			runtime,
			workflow([
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [[agent("fail")], [agent("other")]],
				},
			]),
		);
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(siblingStopped).toBe(true);
	});
	it("retains active status and history until startup recovery is launched", async () => {
		const { runtime, home } = create();
		const run = start(runtime, workflow([agent("work")]));
		runtime.log(run, "work", "working");
		await runtime.flush();
		const restarted = reload(home, { agent: async () => ({}) });
		expect(restarted.get(run.id).status).toBe("running");
		expect(restarted.get(run.id).events[0]?.message).toBe("working");
	});
	it("freezes local workflows per run and protects bundled names", async () => {
		const { runtime } = create();
		const local = workflow([agent("work")]);
		runtime.updateWorkflows([...defaultWorkflows, local]);
		const run = start(runtime, local);
		const definitions = runtime.listWorkflows();
		definitions.find((w) => w.id === "custom")!.name = "New name";
		runtime.updateWorkflows(definitions);
		expect(run.workflow.name).toBe("Custom");
		expect(runtime.selectWorkflow([], "manual", "custom").name).toBe(
			"New name",
		);
		definitions.find((w) => w.id === "factory")!.name = "Changed standard";
		expect(() => runtime.updateWorkflows(definitions)).toThrow("read-only");
	});
});

it("rejects missing/recursive workflow calls and hidden human checkpoints in fanout", async () => {
	const call = (target: string) => ({
		id: "call",
		name: "Call",
		type: "workflow",
		workflow: target,
	});
	expect(() => workflow([call("missing")])).toThrow(
		"Unknown or uncallable workflow",
	);
	expect(() => workflow([call("custom")])).toThrow("Recursive workflow");
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			{ engineVersion: "nodes-v1", id: "a", name: "A", steps: [call("b")] },
			{ engineVersion: "nodes-v1", id: "b", name: "B", steps: [call("a")] },
		]),
	).toThrow("Recursive workflow");
	expect(() =>
		workflow([
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [[call("v2-approval")]],
			},
		]),
	).toThrow("Human checkpoints");
});

function reload(home: string, hooks: Partial<RuntimeHooks> = {}) {
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		...hooks,
	});
	// Restored executors must finish their final saves before home cleanup.
	runtimes.push(runtime);
	return runtime;
}
function untilAborted(context: ExecutionContext): Promise<unknown> {
	return new Promise((resolve) =>
		context.signal.addEventListener("abort", () => resolve({}), { once: true }),
	);
}
it.each([
	false,
	true,
])("recovers nested review loops without rerunning completed work or resetting limits (legacy=%s)", async (legacy) => {
	const first = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id === "review") return { approved: false };
		await context.checkpointAgent?.({
			runner: "codex",
			sessionId: "fix-conversation",
		});
		context.log(
			JSON.stringify({ type: "assistant", session_id: "fix-conversation" }),
		);
		return untilAborted(context);
	});
	const { runtime, home } = create({ agent: first });
	runtime.updateWorkflows(
		validateWorkflows([
			...defaultWorkflows,
			{
				engineVersion: "nodes-v1",
				id: "shared",
				name: "Shared",
				internal: true,
				steps: [
					agent("review", {
						maxVisits: 2,
						branches: [
							{ when: { path: "approved", equals: true }, next: "end" },
						],
					}),
					agent("fix", { maxVisits: 1, runner: "codex", next: "review" }),
				],
			},
			{
				engineVersion: "nodes-v1",
				id: "parent",
				name: "Parent",
				steps: [
					{
						id: "pipeline",
						name: "Pipeline",
						type: "workflow",
						workflow: "shared",
					},
				],
			},
		]),
	);
	const run = start(runtime, runtime.selectWorkflow([], "manual", "parent"));
	void runtime.launch(run);
	await waitFor(() => expect(first).toHaveBeenCalledTimes(2));
	await waitFor(() =>
		expect(
			run.events.some(
				(event) =>
					event.message ===
					JSON.stringify({ type: "assistant", session_id: "fix-conversation" }),
			),
		).toBe(true),
	);
	await runtime.shutdown();
	expect(run.status).toBe("running");
	expect(run.history.map((item) => item.step)).toEqual(["pipeline/review"]);
	if (legacy) {
		delete run.checkpoint;
		await runtime.save(run);
	}
	const resumed = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id === "fix") {
			expect(context.resumeAgent).toEqual({
				runner: "codex",
				sessionId: "fix-conversation",
			});
			expect(context.run.history.map((item) => item.step)).toEqual([
				"pipeline/review",
			]);
			return { fixed: true };
		}
		expect(context.resumeAgent).toBeUndefined();
		return { approved: true };
	});
	await runtime.flush();
	const restarted = reload(home, { agent: resumed });
	restarted.resumeAll();
	restarted.resumeAll(); // Repeated startup recovery cannot launch a duplicate executor.
	await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
	expect(resumed.mock.calls.map(([context]) => context.step.id)).toEqual([
		"fix",
		"review",
	]);
	expect(restarted.get(run.id).history.map((item) => item.step)).toEqual([
		"pipeline/review",
		"pipeline/fix",
		"pipeline/review",
		"pipeline",
	]);
	expect(restarted.get(run.id).checkpoint?.active).toBeUndefined();
});
it("recovers partial fanout with isolated outputs, skipping the finished branch", async () => {
	const { runtime, home } = create({
		agent: async (context) => {
			if (context.step.id === "fast") return { value: "retained" };
			await context.checkpointAgent?.({
				runner: "claude",
				sessionId: "slow-conversation",
			});
			return untilAborted(context);
		},
	});
	const run = start(
		runtime,
		workflow([
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [[agent("fast")], [agent("slow")]],
			},
		]),
	);
	void runtime.launch(run);
	await waitFor(() =>
		expect(run.history.map((item) => item.step)).toEqual(["parallel/0/fast"]),
	);
	await runtime.shutdown();
	const agentHook = vi.fn(async (context: ExecutionContext) => {
		expect(context.step.id).toBe("slow");
		expect(context.resumeAgent).toEqual({
			runner: "claude",
			sessionId: "slow-conversation",
		});
		expect(context.outputs).not.toHaveProperty("fast");
		return { value: "resumed" };
	});
	await runtime.flush();
	const restarted = reload(home, { agent: agentHook });
	restarted.resumeAll();
	await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
	expect(agentHook).toHaveBeenCalledTimes(1);
	expect(restarted.get(run.id).outputs.parallel).toEqual([
		{ fast: { value: "retained" } },
		{ slow: { value: "resumed" } },
	]);
});

it("does not resume completed, failed or explicitly stopped runs", async () => {
	const { runtime, home } = create({
		agent: async () => {
			throw new Error("failure");
		},
	});
	const failed = start(runtime, workflow([agent("work")]));
	await runtime.launch(failed);
	const stopped = start(runtime, workflow([agent("work")]));
	runtime.stop(stopped.id);
	const completed = start(runtime, workflow([agent("work")]));
	completed.status = "completed";
	await runtime.save(completed);
	const agentHook = vi.fn(async () => ({}));
	await runtime.flush();
	const restarted = reload(home, { agent: agentHook });
	restarted.resumeAll();
	expect(agentHook).not.toHaveBeenCalled();
	expect([...restarted.runs.values()].map((run) => run.status)).toEqual(
		expect.arrayContaining(["failed", "stopped", "completed"]),
	);
});

it("grants a bounded persisted retry budget only to the exhausted nested step", async () => {
	let approve = false;
	const hooks = { agent: async () => ({ approved: approve }) };
	const { runtime, home } = create(hooks);
	const child = workflow([
		agent("review", {
			maxVisits: 1,
			branches: [{ when: { path: "approved", equals: false }, next: "review" }],
		}),
	]);
	child.id = "child";
	runtime.updateWorkflows([...defaultWorkflows, child]);
	const parent = validateWorkflows([
		...defaultWorkflows,
		child,
		{
			engineVersion: "nodes-v1",
			id: "parent",
			name: "parent",
			steps: [
				{
					id: "pipeline",
					name: "pipeline",
					type: "workflow",
					workflow: "child",
				},
			],
		},
	]).at(-1)!;
	const run = start(runtime, parent);
	await runtime.launch(run);
	expect(run.iterationLimit).toEqual({
		step: "pipeline/review",
		visits: 2,
		limit: 1,
	});
	const prior = structuredClone(run.history);
	runtime.retry(run.id);
	await waitFor(() => expect(run.status).toBe("failed"));
	expect(run.history).toHaveLength(5);
	expect(run.iterationLimit).toEqual({
		step: "pipeline/review",
		visits: 6,
		limit: 5,
	});
	expect(run.checkpoint?.additionalVisits).toBeUndefined();
	expect(run.checkpoint?.active?.children?.[0]?.additionalVisits).toEqual({
		review: 4,
	});
	await runtime.flush();
	const restarted = reload(home, hooks);
	const restored = restarted.get(run.id);
	expect(restored.history.slice(0, prior.length)).toEqual(prior);
	approve = true;
	restarted.retry(restored.id);
	await waitFor(() => expect(restored.status).toBe("completed"));
	expect(
		restored.history.filter((x) => x.step === "pipeline/review"),
	).toHaveLength(6);
	expect(restored.iterationLimit).toBeUndefined();
});

it.each([
	"workflow",
	"fanout",
])("explicit Retry reopens only an exhausted %s correction and retains its evidence", async (type) => {
	let recovered = false;
	const calls: ExecutionContext[] = [];
	const hooks = {
		agent: async (ctx: ExecutionContext) => {
			calls.push(ctx);
			expect(ctx.resumeAgent?.sessionId).toBe("saved-guide-thread");
			expect(ctx.resumeAgent?.rejected).toMatchObject({
				attempts: 0,
				exhausted: false,
				output: { chapters: [], requirements: [] },
				issues: [{ path: "/chapters", message: "Missing chapters" }],
			});
			if (!recovered) {
				await ctx.checkpointAgent?.({
					...ctx.resumeAgent!,
					rejected: {
						...ctx.resumeAgent!.rejected!,
						attempts: 2,
						exhausted: true,
					},
				});
				throw new Error("Output correction exhausted");
			}
			return { summary: "Guide recovered" };
		},
	};
	const { runtime, home } = create(hooks);
	const child = { ...workflow([agent("guide", { next: "end" })]), id: "child" };
	runtime.updateWorkflows([...defaultWorkflows, child]);
	const parent = workflow(
		[
			{
				id: "pipeline",
				name: "Pipeline",
				type,
				...(type === "workflow"
					? { workflow: "child" }
					: { groups: [[agent("guide", { next: "end" })]] }),
			},
		],
		[child],
	);
	const run = start(runtime, parent);
	run.status = "failed";
	run.outputs.implementation = { summary: "Accepted implementation" };
	run.history.push({
		step: "implementation",
		at: run.createdAt,
		output: run.outputs.implementation,
	});
	const retained = structuredClone(run.history);
	run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "guide",
					visits: { guide: 1 },
					...(type === "fanout"
						? { outputs: structuredClone(run.outputs) }
						: {}),
					active: {
						phase: "executing",
						agent: {
							runner: "codex",
							sessionId: "saved-guide-thread",
							rejected: {
								attempts: 2,
								exhausted: true,
								output: { chapters: [], requirements: [] },
								issues: [{ path: "/chapters", message: "Missing chapters" }],
								revision: {
									headSha: "unchanged",
									dirty: false,
									historyLength: 1,
									at: run.createdAt,
								},
							},
						},
					},
				},
			],
		},
	};
	await runtime.save(run);
	await runtime.flush();
	const restarted = reload(home, hooks);
	const restored = restarted.get(run.id);
	restarted.retry(run.id);
	await waitFor(() => {
		expect(restored.status).toBe("failed");
		expect(restarted.isExecuting(run.id)).toBe(false);
	});
	expect(calls).toHaveLength(1);
	// Automatic restart cannot replenish an exhausted budget.
	await runtime.flush();
	await restarted.flush();
	const again = reload(home, {
		agent: async (ctx) => {
			expect(ctx.resumeAgent?.rejected?.exhausted).toBe(true);
			throw new Error("Output correction exhausted");
		},
		...hooks,
	});
	again.resumeAll();
	expect(again.get(run.id).status).toBe("failed");
	recovered = true;
	restarted.retry(run.id);
	await waitFor(() => expect(restored.status).toBe("completed"));
	expect(calls).toHaveLength(2);
	expect(restored.history.slice(0, retained.length)).toEqual(retained);
	expect(restored.outputs.implementation).toEqual(run.outputs.implementation);
});

it.each([
	"missing startup receipt",
	"different role",
	"completed visit",
	"different thread",
	"ordinary timeout",
	"assistant activity",
	"tool result",
	"successful turn",
	"failed turn",
	"unknown activity",
	"saved output",
	"saved correction",
	"other provider",
	"truncated activity",
])("keeps Codex checkpoints when recovery is unsafe: %s", async (condition) => {
	let resumed: ExecutionContext["resumeAgent"];
	const { runtime } = create({
		agent: async (ctx) => {
			resumed = structuredClone(ctx.resumeAgent);
			return {};
		},
	});
	const run = start(runtime, workflow([agent("capture")]));
	run.checkpoint = { current: "capture", visits: { capture: 1 } };
	failedCodexStartup(run, "capture", run.checkpoint);
	const saved = run.checkpoint.active!.agent!;
	if (condition === "missing startup receipt") run.events = [];
	if (condition === "different role") run.events[0]!.step = "other/capture";
	if (condition === "completed visit")
		run.history.push({
			step: "capture",
			output: {},
			at: new Date(Date.parse(run.createdAt) + 1).toISOString(),
		});
	if (condition === "different thread") saved.sessionId = "real-thread";
	if (condition === "ordinary timeout")
		run.error = "initialize timed out after 60000ms";
	if (condition === "other provider") saved.runner = "claude";
	if (["failed turn", "unknown activity"].includes(condition))
		run.events.push({
			at: run.createdAt,
			step: "capture",
			source: "agent",
			message: JSON.stringify({
				type: condition === "failed turn" ? "result" : "unexpected",
				session_id: saved.sessionId,
				is_error: true,
				errors: ["fixture turn failed after thread creation"],
			}),
		});
	if (condition === "truncated activity")
		run.events.push({
			at: run.createdAt,
			step: "capture",
			source: "agent",
			message: "...truncated tool activity",
		});
	if (
		["assistant activity", "tool result", "successful turn"].includes(condition)
	)
		run.events.push({
			at: run.createdAt,
			step: "capture",
			source: "agent",
			message: JSON.stringify({
				type:
					condition === "successful turn"
						? "result"
						: condition === "tool result"
							? "user"
							: "assistant",
				session_id: saved.sessionId,
				is_error: false,
			}),
		});
	if (condition === "saved output")
		saved.result = {
			output: { summary: "Keep" },
			revision: { headSha: "head", dirty: false, historyLength: 0, at: "" },
		};
	if (condition === "saved correction")
		saved.rejected = { output: { summary: "Keep" }, issues: [], attempts: 1 };
	const prior = structuredClone(saved);
	runtime.retry(run.id);
	await waitFor(() => expect(run.status).toBe("completed"));
	expect(resumed).toEqual(prior);
	expect(
		run.events.some((event) =>
			event.message.includes("Removed invalid Codex startup checkpoint"),
		),
	).toBe(false);
});

it("inherits chat through nested workflows with explicit workflow and step overrides", async () => {
	const observed: boolean[] = [];
	const { runtime, home } = create({
		agent: async (context) => {
			observed.push(context.chat!);
			return {};
		},
	});
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "chat-parent",
			name: "Parent",
			chat: true,
			steps: [
				{
					id: "nested",
					name: "Nested",
					type: "workflow",
					workflow: "chat-child",
				},
			],
		},
		{
			engineVersion: "nodes-v1",
			id: "chat-child",
			name: "Child",
			internal: true,
			steps: [
				agent("inherited"),
				agent("private", { chat: false }),
				agent("public", { chat: true }),
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const make = () =>
		runtime.create({
			title: "Chat",
			repositoryId: "repo",
			workspace: home,
			input: "",
			workflow: runtime.selectWorkflow([], "manual", "chat-parent"),
			triggerOrigin: {
				type: "manual",
				workflowId: "chat-parent",
				at: new Date().toISOString(),
			},
		});
	await runtime.launch(make());
	expect(observed).toEqual([true, false, true]);
	observed.length = 0;
	runtime.updateWorkflows(
		definitions.map((w) => (w.id === "chat-child" ? { ...w, chat: false } : w)),
	);
	await runtime.launch(make());
	expect(observed).toEqual([false, false, true]);
});
it("continues a finished simple run once with the same conversation and persists messages separately", async () => {
	let finish!: () => void;
	const { runtime, home } = create({
		simple: (run) => {
			expect(run.simpleExecution?.agent?.sessionId).toBe("native-thread");
			expect(run.simplePrompt).toBe("Follow up");
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
	});
	const run = runtime.create({
		title: "Chat",
		repositoryId: "repo",
		workspace: home,
		input: "Original",
		workflow: runtime.selectWorkflow([], "manual", "simple"),
		triggerOrigin: {
			type: "manual",
			workflowId: "simple",
			at: new Date().toISOString(),
		},
	});
	run.status = "completed";
	run.simpleExecution = {
		runner: "codex",
		userPrompt: "Original",
		agent: { runner: "codex", sessionId: "native-thread" },
	};
	await runtime.save(run);
	runtime.continueSimple(run.id, "Follow up");
	expect(run.status).toBe("running");
	expect(() => runtime.continueSimple(run.id, "Duplicate")).toThrow();
	const message = runtime.recordChatMessage(run.id, "Follow up", "simple");
	expect(
		reload(home, { agent: async () => ({}) }).chatMessages(run.id),
	).toEqual([message]);
	await waitFor(() => expect(finish).toBeTypeOf("function"));
	finish();
	await waitFor(() => expect(run.status).toBe("completed"));
	expect(run.workspace).toBe(home);
	expect(run.input).toBe("Original");
});
