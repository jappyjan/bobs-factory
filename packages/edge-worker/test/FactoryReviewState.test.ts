import { afterEach, expect, it, vi } from "vitest";
import type { Guide } from "../src/factory/FactoryResults.js";
import {
	guideMatchesGate,
	readProgress,
	readReviewProgress,
	readStored,
	readTextStored,
	reviewKey,
	todayContext,
	writeReviewProgress,
	writeStored,
} from "../src/factory/web/review-state.js";

vi.mock("../src/factory/web/auth-state", () => ({
	accessState: () => ({ status: "authenticated" }),
}));

afterEach(() => vi.unstubAllGlobals());

it("restores progress written by the original reader and isolates changed reviews", () => {
	const run = { id: "saved-run", reviewGate: { headSha: "abc123" } };
	const guide = { summary: "Saved guide" };
	const key = reviewKey(run, guide);
	expect(key).toBe("factory-review/saved-run/abc123/8jd7j8");
	const saved = { page: 2, reviewed: { feature: true } };
	expect(readProgress(saved, 4)).toEqual({ ...saved, disclosures: {} });
	expect(reviewKey(structuredClone(run), structuredClone(guide))).toBe(key);
	expect(reviewKey({ ...run, updatedAt: "later" }, guide)).toBe(key);
	expect(
		reviewKey({ ...run, reviewGate: { headSha: "replacement" } }, guide),
	).not.toBe(key);
	expect(reviewKey(run, { summary: "Replacement guide" })).not.toBe(key);
});

it("rejects corrupt progress without blocking reading", () => {
	for (const saved of [
		null,
		{},
		{ page: -1, reviewed: {} },
		{ page: 4, reviewed: {} },
		{ page: 1, reviewed: [] },
	])
		expect(readProgress(saved, 4)).toEqual({ page: 0, reviewed: {} });
	expect(
		readProgress(
			{
				page: 1,
				reviewed: { a: true, b: "false" },
				disclosures: { "1/code": true },
			},
			4,
		),
	).toEqual({
		page: 1,
		reviewed: { a: true },
		disclosures: { "1/code": true },
	});
});

it("keeps legacy selections readable and tolerates unavailable or malformed storage", () => {
	vi.stubGlobal("sessionStorage", { getItem: () => "saved-run" });
	expect(readTextStored("bob-selected", "", true)).toBe("saved-run");
	vi.stubGlobal("localStorage", {
		getItem: () => "malformed",
		setItem: () => {
			throw new Error("Denied");
		},
	});
	expect(readStored("draft", { open: false })).toEqual({ open: false });
	expect(() =>
		writeStored("draft", { feedback: "Keep this draft" }),
	).not.toThrow();
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
	});
	expect(readStored("progress", null)).toBeNull();
});

it("blocks decisions on a guide from a different revision, including custom nested workflows", () => {
	const run = {
		reviewGate: { headSha: "new" },
		roleRevisions: { "pipeline/guide": { headSha: "old" } },
	};
	expect(guideMatchesGate(run)).toBe(false);
	expect(
		guideMatchesGate({
			...run,
			roleRevisions: { "custom/guide": { headSha: "old" } },
		}),
	).toBe(false);
	expect(
		guideMatchesGate({
			...run,
			roleRevisions: { "pipeline/guide": { headSha: "new" } },
		}),
	).toBe(true);
	expect(
		reviewKey(
			{
				id: "nested",
				roleRevisions: { "custom/guide": { headSha: "historical-sha" } },
			},
			{},
		),
	).toBe(
		`factory-review/nested/historical-sha/${reviewKey({ id: "other" }, {}).split("/").at(-1)}`,
	);
	// Historical guides predate role-revision receipts; their pending gate is still server-validated.
	expect(guideMatchesGate({ reviewGate: { headSha: "legacy" } })).toBe(true);
});

it("carries the reviewed run into Today through direct links and run-story navigation", () => {
	expect(todayContext("/runs/a%20b/review", null)).toEqual({
		focusRunId: "a b",
	});
	expect(todayContext("/runs/a", { focusRunId: "a" })).toEqual({
		focusRunId: "a",
	});
	expect(() => todayContext("/runs/%/review", null)).not.toThrow();
});

