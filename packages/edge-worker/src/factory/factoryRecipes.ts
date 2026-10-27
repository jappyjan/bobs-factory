import {
	factoryComposition,
	takeoverComposition,
} from "./factoryComposition.js";
import { factoryDeliveryRecipes } from "./factoryDeliveryRecipes.js";
import { v2PlanningRecipes } from "./v2PlanningRecipes.js";
import { v2QaApprovalRecipes } from "./v2QaApprovalRecipes.js";
import { v2ReviewRecipe } from "./v2ReviewRecipe.js";
import { stockWorkflowMetadata } from "./workflowMetadata.js";

export const factoryRecipes = [
	...factoryDeliveryRecipes,
	...v2PlanningRecipes,
	{
		...stockWorkflowMetadata.factory,
		engineVersion: "nodes-v1",
		steps: factoryComposition,
	},
	{
		...stockWorkflowMetadata.takeover,
		engineVersion: "nodes-v1",
		steps: takeoverComposition,
	},
	v2ReviewRecipe,
	...v2QaApprovalRecipes,
];
