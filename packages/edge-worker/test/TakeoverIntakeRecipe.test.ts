import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const mocks = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: mocks.provider,
}));
const owned: { home: string; runtime: WorkflowRuntime }[] = [];
afterEach(async () => {
	for (const { runtime, home } of owned.splice(0)) {
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});
const assessment = {
	requirements: {
		summary: "Retain recovery obligations",
		requirements: [
			{
				id: "r1",
				text: "Pending work survives restart",
				source: "ticket discussion",
			},
		],
		decisions: [],
		outOfScope: ["Rewrite completed work"],
	},
	plan: {
		summary:
			"Continue the existing branch and request; add missing recovery validation",
		deliveryMode: "repository",
		steps: [
			{
				id: "p1",
				text: "Test recovery against the existing implementation",
				requirementRefs: ["r1"],
			},
		],
		risks: ["Unresolved review feedback"],
		repositories: ["fixture"],
	},
	completed: ["Implementation"],
	remaining: ["Recovery test"],
	risks: ["Unresolved review feedback"],
	assets: [],
};
function fixture(
	provider: "github" | "gitlab",
	mode: "manual" | "call" | "ticket" | "combined",
	options: {
		advancedBase?: boolean;
		missingBase?: boolean;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "takeover-intake-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", home, ...args], {
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	writeFileSync(join(home, ".git/info/exclude"), "state/\n");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", "/dev/null");
	writeFileSync(join(home, "work.ts"), "original\n");
	git("add", ".");
	git("commit", "-m", "Base");
	const branchPoint = git("rev-parse", "HEAD");
	let base = branchPoint;
	git("update-ref", "refs/remotes/origin/main", base);
	git("checkout", "-b", "existing");
	writeFileSync(join(home, "work.ts"), "original\ncompleted work\n");
	git("add", ".");
	git("commit", "-m", "Existing work");
	const head = git("rev-parse", "HEAD");
	// An explicit PR base must win even if the configured tracking ref has moved.
	if (mode !== "ticket") git("update-ref", "refs/remotes/origin/main", head);
	if (options.advancedBase) {
		const upstream = join(home, "state", "upstream");
		mkdirSync(join(home, "state"));
		git("clone", "--no-hardlinks", home, upstream);
		const remoteGit = (...args: string[]) => git("-C", upstream, ...args);
		remoteGit("checkout", "main");
		remoteGit("config", "user.name", "Fixture");
		remoteGit("config", "user.email", "fixture@example.invalid");
		remoteGit("config", "commit.gpgsign", "false");
		remoteGit("config", "core.hooksPath", "/dev/null");
		writeFileSync(join(upstream, "main-only.ts"), "New main work\n");
		remoteGit("add", ".");
		remoteGit("commit", "-m", "Main advances after the branch point");
		base = remoteGit("rev-parse", "HEAD");
		git("remote", "add", "origin", upstream);
		if (!options.missingBase)
			git("fetch", "--no-tags", "--no-write-fetch-head", "origin", base);
	}
	const url =
		provider === "github"
			? "https://github.com/team/project/pull/7"
			: "https://gitlab.com/team/project/-/merge_requests/7";
	const pr = {
		url,
		number: 7,
		title: "Existing work",
		body: "Preserve this implementation",
		headRefName: "existing",
		headRefOid: head,
		baseRefName: "main",
		baseSha: base,
		state: "OPEN",
		isDraft: false,
		isCrossRepository: false,
		checks: [],
		reviews: [{ body: "Please test recovery" }],
		unresolvedThreads: [{ id: "t1", body: "Restart loses work" }],
		comments: [{ body: "Keep completed work" }],
	};
	const readPr = vi.fn(async (requested: string) => {
		expect(requested).toBe(url);
		return structuredClone(pr);
	});
	const draft = vi.fn();
	mocks.provider.mockResolvedValue({ read: readPr, draft });
	const ticket = {
		id: "T-1",
		url: "https://linear.app/team/issue/T-1",
		title: "Recovery",
		description: "Retain pending work",
		comments: [{ body: "Do not replace completed work" }],
		attachments: [],
	};
	const reference = {
		provider: "native" as const,
		platform: "linear",
		workspaceId: "workspace",
		id: "T-1",
		url: ticket.url,
	};
	const readTicket = vi.fn(async () => structuredClone(ticket));
	const agent = vi.fn(async (context: ExecutionContext) => {
		const reads = stepBindings(context);
		expect(context.step.id).toBe("assess-existing");
		expect(reads.existingWork).toMatchObject({
			diff: {
				repositories: [
					{
						id: "fixture",
						head,
						base: branchPoint,
						target: head,
						files: ["work.ts"],
						stats: {
							filesChanged: 1,
							additions: 1,
							deletions: 0,
							binaryFiles: 0,
						},
					},
				],
			},
			status: {
				repositories: [
					{ id: "fixture", head, branch: "existing", dirty: false },
				],
			},
			fields: {
				source: mode === "ticket" ? "T-1" : url,
				prompt: "Retain completed work",
			},
		});
		if (mode !== "manual")
			expect((reads.existingWork as any).ticket).toEqual(ticket);
		if (mode !== "ticket")
			expect((reads.existingWork as any).pr.repositories[0]).toMatchObject(pr);
		return parseStepOutputAsync(context.step, structuredClone(assessment));
	});
	const runtime = new WorkflowRuntime(join(home, "state"), {
		agent,
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async () => {
			throw new Error("Unexpected legacy tool");
		},
		ticketIO: async (_run, ref) => {
			expect(ref).toEqual(reference);
			return { read: readTicket } as any;
		},
	});
	owned.push({ home, runtime });
	const intake = defaultWorkflows.find((w) => w.id === "v2-takeover-intake")!;
	const caller = WorkflowSchema.parse({
		id: "intake-caller",
		name: "Intake caller",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "targets",
				name: "Targets",
				type: "transform",
				transform: { pr: { literal: { url } }, ticket: { literal: reference } },
			},
			{
				id: "intake",
				name: "Intake",
				type: "workflow",
				workflow: intake.id,
				inputMapping: { pr: "/targets/pr", ticket: "/targets/ticket" },
			},
		],
	});
	const workflow = mode === "call" ? caller : intake;
	const definitions = [...defaultWorkflows, caller];
	const run = runtime.create({
		repositoryId: "fixture",
		workspace: home,
		repositories: [
			{
				id: "fixture",
				name: "Fixture",
				repositoryPath: home,
				workspace: home,
				baseBranch: "main",
				[provider === "github" ? "githubUrl" : "gitlabUrl"]: url.split(
					provider === "github" ? "/pull/" : "/-/merge_requests/",
				)[0],
			},
		],
		input: "Retain completed work",
		launchInputs: {
			source: mode === "ticket" ? "T-1" : url,
			prompt: "Retain completed work",
		},
		...(mode === "ticket" || mode === "combined"
			? { ticketReference: reference, ticketSnapshot: ticket }
			: {}),
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	return { runtime, run, agent, readPr, readTicket, draft, head, base, git };
}

describe("v2-takeover-intake", () => {
	it.each([
		"github",
		"gitlab",
	] as const)("reads %s launch fields and publishes the contract ports", async (provider) => {
		const f = fixture(provider, "manual");
		await f.runtime.launch(f.run);
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.run.outputs.result).toEqual({
			requirements: assessment.requirements,
			plan: assessment.plan,
		});
		expect(f.readPr).toHaveBeenCalledOnce();
		expect(f.readTicket).not.toHaveBeenCalled();
		expect(f.draft).not.toHaveBeenCalled();
		expect(f.git("rev-parse", "HEAD")).toBe(f.head);
	});
	it.each([
		"github",
		"gitlab",
	] as const)("reads explicit %s request and ticket ports through a workflow call", async (provider) => {
		const f = fixture(provider, "call");
		await f.runtime.launch(f.run);
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.run.outputs.intake).toMatchObject({
			outcome: "completed",
			outputs: {
				result: {
					requirements: assessment.requirements,
					plan: assessment.plan,
				},
			},
		});
		expect(f.agent).toHaveBeenCalledOnce();
		expect(f.readPr).toHaveBeenCalledOnce();
		expect(f.readTicket).toHaveBeenCalledOnce();
	});
	it("reads a prepared ticket-only launch without requiring an open request", async () => {
		const f = fixture("github", "ticket");
		await f.runtime.launch(f.run);
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.readTicket).toHaveBeenCalledOnce();
		expect(f.readPr).not.toHaveBeenCalled();
		expect(f.run.outputs.result).toEqual({
			requirements: assessment.requirements,
			plan: assessment.plan,
		});
	});
	it("reads an explicit launch request even when an originating ticket is present", async () => {
		const f = fixture("github", "combined");
		await f.runtime.launch(f.run);
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.readPr).toHaveBeenCalledOnce();
		expect(f.readTicket).toHaveBeenCalledOnce();
	});

	it.each([
		false,
		true,
	])("excludes newer main changes from the branch diff (missing base: %s)", async (missingBase) => {
		const f = fixture("github", "manual", { advancedBase: true, missingBase });
		const refs = f.git("for-each-ref", "--format=%(refname) %(objectname)");
		if (missingBase)
			expect(() => f.git("cat-file", "-e", `${f.base}^{commit}`)).toThrow();
		await f.runtime.launch(f.run);
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.agent).toHaveBeenCalledOnce();
		expect(f.git("cat-file", "-t", f.base)).toBe("commit");
		expect(f.git("rev-parse", "HEAD")).toBe(f.head);
		expect(f.git("for-each-ref", "--format=%(refname) %(objectname)")).toBe(
			refs,
		);
	});

	it("rejects an assessment that omits required plan fields", async () => {
		const step = defaultWorkflows
			.find((w) => w.id === "v2-takeover-intake")!
			.steps.find((s) => s.id === "assess-existing")!;
		await expect(
			parseStepOutputAsync(step, {
				...assessment,
				plan: { summary: "Incomplete" },
			}),
		).rejects.toThrow();
	});
});
