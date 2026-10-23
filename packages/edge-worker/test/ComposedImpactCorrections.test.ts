import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	historicalInventoryRead,
	type ImpactAssessment,
	type ImpactSnapshot,
	validateImpact,
} from "../src/factory/Impact.js";
import * as readiness from "../src/factory/MergeReadiness.js";
import { qaDigest } from "../src/factory/Qa.js";
import { outputRevisionBinding } from "../src/factory/RevisionBinding.js";
import { latestAggregate } from "../src/factory/SpecialistReview.js";
import { inheritStepConfig } from "../src/factory/StepConfig.js";
import { stepForRun } from "../src/factory/ToolBindings.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import {
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

it("allows only the qualified assessor owner to read original inventory after a committed correction", async () => {
	const fixture = setupReplay("provider-recovery", "js");
	try {
		const execution = fixture.runtime.launch(fixture.run);
		await waitForRuntime(
			() =>
				expect(latestAggregate(fixture.run, reviewKey)?.approved).toBe(true),
			{ timeout: 15000 },
		);
		await waitForRuntime(() => expect(fixture.count(roles.assessor)).toBe(2), {
			timeout: 15000,
		});
		await waitForRuntime(
			() => {
				expect(fixture.run.status, fixture.run.error).not.toBe("failed");
				expect(fixture.run.step).toBe(`${roles.outer}/${roles.human}`);
				expect(fixture.run.status).toBe("waiting");
			},
			{ timeout: 15000 },
		);
		const history = structuredClone(fixture.run.history);
		const checkpoint = structuredClone(fixture.run.checkpoint);
		await fixture.runtime.shutdown();
		await execution;
		const restored = fixture.createRuntime();
		const run = restored.get(fixture.run.id);
		expect(run.history).toEqual(history);
		expect(run.checkpoint).toEqual(checkpoint);
		const originalInventory = run.outputs[producer(roles.inventory)];
		const originalHead = fixture.git("rev-parse", "HEAD");
		writeFileSync(
			join(fixture.workspace, "correction.txt"),
			"committed correction; accepted requirements unchanged\n",
		);
		fixture.git("add", ".");
		fixture.git("commit", "-m", "correction after independent review");
		const currentHead = fixture.git("rev-parse", "HEAD");
		expect(currentHead).not.toBe(originalHead);
		const accepted = stepForRun(run, producer(roles.assessor))!;
		const source = stepForRun(run, producer(roles.inventory))!;
		const context: ExecutionContext = {
			run,
			step: accepted,
			stepKey: producer(roles.assessor),
			input: { originalInput: run.input },
			signal: new AbortController().signal,
			evidenceDir: join(fixture.home, "evidence"),
			log: () => {},
		};
		const original = run.boundOutputs![producer(roles.inventory)]!;
		const current = (await outputRevisionBinding(
			{ ...context, step: source, stepKey: producer(roles.inventory) },
			original,
		))!;
		// Exact production seam: Parallel dispatch shallow-copies routes, then calls this same inheritance API.
		// Configured question-enabled assessors are rejected by the outer-Parallel graph validator,
		// so this control deliberately does not bypass that independent human-placement guard.
		const copied = {
			...accepted,
			branches: accepted.branches.map((b) => ({ ...b })),
		};
		inheritStepConfig(accepted, copied);
		expect(
			await historicalInventoryRead(context, source, original, current),
		).toBe(true);
		expect(
			await historicalInventoryRead(
				{ ...context, step: copied },
				source,
				original,
				current,
			),
		).toBe(true);
		expect(
			await historicalInventoryRead(
				{ ...context, step: { ...accepted } },
				source,
				original,
				current,
			),
		).toBe(false);
		const wrongOwner = { ...accepted };
		inheritStepConfig(structuredClone(accepted), wrongOwner);
		expect(
			await historicalInventoryRead(
				{ ...context, step: wrongOwner },
				source,
				original,
				current,
			),
		).toBe(false);
		expect(
			await historicalInventoryRead(
				{ ...context, step: copied, stepKey: `other-frame/${accepted.id}` },
				source,
				original,
				current,
			),
		).toBe(false);
		const downstream = stepForRun(run, producer(roles.checks))!;
		expect(
			await historicalInventoryRead(
				{ ...context, step: downstream, stepKey: producer(roles.checks) },
				source,
				original,
				current,
			),
		).toBe(false);
		expect(
			await historicalInventoryRead(
				{ ...context, step: copied },
				{ ...source },
				original,
				current,
			),
		).toBe(false);
		expect(run.outputs[producer(roles.inventory)]).toEqual(originalInventory);
		expect(run.history).toEqual(history);
		expect(run.checkpoint).toEqual(checkpoint);
		expect(fixture.count(roles.inventory)).toBe(1);
		expect(run.humanDecisions ?? []).toEqual([]);
		expect(run.approvalContinuations ?? []).toEqual([]);
		saveMetrics("round1-parallel-owner", {
			...fixture.metrics(),
			history: run.history.length,
			originalHead,
			currentHead,
			originalInventory: {
				producer: producer(roles.inventory),
				digest: qaDigest(originalInventory),
				historyIndex: history.findIndex(
					(entry) => entry.step === producer(roles.inventory),
				),
				binding: original,
			},
			original: true,
			inheritedCopy: true,
			negativeControls: [
				"unowned equal config",
				"wrong owner",
				"same ID in other frame",
				"downstream stale decision",
				"unowned inventory producer",
			],
			qualification:
				"Production historical-read seam with genuine reconstructed receipts, not an outer-Parallel end-to-end drive",
		});
	} finally {
		await fixture.cleanup();
	}
}, 120000);

