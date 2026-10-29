import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	DISPLAY_COMPONENTS,
	DISPLAY_CONTRACT,
} from "../src/factory/DisplayDocument.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";
import {
	plan,
	proposal,
	questionDocument,
	requirements,
} from "./fixtures/v2-planning.js";

const mocks = vi.hoisted(() => ({ command: vi.fn(), provider: vi.fn() }));
vi.mock("../src/factory/nodes/execute/command.js", async (original) => ({
	...(await original<object>()),
	executeCommand: mocks.command,
}));
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: mocks.provider,
}));
const owned: {
	home: string;
	runtime: WorkflowRuntime;
	server?: FactoryServer;
}[] = [];
afterEach(async () => {
	for (const { runtime, server } of owned) {
		await runtime.shutdown();
		await server?.stop();
	}
	for (const home of new Set(owned.map((r) => r.home)))
		rmSync(home, { recursive: true, force: true });
	owned.length = 0;
});
function runtime(
	home: string,
	agent: RuntimeHooks["agent"],
	extra: Partial<RuntimeHooks> = {},
) {
	const r = new WorkflowRuntime(home, {
		agent: async (ctx) =>
			parseStepOutputAsync(
				ctx.step,
				await agent(ctx),
				undefined,
				ctx.signal,
				ctx.fresh,
			),
		...extra,
	});
	owned.push({ home, runtime: r });
	r.updateWorkflows(defaultWorkflows);
	return r;
}
function fixture(
	id: string,
	agent: RuntimeHooks["agent"],
	extra: Partial<RuntimeHooks> = {},
) {
	const home = mkdtempSync(join(tmpdir(), "v2-planning-"));
	const r = runtime(home, agent, extra);
	const workflow = defaultWorkflows.find((d) => d.id === id)!;
	const run = r.create({
		title: "New readers",
		repositoryId: "fixture",
		workspace: home,
		input: "Confirm new readers",
		launchInputs: {
			requirements: JSON.stringify(requirements),
			plan: JSON.stringify(plan),
			architecture: JSON.stringify({
				meaningful: false,
				accepted: false,
				decisions: [],
			}),
		},
		workflow,
		workflowDefinitions: defaultWorkflows,
		triggerOrigin: {
			type: "manual",
			workflowId: id,
			at: new Date().toISOString(),
		},
	});
	return { home, r, run };
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
async function waiting(_r: WorkflowRuntime, run: FactoryRun, prior?: string) {
	await waitForRuntime(() => {
		expect(run.status, run.error).toBe("waiting");
		expect(run.viewDecision).toBeDefined();
		if (prior) expect(run.viewDecision!.id).not.toBe(prior);
	});
	return structuredClone(run.viewDecision!);
}
const launch = (r: WorkflowRuntime, run: FactoryRun) => {
	void r.launch(run);
};
function server(r: WorkflowRuntime) {
	const s = new FactoryServer(r, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("No launch");
		},
		stop: (id) => r.stop(id),
	});
	owned.at(-1)!.server = s;
	return s;
}

it.each([
	"api",
	"ticket",
])("clarifies through %s, retains decisions, and replans after rejection", async (channel) => {
	let clarifications = 0,
		plans = 0;
	const { r, run } = fixture("v2-clarify-plan", async (ctx) => {
		const reads = stepBindings(ctx);
		if (ctx.step.id === "clarify") {
			expect(reads.source).toMatchObject({
				prompt: "Confirm new readers",
				fields: { plan: JSON.stringify(plan) },
			});
			if (++clarifications === 1)
				return {
					...requirements,
					decisions: [],
					status: "needs-input",
					display: questionDocument,
				};
			expect(reads.answer).toMatchObject({
				values: { owner: "An administrator" },
			});
			return { ...requirements, status: "ready" };
		}
		if (ctx.step.id === "plan") {
			if (++plans === 2)
				expect(reads.feedback).toEqual({
					approved: false,
					feedback: ["Cover rejection"],
				});
			return plan;
		}
		return {
			approved: plans === 2,
			feedback: plans === 2 ? [] : ["Cover rejection"],
		};
	});
	launch(r, run);
	await waiting(r, run);
	const answer = request(run, {
		action: "continue",
		values: { owner: "An administrator" },
	});
	if (channel === "api") {
		const response = await server(r).app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: answer,
		});
		expect(response.statusCode, response.body).toBe(200);
	} else await r.replyView(run.id, `/view-answer ${JSON.stringify(answer)}`);
	await done(run);
	expect(run.outputs.output).toEqual({ requirements, plan });
	expect(clarifications).toBe(2);
	expect(plans).toBe(2);
	expect(run.workflow.steps.find((s) => s.id === "clarify")!.session).toBe(
		"resume",
	);
	expect(run.workflow.steps.find((s) => s.id === "plan")!.session).toBe(
		"resume",
	);
});

