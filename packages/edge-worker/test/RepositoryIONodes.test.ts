import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitProvider } from "../src/factory/GitProvider.js";
import { nodeRegistry } from "../src/factory/nodes/index.js";
import { nodeEffect } from "../src/factory/nodes/metadata.js";
import type { RunRepository } from "../src/factory/RepositoryScope.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const mocks = vi.hoisted(() => ({ command: vi.fn(), provider: vi.fn() }));
vi.mock("../src/factory/FactoryTools.js", async (original) => ({
	...(await original<object>()),
	executeCommand: mocks.command,
}));
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: mocks.provider,
}));
const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const head = "a".repeat(40),
	nextHead = "b".repeat(40),
	base = "c".repeat(40);
interface State {
	head: string;
	dirty: boolean;
	log: string;
	remote: string;
}
const states = new Map<string, State>();
const forges = new Map<string, ReturnType<typeof forge>>();
function forge(id: string) {
	const url =
		id === "lab"
			? "https://gitlab.com/team/sub/project/-/merge_requests/2"
			: "https://github.com/team/project/pull/1";
	let pr: any;
	const comments: any[] = [];
	let lost: "none" | "accepted" | "absent" | "unknown" = "none";
	let checks: any[] = [];
	const provider = {
		list: vi.fn(async () => (pr ? [{ url, isDraft: pr.isDraft }] : [])),
		create: vi.fn(async (input) => {
			if (lost === "absent") {
				lost = "none";
				throw new Error("lost before create");
			}
			pr = {
				url,
				number: 1,
				title: input.title,
				body: input.body,
				headRefName: "feature",
				headRefOid: states.get(id)!.head,
				baseRefName: "main",
				state: "OPEN",
				isDraft: true,
				isCrossRepository: false,
			};
			if (lost === "accepted" || lost === "unknown") {
				if (lost === "unknown") pr.body = "intervening body";
				lost = "none";
				throw new Error("lost after create");
			}
			return url;
		}),
		view: vi.fn(async () => structuredClone(pr)),
		update: vi.fn(async (_url, input) => {
			Object.assign(pr, input);
		}),
		read: vi.fn(async () => ({
			...pr,
			baseSha: base,
			mergeability: "mergeable",
			reviews: [{ state: "APPROVED" }],
			unresolvedThreads: [{ id: "thread" }],
			reviewComments: [{ body: "comment" }],
			labels: ["example"],
			checks,
		})),
		comments: vi.fn(async () => comments),
		comment: vi.fn(async (_url, body) => {
			const c = { id: "comment-1", body };
			comments.push(c);
			return c;
		}),
		draft: vi.fn(async (_url, draft) => {
			pr.isDraft = draft;
		}),
		readiness: vi.fn(async () => ({
			url,
			headSha: pr.headRefOid,
			baseSha: base,
			checks,
			blockers: [],
			state: pr.state,
		})),
		retryCheck: vi.fn(async () => {}),
	} as unknown as GitProvider;
	return {
		provider,
		url,
		get pr() {
			return pr;
		},
		setLost(value: typeof lost) {
			lost = value;
		},
		setChecks(value: any[]) {
			checks = value;
		},
	};
}
beforeEach(() => {
	states.clear();
	forges.clear();
	mocks.command.mockReset();
	mocks.provider.mockReset();
	mocks.provider.mockImplementation(
		async (ctx: ExecutionContext) => forges.get(ctx.run.repositoryId)!.provider,
	);
	mocks.command.mockImplementation(
		async (ctx: ExecutionContext, exe: string, args: string[]) => {
			expect(exe).toBe("git");
			const s = states.get(ctx.run.repositoryId)!;
			switch (args[0]) {
				case "rev-parse":
					return args[1] === "--show-toplevel"
						? ctx.run.workspace
						: args.at(-1)?.includes("origin/main")
							? base
							: s.head;
				case "branch":
					return "feature";
				case "status":
					return s.dirty ? " M file.ts" : "";
				case "add":
					return "";
				case "commit":
					s.log = args.at(-1)!;
					s.head = nextHead;
					s.dirty = false;
					return "committed";
				case "log":
					return s.log;
				case "push":
					s.remote = s.head;
					return "pushed";
				case "ls-remote":
					return s.remote ? `${s.remote}\trefs/heads/feature` : "";
				case "diff":
					return "2\t1\tfile.ts\0-\t-\t binary\tname.png\0";
			}
			throw new Error(`Unexpected command ${args.join(" ")}`);
		},
	);
});
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function runtime(home: string, title = "Example") {
	const r = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({
			message: "feat: example",
			title,
			body: "Body",
		}),
		script: async () => ({}),
	});
	runtimes.push(r);
	return r;
}
function fixture(steps: object[], ids = ["hub"], title = "Example") {
	const home = mkdtempSync(join(tmpdir(), "repository-io-"));
	homes.push(home);
	const repos: RunRepository[] = ids.map((id) => {
		const workspace = join(home, id);
		mkdirSync(workspace);
		writeFileSync(join(workspace, ".git"), "gitdir: fixture");
		states.set(id, { head, dirty: true, remote: "", log: "" });
		forges.set(id, forge(id));
		return {
			id,
			name: id,
			repositoryPath: join(home, "source", id),
			workspace,
			baseBranch: "main",
		};
	});
	const instance = runtime(home, title);
	const workflow = WorkflowSchema.parse({
		id: "io",
		name: "IO",
		stepConfigVersion: "step-config-v1",
		steps: [
			{ id: "seed", name: "Seed", type: "tool", tool: "seed" },
			...steps.map((s) => ({
				name: "IO",
				reads: {
					message: "seed/message",
					title: "seed/title",
					body: "seed/body",
				},
				...s,
			})),
		],
	});
	const run = instance.create({
		title: "IO",
		repositoryId: ids[0]!,
		repositories: repos,
		workspace: repos[0]!.workspace,
		input: "",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: "io",
			at: new Date().toISOString(),
		},
	});
	return { home, instance, run, repos };
}
async function seedPR(id: string) {
	return forges.get(id)!.provider.create({
		branch: "feature",
		baseBranch: "main",
		title: "Old",
		body: "Old body",
	});
}

