import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { freshNodeOutput } from "../src/factory/NodeGuarantees.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

vi.mock("../src/factory/FactoryWebAssets.js", () => ({
	factoryWebAssets: () => ({
		build: "000000000000000000000000",
		protocol: 1,
		assets: [],
	}),
}));

it("drives reuse, bound freshness and convergence through the authenticated API with scripted agents and real Git", async () => {
	const home = mkdtempSync(join(tmpdir(), "f1-node-guarantees-"));
	const workspace = join(home, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-qb", "main");
	git("config", "user.name", "F1");
	git("config", "user.email", "f1@example.test");
	const commit = (value: string) => {
		writeFileSync(join(workspace, "value"), value);
		git("add", "value");
		git(
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"F1 [skip ci]",
		);
	};
	commit("one");
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "guarantees-f1",
			name: "Guarantees F1",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "sample",
					name: "Sample",
					type: "agent",
					prompt: "Scripted sample",
					reuse: "unchanged-inputs",
				},
				{
					id: "observe",
					name: "Observe",
					type: "converge",
					reads: { value: "sample/value" },
					watch: ["/inputs/value"],
					maxCycles: 2,
					branches: [
						{ when: { path: "stalled", equals: false }, next: "sample" },
					],
				},
				{
					id: "response",
					name: "Response",
					type: "script",
					script: "scripted-response",
					bind: ["sample"],
				},
				{
					id: "check",
					name: "Check",
					type: "check",
					check: { results: { current: { fresh: "response" } } },
				},
			],
		},
	]).at(-1)!;
	let agentCalls = 0;
	const hooks = {
		agent: async () => {
			agentCalls++;
			return { value: 1 };
		},
		script: async () => ({ accepted: true }),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	let restarted: WorkflowRuntime | undefined;
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "fixture", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async (input) => {
			const run = runtime.create({
				title: "Guarantees F1",
				repositoryId: "fixture",
				workspace,
				input: input.prompt,
				workflow,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			void runtime.launch(run);
			return run;
		},
	});
	try {
		const created = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers: { "x-factory-request": "1" },
			payload: {
				repositoryId: "fixture",
				workflow: workflow.id,
				prompt: "Scripted guarantees drive",
			},
		});
		expect(created.statusCode, created.body).toBe(202);
		const run = runtime.get(created.json().id);
		await waitForRuntime(() => expect(run.status).toBe("completed"));
		expect(agentCalls).toBe(1);
		expect(run.history.filter((entry) => entry.step === "sample")).toHaveLength(
			2,
		);
		expect(run.outputs.observe).toEqual({
			stalled: true,
			cycles: 2,
			changed: false,
		});
		expect(run.outputs.check).toEqual({ passed: true, current: true });
		expect(
			run.events.filter(
				(event) => event.message === "reused (inputs unchanged)",
			),
		).toHaveLength(1);
		const fetched = await server.app.inject({
			method: "GET",
			url: `/api/runs/${run.id}`,
		});
		expect(fetched.statusCode).toBe(200);
		const bound = run.history.find((entry) => entry.step === "response")
			?.guarantee?.boundDigests;
		await runtime.shutdown();
		restarted = new WorkflowRuntime(home, hooks);
		const loaded = restarted.get(run.id);
		const context: ExecutionContext = {
			run: loaded,
			step: loaded.workflow.steps[3]!,
			stepKey: "check",
			outputs: loaded.outputs,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: workspace,
		};
		expect(
			loaded.history.find((entry) => entry.step === "response")?.guarantee
				?.boundDigests,
		).toEqual(bound);
		expect(await freshNodeOutput(context, "response")).toBe(true);
		commit("two");
		expect(await freshNodeOutput(context, "response")).toBe(false);
	} finally {
		await server.stop();
		await runtime.shutdown();
		await restarted?.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
