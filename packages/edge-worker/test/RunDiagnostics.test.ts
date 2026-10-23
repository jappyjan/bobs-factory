import { expect, it } from "vitest";
import {
	diagnosticAttempt,
	diagnosticReuse,
	diagnosticSummary,
	diagnosticUsage,
	RunAccounting,
	runDiagnostics,
	timingOperation,
} from "../src/factory/RunDiagnostics.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";
import type { CapacityRequest } from "../src/MachineCapacity.js";

function capacity(phase: CapacityRequest["phase"], parked = false) {
	return { phase, parked } as CapacityRequest;
}
function fixture() {
	let wall = Date.parse("2026-10-23T10:00:00Z"),
		mono = 0;
	const run = {
		id: "fixture",
		createdAt: new Date(wall - 10 * 86400000).toISOString(),
		status: "running",
		questions: [],
	} as unknown as FactoryRun;
	const accounting = new RunAccounting({ wall: () => wall, mono: () => mono });
	const tick = (ms: number, wallMs = ms) => {
		wall += wallMs;
		mono += ms;
		accounting.observe(run, true);
	};
	accounting.observe(run, true);
	return { run, accounting, tick, wall: () => wall };
}
it("accounts unions for nested parallel roles and each concurrent wait, independent of reused queue timestamps", () => {
	const { run, accounting, tick, wall } = fixture();
	timingOperation(run, "call/left", { kind: "execution", role: true });
	timingOperation(run, "call/right", { kind: "execution", role: true });
	accounting.observe(run, true);
	tick(3000);
	accounting.capacityChanged(run, "call/left", capacity("queued"));
	accounting.observe(run, true);
	tick(2000);
	timingOperation(run, "call/right");
	run.deliveryReservations = {
		"call/right:resources": {
			phase: "queued",
			scopes: ['["resource","docker"]'],
			queuedAt: "2020-01-01",
			blockers: [
				{
					runId: "other",
					operation: "test",
					targets: ['["resource","docker"]'],
				},
			],
		},
	};
	accounting.observe(run, true);
	tick(1000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 5000,
		roleWallMs: 8000,
		waitMs: 1000,
		waits: { capacity: 3000, "qa-resource": 1000 },
	});
	expect(diagnosticSummary(run, wall()).current).toContainEqual(
		expect.objectContaining({
			kind: "qa-resource",
			resource: "QA resource docker",
			blockerRun: "other",
		}),
	);
	// Actual admission and a later new queue interval are distinct receipts.
	accounting.capacityChanged(run, "call/left");
	delete run.deliveryReservations["call/right:resources"];
	accounting.observe(run, true);
	tick(500);
	accounting.capacityChanged(run, "call/left", capacity("queued"));
	accounting.observe(run, true);
	tick(500);
	expect(run.diagnostics!.active["call/left"]!.measuredMs).toBe(500);
	expect(run.diagnostics!.waits.capacity).toBe(3500);
	expect(
		run.diagnostics!.transitions.filter(
			(t) => t.kind === "capacity" && t.event === "entered",
		),
	).toHaveLength(2);
});
it("keeps offline, delayed observation and legacy gaps unknown, and uses monotonic time across rollback", () => {
	const { run, accounting, tick, wall } = fixture();
	timingOperation(run, "role", { kind: "execution", role: true });
	accounting.observe(run, true);
	tick(2000);
	const restored = structuredClone(run);
	const afterRestart = new RunAccounting({
		wall: () => wall() + 86400000,
		mono: () => 0,
	});
	afterRestart.restore(restored);
	afterRestart.observe(restored, false);
	expect(restored.diagnostics!.executionMs).toBe(2000);
	expect(restored.diagnostics!.active).toEqual({});
	expect(restored.diagnostics!.transitions.at(-1)?.event).toBe("interrupted");
	expect(diagnosticSummary(restored, wall() + 86400000).unobservedMs).toBe(
		11 * 86400000,
	);
	tick(1000, -5000);
	expect(run.diagnostics!.executionMs).toBe(3000);
	expect(run.diagnostics!.clockChanges).toBe(1);
	tick(60000); // A suspended/blocked observer cannot prove a minute of execution.
	expect(run.diagnostics!.executionMs).toBe(8000);
	const legacy = {
		id: "old",
		createdAt: new Date(wall() - 100000).toISOString(),
	} as FactoryRun;
	expect(diagnosticSummary(legacy, wall())).toMatchObject({
		legacy: true,
		executionMs: 0,
		unobservedMs: 100000,
	});
});
it("distinguishes CI, retry backoff, human, repository and recovery without granting authority", () => {
	const { run, accounting, tick } = fixture();
	for (const kind of [
		"provider-ci",
		"retry-backoff",
		"human",
		"repository",
		"recovery",
	] as const) {
		timingOperation(run, "renamed-operation", { kind });
		accounting.observe(run, true);
		tick(1000);
	}
	expect(run.diagnostics).toMatchObject({
		executionMs: 0,
		waitMs: 4000,
		waits: {
			"provider-ci": 1000,
			"retry-backoff": 1000,
			human: 1000,
			repository: 1000,
		},
	});
	expect(run).not.toHaveProperty("humanDecisions");
	expect(run).not.toHaveProperty("progressBudget");
});
it("bounds reads without touching a long-lived run's lazy payloads and labels missing attribution", () => {
	const { run, accounting, tick } = fixture();
	for (const key of ["history", "outputs", "stepAttempts", "workflow"])
		Object.defineProperty(run, key, {
			get() {
				throw new Error(`Unexpected full-run read: ${key}`);
			},
		});
	for (let i = 0; i < 1000; i++) {
		timingOperation(run, "check", {
			kind: i % 2 ? "execution" : "provider-ci",
		});
		accounting.observe(run, true);
		tick(1);
	}
	diagnosticUsage(run, "role", "codex", {
		usage: { input_tokens: 0, output_tokens: 0 },
		total_cost_usd: 0,
	});
	diagnosticUsage(run, "role", "codex", {
		usage: { input_tokens: 10, output_tokens: 5 },
		total_cost_usd: 0,
	});
	const exported = runDiagnostics(run, 0, 100000);
	expect(exported.limit).toBe(32);
	expect(exported.transitions).toHaveLength(32);
	expect(exported.nextOffset).toBe(32);
	expect(run.diagnostics!.transitions).toHaveLength(64);
	expect(JSON.stringify(exported).length).toBeLessThan(16000);
	expect(exported.usage).toEqual([
		{
			step: "role",
			provider: "codex",
			inputTokens: null,
			outputTokens: null,
			costUsd: null,
		},
		{
			step: "role",
			provider: "codex",
			inputTokens: 10,
			outputTokens: 5,
			costUsd: null,
		},
	]);
});

