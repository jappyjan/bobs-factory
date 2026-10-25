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
import {
	StepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { NodeStepSettings } from "../src/factory/web/node-step-settings.js";
import { kindOf, newStep } from "../src/factory/web/recipe-graph.js";
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
