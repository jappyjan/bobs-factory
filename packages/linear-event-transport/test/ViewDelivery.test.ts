import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
import {
	UnsentDispatchError,
	type ViewDeliveryControl,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

const homes: string[] = [],
	trackers: LinearIssueTrackerService[] = [];
afterEach(() => {
	for (const tracker of trackers.splice(0)) tracker.stopDelivery();
	vi.useRealTimers();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture(interval = 0) {
	const home = mkdtempSync(join(tmpdir(), "view-linear-dispatch-"));
	homes.push(home);
	const id = randomUUID(),
		workspaceId = randomUUID();
	let current = true,
		mode: "success" | "429" | "lost" = "success",
		confirmed = false;
	const mutations: unknown[] = [],
		lookups: string[] = [];
	const input = {
		id,
		agentSessionId: "synthetic-session",
		content: {
			type: "thought",
			body: `Decision batch: synthetic\nDisplayed digest: ${"a".repeat(64)}`,
		},
	};
	const control: ViewDeliveryControl = {
		identity: {
			version: 1,
			runId: "synthetic-run",
			receiptKey: "view:synthetic",
			batchId: "synthetic",
			digest: "a".repeat(64),
			deliveryId: id,
		},
		run: async (write) => {
			if (!current) throw new UnsentDispatchError("superseded");
			return { value: write() };
		},
	};
	const open = (authority = true, identify = false, unavailable = false) => {
		const client = new LinearClient({ accessToken: workspaceId });
		client.client.request = vi.fn(async (_document, variables: any) => {
			if (variables.input) {
				mutations.push(structuredClone(variables.input));
				if (mode === "429")
					throw { response: { status: 429, headers: new Headers() } };
				if (mode === "lost") {
					confirmed = true;
					throw new Error("Synthetic lost response");
				}
				return {
					agentActivityCreate: {
						success: true,
						agentActivity: { id },
						lastSyncId: 1,
					},
				};
			}
			if (variables.id === id) {
				lookups.push(variables.id);
				if (!confirmed) throw { response: { status: 404 } };
				return {
					agentActivity: {
						...input,
						agentSession: { id: input.agentSessionId },
						createdAt: new Date().toISOString(),
					},
				};
			}
			return { issue: { id: "budget-read", reactions: [] } };
		}) as any;
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{
				workspaceId,
				factoryHome: home,
				requestIntervalMs: interval,
				...(identify
					? {
							identifyView: (saved) => {
								if (unavailable) throw new UnsentDispatchError("unavailable");
								return saved.id === id ? control.identity : undefined;
							},
						}
					: {}),
				...(authority
					? {
							resolveView: (identity, saved) => {
								expect(identity).toEqual(control.identity);
								expect(saved).toEqual(input);
								return control;
							},
						}
					: {}),
			},
		);
		trackers.push(tracker);
		return { tracker, client };
	};
	const records = () =>
		JSON.parse(
			readFileSync(
				join(
					home,
					"state/linear-activity-delivery",
					readdirSync(join(home, "state/linear-activity-delivery"))[0]!,
				),
				"utf8",
			),
		).records;
	return {
		open,
		input,
		control,
		mutations,
		lookups,
		records,
		absent: () => {
			confirmed = false;
		},
		change: () => {
			current = false;
		},
		mode: (value: typeof mode) => {
			mode = value;
		},
	};
}

it("persists private authority separately, delivers unchanged content and deduplicates the original ID after restart", async () => {
	const f = fixture(),
		first = f.open();
	await first.tracker.createAgentActivity(f.input, { view: f.control });
	expect(f.mutations).toEqual([f.input]);
	expect(f.records()[0]).toMatchObject({
		status: "delivered",
		ambiguous: true,
		view: f.control.identity,
	});
	expect(f.records()[0].input).toBeUndefined();
	first.tracker.stopDelivery();
	await f.open(false).tracker.createAgentActivity(f.input, { view: f.control });
	expect(f.mutations).toHaveLength(1);
});

it("rechecks after real request-budget pacing and retires obsolete definitely-unsent input without confirmation", async () => {
	vi.useFakeTimers();
	const f = fixture(2000),
		{ tracker, client } = f.open();
	await client.issue("consume-pacing-slot");
	const pending = tracker.createAgentActivity(f.input, { view: f.control });
	const result = expect(pending).rejects.toBeInstanceOf(UnsentDispatchError);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.mutations).toEqual([]);
	f.change();
	await vi.advanceTimersByTimeAsync(2000);
	await result;
	expect(f.mutations).toEqual([]);
	expect(f.records()[0]).toMatchObject({
		status: "superseded",
		attempts: 0,
		ambiguous: false,
		originalEvidence: f.input,
	});
	expect(f.records()[0].activityId).toBeUndefined();
});

it("keeps a known-429 unsent retry private and pending without a resolver, then supersedes after persisted recovery", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("429");
	await expect(
		first.tracker.createAgentActivity(f.input, { view: f.control }),
	).rejects.toThrow("pending");
	expect(f.records()[0]).toMatchObject({
		status: "pending",
		ambiguous: false,
		attempts: 1,
	});
	first.tracker.stopDelivery();
	f.change();
	f.mode("success");
	const unavailable = f.open(false);
	await vi.advanceTimersByTimeAsync(30_000);
	await unavailable.tracker.flushActivityDelivery();
	expect(f.mutations).toHaveLength(1);
	expect(f.records()[0]).toMatchObject({ status: "pending", ambiguous: false });
	unavailable.tracker.stopDelivery();
	const recovered = f.open();
	await vi.advanceTimersByTimeAsync(30_000);
	await recovered.tracker.flushActivityDelivery();
	expect(f.records()[0]).toMatchObject({
		status: "superseded",
		attempts: 1,
		originalEvidence: f.input,
	});
	expect(f.records()[0].activityId).toBeUndefined();
	expect(f.mutations).toHaveLength(1);
	await expect(
		recovered.tracker.createAgentActivity(f.input, { view: f.control }),
	).rejects.toBeInstanceOf(UnsentDispatchError);
});

