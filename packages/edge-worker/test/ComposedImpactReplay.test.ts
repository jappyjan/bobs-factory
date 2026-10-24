import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QaCaptureSchema } from "../src/factory/FactoryTools.js";
import * as readiness from "../src/factory/MergeReadiness.js";
import { qaDigest } from "../src/factory/Qa.js";
import {
	assertAggregateRevision,
	latestAggregate,
} from "../src/factory/SpecialistReview.js";
import {
	baseline,
	cases,
	producer,
	reviewKey,
	roles,
	saveMetrics,
	setupReplay,
	specialists,
} from "./fixtures/composed-impact.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

// Provider polling is simulated; real 10-second waits make these drives load-sensitive.
let polling: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => {
	polling = vi
		.spyOn(readiness, "waitForNextPoll")
		.mockImplementation(
			() => new Promise((resolve) => setTimeout(resolve, 20)),
		);
});
afterEach(() => polling?.mockRestore());

const fixtures: ReturnType<typeof setupReplay>[] = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await fixture.cleanup();
});

// The coordinator can alias these ordinary source imports to the exact base.
// TASK145_BASELINE=1 omits both new options, retaining all behavioral assertions:
// a legacy replay is a concrete differential failure, not accepted as success.
it.each(cases)("preserves composed impact boundaries: %s", async (kind) => {
	const layout = cases.indexOf(kind) % 2 ? "python" : "js";
	const fixture = setupReplay(kind, layout);
	fixtures.push(fixture);
	let runtime = fixture.runtime,
		run = fixture.run;
	const accepted = structuredClone(run.workflowDefinitions);
	let execution = runtime.launch(run);
	let restartHistory: typeof run.history | undefined;
	let preApproval:
		| {
				visits: number;
				roleCounts: Record<string, number>;
				checks: number;
				qa: number;
				retrieval: typeof fixture.retrieval;
		  }
		| undefined;
	try {
		if (kind === "metadata-answer") {
			await waitForRuntime(
				() => expect(run.status, run.error).toBe("waiting"),
				{ timeout: 15000 },
			);
			expect(run.step).toBe(producer(roles.gate));
			const incomplete = latestAggregate(run, reviewKey)!;
			expect(
				incomplete.reviewers.filter((r) => r.status === "completed"),
			).toHaveLength(specialists.length - 1);
			expect(
				incomplete.reviewers.find((r) => r.stamp.reviewer === roles.coverage)
					?.status,
			).toBe("blocked");
			expect(run.humanDecisions ?? []).toEqual([]);
			expect(
				fixture.providerCalls.filter((c) => c.operation === "merge"),
			).toEqual([]);
			restartHistory = structuredClone(run.history);
			const checkpoint = structuredClone(run.checkpoint);
			const originalInventory = structuredClone(
				run.outputs[producer(roles.inventory)],
			);
			const originalReview = JSON.stringify(incomplete);
			await runtime.shutdown();
			await execution;
			runtime = fixture.createRuntime();
			run = runtime.get(run.id);
			expect(run.workflowDefinitions).toEqual(accepted);
			expect(run.history).toEqual(restartHistory);
			expect(run.checkpoint).toEqual(checkpoint);
			expect(run.outputs[producer(roles.inventory)]).toEqual(originalInventory);
			expect(JSON.stringify(latestAggregate(run, reviewKey))).toBe(
				originalReview,
			);
			execution = runtime.launch(run);
			await waitForRuntime(() =>
				expect(runtime.pendingAnswers.has(run.id)).toBe(true),
			);
			runtime.answer(
				run.id,
				"Independent fixture access is restored; accepted requirements are unchanged.",
			);
		}
		if (["accepted-requirements", "extraction-drift"].includes(kind)) {
			await waitForRuntime(
				() => expect(run.status, run.error).toBe("waiting"),
				{ timeout: 15000 },
			);
			expect(run.step).toBe(`${roles.outer}/${roles.edit}`);
			expect(run.humanDecisions ?? []).toEqual([]);
			await waitForRuntime(() =>
				expect(runtime.pendingAnswers.has(run.id)).toBe(true),
			);
			runtime.answer(
				run.id,
				"Accept the additional absent-resource requirement; preserve foreign resources and authorization.",
			);
		}
		// Bound first acceptance and correction separately: both must actually run.
		await waitForRuntime(
			() => {
				expect(run.status, run.error).not.toBe("failed");
				expect(fixture.count(roles.edit)).toBeGreaterThan(0);
			},
			{ timeout: 15000 },
		);
		await waitForRuntime(
			() => {
				expect(run.status, run.error).not.toBe("failed");
				const reviewed = latestAggregate(run, reviewKey);
				expect(reviewed?.baseline.round).toBeGreaterThan(1);
				expect(reviewed?.approved).toBe(true);
			},
			{ timeout: 15000 },
		);
		await waitForRuntime(
			() => {
				expect(run.status, run.error).not.toBe("failed");
				expect(run.status).toBe("waiting");
				expect(run.step).toBe(`${roles.outer}/${roles.human}`);
			},
			{ timeout: 15000 },
		);

		preApproval = {
			visits: run.history.length,
			roleCounts: { ...fixture.metrics().roleCounts },
			checks: fixture.checkRuns.length,
			qa: fixture.qaHeads.length,
			retrieval: { ...fixture.retrieval },
		};
		const final = latestAggregate(run, reviewKey)!;
		const first = latestAggregate(run, reviewKey, 1)!;
		const decision = run.impactDecisions!.at(-1)!;
		const head = fixture.git("rev-parse", "HEAD"),
			base = fixture.git("rev-parse", `origin/${fixture.target}`);
		expect(final.approved).toBe(true);
		expect(first.reviewers.map((r) => r.stamp.reviewer).sort()).toEqual(
			[...specialists].sort(),
		);
		expect(
			fixture.calls
				.filter((c) => specialists.includes(c.role) && c.round === 1)
				.map((c) => c.role)
				.sort(),
		).toEqual([...specialists].sort());
		expect(fixture.snapshots[0]!.reviewers.map((r) => r.id).sort()).toEqual(
			[...specialists].sort(),
		);
		expect(fixture.snapshots[0]!.reviewRound).toBeUndefined();
		expect(run.workflowDefinitions).toEqual(accepted);
		expect(run.boundOutputs?.[producer(roles.inventory)]).toBeDefined();
		expect(run.outputs).not.toHaveProperty(roles.inventory);
		expect(run.outputs[`${roles.outer}/${roles.qaGate}`]).toMatchObject({
			approved: true,
			headSha: head,
		});
		const unchangedBehavior = [
			"provider-recovery",
			"metadata-answer",
			"target-advance",
		].includes(kind);
		expect(fixture.qaHeads).toEqual(
			unchangedBehavior ? [fixture.initialHead] : [fixture.initialHead, head],
		);
		for (const role of [roles.plan, roles.capture, roles.qaReview])
			expect(fixture.count(role), `${role} actual QA invocation count`).toBe(
				unchangedBehavior ? 1 : 2,
			);
		expect(fixture.checkRuns).toEqual(
			unchangedBehavior ? [fixture.initialHead] : [fixture.initialHead, head],
		);
		expect(decision.pending).toEqual({
			specialists: [],
			checks: [],
			qaCriteria: [],
		});
		expect(decision.checkResults).toEqual(
			unchangedBehavior
				? []
				: [
						{
							id: "ownership-behavior",
							exitCode: 0,
							evidence: "ownership and authorization verified",
						},
					],
		);
		for (const check of fixture.checkVisits) {
			const selected =
				!check.snapshot.reviewRound ||
				check.snapshot.repositories.some((r) => r.diff) ||
				[
					"integration-conflict",
					"accepted-requirements",
					"weakened-tests",
					"extraction-drift",
				].includes(kind);
			expect(check.pending).toEqual(selected ? ["ownership-behavior"] : []);
			expect(check.snapshot.repositories[0]!.headSha).toBe(check.head);
		}
		const originalQa = fixture.originalQa()!;
		expect(originalQa.gate).toMatchObject({
			approved: true,
			headSha: fixture.initialHead,
		});
		if (unchangedBehavior) {
			expect(run.outputs[`${roles.outer}/${roles.capture}`]).toEqual(
				originalQa.capture,
			);
			expect(run.outputs[`${roles.outer}/${roles.qaReview}`]).toEqual(
				originalQa.review,
			);
			expect(run.outputs[`${roles.outer}/${roles.qaGate}`]).toEqual(
				originalQa.gate,
			);
			expect(run.outputs[`${roles.outer}/${roles.retainedCi}`]).toMatchObject({
				retainQa: true,
			});
			expect(decision.checks).toEqual([]);
			expect(decision.qaCriteria).toEqual([]);
			const criterion = QaCaptureSchema.parse(originalQa.capture).results[0]!
				.criteria[0]!;
			expect(criterion.origin?.environmentProofDigest).toBe(
				qaDigest("composed-fixture-v1"),
			);
			expect(decision.qaReuse).toEqual([
				{
					criterionId: "ownership-preserved",
					originalDigest: qaDigest(criterion),
					reason:
						"Actual source/dependencies and probed fixture environment are unchanged; retain the original independent gate's criterion",
				},
			]);
		}
		for (const record of decision.repeatRecords ?? []) {
			expect(record.reason.trim()).not.toBe("");
			expect(record.snapshotDigest).toBe(
				decision.inventoryBinding?.assessmentSnapshot.digest ??
					decision.snapshot.digest,
			);
			if (record.kind === "specialist")
				expect(record.originalDigest).toBe(
					qaDigest(
						first.reviewers.find(
							(receipt) => receipt.stamp.reviewer === record.id,
						),
					),
				);
			if (record.kind === "qa") {
				const original = run.history[record.originalHistoryIndex!];
				expect(original.step).toBe(`${roles.outer}/${roles.capture}`);
				expect(record.originalProducerKey).toBe(original.step);
				const criterion = QaCaptureSchema.parse(original.output)
					.results.flatMap((result) => result.criteria)
					.find((criterion) => criterion.criterionId === record.id)!;
				expect(record.originalDigest).toBe(qaDigest(criterion));
			}
		}
		assertAggregateRevision(final, head, base);

		const unchangedScope = ![
			"accepted-requirements",
			"extraction-drift",
		].includes(kind);
		// This is deliberately the same expectation on BASE. In particular, changed
		// Git must reach the assessor before any automatic inventory refresh.
		expect(
			fixture.count(roles.inventory),
			"exact producer extraction count",
		).toBe(unchangedScope ? 1 : 2);
		if (unchangedScope)
			expect(run.outputs[producer(roles.inventory)]).toEqual(
				first.baseline.inventory,
			);
		else {
			expect(final.baseline.inventory.requirements.map((r) => r.id)).toEqual([
				"R1",
				"R2",
			]);
			expect(final.baseline.inventory.digest).not.toBe(
				first.baseline.inventory.digest,
			);
		}
		const full = [
			"integration-conflict",
			"accepted-requirements",
			"weakened-tests",
			"extraction-drift",
		].includes(kind);
		const affected =
			kind === "small-correction" ? [roles.quality, roles.coverage] : [];
		for (const id of specialists) {
			const original = first.reviewers.find((r) => r.stamp.reviewer === id)!;
			const expected =
				full ||
				affected.includes(id) ||
				(kind === "metadata-answer" && id === roles.coverage)
					? 2
					: 1;
			expect(fixture.count(id), `${id} actual invocation count`).toBe(expected);
			if (expected === 1) {
				expect(final.reviewers.find((r) => r.stamp.reviewer === id)).toEqual(
					original,
				);
				const reuse = decision.reuseRecords.find(
					(r) => r.original.stamp.reviewer === id,
				)!;
				expect(reuse.originalDigest).toBe(qaDigest(original));
				expect(reuse.original).toEqual(original);
				expect(reuse.reason).toContain(
					`${id}: inspected actual unchanged callers`,
				);
			}
		}
		if (full) expect(decision.reuseRecords).toEqual([]);
		if (kind === "metadata-answer") {
			expect(run.history.slice(0, restartHistory!.length)).toEqual(
				restartHistory,
			);
			expect(
				fixture.calls.filter((c) => c.role === roles.coverage).at(-1)?.resume,
			).toBe(`synthetic-${reviewKey}/5/${roles.coverage}`);
			expect(fixture.count(roles.edit)).toBe(1);
		}
		if (kind === "provider-recovery") {
			expect(fixture.count(roles.providerFix)).toBe(0);
			expect(
				run.history
					.filter((h) => h.step === `${roles.outer}/${roles.ci}`)
					.at(-1)?.output,
			).toMatchObject({
				fix: true,
				checks: [
					{ name: "synthetic-native-check", state: "failure", bucket: "fail" },
				],
			});
			expect(run.outputs[`${roles.outer}/${roles.providerFix}`]).toMatchObject({
				skipped: true,
				reviewRequired: false,
				checks: [],
			});
			expect(
				run.history.filter(
					(h) => h.step === `${roles.outer}/${roles.providerFix}`,
				),
			).toHaveLength(1);
			expect(head).toBe(fixture.initialHead);
			expect(run.answers).toEqual([]);
		}
		if (kind === "metadata-answer") {
			if (!baseline)
				expect(decision.snapshot.inputDigest).not.toBe(
					first.baseline.impact?.snapshot.inputDigest,
				);
			expect(head).toBe(fixture.initialHead);
			expect(base).toBe(fixture.initialBase);
			expect(decision.scopeReuse?.inventoryDigest).toBe(
				first.baseline.inventory.digest,
			);
			expect(decision.scopeReuse?.originalSourceDigest).toBe(
				first.baseline.inventory.sourceContextDigest,
			);
		}
		if (kind === "target-advance") {
			expect(head).toBe(fixture.initialHead);
			expect(base).not.toBe(fixture.initialBase);
			expect(decision.snapshot.repositories[0]).toMatchObject({
				targetIncluded: false,
				targetFiles: ["release-notes.txt"],
				uncertainty: [],
			});
			expect(decision.snapshot.repositories[0]!.combinedTree).toBeTruthy();
		}
		if (kind === "integration-conflict") {
			expect(fixture.conflict()).toMatchObject({
				code: 1,
				output: expect.stringContaining("CONFLICT"),
			});
			expect(fixture.count(roles.repair)).toBe(1);
			expect(
				run.impactDecisions!.some(
					(d) =>
						d.correctionRequired &&
						!d.targetCompatible &&
						d.snapshot.repositories.some((r) => r.uncertainty.length),
				),
			).toBe(true);
			expect(fixture.git("rev-parse", "HEAD^2")).toBe(base);
			expect(decision.snapshot.repositories[0]).toMatchObject({
				targetIncluded: true,
				uncertainty: [],
			});
		}
		if (kind === "weakened-tests") {
			const weakened = run.impactDecisions!.find(
				(d) => d.testAssertions.weakened,
			)!;
			expect(weakened).toMatchObject({
				classification: "full",
				correctionRequired: true,
				reuseRecords: [],
			});
			expect(weakened.specialists.sort()).toEqual([...specialists].sort());
			expect(fixture.count(roles.repair)).toBe(1);
			expect(
				readFileSync(
					join(
						fixture.workspace,
						layout === "js" ? "checks/behavior.cjs" : "checks/behavior.py",
					),
					"utf8",
				),
			).toContain(
				layout === "js"
					? "assert(!allowed('unknown'))"
					: "not allowed('unknown')",
			);
		}
		if (kind === "extraction-drift") {
			const drift = fixture.drift();
			expect(drift.head).toBe(head);
			expect(drift.snapshot).toBeDefined();
			expect(drift.snapshot!.repositories[0]!.headSha).not.toBe(head);
			const assessed = run.impactDecisions!.find(
				(d) => d.snapshot.digest === drift.snapshot!.digest,
			)!;
			expect(assessed.snapshot.repositories).toEqual(
				drift.snapshot!.repositories,
			);
			expect(
				fixture.snapshots.some((s) => s.repositories[0]!.headSha === head),
			).toBe(true);
			expect(
				fixture.checkVisits.some(
					(c) =>
						c.head === head && c.snapshot.repositories[0]!.headSha !== head,
				),
			).toBe(false);
			expect(fixture.count(roles.assessor)).toBeGreaterThanOrEqual(3);
		}

		// A genuine runtime human gate follows QA; an operational answer is never an approval.
		expect(run.humanDecisions ?? []).toEqual([]);
		expect(run.approvalContinuations ?? []).toEqual([]);
		expect(
			fixture.providerCalls.filter((c) =>
				["draft", "merge"].includes(c.operation),
			),
		).toEqual([]);
		const gate = run.reviewGate!;
		expect(gate.headSha).toBe(head);
		expect(() =>
			runtime.decide(run.id, {
				reviewId: gate.id,
				headSha: "wrong-revision",
				decision: "approve",
			}),
		).toThrow("reviewed revision changed");
		expect(run.humanDecisions ?? []).toEqual([]);
		runtime.decide(run.id, {
			reviewId: gate.id,
			headSha: head,
			decision: "approve",
		});
		await execution;
		expect(run.status, run.error).toBe("completed");
		expect(run.humanDecisions).toHaveLength(1);
		expect(run.humanDecisions![0]).toMatchObject({
			reviewId: gate.id,
			decision: "approve",
			headSha: head,
		});
		expect(
			fixture.providerCalls.filter((c) => c.operation === "merge"),
		).toEqual([
			{
				operation: "merge",
				input: { url: fixture.url, headSha: head, method: "merge" },
				head,
				human: 1,
			},
		]);
		expect(run.outputs[`${roles.outer}/${roles.merge}`]).toMatchObject({
			merged: true,
			headSha: head,
		});
		expect(run.outputs[roles.outer]).toMatchObject({
			outcome: "completed",
			completed: true,
		});
	} finally {
		saveMetrics(kind, {
			...fixture.metrics(),
			baseline,
			preApproval,
			status: run.status,
			error: run.error,
			actualHistory: run.history.length,
			assessments: fixture.snapshots.length,
			assessmentBindings: run.impactDecisions?.map((d) => ({
				version: d.snapshot.reuseVersion,
				head: d.snapshot.repositories[0]?.headSha,
				original:
					d.inventoryBinding?.assessmentSnapshot.repositories[0]?.headSha,
				inventory: d.snapshot.inventoryDigest,
				snapshot: d.snapshot.digest,
				pending: d.pending,
				reused: d.reuseRecords.map((r) => ({
					role: r.original.stamp.reviewer,
					original: r.originalDigest,
					revision: r.original.stamp.headSha,
					reason: r.reason,
				})),
				repeated: d.repeatRecords,
			})),
			routeEvents: run.events
				.filter(
					(e) =>
						e.message.includes("stale") || e.step.endsWith(roles.inventory),
				)
				.map((e) => ({ step: e.step, message: e.message })),
			step: run.step,
			lastEvents: run.events
				.slice(-6)
				.map((event) => ({ step: event.step, message: event.message })),
			lastProvider: fixture.providerCalls.slice(-5),
		});
	}
}, 120_000);
