import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import * as tools from "../src/factory/FactoryTools.js";
import { pendingMergeConfirmation } from "../src/factory/MergeRecovery.js";
import { resolveStepConfig } from "../src/factory/StepConfig.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import type { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import legacyWorkflows from "./fixtures/legacy-workflows-a4990127.json" with {
	type: "json",
};

const directories: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

async function fixture(modern = false) {
	const home = mkdtempSync(join(tmpdir(), "merge-recovery-"));
	directories.push(home);
	const definitions = modern
		? defaultWorkflows
		: validateWorkflows(structuredClone(legacyWorkflows.default));
	const workflow = definitions.find((item) => item.id === "factory")!;
	const accepted = {
		id: "recover-merge",
		title: "Recover accepted merge",
		repositoryId: "repo",
		workflow,
		workflowDefinitions: definitions,
		workspace: join(home, "deleted-worktree"),
		input: "Task",
		triggerOrigin: {
			type: "manual" as const,
			workflowId: "factory",
			at: "2026-10-06T00:00:00Z",
		},
	};
	if (!modern) {
		mkdirSync(join(home, "factory", "runs"), { recursive: true });
		writeFileSync(
			join(home, "factory", "runs", `${accepted.id}.json`),
			JSON.stringify({
				...accepted,
				status: "failed",
				createdAt: accepted.triggerOrigin.at,
				updatedAt: accepted.triggerOrigin.at,
				outputs: {},
				history: [],
				answers: [],
				questions: [],
				events: [],
			}),
		);
	}
	const worker = new EdgeWorker({
		issueTrackerFactory: createCLIIssueTracker,
		factoryHome: home,
		repositories: [
			{
				id: "repo",
				name: "Repo",
				repositoryPath: home,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
			},
		],
	});
	await (worker as any).runnerSlots.ready();
	const runtime: WorkflowRuntime = (worker as any).getFactoryRuntime();
	const run = modern ? runtime.create(accepted) : runtime.get(accepted.id);
	if (!modern) {
		expect(run.workflow.stepConfigVersion).toBeUndefined();
		const accepted = run.workflowDefinitions!.find(
			(item) => item.id === "factory-pipeline",
		)!;
		expect(accepted.stepConfigVersion).toBeUndefined();
		expect(
			resolveStepConfig(accepted.steps.find((step) => step.id === "merge")!)
				.explicit,
		).toBe(false);
	}
	run.titleGeneration = undefined;
	run.status = "failed";
	run.step = "pipeline/merge";
	const publication = { url: "https://github.com/test/repo/pull/1" };
	run.outputs[modern ? "pipeline/draft-pr" : "draft-pr"] = publication;
	run.history = [
		{ step: "pipeline/draft-pr", output: publication, at: "" },
		{ step: "pipeline/guide", output: { summary: "Retained guide" }, at: "" },
	];
	run.humanDecisions = [
		{ reviewId: "gate", decision: "approve", headSha: "approved", at: "" },
	];
	run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [
				{
					current: "merge",
					visits: { merge: 1 },
					active: { phase: "executing" },
				},
			],
		},
	};
	if (modern)
		run.checkpoint.active!.children![0]!.outputs = {
			"draft-pr": publication,
		};
	return { runtime, run, home };
}

