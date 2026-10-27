import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import type { GitProvider } from "../src/factory/GitProvider.js";
import type {
	MergeBlocker,
	ProviderCheck,
} from "../src/factory/ProviderReadiness.js";
import { fileTicketIO } from "../src/factory/RepositoryTicketIO.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../src/MachineCapacity.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

vi.mock("../src/factory/FactoryWebAssets.js", () => ({
	factoryWebAssets: () => ({
		build: "000000000000000000000000",
		protocol: 1,
		assets: [],
	}),
}));
const mocks = vi.hoisted(() => ({ provider: vi.fn(), command: vi.fn() }));
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: mocks.provider,
}));
vi.mock("../src/factory/nodes/execute/command.js", async (original) => ({
	...(await original<object>()),
	executeCommand: mocks.command,
}));
const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [],
	capacities: MachineCapacity[] = [];
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.shutdown();
	for (const c of capacities.splice(0)) await c.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
	vi.clearAllMocks();
});
const url = "https://github.com/test/repo/pull/1";
function fixture(
	id: string,
	options: {
		approval?: boolean;
		carried?: boolean;
		carrySafe?: boolean;
		mixed?: boolean;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "factory-delivery-"));
	homes.push(home);
	const source = join(home, "source"),
		workspace = join(home, "worktree"),
		remote = join(home, "remote.git");
	mkdirSync(source);
	const gitAt = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const git = (...args: string[]) => gitAt(workspace, ...args);
	gitAt(source, "init", "-qb", "main");
	gitAt(source, "config", "user.name", "Fixture");
	gitAt(source, "config", "user.email", "fixture@example.invalid");
	gitAt(source, "config", "commit.gpgsign", "false");
	gitAt(source, "config", "core.hooksPath", "/dev/null");
	writeFileSync(join(source, "file.ts"), "export const value = 1;\n");
	gitAt(source, "add", ".");
	gitAt(source, "commit", "-qm", "initial");
	gitAt(source, "clone", "-q", "--bare", source, remote);
	gitAt(source, "remote", "add", "origin", remote);
	gitAt(source, "fetch", "-q", "origin");
	gitAt(source, "worktree", "add", "-qb", "feature", workspace);
	const base = git("rev-parse", "HEAD");
	const state = {
		ci: "green",
		prHead: base,
		base,
		prState: "OPEN",
		queued: false,
		mergeReads: 0,
		changed: false,
		comments: [] as { id: string; body: string }[],
		threads: [] as { id: string }[],
		decision: "APPROVED",
		providerMergeability: "CLEAN",
		blockers: [] as MergeBlocker[],
		failMerge: false,
		failStatus: false,
		queue: false,
	};
	const checks = (): ProviderCheck[] => [
		{
			name: "build",
			required: true,
			state:
				state.ci === "green"
					? "SUCCESS"
					: state.ci === "pending"
						? "IN_PROGRESS"
						: "FAILURE",
			bucket:
				state.ci === "green"
					? "pass"
					: state.ci === "pending"
						? "pending"
						: "fail",
			...(state.ci === "infra"
				? {
						failure: {
							kind: "infrastructure" as const,
							evidence: "runner unavailable",
						},
						retry: {
							kind: "github-run" as const,
							id: "1",
							attempt: 1,
							headSha: state.prHead,
							status: "completed" as const,
						},
					}
				: {}),
		},
	];
	const view = vi.fn(async () => {
		if (state.queued && ++state.mergeReads > 2) state.prState = "MERGED";
		return {
			url,
			number: 1,
			title: "Delivery",
			body: "Body",
			headRefName: "feature",
			headRefOid: state.prHead,
			baseRefName: "main",
			state: state.prState,
			isDraft: false,
			isCrossRepository: false,
			...(state.prState === "MERGED" ? { mergeCommitSha: "merged-sha" } : {}),
		};
	});
	const merge = vi.fn(async (_url: string, expected: string) => {
		expect(expected).toBe(state.prHead);
		if (state.queue) state.queued = true;
		else state.prState = "MERGED";
		if (state.failMerge) throw new Error("lost merge response");
	});
	const retryCheck = vi.fn(async () => {
		state.ci = "green";
	});
	const read = vi.fn(async () => ({
		...(await view()),
		baseSha: state.base,
		mergeability: "mergeable",
		providerMergeability: state.providerMergeability,
		mergeStateStatus: state.providerMergeability,
		reviewDecision: state.decision,
		comments: state.comments,
		reviewComments: [],
		unresolvedThreads: state.threads,
		reviews: [],
		blockers: state.blockers,
		queued: state.queued,
		checks: checks(),
	}));
	const provider = {
		view,
		read,
		merge,
		retryCheck,
		readiness: vi.fn(async () => ({
			url,
			headSha: state.prHead,
			baseSha: state.base,
			checks: checks(),
			mergeMethod: "squash",
		})),
	} as unknown as GitProvider;
	mocks.provider.mockImplementation(async () => provider);
	mocks.command.mockImplementation(
		async (ctx: ExecutionContext, exe: string, args: string[]) => {
			const result = gitAt(ctx.run.workspace, ...args);
			if (exe !== "git") throw new Error(`Unexpected executable ${exe}`);
			if (args[0] === "push") {
				state.prHead = git("rev-parse", "HEAD");
				state.ci = "green";
			}
			return result;
		},
	);
	mkdirSync(join(home, "tickets"));
	writeFileSync(
		join(home, "tickets", "origin.json"),
		JSON.stringify({
			id: "origin",
			url: "https://tickets.test/1",
			title: "Before",
			description: "Before",
			state: { type: "started" },
			comments: [],
			attachments: [],
		}),
	);
	const ticket = fileTicketIO(join(home, "tickets"), "origin");
	const originalStatus = ticket.setStatus;
	ticket.setStatus = vi.fn(async (status) => {
		await originalStatus(status);
		if (state.failStatus) throw new Error("lost status response");
	});
	const agent = vi.fn(async (ctx: ExecutionContext) => {
		switch (ctx.step.id) {
			case "ci-fix":
				if (state.changed)
					writeFileSync(
						join(workspace, "file.ts"),
						"export const value = 2;\n",
					);
				state.threads = [];
				return {
					summary: "Corrected failure",
					message: "fix: CI",
					reviewRequired: false,
					addressedReviewIds: [],
					addressedCommentIds: [],
				};
			case "feedback":
				return {
					reviewRequired: false,
					reason: "Informational feedback assessed",
				};
			case "apply":
				await ticket.update({ title: "Applied" });
				return {
					applied: true,
					revisePlan: false,
					summary: "Applied",
					receipts: [{ before: "Before", after: "Applied" }],
				};
			case "correction":
				await ticket.update({ title: "Corrected" });
				return {
					applied: true,
					revisePlan: false,
					summary: "Corrected",
					receipts: [{ before: "Applied", after: "Corrected" }],
				};
			case "verify":
				return {
					verified: true,
					summary: "Independently verified",
					ticketUrl: "https://tickets.test/1",
					observations: [await ticket.read()],
				};
			case "guide":
				return {
					summary:
						"Verified external work; inspect ticket. Changes remain if rejected.",
				};
			case "final-verify":
				return {
					unchanged: true,
					reason: "Fetched targets match accepted observations",
				};
			default:
				throw new Error(`Unexpected agent ${ctx.step.id}`);
		}
	});
	const capacity = new MachineCapacity(1, join(home, "capacity"));
	capacities.push(capacity);
	const hooks: RuntimeHooks = {
		agent,
		tool: async () => {
			throw new Error("Legacy tool must not run");
		},
		script: async () => {
			throw new Error("Script must not run");
		},
		ioGitProvider: async () => provider,
		ticketIO: async () => ticket,
		capacity,
	};
	const recipe = structuredClone(defaultWorkflows.find((w) => w.id === id)!);
	recipe.id = `fixture-${id}`;
	for (const s of recipe.steps) {
		if (s.type === "wait") {
			s.interval = 5;
			s.timeout = 10000;
		}
		if (s.type === "merge") {
			s.pollInterval = 5;
			s.timeout = 100;
		}
	}
	if (options.approval) {
		recipe.steps.unshift(
			{
				id: "pr-source",
				name: "Read candidate",
				type: "pr",
				op: "read",
				reads: { pr: "pr" },
				branches: [],
				maxVisits: 10,
				next: options.carried ? "original-approval" : "approval",
			},
			{
				id: options.carried ? "original-approval" : "approval",
				name: "Approve candidate",
				type: "display",
				reads: { pr: "pr-source" },
				bind: ["pr-source"],
				document: {
					version: "view-v1",
					components: [
						{
							id: "buttons",
							type: "actions",
							data: {
								literal: { actions: [{ id: "approve", label: "Approve" }] },
							},
						},
					],
				},
				branches: [],
				maxVisits: 10,
				next: options.carried
					? "approval"
					: options.mixed
						? "merge"
						: "current-pr",
			},
		);
		if (options.carried) {
			recipe.steps.splice(2, 0, {
				id: "approval",
				name: "Carry independently assessed approval",
				type: "transform",
				reads: { original: "original-approval" },
				bind: ["original-approval"],
				transform: {
					action: "approve",
					authorization: "carried",
					carriedFrom: { select: "/inputs/original" },
					decision: {
						literal: { safe: options.carrySafe !== false, uncertainty: [] },
					},
				},
				branches: [],
				maxVisits: 10,
				next: "current-pr",
			});
		}
	}
	if (options.mixed) recipe.inputs!.push("pr");
	if (options.mixed)
		recipe.steps.splice(2, 0, {
			id: "merge",
			name: "Repository merge",
			type: "merge",
			expectedRevision: "approval",
			bind: ["approval"],
			reads: { requests: "pr" },
			branches: [],
			maxVisits: 10,
			pollInterval: 5,
			timeout: 100,
			next: "repository-context",
		});

	const workflow = WorkflowSchema.parse(recipe);
	const runtime = new WorkflowRuntime(home, hooks);
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	runtimes.push(runtime);
	const run = runtime.create({
		title: "Delivery",
		repositoryId: "repo",
		workspace,
		repositories: [
			{
				id: "repo",
				name: "Repository",
				workspace,
				repositoryPath: source,
				baseBranch: "main",
				githubUrl: "https://github.com/test/repo",
			},
		],
		input: "Deliver",
		workflow,
		workflowDefinitions: [workflow],
		launchInputs: {
			pr: JSON.stringify({
				repositories: [{ id: "repo", head: base, url, isDraft: false }],
			}),
			requirements: JSON.stringify({
				summary: "Deliver",
				requirements: [],
				decisions: [],
				outOfScope: [],
			}),
			review: JSON.stringify({ approved: true, findings: [], coverage: [] }),
			plan: JSON.stringify({
				summary: "Authorized external update",
				deliveryMode: id === "v2-deferred" ? "deferred" : "external",
				steps: [],
				risks: [],
				repositories: [],
			}),
		},
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "workspace",
		id: "origin",
		url: "https://tickets.test/1",
	};
	run.ticketSnapshot = { id: "origin", url: "https://tickets.test/1" };
	return {
		home,
		workspace,
		runtime,
		run,
		hooks,
		git,
		state,
		agent,
		merge,
		retryCheck,
		ticket,
		capacity,
		provider,
		read,
	};
}
async function done(run: FactoryRun) {
	await waitForRuntime(() => expect(run.status, run.error).toBe("completed"));
}
async function waiting(run: FactoryRun, step?: string) {
	await waitForRuntime(() => {
		expect(run.status, run.error).toBe("waiting");
		expect(run.viewDecision).toBeDefined();
		if (step) expect(run.step).toBe(step);
	});
}
async function answer(
	runtime: WorkflowRuntime,
	run: FactoryRun,
	action: string,
) {
	await runtime.answerView(run.id, {
		batchId: run.viewDecision!.id,
		digest: run.viewDecision!.digest,
		accepted: true,
		action,
		values: ["accept", "changes"].includes(action)
			? { notes: action === "changes" ? "Correct the title" : "" }
			: {},
	});
}
async function restart(f: ReturnType<typeof fixture>, retry = false) {
	await f.runtime.shutdown();
	const runtime = new WorkflowRuntime(f.home, f.hooks);
	runtimes.push(runtime);
	if (retry) runtime.retry(f.run.id);
	else runtime.resumeAll();
	return { runtime, run: runtime.get(f.run.id) };
}
it("CI completes green without an agent or mutation", async () => {
	const f = fixture("v2-ci");
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("completed");
	expect(f.agent).not.toHaveBeenCalled();
	expect(f.run.nodeEffects ?? {}).toEqual({});
});
it.each([
	false,
	true,
])("CI red → fix → green routes code change=%s correctly", async (changed) => {
	const f = fixture("v2-ci");
	f.state.ci = "red";
	f.state.changed = changed;
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe(changed ? "to-review" : "completed");
	expect(f.agent.mock.calls.map(([ctx]) => ctx.step.id)).toEqual([
		"ci-fix",
		"feedback",
	]);
	expect(f.run.outputs["after-fix"]).toMatchObject({
		codeChanged: changed,
		revisionChanged: changed,
		baseChanged: false,
		feedbackRequiresReview: false,
	});
	expect((f.run.outputs.delta as any).repositories[0].stats.filesChanged).toBe(
		changed ? 1 : 0,
	);
	expect(f.git("rev-parse", "@{upstream}")).toBe(f.git("rev-parse", "HEAD"));
});
it("CI infrastructure failure reruns on the provider without a fixer", async () => {
	const f = fixture("v2-ci");
	f.state.ci = "infra";
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.retryCheck).toHaveBeenCalledTimes(1);
	expect(f.agent).not.toHaveBeenCalled();
	expect(f.run.checkpoint?.outcome).toBe("completed");
});
it("CI waits for the matching head and survives restart without holding capacity", async () => {
	const f = fixture("v2-ci");
	f.state.prHead = "old-head";
	const pending = f.runtime.launch(f.run);
	await waitForRuntime(() =>
		expect(f.run.checkpoint?.active?.wait?.polls).toBeGreaterThan(1),
	);
	expect(f.run.capacityLeaves?.wait).toEqual({ phase: "waiting-ci" });
	expect(await f.capacity.snapshot()).toMatchObject({ active: 0, queued: 0 });
	const resumed = await restart(f);
	await pending;
	f.state.prHead = f.git("rev-parse", "HEAD");
	await done(resumed.run);
	expect(resumed.run.history.filter((h) => h.step === "baseline")).toHaveLength(
		1,
	);
	expect(resumed.run.history.filter((h) => h.step === "wait")).toHaveLength(1);
	expect(resumed.run.capacityLeaves ?? {}).toEqual({});
});
it.each([
	"BEHIND",
	"DIRTY",
])("green CI with %s fix blockers integrates the base before returning to review", async (mergeState) => {
	const f = fixture("v2-ci");
	const source = join(f.home, "source");
	writeFileSync(join(source, "base.ts"), "export const base = 2;\n");
	f.git("-C", source, "add", ".");
	f.git("-C", source, "commit", "-qm", "advance base");
	f.git("-C", source, "push", "origin", "main");
	f.state.base = f.git("-C", source, "rev-parse", "HEAD");
	f.state.providerMergeability = mergeState;
	f.state.blockers = [
		{ kind: "stale", message: "Integrate the base", action: "fix" },
	];
	const original = f.agent.getMockImplementation()!;
	f.agent.mockImplementation(async (ctx) => {
		if (ctx.step.id === "ci-fix") {
			f.git("fetch", "origin", "main");
			f.git("rebase", "origin/main");
			f.state.providerMergeability = "CLEAN";
			f.state.blockers = [];
		}
		return original(ctx);
	});
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.agent.mock.calls.map(([ctx]) => ctx.step.id)).toEqual([
		"ci-fix",
		"feedback",
	]);
	expect(f.git("rev-parse", "HEAD")).toBe(f.state.base);
	expect(f.state.prHead).toBe(f.state.base);
	expect(f.run.checkpoint?.outcome).toBe("to-review");
});
it.each([
	false,
	true,
])("CI wait routes to review only when the PR head changes (head changed=%s)", async (headChanged) => {
	const f = fixture("v2-ci");
	f.state.ci = "pending";
	const pending = f.runtime.launch(f.run);
	await waitForRuntime(() =>
		expect(f.run.checkpoint?.active?.wait?.polls).toBeGreaterThan(1),
	);
	f.state.base = "concurrent-merge-base";
	if (headChanged) {
		const originalRead = f.read.getMockImplementation()!;
		f.read.mockImplementation(async () => {
			f.state.prHead = "new-provider-head";
			return originalRead();
		});
	}
	f.state.ci = "green";
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe(
		headChanged ? "to-review" : "completed",
	);
	expect(f.agent).not.toHaveBeenCalled();
});
it("raw standalone approval JSON cannot authorize merge", async () => {
	const f = fixture("v2-merge");
	f.run.launchInputs!.approval = JSON.stringify({ action: "approve" });
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.merge).not.toHaveBeenCalled();
});
it("merge rejects approval when the workspace changes while the human waits", async () => {
	const f = fixture("v2-merge", { approval: true });
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	writeFileSync(join(f.workspace, "file.ts"), "changed after display\n");
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.merge).not.toHaveBeenCalled();
});
it("merge queue releases reservations and capacity until provider confirmation", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.state.queue = true;
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("completed");
	expect(f.merge).toHaveBeenCalledExactlyOnceWith(
		url,
		f.state.prHead,
		"squash",
	);
	expect(f.run.outputs.merge).toEqual({
		repositories: [
			{ repositoryId: "repo", merged: true, sha: "merged-sha", url },
		],
	});
	expect(
		Object.values(f.run.deliveryReservations!).every(
			(r) => r.phase === "released",
		),
	).toBe(true);
	expect(await f.ticket.read()).toMatchObject({
		state: { type: "completed" },
		comments: [{ body: expect.stringContaining("provider confirmed merge") }],
	});
});
it.each([
	"failed",
	"behind",
	"review",
])('routes merge blocker "%s" to its composition outcome', async (blocker) => {
	const f = fixture("v2-merge", { approval: true });
	if (blocker === "failed") f.state.ci = "red";
	if (blocker === "behind") {
		f.state.providerMergeability = "BEHIND";
		f.state.blockers = [
			{
				kind: "stale",
				message: "Branch must be updated from the base",
				action: "fix",
			},
		];
	}
	if (blocker === "review") f.state.threads = [{ id: "thread" }];
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe(
		blocker === "review" ? "to-review" : "to-ci",
	);
	expect(f.merge).not.toHaveBeenCalled();
});
it("scripted F1 merge exposes required review and retains approval across capacity-free wait and restart", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.state.decision = "REVIEW_REQUIRED";
	f.state.providerMergeability = "BLOCKED";
	f.state.blockers = [
		{
			kind: "reviews",
			message: "Required reviewer approval is missing",
			action: "human",
		},
	];
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	await answer(f.runtime, f.run, "approve");
	await waiting(f.run, "merge-assistance");
	const server = new FactoryServer(f.runtime, {
		repositories: () => [{ id: "repo", name: "Repository" }],
		sessions: () => [],
		entries: () => [],
	});
	try {
		const activity = await server.app.inject({
			method: "GET",
			url: `/api/runs/${f.run.id}`,
		});
		expect(activity.statusCode, activity.body).toBe(200);
		expect(activity.body).toContain("Required reviewer approval is missing");
		const response = await server.app.inject({
			method: "POST",
			url: `/api/runs/${f.run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: {
				batchId: f.run.viewDecision!.id,
				digest: f.run.viewDecision!.digest,
				documentDigest: f.run.viewDecision!.documentDigest,
				accepted: true,
				action: "continue",
				values: {},
			},
		});
		expect(response.statusCode, response.body).toBe(200);
		await waitForRuntime(() =>
			expect(f.run.checkpoint?.active?.wait?.polls).toBeGreaterThan(1),
		);
		expect(f.merge).not.toHaveBeenCalled();
		expect(await f.capacity.snapshot()).toMatchObject({ active: 0, queued: 0 });
	} finally {
		await server.stop();
	}
	const resumed = await restart(f);
	await pending;
	f.state.decision = "APPROVED";
	f.state.providerMergeability = "CLEAN";
	f.state.blockers = [];
	await done(resumed.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(resumed.run.checkpoint?.outcome).toBe("completed");
	expect(resumed.run.history.filter((h) => h.step === "approval")).toHaveLength(
		1,
	);
	expect(resumed.run.history.some((h) => h.step === "to-ci")).toBe(false);
});
it.each([
	"pending",
	"rules",
	"queue-behind",
])("merge waits internally for %s and merges once it clears", async (blocker) => {
	const f = fixture("v2-merge", { approval: true });
	if (blocker === "pending") f.state.ci = "pending";
	else {
		f.state.providerMergeability = blocker === "rules" ? "BLOCKED" : "BEHIND";
		f.state.blockers =
			blocker === "rules"
				? [
						{
							kind: "rules",
							message: "GitHub merge rules: BLOCKED",
							action: "wait",
						},
					]
				: [];
	}
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	await answer(f.runtime, f.run, "approve");
	await waitForRuntime(() =>
		expect(f.run.checkpoint?.active?.wait?.polls).toBeGreaterThan(1),
	);
	expect(f.run.step).toBe("merge-wait");
	expect(f.merge).not.toHaveBeenCalled();
	expect(await f.capacity.snapshot()).toMatchObject({ active: 0, queued: 0 });
	f.state.ci = "green";
	f.state.providerMergeability = "CLEAN";
	f.state.blockers = [];
	await pending;
	await done(f.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(f.run.history.filter((h) => h.step === "approval")).toHaveLength(1);
});
it("merge wait timeout explains the provider blocker without recycling approval", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.state.providerMergeability = "BLOCKED";
	f.state.blockers = [
		{
			kind: "rules",
			message: "Branch rule requires operator action",
			action: "wait",
		},
	];
	f.run.workflow.steps.find((s) => s.id === "merge-wait")!.timeout = 100;
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	await answer(f.runtime, f.run, "approve");
	await waiting(f.run, "merge-assistance");
	expect(JSON.stringify(f.run.viewDecision)).toContain(
		"Branch rule requires operator action",
	);
	expect(f.merge).not.toHaveBeenCalled();
	f.state.providerMergeability = "CLEAN";
	f.state.blockers = [];
	// Only the first wait tests expiry. Give recovery enough time for its real
	// checkpoint/provider read under full-suite load instead of expiring again.
	f.run.workflow.steps.find((s) => s.id === "merge-wait")!.timeout = 10000;
	await answer(f.runtime, f.run, "continue");
	await pending;
	await done(f.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(f.run.history.filter((h) => h.step === "approval")).toHaveLength(1);
});
it("reconciles a lost merge response after restart without double merge", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.state.failMerge = true;
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await waitForRuntime(() => expect(f.run.status).toBe("failed"));
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(
		Object.values(f.run.nodeEffects!).some((r) => r.phase === "uncertain"),
	).toBe(true);
	const resumed = await restart(f, true);
	await done(resumed.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
});
it("a restart after confirmed merge reconciles ticket completion without replaying merge", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.state.failStatus = true;
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await waitForRuntime(() => expect(f.run.status).toBe("failed"));
	f.state.failStatus = false;
	const resumed = await restart(f, true);
	await done(resumed.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(f.ticket.setStatus).toHaveBeenCalledTimes(1);
});
it("external delivery retains corrections and re-verifies before a fresh human acceptance", async () => {
	const f = fixture("v2-external");
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "accept");
	await answer(f.runtime, f.run, "changes");
	await waitForRuntime(() =>
		expect(
			f.agent.mock.calls.filter(([ctx]) => ctx.step.id === "verify"),
		).toHaveLength(2),
	);
	await waiting(f.run, "accept");
	expect((await f.ticket.read()).title).toBe("Corrected");
	const resumed = await restart(f);
	await pending;
	await waiting(resumed.run, "accept");
	await answer(resumed.runtime, resumed.run, "accept");
	await done(resumed.run);
	expect(resumed.run.outputs.delivery).toEqual({
		applied: true,
		verified: true,
		ticketUrl: "https://tickets.test/1",
	});
	expect(resumed.run.checkpoint?.outcome).toBe("completed");
	expect(
		f.agent.mock.calls.filter(([ctx]) => ctx.step.id === "apply"),
	).toHaveLength(1);
});
it("external correction returns scope changes to the planner without completion", async () => {
	const f = fixture("v2-external");
	const original = f.hooks.agent;
	f.hooks.agent = async (ctx) =>
		ctx.step.id === "correction"
			? {
					applied: false,
					revisePlan: true,
					summary: "Needs new authorization",
					receipts: [],
				}
			: original(ctx);
	const runtime = new WorkflowRuntime(f.home, f.hooks);
	runtimes.push(runtime);
	runtime.runs.set(f.run.id, f.run);
	const pending = runtime.launch(f.run);
	await waiting(f.run);
	await answer(runtime, f.run, "changes");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("revise-plan");
	expect(f.ticket.setStatus).not.toHaveBeenCalled();
});
it("deferred explains and comments while leaving the ticket open", async () => {
	const f = fixture("v2-deferred");
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.agent).not.toHaveBeenCalled();
	expect(f.ticket.setStatus).not.toHaveBeenCalled();
	expect((await f.ticket.read()).comments).toEqual([
		{ body: expect.stringContaining("Execution remains deferred") },
	]);
	expect(f.run.viewRecords).toHaveLength(1);
});

it.each([
	true,
	false,
])("merge requires a safe fresh carry-forward assessment (%s)", async (safe) => {
	const f = fixture("v2-merge", {
		approval: true,
		carried: true,
		carrySafe: safe,
	});
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe(safe ? "completed" : "to-review");
	expect(f.merge).toHaveBeenCalledTimes(safe ? 1 : 0);
});
it("Merge expectedRevision takes the provider head from a stamped receipt instead of request JSON", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.run.workflow.steps = f.run.workflow.steps.filter((s) =>
		["pr-source", "approval", "merge"].includes(s.id),
	);
	f.run.workflow.steps[1]!.next = "merge";
	const merge = f.run.workflow.steps[2]!;
	merge.requests = [
		{ repositoryId: "repo", url, headSha: "untrusted-json-head" },
	];
	merge.next = "completed";
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.merge).toHaveBeenCalledExactlyOnceWith(
		url,
		f.state.prHead,
		"squash",
	);
});
it("mixed repository delivery retains merge without completing the ticket", async () => {
	const f = fixture("v2-merge", { approval: true });
	f.run.launchInputs!.completion = JSON.stringify({ final: false });
	const pending = f.runtime.launch(f.run);
	await waiting(f.run);
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(f.ticket.setStatus).not.toHaveBeenCalled();
	expect((await f.ticket.read()).state).toEqual({ type: "started" });
});
it("external target drift forces independent verification and renewed acceptance", async () => {
	const f = fixture("v2-external");
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "accept");
	await f.ticket.update({ title: "Concurrent change" });
	await answer(f.runtime, f.run, "accept");
	await waitForRuntime(() =>
		expect(
			f.agent.mock.calls.filter(([ctx]) => ctx.step.id === "verify"),
		).toHaveLength(2),
	);
	await waiting(f.run, "accept");
	expect(f.ticket.setStatus).not.toHaveBeenCalled();
	await answer(f.runtime, f.run, "accept");
	await pending;
	await done(f.run);
});
it("CI retains base changes and unresolved feedback as separate review reasons", async () => {
	const f = fixture("v2-ci");
	f.state.ci = "red";
	const original = f.hooks.agent;
	f.hooks.agent = async (ctx) => {
		const result = await original(ctx);
		if (ctx.step.id === "ci-fix") {
			f.state.base = "new-base";
			f.state.threads = [{ id: "unresolved" }];
		}
		return result;
	};
	await f.runtime.launch(f.run);
	await done(f.run);
	expect(f.run.outputs["after-fix"]).toMatchObject({
		codeChanged: false,
		revisionChanged: false,
		baseChanged: true,
		feedbackRequiresReview: true,
	});
	expect(f.run.checkpoint?.outcome).toBe("to-review");
});
it("scripted F1 external delivery drives correction, cold restart and explicit completion through the authenticated API", async () => {
	const f = fixture("v2-external");
	const serverFor = (runtime: WorkflowRuntime) =>
		new FactoryServer(runtime, {
			repositories: () => [{ id: "repo", name: "Repository" }],
			sessions: () => [],
			entries: () => [],
			stop: (id) => runtime.stop(id),
			start: async () => {
				void runtime.launch(f.run);
				return f.run;
			},
		});
	let server = serverFor(f.runtime);
	try {
		const started = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers: { "x-factory-request": "1" },
			payload: {
				repositoryId: "repo",
				workflow: f.run.workflow.id,
				prompt: "Scripted C4 delivery",
			},
		});
		expect(started.statusCode, started.body).toBe(202);
		await waiting(f.run, "accept");
		const submit = async (run: FactoryRun, action: string) => {
			const response = await server.app.inject({
				method: "POST",
				url: `/api/runs/${run.id}/view-answer`,
				headers: { "x-factory-request": "1" },
				payload: {
					batchId: run.viewDecision!.id,
					digest: run.viewDecision!.digest,
					documentDigest: run.viewDecision!.documentDigest,
					accepted: true,
					action,
					values: { notes: action === "changes" ? "Correct the title" : "" },
				},
			});
			expect(response.statusCode, response.body).toBe(200);
		};
		const firstDigest = f.run.viewDecision!.digest;
		await submit(f.run, "changes");
		await waitForRuntime(() =>
			expect(
				f.agent.mock.calls.filter(([ctx]) => ctx.step.id === "verify"),
			).toHaveLength(2),
		);
		await waiting(f.run, "accept");
		expect(f.run.viewDecision!.digest).not.toBe(firstDigest);
		expect((await f.ticket.read()).title).toBe("Corrected");
		await server.stop();
		const resumed = await restart(f);
		server = serverFor(resumed.runtime);
		await waiting(resumed.run, "accept");
		await submit(resumed.run, "accept");
		await done(resumed.run);
		expect(resumed.run.outputs.delivery).toEqual({
			applied: true,
			verified: true,
			ticketUrl: "https://tickets.test/1",
		});
		expect((await f.ticket.read()).state).toEqual({ type: "completed" });
		const activity = await server.app.inject({
			method: "GET",
			url: `/api/runs/${resumed.run.id}/activity?limit=100`,
		});
		expect(activity.statusCode, activity.body).toBe(200);
		expect(activity.body).toContain("accept");
		expect(resumed.run.viewRecords).toHaveLength(2);
		expect(
			f.agent.mock.calls.filter(([ctx]) => ctx.step.id === "apply"),
		).toHaveLength(1);
	} finally {
		await server.stop();
	}
});

it("mixed final acceptance binds confirmed repository delivery and verified external work", async () => {
	const f = fixture("v2-external", { approval: true, mixed: true });
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	await answer(f.runtime, f.run, "approve");
	await waiting(f.run, "accept");
	expect(f.merge).toHaveBeenCalledTimes(1);
	expect(f.ticket.setStatus).not.toHaveBeenCalled();
	expect(f.run.outputs["repository-context"]).toMatchObject({
		approval: { action: "approve" },
		merge: { repositories: [{ merged: true }] },
	});
	const responseStamp = f.run.checkpoint!.active!.nodeStamp;
	expect(responseStamp).toBeDefined();
	await answer(f.runtime, f.run, "accept");
	await pending;
	await done(f.run);
	const accepted = f.run.history.find((h) => h.step === "accept")!;
	expect(Object.keys(accepted.guarantee!.boundDigests).sort()).toEqual([
		"guide",
		"repository-context",
		"verify",
	]);
	expect((await f.ticket.read()).state).toEqual({ type: "completed" });
});

it("a remote-only head change after approval routes back to review before dispatch", async () => {
	const f = fixture("v2-merge", { approval: true });
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	f.state.prHead = "remote-only-change";
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.merge).not.toHaveBeenCalled();
});

it.each([
	false,
	true,
])("a head change during merge preflight or queue confirmation returns to review (queue=%s)", async (queue) => {
	const f = fixture("v2-merge", { approval: true });
	f.state.queue = queue;
	const pending = f.runtime.launch(f.run);
	await waiting(f.run, "approval");
	const original = vi.mocked(f.provider.view).getMockImplementation()!;
	vi.mocked(f.provider.view).mockImplementation(async (...args) => {
		if (queue ? f.state.queued : f.run.step === "merge")
			f.state.prHead = "new-remote-head";
		return original(...args);
	});
	await answer(f.runtime, f.run, "approve");
	await pending;
	await done(f.run);
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.merge).toHaveBeenCalledTimes(queue ? 1 : 0);
	expect((await f.ticket.read()).state).toEqual({ type: "started" });
});
