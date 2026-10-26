import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digest } from "../src/factory/Delivery.js";
import {
	DisplayDocumentSchema,
	displayComponents,
	ResolvedDisplayDocumentSchema,
	resolveDisplayDocument,
} from "../src/factory/DisplayDocument.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseOutputFormat } from "../src/factory/OutputFormats.js";
import { viewText } from "../src/factory/View.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { DisplayDocumentView } from "../src/factory/web/display.js";
import { NodeStepSettings } from "../src/factory/web/node-step-settings.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const resources: {
	home: string;
	runtime: WorkflowRuntime;
	server?: FactoryServer;
}[] = [];
afterEach(async () => {
	const owned = resources.splice(0);
	for (const r of owned) {
		await r.runtime.shutdown();
		await r.server?.stop();
	}
	for (const home of new Set(owned.map((r) => r.home)))
		rmSync(home, { recursive: true, force: true });
});
const component = (id: string, type: string, data: unknown) => ({
	id,
	type,
	data: { literal: data },
});
const document = (...components: unknown[]) => ({
	version: "view-v1",
	components,
});
const display = (doc: unknown, extra: object = {}) => ({
	id: "screen",
	type: "display",
	name: "Choose next",
	document: doc,
	...extra,
});
const formDocument = () =>
	document(
		component("form", "form", {
			fields: [
				{ id: "name", type: "text", label: "Name", required: true },
				{
					id: "mode",
					type: "choice",
					label: "Mode",
					value: "native",
					custom: true,
					options: [{ id: "native", label: "Native" }],
					recommendation: { answer: "native", reason: "Smallest change" },
				},
			],
		}),
	);
