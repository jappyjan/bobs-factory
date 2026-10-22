import { describe, expect, it } from "vitest";
import { evaluateCheckAsync } from "../src/factory/Check.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { prepareFileIssues } from "../src/factory/FileIssues.js";
import { decisionItems } from "../src/factory/HumanStep.js";
import {
	parseOutputFormat,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { resolveView } from "../src/factory/View.js";

describe("reusable research formats", () => {
	it("rejects overflowing/duplicate assignments and dangling or cyclic shortlist IDs", () => {
		const assignment = {
			id: "one",
			question: "Inspect source ownership",
			scope: ["src"],
		};
		expect(() =>
			parseOutputFormat("research-plan-v1", {
				summary: "Bounded plan",
				assignments: [assignment, { ...assignment }],
			}),
		).toThrow();
		expect(() =>
			parseOutputFormat("research-plan-v1", {
				summary: "Bounded plan",
				assignments: [
					assignment,
					{ ...assignment, id: "two" },
					{ ...assignment, id: "three" },
				],
			}),
		).toThrow();
		expect(
			parseOutputFormat("proposals-v1", {
				summary: "Good enough",
				opportunities: [],
				limitations: [],
			}),
		).toEqual({
			summary: "Good enough",
			opportunities: [],
			limitations: [],
			limitationsDisplay: { items: [] },
		});
		const item = {
			id: "a",
			title: "Own recovery",
			problem: "Split ownership",
			evidence: ["source"],
			consequence: "Lost state",
			before: "Several owners",
			after: "One owner",
			plan: "Move ownership and verify recovery",
			criteria: ["Preserve state"],
			strength: "strong",
			effort: "Small",
			issueBody: "Self-contained deferred plan",
		};
		expect(() =>
			parseOutputFormat("proposals-v1", {
				summary: "Proposal",
				opportunities: [{ ...item, dependencies: ["missing"] }],
			}),
		).toThrow();
		expect(() =>
			parseOutputFormat("proposals-v1", {
				summary: "Proposals",
				opportunities: [
					{ ...item, dependencies: ["b"] },
					{ ...item, id: "b", dependencies: ["a"] },
				],
			}),
		).toThrow();
		expect(() =>
			parseOutputFormat("proposals-v1", {
				summary: "Proposals",
				opportunities: Array.from({ length: 6 }, (_, i) => ({
					...item,
					id: `a${i}`,
				})),
			}),
		).toThrow();
	});
	it("derives exact readable plan/check data without giving schemas execution authority", () => {
		expect(
			parseOutputFormat("plan-package-v1", {
				id: "a",
				itemIds: ["a"],
				title: "Own recovery",
				plan: "Implement scoped plan",
				criteria: ["Preserve state"],
				dependencies: ["base"],
				paths: ["src/state.ts"],
			}),
		).toMatchObject({
			reviewText:
				"Implement scoped plan\n\nAcceptance criteria:\n- Preserve state\n\nDependencies: base\nPaths: src/state.ts",
		});
		expect(
			parseOutputFormat("plan-check-v1", {
				approved: false,
				feedback: ["Restore recovery proof"],
			}),
		).toEqual({
			approved: false,
			feedback: ["Restore recovery proof"],
			display: { text: "Restore recovery proof" },
		});
		expect(() =>
			parseOutputFormat("plan-check-v1", {
				approved: true,
				feedback: ["Unresolved"],
			}),
		).toThrow();
	});
});

const stock = defaultWorkflows.find(
	(workflow) => workflow.id === "improve-codebase",
)!;
const decide = stock.steps.find((step) => step.type === "decide")!;
const approve = stock.steps.find((step) => step.type === "approve")!;
const producer = defaultWorkflows.find(
	(workflow) => workflow.id === "consolidate-proposals",
)!.steps[0]!;
const planProducer = defaultWorkflows.find(
	(workflow) => workflow.id === "refine-plan",
)!.steps[0]!;
const proposal = {
	id: "a",
	title: "Own recovery",
	problem: "Split ownership",
	evidence: ["src/owner.ts"],
	consequence: "Lost obligations",
	before: "Several owners",
	after: "One owner",
	plan: "Move lifecycle ownership",
	criteria: ["Keep pending obligations"],
	effort: "Small",
	strength: "strong",
	issueBody: "Deferred scoped plan",
};
const packageValue = {
	id: "a",
	itemIds: ["a"],
	title: "Own recovery",
	plan: "Move lifecycle ownership",
	criteria: ["MUST retain pending obligations across restart."],
	dependencies: [],
	paths: ["src/owner.ts"],
};

describe("producer formats compose with the actual stock human views", () => {
	it("accepts the exact filing title bound without truncation and leaves legacy data aliases compatible", async () => {
		const raw = {
			summary: "Summary",
			opportunities: [{ ...proposal, title: "t".repeat(250) }],
		};
		const accepted = (await parseStepOutputAsync(producer, raw)) as {
			opportunities: unknown[];
		};
		const action = stock.steps.find((s) => s.id === "dispatch")!
			.groups![0]![0]!;
		const batch = prepareFileIssues(
			"fixture",
			action.id,
			action.fileIssues!,
			{
				outputs: {
					decide: { itemsByAction: { issue: accepted.opportunities } },
				},
			},
			{
				provider: "taskbot",
				instance: "https://tracker.test",
				server: "fixture",
				project: "fixture",
			},
		);
		expect(batch.accepted[0]!.title).toBe(raw.opportunities[0]!.title);
		expect(batch.accepted[0]!.body).toBe(
			`${proposal.issueBody}\n\n${batch.accepted[0]!.marker}`,
		);
		for (const length of [251, 300]) {
			const invalid = {
				...raw,
				opportunities: [{ ...proposal, title: "t".repeat(length) }],
			};
			await expect(
				parseStepOutputAsync(producer, invalid),
			).rejects.toMatchObject({
				output: invalid,
				issues: expect.arrayContaining([
					expect.objectContaining({ path: "/opportunities/0/title" }),
				]),
			});
			expect(() =>
				parseOutputFormat("improvement-proposals-v1", invalid),
			).not.toThrow();
		}
	});
	it("displays complete limitations beyond label length and all projected fields at their receiving bounds", async () => {
		const raw = {
			summary: ` ${"s".repeat(16000)} `,
			opportunities: Array.from({ length: 5 }, (_, i) => ({
				...proposal,
				id: `p${i}`,
				title: "t".repeat(i === 0 ? 250 : 1),
				problem: "b".repeat(i === 0 ? 8000 : 1),
				consequence: "c".repeat(i === 0 ? 4000 : 1),
				before: "d".repeat(i === 0 ? 4000 : 1),
				after: "e".repeat(i === 0 ? 4000 : 1),
				plan: "f".repeat(i === 0 ? 4000 : 1),
				effort: "g".repeat(i === 0 ? 4000 : 1),
			})),
			limitations: [
				"l".repeat(201),
				"m".repeat(2000),
				...Array.from({ length: 28 }, () => "m".repeat(1000)),
			],
		};
		const accepted = await parseStepOutputAsync(producer, raw);
		const scope = { inputs: { proposals: accepted } };
		const view = resolveView(decide.view!, scope);
		expect(view.components[1]!.data).toEqual({
			items: raw.limitations.map((detail, index) => ({
				label: `Limitation ${index + 1}`,
				detail,
			})),
		});
		expect(decisionItems(decide.decide!, scope)).toHaveLength(5);
	});
	it.each([
		["summary", 16001],
		["limitations", 2001],
		["title", 251],
		["problem", 8001],
		["consequence", 4001],
		["before", 4001],
		["after", 4001],
		["plan", 4001],
		["effort", 4001],
	] as const)("rejects overflowing %s at the producer with its original output retained", async (field, length) => {
		const raw = {
			summary: "Summary",
			opportunities: [{ ...proposal }],
			limitations: ["Limitation"],
			...(field === "summary" ? { summary: "s".repeat(length) } : {}),
			...(field === "limitations" ? { limitations: ["l".repeat(length)] } : {}),
			...(field !== "summary" && field !== "limitations"
				? { opportunities: [{ ...proposal, [field]: "x".repeat(length) }] }
				: {}),
		};
		const rejected = parseStepOutputAsync(producer, raw);
		await expect(rejected).rejects.toBeInstanceOf(OutputValidationError);
		await expect(rejected).rejects.toMatchObject({
			output: raw,
			issues: expect.arrayContaining([
				expect.objectContaining({ path: expect.stringContaining(field) }),
			]),
		});
	});
	it("displays five complete canonical packages over 8000 characters without raising component limits", async () => {
		const raw = {
			...packageValue,
			title: "t".repeat(300),
			plan: "p".repeat(8000),
			criteria: ["c".repeat(3998)],
			paths: ["r".repeat(4000)],
		};
		const plans = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				parseStepOutputAsync(planProducer, {
					...raw,
					id: `p${i}`,
					itemIds: [`p${i}`],
				}),
			),
		);
		const checks = ["architecture", "security", "dependencies"].map((key) => ({
			[key]: parseOutputFormat("plan-check-v1", {
				approved: true,
				feedback: [],
			}),
		}));
		const view = resolveView(approve.view!, {
			inputs: {
				plans,
				checks,
				dependencyGraph: {
					passed: true,
					ids: plans.map((p: any) => p.id),
					dependencies: plans.map((p: any) => p.dependencies),
				},
			},
		});
		const cards = view.components[1]!;
		if (cards.type !== "itemCards") throw new Error("Missing plan cards");
		expect(cards.data.items).toHaveLength(5);
		for (const item of cards.data.items)
			expect(item).toMatchObject({
				body: raw.plan,
				details: [
					{ label: "Acceptance criteria", value: `- ${raw.criteria[0]}` },
					{ label: "Dependencies", value: "None" },
					{ label: "Paths", value: raw.paths[0] },
				],
			});
	});
	it.each([
		"title",
		"plan",
		"criteria",
		"paths",
	] as const)("makes excessive package %s correctable before approval and leaves legacy formats compatible", async (field) => {
		const limits = { title: 301, plan: 8001, criteria: 4000, paths: 4001 };
		const raw = {
			...packageValue,
			[field]:
				field === "criteria" || field === "paths"
					? ["x".repeat(limits[field])]
					: "x".repeat(limits[field]),
		};
		const rejected = parseStepOutputAsync(planProducer, raw);
		await expect(rejected).rejects.toBeInstanceOf(OutputValidationError);
		await expect(rejected).rejects.toMatchObject({ output: raw });
		expect(() =>
			parseOutputFormat("improvement-package-v1", raw),
		).not.toThrow();
	});
});

