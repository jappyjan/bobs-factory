import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	boundOutput,
	boundStepKey,
	producerValue,
} from "../src/factory/ToolBindings.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
const runtimes: WorkflowRuntime[] = [],
	homes: string[] = [];
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const role = (id: string, next = "end") => ({
	id,
	name: id,
	type: "agent",
	prompt: "Return data",
	output: { format: "json-v1" },
	next,
});
const reader = {
	id: "port-reader",
	name: "Reader",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	inputs: ["source"],
	outcomes: ["completed"],
	steps: [{ ...role("read"), reads: { source: "source" } }],
};
const body = [
	{ ...role("original", "call") },
	{
		id: "call",
		name: "Reader",
		type: "workflow",
		workflow: reader.id,
		bindings: { source: "original" },
		next: "end",
	},
];
it.each([
	"parallel",
	"foreach",
])("executes local producer ports in each %s frame, with equal JSON remaining distinct owned receipts", async (kind) => {
	const container =
		kind === "parallel"
			? {
					id: "container",
					name: kind,
					type: "fanout",
					groups: [
						body,
						[
							role("other", "other-call"),
							{ ...body[1], id: "other-call", bindings: { source: "other" } },
						],
					],
					next: "end",
				}
			: {
					id: "container",
					name: kind,
					type: "foreach",
					items: { values: [{ id: "a" }, { id: "b" }] },
					body,
					concurrency: 1,
					next: "end",
				};
	const parent = {
		id: "lexical-caller",
		name: "Caller",
		stepConfigVersion: "step-config-v1",
		steps: [container],
	};
	const defs = validateWorkflows([...defaultWorkflows, reader, parent]);
	const h = mkdtempSync(join(tmpdir(), "lexical-call-"));
	homes.push(h);
	const seen: string[] = [];
	const r = new WorkflowRuntime(h, {
		agent: async (c) => {
			if (c.step.id !== "read") return { same: "JSON" };
			const source = c.stepKey!.includes("/1/")
				? "container/1/other"
				: c.stepKey!.replace(/call\/read$/, "original");
			expect(boundStepKey(c, "source")).toBe(source);
			expect(boundOutput(c, "source")).toEqual({ same: "JSON" });
			expect(c.run.history.some((x) => x.step === source)).toBe(true);
			seen.push(source);
			return { read: true };
		},
		tool: async () => ({}),
		script: async () => ({}),
	});
	runtimes.push(r);
	r.updateWorkflows(defs, parent.id);
	const run = r.create({
		title: kind,
		input: kind,
		repositoryId: "fixture",
		workspace: h,
		workflow: defs.at(-1)!,
		triggerOrigin: { type: "manual", workflowId: parent.id },
	});
	await r.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(seen.sort()).toEqual(
		(kind === "parallel"
			? ["container/0/original", "container/1/other"]
			: ["container/a/original", "container/b/original"]
		).sort(),
	);
	expect(producerValue(run, "original")).toBeUndefined();
});
it.each([
	"container/1/original",
	"container/b/original",
	"missing",
])("rejects a producer outside the containing lexical graph: %s", (source) => {
	const invalid = [{ ...body[1], bindings: { source } }];
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			reader,
			{
				id: "invalid-port",
				name: "Invalid",
				stepConfigVersion: "step-config-v1",
				steps: [
					{
						id: "container",
						name: "Container",
						type: "fanout",
						groups: [invalid, [role("original")]],
					},
				],
			},
		]),
	).toThrow("Unknown Call producer");
});
it("does not import inherited JSON in place of an unexecuted configured producer", async () => {
	const h = mkdtempSync(join(tmpdir(), "unexecuted-call-"));
	homes.push(h);
	const parent = {
		id: "unexecuted",
		name: "Unexecuted",
		inputs: ["original"],
		launchFields: [{ name: "original", type: "textarea", label: "Context" }],
		stepConfigVersion: "step-config-v1",
		steps: [body[1], role("original")],
	};
	const defs = validateWorkflows([...defaultWorkflows, reader, parent]);
	let reads = 0;
	const r = new WorkflowRuntime(h, {
		agent: async (c) => {
			reads++;
			expect(boundOutput(c, "source")).toBeUndefined();
			expect(producerValue(c.run, "original")).toBeUndefined();
			return { read: true };
		},
		tool: async () => ({}),
		script: async () => ({}),
	});
	runtimes.push(r);
	r.updateWorkflows(defs, parent.id);
	const run = r.create({
		title: "Context",
		input: "Context",
		repositoryId: "fixture",
		workspace: h,
		workflow: defs.at(-1)!,
		launchInputs: { original: '{"same":"JSON"}' },
		triggerOrigin: { type: "manual", workflowId: parent.id },
	});
	await r.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(reads).toBe(1);
});
it("forwards declared enclosing ports through Parallel lexical frames", async () => {
	const h = mkdtempSync(join(tmpdir(), "forwarded-ports-"));
	homes.push(h);
	const outer = {
		id: "outer-ports",
		name: "Outer",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		inputs: ["source"],
		outcomes: ["completed"],
		steps: [
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [
					[{ ...body[1], id: "one", bindings: { source: "@bindings/source" } }],
					[{ ...body[1], id: "two", bindings: { source: "@bindings/source" } }],
				],
				next: "end",
			},
		],
	};
	const parent = {
		id: "forwarded-parent",
		name: "Parent",
		stepConfigVersion: "step-config-v1",
		steps: [
			role("producer", "outer"),
			{
				id: "outer",
				name: "Outer",
				type: "workflow",
				workflow: outer.id,
				bindings: { source: "producer" },
				next: "end",
			},
		],
	};
	const defs = validateWorkflows([...defaultWorkflows, reader, outer, parent]);
	let consumed = 0;
	const r = new WorkflowRuntime(h, {
		agent: async (c) => {
			if (c.step.id === "producer") return { owned: true };
			expect(boundStepKey(c, "source")).toBe("producer");
			expect(boundOutput(c, "source")).toEqual({ owned: true });
			consumed++;
			return { read: true };
		},
		tool: async () => ({}),
		script: async () => ({}),
	});
	runtimes.push(r);
	r.updateWorkflows(defs, parent.id);
	const run = r.create({
		title: "Forwarded ports",
		input: "Read original producer",
		repositoryId: "fixture",
		workspace: h,
		workflow: defs.at(-1)!,
		triggerOrigin: { type: "manual", workflowId: parent.id },
	});
	await r.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(consumed).toBe(2);
});