function makeRuntime(home: string, overrides: Partial<RuntimeHooks> = {}) {
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("Unexpected agent call");
		},
		script: async () => ({}),
		tool: async () => ({}),
		...overrides,
	});
	resources.push({ home, runtime });
	return runtime;
}
function fixture(steps: unknown[], overrides: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "display-node-"));
	const runtime = makeRuntime(home, overrides);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "display-fixture",
			name: "Display fixture",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]);
	runtime.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = runtime.create({
		title: "Display fixture",
		repositoryId: "fixture",
		workspace: home,
		input: "",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	return { home, runtime, run };
}
async function waiting(runtime: WorkflowRuntime, run: FactoryRun) {
	await Promise.race([
		runtime.launch(run).then(() => {
			throw new Error(
				`Display did not wait: ${run.status}: ${run.error ?? ""}`,
			);
		}),
		waitForRuntime(() => {
			expect(run.status, run.error).toBe("waiting");
			expect(run.viewDecision).toBeDefined();
		}),
	]);
	return structuredClone(run.viewDecision!);
}
const request = (run: FactoryRun, extra: object = {}) => ({
	batchId: run.viewDecision!.id,
	digest: run.viewDecision!.digest,
	documentDigest: run.viewDecision!.documentDigest,
	accepted: true,
	...extra,
});
const done = (run: FactoryRun) =>
	waitForRuntime(() => expect(run.status, run.error).toBe("completed"));

describe("display node", () => {
	it("stamps the actual declared reads of an inline document", async () => {
		const { runtime, run } = fixture(
			[
				{
					id: "author",
					type: "agent",
					name: "Author",
					prompt: "Produce content",
				},
				display({
					version: "view-v1",
					reads: { message: "author" },
					components: [
						{ id: "text", type: "markdown", data: { path: "/inputs/message" } },
					],
				}),
			],
			{ agent: async () => ({ text: "Bound content" }) },
		);
		await runtime.launch(run);
		await done(run);
		expect(
			run.history.find((record) => record.step === "screen")?.inputDigest,
		).toBe(digest({ message: { text: "Bound content" } }));
	});

	it("registers one display node, accepts bind, and returns immediately for content", async () => {
		const { runtime, run } = fixture([
			{ id: "upstream", name: "Upstream", type: "script", script: "fixture" },
			display(
				document(component("text", "markdown", { text: "A retained update" })),
				{ bind: ["upstream"] },
			),
		]);
		await runtime.launch(run);
		await done(run);
		expect(run.viewDisplays).toHaveLength(1);
		expect(run.outputs.screen).toEqual({
			action: null,
			values: {},
			items: {},
			itemsByAction: {},
			followUps: [],
			comments: {},
			documentDigest: run.viewDisplays![0]!.documentDigest,
			bound: ["upstream"],
		});
		expect(run.viewDecision).toBeUndefined();
		expect(
			StepSchema.safeParse({ ...display(formDocument()), from: "/inputs/doc" })
				.success,
		).toBe(false);
	});
	it("waits with defaults, rejects stale digests, and keeps explicitly blank custom answers", async () => {
		const { runtime, run } = fixture([display(formDocument())]);
		await waiting(runtime, run);
		expect(run.outputs.screen).toBeUndefined();
		expect(run.capacityLeaves?.screen?.phase).toBe("waiting-human");
		await expect(
			runtime.answerView(
				run.id,
				request(run, {
					documentDigest: "0".repeat(64),
					values: { name: "Ada" },
				}),
			),
		).rejects.toThrow(/document changed/);
		await expect(
			runtime.answerView(
				run.id,
				request(run, { digest: "0".repeat(64), values: { name: "Ada" } }),
			),
		).rejects.toThrow(/changed/);
		await expect(
			runtime.answerView(run.id, request(run, { values: { name: "" } })),
		).rejects.toThrow(/Complete Name/);
		await runtime.replyView(
			run.id,
			`/view-answer ${JSON.stringify(request(run, { values: { name: "Ada", mode: "" } }))}`,
		);
		await done(run);
		expect(run.outputs.screen).toMatchObject({
			values: { name: "Ada", mode: "" },
		});
	});
	it("routes per-item actions from original values and returns comments and follow-ups", async () => {
		const doc = document(
			component("cards", "itemCards", {
				items: [
					{ id: "a", title: "First", value: { key: 42 } },
					{ id: "b", title: "Second", value: null },
				],
				comment: true,
				actions: [
					{ id: "change", label: "Change", comment: true, followUp: true },
					{ id: "keep", label: "Keep" },
				],
			}),
			component("actions", "actions", {
				actions: [{ id: "continue", label: "Continue" }],
			}),
		);
		const { runtime, run } = fixture(
			[
				display(doc, {
					branches: [
						{
							when: { path: "itemsByAction.change.0.key", equals: 42 },
							next: "changed",
						},
					],
					next: "wrong",
				}),
				{
					id: "wrong",
					type: "script",
					name: "Wrong",
					script: "wrong",
					next: "finish",
				},
				{
					id: "changed",
					type: "script",
					name: "Changed",
					script: "changed",
					next: "finish",
				},
				{ id: "finish", type: "script", name: "End", script: "end" },
			],
			{ script: async (ctx) => ({ step: ctx.step.id }) },
		);
		await waiting(runtime, run);
		await expect(
			runtime.answerView(run.id, request(run, { action: "continue" })),
		).rejects.toThrow(/Choose an action/);
		for (const action of ["comment", "undeclared"]) {
			await expect(
				runtime.answerView(
					run.id,
					request(run, {
						action: "continue",
						choices: [
							{ itemId: "a", action: "change" },
							{ itemId: "b", action, comment: "A comment is not a decision" },
						],
					}),
				),
			).rejects.toThrow(/Unknown item action/);
			expect(run.status).toBe("waiting");
			expect(run.outputs.screen).toBeUndefined();
		}
		await runtime.answerView(
			run.id,
			request(run, {
				action: "continue",
				choices: [
					{ itemId: "a", action: "change", comment: "Please change this" },
					{ itemId: "b", action: "keep" },
				],
			}),
		);
		await done(run);
		expect(run.outputs.screen).toMatchObject({
			action: "continue",
			items: { a: { action: "change", comment: "Please change this" } },
			itemsByAction: { change: [{ key: 42 }], keep: [null] },
			comments: { a: "Please change this" },
			followUps: [{ itemId: "a", action: "change" }],
		});
		expect(run.outputs.changed).toEqual({ step: "changed" });
		expect(run.outputs.wrong).toBeUndefined();
	});
	it.each([
		false,
		true,
	])("allows optional item reactions with answered=%s", async (answered) => {
		const { runtime, run } = fixture([
			display(
				document(
					component("cards", "itemCards", {
						items: [
							{ id: "a", title: "First", value: { key: 42 } },
							{ id: "b", title: "Second" },
						],
						actions: [
							{ id: "fix", label: "Fix" },
							{ id: "skip", label: "Skip" },
						],
						comment: true,
						required: false,
					}),
				),
			),
		]);
		await waiting(runtime, run);
		await expect(
			runtime.answerView(
				run.id,
				request(run, {
					choices: [
						{
							itemId: "b",
							action: "comment",
							comment: "Still not a declared action",
						},
					],
				}),
			),
		).rejects.toThrow(/Unknown item action/);
		await runtime.answerView(
			run.id,
			request(run, {
				choices: answered
					? [{ itemId: "a", action: "fix", comment: "Please fix" }]
					: [],
			}),
		);
		await done(run);
		expect(run.outputs.screen).toMatchObject({
			items: answered ? { a: { action: "fix", comment: "Please fix" } } : {},
			itemsByAction: { fix: answered ? [{ key: 42 }] : [], skip: [] },
			comments: answered ? { a: "Please fix" } : {},
		});
		expect((run.outputs.screen as { items: object }).items).not.toHaveProperty(
			"b",
		);
	});
	it("accepts the comment pseudo-action only on comment-only cards", async () => {
		const { runtime, run } = fixture([
			display(
				document(
					component("cards", "itemCards", {
						items: [{ id: "a", title: "First" }],
						comment: true,
					}),
				),
			),
		]);
		await waiting(runtime, run);
		await runtime.answerView(
			run.id,
			request(run, {
				choices: [{ itemId: "a", action: "comment", comment: "Context only" }],
			}),
		);
		await done(run);
		expect(run.outputs.screen).toMatchObject({
			items: { a: { action: "comment", comment: "Context only" } },
			comments: { a: "Context only" },
			itemsByAction: {},
		});
	});
	it("retains over 100 foreach content displays without consuming decision snapshots", async () => {
		const { runtime, run } = fixture([
			{
				id: "each",
				name: "For each",
				type: "foreach",
				items: {
					values: Array.from({ length: 101 }, (_, i) => ({
						id: String(i),
						text: String(i),
					})),
				},
				maxItems: 101,
				body: [
					display(
						document({
							id: "text",
							type: "markdown",
							data: { bindings: { text: { path: "/inputs/message/text" } } },
						}),
						{
							reads: { message: "@item" },
						},
					),
				],
			},
			display(formDocument()),
		]);
		// The regression is the in-memory snapshot limit, not disk throughput.
		// Restart tests below exercise real persistence; avoid hundreds of fsyncs here.
		vi.spyOn(runtime, "save").mockResolvedValue(undefined);
		await waiting(runtime, run);
		expect(run.viewDisplays).toHaveLength(101);
		expect(run.viewDisplays!.every((s) => s.interactive === false)).toBe(true);
		expect(run.viewRecords).toHaveLength(102);
		await runtime.answerView(
			run.id,
			request(run, { values: { name: "Finished" } }),
		);
		await done(run);
		expect(run.viewDisplays!.at(-1)!.view.components[0]).toMatchObject({
			data: { text: "100" },
		});
	}, 60000);
	it("uses recorded interactivity on restart even when the source no longer resolves", async () => {
		const { home, runtime, run } = fixture(
			[
				{
					id: "author",
					type: "agent",
					name: "Author",
					prompt: "Produce a display",
				},
				{
					id: "screen",
					type: "display",
					name: "Choose next",
					reads: { doc: "author" },
					from: "/inputs/doc",
				},
			],
			{ agent: async () => formDocument() },
		);
		const snapshot = await waiting(runtime, run);
		run.outputs.author = { invalid: true };
		await runtime.save(run);
		await runtime.shutdown();
		const restoredRuntime = makeRuntime(home);
		restoredRuntime.resumeAll();
		const restored = restoredRuntime.get(run.id);
		await waitForRuntime(() => {
			expect(restoredRuntime.isExecuting(run.id)).toBe(true);
			expect(restored.status, restored.error).toBe("waiting");
			expect(restored.capacityLeaves?.screen?.phase).toBe("waiting-human");
		});
		expect(restored.viewDecision).toEqual(snapshot);
	});
	it("resumes the exact waiting document and answers through the API after a cold restart", async () => {
		const { home, runtime, run } = fixture([display(formDocument())]);
		const original = await waiting(runtime, run);
		await runtime.shutdown();
		const second = makeRuntime(home);
		second.resumeAll();
		const restored = second.get(run.id);
		await waitForRuntime(() => {
			expect(second.isExecuting(run.id)).toBe(true);
			expect(restored.status).toBe("waiting");
		});
		expect(restored.viewDecision).toEqual(original);
		const server = new FactoryServer(second, {
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("No API launch");
			},
			stop: (id) => second.stop(id),
		});
		resources.at(-1)!.server = server;
		const preview = await server.app.inject({
			method: "POST",
			url: "/api/recipes/view-preview",
			headers: { "x-factory-request": "1" },
			payload: {
				workflowId: "display-fixture",
				stepId: "screen",
				type: "display",
				name: "Choose next",
				view: formDocument(),
				lastRun: true,
			},
		});
		expect(preview.statusCode, preview.body).toBe(200);
		expect(preview.json().provenance.definitionMatch).toBe(true);
		expect(preview.json().view).toEqual(original.view);
		const response = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: request(restored, { values: { name: "Restarted" } }),
		});
		expect(response.statusCode, response.body).toBe(200);
		await done(restored);
		expect(restored.outputs.screen).toMatchObject({
			values: { name: "Restarted", mode: "native" },
			documentDigest: original.documentDigest,
		});
	});
	it("validates and renders an agent-produced document through from", async () => {
		const doc = formDocument();
		expect(parseOutputFormat("display", doc)).toEqual(doc);
		const { runtime, run } = fixture(
			[
				{
					id: "author",
					name: "Author",
					type: "agent",
					prompt: "Produce a display",
					output: { format: "display" },
				},
				{
					id: "screen",
					name: "Any name",
					type: "display",
					reads: { doc: "author" },
					from: "/inputs/doc",
				},
			],
			{ agent: async () => doc },
		);
		const snapshot = await waiting(runtime, run);
		const html = renderToStaticMarkup(
			createElement(DisplayDocumentView, {
				snapshot,
				runId: "",
				onSubmit: async () => {},
			}),
		);
		expect(html).toContain("Name");
		expect(html).toContain("Custom answer");
		const replacement = formDocument();
		replacement.components = [
			component("form", "form", {
				fields: [
					{ id: "name", type: "text", label: "Full name", required: true },
				],
			}),
		];
		run.outputs.author = replacement;
		await expect(
			runtime.answerView(
				run.id,
				request(run, { values: { name: "Old document" } }),
			),
		).rejects.toThrow(/content changed/);
		await waitForRuntime(() =>
			expect(run.viewDecision!.id).not.toBe(snapshot.id),
		);
		expect(run.viewDecision!.documentDigest).not.toBe(snapshot.documentDigest);
		await runtime.answerView(
			run.id,
			request(run, { values: { name: "Agent" } }),
		);
		await done(run);
	});
	it("retains item ask threads and refreshes the answer digest without rerunning the source", async () => {
		let calls = 0;
		const { runtime, run } = fixture(
			[
				display(
					document(
						component("cards", "itemCards", {
							items: [{ id: "item", title: "An item" }],
							actions: [{ id: "keep", label: "Keep" }],
							ask: { prompt: "Answer about this item only" },
						}),
					),
				),
			],
			{
				agent: async (ctx) => {
					calls++;
					expect(ctx.contextAssistance).toBe(true);
					return "Context answer";
				},
			},
		);
		const snapshot = await waiting(runtime, run);
		await runtime.askView(run.id, {
			batchId: snapshot.id,
			digest: snapshot.digest,
			itemId: "item",
			question: "Why?",
			requestId: "390ae93f-de7f-46af-8646-2e50f411dc1a",
		});
		await waitForRuntime(() =>
			expect(run.viewDecision!.threads?.item?.[0]?.status).toBe("answered"),
		);
		expect(run.viewDecision!.digest).not.toBe(snapshot.digest);
		expect(run.viewDecision!.documentDigest).toBe(snapshot.documentDigest);
		await runtime.answerView(
			run.id,
			request(run, { choices: [{ itemId: "item", action: "keep" }] }),
		);
		await done(run);
		expect(calls).toBe(1);
	});
});

