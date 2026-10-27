import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Workflow, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const directories: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of directories.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const assignment = (id: string, dependencies: string[] = []) => ({
	id,
	prompt: `Implement ${id}`,
	dependencies,
});
const dispatch = (
	wait: boolean,
	values = [assignment("one"), assignment("two", ["one"])],
) => ({
	id: "dispatch",
	name: "Launch selected work",
	type: "launch-runs",
	launchRuns: {
		items: { values },
		workflow: "delivery-child",
		inputMapping: { prompt: "/prompt" },
		dependencies: "/dependencies",
		wait,
	},
});
function recipe(
	id: string,
	steps: unknown[],
	allowedTriggers = ["manual", "workflow"],
) {
	return WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id,
		name: id,
		stepConfigVersion: "step-config-v1",
		allowedTriggers,
		steps,
	});
}
function fixture(
	steps: unknown[],
	extra: Partial<RuntimeHooks> = {},
	dependencies: Workflow[] = [],
) {
	const home = mkdtempSync(join(tmpdir(), "action-runtime-"));
	directories.push(home);
	const repository = join(home, "repository");
	mkdirSync(repository);
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(repository, "init", "-b", "main");
	writeFileSync(
		join(repository, "README.md"),
		"Disposable generic action runtime fixture\n",
	);
	git(repository, "add", "README.md");
	git(
		repository,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-m",
		"Fixture",
	);
	const holds = new Map<string, () => void>();
	const released = new Set<string>();
	const visits: string[] = [];
	const hooks: RuntimeHooks = {
		prepare: async (run) => {
			if (!run.recipeParent || run.setupComplete) return;
			const workspace = join(home, run.id);
			git(repository, "worktree", "add", "--detach", workspace, "main");
			run.workspace = workspace;
			run.repositories = run.repositories?.map((repo) => ({
				...repo,
				workspace,
			}));
			run.setupComplete = true;
		},
		ioGitProvider: async (context) =>
			({
				view: async (url: string) => {
					const id = context.run.recipeParent?.itemId ?? "parent";
					if (!visits.includes(`${id}:merge`)) visits.push(`${id}:merge`);
					return {
						url,
						headRefOid: git(context.run.workspace, "rev-parse", "HEAD"),
						state: "MERGED",
						mergeCommitSha: git(context.run.workspace, "rev-parse", "HEAD"),
					};
				},
			}) as any,
		agent: async (context) => {
			if (context.step.prompt === "fixture-script")
				return (async () => ({}))(context);
			return (async (context) => {
				const id = context.run.recipeParent?.itemId ?? "parent";
				visits.push(`${id}:${context.step.prompt}`);
				if (context.step.prompt === "fixture-hold") {
					if (!released.has(id))
						await new Promise<void>((resolve, reject) => {
							const finish = () => {
								context.signal.removeEventListener("abort", abort);
								holds.delete(id);
								resolve();
							};
							const abort = () => {
								if (holds.get(id) === finish) holds.delete(id);
								reject(context.signal.reason);
							};
							holds.set(id, finish);
							context.signal.addEventListener("abort", abort, { once: true });
							if (context.signal.aborted) abort();
						});
					return { completed: true };
				}
				const headSha = git(context.run.workspace, "rev-parse", "HEAD");
				const url = `https://forge.fixture.test/project/pull/${id}`;
				if (context.step.prompt === "draft-pr")
					return { repositories: [{ repositoryId: "repo", url, headSha }] };
				return { completed: true };
			})(context);
		},
		...extra,
	};
	const parent = recipe("action-parent", steps);
	const child = recipe(
		"delivery-child",
		[
			{
				id: "hold",
				name: "Controlled implementation",
				type: "agent",
				prompt: "fixture-hold",
			},
			{
				id: "publish",
				name: "Controlled publication",
				type: "agent",
				prompt: "draft-pr",
			},
			{
				id: "finish",
				name: "Controlled provider merge",
				type: "merge",
				reads: { requests: "publish" },
			},
		],
		["workflow"],
	);
	const load = () => {
		const runtime = new WorkflowRuntime(home, hooks);
		runtimes.push(runtime);
		return runtime;
	};
	const runtime = load();
	// Accept the complete fixture graph, without copying unrelated bundled prompts
	// into every parent/child checkpoint. Keep the normal installed catalogue.
	const definitions = [parent, child, ...dependencies];
	runtime.updateWorkflows([...runtime.listWorkflows(), ...definitions]);
	const create = (definition: Workflow = parent, id?: string) =>
		runtime.create({
			id,
			repositoryId: "repo",
			repositories: [
				{
					id: "repo",
					name: "Fixture",
					repositoryPath: repository,
					workspace: repository,
					baseBranch: "main",
				},
			],
			workflow: definition,
			workflowDefinitions: definitions,
			workspace: repository,
			input: "Coordinate controlled child work",
			triggerOrigin: {
				type: "manual",
				workflowId: definition.id,
				at: new Date().toISOString(),
				manual: { method: "composer-api" },
			},
		});
	const release = (id: string) => {
		released.add(id);
		holds.get(id)?.();
	};
	return {
		home,
		repository,
		runtime,
		load,
		create,
		release,
		holds,
		visits,
		hooks,
	};
}
const children = (runtime: WorkflowRuntime, parent: FactoryRun) =>
	[...runtime.runs.values()].filter(
		(run) => run.recipeParent?.runId === parent.id,
	);

