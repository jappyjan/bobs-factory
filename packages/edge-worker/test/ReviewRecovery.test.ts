import { expect, it, vi } from "vitest";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	factoryReviewFixContext,
	recordReviewFix,
	reviewRecoveryQuestions,
	validateReviewFix,
} from "../src/factory/ReviewRecovery.js";
import {
	aggregateForContext,
	aggregateReview,
	type ReviewBaseline,
	type ReviewerReceipt,
	validateInventory,
} from "../src/factory/SpecialistReview.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const finding = {
	id: "external-validation",
	rating: 3,
	status: "open",
	summary: "Protected environment validation is blocked",
	evidence:
		"The protected deployment returns 404; required checks remain unexecuted",
};
const revision = {
	headSha: "unchanged",
	dirty: false,
	historyLength: 1,
	at: "",
};
function fixture(visual = false) {
	const gate = visual ? "visual-gate" : "review-gate";
	const fix = visual ? "visual-fix" : "code-fix";
	return {
		step: { id: fix },
		input: { "draft-pr": { url: "fixture" } },
		run: {
			step: `pipeline/${fix}`,
			input: "Validate the feature",
			answers: [],
			outputs: { [gate]: { approved: false, findings: [finding] } },
			history: [],
			roleRevisions: {
				[`pipeline/${visual ? "visual-review" : "code-review"}`]: {
					...revision,
				},
			},
		},
	} as unknown as ExecutionContext;
}
const rejection = {
	summary: "The feature has no source defect; deployment access is needed",
	dispositions: [
		{ id: finding.id, status: "rejected", reason: "Missing external access" },
	],
};
function gateContext(context: ExecutionContext, visual = false) {
	const output = recordReviewFix(context, rejection, revision);
	context.run.history.push({ step: context.run.step!, output, at: "" });
	context.run.step = `pipeline/${visual ? "visual-gate" : "review-gate"}`;
	context.step = {
		id: "gate",
		tool: visual ? "visual-gate" : "review-gate",
	} as ExecutionContext["step"];
	return context;
}

it.each([
	false,
	true,
])("corrects a summary-only assistance request instead of replaying review (visual=%s)", (visual) => {
	const context = fixture(visual);
	const output = validateFactoryResult(context.step.id, {
		summary: "Please provide the protected deployment",
		dispositions: [],
	});
	expect(() => validateReviewFix(context, output)).toThrow(
		"Missing finding IDs: external-validation",
	);
	const corrected = validateFactoryResult(context.step.id, {
		summary: "Blocked on access",
		dispositions: [],
		questions: ["Provide the protected deployment"],
	});
	expect(() => validateReviewFix(context, corrected)).not.toThrow();
	expect(corrected).toMatchObject({
		questions: ["Provide the protected deployment"],
	});
});

it.each([
	false,
	true,
])("pauses a rejected unchanged fix even when the blocker wording and probe change (visual=%s)", (visual) => {
	const context = gateContext(fixture(visual), visual);
	const gate = {
		approved: false,
		findings: [
			{
				...finding,
				summary: "Access still unavailable",
				evidence: "A newer probe returned 502",
			},
		],
	};
	expect(reviewRecoveryQuestions(context, gate, revision)).toEqual([
		expect.stringContaining("external-validation"),
	]);
	expect(gate.approved).toBe(false);
});

it("retains reviewer reassessment for the first evidence-backed rejection", () => {
	const context = fixture();
	expect(() =>
		validateReviewFix(context, validateFactoryResult("code-fix", rejection)),
	).not.toThrow();
	context.step.tool = "review-gate";
	expect(
		reviewRecoveryQuestions(context, { findings: [finding] }, revision),
	).toEqual([]);
});

it.each([
	"changed-fix",
	"changed-after-fix",
	"dirty",
	"finding-progress",
	"new-finding",
	"new-answer",
	"new-chat",
	"unknown-revision",
])("does not park work when progress or new direction is available: %s", (mode) => {
	const context = fixture();
	if (mode === "changed-fix")
		context.run.roleRevisions!["pipeline/code-review"]!.headSha = "previous";
	if (mode === "unknown-revision") context.run.roleRevisions = {};
	gateContext(context);
	const current = { ...revision };
	let findings = [finding];
	if (mode === "changed-after-fix") current.headSha = "new";
	if (mode === "dirty") current.dirty = true;
	if (mode === "finding-progress") findings = [];
	if (mode === "new-finding") findings = [{ ...finding, id: "another" }];
	if (mode === "new-answer")
		context.run.answers.push({
			questions: ["Help"],
			answer: "Use the restored deployment",
			at: "2026-10-07T01:00:00Z",
		});
	if (mode === "new-chat")
		context.chatMessages = [
			{
				id: "chat",
				text: "Use the new environment",
				at: "2026-10-07T01:00:00Z",
				step: "gate",
			},
		];
	expect(reviewRecoveryQuestions(context, { findings }, current)).toEqual([]);
});

