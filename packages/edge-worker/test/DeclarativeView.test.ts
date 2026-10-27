import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ViewSnapshot } from "../src/factory/HumanStep.js";
import {
	type ResolvedView,
	ResolvedViewSchema,
	resolveView,
	viewText,
} from "../src/factory/View.js";
import {
	DeclarativeView,
	ViewMarkdown,
	viewLink,
} from "../src/factory/web/declarative-view.js";

const sha = "a".repeat(64);
const everything = (): ResolvedView =>
	ResolvedViewSchema.parse({
		version: "view-v1",
		components: [
			{
				id: "summary",
				type: "markdown",
				title: "Summary",
				data: {
					text: "**Read this** before choosing. [Guide](https://example.invalid/guide)",
				},
			},
			{
				id: "criteria",
				type: "checklist",
				title: "Criteria",
				data: {
					items: [
						{
							label: "Tests pass",
							state: "done",
							detail: "All focused cases passed",
						},
						{ label: "Capture", state: "partly" },
						{ label: "Review", state: "open" },
					],
				},
			},
			{
				id: "comparison",
				type: "beforeAfter",
				title: "Comparison",
				data: {
					before: "Repeated work",
					after: "Reuse accepted results",
					note: "Inputs remain unchanged",
				},
			},
			{
				id: "measurements",
				type: "chart",
				title: "Measurements",
				data: {
					kind: "line",
					unit: "ms",
					series: [
						{ label: "First", value: 80 },
						{ label: "Second", value: 12 },
					],
				},
			},
			{
				id: "screens",
				type: "screenshots",
				title: "Screens",
				data: {
					items: [
						{
							index: 3,
							sha256: sha,
							alt: "Result at mobile width",
							caption: "390px / dark",
						},
					],
				},
			},
			{
				id: "recording",
				type: "video",
				title: "Recording",
				data: {
					taskId: "playback",
					sha256: sha,
					label: "Decision recording",
					transcript: "Choose an action, then save.",
				},
			},
			{
				id: "values",
				type: "table",
				title: "Values",
				data: {
					columns: ["Case", "Count"],
					rows: [
						["Reused", 2],
						["Pending", 0],
					],
				},
			},
			{
				id: "source",
				type: "code",
				title: "Source",
				data: {
					file: "src/cache.ts",
					excerpt: "return cached ?? compute();",
					startLine: 8,
					endLine: 12,
					language: "typescript",
				},
			},
			{
				id: "progress",
				type: "steps",
				title: "Progress",
				data: {
					items: [
						{
							label: "Research",
							status: "completed",
							detail: "Findings retained",
						},
						{ label: "Decide", status: "running" },
					],
				},
			},
			{
				id: "notes",
				type: "points",
				title: "Notes",
				data: {
					items: [
						{
							label: "Policy",
							detail: "Review approved scope",
							url: "https://example.invalid/policy",
						},
					],
				},
			},
			{
				id: "cards",
				type: "itemCards",
				title: "Cards",
				data: {
					items: [
						{
							id: "a",
							title: "Cache finding",
							body: "Reuse a validated entry.",
							details: [{ label: "Area", value: "Read path" }],
						},
					],
				},
			},
			{
				id: "form",
				type: "choices",
				title: "Form",
				data: {
					fields: [
						{
							id: "name",
							label: "Owner",
							type: "text",
							required: true,
							value: "Team",
						},
						{ id: "note", label: "Note", type: "textarea" },
						{
							id: "priority",
							label: "Priority",
							type: "select",
							options: [{ id: "high", label: "High" }],
						},
						{
							id: "confirm",
							label: "Understood",
							type: "checkbox",
							required: true,
						},
					],
				},
			},
			{
				id: "children",
				type: "runList",
				title: "Child runs",
				data: {
					waves: [
						{
							id: "one",
							label: "First wave",
							runs: [
								{
									id: "child-a",
									title: "Implement cache",
									status: "running",
									note: "Source work is active",
								},
								{ id: "child-b", title: "Review labels", status: "completed" },
							],
						},
						{
							id: "two",
							runs: [
								{
									id: "child-c",
									title: "Integrate",
									status: "queued",
									note: "Waiting for first wave",
								},
							],
						},
					],
				},
			},
			{
				id: "decision",
				type: "decisionBar",
				title: "Summary actions",
				data: {
					summary: "Choose what to do with each item",
					actions: [{ id: "approve", label: "Agent-proposed action" }],
				},
			},
		],
	});

function _decision(overrides: Partial<ViewSnapshot> = {}): ViewSnapshot {
	return {
		id: "a56acc48-c461-4e1c-b94b-ae68e242b034",
		stepKey: "custom/choose",
		kind: "decide",
		title: "Choose next work",
		digest: "sha256-displayed-content-digest",
		createdAt: "2026-10-22T09:00:00Z",
		view: resolveView(
			{
				version: "view-v1",
				components: [
					{
						id: "intro",
						type: "markdown",
						data: { literal: { text: "Read the findings before choosing." } },
					},
				],
			},
			{},
		),
		items: [
			{
				id: "cache",
				title: "Cache entry",
				body: "Reuse validated work.",
				details: [{ label: "Impact", value: "Faster repeated work" }],
			},
		],
		actions: [
			{ id: "fix", label: "Fix", comment: true, followUp: true },
			{ id: "skip", label: "Skip" },
		],
		askAvailable: true,
		...overrides,
	};
}

