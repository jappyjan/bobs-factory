import { registerWorkflowConfig } from "../../src/factory/StepConfig.js";
import { StepSchema, WorkflowSchema } from "../../src/factory/Workflow.js";
import type { ExecutionContext } from "../../src/factory/WorkflowRuntime.js";

/** Give direct pre-config tool tests the same accepted legacy graph as loaded runs. */
export function legacyExecutionContext(
	context: ExecutionContext,
): ExecutionContext {
	const candidate = context.step;
	context.step = StepSchema.parse({
		id: candidate?.id ?? candidate?.tool ?? "ci-fix",
		name: "Legacy fixture step",
		type: candidate?.tool ? "tool" : "agent",
		...(candidate?.tool ? {} : { prompt: "Legacy fixture" }),
		...candidate,
	});
	registerWorkflowConfig(
		{ id: "factory-pipeline", steps: [context.step] },
		"factory",
	);
	if (!context.run.workflow) {
		const leaf = WorkflowSchema.parse({
			id: "legacy-fixture",
			name: "Legacy fixture",
			steps: [
				{
					id: "ci-fix",
					name: "Correct feedback",
					type: "agent",
					prompt: "Correct feedback",
				},
				...["draft-pr", "ci", "handoff", "merge"].map((tool) => ({
					id: tool,
					name: tool,
					type: "tool",
					tool,
				})),
			],
		});
		const root = WorkflowSchema.parse({
			id: "fixture",
			name: "Fixture",
			steps: [
				{
					id: "pipeline",
					name: "Pipeline",
					type: "workflow",
					workflow: leaf.id,
				},
			],
		});
		registerWorkflowConfig(leaf, "factory");
		registerWorkflowConfig(root, "factory");
		context.run.workflow = root;
		context.run.workflowDefinitions = [root, leaf];
	}
	return context;
}