it("uses runtime findings and answers independently of restricted recipe inputs", () => {
	const context = fixture();
	context.run.answers.push({
		questions: ["Access?"],
		answer: "Restored",
		at: "",
	});
	expect(factoryReviewFixContext(context)).toEqual({
		findings: [finding],
		answers: context.run.answers,
	});
	expect(context.input).toEqual({ "draft-pr": { url: "fixture" } });
});

function specialistFixture() {
	const context = fixture();
	const source = { source: "originalInput", reference: "/acceptance/0" };
	const baseline: ReviewBaseline = {
		schemaVersion: 1,
		round: 1,
		key: "pipeline/specialist-review",
		inventory: validateInventory({
			schemaVersion: 1,
			requirements: [
				{
					id: "R1",
					criterion: "Protected environment validation succeeds",
					classification: "active",
					sources: [source],
				},
			],
			decisions: [],
			conflicts: [],
			sourceReceipt: { considered: [source], unavailable: [] },
			questions: [],
		}),
		headSha: revision.headSha,
		baseSha: "base",
		historyLength: 0,
		reviewers: [
			{
				id: "security",
				key: "pipeline/specialist-review/0/security",
				group: 0,
				contract: "specialist-v1",
			},
			{
				id: "requirements",
				key: "pipeline/specialist-review/1/requirements",
				group: 1,
				contract: "coverage-v1",
			},
		],
		context: {},
		at: "",
	};
	context.reviewKey = baseline.key;
	context.run.reviewRounds = [baseline];
	context.run.outputs = {};
	const receipt = (
		reviewer: string,
		findings: ReviewerReceipt["findings"] = [],
	): ReviewerReceipt => ({
		status: "completed",
		blockers: [],
		summary: "Reviewed",
		findings,
		disagreements: [],
		disputeResolutions: [],
		inheritedDispositions: [],
		coverage: [
			{
				requirementId: "R1",
				status: "met",
				evidence: ["Protected validation executed"],
				reason: "Verified",
			},
		],
		stamp: {
			reviewer,
			stepKey: baseline.reviewers.find((role) => role.id === reviewer)!.key,
			round: baseline.round,
			inventoryDigest: baseline.inventory.digest,
			inventoryVersion: baseline.inventory.version,
			headSha: baseline.headSha,
			baseSha: baseline.baseSha,
		},
	});
	return { context, baseline, receipt };
}
const specialistFinding = {
	...finding,
	status: "open" as const,
	requirementIds: ["R1"],
};

it("recovers raw specialist findings before an aggregate exists without granting approval", () => {
	const { context, baseline, receipt } = specialistFixture();
	const duplicate = {
		...specialistFinding,
		id: "second",
		duplicateOf: "security:external-validation",
	};
	context.run.outputs["specialist-review"] = [
		{ security: receipt("security", [specialistFinding, duplicate]) },
		{ requirements: receipt("requirements") },
	];
	const before = structuredClone(context.run);
	const recovered = factoryReviewFixContext(context);
	expect(recovered.findings.map((item) => item.id)).toEqual([
		"security:external-validation",
		"security:second",
	]);
	expect(recovered.findings.every((item) => !("duplicateOf" in item))).toBe(
		true,
	);
	expect(recovered.review).toMatchObject({
		key: baseline.key,
		round: 1,
		status: "incomplete",
		blockers: [expect.stringContaining("no complete aggregate")],
	});
	expect(() => validateReviewFix(context, { dispositions: [] })).toThrow(
		"security:external-validation, security:second",
	);
	const corrected = {
		dispositions: recovered.findings.map((item) => ({
			id: item.id,
			status: "fixed",
		})),
		summary: "Corrected findings; independent reassessment remains required",
	};
	expect(() => validateReviewFix(context, corrected)).not.toThrow();
	expect(recordReviewFix(context, corrected, revision)).toMatchObject({
		reviewAssessment: { unchangedCode: true },
	});
	expect(() => aggregateForContext(context)).toThrow("no complete aggregate");
	expect(context.run).toEqual(before);
});

