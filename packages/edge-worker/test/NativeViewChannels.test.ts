import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TodayApp } from "../../../apps/cli/src/tui/app.js";
import { FactoryClient } from "../../../apps/cli/src/tui/client.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { factoryAccess } from "../src/factory/FactoryAuth.js";
import { requestFactoryTerminalSession } from "../src/factory/FactoryAuthOperator.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import {
	TicketTracking,
	taskbotSource,
} from "../src/factory/TicketTracking.js";
import { nativeViewPreset } from "../src/factory/ViewPresets.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [],
	servers: FactoryServer[] = [],
	apps: TodayApp[] = [],
	services: TicketTracking[] = [];
afterEach(async () => {
	for (const app of apps.splice(0)) app.stop();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const server of servers.splice(0)) await server.stop();
	for (const service of services.splice(0)) service.stop();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const forbidden = async () => {
	throw new Error("Unexpected provider effect");
};
const port = 36344;
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "native-channels143-"));
	homes.push(home);
	const ticket = {
		comments: [] as { body: string }[],
		attachments: [] as { url: string }[],
	};
	let runtime: WorkflowRuntime;
	const service = new TicketTracking(
		async () => ({
			read: async () => structuredClone(ticket),
			stage: async () => undefined,
			comment: async (body) => {
				ticket.comments.push({ body });
			},
			link: async () => {},
		}),
		(run) => runtime.save(run),
		() => {},
	);
	services.push(service);
	const hooks = {
		agent: async (c: any) =>
			c.step.id === "source"
				? { summary: "Current declared review content" }
				: c.run.answers.length
					? { questions: [] }
					: { questions: ["Which correction should I make?"] },
		tool: async () => ({
			headSha: "a".repeat(40),
			url: "https://github.com/synthetic/repo/pull/1",
		}),
		script: forbidden,
		track: (run: any, milestone: any) => service.record(run, milestone),
	};
	runtime = new WorkflowRuntime(home, hooks);
	runtimes.push(runtime);
	const review = nativeViewPreset("review");
	review.reads!.note = "source/summary";
	review.components.unshift({
		id: "custom-note",
		type: "markdown",
		data: { bindings: { text: { path: "/inputs/note" } } },
	});
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "native-channels",
			name: "Controlled native channels",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "source",
					name: "Current guide",
					type: "agent",
					prompt: "Synthetic",
					next: "human",
				},
				{
					id: "human",
					name: "Review this change",
					type: "tool",
					tool: "human-review",
					configVersion: "step-config-v1",
					reads: { guide: "source" },
					view: review,
					branches: [
						{
							when: { path: "decision", equals: "reject" },
							next: "correction",
						},
					],
					next: "end",
				},
				{
					id: "correction",
					name: "Ask about correction",
					type: "agent",
					prompt: "Synthetic",
					askQuestions: true,
					view: nativeViewPreset("ask"),
					next: "end",
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		input: "Synthetic review",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	const makeServer = (r: WorkflowRuntime) => {
		const s = new FactoryServer(
			r,
			{
				repositories: () => [],
				sessions: () => [],
				entries: () => [],
				start: forbidden,
				stop: (id) => r.stop(id),
			},
			factoryAccess(port),
		);
		servers.push(s);
		return s;
	};
	const client = async () => {
		const token = requestFactoryTerminalSession(home);
		// The real server consumes the ephemeral local terminal request on its timer.
		await new Promise((resolve) => setTimeout(resolve, 1200));
		return new FactoryClient({ port, home, requestSession: () => token });
	};
	return {
		home,
		runtime,
		run,
		makeServer,
		client,
		ticket,
		reload: () => {
			runtime = new WorkflowRuntime(home, hooks);
			runtimes.push(runtime);
			return runtime;
		},
	};
}
async function terminal(client: FactoryClient, runId: string) {
	let frame = "";
	const app = new TodayApp({
		client,
		theme: "dark",
		sgr: () => "",
		write: (value) => {
			frame = value;
		},
		size: () => ({ columns: 140, rows: 50 }),
		openUrl: forbidden,
		quit: () => {},
	});
	apps.push(app);
	app.start();
	await waitFor(() =>
		expect((app as any).details.get(runId)?.nativeView).toBeDefined(),
	);
	app.key({ name: "enter" });
	await waitFor(() =>
		expect(frame).toContain("Current declared review content"),
	);
	return { app, frame: () => frame };
}

