import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	conservativeWorkflows,
	defaultWorkflows,
	upgradedArchitectureSteps,
	upgradedGuideStep,
} from "../src/factory/defaultWorkflows.js";
import { incrementalInstructions } from "../src/factory/Incremental.js";
import { renderInstructionTemplate } from "../src/factory/InstructionLibrary.js";
import {
	feedbackPolicyInstructions,
	implementationScopeInstructions,
} from "../src/factory/InstructionText.js";
import {
	factoryNativePrompt,
	factoryRoleInstruction,
	withRuntimeRolePrompt,
} from "../src/factory/RolePrompt.js";
import { registerWorkflowConfig } from "../src/factory/StepConfig.js";
import {
	StepSchema,
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
	workflowTriggerInstructions,
} from "../src/factory/Workflow.js";
import { workflowExecutionInstructions } from "../src/factory/WorkflowExecution.js";

/**
 * Complete current stock and frozen legacy role prompts. Regenerate only for an
 * intentional prompt change; the frozen legacy prompts must remain identical:
 * UPDATE_ROLE_PROMPTS=1 pnpm vitest run test/FactoryRolePrompts.test.ts
 */
const promptFixture = join(__dirname, "fixtures/stock-role-prompts.json");
/**
 * Frozen copy of the base stock definitions (defaultWorkflows,
 * conservativeWorkflows and legacyReviewSteps at a4990127). These are real
 * old-shaped definitions carrying the legacy contract flags; never regenerate.
 */
const legacyFixture = join(
	__dirname,
	"fixtures/legacy-workflows-a4990127.json",
);
const parts = {
	repositoryScope: "<repository scope>",
	gitProvider: '{"gitProvider":"github"}',
	customProviderInstructions: "",
	ticket: "none",
	questions: "<question instructions>",
};

function prompts(workflows: Workflow[], set: string) {
	const result: Record<string, string> = {};
	const walk = (steps: WorkflowStep[], path: string) => {
		for (const step of steps) {
			const key = `${path}/${step.id}`;
			if (step.type === "agent")
				for (const [variant, options] of [
					["base", { assessedCorrection: false, calibratedReview: false }],
					["runtime", { assessedCorrection: true, calibratedReview: true }],
				] as const) {
					result[`${set}${key}#${variant}`] = factoryRoleInstruction(
						withRuntimeRolePrompt(step, steps, options),
						parts,
					);
				}
			if (step.type === "agent")
				result[`${set}${key}#native`] = factoryNativePrompt(step, {
					outputCorrection: false,
					captureCorrection: false,
					resumed: false,
					evidenceDir: "/evidence",
				});
			for (const [index, group] of (step.groups ?? []).entries())
				walk(group, `${key}/${index}`);
			if (step.body) walk(step.body, `${key}/body`);
		}
	};
	for (const workflow of workflows) {
		registerWorkflowConfig(workflow);
		walk(workflow.steps, `/${workflow.id}`);
	}
	return result;
}

/** Derived definitions the runtime installs for pending stock work. */
function upgraded(workflows: Workflow[]): Workflow[] {
	return workflows.flatMap((workflow) => {
		const guide = workflow.steps.map((step) => upgradedGuideStep(step) ?? step);
		const architecture = upgradedArchitectureSteps(workflow.steps);
		return [
			{ ...workflow, steps: guide },
			...(architecture ? [{ ...workflow, steps: architecture }] : []),
		];
	});
}

function legacyDefinitions(): Record<string, Workflow[]> {
	const raw = JSON.parse(readFileSync(legacyFixture, "utf8")) as Record<
		string,
		unknown[]
	>;
	return {
		default: raw.default!.map((w) => WorkflowSchema.parse(w)),
		conservative: raw.conservative!.map((w) => WorkflowSchema.parse(w)),
		legacyReview: [
			{
				...WorkflowSchema.parse(raw.conservative![3]),
				steps: raw.legacyReview!.map((s) => StepSchema.parse(s)),
			},
		],
	};
}

it("asserts complete stock and frozen legacy Factory role prompts", () => {
	const legacy = legacyDefinitions();
	const sets: Record<string, Workflow[]> = {
		stock: defaultWorkflows,
		"stock-upgraded": upgraded(defaultWorkflows),
		conservative: conservativeWorkflows,
		"legacy-default": legacy.default!,
		"legacy-default-upgraded": upgraded(legacy.default!),
		"legacy-conservative": legacy.conservative!,
		"legacy-review": legacy.legacyReview!,
	};
	const actual = Object.assign(
		{},
		...Object.entries(sets).map(([set, workflows]) => prompts(workflows, set)),
	);
	if (process.env.UPDATE_ROLE_PROMPTS) {
		writeFileSync(
			promptFixture,
			`${JSON.stringify(compact(actual), null, "\t")}\n`,
		);
		return;
	}
	const expected = expand(JSON.parse(readFileSync(promptFixture, "utf8")));
	expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
	for (const key of Object.keys(expected)) {
		expect({ key, prompt: actual[key] }).toEqual({
			key,
			prompt: expected[key],
		});
	}
});

it("applies selected shared snippets without requiring prompt tokens and preserves explicit slot placement", () => {
	const step = {
		configVersion: "step-config-v1",
		instructions: [
			"implementation-scope",
			"feedback-policy",
			"review-completion",
		],
	};
	expect(renderInstructionTemplate(step, "Execute the role.")).toBe(
		`Execute the role.\n${implementationScopeInstructions}\n${feedbackPolicyInstructions}`,
	);
	expect(
		renderInstructionTemplate(
			step,
			"First {{instruction:feedback-policy}} then {{instruction:implementation-scope}}.",
		),
	).toBe(
		`First ${feedbackPolicyInstructions} then ${implementationScopeInstructions}.`,
	);
});

/**
 * The fixture stores each distinct prompt once and keeps the large shared
 * reference texts as tokens; expansion restores the exact full prompt.
 */
const shared: [string, string][] = [
	["{{workflowTriggerInstructions}}", workflowTriggerInstructions],
	["{{workflowExecutionInstructions}}", workflowExecutionInstructions],
	["{{incrementalInstructions}}", incrementalInstructions],
];
function compact(prompts: Record<string, string>) {
	const texts: string[] = [];
	const keys: Record<string, number> = {};
	for (const [key, prompt] of Object.entries(prompts).sort()) {
		let text = prompt;
		for (const [token, value] of shared) text = text.split(value).join(token);
		const index = texts.indexOf(text);
		keys[key] = index >= 0 ? index : texts.push(text) - 1;
	}
	return { keys, texts };
}
function expand(fixture: { keys: Record<string, number>; texts: string[] }) {
	return Object.fromEntries(
		Object.entries(fixture.keys).map(([key, index]) => {
			let text = fixture.texts[index]!;
			for (const [token, value] of shared) text = text.split(token).join(value);
			return [key, text];
		}),
	);
}
