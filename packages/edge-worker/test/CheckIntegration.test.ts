import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { scopeContextDigest } from "../src/factory/SpecialistReview.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { validateWorkflows, type Workflow } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import legacyWorkflows from "./fixtures/legacy-workflows-a4990127.json" with {
	type: "json",
};
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function home() {
	const directory = mkdtempSync(join(tmpdir(), "check-runtime-"));
	homes.push(directory);
	return directory;
}

function runtime(directory: string, hooks: Partial<RuntimeHooks> = {}) {
	const instance = new WorkflowRuntime(directory, {
		agent: async () => {
			throw new Error("Unexpected agent invocation");
		},
		script: async () => {
			throw new Error("Unexpected script invocation");
		},
		tool: async () => {
			throw new Error("Unexpected action invocation");
		},
		...hooks,
	});
	runtimes.push(instance);
	return instance;
}

function definitions(steps: unknown[], extra: unknown[] = []) {
	return validateWorkflows([
		...defaultWorkflows,
		...extra,
		{
			id: "check-fixture",
			name: "Check fixture",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]);
}

function create(
	instance: WorkflowRuntime,
	directory: string,
	workflows: Workflow[],
) {
	instance.updateWorkflows(workflows);
	const workflow = workflows.at(-1)!;
	return instance.create({
		title: "Configured check fixture",
		repositoryId: "fixture",
		workspace: directory,
		input: "Fixture only",
		workflow,
		launchInputs: { mode: "external" },
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-21T12:00:00.000Z",
		},
	});
}