it("lists the data contract of every display component", () => {
	for (const type of DISPLAY_COMPONENTS)
		expect(DISPLAY_CONTRACT).toContain(`\n- ${type}: {`);
	expect(DISPLAY_CONTRACT).toContain("markdown: {text: string}");
});

it("returns display validation errors for agent correction instead of failing the run", async () => {
	const clarify = defaultWorkflows
		.find((d) => d.id === "v2-clarify-plan")!
		.steps.find((s) => s.id === "clarify")!;
	const output = (display: unknown) => ({
		...requirements,
		decisions: [],
		status: "needs-input",
		display,
	});
	const mistaken = {
		version: "view-v1",
		components: [
			{
				id: "intro",
				type: "markdown",
				data: { literal: { markdown: "Who confirms?" } },
			},
			{
				id: "todo",
				type: "checklist",
				data: { literal: { title: "Todo", items: ["one"] } },
			},
		],
	};
	const error = await parseStepOutputAsync(clarify, output(mistaken)).catch(
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(OutputValidationError);
	const issue = (error as OutputValidationError).issues[0]!;
	expect(issue.path).toBe("/display");
	expect(issue.message).toContain("/display must follow the display contract");
	expect(issue.message).toContain(
		'components.0.data.literal: Unrecognized key: "markdown"',
	);
	expect(issue.message).toContain("components.1.data.literal.items.0");
	expect(issue.message).not.toContain("data.bindings");
	const actions = (id: string) => ({
		id,
		type: "actions",
		data: { literal: { actions: [{ id: "submit", label: "Submit" }] } },
	});
	const twoBars = await parseStepOutputAsync(
		clarify,
		output({ version: "view-v1", components: [actions("a"), actions("b")] }),
	).catch((e: unknown) => e);
	expect((twoBars as OutputValidationError).issues[0]!.message).toContain(
		"A display has one document action bar",
	);
	await expect(
		parseStepOutputAsync(clarify, output(questionDocument)),
	).resolves.toMatchObject({ status: "needs-input" });
});

it("skips routine work without asking for acceptance", async () => {
	const { r, run } = fixture("v2-check-in", async () => ({
		meaningful: false,
		rationale: "Established pattern",
		decisions: [],
	}));
	await r.launch(run);
	await done(run);
	expect(run.outputs.output).toMatchObject({
		architecture: { meaningful: false, accepted: false, decisions: [] },
	});
	expect(run.viewRecords ?? []).toHaveLength(0);
	expect(run.outputs["architecture-review"]).toBeUndefined();
});

it("replans from the explicit architecture revision port and prior requirements", async () => {
	const revised = { ...plan, summary: "Confirm readers with expiring codes" };
	const revision = {
		meaningful: true,
		accepted: false,
		decisions: [],
		planChanges: revised,
		approval: {
			action: "request-changes",
			comments: { expiry: "Five minutes please" },
		},
	};
	const { r, run } = fixture("v2-clarify-plan", async (ctx) => {
		if (ctx.step.id === "clarify") {
			expect(stepBindings(ctx)).toMatchObject({
				priorRequirements: requirements,
				revision,
			});
			return { ...requirements, status: "ready" };
		}
		if (ctx.step.id === "plan") {
			expect(stepBindings(ctx).revision).toEqual(revision);
			return revised;
		}
		return { approved: true, feedback: [] };
	});
	run.launchInputs!.architecture = JSON.stringify(revision);
	await r.launch(run);
	await done(run);
	expect(run.outputs.output).toEqual({ requirements, plan: revised });
});

it("publishes new-engine display answer protocols without legacy lifecycle milestones", async () => {
	const track = vi.fn(async () => {});
	const { r, run } = fixture(
		"v2-check-in",
		async (ctx) =>
			ctx.step.id === "architecture"
				? proposal()
				: { approved: true, feedback: [] },
		{ track },
	);
	run.ticketReference = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://taskbot.example",
		project: "fixture",
		id: "1",
		url: "https://taskbot.example/p/fixture/t/1",
	};
	launch(r, run);
	await waiting(r, run);
	await waitForRuntime(() => expect(track).toHaveBeenCalledTimes(1));
	expect(track.mock.calls[0]![1]).toMatchObject({
		viewDecision: {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
		},
		body: expect.stringContaining("/view-answer"),
	});
	await r.answerView(run.id, request(run, { action: "accept" }));
	await done(run);
	expect(track).toHaveBeenCalledTimes(1);
});

