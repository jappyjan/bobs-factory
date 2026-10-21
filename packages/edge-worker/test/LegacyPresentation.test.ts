import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
	presentationOutputKeys,
	presentationRoleRevisions,
} from "../src/factory/RunOutputRoles.js";
import { dashboardRun } from "../src/factory/RunProjection.js";
import { configuredOutputKeys } from "../src/factory/ToolBindings.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { FullReview } from "../src/factory/web/focus.js";
import {
	guideMatchesGate,
	guideRevision,
	reviewKey,
} from "../src/factory/web/review-state.js";
import { roleOutput } from "../src/factory/web/run-output.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import legacyWorkflows from "./fixtures/legacy-workflows-a4990127.json" with {
	type: "json",
};

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

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const servers: FactoryServer[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) await server.stop();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function fixture(
	status: "waiting" | "completed" = "waiting",
	change?: (run: any) => void,
) {
	const home = mkdtempSync(join(tmpdir(), "legacy-presentation-"));
	homes.push(home);
	const definitions = structuredClone(legacyWorkflows.default);
	const workflow = definitions.find((w) => w.id === "factory")!;
	const guide = {
		summary: "Accepted historical guide",
		chapters: [
			{ id: "chapter", title: "Retained guide", summary: "Read me", files: [] },
		],
	};
	const evidence = join(home, "factory", "evidence", "historical");
	mkdirSync(evidence, { recursive: true });
	const image = join(evidence, "screen.png");
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
		"base64",
	);
	writeFileSync(image, png);
	const imageSha256 = createHash("sha256").update(png).digest("hex");
	const capture = {
		screenshots: [
			{
				path: image,
				area: "Retained",
				state: "saved",
				caption: "Saved screenshot",
				imageSha256,
			},
		],
		unavailable: [],
	};
	const draft = {
		url: "https://github.com/selected/repo/pull/136",
		headSha: "accepted",
	};
	const at = "2026-10-01T00:00:00Z";
	const stored = {
		id: "historical",
		title: "Historical review",
		workflow,
		workflowDefinitions: definitions,
		repositoryId: "repo",
		workspace: home,
		input: "Task",
		status,
		createdAt: at,
		updatedAt: at,
		step: "pipeline/human-review",
		answers: [],
		questions: [],
		events: [],
		outputs: { guide, capture, "draft-pr": draft },
		history: [
			{ step: "pipeline/capture", output: capture, at },
			{ step: "pipeline/draft-pr", output: draft, at },
			{ step: "pipeline/guide", output: guide, at },
		],
		roleRevisions: {
			"pipeline/guide": {
				headSha: "accepted",
				dirty: false,
				historyLength: 0,
				at,
			},
		},
		reviewGate: {
			id: "review",
			headSha: "accepted",
			url: draft.url,
			status: status === "waiting" ? "pending" : "approve",
		},
		checkpoint:
			status === "waiting"
				? {
						current: "pipeline",
						visits: {},
						active: {
							phase: "result",
							children: [
								{
									current: "human-review",
									visits: {},
									active: { phase: "waiting" },
								},
							],
						},
					}
				: { current: "end", visits: {} },
	};
	change?.(stored);
	const definitionsBytes = JSON.stringify(stored.workflowDefinitions);
	const outputsBytes = JSON.stringify(stored.outputs);
	const originalBytes = JSON.stringify(stored);
	mkdirSync(join(home, "factory", "runs"), { recursive: true });
	const file = join(home, "factory", "runs", `${stored.id}.json`);
	writeFileSync(file, originalBytes);
	const runtime = new WorkflowRuntime(home, {});
	runtimes.push(runtime);
	const run = runtime.get(stored.id);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	servers.push(server);
	return {
		run,
		server,
		runtime,
		guide,
		png,
		image,
		imageSha256,
		originalBytes,
		file,
		definitionsBytes,
		outputsBytes,
	};
}