it("reconciles an ambiguous accepted original before consulting supersession or missing runtime authority", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("lost");
	await expect(
		first.tracker.createAgentActivity(f.input, { view: f.control }),
	).rejects.toThrow("pending");
	first.tracker.stopDelivery();
	f.change();
	f.mode("success");
	const recovered = f.open(false);
	await vi.advanceTimersByTimeAsync(30_000);
	await recovered.tracker.flushActivityDelivery();
	expect(f.lookups).toEqual([f.input.id]);
	expect(f.mutations).toEqual([f.input]);
	expect(f.records()[0]).toMatchObject({
		status: "delivered",
		activityId: f.input.id,
		originalEvidence: f.input,
	});
	await recovered.tracker.createAgentActivity(f.input, { view: f.control });
	expect(f.mutations).toHaveLength(1);
});

it("never accepts a repurposed delivery ID or an agent-like replacement authority", async () => {
	const f = fixture(),
		{ tracker } = f.open();
	await tracker.createAgentActivity(f.input, { view: f.control });
	await expect(
		tracker.createAgentActivity(
			{ ...f.input, content: { type: "thought", body: "new digest" } },
			{ view: f.control },
		),
	).rejects.toThrow("identity");
	await expect(
		tracker.createAgentActivity(f.input, {
			view: {
				...f.control,
				identity: { ...f.control.identity, digest: "b".repeat(64) },
			},
		}),
	).rejects.toThrow("authority");
	expect(f.mutations).toHaveLength(1);
});

