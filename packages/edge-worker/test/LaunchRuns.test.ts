import { describe, expect, it, vi } from "vitest";
import { LaunchRunsConfigurationSchema } from "../src/factory/ActionSteps.js";
import { repositoryCompletionProven } from "../src/factory/Delivery.js";
import {
	assertLaunchTarget,
	type LaunchRunBatch,
	type LaunchRunsHost,
	launchBatchProjection,
	launchBatchSettled,
	launchOutput,
	launchRepositoryCompletionProven,
	prepareLaunchRuns,
	stopLaunchRuns,
	tickLaunchRuns,
} from "../src/factory/LaunchRuns.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import type {
	FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const workflow = (
	id: string,
	steps: unknown[] = [
		{ id: "work", name: "Work", type: "agent", prompt: "Work" },
	],
) =>
	WorkflowSchema.parse({
		id,
		name: id,
		allowedTriggers: ["workflow", "manual"],
		steps,
	});
function makeRun(id = "parent"): FactoryRun {
	return {
		id,
		title: id,
		repositoryId: "repo",
		repositories: [
			{
				id: "repo",
				name: "Project",
				repositoryPath: "/fixture/source",
				workspace: "/fixture/parent",
				baseBranch: "main",
			},
			{
				id: "other",
				name: "Other",
				repositoryPath: "/fixture/other",
				workspace: "/fixture/parent-other",
				baseBranch: "develop",
			},
		],
		workflow: workflow("parent"),
		workflowDefinitions: [
			workflow("parent"),
			workflow("factory", [
				{ id: "publish", name: "Publish", type: "tool", tool: "draft-pr" },
				{ id: "finish", name: "Finish", type: "tool", tool: "merge" },
			]),
		],
		status: "running",
		createdAt: "2026-10-22T00:00:00.000Z",
		updatedAt: "2026-10-22T00:00:00.000Z",
		workspace: "/fixture/parent",
		input: "Parent work",
		runner: "codex",
		model: "retained-model",
		executionSnapshot: {
			schemaVersion: 1,
			sources: { identity: "legacy", tools: "legacy" },
		},
		outputs: {},
		history: [],
		answers: [],
		questions: [],
		events: [],
	};
}
const item = (id: string, dependencies: string[] = []) => ({
	id,
	prompt: `Build ${id}`,
	dependencies,
});
function prepare(
	run: FactoryRun,
	items: unknown[] = [item("first")],
	extra: Record<string, unknown> = {},
) {
	return prepareLaunchRuns(
		run,
		LaunchRunsConfigurationSchema.parse({
			items: { values: items },
			inputMapping: { prompt: "/prompt" },
			dependencies: "/dependencies",
			...extra,
		}),
		{ outputs: {} },
		{ key: "loop/one/dispatch", actionId: "accepted-visit" },
	);
}
function fixture(run = makeRun(), batch = prepare(run)) {
	const runs = new Map<string, FactoryRun>();
	const durable = new Map<string, FactoryRun>();
	const executing = new Set<string>();
	let parentReceipt: LaunchRunBatch | undefined;
	const saves: string[] = [];
	const runtime: LaunchRunsHost["runtime"] = {
		runs,
		create: vi.fn((options: Parameters<WorkflowRuntime["create"]>[0]) => {
			expect(
				parentReceipt?.progress[options.recipeParent!.itemId]?.creation,
			).toBe("creating");
			if (runs.has(options.id!)) throw new Error("Identity already exists");
			const child = {
				...makeRun(options.id),
				...structuredClone(options),
				id: options.id!,
				title: options.id!,
				history: [],
				outputs: {},
			};
			runs.set(child.id, child);
			return child;
		}),
		save: vi.fn(async (child) => {
			durable.set(child.id, structuredClone(child));
			saves.push(`child:${child.id}`);
		}),
		flush: vi.fn(async () => {}),
		launch: vi.fn(async (child) => {
			expect(durable.has(child.id)).toBe(true);
			expect(
				parentReceipt?.progress[child.recipeParent!.itemId]?.launchCommitted,
			).toBe(true);
			executing.add(child.id);
			saves.push(`launch:${child.id}`);
		}),
		stop: vi.fn((id) => {
			expect(parentReceipt?.cancelled).toBe(true);
			executing.delete(id);
			runs.get(id)!.status = "stopped";
		}),
		isExecuting: (id) => executing.has(id),
	};
	const host: LaunchRunsHost = {
		runtime,
		save: vi.fn(async () => {
			parentReceipt = structuredClone(batch);
			saves.push("parent");
		}),
	};
	return {
		run,
		batch,
		runs,
		durable,
		executing,
		runtime,
		host,
		saves,
		receipt: () => parentReceipt,
	};
}
function merged(child: FactoryRun, grouped = false) {
	child.status = "completed";
	const revisions = [
		{
			repositoryId: "repo",
			name: "Project",
			url: "https://forge.test/project/pull/1",
			headSha: "head-a",
		},
		{
			repositoryId: "other",
			name: "Other",
			url: "https://forge.test/other/pull/2",
			headSha: "head-b",
		},
	];
	const published = grouped
		? {
				scopeVersion: 1,
				deliveries: revisions.map(({ repositoryId, name, ...output }) => ({
					repositoryId,
					name,
					output,
				})),
			}
		: { url: revisions[0]!.url, headSha: revisions[0]!.headSha };
	child.outputs = {
		publish: published,
		finish: { ...published, merged: true },
	};
	child.history = [
		{ step: "publish", output: published, at: child.createdAt },
		{
			step: "finish",
			output: { ...published, merged: true },
			at: child.createdAt,
		},
	];
	child.humanDecisions = [
		{
			reviewId: "human-exact",
			decision: "approve",
			headSha: "head-a",
			at: child.createdAt,
			...(grouped ? { repositories: revisions } : {}),
		},
	];
}

