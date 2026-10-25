import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CyrusAgentSessionEntry, immutableJson } from "bobs-factory-core";
import {
	createFactoryContextServerFromSnapshot,
	prepareFactoryContextAsync,
	runtimeTranscript,
	runtimeTranscriptField,
	transcriptAccessPath,
	transcriptSource,
} from "bobs-factory-mcp-tools";
import { afterEach, expect, it, vi } from "vitest";
import {
	roleAgentContext,
	roleContextAccess,
	roleTranscriptSource,
} from "../src/factory/RoleContext.js";
import {
	captureReviewContext,
	originalReviewContext,
} from "../src/factory/SpecialistReview.js";
import {
	mappedStepBindings,
	stepBindings,
} from "../src/factory/StepBindings.js";
import {
	registerWorkflowConfig,
	resolveStepConfig,
} from "../src/factory/StepConfig.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { detachedWorkflowRead } from "../src/factory/WorkflowInput.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const sdk = createRequire(
	new URL("../../mcp-tools/package.json", import.meta.url),
);
const { Client } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { InMemoryTransport } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/inMemory.js")
);
const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function context(diagnostic = false) {
	const home = mkdtempSync(join(tmpdir(), "task149-owners-"));
	homes.push(home);
	const workflow = WorkflowSchema.parse({
		id: "custom",
		name: "Custom role",
		steps: [
			{
				id: "renamed",
				name: "Read outputs",
				type: "agent",
				prompt:
					"Consume the explicit role inputs and preserve required evidence",
				reads: {
					required: "@launchInputs/missing",
					raw: "@transcripts/roles/predecessor/1/entry/content",
				},
				...(diagnostic
					? {
							context: {
								mode: "outputs-first",
								transcripts: {
									purpose: "Recover one original response",
									ranges: [{ role: "predecessor", start: 1, end: 2 }],
									utf8Bytes: 1000,
									pages: 4,
								},
							},
						}
					: {}),
			},
		],
	});
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		id: "synthetic-owner",
		workflow: workflow!,
		workflowDefinitions: [workflow!],
		triggerOrigin: { type: "manual", workflowId: workflow!.id },
		input: "Keep exact accepted compatibility",
		repositoryId: "fixture",
		workspace: home,
	});
	const ctx: ExecutionContext = {
		run,
		step: workflow!.steps[0]!,
		stepKey: "renamed",
		input: {},
		factoryHome: home,
		signal: new AbortController().signal,
		evidenceDir: home,
		log: () => {},
	};
	return { ctx, runtime, home };
}