describe("display document components", () => {
	it("registers the display editor with schema validation, path autocomplete and a live preview", () => {
		const step = StepSchema.parse(display(formDocument()));
		const owner = {
			id: "builder",
			name: "Builder",
			description: "",
			labels: [],
			steps: [step],
			allowedTriggers: ["manual"],
		};
		const html = renderToStaticMarkup(
			createElement(NodeStepSettings, {
				step,
				owner,
				recipes: [owner],
				readOnly: false,
				selection: "screen",
				onSelect: () => {},
				onChange: () => {},
				onError: () => {},
			}),
		);
		expect(html).toContain("Display document JSON");
		expect(html).toContain("Available data paths");
		expect(html).toContain("Live preview");
		expect(html).toContain("<datalist");
		expect(html).toContain("Custom answer");
	});

	it("binds nested sections and rejects presets, domain components and duplicate controls", () => {
		const nested = document(
			component("section", "section", {
				components: [
					{ id: "text", type: "markdown", data: { path: "/inputs/summary" } },
				],
			}),
		);
		expect(
			displayComponents(
				resolveDisplayDocument(nested as never, {
					inputs: { summary: { text: "Bound" } },
				}),
			),
		).toHaveLength(2);
		expect(
			DisplayDocumentSchema.safeParse({ ...nested, preset: "review" }).success,
		).toBe(false);
		expect(
			DisplayDocumentSchema.safeParse(
				document(
					component("legacy", "questions", { questions: ["Question?"] }),
				),
			).success,
		).toBe(false);
		expect(() =>
			resolveDisplayDocument(
				document(
					component("first", "form", {
						fields: [{ id: "same", type: "text", label: "A" }],
					}),
					component("section", "section", {
						components: [
							component("second", "form", {
								fields: [{ id: "same", type: "text", label: "B" }],
							}),
						],
					}),
				) as never,
				{ inputs: {} },
			),
		).toThrow(/unique/);
	});
	it("keeps HTML, script, event handlers and executable URLs inert, including code notes", () => {
		const doc = document(
			component("text", "markdown", {
				text: '<script>globalThis.pwned=1</script><img src=x onerror="alert(1)"> [click](javascript:alert(1))',
			}),
			component("tour", "codeTour", {
				comment: true,
				files: [
					{
						id: "file",
						path: "src/example.ts",
						hunks: ["@@ -1 +1 @@\n-old\n+new"],
						notes: [{ id: "note", line: 1, text: "<script>alert(1)</script>" }],
					},
				],
			}),
		);
		const view = resolveDisplayDocument(doc as never, { inputs: {} });
		const html = renderToStaticMarkup(
			createElement(DisplayDocumentView, {
				runId: "",
				snapshot: {
					id: "inert",
					stepKey: "screen",
					kind: "display",
					title: "Inert",
					digest: "digest",
					view,
					createdAt: "now",
					interactive: true,
				},
				onSubmit: async () => {},
			}),
		);
		expect(html).not.toMatch(/<script|<img|href="javascript:|onerror=/);
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("Line 1");
		expect(viewText(view)).toContain("&lt;script&gt;");
	});
	it.each([
		["markdown", { text: "Markdown text" }, "Markdown text"],
		["points", { items: [{ label: "Point" }] }, "Point"],
		["checklist", { items: [{ label: "Check", state: "done" }] }, "Check"],
		["table", { columns: ["Column"], rows: [["Cell"]] }, "Cell"],
		[
			"chart",
			{ kind: "bar", series: [{ label: "Series", value: 4 }] },
			"Series",
		],
		[
			"beforeAfter",
			{ before: "Before text", after: "After text" },
			"After text",
		],
		["steps", { items: [{ label: "Step" }] }, "Step"],
		["code", { file: "example.ts", excerpt: "const example = 1" }, "example"],
		[
			"screenshots",
			{ items: [{ index: 0, sha256: "a".repeat(64), alt: "Screenshot text" }] },
			"Screenshot text",
		],
		[
			"video",
			{
				taskId: "video",
				sha256: "a".repeat(64),
				label: "Video label",
				transcript: "Transcript",
			},
			"Transcript",
		],
		[
			"itemCards",
			{
				items: [{ id: "item", title: "Item title" }],
				actions: [{ id: "keep", label: "Keep" }],
			},
			"Item title",
		],
		[
			"form",
			{ fields: [{ id: "field", type: "text", label: "Field label" }] },
			"Field label",
		],
		[
			"actions",
			{ actions: [{ id: "continue", label: "Continue" }] },
			"Continue",
		],
		[
			"runList",
			{
				waves: [
					{
						id: "wave",
						runs: [{ id: "run", title: "Run title", status: "running" }],
					},
				],
			},
			"Run title",
		],
		[
			"section",
			{
				components: [component("nested", "markdown", { text: "Nested text" })],
			},
			"Nested text",
		],
		[
			"codeTour",
			{
				files: [
					{
						id: "file",
						path: "example.ts",
						hunks: [],
						notes: [{ id: "note", line: 1, text: "Pinned note" }],
					},
				],
			},
			"Pinned note",
		],
	])("renders %s and retains its text fallback", (type, data, expected) => {
		const view = resolveDisplayDocument(
			document(component("component", String(type), data)) as never,
			{ inputs: {} },
		);
		expect(ResolvedDisplayDocumentSchema.safeParse(view).success).toBe(true);
		expect(viewText(view)).toContain(expected);
		const html = renderToStaticMarkup(
			createElement(DisplayDocumentView, {
				runId: "",
				snapshot: {
					id: "component",
					stepKey: "screen",
					title: "Components",
					kind: "display",
					digest: "digest",
					view,
					interactive: true,
					createdAt: "now",
				},
				onSubmit: async () => {},
			}),
		);
		expect(html).toContain(expected);
	});
});
