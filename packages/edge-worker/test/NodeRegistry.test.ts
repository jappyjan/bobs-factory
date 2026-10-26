import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { digest } from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { nodeRegistry, stepFields } from "../src/factory/nodes/index.js";
import {
	installNodeMetadata,
	paletteNodes,
} from "../src/factory/nodes/metadata.js";
import type { NodeDefinition } from "../src/factory/nodes/NodeDefinition.js";
import { RULE_EVALUATION_LIMITS } from "../src/factory/Rules.js";
import {
	StepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import {
	configurationPatch,
	NodeStepSettings,
} from "../src/factory/web/node-step-settings.js";
import {
	kindOf,
	newStep,
	updateStep,
} from "../src/factory/web/recipe-graph.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const hooks = {
	agent: async () => ({}),
	tool: async () => ({ value: 42 }),
	script: async () => "scalar",
};
function runtime(home = mkdtempSync(join(tmpdir(), "node-registry-"))) {
	if (!homes.includes(home)) homes.push(home);
	const instance = new WorkflowRuntime(home, hooks);
	runtimes.push(instance);
	return { instance, home };
}
function recipe(steps: unknown[]) {
	return validateWorkflows([
		...defaultWorkflows,
		{ id: "nodes", name: "Nodes", stepConfigVersion: "step-config-v1", steps },
	]).at(-1)!;
}
function start(instance: WorkflowRuntime, home: string, steps: unknown[]) {
	const workflow = recipe(steps);
	return instance.create({
		title: "Registry fixture",
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

it("adds a schema, executable and builder entry by registering one definition after schemas have been used", async () => {
	WorkflowSchema.parse({ id: "empty", name: "Empty", steps: [] });
	const schema = z.object({
		...stepFields,
		type: z.literal("fixture-echo"),
		suffix: z.string(),
	});
	const definition = {
		type: "fixture-echo",
		schema,
		category: "logic",
		effect: "pure",
		builder: {
			label: "Echo",
			icon: "◇",
			paletteGroup: "logic",
			defaults: { suffix: "!" },
		},
		execute: (ctx) => ({
			value: `${ctx.reads.value}${ctx.step.suffix}`,
			digest: ctx.inputDigest,
		}),
		summary: () => "Echo completed",
	} satisfies NodeDefinition<typeof schema>;
	nodeRegistry.register(definition);
	expect(() => nodeRegistry.register(definition)).toThrow("already registered");
	// Simulates the JSON-only server/browser boundary, without importing server executors in the UI.
	const metadata = JSON.parse(JSON.stringify(nodeRegistry.metadata()));
	installNodeMetadata(metadata);
	expect(
		paletteNodes().find((node) => node.type === definition.type)?.builder.label,
	).toBe("Echo");
	const step = {
		...newStep(definition.type, "echo"),
		reads: { value: "seed/value" },
	};
	expect(kindOf(step).icon).toBe("◇");
	expect(StepSchema.safeParse({ ...step, suffix: 1 }).success).toBe(false);
	const workflow = recipe([
		{ id: "seed", name: "Seed", type: "tool", tool: "fixture" },
		step,
	]);
	const settings = renderToStaticMarkup(
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
	expect(settings).toContain("Node configuration");
	expect(settings).toContain("suffix");
	const { instance, home } = runtime();
	const run = start(instance, home, workflow.steps);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.echo).toEqual({
		value: "42!",
		digest: digest({ value: 42 }),
	});
	expect(
		run.history.map(({ step, inputDigest }) => ({ step, inputDigest })),
	).toEqual([
		{ step: "seed", inputDigest: digest({}) },
		{ step: "echo", inputDigest: digest({ value: 42 }) },
	]);
	expect(run.events.some((event) => event.message === "Echo completed")).toBe(
		true,
	);
	await instance.shutdown();
	const restored = runtime(home).instance.get(run.id);
	expect(restored.history.at(-1)?.inputDigest).toBe(digest({ value: 42 }));
});

it("retains data-only safety for dynamically registered nodes nested inside flow schemas", () => {
	const schema = z.object({ ...stepFields, type: z.literal("fixture-data") });
	nodeRegistry.register({
		type: "fixture-data",
		schema,
		category: "logic",
		effect: "pure",
		builder: { label: "Data", icon: "◇", paletteGroup: "logic" },
		execute: () => [],
	});
	const getter = vi.fn(() => "fixture-data");
	const unsafe = Object.defineProperty(
		{ id: "nested", name: "Nested" },
		"type",
		{ enumerable: true, get: getter },
	);
	expect(() =>
		WorkflowSchema.parse({
			id: "nested",
			name: "Nested",
			steps: [{ id: "flow", name: "Flow", type: "fanout", groups: [[unsafe]] }],
		}),
	).toThrow("own data properties");
	expect(getter).not.toHaveBeenCalled();
	expect(() =>
		StepSchema.parse({
			id: "unknown",
			name: "Unknown",
			type: "not-registered",
		}),
	).toThrow("Unknown node type");
});

it("stamps scalar and array output receipts without changing their result shape", async () => {
	const schema = z.object({ ...stepFields, type: z.literal("fixture-array") });
	nodeRegistry.register({
		type: "fixture-array",
		schema,
		category: "logic",
		effect: "pure",
		builder: { label: "Array", icon: "◇", paletteGroup: "logic" },
		execute: () => [1, 2],
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ id: "scalar", name: "Scalar", type: "script", script: "fixture" },
		{
			id: "array",
			name: "Array",
			type: "fixture-array",
			reads: { scalar: "scalar" },
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs).toEqual({ scalar: "scalar", array: [1, 2] });
	expect(run.history.map((record) => record.inputDigest)).toEqual([
		digest({}),
		digest({ scalar: "scalar" }),
	]);
});

it("reconciles an uncertain effect across restart without sending it twice", async () => {
	const receipts = new Map<string, { id: string }>();
	const send = vi.fn(async (key: string) => {
		receipts.set(key, { id: "provider-created" });
		throw new Error("response lost after provider creation");
	});
	const reconcile = vi.fn(async (key: string) => receipts.get(key));
	const schema = z.object({
		...stepFields,
		type: z.literal("fixture-effect"),
		payload: z.string(),
	});
	nodeRegistry.register({
		type: "fixture-effect",
		schema,
		category: "io",
		effect: "effect",
		builder: { label: "Effect", icon: "◇", paletteGroup: "io" },
		execute: async (ctx) => {
			const receipt = await ctx.effect(
				"create",
				ctx.step.payload,
				send,
				reconcile,
			);
			expect(
				await ctx.effect("create", ctx.step.payload, send, reconcile),
			).toEqual(receipt);
			await expect(
				ctx.effect("create", "changed", send, reconcile),
			).rejects.toThrow("inputs changed");
			return receipt;
		},
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ id: "send", name: "Send", type: "fixture-effect", payload: "accepted" },
	]);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	const [key, record] = Object.entries(run.nodeEffects!)[0]!;
	expect(record.phase).toBe("uncertain");
	expect(send).toHaveBeenCalledTimes(1);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	expect(resumed.get(run.id).nodeEffects?.[key]?.phase).toBe("uncertain");
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(send).toHaveBeenCalledTimes(1);
	expect(reconcile).toHaveBeenCalledExactlyOnceWith(key);
	expect(resumed.get(run.id).outputs.send).toEqual({ id: "provider-created" });
	expect(resumed.get(run.id).nodeEffects?.[key]?.phase).toBe("confirmed");
});

it.each([
	"transient failure",
	"abort before send",
])("recovers an effect after %s using the original key", async (failure) => {
	const send = vi.fn(async (_key: string) => ({ id: "created" }));
	if (failure === "transient failure")
		send.mockRejectedValueOnce(new Error("DNS unavailable"));
	const reconcile = vi.fn(
		async (): Promise<{ id: string } | null | undefined> => null,
	);
	let first = true;
	const schema = z.object({
		...stepFields,
		type: z.literal(`fixture-retry-${failure}`),
	});
	nodeRegistry.register({
		type: `fixture-retry-${failure}`,
		schema,
		category: "io",
		effect: "effect",
		builder: { label: "Retry", icon: "◇", paletteGroup: "io" },
		execute: async (ctx) => {
			if (first && failure === "abort before send") {
				const controller = new AbortController();
				ctx.signal = controller.signal;
				const save = ctx.engine.save;
				ctx.engine.save = async (run) => {
					await save(run);
					if (
						Object.values(run.nodeEffects ?? {}).some(
							(r) => r.phase === "sending",
						)
					)
						controller.abort();
				};
			}
			first = false;
			return ctx.effect("create", "accepted", send, reconcile);
		},
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ id: "send", name: "Send", type: `fixture-retry-${failure}` },
	]);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	const [key, record] = Object.entries(run.nodeEffects!)[0]!;
	expect(record.phase).toBe(
		failure === "transient failure" ? "uncertain" : "not-sent",
	);
	expect(send).toHaveBeenCalledTimes(failure === "transient failure" ? 1 : 0);
	instance.retry(run.id);
	await waitForRuntime(() => expect(run.status).toBe("completed"));
	expect(send).toHaveBeenCalledTimes(failure === "transient failure" ? 2 : 1);
	for (const [sentKey] of send.mock.calls) expect(sentKey).toBe(key);
	expect(Object.keys(run.nodeEffects!)).toEqual([key]);
	expect(run.nodeEffects![key]!.phase).toBe("confirmed");
	if (failure === "abort before send") expect(reconcile).not.toHaveBeenCalled();
	else expect(reconcile).toHaveBeenCalledExactlyOnceWith(key);
});

it("records read-resolution failures as failed step attempts", async () => {
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{
			id: "check",
			name: "Check",
			type: "check",
			reads: { ticket: "@ticket" },
			check: {
				results: { present: { path: "/inputs/ticket/title", exists: true } },
			},
		},
	]);
	run.ticketSnapshot = {
		title: "Oversized",
		comments: Array.from(
			{ length: RULE_EVALUATION_LIMITS.collection + 1 },
			() => ({ body: "comment" }),
		),
	};
	await instance.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain(
		"Check ticket comments exceed the collection limit",
	);
	expect(
		run.stepAttempts?.map(({ step, outcome }) => ({ step, outcome })),
	).toEqual([{ step: "check", outcome: "failed" }]);
});

