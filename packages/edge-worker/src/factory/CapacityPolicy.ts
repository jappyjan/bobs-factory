import type { WorkflowStep } from "./Workflow.js";
export function isComputeIntensive(step: WorkflowStep): boolean {
	return step.type === "agent" || step.type === "exec";
}
