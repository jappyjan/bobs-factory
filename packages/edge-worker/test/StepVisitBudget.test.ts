import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	stepVisitLimit,
	upgradeStockStepVisits,
} from "../src/factory/StepVisitBudget.js";
import {
	StepSchema,
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
} from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { newStep } from "../src/factory/web/recipe-graph.js";
import legacyWorkflows from "./fixtures/legacy-workflows-a4990127.json" with {
	type: "json",
};

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function oldStock(): Workflow[] {
	const definitions = legacyWorkflows.default.map((workflow) =>
		WorkflowSchema.parse(workflow),
	);
	const restore = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			step.maxVisits /= 2;
			for (const group of step.groups ?? []) restore(group);
		}
	};
	for (const workflow of definitions) restore(workflow.steps);
	return definitions;
}
function fixture(): FactoryRun {
	const workflowDefinitions = oldStock();
	return {
		id: "budget-fixture",
		title: "Budget fixture",
		repositoryId: "any-repository",
		workspace: "/tmp",
		input: "Retain accepted work",
		workflow: workflowDefinitions.find((w) => w.id === "factory")!,
		workflowDefinitions,
		status: "waiting",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
		questions: ["Keep the accepted requirements?"],
		answers: [],
		outputs: { plan: { plan: "Accepted plan" } },
		history: [{ step: "pipeline/plan", output: "accepted", at: "retained" }],
		events: [],
		checkpoint: {
			current: "pipeline",
			visits: { pipeline: 1 },
			active: {
				phase: "executing",
				children: [
					{
						current: "extract-requirements",
						visits: { "extract-requirements": 39 },
						additionalVisits: { "extract-requirements": 32 },
						active: {
							phase: "executing",
							agent: { runner: "codex", sessionId: "retained-session" },
						},
					},
				],
			},
		},
	};
}

it("doubles original stock budgets once, preserving frozen graphs, grants, checkpoints and human waits", () => {
	const run = fixture();
	const before = structuredClone(run);
	expect(upgradeStockStepVisits(run)).toBe(true);
	const { stepVisitBudget, ...retained } = run;
	expect(retained).toEqual(before);
	expect(stepVisitBudget).toMatchObject({
		version: "stock-step-visits-v1",
		additionalVisits: {
			pipeline: 8,
			"pipeline/extract-requirements": 8,
			"pipeline/review-gate": 100,
			"pipeline/specialist-review/0/security-review": 8,
		},
	});
	const extractor = run
		.workflowDefinitions!.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "extract-requirements")!;
	expect(
		stepVisitLimit(run, "pipeline/extract-requirements", extractor, 32),
	).toBe(48);
	const upgraded = structuredClone(run);
	expect(upgradeStockStepVisits(run)).toBe(false);
	expect(run).toEqual(upgraded);
});

it("recognizes unchanged stock steps in mixed older graphs and preserves custom behavior and local recipes", () => {
	const run = fixture();
	const pipeline = run.workflowDefinitions!.find(
		(w) => w.id === "factory-pipeline",
	)!;
	pipeline.steps.find((s) => s.id === "plan")!.prompt = "Custom planning";
	pipeline.steps.find((s) => s.id === "clarify")!.maxVisits = 3;
	const security = pipeline.steps.find((s) => s.id === "specialist-review")!
		.groups![0][0];
	security.maxVisits = 5;
	expect(upgradeStockStepVisits(run)).toBe(true);
	const grants = run.stepVisitBudget!.additionalVisits;
	expect(grants["pipeline/plan"]).toBeUndefined();
	expect(grants["pipeline/clarify"]).toBeUndefined();
	expect(
		grants["pipeline/specialist-review/0/security-review"],
	).toBeUndefined();
	expect(grants["pipeline/implement"]).toBe(8);
	expect(grants["pipeline/specialist-review/1/architecture-review"]).toBe(8);
	expect(stepVisitLimit(run, "pipeline/clarify", pipeline.steps[0])).toBe(3);
	const local = fixture();
	local.workflow = structuredClone(pipeline);
	local.workflow.id = "local-recipe";
	expect(upgradeStockStepVisits(local)).toBe(false);
	expect(local.stepVisitBudget).toBeUndefined();
});

it.each([
	"completed",
	"stopped",
] as const)("leaves %s historical runs unchanged", (status) => {
	const run = fixture();
	run.status = status;
	const before = structuredClone(run);
	expect(upgradeStockStepVisits(run)).toBe(false);
	expect(run).toEqual(before);
});