it.each([
	true,
	false,
])("requires fresh acceptance after request changes even when revised meaningful=%s", async (meaningful) => {
	let drafts = 0;
	const { r, run } = fixture("v2-check-in", async (ctx) => {
		if (ctx.step.id === "architecture-review")
			return { approved: true, feedback: [] };
		if (++drafts === 2)
			expect(stepBindings(ctx).feedback).toMatchObject({
				answer: {
					action: "request-changes",
					comments: { expiry: "Five minutes please" },
				},
			});
		return {
			...proposal(drafts > 1),
			meaningful: drafts === 1 || meaningful,
		};
	});
	launch(r, run);
	const first = await waiting(r, run);
	await r.answerView(
		run.id,
		request(run, {
			action: "request-changes",
			choices: [
				{ itemId: "expiry", action: "comment", comment: "Five minutes please" },
			],
		}),
	);
	await waiting(r, run, first.id);
	expect(run.outputs.output).toBeUndefined();
	expect(run.outputs.accepted).toMatchObject({ accepted: false });
	await r.answerView(run.id, request(run, { action: "accept" }));
	await done(run);
	expect(drafts).toBe(2);
	expect(run.outputs.output).toMatchObject({
		architecture: {
			meaningful,
			accepted: true,
			decisions: [{ id: "expiry", text: "Expire after five minutes" }],
			approval: { action: "accept", bound: ["plan-input", "architecture"] },
		},
	});
});

it("rejects a stale acceptance after the plan changes, then requires a fresh acceptance", async () => {
	let drafts = 0;
	const { r, run } = fixture("v2-check-in", async (ctx) => {
		if (ctx.step.id !== "architecture") return { approved: true, feedback: [] };
		drafts++;
		return proposal(drafts > 1);
	});
	launch(r, run);
	const first = await waiting(r, run);
	run.outputs.plan = { ...plan, summary: "Changed scope" };
	await r.answerView(run.id, request(run, { action: "accept" }));
	await waiting(r, run, first.id);
	expect(
		run.history.filter((h) => h.step === "accepted")[0]!.output,
	).toMatchObject({ accepted: false });
	expect(run.outputs.output).toBeUndefined();
	await r.answerView(run.id, request(run, { action: "accept" }));
	await done(run);
	expect(drafts).toBe(2);
});

it("returns revise-plan with the proposed plan as data", async () => {
	const revised = { ...plan, deliveryMode: "mixed" };
	const { r, run } = fixture("v2-check-in", async () => ({
		...proposal(),
		planChanges: revised,
	}));
	await r.launch(run);
	await done(run);
	expect(run.checkpoint?.outcome).toBe("revise-plan");
	expect(run.outputs.output).toMatchObject({
		architecture: { accepted: false, planChanges: revised },
	});
	expect(run.viewRecords ?? []).toHaveLength(0);
});

