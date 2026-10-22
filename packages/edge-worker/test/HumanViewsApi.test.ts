import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runPushEvent } from "../src/factory/PushEvents.js";
import { taskbotSource } from "../src/factory/TicketTracking.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const resources: {
	runtime: WorkflowRuntime;
	server: FactoryServer;
	home: string;
}[] = [];
afterEach(async () => {
	for (const { runtime, server, home } of resources.splice(0)) {
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});
async function fixture(overrides: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "view-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("No model calls");
		},
		script: async () => ({}),
		tool: async () => ({}),
		...overrides,
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("No launches from API fixture");
		},
		stop: (id) => runtime.stop(id),
	});
	resources.push({ runtime, server, home });
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "api-view",
			name: "API view",
			steps: [
				{
					id: "renamed-human",
					name: "Approve exact content",
					type: "approve",
					view: {
						version: "view-v1",
						components: [
							{
								id: "text",
								type: "markdown",
								data: {
									literal: {
										text: '<script>alert("x")</script> [unsafe](javascript:alert(1))',
									},
								},
							},
						],
					},
				},
			],
		},
	]).at(-1)!;
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const run = runtime.create({
		id: "api-view-run",
		title: "Fixture",
		repositoryId: "fixture",
		workspace: home,
		input: "",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	void runtime.launch(run);
	await waitForRuntime(() => {
		expect(run.status).toBe("waiting");
		expect(run.viewDecision).toBeDefined();
	});
	return { home, runtime, server, run };
}
it("serves exact inert view context and requires the dedicated explicit approval API", async () => {
	const { server, run } = await fixture();
	const response = await server.app.inject({
		url: `/api/runs/${run.id}?view=dashboard`,
	});
	expect(response.statusCode).toBe(200);
	const detail = response.json();
	expect(detail.viewDecision).toEqual(run.viewDecision);
	expect(detail.viewText).toMatch(/&lt;script&gt;/);
	expect(detail.viewText).toMatch(/\\\[unsafe\\\]/);
	expect(detail.viewRecords).toBeUndefined();
	const ordinary = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: `/api/runs/${run.id}/answer`,
		payload: { answer: "yes" },
	});
	expect(ordinary.statusCode).toBe(409);
	expect(run.humanDecisions).toBeUndefined();
	const noConsent = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: `/api/runs/${run.id}/view-answer`,
		payload: {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
			approved: true,
		},
	});
	expect(noConsent.statusCode).toBe(400);
	expect(run.viewDecision!.answer).toBeUndefined();
});
it("serializes competing API answers and preserves the accepted response for exact retries", async () => {
	const { server, runtime, run } = await fixture();
	const payload = {
		batchId: run.viewDecision!.id,
		digest: run.viewDecision!.digest,
		accepted: true,
		approved: true,
	};
	const submit = (body: unknown) =>
		server.app.inject({
			method: "POST",
			headers: { "x-factory-request": "1" },
			url: `/api/runs/${run.id}/view-answer`,
			payload: body as object,
		});
	const replies = await Promise.all([
		submit(payload),
		submit({ ...payload, approved: false, feedback: "Change it" }),
	]);
	expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 409]);
	await waitForRuntime(() => expect(run.status).toBe("completed"));
	const original = run.viewRecords![0]!.answer!;
	expect(original.output.approved).toBe(true);
	expect((await submit(payload)).json().output).toEqual(original.output);
	expect(
		run.history.filter((item) => item.step === "renamed-human"),
	).toHaveLength(1);
	expect(run.humanDecisions).toBeUndefined();
	expect(run.architectureDecisions).toBeUndefined();
	await runtime.flush(run.id);
});
it("labels bounded last-run input previews and rejects private roots and extra inputs", async () => {
	const { server, run } = await fixture();
	const body = {
		workflowId: run.workflow.id,
		stepId: "renamed-human",
		view: run.workflow.steps[0]!.view,
		lastRun: true,
	};
	const preview = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: "/api/recipes/view-preview",
		payload: body,
	});
	expect(preview.statusCode).toBe(200);
	expect(preview.json()).toMatchObject({
		scope: { inputs: {} },
		provenance: {
			kind: "last-run",
			runId: run.id,
			stepKey: "renamed-human",
			definitionMatch: true,
		},
	});
	for (const edit of [
		{ type: "show" },
		{ name: "Edited human title" },
		{ notifications: { push: "view-text" } },
	]) {
		const changed = await server.app.inject({
			method: "POST",
			headers: { "x-factory-request": "1" },
			url: "/api/recipes/view-preview",
			payload: {
				...body,
				type: "approve",
				name: "Approve exact content",
				...edit,
			},
		});
		expect(changed.statusCode).toBe(200);
		expect(changed.json().provenance.definitionMatch).toBe(false);
	}

	const invalid = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: "/api/recipes/view-preview",
		payload: { ...body, view: { from: "/run/credentials" } },
	});
	expect(invalid.statusCode).toBe(400);
	const extra = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: "/api/recipes/view-preview",
		payload: { ...body, path: "/private/home" },
	});
	expect(extra.statusCode).toBe(400);
});
it("identifies pending view attention by server batch and digest without exposing content in push", async () => {
	const { run, runtime, home } = await fixture();
	const before = runPushEvent(run);
	expect(before).toMatchObject({
		category: "review",
		destination: `/#/runs/${run.id}`,
	});
	expect(JSON.stringify(before)).not.toContain("script");
	await runtime.shutdown();
	const restored = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});

	expect(runPushEvent(restored.get(run.id))).toEqual(before);
	await restored.shutdown();
});

