import { describe, expect, it } from "vitest";
import { evaluateCheckAsync } from "../src/factory/Check.js";
import { displayAnswerOutput } from "../src/factory/DisplayAnswers.js";
import {
	displayItems,
	resolveDisplayDocument,
} from "../src/factory/DisplayDocument.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { digest } from "../src/factory/EvidenceDigest.js";
import { foreachPointer } from "../src/factory/Foreach.js";
import type { ViewRecord } from "../src/factory/HumanStep.js";
import { transformOutput } from "../src/factory/nodes/transform.js";
import {
	conforms,
	parseOutputFormat,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { resolveView } from "../src/factory/View.js";
import { viewRecordDigest } from "../src/factory/ViewPresentation.js";
import { viewScope } from "../src/factory/ViewRuntime.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const stock = defaultWorkflows.find((w) => w.id === "improve-codebase")!;
const approve = stock.steps.find((s) => s.id === "approve")!;
const decide = stock.steps.find((s) => s.id === "decide")!;
const planInputs = stock.steps.find((s) => s.id === "plan-inputs")!;
const planDependencies = stock.steps.find((s) => s.id === "plan-dependencies")!;
const planCheck = stock.steps.find((s) => s.id === "plan-check")!;
const planStep = defaultWorkflows.find((w) => w.id === "refine-plan")!
	.steps[0]!;
const consolidate = defaultWorkflows.find(
	(w) => w.id === "consolidate-proposals",
)!.steps[0]!;
const run = { launchInputs: {} } as FactoryRun;
const proposal = {
	id: "a",
	title: "One owner",
	problem: "Split ownership",
	evidence: ["src/owner.ts"],
	consequence: "Lost state",
	before: "Several owners",
	after: "One owner",
	plan: "Move lifecycle ownership",
	criteria: ["MUST retain pending obligations across restart."],
	paths: ["src/owner.ts"],
	strength: "strong",
	effort: "Small",
	issueBody: "Self-contained deferred plan",
};
const graph = { passed: true, ids: ["a"], dependencies: [[]] };
const checks = ["architecture", "security", "dependencies"].map((name) => ({
	[name]: { approved: true, feedback: [], display: { text: "Approved" } },
}));
function approvalRecord(dependencyGraph: typeof graph): ViewRecord {
	const scope = viewScope({
		run,
		step: approve,
		outputs: {
			"plan-check": { plans: [] },
			checks,
			"plan-dependencies": dependencyGraph,
			decide: {},
			consolidate: { outputs: { proposals: {} } },
			snapshot: {},
		},
	});
	const view = resolveView(approve.document!, scope);
	return {
		configDigest: "fixed-config",
		sourceDigest: digest({ view, items: undefined }),
		scope,
		snapshot: {
			id: "fixed-batch",
			stepKey: "approve",
			kind: "approve",
			title: approve.name,
			digest: "",
			createdAt: "2026-10-22T00:00:00.000Z",
			threads: {},
			view,
		},
	};
}

describe("stock approval composition", () => {
	it.each([
		true,
		false,
	])("dispatches an approved batch only with current=%s", async (current) => {
		const gate = stock.steps.find((s) => s.id === "approval-check")!;
		const result = await evaluateCheckAsync(
			gate.check!,
			{ answer: { action: "approve", values: {} } },
			{},
			conforms,
			undefined,
			(ref) => ref === "approve" && current,
		);
		expect(result).toMatchObject({
			passed: current,
			approved: current,
			current,
		});
	});

	it.each([
		"ascii",
		"utf8",
	])("keeps complete corrected %s data through actual Decide, choice output and the full wrapped Approve scope", async (kind) => {
		const raw = {
			summary: "Complete bounded proposals",
			opportunities: Array.from({ length: 5 }, (_, i) => ({
				...proposal,
				id: `p${i}`,
				evidence: [
					(kind === "utf8" ? "界" : "e").repeat(kind === "utf8" ? 7000 : 23500),
				],
			})),
		};
		const proposals = (await parseStepOutputAsync(consolidate, raw)) as {
			opportunities: { id: string }[];
		};
		const outputs = { consolidate: { outputs: { proposals } } };
		const details = await transformOutput(
			stock.steps.find((s) => s.id === "decision-details")!.transform!,
			{ proposals },
		);
		const arranged = await transformOutput(
			stock.steps.find((s) => s.id === "decision-items")!.transform!,
			{ proposals, details },
		);
		const scope = viewScope({
			run,
			step: decide,
			outputs: { ...outputs, "decision-items": arranged },
		});
		const decisionView = resolveDisplayDocument(decide.document!, scope);
		const items = displayItems(decisionView);
		const decisionRecord: ViewRecord = {
			configDigest: "fixed",
			sourceDigest: "fixed",
			items,
			snapshot: {
				id: "fixed",
				stepKey: "decide",
				kind: "display",
				title: decide.name,
				digest: "fixed",
				createdAt: "fixed",
				view: decisionView,
				documentDigest: digest(decisionView),
				items: items.map(({ value: _value, ...item }) => item),
			},
		};
		const choices = displayAnswerOutput(decisionRecord, {
			batchId: "fixed",
			digest: "fixed",
			accepted: true,
			action: "continue",
			choices: items.map(({ id }) => ({
				itemId: id,
				action: "fix",
				comment: "\u0001".repeat(12000),
			})),
		});
		const plans = await Promise.all(
			raw.opportunities.map((item) =>
				parseStepOutputAsync(planStep, {
					id: item.id,
					itemIds: [item.id],
					title: item.title,
					plan: (kind === "utf8" ? "界" : "p").repeat(
						kind === "utf8" ? 6000 : 8000,
					),
					criteria: [item.criteria[0]!, "c".repeat(3900)],
					paths: ["src/owner.ts", "r".repeat(3900)],
					dependencies: [],
				}),
			),
		);
		const checkedInputs = await evaluateCheckAsync(
			planInputs.check!,
			{
				plans: {
					results: Object.fromEntries(
						plans.map((plan, i) => [
							`p${i}`,
							{ refine: { outputs: { plan } } },
						]),
					),
				},
				selected: foreachPointer(choices, "/itemsByAction/fix"),
			},
			{},
			conforms,
		);
		expect(checkedInputs).toEqual({ passed: true, exactCoverage: true, plans });
		const checkedGraph = await evaluateCheckAsync(
			planDependencies.check!,
			{ plans: checkedInputs.plans },
			{},
			conforms,
		);
		expect(checkedGraph.passed).toBe(true);
		const actualChecks = await Promise.all(
			stock.steps
				.find((s) => s.id === "checks")!
				.groups!.map(async (group) => ({
					[group[0]!.id]: await parseStepOutputAsync(group[0]!, {
						approved: true,
						feedback: [],
					}),
				})),
		);
		const checkedPlans = await evaluateCheckAsync(
			planCheck.check!,
			{ checks: actualChecks, plans: checkedInputs.plans, decisions: choices },
			{},
			conforms,
		);
		expect(checkedPlans).toEqual({
			passed: true,
			architecture: true,
			security: true,
			dependencies: true,
			feedback: actualChecks,
			plans,
		});
		const full = viewScope({
			run,
			step: approve,
			outputs: {
				...outputs,
				decide: choices,
				"plan-check": checkedPlans,
				checks: actualChecks,
				"plan-dependencies": checkedGraph,
				// This unused, nondisplayed source must not be copied into the approval scope.
				snapshot: { history: "h".repeat(1_048_577) },
			},
		});
		expect(full.inputs).not.toHaveProperty("proposals");
		expect(full.inputs).not.toHaveProperty("decisions");
		expect(full.inputs.plans).toEqual(plans);
		expect(full.inputs).not.toHaveProperty("baseline");
		const view = resolveView(approve.document!, full);
		const cards = view.components.find((c) => c.type === "itemCards")!;
		if (cards.type !== "itemCards") throw new Error("Missing reviewed plans");
		expect(cards.data.items).toHaveLength(5);
		expect(
			cards.data.items.every((card) =>
				card.details?.[0]?.value.includes(proposal.criteria[0]!),
			),
		).toBe(true);
		expect(
			new TextEncoder().encode(JSON.stringify(full)).length,
		).toBeLessThanOrEqual(1_048_576);
	});
	it("returns full failed-review feedback and five complete large plans within the actual later Check budget", async () => {
		const plans = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				parseStepOutputAsync(planStep, {
					id: `p${i}`,
					itemIds: [`p${i}`],
					title: `Plan p${i}`,
					plan: "p".repeat(8000),
					criteria: [proposal.criteria[0]!, "c".repeat(3900)],
					paths: ["src/owner.ts", "s".repeat(3900)],
					dependencies: [],
				}),
			),
		);
		const failedChecks = await Promise.all(
			stock.steps
				.find((s) => s.id === "checks")!
				.groups!.map(async (group) => ({
					[group[0]!.id]: await parseStepOutputAsync(group[0]!, {
						approved: false,
						feedback: [
							"Restore the accepted ownership guarantee.",
							"f".repeat(7400),
						],
					}),
				})),
		);
		await expect(
			evaluateCheckAsync(
				planCheck.check!,
				{ plans, checks: failedChecks, decisions: {} },
				{},
				conforms,
			),
		).resolves.toEqual({
			passed: false,
			architecture: false,
			security: false,
			dependencies: false,
			plans,
			feedback: failedChecks,
		});
		expect(planCheck.branches).toEqual([
			{ when: { path: "passed", equals: false }, next: "plans" },
		]);
	});
	it.each([
		"duplicate ID",
		"unknown ID",
		"missing prerequisite",
		"wrong item ID",
	])("returns ordinary refinement for complete large packages with %s", async (failure) => {
		const selected = Array.from({ length: 5 }, (_, i) => ({
			id: `p${i}`,
			dependencies: i === 1 ? ["p0"] : [],
		}));
		const plans = await Promise.all(
			selected.map((item, i) =>
				parseStepOutputAsync(planStep, {
					id:
						i === 1 && failure === "duplicate ID"
							? "p0"
							: i === 1 && failure === "unknown ID"
								? "other"
								: item.id,
					itemIds: [i === 1 && failure === "wrong item ID" ? "p0" : item.id],
					title: `Plan ${item.id}`,
					plan: "p".repeat(8000),
					criteria: [proposal.criteria[0]!, "c".repeat(3900)],
					paths: ["src/owner.ts", "s".repeat(3900)],
					dependencies:
						i === 1 &&
						failure !== "missing prerequisite" &&
						failure !== "duplicate ID"
							? ["p0"]
							: [],
				}),
			),
		);
		const output = await evaluateCheckAsync(
			planInputs.check!,
			{
				plans: {
					results: plans.map((plan) => ({ refine: { outputs: { plan } } })),
				},
				selected,
			},
			{},
			conforms,
		);
		expect(output).toEqual({ passed: false, exactCoverage: false, plans });
		expect(planInputs.branches).toEqual([
			{ when: { path: "passed", equals: false }, next: "plans" },
		]);
	});
	it("displays and binds the actual graph result through production source/final digests", () => {
		const accepted = approvalRecord(graph),
			rejected = approvalRecord({ ...graph, passed: false });
		expect(accepted.snapshot.view).not.toEqual(rejected.snapshot.view);
		expect(accepted.sourceDigest).not.toBe(rejected.sourceDigest);
		expect(viewRecordDigest("fixed-run", accepted)).not.toBe(
			viewRecordDigest("fixed-run", rejected),
		);
		const component = accepted.snapshot.view.components.find(
			(c) => c.id === "dependency-graph",
		)!;
		if (component.type !== "markdown") throw new Error("Missing graph review");
		expect(JSON.parse(component.data.text)).toEqual(graph);
	});
	it.each([
		"characters",
		"utf8",
		"duplication",
	] as const)("rejects aggregate %s at the producer with the original output, before stock viewScope can strand it", async (kind) => {
		const raw = {
			summary: "Summary",
			opportunities: [
				{
					...proposal,
					evidence: Array(20).fill(
						(kind === "utf8" ? "界" : "e").repeat(24000),
					),
					...(kind === "duplication"
						? { criteria: Array(5).fill("c".repeat(24000)) }
						: {}),
					...(kind === "characters"
						? {
								criteria: Array(20).fill("c".repeat(24000)),
								nonGoals: Array(2).fill("n".repeat(24000)),
							}
						: {}),
				},
			],
		};
		let rejection: unknown, receiverError: unknown;
		try {
			const parsed = await parseStepOutputAsync(consolidate, raw);
			try {
				viewScope({
					run,
					step: decide,
					outputs: { consolidate: { outputs: { proposals: parsed } } },
				});
			} catch (error) {
				receiverError = error;
			}
		} catch (error) {
			rejection = error;
		}
		// The pre-repair failure reports only the receiver error, never the giant fixture.
		expect(
			rejection instanceof OutputValidationError,
			String(receiverError),
		).toBe(true);
		if (!(rejection instanceof OutputValidationError)) return;
		expect(rejection.output).toEqual(raw);
		expect(() =>
			parseOutputFormat("improvement-proposals-v1", raw),
		).not.toThrow();
		expect(rejection.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/",
					message: expect.stringMatching(/budget|limit/i),
				}),
			]),
		);
	});
	it("bounds derived canonical packages and review display duplication at their producers while legacy data formats remain unchanged", async () => {
		const planStep = defaultWorkflows.find((w) => w.id === "refine-plan")!
			.steps[0]!;
		const reviewStep = stock.steps.find((s) => s.id === "checks")!
			.groups![0]![0]!;
		const plan = {
			id: "a",
			itemIds: ["a"],
			title: "One owner",
			plan: "界".repeat(8000),
			criteria: ["界".repeat(3998)],
			dependencies: [],
			paths: ["界".repeat(4000)],
		};
		const review = { approved: false, feedback: ["界".repeat(4000)] };
		for (const [step, raw, legacy] of [
			[planStep, plan, "improvement-package-v1"],
			[reviewStep, review, "improvement-plan-check-v1"],
		] as const) {
			await expect(parseStepOutputAsync(step, raw)).rejects.toMatchObject({
				output: raw,
				issues: expect.arrayContaining([
					expect.objectContaining({
						path: "/",
						message: expect.stringContaining("including derived fields"),
					}),
				]),
			});
			expect(() => parseOutputFormat(legacy, raw)).not.toThrow();
		}
		const corrected = {
			approved: false,
			feedback: [proposal.criteria[0]!, "界".repeat(2000)],
		};
		await expect(
			parseStepOutputAsync(reviewStep, corrected),
		).resolves.toMatchObject(corrected);
	});
});
