import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	acquireDelivery,
	DELIVERY_AGING_MS,
	releaseDelivery,
	restoreDelivery,
} from "../src/factory/DeliveryCoordination.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const epoch = Date.parse("2026-10-23T10:00:00Z");
const target = (name: string) => JSON.stringify(["resource", name]);
const a = target("a"),
	b = target("b");
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		engineVersion: "nodes-v1",
		id: "delivery-fairness",
		name: "Delivery fairness",
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "Fixture",
				next: "end",
			},
		],
	},
]).at(-1)!;
const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const attempts: { controller: AbortController; settled: Promise<unknown> }[] =
	[];
const barriers: (() => void)[] = [];

afterEach(async () => {
	for (const { controller } of attempts) controller.abort();
	for (const resolve of barriers.splice(0)) resolve();
	await Promise.all(attempts.splice(0).map(({ settled }) => settled));
	vi.useRealTimers();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	barriers.push(resolve);
	return { promise, resolve };
}
function load(home: string) {
	const runtime = new WorkflowRuntime(home, { agent: async () => ({}) });
	runtimes.push(runtime);
	return runtime;
}
function fixture() {
	// Disk commit barriers keep their native immediates; only queue time is controlled.
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	vi.setSystemTime(epoch);
	const home = mkdtempSync(join(tmpdir(), "delivery-fairness-"));
	homes.push(home);
	const runtime = load(home);
	const create = (id: string) =>
		runtime.create({
			id,
			repositoryId: "fixture",
			workspace: home,
			workflow,
			input: id,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	const begin = (
		run: FactoryRun,
		options: NonNullable<Parameters<typeof acquireDelivery>[5]> = {},
		save: () => void | Promise<void> = () => {},
	) => {
		const controller = new AbortController();
		const promise = acquireDelivery(
			run,
			() => runtime.runs.values(),
			controller.signal,
			save,
			() => {},
			{ scopes: [a], ...options },
		);
		const settled = promise.then(
			() => "admitted",
			() => "cancelled",
		);
		attempts.push({ controller, settled });
		return { controller, promise, settled };
	};
	return { home, runtime, create, begin };
}
const clock = (milliseconds: number) => vi.setSystemTime(epoch + milliseconds);
const poll = () => vi.advanceTimersByTimeAsync(200);
const flushAdmission = () => vi.advanceTimersByTimeAsync(0);
const claim = (run: FactoryRun, key = "delivery") =>
	run.deliveryReservations![key]!;

it.each([
	"released",
	"active",
])("does not recycle run age or a previous %s admission", async (phase) => {
	const { create, begin } = fixture();
	const old = create("old");
	old.createdAt = "2020-01-01T00:00:00Z";
	await begin(old, { scopes: [b] }).promise;
	if (phase === "released") releaseDelivery(old, "Previous visit settled");
	const owner = create("owner");
	await begin(owner).promise;
	clock(1000);
	const first = create("first");
	const firstWait = begin(first);
	await flushAdmission();
	clock(2000);
	const next = begin(old);
	await flushAdmission();
	expect(claim(old)).toMatchObject({
		phase: "queued",
		queuedAt: new Date(epoch + 2000).toISOString(),
		waitingSince: new Date(epoch + 2000).toISOString(),
		priority: "normal",
	});
	releaseDelivery(owner, "Settled");
	await poll();
	await firstWait.promise;
	expect(claim(old).phase).toBe("queued");
	releaseDelivery(first, "Settled");
	await poll();
	await next.promise;
	expect(claim(old).waitingSince).toBeUndefined();
});

it("prefers a short-wait completion without preempting an active owner, and exposes the wait", async () => {
	const { create, begin } = fixture();
	const owner = create("owner"),
		normal = create("normal"),
		completion = create("completion");
	await begin(owner).promise;
	clock(100);
	const normalWait = begin(normal, { reason: "Correction" });
	await flushAdmission();
	clock(200);
	const completionWait = begin(completion, {
		priority: "completion",
		reason: "Finish accepted work",
	});
	await flushAdmission();
	expect(claim(owner).phase).toBe("active");
	expect(completion.deliveryCoordination?.reservations).toEqual([
		expect.objectContaining({
			runId: completion.id,
			operation: "delivery",
			scopes: [a],
			phase: "queued",
			priority: "completion",
			readiness: "blocked",
			reason: "Finish accepted work",
			waitingSince: new Date(epoch + 200).toISOString(),
			blockers: [{ runId: owner.id, operation: "delivery", targets: [a] }],
			waitReason: `run owner, operation delivery, target Shared resource a`,
		}),
	]);
	releaseDelivery(owner, "Settled");
	await poll();
	await completionWait.promise;
	expect(claim(normal).phase).toBe("queued");
	releaseDelivery(completion, "Settled");
	await poll();
	await normalWait.promise;
});

it("promotes an aged normal waiter through sustained completion arrivals", async () => {
	const { create, begin } = fixture();
	let owner = create("owner");
	await begin(owner).promise;
	clock(1);
	const normal = create("normal");
	const normalWait = begin(normal);
	await flushAdmission();
	for (const [index, time] of [2, 20_000, 40_000].entries()) {
		clock(time);
		const next = create(`completion-${index}`);
		const waiting = begin(next, { priority: "completion" });
		await flushAdmission();
		releaseDelivery(owner, "Settled");
		await poll();
		await waiting.promise;
		expect(claim(normal).phase).toBe("queued");
		owner = next;
	}
	clock(DELIVERY_AGING_MS + 1);
	const last = create("last-completion");
	const lastWait = begin(last, { priority: "completion" });
	await flushAdmission();
	releaseDelivery(owner, "Settled");
	await poll();
	await normalWait.promise;
	expect(claim(last).phase).toBe("queued");
	releaseDelivery(normal, "Settled");
	await poll();
	await lastWait.promise;
});

it("uses FIFO across aged priorities while newly arriving old corrections wait their turn", async () => {
	const { create, begin } = fixture();
	const owner = create("owner");
	await begin(owner).promise;
	const first = create("first-correction");
	const firstWait = begin(first);
	await flushAdmission();
	clock(1);
	const completion = create("completion");
	const completionWait = begin(completion, { priority: "completion" });
	await flushAdmission();
	clock(2);
	const second = create("second-correction");
	const secondWait = begin(second);
	await flushAdmission();
	clock(DELIVERY_AGING_MS + 2);
	const arrival = create("new-visit-of-old-correction");
	arrival.createdAt = "2020-01-01T00:00:00Z";
	const arrivalWait = begin(arrival);
	await flushAdmission();
	releaseDelivery(owner, "Settled");
	await poll();
	await firstWait.promise;
	expect(claim(completion).phase).toBe("queued");
	releaseDelivery(first, "Settled");
	await poll();
	await completionWait.promise;
	expect(claim(second).phase).toBe("queued");
	releaseDelivery(completion, "Settled");
	await poll();
	await secondWait.promise;
	releaseDelivery(second, "Settled");
	await poll();
	await arrivalWait.promise;
});

it("admits grouped scopes atomically while independent targets remain usable", async () => {
	const { create, begin } = fixture();
	const owner = create("owner-b");
	await begin(owner, { scopes: [b] }).promise;
	const group = create("group");
	const groupWait = begin(group, { scopes: [a, b] });
	await flushAdmission();
	expect(claim(group)).toMatchObject({ phase: "queued", scopes: [a, b] });
	expect(claim(group).heldScopes).toBeUndefined();
	const independent = create("independent");
	await begin(independent, { scopes: [target("c")] }).promise;
	releaseDelivery(owner, "Settled");
	await poll();
	await groupWait.promise;
	expect(claim(group)).toMatchObject({ phase: "active", scopes: [a, b] });
});

it("keeps owned targets exclusive throughout an atomic scope expansion", async () => {
	const { create, begin } = fixture();
	const group = create("group"),
		owner = create("owner-b");
	await begin(group).promise;
	await begin(owner, { scopes: [b] }).promise;
	clock(1000);
	const expansion = begin(group, { scopes: [a, b] });
	await flushAdmission();
	expect(claim(group)).toMatchObject({
		phase: "queued",
		scopes: [a, b],
		heldScopes: [a],
		queuedAt: new Date(epoch + 1000).toISOString(),
	});
	const completion = create("completion");
	const waiting = begin(completion, { priority: "completion" });
	await flushAdmission();
	expect(claim(completion).blockers).toEqual([
		{ runId: group.id, operation: "delivery", targets: [a] },
	]);
	releaseDelivery(owner, "Settled");
	await poll();
	await expansion.promise;
	expect(claim(group)).toMatchObject({ phase: "active", scopes: [a, b] });
	expect(claim(completion).phase).toBe("queued");
	releaseDelivery(group, "Settled");
	await poll();
	await waiting.promise;
});

it.each([
	"queued",
	"active",
])("does not let a stale %s save activate or release its replacement", async (phase) => {
	const { create, begin } = fixture();
	const run = create("replaced");
	const held = barrier();
	const stale = begin(run, {}, () =>
		claim(run).phase === phase ? held.promise : undefined,
	);
	await flushAdmission();
	const oldClaim = claim(run);
	expect(oldClaim.phase).toBe(phase);
	clock(1000);
	const replacement = begin(run, { priority: "completion" });
	await replacement.promise;
	const current = claim(run);
	if (phase === "active") stale.controller.abort();
	held.resolve();
	await expect(stale.promise).rejects.toThrow();
	expect(claim(run)).toBe(current);
	expect(current).toMatchObject({ phase: "active", priority: "completion" });
	expect(current.releasedAt).toBeUndefined();
});

it("protects a stopped in-process active owner until its hook settles, but ignores stopped queues", async () => {
	const { create, begin } = fixture();
	const owner = create("owner");
	await begin(owner).promise;
	const cancelled = create("cancelled-queue");
	const cancelledWait = begin(cancelled);
	await flushAdmission();
	cancelled.status = "stopped";
	owner.status = "stopped";
	let draining = true;
	const next = create("next");
	const waiting = begin(next, {
		ownerExecuting: (run) => run.id === owner.id && draining,
	});
	await flushAdmission();
	expect(claim(next).blockers).toEqual([
		{ runId: owner.id, operation: "delivery", targets: [a] },
	]);
	draining = false;
	await poll();
	await waiting.promise;
	cancelledWait.controller.abort();
	await expect(cancelledWait.promise).rejects.toThrow();
});

it("preserves proven queued waits on restart, starts active waits fresh, and never revives cancelled claims", async () => {
	const { home, runtime, create, begin } = fixture();
	const owner = create("active"),
		queued = create("queued"),
		cancelled = create("cancelled");
	const key = "work:mutation";
	for (const run of [owner, queued, cancelled])
		run.checkpoint = {
			current: "work",
			visits: {},
			active: { phase: "executing" },
		};
	await begin(owner, { key }).promise;
	clock(1000);
	const queuedWait = begin(queued, { key, priority: "completion" });
	const cancelledWait = begin(cancelled, { key });
	await flushAdmission();
	cancelledWait.controller.abort();
	await expect(cancelledWait.promise).rejects.toThrow();
	const queuedAt = claim(queued, key).queuedAt;
	clock(11_000); // Persist ten seconds of observed resource waiting.
	for (const run of [owner, queued, cancelled]) await runtime.save(run);
	// Legacy metadata omission is conservative; the original claim is retained.
	const legacy = structuredClone(queued);
	Reflect.deleteProperty(legacy, "updatedAt");
	restoreDelivery(legacy);
	expect(claim(legacy, key)).toMatchObject({ queuedAt, waitCreditMs: 0 });
	clock(DELIVERY_AGING_MS + 2000);
	const restored = load(home);
	expect(claim(restored.get(queued.id), key)).toMatchObject({
		phase: "queued",
		queuedAt,
		waitingSince: queuedAt,
		priority: "completion",
		readiness: "checking",
	});
	expect(claim(restored.get(owner.id), key)).toMatchObject({
		phase: "queued",
		queuedAt: new Date().toISOString(),
		waitingSince: new Date().toISOString(),
	});
	expect(claim(restored.get(cancelled.id), key).phase).toBe("released");
	const retainedCredit = 10_000;
	expect(claim(restored.get(queued.id), key)).toMatchObject({
		admissionReady: false,
		waitCreditMs: retainedCredit,
	});
	const legacyParked = structuredClone(restored.get(queued.id));
	Reflect.deleteProperty(legacyParked, "updatedAt");
	restoreDelivery(legacyParked);
	expect(claim(legacyParked, key)).toMatchObject({
		queuedAt,
		waitCreditMs: retainedCredit,
	});
	clock(DELIVERY_AGING_MS + 302_000);
	const resumed = restored.get(queued.id);
	await acquireDelivery(
		resumed,
		() => [resumed],
		new AbortController().signal,
		() => {},
		() => {},
		{ key, scopes: [a] },
	);
	expect(claim(resumed, key)).toMatchObject({
		phase: "active",
		admissionReady: true,
		queuedAt: new Date(Date.now() - retainedCredit).toISOString(),
	});
	const stopped = restored.get(queued.id);
	stopped.status = "stopped";
	restoreDelivery(stopped);
	expect(claim(stopped, key).phase).toBe("released");
	queuedWait.controller.abort();
	await expect(queuedWait.promise).rejects.toThrow();
});

it("retains stopping remote ownership through release and restart until capacity reconciliation", async () => {
	const { home, runtime, create, begin } = fixture();
	const owner = create("remote-owner"),
		next = create("next");
	const key = "work:mutation";
	await begin(owner, { key }).promise;
	owner.capacityLeaves = {
		work: {
			phase: "stopping",
			request: {
				id: "request",
				token: "fixture-token",
				sequence: 1,
				owner: { pid: 123, start: "fixture", incarnation: "fixture" },
				queuedAt: new Date().toISOString(),
				phase: "stopping",
				background: false,
				parked: false,
				identity: "remote-fixture",
				recoverable: false,
				remote: true,
			},
		},
	};
	owner.status = "stopped";
	releaseDelivery(owner, "Stopped", key);
	expect(claim(owner, key)).toMatchObject({
		phase: "active",
		readiness: "unknown",
		reason: "External execution cancellation is unconfirmed; resource retained",
	});
	await runtime.save(owner);
	clock(DELIVERY_AGING_MS + 1000);
	const restored = load(home).get(owner.id);
	restoreDelivery(restored);
	expect(claim(restored, key)).toMatchObject({
		phase: "active",
		readiness: "unknown",
	});
	expect(claim(restored, key).queuedAt).toBe(new Date(epoch).toISOString());
	const waiting = begin(next);
	await flushAdmission();
	expect(claim(next).blockers).toEqual([
		{ runId: owner.id, operation: key, targets: [a] },
	]);
	// The existing capacity reconciliation owns proof of cancellation and clears this leaf.
	delete owner.capacityLeaves.work;
	releaseDelivery(owner, "Capacity cancellation reconciled", key);
	await poll();
	await waiting.promise;
});

it("unwinds cyclic target expansion without dropping already-owned mutation scopes", async () => {
	const { create, begin } = fixture();
	const first = create("cycle-a"),
		second = create("cycle-b");
	await begin(first, { scopes: [a] }).promise;
	await begin(second, { scopes: [b] }).promise;
	const expandFirst = begin(first, { scopes: [a, b] });
	await flushAdmission();
	const expandSecond = begin(second, { scopes: [a, b] });
	await flushAdmission();
	await expect(expandSecond.promise).rejects.toThrow("expansion cycle");
	expect(claim(second)).toMatchObject({ phase: "active", scopes: [b] });
	expect(claim(first).phase).toBe("queued");
	releaseDelivery(second, "Outer mutation cleanup settled");
	await poll();
	await expandFirst.promise;
	expect(claim(first)).toMatchObject({ phase: "active", scopes: [a, b] });
});
