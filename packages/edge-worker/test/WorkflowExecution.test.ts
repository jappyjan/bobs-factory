import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { workflowExecutionContext } from "../src/factory/WorkflowExecution.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const workflow = (id: string, steps: unknown[]) =>
	WorkflowSchema.parse({ id, name: id, steps });
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
		answers: [],
		architectureDecisions: [],
		humanDecisions: [],
		decisionAttribution: {
			unnamedOperator: "Factory operator (name not recorded)",
		},
	});
	expect(ctx.run).toEqual(original);
});

it("exposes original unnamed operator receipts without inferring approval from other role outputs", () => {
	const root = workflow("saved", [role("extract-requirements")]);
	const ctx = context(root);
	ctx.run.answers = [
		{
			questions: ["Deliver software now or wait for hardware?"],
			answer:
				"Deliver software; defer hardware qualification and block rollout.",
			at: "2026-10-17T06:34:41.752Z",
		},
	];
	ctx.run.humanDecisions = [
		{
			reviewId: "review-1",
			headSha: "head",
			decision: "reject",
			feedback: "Keep production rollout blocked",
			at: "2026-10-18T06:34:41.752Z",
		},
	];
	ctx.run.outputs = { "plan-review": { approved: true } };
	const original = structuredClone(ctx.run);
	const result = workflowExecutionContext(ctx);
	expect(result.answers).toEqual(original.answers);
	expect(result.humanDecisions).toEqual(original.humanDecisions);
	expect(result.architectureDecisions).toEqual([]);
	expect(result.decisionAttribution).toEqual({
		unnamedOperator: "Factory operator (name not recorded)",
	});
	result.answers[0]!.answer = "changed";
	result.humanDecisions[0]!.decision = "approve";
	expect(ctx.run).toEqual(original);
});

it("retains renamed architecture contracts, gate policies and actual decisions without fabricating acceptance", () => {
	const root = workflow("custom", [
		{ ...role("design"), architectureContract: "architecture-v1" },
		{
			...role("assess"),
			architectureContract: "architecture-review-v1",
			architectureSource: "design",
		},
		{
			id: "decision",
			name: "Decision",
			type: "tool",
			tool: "architecture-decision",
			args: [],
			arguments: { proposal: "design", review: "assess", approval: "always" },
			next: "build",
		},
		role("build"),
	]);
	const ctx = context(root);
	ctx.run.architectureDecisions = [
		{
			proposalId: "proposal",
			version: 2,
			digest: "accepted-digest",
			decision: "accept",
			at: "accepted-at",
		},
	];
	const result = json(workflowExecutionContext(ctx));
	expect(result.workflows).toEqual([
		{
			id: "custom",
			steps: [
				{
					id: "design",
					name: "design",
					type: "agent",
					branches: [],
					architectureContract: "architecture-v1",
				},
				{
					id: "assess",
					name: "assess",
					type: "agent",
					branches: [],
					architectureContract: "architecture-review-v1",
					architectureSource: "design",
				},
				{
					id: "decision",
					name: "Decision",
					type: "tool",
					branches: [],
					tool: "architecture-decision",
					args: [],
					arguments: {
						proposal: "design",
						review: "assess",
						approval: "always",
					},
					next: "build",
				},
				{ id: "build", name: "build", type: "agent", branches: [] },
			],
		},
	]);
	expect(result.architectureDecisions).toEqual(ctx.run.architectureDecisions);
	expect(result.humanDecisions).toEqual([]);
	result.architectureDecisions[0].decision = "revise";
	expect(ctx.run.architectureDecisions[0]!.decision).toBe("accept");
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
