import type { WorkflowStep } from "./Workflow.js";
import type { FactoryRun } from "./WorkflowRuntime.js";
export interface StepVisitBudgetUpgrade {
	version: "stock-step-visits-v1";
	at: string;
	/** Full runtime step keys include called workflows and fanout branches. */
	additionalVisits: Record<string, number>;
	/** Full-behavior fingerprints retain the source of each stock allowance. */
	workflowDigests: Record<string, string>;
	stepDigests: Record<string, string>;
}

export function stepVisitLimit(
	run: FactoryRun,
	key: string,
	step: WorkflowStep,
	additionalVisits = 0,
): number {
	return (
		step.maxVisits +
		(run.stepVisitBudget?.additionalVisits[key] ?? 0) +
		additionalVisits
	);
}
