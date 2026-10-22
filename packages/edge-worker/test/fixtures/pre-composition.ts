import { improvementRecipes } from "../../src/factory/improvementWorkflow.js";
import {
	stockFactorySteps,
	stockTakeoverSteps,
	stockWorkflowMetadata,
} from "../../src/factory/stockFactorySteps.js";
import { validateWorkflows } from "../../src/factory/Workflow.js";

/** Accepted #141 stock graph, reconstructed from its byte-identical configured roles.
 * Tests of frozen/legacy role behavior deliberately retain their original flat frame.
 * New compositions are driven separately by FactoryComposition.test.ts.
 */
export const preCompositionWorkflows = validateWorkflows([
	{ ...stockWorkflowMetadata.simple, steps: [] },
	{
		...stockWorkflowMetadata.factory,
		steps: [
			{
				id: "pipeline",
				configVersion: "step-config-v1",
				reads: { scopeSource: "@source", scopeTicket: "@ticket" },
				rules: [],
				checks: [
					{
						check: "scope-inputs",
						sources: {
							clarify: "scopeClarify",
							decisions: "scopeDecisions",
							plan: "scopePlan",
							"existing-work": "scopeExistingWork",
							"assess-existing": "scopeAssessment",
							source: "scopeSource",
							ticket: "scopeTicket",
						},
					},
				],
				access: { mode: "workspace" },
				instructions: [],
				name: "Factory pipeline",
				branches: [],
				maxVisits: 16,
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		...stockWorkflowMetadata.takeover,
		steps: [
			...Object.values(stockTakeoverSteps),
			{
				id: "pipeline",
				configVersion: "step-config-v1",
				reads: {
					scopeExistingWork: "existing-work",
					scopeAssessment: "assess-existing",
					scopeSource: "@source",
					scopeTicket: "@ticket",
				},
				rules: [],
				checks: [
					{
						check: "scope-inputs",
						sources: {
							clarify: "scopeClarify",
							decisions: "scopeDecisions",
							plan: "scopePlan",
							"existing-work": "scopeExistingWork",
							"assess-existing": "scopeAssessment",
							source: "scopeSource",
							ticket: "scopeTicket",
						},
					},
				],
				access: { mode: "workspace" },
				instructions: [],
				name: "Continue factory pipeline",
				branches: [],
				maxVisits: 16,
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		...stockWorkflowMetadata["factory-pipeline"],
		steps: Object.values(stockFactorySteps),
	},
	...improvementRecipes,
]);
