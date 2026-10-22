import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digest } from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { checkArgs, resolveStepConfig } from "../src/factory/StepConfig.js";
import {
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
} from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
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
const at = "2026-10-22T01:00:00.000Z";
const native = {
	runner: "codex" as const,
	sessionId: "retained-independent-review",
};
type Gate = "accept-delivery" | "delivery-route";
type Shape = "explicit" | "legacy" | "renamed" | "named-plan";
interface AcceptedScenario {
	workflow: Workflow;
	clarifyId: string;
	planId: string;
	reviewId: string;
	gateId: string;
	readAlias: string;
}
function acceptedScenario(
	shape: Shape,
	gate: Gate = "accept-delivery",
	restricted = false,
): AcceptedScenario {
	const source =
		shape === "legacy"
			? legacyWorkflows.default.find(
					(workflow) => workflow.id === "factory-pipeline",
				)!
			: defaultWorkflows.find(
					(workflow) => workflow.id === "factory-pipeline",
				)!;
	const clarifyId = shape === "renamed" ? "retained-requirements" : "clarify";
	const planId = shape === "renamed" ? "assembled-proposal" : "plan";
	const reviewId = shape === "renamed" ? "independent-audit" : "plan-review";
	const gateId =
		shape === "renamed" ? "record-reviewed-contract" : "delivery-route";
	const readAlias =
		shape === "renamed"
			? "acceptedCandidate"
			: shape === "named-plan"
				? "plan"
				: "scopePlan";
	const clone = (id: string): WorkflowStep =>
		structuredClone(
			source.steps.find((step) => step.id === id)!,
		) as WorkflowStep;
	const clarify = {
		...clone("clarify"),
		id: clarifyId,
		next: planId,
		branches: [],
	};
	const planner = {
		...clone("plan"),
		id: planId,
		next: reviewId,
		branches: [],
	};
	const reviewer = {
		...clone("plan-review"),
		id: reviewId,
		next: gateId,
		branches: [],
	};
	if (shape === "renamed" || shape === "named-plan") {
		reviewer.reads = { [readAlias]: planId };
		reviewer.checks =
			shape === "named-plan"
				? []
				: [{ check: "scope-inputs", sources: { plan: readAlias } }];
	}
	if (restricted) reviewer.inputs = [planId];
	const acceptedGate: WorkflowStep =
		shape === "legacy"
			? { ...clone("delivery-route"), next: "end", branches: [], tool: gate }
			: {
					id: gateId,
					name: "Accept exactly reviewed delivery",
					type: "tool",
					tool: gate,
					reads: {
						plan: planId,
						planReview: reviewId,
						review: reviewId,
						clarify: clarifyId,
					},
					next: "end",
					branches: [],
					maxVisits: 16,
				};
	const decoy =
		shape === "renamed"
			? [
					{
						id: "plan",
						name: "Unrelated ordinary output",
						type: "agent",
						prompt: "Retained unrelated data",
						output: { format: "json-v1" },
						next: clarifyId,
						branches: [],
						maxVisits: 16,
					} as WorkflowStep,
				]
			: [];
	return {
		workflow: WorkflowSchema.parse({
			id: "factory-pipeline",
			name: "Retained compact delivery route",
			description: "",
			labels: [],
			allowedTriggers: ["workflow"],
			...(shape === "legacy"
				? {}
				: { stepConfigVersion: "step-config-v1" as const }),
			steps: [...decoy, clarify, planner, reviewer, acceptedGate],
		}),
		clarifyId,
		planId,
		reviewId,
		gateId,
		readAlias,
	};
}
function contract(reference = "Original retained requirements", version = 1) {
	return {
		format: "delivery-v1" as const,
		version,
		mode: "repository" as const,
		authorization: { status: "authorized" as const, reference },
		executionReference: digest({ runner: "codex", repositoryId: "fixture" }),
		targets: [],
	};
}
function retainedRun(
	scenario: AcceptedScenario,
	candidate = contract(),
): FactoryRun {
	const clarify = {
		questions: [],
		decisions: [],
		requirements: ["Preserve the requested repository change"],
		deliveryMode: "repository",
	};
	const plan = {
		plan: "Preserve the complete requested repository change",
		assets: [],
		deliveryContract: candidate,
	};
	const outputs: Record<string, unknown> = {
		[scenario.clarifyId]: clarify,
		[scenario.planId]: plan,
	};
	if (scenario.planId !== "plan")
		outputs.plan = {
			plan: "Unrelated decoy",
			assets: [],
			deliveryContract: contract("UNRELATED decoy", 71),
		};
	return {
		id: "retained-delivery-candidate",
		title: "Retained independent review",
		repositoryId: "fixture",
		workspace: "",
		runner: "codex",
		input: "Preserve the requested repository change",
		workflow: scenario.workflow,
		workflowDefinitions: [scenario.workflow],
		contractVersion: 2,
		status: "running",
		createdAt: at,
		updatedAt: at,
		outputs,
		history: [
			{ step: scenario.clarifyId, output: clarify, at },
			{ step: scenario.planId, output: plan, at },
		],
		answers: [],
		questions: [],
		events: [],
		checkpoint: {
			current: scenario.reviewId,
			visits: {
				[scenario.clarifyId]: 1,
				[scenario.planId]: 1,
				[scenario.reviewId]: 1,
			},
			agentSessions: { [scenario.reviewId]: { ...native } },
			active: { phase: "executing", agent: { ...native } },
		},
	};
}
interface Observation {
	input: Record<string, unknown>;
	currentScope: Record<string, unknown>;
	bindingInput: Record<string, unknown>;
	resumeAgent: ExecutionContext["resumeAgent"];
}
function persistedRuntime(run: FactoryRun, scenario: AcceptedScenario) {
	const home = mkdtempSync(join(tmpdir(), "delivery-candidate-digest-"));
	homes.push(home);
	mkdirSync(join(home, "factory", "runs"), { recursive: true });
	writeFileSync(
		join(home, "factory", "runs", `${run.id}.json`),
		JSON.stringify(run),
	);
	const definitions = JSON.stringify(run.workflowDefinitions),
		workflow = JSON.stringify(run.workflow);
	const originalReceipts = structuredClone(run.history);
	const observations: Observation[] = [];
	const command = vi.fn(async () => {
		throw new Error("Delivery acceptance must not issue an external command");
	});
	const postComment = vi.fn(async () => {});
	const tools = new FactoryTools({ command, postComment });
	const agent = vi.fn(async (context: ExecutionContext) => {
		if (context.step.id !== scenario.reviewId)
			throw new Error(`Unexpected agent replay: ${context.step.id}`);
		const input = context.input as Record<string, unknown>;
		observations.push({
			input: structuredClone(input),
			currentScope: structuredClone(context.currentScope!()) as Record<
				string,
				unknown
			>,
			bindingInput: structuredClone(
				context.bindingInput!(context.step),
			) as Record<string, unknown>,
			resumeAgent: structuredClone(context.resumeAgent),
		});
		// Reviewers consume the runtime's exact candidate identity; they never calculate one.
		return {
			approved: true,
			feedback: [],
			deliveryContractDigest: input.deliveryCandidateDigest,
		};
	});
	const runtime = new WorkflowRuntime(home, {
		agent,
		tool: (context) => tools.tool(context),
		script: async () => {
			throw new Error("No script in this accepted route");
		},
	});
	runtimes.push(runtime);
	const loaded = runtime.get(run.id);
	return {
		runtime,
		loaded,
		agent,
		observations,
		command,
		postComment,
		assertRetained() {
			expect(JSON.stringify(loaded.workflowDefinitions)).toBe(definitions);
			expect(JSON.stringify(loaded.workflow)).toBe(workflow);
			expect(loaded.history.slice(0, originalReceipts.length)).toEqual(
				originalReceipts,
			);
			expect(loaded.checkpoint!.agentSessions![scenario.reviewId]).toEqual(
				native,
			);
			expect(command).not.toHaveBeenCalled();
			expect(postComment).not.toHaveBeenCalled();
		},
	};
}
function expectSuppliedDigest(observation: Observation, expected: string) {
	expect(observation.input.deliveryCandidateDigest).toBe(expected);
	expect(observation.currentScope.deliveryCandidateDigest).toBe(expected);
	expect(observation.bindingInput.deliveryCandidateDigest).toBe(expected);
	expect(observation.resumeAgent).toEqual(native);
}

