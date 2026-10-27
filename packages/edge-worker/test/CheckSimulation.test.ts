import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as checkEngine from "../src/factory/Check.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const fixtures: {
	home: string;
	runtime: WorkflowRuntime;
	server: FactoryServer;
}[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const fixture of fixtures.splice(0)) {
		await fixture.runtime.shutdown();
		await fixture.server.stop();
		rmSync(fixture.home, { recursive: true, force: true });
	}
});

function setup(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "check-simulation-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			if (context.step.prompt === "fixture-tool")
				return (async () => {
					throw new Error("Unexpected action");
				})(context);
			if (context.step.prompt === "fixture-script")
				return (async () => {
					throw new Error("Unexpected script");
				})(context);
			return (async () => {
				throw new Error("Unexpected agent");
			})(context);
		},
		...hooks,
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unexpected launch");
		},
		stop: (id) => runtime.stop(id),
	});
	const fixture = { home, runtime, server };
	fixtures.push(fixture);
	return fixture;
}

function simulate(
	server: FactoryServer,
	step: unknown,
	inputs: unknown,
	evidence: unknown = {},
	fallback = "end",
) {
	return server.app.inject({
		method: "POST",
		url: "/api/workflows/check/simulate",
		headers: { "x-factory-request": "1" },
		payload: { step, inputs, evidence, fallback },
	});
}

const collectionStep = {
	id: "configured-check",
	name: "Configured Check",
	type: "check",
	reads: { batch: "data" },
	check: {
		results: {
			approved: {
				aggregate: "all",
				path: "/inputs/batch/items",
				require: { path: "/approved", equals: true },
			},
			failures: {
				aggregate: "count",
				path: "/inputs/batch/items",
				where: { path: "/approved", equals: false },
			},
		},
	},
	branches: [{ when: { path: "approved", equals: true }, next: "accepted" }],
	next: "correction",
};

it.each([
	true,
	false,
])("simulates the same Check output and declared route as native execution (approved=%s)", async (approved) => {
	const data = { items: [{ approved: true }, { approved }] };
	const script = vi.fn(async () => data);
	const { home, runtime, server } = setup({ agent: script });
	const workflows = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "simulation-fixture",
			name: "Simulation fixture",
			stepConfigVersion: "step-config-v1",
			steps: [
				{ id: "data", name: "Data", type: "agent", prompt: "fixture-script" },
				collectionStep,
				{
					id: "correction",
					name: "Correction",
					type: "check",
					check: { results: { reached: { path: "/inputs", exists: true } } },
					next: "end",
				},
				{
					id: "accepted",
					name: "Accepted",
					type: "check",
					check: { results: { reached: { path: "/inputs", exists: true } } },
					next: "end",
				},
			],
		},
	]);
	runtime.updateWorkflows(workflows);
	const workflow = workflows.at(-1)!;
	const step = workflow.steps.find((step) => step.id === collectionStep.id)!;
	const run = runtime.create({
		title: "Simulation parity",
		repositoryId: "fixture",
		workspace: home,
		input: "Fixture",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-21T12:00:00.000Z",
		},
	});
	await runtime.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	const response = await simulate(server, step, { batch: data });
	expect(response.statusCode).toBe(200);
	const actual = response.json();
	expect(actual).toEqual({
		output: run.outputs[step.id],
		next: approved ? "accepted" : "correction",
	});
	expect(actual.output).toEqual({
		passed: approved,
		approved,
		failures: approved ? 0 : 1,
	});
	expect(run.history.map((receipt) => receipt.step)).toEqual([
		"data",
		step.id,
		actual.next,
	]);
	expect(script).toHaveBeenCalledOnce();
});

it("reports invalid configuration and malformed collection paths clearly", async () => {
	const { server } = setup();
	const invalid = await simulate(
		server,
		{
			id: "invalid",
			name: "Invalid",
			type: "check",
			check: {
				results: { count: { aggregate: "count", path: "/inputs/items" } },
			},
		},
		{ items: [] },
	);
	expect(invalid.statusCode).toBe(400);
	expect(invalid.json()).toEqual({
		error: "Check needs a boolean result or an explicit passed rule",
	});
	for (const inputs of [{ batch: { items: null } }, { batch: {} }]) {
		const malformed = await simulate(server, collectionStep, inputs);
		expect(malformed.statusCode).toBe(409);
		expect(malformed.json().error).toMatch(
			/Rule aggregate path \/inputs\/batch\/items (must select an array|is missing items)/,
		);
	}
	const wrongType = await simulate(
		server,
		{ id: "agent", name: "Agent", type: "agent", prompt: "Task" },
		{},
	);
	expect(wrongType.statusCode).toBe(409);
	expect(wrongType.json()).toEqual({
		error: "Select a configured Check step to simulate",
	});
});

