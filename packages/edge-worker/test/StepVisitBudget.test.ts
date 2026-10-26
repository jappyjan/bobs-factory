import { expect, it } from "vitest";
import { stepVisitLimit } from "../src/factory/StepVisitBudget.js";
import { StepSchema } from "../src/factory/Workflow.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

it("retains explicit visit grants without upgrading historical limits", () => {
	const step = StepSchema.parse({
		id: "work",
		name: "Work",
		type: "agent",
		prompt: "Work",
		maxVisits: 8,
	});
	const run = {
		stepVisitBudget: { additionalVisits: { "call/work": 4 } },
	} as FactoryRun;
	expect(stepVisitLimit(run, "call/work", step, 2)).toBe(14);
	expect(stepVisitLimit(run, "other/work", step)).toBe(8);
});
it("bounds new node defaults independently of retained grants", () => {
	const step = { id: "work", name: "Work", type: "agent", prompt: "Work" };
	expect(StepSchema.parse(step).maxVisits).toBe(16);
	expect(StepSchema.parse({ ...step, maxVisits: 8 }).maxVisits).toBe(8);
	expect(StepSchema.safeParse({ ...step, maxVisits: 201 }).success).toBe(false);
});
