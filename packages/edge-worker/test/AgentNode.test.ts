import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunnerConfig, RunnerType } from "bobs-factory-core";
import {
	loadFactoryContextSnapshot,
	runtimeTranscriptField,
} from "bobs-factory-mcp-tools";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { nodeRegistry } from "../src/factory/nodes/index.js";
import { stepFields } from "../src/factory/nodes/schema.js";
import { nativeAgentReads } from "../src/factory/RolePrompt.js";
import { materializeWorkflowConfig } from "../src/factory/StepConfig.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { AgentStepSettings } from "../src/factory/web/agent-step-settings.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import recipe from "./fixtures/agent-node-needs-input.json";

const waitForRuntime = (callback: () => void) =>
	vi.waitFor(callback, { timeout: 10000 });

// Source imports prepare a .js launcher beside .ts sources. Use the built MCP
// entrypoint for the real non-Codex scoped preflight in this scripted drive.
vi.mock("bobs-factory-mcp-tools", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("bobs-factory-mcp-tools")>();
	return {
		...actual,
		verifyFactoryContext: (
			config: Parameters<typeof actual.verifyFactoryContext>[0],
			...rest: [AbortSignal, string]
		) =>
			actual.verifyFactoryContext(
				{
					...config,
					args: [
						fileURLToPath(
							new URL(
								"../../mcp-tools/dist/factory-context-main.js",
								import.meta.url,
							),
						),
						...config.args.slice(1),
					],
				},
				...rest,
			),
	};
});

// B2 owns display. These two tiny registered nodes exercise the authored graph
// without embedding a human protocol or status semantics in the agent/runtime.
let answer: (() => void) | undefined;
nodeRegistry.register({
	type: "test-agent-status",
	schema: z.object({ ...stepFields, type: z.literal("test-agent-status") }),
	category: "logic",
	effect: "pure",
	builder: { label: "Status", icon: "?", paletteGroup: "logic", defaults: {} },
	execute: (ctx) => ({ needsInput: ctx.reads.value === "needs-input" }),
});
nodeRegistry.register({
	type: "test-agent-input",
	schema: z.object({ ...stepFields, type: z.literal("test-agent-input") }),
	category: "display",
	effect: "human",
	builder: { label: "Answer", icon: "?", paletteGroup: "logic", defaults: {} },
	execute: (ctx) =>
		ctx.phase("waiting-human", async () => {
			expect(ctx.reads.document).toEqual({ title: "Choose a value" });
			await new Promise<void>((resolve, reject) => {
				answer = resolve;
				ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), {
					once: true,
				});
			});
			return { answer: "Use the saved value" };
		}),
});

nodeRegistry.register({
	type: "test-agent-round",
	schema: z.object({ ...stepFields, type: z.literal("test-agent-round") }),
	category: "logic",
	effect: "human",
	builder: { label: "Round", icon: "?", paletteGroup: "logic", defaults: {} },
	execute: async (ctx) => {
		if (ctx.run.history.some((entry) => entry.step === "again"))
			return { again: false };
		await ctx.phase(
			"waiting-human",
			() =>
				new Promise<void>((resolve, reject) => {
					answer = resolve;
					ctx.signal.addEventListener(
						"abort",
						() => reject(ctx.signal.reason),
						{ once: true },
					);
				}),
		);
		return { again: true };
	},
});

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	answer = undefined;
});

