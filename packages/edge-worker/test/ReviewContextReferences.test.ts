import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { immutableJson, JsonSnapshotStore } from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import {
	captureReviewContext,
	originalReviewContext,
} from "../src/factory/SpecialistReview.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { StepSchema } from "../src/factory/Workflow.js";
import { snapshotHistory } from "../src/factory/WorkflowInput.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const entry = (index: number) =>
	immutableJson({
		step: `outer/items/${index}/nested/parallel/0/renamed`,
		at: `round-${index}`,
		output: {
			findings: [
				{ id: `F${index}`, status: "open", evidence: "original".repeat(1000) },
			],
		},
	});

it("captures native history cutoffs without decoding historical payloads", () => {
	let loads = 0;
	const index = Array.from({ length: 48 }, (_, i) => ({
		step: entry(i).step,
		at: entry(i).at,
	}));
	const history = new Array<ReturnType<typeof entry>>(48);
	for (let i = 0; i < history.length; i++)
		Object.defineProperty(history, i, {
			enumerable: true,
			configurable: true,
			get: () => {
				loads++;
				return entry(i);
			},
		});
	const run = { id: "isolated", history };
	const input = {
		history: snapshotHistory(history),
		outputs: { current: { dependency: "changed", status: "blocked" } },
	};
	const captured = immutableJson(captureReviewContext(input, run, index));
	expect(loads).toBe(0);
	expect(JSON.stringify(captured).length).toBeLessThan(1500);
	expect(captured.contextReferences.map((ref) => ref.path)).toEqual([
		["history"],
	]);
	const restored = originalReviewContext(captured, run, index) as typeof input;
	expect(loads).toBe(0);
	expect(restored.history).toHaveLength(48);
	expect(restored.history[1]).toEqual(entry(1));
	expect(loads).toBe(1);
	expect(restored.outputs.current).toEqual(input.outputs.current);
});

it("retains exact original ranges across appends and disk reconstruction and refuses stale owners", async () => {
	const home = mkdtempSync(join(tmpdir(), "review-context-144-"));
	homes.push(home);
	const history = [entry(0), entry(1)];
	const run = { id: "original-owner", history };
	const index = history.map(({ step, at }) => ({ step, at }));
	const input = {
		history: snapshotHistory(history),
		selected: { rejection: "Evidence disproves proposed fix" },
	};
	const baseline = immutableJson(captureReviewContext(input, run, index));
	history.push(entry(2));
	const store = new JsonSnapshotStore(join(home, "chunks"));
	const path = join(home, "saved.json");
	await store.write(path, { ...run, baseline }, {}, [], [], { history: 1 });
	const saved = store.load<typeof run & { baseline: typeof baseline }>(
		path,
	).value;
	const restored = originalReviewContext(saved.baseline, saved, [
		...index,
		{ step: entry(2).step, at: entry(2).at },
	]);
	expect(restored).toEqual(input);
	expect(() =>
		originalReviewContext(
			saved.baseline,
			{ ...saved, id: "sibling-owner" },
			index,
		),
	).toThrow("missing or changed");
	expect(() =>
		originalReviewContext(saved.baseline, saved, [
			{ ...index[0]!, at: "changed" },
			index[1]!,
		]),
	).toThrow("missing or changed");
	expect(() =>
		originalReviewContext(saved.baseline, { ...saved, history: [] }, index),
	).toThrow("missing or changed");
	// A legacy inline baseline and a role-authored reference-shaped value stay ordinary data.
	const legacy = {
		context: {
			marker: { runId: "original-owner", start: 0, end: 2 },
			history: [entry(0)],
		},
	};
	expect(originalReviewContext(legacy, saved, index)).toBe(legacy.context);
});

it("keeps repository-projected history inline instead of substituting unprojected source receipts", () => {
	const run = { id: "scoped", history: [entry(0)] };
	const history = snapshotHistory(run.history, 0, 1, (value) => ({
		...value,
		output: { findings: [] },
	}));
	const captured = captureReviewContext({ history }, run, [
		{ step: entry(0).step, at: entry(0).at },
	]);
	expect(captured.contextReferences).toEqual([]);
	expect(captured.context).toEqual({
		history: [{ ...entry(0), output: { findings: [] } }],
	});
});

for (const count of [12, 48])
	it(`captures actual detached declared history aliases at ${count} receipts and retains modified copies`, () => {
		const history = Array.from({ length: count }, (_, i) => entry(i));
		const run = {
			id: "owner",
			history,
			outputs: {},
			answers: [],
			workspace: "/unused",
			repositoryId: "fixture",
		};
		const index = history.map(({ step, at }) => ({ step, at }));
		const step = StepSchema.parse({
			id: "renamed",
			name: "Review",
			type: "fanout",
			groups: [
				[{ id: "observer", name: "Observer", type: "agent", prompt: "Review" }],
			],
			reads: { priorProof: "@history" },
		});
		const bindings = stepBindings({
			run,
			step,
			stepKey: "outer/items/0/renamed",
			outputs: {},
			input: {},
		} as ExecutionContext);
		const prior = bindings.priorProof as typeof history;
		expect(prior).toEqual(history);
		expect(prior[0]).not.toBe(history[0]);
		const baseline = immutableJson(
			captureReviewContext(
				{ history: snapshotHistory(history), ...bindings },
				run,
				index,
			),
		);
		expect(baseline.contextReferences.map(({ path }) => path)).toEqual([
			["history"],
			["priorProof"],
		]);
		expect(JSON.stringify(baseline).length).toBeLessThan(600);
		history.push(entry(count));
		const restored = originalReviewContext(baseline, run, [
			...index,
			{ step: entry(count).step, at: entry(count).at },
		]) as { priorProof: typeof history };
		expect(restored.priorProof).toEqual(prior);
		expect(restored.priorProof).toHaveLength(count);
		prior[0]!.output.findings[0]!.evidence = "changed detached declaration";
		expect(history[0]!.output.findings[0]!.evidence).not.toBe(
			"changed detached declaration",
		);
		const modified = captureReviewContext(bindings, run, index);
		expect(modified.contextReferences).toEqual([]);
		expect(
			(originalReviewContext(modified, run, index) as typeof bindings)
				.priorProof,
		).toEqual(prior);
		// Reordering identical JSON members also retains the actual declared input.
		prior.reverse();
		expect(
			captureReviewContext(bindings, run, index).contextReferences,
		).toEqual([]);
	});