it("restores independent check/visited state and ignores malformed boolean entries", () => {
	expect(
		readProgress(
			{
				page: 2,
				reviewed: { step: false },
				checked: { "step/0": true, "step/1": "true" },
				visited: { overview: true, files: 1 },
			},
			5,
		),
	).toEqual({
		page: 2,
		reviewed: { step: false },
		checked: { "step/0": true },
		visited: { overview: true },
		disclosures: {},
	});
});

function followupFixture() {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
	});
	const guide: Guide = {
		goal: "Preserve ownership",
		summary: "Complete review",
		decision: { status: "ready", summary: "Inspect cleanup and authorization" },
		requirements: [
			{
				requirementId: "R1",
				criterion: "Only owned resources",
				status: "supported",
				evidence: ["Checked"],
			},
		],
		behavior: [],
		checks: [],
		risks: [],
		reviewInstructions: ["Inspect both chapters"],
		chapters: ["cleanup", "authorization"].map((id) => ({
			id,
			title: id,
			summary: "Inspect behavior",
			before: "Previous",
			after: "Current",
			requirementIndexes: [0],
			files: id === "cleanup" ? ["teardown"] : [],
			screenshots: [],
			diagrams: [],
			reviewChecks: ["Check ownership"],
			risks: [],
			evidence: ["Checked"],
		})),
	};
	const original = { id: "followup", reviewGate: { headSha: "original" } };
	const current = {
		id: original.id,
		reviewGate: { headSha: "current" },
		impactDecisions: [
			{
				status: "completed",
				classification: "affected",
				uncertainty: [],
				snapshot: {
					digest: "current-snapshot",
					approval: { headSha: "original" },
					repositories: [{ headSha: "current", reviewHead: "original" }],
				},
				reuseRecords: [
					{
						snapshotDigest: "current-snapshot",
						boundary: {
							areas: ["authorization"],
							requirementIds: ["R1"],
							dependencies: ["auth"],
						},
					},
				],
			},
		],
	};
	return { guide, original, current, storage };
}

it("retains independently unchanged chapters after renewed review and reload, while resetting affected progress", () => {
	const { guide, original, current } = followupFixture();
	writeReviewProgress(original, guide, {
		page: 2,
		reviewed: { cleanup: true, authorization: true },
		disclosures: { code: true },
		visited: { decide: true },
	});
	expect(readReviewProgress(current, guide, 5)).toEqual({
		page: 0,
		reviewed: { authorization: true },
	});
	writeReviewProgress(current, guide, readReviewProgress(current, guide, 5));
	expect(readReviewProgress(current, guide, 5)).toEqual({
		page: 0,
		reviewed: { authorization: true },
		disclosures: {},
	});
});

it("invalidates changed chapter prose, requirements and source files despite a retained chapter ID", () => {
	const { guide, original, current } = followupFixture();
	writeReviewProgress(original, guide, {
		page: 0,
		reviewed: { authorization: true },
	});
	for (const change of [
		(g: Guide) => {
			g.chapters![1]!.after = "Changed authorization";
		},
		(g: Guide) => {
			g.requirements[0]!.criterion = "New ownership requirement";
		},
		(g: Guide) => {
			g.chapters![1]!.files = ["shared/config"];
		},
	]) {
		const changed = structuredClone(guide);
		change(changed);
		expect(readReviewProgress(current, changed, 5).reviewed).toEqual({});
	}
});

it("does not reuse reading progress with missing, uncertain or stale impact evidence, or from a different run", () => {
	const { guide, original, current } = followupFixture();
	writeReviewProgress(original, guide, {
		page: 0,
		reviewed: { authorization: true },
	});
	for (const run of [
		{ ...current, impactDecisions: [] },
		{ ...current, id: "other" },
		{ ...current, reviewGate: { headSha: "later" } },
		{
			...current,
			impactDecisions: [
				{ ...current.impactDecisions[0], uncertainty: ["Unknown dependency"] },
			],
		},
		{
			...current,
			impactDecisions: [
				{ ...current.impactDecisions[0], classification: "full" },
			],
		},
	])
		expect(readReviewProgress(run, guide, 5).reviewed).toEqual({});
});

it("preserves an explicit unchecked choice and does not resurrect progress after an intervening changed chapter", () => {
	const { guide, original, current } = followupFixture();
	writeReviewProgress(original, guide, {
		page: 0,
		reviewed: { authorization: true },
	});
	const next = readReviewProgress(current, guide, 5);
	writeReviewProgress(current, guide, {
		...next,
		reviewed: { authorization: false },
	});
	const anotherGuide = { ...guide, summary: "Another follow-up" };
	expect(readReviewProgress(current, anotherGuide, 5).reviewed).toEqual({
		authorization: false,
	});
	const changed = structuredClone(anotherGuide);
	changed.chapters![1]!.summary = "Changed content";
	writeReviewProgress(
		current,
		changed,
		readReviewProgress(current, changed, 5),
	);
	expect(
		readReviewProgress(current, { ...guide, summary: "Restored content" }, 5)
			.reviewed,
	).toEqual({});
});

