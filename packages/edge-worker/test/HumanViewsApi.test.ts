import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runPushEvent } from "../src/factory/PushEvents.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
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
async function fixture() {
	const home = mkdtempSync(join(tmpdir(), "view-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("No model calls");
		},
		script: async () => ({}),
		tool: async () => ({}),
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
