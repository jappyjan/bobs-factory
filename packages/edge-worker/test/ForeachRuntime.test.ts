import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../src/MachineCapacity.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const instance of runtimes.splice(0)) await instance.shutdown();
	for (const directory of homes.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function home() {
	const directory = mkdtempSync(join(tmpdir(), "foreach-runtime-"));
	homes.push(directory);
	return directory;
}
function runtime(directory: string, hooks: Partial<RuntimeHooks> = {}) {
	const instance = new WorkflowRuntime(directory, {
		agent: async () => {
			throw new Error("Unexpected agent call");
		},
		...hooks,
	});
	runtimes.push(instance);
	return instance;
}
function agent(id: string, extra: Record<string, unknown> = {}) {
	return { id, name: id, type: "agent", prompt: "Fixture task", ...extra };
}
function each(
	values: unknown[],
	body: unknown[],
	extra: Record<string, unknown> = {},
) {
	return {
		id: "each",
		name: "For each",
		type: "foreach",
		items: { values },
		body,
		...extra,
	};
}
function create(
	instance: WorkflowRuntime,
	directory: string,
	steps: unknown[],
	dependencies: unknown[] = [],
) {
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...dependencies,
		{
			engineVersion: "nodes-v1",
			id: "foreach-fixture",
			name: "For each fixture",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]);
	instance.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	return instance.create({
		title: "For each fixture",
		repositoryId: "fixture",
		workspace: directory,
		input: "Controlled fixture",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-22T00:00:00.000Z",
		},
	});
}
function untilAborted(context: ExecutionContext): Promise<unknown> {
	if (context.signal.aborted) return Promise.resolve({});
	return new Promise((resolve) =>
		context.signal.addEventListener("abort", () => resolve({}), { once: true }),
	);
}