it("reassesses executed added requirement IDs after nested revision drift and refuses unqualified inventories", async () => {
	const fixture = setupReplay("extraction-drift", "python");
	let qualified: unknown;
	try {
		const agent = fixture.hooks.agent!;
		fixture.hooks.agent = async (context) => {
			const value = await agent(context);
			if (
				context.step.id !== roles.assessor ||
				!(value as ImpactAssessment).requirementIds.includes("R2")
			)
				return value;
			const snapshot = (context.input as { impactSnapshot: ImpactSnapshot })
				.impactSnapshot;
			const previous = latestAggregate(context.run, reviewKey)!;
			expect(previous.baseline.inventory.requirements.map((r) => r.id)).toEqual(
				["R1"],
			);
			const decision = validateImpact(value, snapshot, context.run);
			expect(decision.specialists.sort()).toEqual([...specialists].sort());
			expect(decision.inventoryBinding?.producerKey).toBe(
				producer(roles.inventory),
			);
			expect(() =>
				validateImpact(
					{ ...(value as ImpactAssessment), requirementIds: ["unknown"] },
					snapshot,
					context.run,
				),
			).toThrow("Impact references an unknown requirement");
			// Deliberately invalid COPIES passed only to the validator; genuine runtime state stays intact.
			const unexecuted = {
				...context.run,
				history: context.run.history.filter(
					(entry) =>
						entry.step !== producer(roles.inventory) ||
						qaDigest(entry.output) !== decision.inventoryBinding!.receiptDigest,
				),
			};
			expect(() => validateImpact(value, snapshot, unexecuted)).toThrow(
				"Impact references an unknown requirement",
			);
			const stale = {
				...context.run,
				boundOutputs: {
					...context.run.boundOutputs,
					[producer(roles.inventory)]: {
						...context.run.boundOutputs![producer(roles.inventory)]!,
						repositories: context.run.boundOutputs![
							producer(roles.inventory)
						]!.repositories.map((r) => ({
							...r,
							headSha: fixture.initialHead,
						})),
					},
				},
			};
			expect(() => validateImpact(value, snapshot, stale)).toThrow(
				"Impact references an unknown requirement",
			);
			qualified = {
				previousIds: ["R1"],
				assessedIds: decision.requirementIds,
				originalExtraction: decision.inventoryBinding,
				snapshot,
				pending: decision.pending,
				negativeControls: [
					"unknown ID",
					"missing original extraction receipt",
					"stale extraction head",
				],
			};
			return value;
		};
		const run = fixture.run;
		const execution = fixture.runtime.launch(run);
		await waitForRuntime(() => expect(run.status, run.error).toBe("waiting"), {
			timeout: 15000,
		});
		expect(run.step).toBe(`${roles.outer}/${roles.edit}`);
		await waitForRuntime(() =>
			expect(fixture.runtime.pendingAnswers.has(run.id)).toBe(true),
		);
		fixture.runtime.answer(
			run.id,
			"Accept the additional absent-resource requirement; preserve foreign resources and authorization.",
		);
		await waitForRuntime(
			() => {
				expect(run.status, run.error).not.toBe("failed");
				const review = latestAggregate(run, reviewKey);
				expect(review?.baseline.round).toBeGreaterThan(1);
				expect(review?.approved).toBe(true);
			},
			{ timeout: 15000 },
		);
		await waitForRuntime(
			() => {
				expect(run.status, run.error).not.toBe("failed");
				expect(run.step).toBe(`${roles.outer}/${roles.human}`);
				expect(run.status).toBe("waiting");
			},
			{ timeout: 15000 },
		);
		expect(qualified).toBeDefined();
		const reviewed = latestAggregate(run, reviewKey)!;
		expect(reviewed.approved).toBe(true);
		expect(reviewed.coverage.map((c) => c.requirementId).sort()).toEqual([
			"R1",
			"R2",
		]);
		expect(fixture.count(roles.inventory)).toBe(2);
		expect(fixture.count(roles.assessor)).toBe(3);
		expect(
			fixture.calls.filter((c) => specialists.includes(c.role)),
		).toHaveLength(12);
		expect(fixture.checkRuns).toHaveLength(2);
		expect(fixture.qaHeads).toHaveLength(2);
		expect(run.humanDecisions ?? []).toEqual([]);
		expect(run.approvalContinuations ?? []).toEqual([]);
		expect(
			fixture.providerCalls.filter((c) =>
				["draft", "merge"].includes(c.operation),
			),
		).toEqual([]);
		const gate = run.reviewGate!;
		expect(() =>
			fixture.runtime.decide(run.id, {
				reviewId: gate.id,
				headSha: "wrong-revision",
				decision: "approve",
			}),
		).toThrow("reviewed revision changed");
		const preApproval = { ...fixture.metrics(), history: run.history.length };
		fixture.runtime.decide(run.id, {
			reviewId: gate.id,
			headSha: gate.headSha,
			decision: "approve",
		});
		await execution;
		expect(run.status, run.error).toBe("completed");
		expect(run.outputs[`${roles.outer}/${roles.merge}`]).toMatchObject({
			merged: true,
			headSha: gate.headSha,
		});
		saveMetrics("round1-added-id", {
			...preApproval,
			qualified,
			nativeHuman: run.humanDecisions,
			providerMerge: fixture.providerCalls.filter(
				(c) => c.operation === "merge",
			),
		});
	} finally {
		await fixture.cleanup();
	}
}, 120000);
