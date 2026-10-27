import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { boundStepKey } from "../src/factory/ToolBindings.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const workflow = (id: string) => defaultWorkflows.find((w) => w.id === id)!;

it("binds the Takeover intake assessment to its lexical existing-work producer", () => {
	const run = {
		workflow: workflow("takeover"),
		workflowDefinitions: defaultWorkflows,
	} as unknown as FactoryRun;
	const step = workflow("v2-takeover-intake").steps.find(
		(s) => s.id === "assess-existing",
	)!;
	expect(
		boundStepKey(
			{ run, step, stepKey: "intake/assess-existing" },
			"existingWork",
		),
	).toBe("intake/existing-work");
});
