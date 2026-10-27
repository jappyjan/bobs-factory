import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { LaunchRunsConfigurationSchema } from "../src/factory/ActionSteps.js";
import {
	type LaunchRunsHost,
	prepareLaunchRuns,
	tickLaunchRuns,
} from "../src/factory/LaunchRuns.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

it("settles a detached parent when its last child finishes during the parent's final save", async () => {
	const home = mkdtempSync(join(tmpdir(), "action-seam-finalize-"));
	let releaseChild!: () => void;
	const childBarrier = new Promise<void>((resolve) => {
		releaseChild = resolve;
	});
	let releaseParent!: () => void;
	const parentBarrier = new Promise<void>((resolve) => {
		releaseParent = resolve;
	});
	let parentFinalSave!: () => void;
	const reachedFinalSave = new Promise<void>((resolve) => {
		parentFinalSave = resolve;
	});
	const child = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "seam-child",
		name: "Controlled child",
		allowedTriggers: ["workflow"],
		steps: [
			{ id: "work", name: "Work", type: "agent", prompt: "Controlled work" },
		],
	});
	const parentWorkflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "seam-parent",
		name: "Detached parent",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "dispatch",
				name: "Launch child",
				type: "launch-runs",
				launchRuns: {
					workflow: child.id,
					items: { values: [{ id: "one", prompt: "Controlled child" }] },
					inputMapping: { prompt: "/prompt" },
					wait: false,
				},
			},
		],
	});
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			await childBarrier;
			return { completed: true };
		},
	});
	let parent: FactoryRun | undefined;
	let executing: Promise<void> | undefined;
	try {
		runtime.updateWorkflows([
			...runtime.listWorkflows(),
			parentWorkflow,
			child,
		]);
		parent = runtime.create({
			repositoryId: "fixture",
			workspace: "",
			workflow: parentWorkflow,
			workflowDefinitions: runtime.listWorkflows(),
			input: "Coordinate controlled work",
			triggerOrigin: { type: "manual", workflowId: parentWorkflow.id },
		});
		const save = runtime.save.bind(runtime);
		let waitingEndSaves = 0;
		vi.spyOn(runtime, "save").mockImplementation(async (run) => {
			const hold =
				run.id === parent!.id &&
				run.status === "waiting" &&
				run.checkpoint?.current === "end" &&
				++waitingEndSaves === 2;
			await save(run);
			if (hold) {
				parentFinalSave();
				await parentBarrier;
			}
		});
		executing = runtime.launch(parent);
		await reachedFinalSave;
		expect(runtime.isExecuting(parent.id)).toBe(true);
		releaseChild();
		await waitForRuntime(() => {
			expect(
				Object.values(parent!.launchActions!)[0]!.progress.one!.status,
			).toBe("completed");
			expect(
				[...runtime.runs.values()]
					.filter((run) => run.recipeParent?.runId === parent!.id)
					.every((run) => !runtime.isExecuting(run.id)),
			).toBe(true);
		});
		await runtime.flush();
		expect(runtime.isExecuting(parent.id)).toBe(true);
		releaseParent();
		await executing;
		await waitForRuntime(() => expect(parent!.status).toBe("completed"));
		expect(
			parent.history.filter((entry) => entry.step === "dispatch"),
		).toHaveLength(1);
		expect(
			[...runtime.runs.values()].filter(
				(run) => run.recipeParent?.runId === parent!.id,
			),
		).toHaveLength(1);
	} finally {
		releaseChild();
		releaseParent();
		await executing;
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	"stop",
	"shutdown",
] as const)("observes the pending human gate rejection when %s interrupts notification publication", async (operation) => {
	const home = mkdtempSync(join(tmpdir(), "action-seam-review-"));
	let releasePublication!: () => void;
	const publicationBarrier = new Promise<void>((resolve) => {
		releasePublication = resolve;
	});
	let publicationReached!: () => void;
	const reachedPublication = new Promise<void>((resolve) => {
		publicationReached = resolve;
	});
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "seam-review",
		name: "Controlled review",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "review",
				name: "Human review",
				type: "display",
				document: {
					version: "view-v1",
					components: [
						{
							id: "submit",
							type: "actions",
							data: {
								literal: { actions: [{ id: "approve", label: "Approve" }] },
							},
						},
					],
				},
			},
		],
	});
	const runtime = new WorkflowRuntime(home, {
		track: async () => {},
		agent: async () => ({}),
	});
	let executing: Promise<void> | undefined;
	let stopping: Promise<void> | undefined;
	const unhandled: unknown[] = [];
	const observe = (error: unknown) => {
		unhandled.push(error);
	};
	process.on("unhandledRejection", observe);
	try {
		runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: "",
			workflow,
			workflowDefinitions: runtime.listWorkflows(),
			input: "Controlled review",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		run.ticketReference = {
			provider: "native",
			platform: "linear",
			workspaceId: "fixture",
			id: "fixture-issue",
			url: "https://linear.app/fixture/issue/TEST-1",
		};
		const track = runtime.track.bind(runtime);
		vi.spyOn(runtime, "track").mockImplementation(
			async (current, milestone) => {
				await track(current, milestone);
				if (milestone.key.startsWith("view:")) {
					publicationReached();
					await publicationBarrier;
				}
			},
		);
		executing = runtime.launch(run);
		await reachedPublication;
		const originalGate = structuredClone(run.viewDecision);
		if (operation === "stop") runtime.stop(run.id);
		else stopping = runtime.shutdown();
		// A real event-loop turn exposes an unobserved rejection before publication resumes.
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(unhandled).toEqual([]);
		releasePublication();
		await executing;
		await stopping;
		expect(run.status).toBe(operation === "stop" ? "stopped" : "waiting");
		expect(run.viewDecision).toEqual(originalGate);
		expect(run.viewDecision?.answer).toBeUndefined();
		expect(run.viewRecords?.every((record) => !record.answer)).toBe(true);
		expect(runtime.isExecuting(run.id)).toBe(false);
	} finally {
		releasePublication();
		await executing;
		await stopping;
		await runtime.shutdown();
		process.removeListener("unhandledRejection", observe);
		rmSync(home, { recursive: true, force: true });
	}
});