it.each([
	"waiting",
	"completed",
] as const)("loads a499 %s review leaf outputs without rewriting their accepted data", async (status) => {
	const {
		run,
		server,
		runtime,
		guide,
		png,
		image,
		imageSha256,
		file,
		originalBytes,
		definitionsBytes,
		outputsBytes,
	} = fixture(status);
	expect(presentationOutputKeys(run)).toMatchObject({
		guide: "guide",
		capture: "capture",
		"draft-pr": "draft-pr",
	});
	expect(guideRevision(dashboardRun(run, run.outputs, false))).toEqual(
		run.roleRevisions!["pipeline/guide"],
	);
	for (const view of ["dashboard", "focus"]) {
		const response = await server.app.inject({
			url: `/api/runs/${run.id}?view=${view}`,
		});
		expect(response.statusCode).toBe(200);
		const projected = response.json();
		expect(roleOutput(projected, "guide")?.summary).toBe(guide.summary);
		if (view === "dashboard") {
			expect(projected.hasGuide).toBe(true);
			expect(guideRevision(projected)).toEqual(
				run.roleRevisions!["pipeline/guide"],
			);
			expect(guideMatchesGate(projected)).toBe(true);
			expect(
				guideMatchesGate({
					...projected,
					reviewGate: { ...projected.reviewGate, headSha: "changed" },
				}),
			).toBe(false);
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
							{},
							createElement(FullReview, {
								run: projected,
								onSettled: () => {},
							}),
						),
					),
				);
				expect(html).toContain(guide.summary);
				expect(html).toContain("Retained guide");
			} finally {
				client.clear();
			}
		}
	}
	const evidence = await server.app.inject({
		url: `/api/runs/${run.id}/evidence`,
	});
	expect(evidence.statusCode).toBe(200);
	expect(evidence.json().screenshots[0].caption).toBe("Saved screenshot");
	for (const artifact of ["", "&artifact=capture"]) {
		const shot = await server.app.inject({
			url: `/api/runs/${run.id}/screenshots/0?v=${imageSha256}${artifact}`,
		});
		expect(shot.statusCode).toBe(200);
		expect(shot.rawPayload).toEqual(png);
	}
	const stale = await server.app.inject({
		url: `/api/runs/${run.id}/screenshots/0?v=${"0".repeat(64)}`,
	});
	expect(stale.statusCode).toBe(409);
	writeFileSync(image, Buffer.from("changed"));
	const changed = await server.app.inject({
		url: `/api/runs/${run.id}/screenshots/0`,
	});
	expect(changed.statusCode).not.toBe(200);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(definitionsBytes);
	expect(JSON.stringify(run.outputs)).toBe(outputsBytes);
	expect(Object.keys(run.roleRevisions!)).toEqual(["pipeline/guide"]);
	await runtime.flush(run.id);
	expect(readFileSync(`${file}.legacy`, "utf8")).toBe(originalBytes);
});

it.each([
	"version",
	"optional",
	"root",
	"sibling",
	"unaccepted-history",
	"missing-history",
])("denies historical aliases with %s producer ambiguity or modern config", async (kind) => {
	const { run, server } = fixture("waiting", (stored) => {
		if (kind === "version")
			stored.workflow.stepConfigVersion = "step-config-v1";
		if (kind === "optional") stored.workflow.steps[0].access = "workspace";
		if (kind === "root")
			stored.workflow.steps.push({
				id: "guide",
				name: "Root data",
				type: "agent",
				prompt: "Data",
				next: "end",
			});
		if (kind === "sibling")
			stored.workflow.steps.push({
				id: "sibling",
				name: "Other frame",
				type: "workflow",
				workflow: "factory-pipeline",
				next: "end",
			});
		if (kind === "unaccepted-history")
			stored.history.push({
				step: "unaccepted/guide",
				output: stored.outputs.guide,
				at: stored.updatedAt,
			});
		if (kind === "missing-history")
			stored.history = stored.history.filter(
				(h: { step: string }) => h.step !== "pipeline/guide",
			);
	});
	expect(presentationOutputKeys(run).guide).toBeUndefined();
	expect(presentationRoleRevisions(run)?.guide).toBeUndefined();
	if (["version", "optional", "sibling"].includes(kind)) {
		expect(presentationOutputKeys(run).capture).toBeUndefined();
		const screenshot = await server.app.inject({
			url: `/api/runs/${run.id}/screenshots/0`,
		});
		expect(screenshot.statusCode).not.toBe(200);
	}
});

it("does not borrow a revision receipt from an unrelated qualified producer", async () => {
	const { run, server } = fixture("waiting", (stored) => {
		stored.roleRevisions["other/guide"] =
			stored.roleRevisions["pipeline/guide"];
		delete stored.roleRevisions["pipeline/guide"];
	});
	expect(presentationOutputKeys(run).guide).toBe("guide");
	const response = await server.app.inject({
		url: `/api/runs/${run.id}?view=dashboard`,
	});
	expect(guideRevision(response.json())).toBeUndefined();
	expect(Object.keys(run.roleRevisions!)).toEqual(["other/guide"]);
});

it("preserves completed historical review progress identity after its gate is gone", async () => {
	const { run, server, guide } = fixture("completed", (stored) => {
		delete stored.reviewGate;
	});
	const response = await server.app.inject({
		url: `/api/runs/${run.id}?view=dashboard`,
	});
	const projected = response.json();
	expect(guideRevision(projected)?.headSha).toBe("accepted");
	expect(reviewKey(projected, roleOutput(projected, "guide"))).toBe(
		reviewKey(
			{ id: run.id, outputs: { guide }, roleRevisions: run.roleRevisions },
			guide,
		),
	);
});

it("does not infer a producer from legacy-looking output and history without an accepted graph", () => {
	expect(
		configuredOutputKeys(
			{
				outputs: { guide: { summary: "Unowned" } },
				history: [{ step: "pipeline/guide" }],
			} as any,
			{ check: "requirement-coverage" },
		),
	).toEqual([]);
});
