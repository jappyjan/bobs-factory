import { existsSync, readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

import { gitProvider, resolveGitProvider } from "../src/factory/GitProvider.js";

import { registerWorkflowConfig } from "../src/factory/StepConfig.js";
import { TakeoverSourceSchema } from "../src/factory/Takeover.js";
import { originatingTicket } from "../src/factory/TicketTracking.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";

const repositoryUrl = "https://gitlab.example/team/subgroup/repo";
const url = `${repositoryUrl}/-/merge_requests/17`;
const mr = {
	web_url: url,
	iid: 17,
	title: "Draft: Change",
	description: "Description",
	source_branch: "feature/change",
	target_branch: "development",
	sha: "head",
	state: "opened",
	draft: true,
	source_project_id: 8,
	target_project_id: 8,
	detailed_merge_status: "draft_status",
	has_conflicts: false,
	head_pipeline: {
		id: 22,
		sha: "head",
		status: "success",
		web_url: `${repositoryUrl}/-/pipelines/22`,
	},
};
function context(tool = "draft-pr"): ExecutionContext {
	const result: ExecutionContext = {
		run: {
			id: "run",
			repositoryId: "repo",
			title: "Change",
			workspace: "/tmp",
			workflow: defaultWorkflows.find((w) => w.id === "factory")!,
			workflowDefinitions: defaultWorkflows,
			status: "running",
			input: "Change",
			createdAt: "",
			updatedAt: "",
			history: [],
			answers: [],
			events: [],
			questions: [],
			outputs: { repository: { baseBranch: "development" } },
		},
		step: {
			id: tool,
			name: tool,
			type: "pr",
			op: "read",
			maxVisits: 8,
			branches: [],
		},
		input: {},
		evidenceDir: "/tmp",
		signal: new AbortController().signal,
		log: vi.fn(),
	};
	registerWorkflowConfig(
		{ engineVersion: "nodes-v1", id: "provider-fixture", steps: [result.step] },
		"factory",
	);
	return result;
}
function gitlab(
	extra: Record<string, unknown> = {},
	discussions: unknown[] = [],
	approvals = 1,
) {
	return vi.fn(async (exe: string, args: string[]) => {
		expect(exe).toBe("glab");
		expect(args.slice(0, 1)).toEqual(["api"]);
		expect(args).toContain("gitlab.example");
		const path = args[1]!;
		if (path.endsWith("/approvals"))
			return JSON.stringify({ approvals_left: approvals });
		if (path.includes("/discussions")) return JSON.stringify(discussions);
		if (path.includes("/notes"))
			return JSON.stringify([
				{
					id: 99,
					body: "Please fix it",
					author: { username: "reviewer" },
					updated_at: "2026-10-08T10:00:00Z",
				},
			]);
		if (path.includes("/repository/branches/"))
			return JSON.stringify({ commit: { id: "base" } });
		if (path.includes("/jobs"))
			return JSON.stringify([{ name: "test", status: "success" }]);
		if (path === "projects/team%2Fsubgroup%2Frepo")
			return JSON.stringify({
				id: 8,
				only_allow_merge_if_pipeline_succeeds: true,
				squash_option: "always",
			});
		return JSON.stringify({ ...mr, ...extra });
	});
}

it("binds takeover to the selected remote and honors an explicit selection over ambiguous URL hints", async () => {
	const ctx = context("inspect-existing");
	ctx.run.gitProvider = {
		type: "gitlab",
		repositoryUrl: "https://gitlab.example/team/selected",
	};
	const command = vi.fn(async () => "git@gitlab.example:team/selected.git");
	const provider = await resolveGitProvider(ctx, command, url);
	await expect(provider.inspect(url)).rejects.toThrow("selected repository");
	expect(command).not.toHaveBeenCalled();
	const explicit = context();
	explicit.run.repositories = [
		{
			id: explicit.run.repositoryId,
			name: "Selected",
			repositoryPath: explicit.run.workspace,
			workspace: explicit.run.workspace,
			baseBranch: "main",
			gitProvider: { type: "github" },
			githubUrl: "https://github.example/team/repo",
			gitlabUrl: repositoryUrl,
		},
	];
	explicit.run.outputs.repository = {
		gitProvider: { type: "github" },
		githubUrl: "https://github.example/team/repo",
		gitlabUrl: repositoryUrl,
	};
	await resolveGitProvider(explicit, command);
	expect(explicit.run.gitProvider).toEqual({
		type: "github",
		repositoryUrl: "https://github.example/team/repo",
	});
});

it("keeps GitLab repository path comparisons case-sensitive", async () => {
	const command = gitlab();
	await expect(
		gitProvider(command, { type: "gitlab", repositoryUrl }).view(
			"https://gitlab.example/Team/subgroup/repo/-/merge_requests/17",
		),
	).rejects.toThrow("selected repository");
	expect(command).not.toHaveBeenCalled();
});

it("captures takeover context on self-managed GitLab and rejects fork sources", async () => {
	const forge = gitProvider(gitlab(), { type: "gitlab", repositoryUrl });
	expect(await forge.inspect(url)).toMatchObject({
		url,
		headRefName: "feature/change",
		baseRefName: "development",
		isCrossRepository: false,
		comments: [{ id: "99" }],
	});
	await expect(
		gitProvider(gitlab({ source_project_id: 9 }), {
			type: "gitlab",
			repositoryUrl,
		}).inspect(url),
	).rejects.toThrow("fork takeover");
	expect(TakeoverSourceSchema.parse(url)).toBe(url);
	expect(originatingTicket("", url)).toBeUndefined();
	expect(
		originatingTicket("Task: https://linear.app/team/issue/NG-844/title", url),
	).toBe("https://linear.app/team/issue/NG-844/title");
});
it("supports another forge through a configured executable without shell interpolation, cleaning up request files", async () => {
	const other = "https://code.example/team/repo/pulls/4",
		paths: string[] = [];
	const cmd = vi.fn(async (exe: string, args: string[]) => {
		expect(exe).toBe("/tools/forge adapter");
		expect(args[0]).toBe("--fixture");
		const path = args.at(-1)!;
		paths.push(path);
		const request = JSON.parse(readFileSync(path, "utf8"));
		expect(request.repositoryUrl).toBe("https://code.example/team/repo");
		if (args[1] === "list")
			return JSON.stringify([{ url: other, isDraft: true }]);
		if (args[1] === "create") return JSON.stringify({ url: other });
		if (args[1] === "view")
			return JSON.stringify({
				url: other,
				number: 4,
				title: "Change",
				body: "literal",
				headRefName: "feature",
				headRefOid: "head",
				baseRefName: "main",
				state: "OPEN",
				isDraft: true,
				isCrossRepository: false,
			});
		if (args[1] === "readiness")
			return JSON.stringify({
				headSha: "head",
				baseSha: "base",
				url: other,
				state: "OPEN",
				isDraft: false,
				approved: true,
				reviewReady: true,
				fix: false,
				blockers: [],
				checks: [{ name: "CI", state: "pending", bucket: "pending" }],
				threads: [],
				comments: [],
				reviews: [],
				queued: false,
				mergeMethod: "merge",
			});
		expect(request.input).toMatchObject({ url: other, headSha: "approved" });
		return '{"ok":true}';
	});
	const forge = gitProvider(cmd, {
		type: "custom",
		repositoryUrl: "https://code.example/team/repo",
		command: "/tools/forge adapter",
		args: ["--fixture"],
	});
	expect(await forge.list("feature")).toEqual([{ url: other, isDraft: true }]);
	expect(
		await forge.create({
			branch: "feature",
			baseBranch: "main",
			title: "$(do-not-execute)",
			body: "literal",
		}),
	).toBe(other);
	await forge.merge(other, "approved", "merge");
	expect(paths.every((p) => !existsSync(p))).toBe(true);
	expect(TakeoverSourceSchema.parse(other)).toBe(other);
	await expect(forge.readiness(other)).rejects.toThrow("contradicts");
	expect(paths.every((p) => !existsSync(p))).toBe(true);
	const calls = cmd.mock.calls.length;
	await expect(
		forge.merge(
			"https://code.example/team/repo/../another/pulls/4",
			"approved",
			"merge",
		),
	).rejects.toThrow("selected repository");
	expect(cmd).toHaveBeenCalledTimes(calls);
});

it("confirms a GitLab fast-forward merge using its head SHA", async () => {
	const commands = gitlab({
		state: "merged",
		merge_commit_sha: null,
		squash_commit_sha: null,
	});
	const provider = gitProvider(commands, { type: "gitlab", repositoryUrl });
	expect(await provider.view(url)).toMatchObject({
		state: "MERGED",
		headRefOid: "head",
		mergeCommitSha: "head",
	});
});

it("exposes GitLab IO reads, metadata updates, comments and required/optional check evidence", async () => {
	const baseline = gitlab(
		{
			labels: ["example"],
			head_pipeline: { ...mr.head_pipeline, status: "failed" },
		},
		[{ id: "discussion", notes: [{ resolvable: true, resolved: false }] }],
	);
	const cmd = vi.fn(async (exe: string, args: string[]) => {
		const path = args[1]!;
		if (path.endsWith("/approvals"))
			return JSON.stringify({
				approvals_left: 0,
				approved_by: [{ user: { username: "alice" } }],
			});
		if (path.includes("/pipelines/22/jobs"))
			return JSON.stringify([
				{
					id: 5,
					name: "build",
					status: "failed",
					allow_failure: false,
					failure_reason: "runner_system_failure",
					commit: { id: "head" },
					pipeline: { sha: "head" },
				},
				{ id: 6, name: "optional", status: "failed", allow_failure: true },
			]);
		if (path.endsWith("/trace")) return "Runner failed to allocate a machine";
		if (path.endsWith("/notes") && args.includes("POST"))
			return JSON.stringify({
				id: 42,
				body: "Hello",
				web_url: `${url}#note_42`,
			});
		return baseline(exe, args);
	});
	const provider = gitProvider(cmd, { type: "gitlab", repositoryUrl });
	const result = await provider.read!(url);
	expect(result).toMatchObject({
		state: "OPEN",
		headRefOid: "head",
		baseSha: "base",
		labels: ["example"],
		mergeability: "unknown",
		providerMergeability: "draft_status",
		comments: [expect.objectContaining({ body: "Please fix it" })],
		blockers: expect.arrayContaining([
			expect.objectContaining({ kind: "draft" }),
		]),
		queued: false,
		reviews: [{ user: { username: "alice" } }],
		unresolvedThreads: [{ id: "discussion" }],
	});
	expect(result.checks).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: "build",
				required: true,
				failureLogExcerpt: "Runner failed to allocate a machine",
				failure: {
					kind: "infrastructure",
					evidence: "GitLab failure_reason: runner_system_failure",
				},
			}),
			expect.objectContaining({ name: "optional", required: false }),
		]),
	);
	// Polling again must reuse immutable failure logs, including across adapter recreation.
	const receipts = {};
	const polling = gitProvider(cmd, { type: "gitlab", repositoryUrl }, receipts);
	cmd.mockClear();
	await polling.read!(url);
	await gitProvider(cmd, { type: "gitlab", repositoryUrl }, receipts).read!(
		url,
	);
	expect(
		cmd.mock.calls.filter(([, args]) => args[1]?.includes("/jobs/5/trace")),
	).toHaveLength(1);
	expect(
		cmd.mock.calls.filter(([, args]) => args[1]?.includes("/jobs/6/trace")),
	).toHaveLength(0);
	// One MR + one discussion fetch per snapshot; no separate PR-read inspection.
	expect(
		cmd.mock.calls.filter(([, args]) =>
			/\/merge_requests\/17(?:\?|$)/.test(args[1]!),
		),
	).toHaveLength(2);
	expect(
		cmd.mock.calls.filter(([, args]) => args[1]?.includes("/discussions")),
	).toHaveLength(2);
	await provider.update!(url, { title: "New title", body: "New body" });
	expect(cmd.mock.calls.at(-1)![1]).toEqual(
		expect.arrayContaining([
			"PUT",
			"title=Draft: New title",
			"description=New body",
		]),
	);
	expect(await provider.comments!(url)).toEqual([
		{ id: "99", body: "Please fix it", url: undefined },
	]);
	expect(await provider.comment!(url, "Hello")).toEqual({
		id: "42",
		body: "Hello",
		url: `${url}#note_42`,
	});
	expect(() =>
		provider.comment!(
			"https://gitlab.example/other/repo/-/merge_requests/17",
			"Hello",
		),
	).toThrow("selected repository");
});