function handoff(run: Awaited<ReturnType<typeof fixture>>["run"]) {
	run.step = "pipeline/handoff";
	run.checkpoint!.active!.children![0]!.current = "handoff";
	const approval = run.humanDecisions!.at(-1)!;
	run.reviewGate = {
		id: approval.reviewId,
		headSha: approval.headSha,
		url: "https://github.com/test/repo/pull/1",
		status: "approve",
	};
	run.outputs["human-review"] = approval;
	run.history.push({
		step: "pipeline/human-review",
		output: approval,
		at: "now",
	});
}
it.each([
	"missing",
	"clean",
	"dirty",
	"changed-head",
])("reconciles a replayed handoff with prior explicit approval and real merged evidence (%s)", async (local) => {
	const { runtime, run } = await fixture();
	handoff(run);
	if (local !== "missing") mkdirSync(run.workspace);
	const history = structuredClone(run.history),
		decisions = structuredClone(run.humanDecisions);
	const tool = vi
		.spyOn(tools.FactoryTools.prototype, "tool")
		.mockRejectedValue(new Error("Delivery mutation must not run"));
	vi.spyOn(tools, "executeCommand").mockImplementation(
		async (_context, exe, args) => {
			if (exe === "git")
				return args[0] === "rev-parse"
					? local === "changed-head"
						? "changed"
						: "approved"
					: local === "dirty"
						? " M pending.txt"
						: "";
			expect(exe).toBe("bobs-factory:github-api");
			expect(JSON.parse(args[0]!).method).toBe("GET");
			return JSON.stringify({
				html_url: "https://github.com/test/repo/pull/1",
				number: 1,
				title: "Fixture",
				body: "",
				draft: false,
				state: "closed",
				merged: true,
				head: {
					ref: "feature",
					sha: "approved",
					repo: { full_name: "test/repo" },
				},
				base: { ref: "main", repo: { full_name: "test/repo" } },
			});
		},
	);
	await runtime.launch(run);
	expect(tool).not.toHaveBeenCalled();
	expect(run.humanDecisions).toEqual(decisions);
	expect(run.history.slice(0, history.length)).toEqual(history);
	if (local === "missing" || local === "clean") {
		expect(run.status, run.error).toBe("completed");
		expect(run.outputs.merge).toMatchObject({
			merged: true,
			headSha: "approved",
		});
		expect(run.history.filter((h) => h.step === "pipeline/merge")).toHaveLength(
			1,
		);
	} else {
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/Local work changed/);
		expect(run.outputs.merge).toBeUndefined();
	}
	await runtime.shutdown();
});
it.each([
	"missing-history",
	"pending",
	"latest-rejected",
	"intervening-work",
	"after-merge-work",
])("does not shortcut a handoff with an unfinished or unapproved route (%s)", async (reason) => {
	const { runtime, run } = await fixture();
	handoff(run);
	const steps = run.workflowDefinitions!.find(
		(w) => w.id === "factory-pipeline",
	)!.steps;
	if (reason === "missing-history") run.history.pop();
	if (reason === "pending") run.reviewGate!.status = "pending";
	if (reason === "latest-rejected")
		run.humanDecisions!.push({
			...run.humanDecisions![0]!,
			decision: "reject",
		});
	if (reason === "intervening-work")
		steps.find((s) => s.id === "human-review")!.next = "guide";
	if (reason === "after-merge-work")
		steps.find((s) => s.id === "merge")!.next = "guide";
	expect(
		pendingMergeConfirmation(run, {
			merged: true,
			headSha: "approved",
			url: "https://github.com/test/repo/pull/1",
		}),
	).toBeUndefined();
	await runtime.shutdown();
});

it.each([
	"approved",
	"different",
])("recovers GitLab merge evidence only at the approved revision (%s)", async (head) => {
	const { runtime, run } = await fixture();
	run.gitProvider = {
		type: "gitlab",
		repositoryUrl: "https://gitlab.example/team/repo",
	};
	run.outputs["draft-pr"] = {
		url: "https://gitlab.example/team/repo/-/merge_requests/7",
	};
	run.history[0]!.output = run.outputs["draft-pr"];
	const command = vi
		.spyOn(tools, "executeCommand")
		.mockImplementation(async (_ctx, exe, args) => {
			expect(exe).toBe("glab");
			expect(args[1]).toBe("projects/team%2Frepo/merge_requests/7");
			expect(args).toContain("gitlab.example");
			return JSON.stringify({
				web_url: "https://gitlab.example/team/repo/-/merge_requests/7",
				iid: 7,
				title: "Change",
				description: "",
				source_branch: "feature",
				target_branch: "main",
				sha: head,
				state: "merged",
				draft: false,
				source_project_id: 1,
				target_project_id: 1,
			});
		});
	run.status = "running";
	await runtime.launch(run);
	expect(command).toHaveBeenCalledOnce();
	expect(run.status).toBe(head === "approved" ? "completed" : "failed");
	if (head === "approved")
		expect(run.outputs.merge).toEqual({
			merged: true,
			headSha: "approved",
			url: "https://gitlab.example/team/repo/-/merge_requests/7",
		});
	else expect(run.outputs.merge).toBeUndefined();
	await runtime.shutdown();
});

it.each([
	["MERGED", "approved", "completed"],
	["MERGED", "another-revision", "failed"],
	["OPEN", "approved", "failed"],
	["CLOSED", "approved", "failed"],
])("recovers the saved merge checkpoint only for the approved merged revision (%s/%s)", async (state, headRefOid, status) => {
	const { runtime, run, home } = await fixture();
	const history = structuredClone(run.history);
	const command = vi
		.spyOn(tools, "executeCommand")
		.mockImplementation(async (ctx, exe, args) => {
			expect(ctx.run.workspace).toBe(home);
			expect(exe).toBe("bobs-factory:github-api");
			expect(JSON.parse(args[0]!)).toEqual({
				host: "github.com",
				project: "test/repo",
				method: "GET",
				path: "repos/test/repo/pulls/1",
			});
			return JSON.stringify({
				html_url: "https://github.com/test/repo/pull/1",
				number: 1,
				title: "Change",
				body: "Description",
				draft: false,
				state: state === "OPEN" ? "open" : "closed",
				merged: state === "MERGED",
				head: {
					ref: "feature",
					sha: headRefOid,
					repo: { full_name: "test/repo" },
				},
				base: { ref: "main", repo: { full_name: "test/repo" } },
			});
		});
	run.status = "running";
	await runtime.launch(run);
	expect(command).toHaveBeenCalledOnce();
	expect(run.status).toBe(status);
	expect(run.history.slice(0, history.length)).toEqual(history);
	if (status === "completed") {
		expect(run.outputs.merge).toEqual({
			merged: true,
			url: "https://github.com/test/repo/pull/1",
			headSha: "approved",
		});
		expect(run.checkpoint!.current).toBe("end");
		expect(runtime.viewState(run.id).settledAt).toBeDefined();
		expect(run.history.slice(history.length).map((item) => item.step)).toEqual([
			"pipeline/merge",
			"pipeline",
		]);
	} else {
		expect(run.outputs.merge).toBeUndefined();
		expect(run.history).toEqual(history);
		expect(run.error).toMatch(
			/worktree is unavailable|explicitly approved revision/,
		);
	}
	await runtime.shutdown();
});