it("uses doubled defaults consistently for new stock and editor steps while retaining explicit limits", () => {
	const run = fixture();
	run.workflowDefinitions = structuredClone(defaultWorkflows);
	run.workflow = run.workflowDefinitions.find((w) => w.id === "factory")!;
	expect(upgradeStockStepVisits(run)).toBe(false);
	const raw = { id: "work", name: "Work", type: "agent", prompt: "Work" };
	expect(StepSchema.parse(raw).maxVisits).toBe(16);
	expect(StepSchema.parse({ ...raw, maxVisits: 8 }).maxVisits).toBe(8);
	expect(StepSchema.parse({ ...raw, maxVisits: 200 }).maxVisits).toBe(200);
	expect(StepSchema.safeParse({ ...raw, maxVisits: 201 }).success).toBe(false);
	for (const kind of [
		"agent",
		"script",
		"tool",
		"workflow",
		"human",
		"fanout",
	] as const)
		expect(newStep(kind, "new-step").maxVisits).toBe(16);
	expect(newStep("fanout", "parallel").groups![0][0].maxVisits).toBe(16);
});

it.each([
	"failed",
	"stopped",
] as const)("persists the upgrade across restarts and explicit continuation of %s work uses its saved allowance before granting more passes", async (status) => {
	const home = mkdtempSync(join(tmpdir(), "step-visit-upgrade-"));
	homes.push(home);
	const sessions: (string | undefined)[] = [];
	const hooks = {
		agent: async ({
			resumeAgent,
		}: import("../src/factory/WorkflowRuntime.js").ExecutionContext) => {
			sessions.push(resumeAgent?.sessionId);
			throw new Error("fixture execution reached");
		},
		script: async () => ({}),
		tool: async () => ({}),
	};
	const original = new WorkflowRuntime(home, hooks);
	runtimes.push(original);
	const run = original.create({
		workflow: original.selectWorkflow([], "manual", "factory"),
		repositoryId: "arbitrary-project",
		workspace: home,
		input: "Continue accepted work",
		triggerOrigin: { type: "manual", workflowId: "factory", at: "" },
	});
	const definitions = oldStock();
	run.workflow = definitions.find((w) => w.id === "factory")!;
	run.workflowDefinitions = definitions;
	run.status = status;
	run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "clarify",
					visits: { clarify: 13 },
					additionalVisits: { clarify: 4 },
					active: {
						phase: "executing",
						agent: { runner: "codex", sessionId: "retained-session" },
					},
				},
			],
		},
	};
	run.iterationLimit = { step: "pipeline/clarify", visits: 13, limit: 12 };
	const workflow = structuredClone(run.workflow);
	const checkpoint = structuredClone(run.checkpoint);
	await original.save(run);
	await original.shutdown();
	const restored = new WorkflowRuntime(home, hooks);
	runtimes.push(restored);
	const saved = restored.get(run.id);
	expect(saved.status).toBe(status);
	expect(saved.workflow).toEqual(workflow);
	expect(saved.checkpoint).toEqual(checkpoint);
	if (status === "failed") {
		expect(saved.stepVisitBudget!.additionalVisits["pipeline/clarify"]).toBe(8);
		expect(saved.iterationLimit).toEqual({
			step: "pipeline/clarify",
			visits: 13,
			limit: 20,
		});
	} else expect(saved.stepVisitBudget).toBeUndefined();
	await restored.flush();
	await restored.shutdown();
	const restarted = new WorkflowRuntime(home, hooks);
	runtimes.push(restarted);
	const retried =
		status === "stopped" ? restarted.resume(run.id) : restarted.retry(run.id);
	await vi.waitFor(() => expect(retried.status).toBe("failed"));
	expect(sessions).toEqual(["retained-session"]);
	expect(retried.error).toBe("fixture execution reached");
	expect(retried.checkpoint!.active!.children![0].additionalVisits).toEqual({
		clarify: 4,
	});
	expect(retried.workflow).toEqual(workflow);
	expect(retried.stepVisitBudget!.additionalVisits["pipeline/clarify"]).toBe(8);
	if (status === "failed")
		expect(retried.stepVisitBudget).toEqual(saved.stepVisitBudget);
	await restarted.flush();
	await restarted.shutdown();
	const again = new WorkflowRuntime(home, hooks);
	runtimes.push(again);
	expect(again.get(run.id).stepVisitBudget).toEqual(retried.stepVisitBudget);
});