it.each([
	"status",
	"rev-parse",
	"diff",
	"commit",
	"push",
])("git %s handles every scoped repository with revisions", async (op) => {
	const { instance, run } = fixture(
		[{ id: "op", type: "git", op }],
		["hub", "lab"],
	);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	const result = (run.outputs.op as any).repositories;
	expect(result.map((r: any) => [r.id, r.head])).toEqual([
		["hub", op === "commit" ? nextHead : head],
		["lab", op === "commit" ? nextHead : head],
	]);
	for (const r of result) {
		if (op === "status")
			expect(r).toMatchObject({ branch: "feature", dirty: true });
		if (op === "rev-parse") expect(r.revision).toBe(head);
		if (op === "diff")
			expect(r).toMatchObject({
				base,
				target: head,
				files: ["file.ts", " binary\tname.png"],
				stats: { filesChanged: 2, additions: 2, deletions: 1, binaryFiles: 1 },
			});
		if (op === "commit") expect(r.committed).toBe(true);
		if (op === "push") expect(r.pushed).toBe(true);
	}
});
it("git commit is a no-op when clean and rejects source-clone mutations", async () => {
	const { instance, run, repos } = fixture([
		{ id: "op", type: "git", op: "commit" },
	]);
	states.get("hub")!.dirty = false;
	await instance.launch(run);
	expect((run.outputs.op as any).repositories[0].committed).toBe(false);
	expect(
		mocks.command.mock.calls.some(([, , args]) => args[0] === "commit"),
	).toBe(false);
	const second = fixture([{ id: "op", type: "git", op: "push" }]);
	rmSync(join(second.repos[0]!.workspace, ".git"));
	mkdirSync(join(second.repos[0]!.workspace, ".git"));
	await second.instance.launch(second.run);
	expect(second.run.status).toBe("failed");
	expect(repos[0]!.workspace).not.toBe(repos[0]!.repositoryPath);
});
it.each([
	"ensure",
	"read",
	"comment",
	"ready",
])("pr %s works across GitHub and GitLab scopes", async (op) => {
	const { instance, run } = fixture(
		[{ id: "op", type: "pr", op }],
		["hub", "lab"],
	);
	for (const id of ["hub", "lab"]) await seedPR(id);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	const result = (run.outputs.op as any).repositories;
	expect(result.map((r: any) => r.id)).toEqual(["hub", "lab"]);
	for (const r of result) {
		expect(r).toMatchObject({ head, url: forges.get(r.id)!.url });
		const f = forges.get(r.id)!;
		if (op === "ensure") {
			expect(f.pr.title).toBe("Example");
			expect(f.pr.body).toMatch(/^Body\n\n<!-- factory-effect:/);
		}
		if (op === "read")
			expect(r).toMatchObject({
				base,
				mergeability: "mergeable",
				labels: ["example"],
				unresolvedThreads: [{ id: "thread" }],
				reviews: [{ state: "APPROVED" }],
			});
		if (op === "comment")
			expect(r.comment.body).toMatch(/^Body\n\n<!-- factory-effect:/);
		if (op === "ready") expect(r.isDraft).toBe(false);
	}
});
it.each([
	"accepted",
	"absent",
	"unknown",
] as const)("pr ensure reconciles %s outcomes across a cold restart", async (outcome) => {
	const { instance, home, run } = fixture([
		{ id: "op", type: "pr", op: "ensure" },
	]);
	const f = forges.get("hub")!;
	f.setLost(outcome);
	await instance.launch(run);
	expect(run.status).toBe("failed");
	const key = Object.keys(run.nodeEffects!)[0]!;
	expect(run.nodeEffects![key]!.phase).toBe("uncertain");
	await instance.shutdown();
	const resumed = runtime(home);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(f.provider.create).toHaveBeenCalledTimes(outcome === "absent" ? 2 : 1);
	if (outcome === "absent") {
		const calls = vi.mocked(f.provider.create).mock.calls;
		expect(calls[0]![0].body).toBe(calls[1]![0].body);
	}
	expect(resumed.get(run.id).nodeEffects![key]!.phase).toBe("confirmed");
});
it("pr comment reconciles a lost response without posting twice", async () => {
	const { instance, home, run } = fixture([
		{ id: "op", type: "pr", op: "comment" },
	]);
	await seedPR("hub");
	const f = forges.get("hub")!,
		original = f.provider.comment!;
	f.provider.comment = vi.fn(async (...args) => {
		await original(...args);
		throw new Error("lost comment response");
	});
	await instance.launch(run);
	expect(run.status).toBe("failed");
	await instance.shutdown();
	const resumed = runtime(home);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(f.provider.comment).toHaveBeenCalledTimes(1);
});
it("ci status is a single read and rerun targets infrastructure failures only, once per run identity", async () => {
	const { instance, run } = fixture(
		[{ id: "op", type: "ci", op: "status" }],
		["hub", "lab"],
	);
	const failed = {
		name: "runner",
		state: "FAILURE",
		bucket: "fail",
		required: true,
		link: "https://ci.example/job",
		failure: { kind: "infrastructure", evidence: "Runner unavailable" },
		retry: { id: "1", attempt: 1, headSha: head, kind: "github-run" },
	};
	for (const id of ["hub", "lab"]) {
		await seedPR(id);
		forges
			.get(id)!
			.setChecks([
				failed,
				{ name: "optional", state: "SUCCESS", bucket: "pass", required: false },
			]);
	}
	await instance.launch(run);
	expect(run.status).toBe("completed");
	for (const r of (run.outputs.op as any).repositories) {
		expect(r.checks[0]).toMatchObject({
			required: true,
			conclusion: "FAILURE",
			url: "https://ci.example/job",
			failureLogExcerpt: "Runner unavailable",
			infraFailure: true,
		});
		expect(r.checks[1].required).toBe(false);
		expect(forges.get(r.id)!.provider.readiness).toHaveBeenCalledTimes(1);
		expect(forges.get(r.id)!.provider.retryCheck).not.toHaveBeenCalled();
	}
	const other = fixture(
		[{ id: "op", type: "ci", op: "rerun" }],
		["hub", "lab"],
	);
	for (const id of ["hub", "lab"]) {
		await seedPR(id);
		forges.get(id)!.setChecks([
			failed,
			{ ...failed, name: "aggregate" },
			{
				...failed,
				name: "code",
				failure: { kind: "unknown", evidence: "Assertion failed" },
				retry: { ...failed.retry, id: "2" },
			},
		]);
	}
	await other.instance.launch(other.run);
	expect(other.run.status).toBe("completed");
	for (const id of ["hub", "lab"])
		expect(forges.get(id)!.provider.retryCheck).toHaveBeenCalledTimes(1);
});
it("reports stale-head CI as incomplete and leaves ready requests untouched on ensure", async () => {
	const { instance, run } = fixture([{ id: "op", type: "ci", op: "status" }]);
	await seedPR("hub");
	forges.get("hub")!.pr.headRefOid = base;
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect((run.outputs.op as any).repositories[0]).toMatchObject({
		headMatches: false,
		localHead: head,
		prHead: base,
		summary: { complete: false },
	});
	const other = fixture([{ id: "op", type: "pr", op: "ensure" }]);
	await seedPR("hub");
	forges.get("hub")!.pr.isDraft = false;
	await other.instance.launch(other.run);
	expect(other.run.status).toBe("completed");
	expect(forges.get("hub")!.provider.update).not.toHaveBeenCalled();
});
it("runs git commit → git push → pr ensure → ci status through the real recipe engine", async () => {
	const { instance, run } = fixture(
		[
			{ id: "commit", type: "git", op: "commit" },
			{ id: "push", type: "git", op: "push" },
			{ id: "pr", type: "pr", op: "ensure" },
			{ id: "ci", type: "ci", op: "status", reads: { pr: "pr" } },
		],
		["hub", "lab"],
	);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(
		(run.outputs.ci as any).repositories.map((r: any) => [
			r.id,
			r.head,
			r.base,
		]),
	).toEqual([
		["hub", nextHead, base],
		["lab", nextHead, base],
	]);
	for (const id of ["hub", "lab"]) {
		expect(states.get(id)!.remote).toBe(nextHead);
		expect(forges.get(id)!.provider.create).toHaveBeenCalledTimes(1);
	}
	expect(
		run.history
			.filter((h) => ["commit", "push", "pr", "ci"].includes(h.step))
			.map((h) => h.step),
	).toEqual(["commit", "push", "pr", "ci"]);
});
it("publishes operation effect metadata and JSON-panel defaults without executable browser metadata", () => {
	const catalog = JSON.parse(JSON.stringify(nodeRegistry.metadata()));
	for (const type of ["git", "pr", "ci"])
		expect(catalog.find((n: any) => n.type === type).builder.defaults.op).toBe(
			type === "pr" ? "read" : "status",
		);
	for (const [type, ops] of [
		["git", ["status", "rev-parse", "diff"]],
		["pr", ["read"]],
		["ci", ["status"]],
	] as const)
		for (const op of ops) expect(nodeEffect({ type, op })).toBe("read-only");
	for (const [type, op] of [
		["git", "commit"],
		["git", "push"],
		["pr", "ensure"],
		["pr", "comment"],
		["pr", "ready"],
		["ci", "rerun"],
	])
		expect(nodeEffect({ type: type!, op })).toBe("effect");
	expect(nodeEffect({ type: "git", op: "unknown" })).toBe("effect");
	expect(nodeEffect({ type: "git", op: "toString" })).toBe("effect");
	expect(
		nodeRegistry.effectFor(
			WorkflowSchema.parse({
				id: "effects",
				name: "Effects",
				steps: [{ id: "ci", name: "CI", type: "ci", op: "status" }],
			}).steps[0]!,
		),
	).toBe("read-only");
	expect(
		nodeRegistry.effectFor(
			WorkflowSchema.parse({
				id: "effects",
				name: "Effects",
				steps: [{ id: "ci", name: "CI", type: "ci", op: "rerun" }],
			}).steps[0]!,
		),
	).toBe("effect");
});