function fixture(runnerType: RunnerType = "codex") {
	const home = mkdtempSync(join(tmpdir(), "agent-node-"));
	homes.push(home);
	const workspace = join(home, "repo");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
	git("init", "-b", "main");
	writeFileSync(join(workspace, "proof.txt"), "Recorded evidence\n");
	git("add", ".");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Fixture [skip ci]",
	);
	const turns: {
		runner: RunnerType;
		resume?: string;
		model?: string;
		instruction?: string;
		prompt: string;
		snapshot: unknown;
	}[] = [];
	let output: (turn: number) => unknown = (turn) =>
		turn === 1
			? { status: "needs-input", display: { title: "Choose a value" } }
			: { status: "completed", value: "Use the saved value" };
	let defaultRunner = runnerType;
	let resumeError: string | undefined;
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
		agentSessionManager: {
			getSession: () => ({}),
			addAgentRunner: vi.fn(),
			markFactoryMessage: vi.fn(),
		},
		repositories: new Map([
			[
				"repo",
				{
					id: "repo",
					name: "Repo",
					repositoryPath: workspace,
					isActive: true,
					baseBranch: "main",
				},
			],
		]),
		factoryHome: home,
		runnerSlots: new SessionSemaphore(1),
		buildAgentRunnerConfig: async (
			_session: unknown,
			_repo: unknown,
			_id: unknown,
			instruction: string,
		) => ({
			runnerType: defaultRunner,
			config: {
				model: "fixture",
				workingDirectory: workspace,
				appendSystemPrompt: instruction,
			},
		}),
		buildAllowedTools: () => [],
		buildDisallowedTools: () => [],
		getDefaultFallbackModelForRunner: () => undefined,
		getDefaultModelForRunner: () => "fixture",
		saveFactorySession: vi.fn(),
		buildRunnerForType: (type: RunnerType, config: AgentRunnerConfig) => {
			let result: unknown;
			return {
				start: async (prompt: string) => {
					turns.push({
						runner: type,
						resume: config.resumeSessionId,
						model: config.model,
						instruction: config.appendSystemPrompt,
						prompt,
						snapshot: loadFactoryContextSnapshot(
							(
								config.mcpConfig!["factory-context"] as { args: string[] }
							).args.at(-1)!,
						),
					});
					if (config.resumeSessionId && resumeError)
						throw new Error(resumeError);
					await config.onMessage?.({
						type: "system",
						subtype: "init",
						session_id:
							config.resumeSessionId ?? `native-${type}-${turns.length}`,
					} as never);
					result = output(turns.length);
				},
				stop: vi.fn(),
				getMessages: () => [{ type: "result", result: JSON.stringify(result) }],
			};
		},
	});
	const hooks = {
		agent: (ctx: ExecutionContext) => worker.executeFactoryAgent(ctx),
	};
	const runtime = (overrides: Partial<RuntimeHooks> = {}) => {
		const value = new WorkflowRuntime(home, { ...hooks, ...overrides });
		runtimes.push(value);
		return value;
	};
	return {
		home,
		workspace,
		turns,
		runtime,
		worker,
		setDefaultRunner: (next: RunnerType) => {
			defaultRunner = next;
		},
		setResumeError: (next: string) => {
			resumeError = next;
		},
		setOutput: (next: typeof output) => {
			output = next;
		},
	};
}

it("starts a fresh conversation on a revisit when session is omitted", async () => {
	const f = fixture();
	const definition = structuredClone(recipe);
	delete (definition.steps[0] as { session?: string }).session;
	const workflow = WorkflowSchema.parse({ ...definition, convergence: {} });
	expect(workflow.steps[0]!.session).toBe("fresh");
	const runtime = f.runtime();
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() =>
		expect(
			answer,
			JSON.stringify({ status: run.status, error: run.error }),
		).toBeTypeOf("function"),
	);
	answer!();
	await waitForRuntime(() => expect(run.status).toBe("completed"));
	expect(f.turns.map((turn) => turn.resume)).toEqual([undefined, undefined]);
});

it("corrects failed verify evidence in the same native conversation even for session=fresh", async () => {
	const f = fixture();
	f.setOutput((turn) => ({
		files: [turn === 1 ? "missing.txt" : "proof.txt"],
	}));
	const workflow = WorkflowSchema.parse({
		id: "evidence",
		name: "Evidence",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "produce",
				name: "Produce",
				type: "agent",
				prompt: "Return existing files",
				session: "fresh",
				verify: [{ check: "files-exist", path: "/files/*" }],
				next: "end",
			},
		],
	});
	const runtime = f.runtime();
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Produce",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	await runtime.launch(run);
	expect([run.status, run.error]).toEqual(["completed", undefined]);
	expect(run.outputs.produce).toEqual({ files: ["proof.txt"] });
	expect(f.turns.map((turn) => turn.resume)).toEqual([
		undefined,
		"native-codex-1",
	]);
	expect(f.turns[1]!.prompt).toContain(
		"The previous output failed validation.",
	);
	expect(JSON.stringify(f.turns[1]!.snapshot)).toContain("files-exist:");
});

