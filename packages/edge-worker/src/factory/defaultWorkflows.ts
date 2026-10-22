import { factoryRecipes } from "./factoryRecipes.js";
import { improvementRecipes } from "./improvementWorkflow.js";
import { stockWorkflowMetadata } from "./stockFactorySteps.js";
import { validateWorkflows } from "./Workflow.js";

export {
	conservativeWorkflows,
	legacyReviewSteps,
	upgradedArchitectureSteps,
	upgradedGuideStep,
	upgradeHandoffReadiness,
} from "./legacyDefaultWorkflows.js";

/** Newly accepted definitions are static. Historical snapshots and forks keep their graphs. */
export const defaultWorkflows = validateWorkflows([
	{ ...stockWorkflowMetadata.simple, steps: [] },
	...factoryRecipes,
	...improvementRecipes,
]);
