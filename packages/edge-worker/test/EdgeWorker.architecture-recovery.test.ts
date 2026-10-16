import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import type {
	ExecutionContext,
	FactoryRun,
} from "../src/factory/WorkflowRuntime.js";
import { proposal } from "./fixtures/architecture.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function fixture() {
	const workspace = mkdtempSync(join(tmpdir(), "architecture-retry-"));
	homes.push(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-q");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--allow-empty",
		"-qm",
		"Fixture",
	);
	const workflow = WorkflowSchema.parse({
		id: "architecture-retry",
		name: "Architecture retry",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "architecture",
				name: "Architecture",
				type: "agent",
				architectureContract: "architecture-v1",
				architectureBrief: "review-v1",
				prompt: "Retain the complete plan",
			},
		],
	});
	const output = proposal();
	output.candidate.steps = Array.from({ length: 33 }, (_, i) => ({
		...output.candidate.steps[0]!,
		id: `D${i + 1}`,
	}));
	const context: ExecutionContext = {
		run: {
			id: "retained-architecture",
			repositoryId: "repo",
			workspace,
			workflow,
			history: [],
			outputs: {},
			answers: [],
		} as unknown as FactoryRun,
		step: workflow.steps[0]!,
		input: {},
		signal: new AbortController().signal,
		evidenceDir: workspace,
		log: vi.fn(),
		checkpointAgent: vi.fn(),
		resumeAgent: {
			runner: "codex",
			sessionId: "retained-native-session",
			infrastructureFailure: {
				reason: "Old schema cannot represent the plan",
				at: new Date().toISOString(),
			},
			rejected: {
				output,
				issues: [
					{
						path: "/candidate/steps",
						message: "Too big: expected array to have <=15 items",
					},
				],
				revision: {
					headSha: git("rev-parse", "HEAD"),
					dirty: false,
					historyLength: 0,
					at: new Date().toISOString(),
				},
				attempts: 0,
				retryGeneration: 1,
			},
		},
	};
	const worker = Object.create(EdgeWorker.prototype) as {
		revalidateRetriedArchitecture(context: ExecutionContext): Promise<void>;
	};
	return { workspace, context, worker };
}

it("revalidates a retained architecture after an explicit retry under the current contract, without losing its native session", async () => {
	const { context, worker } = fixture();
	const saved = structuredClone(context.resumeAgent!);
	await worker.revalidateRetriedArchitecture(context);
	expect(context.resumeAgent).toEqual({
		runner: saved.runner,
		sessionId: saved.sessionId,
		result: {
			output: saved.rejected!.output,
			revision: saved.rejected!.revision,
			finalizing: true,
		},
	});
	expect(context.checkpointAgent).toHaveBeenCalledExactlyOnceWith(
		context.resumeAgent,
	);
});

it.each([
	"no-retry",
	"stale",
	"dirty",
	"dirty-saved",
	"invalid",
	"capture",
])("preserves rejected output for normal correction when %s", async (reason) => {
	const { workspace, context, worker } = fixture();
	const rejected = context.resumeAgent!.rejected!;
	if (reason === "no-retry") rejected.retryGeneration = 0;
	if (reason === "stale") rejected.revision!.headSha = "old-head";
	if (reason === "dirty")
		writeFileSync(join(workspace, "new.txt"), "Uncommitted work");
	if (reason === "dirty-saved") rejected.revision!.dirty = true;
	if (reason === "invalid")
		rejected.output = { architectureContract: "architecture-v1" };
	if (reason === "capture") {
		context.step.architectureContract = undefined;
		context.step.id = "capture";
	}
	const saved = structuredClone(context.resumeAgent);
	await worker.revalidateRetriedArchitecture(context);
	expect(context.resumeAgent).toEqual(saved);
	expect(context.checkpointAgent).not.toHaveBeenCalled();
});
