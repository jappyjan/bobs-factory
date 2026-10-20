import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

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
		await waitForRuntime(() => {
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
		await waitForRuntime(() => expect(tracking.isBusy()).toBe(false));
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
			await waitForRuntime(() =>
				expect(worker.getTicketTracking().isBusy()).toBe(false),
			);
			await worker.getFactoryRuntime().flush();
		}
		vi.restoreAllMocks();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each(
	references,
)("finalizes a saved agent result without waiting for $provider publication", async (reference) => {
	const home = mkdtempSync(join(tmpdir(), "role-publication-recovery-"));
	const repository = join(home, "repo");
	mkdirSync(repository);
	execFileSync("git", ["init", "-q", repository]);
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.test",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"Fixture",
		],
		{ cwd: repository },
	);
	const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: repository,
		encoding: "utf8",
	}).trim();
	const worker = new EdgeWorker({
		factoryHome: home,
		issueTrackerFactory: createCLIIssueTracker,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				repositoryPath: repository,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
			},
		],
	}) as unknown as WorkerInternals;
	const runtime = worker.getFactoryRuntime();
	let rejectPublication!: (error: Error) => void;
	const publication = new Promise<void>((_, reject) => {
		rejectPublication = reject;
	});
	const publish = vi.fn(() => publication);
	vi.spyOn(worker, "factoryTicketAdapter").mockResolvedValue({
		read: async () => ({
			comments: [],
			attachments: [],
			status: "in_progress",
		}),
		stage: async () => undefined,
		comment: async () => {},
		link: async () => {},
		publish,
	});
	const workflow = WorkflowSchema.parse({
		id: "saved-role",
		name: "Saved role",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "plan-review",
				name: "Review",
				type: "agent",
				prompt: "Already completed",
			},
			{
				id: "decisions",
				name: "Save decisions",
				type: "tool",
				tool: "record-decisions",
			},
			{
				id: "after",
				name: "Next step",
				type: "script",
				script: "printf advanced",
			},
		],
	});
	const run = runtime.create({
		id: "saved-role",
		repositoryId: "repo",
		workspace: repository,
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	const output = { approved: true, feedback: [] };
	run.ticketReference = reference;
	run.outputs.ticket = { id: reference.id };
	run.outputs.clarify = {
		decisions: [
			{
				question: "Which target?",
				answer: "Keep the configured target",
				reason: "Explicit accepted answer",
			},
		],
	};
	run.checkpoint = {
		current: "plan-review",
		visits: { "plan-review": 1 },
		active: {
			phase: "executing",
			agent: {
				runner: "codex",
				sessionId: "retained-conversation",
				result: {
					output,
					revision: {
						headSha,
						dirty: false,
						historyLength: 0,
						at: run.createdAt,
					},
					finalizing: true,
				},
			},
		},
	};
	try {
		await runtime.save(run);
		const executing = runtime.launch(run);
		await waitForRuntime(() => {
			expect(publish).toHaveBeenCalled();
			expect(run.status).toBe("completed");
		});
		await executing;
		expect(run.outputs["plan-review"]).toEqual(output);
		expect(run.outputs.after).toEqual({ stdout: "advanced" });
		expect(run.checkpoint.agentSessions?.["plan-review"]?.sessionId).toBe(
			"retained-conversation",
		);
		const receipt = run.ticketSync!.receipts.find((item) =>
			item.key.startsWith("role-outcome:"),
		)!;
		expect(receipt).toBeDefined();
		expect(receipt.delivered).not.toBe(true);
		expect(
			run.ticketSync!.receipts.some((item) => item.key.startsWith("comment:")),
		).toBe(true);
		const restored = new WorkflowRuntime(home, {
			agent: async () => {
				throw new Error("Do not replay the role");
			},
			script: async () => ({}),
			tool: async () => ({}),
		});
		expect(restored.get(run.id).ticketSync!.receipts).toContainEqual(receipt);
		await restored.shutdown();
	} finally {
		rejectPublication(new Error("Controlled publication outage"));
		worker.getTicketTracking().stop();
		await waitForRuntime(() =>
			expect(worker.getTicketTracking().isBusy()).toBe(false),
		);
		await runtime.shutdown();
		await worker.runnerSlots.shutdown();
		vi.restoreAllMocks();
		rmSync(home, { recursive: true, force: true });
	}
});