it("includes nested Launch runs targets in availability impact and pauses the parent before any child exists", async () => {
	const home = mkdtempSync(join(tmpdir(), "action-seam-availability-"));
	const runtime = new WorkflowRuntime(home, { agent: async () => ({}) });
	try {
		const target = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "seam-availability-target",
			name: "Child",
			allowedTriggers: ["workflow"],
			steps: [
				{ id: "work", name: "Work", type: "agent", prompt: "Controlled work" },
			],
		});
		const bridge = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "seam-availability-bridge",
			name: "Bridge",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "launch",
					name: "Launch",
					type: "launch-runs",
					launchRuns: {
						workflow: target.id,
						items: { values: [{ id: "one", prompt: "Controlled work" }] },
						inputMapping: { prompt: "/prompt" },
						wait: true,
					},
				},
			],
		});
		const workflow = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "seam-availability-parent",
			name: "Parent",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "call",
					name: "Call bridge",
					type: "workflow",
					workflow: bridge.id,
				},
			],
		});
		runtime.updateWorkflows([
			...runtime.listWorkflows(),
			workflow,
			bridge,
			target,
		]);
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: "",
			workflow,
			workflowDefinitions: runtime.listWorkflows(),
			input: "Controlled work",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		expect(runtime.availabilityImpact(target.id)).toEqual([run.id]);
		runtime.setWorkflowEnabled(target.id, false);
		expect(run.status).toBe("blocked");
		expect(run.workflowBlock?.workflowIds).toEqual([target.id]);
		expect(
			[...runtime.runs.values()].filter(
				(candidate) => candidate.recipeParent?.runId === run.id,
			),
		).toEqual([]);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("does not promote ordinary agent outputs through unversioned merge aliases into dependency delivery proof", async () => {
	const home = mkdtempSync(join(tmpdir(), "action-seam-authority-"));
	const runtime = new WorkflowRuntime(home, { agent: async () => ({}) });
	try {
		const target = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "seam-agent-alias-child",
			name: "Unversioned child",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "draft-pr",
					name: "Agent observation",
					type: "agent",
					prompt: "Return observation",
				},
				{
					id: "merge",
					name: "Agent claim",
					type: "agent",
					prompt: "Return observation",
				},
			],
		});
		const configuration = LaunchRunsConfigurationSchema.parse({
			workflow: target.id,
			items: {
				values: [
					{ id: "one", prompt: "First", dependencies: [] },
					{ id: "two", prompt: "Second", dependencies: ["one"] },
				],
			},
			inputMapping: { prompt: "/prompt" },
			dependencies: "/dependencies",
			wait: false,
		});
		const workflow = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "seam-agent-alias-parent",
			name: "Parent",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "dispatch",
					name: "Dispatch",
					type: "launch-runs",
					launchRuns: configuration,
				},
			],
		});
		runtime.updateWorkflows([...runtime.listWorkflows(), workflow, target]);
		const parent = runtime.create({
			repositoryId: "fixture",
			workspace: "",
			workflow,
			workflowDefinitions: runtime.listWorkflows(),
			input: "Controlled dependency work",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		const batch = prepareLaunchRuns(
			parent,
			configuration,
			{ outputs: {} },
			{ key: "dispatch", actionId: "exact-admission" },
		);
		parent.launchActions = { "exact-admission": batch };
		const host: LaunchRunsHost = {
			runtime: {
				runs: runtime.runs,
				create: runtime.create.bind(runtime),
				save: runtime.save.bind(runtime),
				flush: runtime.flush.bind(runtime),
				launch: async () => {},
				stop: runtime.stop.bind(runtime),
				isExecuting: () => false,
			},
			save: () => runtime.save(parent),
		};
		await tickLaunchRuns(parent, batch, host);
		const first = runtime.get(batch.accepted.items[0]!.runId);
		const publication = {
			url: "https://forge.fixture.test/project/pull/1",
			headSha: "a".repeat(40),
		};
		const claim = { ...publication, merged: true };
		first.outputs = { "draft-pr": publication, merge: claim };
		first.history = [
			{ step: "draft-pr", output: publication, at: first.createdAt },
			{ step: "merge", output: claim, at: first.createdAt },
		];
		first.humanDecisions = [
			{
				reviewId: "retained-human-approval",
				decision: "approve",
				headSha: publication.headSha,
				at: first.createdAt,
			},
		];
		first.status = "completed";
		await tickLaunchRuns(parent, batch, host);
		expect(runtime.runs.size).toBe(2);
		expect(batch.progress.two!.status).toBe("blocked");
		expect(batch.progress.two!.creation).toBe("pending");
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

function emptyBatchFixture(finished: (run: FactoryRun) => Promise<void>) {
	const home = mkdtempSync(join(tmpdir(), "action-seam-publication-"));
	const runtime = new WorkflowRuntime(home, {
		finished,
		agent: async () => ({}),
	});
	const target = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "seam-publication-child",
		name: "Unused target",
		allowedTriggers: ["workflow"],
		steps: [
			{ id: "work", name: "Work", type: "agent", prompt: "Controlled work" },
		],
	});
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "seam-publication-parent",
		name: "Empty accepted batch",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "dispatch",
				name: "Dispatch",
				type: "launch-runs",
				launchRuns: {
					workflow: target.id,
					items: { values: [] },
					inputMapping: { prompt: "/prompt" },
					wait: false,
				},
			},
		],
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow, target]);
	const parent = runtime.create({
		repositoryId: "fixture",
		workspace: "",
		workflow,
		workflowDefinitions: runtime.listWorkflows(),
		input: "Controlled empty batch",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	return { home, runtime, parent };
}

it("publishes one terminal hook when concurrent recovery requests arrive during publication", async () => {
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered!: () => void;
	const reached = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const finished = vi.fn(async () => {
		entered();
		await barrier;
	});
	const { home, runtime, parent } = emptyBatchFixture(finished);
	let executing: Promise<void> | undefined;
	try {
		executing = runtime.launch(parent);
		await reached;
		expect(parent.launchOutcomePublication?.phase).toBe("pending");
		const key = parent.launchOutcomePublication!.key;
		runtime.resumeAll();
		runtime.resumeAll();
		await runtime.flush();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(finished).toHaveBeenCalledTimes(1);
		release();
		await executing;
		await waitForRuntime(() =>
			expect(parent.launchOutcomePublication).toEqual({
				key,
				phase: "confirmed",
			}),
		);
		expect(parent.status).toBe("completed");
		expect(
			parent.history.filter((entry) => entry.step === "dispatch"),
		).toHaveLength(1);
	} finally {
		release();
		await executing;
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("releases execution after a terminal publication save failure and retries the same receipt without replaying dispatch", async () => {
	const finished = vi.fn(async () => {});
	const { home, runtime, parent } = emptyBatchFixture(finished);
	try {
		const save = runtime.save.bind(runtime);
		let failed = false;
		vi.spyOn(runtime, "save").mockImplementation(async (run) => {
			if (
				!failed &&
				run.id === parent.id &&
				run.launchOutcomePublication?.phase === "pending"
			) {
				failed = true;
				throw new Error("Controlled publication storage outage");
			}
			await save(run);
		});
		await runtime.launch(parent);
		expect(failed).toBe(true);
		expect(runtime.isExecuting(parent.id)).toBe(false);
		expect(parent.status).toBe("completed");
		expect(parent.launchOutcomePublication?.phase).toBe("pending");
		expect(finished).not.toHaveBeenCalled();
		const key = parent.launchOutcomePublication!.key;
		const output = structuredClone(parent.outputs.dispatch);
		runtime.resumeAll();
		await waitForRuntime(() =>
			expect(parent.launchOutcomePublication).toEqual({
				key,
				phase: "confirmed",
			}),
		);
		expect(finished).toHaveBeenCalledTimes(1);
		expect(parent.outputs.dispatch).toEqual(output);
		expect(
			parent.history.filter((entry) => entry.step === "dispatch"),
		).toHaveLength(1);
		expect(runtime.runs.size).toBe(1);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
