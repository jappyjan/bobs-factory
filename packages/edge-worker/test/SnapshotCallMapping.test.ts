import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonSnapshotStore } from "bobs-factory-core";
import { afterEach, describe, expect, it } from "vitest";
import { registerResearchTools } from "../../mcp-tools/src/factoryResearch.js";
import { digest } from "../src/factory/Delivery.js";
import { snapshotForRead } from "../src/factory/RepositorySnapshot.js";
import { pinReadOnlyAccess } from "../src/factory/RevisionBinding.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type GraphCheckpoint,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function recipe(id: string, steps: unknown[]) {
	return WorkflowSchema.parse({
		id,
		name: id,
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["manual", "workflow"],
		steps,
	});
}
const inspect = (from = "@callInputs/baseline") => ({
	id: "inspect",
	name: "Inspect pinned blobs",
	type: "agent",
	prompt: "Read the pinned fixture",
	access: "read-only",
	revision: "bound",
	reads: { baseline: from },
	output: { format: "json-v1" },
	next: "end",
});
const snapshot = (id = "source-snapshot", next = "call") => ({
	id,
	name: "Freeze repositories",
	type: "snapshot",
	snapshot: {},
	next,
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "snapshot-call-mapping-"));
	homes.push(home);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", home, ...args], {
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", "/dev/null");
	writeFileSync(join(home, "README.md"), "original immutable fixture");
	git("add", "README.md");
	git("commit", "-m", "Fixture");
	return {
		home,
		git,
		revision: git("rev-parse", "HEAD"),
		state: join(home, "state"),
	};
}
function runtime(
	state: string,
	agent: (context: ExecutionContext) => Promise<unknown>,
) {
	const instance = new WorkflowRuntime(state, {
		agent,
		tool: async () => {
			throw new Error("Unexpected tool");
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
	});
	runtimes.push(instance);
	return instance;
}
function create(
	instance: WorkflowRuntime,
	home: string,
	definitions: ReturnType<typeof recipe>[],
) {
	// This is an actual catalogue save: callees cannot reference unknown caller step IDs.
	instance.updateWorkflows([...instance.listWorkflows(), ...definitions]);
	const workflow = definitions[0]!;
	return instance.create({
		id: "snapshot-call",
		repositoryId: "fixture",
		workspace: home,
		repositories: [
			{
				id: "fixture",
				name: "Fixture",
				repositoryPath: home,
				workspace: home,
				baseBranch: "main",
			},
		],
		input: "Controlled immutable inspection",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
}
async function readBlob(context: ExecutionContext) {
	const access = await pinReadOnlyAccess(context);
	let read:
		| ((
				args: Record<string, unknown>,
		  ) => Promise<{ content: { text: string }[] }>)
		| undefined;
	registerResearchTools(
		{
			registerTool: (name: string, _config: unknown, fn: typeof read) => {
				if (name === "read_repository") read = fn;
			},
		} as unknown as Parameters<typeof registerResearchTools>[0],
		access,
	);
	const result = await read!({
		repositoryId: "fixture",
		path: "README.md",
		offset: 0,
	});
	return {
		revision: access.repositories[0]!.revision,
		blob: JSON.parse(result.content[0]!.text),
	};
}
function directDefinitions() {
	const child = recipe("independent-inspector", [inspect()]);
	const parent = recipe("renamed-caller", [
		snapshot("frozen-project", "handoff"),
		{
			id: "handoff",
			name: "Call independent inspector",
			type: "workflow",
			workflow: child.id,
			inputMapping: { baseline: "/frozen-project" },
			next: "end",
		},
	]);
	return [parent, child];
}
function clearPrivateInputs(frame?: GraphCheckpoint) {
	if (!frame) return;
	delete frame.snapshotInputs;
	for (const child of frame.active?.children ?? []) clearPrivateInputs(child);
}

describe("private Snapshot provenance across mapped Call inputs", () => {
	it("maps a whole Snapshot owned by a completed reusable Call result", async () => {
		const f = fixture();
		let inspected = 0;
		const producer = recipe("snapshot-producer", [snapshot("baseline", "end")]);
		const child = recipe("result-inspector", [inspect()]);
		const parent = recipe("result-caller", [
			{
				id: "produce",
				name: "Produce baseline",
				type: "workflow",
				workflow: producer.id,
				inputMapping: {},
				next: "consume",
			},
			{
				id: "consume",
				name: "Consume returned baseline",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/produce/outputs/baseline" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			inspected++;
			expect(context.snapshotInputs!.baseline!.producer.key).toBe(
				"produce/baseline",
			);
			expect(context.snapshotInputs!.baseline!.hops[0]!.wrappers).toEqual([
				{ key: "produce", outputDigest: digest(context.run.outputs.produce) },
			]);
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, producer, child]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(inspected).toBe(1);
		expect(run.outputs["consume/inspect"]).toMatchObject({
			revision: f.revision,
		});
	});
	it.each([
		false,
		true,
	])("maps an exact For each result item through runtime-owned result wrappers (nested Call=%s)", async (nested) => {
		const f = fixture();
		let inspected = 0;
		const rows = {
			id: "rows",
			name: "Produce each baseline",
			type: "foreach",
			items: { values: [{ id: "a" }, { id: "b" }] },
			body: [snapshot("baseline", "end")],
			next: nested ? "end" : "consume",
		};
		const producer = recipe("item-snapshot-producer", [rows]);
		const child = recipe("item-result-inspector", [inspect()]);
		const path = nested
			? "/produce/outputs/rows/results/a/baseline"
			: "/rows/results/a/baseline";
		const parent = recipe("item-result-caller", [
			...(nested
				? [
						{
							id: "produce",
							name: "Produce items",
							type: "workflow",
							workflow: producer.id,
							inputMapping: {},
							next: "consume",
						},
					]
				: [rows]),
			{
				id: "consume",
				name: "Consume selected item",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: path },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			inspected++;
			expect(context.snapshotInputs!.baseline!.producer.key).toBe(
				`${nested ? "produce/" : ""}rows/a/baseline`,
			);
			expect(
				context.snapshotInputs!.baseline!.hops[0]!.wrappers!.map(
					(wrapper) => wrapper.key,
				),
			).toEqual(nested ? ["produce", "produce/rows"] : ["rows"]);
			return readBlob(context);
		});
		const run = create(
			instance,
			f.home,
			nested ? [parent, producer, child] : [parent, child],
		);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(inspected).toBe(1);
	});
	it("does not revive a stale runtime wrapper after its real producer has returned a newer Snapshot", async () => {
		const f = fixture();
		let decisions = 0,
			inspected = 0;
		const producer = recipe("repeated-producer", [snapshot("baseline", "end")]);
		const child = recipe("stale-result-inspector", [inspect()]);
		const parent = recipe("stale-result-caller", [
			{
				id: "produce",
				name: "Produce baseline",
				type: "workflow",
				workflow: producer.id,
				inputMapping: {},
				next: "decide",
			},
			{
				id: "decide",
				name: "Repeat once",
				type: "agent",
				prompt: "Controlled fixture",
				output: { format: "json-v1" },
				branches: [{ when: { path: "again", equals: true }, next: "produce" }],
				next: "alter",
			},
			{
				id: "alter",
				name: "Adversarial stale projection",
				type: "agent",
				prompt: "Controlled fixture",
				output: { format: "json-v1" },
				next: "consume",
			},
			{
				id: "consume",
				name: "Consume current result",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/produce/outputs/baseline" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			if (context.step.id === "decide") return { again: ++decisions === 1 };
			if (context.step.id === "alter") {
				const original = context.run.history.find(
					(entry) => entry.step === "produce",
				)!;
				context.run.outputs.produce = structuredClone(original.output);
				return {};
			}
			inspected++;
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, producer, child]);
		await instance.launch(run);
		expect(decisions).toBe(2);
		expect(
			run.history.filter((entry) => entry.step === "produce"),
		).toHaveLength(2);
		expect(run.status).toBe("failed");
		expect(run.error).toBe(
			"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
		);
		expect(inspected).toBe(0);
	});
	it("does not grant Snapshot authority to an ordinary agent's exact copy of a runtime Call wrapper", async () => {
		const f = fixture();
		let inspected = 0;
		const producer = recipe("wrapper-producer", [snapshot("baseline", "end")]);
		const child = recipe("wrapper-inspector", [inspect()]);
		const parent = recipe("copied-wrapper-caller", [
			{
				id: "produce",
				name: "Produce baseline",
				type: "workflow",
				workflow: producer.id,
				inputMapping: {},
				next: "copy",
			},
			{
				id: "copy",
				name: "Copy ordinary wrapper",
				type: "agent",
				prompt: "Copy JSON",
				reads: { wrapper: "produce" },
				output: { format: "json-v1" },
				next: "consume",
			},
			{
				id: "consume",
				name: "Consume ordinary copy",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/copy/outputs/baseline" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			if (context.step.id === "copy") return stepBindings(context).wrapper;
			inspected++;
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, producer, child]);
		await instance.launch(run);
		expect(run.outputs.copy).toEqual(run.outputs.produce);
		expect(run.status).toBe("failed");
		expect(run.error).toBe(
			"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
		);
		expect(inspected).toBe(0);
	});
	it("rejects an altered For each wrapper that substitutes another item's otherwise real Snapshot", async () => {
		const f = fixture();
		let inspected = 0;
		const child = recipe("altered-result-inspector", [inspect()]);
		const parent = recipe("altered-result-caller", [
			{
				id: "rows",
				name: "Produce baselines",
				type: "foreach",
				items: { values: [{ id: "a" }, { id: "b" }] },
				body: [snapshot("baseline", "end")],
				next: "alter",
			},
			{
				id: "alter",
				name: "Adversarial projection fixture",
				type: "agent",
				prompt: "Controlled fixture",
				output: { format: "json-v1" },
				next: "consume",
			},
			{
				id: "consume",
				name: "Consume selected baseline",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/rows/results/a/baseline" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			if (context.step.id === "alter") {
				// Corrupt only the mutable output projection; original accepted history stays intact.
				const changed = structuredClone(context.run.outputs.rows) as {
					results: Record<string, unknown>;
				};
				changed.results.a = changed.results.b;
				context.run.outputs.rows = changed;
				return {};
			}
			inspected++;
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, child]);
		await instance.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toBe(
			"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
		);
		expect(inspected).toBe(0);
		const original = run.history.find((entry) => entry.step === "rows")!
			.output as { results: Record<string, unknown> };
		expect(original.results.a).not.toEqual(original.results.b);
	});
	it("saves an independent callee and maps a renamed real Snapshot while serving its original tracked blob", async () => {
		const f = fixture(),
			observations: ExecutionContext[] = [];
		const instance = runtime(f.state, async (context) => {
			observations.push(context);
			writeFileSync(join(f.home, "README.md"), "new mutable HEAD");
			f.git("add", "README.md");
			f.git("commit", "-m", "Later");
			return readBlob(context);
		});
		const definitions = directDefinitions(),
			accepted = JSON.stringify(definitions),
			run = create(instance, f.home, definitions);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(observations).toHaveLength(1);
		expect(run.outputs["handoff/inspect"]).toEqual({
			revision: f.revision,
			blob: {
				revision: f.revision,
				path: "README.md",
				offset: 0,
				text: "original immutable fixture",
				total: 26,
				nextOffset: null,
			},
		});
		expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
		const context = observations[0]!;
		expect(context.snapshotInputs?.baseline).toMatchObject({
			runId: run.id,
			producer: { key: "frozen-project" },
			hops: [
				{
					callKey: "handoff",
					targetWorkflowId: "independent-inspector",
					inputName: "baseline",
					path: "/frozen-project",
				},
			],
		});
		expect(stepBindings(context)).toEqual({
			baseline: context.callInputs!.baseline,
		});
		expect(JSON.stringify(context.input)).not.toContain("snapshotInputs");
		expect(JSON.stringify(run.outputs)).not.toContain("mappingDigest");
	});
	it("retains a global Snapshot through renamed nested Call and For each mappings without sharing item authority", async () => {
		const f = fixture(),
			contexts: ExecutionContext[] = [];
		const leaf = recipe("leaf-inspector", [inspect()]);
		const middle = recipe("mapped-middle", [
			{
				id: "rows",
				name: "Inspect rows",
				type: "foreach",
				items: { values: [{ id: "a" }, { id: "b" }] },
				concurrency: 1,
				body: [
					{
						id: "relay",
						name: "Relay baseline",
						type: "workflow",
						workflow: leaf.id,
						reads: { original: "@callInputs/baseline" },
						inputMapping: { baseline: "/inputs/original" },
						next: "end",
					},
				],
				next: "end",
			},
		]);
		const parent = recipe("outer-coordinator", [
			snapshot(),
			{
				id: "call",
				name: "Call middle",
				type: "workflow",
				workflow: middle.id,
				inputMapping: { baseline: "/source-snapshot" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			contexts.push(context);
			if (context.iteration?.id === "b")
				expect(() =>
					snapshotForRead({
						...context,
						snapshotInputs: contexts[0]!.snapshotInputs,
					}),
				).toThrow("runtime-produced");
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, middle, leaf]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(contexts.map((c) => c.stepKey)).toEqual([
			"call/rows/a/relay/inspect",
			"call/rows/b/relay/inspect",
		]);
		for (const context of contexts) {
			expect(context.snapshotInputs!.baseline!.hops).toHaveLength(2);
			expect(context.snapshotInputs!.baseline!.hops[1]!.iteration).toEqual({
				frame: "call/rows",
				id: context.iteration!.id,
				index: context.iteration!.index,
				itemDigest: digest(context.iteration!.value),
			});
		}
	});
	it("tracks item-owned Snapshot producers through Call without permitting a sibling's private record", async () => {
		const f = fixture(),
			contexts: ExecutionContext[] = [];
		const leaf = recipe("per-item-inspector", [inspect()]);
		const parent = recipe("per-item-coordinator", [
			{
				id: "rows",
				name: "Per item",
				type: "foreach",
				items: { values: [{ id: "a" }, { id: "b" }] },
				concurrency: 1,
				body: [
					snapshot("item-baseline"),
					{
						id: "call",
						name: "Inspect item",
						type: "workflow",
						workflow: leaf.id,
						inputMapping: { baseline: "/item-baseline" },
						next: "end",
					},
				],
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			contexts.push(context);
			if (context.iteration!.id === "b")
				expect(() =>
					snapshotForRead({
						...context,
						snapshotInputs: contexts[0]!.snapshotInputs,
						callInputs: contexts[0]!.callInputs,
					}),
				).toThrow("runtime-produced");
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, leaf]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(contexts).toHaveLength(2);
		expect(
			contexts.map((c) => c.snapshotInputs!.baseline!.producer.key),
		).toEqual(["rows/a/item-baseline", "rows/b/item-baseline"]);
	});
	it.each([
		false,
		true,
	])("backfills only matching frozen old Call inputs after real persisted restart (source drift=%s)", async (drift) => {
		const f = fixture();
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const first = runtime(f.state, async (context) => {
			await readBlob(context);
			entered();
			await new Promise<void>((resolve) =>
				context.signal.addEventListener("abort", () => resolve(), {
					once: true,
				}),
			);
			return {};
		});
		const definitions = directDefinitions(),
			run = create(first, f.home, definitions),
			execution = first.launch(run);
		await ready;
		first.stop(run.id);
		await execution;
		await first.shutdown();
		const path = join(f.state, "factory", "runs", `${run.id}.json`),
			stored = JSON.parse(readFileSync(path, "utf8")),
			saved =
				stored.format === "bobs-factory-json-snapshot-1"
					? new JsonSnapshotStore(
							join(f.state, "factory", "run-chunks"),
						).load<FactoryRun>(path).value
					: (stored as FactoryRun);
		clearPrivateInputs(saved.checkpoint);
		if (drift)
			saved.outputs["frozen-project"] = {
				...(saved.outputs["frozen-project"] as object),
				revision: "forged-public-revision",
			};
		const frozen = JSON.stringify(
				saved.checkpoint!.active!.children![0]!.callInputs,
			),
			receipt = JSON.stringify(saved.repositorySnapshots),
			graph = JSON.stringify(saved.workflowDefinitions);
		writeFileSync(path, JSON.stringify(saved));
		let calls = 0;
		const restored = runtime(f.state, async (context) => {
			calls++;
			return readBlob(context);
		});
		const loaded = restored.get(run.id);
		await restored.launch(loaded);
		expect(loaded.status, loaded.error).toBe(drift ? "failed" : "completed");
		expect(calls).toBe(drift ? 0 : 1);
		if (drift)
			expect(loaded.error).toBe(
				"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
			);
		expect(JSON.stringify(loaded.repositorySnapshots)).toBe(receipt);
		expect(JSON.stringify(loaded.workflowDefinitions)).toBe(graph);
		if (drift)
			expect(
				JSON.stringify(loaded.checkpoint!.active!.children![0]!.callInputs),
			).toBe(frozen);
	});
	it("passes copied Snapshot JSON as ordinary Call data but refuses pinned access without producer authority", async () => {
		const f = fixture();
		let inspected = 0;
		const child = recipe("copy-inspector", [inspect()]);
		const parent = recipe("copy-caller", [
			snapshot("real-source", "copy"),
			{
				id: "copy",
				name: "Copy ordinary data",
				type: "agent",
				prompt: "Echo ordinary JSON",
				reads: { source: "real-source" },
				output: { format: "json-v1" },
				next: "call",
			},
			{
				id: "call",
				name: "Pass ordinary copy",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/copy" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			if (context.step.id === "copy") return stepBindings(context).source;
			inspected++;
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, child]);
		await instance.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toBe(
			"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
		);
		expect(inspected).toBe(0);
		expect(run.checkpoint!.active!.children![0]!.callInputs!.baseline).toEqual(
			run.outputs.copy,
		);
		expect(run.checkpoint!.active!.children![0]!.snapshotInputs).toEqual({});
	});
	it("does not let an ordinary mapped alias impersonate the ancestor Snapshot output in a nested Call", async () => {
		const f = fixture();
		let inspected = 0;
		const child = recipe("shadow-inspector", [inspect()]);
		const middle = recipe("shadow-middle", [
			{
				id: "relay",
				name: "Relay ordinary alias",
				type: "workflow",
				workflow: child.id,
				inputMapping: { baseline: "/source-snapshot" },
				next: "end",
			},
		]);
		const parent = recipe("shadow-caller", [
			snapshot("source-snapshot", "copy"),
			{
				id: "copy",
				name: "Ordinary copy",
				type: "agent",
				prompt: "Copy JSON",
				reads: { source: "source-snapshot" },
				output: { format: "json-v1" },
				next: "call",
			},
			{
				id: "call",
				name: "Pass copied alias",
				type: "workflow",
				workflow: middle.id,
				inputMapping: { "source-snapshot": "/copy" },
				next: "end",
			},
		]);
		const instance = runtime(f.state, async (context) => {
			if (context.step.id === "copy") return stepBindings(context).source;
			inspected++;
			return readBlob(context);
		});
		const run = create(instance, f.home, [parent, middle, child]);
		await instance.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toBe(
			"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
		);
		expect(inspected).toBe(0);
	});
	it("rejects missing, altered, foreign and wrong-frame provenance instead of borrowing authority from public equality", async () => {
		const f = fixture();
		let checks = 0;
		const instance = runtime(f.state, async (context) => {
			const provenance = context.snapshotInputs!.baseline!;
			for (const bad of [
				undefined,
				{ ...provenance, runId: "foreign-run" },
				{
					...provenance,
					valueDigest: digest({ copy: context.callInputs!.baseline }),
				},
				{
					...provenance,
					hops: provenance.hops.map((h) => ({ ...h, callKey: "other-call" })),
				},
				{
					...provenance,
					hops: provenance.hops.map((h) => ({
						...h,
						mappingDigest: "changed",
					})),
				},
			]) {
				expect(() =>
					snapshotForRead({
						...context,
						snapshotInputs: bad ? { baseline: bad } : {},
					}),
				).toThrow("runtime-produced");
				checks++;
			}
			const changed = {
				...(context.callInputs!.baseline as object),
				revision: "altered",
			};
			expect(() =>
				snapshotForRead({ ...context, callInputs: { baseline: changed } }),
			).toThrow("runtime-produced");
			checks++;
			return readBlob(context);
		});
		const run = create(instance, f.home, directDefinitions());
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(checks).toBe(6);
	});
});

it("reads the original private Snapshot through renamed nested outcome Call ports, never equal JSON", async () => {
	const f = fixture();
	const reader = {
		...recipe("port-reader", [inspect("baseline")]),
		inputs: ["baseline"],
		outcomes: ["completed"],
	};
	const bridge = {
		...recipe("port-bridge", [
			{
				id: "nested",
				name: "Nested",
				type: "workflow",
				workflow: reader.id,
				bindings: { baseline: "@bindings/pinned" },
				next: "end",
			},
		]),
		inputs: ["pinned"],
		outcomes: ["completed"],
	};
	const parent = recipe("port-parent", [
		snapshot("original-snapshot", "handoff"),
		{
			id: "handoff",
			name: "Handoff",
			type: "workflow",
			workflow: bridge.id,
			bindings: { pinned: "original-snapshot" },
			next: "end",
		},
	]);
	const instance = runtime(f.state, async (context) => {
		expect(snapshotForRead(context, "baseline")?.producer.key).toBe(
			"original-snapshot",
		);
		const read = await readBlob(context);
		expect(read.revision).toBe(f.revision);
		return read;
	});
	const run = create(instance, f.home, [parent, bridge, reader]);
	await instance.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(run.history.map((x) => x.step)).toContain("handoff/nested/inspect");
	const snapshotReceipt = Object.values(run.repositorySnapshots!)[0]!;
	// An inherited lookalike with no declared executed producer cannot acquire identity.
	const step = reader.steps[0]!;
	expect(() =>
		snapshotForRead(
			{
				run,
				step,
				stepKey: "unbound/inspect",
				outputs: { baseline: run.outputs["original-snapshot"] },
			} as ExecutionContext,
			"baseline",
		),
	).toThrow();
	expect(snapshotReceipt.producer.key).toBe("original-snapshot");
});

it("refreshes mapped Snapshot provenance on a new retained Call visit and preserves both original receipts", async () => {
	const f = fixture(),
		revisions: string[] = [];
	const child = recipe("revisit-inspector", [
		{
			...inspect(),
			maxVisits: 2,
			branches: [{ when: { path: "retry", equals: true }, next: "repair" }],
		},
	]);
	child.outcomes = ["repair", "completed"];
	const parent = recipe("revisit-caller", [
		snapshot("baseline", "call"),
		{
			id: "call",
			name: "Inspect",
			type: "workflow",
			workflow: child.id,
			inputMapping: { baseline: "/baseline" },
			next: "end",
			branches: [
				{ when: { path: "outcome", equals: "repair" }, next: "change" },
			],
		},
		{
			id: "change",
			name: "Change",
			type: "agent",
			prompt: "Change fixture",
			next: "baseline",
		},
	]);
	const r = runtime(f.state, async (c) => {
		if (c.step.id === "change") {
			writeFileSync(join(f.home, "README.md"), "second immutable fixture");
			f.git("add", "README.md");
			f.git("commit", "-m", "changed [skip ci]");
			return { changed: true };
		}
		const value = await readBlob(c);
		revisions.push(value.revision);
		return { ...value, retry: revisions.length === 1 };
	});
	const run = create(r, f.home, [parent, child]);
	await r.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(revisions).toEqual([f.revision, f.git("rev-parse", "HEAD")]);
	expect(new Set(revisions).size).toBe(2);
	expect(run.history.filter((x) => x.step === "call/inspect")).toHaveLength(2);
	expect(run.checkpoint!.calls!.call!.visits.inspect).toBe(2);
	expect(Object.values(run.repositorySnapshots!)).toHaveLength(2);
});
