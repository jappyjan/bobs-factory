import historicalStepDigests from "./historicalStepDigests.json" with {
	type: "json",
};
import type { Workflow, WorkflowStep } from "./Workflow.js";
import {
	recognizedStock,
	stepBehaviorDigest,
	workflowBehaviorDigest,
} from "./WorkflowCatalog.js";
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

/** Add capacity to known stock steps without editing accepted workflow graphs. */
export function upgradeStockStepVisits(run: FactoryRun): boolean {
	if (run.stepVisitBudget || ["completed", "stopped"].includes(run.status))
		return false;
	const additionalVisits: Record<string, number> = {};
	const workflowDigests: Record<string, string> = {};
	const stepDigests: Record<string, string> = {};
	const historical: Record<
		string,
		Record<string, string>
	> = historicalStepDigests;
	const visit = (
		workflow: Workflow,
		prefix: string,
		ancestors: Set<string>,
	) => {
		if (ancestors.has(workflow.id)) return;
		const nextAncestors = new Set([...ancestors, workflow.id]);
		const stock = recognizedStock(workflow);
		const walk = (steps: WorkflowStep[], parent: string) => {
			for (const step of steps) {
				const key = `${parent}${step.id}`;
				// Both stock tiers doubled. New definitions already contain 16/200;
				// explicit custom limits never qualify by their number or ID alone.
				const stepDigest = stepBehaviorDigest(step);
				if (
					[8, 100].includes(step.maxVisits) &&
					(stock || historical[workflow.id]?.[stepDigest])
				) {
					additionalVisits[key] = step.maxVisits;
					stepDigests[key] = stepDigest;
					workflowDigests[workflow.id] ??= workflowBehaviorDigest(workflow);
				}
				for (const [index, group] of (step.groups ?? []).entries())
					walk(group, `${key}/${index}/`);
				if (step.type === "workflow") {
					const child = run.workflowDefinitions?.find(
						(definition) => definition.id === step.workflow,
					);
					if (child) visit(child, `${key}/`, nextAncestors);
				}
			}
		};
		walk(workflow.steps, prefix);
	};
	visit(run.recoveryWorkflow ?? run.workflow, "", new Set());
	if (!Object.keys(additionalVisits).length) return false;
	run.stepVisitBudget = {
		version: "stock-step-visits-v1",
		at: new Date().toISOString(),
		additionalVisits,
		workflowDigests,
		stepDigests,
	};
	const iterationLimit = run.iterationLimit;
	const allowance = iterationLimit && additionalVisits[iterationLimit.step];
	if (iterationLimit && allowance)
		run.iterationLimit = {
			...iterationLimit,
			limit: iterationLimit.limit + allowance,
		};
	return true;
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
