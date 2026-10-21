import { describe, expect, it } from "vitest";
import { CheckSchema, evaluateCheck } from "../src/factory/Check.js";
import type { RuleCondition } from "../src/factory/Rules.js";
import {
	conditionEditorKind,
	newCondition,
} from "../src/factory/web/check-step-settings.js";
import {
	authorableTools,
	kindOf,
	newStep,
} from "../src/factory/web/recipe-graph.js";

describe("Check authoring", () => {
	it("creates an independent Check node with a valid named rule", () => {
		const step = newStep("check", "renamed-check");
		expect(kindOf(step).label).toBe("Check");
		expect(step.type).toBe("check");
		expect(step.tool).toBeUndefined();
		expect(step.prompt).toBeUndefined();
		expect(CheckSchema.safeParse(step.check).success).toBe(true);
		expect(evaluateCheck(step.check!, { review: { approved: true } })).toEqual({
			passed: true,
			approved: true,
		});
	});

	it.each([
		"field",
		"all",
		"any",
		"not",
		"each",
		"some",
		"count",
	])("starts %s conditions as valid rules evaluated by the shared engine", (kind) => {
		const condition = newCondition(kind);
		expect(conditionEditorKind(condition)).toBe(kind);
		expect(
			CheckSchema.safeParse({ results: { approved: condition } }).success,
		).toBe(true);
		expect(
			typeof evaluateCheck({ results: { approved: condition } }, {}).passed,
		).toBe("boolean");
	});

	it("keeps compound field predicates and computed bounds in the JSON editor", () => {
		const conditions: RuleCondition[] = [
			{ path: "/rating", min: 2, max: 4 },
			{ count: "/items", min: { length: "/requirements" } },
			{ conforms: "review-v1" },
			{ path: "/items", unique: true, by: ["/id", "/version"] },
		];
		const original = structuredClone(conditions);
		for (const condition of conditions)
			expect(conditionEditorKind(condition)).toBe("json");
		expect(conditions).toEqual(original);
	});

	it("offers side-effect actions while keeping saved decision tools out of new recipes", () => {
		for (const legacy of [
			"review-gate",
			"visual-gate",
			"delivery-mode",
			"delivery-route",
			"review-after-fix",
		])
			expect(authorableTools).not.toContain(legacy);
		for (const action of [
			"ci",
			"ci-fix-readiness",
			"accept-delivery",
			"inspect-review-readiness",
			"handoff",
			"merge",
			"draft-pr",
			"external-apply",
			"external-verify",
		])
			expect(authorableTools).toContain(action);
	});
});