it("retains prior unresolved findings through a partial round and accepts only explicit current resolutions", () => {
	const { context, baseline, receipt } = specialistFixture();
	const prior = aggregateReview(baseline, [
		{
			security: receipt("security", [
				specialistFinding,
				{ ...specialistFinding, id: "retained" },
				{ ...specialistFinding, id: "inherited" },
			]),
		},
		{ requirements: receipt("requirements") },
	]);
	context.run.history.push({
		step: "pipeline/review-gate",
		output: prior,
		at: "",
	});
	const next = { ...baseline, round: 2 };
	context.run.reviewRounds!.push(next);
	const current = receipt("security", [
		{ ...specialistFinding, status: "resolved", reason: "Fresh check passes" },
		{ ...specialistFinding, id: "new" },
	]);
	current.stamp.round = 2;
	current.status = "blocked";
	current.blockers = ["Protected environment is unavailable"];
	current.inheritedDispositions = ["security:inherited", "security:new"].map(
		(id) => ({
			id,
			status: "resolved",
			reason: "Prior issue resolved",
			evidence: "Fresh check passes",
		}),
	);
	context.run.history.push({
		step: current.stamp.stepKey,
		output: current,
		at: "",
	});
	context.run.outputs["specialist-review"] = [
		{ security: receipt("security", [{ ...specialistFinding, id: "stale" }]) },
	];
	const recovered = factoryReviewFixContext(context);
	expect(recovered.findings.map((item) => item.id)).toEqual([
		"security:retained",
		"security:new",
	]);
	expect(recovered.review?.blockers).toEqual([
		expect.stringContaining("round 2 has no complete aggregate"),
		"security: Protected environment is unavailable",
		expect.stringContaining("requirements: missing, incomplete or stale"),
	]);
	expect(() => aggregateForContext(context)).toThrow("no complete aggregate");
});

it("keeps sibling and stale receipts out of correction context and explains the pending review", () => {
	const { context, baseline, receipt } = specialistFixture();
	const stale = receipt("security", [specialistFinding]);
	stale.stamp.headSha = "old-head";
	const sibling = receipt("requirements", [
		{ ...specialistFinding, id: "sibling" },
	]);
	sibling.stamp.stepKey = "other/specialist-review/1/requirements";
	context.run.outputs["specialist-review"] = [
		{ security: stale },
		{ requirements: sibling },
	];
	context.run.reviewRounds!.push({
		...baseline,
		key: "other/specialist-review",
		round: 2,
	});
	context.run.history.push({
		step: sibling.stamp.stepKey,
		output: sibling,
		at: "",
	});
	const recovered = factoryReviewFixContext(context);
	expect(recovered.findings).toEqual([]);
	expect(recovered.review).toMatchObject({
		key: baseline.key,
		round: 1,
		status: "incomplete",
		blockers: [
			expect.stringContaining("Run its configured review gate"),
			expect.stringContaining("security: missing, incomplete or stale"),
			expect.stringContaining("requirements: missing, incomplete or stale"),
		],
	});
	expect(() => aggregateForContext(context)).toThrow("no complete aggregate");
});

it("does not use another workflow frame's aggregate when this correction has no baseline", () => {
	const { context, baseline, receipt } = specialistFixture();
	const sibling = aggregateReview(baseline, [
		{ security: receipt("security", [specialistFinding]) },
		{ requirements: receipt("requirements") },
	]);
	context.reviewKey = "unrelated/specialist-review";
	context.run.outputs["review-gate"] = sibling;
	context.run.history.push({
		step: "pipeline/review-gate",
		output: sibling,
		at: "",
	});
	expect(factoryReviewFixContext(context)).toMatchObject({
		findings: [],
		review: {
			key: "unrelated/specialist-review",
			status: "incomplete",
			blockers: [
				expect.stringContaining("No specialist baseline is associated"),
			],
		},
	});
});

it("the real review gate parks a clean rejected attempt without approving it", async () => {
	const context = gateContext(fixture());
	context.log = vi.fn();
	context.run.outputs["code-review"] = {
		status: "completed",
		summary: "Blocked",
		findings: [finding],
	};
	const tools = new FactoryTools({
		command: async (_ctx, _exe, args) =>
			args[0] === "rev-parse" ? "unchanged" : "",
	});
	expect(await tools.tool(context)).toEqual({
		approved: false,
		findings: [finding],
		reviewBlocked: true,
		questions: [expect.stringContaining("required validation remain blocking")],
	});
});
