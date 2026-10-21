import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateCheckAsync } from "../src/factory/Check.js";
import { installStockChecks } from "../src/factory/CheckPresets.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { captureEvidence, FactoryTools } from "../src/factory/FactoryTools.js";
import { qaDigest } from "../src/factory/Qa.js";
import {
	registerWorkflowConfig,
	resolveStepConfig,
} from "../src/factory/StepConfig.js";
import type { WorkflowStep } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { qaExecution, qaScope } from "./fixtures/qa.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function legacyStep(tool: string): WorkflowStep {
	const step: WorkflowStep = {
		id: tool,
		name: tool,
		type: "tool",
		tool,
		branches: [],
		maxVisits: 8,
		...(tool === "visual-gate" ? { qaContract: "qa-v1" as const } : {}),
	};
	registerWorkflowConfig({ id: "factory-pipeline", steps: [step] }, "factory");
	return step;
}

function modernGraph(legacy: WorkflowStep): WorkflowStep[] {
	const configuration = resolveStepConfig(legacy);
	const step: WorkflowStep = {
		...structuredClone(legacy),
		configVersion: "step-config-v1",
		reads: structuredClone(configuration.reads),
		checks: configuration.checks.map(({ check, args }) =>
			Object.keys(args).length ? { check, ...args } : check,
		),
	};
	const steps = [step];
	installStockChecks(steps);
	expect(step.type).toBe("check");
	expect(step.tool).toBeUndefined();
	return steps;
}

function modernStep(legacy: WorkflowStep): WorkflowStep {
	return modernGraph(legacy).find((step) => step.type === "check")!;
}

function context(tool = "review-gate"): ExecutionContext {
	const home = mkdtempSync(join(tmpdir(), "stock-check-equivalence-"));
	homes.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		title: "Save a record",
		repositoryId: "repo",
		workspace: home,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				workspace: home,
				repositoryPath: home,
				baseBranch: "main",
				githubUrl: "https://github.com/test/repo",
			},
		],
		workflow: defaultWorkflows.find((workflow) => workflow.id === "factory")!,
		input: "Persist a record",
		triggerOrigin: { type: "manual", workflowId: "factory" },
	});
	run.step = tool;
	return {
		run,
		step: legacyStep(tool),
		input: {},
		evidenceDir: home,
		signal: new AbortController().signal,
		log: () => {},
	};
}

const qaTools = () =>
	new FactoryTools({
		postComment: async () => {},
		command: async (_context, _executable, args) =>
			args[0] === "status" ? "" : "head",
	});

function qaContext(surface: "api" | "cli" | "ui" = "api") {
	const ctx = context("visual-gate");
	ctx.run.outputs.clarify = {
		requirements: ["Persist a record"],
		decisions: [],
	};
	ctx.run.outputs["visual-scope"] = qaScope(surface);
	ctx.run.roleRevisions = Object.fromEntries(
		["visual-scope", "capture", "visual-review"].map((id) => [
			id,
			{ headSha: "head", dirty: false, at: "now", historyLength: 0 },
		]),
	);
	ctx.progress = {
		visit: 1,
		changedFiles: [],
		unchangedCode: false,
		uncertain: true,
		newHistory: [],
		currentRevision: {
			headSha: "head",
			dirty: false,
			at: "now",
			historyLength: 0,
		},
	};
	return ctx;
}

function stampQa(ctx: ExecutionContext, output = qaExecution()) {
	const capture = { ...ctx.step, id: "capture", type: "agent" as const };
	registerWorkflowConfig(
		{ id: "factory-pipeline", steps: [capture] },
		"factory",
	);
	ctx.run.outputs.capture = captureEvidence({ ...ctx, step: capture }, output);
	ctx.run.outputs["visual-review"] = {
		status: "completed",
		qaContract: "qa-v1",
		blockers: [],
		findings: [],
		summary: "Inspected actual receipts",
		acceptedScreenshots: [],
		qaReviewStamp: {
			headSha: "head",
			dirty: false,
			scopeHash: qaDigest(ctx.run.outputs["visual-scope"]),
			captureHash: qaDigest(ctx.run.outputs.capture),
		},
	};
}

