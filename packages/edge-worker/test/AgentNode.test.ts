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
import {
	factoryRoleInstruction,
	nativeAgentReads,
	withRuntimeRolePrompt,
} from "../src/factory/RolePrompt.js";
import { materializeWorkflowConfig } from "../src/factory/StepConfig.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
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
		prompt: string;
		snapshot: unknown;
	}[] = [];
	let output: (turn: number) => unknown = (turn) =>
		turn === 1
			? { status: "needs-input", display: { title: "Choose a value" } }
			: { status: "completed", value: "Use the saved value" };
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
			runnerType,
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
						prompt,
						snapshot: loadFactoryContextSnapshot(
							(
								config.mcpConfig!["factory-context"] as { args: string[] }
							).args.at(-1)!,
						),
					});
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
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = () => {
		const value = new WorkflowRuntime(home, hooks);
		runtimes.push(value);
		return value;
	};
	return {
		home,
		workspace,
		turns,
		runtime,
		worker,
		setOutput: (next: typeof output) => {
			output = next;
		},
	};
}

it.each([
	"claude",
	"codex",
	"gemini",
	"cursor",
	"opencode",
] as const)("resumes the %s node after a separate human node and a cold restart, with new reads in the new message", async (runner) => {
	const f = fixture(runner);
	let runtime = f.runtime();
	const workflow = WorkflowSchema.parse(recipe);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		runner,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	void runtime.launch(run);
	await waitForRuntime(() =>
		expect(
			answer,
			JSON.stringify({ status: run.status, error: run.error }),
		).toBeTypeOf("function"),
	);
	expect(f.turns).toHaveLength(1);
	expect(run.questions).toEqual([]);
	await runtime.flush(run.id);
	runtime.stop(run.id);
	await runtime.shutdown();
	answer = undefined;
	runtime = f.runtime();
	runtime.resume(run.id);
	await waitForRuntime(() =>
		expect(
			answer,
			JSON.stringify({ status: run.status, error: run.error }),
		).toBeTypeOf("function"),
	);
	answer!();
	await waitForRuntime(() =>
		expect(runtime.get(run.id).status).toBe("completed"),
	);
	expect(runtime.get(run.id).error).toBeUndefined();
	expect(f.turns.map(({ runner, resume }) => ({ runner, resume }))).toEqual([
		{ runner, resume: undefined },
		{ runner, resume: `native-${runner}-1` },
	]);
	expect(f.turns[1]!.prompt).toContain(
		'Current reads (JSON):\n{"answer":"Use the saved value"}',
	);
	expect(runtime.get(run.id).history.map((entry) => entry.step)).toEqual([
		"compose",
		"status",
		"human",
		"compose",
		"status",
	]);
});

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

it("keeps new agent instructions generic even when runtime legacy additions are requested", () => {
	const step = WorkflowSchema.parse(recipe).steps[0]!;
	const augmented = withRuntimeRolePrompt(step, [], {
		assessedCorrection: true,
		calibratedReview: true,
	});
	expect(augmented).toBe(step);
	expect(
		factoryRoleInstruction(augmented, {
			repositoryScope: "<workspace>",
			gitProvider: "",
			customProviderInstructions: "",
			ticket: "",
			questions: "legacy human UI",
		}),
	).toBe(
		`Execute the configured agent node: Compose.\n${step.prompt}\n\n<workspace>\nReturn JSON matching the configured output schema and rules.`,
	);
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

it("fails explicitly if a revisited resume node has no native session", async () => {
	const f = fixture();
	const runtime = new WorkflowRuntime(f.home, {
		agent: async () => ({
			status: "needs-input",
			display: { title: "Choose a value" },
		}),
		script: async () => ({}),
		tool: async () => ({}),
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
	await waitForRuntime(() => expect(run.status).toBe("failed"));
	expect(run.error).toContain(
		"previous visit did not retain a native session ID",
	);
});

it("rejects cross-runner native session reuse before launching another runner", async () => {
	const f = fixture("codex");
	const runtime = f.runtime();
	const workflow = WorkflowSchema.parse(recipe);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.workspace,
		workflow,
		input: "Compose",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	await expect(
		f.worker.executeFactoryAgent({
			run,
			step: workflow.steps[0]!,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: join(f.home, "evidence"),
			resumeAgent: { runner: "claude", sessionId: "claude-native" },
		}),
	).rejects.toThrow("Cannot resume claude session with codex");
	expect(f.turns).toHaveLength(0);
});
