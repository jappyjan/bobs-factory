import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { boundStepKey } from "../src/factory/ToolBindings.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const workflow = (id: string) => defaultWorkflows.find((w) => w.id === id)!;

it.each([
	["clarify-plan", "planning", "clarify"],
	["clarify-plan", "planning", "plan"],
	["clarify-plan", "planning", "plan-review"],
])("binds the Takeover assessment into composed %s/%s", (recipe, call, id) => {
	const run = {
		workflow: workflow("takeover"),
		workflowDefinitions: defaultWorkflows,
	} as unknown as FactoryRun;
	const step = workflow(recipe).steps.find((s) => s.id === id)!;
	const context = { run, step, stepKey: `${call}/${id}` };
	expect(boundStepKey(context, "scopeExistingWork")).toBe("existing-work");
	expect(boundStepKey(context, "scopeAssessment")).toBe("assess-existing");
});