type Decision = Record<string, unknown>;
function outcome(output: unknown) {
	const result = output as Decision;
	return {
		approved: result.approved === true,
		findings: result.findings ?? [],
		questions: result.questions ?? [],
		reviewIncomplete: result.reviewIncomplete === true,
		reviewBlocked: result.reviewBlocked === true,
		qaRetry: result.qaRetry === true,
		qaBlocked: result.qaBlocked === true,
		captureBlocked: result.captureBlocked === true,
	};
}

async function equivalentGate(ctx: ExecutionContext, tools = qaTools()) {
	const legacy = await tools.tool(ctx);
	const step = modernStep(ctx.step);
	const evidence = await tools.evidence({ ...ctx, step });
	const checked = await evaluateCheckAsync(step.check!, {}, evidence);
	expect(outcome(checked)).toEqual(outcome(legacy));
	expect(checked.passed).toBe(outcome(legacy).approved);
	expect(checked).not.toHaveProperty("next");
	return checked;
}

describe("legacy decision handler and stock Check equivalence", () => {
	it.each([
		["nitpick", 1, "open", true],
		["consequential", 2, "open", false],
		["resolved", 3, "resolved", true],
		["accepted rejection", 3, "accepted-rejection", true],
	] as const)("preserves %s review findings", async (_name, rating, status, approved) => {
		const ctx = context();
		ctx.run.outputs["code-review"] = {
			status: "completed",
			blockers: [],
			summary: "Reviewed",
			findings: [
				{
					id: "finding",
					rating,
					status,
					summary: "Behavior",
					evidence: "record.ts:4",
					...(status !== "open"
						? { reason: "Readback proves the complaint was settled" }
						: {}),
				},
			],
		};
		const checked = await equivalentGate(ctx);
		expect(checked.approved).toBe(approved);
		expect((checked.findings as unknown[]).length).toBe(approved ? 0 : 1);
	});

	it.each([
		"blocked",
		"failed",
	] as const)("never approves incomplete %s reviewers", async (status) => {
		const ctx = context();
		ctx.run.outputs["code-review"] = {
			status,
			blockers: ["Missing diff access"],
			summary: "Cannot inspect",
			findings: [],
		};
		const checked = await equivalentGate(ctx);
		expect(checked).toMatchObject({
			approved: false,
			reviewIncomplete: true,
			questions: [expect.stringContaining("Missing diff access")],
		});
	});

	it.each([
		"api",
		"cli",
	] as const)("preserves passed %s evidence without artificial screenshots", async (surface) => {
		const ctx = qaContext(surface);
		stampQa(ctx);
		expect(await equivalentGate(ctx)).toMatchObject({
			passed: true,
			approved: true,
		});
	});

	it.each([
		"failed",
		"blocked",
	] as const)("preserves %s criterion handling", async (result) => {
		const ctx = qaContext();
		stampQa(ctx, qaExecution(result));
		const checked = await equivalentGate(ctx);
		expect(checked.approved).toBe(false);
		if (result === "failed")
			expect(checked.findings).toEqual([
				expect.objectContaining({ criterionId: "saved", rating: 3 }),
			]);
		else
			expect(checked).toMatchObject({
				qaBlocked: true,
				questions: [expect.stringContaining("Test account unavailable")],
			});
	});

	it.each([
		"failed",
		"blocked",
	] as const)("retains confirmed product failures when the QA reviewer is %s, then requires its missing review", async (status) => {
		const ctx = qaContext();
		stampQa(ctx, qaExecution("failed"));
		Object.assign(ctx.run.outputs["visual-review"] as object, {
			status,
			blockers: ["Cannot approve failed behavior"],
		});
		const failed = await equivalentGate(ctx);
		expect(failed.approved).toBe(false);
		expect(failed.findings).toEqual([
			expect.objectContaining({ criterionId: "saved" }),
		]);
		expect(failed.reviewIncomplete).toBe(false);
		expect(outcome(failed).questions).toEqual([]);
		stampQa(ctx);
		Object.assign(ctx.run.outputs["visual-review"] as object, {
			status,
			blockers: ["Missing required diff access"],
		});
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			reviewIncomplete: true,
			questions: [expect.stringContaining("Missing required diff access")],
		});
	});

	it.each([
		"missing-stamp",
		"stale-capture",
		"stale-scope",
		"wrong-frame",
	] as const)("rejects %s provenance even when role data claims pass", async (scenario) => {
		const ctx = qaContext();
		stampQa(ctx);
		if (scenario === "missing-stamp")
			delete (ctx.run.outputs.capture as Record<string, unknown>)
				.testedRevision;
		if (scenario === "stale-capture")
			ctx.run.roleRevisions!.capture!.headSha = "old";
		if (scenario === "stale-scope")
			(ctx.run.outputs["visual-scope"] as ReturnType<typeof qaScope>)
				.stories[0]!.criteria[0]!.expected = "A newly changed expectation";
		if (scenario === "wrong-frame") ctx.stepKey = "nested/visual-gate";
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			qaRetry: true,
		});
	});

	it("accepts the exact capture and reviewer frame after rejecting identical leaf receipts from a sibling", async () => {
		const ctx = qaContext();
		stampQa(ctx);
		ctx.stepKey = "nested/visual-gate";
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			qaRetry: true,
		});
		for (const role of ["capture", "visual-review"])
			ctx.run.roleRevisions![`nested/${role}`] = structuredClone(
				ctx.run.roleRevisions![role]!,
			);
		expect(await equivalentGate(ctx)).toMatchObject({ approved: true });
	});

	it("preserves selected screenshot completeness, exact acceptance hash and changed-byte rejection", async () => {
		const ctx = qaContext("ui");
		execFileSync("git", ["init", "-q"], { cwd: ctx.run.workspace });
		writeFileSync(join(ctx.run.workspace, "view.ts"), "fixture");
		stampQa(ctx);
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			captureBlocked: true,
		});
		const path = join(ctx.evidenceDir, "saved.png");
		const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
		writeFileSync(path, bytes);
		const capture = qaExecution();
		capture.screenshots.push({
			path,
			caption: "Saved",
			area: "Editor",
			state: "saved",
		});
		stampQa(ctx, capture);
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			qaRetry: true,
		});
		const stamped = ctx.run.outputs.capture as typeof capture;
		(
			ctx.run.outputs["visual-review"] as Record<string, unknown>
		).acceptedScreenshots = stamped.screenshots.map(
			({ area, state, imageSha256 }) => ({ area, state, imageSha256 }),
		);
		expect(await equivalentGate(ctx)).toMatchObject({ approved: true });
		writeFileSync(path, Buffer.concat([bytes, Buffer.from("changed")]));
		expect(await equivalentGate(ctx)).toMatchObject({
			approved: false,
			qaRetry: true,
		});
	});

	it("cannot settle a failed behavioral criterion with an accepted rejection", async () => {
		const ctx = qaContext();
		const capture = qaExecution("failed");
		capture.findings = [
			{
				id: "settled",
				rating: 3,
				status: "accepted-rejection",
				reason: "Fixer disputes the complaint",
				summary: "Save lost record",
				evidence: "Readback missing",
				storyId: "save",
				criterionId: "saved",
				requirementRefs: ["requirements/0"],
				reproduction: ["Save"],
				expected: "Record is persisted",
				actual: "Record missing",
			},
		];
		stampQa(ctx, capture);
		const checked = await equivalentGate(ctx);
		expect(checked.approved).toBe(false);
		expect(checked.findings).toEqual([
			expect.objectContaining({ criterionId: "saved", status: "open" }),
		]);
		expect((checked.findings as { id: string }[])[0]!.id).not.toBe("settled");
	});
});

