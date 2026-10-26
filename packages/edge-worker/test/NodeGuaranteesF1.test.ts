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

it("drives scoped reuse across commits, bound freshness and convergence through the authenticated API with scripted agents and real Git", async () => {
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
					revisionScope: { paths: ["value"] },
				},
				{
					id: "change",
					name: "Change",
					type: "script",
					script: "scripted-change",
				},
				{
					id: "observe",
					name: "Observe",
					type: "converge",
					reads: { value: "sample/value" },
					watch: ["/inputs/value"],
					maxCycles: 3,
					branches: [
						{ when: { path: "stalled", equals: false }, next: "sample" },
					],
				},
				{
					id: "response",
					name: "Response",
					type: "script",
					script: "scripted-response",
					revisionScope: { paths: ["value"] },
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
	let agentCalls = 0,
		changes = 0;
	const outsideCommit = (value: string) => {
		writeFileSync(join(workspace, "outside"), value);
		git("add", "outside");
		git(
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"Outside [skip ci]",
		);
	};
	const hooks = {
		agent: async () => {
			agentCalls++;
			return { value: 1 };
		},
		script: async (ctx: ExecutionContext) => {
			if (ctx.step.id === "change") {
				if (++changes === 1) outsideCommit("outside");
				else if (changes === 2) commit("inside");
			}
			return { accepted: true };
		},
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
		expect(agentCalls).toBe(2);
		expect(run.history.filter((entry) => entry.step === "sample")).toHaveLength(
			3,
		);
		expect(run.outputs.observe).toEqual({
			stalled: true,
			cycles: 3,
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
			step: loaded.workflow.steps.at(-1)!,
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
		outsideCommit("after restart");
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

it.each([
	{ producerScope: { paths: ["a/**"] }, approvalScope: undefined },
	{ producerScope: "none", approvalScope: undefined },
	{ producerScope: { paths: ["a/**"] }, approvalScope: "repository" },
	{ producerScope: "none", approvalScope: "repository" },
] as const)("freezes whole-repository Display approval before waiting with producer $producerScope and approval $approvalScope", async ({
	producerScope,
	approvalScope,
}) => {
	const home = mkdtempSync(join(tmpdir(), "f1-approval-revisions-"));
	const workspace = join(home, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-qb", "main");
	git("config", "user.name", "F1");
	git("config", "user.email", "f1@example.test");
	mkdirSync(join(workspace, "a"));
	mkdirSync(join(workspace, "b"));
	writeFileSync(join(workspace, "a", "reviewed"), "reviewed");
	writeFileSync(join(workspace, "b", "unreviewed"), "original");
	const commit = () => {
		git("add", ".");
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
	commit();
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "approval-f1",
			name: "Approval F1",
			engineVersion: "nodes-v1",
			steps: [
				{
					id: "review",
					name: "Review",
					type: "agent",
					prompt: "Review a",
					revisionScope: producerScope,
				},
				{
					id: "approval",
					name: "Approve",
					type: "display",
					bind: ["review"],
					revisionScope: approvalScope,
					document: {
						version: "view-v1",
						components: [
							{
								id: "form",
								type: "form",
								data: {
									literal: {
										fields: [
											{
												id: "answer",
												type: "text",
												label: "Answer",
												required: true,
											},
										],
									},
								},
							},
						],
					},
				},
				{
					id: "gate",
					name: "Gate",
					type: "check",
					check: { results: { current: { fresh: "approval" } } },
				},
			],
		},
	]).at(-1)!;
	const hooks = {
		agent: async () => ({ reviewed: true }),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	let restarted: WorkflowRuntime | undefined;
	let server: FactoryServer | undefined;
	try {
		const run = runtime.create({
			title: "Approval F1",
			repositoryId: "fixture",
			workspace,
			input: "",
			workflow,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
		void runtime.launch(run);
		await waitForRuntime(() =>
			expect(run.viewDecision, run.error).toBeDefined(),
		);
		const frozen = structuredClone(
			run.checkpoint!.active!.nodeStamp!.guarantee,
		);
		const head = git("rev-parse", "HEAD");
		expect(frozen.revisions.fixture).toMatchObject({
			headSha: head,
			workspaceDigest: expect.any(String),
		});
		expect(frozen.revisionChecks?.review).toEqual(
			run.history[0]!.guarantee!.revisions,
		);
		// The answer must retain the observation from before the human wait.
		writeFileSync(join(workspace, "b", "unreviewed"), "changed while waiting");
		await runtime.shutdown();
		restarted = new WorkflowRuntime(home, hooks);
		const loaded = restarted.get(run.id);
		restarted.resumeAll();
		await waitForRuntime(() => {
			expect(restarted!.isExecuting(run.id)).toBe(true);
			expect(loaded.status, loaded.error).toBe("waiting");
		});
		expect(loaded.checkpoint!.active!.nodeStamp!.guarantee).toEqual(frozen);
		server = new FactoryServer(restarted, {
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("No launch");
			},
			stop: (id) => restarted!.stop(id),
		});
		const answer = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: {
				batchId: loaded.viewDecision!.id,
				digest: loaded.viewDecision!.digest,
				documentDigest: loaded.viewDecision!.documentDigest,
				accepted: true,
				values: { answer: "Approved" },
			},
		});
		expect(answer.statusCode, answer.body).toBe(200);
		await waitForRuntime(() =>
			expect(loaded.status, loaded.error).toBe("completed"),
		);
		expect(loaded.outputs.gate).toEqual({ passed: false, current: false });
		const context: ExecutionContext = {
			run: loaded,
			step: loaded.workflow.steps.at(-1)!,
			stepKey: "gate",
			outputs: loaded.outputs,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: workspace,
		};
		expect(await freshNodeOutput(context, "review")).toBe(true);
		expect(await freshNodeOutput(context, "approval")).toBe(false);
		// Restoring the workspace restores freshness; a b-only commit invalidates it.
		git("restore", "b/unreviewed");
		expect(await freshNodeOutput(context, "approval")).toBe(true);
		writeFileSync(
			join(workspace, "b", "unreviewed"),
			"committed outside review",
		);
		commit();
		expect(await freshNodeOutput(context, "review")).toBe(true);
		expect(await freshNodeOutput(context, "approval")).toBe(false);
		expect(
			loaded.history.find((entry) => entry.step === "approval")!.guarantee!
				.revisions.fixture!.headSha,
		).toBe(head);
	} finally {
		await server?.stop();
		await runtime.shutdown();
		await restarted?.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