it.each([
	"qaContract",
	"videoContract",
	"impactContract",
	"impact",
	"architectureSource",
	"architectureContract",
	"architectureBrief",
	"reviewContract",
	"guideContract",
	"review",
	"impactSource",
	"inputs",
	"askQuestions",
	"view",
	"checks",
])("rejects legacy agent %s in new definitions with a useful error", (key) => {
	const definition = structuredClone(recipe);
	Object.assign(definition.steps[0]!, {
		[key]: key === "askQuestions" ? false : "legacy",
	});
	expect(() => WorkflowSchema.parse(definition)).toThrow(
		`New agent nodes do not support ${key}`,
	);
});

it.each([
	{ check: "review-evidence", path: "/files/*" },
	{ check: "files-exist" },
	{ check: "media-valid", path: "/images/*", adapter: "guide" },
])("rejects invalid verification %j at definition time", (verify) => {
	const definition = structuredClone(recipe);
	Object.assign(definition.steps[0]!, { verify: [verify] });
	expect(() => WorkflowSchema.parse(definition)).toThrow();
});

it("preserves the new definition contract through serialization and builder projection", () => {
	const workflow = WorkflowSchema.parse(recipe);
	const copy = WorkflowSchema.parse(
		JSON.parse(JSON.stringify(materializeWorkflowConfig(workflow))),
	);
	expect(copy).toEqual(workflow);
	expect(copy.steps[0]).not.toHaveProperty("askQuestions");
	expect(copy.steps[0]).not.toHaveProperty("checks");
	const html = renderToStaticMarkup(
		createElement(AgentStepSettings, {
			step: copy.steps[0]!,
			newEngine: true,
			readOnly: false,
			onChange: () => {},
			onError: () => {},
		}),
	);
	expect(html).toContain('aria-label="Session"');
	expect(html).toContain('aria-label="Verify"');
	expect(html).not.toContain('aria-label="Checks"');
});

it("keeps large and native transcript reads on the scoped MCP connection", () => {
	const workflow = WorkflowSchema.parse({
		...recipe,
		steps: [
			{
				...recipe.steps[0],
				reads: {
					small: "human/answer",
					large: "human/document",
					raw: "@transcripts",
					selected: "@callInputs/value",
				},
			},
		],
	});
	const input = {
		small: "new answer",
		large: "x".repeat(10000),
		raw: { private: "native buffer" },
		selected: "scoped native text",
	};
	runtimeTranscriptField(input, "selected", {
		runId: "r",
		role: "previous",
		start: 0,
		end: 1,
	});
	const reads = nativeAgentReads(workflow.steps[0]!, input);
	expect(reads).toEqual({
		small: "new answer",
		large: {
			contextPath: "/large",
			from: "human/document",
			readWith: "factory-context read_context",
		},
		raw: {
			contextPath: "/raw",
			from: "@transcripts",
			readWith: "factory-context read_context",
		},
		selected: {
			contextPath: "/selected",
			from: "@callInputs/value",
			readWith: "factory-context read_context",
		},
	});
});

it("continues with a warning if a revisited resume node has no native session", async () => {
	const f = fixture();
	f.setOutput(() => ({ status: "completed" }));
	const runtime = new WorkflowRuntime(f.home, {
		agent: async (ctx) =>
			ctx.resumeFallback
				? f.worker.executeFactoryAgent(ctx)
				: { status: "needs-input", display: { title: "Choose a value" } },
	});
	runtimes.push(runtime);
	const workflow = WorkflowSchema.parse(recipe);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(answer).toBeTypeOf("function"));
	answer!();
	await waitForRuntime(() => expect(run.status).toBe("completed"));
	expect(run.error).toBeUndefined();
	expect(f.turns[0]!.resume).toBeUndefined();
	expect(f.turns[0]!.prompt).toContain(
		'Previous output (JSON):\n{"status":"needs-input","display":{"title":"Choose a value"}}',
	);
	expect(
		run.events.some(
			(event) =>
				event.message.includes("Warning:") &&
				event.message.includes("not retained"),
		),
	).toBe(true);
});