it("delivers current bounded Ask text and its exact answer protocol through real API and native ticket fallback", async () => {
	const comments: string[] = [];
	let failAsk = false;
	const { runtime, server, home } = await fixture({
		agent: async () => {
			if (failAsk) throw new Error("E".repeat(1_000_000));
			return "API_UNIQUE_REPLY <script>inert</script>";
		},
		track: async (_run, milestone) => {
			comments.push(milestone.body);
		},
	});
	const large = {
		version: "view-v1",
		components: Array.from({ length: 5 }, (_, index) => ({
			id: `text${index}`,
			type: "markdown",
			data: { literal: { text: "H".repeat(16000) } },
		})),
	};
	const items = Array.from({ length: 13 }, (_, index) => ({
		id: `item${index}`,
		title: `Item ${index}`,
		body: "B".repeat(8000),
	}));
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "text-channels",
			name: "Text channels",
			steps: [
				{ id: "first", name: "Earlier Show", type: "show", view: large },
				{ id: "second", name: "Another Show", type: "show", view: large },
				{
					id: "choose",
					name: "Current decision",
					type: "decide",
					view: {
						version: "view-v1",
						components: [
							{
								id: "summary",
								type: "markdown",
								data: { literal: { text: "Current display" } },
							},
						],
					},
					decide: {
						items: { literal: items },
						body: "/body",
						actions: [{ id: "skip", label: "Skip" }],
						ask: { prompt: "Explain only supplied context" },
					},
				},
			],
		},
	]).at(-1)!;
	const reference = taskbotSource("https://taskbot.example/p/fixture/t/1")!;
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "",
		workflow,
		ticketReference: reference,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(run.viewDecision).toBeDefined());
	await waitForRuntime(() =>
		expect(comments.some((text) => text.includes(run.viewDecision!.id))).toBe(
			true,
		),
	);
	const initialResponse = await server.app.inject({
		url: `/api/runs/${run.id}?view=dashboard`,
	});
	const initial = initialResponse.json();
	expect(initial.viewText).toContain(
		`/view-answer {"batchId":"${run.viewDecision!.id}"`,
	);
	expect(initial.viewText).toContain(run.viewDecision!.digest);
	expect(initial.viewText).toContain("INCOMPLETE");
	expect(initial.viewText.length).toBeLessThanOrEqual(100000);
	const comment = comments.find((text) => text.includes(run.viewDecision!.id))!;
	expect(comment).toContain("/view-answer");
	expect(comment).toContain("INCOMPLETE");
	const response = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: `/api/runs/${run.id}/view-ask`,
		payload: {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
			itemId: "item0",
			question: "API_UNIQUE_QUESTION",
			requestId: randomUUID(),
		},
	});
	expect(response.statusCode).toBe(200);
	await waitForRuntime(() =>
		expect(run.viewDecision!.threads!.item0![0]!.status).toBe("answered"),
	);
	const detail = (
		await server.app.inject({ url: `/api/runs/${run.id}?view=dashboard` })
	).json();
	expect(detail.viewText).toContain("API\\_UNIQUE\\_QUESTION");
	expect(detail.viewText).toContain("API\\_UNIQUE\\_REPLY");
	expect(detail.viewText).toContain("answered");
	expect(detail.viewText).not.toContain("<script>");
	expect(detail.viewText).toContain(run.viewDecision!.digest);
	expect(detail.viewDecision.digest).not.toBe(initial.viewDecision.digest);
	failAsk = true;
	const failed = await server.app.inject({
		method: "POST",
		headers: { "x-factory-request": "1" },
		url: `/api/runs/${run.id}/view-ask`,
		payload: {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
			itemId: "item1",
			question: "Explain missing evidence",
			requestId: randomUUID(),
		},
	});
	expect(failed.statusCode).toBe(200);
	await waitForRuntime(() =>
		expect(run.viewDecision!.threads!.item1![0]!.status).toBe("failed"),
	);
	const bounded = await server.app.inject({
		url: `/api/runs/${run.id}?view=dashboard`,
	});
	expect(bounded.body.length - initialResponse.body.length).toBeLessThan(30000);
	expect(
		bounded.json().viewDecision.threads.item1[0].error.length,
	).toBeLessThanOrEqual(24000);
	expect(bounded.json().viewDecision.threads.item1[0].error).toContain(
		"Private agent diagnostics were retained",
	);

	expect(
		run.viewRecords!.find((r) => r.snapshot.id === run.viewDecision!.id)!
			.snapshot.threads!.item1![0]!.error,
	).toBe("E".repeat(1_000_000));
	await expect(
		runtime.replyView(
			run.id,
			`/view-answer ${JSON.stringify({ batchId: initial.viewDecision.id, digest: initial.viewDecision.digest, accepted: true, choices: items.map((item) => ({ itemId: item.id, action: "skip" })) })}`,
		),
	).rejects.toThrow("changed");
	await runtime.replyView(
		run.id,
		`/view-answer ${JSON.stringify({ batchId: run.viewDecision!.id, digest: run.viewDecision!.digest, accepted: true, choices: items.map((item) => ({ itemId: item.id, action: "skip" })) })}`,
	);
	await waitForRuntime(() => expect(run.status).toBe("completed"));
});