it("keeps ordinary handoffs source-bound and reports missing records without loading native buffers or changing authority", () => {
	const { ctx } = context();
	ctx.transcriptEntries = () => {
		throw new Error("ordinary roles must never load native transcript buffers");
	};
	ctx.run.answers.push({
		questions: ["Preserve old clients?"],
		answer: "Yes, keep compatibility",
		at: "2026-10-23T00:00:00Z",
	});
	ctx.chatMessages = [
		{
			id: "human-message",
			text: "Retain the unresolved finding",
			step: "renamed",
			at: "2026-10-23T00:00:00Z",
		},
	];
	const original = JSON.stringify(ctx.run);
	expect(transcriptSource(roleTranscriptSource(ctx) as object)).toMatchObject({
		runId: ctx.run.id,
		role: "*",
	});
	const view = roleAgentContext(ctx) as {
		handoff: {
			answers: unknown[];
			steering: unknown[];
			gaps: { source: string; remedy: string }[];
		};
	};
	expect(view.handoff.answers).toEqual([
		{
			kind: "human-answer",
			source: { runId: ctx.run.id, path: "/answers/0" },
			value: ctx.run.answers[0],
		},
	]);
	expect(view.handoff.steering).toEqual([
		{
			kind: "human-steering",
			source: { runId: ctx.run.id, path: "/chatMessages", id: "human-message" },
			value: ctx.chatMessages[0],
		},
	]);
	expect(view.handoff.gaps.map((gap) => gap.source)).toEqual([
		"@launchInputs/missing",
		"@transcripts/roles/predecessor/1/entry/content",
	]);
	expect(
		view.handoff.gaps.every((gap) =>
			gap.remedy.includes("explicit source-bound output/artifact"),
		),
	).toBe(true);
	expect(JSON.stringify(ctx.run)).toBe(original);
	ctx.input = {
		handoff: { messages: ["legitimate domain data"] },
		factoryHandoff: { history: ["product revision"] },
	};
	const collision = roleAgentContext(ctx) as Record<string, unknown>;
	expect(collision.handoff).toEqual({ messages: ["legitimate domain data"] });
	expect(collision.factoryHandoff).toEqual({ history: ["product revision"] });
	expect(roleContextAccess(ctx)?.handoffPath).toBe("/factoryHandoff1");
	expect(collision.factoryHandoff1).toMatchObject({
		format: "factory-role-handoff-v1",
	});
	ctx.input = { history: [{ step: "research", output: {} }] };
	const handoffOf = () =>
		(roleAgentContext(ctx) as { handoff: { reviewMemory?: unknown } }).handoff;
	expect(handoffOf().reviewMemory).toBeUndefined();
	ctx.run.reviewRounds = [
		{ key: "review/specialist-review" },
	] as unknown as typeof ctx.run.reviewRounds;
	expect(handoffOf().reviewMemory).toMatchObject({
		ledger: "/contextMemory/reviewLedger",
	});
	delete ctx.run.roleContext;
	expect(roleAgentContext(ctx)).toBe(ctx.input);
	expect(roleContextAccess(ctx)).toBeUndefined();
});