it("exposes GitHub IO reads, metadata updates and comments through native transport", async () => {
	const prUrl = "https://github.com/test/repo/pull/1";
	const cmd = vi.fn(async (_exe: string, args: string[]) => {
		const request = githubRequest(args);
		if (
			request.path.endsWith("/issues/1/comments") &&
			request.method === "POST"
		)
			return JSON.stringify({
				id: 8,
				body: (request.body as { body: string }).body,
				html_url: `${prUrl}#issuecomment-8`,
			});
		const receipt = githubApiReceipt(args, {
			labels: { nodes: [{ name: "example" }] },
			mergeStateStatus: "BEHIND",
			reviewDecision: "CHANGES_REQUESTED",
			statusCheckRollup: {
				contexts: {
					nodes: [
						{
							__typename: "CheckRun",
							name: "runner",
							conclusion: "STARTUP_FAILURE",
							isRequired: true,
						},
						{
							__typename: "StatusContext",
							context: "optional",
							state: "SUCCESS",
							isRequired: false,
						},
					],
					pageInfo: { hasNextPage: false },
				},
			},
		});
		if (request.path === "repos/test/repo/pulls/1" && request.method === "GET")
			Object.assign(receipt, {
				labels: [{ name: "example" }],
				mergeable: true,
			});
		return JSON.stringify(receipt);
	});
	const provider = gitProvider(cmd, {
		type: "github",
		repositoryUrl: "https://github.com/test/repo",
	});
	const result = await provider.read!(prUrl);
	expect(result).toMatchObject({
		state: "OPEN",
		labels: ["example"],
		mergeability: "mergeable",
		providerMergeability: "BEHIND",
		mergeStateStatus: "BEHIND",
		reviewDecision: "CHANGES_REQUESTED",
		blockers: expect.arrayContaining([
			expect.objectContaining({ kind: "stale" }),
			expect.objectContaining({ kind: "reviews" }),
		]),
		queued: false,
	});
	expect(result.checks).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				name: "runner",
				required: true,
				failure: {
					kind: "infrastructure",
					evidence: "GitHub check conclusion: STARTUP_FAILURE",
				},
			}),
			expect.objectContaining({ name: "optional", required: false }),
		]),
	);
	expect(
		cmd.mock.calls.filter(
			([, args]) => githubRequest(args).path === "repos/test/repo/pulls/1",
		),
	).toHaveLength(0);
	await provider.update!(prUrl, { title: "Title", body: "Body" });
	expect(githubRequest(cmd.mock.calls.at(-1)![1])).toMatchObject({
		method: "PATCH",
		body: { title: "Title", body: "Body" },
	});
	expect(await provider.comments!(prUrl)).toEqual([]);
	expect(await provider.comment!(prUrl, "Hello")).toEqual({
		id: "8",
		body: "Hello",
		url: `${prUrl}#issuecomment-8`,
	});
	expect(() =>
		provider.update!("https://github.com/other/repo/pull/1", {
			title: "Title",
			body: "Body",
		}),
	).toThrow("selected repository");
});

it("GitHub retryCheck reports a running Actions run as skipped", async () => {
	const cmd = vi.fn(async (_exe: string, args: string[]) => {
		const request = githubRequest(args);
		if (request.path.endsWith("/actions/runs/42"))
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: 1,
				status: "in_progress",
			});
		return JSON.stringify(githubApiReceipt(args));
	});
	const provider = gitProvider(cmd, {
		type: "github",
		repositoryUrl: "https://github.com/test/repo",
	});
	expect(
		await provider.retryCheck!("https://github.com/test/repo/pull/1", {
			kind: "github-run",
			id: "42",
			attempt: 1,
			headSha: "head",
		}),
	).toEqual({ requested: false, reason: "in-progress" });
	expect(
		cmd.mock.calls.some(([, args]) => githubRequest(args).method === "POST"),
	).toBe(false);
});
