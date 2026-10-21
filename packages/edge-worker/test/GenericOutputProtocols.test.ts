import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	parseStepOutput,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { hasCheck } from "../src/factory/StepConfig.js";
import {
	validateWorkflows,
	type WorkflowStep,
} from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { proposal } from "./fixtures/architecture.js";

const ordinary = {
	architectureRevision: true,
	questions: 42,
	questionChoices: { category: "ordinary data" },
	questionRecommendations: "score",
	ciAssistance: ["ordinary data"],
	reviewBlocked: true,
	reviewIncomplete: true,
	captureBlocked: true,
	qaBlocked: true,
	qaRetry: true,
};
const custom = {
	type: "object",
	properties: {
		architectureRevision: { type: "boolean" },
		questions: { type: "integer" },
		questionChoices: { type: "object" },
		questionRecommendations: { type: "string" },
	},
	required: ["questions", "architectureRevision"],
};

it.each([
	{},
	{ reads: {} },
	{ output: { format: "json-v1" as const } },
	{ output: { schema: custom }, checks: [], rules: [], instructions: [] },
])("keeps ordinary protocol-like fields as data with settings %j", async (settings) => {
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "plain-data",
			name: "Plain data",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "implement",
					name: "Data",
					type: "agent",
					prompt: "Return data",
					...settings,
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const step = workflow.steps[0]!;
	expect(parseStepOutput(step, ordinary)).toEqual(ordinary);
	expect(await parseStepOutputAsync(step, ordinary)).toEqual(ordinary);
	const home = mkdtempSync(join(tmpdir(), "generic-output-protocols-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => parseStepOutputAsync(context.step, ordinary),
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const run = runtime.create({
			repositoryId: "repo",
			workspace: home,
			workflow,
			input: "Return data",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.status).toBe("completed");
		expect(run.error).toBeUndefined();
		expect(run.outputs.implement).toEqual(ordinary);
		expect(run.questions).toEqual([]);
		expect(run.architectureProposals ?? []).toEqual([]);
		expect(run.history.map((entry) => entry.step)).toEqual(["implement"]);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	{ askQuestions: true },
	{ checks: ["optional-questions" as const] },
	{ output: { format: "question-fields-v1" as const } },
])("normalizes and validates human fields only for a declared question protocol %j", async (settings) => {
	const step = {
		id: "custom",
		name: "Question",
		type: "agent",
		prompt: "Ask",
		configVersion: "step-config-v1" as const,
		...settings,
	};
	const output = {
		questions: ["Which approach?"],
		questionRecommendations: [
			{
				questionIndex: 0,
				answer: " Use existing ",
				reason: " Already supported ",
			},
		],
	};
	const expected = {
		questions: ["Which approach?"],
		questionRecommendations: [
			{ questionIndex: 0, answer: "Use existing", reason: "Already supported" },
		],
	};
	expect(parseStepOutput(step, output)).toEqual(expected);
	expect(await parseStepOutputAsync(step, output)).toEqual(expected);
	expect(() => parseStepOutput(step, { questions: 42 })).toThrow(
		OutputValidationError,
	);
	await expect(
		parseStepOutputAsync(step, { questions: 42 }),
	).rejects.toBeInstanceOf(OutputValidationError);
});

it("retains inline-schema question capability through async validation", async () => {
	const step = {
		id: "choice",
		name: "Choice",
		type: "agent",
		prompt: "Ask",
		checks: ["optional-questions" as const],
		output: { schema: { type: "object" } },
	};
	const value = {
		questions: ["Which?"],
		questionChoices: [
			{
				questionIndex: 0,
				selection: "single",
				options: [
					{ id: "a", answer: " A " },
					{ id: "b", answer: " B " },
				],
			},
		],
	};
	expect(await parseStepOutputAsync(step, value)).toEqual({
		questions: ["Which?"],
		questionChoices: [
			{
				questionIndex: 0,
				selection: "single",
				options: [
					{ id: "a", answer: "A" },
					{ id: "b", answer: "B" },
				],
			},
		],
	});
});

it.each([
	true,
	false,
])("uses the explicit architecture capability (%s), even with a proposal decision present", async (enabled) => {
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "explicit-handback",
			name: "Handback",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "draft",
					type: "agent",
					name: "Design",
					prompt: "Design",
					output: { format: "architecture-v1" },
					checks: ["architecture-proposal"],
				},
				{
					id: "assess",
					type: "agent",
					name: "Assess",
					prompt: "Assess",
					output: { format: "architecture-review-v1" },
					checks: ["architecture-candidate"],
					reads: { proposal: "draft" },
				},
				{
					id: "accept",
					type: "tool",
					name: "Accept",
					tool: "architecture-decision",
					reads: {
						proposal: "draft",
						review: "assess",
						revise: "draft",
						planOutput: "build",
					},
				},
				{
					id: "build",
					type: "agent",
					name: "Build",
					prompt: "Build",
					output: { format: "implement-v1" },
					checks: enabled ? ["architecture-revision"] : [],
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const home = mkdtempSync(join(tmpdir(), "declared-handback-"));
	let builds = 0,
		proposals = 0;
	const runtime = new WorkflowRuntime(home, {
		agent: async ({ step }) => {
			if (hasCheck(step, "architecture-proposal")) {
				proposals++;
				return proposal("routine");
			}
			if (hasCheck(step, "architecture-candidate"))
				return { approved: true, feedback: [] };
			builds++;
			return parseStepOutputAsync(step, {
				status: builds === 1 ? "blocked" : "completed",
				architectureRevision: builds === 1,
				summary: "Update",
				checks: [],
				questions: [],
			});
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const run = runtime.create({
			repositoryId: "repo",
			workspace: home,
			workflow,
			input: "Build",
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(builds).toBe(enabled ? 2 : 1);
		expect(proposals).toBe(enabled ? 2 : 1);
		const phase = ["draft", "assess", "accept", "build"];
		expect(run.history.map((entry) => entry.step)).toEqual(
			enabled ? [...phase, ...phase] : phase,
		);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("rejects only an opted-in architecture role without a configured local proposal association", () => {
	const steps: WorkflowStep[] = [
		{
			id: "data",
			name: "Data",
			type: "agent",
			prompt: "Return data",
			branches: [],
			maxVisits: 5,
			checks: ["architecture-revision"],
		},
	];
	expect(() =>
		validateWorkflows([
			{
				id: "unbound-handback",
				name: "Handback",
				stepConfigVersion: "step-config-v1",
				steps,
			},
		]),
	).toThrow("architecture-revision requires a local architecture decision");
});
