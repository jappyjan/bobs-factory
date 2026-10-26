import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	parseStepOutput,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

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
	{ output: { schema: custom }, rules: [], instructions: [] },
])("keeps ordinary protocol-like fields as data with settings %j", async (settings) => {
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
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
		expect(run.questions).toBeUndefined();
		expect(run.architectureProposals ?? []).toEqual([]);
		expect(run.history.map((entry) => entry.step)).toEqual(["implement"]);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
