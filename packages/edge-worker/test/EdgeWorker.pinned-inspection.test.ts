import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFactoryContextSnapshot } from "bobs-factory-mcp-tools";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { StaleBoundInspectionError } from "../src/factory/RevisionBinding.js";
import { WorkflowSchema, type WorkflowStep } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";

const directories: string[] = [],
	runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
type Turn = {
	turn: number;
	context: ExecutionContext;
	commit: (index?: number) => string;
};
function fixture(
	grouped = false,
	onTurn?: (turn: Turn) => unknown,
	stepOptions: Partial<WorkflowStep> = {},
) {
	const home = mkdtempSync(join(tmpdir(), "pinned-inspection-"));
	directories.push(home);
	const git = (workspace: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd: workspace,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	const repositories = Array.from({ length: grouped ? 2 : 1 }, (_, index) => {
		const workspace = join(home, `repo-${index}`);
		mkdirSync(workspace);
		git(workspace, "init", "-b", "main");
		git(workspace, "config", "user.name", "Fixture");
		git(workspace, "config", "user.email", "fixture@example.invalid");
		git(workspace, "config", "commit.gpgsign", "false");
		writeFileSync(join(workspace, "record.txt"), "Snapshot A\n");
		git(workspace, "add", ".");
		git(workspace, "commit", "-m", "Snapshot A");
		return {
			id: `repo-${index}`,
			name: `Repo ${index}`,
			workspace,
			repositoryPath: workspace,
			baseBranch: "main",
			isActive: true,
		};
	});
	const original = repositories.map((repository) =>
		git(repository.workspace, "rev-parse", "HEAD"),
	);
	const commit = (index = repositories.length - 1) => {
		const workspace = repositories[index]!.workspace;
		writeFileSync(join(workspace, "record.txt"), "Snapshot B\n");
		git(workspace, "add", ".");
		git(workspace, "commit", "-m", "Concurrent snapshot B");
		return git(workspace, "rev-parse", "HEAD");
	};
	const workflow = WorkflowSchema.parse({
		id: "pinned-review",
		name: "Pinned review",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "inspect",
				name: "Inspect",
				type: "agent",
				prompt: "Inspect the pinned repository snapshots",
				revision: "bound",
				access: "read-only",
				output: {
					schema: {
						type: "object",
						properties: {
							inspectedHeads: { type: "array", items: { type: "string" } },
							accepted: { type: "boolean" },
						},
						required: ["inspectedHeads", "accepted"],
						additionalProperties: false,
					},
				},
				next: "end",
				...stepOptions,
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
		repositoryId: repositories[0]!.id,
		repositories: grouped ? repositories : undefined,
		workspace: repositories[0]!.workspace,
		workflow,
		input: "Inspect the code",
		runner: "codex",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	run.step = "inspect";
	const evidenceDir = join(home, "evidence");
	mkdirSync(evidenceDir);
	const checkpoints: NonNullable<ExecutionContext["resumeAgent"]>[] = [];
	const context = (
		resumeAgent?: ExecutionContext["resumeAgent"],
	): ExecutionContext => ({
		run,
		step: workflow.steps[0]!,
		stepKey: "inspect",
		outputs: run.outputs,
		input: { request: "Inspect the code" },
		evidenceDir,
		log: () => {},
		signal: new AbortController().signal,
		resumeAgent,
		checkpointAgent: async (checkpoint) => {
			checkpoints.push(structuredClone(checkpoint));
		},
	});
	let current: ExecutionContext;
	let config: {
		onMessage: (message: unknown) => unknown;
		mcpConfig: Record<string, { args: string[] }>;
	};
	let output: unknown;
	const starts: string[][] = [];
	const inputs: unknown[] = [];
	const runner = {
		start: vi.fn(async () => {
			starts.push(
				current.researchAccess!.repositories.map(
					(repository) => repository.revision,
				),
			);
			await config.onMessage({
				type: "system",
				subtype: "init",
				session_id: "pinned-session",
			});
			inputs.push(
				loadFactoryContextSnapshot(
					config.mcpConfig["factory-context"]!.args.at(-1)!,
				),
			);
			output = onTurn?.({ turn: starts.length, context: current, commit }) ?? {
				inspectedHeads: starts.at(-1),
				accepted: true,
			};
		}),
		stop: vi.fn(),
		getMessages: () => [{ type: "result", result: JSON.stringify(output) }],
	};
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
		agentSessionManager: {
			getSession: () => ({}),
			addAgentRunner: vi.fn(),
			markFactoryMessage: vi.fn(),
		},
		repositories: new Map(
			repositories.map((repository) => [repository.id, repository]),
		),
		factoryHome: home,
		runnerSlots: new SessionSemaphore(1),
		buildAgentRunnerConfig: async () => ({
			runnerType: "codex",
			config: { model: "fixture", workingDirectory: run.workspace },
		}),
		buildAllowedTools: () => [],
		buildDisallowedTools: () => [],
		getDefaultFallbackModelForRunner: () => undefined,
		saveFactorySession: () => {},
		buildRunnerForType: (_type: unknown, value: typeof config) => {
			config = value;
			return runner;
		},
	});
	return {
		original,
		repositories,
		run,
		starts,
		inputs,
		checkpoints,
		commit,
		runner,
		context,
		execute: async (value: ExecutionContext) => {
			current = value;
			return worker.executeFactoryAgent(value);
		},
	};
}
it.each([
	false,
	true,
])("rejects a concurrent repository commit without relabeling pinned A output as snapshot B (grouped=%s)", async (grouped) => {
	const f = fixture(grouped, ({ commit }) => {
		commit();
	});
	const context = f.context();
	await expect(f.execute(context)).rejects.toBeInstanceOf(
		StaleBoundInspectionError,
	);
	expect(f.starts).toEqual([f.original]);
	expect(
		context.researchAccess!.repositories.map(
			(repository) => repository.revision,
		),
	).toEqual(f.original);
	expect(
		context.inspectionBinding!.repositories.map(
			(repository) => repository.headSha,
		),
	).toEqual(f.original);
	for (const checkpoint of f.checkpoints) {
		if (checkpoint.result)
			expect(
				checkpoint.result.binding!.repositories.map(
					(repository) => repository.headSha,
				),
			).toEqual(f.original);
	}
	expect(f.runner.start).toHaveBeenCalledOnce();
});
it("keeps the original pin throughout schema correction and rejects drift during its corrective turn", async () => {
	const f = fixture(false, ({ turn, commit, context }) => {
		if (turn === 1)
			return {
				inspectedHeads: context.researchAccess!.repositories.map(
					(repository) => repository.revision,
				),
				accepted: "invalid boolean",
			};
		commit();
		return {
			inspectedHeads: context.researchAccess!.repositories.map(
				(repository) => repository.revision,
			),
			accepted: true,
		};
	});
	const context = f.context();
	await expect(f.execute(context)).rejects.toBeInstanceOf(
		StaleBoundInspectionError,
	);
	expect(f.starts).toEqual([f.original, f.original]);
	expect(f.checkpoints.some((checkpoint) => checkpoint.rejected)).toBe(true);
	expect(
		context.inspectionBinding!.repositories.map(
			(repository) => repository.headSha,
		),
	).toEqual(f.original);
	for (const checkpoint of f.checkpoints) {
		if (checkpoint.result)
			expect(
				checkpoint.result.binding!.repositories.map(
					(repository) => repository.headSha,
				),
			).toEqual(f.original);
	}
});
it("retains the saved start snapshot across JSON restart and refuses to trust it after repository drift", async () => {
	const f = fixture(true);
	const original = f.context();
	await expect(f.execute(original)).resolves.toEqual({
		inspectedHeads: f.original,
		accepted: true,
	});
	const saved = JSON.parse(JSON.stringify(original.resumeAgent)) as NonNullable<
		ExecutionContext["resumeAgent"]
	>;
	expect(
		saved.inspection!.repositories.map((repository) => repository.headSha),
	).toEqual(f.original);
	expect(
		saved.result!.binding!.repositories.map((repository) => repository.headSha),
	).toEqual(f.original);
	f.commit();
	const resumed = f.context(saved);
	await expect(f.execute(resumed)).rejects.toBeInstanceOf(
		StaleBoundInspectionError,
	);
	expect(
		resumed.inspectionBinding!.repositories.map(
			(repository) => repository.headSha,
		),
	).toEqual(f.original);
	expect(f.runner.start).toHaveBeenCalledOnce();
});

it.each([
	false,
	true,
])("binds the actual feedback supplied to a native turn and rejects concurrent feedback drift (changed=%s)", async (changed) => {
	const f = fixture(
		false,
		({ context }) => {
			if (changed)
				context.run.mergeReadiness = {
					...context.run.mergeReadiness!,
					headSha: "provider-B",
				};
		},
		{
			output: undefined,
			reads: { feedback: "@feedback" },
			checks: ["feedback-assessment"],
		},
	);
	const context = f.context();
	context.run.mergeReadiness = {
		headSha: "provider-A",
		baseSha: "base",
		url: "https://github.com/fixture/repo/pull/1",
		state: "OPEN",
		isDraft: false,
		approved: false,
		reviewReady: true,
		fix: false,
		blockers: [],
		checks: [],
		threads: [],
		comments: [],
		reviews: [],
		queued: false,
		mergeMethod: "squash",
	};
	if (changed)
		await expect(f.execute(context)).rejects.toBeInstanceOf(
			StaleBoundInspectionError,
		);
	else
		await expect(f.execute(context)).resolves.toMatchObject({
			accepted: true,
			feedbackAssessment: { headSha: "provider-A" },
		});
	expect(f.inputs).toHaveLength(1);
	expect(f.inputs[0]).toMatchObject({
		feedback: { readiness: { headSha: "provider-A" } },
	});
});