it("retains an already saved merge receipt without duplicating it", async () => {
	const { runtime, run } = await fixture();
	const output = {
		merged: true,
		url: "https://github.com/test/repo/pull/1",
		headSha: "approved",
	};
	run.outputs.merge = output;
	run.history.push({ step: "pipeline/merge", output, at: "" });
	run.checkpoint!.active!.children![0]!.active!.phase = "result";
	vi.spyOn(tools, "executeCommand").mockResolvedValue(
		JSON.stringify({
			html_url: "https://github.com/test/repo/pull/1",
			number: 1,
			title: "Change",
			body: "Description",
			draft: false,
			state: "closed",
			merged: true,
			head: {
				ref: "feature",
				sha: "approved",
				repo: { full_name: "test/repo" },
			},
			base: { ref: "main", repo: { full_name: "test/repo" } },
		}),
	);
	await runtime.launch(run);
	expect(run.status).toBe("completed");
	expect(
		run.history.filter((item) => item.step === "pipeline/merge"),
	).toHaveLength(1);
	await runtime.shutdown();
});

it.each([
	"executing",
	"result",
] as const)("rejects receipt-dependent unfinished work from the %s phase", async (phase) => {
	for (const path of ["merged", "headSha", "url"]) {
		const { runtime, run } = await fixture();
		const receipt = {
			merged: true,
			url: "https://github.com/test/repo/pull/1",
			headSha: "approved",
		};
		const pipeline = run.workflowDefinitions!.find(
			(item) => item.id === "factory-pipeline",
		)!;
		const merge = pipeline.steps.find((step) => step.id === "merge")!;
		merge.branches = [
			{
				when: { path, equals: receipt[path as keyof typeof receipt] },
				next: "publish",
			},
		];
		merge.next = "end";
		pipeline.steps.push({
			id: "publish",
			type: "tool",
			tool: "publish",
			branches: [],
			next: "end",
		});
		run.checkpoint!.active!.children![0]!.active!.phase = phase;
		if (phase === "result") {
			run.outputs.merge = receipt;
			run.history.push({ step: "pipeline/merge", output: receipt, at: "" });
		}
		const history = structuredClone(run.history);
		const outputs = structuredClone(run.outputs);
		const command = vi.spyOn(tools, "executeCommand").mockResolvedValue(
			JSON.stringify({
				html_url: "https://github.com/test/repo/pull/1",
				number: 1,
				title: "Change",
				body: "Description",
				draft: false,
				state: "closed",
				merged: true,
				head: {
					ref: "feature",
					sha: "approved",
					repo: { full_name: "test/repo" },
				},
				base: { ref: "main", repo: { full_name: "test/repo" } },
			}),
		);
		await runtime.launch(run);
		expect(command).toHaveBeenCalledOnce();
		expect(run.status).toBe("failed");
		expect(run.error).toContain("Saved worktree is unavailable");
		expect(run.history).toEqual(history);
		expect(run.outputs).toEqual(outputs);
		expect(run.step).toBe("pipeline/merge");
		await runtime.shutdown();
		command.mockRestore();
	}
});

it("allows a receipt-dependent terminal route", async () => {
	const { runtime, run } = await fixture();
	const pipeline = run.workflowDefinitions!.find(
		(item) => item.id === "factory-pipeline",
	)!;
	const merge = pipeline.steps.find((step) => step.id === "merge")!;
	merge.branches = [
		{ when: { path: "headSha", equals: "approved" }, next: "end" },
	];
	merge.next = "publish";
	vi.spyOn(tools, "executeCommand").mockResolvedValue(
		JSON.stringify({
			html_url: "https://github.com/test/repo/pull/1",
			number: 1,
			title: "Change",
			body: "Description",
			draft: false,
			state: "closed",
			merged: true,
			head: {
				ref: "feature",
				sha: "approved",
				repo: { full_name: "test/repo" },
			},
			base: { ref: "main", repo: { full_name: "test/repo" } },
		}),
	);
	await runtime.launch(run);
	expect(run.status).toBe("completed");
	expect(run.outputs.merge).toEqual({
		merged: true,
		url: "https://github.com/test/repo/pull/1",
		headSha: "approved",
	});
	await runtime.shutdown();
});

