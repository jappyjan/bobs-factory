import { describe, expect, it } from "vitest";
import { digest } from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	decisionItems,
	type ViewRecord,
	viewAnswerOutput,
} from "../src/factory/HumanStep.js";
import {
	parseOutputFormat,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { resolveView } from "../src/factory/View.js";
import { viewRecordDigest } from "../src/factory/ViewPresentation.js";
import { viewScope } from "../src/factory/ViewRuntime.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const stock = defaultWorkflows.find((w) => w.id === "improve-codebase")!;
const approve = stock.steps.find((s) => s.type === "approve")!;
const decide = stock.steps.find((s) => s.type === "decide")!;
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
	const view = resolveView(approve.view!, scope);
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
		const scope = viewScope({ run, step: decide, outputs });
		const items = decisionItems(decide.decide!, scope);
		const decisionRecord: ViewRecord = {
			configDigest: "fixed",
			sourceDigest: "fixed",
			items,
			snapshot: {
				id: "fixed",
				stepKey: "decide",
				kind: "decide",
				title: decide.name,
				digest: "fixed",
				createdAt: "fixed",
				view: resolveView(decide.view!, scope),
				items: items.map(({ value: _value, ...item }) => item),
				actions: decide.decide!.actions,
			},
		};
		const choices = viewAnswerOutput(decisionRecord, {
			batchId: "fixed",
			digest: "fixed",
			accepted: true,
			choices: items.map(({ id }) => ({
				itemId: id,
				action: "fix",
				comment: "\u0001".repeat(12000),
			})),
		});
		const planStep = defaultWorkflows.find((w) => w.id === "refine-plan")!
			.steps[0]!;
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
		const full = viewScope({
			run,
			step: approve,
			outputs: {
				...outputs,
				decide: choices,
				"plan-check": { plans },
				checks,
				"plan-dependencies": {
					passed: true,
					ids: raw.opportunities.map((i) => i.id),
					dependencies: raw.opportunities.map(() => []),
				},
				// This unused, nondisplayed source must not be copied into the approval scope.
				snapshot: { history: "h".repeat(1_048_577) },
			},
		});
		expect(full.inputs.proposals).toEqual(proposals);
		expect(full.inputs.decisions).toEqual(choices);
		expect(full.inputs.plans).toEqual(plans);
		expect(full.inputs).not.toHaveProperty("baseline");
		const view = resolveView(approve.view!, full);
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
