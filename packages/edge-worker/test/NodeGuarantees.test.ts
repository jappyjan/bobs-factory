import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { digest } from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	freshNodeOutput,
	observeNodeRevisions,
} from "../src/factory/NodeGuarantees.js";
import {
	type NodeContext,
	nodeRegistry,
	stepFields,
} from "../src/factory/nodes/index.js";
import {
	installNodeMetadata,
	paletteNodes,
} from "../src/factory/nodes/metadata.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import * as revisions from "../src/factory/RevisionBinding.js";
import { evaluateCondition } from "../src/factory/Rules.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { NodeStepSettings } from "../src/factory/web/node-step-settings.js";
import { newStep } from "../src/factory/web/recipe-graph.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const execute = vi.fn<(ctx: NodeContext) => unknown>();
nodeRegistry.register({
	type: "guarantees-fixture",
	schema: z.object({ ...stepFields, type: z.literal("guarantees-fixture") }),
	category: "logic",
	effect: "pure",
	builder: { label: "Fixture", icon: "◇", paletteGroup: "logic" },
	execute: (ctx) => execute(ctx),
});
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	execute.mockReset();
	vi.restoreAllMocks();
});
function runtime(
	home = mkdtempSync(join(tmpdir(), "node-guarantees-")),
	agent?: (ctx: ExecutionContext) => Promise<unknown>,
) {
	if (!homes.includes(home)) homes.push(home);
	const instance = new WorkflowRuntime(home, {
		agent: agent ?? (async () => ({})),
		tool: async () => ({}),
		script: async () => ({}),
	});
	runtimes.push(instance);
	return { instance, home };
}
function recipe(steps: unknown[]) {
	return validateWorkflows([
		...defaultWorkflows,
		{
			id: "guarantees",
			name: "Guarantees",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]).at(-1)!;
}
function start(
	instance: WorkflowRuntime,
	home: string,
	steps: unknown[],
	workspace = home,
) {
	const workflow = recipe(steps);
	return instance.create({
		title: "Guarantees",
		repositoryId: "fixture",
		workspace,
		input: "fixture",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
}
function fixture(id: string, fields: Record<string, unknown> = {}) {
	return { id, name: id, type: "guarantees-fixture", ...fields };
}
function context(run: FactoryRun, stepId = "consume"): ExecutionContext {
	return {
		run,
		step: StepSchema.parse(fixture(stepId)),
		stepKey: stepId,
		input: {},
		outputs: run.outputs,
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: run.workspace,
	};
}
function repository(home: string) {
	const workspace = join(home, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-qb", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	const commit = (value: string) => {
		writeFileSync(join(workspace, "value"), value);
		git("add", "value");
		git(
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"Fixture [skip ci]",
		);
	};
	commit("one");
	return { workspace, git, commit };
}

it("reuses unchanged inputs, misses changed inputs, and logs each reuse", async () => {
	let cycle = 0,
		computations = 0;
	execute.mockImplementation((ctx) => {
		if (ctx.step.id === "source") return { value: cycle < 2 ? 1 : 2 };
		if (ctx.step.id === "compute") {
			ctx.guarantee.state = { value: ctx.reads.value };
			computations++;
			return { value: ctx.reads.value };
		}
		return { again: ++cycle < 3 };
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		fixture("source"),
		fixture("compute", {
			reads: { value: "source/value" },
			reuse: "unchanged-inputs",
		}),
		fixture("cycle", {
			branches: [{ when: { path: "again", equals: true }, next: "source" }],
		}),
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(computations).toBe(2);
	expect(
		run.history
			.filter((entry) => entry.step === "compute")
			.map((entry) => entry.guarantee?.state),
	).toEqual([{ value: 1 }, { value: 1 }, { value: 2 }]);
	expect(
		run.history
			.filter((entry) => entry.step === "compute")
			.map((entry) => entry.output),
	).toEqual([{ value: 1 }, { value: 1 }, { value: 2 }]);
	expect(
		run.events.filter((event) => event.message === "reused (inputs unchanged)"),
	).toHaveLength(1);
});

it("keeps foreach reuse isolated by item and invalidates only the changed item", async () => {
	let cycle = 0;
	const computed: string[] = [];
	execute.mockImplementation((ctx) => {
		if (ctx.step.id === "source")
			return {
				items: [
					{ id: "a", value: cycle < 2 ? 1 : 2 },
					{ id: "b", value: 2 },
				],
			};
		if (ctx.step.id === "compute") {
			computed.push(`${ctx.iteration?.id}:${ctx.reads.value}`);
			return ctx.reads.value;
		}
		return { again: ++cycle < 3 };
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		fixture("source"),
		{
			id: "each",
			name: "Each",
			type: "foreach",
			reads: { items: "source/items" },
			items: { from: "/inputs/items" },
			body: [
				fixture("compute", {
					reads: { value: "@item/value" },
					reuse: "unchanged-inputs",
				}),
			],
		},
		fixture("cycle", {
			branches: [{ when: { path: "again", equals: true }, next: "source" }],
		}),
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(computed.sort()).toEqual(["a:1", "a:2", "b:2"]);
	expect(
		run.events.filter((event) => event.message === "reused (inputs unchanged)"),
	).toHaveLength(3);
});

it("keeps parallel reuse in its own branch frame", async () => {
	const executions: string[] = [];
	execute.mockImplementation((ctx) => {
		if (ctx.step.id === "compute") {
			executions.push(ctx.stepKey!);
			return ctx.stepKey;
		}
		return {
			again:
				ctx.run.history.filter((item) => item.step === ctx.stepKey).length ===
				0,
		};
	});
	const branch = () => [
		fixture("compute", { reuse: "unchanged-inputs" }),
		fixture("cycle", {
			branches: [{ when: { path: "again", equals: true }, next: "compute" }],
		}),
	];
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{
			id: "parallel",
			name: "Parallel",
			type: "fanout",
			groups: [branch(), branch()],
		},
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(executions.sort()).toEqual([
		"parallel/0/compute",
		"parallel/1/compute",
	]);
	expect(
		run.events.filter((event) => event.message === "reused (inputs unchanged)"),
	).toHaveLength(2);
});

it("invalidates fresh after input, dirty workspace and HEAD changes, including after restart", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	execute.mockImplementation(async (ctx) => {
		if (ctx.step.id === "source") return { value: 1 };
		ctx.recordRevisions(await observeNodeRevisions(ctx));
		return { value: ctx.reads.value };
	});
	const run = start(
		instance,
		home,
		[
			fixture("source"),
			fixture("inspect", { reads: { value: "source/value" } }),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(await freshNodeOutput(context(run), "inspect")).toBe(true);
	run.outputs.source = { value: 2 };
	expect(await freshNodeOutput(context(run), "inspect")).toBe(false);
	run.outputs.source = { value: 1 };
	writeFileSync(join(repo.workspace, "value"), "dirty");
	expect(await freshNodeOutput(context(run), "inspect")).toBe(false);
	writeFileSync(join(repo.workspace, "value"), "one");
	await instance.save(run);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	expect(await freshNodeOutput(context(loaded), "inspect")).toBe(true);
	repo.commit("two");
	expect(await freshNodeOutput(context(loaded), "inspect")).toBe(false);
	expect(await freshNodeOutput(context(loaded), "missing")).toBe(false);
	const aborted = {
		...context(loaded),
		signal: AbortSignal.abort(new Error("freshness cancelled")),
	};
	await expect(freshNodeOutput(aborted, "inspect")).rejects.toThrow(
		"freshness cancelled",
	);
});

it("invalidates reuse after a revision change reported by an IO node", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	let cycles = 0,
		executions = 0;
	execute.mockImplementation(async (ctx) => {
		if (ctx.step.id === "inspect") {
			executions++;
			ctx.recordRevisions({
				fixture: { headSha: repo.git("rev-parse", "HEAD") },
			});
			return executions;
		}
		if (++cycles === 2) repo.commit("two");
		return { again: cycles < 3 };
	});
	const run = start(
		instance,
		home,
		[
			fixture("inspect", { reuse: "unchanged-inputs" }),
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "inspect" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(executions).toBe(2);
	expect(
		run.history
			.filter((entry) => entry.step === "inspect")
			.map((entry) => entry.output),
	).toEqual([1, 1, 2]);
});

it("persists bound digests and transitively invalidates bound responses after restart", async () => {
	const { instance, home } = runtime();
	execute.mockImplementation((ctx) =>
		ctx.step.id === "source" ? { value: 1 } : { accepted: true },
	);
	const run = start(instance, home, [
		fixture("source"),
		fixture("response", { bind: ["source"] }),
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	const bound = run.history.at(-1)?.guarantee?.boundDigests;
	expect(Object.keys(bound!)).toEqual(["source"]);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	expect(loaded.history.at(-1)?.guarantee?.boundDigests).toEqual(bound);
	expect(await freshNodeOutput(context(loaded), "response")).toBe(true);
	loaded.outputs.source = { value: 2 };
	expect(await freshNodeOutput(context(loaded), "response")).toBe(false);
});

it("freezes bound digests before an interrupted response and does not rebind on restart", async () => {
	let fail = true;
	execute.mockImplementation((ctx) => {
		if (ctx.step.id === "source") return { value: 1 };
		if (fail) throw new Error("interrupted response");
		return { accepted: true };
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		fixture("source"),
		fixture("response", { bind: ["source"] }),
	]);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	const frozen = run.checkpoint?.active?.nodeStamp?.guarantee.boundDigests;
	run.outputs.source = { value: 2 };
	await instance.save(run);
	await instance.shutdown();
	fail = false;
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	await resumed.launch(loaded);
	expect(loaded.status).toBe("completed");
	expect(loaded.history.at(-1)?.guarantee?.boundDigests).toEqual(frozen);
	expect(await freshNodeOutput(context(loaded), "response")).toBe(false);
});

it("supports fresh rules in Check routes and agent output validation", async () => {
	execute.mockImplementation(() => ({ value: 1 }));
	const { instance, home } = runtime(undefined, async (ctx) =>
		parseStepOutputAsync(
			ctx.step,
			{ ok: true },
			undefined,
			ctx.signal,
			ctx.fresh,
		),
	);
	const run = start(instance, home, [
		fixture("source"),
		{
			id: "check",
			name: "Check",
			type: "check",
			check: { results: { current: { fresh: "source" } } },
			branches: [{ when: { path: "passed", equals: true }, next: "agent" }],
			next: "end",
		},
		{
			id: "agent",
			name: "Agent",
			type: "agent",
			prompt: "Read",
			rules: [
				{ message: "Output must be current", require: { fresh: "source" } },
			],
		},
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.outputs.check).toEqual({ passed: true, current: true });
	expect(run.outputs.agent).toEqual({ ok: true });
	expect(evaluateCondition({ fresh: "source" }, {})).toBe(false);
	await expect(
		parseStepOutputAsync(
			run.workflow.steps[2]!,
			{},
			undefined,
			undefined,
			async () => false,
		),
	).rejects.toThrow("Output must be current");
});

it("detects unchanged cycles, resets after change, and retains converge state over restart", async () => {
	let cycles = 0;
	execute.mockImplementation((ctx) =>
		ctx.step.id === "source"
			? { value: cycles < 3 ? 1 : 2 }
			: { again: ++cycles < 4 },
	);
	const { instance, home } = runtime();
	const run = start(instance, home, [
		fixture("source"),
		{
			id: "observe",
			name: "Observe",
			type: "converge",
			reads: { value: "source/value" },
			watch: ["/inputs/value"],
			maxCycles: 3,
		},
		fixture("cycle", {
			branches: [{ when: { path: "again", equals: true }, next: "source" }],
		}),
	]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(
		run.history
			.filter((entry) => entry.step === "observe")
			.map((entry) => entry.output),
	).toEqual([
		{ stalled: false, cycles: 1, changed: true },
		{ stalled: false, cycles: 2, changed: false },
		{ stalled: true, cycles: 3, changed: false },
		{ stalled: false, cycles: 1, changed: true },
	]);
	const saved = run.history.find((entry) => entry.step === "observe")?.guarantee
		?.state;
	await instance.shutdown();
	const loaded = runtime(home).instance.get(run.id);
	expect(
		loaded.history.find((entry) => entry.step === "observe")?.guarantee?.state,
	).toEqual(saved);
	expect(loaded.history.at(-2)?.guarantee?.state).toEqual({
		watchDigest: digest({ value0: 2 }),
	});
});

it("provides converge registry metadata, insertion and a JSON builder panel including bind", () => {
	installNodeMetadata(JSON.parse(JSON.stringify(nodeRegistry.metadata())));
	expect(paletteNodes().some((node) => node.type === "converge")).toBe(true);
	const step = {
		...newStep("converge", "observe"),
		bind: ["source"],
	};
	expect(StepSchema.parse(step)).toMatchObject({
		watch: ["/inputs/value"],
		maxCycles: 3,
		bind: ["source"],
	});
	expect(() => recipe([{ ...step, reuse: "unchanged-inputs" }])).toThrow(
		"cannot reuse",
	);
	const workflow = recipe([step]);
	const markup = renderToStaticMarkup(
		createElement(NodeStepSettings, {
			step,
			owner: workflow,
			recipes: [workflow],
			readOnly: false,
			selection: step.id,
			onSelect: () => {},
			onChange: () => {},
			onError: () => {},
		}),
	);
	expect(markup).toContain("Node configuration");
	expect(markup).toContain("watch");
	expect(markup).toContain("bind");
});

it("resolves bound Call aliases in the producer's frame after restart", async () => {
	execute.mockImplementation((ctx) =>
		ctx.step.id === "source" ? { value: 7 } : { value: ctx.reads.value },
	);
	const { instance, home } = runtime();
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "guarantees-parent",
			name: "Parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				fixture("source"),
				{
					id: "call",
					name: "Call",
					type: "workflow",
					workflow: "guarantees-child",
					bindings: { alias: "source" },
				},
			],
		},
		{
			id: "guarantees-child",
			name: "Child",
			inputs: ["alias"],
			stepConfigVersion: "step-config-v1",
			steps: [
				fixture("response", {
					reads: { value: "alias/value" },
					bind: ["alias"],
				}),
			],
		},
	]);
	instance.updateWorkflows(definitions);
	const workflow = definitions.find(
		(entry) => entry.id === "guarantees-parent",
	)!;
	const run = instance.create({
		title: "Call scope",
		repositoryId: "fixture",
		workspace: home,
		input: "fixture",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.outputs["call/response"]).toEqual({ value: 7 });
	await instance.shutdown();
	const loaded = runtime(home).instance.get(run.id);
	expect(await freshNodeOutput(context(loaded), "/call/response")).toBe(true);
	loaded.outputs.source = { value: 8 };
	expect(await freshNodeOutput(context(loaded), "/call/response")).toBe(false);
});

it("does not relabel inherited stale repository evidence with a consumer's current revision", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	let visits = 0;
	execute.mockImplementation((ctx) => {
		if (ctx.step.id === "source") {
			ctx.recordRevisions({
				fixture: { headSha: repo.git("rev-parse", "HEAD") },
			});
			return { value: 1 };
		}
		if (ctx.step.id === "change") {
			repo.commit("two");
			return {};
		}
		if (ctx.step.id === "consume") return { value: ctx.reads.value };
		return { again: ++visits < 2 };
	});
	const run = start(
		instance,
		home,
		[
			fixture("source"),
			fixture("change"),
			fixture("consume", { reads: { value: "source/value" } }),
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "consume" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(await freshNodeOutput(context(run, "last"), "consume")).toBe(false);
	const source = run.history[0]!.guarantee!.revisions;
	for (const receipt of run.history.filter((entry) => entry.step === "consume"))
		expect(receipt.guarantee?.revisions).toEqual(source);
});

it("stamps a mutating agent with its resulting revision while retaining its input digest", async () => {
	let repo: ReturnType<typeof repository>;
	const { instance, home } = runtime(undefined, async (ctx) => {
		expect(ctx.input).toMatchObject({ value: 1 });
		repo.commit("two");
		return { updated: true };
	});
	repo = repository(home);
	execute.mockImplementation((ctx) => {
		ctx.recordRevisions({
			fixture: { headSha: repo.git("rev-parse", "HEAD") },
		});
		return { value: 1 };
	});
	const run = start(
		instance,
		home,
		[
			fixture("source"),
			{
				id: "change",
				name: "Change",
				type: "agent",
				prompt: "Change value",
				reads: { value: "source/value" },
				access: { mode: "workspace" },
			},
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.history.at(-1)?.inputDigest).toBe(digest({ value: 1 }));
	expect(run.history.at(-1)?.guarantee?.revisions.fixture?.headSha).toBe(
		repo.git("rev-parse", "HEAD"),
	);
	expect(await freshNodeOutput(context(run), "source")).toBe(false);
	expect(await freshNodeOutput(context(run), "change")).toBe(true);
});

it("distinguishes a current null result from a missing output slot", async () => {
	execute.mockImplementation(() => null);
	const { instance, home } = runtime();
	const run = start(instance, home, [fixture("scalar")]);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(await freshNodeOutput(context(run), "scalar")).toBe(true);
	delete run.outputs.scalar;
	expect(await freshNodeOutput(context(run), "scalar")).toBe(false);
});

it.each([
	"parallel",
	"foreach",
])("reuses scoped agents in %s across unrelated commits, but reruns affected scopes", async (kind) => {
	let cycle = 0;
	const calls: string[] = [];
	const { instance, home } = runtime(undefined, async (ctx) => {
		calls.push(ctx.stepKey!);
		return { reviewed: true };
	});
	const repo = repository(home);
	mkdirSync(join(repo.workspace, "area"));
	writeFileSync(join(repo.workspace, "area", "file.ts"), "initial");
	repo.git("add", ".");
	repo.commit("initial");
	const freshness: boolean[] = [];
	execute.mockImplementation(async (ctx) => {
		if (ctx.step.id === "impact") {
			ctx.recordRevisions(await observeNodeRevisions(ctx));
			return { paths: ["area/**"], items: [{ id: "a" }, { id: "b" }] };
		}
		if (cycle === 0) repo.commit("outside scope");
		if (cycle === 1) {
			writeFileSync(join(repo.workspace, "area", "file.ts"), "changed");
			repo.git("add", ".");
			repo.commit("inside scope");
		}
		freshness.push(
			await ctx.fresh(
				kind === "parallel" ? "/group/0/review" : "/group/a/review",
			),
		);
		return { again: ++cycle < 3 };
	});
	const review = (dynamic: boolean) => ({
		id: "review",
		name: "Review",
		type: "agent",
		prompt: "Review area",
		reuse: "unchanged-inputs",
		reads: { paths: "impact/paths" },
		revisionScope: { paths: dynamic ? { from: "/inputs/paths" } : ["area/**"] },
	});
	const group =
		kind === "parallel"
			? {
					id: "group",
					name: "Parallel",
					type: "fanout",
					groups: [[review(false)], [review(true)]],
				}
			: {
					id: "group",
					name: "For each",
					type: "foreach",
					reads: { items: "impact/items" },
					items: { from: "/inputs/items" },
					body: [review(true)],
				};
	const run = start(
		instance,
		home,
		[
			fixture("impact"),
			group,
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "impact" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	const keys =
		kind === "parallel"
			? ["group/0/review", "group/1/review"]
			: ["group/a/review", "group/b/review"];
	expect(calls.sort()).toEqual([...keys, ...keys].sort());
	expect(freshness).toEqual([true, false, true]);
	expect(
		run.events.filter((event) => event.message === "reused (inputs unchanged)"),
	).toHaveLength(2);
	// Scoped content and the accepted paths survive restart, along with local HEAD provenance.
	await instance.shutdown();
	const loaded = runtime(home).instance.get(run.id);
	expect(await freshNodeOutput(context(loaded), `/${keys[0]}`)).toBe(true);
	writeFileSync(join(repo.workspace, "outside"), "untracked outside");
	expect(await freshNodeOutput(context(loaded), `/${keys[0]}`)).toBe(true);
	writeFileSync(join(repo.workspace, "area", "new.ts"), "untracked inside");
	expect(await freshNodeOutput(context(loaded), `/${keys[0]}`)).toBe(false);
	rmSync(join(repo.workspace, "area", "new.ts"));
	writeFileSync(join(repo.workspace, "area", "file.ts"), "dirty inside");
	expect(await freshNodeOutput(context(loaded), `/${keys[0]}`)).toBe(false);
});

it("resolves changing dynamic scopes from named reads and lets none rely on inputs only", async () => {
	let cycles = 0;
	const calls: string[] = [];
	const { instance, home } = runtime(undefined, async (ctx) => {
		calls.push(ctx.step.id);
		return { ok: true };
	});
	const repo = repository(home);
	execute.mockImplementation(async (ctx) => {
		if (ctx.step.id === "impact") {
			ctx.recordRevisions(await observeNodeRevisions(ctx));
			return { paths: cycles ? ["missing/**"] : ["value"] };
		}
		if (++cycles === 1) repo.commit("two");
		return { again: cycles < 2 };
	});
	const run = start(
		instance,
		home,
		[
			fixture("impact"),
			{
				id: "dynamic",
				name: "Dynamic",
				type: "agent",
				prompt: "Inspect",
				reuse: "unchanged-inputs",
				reads: { paths: "impact/paths" },
				revisionScope: { paths: { from: "/inputs/paths" } },
			},
			{
				id: "inputsOnly",
				name: "Inputs only",
				type: "agent",
				prompt: "Inspect",
				reuse: "unchanged-inputs",
				reads: { paths: "impact/paths" },
				revisionScope: "none",
			},
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "dynamic" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(calls).toEqual(["dynamic", "inputsOnly", "dynamic"]);
	expect(
		run.history.find((entry) => entry.step === "inputsOnly")?.guarantee
			?.revisions,
	).toEqual({});
	// The producer's reads are re-resolved for freshness, including its dynamic paths.
	run.outputs.impact = { paths: ["other"] };
	expect(await freshNodeOutput(context(run), "dynamic")).toBe(false);
	expect(await freshNodeOutput(context(run), "inputsOnly")).toBe(false);
});

it.each([
	"unborn HEAD",
	"failed observation",
])("fails closed without failing the agent on %s", async (failure) => {
	let calls = 0,
		cycles = 0;
	const { instance, home } = runtime(undefined, async () => {
		calls++;
		return { ok: true };
	});
	const repo = repository(home);
	if (failure === "unborn HEAD") repo.git("update-ref", "-d", "HEAD");
	else
		vi.spyOn(revisions, "captureRepositoryRevisions").mockRejectedValue(
			new Error("maxBuffer/timeout"),
		);
	execute.mockImplementation(() => ({ again: ++cycles < 2 }));
	const run = start(
		instance,
		home,
		[
			{
				id: "sample",
				name: "Sample",
				type: "agent",
				prompt: "Inspect",
				reuse: "unchanged-inputs",
			},
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "sample" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(calls).toBe(2);
	expect(run.history[0]?.guarantee?.revisions.fixture?.unobservable).toBe(true);
	expect(await freshNodeOutput(context(run), "sample")).toBe(false);
});

it("shares observations across preparation, reuse and multiple fresh references in one step attempt", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	const capture = vi.spyOn(revisions, "captureRepositoryRevisions");
	let cycles = 0;
	execute.mockImplementation(async (ctx) => {
		if (ctx.step.id === "bound") return {};
		if (cycles === 0) {
			capture.mockClear();
			expect(
				await Promise.all([ctx.fresh("sample"), ctx.fresh("bound")]),
			).toEqual([true, true]);
			expect(capture).toHaveBeenCalledTimes(1);
			capture.mockClear();
		}
		return { again: ++cycles < 2 };
	});
	const run = start(
		instance,
		home,
		[
			{
				id: "sample",
				name: "Sample",
				type: "agent",
				prompt: "Inspect",
				reuse: "unchanged-inputs",
			},
			fixture("bound", { bind: ["sample"] }),
			fixture("cycle", {
				branches: [{ when: { path: "again", equals: true }, next: "sample" }],
			}),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(capture).toHaveBeenCalledTimes(1); // prepare and fresh on reused sample
	expect(
		run.events.filter((event) => event.message === "reused (inputs unchanged)"),
	).toHaveLength(1);
});

it("rejects reuse for node-owned previous state and explicit self/history dependencies", () => {
	const schema = z.object({
		...stepFields,
		type: z.literal("previous-receipt-fixture"),
	});
	nodeRegistry.register({
		type: "previous-receipt-fixture",
		schema,
		usesPreviousReceipt: true,
		category: "logic",
		effect: "pure",
		builder: { label: "Previous", icon: "◇", paletteGroup: "logic" },
		execute: () => ({}),
	});
	expect(() =>
		recipe([
			{
				id: "previous",
				name: "Previous",
				type: "previous-receipt-fixture",
				reuse: "unchanged-inputs",
			},
		]),
	).toThrow("previous receipt");
	for (const fields of [
		{ reads: { previous: "self/value" } },
		{ reads: { history: "@history" } },
		{ bind: ["self"] },
	])
		expect(() =>
			recipe([fixture("self", { ...fields, reuse: "unchanged-inputs" })]),
		).toThrow("previous receipt");
});

it("retains every inherited revision scope when multiple reviewers cover the same repository", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	execute.mockImplementation(() => ({}));
	const run = start(
		instance,
		home,
		[
			{
				id: "first",
				name: "First",
				type: "agent",
				prompt: "Inspect",
				revisionScope: { paths: ["value"] },
			},
			{
				id: "second",
				name: "Second",
				type: "agent",
				prompt: "Inspect",
				revisionScope: { paths: ["other"] },
			},
			fixture("combine", { reads: { first: "first", second: "second" } }),
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(await freshNodeOutput(context(run), "combine")).toBe(true);
	repo.commit("two");
	expect(await freshNodeOutput(context(run), "second")).toBe(true);
	expect(await freshNodeOutput(context(run), "combine")).toBe(false);
});

it("compares a scoped Snapshot reader with the local checkout, including dirty changes", async () => {
	const { instance, home } = runtime();
	const repo = repository(home);
	const run = start(
		instance,
		home,
		[
			{ id: "snapshot", name: "Snapshot", type: "snapshot" },
			{
				id: "sample",
				name: "Sample",
				type: "agent",
				prompt: "Inspect",
				access: { mode: "read-only" },
				reads: { snapshot: "snapshot" },
				revisionScope: { paths: ["value"] },
			},
		],
		repo.workspace,
	);
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(await freshNodeOutput(context(run), "sample")).toBe(true);
	writeFileSync(join(repo.workspace, "outside"), "outside");
	repo.git("add", "outside");
	repo.git(
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-qm",
		"Outside [skip ci]",
	);
	expect(await freshNodeOutput(context(run), "sample")).toBe(true);
	writeFileSync(join(repo.workspace, "value"), "dirty");
	expect(await freshNodeOutput(context(run), "sample")).toBe(false);
});