describe("Check production graph execution", () => {
	it.each([
		"choose",
		"visual-gate",
	])("routes on declared results with arbitrary Check name %s and no agent or action", async (name) => {
		const directory = home();
		const agent = vi.fn(async () => ({}));
		const script = vi.fn(async () => ({}));
		const tool = vi.fn(async () => ({}));
		const evidence = vi.fn(async () => {
			throw new Error("Undeclared evidence must stay cold");
		});
		const instance = runtime(directory, { agent, script, tool, evidence });
		const run = create(
			instance,
			directory,
			definitions([
				{
					id: name,
					name: "Choose route",
					type: "check",
					reads: { delivery: "@launchInputs" },
					check: {
						results: {
							external: { path: "/inputs/delivery/mode", equals: "external" },
							mode: { select: "/inputs/delivery/mode" },
						},
					},
					branches: [
						{ when: { path: "external", equals: true }, next: "selected" },
					],
					next: "wrong",
				},
				{
					id: "wrong",
					name: "Wrong route",
					type: "tool",
					tool: "must-not-run",
					next: "end",
				},
				{
					id: "selected",
					name: "Selected route",
					type: "check",
					reads: { decision: name },
					check: {
						results: {
							correct: { path: "/inputs/decision/mode", equals: "external" },
						},
					},
					next: "end",
				},
			]),
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(run.outputs[name]).toEqual({
			passed: true,
			external: true,
			mode: "external",
		});
		expect(run.outputs.selected).toEqual({ passed: true, correct: true });
		expect(run.history.map((receipt) => receipt.step)).toEqual([
			name,
			"selected",
		]);
		expect(agent).not.toHaveBeenCalled();
		expect(script).not.toHaveBeenCalled();
		expect(tool).not.toHaveBeenCalled();
		expect(evidence).not.toHaveBeenCalled();
		expect(run.reviewRounds).toBeUndefined();
		expect(run.delivery).toBeUndefined();
	});

	it("exposes only declared fixed evidence and keeps role-like input names ordinary", async () => {
		const directory = home();
		const evidence = vi.fn(async (_context: ExecutionContext) => ({
			"delivery-evidence": { verified: true, headSha: "reviewed-revision" },
			"qa-gate-evidence": { verified: true },
		}));
		const instance = runtime(directory, { evidence });
		const run = create(
			instance,
			directory,
			definitions([
				{
					id: "ordinary-data",
					name: "Ordinary data",
					type: "check",
					reads: {
						review: "@launchInputs",
						impact: "@launchInputs",
						qaReuse: "@launchInputs",
					},
					check: {
						results: {
							undeclared: {
								path: "/evidence/delivery-evidence/verified",
								exists: false,
							},
						},
					},
				},
				{
					id: "declared-evidence",
					name: "Declared evidence",
					type: "check",
					checks: ["delivery-evidence"],
					check: {
						results: {
							verified: {
								path: "/evidence/delivery-evidence/verified",
								equals: true,
							},
							headSha: { select: "/evidence/delivery-evidence/headSha" },
							extra: {
								path: "/evidence/qa-gate-evidence/verified",
								equals: true,
							},
						},
						passed: { path: "/results/verified", equals: true },
					},
				},
			]),
		);
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(evidence).toHaveBeenCalledOnce();
		expect(evidence.mock.calls[0]![0].step.id).toBe("declared-evidence");
		expect(run.outputs["ordinary-data"]).toEqual({
			passed: true,
			undeclared: true,
		});
		expect(run.outputs["declared-evidence"]).toEqual({
			passed: true,
			verified: true,
			headSha: "reviewed-revision",
			extra: false,
		});
		expect(run.reviewRounds).toBeUndefined();
		expect(run.impactDecisions).toBeUndefined();
	});

	it("resolves renamed producers in exact called and parallel frames before aggregating results", async () => {
		const directory = home();
		const script = vi.fn(async (context: ExecutionContext) => ({
			items: [{ approved: !context.stepKey!.includes("/1/") }],
		}));
		const instance = runtime(directory, { script });
		const group = () => [
			{
				id: "renamed-source",
				name: "Source",
				type: "script",
				script: "fixture",
			},
			{
				id: "renamed-check",
				name: "Check",
				type: "check",
				reads: { reviews: "renamed-source/items" },
				check: {
					results: {
						approved: {
							aggregate: "all",
							path: "/inputs/reviews",
							require: { path: "/approved", equals: true },
						},
					},
				},
			},
		];
		const child = {
			id: "called-checks",
			name: "Called checks",
			stepConfigVersion: "step-config-v1",
			internal: true,
			steps: [
				{
					id: "renamed-parallel",
					name: "Parallel",
					type: "fanout",
					groups: [group(), group()],
				},
				{
					id: "renamed-aggregate",
					name: "Aggregate",
					type: "check",
					reads: { parallel: "renamed-parallel" },
					check: {
						results: {
							approved: {
								aggregate: "all",
								path: "/inputs/parallel/*/renamed-check",
								require: { path: "/passed", equals: true },
							},
							failures: {
								aggregate: "count",
								path: "/inputs/parallel/*/renamed-check",
								where: { path: "/passed", equals: false },
							},
						},
					},
				},
			],
		};
		const run = create(
			instance,
			directory,
			definitions(
				[
					{
						id: "renamed-call",
						name: "Call",
						type: "workflow",
						workflow: child.id,
					},
				],
				[child],
			),
		);
		// An unrelated accepted output with the same leaf ID must not replace a
		// producer in a called/parallel frame.
		run.outputs["renamed-source"] = { items: [{ approved: true }] };
		await instance.launch(run);
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
		expect(script).toHaveBeenCalledTimes(2);
		const checks = run.history.filter((receipt) =>
			receipt.step.endsWith("/renamed-check"),
		);
		expect(checks.map((receipt) => [receipt.step, receipt.output])).toEqual([
			[
				"renamed-call/renamed-parallel/0/renamed-check",
				{ passed: true, approved: true },
			],
			[
				"renamed-call/renamed-parallel/1/renamed-check",
				{ passed: false, approved: false },
			],
		]);
		expect(
			run.history.find(
				(receipt) => receipt.step === "renamed-call/renamed-aggregate",
			)?.output,
		).toEqual({ passed: false, approved: false, failures: 1 });
		expect(run.outputs["renamed-source"]).toEqual({
			items: [{ approved: true }],
		});
	});

	it("keeps malformed collection failures retryable across restart without replaying completed producers", async () => {
		const directory = home();
		const agent = vi.fn(async () => ({ items: null }));
		const first = runtime(directory, { agent });
		const run = create(
			first,
			directory,
			definitions([
				{
					id: "supplied-data",
					name: "Supply data",
					type: "agent",
					prompt: "Fixture data",
				},
				{
					id: "validate-collection",
					name: "Validate collection",
					type: "check",
					reads: { data: "supplied-data" },
					check: {
						results: {
							all: {
								aggregate: "all",
								path: "/inputs/data/items",
								require: { path: "/ok", equals: true },
							},
						},
					},
				},
			]),
		);
		const frozen = JSON.stringify(run.workflowDefinitions);
		await first.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/aggregate path.*must select an array/);
		expect(run.outputs["validate-collection"]).toBeUndefined();
		await first.shutdown();
		await first.flush();
		const resumed = runtime(directory, { agent });
		const loaded = resumed.get(run.id);
		expect(JSON.stringify(loaded.workflowDefinitions)).toBe(frozen);
		// Supply a corrected fixture artifact; retry executes the failed Check.
		loaded.outputs["supplied-data"] = { items: [{ ok: true }] };
		resumed.retry(loaded.id);
		await waitForRuntime(() => expect(loaded.status).toBe("completed"));
		expect(loaded.outputs["validate-collection"]).toEqual({
			passed: true,
			all: true,
		});
		expect(agent).toHaveBeenCalledOnce();
		expect(
			loaded.history.filter((receipt) => receipt.step === "supplied-data"),
		).toHaveLength(1);
		expect(JSON.stringify(loaded.workflowDefinitions)).toBe(frozen);
	});

	it("uses the same host ticket timestamps in fresh, restored and simulated Checks", async () => {
		const directory = home();
		const first = runtime(directory);
		const createdAt = "2026-10-20T10:00:00.000Z";
		const updatedAt = "2026-10-21T11:00:00.000Z";
		const workflows = definitions([
			{
				id: "timestamp-check",
				name: "Timestamp Check",
				type: "check",
				reads: { ticket: "@ticket" },
				check: {
					results: {
						createdAt: { select: "/inputs/ticket/createdAt" },
						updatedAt: { select: "/inputs/ticket/updatedAt" },
						commentCreatedAt: { select: "/inputs/ticket/comments/0/createdAt" },
					},
					passed: { path: "/results/createdAt", equals: createdAt },
				},
			},
		]);
		const nativeTicket = () => ({
			title: "Host ticket",
			createdAt: new Date(createdAt),
			updatedAt: new Date(updatedAt),
			comments: [
				{
					body: "Original direction",
					createdAt: new Date(createdAt),
					updatedAt: new Date(updatedAt),
				},
			],
		});
		const fresh = create(first, directory, workflows);
		fresh.ticketSnapshot = nativeTicket();
		const context: ExecutionContext = {
			run: fresh,
			step: fresh.workflow.steps[0]!,
			input: {},
			signal: new AbortController().signal,
			evidenceDir: directory,
			log: () => {},
		};
		const ordinaryBindings = stepBindings(context);
		const ruleBindings = stepBindings(context, fresh.history, {
			checkJson: true,
		});
		expect(
			(ordinaryBindings.ticket as ReturnType<typeof nativeTicket>).createdAt,
		).toBeInstanceOf(Date);
		expect(
			(ordinaryBindings.ticket as ReturnType<typeof nativeTicket>).comments[0]!
				.createdAt,
		).toBeInstanceOf(Date);
		expect(ruleBindings.ticket).toEqual({
			title: "Host ticket",
			createdAt,
			updatedAt,
			comments: [{ body: "Original direction", createdAt, updatedAt }],
		});
		const originalScope = scopeContextDigest({
			scopeSources: { ticket: fresh.ticketSnapshot },
		});
		expect(scopeContextDigest({ scopeSources: ordinaryBindings })).toBe(
			originalScope,
		);
		// Encoding at the pure-rule boundary must not replace the native scope
		// inputs that an independently accepted reviewer actually consumed.
		expect(scopeContextDigest({ scopeSources: ruleBindings })).not.toBe(
			originalScope,
		);
		await first.launch(fresh);
		expect(fresh.error).toBeUndefined();
		expect(fresh.status).toBe("completed");
		expect(fresh.outputs["timestamp-check"]).toEqual({
			passed: true,
			createdAt,
			updatedAt,
			commentCreatedAt: createdAt,
		});
		expect(
			(fresh.ticketSnapshot as ReturnType<typeof nativeTicket>).createdAt,
		).toBeInstanceOf(Date);
		const pending = create(first, directory, workflows);
		pending.ticketSnapshot = nativeTicket();
		pending.status = "interrupted";
		await first.save(pending);
		await first.shutdown();
		await first.flush();
		const resumed = runtime(directory);
		const loaded = resumed.get(pending.id);
		expect(loaded.ticketSnapshot).toEqual({
			title: "Host ticket",
			createdAt,
			updatedAt,
			comments: [{ body: "Original direction", createdAt, updatedAt }],
		});
		resumed.retry(loaded.id);
		await waitForRuntime(() =>
			expect(loaded.status, loaded.error).toBe("completed"),
		);
		expect(loaded.outputs["timestamp-check"]).toEqual(
			fresh.outputs["timestamp-check"],
		);
		const { FactoryServer } = await import(
			"./fixtures/authenticated-factory.js"
		);
		const server = new FactoryServer(resumed, {
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("Simulation cannot launch a run");
			},
			stop: (id) => resumed.stop(id),
		});
		try {
			const response = await server.app.inject({
				method: "POST",
				url: "/api/workflows/check/simulate",
				headers: { "x-factory-request": "1" },
				payload: {
					step: loaded.workflow.steps[0],
					inputs: { ticket: loaded.ticketSnapshot },
				},
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				output: fresh.outputs["timestamp-check"],
				next: "end",
			});
		} finally {
			await server.stop();
		}
	});

	it("loads and resumes an old saved decision tool through the ordinary runtime without rewriting accepted definitions", async () => {
		const directory = home();
		const legacy = legacyWorkflows.default.find(
			(workflow) => workflow.id === "factory-pipeline",
		)!;
		const original = legacy.steps.find(
			(step) => "tool" in step && step.tool === "delivery-mode",
		)!;
		const workflow = {
			id: "saved-gate-fork",
			name: "Saved gate fork",
			steps: [{ ...original, next: "end", branches: [] }],
		};
		const definitions = [...structuredClone(legacyWorkflows.default), workflow];
		const definitionBytes = JSON.stringify(definitions);
		const at = "2026-10-20T12:00:00.000Z";
		const run = {
			id: "saved-decision-tool",
			title: "Saved gate",
			repositoryId: "fixture",
			workspace: directory,
			input: "Fixture",
			workflow,
			workflowDefinitions: definitions,
			status: "running",
			createdAt: at,
			updatedAt: at,
			answers: [],
			outputs: {},
			history: [],
			events: [],
			checkpoint: {
				current: original.id,
				visits: { [original.id]: 1 },
				active: { phase: "executing" },
			},
		};
		mkdirSync(join(directory, "factory", "runs"), { recursive: true });
		writeFileSync(
			join(directory, "factory", "runs", `${run.id}.json`),
			JSON.stringify(run),
		);
		const postComment = vi.fn(async () => {});
		const command = vi.fn(async () => {
			throw new Error("No external command for decision");
		});
		const tools = new FactoryTools({ postComment, command });
		const instance = runtime(directory, {
			tool: (context) => tools.tool(context),
		});
		const loaded = instance.get(run.id);
		await instance.launch(loaded);
		expect(loaded.error).toBeUndefined();
		expect(loaded.status).toBe("completed");
		expect(loaded.outputs[original.id]).toEqual({
			mode: "repository",
			repositoryComplete: false,
		});
		expect(JSON.stringify(loaded.workflowDefinitions)).toBe(definitionBytes);
		expect(JSON.stringify(loaded.workflow.steps)).toBe(
			JSON.stringify(workflow.steps),
		);
		expect(command).not.toHaveBeenCalled();
		expect(postComment).not.toHaveBeenCalled();
	});
});