describe("plan dependency correction before human acceptance", () => {
	it.each([
		{ dependencies: ["a"] },
		{ dependencies: ["base", "base"] },
	])("rejects self or duplicate dependencies at Refine with raw output and exact path", async ({
		dependencies,
	}) => {
		const raw = { ...packageValue, dependencies };
		await expect(parseStepOutputAsync(planProducer, raw)).rejects.toMatchObject(
			{
				output: raw,
				issues: expect.arrayContaining([
					expect.objectContaining({
						path: expect.stringMatching(/^\/dependencies\/\d+$/),
					}),
				]),
			},
		);
		expect(() =>
			parseOutputFormat("improvement-package-v1", raw),
		).not.toThrow();
	});
	it.each([
		{ dependencies: [["b"], ["a"]] },
		{ dependencies: [["a"], ["a"]] },
		{ dependencies: [[], ["a", "a"]] },
		{ dependencies: [[], ["missing"]] },
	])("fails the actual stock graph Check before dispatch for invalid dependencies %j", async ({
		dependencies,
	}) => {
		const check = stock.steps.find((s) => s.id === "plan-dependencies")!;
		const result = await evaluateCheckAsync(
			check.check!,
			{
				plans: ["a", "b"].map((id, index) => ({
					id,
					dependencies: dependencies[index],
				})),
			},
			{},
			(format, value) => {
				try {
					parseOutputFormat(format, value);
					return true;
				} catch {
					return false;
				}
			},
		);
		expect(result).toEqual({ passed: false, ids: ["a", "b"], dependencies });
		expect(check.branches).toEqual([
			{ when: { path: "passed", equals: false }, next: "plans" },
		]);
	});
	it("validates empty and maximum-size stock plan DAGs without revalidating full approval prose in the rule budget", async () => {
		const check = stock.steps.find((s) => s.id === "plan-dependencies")!;
		for (const count of [0, 5]) {
			const plans = Array.from({ length: count }, (_, i) => ({
				...packageValue,
				id: `p${i}`,
				plan: "p".repeat(8000),
				criteria: ["c".repeat(3998)],
				paths: ["r".repeat(4000)],
				dependencies: Array.from({ length: i }, (_, j) => `p${j}`),
			}));
			const result = await evaluateCheckAsync(
				check.check!,
				{ plans },
				{},
				(format, value) => {
					parseOutputFormat(format, value);
					return true;
				},
			);
			expect(result.passed).toBe(true);
		}
	});
});
