import { describe, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
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
	it("displays complete limitations beyond label length and all projected fields at their receiving bounds", async () => {
		const raw = {
			summary: ` ${"s".repeat(16000)} `,
			opportunities: Array.from({ length: 5 }, (_, i) => ({
				...proposal,
				id: `p${i}`,
				title: "t".repeat(300),
				problem: "b".repeat(8000),
				consequence: "c".repeat(4000),
				before: "d".repeat(4000),
				after: "e".repeat(4000),
				plan: "f".repeat(4000),
				effort: "g".repeat(4000),
			})),
			limitations: [
				"l".repeat(201),
				...Array.from({ length: 29 }, () => "m".repeat(2000)),
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
		["title", 301],
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
		const view = resolveView(approve.view!, { inputs: { plans, checks } });
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
