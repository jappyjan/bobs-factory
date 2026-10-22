import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
it("uses corrected mapped inputs on the next outcome Call visit while retaining visit counts", async () => {
	const home = mkdtempSync(join(tmpdir(), "review142-mapping-"));
	let sourceCalls = 0;
	const received: number[] = [];
	const sessions: (string | undefined)[] = [];
	const child = {
		id: "mapped-reader",
		name: "Reader",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		outcomes: ["repair", "completed"],
		steps: [
			{
				id: "inspect",
				name: "Inspect",
				type: "agent",
				prompt: "Inspect plan",
				reads: { plan: "@callInputs/plan" },
				output: { format: "json-v1" },
				maxVisits: 2,
				next: "end",
				branches: [{ when: { path: "retry", equals: true }, next: "repair" }],
			},
		],
	};
	const parent = {
		id: "mapping-caller",
		name: "Caller",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "plan-source",
				name: "Plan source",
				type: "agent",
				prompt: "Produce plan",
				output: { format: "json-v1" },
				next: "call",
			},
			{
				id: "call",
				name: "Inspect plan",
				type: "workflow",
				workflow: child.id,
				inputMapping: { plan: "/plan-source" },
				next: "end",
				branches: [
					{ when: { path: "outcome", equals: "repair" }, next: "plan-source" },
				],
			},
		],
	};
	const defs = validateWorkflows([...defaultWorkflows, child, parent]);
	const r = new WorkflowRuntime(home, {
		agent: async (c) => {
			if (c.step.id === "plan-source") return { version: ++sourceCalls };
			sessions.push(c.resumeAgent?.sessionId);
			await c.checkpointAgent?.({
				runner: "codex",
				sessionId: "mapped-inspection",
			});
			const v = (c.callInputs!.plan as { version: number }).version;
			received.push(v);
			return { retry: v < 2 };
		},
		tool: async () => ({}),
		script: async () => ({}),
	});
	try {
		r.updateWorkflows(defs, parent.id);
		const run = r.create({
			title: "Correct mapped plan",
			repositoryId: "fixture",
			workspace: home,
			input: "Use corrected plan",
			workflow: defs.at(-1)!,
			triggerOrigin: { type: "manual", workflowId: parent.id },
		});
		await r.launch(run);
		writeFileSync(
			"/tmp/taskbot142-r1-mapped.json",
			JSON.stringify(
				{
					status: run.status,
					error: run.error,
					sourceCalls,
					received,
					checkpoint: run.checkpoint,
					history: run.history,
				},
				null,
				2,
			),
		);
		expect(received).toEqual([1, 2]);
		expect(sessions).toEqual([undefined, "mapped-inspection"]);
		expect(run.checkpoint!.calls!.call!.visits.inspect).toBe(2);
		expect(run.status, run.error).toBe("completed");
	} finally {
		await r.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
