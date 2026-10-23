import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

function receipt(name: string, data: unknown) {
	const directory = process.env.BOBS_FACTORY_RESERVATION_RECEIPTS;
	if (directory)
		writeFileSync(join(directory, name), JSON.stringify(data, null, 2));
}
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

it.each([
	"single",
	"unchanged",
	"changed",
	"dirty",
	"unreadable",
])("continued publication respects affected authority and %s context", async (mode) => {
	const home = mkdtempSync(join(tmpdir(), "reservation-publication-"));
	const effects: { repository: string; command: string; args: string[] }[] = [];
	let published = false;
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (context, command, args) => {
			const repository = context.run.repositoryId;
			effects.push({ repository, command, args });
			if (command === "git") {
				if (args[0] === "branch") return "feature";
				if (args[0] === "status")
					return repository === "context" &&
						context.step.id === "continued" &&
						mode === "dirty"
						? "?? local.ts"
						: "";
				if (args[0] === "rev-list")
					return repository === "repo" ||
						(context.step.id === "continued" && mode === "changed")
						? "1"
						: "0";
				if (args[0] === "diff") {
					if (
						repository === "context" &&
						context.step.id === "continued" &&
						mode === "unreadable"
					)
						throw new Error("Base unavailable");
					return repository === "repo" ||
						(context.step.id === "continued" && mode === "changed")
						? "source.ts"
						: "";
				}
				if (args[0] === "rev-parse") return "head";
				return "";
			}
			const request = githubRequest(args);
			if (request.method === "POST" && request.path.endsWith("/pulls")) {
				published = true;
				return JSON.stringify(
					githubApiReceipt([
						JSON.stringify({ ...request, path: `${request.path}/1` }),
					]),
				);
			}
			if (request.method === "GET" && request.path.includes("/pulls?"))
				return JSON.stringify(
					published
						? [{ html_url: "https://github.com/test/repo/pull/1", draft: true }]
						: [],
				);
			return JSON.stringify(githubApiReceipt(args));
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "publication-recovery",
			name: "Publication recovery",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "original",
					name: "Publish work",
					type: "tool",
					tool: "draft-pr",
					next: "continued",
				},
				{
					id: "continued",
					name: "Publish correction",
					type: "tool",
					tool: "draft-pr",
					arguments: { publication: "existing" },
					reads: { draftPr: "original" },
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const repositories = [
		{
			id: "repo",
			name: "Changed",
			repositoryPath: home,
			workspace: home,
			baseBranch: "main",
			githubUrl: "https://github.com/test/repo",
		},
	];
	if (mode !== "single")
		repositories.push({
			id: "context",
			name: "Context",
			repositoryPath: home,
			workspace: home,
			baseBranch: "main",
			githubUrl: "https://github.com/test/context",
		});
	const run = runtime.create({
		repositoryId: "repo",
		repositories,
		workspace: home,
		workflow,
		input: mode,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	try {
		await runtime.launch(run);
		receipt(`publication-${mode}.json`, {
			status: run.status,
			error: run.error,
			history: run.history.map(({ step, output }) => ({ step, output })),
			effects,
		});
		if (mode === "single" || mode === "unchanged") {
			expect(run.status, run.error).toBe("completed");
			expect(run.history.map(({ step }) => step)).toEqual([
				"original",
				"continued",
			]);
			expect(
				effects.filter(
					(effect) => effect.command === "git" && effect.args[0] === "push",
				),
			).toHaveLength(2);
		} else {
			expect(run.status).toBe("failed");
			expect(run.error).toMatch(
				mode === "unreadable"
					? /Base unavailable/
					: /original executed PR receipt/,
			);
		}
		expect(
			effects.filter(
				(effect) =>
					effect.repository === "context" &&
					effect.command === "git" &&
					["push", "add", "commit"].includes(effect.args[0]!),
			),
		).toEqual([]);
		expect(
			effects.filter(
				(effect) =>
					effect.command !== "git" &&
					githubRequest(effect.args).method === "POST",
			),
		).toHaveLength(1);
	} finally {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("normal shutdown and resumeAll park resource priority until capacity admission, then complete without overlap", async () => {
	const home = mkdtempSync(join(tmpdir(), "reservation-restart-"));
	const workflows = validateWorkflows([
		...defaultWorkflows,
		...[false, true].map((computeIntensive) => ({
			id: computeIntensive ? "intensive-recovery" : "resource-owner-recovery",
			name: "Resource recovery",
			steps: [
				{
					id: "shared",
					name: "Shared action",
					type: "tool",
					tool: "fixture-qa",
					computeIntensive,
					resources: ["docker:recovery/shared"],
					next: "end",
				},
			],
		})),
	]);
	const intensive = workflows.find(({ id }) => id === "intensive-recovery")!;
	const noncompute = workflows.find(
		({ id }) => id === "resource-owner-recovery",
	)!;
	const capacity = new SessionSemaphore(1);
	const entered = deferred(),
		held = deferred();
	const first = new WorkflowRuntime(home, {
		capacity,
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
	const make = (workflow: typeof intensive, input: string) =>
		first.create({
			repositoryId: "repo",
			workspace: home,
			workflow,
			input,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	const older = make(intensive, "older-capacity-first");
	await first.save(older);
	const owner = make(noncompute, "owner"),
		waiting = make(intensive, "earlier-resource-waiter");
	let second: WorkflowRuntime | undefined;
	const visits: string[] = [];
	let concurrent = 0,
		peak = 0;
	let before: unknown, restoredBefore: unknown, during: unknown;
	const restoredCapacity = new SessionSemaphore(1);
	try {
		const ownerTask = first.launch(owner);
		await entered.promise;
		const waitingTask = first.launch(waiting);
		await waitFor(() =>
			expect(waiting.deliveryCoordination?.phase).toBe("queued"),
		);
		const olderTask = first.launch(older);
		await waitFor(() => expect(capacity.waiting).toBe(1));
		before = structuredClone({
			older,
			waiting,
			capacity: { active: capacity.active, waiting: capacity.waiting },
		});
		const originalQueuedAt = waiting.deliveryCoordination!.queuedAt;
		await first.shutdown();
		await Promise.all([ownerTask, waitingTask, olderTask]);
		second = new WorkflowRuntime(home, {
			capacity: restoredCapacity,
			agent: async () => ({}),
			script: async () => ({}),
			tool: async ({ run }) => {
				visits.push(run.input);
				concurrent++;
				peak = Math.max(peak, concurrent);
				try {
					if (run.id === older.id) await held.promise;
					return {};
				} finally {
					concurrent--;
				}
			},
		});
		restoredBefore = structuredClone({
			older: second.get(older.id),
			waiting: second.get(waiting.id),
		});
		second.resumeAll();
		await waitFor(() => expect(visits).toContain(older.input));
		await waitFor(() => expect(restoredCapacity.waiting).toBe(1));
		during = structuredClone({
			older: second.get(older.id),
			waiting: second.get(waiting.id),
			capacity: {
				active: restoredCapacity.active,
				waiting: restoredCapacity.waiting,
			},
		});
		expect(second.get(waiting.id).deliveryCoordination).toMatchObject({
			phase: "queued",
			queuedAt: originalQueuedAt,
			admissionReady: false,
		});
		expect(second.get(older.id).deliveryCoordination?.phase).toBe("active");
		held.resolve();
		await waitFor(() =>
			expect(second!.get(waiting.id).status).toBe("completed"),
		);
		await waitFor(() => expect(second!.get(older.id).status).toBe("completed"));
		await waitFor(() => expect(restoredCapacity.active).toBe(0));
		expect(visits.filter((input) => input === waiting.input)).toHaveLength(1);
		expect(visits.filter((input) => input === older.input)).toHaveLength(1);
		expect(peak).toBe(1);
	} finally {
		receipt("restart-capacity.json", {
			before,
			restoredBefore,
			during,
			final: second
				? [...second.runs.values()].map(
						({ id, input, status, deliveryCoordination, capacityLeaves }) => ({
							id,
							input,
							status,
							deliveryCoordination,
							capacityLeaves,
						}),
					)
				: [],
			visits,
			peak,
			capacity: {
				active: restoredCapacity.active,
				waiting: restoredCapacity.waiting,
			},
		});
		held.resolve();
		if (second) {
			for (const run of second.runs.values()) second.stop(run.id);
			await second.shutdown();
		}
		for (const run of first.runs.values()) first.stop(run.id);
		await first.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
}, 15000);
