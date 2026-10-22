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
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const instance of runtimes.splice(0)) await instance.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function home() {
	const directory = mkdtempSync(join(tmpdir(), "foreach-ownership-"));
	homes.push(directory);
	return directory;
}
function runtime(directory: string, hooks: Partial<RuntimeHooks>) {
	const instance = new WorkflowRuntime(directory, {
		agent: async () => {
			throw new Error("Unexpected agent invocation");
		},
		tool: async () => {
			throw new Error("Unexpected action invocation");
		},
		script: async () => {
			throw new Error("Unexpected script invocation");
		},
		...hooks,
	});
	runtimes.push(instance);
	return instance;
}
const agent = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Controlled fixture",
	...extra,
});
const each = (
	body: unknown[],
	values: unknown[] = [{ id: "a" }],
	extra = {},
) => ({
	id: "each",
	name: "Each",
	type: "foreach",
	items: { values },
	body,
	...extra,
});
const child = (steps: unknown[], modern = true) => ({
	id: "child",
	name: "Child",
	allowedTriggers: ["workflow"],
	...(modern ? { stepConfigVersion: "step-config-v1" } : {}),
	steps,
});
function create(
	instance: WorkflowRuntime,
	directory: string,
	steps: unknown[],
	dependencies: unknown[] = [],
	modern = true,
) {
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...dependencies,
		{
			id: "ownership-fixture",
			name: "Ownership fixture",
			...(modern ? { stepConfigVersion: "step-config-v1" } : {}),
			steps,
		},
	]);
	instance.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	return instance.create({
		title: "Owned output fixture",
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
type Mode = "foreach" | "mapped call";
function container(mode: Mode, body: unknown[]) {
	return mode === "foreach"
		? {
				step: each(body),
				dependencies: [],
				source: "each",
				pointer: "/inputs/batch/results/a",
			}
		: {
				step: {
					id: "call",
					name: "Call",
					type: "workflow",
					workflow: "child",
					inputMapping: { topic: "/skipped/authority" },
				},
				dependencies: [child(body)],
				source: "call",
				pointer: "/inputs/batch/outputs",
			};
}
const outerApproval = { approved: true, authority: "ancestor only" };
function untilAborted(context: ExecutionContext): Promise<unknown> {
	if (context.signal.aborted) return Promise.resolve({});
	return new Promise((resolve) =>
		context.signal.addEventListener("abort", () => resolve({}), { once: true }),
	);
}

describe("For each and mapped Call output ownership", () => {
	it.each([
		"foreach",
		"mapped call",
	] as const)("does not publish a skipped %s approval while retaining inherited named reads", async (mode) => {
		const directory = home();
		const calls: string[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				calls.push(context.stepKey!);
				if (context.stepKey === "skipped") return outerApproval;
				expect(stepBindings(context).inherited).toEqual(outerApproval);
				if (mode === "mapped call")
					expect(stepBindings(context).topic).toBe("ancestor only");
				return { readAuthority: stepBindings(context).inherited };
			},
		});
		const fixture = container(mode, [
			agent("route", {
				reads: {
					inherited: "skipped",
					...(mode === "mapped call" ? { topic: "@callInputs/topic" } : {}),
				},
				next: "end",
			}),
			agent("skipped"),
		]);
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				fixture.step,
				{
					id: "verify",
					name: "Verify child approval",
					type: "check",
					reads: { batch: fixture.source },
					check: {
						results: {
							childApproved: {
								path: `${fixture.pointer}/skipped/approved`,
								equals: true,
							},
						},
					},
				},
			],
			fixture.dependencies,
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(calls).toEqual([
			"skipped",
			mode === "foreach" ? "each/a/route" : "call/route",
		]);
		expect(run.outputs.verify).toEqual({ passed: false, childApproved: false });
		const output = run.outputs[fixture.source] as {
			results?: { a: unknown };
			outputs?: unknown;
		};
		expect(mode === "foreach" ? output.results!.a : output.outputs).toEqual({
			route: { readAuthority: outerApproval },
		});
		expect(run.outputs.skipped).toEqual(outerApproval);
		expect(
			run.history.filter((receipt) => receipt.step.endsWith("/skipped")),
		).toHaveLength(0);
	});

	it.each([
		"foreach",
		"mapped call",
	] as const)("retains an actually executed colliding %s child result with its own authority", async (mode) => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) => {
				if (context.stepKey === "skipped") return outerApproval;
				if (context.step.id === "route")
					return { inherited: stepBindings(context).inherited };
				return { approved: true, authority: context.stepKey };
			},
		});
		const fixture = container(mode, [
			agent("route", { reads: { inherited: "skipped" } }),
			agent("skipped"),
		]);
		const key = mode === "foreach" ? "each/a/skipped" : "call/skipped";
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				fixture.step,
				{
					id: "verify",
					name: "Verify exact child",
					type: "check",
					reads: { batch: fixture.source },
					check: {
						results: {
							childApproved: {
								path: `${fixture.pointer}/skipped/approved`,
								equals: true,
							},
							exactAuthority: {
								path: `${fixture.pointer}/skipped/authority`,
								equals: key,
							},
						},
					},
				},
			],
			fixture.dependencies,
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.outputs.verify).toEqual({
			passed: true,
			childApproved: true,
			exactAuthority: true,
		});
		expect(run.history.find((receipt) => receipt.step === key)?.output).toEqual(
			{ approved: true, authority: key },
		);
		expect(run.outputs.skipped).toEqual(outerApproval);
	});

	it("separates identically named ancestor, sibling, nested item and called output authorities", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) => {
				if (context.stepKey === "skipped") return outerApproval;
				if (context.step.id === "skipped")
					return { approved: true, authority: context.stepKey };
				return { inherited: stepBindings(context).inherited };
			},
		});
		const called = child([
			agent("route", { reads: { inherited: "skipped" }, next: "end" }),
			agent("skipped"),
		]);
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				each(
					[
						agent("skipped"),
						each(
							[
								{
									id: "call",
									name: "Call",
									type: "workflow",
									workflow: "child",
									inputMapping: {},
								},
							],
							[{ id: "same" }],
							{ id: "nested" },
						),
					],
					[{ id: "north" }, { id: "south" }],
				),
				{
					id: "verify",
					name: "Verify nested authorities",
					type: "check",
					reads: { batch: "each" },
					check: {
						results: {
							northChildApproved: {
								path: "/inputs/batch/results/north/nested/results/same/call/outputs/skipped/approved",
								equals: true,
							},
							southChildApproved: {
								path: "/inputs/batch/results/south/nested/results/same/call/outputs/skipped/approved",
								equals: true,
							},
						},
					},
				},
			],
			[called],
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.outputs.verify).toEqual({
			passed: false,
			northChildApproved: false,
			southChildApproved: false,
		});
		for (const id of ["north", "south"]) {
			const batch = run.outputs.each as {
				results: Record<
					string,
					{
						skipped: unknown;
						nested: { results: { same: { call: { outputs: unknown } } } };
					}
				>;
			};
			const own = { approved: true, authority: `each/${id}/skipped` };
			expect(batch.results[id]!.skipped).toEqual(own);
			expect(batch.results[id]!.nested.results.same.call.outputs).toEqual({
				route: { inherited: own },
			});
		}
		expect(run.outputs.skipped).toEqual(outerApproval);
	});

	it.each([
		"foreach",
		"mapped call",
	] as const)("does not smuggle ancestor approval through a Parallel branch inside %s", async (mode) => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) =>
				context.stepKey === "skipped"
					? outerApproval
					: { inherited: stepBindings(context).inherited },
		});
		const fixture = container(mode, [
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [
					[
						agent("route", { reads: { inherited: "skipped" }, next: "end" }),
						agent("skipped"),
					],
				],
			},
		]);
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				fixture.step,
				{
					id: "verify",
					name: "Verify branch",
					type: "check",
					reads: { batch: fixture.source },
					check: {
						results: {
							childApproved: {
								path: `${fixture.pointer}/parallel/0/skipped/approved`,
								equals: true,
							},
						},
					},
				},
			],
			fixture.dependencies,
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.outputs.verify).toEqual({ passed: false, childApproved: false });
		const output = run.outputs[fixture.source] as {
			results?: { a: { parallel: unknown } };
			outputs?: { parallel: unknown };
		};
		expect(
			mode === "foreach"
				? output.results!.a.parallel
				: output.outputs!.parallel,
		).toEqual([{ route: { inherited: outerApproval } }]);
	});

	it("preserves unmapped legacy Call shared context and its original wrapper shape", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) =>
				context.stepKey === "skipped"
					? outerApproval
					: { inherited: stepBindings(context).skipped },
		});
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				{ id: "call", name: "Call", type: "workflow", workflow: "child" },
			],
			[
				child(
					[
						agent("route", { inputs: ["skipped"], next: "end" }),
						agent("skipped"),
					],
					false,
				),
			],
			false,
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.outputs.call).toEqual({ workflow: "child", completed: true });
		expect(run.outputs.route).toEqual({ inherited: outerApproval });
		expect(run.outputs.skipped).toEqual(outerApproval);
	});

	it("preserves old Parallel output projection outside the new projected scopes", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) =>
				context.stepKey === "skipped"
					? outerApproval
					: { inherited: stepBindings(context).skipped },
		});
		const run = create(
			instance,
			directory,
			[
				agent("skipped"),
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [
						[
							agent("route", { inputs: ["skipped"], next: "end" }),
							agent("skipped"),
						],
					],
				},
			],
			[],
			false,
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.outputs.parallel).toEqual([
			{ route: { inherited: outerApproval }, skipped: outerApproval },
		]);
	});

	it("reloads exact owned item results without replaying completed items or losing unfinished native context", async () => {
		const directory = home();
		const first = vi.fn(async (context: ExecutionContext) => {
			if (context.stepKey === "skipped") return outerApproval;
			if (context.iteration!.id === "done")
				return { inherited: stepBindings(context).inherited };
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "owned-unfinished",
			});
			return untilAborted(context);
		});
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			agent("skipped"),
			each(
				[
					agent("route", {
						runner: "codex",
						reads: { inherited: "skipped" },
						next: "end",
					}),
					agent("skipped"),
				],
				[{ id: "done" }, { id: "unfinished" }],
				{ concurrency: 1 },
			),
		]);
		void instance.launch(run);
		await waitFor(() =>
			expect(
				run.checkpoint?.active?.children?.[1]?.active?.agent?.sessionId,
			).toBe("owned-unfinished"),
		);
		await instance.shutdown();
		await instance.flush();
		const originalReceipts = structuredClone(run.history);
		const resumed = vi.fn(async (context: ExecutionContext) => {
			expect(context.stepKey).toBe("each/unfinished/route");
			expect(context.resumeAgent).toEqual({
				runner: "codex",
				sessionId: "owned-unfinished",
			});
			return { inherited: stepBindings(context).inherited };
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() =>
			expect({
				status: restarted.get(run.id).status,
				error: restarted.get(run.id).error,
			}).toEqual({ status: "completed", error: undefined }),
		);
		const restored = restarted.get(run.id);
		expect(resumed).toHaveBeenCalledOnce();
		expect(restored.history.slice(0, originalReceipts.length)).toEqual(
			originalReceipts,
		);
		expect(
			restored.history.filter((receipt) => receipt.step === "each/done/route"),
		).toHaveLength(1);
		expect(restored.outputs.each).toMatchObject({
			results: {
				done: { route: { inherited: outerApproval } },
				unfinished: { route: { inherited: outerApproval } },
			},
			summary: { completed: 2 },
		});
		const output = restored.outputs.each as { results: Record<string, object> };
		for (const item of Object.values(output.results))
			expect(item).not.toHaveProperty("skipped");
	});

	it("joins a durably completed child after restart without publishing skipped inherited output", async () => {
		const directory = home();
		const first = vi.fn(async (context: ExecutionContext) =>
			context.stepKey === "skipped"
				? outerApproval
				: { inherited: stepBindings(context).inherited },
		);
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			agent("skipped"),
			each([
				agent("route", { reads: { inherited: "skipped" }, next: "end" }),
				agent("skipped"),
			]),
		]);
		let held = false;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = instance.save.bind(instance);
		vi.spyOn(instance, "save").mockImplementation(async (value) => {
			const completedBeforeJoin =
				value.checkpoint?.active?.foreach?.states[0]?.status === "completed" &&
				!Object.hasOwn(value.outputs, "each");
			await save(value);
			if (completedBeforeJoin) {
				held = true;
				await barrier;
			}
		});
		void instance.launch(run);
		try {
			await waitFor(() => expect(held).toBe(true));
			expect(run.outputs.each).toBeUndefined();
		} finally {
			const shutdown = instance.shutdown();
			release();
			await shutdown;
		}
		await instance.flush();
		const resumed = vi.fn(async () => {
			throw new Error("Completed child must not replay");
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(resumed).not.toHaveBeenCalled();
		expect(restarted.get(run.id).outputs.each).toEqual({
			results: { a: { route: { inherited: outerApproval } } },
			summary: {
				total: 1,
				completed: 1,
				failed: 0,
				cancelled: 0,
				failures: [],
				limitations: [],
			},
		});
	});

	it("retains mapped Call ownership through ordinary disk reload and native continuation", async () => {
		const directory = home();
		const instance = runtime(directory, {
			agent: async (context) => {
				if (context.stepKey === "skipped") return outerApproval;
				await context.checkpointAgent?.({
					runner: "codex",
					sessionId: "mapped-owned-native",
				});
				return untilAborted(context);
			},
		});
		const fixture = container("mapped call", [
			agent("route", {
				runner: "codex",
				reads: { inherited: "skipped", topic: "@callInputs/topic" },
				next: "end",
			}),
			agent("skipped"),
		]);
		const run = create(
			instance,
			directory,
			[agent("skipped"), fixture.step],
			fixture.dependencies,
		);
		void instance.launch(run);
		await waitFor(() =>
			expect(
				run.checkpoint?.active?.children?.[0]?.active?.agent?.sessionId,
			).toBe("mapped-owned-native"),
		);
		await instance.shutdown();
		await instance.flush();
		const resumed = vi.fn(async (context: ExecutionContext) => {
			expect(context.resumeAgent).toEqual({
				runner: "codex",
				sessionId: "mapped-owned-native",
			});
			expect(stepBindings(context)).toEqual({
				inherited: outerApproval,
				topic: "ancestor only",
			});
			return { inherited: stepBindings(context).inherited };
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(resumed).toHaveBeenCalledOnce();
		expect(restarted.get(run.id).outputs.call).toEqual({
			workflow: "child",
			completed: true,
			outputs: { route: { inherited: outerApproval } },
		});
	});

	it("restores an older unfinished ownership frame from current executed receipts without adopting a prior invocation's skipped approval", async () => {
		const directory = home();
		let pass = 0;
		const first = vi.fn(async (context: ExecutionContext) => {
			if (context.stepKey === "skipped") return outerApproval;
			if (context.step.id === "source")
				return { pass: ++pass, items: [{ id: "a", pass }] };
			if (context.step.id === "skipped")
				return { approved: true, authority: "first invocation only" };
			return {
				pass: (context.iteration!.value as { pass: number }).pass,
				inherited: stepBindings(context).inherited,
			};
		});
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			agent("skipped"),
			agent("source", { maxVisits: 2 }),
			each(
				[
					agent("route", {
						reads: { inherited: "skipped" },
						branches: [{ when: { path: "pass", equals: 1 }, next: "skipped" }],
						next: "end",
					}),
					agent("skipped"),
				],
				[],
				{ items: { from: "/source/items" }, maxVisits: 2 },
			),
			{
				id: "repeat",
				name: "Repeat once",
				type: "check",
				reads: { source: "source" },
				check: {
					results: { again: { path: "/inputs/source/pass", equals: 1 } },
				},
				branches: [{ when: { path: "again", equals: true }, next: "source" }],
				next: "end",
			},
		]);
		let held = false;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = instance.save.bind(instance);
		vi.spyOn(instance, "save").mockImplementation(async (value) => {
			const current = value.checkpoint?.active?.children?.[0];
			const secondResult =
				value.checkpoint?.visits.each === 2 &&
				current?.current === "route" &&
				current.active?.phase === "result";
			await save(value);
			if (secondResult) {
				held = true;
				await barrier;
			}
		});
		void instance.launch(run);
		try {
			await waitFor(() => expect(held).toBe(true));
			expect(
				run.history
					.filter((receipt) => receipt.step === "each/a/skipped")
					.map((receipt) => receipt.output),
			).toEqual([{ approved: true, authority: "first invocation only" }]);
		} finally {
			const shutdown = instance.shutdown();
			release();
			await shutdown;
		}
		await instance.flush();
		const originalReceipts = structuredClone(run.history);
		// Model the older on-disk checkpoint shape by omitting only the new
		// operational ownership index. Original accepted history, outputs, visits
		// and item authority remain unchanged and go through the ordinary writer.
		delete run.checkpoint!.active!.children![0]!.resultReceipts;
		await instance.save(run);
		await instance.flush();
		const resumed = vi.fn(async () => {
			throw new Error("An accepted completed role must not replay");
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		const restored = restarted.get(run.id);
		expect(resumed).not.toHaveBeenCalled();
		expect(first.mock.calls.map(([context]) => context.stepKey)).toEqual([
			"skipped",
			"source",
			"each/a/route",
			"each/a/skipped",
			"source",
			"each/a/route",
		]);
		expect(restored.history.slice(0, originalReceipts.length)).toEqual(
			originalReceipts,
		);
		expect(
			restored.history.filter((receipt) => receipt.step === "each/a/route"),
		).toHaveLength(2);
		expect(restored.outputs.each).toEqual({
			results: { a: { route: { pass: 2, inherited: outerApproval } } },
			summary: {
				total: 1,
				completed: 1,
				failed: 0,
				cancelled: 0,
				failures: [],
				limitations: [],
			},
		});
	});

	it("prepares an agent source collection loaded from its completed checkpoint before the first item dispatch", async () => {
		const directory = home();
		const source = { items: [{ id: "a", brief: "accepted source" }] };
		const first = vi.fn(async () => source);
		const instance = runtime(directory, { agent: first });
		const run = create(instance, directory, [
			agent("source"),
			each([agent("work", { reads: { current: "@item" } })], [], {
				items: { from: "/source/items" },
			}),
		]);
		let held = false;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = instance.save.bind(instance);
		vi.spyOn(instance, "save").mockImplementation(async (value) => {
			const sourceCompleted =
				value.checkpoint?.current === "source" &&
				value.checkpoint.active?.phase === "result";
			await save(value);
			if (sourceCompleted) {
				held = true;
				await barrier;
			}
		});
		void instance.launch(run);
		try {
			await waitFor(() => expect(held).toBe(true));
			expect(first).toHaveBeenCalledOnce();
			expect(run.foreach).toBeUndefined();
			expect(run.history.map((receipt) => receipt.step)).toEqual(["source"]);
		} finally {
			const shutdown = instance.shutdown();
			release();
			await shutdown;
		}
		await instance.flush();
		const resumed = vi.fn(async (context: ExecutionContext) => {
			expect(context.stepKey).toBe("each/a/work");
			expect(context.resumeAgent).toBeUndefined();
			expect(stepBindings(context)).toEqual({ current: source.items[0] });
			return {
				brief: (stepBindings(context).current as { brief: string }).brief,
			};
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("completed"));
		expect(resumed).toHaveBeenCalledOnce();
		expect(
			restarted
				.get(run.id)
				.history.filter((receipt) => receipt.step === "source"),
		).toHaveLength(1);
		expect(restarted.get(run.id).outputs.each).toMatchObject({
			results: { a: { work: { brief: "accepted source" } } },
			summary: { total: 1, completed: 1, failed: 0 },
		});
	});

	it("fails closed before approval when an older completed wrapper lacks provable descendant ownership", async () => {
		const directory = home();
		const native = {
			runner: "codex" as const,
			sessionId: "completed-wrapper-native",
		};
		const nativeEvent = JSON.stringify({
			type: "assistant",
			session_id: native.sessionId,
		});
		const first = vi.fn(async (context: ExecutionContext) => {
			await context.checkpointAgent?.(native);
			context.log(nativeEvent, "agent");
			return { approved: true, authority: context.stepKey };
		});
		const instance = runtime(directory, { agent: first });
		const run = create(
			instance,
			directory,
			[
				each([
					{
						id: "call",
						name: "Call",
						type: "workflow",
						workflow: "child",
						inputMapping: {},
					},
				]),
				{
					id: "verify",
					name: "Verify child approval",
					type: "check",
					reads: { batch: "each" },
					check: {
						results: {
							childApproved: {
								path: "/inputs/batch/results/a/call/outputs/approve/approved",
								equals: true,
							},
						},
					},
				},
			],
			[child([agent("approve", { runner: "codex" })])],
		);
		let held = false;
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		const save = instance.save.bind(instance);
		vi.spyOn(instance, "save").mockImplementation(async (value) => {
			const completedBeforeJoin =
				value.checkpoint?.active?.foreach?.states[0]?.status === "completed" &&
				!Object.hasOwn(value.outputs, "each");
			await save(value);
			if (completedBeforeJoin) {
				held = true;
				await barrier;
			}
		});
		void instance.launch(run);
		try {
			await waitFor(() => expect(held).toBe(true));
			expect(run.outputs.each).toBeUndefined();
			expect(first).toHaveBeenCalledOnce();
		} finally {
			const shutdown = instance.shutdown();
			release();
			await shutdown;
		}
		await instance.flush();
		const originalHistory = structuredClone(run.history);
		const originalResult = structuredClone(
			run.checkpoint!.active!.foreach!.states[0]!.result,
		);
		const originalNativeEvents = structuredClone(
			run.events.filter((event) => event.message === nativeEvent),
		);
		expect(originalNativeEvents).toHaveLength(1);
		// Only the new operational index is omitted to represent the older shape.
		// Accepted wrapper/agent receipts, item result and native evidence remain intact.
		delete run.checkpoint!.active!.children![0]!.resultReceipts;
		await instance.save(run);
		await instance.flush();
		const resumed = vi.fn(async () => {
			throw new Error("An ownership error must not replay native work");
		});
		const restarted = runtime(directory, { agent: resumed });
		restarted.resumeAll();
		await waitFor(() => expect(restarted.get(run.id).status).toBe("failed"));
		const restored = restarted.get(run.id);
		expect(restored.error).toMatch(
			/Child result ownership is missing at each\/a\/call/,
		);
		expect(resumed).not.toHaveBeenCalled();
		expect(restored.outputs.each).toBeUndefined();
		expect(restored.outputs.verify).toBeUndefined();
		expect(restored.history).toEqual(originalHistory);
		expect(restored.checkpoint!.active!.foreach!.states[0]!.result).toEqual(
			originalResult,
		);
		expect(restored.outputs["each/a/call/approve"]).toEqual({
			approved: true,
			authority: "each/a/call/approve",
		});
		expect(
			restored.events.filter((event) => event.message === nativeEvent),
		).toEqual(originalNativeEvents);
	});
});
