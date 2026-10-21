import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parseStepOutput } from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { resolveStepConfig } from "../src/factory/StepConfig.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import legacyWorkflows from "./fixtures/legacy-workflows-a4990127.json" with {
	type: "json",
};
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

it("loads raw frozen Factory definitions and resumes their output validation and human-answer lifecycle after restart", async () => {
	const home = mkdtempSync(join(tmpdir(), "legacy-step-resume-"));
	homes.push(home);
	const definitions = structuredClone(legacyWorkflows.default);
	const workflow = definitions.find(
		(definition) => definition.id === "factory",
	)!;
	const definitionBytes = JSON.stringify(definitions);
	const at = "2026-10-20T10:00:00.000Z";
	const run = {
		id: "legacy-factory-resume",
		title: "Resume accepted implementation",
		repositoryId: "fixture",
		workspace: home,
		input: "Keep accepted requirements",
		workflow,
		workflowDefinitions: definitions,
		status: "running",
		createdAt: at,
		updatedAt: at,
		answers: [],
		outputs: { plan: { plan: "Accepted plan" } },
		history: [{ step: "pipeline/plan", output: { plan: "Accepted plan" }, at }],
		events: [],
		checkpoint: {
			current: "pipeline",
			visits: { pipeline: 1 },
			active: {
				phase: "executing",
				children: [
					{
						current: "implement",
						visits: { implement: 1 },
						active: {
							phase: "executing",
							agent: { runner: "codex", sessionId: "saved-implementation" },
						},
					},
				],
			},
		},
	};
	mkdirSync(join(home, "factory", "runs"), { recursive: true });
	writeFileSync(
		join(home, "factory", "runs", `${run.id}.json`),
		JSON.stringify(run),
	);
	let attempts = 0;
	const first = new WorkflowRuntime(home, {
		agent: async (context) => {
			expect(context.step.id).toBe("implement");
			expect(context.resumeAgent?.sessionId).toBe("saved-implementation");
			attempts++;
			// The native executor uses this parser before returning a role result.
			expect(() =>
				parseStepOutput(context.step, {
					status: "blocked",
					summary: "Need fixture access",
					checks: [],
					questions: [],
				}),
			).toThrow(OutputValidationError);
			return parseStepOutput(context.step, {
				status: "blocked",
				summary: "Need fixture access",
				checks: [],
				questions: ["Restore fixture access?"],
			});
		},
		script: async () => ({}),
		tool: async () => {
			throw new Error("No publication before the answer");
		},
	});
	runtimes.push(first);
	const loaded = first.get(run.id);
	const execution = first.launch(loaded);
	await waitForRuntime(() => {
		expect(loaded.error).toBeUndefined();
		expect(loaded.status).toBe("waiting");
	});
	expect(attempts).toBe(1);
	expect(loaded.questions).toEqual(["Restore fixture access?"]);
	expect(JSON.stringify(loaded.workflowDefinitions)).toBe(definitionBytes);
	await first.shutdown();
	await execution;
	await first.flush();

	let publicationReached = false;
	const resumed = new WorkflowRuntime(home, {
		agent: async (context) => {
			expect(context.step.id).toBe("implement");
			expect(context.run.answers.at(-1)?.answer).toBe(
				"Fixture access restored",
			);
			expect(resolveStepConfig(context.step).output).toEqual({
				format: "implement-v1",
			});
			return parseStepOutput(context.step, {
				status: "completed",
				summary: "Implementation complete",
				checks: ["fixture verified"],
				questions: [],
			});
		},
		script: async () => ({}),
		tool: async (context: ExecutionContext) => {
			expect(context.step.tool).toBe("draft-pr");
			publicationReached = true;
			return new Promise((resolve) =>
				context.signal.addEventListener("abort", () => resolve({}), {
					once: true,
				}),
			);
		},
	});
	runtimes.push(resumed);
	const restored = resumed.get(run.id);
	const resumedExecution = resumed.launch(restored);
	await waitForRuntime(() => expect(restored.status).toBe("waiting"));
	expect(restored.questions).toEqual(["Restore fixture access?"]);
	resumed.answer(restored.id, "Fixture access restored");
	await waitForRuntime(() => expect(publicationReached).toBe(true));
	expect(restored.outputs.implement).toEqual({
		status: "completed",
		summary: "Implementation complete",
		checks: ["fixture verified"],
		questions: [],
	});
	expect(
		restored.history.filter((receipt) => receipt.step === "pipeline/plan"),
	).toHaveLength(1);
	expect(JSON.stringify(restored.workflowDefinitions)).toBe(definitionBytes);
	// Publication is intentionally held: this regression proves resume through the next accepted action without creating a PR.
	await resumed.shutdown();
	await resumedExecution;
});

it.each([
	{ modern: false, gate: {}, includeAnswers: false },
	{ modern: false, gate: { captureBlocked: true }, includeAnswers: true },
	{ modern: false, gate: { qaBlocked: true }, includeAnswers: true },
	{ modern: true, gate: {}, includeAnswers: false },
	{ modern: true, gate: { captureBlocked: true }, includeAnswers: true },
])("retains conditional answers in restricted capture inputs (%j)", async ({
	modern,
	gate,
	includeAnswers,
}) => {
	const home = mkdtempSync(join(tmpdir(), "conditional-capture-inputs-"));
	homes.push(home);
	const workflow = WorkflowSchema.parse({
		id: "frozen-capture-fork",
		name: "Capture fork",
		...(modern ? { stepConfigVersion: "step-config-v1" } : {}),
		steps: [
			{
				id: "capture",
				name: "Record evidence",
				type: "agent",
				prompt: "Record",
				inputs: ["visual-scope"],
				...(modern
					? {
							reads: {
								answers: {
									from: "@answers",
									when: { path: "/visual-gate/captureBlocked", equals: true },
								},
							},
						}
					: {}),
			},
		],
	});
	let capturedInput: unknown;
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			capturedInput = context.input;
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		title: "Capture",
		repositoryId: "fixture",
		workspace: home,
		input: "Record evidence",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-20T10:00:00.000Z",
		},
	});
	run.outputs["visual-scope"] = { changed: false, areas: [] };
	run.outputs["visual-gate"] = gate;
	run.answers.push({
		questions: ["Restore fixture?"],
		answer: "Restored",
		at: "2026-10-20T10:00:00.000Z",
	});
	await runtime.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(Object.hasOwn(capturedInput as object, "answers")).toBe(
		includeAnswers,
	);
	if (includeAnswers)
		expect((capturedInput as { answers: unknown }).answers).toEqual(
			run.answers,
		);
});