describe("declarative view presentation", () => {
	it("renders every component and gives every component a useful text fallback", () => {
		const view = everything();
		const html = renderToStaticMarkup(
			createElement(DeclarativeView, {
				view,
				runId: "current-run",
				fields: {},
				onFieldChange: vi.fn(),
			}),
		);
		const fallback = viewText(view);
		for (const component of view.components) {
			expect(html).toContain(`dv-${component.type}`);
			expect(fallback).toContain(component.title);
		}
		for (const text of [
			"Tests pass",
			"Repeated work",
			"Reuse accepted results",
			"First",
			"80",
			"Result at mobile width",
			"Decision recording",
			"Choose an action",
			"Reused",
			"src/cache",
			"Research",
			"Policy",
			"Cache finding",
			"Owner",
			"First wave",
			"Implement cache",
			"running",
			"queued",
			"Choose what to do",
		]) {
			expect(html).toContain(text);
			expect(fallback).toContain(text);
		}
		expect(html).toContain('scope="col"');
		expect(html).not.toContain('aria-label="Item questions"');
	});

	it("keeps remote media absent, renders local protected media, and makes declarative actions inert", () => {
		const html = renderToStaticMarkup(
			createElement(DeclarativeView, { view: everything(), runId: "run/1" }),
		);
		expect(html).toContain(`/api/runs/run%2F1/view-screenshots/3?v=${sha}`);
		expect(html).toContain(`/api/runs/run%2F1/videos/playback/media?v=${sha}`);
		expect(html).toContain('preload="none"');
		expect(html).toContain('href="/#/runs/child-a"');
		expect(html).not.toContain("<button");
		expect(html).toContain("Agent-proposed action");
		const preview = renderToStaticMarkup(
			createElement(DeclarativeView, { view: everything() }),
		);
		expect(preview).not.toContain("/api/runs/");
		expect(preview).toContain("Screenshot: Result at mobile width");
		expect(preview).toContain("Video available in the run");
	});

	it("gives forms native labelled controls and preserves supplied values", () => {
		const html = renderToStaticMarkup(
			createElement(DeclarativeView, {
				view: everything(),
				fields: {
					name: "Jan",
					note: "Reviewed",
					priority: "high",
					confirm: true,
				},
				onFieldChange: vi.fn(),
			}),
		);
		expect(html).toContain('value="Jan"');
		expect(html).toContain(">Reviewed</textarea>");
		expect(html).toContain('selected=""');
		expect(html).toContain('checked=""');
		expect(html).toContain("Owner (required)");
		expect(html).toMatch(/<label[^>]+for="[^"]+"/);
		expect(html).toContain('name="confirm"');
	});

	it("renders malicious Markdown, HTML-like code, titles and strings without execution", () => {
		const html = renderToStaticMarkup(
			createElement(ViewMarkdown, {
				text: '<script>alert("owned")</script>\n\n<img src="https://remote.invalid/pixel" onerror="alert(1)">\n\n[Run](javascript:alert%281%29) ![External image](https://remote.invalid/pixel)\n\n```html\n<script>inert code</script>\n```',
			}),
		);
		expect(html).not.toMatch(
			/<script|<img|onerror=|href="javascript:|src="https:/i,
		);
		expect(html).toContain("&lt;script&gt;inert code&lt;/script&gt;");
		expect(html).toContain("Image: External image");
		const view = everything();
		view.components[0]!.title = '<script>alert("title")</script>';
		const full = renderToStaticMarkup(createElement(DeclarativeView, { view }));
		expect(full).toContain(
			"&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;",
		);
		expect(full).not.toContain("<script");
		expect(viewText(view)).not.toContain("<script");
	});

	it.each([
		"javascript:alert(1)",
		"data:text/html,<script>x</script>",
		"//example.invalid",
		"https://user:secret@example.invalid",
		"https://example.invalid/\nattack",
		"/api/run-delete",
	])("rejects unsafe link %s", (url) => {
		expect(viewLink(url)).toBeUndefined();
	});

	it("fails clearly on invalid API views and never executes accessors or toJSON", () => {
		const components = vi.fn(() => []);
		const toJSON = vi.fn(() => everything());
		const payload = Object.defineProperty(
			{ version: "view-v1", toJSON },
			"components",
			{ get: components },
		);
		const html = renderToStaticMarkup(
			createElement(DeclarativeView, {
				view: payload as unknown as ResolvedView,
			}),
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("cannot be displayed");
		expect(components).not.toHaveBeenCalled();
		expect(toJSON).not.toHaveBeenCalled();
		const invalid = {
			version: "view-v1",
			components: [
				{ id: "x", type: "html", data: { html: "<script>x</script>" } },
			],
		};
		expect(
			renderToStaticMarkup(
				createElement(DeclarativeView, {
					view: invalid as unknown as ResolvedView,
				}),
			),
		).toContain('role="alert"');
	});
});
