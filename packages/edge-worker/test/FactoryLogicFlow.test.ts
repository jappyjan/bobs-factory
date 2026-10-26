/* biome-ignore-all lint/suspicious/noThenProperty: Declarative JSON branches, never callable Promise.then properties. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { nodeRegistry, stepFields } from "../src/factory/nodes/index.js";
import { nodeEffect, paletteNodes } from "../src/factory/nodes/metadata.js";
import type { NodeContext } from "../src/factory/nodes/NodeDefinition.js";
import { transformOutput } from "../src/factory/nodes/transform.js";
import {
	evaluateTransformAsync,
	TransformSchema,
} from "../src/factory/Rules.js";
import {
	materializeWorkflowConfig,
	resolveStepConfig,
} from "../src/factory/StepConfig.js";
import { StepSchema, WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { NodeStepSettings } from "../src/factory/web/node-step-settings.js";
import { newStep, type Recipe } from "../src/factory/web/recipe-graph.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const evidence = vi.fn(async () => {
	throw new Error("Pure checks must not execute evidence");
});
function runtime(home = mkdtempSync(join(tmpdir(), "factory-logic-"))) {
	if (!homes.includes(home)) homes.push(home);
	const instance = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
		evidence,
	});
	runtimes.push(instance);
	return { instance, home };
}
function recipe(steps: unknown[], modern = true) {
	return WorkflowSchema.parse({
		id: "logic",
		name: "Logic",
		stepConfigVersion: "step-config-v1",
		...(modern ? { engineVersion: "nodes-v1" } : {}),
		steps,
	});
}
function start(
	instance: WorkflowRuntime,
	home: string,
	steps: unknown[],
	convergence?: { maxUnchangedAttempts: number; continueAttempts: number },
) {
	const workflow = WorkflowSchema.parse({ ...recipe(steps), convergence });
	return instance.create({
		title: "Logic fixture",
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
}
let id = 0;
function readNode(
	execute: (ctx: NodeContext) => unknown,
	effect: "read-only" | "effect" = "read-only",
) {
	const type = `fixture-poll-${++id}`;
	const schema = z.object({ ...stepFields, type: z.literal(type) });
	nodeRegistry.register({
		type,
		schema,
		category: "io",
		effect,
		builder: { label: "Poll", icon: "◇", paletteGroup: "io" },
		execute,
	});
	return { id: "poll", name: "Poll", type, reads: {} };
}
function waitStep(body: unknown, extra: object = {}) {
	return {
		id: "wait",
		name: "Wait",
		type: "wait",
		body,
		interval: 5,
		timeout: 10000,
		until: { path: "/output/ready", equals: true },
		...extra,
	};
}

it.each([
	"^/value",
	"^^/value",
	"@key",
	"@index",
	"^@key",
	"^@index",
])("rejects map-only pointer %s in ordinary rules and top-level transforms", (path) => {
	const conditions = [
		{ path, exists: true },
		{ all: [{ compare: { left: { length: path }, op: "gte", right: 0 } }] },
		{ each: "/items", require: { path: "/id", equalsPath: path } },
	];
	for (const condition of conditions) {
		expect(() =>
			recipe([
				{
					id: "check",
					name: "Check",
					type: "check",
					check: { results: { valid: condition } },
				},
			]),
		).toThrow();
		expect(() =>
			recipe([
				{
					id: "agent",
					name: "Agent",
					type: "agent",
					prompt: "Validate",
					rules: [{ message: "Must be valid", require: condition }],
				},
			]),
		).toThrow();
		expect(TransformSchema.safeParse({ valid: condition }).success).toBe(false);
		expect(
			TransformSchema.safeParse({
				rows: {
					map: "/inputs/items",
					template: { valid: condition },
				},
			}).success,
		).toBe(true);
	}
	for (const expression of [
		{ select: path },
		{ aggregate: "count", path: "/items", where: { path, exists: true } },
		{ find: { collection: "/items", key: "/id", value: path } },
	]) {
		expect(() =>
			recipe([
				{
					id: "check",
					name: "Check",
					type: "check",
					check: {
						results: { selected: expression },
						passed: { path: "/selected", exists: true },
					},
				},
			]),
		).toThrow();
		expect(TransformSchema.safeParse({ value: expression }).success).toBe(
			false,
		);
		expect(
			TransformSchema.safeParse({
				rows: {
					map: "/inputs/items",
					template: { value: expression },
				},
			}).success,
		).toBe(true);
	}
	expect(
		TransformSchema.safeParse({ rows: { map: path, template: {} } }).success,
	).toBe(false);
});

it("retains ordinary root pointers and inert map syntax in literal data", () => {
	expect(() =>
		recipe([
			{
				id: "agent",
				name: "Agent",
				type: "agent",
				prompt: "Validate",
				rules: [
					{ message: "Required", require: { path: "$/value", exists: true } },
				],
			},
		]),
	).not.toThrow();
	expect(
		TransformSchema.safeParse({
			value: {
				literal: {
					path: "^/value",
					key: "@key",
					index: "@index",
				},
			},
		}).success,
	).toBe(true);
});

it("maps filtered items with root reads, aggregates and literals, retaining input ownership", async () => {
	const template = TransformSchema.parse({
		rows: {
			map: "/inputs/items",
			where: { path: "/enabled", equals: true },
			template: {
				id: { select: "/id" },
				tag: { select: "$/inputs/tag" },
				accepted: { path: "/score", min: 2 },
				nested: { map: "/values", template: { value: { select: "" } } },
				global: {
					map: "$/inputs/shared",
					template: { parent: { select: "^/id" }, value: { select: "" } },
				},
			},
		},
		count: {
			aggregate: "count",
			path: "/inputs/items",
			where: { path: "/enabled", equals: true },
		},
		filtered: {
			aggregate: "filter",
			path: "/inputs/items",
			where: { path: "/score", min: 2 },
		},
		all: {
			aggregate: "all",
			path: "/inputs/items",
			require: { path: "/enabled", equals: true },
		},
		label: "hello",
		countLiteral: 3,
		metadata: { literal: { select: "is data", values: [1, 2] } },
	});
	const inputs = {
		tag: "batch",
		shared: ["common"],
		items: [
			{ id: "a", enabled: true, score: 3, values: [1, 2] },
			{ id: "b", enabled: false, score: 0, values: [] },
		],
	};
	const output = await evaluateTransformAsync(template, inputs);
	expect(output).toEqual({
		rows: [
			{
				id: "a",
				tag: "batch",
				accepted: true,
				nested: [{ value: 1 }, { value: 2 }],
				global: [{ parent: "a", value: "common" }],
			},
		],
		count: 1,
		filtered: [inputs.items[0]],
		all: false,
		label: "hello",
		countLiteral: 3,
		metadata: { select: "is data", values: [1, 2] },
	});
	(output.filtered as { id: string }[])[0]!.id = "changed";
	expect(inputs.items[0]!.id).toBe("a");
});

it("validates optional transform output schemas and rejects invalid collections and cancellation", async () => {
	const output = {
		schema: {
			type: "object",
			properties: { n: { type: "number" } },
			required: ["n"],
			additionalProperties: false,
		},
	};
	expect(await transformOutput({ n: 3 }, {}, output)).toEqual({ n: 3 });
	await expect(transformOutput({ n: "wrong" }, {}, output)).rejects.toThrow(
		"Transform output",
	);
	await expect(
		evaluateTransformAsync(
			{ values: { map: "/inputs/missing", template: {} } },
			{},
		),
	).rejects.toThrow(/missing|must select an array/);
	await expect(
		evaluateTransformAsync({ n: 1 }, {}, AbortSignal.abort()),
	).rejects.toThrow();
	expect(
		TransformSchema.safeParse({ n: { eval: "process.exit()" } }).success,
	).toBe(false);
});

it("bounds expansion across all map fields, rejects accessors and reserved output fields", async () => {
	const getter = vi.fn(() => 1);
	const unsafe = Object.defineProperty({}, "x", {
		enumerable: true,
		get: getter,
	});
	expect(TransformSchema.safeParse(unsafe).success).toBe(false);
	expect(getter).not.toHaveBeenCalled();
	expect(
		TransformSchema.safeParse(JSON.parse('{"constructor":1}')).success,
	).toBe(false);
	expect(TransformSchema.safeParse(JSON.parse('{"__proto__":1}')).success).toBe(
		false,
	);
	expect(
		TransformSchema.safeParse(
			JSON.parse('{"rows":{"map":"/inputs/items","template":{"__proto__":1}}}'),
		).success,
	).toBe(false);
	const literal = JSON.parse('{"__proto__":{"value":1}}');
	expect(
		await evaluateTransformAsync(
			TransformSchema.parse({ data: { literal } }),
			{},
		),
	).toEqual({ data: literal });
	const template = {
		rows: {
			map: "/inputs/items",
			template: { data: { literal: "x".repeat(1000) } },
		},
	};
	await expect(
		evaluateTransformAsync(TransformSchema.parse(template), {
			items: Array(1000).fill(1),
		}),
	).rejects.toThrow(/limit/);
});

it("rejects checks on nodes-v1 checks recursively but retains legacy checks and editable projections", () => {
	const check = {
		id: "check",
		name: "Check",
		type: "check",
		checks: [],
		check: { results: { ok: { path: "/inputs/value", equals: 42 } } },
	};
	expect(() => recipe([check])).toThrow("legacy-only");
	expect(() =>
		recipe([{ id: "f", name: "F", type: "fanout", groups: [[check]] }]),
	).toThrow("legacy-only");
	expect(recipe([check], false).steps[0]!.checks).toEqual([]);
	const workflow = recipe([{ ...check, checks: undefined }]);
	expect(() =>
		WorkflowSchema.parse(materializeWorkflowConfig(workflow)),
	).not.toThrow();
});

it("executes a pure check with reads and preserves passed/branch semantics", async () => {
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ id: "seed", name: "Seed", type: "transform", transform: { value: 42 } },
		{
			id: "check",
			name: "Check",
			type: "check",
			reads: { seed: "seed" },
			check: { results: { ok: { path: "/inputs/seed/value", equals: 42 } } },
			branches: [{ when: { path: "passed", equals: true }, next: "end" }],
		},
		{ id: "unused", name: "Unused", type: "script", script: "unused" },
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.check).toEqual({ passed: true, ok: true });
	expect(run.outputs.unused).toBeUndefined();
	expect(evidence).not.toHaveBeenCalled();
});

it("wait succeeds through the registry with one history entry and one progress line", async () => {
	let polls = 0;
	const body = readNode(() => ({ ready: ++polls === 3, result: 42 }));
	const { instance, home } = runtime();
	const run = start(instance, home, [waitStep(body)]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.wait).toEqual({
		ready: true,
		result: 42,
		timedOut: false,
		polls: 3,
	});
	expect(run.history.map((entry) => entry.step)).toEqual(["wait"]);
	expect(
		run.events.filter(
			(entry) => entry.message === "Waiting for the configured condition",
		),
	).toHaveLength(1);
	expect(
		Object.values(run.capacityLeaves ?? {}).some((leaf) => leaf.request),
	).toBe(false);
});

it("wait times out retaining last output without reserving execution capacity", async () => {
	const body = readNode(() => ({ ready: false, value: 7 }));
	const { instance, home } = runtime();
	const run = start(instance, home, [
		waitStep(body, { interval: 10000, timeout: 1500 }),
	]);
	const pending = instance.launch(run);
	await vi.waitFor(() => {
		expect(run.capacityLeaves?.wait).toEqual({ phase: "waiting-ci" });
		expect(run.checkpoint?.active?.wait?.output).toEqual({
			ready: false,
			value: 7,
		});
	});
	expect(run.capacityLeaves?.wait?.request).toBeUndefined();
	await pending;
	expect(run.outputs.wait).toEqual({
		ready: false,
		value: 7,
		timedOut: true,
		polls: 1,
	});
	expect(run.history).toHaveLength(1);
});

it.each([
	false,
	true,
])("wait retains deadline, polls and last output over a cold restart (expires=%s)", async (expires) => {
	let ready = false;
	const body = readNode(() => ({ ready, value: 7 }));
	const { instance, home } = runtime();
	const run = start(instance, home, [
		waitStep(body, { interval: 10000, timeout: 60000 }),
	]);
	const pending = instance.launch(run);
	await vi.waitFor(() => {
		expect(run.capacityLeaves?.wait).toEqual({ phase: "waiting-ci" });
		expect(run.checkpoint?.active?.wait?.output).toEqual({
			ready: false,
			value: 7,
		});
	});
	const deadline = run.checkpoint!.active!.wait!.deadline;
	await instance.shutdown();
	await pending;
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	expect(loaded.checkpoint!.active!.wait).toMatchObject({
		deadline,
		polls: 1,
		output: { ready: false, value: 7 },
	});
	ready = true;
	if (expires) loaded.checkpoint!.active!.wait!.deadline = Date.now() - 1;
	else loaded.checkpoint!.active!.wait!.nextPollAt = Date.now();
	await resumed.launch(loaded);
	expect(loaded.status).toBe("completed");
	expect(loaded.outputs.wait).toEqual({
		ready: !expires,
		value: 7,
		timedOut: expires,
		polls: expires ? 1 : 2,
	});
	expect(loaded.history).toHaveLength(1);
});

it("rejects non-read-only wait bodies including nested flow/agent nodes", () => {
	const body = readNode(() => ({}), "effect");
	expect(() => StepSchema.parse(waitStep(body))).toThrow("read-only IO");
	expect(() =>
		StepSchema.parse(
			waitStep({ id: "a", name: "A", type: "agent", prompt: "hello" }),
		),
	).toThrow("read-only IO");
	expect(() => StepSchema.parse(waitStep([body, body]))).toThrow();
});

it("exhausts retries then routes error to the handler's explicit @error read", async () => {
	const fail = vi.fn(() => {
		throw new TypeError("provider unavailable");
	});
	const body = readNode(fail);
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{
			...body,
			id: "operation",
			retry: { max: 2, backoff: 5 },
			onError: "handle",
		},
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			reads: { error: "@error" },
			transform: { error: { select: "/inputs/error" } },
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(fail).toHaveBeenCalledTimes(3);
	expect(run.outputs.handle).toEqual({
		error: { message: "provider unavailable", kind: "TypeError" },
	});
	expect(run.history.map((entry) => entry.step)).toEqual(["handle"]);
});

it("retries inline tool nodes and leaves unhandled failure behavior unchanged", async () => {
	const { instance, home } = runtime();
	const tool = vi
		.fn()
		.mockRejectedValueOnce(new Error("transient"))
		.mockResolvedValue({ ready: true });
	instance.hooks.tool = tool;
	const run = start(instance, home, [
		{
			id: "op",
			name: "Op",
			type: "tool",
			tool: "fixture",
			retry: { max: 1, backoff: 0 },
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(tool).toHaveBeenCalledTimes(2);
	expect(run.history).toHaveLength(1);
	const fail = start(instance, home, [
		readNode(() => {
			throw new Error("unhandled");
		}),
	]);
	await instance.launch(fail);
	expect(fail.status).toBe("failed");
	expect(fail.error).toContain("unhandled");
});

it("retains retry budget and backoff over restart; cancellation does not route an error", async () => {
	const fail = vi.fn(() => {
		throw new Error("temporary");
	});
	const body = readNode(fail);
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ ...body, retry: { max: 1, backoff: 60000 }, onError: "handle" },
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			transform: { handled: true },
		},
	]);
	const pending = instance.launch(run);
	await vi.waitFor(() =>
		expect(run.checkpoint?.active?.retryAt).toBeGreaterThan(Date.now()),
	);
	await instance.shutdown();
	await pending;
	expect(run.outputs.handle).toBeUndefined();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	expect(loaded.checkpoint?.active?.retries).toBe(1);
	loaded.checkpoint!.active!.retryAt = Date.now();
	await resumed.launch(loaded);
	expect(loaded.status).toBe("completed");
	expect(fail).toHaveBeenCalledTimes(2);
	expect(loaded.outputs.handle).toEqual({ handled: true });
});

it("registers transform/wait palette entries and settings panels with error controls", () => {
	const body = readNode(() => ({}));
	for (const type of ["transform", "wait"]) {
		expect(paletteNodes().some((node) => node.type === type)).toBe(true);
		const step =
			type === "wait" ? StepSchema.parse(waitStep(body)) : newStep(type, type);
		const owner = recipe([step]) as Recipe;
		expect(() =>
			WorkflowSchema.parse(materializeWorkflowConfig(owner)),
		).not.toThrow();
		const html = renderToStaticMarkup(
			createElement(NodeStepSettings, {
				step,
				owner,
				recipes: [owner],
				readOnly: false,
				selection: step.id,
				onSelect() {},
				onChange() {},
				onError() {},
			}),
		);
		expect(html).toContain(
			type === "wait" ? "Read-only body node" : "Transform template",
		);
		expect(html).toContain("Retry failures");
		expect(html).toContain("Error route");
	}
});

it("simulates transform with production evaluation and recipe route matching through HTTP", async () => {
	const { instance } = runtime();
	const server = new FactoryServer(instance, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => instance.stop(id),
	});
	try {
		const step = {
			id: "t",
			name: "T",
			type: "transform",
			transform: { count: { aggregate: "count", path: "/inputs/items" } },
			branches: [{ when: { path: "count", equals: 2 }, next: "match" }],
		};
		const response = await server.app.inject({
			method: "POST",
			url: "/api/workflows/transform/simulate",
			headers: { "x-factory-request": "1" },
			payload: { step, inputs: { items: [1, 2] } },
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ output: { count: 2 }, next: "match" });
	} finally {
		await server.stop();
	}
});

it("uses nodes-v1 independently of old configuration markers and validates local error targets", () => {
	const workflow = WorkflowSchema.parse({
		id: "modern",
		name: "Modern",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "implement",
				name: "Implement",
				type: "agent",
				prompt: "Return data",
			},
		],
	});
	expect(resolveStepConfig(workflow.steps[0]!).checks).toEqual([]);
	expect(resolveStepConfig(workflow.steps[0]!).explicit).toBe(true);
	expect(() =>
		recipe([
			{
				id: "t",
				name: "T",
				type: "transform",
				transform: {},
				onError: "missing",
			},
		]),
	).toThrow("same graph");
});

it("returns at the wait deadline even when a read-only provider ignores cancellation", async () => {
	const execute = vi.fn(() => new Promise(() => {}));
	const { instance, home } = runtime();
	const run = start(instance, home, [
		waitStep(readNode(execute), { timeout: 1500 }),
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(run.outputs.wait).toEqual({ output: null, timedOut: true, polls: 1 });
});

it("resolves per-operation and per-access IO effects with schema defaults before accepting a Wait body", async () => {
	const type = `fixture-effects-${++id}`;
	const schema = z.object({
		...stepFields,
		type: z.literal(type),
		op: z.enum(["read", "write", "other"]).default("read"),
	});
	nodeRegistry.register({
		type,
		schema,
		category: "io",
		effect: "effect",
		operationEffects: { read: "pure", write: "effect" },
		builder: { label: "Operations", icon: "◇", paletteGroup: "io" },
		execute: () => ({ ready: true }),
	});
	const base = { id: "poll", name: "Poll", type };
	expect(nodeEffect({ type, op: "constructor" })).toBe("effect");
	expect(nodeEffect({ type, op: "toString" })).toBe("effect");
	const step = StepSchema.parse(waitStep(base));
	expect(nodeRegistry.effectFor(step.body![0]!)).toBe("pure");
	expect(() => StepSchema.parse(waitStep({ ...base, op: "write" }))).toThrow(
		"read-only IO",
	);
	expect(() => StepSchema.parse(waitStep({ ...base, op: "other" }))).toThrow(
		"read-only IO",
	);
	const accessType = `fixture-access-${++id}`;
	const accessSchema = z.object({
		...stepFields,
		type: z.literal(accessType),
		access: z.enum(["read-only", "workspace"]).default("read-only"),
	});
	nodeRegistry.register({
		type: accessType,
		schema: accessSchema,
		category: "io",
		effect: "effect",
		accessEffects: { "read-only": "read-only", workspace: "effect" },
		builder: { label: "Access", icon: "◇", paletteGroup: "io" },
		execute: () => ({ ready: true }),
	});
	expect(() =>
		StepSchema.parse(waitStep({ ...base, type: accessType })),
	).not.toThrow();
	expect(() =>
		StepSchema.parse(
			waitStep({ ...base, type: accessType, access: "workspace" }),
		),
	).toThrow("read-only IO");
	const metadata = JSON.parse(JSON.stringify(nodeRegistry.metadata()));
	expect(
		metadata.find((node: { type: string }) => node.type === type)
			.operationEffects,
	).toEqual({ read: "pure", write: "effect" });
	expect(
		metadata.find((node: { type: string }) => node.type === accessType)
			.accessEffects,
	).toEqual({ "read-only": "read-only", workspace: "effect" });
	const { instance, home } = runtime();
	const run = start(instance, home, [waitStep(base)]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.wait).toEqual({ ready: true, timedOut: false, polls: 1 });
});

it("transforms realistic reviewer bodies and large passthrough collections within its independent budget", async () => {
	const reviewers = Array.from({ length: 8 }, (_, reviewer) => ({
		name: `Reviewer ${reviewer}`,
		findings: Array.from({ length: 60 }, (_, index) => ({
			id: `${reviewer}-${index}`,
			body: "x".repeat(1200),
		})),
	}));
	const template = TransformSchema.parse({
		rows: {
			map: "/inputs/reviewers/*/findings/*",
			template: {
				id: { select: "/id" },
				body: { select: "/body" },
				reviewer: { select: "^/name" },
			},
		},
	});
	const output = await evaluateTransformAsync(template, { reviewers });
	const rows = output.rows as { id: string; body: string; reviewer: string }[];
	expect(rows).toHaveLength(480);
	expect(rows.at(-1)).toEqual({
		id: "7-59",
		body: "x".repeat(1200),
		reviewer: "Reviewer 7",
	});
	for (const [count, length] of [
		[300, 200],
		[2000, 10],
		[1000, 200],
	]) {
		const items = Array.from({ length: count! }, () => "x".repeat(length!));
		expect(
			await evaluateTransformAsync(
				{ items: { select: "/inputs/items" } },
				{ items },
			),
		).toEqual({ items });
	}
});

it("flattens keyed reviewer findings, concatenates optional sources, deduplicates and joins prior dispositions", async () => {
	const inputs = {
		reviewers: {
			alice: {
				name: "Alice",
				findings: [
					{ id: "a", rating: 3, status: "open" },
					{ id: "b", rating: 1, status: "open" },
				],
			},
			failed: { name: "Failed" },
			bob: {
				name: "Bob",
				findings: [
					{ id: "a", rating: 4, status: "open" },
					{ id: "c", rating: 2, status: "closed" },
				],
			},
		},
		extra: [{ id: "d", rating: 2, status: "open" }],
		prior: [{ id: "a", disposition: "confirmed" }],
	};
	const flattened = await evaluateTransformAsync(
		TransformSchema.parse({
			findings: {
				map: [
					"/inputs/reviewers/*/findings/*",
					"/inputs/absent",
					"/inputs/extra",
				],
				missingAsEmpty: true,
				distinctBy: "/id",
				where: {
					all: [
						{ path: "/rating", min: 2 },
						{ path: "/status", equals: "open" },
					],
				},
				template: {
					id: { select: "/id" },
					reviewer: { select: "^/name" },
					reviewerKey: { select: "^@key" },
					key: { select: "@key" },
					index: { select: "@index" },
					prior: {
						find: { collection: "$/inputs/prior", key: "/id", value: "/id" },
					},
				},
			},
		}),
		inputs,
	);
	expect(flattened).toEqual({
		findings: [
			{
				id: "a",
				reviewer: "Alice",
				reviewerKey: "alice",
				key: "0",
				index: 0,
				prior: inputs.prior[0],
			},
			{
				id: "d",
				reviewer: null,
				reviewerKey: null,
				key: "0",
				index: 0,
				prior: null,
			},
		],
	});
	(flattened.findings as { prior: { id: string } }[])[0]!.prior.id = "changed";
	expect(inputs.prior[0]!.id).toBe("a");
	expect(
		await evaluateTransformAsync(
			{
				rows: {
					map: "/inputs/reviewers",
					template: {
						key: { select: "@key" },
						index: { select: "@index" },
						findings: {
							map: "/findings",
							missingAsEmpty: true,
							template: {
								reviewer: { select: "^/name" },
								key: { select: "^@key" },
							},
						},
					},
				},
			},
			inputs,
		),
	).toEqual({
		rows: [
			{
				key: "alice",
				index: 0,
				findings: [
					{ reviewer: "Alice", key: "alice" },
					{ reviewer: "Alice", key: "alice" },
				],
			},
			{ key: "failed", index: 1, findings: [] },
			{
				key: "bob",
				index: 2,
				findings: [
					{ reviewer: "Bob", key: "bob" },
					{ reviewer: "Bob", key: "bob" },
				],
			},
		],
	});
	await expect(
		evaluateTransformAsync(
			{ rows: { map: "/inputs/reviewers/*/findings/*", template: {} } },
			inputs,
		),
	).rejects.toThrow(/missing/);
	await expect(
		evaluateTransformAsync(
			{ rows: { map: "/inputs/value", missingAsEmpty: true, template: {} } },
			{ value: 3 },
		),
	).rejects.toThrow(/array or object/);
});

it("cancels an in-flight realistic transform between work slices", async () => {
	const controller = new AbortController();
	const pending = evaluateTransformAsync(
		{ items: { select: "/inputs/items" } },
		{ items: Array(2000).fill("x".repeat(200)) },
		controller.signal,
	);
	setImmediate(() => controller.abort(new Error("cancel transform")));
	await expect(pending).rejects.toThrow("cancel transform");
});

it("treats transient body errors as failed polls and persists an optional error cap", async () => {
	let polls = 0;
	const body = readNode(() => {
		if (++polls < 3) throw new Error("temporary read failure");
		return { ready: true };
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [waitStep(body)]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.wait).toEqual({ ready: true, timedOut: false, polls: 3 });
	expect(
		run.events.filter((event) =>
			/Poll .* failed: temporary read failure/.test(event.message),
		),
	).toHaveLength(2);
	const failing = readNode(() => {
		throw new Error("always down");
	});
	const capped = start(instance, home, [waitStep(failing, { maxErrors: 2 })]);
	await instance.launch(capped);
	expect(capped.status).toBe("failed");
	expect(capped.checkpoint?.active?.wait).toMatchObject({
		polls: 2,
		errors: 2,
	});
});

it("clears routed @error after the handler succeeds", async () => {
	const fail = readNode(() => {
		throw new Error("handled");
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ ...fail, onError: "handle" },
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			reads: { error: "@error" },
			transform: { error: { select: "/inputs/error" } },
		},
		{ ...readNode((ctx) => ({ error: ctx.error ?? null })), id: "after" },
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.handle).toEqual({
		error: { message: "handled", kind: "Error" },
	});
	expect(run.outputs.after).toEqual({ error: null });
	expect(run.checkpoint?.error).toBeUndefined();
});

it("does not route an uncertain effect back into a fresh sending visit", async () => {
	const send = vi.fn(async () => {
		throw new Error("response lost after creation");
	});
	const effect = readNode(
		(ctx) => ctx.effect("create", { title: "accepted" }, send),
		"effect",
	);
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ ...effect, id: "send", retry: { max: 2, backoff: 0 }, onError: "handle" },
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			transform: { handled: true },
			next: "send",
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain("requires reconciliation");
	expect(run.outputs.handle).toBeUndefined();
	expect(run.checkpoint?.active?.actionId).toBeTruthy();
	expect(Object.values(run.nodeEffects!)).toHaveLength(1);
	expect(Object.values(run.nodeEffects!)[0]!.phase).toBe("uncertain");
	expect(send).toHaveBeenCalledTimes(1);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	await resumed.launch(loaded);
	expect(loaded.status).toBe("failed");
	expect(loaded.outputs.handle).toBeUndefined();
	expect(send).toHaveBeenCalledTimes(1);
});

it("counts retried registry preflight failures once against convergence", async () => {
	let executions = 0;
	const body = readNode(() => {
		if (++executions < 3) throw new Error("transient");
		return { ready: true };
	});
	const { instance, home } = runtime();
	const run = start(
		instance,
		home,
		[{ ...body, retry: { max: 2, backoff: 0 } }],
		{ maxUnchangedAttempts: 2, continueAttempts: 1 },
	);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(executions).toBe(3);
	expect(
		Object.values(run.progressBudget!.observations).map(
			(observation) => observation.attempts,
		),
	).toEqual([1]);
	expect(run.progressBudget!.recent.map((entry) => entry.reason)).toEqual([
		"preflight-failure",
	]);
});

it.each([
	false,
	true,
])("does not retry or route unavailable workflows from requireRunAvailable (wait=%s)", async (polling) => {
	const { instance, home } = runtime();
	const disabled = WorkflowSchema.parse({
		...recipe([
			{ id: "unused", name: "Unused", type: "transform", transform: {} },
		]),
		id: "disabled",
	});
	instance.updateWorkflows([...instance.listWorkflows(), disabled]);
	instance.setWorkflowEnabled(disabled.id, false);
	const execute = vi.fn((ctx: NodeContext) =>
		instance.requireRunAvailable({ ...ctx.run, workflow: disabled }),
	);
	const body = readNode(execute);
	const run = start(instance, home, [
		{
			...(polling ? waitStep(body) : body),
			retry: { max: 2, backoff: 0 },
			onError: "handle",
		},
		{
			id: "handle",
			name: "Handle",
			type: "transform",
			transform: { handled: true },
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain("unavailable");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(run.outputs.handle).toBeUndefined();
});

it("applies prior disposition fields with a shallow merge before filtering actionable findings", async () => {
	const joined = await evaluateTransformAsync(
		TransformSchema.parse({
			rows: {
				map: "/inputs/findings",
				template: {
					finding: {
						merge: [
							{ select: "" },
							{
								find: {
									collection: "$/inputs/dispositions",
									key: "/id",
									value: "/id",
								},
							},
						],
					},
				},
			},
		}),
		{
			findings: [
				{ id: "a", body: "kept", rating: 3, status: "open" },
				{ id: "b", body: "fixed", rating: 2, status: "open" },
			],
			dispositions: [
				{ id: "b", status: "resolved", reason: "fixed in current revision" },
			],
		},
	);
	expect(joined).toEqual({
		rows: [
			{ finding: { id: "a", body: "kept", rating: 3, status: "open" } },
			{
				finding: {
					id: "b",
					body: "fixed",
					rating: 2,
					status: "resolved",
					reason: "fixed in current revision",
				},
			},
		],
	});
	const actionable = await evaluateTransformAsync(
		{
			rows: {
				map: "/inputs/rows",
				where: {
					all: [
						{ path: "/finding/rating", min: 2 },
						{ path: "/finding/status", equals: "open" },
					],
				},
				template: { id: { select: "/finding/id" } },
			},
		},
		joined,
	);
	expect(actionable).toEqual({ rows: [{ id: "a" }] });
	await expect(
		evaluateTransformAsync({ bad: { merge: [3] } }, {}),
	).rejects.toThrow("merge accepts objects");
	const reserved = JSON.parse('{"__proto__":{"safe":true}}');
	expect(
		await evaluateTransformAsync(
			{ data: { merge: [{ literal: reserved }] } },
			{},
		),
	).toEqual({ data: reserved });
});

it("evaluates only the chosen conditional transform branch and retains map/root scopes", async () => {
	const template = TransformSchema.parse({
		rows: {
			map: "/inputs/items",
			template: {
				result: {
					if: { path: "/enabled", equals: true },
					then: {
						if: { path: "$/inputs/available", equals: true },
						then: { select: "/value" },
						else: "unavailable",
					},
					else: { literal: { skipped: true } },
				},
			},
		},
		optional: {
			if: { path: "/inputs/missing", exists: true },
			then: { map: "/inputs/missing", template: { value: { select: "" } } },
			else: { literal: [] },
		},
	});
	expect(
		await evaluateTransformAsync(template, {
			available: true,
			items: [{ enabled: true, value: 42 }, { enabled: false }],
		}),
	).toEqual({
		rows: [{ result: 42 }, { result: { skipped: true } }],
		optional: [],
	});
	expect(
		TransformSchema.safeParse({
			value: { if: { path: "^/value", exists: true }, then: 1, else: 2 },
		}).success,
	).toBe(false);
	const malicious = JSON.parse(
		'{"value":{"if":{"path":"/inputs/ok","equals":true},"then":{"map":"/inputs/items","template":{"__proto__":1}},"else":null}}',
	);
	expect(TransformSchema.safeParse(malicious).success).toBe(false);
});

it("keeps conditional transform depth bounded and honors cancellation", async () => {
	let nested: unknown = 1;
	for (let index = 0; index < 15; index++)
		nested = {
			if: { path: "/inputs/ok", equals: true },
			then: nested,
			else: 0,
		};
	const template = TransformSchema.parse({ value: nested });
	await expect(evaluateTransformAsync(template, { ok: true })).rejects.toThrow(
		/nesting|limit/,
	);
	await expect(
		evaluateTransformAsync(
			TransformSchema.parse({ value: 1 }),
			{},
			AbortSignal.abort(),
		),
	).rejects.toBeDefined();
});
