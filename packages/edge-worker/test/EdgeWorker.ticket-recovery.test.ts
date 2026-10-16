import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type {
	TicketAdapter,
	TicketMilestone,
	TicketReference,
	TicketSnapshot,
	TicketTracking,
} from "../src/factory/TicketTracking.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import type {
	FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";

interface WorkerInternals {
	getFactoryRuntime(): WorkflowRuntime;
	getTicketTracking(): TicketTracking;
	factoryTicketAdapter(run: FactoryRun): Promise<TicketAdapter>;
	runnerSlots: MachineCapacity;
}

const references: TicketReference[] = [
	{
		provider: "native",
		platform: "linear",
		workspaceId: "workspace-a",
		id: "ticket-a",
		url: "https://linear.example/project-a/ticket-a",
	},
	{
		provider: "taskbot",
		server: "tickets",
		instance: "https://tickets.example",
		project: "project-b",
		id: 42,
		url: "https://tickets.example/p/project-b/t/42",
	},
];

it.each(
	references,
)("recovers saved work independently of stalled $provider delivery and retries its retained receipt", async (reference) => {
	const home = mkdtempSync(join(tmpdir(), "ticket-recovery-"));
	execFileSync("git", ["init", "-q", home]);
	const workers: WorkerInternals[] = [];
	const boot = () => {
		const worker = new EdgeWorker({
			factoryHome: home,
			issueTrackerFactory: createCLIIssueTracker,
			repositories: [
				{
					id: reference.provider,
					name: "Test project",
					repositoryPath: home,
					workspaceBaseDir: home,
					baseBranch: "main",
					isActive: true,
				},
			],
		}) as unknown as WorkerInternals;
		workers.push(worker);
		return { worker, runtime: worker.getFactoryRuntime() };
	};
	const ticket: TicketSnapshot = {
		comments: [],
		attachments: [],
		status: "in_progress",
	};
	let failDelivery!: (error: Error) => void;
	const blockedDelivery = new Promise<void>((_, reject) => {
		failDelivery = reject;
	});
	const adapter: TicketAdapter = {
		read: async () => ticket,
		stage: async () => undefined,
		link: async () => {},
		comment: async () => {},
		publish: vi.fn(() => blockedDelivery),
	};
	try {
		const first = boot();
		const workflow = WorkflowSchema.parse({
			id: "custom-recovery",
			name: "Custom recovery",
			allowedTriggers: ["manual"],
			steps: [
				{ id: "before", name: "Saved", type: "script", script: "exit 99" },
				{
					id: "after",
					name: "Remaining work",
					type: "script",
					script: "printf recovered",
				},
			],
		});
		const run = first.runtime.create({
			id: "retained-run",
			repositoryId: reference.provider,
			workflow,
			workspace: home,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
		run.status = "running";
		run.checkpoint = {
			current: "after",
			visits: { before: 1 },
			agentSessions: {
				before: { runner: "codex", sessionId: "saved-conversation" },
			},
		};
		run.outputs = { before: { saved: true }, ticket: { id: reference.id } };
		run.history = [
			{ step: "before", output: { saved: true }, at: run.createdAt },
		];
		run.ticketReference = reference;
		run.ticketSync = {
			receipts: [{ key: "saved-progress", body: "Retained publication" }],
		};
		await first.runtime.save(run);
		await first.runtime.shutdown();
		await first.worker.runnerSlots.shutdown();

		const restarted = boot();
		vi.spyOn(restarted.worker, "factoryTicketAdapter").mockResolvedValue(
			adapter,
		);
		const tracking = restarted.worker.getTicketTracking();
		restarted.runtime.resumeAll();
		await vi.waitFor(() => {
			expect(adapter.publish).toHaveBeenCalled();
			expect(restarted.runtime.get(run.id).status).toBe("completed");
		});
		const recovered = restarted.runtime.get(run.id);
		expect(tracking.isBusy()).toBe(true);
		expect(recovered.outputs.before).toEqual({ saved: true });
		expect(recovered.checkpoint?.agentSessions?.before?.sessionId).toBe(
			"saved-conversation",
		);
		expect(recovered.history.map((entry) => entry.step)).toEqual([
			"before",
			"after",
		]);
		const receipt = recovered.ticketSync!.receipts[0]!;
		const deliveryId = receipt.deliveryId;
		expect(deliveryId).toBeDefined();
		expect(receipt.delivered).not.toBe(true);
		// An unavailable tracker must not hold shutdown after work has settled.
		await restarted.runtime.shutdown();
		await restarted.worker.runnerSlots.shutdown();
		tracking.stop();
		failDelivery(new Error("Tracker unavailable"));
		await vi.waitFor(() => expect(tracking.isBusy()).toBe(false));
		await restarted.runtime.flush();
		expect(receipt.error).toBe("Tracker unavailable");
		expect(recovered.status).toBe("completed");

		// A later process retries the same durable delivery, without rerunning work.
		const retry = boot();
		const publish = vi.fn(async (_receipt: TicketMilestone, body: string) => {
			ticket.comments.push({ body });
		});
		vi.spyOn(retry.worker, "factoryTicketAdapter").mockResolvedValue({
			...adapter,
			publish,
		});
		const restored = retry.runtime.get(run.id);
		expect(restored.ticketSync!.receipts[0]!.deliveryId).toBe(deliveryId);
		expect(restored.ticketSync!.receipts[0]!.delivered).not.toBe(true);
		await retry.worker.getTicketTracking().flush(restored);
		expect(restored.ticketSync!.receipts[0]!.delivered).toBe(true);
		expect(publish.mock.calls[0]![0].deliveryId).toBe(deliveryId);
		expect(restored.history.map((entry) => entry.step)).toEqual([
			"before",
			"after",
		]);
		expect(restored.status).toBe("completed");
	} finally {
		failDelivery(new Error("Fixture cleanup"));
		for (const worker of workers) {
			worker.getTicketTracking().stop();
			await worker.runnerSlots.shutdown();
			await worker.getFactoryRuntime().shutdown();
			await vi.waitFor(() =>
				expect(worker.getTicketTracking().isBusy()).toBe(false),
			);
			await worker.getFactoryRuntime().flush();
		}
		vi.restoreAllMocks();
		rmSync(home, { recursive: true, force: true });
	}
});
