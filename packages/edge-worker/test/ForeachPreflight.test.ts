import { immutableJson, type RunnerType } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { validateProfileRunner } from "../src/factory/ExecutionCapabilities.js";
import type { ResolvedExecutionEnvironment } from "../src/factory/ExecutionEnvironment.js";
import { type Workflow, WorkflowSchema } from "../src/factory/Workflow.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

// Preserve the actual traversal and role-settings validation. Only the external
// capability boundary is mocked; no provider executable or auth store is used.
vi.mock("../src/factory/ExecutionCapabilities.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../src/factory/ExecutionCapabilities.js")
	>()),
	validateProfileRunner: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

interface PreflightWorker {
	factoryHome: string;
	runnerSelectionService: { getDefaultRunner(): RunnerType };
	getDefaultModelForRunner(runner: RunnerType): string;
	getFactoryRuntime(): {
		resolveTitleSettings(): { runner: RunnerType; model: string };
	};
	resolveRunExecution(
		run: FactoryRun,
		runner: RunnerType,
	): Promise<ResolvedExecutionEnvironment | undefined>;
	preflightExecution(
		run: FactoryRun,
		workflow: Workflow,
		definitions: Workflow[],
	): Promise<void>;
}
function fixture(workflow: Workflow) {
	const resolveRunExecution = vi.fn(
		async (_run: FactoryRun, _runner: RunnerType) => undefined,
	);
	const worker: PreflightWorker = Object.assign(
		Object.create(EdgeWorker.prototype),
		{
			factoryHome: "/fixture/bobs-factory",
			runnerSelectionService: { getDefaultRunner: () => "codex" as const },
			getDefaultModelForRunner: (runner: RunnerType) => `default-${runner}`,
			getFactoryRuntime: () => ({
				resolveTitleSettings: () => ({
					runner: "gemini" as const,
					model: "title-model",
				}),
			}),
			resolveRunExecution,
		},
	);
	const run: FactoryRun = {
		id: "foreach-preflight",
		title: "Preflight fixture",
		repositoryId: "fixture",
		workflow,
		workflowDefinitions: [workflow],
		status: "running",
		createdAt: "2026-10-22T00:00:00.000Z",
		updatedAt: "2026-10-22T00:00:00.000Z",
		workspace: "/fixture/worktree",
		input: "Controlled fixture",
		runner: "codex",
		model: "accepted-codex-model",
		executionSnapshot: {
			schemaVersion: 1,
			sources: { identity: "manual", tools: "manual" },
		},
		outputs: {},
		history: [],
		answers: [],
		questions: [],
		events: [],
	};
	return { worker, run, resolveRunExecution };
}
const role = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Fixture",
	...extra,
});
const each = (id: string, body: unknown[]) => ({
	id,
	name: id,
	type: "foreach",
	items: { values: [{ id: "item" }] },
	body,
});

it("preflights every frozen inline, nested, called and title provider, resolving each provider once", async () => {
	const workflow = immutableJson(
		WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "parent",
			name: "Parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				each("outer", [
					role("inline", { runner: "claude", model: "inline-model" }),
					each("nested", [
						{ id: "call", name: "Call", type: "workflow", workflow: "worker" },
						{
							id: "again",
							name: "Again",
							type: "workflow",
							workflow: "worker",
						},
					]),
					role("duplicate-provider", { runner: "claude" }),
				]),
			],
		}),
	);
	const called = immutableJson(
		WorkflowSchema.parse({
			engineVersion: "nodes-v1",
			id: "worker",
			name: "Worker",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [role("different-provider", { runner: "opencode" })],
		}),
	);
	const { worker, run, resolveRunExecution } = fixture(workflow);
	run.workflowDefinitions = [workflow, called];
	await worker.preflightExecution(run, workflow, run.workflowDefinitions);
	expect(vi.mocked(validateProfileRunner).mock.calls).toEqual([
		[
			{ factoryHome: worker.factoryHome, model: "accepted-codex-model" },
			run.executionSnapshot,
			"codex",
		],
		[
			{ factoryHome: worker.factoryHome, model: "inline-model" },
			run.executionSnapshot,
			"claude",
		],
		[
			{ factoryHome: worker.factoryHome, model: "default-opencode" },
			run.executionSnapshot,
			"opencode",
		],
		[
			{ factoryHome: worker.factoryHome, model: "default-claude" },
			run.executionSnapshot,
			"claude",
		],
		[
			{ factoryHome: worker.factoryHome, model: "title-model" },
			run.executionSnapshot,
			"gemini",
		],
	]);
	expect(resolveRunExecution.mock.calls).toEqual([
		[run, "codex"],
		[run, "claude"],
		[run, "opencode"],
		[run, "gemini"],
	]);
});