it("upgrades old revision-scoped progress only with the original guide and independent reuse evidence", () => {
	const { guide, original, current, storage } = followupFixture();
	const old = { ...guide, reviewFiles: { headSha: "original" } };
	storage.set(
		reviewKey(original, old),
		JSON.stringify({
			page: 2,
			reviewed: { cleanup: true, authorization: true },
		}),
	);
	const run = { ...current, history: [{ step: "guide", output: old }] };
	const updated = { ...guide, previousHeadSha: "original" };
	expect(readReviewProgress(run, updated, 5).reviewed).toEqual({
		authorization: true,
	});
	expect(
		readReviewProgress({ ...run, history: [] }, updated, 5).reviewed,
	).toEqual({});
});

it("invalidates uncertain secondary repository changes even when the primary revision is unchanged", () => {
	const { guide, original, current: followup } = followupFixture();
	const run = {
		...original,
		reviewGate: {
			...original.reviewGate,
			repositories: [
				{ repositoryId: "a", headSha: "original" },
				{ repositoryId: "b", headSha: "before" },
			],
		},
	};
	writeReviewProgress(run, guide, {
		page: 0,
		reviewed: { authorization: true },
	});
	const current = {
		...run,
		reviewGate: {
			...run.reviewGate,
			repositories: [
				{ repositoryId: "a", headSha: "original" },
				{ repositoryId: "b", headSha: "after" },
			],
		},
	};
	expect(reviewKey(current, guide)).not.toBe(reviewKey(run, guide));
	expect(readReviewProgress(run, guide, 5).reviewed).toEqual({
		authorization: true,
	});
	expect(readReviewProgress(current, guide, 5).reviewed).toEqual({});
	const reordered = {
		...run,
		reviewGate: {
			...run.reviewGate,
			repositories: [...run.reviewGate.repositories].reverse(),
		},
	};
	expect(reviewKey(reordered, guide)).toBe(reviewKey(run, guide));
	expect(readReviewProgress(reordered, guide, 5).reviewed).toEqual({
		authorization: true,
	});
	for (const repositories of [
		run.reviewGate.repositories.slice(0, 1),
		[...run.reviewGate.repositories, { repositoryId: "c", headSha: "added" }],
	]) {
		const changed = { ...run, reviewGate: { ...run.reviewGate, repositories } };
		expect(reviewKey(changed, guide)).not.toBe(reviewKey(run, guide));
		expect(readReviewProgress(changed, guide, 5).reviewed).toEqual({});
	}
	const decision = followup.impactDecisions[0]!;
	const assessed = {
		...current,
		impactDecisions: [
			{
				...decision,
				snapshot: {
					...decision.snapshot,
					repositories: [
						{ repositoryId: "a", headSha: "original", reviewHead: "original" },
						{ repositoryId: "b", headSha: "after", reviewHead: "before" },
					],
				},
			},
		],
	};
	expect(readReviewProgress(assessed, guide, 5).reviewed).toEqual({
		authorization: true,
	});
	// Even a saved entry under the current key must prove its repository scope.
	writeStored(reviewKey(current, guide), {
		page: 0,
		reviewed: { authorization: true },
		chapterProgress: readStored(
			`factory-review/${run.id}/chapter-progress`,
			null,
		),
	});
	expect(readReviewProgress(current, guide, 5).reviewed).toEqual({});
});

it("ignores corrupt chapter carryover without blocking the reader", () => {
	const { guide, current, storage } = followupFixture();
	for (const value of [
		{
			revision: "original",
			contexts: {},
			reviewed: {},
			repositories: "invalid",
		},
		{ revision: "original", contexts: {}, reviewed: {}, repositories: [null] },
		{ revision: "original", contexts: [], reviewed: [] },
	]) {
		storage.set(
			`factory-review/${current.id}/chapter-progress`,
			JSON.stringify(value),
		);
		expect(readReviewProgress(current, guide, 5)).toEqual({
			page: 0,
			reviewed: {},
		});
	}
});