type FixScenario =
	| "unchanged"
	| "source-change"
	| "synchronized"
	| "base-change"
	| "missing-review"
	| "failed-checks"
	| "unresolved-thread"
	| "resolved-thread";

async function postFix(scenario: FixScenario) {
	const ctx = context("review-after-fix");
	ctx.run.outputs["draft-pr"] = { url: "https://github.com/test/repo/pull/1" };
	ctx.run.outputs.ci = {
		threads: [],
		reviews: [],
		headSha:
			scenario === "unchanged" || scenario === "synchronized"
				? "old-head"
				: "current-head",
		worktreeHeadSha: "current-head",
		baseSha: "base",
		checks:
			scenario === "failed-checks"
				? [{ name: "test", state: "FAILURE", bucket: "fail" }]
				: [],
		blockers:
			scenario === "unchanged" || scenario === "synchronized"
				? [{ kind: "revision", action: "fix" }]
				: scenario.endsWith("thread")
					? [{ kind: "threads", action: "fix" }]
					: [],
	};
	ctx.run.outputs["ci-fix"] = { reviewRequired: false };
	ctx.run.outputs["review-gate"] = { approved: true };
	ctx.run.roleRevisions =
		scenario === "missing-review"
			? {}
			: {
					"code-review": {
						headSha: "current-head",
						dirty: false,
						historyLength: 0,
						at: "now",
					},
				};
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (_context, executable, args) => {
			if (executable === "git")
				return args[0] === "status"
					? ""
					: scenario === "source-change"
						? "new-head"
						: "current-head";
			if (githubRequest(args).path !== "graphql") return "[]";
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid:
						scenario === "unchanged"
							? "old-head"
							: scenario === "source-change"
								? "new-head"
								: "current-head",
					baseRefOid: scenario === "base-change" ? "new-base" : "base",
					mergeStateStatus: "CLEAN",
					reviewDecision: "APPROVED",
					...(scenario === "failed-checks"
						? {
								statusCheckRollup: {
									contexts: {
										nodes: [{ name: "test", state: "FAILURE" }],
										pageInfo: { hasNextPage: false },
									},
								},
							}
						: {}),
					...(scenario === "unresolved-thread"
						? {
								reviewThreads: {
									nodes: [
										{
											id: "thread",
											isResolved: false,
											isOutdated: false,
											comments: {
												pageInfo: { hasNextPage: false },
												nodes: [
													{
														id: "comment",
														body: "Fix record loss",
														author: { login: "reviewer" },
													},
												],
											},
										},
									],
									pageInfo: { hasNextPage: false },
								},
							}
						: {}),
				}),
			);
		},
	});
	const legacy = (await tools.tool(ctx)) as Decision;
	const graph = modernGraph(ctx.step);
	const observer = graph.find(
		(step) => step.tool === "inspect-review-readiness",
	)!;
	const check = graph.find((step) => step.type === "check")!;
	const observation = (await tools.tool({
		...ctx,
		step: observer,
	})) as Decision;
	expect(observation).not.toHaveProperty("reviewRequired");
	expect(observation).not.toHaveProperty("next");
	const checked = await evaluateCheckAsync(check.check!, {
		observation,
		observations: observation.observations,
	});
	expect({
		reviewRequired: checked.reviewRequired,
		headSha: checked.headSha,
		baseSha: checked.baseSha,
	}).toEqual({
		reviewRequired: legacy.reviewRequired,
		headSha: legacy.headSha,
		baseSha: legacy.baseSha,
	});
	expect(checked.needsAssistance).toBe(
		Array.isArray(legacy.questions) && legacy.questions.length > 0,
	);
	expect(checked.passed).toBe(legacy.reviewRequired !== true);
	expect(checked).not.toHaveProperty("next");
	return { check, checked, legacy, observation };
}