it("does not stamp retry sleep before the first accepted reads, including after restart", async () => {
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{
			id: "check",
			name: "Check",
			type: "check",
			reads: { ticket: "@ticket" },
			check: {
				results: { present: { path: "/inputs/ticket/title", exists: true } },
			},
			retry: { max: 1, backoff: 0 },
		},
	]);
	run.ticketSnapshot = { title: "Available on retry" };
	// An earlier read-resolution failure scheduled a retry before any stamp existed.
	run.checkpoint = {
		current: "check",
		visits: { check: 1 },
		active: { phase: "executing", retries: 1, retryAt: Date.now() },
	};
	await instance.save(run);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	const save = resumed.save.bind(resumed);
	let waits = 0;
	const saving = vi
		.spyOn(resumed, "save")
		.mockImplementation(async (snapshot) => {
			if (snapshot.capacityLeaves?.check?.phase === "waiting-ci") {
				waits++;
				expect(snapshot.checkpoint?.active?.nodeStamp).toBeUndefined();
			}
			await save(snapshot);
		});
	try {
		await resumed.launch(loaded);
		expect(loaded.error).toBeUndefined();
		expect(loaded.status).toBe("completed");
		expect(waits).toBeGreaterThan(0);
		expect(loaded.history.at(-1)?.inputDigest).toBe(
			digest({ ticket: loaded.ticketSnapshot }),
		);
		expect(loaded.outputs.check).toEqual({ passed: true, present: true });
	} finally {
		saving.mockRestore();
	}
});