describe("generic Launch runs", () => {
	it("persists intent before create and child before launch, and serializes concurrent dispatch", async () => {
		const f = fixture();
		await Promise.all([
			tickLaunchRuns(f.run, f.batch, f.host),
			tickLaunchRuns(f.run, f.batch, f.host),
		]);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		expect(f.runtime.launch).toHaveBeenCalledTimes(1);
		const id = f.batch.accepted.items[0]!.runId;
		expect(f.saves.indexOf(`child:${id}`)).toBeLessThan(
			f.saves.indexOf(`launch:${id}`),
		);
		expect(f.runs.get(id)?.recipeParent).toEqual({
			runId: "parent",
			actionId: "accepted-visit",
			itemId: "first",
			workflowId: "parent",
			ancestors: ["parent"],
		});
	});

	it("retains accepted definitions, model, execution profile, prompt and selected scope after catalogue/input changes", async () => {
		const run = makeRun();
		const values = [
			{
				...item("one"),
				plan: { steps: ["Preserve receipt"] },
				repos: ["other"],
			},
		];
		const batch = prepare(run, values, {
			inputMapping: {
				prompt: "/prompt",
				plan: "/plan",
				repositoryIds: "/repos",
			},
		});
		const frozen = structuredClone(batch.accepted);
		values[0]!.prompt = "Mutated source";
		run.model = "new-default";
		run.executionSnapshot!.sources.identity = "factory";
		run.workflowDefinitions![1]!.allowedTriggers = [];
		run.repositories![1]!.repositoryPath = "/reconfigured";
		const f = fixture(run, batch);
		await tickLaunchRuns(run, batch, f.host);
		const child = f.runs.get(batch.accepted.items[0]!.runId)!;
		expect(child.model).toBe("retained-model");
		expect(child.executionSnapshot).toEqual(frozen.execution.executionSnapshot);
		expect(child.workflow).toEqual(frozen.workflow);
		expect(child.repositoryId).toBe("other");
		expect(child.repositories).toEqual([
			{ ...makeRun().repositories![1], workspace: "" },
		]);
		expect(child.launchInputs).toEqual({
			prompt: "Build one",
			plan: '{"steps":["Preserve receipt"]}',
		});
		expect(child.input).toBe(
			'Build one\n\n## Plan\n{"steps":["Preserve receipt"]}',
		);
		expect(batch.accepted).toEqual(frozen);
		expect(f.runtime.create).toHaveBeenLastCalledWith(expect.anything(), {
			workflow: frozen.workflow,
			workflowDefinitions: frozen.definitions,
			trigger: "workflow",
		});
	});

	it("binds repeated visits to separate identities while restart keeps the original identity", () => {
		const run = makeRun();
		const config = LaunchRunsConfigurationSchema.parse({
			items: { values: [item("one")] },
			inputMapping: { prompt: "/prompt" },
		});
		const first = prepareLaunchRuns(
			run,
			config,
			{ outputs: {} },
			{ key: "dispatch", actionId: "visit-one" },
		);
		const again = prepareLaunchRuns(
			run,
			config,
			{ outputs: {} },
			{ key: "dispatch", actionId: "visit-one" },
		);
		const second = prepareLaunchRuns(
			run,
			config,
			{ outputs: {} },
			{ key: "dispatch", actionId: "visit-two" },
		);
		expect(first.accepted.items[0]!.runId).toBe(again.accepted.items[0]!.runId);
		expect(first.accepted.items[0]!.runId).not.toBe(
			second.accepted.items[0]!.runId,
		);
	});

	it("reconciles a child persisted before parent confirmation without duplicate creation", async () => {
		const f = fixture();
		vi.mocked(f.host.save)
			.mockImplementationOnce(async () => {})
			.mockImplementationOnce(async () => {
				throw new Error("crash before create");
			});
		await expect(tickLaunchRuns(f.run, f.batch, f.host)).rejects.toThrow(
			"crash before create",
		);
		expect(f.runtime.create).not.toHaveBeenCalled();
		const recovered = fixture(f.run, JSON.parse(JSON.stringify(f.batch)));
		await tickLaunchRuns(recovered.run, recovered.batch, recovered.host);
		expect(recovered.runtime.create).toHaveBeenCalledTimes(1);
		const original = recovered.runs.get(
			recovered.batch.accepted.items[0]!.runId,
		)!;
		recovered.batch.progress.first!.creation = "uncertain";
		recovered.batch.progress.first!.status = "uncertain";
		const restart = fixture(f.run, JSON.parse(JSON.stringify(recovered.batch)));
		restart.runs.set(original.id, structuredClone(original));
		await tickLaunchRuns(restart.run, restart.batch, restart.host);
		expect(restart.runtime.create).not.toHaveBeenCalled();
		expect(restart.runtime.launch).toHaveBeenCalledTimes(1);
		expect(restart.batch.progress.first!.creation).toBe("confirmed");
	});

	it("does not launch a child whose persistence is uncertain until the original child is durably saved", async () => {
		const f = fixture();
		vi.mocked(f.runtime.flush).mockRejectedValueOnce(
			new Error("storage unavailable"),
		);
		await tickLaunchRuns(f.run, f.batch, f.host);
		expect(f.runtime.launch).not.toHaveBeenCalled();
		expect(f.batch.progress.first).toMatchObject({
			creation: "uncertain",
			status: "uncertain",
		});
		await tickLaunchRuns(f.run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		expect(f.runtime.launch).toHaveBeenCalledTimes(1);
	});

	it("does not launch when the durable admission commit fails, then retries the same child identity", async () => {
		const f = fixture();
		const save = f.host.save;
		let fail = true;
		f.host.save = vi.fn(async () => {
			if (fail && f.batch.progress.first!.launchCommitted) {
				fail = false;
				throw new Error("Commit unavailable");
			}
			await save();
		});
		await tickLaunchRuns(f.run, f.batch, f.host);
		expect(f.runtime.launch).not.toHaveBeenCalled();
		expect(f.batch.progress.first!.launchCommitted).toBeUndefined();
		expect(f.batch.progress.first!.status).toBe("uncertain");
		await tickLaunchRuns(f.run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		expect(f.runtime.launch).toHaveBeenCalledTimes(1);
		expect(f.batch.progress.first!.launchCommitted).toBe(true);
	});

	it("does not inherit new default profiles when the accepted parent used Legacy", async () => {
		const run = makeRun();
		delete run.executionSnapshot;
		const batch = JSON.parse(JSON.stringify(prepare(run)));
		const f = fixture(run, batch);
		await tickLaunchRuns(run, batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledWith(
			expect.objectContaining({ executionSnapshot: undefined }),
			expect.anything(),
		);
	});

	it("dispatches unversioned arbitrary-named tool dependency waves only for exact approved provider merge receipts", async () => {
		const run = makeRun();
		const f = fixture(
			run,
			prepare(run, [
				item("second", ["first"]),
				item("first"),
				item("parallel"),
			]),
		);
		expect(f.batch.accepted.items.map((i) => [i.id, i.wave])).toEqual([
			["second", 1],
			["first", 0],
			["parallel", 0],
		]);
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(2);
		const first = f.runs.get(
			f.batch.accepted.items.find((i) => i.id === "first")!.runId,
		)!;
		merged(first, true);
		first.humanDecisions![0]!.repositories![1]!.headSha = "stale-head";
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(2);
		expect(f.batch.progress.second).toMatchObject({ status: "blocked" });
		merged(first, true);
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(3);
		expect(f.batch.progress.first!.status).toBe("merged");
	});

	it("rejects agent-authored merged flags and mismatched grouped provider receipts", async () => {
		const run = makeRun();
		const f = fixture(run, prepare(run, [item("one"), item("two", ["one"])]));
		await tickLaunchRuns(run, f.batch, f.host);
		const child = f.runs.get(f.batch.accepted.items[0]!.runId)!;
		merged(child, true);
		child.workflow = workflow("factory");
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		child.workflow = f.batch.accepted.workflow;
		const wrong = {
			scopeVersion: 1,
			merged: true,
			deliveries: [
				{
					repositoryId: "repo",
					name: "Project",
					output: {
						url: "https://forge.test/project/pull/1",
						headSha: "head-a",
					},
				},
			],
		};
		child.history[1]!.output = wrong;
		child.outputs.finish = wrong;
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
	});

	it("refuses unversioned agent semantic aliases even with an exact human approval", async () => {
		const run = makeRun();
		run.workflowDefinitions![1] = workflow("factory", [
			{
				id: "draft-pr",
				name: "Ordinary author output",
				type: "agent",
				prompt: "Describe a PR",
			},
			{
				id: "merge",
				name: "Ordinary author output",
				type: "agent",
				prompt: "Describe a merge",
			},
		]);
		const f = fixture(run, prepare(run, [item("one"), item("two", ["one"])]));
		await tickLaunchRuns(run, f.batch, f.host);
		const child = f.runs.get(f.batch.accepted.items[0]!.runId)!;
		const publication = {
			url: "https://forge.test/project/pull/1",
			headSha: "head-a",
		};
		const merge = { ...publication, merged: true };
		child.status = "completed";
		child.outputs = { "draft-pr": publication, merge };
		child.history = [
			{ step: "draft-pr", output: publication, at: child.createdAt },
			{ step: "merge", output: merge, at: child.createdAt },
		];
		child.humanDecisions = [
			{
				reviewId: "exact-human",
				decision: "approve",
				headSha: "head-a",
				at: child.createdAt,
			},
		];
		// Characterize the retained legacy adapter; the generic effect must never
		// grant its compatibility alias authority to an ordinary agent output.
		expect(repositoryCompletionProven(child)).toBe(true);
		expect(launchRepositoryCompletionProven(child)).toBe(false);
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		expect(f.batch.progress.one!.status).toBe("completed");
		expect(f.batch.progress.two!.status).toBe("blocked");
	});

	it("requires original executed tool receipts instead of current output aliases or empty historical tool results", () => {
		const child = makeRun("child");
		child.workflow = workflow("factory", [
			{ id: "draft-pr", name: "Publish", type: "tool", tool: "draft-pr" },
			{ id: "merge", name: "Merge", type: "tool", tool: "merge" },
		]);
		const publication = {
			url: "https://forge.test/project/pull/1",
			headSha: "head-a",
		};
		const merge = { ...publication, merged: true };
		child.outputs = { "draft-pr": publication, merge };
		child.humanDecisions = [
			{
				reviewId: "exact-human",
				decision: "approve",
				headSha: "head-a",
				at: child.createdAt,
			},
		];
		child.status = "completed";
		expect(launchRepositoryCompletionProven(child)).toBe(false);
		child.history = [
			{ step: "draft-pr", output: undefined, at: child.createdAt },
			{ step: "merge", output: undefined, at: child.createdAt },
		];
		expect(repositoryCompletionProven(child)).toBe(true);
		expect(launchRepositoryCompletionProven(child)).toBe(false);
		child.history = [
			{ step: "draft-pr", output: publication, at: child.createdAt },
			{ step: "merge", output: merge, at: child.createdAt },
		];
		expect(launchRepositoryCompletionProven(child)).toBe(true);
		child.history[1]!.output = { ...publication, merged: false };
		expect(launchRepositoryCompletionProven(child)).toBe(false);
	});

	it.each([
		"failed",
		"stopped",
		"blocked",
	] as const)("blocks dependants when the original prerequisite is %s", async (status) => {
		const run = makeRun();
		const f = fixture(run, prepare(run, [item("one"), item("two", ["one"])]));
		await tickLaunchRuns(run, f.batch, f.host);
		f.runs.get(f.batch.accepted.items[0]!.runId)!.status = status;
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.batch.progress.two).toEqual({
			status: "blocked",
			creation: "pending",
			error:
				"Prerequisite one did not deliver; retry or resume that original child before dispatching this item",
		});
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
	});

	it("parent pause preserves ordinary children and stops the next wave; resume retains completed children", async () => {
		const run = makeRun();
		const f = fixture(run, prepare(run, [item("one"), item("two", ["one"])]));
		await tickLaunchRuns(run, f.batch, f.host);
		merged(f.runs.get(f.batch.accepted.items[0]!.runId)!);
		f.batch.paused = true;
		run.status = "stopped";
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.stop).not.toHaveBeenCalled();
		expect(f.runtime.create).toHaveBeenCalledTimes(1);
		f.batch.paused = false;
		run.status = "running";
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(2);
		expect(f.batch.progress.one!.status).toBe("merged");
	});

	it("stop during child persistence cancels the original child after persisting batch intent and never launches it", async () => {
		const f = fixture();
		let entered!: () => void;
		let release!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(f.runtime.flush).mockImplementationOnce(async () => {
			entered();
			await barrier;
		});
		const dispatch = tickLaunchRuns(f.run, f.batch, f.host);
		await reached;
		const stop = stopLaunchRuns(f.run, f.batch, f.host);
		expect(f.batch.cancelled).toBe(true);
		release();
		await Promise.all([dispatch, stop]);
		expect(f.runtime.launch).not.toHaveBeenCalled();
		expect(f.runtime.stop).toHaveBeenCalledExactlyOnceWith(
			f.batch.accepted.items[0]!.runId,
		);
		expect(f.batch.progress.first!.status).toBe("cancelled");
		expect(launchBatchSettled(f.batch)).toBe(true);
	});

	it("wait=false returns immutable links immediately while later ticks continue original dependency waves", async () => {
		const run = makeRun();
		const f = fixture(
			run,
			prepare(run, [item("one"), item("two", ["one"])], { wait: false }),
		);
		await tickLaunchRuns(run, f.batch, f.host);
		const receipt = launchOutput(f.batch);
		const original = structuredClone(receipt);
		expect(receipt.children.two?.runId).toBe(f.batch.accepted.items[1]!.runId);
		expect(launchBatchSettled(f.batch)).toBe(false);
		run.status = "completed";
		merged(f.runs.get(f.batch.accepted.items[0]!.runId)!);
		await tickLaunchRuns(run, f.batch, f.host);
		expect(f.runtime.create).toHaveBeenCalledTimes(2);
		expect(receipt).toEqual(original);
		expect(launchOutput(f.batch)).toEqual(original);
	});

	it("never sends after a parent pause at the intent barrier", async () => {
		const f = fixture();
		vi.mocked(f.host.save).mockImplementation(async () => {
			if (f.batch.progress.first!.creation === "creating")
				f.batch.paused = true;
		});
		await tickLaunchRuns(f.run, f.batch, f.host);
		expect(f.runtime.create).not.toHaveBeenCalled();
	});

	it("refuses colliding existing children and modified accepted batches", async () => {
		const f = fixture();
		f.runs.set(
			f.batch.accepted.items[0]!.runId,
			makeRun(f.batch.accepted.items[0]!.runId),
		);
		await expect(tickLaunchRuns(f.run, f.batch, f.host)).rejects.toThrow(
			"identity collision",
		);
		f.batch.accepted.items[0]!.prompt = "Altered accepted input";
		await expect(tickLaunchRuns(f.run, f.batch, f.host)).rejects.toThrow(
			"integrity check failed",
		);
		expect(f.runtime.launch).not.toHaveBeenCalled();
	});

	it.each(
		[
			[item("one", ["missing"])],
			[item("one", ["one"])],
			[item("one", ["two"]), item("two", ["one"])],
			[item("one"), item("two", ["one", "one"])],
			[item("same"), item("same")],
		].map((items) => ({ items })),
	)("rejects invalid dependencies before any effects: $items", ({ items }) => {
		expect(() => prepare(makeRun(), items)).toThrow();
	});

	it("rejects repository escalation and duplicates before effects", () => {
		const run = makeRun();
		for (const repos of [["outside"], ["repo", "repo"], []])
			expect(() =>
				prepare(run, [{ ...item("one"), repos }], {
					inputMapping: { prompt: "/prompt", repositoryIds: "/repos" },
				}),
			).toThrow("parent's accepted scope");
	});

	it("requires workflow permission at the default, selected and transitively called targets", () => {
		const run = makeRun();
		run.workflowDefinitions![1]!.allowedTriggers = ["manual"];
		expect(() => prepare(run)).toThrow("does not allow workflow");
		run.workflowDefinitions!.push(
			workflow("wrapper", [
				{ id: "call", name: "Call", type: "workflow", workflow: "factory" },
			]),
		);
		expect(() => prepare(run, [item("one")], { workflow: "wrapper" })).toThrow(
			"does not allow workflow",
		);
	});

	it("rejects direct, Call recipe and nested launch recursion by resolved IDs and active call lineage", () => {
		const parent = workflow("parent");
		expect(() => assertLaunchTarget("parent", [parent], ["parent"])).toThrow(
			"Recursive workflow launch",
		);
		const called = workflow("called", [
			{ id: "return", name: "Return", type: "workflow", workflow: "parent" },
		]);
		expect(() =>
			assertLaunchTarget("called", [parent, called], ["parent"]),
		).toThrow("Recursive workflow launch");
		const a = workflow("a", [
			{
				id: "launch",
				name: "Launch",
				type: "launch-runs",
				launchRuns: {
					items: { values: [] },
					workflow: "b",
					inputMapping: { prompt: "/prompt" },
				},
			},
		]);
		const b = workflow("b", [
			{ id: "call", name: "Call", type: "workflow", workflow: "a" },
		]);
		expect(() => assertLaunchTarget("a", [parent, a, b], ["parent"])).toThrow(
			"Recursive workflow launch",
		);
		expect(() =>
			assertLaunchTarget("called", [called], ["parent", "called"]),
		).toThrow("Recursive workflow launch");
	});

	it("projects only safe child-list data", () => {
		const f = fixture();
		const projected = launchBatchProjection(f.batch);
		expect(Object.keys(projected)).toEqual([
			"key",
			"actionId",
			"workflowId",
			"targetWorkflowId",
			"wait",
			"paused",
			"cancelled",
			"items",
		]);
		expect(Object.keys(projected.items[0]!)).toEqual([
			"id",
			"index",
			"title",
			"runId",
			"url",
			"wave",
			"dependencies",
			"status",
			"creation",
		]);
	});
});