it("revises after independent architecture rejection before showing a display", async () => {
	let reviews = 0;
	const { r, run } = fixture("v2-check-in", async (ctx) => {
		if (ctx.step.id === "architecture-review") {
			reviews++;
			return {
				approved: reviews > 1,
				feedback: reviews === 1 ? ["Explain expiry"] : [],
			};
		}
		if (reviews === 1)
			expect(stepBindings(ctx).feedback).toMatchObject({
				review: { approved: false, feedback: ["Explain expiry"] },
			});
		return proposal(reviews > 0);
	});
	launch(r, run);
	await waiting(r, run);
	expect(reviews).toBe(2);
	expect(run.viewRecords).toHaveLength(1);
	await r.answerView(run.id, request(run, { action: "accept" }));
	await done(run);
});

it("accepts a bound call and exposes the public architecture output port", async () => {
	const { home, r } = fixture("v2-check-in", async (ctx) =>
		ctx.step.id === "architecture"
			? proposal()
			: { approved: true, feedback: [] },
	);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "caller",
			name: "Caller",
			engineVersion: "nodes-v1",
			steps: [
				{
					id: "request",
					name: "Requirements",
					type: "transform",
					transform: Object.fromEntries(
						Object.entries(requirements).map(([key, value]) => [
							key,
							{ literal: value },
						]),
					),
				},
				{
					id: "candidate",
					name: "Plan",
					type: "transform",
					transform: Object.fromEntries(
						Object.entries(plan).map(([key, value]) => [
							key,
							{ literal: value },
						]),
					),
				},
				{
					id: "call",
					name: "Call",
					type: "workflow",
					workflow: "v2-check-in",
					inputFreshness: "on-read",
					bindings: { requirements: "request", plan: "candidate" },
				},
			],
		},
	]);
	r.updateWorkflows(definitions);
	const run = r.create({
		title: "Caller",
		repositoryId: "fixture",
		workspace: home,
		input: "Confirm new readers",
		workflow: definitions.at(-1)!,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: "caller",
			at: new Date().toISOString(),
		},
	});
	launch(r, run);
	await waiting(r, run);
	await r.answerView(run.id, request(run, { action: "accept" }));
	await done(run);
	expect(run.outputs.call).toMatchObject({
		outcome: "completed",
		outputs: { output: { architecture: { meaningful: true, accepted: true } } },
	});
});

it("restarts while waiting at the check-in and accepts the exact retained display", async () => {
	const agent = vi.fn(async (ctx: ExecutionContext) =>
		ctx.step.id === "architecture"
			? proposal()
			: { approved: true, feedback: [] },
	);
	const { home, r, run } = fixture("v2-check-in", agent);
	launch(r, run);
	const original = await waiting(r, run);
	await r.shutdown();
	const restoredRuntime = runtime(home, agent);
	restoredRuntime.resumeAll();
	const restored = restoredRuntime.get(run.id);
	await waiting(restoredRuntime, restored);
	expect(restored.viewDecision).toEqual(original);
	await restoredRuntime.replyView(
		run.id,
		`/view-answer ${JSON.stringify(request(restored, { action: "accept" }))}`,
	);
	await done(restored);
	expect(restored.outputs.output).toMatchObject({
		architecture: { accepted: true },
	});
	expect(agent).toHaveBeenCalledTimes(2);
});

it("hands architecture revision back without Git or PR effects", async () => {
	const { r, run } = fixture("v2-implementation", async () => ({
		status: "blocked",
		architectureRevision: true,
		summary: "A changed boundary needs acceptance",
		checks: [],
	}));
	await r.launch(run);
	await done(run);
	expect(run.checkpoint?.outcome).toBe("to-architecture");
	expect(run.outputs.pr).toBeUndefined();
	expect(run.nodeEffects ?? {}).toEqual({});
});

it("resumes implementation after assistance without publishing unfinished work", async () => {
	let turns = 0;
	const { r, run } = fixture("v2-implementation", async (ctx) => {
		if (++turns === 1)
			return {
				status: "needs-input",
				architectureRevision: false,
				summary: "Missing a decision",
				checks: [],
				display: questionDocument,
			};
		expect(stepBindings(ctx).answer).toMatchObject({
			values: { owner: "An administrator" },
		});
		return {
			status: "blocked",
			architectureRevision: true,
			summary: "Answer changes the boundary",
			checks: [],
		};
	});
	launch(r, run);
	await waiting(r, run);
	expect(run.nodeEffects ?? {}).toEqual({});
	await r.answerView(
		run.id,
		request(run, { action: "continue", values: { owner: "An administrator" } }),
	);
	await done(run);
	expect(turns).toBe(2);
	expect(run.checkpoint?.outcome).toBe("to-architecture");
});

