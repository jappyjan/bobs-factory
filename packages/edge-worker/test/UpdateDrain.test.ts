import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";
import { UpdateDrain } from "../src/updates/UpdateDrain.js";

it("pins the pre-node-engine v2 receipt, including legacy fields and property order", async () => {
	const home = mkdtempSync(join(tmpdir(), "update-receipt-v2-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("No agent permitted");
		},
	});
	try {
		// Fixed bytes and values, independent of the installed bundled recipes.
		writeFileSync(join(home, "factory/workflows.json"), "saved catalog\n");
		writeFileSync(join(home, "config.json"), '{"fixture":true}\n');
		writeFileSync(join(home, ".env"), "FIXTURE=value\n");
		const run = {
			id: "legacy-run",
			title: "Legacy",
			repositoryId: "repo",
			workspace: "/fixture/workspace",
			input: "fixture",
			status: "stopped",
			createdAt: "2026-10-25T00:00:00.000Z",
			updatedAt: "2026-10-25T00:00:00.000Z",
			workflow: {
				id: "legacy",
				name: "Legacy",
				steps: [],
				labels: [],
				description: "",
			},
			workflowDefinitions: [],
			checkpoint: { current: "end", visits: {} },
			outputs: { answer: "retained" },
			answers: { question: "accepted" },
			reviewGate: { approved: true },
			humanDecisions: [{ decision: "approve" }],
			questionBatchId: "batch-1",
			questions: [{ id: "question", text: "Continue?" }],
			questionRecommendations: { question: "yes" },
			executionSnapshot: {
				schemaVersion: 1,
				sources: { identity: "legacy", tools: "legacy" },
			},
			delivery: { pr: 173 },
			ticketSync: { receipts: [], lastStatus: "review" },
			history: [],
			events: [],
		} satisfies FactoryRun & Record<string, unknown>;
		runtime.runs.set(run.id, run);
		const drain = new UpdateDrain(
			home,
			runtime,
			{} as MachineCapacity,
			() => false,
			() => {},
			() => ({
				pendingIntegrationEvents: {},
				sessions: [{ id: "native", codex: "saved-id" }],
			}),
		);
		// Captured from 5d5f2760 UpdateDrain.receipt() over this run after its
		// WorkflowRuntime loader parsed the graph (which adds allowedTriggers), as
		// the running worker held it. Hashing the unparsed object gave b6ecda8f...,
		// which no running worker ever reported.
		const expected = {
			preservationContract: "factory-preservation-v2",
			preservedStateSha256:
				"97751ac487f7697286de7064a4685293fc993b4b2cf4ddbc5350a8fbcfce6fcb",
			runIds: ["legacy-run"],
		};
		expect(drain.receipt()).toEqual(expected);
		Object.assign(run, {
			viewRecords: [{ id: "new-view" }],
			nodeEffects: { effect: { phase: "confirmed" } },
		});
		expect(drain.receipt()).toEqual(expected);
		for (const key of [
			"answers",
			"reviewGate",
			"humanDecisions",
			"questionBatchId",
			"questions",
			"questionRecommendations",
			"delivery",
		] as const) {
			const original = run[key];
			Object.assign(run, { [key]: null });
			expect(drain.receipt().preservedStateSha256, key).not.toBe(
				expected.preservedStateSha256,
			);
			Object.assign(run, { [key]: original });
		}
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("preserves the raw legacy receipt across runtime load and bundled catalog reconciliation", async () => {
	const home = mkdtempSync(join(tmpdir(), "update-legacy-load-"));
	const hooks = { agent: async () => ({}) };
	const runtime = new WorkflowRuntime(home, hooks);
	let restored: WorkflowRuntime | undefined;
	try {
		const catalog = runtime.catalog.read();
		// This bundled identity and role were available to the old worker.
		catalog.preferences["retired-bundled"] = { oldRole: { runner: "codex" } };
		catalog.launch["retired-bundled"] = {
			labels: ["saved"],
			allowedTriggers: ["manual"],
		};
		catalog.enabled["retired-bundled"] = false;
		catalog.defaultWorkflow = "retired-bundled";
		const bytes = JSON.stringify(catalog, null, 2);
		writeFileSync(join(home, "factory/workflows.json"), bytes);
		// An already-reconciled runtime is not an old worker baseline. Load the
		// saved catalog default separately below, as the old worker would see it.
		const run = runtime.create({
			id: "legacy-load",
			triggerOrigin: {
				type: "manual",
				workflowId: "legacy",
				at: "2026-10-25T00:00:00.000Z",
			},
			workflow: {
				id: "legacy",
				name: "Legacy",
				description: "",
				labels: [],
				steps: [],
			},
			workflowDefinitions: [],
			repositoryId: "repo",
			workspace: "/fixture",
			input: "fixture",
		});
		Object.assign(run, {
			workflow: {
				id: "legacy",
				name: "Legacy",
				description: "",
				labels: [],
				steps: [
					{ id: "old-tool", name: "Old", type: "tool", tool: "human-review" },
				],
			},
			answers: { oldQuestion: "yes" },
			reviewGate: { approved: true },
			delivery: { pr: 173 },
		});
		await runtime.save(run);
		await runtime.shutdown();
		const drain = (r: WorkflowRuntime) =>
			new UpdateDrain(
				home,
				r,
				{} as MachineCapacity,
				() => false,
				() => {},
			);
		// Baseline default before the bundled identity was removed.
		const originalDefault = runtime.catalog.preservedDefaultWorkflow;
		runtime.catalog.preservedDefaultWorkflow = () => "retired-bundled";
		const before = drain(runtime).receipt();
		runtime.catalog.preservedDefaultWorkflow = originalDefault;
		restored = new WorkflowRuntime(home, hooks);
		expect(restored.getDefaultWorkflow()).toBe("factory");
		expect(restored.catalog.read().inactive).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					workflow: "retired-bundled",
					role: "oldRole",
				}),
			]),
		);
		expect(restored.get(run.id).status).toBe("stopped");
		expect(readFileSync(join(home, "factory/workflows.json"), "utf8")).toBe(
			bytes,
		);
		expect(drain(restored).receipt()).toEqual(before);
		// Explicit user edits still commit the reconciled catalog and new default.
		restored.updateWorkflows(restored.listWorkflows(), "simple");
		expect(restored.catalog.preservedDefaultWorkflow()).toBe("simple");
		expect(drain(restored).receipt()).not.toEqual(before);
	} finally {
		await restored?.shutdown();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("hashes stored legacy graphs as the running pre-node-engine worker held them", async () => {
	const home = mkdtempSync(join(tmpdir(), "update-receipt-parsed-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("No agent permitted");
		},
	});
	try {
		writeFileSync(join(home, "factory/workflows.json"), "saved catalog\n");
		writeFileSync(join(home, "config.json"), '{"fixture":true}\n');
		writeFileSync(join(home, ".env"), "FIXTURE=value\n");
		// Stored bytes as an earlier worker wrote them: unordered properties, no
		// schema defaults and no allowed triggers. The old worker re-parsed these
		// on load, so its receipt covers the normalized shape, and the new loader
		// retains the stored bytes verbatim.
		const stored = {
			steps: [
				{
					id: "ask",
					name: "Ask",
					type: "agent",
					prompt: "Go",
					json: true,
					askQuestions: false,
					runner: "codex",
					model: "gpt-5",
					next: "run",
				},
				{
					id: "run",
					name: "Run",
					type: "tool",
					tool: "noop",
					branches: [{ next: "ask", when: { equals: 1, path: "/x" } }],
				},
				{
					id: "each",
					name: "Each",
					type: "foreach",
					items: { from: "/list" },
					body: [
						{
							id: "inner",
							name: "Inner",
							type: "agent",
							prompt: "P",
							askQuestions: true,
							json: false,
						},
					],
				},
			],
			labels: ["a"],
			chat: true,
			name: "Legacy",
			id: "legacy-graph",
			description: "d",
		};
		const run = (id: string, workflow: unknown) =>
			({
				id,
				title: "Legacy",
				repositoryId: "repo",
				workspace: "/fixture/workspace",
				input: "fixture",
				status: "stopped",
				createdAt: "2026-10-25T00:00:00.000Z",
				updatedAt: "2026-10-25T00:00:00.000Z",
				workflow,
				workflowDefinitions: [],
				checkpoint: { current: "end", visits: {} },
				outputs: {},
				history: [],
				events: [],
			}) as unknown as FactoryRun;
		for (const item of [
			run("a", stored),
			run("b", { name: "Simple", id: "simple", steps: [] }),
		])
			runtime.runs.set(item.id, item);
		const drain = new UpdateDrain(
			home,
			runtime,
			{} as MachineCapacity,
			() => false,
			() => {},
			() => ({ pendingIntegrationEvents: {}, sessions: [] }),
		);
		// Captured from 5d5f2760 UpdateDrain.receipt() after WorkflowSchema.parse
		// of the same stored graphs, as its WorkflowRuntime loader assigned them.
		expect(drain.receipt().preservedStateSha256).toBe(
			"27741e13da073e94aaf5834ad27ca9ac6232bc197e1650a9eda458970b3193a7",
		);
		// Receipts never alter the retained run.
		expect(Object.keys(runtime.runs.get("a")!.workflow)[0]).toBe("steps");
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
