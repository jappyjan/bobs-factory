// F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bun scripts/qa-v2-check-in.mjs
// Real runtime, persistence, authenticated dashboard/API; deterministic agents and ticket adapter.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultWorkflows } from "../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { parseStepOutputAsync } from "../packages/edge-worker/src/factory/OutputFormats.ts";
import { stepBindings } from "../packages/edge-worker/src/factory/StepBindings.ts";
import {
	TicketTracking,
	taskbotAdapter,
	taskbotSource,
} from "../packages/edge-worker/src/factory/TicketTracking.ts";
import { WorkflowRuntime } from "../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { FactoryServer } from "../packages/edge-worker/test/fixtures/authenticated-factory.ts";
import {
	plan,
	proposal,
	questionDocument,
	requirements,
} from "../packages/edge-worker/test/fixtures/v2-planning.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const evidence = resolve("apps/f1/test-drives/assets/2026-10-26-v2-check-in");
mkdirSync(evidence, { recursive: true });
const home = mkdtempSync(join(tmpdir(), "f1-v2-check-in-"));
const port = Number(process.env.F1_CHECK_IN_PORT ?? 3674),
	origin = `http://localhost:${port}`;
const ticket = { id: 1, status: "backlog", comments: [], attachments: [] };
const reference = {
	...taskbotSource("https://taskbot.example/p/check-in/t/1"),
	server: "taskbot",
};
const call = async (tool, args) => {
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
	call,
	async (tool, args, dispatch) =>
		(await dispatch.run(() => call(tool, args))).value,
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
const counts = {};
const hooks = {
	agent: async (ctx) => {
		counts[ctx.step.id] = (counts[ctx.step.id] ?? 0) + 1;
		const reads = stepBindings(ctx);
		let output;
		if (ctx.step.id === "clarify") {
			assert.equal(reads.source.prompt, "Confirm new readers");
			output =
				counts.clarify === 1
					? {
							...requirements,
							decisions: [],
							status: "needs-input",
							display: questionDocument,
						}
					: { ...requirements, status: "ready" };
			if (counts.clarify > 1)
				assert.equal(reads.answer.values.owner, "An administrator");
		} else if (ctx.step.id === "plan") output = plan;
		else if (ctx.step.id === "architecture") {
			if (counts.architecture > 1)
				assert.equal(
					reads.feedback.answer.comments.expiry,
					"Five minutes please",
				);
			output = proposal(counts.architecture > 1);
		} else output = { approved: true, feedback: [] };
		return parseStepOutputAsync(
			ctx.step,
			output,
			undefined,
			ctx.signal,
			ctx.fresh,
		);
	},
	script: async () => {
		throw new Error("Unexpected script");
	},
	tool: async () => {
		throw new Error("Unexpected legacy tool");
	},
	track: (run, milestone) => tracking.record(run, milestone),
};
const createRuntime = () => {
	const r = new WorkflowRuntime(home, hooks);
	r.updateWorkflows(defaultWorkflows);
	return r;
};
runtime = createRuntime();
const createRun = (id) => {
	const workflow = defaultWorkflows.find((d) => d.id === id);
	const run = runtime.create({
		title: "Confirm new readers",
		repositoryId: "fixture",
		workspace: home,
		input: "Confirm new readers",
		launchInputs: {
			requirements: JSON.stringify(requirements),
			plan: JSON.stringify(plan),
		},
		workflow,
		workflowDefinitions: defaultWorkflows,
		triggerOrigin: {
			type: "manual",
			workflowId: id,
			at: new Date().toISOString(),
		},
	});
	runtime.updateTitle(
		run.id,
		{ ...run.titleGeneration, state: "completed" },
		"Confirm new readers",
	);
	return run;
};
const until = async (condition) => {
	const limit = Date.now() + 30000;
	while (Date.now() < limit) {
		if (condition()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(
		`Timed out; ticket: ${JSON.stringify(ticket)}; runs: ${JSON.stringify(runtime.listRuns().map((r) => ({ id: r.id, status: r.status, error: r.error, counts, step: runtime.get(r.id).step, wait: runtime.get(r.id).waitReason, limit: runtime.get(r.id).iterationLimit, questions: runtime.get(r.id).questions, view: runtime.get(r.id).viewDecision, sync: runtime.get(r.id).ticketSync })))}`,
	);
};
const answer = (run, extra = {}) => ({
	batchId: run.viewDecision.id,
	digest: run.viewDecision.digest,
	documentDigest: run.viewDecision.documentDigest,
	accepted: true,
	...extra,
});
const receipt = {
	mode: "mock",
	checks: [],
	screenshots: [],
	consoleErrors: [],
};
let server, browser;
try {
	const planning = createRun("v2-clarify-plan");
	console.log("Launching clarify-plan");
	planning.ticketReference = reference;
	void runtime.launch(planning);
	await until(
		() =>
			planning.status === "waiting" &&
			planning.viewDecision &&
			ticket.comments.some((c) => c.body.includes("/view-answer")),
	);

	await runtime.replyView(
		planning.id,
		`/view-answer ${JSON.stringify(answer(planning, { action: "continue", values: { owner: "An administrator" } }))}`,
	);
	await until(() => planning.status === "completed");
	assert.deepEqual(planning.outputs.output, { requirements, plan });
	receipt.checks.push(
		"Bundled clarify-plan publishes the explicit answer protocol to mocked Taskbot; ticket command resumes with accepted answers and emits both ports",
	);
	console.log("Clarification completed");
	const initial = createRun("v2-check-in");
	void runtime.launch(initial);
	await until(() => initial.status === "waiting");
	console.log("Check-in waiting; restart");
	const snapshot = structuredClone(initial.viewDecision);
	await runtime.shutdown();
	runtime = createRuntime();
	runtime.resumeAll();
	const run = runtime.get(initial.id);
	await until(() => runtime.isExecuting(run.id) && run.status === "waiting");
	assert.deepEqual(run.viewDecision, snapshot);
	assert.equal(counts.architecture, 1);
	receipt.checks.push(
		"Cold restart retains exact check-in document, bound plan/proposal and answer digests without rerunning agents",
	);
	server = new FactoryServer(
		runtime,
		{
			repositories: () => [
				{ id: "fixture", name: "Readers", repositoryPath: home },
			],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("No launch");
			},
			stop: (id) => runtime.stop(id),
		},
		origin,
	);
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
	await page.getByRole("form", { name: "Check in with you" }).waitFor();
	await page
		.getByRole("heading", { name: "Before I start", exact: true })
		.click();
	for (const width of [1280, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.evaluate(() => {
			localStorage.setItem("factory-theme", "light");
			document.documentElement.dataset.theme = "light";
			document.documentElement.style.colorScheme = "light";
			window.scrollTo(0, 0);
		});
		await page.waitForTimeout(150);
		const dimensions = await page.evaluate(() => ({
			width: innerWidth,
			scrollWidth: document.documentElement.scrollWidth,
		}));
		assert(
			dimensions.scrollWidth <= dimensions.width,
			JSON.stringify(dimensions),
		);
		const name = `check-in-${width}.png`;
		await page.screenshot({ path: join(evidence, name), fullPage: true });
		receipt.screenshots.push({ name, ...dimensions });
	}
	await page
		.locator(".dv-item-card")
		.first()
		.getByRole("textbox", { name: "Comment", exact: true })
		.fill("Five minutes please");
	await page
		.getByRole("button", { name: "Request changes", exact: true })
		.click();
	await until(
		() => run.status === "waiting" && run.viewDecision.id !== snapshot.id,
	);
	await page
		.getByText("I went with five minutes, following your note.", {
			exact: false,
		})
		.waitFor();
	await page.getByRole("button", { name: "Accept", exact: true }).click();
	await until(() => run.status === "completed");
	assert.equal(counts.architecture, 2);
	assert.equal(run.outputs.output.architecture.accepted, true);
	assert.deepEqual(run.outputs.output.architecture.decisions, [
		{ id: "expiry", text: "Expire after five minutes" },
	]);
	assert.deepEqual(run.outputs.output.architecture.approval.items, {});
	receipt.checks.push(
		"At 390px, per-point comment + Request changes reaches resumed author, revised proposal renders, and Accept submits without mandatory item answers",
	);
	assert.deepEqual(receipt.consoleErrors, []);
	receipt.checks.push(
		"No horizontal overflow at desktop/390px and no browser page errors",
	);
	writeFileSync(
		join(evidence, "receipt.json"),
		`${JSON.stringify({ ...receipt, counts }, null, 2)}\n`,
	);
	console.log(JSON.stringify(receipt, null, 2));
} finally {
	await browser?.close();
	await server?.stop();
	await runtime.shutdown();
	rmSync(home, { recursive: true, force: true });
}