it("uses original role-tagged session entries, preserves scalar read provenance and refuses absent source/range", async () => {
	const { ctx, home } = context(true);
	const entries: CyrusAgentSessionEntry[] = [
		{ type: "assistant", content: "unattributed legacy content" },
		...Array.from({ length: 3 }, (_, index) => ({
			type: "assistant" as const,
			content: `original-${index}`,
			codexSessionId: "synthetic-native-id",
			metadata: { factoryStepKey: "predecessor", timestamp: index },
		})),
		{
			type: "assistant",
			content: "unrelated sibling",
			metadata: { factoryStepKey: "sibling", timestamp: 4 },
		},
	];
	expect(() => roleTranscriptSource(ctx)).toThrow(
		"Original native transcript source is unavailable",
	);
	const narrowEntries = entries.slice();
	Object.defineProperty(narrowEntries, 3, {
		get: () => {
			throw new Error(
				"A narrow diagnostic must not materialize a later transcript entry",
			);
		},
	});
	ctx.transcriptEntries = () => narrowEntries;
	const bindings = stepBindings(ctx);
	bindings.mapped = mappedStepBindings(bindings, { historical: "raw" });
	ctx.input = bindings;
	expect(bindings.raw).toBe("original-1");
	const prepared = await prepareFactoryContextAsync(
		roleAgentContext(ctx),
		undefined,
		undefined,
		{ cacheDirectory: join(home, "cache"), access: roleContextAccess(ctx) },
	);
	const server = createFactoryContextServerFromSnapshot(
		prepared.config.args.at(-1)!,
	);
	const client = new Client({ name: "owner-boundary", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		const result = await client.callTool({
			name: "read_context",
			arguments: { path: "/raw" },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent?.text).toBe("original-1");
		expect(entries[2]!.codexSessionId).toBe("synthetic-native-id");
		ctx.run.roleContext!.policy = { mode: "outputs-first" };
		delete ctx.step.context;
		const normal = await prepareFactoryContextAsync(
			roleAgentContext(ctx),
			undefined,
			undefined,
			{ cacheDirectory: join(home, "cache"), access: roleContextAccess(ctx) },
		);
		const normalServer = createFactoryContextServerFromSnapshot(
			normal.config.args.at(-1)!,
		);
		const normalClient = new Client({ name: "normal", version: "1" });
		const [c, d] = InMemoryTransport.createLinkedPair();
		await normalServer.connect(c);
		await normalClient.connect(d);
		try {
			expect(
				(
					await normalClient.callTool({
						name: "read_context",
						arguments: { path: "/raw", view: "full" },
					})
				).isError,
			).toBe(true);
			expect(
				(
					await normalClient.callTool({
						name: "read_context",
						arguments: { path: "/handoff/inputs/0/value", view: "full" },
					})
				).isError,
			).toBe(true);
			expect(
				(
					await normalClient.callTool({
						name: "read_context",
						arguments: { path: "/mapped/historical", view: "full" },
					})
				).isError,
			).toBe(true);
		} finally {
			await normalClient.close();
			await normalServer.close();
			normal.cleanup();
		}
		ctx.transcriptEntries = () => entries;
		ctx.step.context = {
			mode: "outputs-first",
			transcripts: {
				purpose: "Recover missing original",
				ranges: [{ role: "predecessor", start: 8, end: 9 }],
				utf8Bytes: 100,
				pages: 1,
			},
		};
		expect(() => roleTranscriptSource(ctx)).toThrow(
			"Transcript accounting identity changed",
		);
		const missing = context(true).ctx;
		missing.step.context = ctx.step.context;
		missing.transcriptEntries = () => entries;
		expect(() => roleTranscriptSource(missing)).toThrow(
			"unavailable or lacks role provenance",
		);
	} finally {
		await client.close();
		await server.close();
		prepared.cleanup();
	}
});

it("retains private transcript provenance through detached aliases and reconstructed inline baselines without rewriting originals", async () => {
	const { ctx, home } = context();
	const scope = { runId: ctx.run.id, role: "predecessor", start: 0, end: 1 };
	const raw = runtimeTranscript(
		{ messages: [{ content: "synthetic original raw conversation" }] },
		scope,
	);
	const inline = immutableJson({
		nested: { copied: raw },
		baseline: {
			retained: raw,
			context: { historical: "unchanged existing nested baseline projection" },
		},
		scalar: "synthetic raw scalar",
		accepted: { messages: ["legitimate application messages"] },
	});
	runtimeTranscript(inline.nested.copied, scope);
	runtimeTranscript(inline.baseline.retained, scope);
	runtimeTranscriptField(inline, "scalar", scope);
	const firstCapture = captureReviewContext(inline, ctx.run, []);
	const captured = immutableJson(captureReviewContext(inline, ctx.run, []));
	expect(captured.contextTranscriptSources).toEqual(
		firstCapture.contextTranscriptSources,
	);
	const disk = JSON.parse(JSON.stringify(captured));
	const reconstructed = originalReviewContext(disk, ctx.run, []);
	const copy = detachedWorkflowRead(reconstructed);
	expect(copy).toEqual({
		...inline,
		baseline: { retained: inline.baseline.retained },
	});
	expect(copy).not.toBe(reconstructed);
	const prepared = await prepareFactoryContextAsync(
		{ legacy: { baseline: { context: copy } } },
		undefined,
		undefined,
		{ cacheDirectory: join(home, "cache"), access: roleContextAccess(ctx) },
	);
	const server = createFactoryContextServerFromSnapshot(
		prepared.config.args.at(-1)!,
	);
	const client = new Client({ name: "legacy-adapter", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		for (const path of [
			"/legacy/baseline/context/nested/copied/messages/0/content",
			"/legacy/baseline/context/scalar",
			"/legacy/baseline/context/baseline/retained/messages/0/content",
			"",
		])
			expect(
				(
					await client.callTool({
						name: "read_context",
						arguments: { path, view: "full" },
					})
				).isError,
			).toBe(true);
		const allowed = await client.callTool({
			name: "read_context",
			arguments: { path: "/legacy/baseline/context/accepted", view: "full" },
		});
		expect(allowed.isError).not.toBe(true);
		expect(raw.messages[0]!.content).toBe(
			"synthetic original raw conversation",
		);
		expect(() =>
			originalReviewContext(disk, { ...ctx.run, id: "foreign-run" }, []),
		).toThrow("Foreign transcript source");
	} finally {
		await client.close();
		await server.close();
		prepared.cleanup();
	}
});

it("inherits a nested recipe's accepted context configuration independently of role naming", () => {
	const { ctx } = context();
	const recipe = WorkflowSchema.parse({
		id: "nested-recipe",
		name: "Nested",
		context: {
			mode: "outputs-first",
			transcripts: {
				purpose: "Analyze one original conversation response",
				ranges: [{ role: "prior-role", start: 2, end: 3 }],
				utf8Bytes: 80,
				pages: 2,
			},
		},
		steps: [
			{
				id: "custom-analysis",
				name: "Arbitrary name",
				type: "agent",
				prompt:
					"Consume the explicit role inputs and preserve required evidence",
			},
		],
	});
	registerWorkflowConfig(recipe!);
	ctx.run.workflowDefinitions!.push(recipe!);
	ctx.step = recipe!.steps[0]!;
	expect(roleContextAccess(ctx)?.policy).toEqual(recipe!.context);
	expect(ctx.run.roleContext?.adoption).toBe("new-run");
});

it("context adoption preserves legacy output, QA, permission and revision contracts", () => {
	const legacy = {
		id: "capture",
		type: "agent",
		qaContract: "qa-v1" as const,
		json: true,
	};
	expect(
		resolveStepConfig({
			...legacy,
			context: { mode: "outputs-first" as const },
		}),
	).toEqual(resolveStepConfig(legacy));
});

it("refuses an oversized original range before detaching it and records an actionable bounded-extension gap", () => {
	const { ctx } = context(true);
	ctx.step.context!.transcripts!.utf8Bytes = 256;
	ctx.step.context!.transcripts!.extension = { pages: 1, utf8Bytes: 256 };
	ctx.transcriptEntries = () => [
		{
			type: "assistant",
			content: "earlier",
			metadata: { factoryStepKey: "predecessor", timestamp: 0 },
		},
		{
			type: "assistant",
			content: "é".repeat(1000000),
			metadata: { factoryStepKey: "predecessor", timestamp: 1 },
		},
	];
	const clone = vi.spyOn(globalThis, "structuredClone");
	expect(() => stepBindings(ctx)).toThrow(
		"exceeds its authorized UTF-8 capture allowance",
	);
	expect(clone).not.toHaveBeenCalled();
	const receipt = JSON.parse(
		readFileSync(transcriptAccessPath(roleContextAccess(ctx)!), "utf8"),
	);
	expect(receipt).toMatchObject({
		pages: 0,
		utf8Bytes: 0,
		grants: [],
		blocked: {
			reason: "transcript-capture-allowance",
			scope: { runId: ctx.run.id, role: "predecessor", start: 1, end: 2 },
		},
	});
});

it("reports a partner read as missing only after its producer has output", async () => {
	const home = mkdtempSync(join(tmpdir(), "first-pass-gaps-"));
	homes.push(home);
	const workflow = WorkflowSchema.parse({
		id: "first-pass",
		name: "First pass",
		steps: [
			{
				id: "consume",
				name: "Clarify",
				type: "agent",
				prompt: "Clarify the task, reusing any earlier plan",
				reads: { earlier: "plan" },
			},
			{ id: "plan", name: "Plan", type: "agent", prompt: "Plan the work" },
		],
	});
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	runtimes.push(runtime);
	registerWorkflowConfig(workflow);
	const run = runtime.create({
		id: "first-pass-run",
		workflow,
		workflowDefinitions: [workflow],
		triggerOrigin: { type: "manual", workflowId: workflow.id },
		input: "Continue the existing work",
		repositoryId: "fixture",
		workspace: home,
	});
	const ctx: ExecutionContext = {
		run,
		step: workflow.steps[0]!,
		stepKey: "consume",
		input: {},
		factoryHome: home,
		signal: new AbortController().signal,
		evidenceDir: home,
		log: () => {},
	};
	const gaps = () =>
		(roleAgentContext(ctx) as { handoff: { gaps: { input: string }[] } })
			.handoff.gaps;
	expect(gaps()).toEqual([]);
	run.outputs.plan = { summary: "Earlier plan" };
	expect(gaps().map((gap) => gap.input)).toEqual(["earlier"]);
});
