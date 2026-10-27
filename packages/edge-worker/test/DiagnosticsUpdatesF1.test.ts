import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { acquireDelivery } from "../src/factory/DeliveryCoordination.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import {
	accessGeneration,
	accessRequired,
	checkAccess,
} from "../src/factory/web/auth-state.js";
import { applyTimingUpdate } from "../src/factory/web/client.js";
import { TimingSummary } from "../src/factory/web/run-diagnostics.js";

// Only local mocked runtime/cache/renderer seams. No web shell, network or provider.
afterEach(() => {
	vi.useRealTimers();
	accessRequired("Synthetic test ended");
	vi.unstubAllGlobals();
});
async function authenticate() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
}
it("P148-R2-S1: actual heartbeat advances the Working caches and timing renderer for one unchanged scoped blocker, without a full-run refresh", async () => {
	await authenticate();
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
	const home = mkdtempSync(join(tmpdir(), "task148-update-"));
	let wall = Date.now(),
		mono = 0;
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "timing-update",
		name: "Timing update",
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "Mock",
				resources: ["docker"],
				access: { mode: "read-only" },
				next: "end",
			},
		],
	});
	const runtime = new WorkflowRuntime(
		home,
		{
			agent: async () => {
				throw new Error("Blocked role must not run");
			},
		},
		{ wall: () => wall, mono: () => mono },
	);
	const cache = new QueryClient();
	const create = () =>
		runtime.create({
			title: "Synthetic waiting role",
			repositoryId: "fixture",
			workspace: home,
			workflow,
			input: "mock",
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date(wall).toISOString(),
			},
		});
	const owner = create(),
		run = create();
	let unsubscribe = () => {},
		normalOff = () => {};
	try {
		await acquireDelivery(
			owner,
			() => runtime.runs.values(),
			new AbortController().signal,
			() => runtime.save(owner),
			() => {},
			{ key: "owner:resources", scopes: ['["resource","docker"]'] },
		);
		void runtime.launch(run);
		await vi.waitFor(() =>
			expect(run.diagnostics?.active.work?.kind).toBe("qa-resource"),
		);
		await runtime.flush();
		const originalClaim = structuredClone(run.deliveryReservations),
			originalHistory = structuredClone(run.history);
		// These are the ACTUAL useRuns/useRun query keys and their production projections.
		cache.setQueryData(
			["runs"],
			JSON.parse(JSON.stringify(runtime.listRuns())),
		);
		cache.setQueryData(["run", run.id], {
			id: run.id,
			diagnostics: structuredClone(run.diagnostics),
			retained: "dashboard",
		});
		cache.setQueryData(["run", run.id, "focus"], {
			id: run.id,
			retained: "focus",
		});
		const initial = cache
			.getQueryData<any[]>(["runs"])!
			.find((r) => r.id === run.id);
		const before = renderToStaticMarkup(
			createElement(TimingSummary, { diagnostics: initial.diagnostics }),
		);
		let normalChanges = 0,
			timingChanges = 0;
		normalOff = runtime.subscribe(() => normalChanges++);
		unsubscribe = runtime.subscribeDiagnostics((update) => {
			timingChanges++;
			applyTimingUpdate(cache, JSON.parse(JSON.stringify(update)));
		});
		const list = vi.spyOn(runtime, "listRuns"),
			save = vi.spyOn(runtime, "save"),
			fetch = vi.mocked(global.fetch);
		fetch.mockClear();
		wall += 5000;
		mono += 5000;
		await vi.advanceTimersByTimeAsync(5000);
		const current = cache
			.getQueryData<any[]>(["runs"])!
			.find((r) => r.id === run.id);
		expect(current.diagnostics).toMatchObject({
			ageMs: initial.diagnostics.ageMs + 5000,
			executionMs: 0,
			waitMs: 5000,
			current: [
				expect.objectContaining({
					kind: "qa-resource",
					measuredMs: 5000,
					blockerRun: owner.id,
				}),
			],
		});
		expect(cache.getQueryData<any>(["run", run.id]).diagnostics).toEqual(
			current.diagnostics,
		);
		expect(cache.getQueryData<any>(["run", run.id, "focus"])).toMatchObject({
			retained: "focus",
			diagnostics: current.diagnostics,
		});
		const after = renderToStaticMarkup(
			createElement(TimingSummary, { diagnostics: current.diagnostics }),
		);
		expect(before).toContain("Wait 0s");
		expect(after).toContain("Wait 5s");
		expect(after).toContain("QA resource docker");
		expect(after).toContain(owner.id);
		expect(normalChanges).toBe(0);
		expect(timingChanges).toBe(1);
		expect(list).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
		expect(run.deliveryReservations).toEqual(originalClaim);
		expect(run.history).toEqual(originalHistory);
		list.mockRestore();
		save.mockRestore();
	} finally {
		unsubscribe();
		normalOff();
		cache.clear();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
it("timing notifications cannot create missing private runs or repopulate caches after session rotation", async () => {
	await authenticate();
	const cache = new QueryClient(),
		epoch = accessGeneration();
	const update = { id: "missing", diagnostics: { ageMs: 10 } } as Parameters<
		typeof applyTimingUpdate
	>[1];
	try {
		applyTimingUpdate(cache, update, epoch);
		expect(cache.getQueryData(["runs"])).toBeUndefined();
		expect(cache.getQueryData(["run", "missing"])).toBeUndefined();
		accessRequired("Rotate synthetic session");
		await authenticate();
		cache.setQueryData(
			["runs"],
			[{ id: "missing", diagnostics: { ageMs: 1 } }],
		);
		applyTimingUpdate(cache, update, epoch);
		expect(cache.getQueryData(["runs"])).toEqual([
			{ id: "missing", diagnostics: { ageMs: 1 } },
		]);
	} finally {
		cache.clear();
	}
});