describe("runtime-owned delivery candidate digest", () => {
	it.each([
		false,
		true,
	])("loads frozen explicit scopePlan bindings and supplies their exact digest with restricted inputs=%s", async (restricted) => {
		const scenario = acceptedScenario(
			"explicit",
			"accept-delivery",
			restricted,
		);
		const candidate = contract();
		const f = persistedRuntime(retainedRun(scenario, candidate), scenario);
		expect(
			checkArgs(
				f.loaded.workflow.steps.find((step) => step.id === scenario.reviewId)!,
				"scope-inputs",
			)?.sources,
		).toHaveProperty("plan", "scopePlan");
		await f.runtime.launch(f.loaded);
		expect(f.loaded.status, f.loaded.error).toBe("completed");
		expect(f.observations).toHaveLength(1);
		expectSuppliedDigest(f.observations[0]!, digest(candidate));
		expect(f.loaded.delivery?.contract).toEqual(candidate);
		expect(f.loaded.outputs[scenario.reviewId]).toEqual({
			approved: true,
			feedback: [],
			deliveryContractDigest: digest(candidate),
		});
		f.assertRetained();
	});
	it("normalizes a genuinely old saved review in memory without rewriting its definition or native session", async () => {
		const scenario = acceptedScenario("legacy", "delivery-route");
		const f = persistedRuntime(retainedRun(scenario), scenario);
		const review = f.loaded.workflow.steps.find(
			(step) => step.id === scenario.reviewId,
		)!;
		expect(review.reads).toBeUndefined();
		await f.runtime.launch(f.loaded);
		expect(f.loaded.status, f.loaded.error).toBe("completed");
		expect(resolveStepConfig(review).reads.scopePlan?.from).toBe(
			scenario.planId,
		);
		expectSuppliedDigest(f.observations[0]!, digest(contract()));
		f.assertRetained();
	});
	it("uses a fully renamed source and semantic read alias instead of unrelated outputs.plan", async () => {
		const scenario = acceptedScenario("renamed");
		const candidate = contract("Actual renamed candidate");
		const f = persistedRuntime(retainedRun(scenario, candidate), scenario);
		await f.runtime.launch(f.loaded);
		expect(f.loaded.status, f.loaded.error).toBe("completed");
		expectSuppliedDigest(f.observations[0]!, digest(candidate));
		expect(f.observations[0]!.input[scenario.readAlias]).toEqual(
			f.loaded.outputs[scenario.planId],
		);
		expect(
			digest(
				(f.loaded.outputs.plan as { deliveryContract: unknown })
					.deliveryContract,
			),
		).not.toBe(digest(candidate));
		expect(f.loaded.delivery?.contract).toEqual(candidate);
		f.assertRetained();
	});
	it("retains the existing explicitly declared reads.plan partner when no scope plan mapping is configured", async () => {
		const scenario = acceptedScenario("named-plan");
		const f = persistedRuntime(retainedRun(scenario), scenario);
		await f.runtime.launch(f.loaded);
		expect(f.loaded.status, f.loaded.error).toBe("completed");
		expectSuppliedDigest(f.observations[0]!, digest(contract()));
		f.assertRetained();
	});
	it.each([
		"accept-delivery",
		"delivery-route",
	] as const)("%s rejects absent/invalid semantic aliases despite a declared plan decoy", async (gate) => {
		for (const mapping of ["missingCandidateRead", 17]) {
			const scenario = acceptedScenario("renamed", gate);
			const review = scenario.workflow.steps.find(
				(step) => step.id === scenario.reviewId,
			)!;
			review.reads = { ...review.reads, plan: "plan" };
			review.checks = [{ check: "scope-inputs", sources: { plan: mapping } }];
			const f = persistedRuntime(retainedRun(scenario), scenario);
			await f.runtime.launch(f.loaded);
			expect(f.loaded.status).toBe("failed");
			expect(f.loaded.error).toBe(
				"Plan review must confirm the exact delivery contract digest",
			);
			expectSuppliedDigest(f.observations[0]!, digest(undefined));
			expect(f.loaded.delivery).toBeUndefined();
			expect(
				f.loaded.history.some((receipt) => receipt.step === scenario.gateId),
			).toBe(false);
			f.assertRetained();
		}
	});
	it.each([
		"accept-delivery",
		"delivery-route",
	] as const)("%s rejects an honestly echoed review receipt for a different or stale candidate", async (gate) => {
		const scenario = acceptedScenario("renamed", gate);
		const originallyReviewed = contract("Original candidate", 1);
		const original = persistedRuntime(
			retainedRun(scenario, originallyReviewed),
			scenario,
		);
		await original.runtime.launch(original.loaded);
		expect(original.loaded.status, original.loaded.error).toBe("completed");
		const receipt = structuredClone(
			original.loaded.history.find(
				(entry) => entry.step === scenario.reviewId,
			)!,
		);
		expect(receipt.output).toEqual({
			approved: true,
			feedback: [],
			deliveryContractDigest: digest(originallyReviewed),
		});
		for (const candidate of [
			contract("Different candidate", 1),
			contract("Revised candidate", 2),
		]) {
			const saved = retainedRun(scenario, candidate);
			saved.outputs[scenario.reviewId] = structuredClone(receipt.output);
			saved.history.push(structuredClone(receipt));
			saved.checkpoint!.current = scenario.gateId;
			saved.checkpoint!.visits[scenario.gateId] = 1;
			saved.checkpoint!.active = { phase: "executing" };
			const f = persistedRuntime(saved, scenario);
			await f.runtime.launch(f.loaded);
			expect(f.loaded.status).toBe("failed");
			expect(f.loaded.error).toBe(
				"Plan review must confirm the exact delivery contract digest",
			);
			expect(f.agent).not.toHaveBeenCalled();
			expect(f.loaded.outputs[scenario.reviewId]).toEqual(receipt.output);
			expect(f.loaded.delivery).toBeUndefined();
			expect(
				f.loaded.history.some((entry) => entry.step === scenario.gateId),
			).toBe(false);
			f.assertRetained();
		}
		original.assertRetained();
	});
});
