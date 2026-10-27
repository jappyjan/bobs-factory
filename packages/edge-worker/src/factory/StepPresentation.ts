import { nodeKind } from "./nodes/metadata.js";
import type { WorkflowStep } from "./Workflow.js";
export interface StepPresentation {
	phase: "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "violet";
	icon: string;
	fixing: boolean;
}
export function stepPresentation(step: WorkflowStep): StepPresentation {
	const kind = nodeKind(step.type);
	return {
		phase: kind.tone as StepPresentation["phase"],
		icon: kind.icon,
		fixing: false,
	};
}
