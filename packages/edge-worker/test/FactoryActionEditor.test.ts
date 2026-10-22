import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { StepSchema } from "../src/factory/Workflow.js";
import { actionConfigurationProblem } from "../src/factory/web/action-step-settings.js";
import { artifactSummary, artifactType } from "../src/factory/web/artifacts.js";
import {
	type ChildRunBatchView,
	ChildRunList,
	childBatchLabel,
	childRunWaves,
	RecipeParentLink,
	recipeParentOf,
} from "../src/factory/web/child-runs.js";
import { bodyProblem } from "../src/factory/web/foreach-step-settings.js";
import { RecipePalette } from "../src/factory/web/recipe-builder.js";
import {
	draftProblems,
	kinds,
	newStep,
	type Recipe,
} from "../src/factory/web/recipe-graph.js";

const batch = (): ChildRunBatchView => ({
	key: "call/dispatch",
	actionId: "durable-effect-id",
	workflowId: "custom-parent",
	targetWorkflowId: "factory",
	wait: false,
	paused: false,
	cancelled: false,
	items: [
		{
			id: "follow",
			index: 0,
			runId: "child-follow",
			title: "Follow-up",
			url: "/runs/child-follow",
			dependencies: ["first"],
			wave: 1,
			status: "queued",
			creation: "pending",
		},
		{
			id: "first",
			index: 1,
			runId: "child-first",
			title: "<script>first</script>",
			url: "/runs/child-first",
			dependencies: [],
			wave: 0,
			status: "running",
			creation: "confirmed",
		},
		{
			id: "uncertain",
			index: 2,
			runId: "child-unknown",
			title: "Uncertain send",
			url: "/runs/child-unknown",
			dependencies: [],
			wave: 0,
			status: "uncertain",
			creation: "uncertain",
			error: "Reconciliation pending",
		},
	],
});

const render = (element: ReturnType<typeof createElement>) =>
	renderToStaticMarkup(createElement(MemoryRouter, {}, element));

describe("generic action authoring", () => {
	it("keeps structured action summaries inspectable instead of treating them as Markdown", () => {
		const result = {
			tickets: {
				first: { id: "ticket-1", url: "https://tracker.example.invalid/t/1" },
			},
			summary: { total: 1, confirmed: 1, uncertain: 0 },
		};
		expect(artifactType(result)).toBe("structure");
		expect(artifactSummary(result)).toBe(
			"total: 1 · confirmed: 1 · uncertain: 0",
		);
		expect(artifactType({ summary: "Accepted review report" })).toBe("report");
	});
	it("offers independently configurable, valid actions inside any recipe and For each body", () => {
		for (const type of ["snapshot", "file-issues", "launch-runs"] as const) {
			const step = StepSchema.parse(newStep(type, `renamed-${type}`));
			expect(kinds[type].label).toBeTruthy();
			expect(bodyProblem([step])).toBeUndefined();
			const recipe: Recipe = {
				id: "custom",
				name: "Custom",
				description: "",
				labels: [],
				allowedTriggers: ["manual"],
				steps: [step],
			};
			expect(draftProblems(recipe)).toEqual([]);
		}
	});
	it("blocks malformed action paths and invalid bounds before saving", () => {
		const issue = newStep("file-issues", "tickets");
		expect(
			actionConfigurationProblem(issue, {
				...issue.fileIssues,
				fields: { title: "/constructor/title", body: "/body" },
			}),
		).toBeDefined();
		expect(
			actionConfigurationProblem(issue, { ...issue.fileIssues, maxItems: 0 }),
		).toBeDefined();
		const launch = newStep("launch-runs", "children");
		expect(
			actionConfigurationProblem(launch, {
				...launch.launchRuns,
				inputMapping: { prompt: "prompt" },
			}),
		).toBeDefined();
		expect(
			actionConfigurationProblem(newStep("snapshot", "snapshot"), {
				history: { lookbackDays: 0 },
			}),
		).toBeDefined();
	});
});

