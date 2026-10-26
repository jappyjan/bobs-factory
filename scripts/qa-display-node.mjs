// F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun scripts/qa-display-node.mjs
// Isolated deterministic Factory runtime + real authenticated HTTP/dashboard, no model calls.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultWorkflows } from "../packages/edge-worker/src/factory/defaultWorkflows.ts";
import {
	TicketTracking,
	taskbotAdapter,
	taskbotSource,
} from "../packages/edge-worker/src/factory/TicketTracking.ts";
import { validateWorkflows } from "../packages/edge-worker/src/factory/Workflow.ts";
import { WorkflowRuntime } from "../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { FactoryServer } from "../packages/edge-worker/test/fixtures/authenticated-factory.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const evidence = resolve("apps/f1/test-drives/assets/2026-10-26-display-node");
mkdirSync(evidence, { recursive: true });
const home = mkdtempSync(join(tmpdir(), "f1-display-"));
const port = Number(process.env.F1_DISPLAY_PORT ?? 3672);
const origin = `http://localhost:${port}`;
const c = (id, type, data) => ({ id, type, data: { literal: data } });
const doc = {
	version: "view-v1",
	components: [
		c("intro", "markdown", {
			text: "## A document, arranged for this task\nChoose the next step and leave any context. Components can be arranged freely.\n<script>globalThis.displayPwned=1</script>",
		}),
		c("facts", "section", {
			components: [
				c("points", "points", {
					items: [
						{
							label: "One generic screen",
							detail: "Recipes own the meaning; components own presentation.",
						},
						{
							label: "Explicit answers",
							detail: "Defaults stay editable until you submit.",
						},
					],
				}),
				c("change", "beforeAfter", {
					before: "Separate fixed screens",
					after: "A freely arranged document",
				}),
			],
		}),
		c("items", "itemCards", {
			items: [
				{
					id: "cache",
					title: "Reuse accepted cache entries",
					body: "Keep validated results when the inputs match.",
					value: { id: "cache", priority: 1 },
				},
				{
					id: "labels",
					title: "Clarify progress labels",
					body: "Make active and waiting steps easier to distinguish.",
				},
			],
			actions: [
				{ id: "change", label: "Change", comment: true, followUp: true },
				{ id: "keep", label: "Keep" },
			],
			comment: true,
			ask: { prompt: "Answer about this displayed item only." },
		}),
		c("form", "form", {
			fields: [
				{ id: "name", label: "Your name", type: "text", required: true },
				{
					id: "mode",
					label: "Approach",
					type: "choice",
					custom: true,
					value: "native",
					options: [
						{
							id: "native",
							label: "Use native components",
							reason: "Smallest useful change",
						},
						{ id: "custom", label: "Build a custom extension" },
					],
					recommendation: {
						answer: "native",
						reason: "Start with the existing tools.",
					},
				},
			],
		}),
		c("tour", "codeTour", {
			comment: true,
			files: [
				{
					id: "example",
					path: "src/example.ts",
					hunks: [
						"@@ -1,2 +1,2 @@\n-export const mode = 'fixed';\n+export const mode = 'document';\n export const enabled = true;",
					],
					notes: [
						{
							id: "mode-note",
							line: 1,
							text: "The document supplies the arrangement; the renderer stays generic.",
						},
					],
				},
			],
		}),
		c("action", "actions", {
			summary: "Your answers are bound to this exact document.",
			actions: [
				{ id: "continue", label: "Continue" },
				{ id: "revise", label: "Revise" },
			],
		}),
	],
};
const ticket = { id: 1, status: "backlog", comments: [], attachments: [] };
const reference = {
	...taskbotSource("https://taskbot.example/p/display/t/1"),
	server: "taskbot",
};
const taskbotCall = async (tool, args) => {
	if (tool === "comment") ticket.comments.push({ body: args.body });
	if (tool === "set_status") ticket.status = args.to;
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(tool === "get_ticket" ? ticket : { ok: true }),
			},
		],
	};
};
const adapter = taskbotAdapter(
	reference,
	taskbotCall,
	async (tool, args, dispatch) =>
		(await dispatch.run(() => taskbotCall(tool, args))).value,
);
let runtime;
const tracking = new TicketTracking(
	async () => adapter,
	(run) => runtime.save(run),
	(run, message) => runtime.log(run, "ticket-sync", message),
	undefined,
	(run, version) => runtime.humanViews.validatePublication(run, version),
	(run, version, write) =>
		runtime.humanViews.dispatchPublication(run, version, write),
);
const agentCalls = [];
const hooks = {
	agent: async (ctx) => {
		agentCalls.push(ctx.step.id);
		return ctx.contextAssistance
			? "The cached result is reusable when its accepted inputs match."
			: doc;
	},
	tool: async () => {
		throw new Error("Unexpected tool call");
	},
	script: async () => ({}),
	track: (run, milestone) => tracking.record(run, milestone),
};
runtime = new WorkflowRuntime(home, hooks);
const definitions = validateWorkflows([
	...defaultWorkflows,
	{
		id: "optional-display-drive",
		name: "Optional reactions",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "screen",
				name: "Optional reactions",
				type: "display",
				document: {
					version: "view-v1",
					components: [
						c("form", "form", {
							fields: [
								{
									id: "name",
									label: "Your name",
									type: "text",
									required: true,
								},
							],
						}),
						c("cards", "itemCards", {
							items: [
								{ id: "a", title: "First", value: { key: 42 } },
								{ id: "b", title: "Unanswered" },
							],
							actions: [
								{ id: "fix", label: "Fix" },
								{ id: "skip", label: "Skip" },
							],
							required: false,
							comment: true,
						}),
						c("comments", "itemCards", {
							items: [{ id: "c", title: "Comment only" }],
							comment: true,
						}),
					],
				},
			},
		],
	},
	{
		id: "display-drive",
		name: "Display component library",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "author",
				type: "agent",
				name: "Author a document",
				prompt: "Produce a display document",
				output: { format: "display" },
			},
			{
				id: "screen",
				type: "display",
				name: "Choose what happens next",
				reads: { author: "author" },
				from: "/inputs/author",
			},
		],
	},
]);
runtime.updateWorkflows(definitions);
const run = runtime.create({
	id: "display-drive",
	title: "Generic Display node",
	repositoryId: "fixture",
	workspace: home,
	input: "Deterministic fixture",
	workflow: definitions.at(-1),
	workflowDefinitions: definitions,
	triggerOrigin: {
		type: "manual",
		workflowId: "display-drive",
		at: new Date().toISOString(),
	},
});
run.ticketReference = reference;
let server, browser;
const receipt = {
	mode: "mock",
	screenshots: [],
	screenshotsRefreshed: process.env.F1_DISPLAY_REFRESH_SCREENSHOTS === "1",
	checks: [],
	consoleErrors: [],
};
const until = async (predicate) => {
	const limit = Date.now() + 30000;
	while (Date.now() < limit) {
		if (predicate()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(
		`Timeout: ${runtime.get(run.id).status}: ${runtime.get(run.id).error}`,
	);
};
const makeServer = () =>
	new FactoryServer(
		runtime,
		{
			repositories: () => [
				{ id: "fixture", name: "Display fixture", repositoryPath: home },
			],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("Fixture launch only");
			},
			stop: (id) => runtime.stop(id),
		},
		origin,
	);
try {
	void runtime.launch(run);
	await until(() => run.status === "waiting");
	assert.equal(agentCalls.length, 1);
	await until(() =>
		ticket.comments.some((c) => c.body.includes("/view-answer")),
	);
	console.log("Ticket protocol published");
	const snapshot = JSON.parse(JSON.stringify(run.viewDecision));
	await runtime.shutdown();
	runtime = new WorkflowRuntime(home, hooks);
	runtime.resumeAll();
	await until(
		() =>
			runtime.isExecuting(run.id) && runtime.get(run.id).status === "waiting",
	);
	assert.deepEqual(runtime.get(run.id).viewDecision, snapshot);
	receipt.checks.push(
		"Cold restart preserves exact waiting document and digests; author called once",
	);
	console.log("Waiting document restored");
	server = makeServer();
	await server.start(port);
	const { chromium } = await import(
		process.env.F1_PLAYWRIGHT_MODULE ?? "playwright"
	);
	browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();
	await context.addCookies([
		{
			name: "factory-local-session",
			value: "route-fixture-session",
			url: origin,
		},
	]);
	const page = await context.newPage();
	page.on("pageerror", (error) => receipt.consoleErrors.push(error.message));
	await page.goto(`${origin}/#/runs/${run.id}`);
	await page.getByRole("form", { name: "Choose what happens next" }).waitFor();
	assert.equal(await page.evaluate(() => globalThis.displayPwned), undefined);
	assert.equal(await page.locator(".display-document script").count(), 0);
	for (const width of [1280, 390])
		for (const theme of ["light", "dark"]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.evaluate((theme) => {
				localStorage.setItem("factory-theme", theme);
				document.documentElement.dataset.theme = theme;
				document.documentElement.style.colorScheme = theme;
			}, theme);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.waitForTimeout(150);
			const dimensions = await page.evaluate(() => ({
				width: innerWidth,
				scrollWidth: document.documentElement.scrollWidth,
			}));
			assert(
				dimensions.scrollWidth <= dimensions.width,
				JSON.stringify(dimensions),
			);
			const name = `display-${width}-${theme}.png`;
			if (process.env.F1_DISPLAY_REFRESH_SCREENSHOTS === "1")
				await page.screenshot({ path: join(evidence, name), fullPage: true });
			receipt.screenshots.push({ name, ...dimensions });
		}
	await page.setViewportSize({ width: 360, height: 900 });
	const noteBox = await page.locator(".display-code-note").boundingBox();
	assert(
		noteBox && noteBox.x >= 0 && noteBox.x + noteBox.width <= 360,
		JSON.stringify(noteBox),
	);
	await page.mouse.wheel(0, 1);
	await page.evaluate(() => window.scrollTo(0, 500));
	await page.waitForTimeout(100);
	await page.reload();
	await page.getByRole("form", { name: "Choose what happens next" }).waitFor();
	await page.waitForTimeout(250);
	assert(
		Math.abs((await page.evaluate(() => scrollY)) - 500) < 50,
		"Reading position restores after reload",
	);
	receipt.checks.push(
		"Code-tour notes fit at 360px; reading position restores after reload",
	);
	assert(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	);
	receipt.checks.push(
		"Desktop and 390px light/dark layouts; no horizontal overflow at 360px",
	);
	const name = page.getByRole("textbox", { name: "Your name" });
	await name.fill("Ada");
	const submissions = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/view-answer"))
			submissions.push(request.postDataJSON());
	});
	const firstComment = page
		.locator(".dv-item-card")
		.first()
		.getByRole("textbox", { name: "Comment", exact: true });
	await firstComment.fill("Keep the cache key stable");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	assert.equal(submissions.length, 0);
	assert.equal(runtime.get(run.id).status, "waiting");
	assert.equal(
		await page.locator('.dv-item-card input[type="radio"]:checked').count(),
		0,
	);
	receipt.checks.push(
		"Typing a comment selects no item action and cannot satisfy required item choices",
	);
	await page.getByRole("radio", { name: "Custom answer", exact: true }).check();
	assert.equal(
		await page.getByRole("textbox", { name: "Your answer" }).inputValue(),
		"",
	);
	await page
		.getByRole("group", { name: "Action for Reuse accepted cache entries" })
		.getByRole("radio", { name: "Change", exact: true })
		.check();
	await page
		.getByRole("group", { name: "Action for Clarify progress labels" })
		.getByRole("radio", { name: "Keep", exact: true })
		.check();
	await page
		.locator(".dv-item-card")
		.first()
		.getByRole("textbox", { name: "Comment", exact: true })
		.fill("Keep the cache key stable");
	await page
		.locator(".display-code-note")
		.getByRole("textbox", { name: "Comment", exact: true })
		.fill("Clear separation");
	// All required values are now valid: Enter in the single-line input must do nothing.
	await name.focus();
	await page.keyboard.press("Enter");
	await page.waitForTimeout(250);
	assert.equal(submissions.length, 0);
	assert.equal(runtime.get(run.id).status, "waiting");
	receipt.checks.push(
		"Enter in a valid single-line text field sends no answer and leaves the display waiting",
	);
	// Verify a real keyboard action submits once through the dashboard/API.
	await page.getByRole("button", { name: "Continue", exact: true }).focus();
	await page.keyboard.press("Enter");
	await until(() => runtime.get(run.id).status === "completed");
	assert.equal(submissions.length, 1);
	const output = runtime.get(run.id).outputs.screen;
	assert.equal(output.values.name, "Ada");
	assert.equal(output.values.mode, "");
	assert.equal(output.action, "continue");
	assert.equal(output.itemsByAction.change[0].priority, 1);
	assert.equal(output.comments["mode-note"], "Clear separation");
	receipt.output = output;
	receipt.checks.push(
		"Keyboard submission, form/custom blank answer, per-item actions, original values, comments and code-note comments round-trip through real HTTP",
	);
	// The retained ticket protocol uses the same explicit reply path; identical retry is idempotent.
	const retained = runtime.get(run.id).viewRecords.at(-1).answer.request;
	await runtime.replyView(run.id, `/view-answer ${JSON.stringify(retained)}`);
	receipt.checks.push(
		"Ticket/terminal reply protocol accepts an identical retry without changing accepted answers",
	);
	const optionalWorkflow = definitions.find(
		(d) => d.id === "optional-display-drive",
	);
	const optionalRun = runtime.create({
		title: "Optional reactions",
		repositoryId: "fixture",
		workspace: home,
		input: "",
		workflow: optionalWorkflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: optionalWorkflow.id,
			at: new Date().toISOString(),
		},
	});
	void runtime.launch(optionalRun);
	await until(() => optionalRun.status === "waiting");
	await page.goto(`${origin}/#/runs/${optionalRun.id}`);
	const optionalForm = page.getByRole("form", { name: "Optional reactions" });
	await optionalForm.waitFor();
	const optionalName = optionalForm.getByRole("textbox", { name: "Your name" });
	await optionalName.fill("Ada");
	await optionalName.press("Enter");
	await page.waitForTimeout(250);
	assert.equal(submissions.length, 1);
	assert.equal(optionalRun.status, "waiting");
	const optionalComment = optionalForm
		.locator(".dv-item-card")
		.first()
		.getByRole("textbox", { name: "Comment", exact: true });
	await optionalComment.fill("Please fix");
	await optionalForm
		.getByRole("button", { name: "Submit", exact: true })
		.click();
	await optionalForm
		.getByRole("alert")
		.filter({ hasText: "Choose an item action" })
		.waitFor();
	assert.equal(submissions.length, 1);
	await optionalForm
		.getByRole("group", { name: "Action for First" })
		.getByRole("radio", { name: "Fix", exact: true })
		.check();
	await optionalForm
		.locator(".dv-item-card")
		.last()
		.getByRole("textbox", { name: "Comment", exact: true })
		.fill("Context only");
	await optionalForm
		.getByRole("button", { name: "Submit", exact: true })
		.click();
	await until(() => optionalRun.status === "completed");
	assert.equal(submissions.length, 2);
	assert.deepEqual(
		JSON.parse(JSON.stringify(optionalRun.outputs.screen.itemsByAction)),
		{
			fix: [{ key: 42 }],
			skip: [],
		},
	);
	assert.equal(optionalRun.outputs.screen.items.b, undefined);
	assert.deepEqual(
		JSON.parse(JSON.stringify(optionalRun.outputs.screen.comments)),
		{
			a: "Please fix",
			c: "Context only",
		},
	);
	assert.equal(optionalRun.outputs.screen.action, null);
	receipt.checks.push(
		"Plain Submit remains explicit: Enter sends nothing; optional reactions omit unanswered items, comments need declared actions, and comment-only cards submit normally",
	);
	receipt.optionalOutput = optionalRun.outputs.screen;
	assert.equal(receipt.consoleErrors.length, 0);
	receipt.ticketComments = ticket.comments.length;
	receipt.agentCalls = agentCalls;
	receipt.result = "passed";
	writeFileSync(
		join(evidence, process.env.F1_DISPLAY_RECEIPT ?? "receipt.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
	);
	console.log(JSON.stringify(receipt, null, 2));
} finally {
	await browser?.close();
	await server?.stop();
	await runtime.shutdown();
	tracking.stop();
	rmSync(home, { recursive: true, force: true });
}
