import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const gate = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

it.each([
	900, 60_900,
])("restores only %ims of observed eligible waiting across an offline snapshot", async (earnedMs) => {
	const epoch = Date.parse("2026-10-23T10:00:00Z");
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(epoch);
	const directory = mkdtempSync(join(tmpdir(), "reservation-offline-age-"));
	const original = join(directory, "original"),
		recovered = join(directory, "recovered");
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...["normal", "completion"].map((priority) => ({
			id: `offline-${priority}`,
			name: `Offline ${priority}`,
			steps: [
				{
					id: "work",
					name: "Shared work",
					type: "tool",
					tool: "fixture-resource",
					resources: ["shared:offline-age"],
					access: { mode: "workspace", priority },
					next: "end",
				},
			],
		})),
	]);
	const normalFlow = definitions.find(({ id }) => id === "offline-normal")!;
	const completionFlow = definitions.find(
		({ id }) => id === "offline-completion",
	)!;
	const entered = gate(),
		release = gate();
	const first = new WorkflowRuntime(original, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ run, signal }) => {
			if (run.input === "owner") {
				entered.resolve();
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
			}
			return {};
		},
	});
	first.updateWorkflows(definitions);
	const create = (
		runtime: WorkflowRuntime,
		workflow: typeof normalFlow,
		input: string,
	) =>
		runtime.create({
			repositoryId: "fixture",
			workspace: directory,
			workflow,
			input,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	const owner = create(first, normalFlow, "owner"),
		normal = create(first, normalFlow, "normal");
	const launches: Promise<unknown>[] = [];
	let second: WorkflowRuntime | undefined;
	const order: string[] = [];
	let peak = 0,
		active = 0;
	let before: unknown,
		restored: unknown,
		eligible: unknown,
		observedAt: string | undefined;
	try {
		launches.push(first.launch(owner));
		await entered.promise;
		launches.push(first.launch(normal));
		await waitFor(() =>
			expect(normal.deliveryCoordination?.phase).toBe("queued"),
		);
		// Advance the live producer clock, then persist actual completed snapshot writes.
		const snapshotAt =
			Date.parse(normal.deliveryCoordination!.queuedAt) + earnedMs;
		vi.setSystemTime(snapshotAt);
		await first.save(owner);
		await first.save(normal);
		await first.flush();
		before = structuredClone(normal.deliveryCoordination);
		observedAt = normal.updatedAt;
		cpSync(original, recovered, { recursive: true });
		await first.shutdown();
		await Promise.all(launches);
		vi.setSystemTime(snapshotAt + 120_000);
		const resumedOwner = gate();
		second = new WorkflowRuntime(recovered, {
			agent: async () => ({}),
			script: async () => ({}),
			tool: async ({ run }) => {
				active++;
				peak = Math.max(peak, active);
				try {
					if (run.input === "owner") {
						resumedOwner.resolve();
						await release.promise;
					} else order.push(run.input);
					return {};
				} finally {
					active--;
				}
			},
		});
		restored = structuredClone(second.get(normal.id).deliveryCoordination);
		const restoredOwnerTask = second.launch(second.get(owner.id));
		await resumedOwner.promise;
		const completion = create(second, completionFlow, "completion");
		const completionTask = second.launch(completion);
		await waitFor(() =>
			expect(completion.deliveryCoordination?.phase).toBe("queued"),
		);
		const normalTask = second.launch(second.get(normal.id));
		await waitFor(() =>
			expect(second!.get(normal.id).deliveryCoordination?.admissionReady).toBe(
				true,
			),
		);
		eligible = structuredClone({
			normal: second.get(normal.id).deliveryCoordination,
			completion: completion.deliveryCoordination,
		});
		expect(completion.deliveryCoordination?.admissionReady).toBe(true);
		release.resolve();
		await Promise.all([restoredOwnerTask, normalTask, completionTask]);
		expect(peak).toBe(1);
		expect(second.get(normal.id).status).toBe("completed");
		expect(completion.status).toBe("completed");
		expect(order).toEqual(
			earnedMs < 60_000 ? ["completion", "normal"] : ["normal", "completion"],
		);
		expect(restored).toMatchObject({
			waitCreditMs: earnedMs,
			admissionReady: false,
		});
		expect(second.get(normal.id).createdAt).toBe(normal.createdAt);
	} finally {
		const output = process.env.BOBS_FACTORY_RESERVATION_RECEIPTS;
		if (output)
			writeFileSync(
				join(output, `offline-${earnedMs}.json`),
				JSON.stringify(
					{
						before,
						observedAt,
						restored,
						eligible,
						order,
						peak,
						earnedMs,
						offlineMs: 120_000,
					},
					null,
					2,
				),
			);
		release.resolve();
		if (second) {
			for (const run of second.runs.values()) second.stop(run.id);
			await second.shutdown();
		}
		for (const run of first.runs.values()) first.stop(run.id);
		await first.shutdown();
		await Promise.allSettled(launches);
		vi.useRealTimers();
		rmSync(directory, { recursive: true, force: true });
	}
}, 15000);