describe("retained child run view", () => {
	it("sorts dependency waves without changing accepted item order or receipts", () => {
		const retained = batch();
		const original = structuredClone(retained);
		expect(
			childRunWaves(retained).map(({ wave, items }) => ({
				wave,
				ids: items.map((item) => item.id),
			})),
		).toEqual([
			{ wave: 0, ids: ["first", "uncertain"] },
			{ wave: 1, ids: ["follow"] },
		]);
		expect(retained).toEqual(original);
	});
	it("shows paused dispatch separately from running children and uncertain creation", () => {
		const html = render(
			createElement(ChildRunList, {
				batches: { "durable-effect-id": batch() },
				parentStatus: "stopped",
			}),
		);
		expect(html).toContain("Dispatch paused");
		expect(html).toContain('data-status="running"');
		expect(html).toContain('data-status="queued"');
		expect(html).toContain("Wave 1");
		expect(html).toContain("Wave 2");
		expect(html).toContain("Depends on first");
		expect(html).toContain('href="/runs/child-first"');
		expect(html).not.toContain('href="/runs/child-unknown"');
		expect(html).not.toContain('href="/runs/child-follow"');
		expect(html).toContain("Reconciliation pending");
		expect(html).toContain("&lt;script&gt;first&lt;/script&gt;");
		expect(html).not.toContain("<script>");
	});
	it("keeps a stop request and blocked-child outcomes visible while cancellation remains pending after restart", () => {
		const retained = batch();
		retained.cancelled = true;
		retained.items[0] = {
			...retained.items[0]!,
			status: "blocked",
			creation: "pending",
			error: "Prerequisite cancelled",
		};
		const html = render(
			createElement(ChildRunList, {
				batches: JSON.parse(JSON.stringify({ effect: retained })),
				parentStatus: "stopped",
			}),
		);
		expect(html).toContain("Stopping batch");
		expect(html).toContain(
			"Pending or uncertain children are reconciled and stopped",
		);
		expect(html).toContain('data-status="blocked"');
		expect(html).toContain("Prerequisite cancelled");
	});
	it("never labels uncertain child cancellation as finished", () => {
		const retained = batch();
		retained.cancelled = true;
		retained.items = retained.items.map((item) => ({
			...item,
			status: "cancelled",
		}));
		expect(childBatchLabel(retained, "stopped")).toBe("Stopping batch");
		retained.items = retained.items.map((item) => ({
			...item,
			creation: item.id === "follow" ? "pending" : "confirmed",
		}));
		expect(childBatchLabel(retained, "stopped")).toBe("Batch stopped");
	});
	it("shows generic parent provenance and escapes parent links", () => {
		const run = {
			recipeParent: { runId: "parent/../<", workflowId: "<custom>" },
		};
		expect(recipeParentOf(run)?.runId).toBe("parent/../<");
		expect(recipeParentOf({})).toBeUndefined();
		expect(recipeParentOf({ recipeParent: { runId: "parent" } })).toEqual({
			runId: "parent",
			label: "a recipe run",
		});
		const html = render(createElement(RecipeParentLink, { run }));
		expect(html).toContain("Part of recipe &lt;custom&gt;");
		expect(html).toContain('href="/runs/parent%2F..%2F%3C"');
	});
});

describe("recipe palette", () => {
	it("offers bundled and local callable recipes while respecting trigger and owner boundaries", () => {
		const recipe = (
			id: string,
			ownership: Recipe["ownership"],
			allowedTriggers: string[],
		): Recipe => ({
			id,
			name: `${id} recipe`,
			description: "",
			labels: [],
			steps: [],
			ownership,
			allowedTriggers,
		});
		const recipes = [
			recipe("owner", "local", ["workflow"]),
			recipe("bundled-worker", "bundled", ["workflow"]),
			recipe("local-worker", "local", ["workflow"]),
			recipe("manual-only", "bundled", ["manual"]),
		];
		const html = renderToStaticMarkup(
			createElement(RecipePalette, {
				recipes,
				ownerId: "owner",
				disabled: false,
				onAdd: () => {},
			}),
		);
		expect(html).toContain("bundled-worker recipe");
		expect(html).toContain("local-worker recipe");
		expect(html).not.toContain("owner recipe");
		expect(html).not.toContain("manual-only recipe");
		const readonly = renderToStaticMarkup(
			createElement(RecipePalette, {
				recipes,
				ownerId: "owner",
				disabled: true,
				onAdd: () => {},
			}),
		);
		expect(readonly).toContain("Fork to add steps");
		expect(readonly).toMatch(
			/disabled=""[^>]*title="Call bundled-worker recipe"/,
		);
		expect(readonly).not.toContain('draggable="true"');
	});
});