describe("durable For each execution", () => {
	it("runs agent source → For each → Check with arbitrary names and keyed results", async () => {
		const directory = home();
		const calls: string[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				calls.push(context.stepKey!);
				if (context.step.id === "coordinate")
					return {
						assignments: [
							{ id: "beta", name: "B" },
							{ id: "alpha", name: "A" },
						],
					};
				const bindings = stepBindings(context);
				expect(bindings).toEqual({
					assignment: context.iteration!.value,
					ordinal: context.iteration!.index,
				});
				expect(context.input).toMatchObject({
					item: context.iteration!.value,
					index: context.iteration!.index,
				});
				return {
					brief: `${(bindings.assignment as { name: string }).name}:${bindings.ordinal}`,
				};
			},
		});
		const run = create(instance, directory, [
			agent("coordinate"),
			each(
				[],
				[
					agent("inspect", {
						reads: { assignment: "@item", ordinal: "@index" },
					}),
				],
				{ items: { from: "/coordinate/assignments" } },
			),
			{
				id: "verify",
				name: "Verify",
				type: "check",
				reads: { batch: "each" },
				check: {
					results: {
						complete: { path: "/inputs/batch/summary/completed", equals: 2 },
						alpha: {
							path: "/inputs/batch/results/alpha/inspect/brief",
							equals: "A:1",
						},
						beta: {
							path: "/inputs/batch/results/beta/inspect/brief",
							equals: "B:0",
						},
					},
				},
			},
		]);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(calls).toEqual([
			"coordinate",
			"each/beta/inspect",
			"each/alpha/inspect",
		]);
		expect(run.outputs.each).toEqual({
			results: {
				beta: { inspect: { brief: "B:0" } },
				alpha: { inspect: { brief: "A:1" } },
			},
			summary: {
				total: 2,
				completed: 2,
				failed: 0,
				cancelled: 0,
				failures: [],
				limitations: [],
			},
		});
		expect(run.outputs.verify).toEqual({
			passed: true,
			complete: true,
			alpha: true,
			beta: true,
		});
		expect(run.foreach?.each).toMatchObject({
			completed: 2,
			total: 2,
			items: [
				{ id: "beta", index: 0, status: "completed" },
				{ id: "alpha", index: 1, status: "completed" },
			],
		});
		const receipts = run.history.filter((entry) =>
			entry.step.includes("/inspect"),
		);
		expect(receipts.map((entry) => entry.step).sort()).toEqual([
			"each/alpha/inspect",
			"each/beta/inspect",
		]);
		expect(
			run.stepAttempts
				?.filter(
					(attempt) =>
						attempt.kind === "step" && attempt.step.includes("/inspect"),
				)
				.map((attempt) => ({
					step: attempt.step,
					iteration: attempt.iteration,
				}))
				.sort((a, b) => a.step.localeCompare(b.step)),
		).toEqual([
			{
				step: "each/alpha/inspect",
				iteration: {
					frame: "each",
					id: "alpha",
					index: 1,
					itemDigest: expect.any(String),
				},
			},
			{
				step: "each/beta/inspect",
				iteration: {
					frame: "each",
					id: "beta",
					index: 0,
					itemDigest: expect.any(String),
				},
			},
		]);
	});

	it("bounds in-flight iterations by configured concurrency and preserves accepted aggregate order", async () => {
		const directory = home();
		const release = new Map<string, () => void>();
		let active = 0,
			peak = 0;
		const agentHook = vi.fn(async (context: ExecutionContext) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise<void>((resolve) =>
				release.set(context.iteration!.id, resolve),
			);
			active--;
			return { id: context.iteration!.id };
		});
		const instance = runtime(directory, { agent: agentHook });
		const run = create(instance, directory, [
			each(
				["a", "b", "c", "d"].map((id) => ({ id })),
				[agent("work")],
				{ concurrency: 2 },
			),
		]);
		const done = instance.launch(run);
		await waitFor(() => expect(release.size).toBe(2));
		expect(agentHook).toHaveBeenCalledTimes(2);
		release.get("b")!();
		await waitFor(() => expect(release.has("c")).toBe(true));
		release.get("c")!();
		await waitFor(() => expect(release.has("d")).toBe(true));
		release.get("d")!();
		release.get("a")!();
		await done;
		expect(run.error).toBeUndefined();
		expect(peak).toBe(2);
		expect(
			Object.keys((run.outputs.each as { results: object }).results),
		).toEqual(["a", "b", "c", "d"]);
	});

	it("keeps successful items with explicit limitations and original failure ordering", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) => {
				if (context.iteration!.id === "bad") throw new Error("Fixture failure");
				return { id: context.iteration!.id };
			},
		});
		const run = create(instance, directory, [
			each([{ id: "good" }, { id: "bad" }, { id: "last" }], [agent("work")], {
				failure: "keep-successful",
				concurrency: 1,
			}),
		]);
		await instance.launch(run);
		expect(run.status).toBe("completed");
		expect(run.outputs.each).toEqual({
			results: {
				good: { work: { id: "good" } },
				last: { work: { id: "last" } },
			},
			summary: {
				total: 3,
				completed: 2,
				failed: 1,
				cancelled: 0,
				failures: [
					{ id: "bad", index: 1, status: "failed", error: "Fixture failure" },
				],
				limitations: ["bad: Fixture failure"],
			},
		});
		expect(run.history.map((entry) => entry.step)).toEqual([
			"each/good/work",
			"each/last/work",
			"each",
		]);
	});

	it("all-must-succeed aborts active siblings, stops undispatched items and retains completed receipts", async () => {
		const directory = home();
		let fail!: () => void;
		let siblingAborted = false;
		const calls: string[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				const id = context.iteration!.id;
				calls.push(id);
				if (id === "done") return { receipt: "original" };
				if (id === "fail") {
					await new Promise<void>((resolve) => {
						fail = resolve;
					});
					throw new Error("Required item failed");
				}
				await untilAborted(context);
				siblingAborted = true;
				return {};
			},
		});
		const run = create(instance, directory, [
			each(
				["done", "fail", "active", "undispatched"].map((id) => ({ id })),
				[agent("work")],
				{ concurrency: 2 },
			),
		]);
		const done = instance.launch(run);
		await waitFor(() => expect(calls).toEqual(["done", "fail", "active"]));
		fail();
		await done;
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/Required item failed/);
		expect(siblingAborted).toBe(true);
		expect(calls).not.toContain("undispatched");
		expect(run.outputs.each).toBeUndefined();
		expect(run.history.map((entry) => entry.step)).toEqual(["each/done/work"]);
		expect(run.history[0]!.output).toEqual({ receipt: "original" });
		expect(run.foreach?.each?.items.map((item) => item.status)).toEqual([
			"completed",
			"failed",
			"cancelled",
			"cancelled",
		]);
	});

	it("treats a terminal failed result as an item failure instead of false success", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async () => ({
				status: "failed",
				error: "Action could not finish",
			}),
		});
		const run = create(instance, directory, [
			each(
				[{ id: "a" }],
				[{ id: "act", name: "Act", type: "agent", prompt: "fixture" }],
				{ failure: "keep-successful" },
			),
		]);
		await instance.launch(run);
		expect(run.status).toBe("completed");
		expect(run.outputs.each).toMatchObject({
			results: {},
			summary: {
				completed: 0,
				failed: 1,
				failures: [{ id: "a", status: "failed" }],
			},
		});
	});

	it.each([
		{ wrapper: "call", failure: "keep-successful" },
		{ wrapper: "call", failure: "all-must-succeed" },
		{ wrapper: "fanout", failure: "keep-successful" },
		{ wrapper: "fanout", failure: "all-must-succeed" },
	] as const)("propagates terminal failed results through $wrapper under $failure", async ({
		wrapper,
		failure,
	}) => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async () => ({ status: "failed", error: "Nested action failed" }),
		});
		const act = { id: "act", name: "Act", type: "agent", prompt: "fixture" };
		const body =
			wrapper === "call"
				? [{ id: "call", name: "Call", type: "workflow", workflow: "worker" }]
				: [
						{
							id: "parallel",
							name: "Parallel",
							type: "fanout",
							groups: [[act]],
						},
					];
		const run = create(
			instance,
			directory,
			[each([{ id: "a" }], body, { failure })],
			[
				{
					engineVersion: "nodes-v1",
					id: "worker",
					name: "Worker",
					allowedTriggers: ["workflow"],
					steps: [act],
				},
			],
		);
		await instance.launch(run);
		expect(run.foreach?.each?.items).toMatchObject([
			{ id: "a", status: "failed" },
		]);
		expect(
			run.history.some(
				(receipt) =>
					receipt.step.endsWith("/act") &&
					(receipt.output as { status: string }).status === "failed",
			),
		).toBe(true);
		if (failure === "all-must-succeed") {
			expect(run.status).toBe("failed");
			expect(run.outputs.each).toBeUndefined();
		} else {
			expect(run.status).toBe("completed");
			expect(run.outputs.each).toMatchObject({
				results: {},
				summary: {
					total: 1,
					completed: 0,
					failed: 1,
					failures: [{ id: "a", status: "failed" }],
				},
			});
		}
	});

	it("preserves a terminal failed agent's native session across persisted reload and explicit Retry", async () => {
		const directory = home();
		const first = vi.fn(async (context: ExecutionContext) => {
			if (context.iteration!.id === "done")
				return { status: "completed", receipt: "retained" };
			const output = { status: "failed", error: "Provider action unfinished" };
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "failed-item-native",
				idleRetries: 1,
				result: {
					output,
					revision: {
						headSha: "fixture",
						dirty: false,
						historyLength: context.run.history.length,
						at: context.run.createdAt,
					},
				},
			});
			return output;
		});
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			each(
				[{ id: "done" }, { id: "failed" }],
				[agent("work", { runner: "codex", maxVisits: 2 })],
				{ concurrency: 1 },
			),
		]);
		await instance.launch(run);
		expect(run.status).toBe("failed");
		await instance.shutdown();
		await instance.flush();
		const resumed = vi.fn(async (context: ExecutionContext) => {
			expect(context.iteration!.id).toBe("failed");
			expect(context.resumeAgent).toMatchObject({
				runner: "codex",
				sessionId: "failed-item-native",
			});
			expect(context.resumeAgent?.result).toBeUndefined();
			return { status: "completed", receipt: "continued" };
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.retry(run.id);
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(resumed).toHaveBeenCalledOnce();
		const restored = restarted.get(run.id);
		expect(
			restored.history.filter((receipt) => receipt.step === "each/done/work"),
		).toHaveLength(1);
		expect(
			restored.history
				.filter((receipt) => receipt.step === "each/failed/work")
				.map((receipt) => receipt.output),
		).toEqual([
			{ status: "failed", error: "Provider action unfinished" },
			{ status: "completed", receipt: "continued" },
		]);
		expect(restored.outputs.each).toMatchObject({
			results: {
				done: { work: { receipt: "retained" } },
				failed: { work: { receipt: "continued" } },
			},
			summary: { total: 2, completed: 2, failed: 0 },
		});
	});

	it("keeps nested inline and called item/index frames lexical with mapped call inputs", async () => {
		const directory = home();
		const observed = new Map<string, unknown>();
		const instance = runtime(directory, {
			agent: async (context) => {
				const bindings = stepBindings(context);
				observed.set(context.stepKey!, bindings);
				return bindings;
			},
		});
		const child = {
			engineVersion: "nodes-v1",
			id: "worker",
			name: "Worker",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [
				agent("inspect", {
					reads: {
						current: "@item",
						ordinal: "@index",
						topic: "@callInputs/topic",
					},
				}),
			],
		};
		const run = create(
			instance,
			directory,
			[
				each(
					[
						{
							id: "north",
							assignments: [{ id: "same", name: "North assignment" }],
						},
						{
							id: "south",
							assignments: [{ id: "same", name: "South assignment" }],
						},
					],
					[
						each(
							[],
							[
								{
									id: "call",
									name: "Call",
									type: "workflow",
									workflow: "worker",
									inputMapping: { topic: "/item/name" },
								},
							],
							{ id: "nested", items: { from: "/item/assignments" } },
						),
						agent("outer", { reads: { current: "@item", ordinal: "@index" } }),
					],
				),
			],
			[child],
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(observed.get("each/north/nested/same/call/inspect")).toEqual({
			current: { id: "same", name: "North assignment" },
			ordinal: 0,
			topic: "North assignment",
		});
		expect(observed.get("each/south/nested/same/call/inspect")).toEqual({
			current: { id: "same", name: "South assignment" },
			ordinal: 0,
			topic: "South assignment",
		});
		expect(observed.get("each/north/outer")).toEqual({
			current: {
				id: "north",
				assignments: [{ id: "same", name: "North assignment" }],
			},
			ordinal: 0,
		});
		expect(observed.get("each/south/outer")).toEqual({
			current: {
				id: "south",
				assignments: [{ id: "same", name: "South assignment" }],
			},
			ordinal: 1,
		});
		expect(run.outputs).not.toHaveProperty("topic");
		expect(run.outputs).not.toHaveProperty("inspect");
		expect(run.outputs.each).toMatchObject({
			results: {
				north: {
					nested: {
						results: {
							same: {
								call: {
									workflow: "worker",
									completed: true,
									outputs: { inspect: { topic: "North assignment" } },
								},
							},
						},
					},
				},
			},
		});
	});

	it("retains accepted call inputs when a called role mutates graph outputs and its input copies", async () => {
		const directory = home();
		const observed: unknown[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				if (context.step.id === "first") {
					(context.outputs!.topic as { brief: string }).brief =
						"changed graph output";
					const input = context.input as {
						accepted: { brief: string };
						item: { details: { brief: string } };
					};
					input.accepted.brief = "changed named read";
					input.item.details.brief = "changed lexical input copy";
					return { complete: true };
				}
				const bindings = stepBindings(context);
				observed.push(bindings);
				return bindings;
			},
		});
		const child = {
			engineVersion: "nodes-v1",
			id: "worker",
			name: "Worker",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [
				agent("first", { reads: { accepted: "@callInputs/topic" } }),
				agent("second", {
					reads: { accepted: "@callInputs/topic", current: "@item" },
				}),
			],
		};
		const item = { id: "a", details: { brief: "original" } };
		const run = create(
			instance,
			directory,
			[
				each(
					[item],
					[
						{
							id: "call",
							name: "Call",
							type: "workflow",
							workflow: "worker",
							inputMapping: { topic: "/item/details" },
						},
						agent("outer", { reads: { current: "@item" } }),
					],
				),
			],
			[child],
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(observed).toEqual([
			{ accepted: { brief: "original" }, current: item },
			{ current: item },
		]);
		expect(run.foreachIterations?.[0]?.snapshot.items[0]?.value).toEqual(item);
		expect(run.outputs.each).toMatchObject({
			results: {
				a: {
					call: {
						outputs: {
							second: { accepted: { brief: "original" }, current: item },
						},
					},
					outer: { current: item },
				},
			},
		});
	});

	it("runs nested called intensive leaves at real machine capacity one without retaining parent slots", async () => {
		const directory = home();
		const capacity = new MachineCapacity(
			1,
			join(directory, "machine-capacity"),
		);
		let active = 0,
			peak = 0;
		const script = vi.fn(async () => {
			peak = Math.max(peak, ++active);
			await Promise.resolve();
			active--;
			return { complete: true };
		});
		const instance = runtime(directory, { capacity, agent: script });
		const child = {
			engineVersion: "nodes-v1",
			id: "worker",
			name: "Worker",
			allowedTriggers: ["workflow"],
			steps: [{ id: "heavy", name: "Heavy", type: "agent", prompt: "fixture" }],
		};
		const run = create(
			instance,
			directory,
			[
				each(
					[{ id: "a" }, { id: "b" }],
					[
						each(
							[{ id: "x" }, { id: "y" }],
							[
								{
									id: "call",
									name: "Call",
									type: "workflow",
									workflow: "worker",
								},
							],
							{ id: "nested", concurrency: 2 },
						),
					],
					{ concurrency: 2 },
				),
			],
			[child],
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(script).toHaveBeenCalledTimes(4);
		expect(peak).toBe(1);
		expect(await capacity.snapshot()).toMatchObject({ active: 0, queued: 0 });
	});

	it("reloads normal persisted progress, skips completed items and resumes unfinished native context", async () => {
		const directory = home();
		const initial = vi.fn(async (context: ExecutionContext) => {
			if (context.iteration!.id === "complete") return { receipt: "original" };
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "unfinished-item-thread",
				idleRetries: 1,
			});
			return untilAborted(context);
		});
		const instance = runtime(directory, { agent: initial });
		const run = create(instance, directory, [
			each(
				[{ id: "complete" }, { id: "unfinished" }, { id: "later" }],
				[agent("work", { runner: "codex", maxVisits: 1 })],
				{ concurrency: 1 },
			),
		]);
		void instance.launch(run);
		await waitFor(() => expect(initial).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(
				run.checkpoint.active?.children?.[1]?.active?.agent?.sessionId,
			).toBe("unfinished-item-thread"),
		);
		await instance.shutdown();
		await instance.flush();
		const resumed = vi.fn(async (context: ExecutionContext) => {
			if (context.iteration!.id === "unfinished")
				expect(context.resumeAgent).toEqual({
					runner: "codex",
					sessionId: "unfinished-item-thread",
					idleRetries: 1,
				});
			else expect(context.resumeAgent).toBeUndefined();
			return { receipt: `finished-${context.iteration!.id}` };
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		const restored = restarted.get(run.id);
		expect(resumed.mock.calls.map(([context]) => context.stepKey)).toEqual([
			"each/unfinished/work",
			"each/later/work",
		]);
		expect(
			restored.history.filter((entry) => entry.step === "each/complete/work"),
		).toHaveLength(1);
		expect(restored.outputs.each).toMatchObject({
			results: { complete: { work: { receipt: "original" } } },
			summary: { total: 3, completed: 3, failed: 0 },
		});
	});

	it("recovers the completion-before-join save boundary without dispatching completed work again", async () => {
		const directory = home();
		const first = vi.fn(async () => ({ receipt: "accepted before join" }));
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			each([{ id: "a" }], [agent("work")]),
		]);
		let held = false;
		let release!: () => void;
		const boundary = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = instance.save.bind(instance);
		vi.spyOn(instance, "save").mockImplementation(async (value) => {
			const atBoundary =
				value.checkpoint.active?.foreach?.states[0]?.status === "completed" &&
				!Object.hasOwn(value.outputs, "each");
			await save(value);
			if (atBoundary) {
				held = true;
				await boundary;
			}
		});
		void instance.launch(run);
		await waitFor(() => expect(held).toBe(true));
		expect(run.outputs.each).toBeUndefined();
		expect(run.history.map((entry) => entry.step)).toEqual(["each/a/work"]);
		const stopping = instance.shutdown();
		release();
		await stopping;
		await instance.flush();
		const resumed = vi.fn(async () => {
			throw new Error("Completed item must not replay");
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(resumed).not.toHaveBeenCalled();
		expect(restarted.get(run.id).outputs.each).toMatchObject({
			results: { a: { work: { receipt: "accepted before join" } } },
			summary: { completed: 1 },
		});
	});

	it("explicit cancellation retains completed receipts without returning partial success under keep-successful", async () => {
		const directory = home();
		const agentHook = vi.fn(async (context: ExecutionContext) => {
			if (context.iteration!.id === "done") return { receipt: "retained" };
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "cancelled-native",
			});
			return untilAborted(context);
		});
		const instance = runtime(directory, { agent: agentHook });
		const run = create(instance, directory, [
			each(
				[{ id: "done" }, { id: "active" }, { id: "later" }],
				[agent("work")],
				{ concurrency: 1, failure: "keep-successful" },
			),
		]);
		const done = instance.launch(run);
		await waitFor(() =>
			expect(
				run.checkpoint.active?.children?.[1]?.active?.agent?.sessionId,
			).toBe("cancelled-native"),
		);
		instance.stop(run.id);
		await done;
		expect(run.status).toBe("stopped");
		expect(agentHook).toHaveBeenCalledTimes(2);
		expect(run.outputs.each).toBeUndefined();
		expect(run.history.map((entry) => entry.step)).toEqual(["each/done/work"]);
		expect(run.foreach?.each?.items.map((item) => item.status)).toEqual([
			"completed",
			"cancelled",
			"cancelled",
		]);
	});

	it("retains the pre-dispatch source snapshot across live output and catalog changes", async () => {
		const directory = home();
		const initial = vi.fn(async (context: ExecutionContext) => {
			if (context.step.id === "source")
				return {
					items: [
						{ id: "a", name: "Original A" },
						{ id: "b", name: "Original B" },
					],
				};
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "original-item",
			});
			return untilAborted(context);
		});
		const instance = runtime(directory, { agent: initial });
		const steps = [
			agent("source"),
			each([], [agent("work", { runner: "codex" })], {
				concurrency: 1,
				items: { from: "/source/items" },
			}),
		];
		const run = create(instance, directory, steps);
		void instance.launch(run);
		await waitFor(() => expect(initial).toHaveBeenCalledTimes(2));
		run.outputs.source = { items: [{ id: "new", name: "Changed collection" }] };
		await instance.shutdown();
		await instance.flush();
		const resumed = vi.fn(async (context: ExecutionContext) => ({
			accepted: context.iteration!.value,
		}));
		const restarted = runtime(directory, { agent: resumed });
		const updated = restarted.listWorkflows().map((workflow) =>
			workflow.id === "foreach-fixture"
				? {
						...workflow,
						steps: [
							each([{ id: "replacement" }], [agent("changed")], {
								concurrency: 8,
							}),
						],
					}
				: workflow,
		);
		restarted.updateWorkflows(updated);
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(
			resumed.mock.calls.map(([context]) => [
				context.stepKey,
				context.iteration!.index,
				context.iteration!.value,
			]),
		).toEqual([
			["each/a/work", 0, { id: "a", name: "Original A" }],
			["each/b/work", 1, { id: "b", name: "Original B" }],
		]);
		expect(restarted.get(run.id).foreach?.each).toMatchObject({
			concurrency: 1,
			total: 2,
		});
	});

	it("retains per-item visit budgets across shutdown and explicit bounded retry", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) => {
				await context.checkpointAgent?.({
					runner: "codex",
					sessionId: "loop-native",
				});
				return untilAborted(context);
			},
		});
		const run = create(instance, directory, [
			each(
				[{ id: "a" }],
				[agent("loop", { runner: "codex", maxVisits: 1, next: "loop" })],
			),
		]);
		void instance.launch(run);
		await waitFor(() =>
			expect(
				run.checkpoint.active?.children?.[0]?.active?.agent?.sessionId,
			).toBe("loop-native"),
		);
		await instance.shutdown();
		await instance.flush();
		const agentHook = vi.fn(async () => ({ finished: false }));
		const restarted = runtime(directory, { agent: agentHook });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("failed"));
		expect(agentHook).toHaveBeenCalledTimes(1);
		expect(
			restarted.get(run.id).checkpoint.active?.children?.[0]?.visits.loop,
		).toBe(2);
		expect(restarted.get(run.id).error).toMatch(/limit|visit|budget/i);
		await waitFor(() => expect(restarted.isExecuting(run.id)).toBe(false));
		restarted.retry(run.id);
		await waitFor(() => expect(restarted.get(run.id).status).toBe("failed"));
		expect(agentHook).toHaveBeenCalledTimes(5);
		expect(
			restarted.get(run.id).checkpoint.active?.children?.[0]?.additionalVisits
				?.loop,
		).toBe(4);
		expect(
			restarted.get(run.id).checkpoint.active?.children?.[0]?.visits.loop,
		).toBe(6);
	});

	it.each([
		["missing", { from: "/source/missing" }, { items: [] }, /does not resolve/],
		[
			"non-array",
			{ from: "/source/items" },
			{ items: {} },
			/resolve to an array/,
		],
		[
			"duplicate",
			{ from: "/source/items" },
			{ items: [{ id: "same" }, { id: "same" }] },
			/duplicate item ID/,
		],
	] as const)("fails the %s source before any body agent dispatch", async (_name, items, source, error) => {
		const directory = home();
		const agentHook = vi.fn(async () => source);
		const instance = runtime(directory, { agent: agentHook });
		const run = create(instance, directory, [
			agent("source"),
			each([], [agent("work")], { items }),
		]);
		await instance.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(error);
		expect(agentHook).toHaveBeenCalledTimes(1);
		expect(run.history.map((entry) => entry.step)).toEqual(["source"]);
	});
});
