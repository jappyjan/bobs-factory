import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
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
import { ReviewPage } from "../src/factory/web/review-page.js";
import {
	readReviewProgress,
	reviewKey,
	writeReviewProgress,
} from "../src/factory/web/review-state.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

// Browser stores have no SSR reader. Keep their real snapshot and React hooks.
vi.mock("react", async (importOriginal) => {
	const original = await importOriginal<typeof import("react")>();
	return {
		...original,
		useSyncExternalStore: (
			subscribe: Parameters<typeof original.useSyncExternalStore>[0],
			getSnapshot: () => unknown,
			getServerSnapshot?: () => unknown,
		) =>
			original.useSyncExternalStore(
				subscribe,
				getSnapshot,
				getServerSnapshot ?? getSnapshot,
			),
	};
});
vi.mock("../src/factory/web/pwa.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/pwa.js")>();
	return { ...original, usePwa: () => original.pwaState() };
});
// SSR reads the authenticated UI's local progress store. Server/TUI authentication
// remains the real protected fixture; this mock grants no runtime authority.
vi.mock("../src/factory/web/auth-state.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/auth-state.js")>();
	return {
		...original,
		accessState: () => ({ status: "authenticated", access: "local" }),
	};
});
const route = vi.hoisted(() => ({ run: undefined as any }));
vi.mock("../src/factory/web/client.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/client.js")>();
	return { ...original, useRun: () => ({ data: route.run, isLoading: false }) };
});
function renderReader(detail: any) {
	route.run = detail;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	try {
		return renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					MemoryRouter,
					{ initialEntries: [`/runs/${detail.id}/review`] },
					createElement(ReviewPage, {
						config: { repositories: [], workflows: [] },
						onSettled: () => {},
					}),
				),
			),
		);
	} finally {
		client.clear();
	}
}

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [],
	servers: FactoryServer[] = [],
	apps: TodayApp[] = [],
	services: TicketTracking[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
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
function fixture(withShow = false) {
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
				? {
						summary: "Current declared review content",
						chapters: [
							{
								id: "retained",
								title: "Prior correction guide",
								summary: "Inspect original checks before answering",
								files: [],
							},
						],
					}
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
					next: withShow ? "past-display" : "human",
				},
				...(withShow
					? [
							{
								id: "past-display",
								name: "An earlier Show",
								type: "show",
								view: {
									version: "view-v1",
									components: [
										{
											id: "earlier",
											type: "markdown",
											data: {
												literal: { text: "Earlier generic Show content" },
											},
										},
									],
								},
								next: "human",
							},
						]
					: []),
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
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	const before: any = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	const guide = before.outputs.source;
	const key = reviewKey(before, guide);
	writeReviewProgress(before, guide, { page: 1, reviewed: { retained: true } });
	expect(renderReader(before)).toContain(
		"Inspect original checks before answering",
	);
	const t = await terminal(client, f.run.id),
		app = t.app as any;
	t.app.key({ name: "text", text: "r" });
	await app.overlay.submit("Correct the label");
	await waitFor(() =>
		expect(f.run.questions).toEqual(["Which correction should I make?"]),
	);
	let detail: any = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	expect(detail.savedReviewView).toMatchObject({
		authority: "read-only",
		stepKey: "human",
		guideSource: "source",
	});
	const savedGuide = Object.values(detail.savedReviewView.resources).at(
		0,
	) as any;
	expect(savedGuide.value).toEqual(guide);
	expect(reviewKey(detail, savedGuide.value)).toBe(key);
	expect(readReviewProgress(detail, savedGuide.value, 4)).toMatchObject({
		page: 1,
		reviewed: { retained: true },
	});
	const html = renderReader(detail);
	expect(html).toContain("Inspect original checks before answering");
	expect(html).not.toContain("No review guide yet");
	expect(html).not.toContain("Approve this PR");
	expect(html).not.toContain("Request changes");
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
	await expect(
		client.post(`/api/runs/${f.run.id}/answer`, {
			answer: "Correct the label",
			kind: "answer",
			context: {
				step: detail.step,
				questions: detail.questions,
				questionBatchId: batch,
			},
			display: { digest: detail.savedReviewView.digest },
		}),
	).rejects.toMatchObject({ status: 409 });
	expect(f.run.answers).toHaveLength(0);
	expect(f.run.reviewGate).toEqual(gate);
	expect(f.run.humanDecisions).toEqual(history);
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
	expect(detail.savedReviewView.authority).toBe("read-only");
	expect(renderReader(detail)).toContain(
		"Inspect original checks before answering",
	);
	expect(reviewKey(detail, savedGuide.value)).toBe(key);
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
}, 180000);

it("renders the current native Review before retained Show history and approves only that displayed version", async () => {
	const f = fixture(true),
		s = f.makeServer(f.runtime);
	await s.start(port);
	void f.runtime.launch(f.run);
	await waitFor(() => expect(f.run.reviewGate?.status).toBe("pending"));
	const client = await f.client();
	const detail: any = await client.get(`/api/runs/${f.run.id}?view=dashboard`);
	expect(detail.nativeView.authority).toBe("review");
	expect(detail.viewText).toContain(
		`Displayed digest: ${detail.nativeView.digest}`,
	);
	expect(detail.viewText).toContain("Current declared review content");
	expect(detail.viewText).toContain("Earlier generic Show content");
	expect(
		detail.viewText.indexOf("Current declared review content"),
	).toBeLessThan(detail.viewText.indexOf("Earlier generic Show content"));
	expect(detail.viewText.replaceAll("\\", "")).toContain(detail.reviewGate.id);
	expect(detail.viewText.length).toBeLessThanOrEqual(100000);
	const t = await terminal(client, f.run.id);
	expect(t.frame()).toContain("Current declared review content");
	expect(t.frame().replaceAll("\\", "")).toContain(detail.reviewGate.id);
	t.app.key({ name: "text", text: "a" });
	await (t.app as any).overlay.action();
	await waitFor(() => expect(f.run.humanDecisions).toHaveLength(1));
	expect(f.run.humanDecisions?.[0]).toMatchObject({
		decision: "approve",
		reviewId: detail.reviewGate.id,
		headSha: detail.reviewGate.headSha,
		url: detail.reviewGate.url,
	});
});