it("uses the saved runner and model when current defaults have changed", async () => {
	const f = fixture();
	f.setOutput(() => ({ status: "completed" }));
	const runtime = f.runtime({
		agent: async (ctx) => {
			ctx.resumeAgent = {
				runner: "claude",
				model: "saved-model",
				sessionId: "claude-native",
			};
			return f.worker.executeFactoryAgent(ctx);
		},
	});
	const workflow = WorkflowSchema.parse({
		id: "saved-settings",
		name: "Saved settings",
		engineVersion: "nodes-v1",
		steps: [nestedAgent],
	});
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	await runtime.launch(run);
	expect([run.status, run.error]).toEqual(["completed", undefined]);
	expect(
		f.turns.map(({ runner, model, resume }) => ({ runner, model, resume })),
	).toEqual([
		{ runner: "claude", model: "saved-model", resume: "claude-native" },
	]);
});

const nestedAgent = {
	id: "compose",
	name: "Compose",
	type: "agent",
	prompt: "Inspect current data",
	session: "resume",
	reads: { data: "@launchInputs/data" },
	next: "end",
};

it.each([
	"fanout",
	"foreach",
	"workflow",
] as const)("resumes each structural agent in a revisited %s after cold restart", async (kind) => {
	const f = fixture();
	f.setOutput((turn) => ({ turn }));
	let runtime = f.runtime();
	const child = WorkflowSchema.parse({
		id: "child",
		name: "Child",
		engineVersion: "nodes-v1",
		triggers: ["workflow"],
		steps: [nestedAgent],
	});
	const enclosing =
		kind === "fanout"
			? {
					type: "fanout",
					groups: [
						[{ ...nestedAgent, id: "left" }],
						[{ ...nestedAgent, id: "right" }],
					],
				}
			: kind === "foreach"
				? {
						type: "foreach",
						items: { values: [{ id: "alpha" }, { id: "beta" }] },
						concurrency: 1,
						body: [nestedAgent],
					}
				: { type: "workflow", workflow: "child" };
	const workflow = WorkflowSchema.parse({
		id: "nested-resume",
		name: "Nested resume",
		engineVersion: "nodes-v1",
		steps: [
			{ id: "nested", name: "Nested", ...enclosing, next: "again" },
			{
				id: "again",
				name: "Again",
				type: "test-agent-round",
				branches: [{ when: { path: "again", equals: true }, next: "nested" }],
				next: "end",
			},
		],
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow, child]);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Review",
		launchInputs: { data: "current-value" },
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(answer, run.error).toBeTypeOf("function"));
	const count = kind === "workflow" ? 1 : 2;
	expect(f.turns).toHaveLength(count);
	expect(f.turns.every((turn) => turn.resume === undefined)).toBe(true);
	runtime.stop(run.id);
	await runtime.shutdown();
	answer = undefined;
	// Manual launches can have no frozen run.runner; a changed repository default must not change the saved session's runner/model.
	f.setDefaultRunner("claude");
	runtime = f.runtime();
	runtime.resume(run.id);
	await waitForRuntime(() =>
		expect(answer, runtime.get(run.id).error).toBeTypeOf("function"),
	);
	answer!();
	await waitForRuntime(() =>
		expect(runtime.get(run.id).status, runtime.get(run.id).error).toBe(
			"completed",
		),
	);
	expect(f.turns).toHaveLength(2 * count);
	expect(f.turns.slice(count).map((turn) => turn.resume)).toEqual(
		Array.from({ length: count }, (_, index) => `native-codex-${index + 1}`),
	);
	for (const turn of f.turns) {
		expect(turn.runner).toBe("codex");
		expect(turn.model).toBe("fixture");
		expect(turn.instruction).toContain(
			"Execute the configured agent node: Compose.",
		);
		expect(turn.prompt).toContain(
			'Current reads (JSON):\n{"data":"current-value"}',
		);
	}
});