it.each([
	undefined,
	"x".repeat(101),
])("rejects an invalid PR title before publication (%s)", async (title) => {
	const { r, run } = fixture("v2-implementation", async () => ({
		status: "completed",
		architectureRevision: false,
		title,
		summary: "Reader confirmation implemented",
		checks: [],
	}));
	await r.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toMatch(/title/);
	expect(run.nodeEffects ?? {}).toEqual({});
});

it("implements with a long plan, commits without hooks, pushes and opens one draft PR", async () => {
	const title = "Confirm new readers before registration".padEnd(100, ".");
	const { home, r, run } = fixture("v2-implementation", async () => ({
		status: "completed",
		architectureRevision: false,
		title,
		summary: "Reader confirmation implemented",
		checks: ["confirmation tests passed"],
	}));
	const longPlan = { ...plan, summary: plan.summary.repeat(10) };
	expect(longPlan.summary.length).toBeGreaterThan(256);
	run.launchInputs!.plan = JSON.stringify(longPlan);
	writeFileSync(join(home, ".git"), "gitdir: fixture");
	let head = "a".repeat(40),
		dirty = true;
	const next = "b".repeat(40),
		url = "https://github.com/team/project/pull/1";
	const calls: string[][] = [];
	mocks.command.mockImplementation(
		async (_ctx: ExecutionContext, _exe: string, args: string[]) => {
			calls.push(args);
			switch (args[0]) {
				case "rev-parse":
					return args[1] === "--show-toplevel" ? home : head;
				case "branch":
					return "feature";
				case "status":
					return dirty ? " M reader.ts" : "";
				case "add":
					return "";
				case "commit":
					head = next;
					dirty = false;
					return "committed";
				case "rev-list":
					return "1";
				case "push":
					return "pushed";
				default:
					return "";
			}
		},
	);
	let pr: object | undefined;
	const create = vi.fn(async (input) => {
		pr = {
			url,
			number: 1,
			title: input.title,
			body: input.body,
			headRefName: "feature",
			headRefOid: head,
			baseRefName: "main",
			state: "OPEN",
			isDraft: true,
			isCrossRepository: false,
		};
		return url;
	});
	mocks.provider.mockResolvedValue({
		list: async () => [],
		create,
		view: async () => pr,
	});
	run.repositories = [
		{
			id: "fixture",
			name: "fixture",
			repositoryPath: join(home, "source"),
			workspace: home,
			baseBranch: "main",
		},
	];
	await r.launch(run);
	await done(run);
	expect(calls.find((args) => args[0] === "commit")).toContain("--no-verify");
	expect(calls.some((args) => args[0] === "push")).toBe(true);
	expect(create).toHaveBeenCalledTimes(1);
	expect(create.mock.calls[0]![0]).toMatchObject({
		title,
		body: expect.stringContaining(longPlan.summary),
	});
	expect(run.outputs.output).toEqual({
		change: {
			summary: "Reader confirmation implemented",
			repositories: [{ id: "fixture", head: next }],
		},
		pr: { repositories: [{ id: "fixture", head: next, url, isDraft: true }] },
	});
});

it("keeps the legacy source meaning on unmarked recipes", () => {
	const { run } = fixture("v2-clarify-plan", async () => ({}));
	run.takeoverSource = { url: "https://github.com/team/project/pull/2" };
	const workflow = WorkflowSchema.parse({
		id: "legacy",
		name: "Legacy",
		steps: [
			{
				id: "read",
				name: "Read",
				type: "agent",
				prompt: "Read",
				reads: { source: "@source" },
			},
		],
	});
	expect(
		stepBindings({
			run,
			step: workflow.steps[0]!,
			signal: new AbortController().signal,
		} as ExecutionContext).source,
	).toEqual(run.takeoverSource);
});
