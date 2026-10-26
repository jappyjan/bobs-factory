import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import failed from "./fixtures/parallel-call-failed-456154f3.json" with {
	type: "json",
};
import unfinished from "./fixtures/parallel-call-unfinished-456154f3.json" with {
	type: "json",
};
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function runtime(home: string, agent: RuntimeHooks["agent"]) {
	const instance = new WorkflowRuntime(home, {
		agent,
	});
	runtimes.push(instance);
	return instance;
}
function create(modern: boolean) {
	const home = mkdtempSync(join(tmpdir(), "parallel-call-"));
	homes.push(home);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "reusable",
			name: "Reusable",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "inside",
					name: "Inside",
					type: "agent",
					prompt: "Return JSON",
					outputFormat: "json-v1",
					next: "end",
				},
			],
		},
		{
			engineVersion: "nodes-v1",
			id: "parent",
			name: "Parent",
			...(modern ? { stepConfigVersion: "step-config-v1" } : {}),
			steps: [
				{
					id: "seed",
					name: "Seed",
					type: "agent",
					prompt: "Return JSON",
					outputFormat: "json-v1",
				},
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					groups: [
						[
							{
								id: "call",
								name: "Call",
								type: "workflow",
								workflow: "reusable",
								next: "end",
							},
						],
					],
					next: "end",
				},
			],
		},
	]);
	const agent = vi.fn(async (context: ExecutionContext) => ({
		value: context.step.id,
	}));
	const instance = runtime(home, agent);
	instance.updateWorkflows(definitions, "parent");
	const run = instance.create({
		id: "parallel-call",
		title: "Parallel Call",
		repositoryId: "fixture",
		workspace: home,
		input: "Synthetic input",
		triggerOrigin: {
			type: "manual",
			workflowId: "parent",
			at: new Date().toISOString(),
		},
		workflow: definitions.at(-1)!,
	});
	return { home, instance, run, agent };
}

it("completes an ordinary Call in modern Parallel with scoped outputs", async () => {
	for (const modern of [true]) {
		const { instance, run, agent } = create(modern);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(agent.mock.calls.map(([context]) => context.step.id)).toEqual([
			"seed",
			"inside",
		]);
		expect(run.outputs.parallel).toEqual([
			{
				...(modern
					? {}
					: { seed: { value: "seed" }, inside: { value: "inside" } }),
				call: { workflow: "reusable", completed: true },
			},
		]);
		expect(
			run.history.filter((entry) => entry.step === "parallel/0/call/inside"),
		).toHaveLength(1);
		expect(
			run.history.filter((entry) => entry.step === "parallel/0/call"),
		).toHaveLength(1);
	}
});

it.each([
	unfinished.run,
	failed,
])("keeps frozen legacy ownership snapshots read-only across restart", async (snapshot) => {
	const home = mkdtempSync(join(tmpdir(), "parallel-legacy-"));
	homes.push(home);
	mkdirSync(join(home, "factory", "runs"), { recursive: true });
	writeFileSync(
		join(home, "factory", "runs", `${snapshot.id}.json`),
		JSON.stringify(snapshot),
	);
	const agent = vi.fn(async () => {
		throw new Error("Legacy work must not replay");
	});
	for (let i = 0; i < 2; i++) {
		const instance = runtime(home, agent);
		const run = instance.get(snapshot.id);
		instance.resumeAll();
		expect(run.workflow).toEqual(snapshot.workflow);
		expect(run.history).toEqual(snapshot.history);
		expect(() => instance.retry(run.id)).toThrow(/older recipe engine/);
		expect(agent).not.toHaveBeenCalled();
		await instance.shutdown();
		await instance.flush();
	}
});

it("finishes a persisted active Call result through normal ownership publication without replay", async () => {
	const { home, instance, run, agent } = create(true);
	let held = false;
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	const save = instance.save.bind(instance);
	vi.spyOn(instance, "save").mockImplementation(async (value) => {
		await save(value);
		if (value.checkpoint?.active?.children?.[0]?.active?.phase === "result") {
			held = true;
			await barrier;
		}
	});
	const running = instance.launch(run);
	try {
		await waitFor(() => expect(held).toBe(true));
		expect(agent).toHaveBeenCalledTimes(2);
	} finally {
		const stopping = instance.shutdown();
		release();
		await stopping;
		await running;
	}
	await instance.flush();
	const history = structuredClone(run.history);
	const resumed = vi.fn(async () => {
		throw new Error("Accepted result must not replay");
	});
	const restarted = runtime(home, resumed);
	const restored = restarted.get(run.id);
	restarted.resumeAll();
	await waitFor(() =>
		expect(restored.status, restored.error).toBe("completed"),
	);
	expect(restored.outputs.parallel).toEqual([
		{ call: { workflow: "reusable", completed: true } },
	]);
	expect(restored.history.slice(0, history.length)).toEqual(history);
	expect(
		restored.history.filter((entry) => entry.step === "parallel/0/call"),
	).toHaveLength(1);
	expect(resumed).not.toHaveBeenCalled();
});