it.each([
	"accepted",
	"absent",
])("git commit recovers a lost %s result after restart", async (outcome) => {
	const { instance, home, run } = fixture([
		{ id: "op", type: "git", op: "commit" },
	]);
	const execute = mocks.command.getMockImplementation()!;
	let first = true;
	mocks.command.mockImplementation(async (ctx, exe, args) => {
		if (args[0] === "commit" && first) {
			first = false;
			if (outcome === "accepted") await execute(ctx, exe, args);
			throw new Error(
				outcome === "absent" ? "signing failed" : "commit response lost",
			);
		}
		return execute(ctx, exe, args);
	});
	await instance.launch(run);
	expect(run.status).toBe("failed");
	await instance.shutdown();
	const resumed = runtime(home);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(
		mocks.command.mock.calls.filter(([, , args]) => args[0] === "commit"),
	).toHaveLength(outcome === "accepted" ? 1 : 2);
	expect((resumed.get(run.id).outputs.op as any).repositories[0]).toMatchObject(
		{ head: nextHead, committed: true },
	);
});

it.each([
	true,
	false,
	undefined,
])("git commit honors verify=%s, defaulting to hooks", async (verify) => {
	const { instance, run } = fixture([
		{
			id: "op",
			type: "git",
			op: "commit",
			...(verify === undefined ? {} : { verify }),
		},
	]);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	const args = mocks.command.mock.calls.find(
		([, , args]) => args[0] === "commit",
	)![2];
	expect(args.includes("--no-verify")).toBe(verify === false);
});