describe("post-fix action facts and ordinary Check routes", () => {
	it.each([
		"unchanged",
		"source-change",
		"synchronized",
		"base-change",
		"missing-review",
		"failed-checks",
		"unresolved-thread",
		"resolved-thread",
	] as const)("preserves legacy %s review/assistance decisions", async (scenario) => {
		const { checked } = await postFix(scenario);
		expect(checked.reviewRequired).toBe(
			[
				"unchanged",
				"source-change",
				"base-change",
				"missing-review",
				"unresolved-thread",
			].includes(scenario),
		);
		if (scenario === "unchanged") expect(checked.needsAssistance).toBe(true);
		if (scenario === "synchronized" || scenario === "resolved-thread")
			expect(checked.needsAssistance).toBe(false);
	});

	it("aggregates factual provider observations without losing secondary repository failures", async () => {
		const clean = await postFix("synchronized");
		const changed = await postFix("base-change");
		const checked = await evaluateCheckAsync(clean.check.check!, {
			observation: clean.observation,
			observations: [clean.observation, changed.observation],
		});
		expect(checked).toMatchObject({
			reviewRequired: true,
			baseChanged: true,
			passed: false,
		});
		const blocked = await postFix("unchanged");
		const grouped = await evaluateCheckAsync(clean.check.check!, {
			observation: clean.observation,
			observations: [clean.observation, blocked.observation],
		});
		expect(grouped).toMatchObject({
			reviewRequired: true,
			unchangedRevision: true,
			needsAssistance: true,
			passed: false,
		});
		expect(grouped.assistanceObservations).toEqual([blocked.observation]);
	});
});