it("serializes only the original activity input through the real SDK and HTTP request after local validation", async () => {
	const home = mkdtempSync(join(tmpdir(), "linear-wire-view-"));
	homes.push(home);
	const input = {
		id: randomUUID(),
		agentSessionId: randomUUID(),
		content: { type: "thought", body: "Exact displayed discussion" },
	};
	const requests: unknown[] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		const parsed = JSON.parse(body);
		requests.push(parsed.variables.input);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify({
				data: {
					agentActivityCreate: {
						success: true,
						agentActivity: { id: input.id },
						lastSyncId: 1,
					},
				},
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address");
	const control: ViewDeliveryControl = {
		identity: {
			version: 1,
			runId: "run",
			receiptKey: "receipt",
			batchId: "batch",
			digest: "a".repeat(64),
			deliveryId: input.id,
		},
		run: async (write) => ({ value: write() }),
	};
	const tracker = new LinearIssueTrackerService(
		new LinearClient({
			apiUrl: `http://127.0.0.1:${address.port}`,
			accessToken: "synthetic",
		}),
		undefined,
		undefined,
		{
			factoryHome: home,
			workspaceId: randomUUID(),
			requestIntervalMs: 0,
			resolveView: () => control,
		},
	);
	trackers.push(tracker);
	try {
		await tracker.createAgentActivity(input, { view: control });
		expect(requests).toEqual([input]);
	} finally {
		tracker.stopDelivery();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("serializes concurrent reconciliation and recovery around the same ambiguous original", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("lost");
	await expect(
		first.tracker.createAgentActivity(f.input, { view: f.control }),
	).rejects.toThrow("pending");
	first.tracker.stopDelivery();
	f.change();
	const recovered = f.open(false);
	const states = await Promise.all([
		recovered.tracker.reconcileAgentActivityDelivery(f.input.id),
		recovered.tracker.reconcileAgentActivityDelivery(f.input.id),
		recovered.tracker.flushActivityDelivery(),
	]);
	expect(states.slice(0, 2)).toEqual(["delivered", "delivered"]);
	expect(f.lookups).toEqual([f.input.id]);
	expect(f.mutations).toEqual([f.input]);
});

it("supersedes an ambiguous original only after the provider conclusively proves that exact ID absent", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("lost");
	await expect(
		first.tracker.createAgentActivity(f.input, { view: f.control }),
	).rejects.toThrow("pending");
	first.tracker.stopDelivery();
	f.change();
	f.absent();
	const recovered = f.open();
	expect(
		await recovered.tracker.reconcileAgentActivityDelivery(f.input.id),
	).toBe("superseded");
	expect(f.lookups).toEqual([f.input.id]);
	expect(f.mutations).toEqual([f.input]);
	expect(f.records()[0]).toMatchObject({
		status: "superseded",
		ambiguous: false,
		originalEvidence: f.input,
	});
	expect(f.records()[0].activityId).toBeUndefined();
});

it("binds a genuine pre-guard queued input by its canonical retained delivery identity before recovery", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("429");
	await expect(first.tracker.createAgentActivity(f.input)).rejects.toThrow(
		"pending",
	);
	expect(f.records()[0].view).toBeUndefined();
	first.tracker.stopDelivery();
	f.change();
	f.mode("success");
	const recovered = f.open(true, true);
	await vi.advanceTimersByTimeAsync(30_000);
	await recovered.tracker.flushActivityDelivery();
	expect(f.records()[0]).toMatchObject({
		status: "superseded",
		view: f.control.identity,
	});
	expect(f.mutations).toEqual([f.input]);
	expect(f.records()[0].activityId).toBeUndefined();
});

it("does not apply mutation authority to unrelated metadata work inheriting the local async scope", async () => {
	const f = fixture(),
		{ tracker, client } = f.open();
	let checks = 0,
		read: ReturnType<typeof client.issue> | undefined;
	const original = f.control.run;
	f.control.run = async (write) => {
		checks++;
		if (checks === 1) read = client.issue("metadata-created-during-validation");
		return original(write);
	};
	await tracker.createAgentActivity(f.input, { view: f.control });
	await read;
	expect(checks).toBe(1);
	expect(f.mutations).toEqual([f.input]);
});

it("reconciles an old ambiguous wire input before even attempting unavailable legacy runtime binding", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		first = f.open();
	f.mode("lost");
	await expect(first.tracker.createAgentActivity(f.input)).rejects.toThrow(
		"pending",
	);
	first.tracker.stopDelivery();
	f.change();
	const recovered = f.open(false, true, true);
	await vi.advanceTimersByTimeAsync(30_000);
	await recovered.tracker.flushActivityDelivery();
	expect(f.lookups).toEqual([f.input.id]);
	expect(f.mutations).toEqual([f.input]);
	expect(f.records()[0]).toMatchObject({
		status: "delivered",
		activityId: f.input.id,
	});
	expect(f.records()[0].view).toBeUndefined();
});