it.each([
	"waiting-ci",
	"waiting-human",
] as const)("observes and clears %s without execution capacity", async (kind) => {
	const schema = z.object({
		...stepFields,
		type: z.literal(`fixture-${kind}`),
	});
	let calls = 0;
	nodeRegistry.register({
		type: `fixture-${kind}`,
		schema,
		category: "io",
		effect: "effect",
		builder: { label: "Wait", icon: "◇", paletteGroup: "io" },
		execute: (ctx) =>
			ctx.phase(kind, async () => {
				expect(ctx.run.capacityLeaves?.wait).toEqual({ phase: kind });
				expect(ctx.run.diagnostics?.operations.wait).toEqual({
					kind: kind === "waiting-ci" ? "provider-ci" : "human",
				});
				if (++calls === 1) throw new Error("wait failed");
				return "ready";
			}),
	});
	const { instance, home } = runtime();
	const run = start(instance, home, [
		{ id: "wait", name: "Wait", type: `fixture-${kind}` },
	]);
	// A cold restart may retain the last passive wait leaf.
	run.capacityLeaves = { wait: { phase: kind } };
	await instance.save(run);
	await instance.shutdown();
	const resumed = runtime(home).instance;
	const loaded = resumed.get(run.id);
	await resumed.launch(loaded);
	expect(loaded.status).toBe("failed");
	expect(loaded.capacityLeaves?.wait).toBeUndefined();
	expect(loaded.diagnostics?.operations.wait).toBeUndefined();
	resumed.retry(run.id);
	await waitForRuntime(() => expect(loaded.status).toBe("completed"));
	expect(loaded.outputs.wait).toBe("ready");
	expect(loaded.capacityLeaves?.wait).toBeUndefined();
	expect(loaded.diagnostics?.operations.wait).toBeUndefined();
});

