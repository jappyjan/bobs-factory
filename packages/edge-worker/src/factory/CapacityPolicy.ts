import type { WorkflowStep } from "./Workflow.js";

export const passiveTools = [
	"human-review",
	"architecture-decision",
	"handoff",
	"ci",
	"merge-readiness",
	"wait-ci",
	"wait-for-ci",
	"merge",
];
export function isComputeIntensive(step: WorkflowStep): boolean {
	if (step.type === "agent") return true;
	if (
		step.type === "workflow" ||
		step.type === "fanout" ||
		step.type === "foreach" ||
		passiveTools.includes(step.tool ?? "")
	)
		return false;
	return (
		step.computeIntensive ??
		(step.type === "script" ||
			step.tool === "exec" ||
			step.tool === "impact-checks")
	);
}