it.each([
	"accepted",
	"failed",
])("git push recovers a %s send to an existing branch after restart", async (outcome) => {
	const { instance, home, run } = fixture([
		{ id: "op", type: "git", op: "push" },
	]);
	states.get("hub")!.remote = base;
	const execute = mocks.command.getMockImplementation()!;
	let first = true;
	mocks.command.mockImplementation(async (ctx, exe, args) => {
		if (args[0] === "push" && first) {
			first = false;
			if (outcome === "accepted") await execute(ctx, exe, args);
			throw new Error("push response lost");
		}
		return execute(ctx, exe, args);
	});
	await instance.launch(run);
	expect(run.status).toBe("failed");
	await instance.shutdown();
	const resumed = runtime(home);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	const sends = mocks.command.mock.calls.filter(
		([, , args]) => args[0] === "push",
	);
	expect(sends).toHaveLength(outcome === "accepted" ? 1 : 2);
	expect(sends[0]![2]).toEqual([
		"push",
		"-u",
		"origin",
		"HEAD:refs/heads/feature",
	]);
	expect(states.get("hub")!.remote).toBe(head);
});

it("pr ensure retries a failed update after restart with the same marker", async () => {
	const { instance, home, run } = fixture([
		{ id: "op", type: "pr", op: "ensure" },
	]);
	await seedPR("hub");
	const f = forges.get("hub")!;
	vi.mocked(f.provider.update!).mockRejectedValueOnce(new Error("PATCH lost"));
	await instance.launch(run);
	expect(run.status).toBe("failed");
	await instance.shutdown();
	const resumed = runtime(home);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(f.provider.create).toHaveBeenCalledTimes(1); // seed only
	const updates = vi.mocked(f.provider.update!).mock.calls;
	expect(updates).toHaveLength(2);
	expect(updates[0]![1]).toEqual(updates[1]![1]);
});