it.each([
	false,
	true,
])("preserves cloned foreach agent reads and ids-resolve (restart=%s)", async (restart) => {
	const f = fixture();
	f.setOutput(() => ({ selected: ["allowed"] }));
	let paused = false;
	let runtime = f.runtime(
		restart
			? {
					agent: async (ctx) => {
						paused = true;
						await new Promise<void>((_resolve, reject) =>
							ctx.signal.addEventListener(
								"abort",
								() => reject(ctx.signal.reason),
								{
									once: true,
								},
							),
						);
					},
				}
			: {},
	);
	const workflow = WorkflowSchema.parse({
		id: "foreach-restart",
		name: "Restart",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "each",
				name: "Each",
				type: "foreach",
				items: { values: [{ id: "alpha", ids: ["allowed"] }] },
				body: [
					{
						...nestedAgent,
						reads: { item: "@item" },
						verify: [
							{
								check: "ids-resolve",
								path: "/selected/*",
								source: "item",
								ids: "/ids/*",
							},
						],
					},
				],
			},
		],
	});
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Inspect",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	if (restart) {
		await waitForRuntime(() => expect(paused).toBe(true));
		await runtime.shutdown();
		runtime = f.runtime();
		runtime.resumeAll();
	}
	await waitForRuntime(() =>
		expect(runtime.get(run.id).status, runtime.get(run.id).error).toBe(
			"completed",
		),
	);
	expect(f.turns).toHaveLength(1);
	expect(f.turns[0]!.instruction).toContain(
		"Execute the configured agent node: Compose.",
	);
	expect(f.turns[0]!.prompt).toContain(
		'Current reads (JSON):\n{"item":{"id":"alpha","ids":["allowed"]}}',
	);
	expect(runtime.get(run.id).outputs.each).toMatchObject({
		results: { alpha: { compose: { selected: ["allowed"] } } },
	});
});

it.each([
	"thread/resume failed: no rollout found for thread id native-codex-1",
	"spawn codex ENOENT",
])("falls back once to fresh context when resume fails: %s", async (failure) => {
	const f = fixture();
	const runtime = f.runtime();
	const workflow = WorkflowSchema.parse(recipe);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() => expect(answer, run.error).toBeTypeOf("function"));
	f.setResumeError(failure);
	if (failure.includes("ENOENT")) f.setDefaultRunner("claude");
	answer!();
	await waitForRuntime(() => expect(run.status, run.error).toBe("completed"));
	expect(f.turns.map((turn) => turn.resume)).toEqual([
		undefined,
		"native-codex-1",
		undefined,
	]);
	expect(f.turns[2]!.runner).toBe(
		failure.includes("ENOENT") ? "claude" : "codex",
	);
	expect(f.turns[2]!.prompt).toContain(
		'Previous output (JSON):\n{"status":"needs-input","display":{"title":"Choose a value"}}',
	);
	expect(f.turns[2]!.prompt).toContain(
		'Current reads (JSON):\n{"answer":"Use the saved value"}',
	);
	expect(
		run.events.some((event) =>
			event.message.includes("Warning: native session cannot be resumed"),
		),
	).toBe(true);
});

it.each([
	"fresh",
	"resume",
])("respects session=%s when a stale bound producer is refreshed", async (session) => {
	const f = fixture();
	f.setOutput((turn) => {
		if (turn === 2) {
			writeFileSync(join(f.workspace, "proof.txt"), "Changed revision\n");
			execFileSync("git", ["add", "."], { cwd: f.workspace });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Fixture",
					"-c",
					"user.email=fixture@example.invalid",
					"-c",
					"commit.gpgsign=false",
					"commit",
					"-m",
					"Change [skip ci]",
				],
				{ cwd: f.workspace },
			);
		}
		return { receipt: turn };
	});
	const runtime = f.runtime();
	const workflow = WorkflowSchema.parse({
		id: "freshness",
		name: "Freshness",
		engineVersion: "nodes-v1",
		steps: [
			{
				...nestedAgent,
				id: "inspection",
				revision: "bound",
				session,
				next: "mutate",
			},
			{ ...nestedAgent, id: "mutate", session: "fresh", next: "consume" },
			{
				...nestedAgent,
				id: "consume",
				reads: { source: "inspection" },
				session: "fresh",
				next: "end",
			},
		],
	});
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Inspect",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	await runtime.launch(run);
	expect([run.status, run.error]).toEqual(["completed", undefined]);
	expect(f.turns.map((turn) => turn.resume)).toEqual([
		undefined,
		undefined,
		session === "resume" ? "native-codex-1" : undefined,
		undefined,
	]);
	expect(f.turns[3]!.prompt).toContain(
		'Current reads (JSON):\n{"source":{"receipt":3}}',
	);
});
