import { afterEach, expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	type MergeReadiness,
	waitForNextPoll,
} from "../src/factory/MergeReadiness.js";
import {
	RunAccounting,
	timingOperation,
} from "../src/factory/RunDiagnostics.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { legacyExecutionContext } from "./fixtures/legacy-execution-context.js";

// All readiness receipts are local synthetic data; no provider/CI query can execute.
const mocked = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock("../src/factory/MergeReadiness.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../src/factory/MergeReadiness.js")
	>()),
	inspectReadinessWithRetry: mocked.readiness,
}));
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});
function fixture() {
	let wall = Date.now(),
		mono = 0;
	const controller = new AbortController(),
		accounting = new RunAccounting({ wall: () => wall, mono: () => mono });
	const context = legacyExecutionContext({
		run: {
			id: "synthetic",
			createdAt: new Date(wall).toISOString(),
			status: "running",
			questions: [],
			history: [],
			outputs: {
				"draft-pr": { url: "https://fixture.invalid/owner/repo/pull/1" },
			},
			humanDecisions: [{ decision: "approve", headSha: "head" }],
		},
		step: { tool: "merge" },
		stepKey: "scoped/merge",
		signal: controller.signal,
		log: () => {},
		groupedImpactValidated: true,
		validateDelivery: async () => undefined,
		executionApproval: { decision: "approve", headSha: "head" },
	} as unknown as ExecutionContext);
	context.checkpointDiagnostics = () => accounting.observe(context.run, true);
	timingOperation(context.run, "scoped/merge", { kind: "execution" });
	accounting.observe(context.run, true);
	const snapshot = {
		headSha: "head",
		baseSha: "base",
		url: "https://fixture.invalid/owner/repo/pull/1",
		state: "OPEN",
		isDraft: false,
		approved: false,
		reviewReady: true,
		fix: false,
		blockers: [
			{
				kind: "reviews",
				action: "human",
				message: "Required reviewer approval",
			},
		],
		checks: [{ name: "renamed-anything", state: "SUCCESS", bucket: "pass" }],
		threads: [],
		comments: [],
		reviews: [],
		queued: false,
		mergeMethod: "squash",
	} as MergeReadiness;
	return {
		context,
		snapshot,
		controller,
		tick: (ms: number) => {
			wall += ms;
			mono += ms;
			accounting.observe(context.run, true);
		},
	};
}
it.each([
	"human",
	"provider-ci",
	"both",
] as const)("P148-R2-S2: scoped %s blockers drive truthful overlapping wait unions and restore the prior operation", async (mode) => {
	vi.useFakeTimers();
	const f = fixture();
	if (mode === "provider-ci")
		f.snapshot.blockers = [
			{ kind: "checks", action: "wait", message: "Pending provider result" },
		];
	if (mode === "both")
		f.snapshot.blockers.push({
			kind: "checks",
			action: "wait",
			message: "Pending provider result",
		});
	const original = structuredClone(f.snapshot),
		decisions = structuredClone(f.context.run.humanDecisions);
	const pending = waitForNextPoll(f.context, 10000, f.snapshot);
	f.tick(2000);
	expect(f.context.run.diagnostics).toMatchObject({
		executionMs: 0,
		waitMs: 2000,
		waits:
			mode === "human"
				? { human: 2000 }
				: mode === "provider-ci"
					? { "provider-ci": 2000 }
					: { human: 2000, "provider-ci": 2000 },
	});
	expect(
		Object.values(f.context.run.diagnostics!.active)
			.map((s) => s.kind)
			.sort(),
	).toEqual(mode === "both" ? ["human", "provider-ci"] : [mode]);
	expect(f.context.run.diagnostics!.active["scoped/merge"].resource).toBe(
		mode === "provider-ci" ? "checks" : "reviews",
	);
	const rejected = expect(pending).rejects.toThrow("Run terminated");
	f.controller.abort();
	await rejected;
	expect(f.context.run.diagnostics!.operations).toEqual({
		"scoped/merge": { kind: "execution" },
	});
	expect(f.snapshot).toEqual(original);
	expect(f.context.run.humanDecisions).toEqual(decisions);
	expect(vi.getTimerCount()).toBe(0);
});
it("actual merge caller passes its green-check human-only receipt and never submits a merge while required reviewer approval is absent", async () => {
	vi.useFakeTimers();
	const f = fixture();
	mocked.readiness.mockResolvedValue(f.snapshot);
	const command = vi.fn(
		async (_context: ExecutionContext, exe: string, args: string[]) => {
			if (exe !== "git") throw new Error("No provider command allowed");
			if (args[0] === "rev-parse") return "head";
			if (args[0] === "status") return "";
			throw new Error(`Unexpected local command ${args}`);
		},
	);
	const tool = new FactoryTools({
		command,
		postComment: async () => {
			throw new Error("No external comment allowed");
		},
	});
	const pending = tool.tool(f.context);
	await vi.waitFor(() =>
		expect(f.context.run.diagnostics?.active["scoped/merge"]?.kind).toBe(
			"human",
		),
	);
	f.tick(2000);
	expect(f.context.run.diagnostics).toMatchObject({
		waitMs: 2000,
		waits: { human: 2000 },
	});
	expect(f.snapshot.approved).toBe(false);
	expect(f.snapshot.checks.every((c) => c.bucket === "pass")).toBe(true);
	expect(command.mock.calls.every(([, exe]) => exe === "git")).toBe(true);
	const rejected = expect(pending).rejects.toThrow();
	f.controller.abort();
	await rejected;
	expect(vi.getTimerCount()).toBe(0);
});
it("transport backoff retains its separate reason and original operation", async () => {
	vi.useFakeTimers();
	const f = fixture();
	const pending = waitForNextPoll(f.context, 10000, "retry-backoff");
	f.tick(1000);
	expect(f.context.run.diagnostics!.waits).toEqual({ "retry-backoff": 1000 });
	const rejected = expect(pending).rejects.toThrow();
	f.controller.abort();
	await rejected;
	expect(f.context.run.diagnostics!.operations["scoped/merge"].kind).toBe(
		"execution",
	);
});