it("round-trips real Recipes human definitions and explicit notification edits without manufacturing agent authority", async () => {
	const { runtime, server, run, home } = await fixture();
	const response = await server.app.inject({ url: "/api/config?view=recipes" });
	expect(response.statusCode).toBe(200);
	const editable = response
		.json()
		.workflows.find(
			(workflow: { id: string }) => workflow.id === run.workflow.id,
		);
	const human = editable.steps[0];
	for (const key of [
		"rules",
		"checks",
		"access",
		"instructions",
		"output",
		"revision",
	])
		expect(human).not.toHaveProperty(key);
	const saved = await server.app.inject({
		method: "PATCH",
		headers: { "x-factory-request": "1" },
		url: "/api/workflows",
		payload: {
			workflows: [
				{
					...editable,
					steps: [{ ...human, notifications: { push: "view-text" } }],
				},
			],
		},
	});
	expect(saved.statusCode, saved.body).toBe(200);
	const workflow = runtime
		.listWorkflows()
		.find((workflow) => workflow.id === run.workflow.id)!;
	expect(workflow.steps[0]!.notifications).toEqual({ push: "view-text" });
	expect(run.workflow.steps[0]!.notifications).toBeUndefined();
	expect(run.viewDecision!.notifications).toBeUndefined();
	expect(runPushEvent(run)!.viewText).toBeUndefined();
	const next = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(next);
	await waitForRuntime(() => expect(next.status).toBe("waiting"));
	expect(next.viewDecision!.notifications).toEqual({ push: "view-text" });
	expect(runPushEvent(next)!.viewText).toContain(next.viewDecision!.digest);
	const invalid = await server.app.inject({
		method: "PATCH",
		headers: { "x-factory-request": "1" },
		url: "/api/workflows",
		payload: {
			workflows: [
				{
					...editable,
					steps: [{ ...human, rules: [], access: { mode: "workspace" } }],
				},
			],
		},
	});
	expect(invalid.statusCode).toBe(400);
});