it.each([
	"approve",
	"reject",
] as const)("captures the displayed native version for actual terminal %s callbacks", async (decision) => {
	const f = fixture(),
		s = f.makeServer(f.runtime);
	await s.start(port);
	void f.runtime.launch(f.run);
	await waitFor(() => expect(f.run.reviewGate?.status).toBe("pending"));
	const client = await f.client(),
		shown: any = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	expect(shown.viewText).toContain("Current declared review content");
	const identityText = shown.viewText.replaceAll("\\", "");
	expect(identityText).toContain(shown.reviewGate.id);
	expect(identityText).toContain(shown.reviewGate.url);
	expect(identityText).toContain(shown.reviewGate.headSha);
	const t = await terminal(client, f.run.id),
		app = t.app as any;
	const open = () =>
		t.app.key({ name: "text", text: decision === "approve" ? "a" : "r" });
	const submit = () =>
		decision === "approve"
			? app.overlay.action()
			: app.overlay.submit("Correct the label");
	open();
	const staleOverlay = app.overlay;
	// A public producer changes after display. A refresh must not change the
	// version already captured by the open confirmation/prompt callback.
	(f.run.outputs.source as { summary: string }).summary =
		"Updated declared review content";
	await app.loadDetail(f.run.id);
	expect(app.details.get(f.run.id).nativeView.digest).not.toBe(
		shown.nativeView.digest,
	);
	expect(app.overlay).toBe(staleOverlay);
	await expect(submit()).rejects.toMatchObject({ status: 409 });
	expect(f.run.humanDecisions ?? []).toEqual([]);
	expect(f.run.reviewGate?.status).toBe("pending");
	t.app.key({ name: "escape" });
	open();
	await submit();
	await waitFor(() => expect(f.run.humanDecisions?.length).toBe(1));
	expect(f.run.humanDecisions?.[0]).toMatchObject({
		decision,
		reviewId: shown.reviewGate.id,
		headSha: shown.reviewGate.headSha,
		url: shown.reviewGate.url,
	});
});

it("restores the current Ask after exact terminal rejection while retaining review history and notification dedup", async () => {
	const f = fixture();
	f.run.ticketReference = {
		...taskbotSource("https://tasks.example.invalid/p/fixture/t/1")!,
		server: "synthetic",
	};
	let s = f.makeServer(f.runtime);
	await s.start(port);
	void f.runtime.launch(f.run);
	await waitFor(() => expect(f.run.reviewGate?.status).toBe("pending"));
	let client = await f.client();
	const t = await terminal(client, f.run.id),
		app = t.app as any;
	t.app.key({ name: "text", text: "r" });
	await app.overlay.submit("Correct the label");
	await waitFor(() =>
		expect(f.run.questions).toEqual(["Which correction should I make?"]),
	);
	let detail: any = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	expect(detail.nativeView).toMatchObject({
		authority: "ask",
		preset: "ask",
		stepKey: "correction",
	});
	expect(
		detail.nativeView.view.components.some((c: any) => c.type === "questions"),
	).toBe(true);
	expect(detail.viewText).toContain("Which correction should I make?");
	expect(detail.viewText.replaceAll("\\", "")).toContain(
		detail.questionBatchId,
	);
	const comments = () =>
		f.ticket.comments.filter((c) =>
			c.body.startsWith("Factory needs assistance:"),
		);
	await waitFor(() => expect(comments()).toHaveLength(1));
	expect(comments()[0]!.body).toContain("Which correction should I make?");
	const batch = detail.questionBatchId,
		gate = structuredClone(f.run.reviewGate),
		history = structuredClone(f.run.humanDecisions);
	t.app.stop();
	await f.runtime.shutdown();
	await s.stop();
	const restored = f.reload();
	s = f.makeServer(restored);
	await s.start(port);
	restored.resumeAll();
	await waitFor(() => expect(restored.get(f.run.id).status).toBe("waiting"));
	client = await f.client();
	detail = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	expect(detail.nativeView).toMatchObject({
		authority: "ask",
		preset: "ask",
		stepKey: "correction",
	});
	expect(detail.questionBatchId).toBe(batch);
	expect(comments()).toHaveLength(1);
	await client.post(`/api/runs/${f.run.id}/answer`, {
		answer: "Correct the label",
		kind: "answer",
		context: {
			step: detail.step,
			questions: detail.questions,
			questionBatchId: batch,
		},
	});
	await waitFor(() => expect(restored.get(f.run.id).status).toBe("completed"));
	const current = restored.get(f.run.id);
	expect(current.answers).toHaveLength(1);
	expect(current.reviewGate).toEqual(gate);
	expect(current.humanDecisions).toEqual(history);
	expect(comments()).toHaveLength(1);
}, 10000);