it("removes deleted optional JSON configuration through the builder merge patch", () => {
	const workflow = recipe([
		{ id: "call", name: "Call", type: "snapshot", maxVisits: 3 },
	]);
	const step = workflow.steps[0]!;
	const { maxVisits: _, ...edited } = step;
	const updated = updateStep(
		workflow,
		step.id,
		configurationPatch(step, { ...edited, id: "changed", type: "changed" }),
	);
	const saved = JSON.parse(JSON.stringify(updated)).steps[0];
	expect(saved).not.toHaveProperty("maxVisits");
	expect(saved.id).toBe("call");
	expect(saved.type).toBe("snapshot");
});

it("passes graph chat through flow nodes despite local step overrides", async () => {
	const observed: boolean[] = [];
	const home = mkdtempSync(join(tmpdir(), "node-chat-"));
	homes.push(home);
	const instance = new WorkflowRuntime(home, {
		...hooks,
		agent: async (ctx) => {
			observed.push(ctx.chat!);
			return {};
		},
	});
	runtimes.push(instance);
	const call = (id: string) => ({
		id,
		name: id,
		type: "workflow",
		workflow: "chat-child",
		chat: false,
	});
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "chat-root",
			name: "Root",
			chat: true,
			steps: [
				call("direct"),
				{
					id: "fan",
					name: "Fan",
					type: "fanout",
					chat: false,
					groups: [[call("branch")]],
				},
				{
					id: "each",
					name: "Each",
					type: "foreach",
					chat: false,
					items: { values: [{ id: "one" }] },
					body: [call("nested-item")],
				},
			],
		},
		{
			id: "chat-child",
			name: "Child",
			internal: true,
			steps: [
				{ id: "agent", name: "Agent", type: "agent", prompt: "Read the task" },
			],
		},
	]);
	instance.updateWorkflows(definitions);
	const run = instance.create({
		title: "Chat",
		repositoryId: "fixture",
		workspace: home,
		input: "fixture",
		workflow: definitions.find((d) => d.id === "chat-root")!,
		triggerOrigin: {
			type: "manual",
			workflowId: "chat-root",
			at: new Date().toISOString(),
		},
	});
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(observed).toEqual([true, true, true]);
});

it("stamps the exact history reads consumed by a refreshed agent", async () => {
	const observed: unknown[] = [];
	const home = mkdtempSync(join(tmpdir(), "node-history-"));
	homes.push(home);
	const instance = new WorkflowRuntime(home, {
		...hooks,
		agent: async (ctx) => {
			observed.push(ctx.input);
			return { refreshed: true };
		},
	});
	runtimes.push(instance);
	const run = start(instance, home, [
		{
			id: "inspect",
			name: "Inspect",
			type: "agent",
			prompt: "Read the history",
			reads: { history: "@history" },
		},
	]);
	const seed = { step: "seed", output: { accepted: true }, at: run.createdAt };
	run.history.push(seed, {
		step: "inspect",
		output: { old: true },
		at: run.createdAt,
	});
	run.boundOutputs = {
		inspect: {
			version: 1,
			repositories: [],
			inputDigest: "previous",
			historyLength: 0,
		},
	};
	run.checkpoint = {
		current: "inspect",
		visits: {},
		producerRefresh: { source: "inspect", current: "end" },
	};
	await instance.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(observed[0]).toMatchObject({ history: [seed] });
	expect(run.history.at(-1)?.inputDigest).toBe(digest({ history: [seed] }));
});
