import { describe, expect, it } from "vitest";
import { parseOutputFormat } from "../src/factory/OutputFormats.js";

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
		).toEqual({ summary: "Good enough", opportunities: [], limitations: [] });
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