it("rejects invalid Check saves with actionable errors and preserves the saved recipe revision", async () => {
	const { server, runtime } = setup();
	const current = (
		await server.app.inject({ url: "/api/config?view=recipes" })
	).json();
	for (const [results, message] of [
		[
			{ count: { aggregate: "count", path: "/inputs/items" } },
			"Check needs a boolean result or an explicit passed rule",
		],
		[
			{ passed: { path: "/inputs/ready", equals: true } },
			'Check result "passed" is reserved',
		],
	] as const) {
		const response = await server.app.inject({
			method: "PATCH",
			url: "/api/workflows",
			headers: {
				"x-factory-request": "1",
				"x-factory-config": current.configRevision,
			},
			payload: {
				workflows: [
					{
						engineVersion: "nodes-v1",
						id: "invalid-check",
						name: "Invalid Check",
						stepConfigVersion: "step-config-v1",
						steps: [
							{
								id: "invalid",
								name: "Invalid",
								type: "check",
								check: { results },
							},
						],
					},
				],
			},
		});
		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({ error: message });
		expect(
			runtime
				.listWorkflows()
				.some((workflow) => workflow.id === "invalid-check"),
		).toBe(false);
		expect(
			(await server.app.inject({ url: "/api/config?view=recipes" })).json()
				.configRevision,
		).toBe(current.configRevision);
	}
});

function expensiveStep() {
	return {
		id: "expensive",
		name: "Expensive Check",
		type: "check",
		check: {
			results: {
				all: {
					aggregate: "all",
					path: "/inputs/items",
					require: {
						count: "$/inputs/items",
						where: { path: "/id", min: 0 },
						min: 0,
					},
				},
			},
		},
	};
}

it("enforces the shared evaluation bound while unrelated HTTP work stays responsive", async () => {
	const { server } = setup();
	const inputs = { items: Array.from({ length: 4000 }, (_, id) => ({ id })) };
	const actual = checkEngine.evaluateCheckAsync;
	let evaluationStarted!: () => void;
	const startedEvaluation = new Promise<void>((resolve) => {
		evaluationStarted = resolve;
	});
	vi.spyOn(checkEngine, "evaluateCheckAsync").mockImplementation((...args) => {
		const evaluation = actual(...args);
		evaluationStarted();
		return evaluation;
	});
	let finished = false;
	const pending = simulate(server, expensiveStep(), inputs).finally(() => {
		finished = true;
	});
	await startedEvaluation;
	const started = Date.now();
	const catalog = await server.app.inject({
		url: "/api/workflows/step-config/catalog",
	});
	expect(catalog.statusCode).toBe(200);
	expect(Date.now() - started).toBeLessThan(1000);
	expect(finished).toBe(false);
	const limited = await pending;
	expect(limited.statusCode).toBe(409);
	expect(limited.json()).toEqual({
		error: "Rules exceed the evaluation operation limit",
	});
});

it("cancels the real evaluator when its simulation HTTP client disconnects", async () => {
	const { server } = setup();
	const actual = checkEngine.evaluateCheckAsync;
	let signal: AbortSignal | undefined;
	let aborted = false;
	let evaluationStarted!: () => void;
	const startedEvaluation = new Promise<void>((resolve) => {
		evaluationStarted = resolve;
	});
	vi.spyOn(checkEngine, "evaluateCheckAsync").mockImplementation((...args) => {
		signal = args[4];
		const evaluation = actual(...args);
		void evaluation.catch((error: Error) => {
			aborted = error.name === "AbortError";
		});
		evaluationStarted();
		return evaluation;
	});
	const address = await server.app.listen({ port: 0, host: "127.0.0.1" });
	const payload = JSON.stringify({
		step: expensiveStep(),
		inputs: { items: Array.from({ length: 12000 }, (_, id) => ({ id })) },
	});
	const request = httpRequest(`${address}/api/workflows/check/simulate`, {
		method: "POST",
		headers: {
			host: "localhost",
			origin: "http://localhost",
			cookie: "factory-local-session=route-fixture-session",
			"x-factory-request": "1",
			"content-type": "application/json",
			"content-length": Buffer.byteLength(payload),
		},
	});
	request.on("error", () => {});
	request.on("response", (response) => response.resume());
	try {
		request.end(payload);
		await startedEvaluation;
		expect(signal).toBeDefined();
		request.destroy();
		await vi.waitFor(() => expect(signal?.aborted).toBe(true));
		await vi.waitFor(() => expect(aborted).toBe(true));
		const responsive = await server.app.inject({
			url: "/api/workflows/step-config/catalog",
		});
		expect(responsive.statusCode).toBe(200);
	} finally {
		request.destroy();
	}
});
