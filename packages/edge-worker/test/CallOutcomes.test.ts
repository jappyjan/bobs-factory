import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { boundStepKey, producerValue } from "../src/factory/ToolBindings.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const instances: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const r of instances.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const role = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	configVersion: "step-config-v1",
	prompt: "Return JSON",
	output: { format: "json-v1" },
	...extra,
});
function setup(
	agent: RuntimeHooks["agent"],
	tool: RuntimeHooks["agent"] = async () => ({}),
) {
	const home = mkdtempSync(join(tmpdir(), "call-outcomes-"));
	homes.push(home);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "a",
			name: "A",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			inputs: ["publication"],
			outcomes: ["repair", "completed"],
			steps: [
				role("prepare"),
				role("verify", {
					reads: { publication: "publication" },
					next: "end",
					branches: [{ when: { path: "retry", equals: true }, next: "repair" }],
				}),
			],
		},
		{
			engineVersion: "nodes-v1",
			id: "b",
			name: "B",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			outcomes: ["completed"],
			steps: [
				{
					id: "publish",
					name: "Publish",
					type: "agent",
					configVersion: "step-config-v1",
					prompt: "fixture-publication",
					next: "end",
				},
			],
		},
		{
			engineVersion: "nodes-v1",
			id: "parent",
			name: "Parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "first",
					name: "First",
					type: "workflow",
					workflow: "a",
					bindings: { publication: "second/publish" },
					next: "end",
					branches: [
						{ when: { path: "outcome", equals: "repair" }, next: "second" },
					],
				},
				{
					id: "second",
					name: "Second",
					type: "workflow",
					workflow: "b",
					next: "first",
					branches: [
						{
							when: { path: "completed", equals: true },
							next: "first",
							entry: "verify",
						},
					],
				},
			],
		},
	]);
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) =>
			context.step.prompt === "fixture-publication"
				? tool(context)
				: agent(context),
		script: async () => ({}),
	});
	instances.push(runtime);
	runtime.updateWorkflows(definitions, "parent");
	const run = runtime.create({
		id: "test",
		title: "Test",
		input: "Test",
		repositoryId: "fixture",
		workspace: home,
		workflow: definitions.at(-1)!,
		triggerOrigin: {
			type: "manual",
			workflowId: "parent",
			at: new Date().toISOString(),
		},
	});
	return { home, runtime, run, definitions };
}
it("routes corrections across Calls with original frame visits, produced-only outputs and qualified producer reads", async () => {
	const seen: string[] = [];
	const { runtime, run } = setup(
		async (context) => {
			seen.push(context.stepKey!);
			if (context.step.id === "verify") {
				expect(boundStepKey(context, "publication")).toBe("second/publish");
				const actual = producerValue(
					context.run,
					boundStepKey(context, "publication")!,
				);
				return { retry: !actual, publication: actual ?? null };
			}
			return { prepared: true };
		},
		async () => ({ url: "https://example.test/pr/1", headSha: "head" }),
	);
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(seen).toEqual(["first/prepare", "first/verify", "first/verify"]);
	expect(run.checkpoint!.calls!.first!.visits).toEqual({
		prepare: 1,
		verify: 2,
	});
	expect(run.outputs.first).toMatchObject({
		outcome: "completed",
		outputs: { prepare: { prepared: true }, verify: { retry: false } },
	});
	expect((run.outputs.first as { outputs: object }).outputs).not.toHaveProperty(
		"publication",
	);
	expect(run.history.filter((x) => x.step === "second/publish")).toHaveLength(
		1,
	);
	expect(run.history.filter((x) => x.step === "first")).toHaveLength(2);
});
it("retains the outcome frame and accepted producer receipts through waiting, shutdown and correction resume", async () => {
	let verify = 0;
	const agent = vi.fn(async (c: ExecutionContext) =>
		c.step.id === "ask"
			? { questions: ["Proceed?"] }
			: c.step.id === "prepare"
				? { prepared: true }
				: ++verify === 1
					? { retry: true }
					: { retry: false },
	);
	const { home, runtime, run, definitions } = setup(agent, async () => ({
		url: "https://example.test/pr/1",
		headSha: "head",
	}));
	// A real ordinary assistance wait inside the correction recipe, after its first produced action.
	const b = definitions.find((w) => w.id === "b")!;
	b.steps.push({
		id: "ask",
		name: "Ask",
		type: "display",
		next: "end",
		document: {
			version: "view-v1",
			components: [
				{
					id: "submit",
					type: "actions",
					data: {
						literal: { actions: [{ id: "continue", label: "Continue" }] },
					},
				},
			],
		},
		branches: [],
		maxVisits: 100,
	} as never);
	b.steps[0]!.next = "ask";
	runtime.updateWorkflows(definitions, "parent");
	run.workflowDefinitions = structuredClone(definitions);
	const pending = runtime.launch(run);
	await waitForRuntime(() => expect(run.status, run.error).toBe("waiting"));
	const prefix = structuredClone(run.history);
	await runtime.shutdown();
	await pending;
	const resumed = new WorkflowRuntime(home, {
		agent: async (c) => (c.step.id === "ask" ? { questions: [] } : agent(c)),
	});
	instances.push(resumed);
	const restored = resumed.get(run.id);
	const continuing = resumed.launch(restored);
	await waitForRuntime(() =>
		expect(restored.status, restored.error).toBe("waiting"),
	);
	await resumed.answerView(restored.id, {
		batchId: restored.viewDecision!.id,
		digest: restored.viewDecision!.digest,
		accepted: true,
		action: "continue",
	});
	await waitForRuntime(() =>
		expect(["completed", "failed"]).toContain(restored.status),
	);
	await continuing;
	expect(restored.status, restored.error).toBe("completed");
	expect(restored.history.slice(0, prefix.length)).toEqual(prefix);
	expect(restored.checkpoint!.calls!.first!.visits.verify).toBe(2);
	expect(
		restored.history.filter((x) => x.step === "first/verify"),
	).toHaveLength(2);
	expect(
		restored.history.filter((x) => x.step === "second/publish"),
	).toHaveLength(1);
});
it("rejects undeclared outcomes, missing sources and entries before execution", () => {
	const { definitions } = setup(async () => ({}));
	const invalid = structuredClone(definitions);
	invalid.at(-1)!.steps[0]!.bindings = { publication: "missing/producer" };
	expect(() => validateWorkflows(invalid)).toThrow("Unknown Call producer");
	const entry = structuredClone(definitions);
	entry.at(-1)!.steps[1]!.branches[0]!.entry = "missing";
	expect(() => validateWorkflows(entry)).toThrow("real callee step");
	const outcome = structuredClone(definitions);
	outcome.find((w) => w.id === "a")!.outcomes = [];
	expect(() => validateWorkflows(outcome)).toThrow("Unknown step: repair");
});

it("keeps original child pass limits across outcome re-entry", async () => {
	const { runtime, run, definitions } = setup(async () => ({ retry: true }));
	const child = definitions.find((w) => w.id === "a")!;
	child.steps.find((s) => s.id === "verify")!.maxVisits = 2;
	run.workflowDefinitions = structuredClone(definitions);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toMatch(/limit|pass|loop/i);
	expect(run.history.filter((x) => x.step === "first/prepare")).toHaveLength(1);
	expect(run.checkpoint!.calls!.first!.visits.verify).toBe(3);
	expect(run.history.filter((x) => x.step === "first/verify")).toHaveLength(2);
});