it("retains original reuse authority and distinguishes long nested step identities in bounded repetition counts", () => {
	const { run } = fixture();
	const receipt = Object.freeze({
		approved: false,
		nativeSession: "retained",
		evidence: "original",
	});
	Object.defineProperty(run, "outputs", {
		get: () => {
			throw new Error("Diagnostics must not read original evidence");
		},
	});
	const base = {
		id: "first",
		step: `nested/${"a".repeat(170)}/left`,
		type: "agent",
		kind: "step",
		reason: "initial",
		outcome: "completed",
		runtime: { commit: null },
		workflowHash: "w",
		contract: { hash: "c" },
		instructionsHash: "i",
	} as unknown as import("../src/factory/Provenance.js").StepAttempt;
	diagnosticAttempt(run, base, true);
	diagnosticAttempt(
		run,
		{ ...base, id: "second", step: base.step.replace("/left", "/right") },
		true,
	);
	expect(runDiagnostics(run).repeatedRoles).toEqual([]);
	diagnosticReuse(run, "qa", "original-digest", "criterion");
	diagnosticReuse(run, "qa", "original-digest", "criterion");
	expect(run.diagnostics!.reuse).toEqual([
		{ step: "qa", digest: "original-digest", source: "criterion" },
	]);
	expect(receipt).toEqual({
		approved: false,
		nativeSession: "retained",
		evidence: "original",
	});
	expect(run).not.toHaveProperty("humanDecisions");
	for (let i = 0; i < 100; i++)
		diagnosticAttempt(run, { ...base, id: `later-${i}` }, true);
	const count = run.diagnostics!.attemptCount;
	diagnosticAttempt(run, { ...base, outcome: "interrupted" }); // Late finalizer after the record has left the recent window.
	expect(run.diagnostics!.attemptCount).toBe(count);
	expect(run.diagnostics!.attempts).toHaveLength(64);
});

// P148-R1-S1 (Spec): retained scheduling state is not a new observation.
it("requires fresh eligible capacity callbacks after restore without changing saved scheduling records", () => {
	const { run, accounting, tick } = fixture();
	timingOperation(run, "prior", { kind: "execution", role: true });
	accounting.observe(run, true);
	tick(1000);
	run.capacityLeaves = {
		prior: { phase: "executing", request: capacity("executing") },
		parked: { phase: "queued", request: capacity("queued", true) },
	};
	const scheduling = structuredClone(run.capacityLeaves);
	accounting.restore(run);
	timingOperation(run, "run", { kind: "recovery" });
	accounting.observe(run, true);
	tick(2000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 1000,
		roleWallMs: 1000,
		waitMs: 0,
	});
	expect(run.capacityLeaves).toEqual(scheduling);
	expect(
		run.diagnostics!.transitions.some((t) => t.event === "interrupted"),
	).toBe(true);
	accounting.capacityChanged(run, "parked", capacity("queued", true));
	accounting.observe(run, true);
	tick(1000);
	expect(run.diagnostics!.waitMs).toBe(0);
	accounting.capacityChanged(run, "parked", capacity("queued"));
	accounting.observe(run, true);
	tick(1000);
	expect(run.diagnostics!.waits.capacity).toBe(1000);
	accounting.capacityChanged(run, "parked", capacity("executing"));
	accounting.observe(run, true);
	tick(2000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 3000,
		roleWallMs: 1000,
		waitMs: 1000,
	});
});
// P148-R1-S2 (Spec) and R148-R1-01 (root) retain separate trigger provenance.
it("counts actual attempts once and gives generic capacity execution no agent-role wall", () => {
	const { run, accounting, tick } = fixture();
	accounting.capacityChanged(run, "arbitrary-parent", capacity("executing"));
	timingOperation(run, "different-explanation-key", {
		kind: "execution",
		role: true,
		roleIdentity: "turn-1",
	});
	accounting.observe(run, true);
	tick(2000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 2000,
		roleWallMs: 2000,
	});
	// Two observations of the same actual turn do not create two roles.
	timingOperation(run, "alias", {
		kind: "execution",
		role: true,
		roleIdentity: "turn-1",
	});
	accounting.observe(run, true);
	tick(1000);
	expect(run.diagnostics!.roleWallMs).toBe(3000);
	timingOperation(run, "different-explanation-key");
	timingOperation(run, "alias");
	accounting.observe(run, true);
	tick(2000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 5000,
		roleWallMs: 3000,
	});
	accounting.capacityChanged(run, "arbitrary-parent");
	accounting.observe(run, true);
	tick(1000);
	expect(run.diagnostics!.executionMs).toBe(5000);
});