it("pr ensure accepts provider trimming and marker-preserving body normalization", async () => {
	const { instance, run } = fixture(
		[{ id: "op", type: "pr", op: "ensure" }],
		["hub"],
		"Example\n",
	);
	const f = forges.get("hub")!,
		original = f.provider.create;
	f.provider.create = vi.fn(async (input) =>
		original({ ...input, title: input.title.trim(), body: `${input.body}\n` }),
	);
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(f.pr.title).toBe("Example");
});

it("ci rerun skips missing identities, in-progress runs and provider-side races", async () => {
	const { instance, run } = fixture([{ id: "op", type: "ci", op: "rerun" }]);
	await seedPR("hub");
	const f = forges.get("hub")!;
	const check = {
		name: "runner",
		state: "FAILURE",
		bucket: "fail",
		failure: { kind: "infrastructure", evidence: "runner unavailable" },
	};
	f.setChecks([
		check,
		{
			...check,
			name: "running",
			retry: {
				id: "1",
				attempt: 1,
				headSha: head,
				kind: "github-run",
				status: "in_progress",
			},
		},
		{
			...check,
			name: "raced",
			retry: {
				id: "2",
				attempt: 1,
				headSha: head,
				kind: "github-run",
				status: "completed",
			},
		},
	]);
	vi.mocked(f.provider.retryCheck!).mockResolvedValue({
		requested: false,
		reason: "in-progress",
	});
	await instance.launch(run);
	expect(run.status).toBe("completed");
	expect(f.provider.retryCheck).toHaveBeenCalledTimes(1);
	expect((run.outputs.op as any).repositories[0].reruns).toMatchObject([
		{ check: "runner", requested: false, skipped: "missing-retry-identity" },
		{ check: "running", requested: false, skipped: "in-progress" },
		{ check: "raced", requested: false, skipped: "in-progress" },
	]);
});
