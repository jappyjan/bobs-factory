import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { nativeViewSnapshot } from "../src/factory/NativeViews.js";
import { hasCheck } from "../src/factory/StepConfig.js";
import type { ViewDefinition } from "../src/factory/View.js";
import { nativeViewPreset } from "../src/factory/ViewPresets.js";
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
	const path = mkdtempSync(join(tmpdir(), "saved-checkin143-"));
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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ArchitecturePage } from "../src/factory/web/architecture.js";

// Browser stores have no SSR reader. Use their real current snapshot for this
// server-rendered component check while retaining React's hook behavior.
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

const route = vi.hoisted(() => ({ run: undefined as any }));
vi.mock("../src/factory/web/client.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/client.js")>();
	return { ...original, useRun: () => ({ data: route.run, isLoading: false }) };
});

it.each([
	false,
	true,
])("reads the saved Factory check-in declaration during a later Review (notes hidden: %s)", async (hideNotes) => {
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
	let candidate: Record<string, unknown> = {};
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
		return { summary: "Current unrelated Review guide" };
	};
	let runtime = new WorkflowRuntime(directory, {
		agent: raw,
		tool: (c) =>
			c.step.tool === "human-review"
				? Promise.resolve({
						headSha: "a".repeat(40),
						url: "https://github.com/synthetic/repo/pull/2",
					})
				: tools.tool(c),
		script: async () => ({}),
	});
	runtimes.push(runtime);
	const fork = runtime.forkWorkflow("factory"),
		definitions = runtime.listWorkflows(),
		child = definitions.find(
			(w) => w.id === fork.steps.find((s) => s.id === "check-in")!.workflow,
		)!,
		decision = child.steps.find((s) => s.tool === "architecture-decision")!;

	definitions
		.find((w) => w.id === fork.id)!
		.steps.find((s) => s.id === "check-in")!.next = "reader-source";
	definitions
		.find((w) => w.id === fork.id)!
		.steps.push(
			{
				id: "reader-source",
				name: "Current guide",
				type: "agent",
				prompt: "Synthetic guide",
				next: "reader-human",
			},
			{
				id: "reader-human",
				name: "Current review",
				type: "tool",
				tool: "human-review",
				configVersion: "step-config-v1",
				reads: { guide: "reader-source" },
				view: nativeViewPreset("review"),
				next: "end",
			},
		);
	const view = structuredClone(decision.view) as ViewDefinition;
	view.reads!.planDetails = "architecture/candidate/plan";
	view.components = [
		view.components.find((c) => c.id === "size")!,
		...view.components.filter(
			(c) =>
				!["size", "notice", ...(hideNotes ? ["notes"] : [])].includes(c.id),
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
		tool: (c) =>
			c.step.tool === "human-review"
				? Promise.resolve({
						headSha: "a".repeat(40),
						url: "https://github.com/synthetic/repo/pull/2",
					})
				: tools.tool(c),
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
	const pending = (
		await currentServer.app.inject({
			url: `/api/runs/${run.id}?view=architecture`,
		})
	).json();
	expect(pending.architectureViews[p.id]).toMatchObject({
		authority: "approve",
		digest: shown.digest,
		proposalId: p.id,
		proposalDigest: p.digest,
	});
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
	await waitForRuntime(() => expect(run.reviewGate?.status).toBe("pending"));
	expect(run.architectureDecisions?.at(-1)).toMatchObject({
		proposalId: p.id,
		digest: p.digest,
		decision: "accept",
	});
	expect(run.outputs[planOutput]).toEqual(p.content.candidate);

	const current = (
		await currentServer.app.inject({
			url: `/api/runs/${run.id}?view=architecture`,
		})
	).json();
	expect(current.nativeView.authority).toBe("review");
	expect(current.architectureProposals.at(-1).status).toBe("accepted");
	const unchanged = structuredClone({
		proposals: run.architectureProposals,
		decisions: run.architectureDecisions,
		gate: run.reviewGate,
	});
	const cannotBorrow = await currentServer.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/review`,
		headers: { "x-factory-request": "1" },
		payload: {
			decision: "approve",
			reviewId: run.reviewGate!.id,
			headSha: run.reviewGate!.headSha,
			display: { digest: current.architectureViews[p.id].digest },
		},
	});
	expect(cannotBorrow.statusCode).toBe(409);
	expect({
		proposals: run.architectureProposals,
		decisions: run.architectureDecisions,
		gate: run.reviewGate,
	}).toEqual(unchanged);
	route.run = current;
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	try {
		const html = renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					MemoryRouter,
					{ initialEntries: [`/runs/${run.id}/architecture`] },
					createElement(ArchitecturePage),
				),
			),
		);
		expect(html).not.toContain("Current unrelated Review guide");
		expect(html).toContain("Bob starts building straight away");
		expect(html).toContain("I kept the approval next to the run");
		expect(html.includes("Bob’s notes")).toBe(!hideNotes);
		expect(
			current.architectureViews[p.id].view.components.at(-1),
		).toMatchObject({
			type: "markdown",
			data: { text: p.content.candidate.plan },
		});
		expect(html).toContain("Save a record safely with a focused local check");
		expect(html).not.toContain("Go ahead, build it");
		expect(html).not.toContain("Your answer");
		expect(current.architectureViews[p.id]).toMatchObject({
			authority: "read-only",
			proposalId: p.id,
			proposalDigest: p.digest,
		});
		expect(current.architectureViews[p.id].view.components[0].id).toBe("size");
		expect(current.nativeView.authority).toBe("review");
		expect(run.architectureDecisions).toHaveLength(1);
	} finally {
		client.clear();
		vi.unstubAllGlobals();
	}
});
