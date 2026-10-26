import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { workflowExecutionContext } from "../src/factory/WorkflowExecution.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const workflow = (id: string, steps: unknown[]) =>
	WorkflowSchema.parse({ engineVersion: "nodes-v1", id, name: id, steps });
const role = (id: string) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Do work",
});
const context = (root: ReturnType<typeof workflow>, definitions = [root]) =>
	({
		run: { workflow: root, workflowDefinitions: definitions },
		step: root.steps[0],
		stepKey: "pipeline/implement",
	}) as ExecutionContext;
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

it("describes a frozen legacy pipeline without importing unrelated current architecture gates", () => {
	const pipeline = workflow("legacy-pipeline", [
		role("plan"),
		{
			...role("plan-review"),
			branches: [{ when: { path: "approved", equals: false }, next: "plan" }],
		},
		role("implement"),
	]);
	const root = workflow("legacy-factory", [
		{
			id: "pipeline",
			name: "Pipeline",
			type: "workflow",
			workflow: pipeline.id,
		},
	]);
	const ctx = context(root, [...defaultWorkflows, root, pipeline]);
	ctx.step = pipeline.steps[2]!;
	const original = structuredClone(ctx.run);
	expect(json(workflowExecutionContext(ctx))).toEqual({
		contract: "workflow-execution-v1",
		rootWorkflowId: "legacy-factory",
		currentStep: { key: "pipeline/implement", id: "implement", type: "agent" },
		workflows: [
			{
				id: "legacy-factory",
				steps: [
					{
						id: "pipeline",
						name: "Pipeline",
						type: "workflow",
						branches: [],
						workflow: "legacy-pipeline",
					},
				],
			},
			{
				id: "legacy-pipeline",
				steps: [
					{ id: "plan", name: "plan", type: "agent", branches: [] },
					{
						id: "plan-review",
						name: "plan-review",
						type: "agent",
						branches: [
							{ when: { path: "approved", equals: false }, next: "plan" },
						],
					},
					{ id: "implement", name: "implement", type: "agent", branches: [] },
				],
			},
		],
		missingWorkflowIds: [],
		decisionAttribution: {
			unnamedOperator: "Factory operator (name not recorded)",
		},
	});
	expect(ctx.run).toEqual(original);
});

it("follows fanout calls, bounds cycles and reports missing accepted definitions as unknown", () => {
	const root = workflow("root", [
		{
			id: "parallel",
			name: "Parallel",
			type: "fanout",
			groups: [
				[{ id: "call", name: "Call", type: "workflow", workflow: "child" }],
				[
					{
						id: "missing",
						name: "Missing",
						type: "workflow",
						workflow: "unavailable",
					},
				],
			],
		},
	]);
	const child = workflow("child", [
		{ id: "back", name: "Back", type: "workflow", workflow: "root" },
	]);
	const result = json(workflowExecutionContext(context(root, [root, child])));
	expect(result.workflows).toEqual([
		{
			id: "root",
			steps: [
				{
					id: "parallel",
					name: "Parallel",
					type: "fanout",
					branches: [],
					groups: [
						[
							{
								id: "call",
								name: "Call",
								type: "workflow",
								workflow: "child",
								branches: [],
							},
						],
						[
							{
								id: "missing",
								name: "Missing",
								type: "workflow",
								workflow: "unavailable",
								branches: [],
							},
						],
					],
				},
			],
		},
		{
			id: "child",
			steps: [
				{
					id: "back",
					name: "Back",
					type: "workflow",
					workflow: "root",
					branches: [],
				},
			],
		},
	]);
	expect(result.missingWorkflowIds).toEqual(["unavailable"]);
});
