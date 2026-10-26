import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

it("refreshes a bound history reader without making its own prior receipt invalidate the new attempt", async () => {
	const workspace = mkdtempSync(join(tmpdir(), "bound-history-repository-"));
	const home = mkdtempSync(join(tmpdir(), "bound-history-runtime-"));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "record.txt"), "Stable input\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	let inspections = 0,
		mutations = 0;
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			if (context.step.id === "mutate") {
				mutations++;
				return { updated: true };
			}
			if (context.step.id === "consume")
				return { received: (context.input as { source: unknown }).source };
			return {
				inspection: ++inspections,
				observed: (context.input as { events: { step: string }[] }).events.map(
					(e) => e.step,
				),
			};
		},
	});
	try {
		const workflow = WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "history-reader",
			name: "History reader",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "inspect",
					name: "Inspect history",
					type: "agent",
					prompt: "Inspect supplied history",
					revision: "bound",
					reads: { events: "@history" },
					maxVisits: 3,
					next: "mutate",
				},
				{
					id: "mutate",
					name: "Mutate",
					type: "agent",
					prompt: "mutate",
					next: "consume",
				},
				{
					id: "consume",
					name: "Consume",
					type: "agent",
					prompt: "consume",
					reads: { source: "inspect" },
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace,
			workflow,
			input: "Inspect current history",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		const frozen = JSON.stringify(run.workflow);
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(inspections).toBe(2);
		expect(mutations).toBe(1);
		expect(run.outputs.consume).toEqual({
			received: { inspection: 2, observed: ["mutate"] },
		});
		expect(run.history.map((entry) => entry.step)).toEqual([
			"inspect",
			"mutate",
			"inspect",
			"consume",
		]);
		expect(JSON.stringify(run.workflow)).toBe(frozen);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
		rmSync(workspace, { recursive: true, force: true });
	}
});
