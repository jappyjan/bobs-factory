import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	nativeViewSnapshot,
	prepareNativeViewConsent,
} from "../src/factory/NativeViews.js";
import { hasCheck } from "../src/factory/StepConfig.js";
import type { ViewDefinition } from "../src/factory/View.js";
import { nativeViewPreset } from "../src/factory/ViewPresets.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { checkin } from "./fixtures/architecture.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [],
	servers: FactoryServer[] = [];
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.shutdown();
	for (const s of servers.splice(0)) await s.stop();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function home() {
	const path = mkdtempSync(join(tmpdir(), "native-views143-"));
	homes.push(path);
	return path;
}
function server(runtime: WorkflowRuntime) {
	const s = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: (id) => runtime.stop(id),
	});
	servers.push(s);
	return s;
}
it("keeps a renamed Ask on native answers, refuses stale displays and cannot borrow generic approval", async () => {
	const directory = home();
	let calls = 0;
	const runtime = new WorkflowRuntime(directory, {
		agent: async () =>
			++calls === 1
				? {
						questions: ["Which storage?"],
						questionRecommendations: [
							{
								questionIndex: 0,
								answer: "Keep local storage",
								reason: "Preserves data",
							},
						],
					}
				: { questions: [] },
		tool: async () => ({}),
		script: async () => ({}),
	});
	runtimes.push(runtime);
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "renamed",
			name: "Different name",
			steps: [
				{
					id: "ask-a-human",
					name: "Ordinary source",
					type: "agent",
					prompt: "Ask",
					askQuestions: true,
					view: nativeViewPreset("ask"),
				},
			],
		},
	]).at(-1)!;
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const run = runtime.create({
		title: "Ask",
		repositoryId: "fixture",
		workspace: directory,
		input: "fixture",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(run.status).toBe("waiting"));
	const s = server(runtime),
		first = nativeViewSnapshot(run)!;
	expect(first.view.components[0]?.type).toBe("questions");
	expect(calls).toBe(1);
	const forged = await s.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/view-answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			batchId: run.questionBatchId,
			digest: first.digest,
			accepted: true,
			approved: true,
		},
	});
	expect(forged.statusCode).toBe(409);
	expect(run.humanDecisions).toBeUndefined();
	expect(run.architectureDecisions ?? []).toEqual([]);
	const context = {
		step: run.step,
		questions: run.questions,
		questionBatchId: run.questionBatchId,
	};
	run.questionRecommendations![0]!.reason = "New public evidence";
	const stale = await s.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			answer: "Keep local storage",
			context,
			kind: "answer",
			display: { digest: first.digest },
		},
	});
	expect(stale.statusCode).toBe(409);
	expect(run.answers).toHaveLength(0);
	const current = nativeViewSnapshot(run)!;
	const accepted = await s.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			answer: "Keep local storage",
			context,
			kind: "answer",
			display: { digest: current.digest },
		},
	});
	expect(accepted.statusCode, accepted.body).toBe(200);
	await waitForRuntime(() => expect(run.status).toBe("completed"));
	expect(run.answers[0]?.answer).toBe("Keep local storage");
});
it("saves, exports and reloads a real Factory fork's reordered check-in with a declared output and exact native acceptance", async () => {
	const directory = home();
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: directory,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Controlled fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(directory, "record.txt"), "before\n");
	git("add", ".");
	git("commit", "-m", "test: local baseline [skip ci]");
	const tools = new FactoryTools();
	let candidate: Record<string, unknown> = {},
		reachedImplementation = false;
	const raw = async (c: ExecutionContext): Promise<unknown> => {
		if (hasCheck(c.step, "architecture-proposal")) {
			const p = checkin();
			p.candidate = { ...p.candidate, ...candidate };
			return p;
		}
		if (hasCheck(c.step, "architecture-candidate"))
			return { approved: true, feedback: [] };
		if (c.step.output?.format === "clarify-v1")
			return {
				questions: [],
				decisions: [],
				requirements: ["Save a record safely"],
				deliveryMode: "repository",
			};
		if (c.step.output?.format === "plan-v1") {
			candidate = {
				plan: "Save a record safely with a focused local check",
				assets: [],
				deliveryContract: {
					format: "delivery-v1",
					version: 1,
					mode: "repository",
					authorization: { status: "authorized", reference: "originalInput" },
					executionReference: String(
						(c.currentScope!() as Record<string, unknown>)
							.deliveryExecutionReference,
					),
					targets: [],
				},
			};
			return candidate;
		}
		if (c.step.output?.format === "plan-review-v1")
			return {
				approved: true,
				feedback: [],
				deliveryContractDigest: (c.currentScope!() as Record<string, unknown>)
					.deliveryCandidateDigest,
			};
		reachedImplementation = true;
		throw new Error(
			"Controlled boundary: implementation is outside this human-view drive",
		);
	};
	let runtime = new WorkflowRuntime(directory, {
		agent: raw,
		tool: (c) => tools.tool(c),
		script: async () => ({}),
	});
	runtimes.push(runtime);
	const fork = runtime.forkWorkflow("factory"),
		definitions = runtime.listWorkflows(),
		child = definitions.find(
			(w) => w.id === fork.steps.find((s) => s.id === "check-in")!.workflow,
		)!,
		decision = child.steps.find((s) => s.tool === "architecture-decision")!;
	const view = structuredClone(decision.view) as ViewDefinition;
	view.reads!.planDetails = "architecture/candidate/plan";
	view.components = [
		view.components.find((c) => c.id === "size")!,
		...view.components.filter(
			(c) => !["size", "notice", "notes"].includes(c.id),
		),
		{
			id: "declared-plan",
			type: "markdown",
			data: { bindings: { text: { path: "/inputs/planDetails" } } },
		},
	];
	decision.view = view;
	const s = server(runtime),
		saved = await s.app.inject({
			method: "PUT",
			url: "/api/workflows",
			headers: { "x-factory-request": "1" },
			payload: definitions,
		});
	expect(saved.statusCode, saved.body).toBe(200);
	const exported = (
		await s.app.inject({ url: "/api/workflows/export" })
	).json();
	expect(
		exported.locals
			.find((w: { id: string }) => w.id === child.id)
			.steps.find((s: { id: string }) => s.id === decision.id).view,
	).toEqual(view);
	await runtime.shutdown();
	await s.stop();
	servers.splice(servers.indexOf(s), 1);
	runtime = new WorkflowRuntime(directory, {
		agent: raw,
		tool: (c) => tools.tool(c),
		script: async () => ({}),
	});
	runtimes.push(runtime);
	const workflow = runtime.listWorkflows().find((w) => w.id === fork.id)!;
	const run = runtime.create({
		title: "Factory fork",
		repositoryId: "fixture",
		workspace: directory,
		input: "Save a record safely",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
		workflowDefinitions: runtime.listWorkflows(),
		repositories: [
			{
				id: "fixture",
				name: "fixture",
				workspace: directory,
				repositoryPath: directory,
				baseBranch: "main",
			},
		],
	});
	void runtime.launch(run);
	await waitForRuntime(() => {
		expect(run.status, run.error).toBe("waiting");
		expect(run.architectureGate).toBeDefined();
	});
	const shown = nativeViewSnapshot(run)!;
	expect(shown.compatibility).toBe(false);
	expect(shown.view.components[0]?.id).toBe("size");
	expect(shown.view.components.some((c) => c.id === "notice")).toBe(false);
	expect(shown.view.components.at(-1)).toMatchObject({
		type: "markdown",
		data: { text: run.architectureProposals!.at(-1)!.content.candidate.plan },
	});
	const p = run.architectureProposals!.at(-1)!,
		planOutput = run.architectureGate!.planOutput;
	const currentServer = server(runtime);
	const response = await currentServer.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/architecture-decision`,
		headers: { "x-factory-request": "1" },
		payload: {
			proposalId: p.id,
			version: p.version,
			digest: p.digest,
			decision: "accept",
			display: { digest: shown.digest },
		},
	});
	expect(response.statusCode, response.body).toBe(202);
	await waitForRuntime(() => expect(reachedImplementation).toBe(true));
	expect(run.architectureDecisions?.at(-1)).toMatchObject({
		proposalId: p.id,
		digest: p.digest,
		decision: "accept",
	});
	expect(run.outputs[planOutput]).toEqual(p.content.candidate);
});
it("binds the configured renamed guide and every repository URL/head, and rejects changed view configuration before native acceptance", async () => {
	const directory = home();
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "bound-review",
			name: "Bound review",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "other",
					name: "Other guide",
					type: "agent",
					prompt: "Other",
					next: "authored",
				},
				{
					id: "authored",
					name: "Current guide",
					type: "agent",
					prompt: "Current",
					next: "human",
				},
				{
					id: "human",
					name: "Renamed checkpoint",
					type: "tool",
					tool: "human-review",
					configVersion: "step-config-v1",
					reads: { guide: "authored" },
					view: nativeViewPreset("review"),
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const repositories = [
		{
			repositoryId: "one",
			name: "One",
			url: "https://github.com/test/one/pull/1",
			headSha: "a".repeat(40),
		},
		{
			repositoryId: "two",
			name: "Two",
			url: "https://github.com/test/two/pull/2",
			headSha: "b".repeat(40),
		},
	];
	const runtime = new WorkflowRuntime(directory, {
		agent: async (c) => ({
			summary:
				c.step.id === "authored" ? "Current declared guide" : "Other guide",
		}),
		script: async () => ({}),
		tool: async () => ({
			scopeVersion: 1,
			headSha: "c".repeat(40),
			url: repositories[0]!.url,
			deliveries: repositories.map((repository) => ({
				...repository,
				output: { ...repository },
			})),
		}),
	});
	runtimes.push(runtime);
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const run = runtime.create({
		title: "Grouped review",
		repositoryId: "fixture",
		workspace: directory,
		workflow,
		input: "Controlled",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(run.status).toBe("waiting"));
	const shown = nativeViewSnapshot(run)!;
	expect(shown.guideSource).toBe("authored");
	expect(Object.values(shown.resources)[0]?.value).toEqual({
		summary: "Current declared guide",
	});
	expect(run.reviewGate!.repositories).toHaveLength(2);
	for (let index = 0; index < 2; index++)
		for (const field of ["url", "headSha"] as const) {
			const repository = run.reviewGate!.repositories![index]!,
				old = repository[field];
			repository[field] = field === "url" ? `${old}0` : "d".repeat(40);
			await expect(
				prepareNativeViewConsent(runtime, run, { digest: shown.digest }),
			).rejects.toThrow("Displayed content changed");
			repository[field] = old;
		}
	const step = run.workflow.steps[2]!,
		previous = structuredClone(step.view);
	(step.view as ViewDefinition).components[0]!.title =
		"Changed configured display";
	await expect(
		prepareNativeViewConsent(runtime, run, { digest: shown.digest }),
	).rejects.toThrow("Displayed content changed");
	step.view = previous;
	const s = server(runtime),
		body = {
			reviewId: run.reviewGate!.id,
			headSha: run.reviewGate!.headSha,
			decision: "approve",
		};
	const absent = await s.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/review`,
		headers: { "x-factory-request": "1" },
		payload: body,
	});
	expect(absent.statusCode).toBe(409);
	const accepted = await s.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/review`,
		headers: { "x-factory-request": "1" },
		payload: { ...body, display: { digest: shown.digest } },
	});
	expect(accepted.statusCode, accepted.body).toBe(202);
	expect(run.humanDecisions?.at(-1)?.repositories).toEqual(repositories);
	await waitForRuntime(() => expect(run.status).toBe("completed"));
});