it.each([
	"no-approval",
	"unfinished-agent",
	"more-work",
])("does not bypass missing-worktree protection for %s", async (scenario) => {
	const { runtime, run } = await fixture();
	if (scenario === "no-approval") run.humanDecisions = [];
	if (scenario === "unfinished-agent") {
		run.step = "pipeline/guide";
		run.checkpoint!.active!.children![0]!.current = "guide";
	}
	if (scenario === "more-work") run.workflow.steps[0]!.next = "pipeline";
	const command = vi.spyOn(tools, "executeCommand");
	await runtime.launch(run);
	expect(command).not.toHaveBeenCalled();
	expect(run.status).toBe("failed");
	expect(run.error).toContain("Saved worktree is unavailable");
	await runtime.shutdown();
});

it("recovers a confirmed merge after every accepted step and partner has been renamed", async () => {
	const { runtime, run } = await fixture(true);
	const pipeline = run.workflowDefinitions!.find(
		(workflow) => workflow.id === "factory-pipeline",
	)!;
	const names = new Map(
		pipeline.steps.map((step, index) => [step.id, `recovery_${index}`]),
	);
	names.set("pipeline", "invocation");
	const reference = (value: string) =>
		value
			.split("/")
			.map((part) => names.get(part) ?? part)
			.join("/");
	for (const step of [...run.workflow.steps, ...pipeline.steps]) {
		step.id = names.get(step.id)!;
		if (step.next && step.next !== "end") step.next = names.get(step.next)!;
		for (const branch of step.branches)
			if (branch.next !== "end") branch.next = names.get(branch.next)!;
		for (const [name, binding] of Object.entries(step.reads ?? {}))
			step.reads![name] =
				typeof binding === "string"
					? reference(binding)
					: { ...binding, from: reference(binding.from) };
	}
	run.step = reference(run.step!);
	run.checkpoint!.current = names.get(run.checkpoint!.current)!;
	run.checkpoint!.active!.children![0]!.current = names.get("merge")!;
	const frame = run.checkpoint!.active!.children![0]!;
	frame.outputs = Object.fromEntries(
		Object.entries(frame.outputs ?? {}).map(([key, value]) => [
			reference(key),
			value,
		]),
	);
	run.outputs = Object.fromEntries(
		Object.entries(run.outputs).map(([key, value]) => [reference(key), value]),
	);
	run.history = run.history.map((entry) => ({
		...entry,
		step: reference(entry.step),
	}));
	const mergeId = names.get("merge")!;
	const rootOutput = { summary: "Independent root agent output" };
	run.workflow.steps.unshift({
		id: mergeId,
		name: "Root output sharing the called merge's leaf name",
		type: "agent",
		prompt: "Independent root role",
		output: { format: "json-v1" },
		branches: [],
		next: "end",
	});
	run.outputs[mergeId] = rootOutput;
	run.history.unshift({ step: mergeId, output: rootOutput, at: "" });
	run.checkpoint!.visits[mergeId] = 1;
	const tool = vi
		.spyOn(tools.FactoryTools.prototype, "tool")
		.mockRejectedValue(new Error("No new delivery mutation"));
	vi.spyOn(tools, "executeCommand").mockImplementation(
		async (_context, exe, args) => {
			expect(exe).toBe("bobs-factory:github-api");
			expect(JSON.parse(args[0]!).method).toBe("GET");
			return JSON.stringify({
				html_url: "https://github.com/test/repo/pull/1",
				number: 1,
				title: "Fixture",
				body: "",
				draft: false,
				state: "closed",
				merged: true,
				head: {
					ref: "feature",
					sha: "approved",
					repo: { full_name: "test/repo" },
				},
				base: { ref: "main", repo: { full_name: "test/repo" } },
			});
		},
	);
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	const mergeKey = `${names.get("pipeline")!}/${mergeId}`;
	expect(run.outputs[mergeKey]).toMatchObject({
		merged: true,
		headSha: "approved",
	});
	expect(frame.outputs![mergeId]).toEqual(run.outputs[mergeKey]);
	expect(run.outputs[mergeId]).toEqual(rootOutput);
	expect(run.history.filter((entry) => entry.step === mergeKey)).toHaveLength(
		1,
	);
	expect(run.outputs.merge).toBeUndefined();
	expect(tool).not.toHaveBeenCalled();
	await runtime.shutdown();
});