describe("generic side-effect runtime integration", () => {
	it("wait=true retains the action checkpoint and tracks ordinary isolated children through dependency delivery", async () => {
		const f = fixture([dispatch(true)]);
		const parent = f.create();
		const executing = f.runtime.launch(parent);
		await waitForRuntime(() => {
			expect(parent.status).toBe("waiting");
			expect(f.holds.has("one")).toBe(true);
		});
		expect(parent.outputs.dispatch).toBeUndefined();
		expect(Object.values(parent.capacityLeaves ?? {})).toEqual([]);
		expect(children(f.runtime, parent)).toHaveLength(1);
		expect(children(f.runtime, parent)[0]!.workspace).not.toBe(
			parent.workspace,
		);
		f.release("one");
		await waitForRuntime(() => expect(f.holds.has("two")).toBe(true));
		f.release("two");
		await executing;
		expect(parent.status).toBe("completed");
		expect(children(f.runtime, parent)).toHaveLength(2);
		expect(
			new Set(children(f.runtime, parent).map((run) => run.workspace)).size,
		).toBe(2);
		const output = parent.outputs.dispatch as {
			children: Record<string, { status: string }>;
		};
		expect(Object.values(output.children).map((child) => child.status)).toEqual(
			["merged", "merged"],
		);
		expect(f.visits.filter((visit) => visit.endsWith(":merge"))).toEqual([
			"one:merge",
			"two:merge",
		]);
	});

	it("wait=false returns links, runs later steps and resumes deferred waves after shutdown without changing original output", async () => {
		const finished = vi.fn(async (_run: FactoryRun) => {});
		const f = fixture(
			[
				dispatch(false),
				{
					id: "after",
					name: "After dispatch",
					type: "agent",
					prompt: "fixture-after",
				},
			],
			{ finished },
		);
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(parent.checkpoint?.current).toBe("end");
		expect(parent.status).toBe("waiting");
		expect(
			finished.mock.calls.filter(([run]) => run.id === parent.id),
		).toHaveLength(0);
		expect(f.visits).toContain("parent:fixture-after");
		const receipt = structuredClone(parent.outputs.dispatch);
		const history = structuredClone(
			parent.history.find((entry) => entry.step === "dispatch"),
		);
		const actionIds = Object.keys(parent.launchActions!);
		const originalChildId = children(f.runtime, parent)[0]!.id;
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		restored.resumeAll();
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChildId,
		]);
		expect(Object.keys(reloaded.launchActions!)).toEqual(actionIds);
		f.release("one");
		await waitForRuntime(() => expect(f.holds.has("two")).toBe(true));
		f.release("two");
		await waitForRuntime(() => {
			expect(reloaded.status).toBe("completed");
			expect(children(restored, reloaded)).toHaveLength(2);
			expect(
				finished.mock.calls.filter(([run]) => run.id === parent.id),
			).toHaveLength(1);
		});
		expect(reloaded.outputs.dispatch).toEqual(receipt);
		expect(reloaded.history.find((entry) => entry.step === "dispatch")).toEqual(
			history,
		);
		expect(
			f.visits.filter((visit) => visit === "parent:fixture-after"),
		).toHaveLength(1);
		expect(f.visits.filter((visit) => visit === "one:draft-pr")).toHaveLength(
			1,
		);
		await restored.shutdown();
		const finalRestart = f.load();
		finalRestart.resumeAll();
		await finalRestart.shutdown();
		expect(
			finished.mock.calls.filter(([run]) => run.id === parent.id),
		).toHaveLength(1);
	});

	it("parent Stop pauses later waves while the original child continues; explicit Resume retains completed receipts", async () => {
		const f = fixture([dispatch(false)]);
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const batch = Object.values(parent.launchActions!)[0]!;
		const accepted = structuredClone(batch.accepted);
		const originalOutput = structuredClone(parent.outputs.dispatch);
		const originalHistory = structuredClone(parent.history);
		const originalChild = children(f.runtime, parent)[0]!;
		const create = vi.spyOn(f.runtime, "create");
		const launch = vi.spyOn(f.runtime, "launch");
		f.runtime.stop(parent.id);
		f.release("one");
		await waitForRuntime(() =>
			expect(children(f.runtime, parent)[0]!.status).toBe("completed"),
		);
		await waitForRuntime(() =>
			expect(batch.progress.one).toMatchObject({
				status: "merged",
				creation: "confirmed",
			}),
		);
		expect(parent.status).toBe("stopped");
		expect(children(f.runtime, parent)).toHaveLength(1);
		expect(Object.values(parent.launchActions!)[0]!.paused).toBe(true);
		expect(batch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(create).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(batch.accepted).toEqual(accepted);
		expect(parent.outputs.dispatch).toEqual(originalOutput);
		expect(parent.history).toEqual(originalHistory);
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		const restoredCreate = vi.spyOn(restored, "create");
		const restoredLaunch = vi.spyOn(restored, "launch");
		restored.resumeAll();
		await restored.flush();
		const restoredBatch = Object.values(reloaded.launchActions!)[0]!;
		await waitForRuntime(() =>
			expect(restoredBatch.progress.one).toMatchObject({
				status: "merged",
				creation: "confirmed",
			}),
		);
		expect(reloaded.status).toBe("stopped");
		expect(restoredBatch.paused).toBe(true);
		expect(restoredBatch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(restoredCreate).not.toHaveBeenCalled();
		expect(restoredLaunch).not.toHaveBeenCalled();
		expect(restoredBatch.accepted).toEqual(accepted);
		expect(reloaded.outputs.dispatch).toEqual(originalOutput);
		expect(reloaded.history).toEqual(originalHistory);
		restored.resume(parent.id);
		await waitForRuntime(() => expect(f.holds.has("two")).toBe(true));
		f.release("two");
		await waitForRuntime(() => expect(reloaded.status).toBe("completed"));
		expect(f.visits.filter((visit) => visit === "one:merge")).toHaveLength(1);
	});

	it.each([
		"failed",
		"cancelled",
	] as const)("stopped parents observe original child %s outcomes without dispatching a dependent or changing accepted receipts", async (outcome) => {
		const finished = vi.fn(async (_run: FactoryRun) => {});
		const f = fixture([dispatch(false)], { finished });
		const tool = f.hooks.agent;
		f.hooks.agent = async (context) => {
			const result = await tool(context);
			if (
				outcome === "failed" &&
				context.run.recipeParent?.itemId === "one" &&
				context.step.prompt === "fixture-hold"
			)
				throw new Error("Controlled failure after parent Stop");
			return result;
		};
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const originalChild = children(f.runtime, parent)[0]!;
		const batch = Object.values(parent.launchActions!)[0]!;
		const accepted = structuredClone(batch.accepted);
		const originalOutput = structuredClone(parent.outputs.dispatch);
		const originalHistory = structuredClone(parent.history);
		const create = vi.spyOn(f.runtime, "create");
		const launch = vi.spyOn(f.runtime, "launch");
		f.runtime.stop(parent.id);
		if (outcome === "failed") f.release("one");
		else f.runtime.stop(originalChild.id);
		const expectedStatus = outcome === "failed" ? "blocked" : "cancelled";
		await waitForRuntime(() =>
			expect(batch.progress.one).toMatchObject({
				status: expectedStatus,
				creation: "confirmed",
			}),
		);
		expect(parent.status).toBe("stopped");
		expect(batch.paused).toBe(true);
		expect(batch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(f.runtime, parent).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(create).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(
			finished.mock.calls.filter(([run]) => run.id === parent.id),
		).toHaveLength(0);
		expect(batch.accepted).toEqual(accepted);
		expect(parent.outputs.dispatch).toEqual(originalOutput);
		expect(parent.history).toEqual(originalHistory);
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		const restoredCreate = vi.spyOn(restored, "create");
		const restoredLaunch = vi.spyOn(restored, "launch");
		restored.resumeAll();
		await restored.flush();
		const restoredBatch = Object.values(reloaded.launchActions!)[0]!;
		await waitForRuntime(() =>
			expect(restoredBatch.progress.one).toMatchObject({
				status: expectedStatus,
				creation: "confirmed",
			}),
		);
		expect(reloaded.status).toBe("stopped");
		expect(restoredBatch.paused).toBe(true);
		expect(restoredBatch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(restoredCreate).not.toHaveBeenCalled();
		expect(restoredLaunch).not.toHaveBeenCalled();
		expect(restoredBatch.accepted).toEqual(accepted);
		expect(reloaded.outputs.dispatch).toEqual(originalOutput);
		expect(reloaded.history).toEqual(originalHistory);
	});

	it("a stopped parent retains ordinary continuation of its already-admitted active child across restart while observing the queued next wave", async () => {
		const f = fixture([dispatch(false)]);
		// Load the parent manifest before child-* so its observation turn is pending
		// when resumeAll considers continuation of the already-admitted child.
		const parent = f.create(undefined, "a-paused-active-parent");
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const batch = Object.values(parent.launchActions!)[0]!;
		expect(batch.progress.one!.launchCommitted).toBe(true);
		const accepted = structuredClone(batch.accepted);
		const originalOutput = structuredClone(parent.outputs.dispatch);
		const originalHistory = structuredClone(parent.history);
		const originalChild = children(f.runtime, parent)[0]!;
		f.runtime.stop(parent.id);
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		const create = vi.spyOn(restored, "create");
		const launch = vi.spyOn(restored, "launch");
		restored.resumeAll();
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const restoredBatch = Object.values(reloaded.launchActions!)[0]!;
		expect(reloaded.status).toBe("stopped");
		expect(restoredBatch.paused).toBe(true);
		expect(restoredBatch.progress.one!.launchCommitted).toBe(true);
		expect(restoredBatch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(create).not.toHaveBeenCalled();
		expect(launch).toHaveBeenCalledExactlyOnceWith(
			restored.get(originalChild.id),
		);
		f.release("one");
		await waitForRuntime(() =>
			expect(restoredBatch.progress.one).toMatchObject({
				status: "merged",
				creation: "confirmed",
			}),
		);
		expect(reloaded.status).toBe("stopped");
		expect(restoredBatch.paused).toBe(true);
		expect(restoredBatch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(create).not.toHaveBeenCalled();
		expect(launch).toHaveBeenCalledTimes(1);
		expect(f.visits.filter((visit) => visit === "one:draft-pr")).toHaveLength(
			1,
		);
		expect(f.visits.filter((visit) => visit === "one:merge")).toHaveLength(1);
		expect(restoredBatch.accepted).toEqual(accepted);
		expect(reloaded.outputs.dispatch).toEqual(originalOutput);
		expect(reloaded.history).toEqual(originalHistory);
	});

	it("Stop batch persists cancellation, stops active children and survives restart without dispatching dependants", async () => {
		const f = fixture([dispatch(false)]);
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const [actionId] = Object.keys(parent.launchActions!);
		await f.runtime.stopBatch(parent.id, actionId);
		await waitForRuntime(() =>
			expect(children(f.runtime, parent)[0]!.status).toBe("stopped"),
		);
		expect(parent.status).toBe("stopped");
		expect(Object.values(parent.launchActions!)[0]).toMatchObject({
			paused: true,
			cancelled: true,
		});
		await f.runtime.shutdown();
		const restored = f.load();
		restored.resumeAll();
		await restored.flush();
		const reloaded = restored.get(parent.id);
		expect(reloaded.status).toBe("stopped");
		expect(children(restored, reloaded)).toHaveLength(1);
		expect(children(restored, reloaded)[0]!.status).toBe("stopped");
		expect(
			Object.values(reloaded.launchActions!)[0]!.progress.two!.status,
		).toBe("cancelled");
	});

	it("Stop batch at the persisted intent barrier prevents creation and retains cancellation after restart", async () => {
		const f = fixture([dispatch(false)]);
		const parent = f.create();
		const save = f.runtime.save.bind(f.runtime);
		let entered!: () => void;
		let release!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		vi.spyOn(f.runtime, "save").mockImplementation(async (run) => {
			await save(run);
			if (
				!held &&
				run.id === parent.id &&
				Object.values(run.launchActions ?? {}).some(
					(batch) => batch.progress.one?.creation === "creating",
				)
			) {
				held = true;
				entered();
				await barrier;
			}
		});
		const executing = f.runtime.launch(parent);
		await reached;
		const stop = f.runtime.stopBatch(parent.id);
		release();
		await Promise.all([executing, stop]);
		expect(children(f.runtime, parent)).toHaveLength(0);
		expect(Object.values(parent.launchActions!)[0]).toMatchObject({
			cancelled: true,
			progress: { one: { status: "cancelled" }, two: { status: "cancelled" } },
		});
		await f.runtime.shutdown();
		const restored = f.load();
		restored.resumeAll();
		await restored.flush();
		expect(children(restored, restored.get(parent.id))).toHaveLength(0);
		expect(restored.get(parent.id).status).toBe("stopped");
	});

	it("Stop batch during uncertain child persistence stops that exact child and never launches or duplicates it", async () => {
		const f = fixture([dispatch(false)]);
		const parent = f.create();
		const flush = f.runtime.flush.bind(f.runtime);
		let entered!: () => void;
		let release!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		vi.spyOn(f.runtime, "flush").mockImplementation(async (id) => {
			await flush(id);
			if (!held && id?.startsWith("child-")) {
				held = true;
				entered();
				await barrier;
			}
		});
		const executing = f.runtime.launch(parent);
		await reached;
		const originalChild = children(f.runtime, parent)[0]!;
		expect(originalChild.setupComplete).toBe(false);
		expect(
			Object.values(parent.launchActions!)[0]!.progress.one!.creation,
		).toBe("creating");
		const stop = f.runtime.stopBatch(parent.id);
		release();
		await Promise.all([executing, stop]);
		expect(children(f.runtime, parent).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(originalChild.status).toBe("stopped");
		expect(originalChild.setupComplete).toBe(false);
		expect(f.visits.filter((visit) => visit.startsWith("one:"))).toHaveLength(
			0,
		);
		await f.runtime.shutdown();
		const restored = f.load();
		restored.resumeAll();
		await restored.flush();
		expect(
			children(restored, restored.get(parent.id)).map((child) => child.id),
		).toEqual([originalChild.id]);
		expect(restored.get(originalChild.id).status).toBe("stopped");
	});

	it("parent Stop before child launch admission survives restart without starting that child until explicit Resume", async () => {
		const f = fixture([dispatch(false, [assignment("one")])]);
		const parent = f.create();
		const flush = f.runtime.flush.bind(f.runtime);
		let entered!: () => void;
		let release!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		vi.spyOn(f.runtime, "flush").mockImplementation(async (id) => {
			await flush(id);
			if (!held && id?.startsWith("child-")) {
				held = true;
				entered();
				await barrier;
			}
		});
		const executing = f.runtime.launch(parent);
		await reached;
		const original = children(f.runtime, parent)[0]!;
		f.runtime.stop(parent.id);
		release();
		await executing;
		expect(original.setupComplete).toBe(false);
		expect(
			Object.values(parent.launchActions!)[0]!.progress.one!.launchCommitted,
		).toBeUndefined();
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		restored.resumeAll();
		await restored.flush();
		expect(reloaded.status).toBe("stopped");
		expect(restored.isExecuting(original.id)).toBe(false);
		expect(restored.get(original.id).setupComplete).toBe(false);
		expect(f.holds.has("one")).toBe(false);
		restored.resume(parent.id);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			original.id,
		]);
		f.release("one");
		await waitForRuntime(() => expect(reloaded.status).toBe("completed"));
	});

	it("stopped parents reconcile an uncertain original child without admitting it or changing the stopped outcome", async () => {
		const f = fixture([dispatch(false)]);
		const parent = f.create();
		const save = f.runtime.save.bind(f.runtime);
		let unavailable = false;
		let rejectedWrites = 0;
		vi.spyOn(f.runtime, "save").mockImplementation(async (run) => {
			if (run.recipeParent && unavailable) {
				rejectedWrites++;
				throw new Error("Controlled child storage unavailable");
			}
			await save(run);
		});
		const create = f.runtime.create.bind(f.runtime);
		let lostAcknowledgement = false;
		vi.spyOn(f.runtime, "create").mockImplementation((options, accepted) => {
			const child = create(options, accepted);
			if (options.recipeParent && !lostAcknowledgement) {
				lostAcknowledgement = true;
				unavailable = true;
				throw new Error("Controlled local admission acknowledgement loss");
			}
			return child;
		});
		await f.runtime.launch(parent);
		expect(parent.status).toBe("failed");
		const batch = Object.values(parent.launchActions!)[0]!;
		const accepted = structuredClone(batch.accepted);
		const originalOutput = structuredClone(parent.outputs.dispatch);
		const originalHistory = structuredClone(parent.history);
		const originalChild = children(f.runtime, parent)[0]!;
		const error = parent.error;
		f.runtime.stop(parent.id);
		const launch = vi.spyOn(f.runtime, "launch");
		const beforeObservation = rejectedWrites;
		f.runtime.resumeAll();
		await waitForRuntime(() =>
			expect(rejectedWrites).toBeGreaterThan(beforeObservation),
		);
		expect(parent.status).toBe("stopped");
		expect(parent.error).toBe(error);
		expect(batch.paused).toBe(true);
		expect(batch.progress.one).toMatchObject({
			creation: "uncertain",
			status: "uncertain",
		});
		expect(batch.progress.one!.error).toBe(
			"Child persistence is uncertain; restore storage and reconcile the original child",
		);
		expect(batch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		unavailable = false;
		await f.runtime.save(originalChild);
		await waitForRuntime(() =>
			expect(batch.progress.one).toMatchObject({
				creation: "confirmed",
				status: "launched",
			}),
		);
		expect(batch.progress.one!.launchCommitted).toBeUndefined();
		expect(parent.status).toBe("stopped");
		expect(parent.error).toBe(error);
		expect(launch).not.toHaveBeenCalled();
		expect(f.holds.has("one")).toBe(false);
		expect(originalChild.setupComplete).toBe(false);
		expect(children(f.runtime, parent).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(batch.accepted).toEqual(accepted);
		expect(parent.outputs.dispatch).toEqual(originalOutput);
		expect(parent.history).toEqual(originalHistory);
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		const restoredCreate = vi.spyOn(restored, "create");
		const restoredLaunch = vi.spyOn(restored, "launch");
		restored.resumeAll();
		await restored.flush();
		const restoredBatch = Object.values(reloaded.launchActions!)[0]!;
		expect(reloaded.status).toBe("stopped");
		expect(reloaded.error).toBe(error);
		expect(restoredBatch.paused).toBe(true);
		expect(restoredBatch.progress.one).toMatchObject({
			creation: "confirmed",
			status: "launched",
		});
		expect(restoredBatch.progress.one!.launchCommitted).toBeUndefined();
		expect(restoredBatch.progress.two).toEqual({
			status: "queued",
			creation: "pending",
		});
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			originalChild.id,
		]);
		expect(restoredCreate).not.toHaveBeenCalled();
		expect(restoredLaunch).not.toHaveBeenCalled();
		expect(restoredBatch.accepted).toEqual(accepted);
		expect(reloaded.outputs.dispatch).toEqual(originalOutput);
		expect(reloaded.history).toEqual(originalHistory);
	});

	it("concurrent resumeAll cannot launch a child before its admission intent is durable", async () => {
		const f = fixture([dispatch(false, [assignment("one")])]);
		const parent = f.create();
		const save = f.runtime.save.bind(f.runtime);
		let entered!: () => void;
		let release!: () => void;
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = false;
		vi.spyOn(f.runtime, "save").mockImplementation(async (run) => {
			if (
				!held &&
				run.id === parent.id &&
				Object.values(run.launchActions ?? {}).some(
					(batch) => batch.progress.one?.launchCommitted,
				)
			) {
				held = true;
				entered();
				await barrier;
			}
			await save(run);
		});
		const executing = f.runtime.launch(parent);
		await reached;
		const child = children(f.runtime, parent)[0]!;
		f.runtime.resumeAll();
		const escapedAdmissionBarrier = f.runtime.isExecuting(child.id);
		release();
		await executing;
		expect(escapedAdmissionBarrier).toBe(false);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		f.release("one");
		await waitForRuntime(() => expect(parent.status).toBe("completed"));
		expect(children(f.runtime, parent)).toHaveLength(1);
		expect(f.visits.filter((visit) => visit === "one:draft-pr")).toHaveLength(
			1,
		);
	});

	it("retry after a later graph failure reconciles the original batch and retains its original links", async () => {
		const f = fixture([
			dispatch(false),
			{
				id: "after",
				name: "After dispatch",
				type: "agent",
				prompt: "fixture-after",
			},
		]);
		const originalTool = f.hooks.agent;
		let fail = true;
		f.hooks.agent = async (context) => {
			if (fail && context.step.prompt === "fixture-after") {
				fail = false;
				throw new Error("Controlled later-step failure");
			}
			return originalTool(context);
		};
		const parent = f.create();
		await f.runtime.launch(parent);
		expect(parent.status).toBe("failed");
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const actionIds = Object.keys(parent.launchActions!);
		const originalOutput = structuredClone(parent.outputs.dispatch);
		const firstChildId = children(f.runtime, parent)[0]!.id;
		f.release("one");
		await waitForRuntime(() =>
			expect(f.runtime.get(firstChildId).status).toBe("completed"),
		);
		expect(children(f.runtime, parent)).toHaveLength(1);
		f.runtime.retry(parent.id);
		await waitForRuntime(() => expect(f.holds.has("two")).toBe(true));
		f.release("two");
		await waitForRuntime(() => expect(parent.status).toBe("completed"));
		expect(Object.keys(parent.launchActions!)).toEqual(actionIds);
		expect(parent.outputs.dispatch).toEqual(originalOutput);
		expect(
			parent.history.filter((entry) => entry.step === "dispatch"),
		).toHaveLength(1);
		expect(children(f.runtime, parent)).toHaveLength(2);
		expect(f.visits.filter((visit) => visit === "one:merge")).toHaveLength(1);
	});

	it.each([
		true,
		false,
	])("reports a failed prerequisite batch truthfully with wait=%s instead of completing the parent", async (wait) => {
		const f = fixture([dispatch(wait)]);
		const tool = f.hooks.agent;
		f.hooks.agent = async (context) => {
			if (
				context.run.recipeParent?.itemId === "one" &&
				context.step.prompt === "fixture-hold"
			)
				throw new Error("Controlled prerequisite failure");
			return tool(context);
		};
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(parent.status).toBe("failed"));
		const batch = Object.values(parent.launchActions!)[0]!;
		expect(batch.progress.one!.status).toBe("blocked");
		expect(batch.progress.two!.status).toBe("blocked");
		expect(children(f.runtime, parent)).toHaveLength(1);
		if (wait)
			expect(parent.outputs.dispatch).toMatchObject({
				children: { one: { status: "blocked" }, two: { status: "blocked" } },
			});
	});

	it("retains an independently cancelled child's outcome without falsely completing the parent", async () => {
		const f = fixture([dispatch(false, [assignment("one")])]);
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		f.runtime.stop(children(f.runtime, parent)[0]!.id);
		await waitForRuntime(() => expect(parent.status).toBe("failed"));
		expect(Object.values(parent.launchActions!)[0]!.progress.one!.status).toBe(
			"cancelled",
		);
		expect(children(f.runtime, parent)).toHaveLength(1);
	});

	it("keeps a workflow-only target permitted without granting manual launch permission", async () => {
		const f = fixture([dispatch(false, [assignment("one")])]);
		const target = f.runtime
			.listWorkflows()
			.find((workflow) => workflow.id === "delivery-child")!;
		expect(() => f.create(target)).toThrow("does not allow manual");
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(children(f.runtime, parent)[0]!.workflow.allowedTriggers).toEqual([
			"workflow",
		]);
		f.release("one");
		await waitForRuntime(() => expect(parent.status).toBe("completed"));
	});

	it("resumes wait=true from the same action and already-created child after shutdown", async () => {
		const f = fixture([dispatch(true)]);
		const parent = f.create();
		void f.runtime.launch(parent);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		const accepted = structuredClone(parent.launchActions);
		const first = children(f.runtime, parent)[0]!.id;
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		restored.resumeAll();
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(Object.keys(reloaded.launchActions!)).toEqual(
			Object.keys(accepted!),
		);
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			first,
		]);
		f.release("one");
		await waitForRuntime(() => expect(f.holds.has("two")).toBe(true));
		f.release("two");
		await waitForRuntime(() => expect(reloaded.status).toBe("completed"));
		expect(children(restored, reloaded)).toHaveLength(2);
	});

	it.each([
		"before",
		"after",
	] as const)("uncertain %s-create admission stays actionable across restart and Retry reconciles the original identity", async (phase) => {
		const f = fixture([dispatch(false, [assignment("one")])]);
		const parent = f.create();
		const create = f.runtime.create.bind(f.runtime);
		let failed = false;
		vi.spyOn(f.runtime, "create").mockImplementation((options, accepted) => {
			if (options.recipeParent && !failed) {
				failed = true;
				if (phase === "after") create(options, accepted);
				throw new Error("Controlled local admission acknowledgement loss");
			}
			return create(options, accepted);
		});
		await f.runtime.launch(parent);
		expect(parent.status).toBe("failed");
		expect(parent.error).toMatch(/Child admission needs reconciliation/);
		const [actionId, batch] = Object.entries(parent.launchActions!)[0]!;
		const childId = batch.accepted.items[0]!.runId;
		if (phase === "before")
			expect(batch.progress.one).toMatchObject({
				creation: "uncertain",
				status: "uncertain",
			});
		// A queued receipt notification may safely confirm the persisted original
		// child, but a failed parent cannot admit it to execution before Retry.
		expect(batch.progress.one!.launchCommitted).toBeUndefined();
		expect(children(f.runtime, parent)).toHaveLength(phase === "after" ? 1 : 0);
		expect(f.holds.has("one")).toBe(false);
		await f.runtime.shutdown();
		const restored = f.load();
		const reloaded = restored.get(parent.id);
		restored.resumeAll();
		await restored.flush();
		expect(reloaded.status).toBe("failed");
		expect(f.holds.has("one")).toBe(false);
		restored.retry(parent.id);
		await waitForRuntime(() => expect(f.holds.has("one")).toBe(true));
		expect(Object.keys(reloaded.launchActions!)).toEqual([actionId]);
		expect(children(restored, reloaded).map((child) => child.id)).toEqual([
			childId,
		]);
		f.release("one");
		await waitForRuntime(() => expect(reloaded.status).toBe("completed"));
		expect(f.visits.filter((visit) => visit === "one:draft-pr")).toHaveLength(
			1,
		);
	});

	it("For each and Call recipe launch independent batches when inner item IDs repeat", async () => {
		const f = fixture(
			[
				{
					id: "outer",
					name: "Outer items",
					type: "foreach",
					items: { values: [{ id: "alpha" }, { id: "beta" }] },
					body: [
						{
							id: "call",
							name: "Call reusable dispatch",
							type: "workflow",
							workflow: "launcher",
						},
					],
				},
			],
			{},
			[
				recipe(
					"launcher",
					[dispatch(false, [assignment("same")])],
					["workflow"],
				),
			],
		);
		const parent = f.create();
		await f.runtime.launch(parent);
		await waitForRuntime(() =>
			expect(children(f.runtime, parent)).toHaveLength(2),
		);
		const batches = Object.values(parent.launchActions!);
		expect(batches).toHaveLength(2);
		expect(new Set(batches.map((batch) => batch.accepted.actionId)).size).toBe(
			2,
		);
		expect(batches.map((batch) => batch.accepted.key).sort()).toEqual([
			"outer/alpha/call/dispatch",
			"outer/beta/call/dispatch",
		]);
		expect(
			new Set(children(f.runtime, parent).map((child) => child.id)).size,
		).toBe(2);
		// Both are distinct ordinary children even though the inner source item ID repeats.
		for (const child of children(f.runtime, parent)) f.runtime.stop(child.id);
	});
});

it("completes an empty File issues action without discovering or invoking a tracker", async () => {
	const discover = vi.fn(async () => {
		throw new Error("No tracker should be needed");
	});
	const send = vi.fn(async () => {
		throw new Error("No issue should be sent");
	});
	const f = fixture(
		[
			{
				id: "empty",
				name: "File selected issues",
				type: "file-issues",
				fileIssues: {
					items: { values: [] },
					fields: { title: "/title", body: "/body" },
				},
				next: "end",
			},
		],
		{ issueDestinations: discover, fileIssue: send },
	);
	const run = f.create();
	await f.runtime.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.empty).toEqual({
		tickets: {},
		summary: { total: 0, confirmed: 0, uncertain: 0 },
	});
	expect(discover).not.toHaveBeenCalled();
	expect(send).not.toHaveBeenCalled();
	expect(Object.values(run.issueActions!)[0]!.accepted).toEqual([]);
});
