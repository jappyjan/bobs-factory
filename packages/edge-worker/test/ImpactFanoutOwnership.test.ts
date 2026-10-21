import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { type ImpactDecision, impactFanout } from "../src/factory/Impact.js";
import { qaDigest } from "../src/factory/Qa.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

it("resolves impact fanout configuration only in its exact accepted call frame", () => {
	const child = (id: string, source: string) => ({
		id,
		name: id,
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		steps: [
			{
				id: source,
				name: source,
				type: "agent",
				prompt: "Extract inventory",
				next: "experts",
			},
			{
				id: "experts",
				name: "Independent reviewers",
				type: "fanout",
				reads: { inventory: source },
				groups: [
					[
						{
							id: "security",
							name: "Security",
							type: "agent",
							prompt: "Review security",
							output: { format: "specialist-v1" },
						},
					],
				],
			},
		],
	});
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "frame-owner",
			name: "Owner",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "first",
					name: "First",
					type: "workflow",
					workflow: "first-child",
					next: "second",
				},
				{
					id: "second",
					name: "Second",
					type: "workflow",
					workflow: "second-child",
				},
			],
		},
		child("first-child", "first-data"),
		child("second-child", "second-data"),
	]);
	const expected = definitions.find((w) => w.id === "second-child")!.steps[1]!;
	const context = {
		run: {
			workflow: definitions.find((w) => w.id === "frame-owner")!,
			workflowDefinitions: definitions,
		},
	} as ExecutionContext;
	const reviewers = expected.groups!.flat().map((role) => ({
		id: role.id,
		name: role.name,
		contract: "specialist-v1",
		promptDigest: qaDigest({
			prompt: role.prompt,
			runner: role.runner,
			model: role.model,
		}),
	}));
	const decision = {
		snapshot: { key: "second/experts", reviewers },
	} as ImpactDecision;
	expect(impactFanout(context, decision)).toBe(expected);
	decision.snapshot.key = "unaccepted/experts";
	expect(() => impactFanout(context, decision)).toThrow(
		"Accepted impact reviewer configuration is unavailable",
	);
});
