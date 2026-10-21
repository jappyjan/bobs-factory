import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	type ImprovementAction,
	type ImprovementProposal,
	type ItemChoice,
	OpportunitySchema,
	validatePackages,
} from "../src/factory/Improvement.js";
import {
	fileLinearImprovement,
	fileTaskbotImprovement,
} from "../src/factory/ImprovementIssues.js";
import { applyImprovementAction } from "../src/factory/ImprovementRuntime.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const runtimes: WorkflowRuntime[] = [],
	directories: string[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const opportunity = (id: string, dependencies: string[] = []) =>
	OpportunitySchema.parse({
		id,
		title: `Improve ${id}`,
		problem: `Systemic ${id} ownership is split`,
		evidence: [`src/${id}.ts at pinned revision`],
		consequence: "Recovery changes cross unrelated modules",
		before: "Callers own coordination",
		after: "One module owns coordination",
		plan: `Concentrate ${id} ownership and verify recovery through its interface`,
		criteria: ["Recovery retains state"],
		strength: "strong",
		effort: "Small",
		dependencies,
	});
function fixture(extra: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "improvement-test-"));
	directories.push(home);
	const repository = join(home, "repository");
	mkdirSync(repository);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", repository, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	git("init", "-b", "main");
	writeFileSync(join(repository, "README.md"), "Architecture fixture\n");
	writeFileSync(
		join(repository, "package.json"),
		JSON.stringify({ name: "bobs-factory-fixture" }),
	);
	git("add", "README.md", "package.json");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"-c",
		"commit.gpgsign=false",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-m",
		"Fixture",
	);
	const definition = WorkflowSchema.parse({
		...defaultWorkflows.find((w) => w.id === "improve-codebase")!,
		id: "survey",
		steps: defaultWorkflows
			.find((w) => w.id === "improve-codebase")!
			.steps.map((s) =>
				s.id === "research-worker"
					? { ...s, model: "configured-cheaper-model" }
					: s,
			),
	});
	const factory = WorkflowSchema.parse({
		id: "factory",
		name: "Fixture child delivery",
		allowedTriggers: ["manual", "workflow"],
		steps: [
			{
				id: "merge",
				name: "Scripted delivery",
				type: "tool",
				tool: "fixture-delivery",
			},
		],
	});
	const opportunities = [
		opportunity("a"),
		opportunity("b"),
		opportunity("c", ["a"]),
		opportunity("later"),
		opportunity("skip"),
	];
	const deliveries = new Map<string, () => void>();
	const calls: string[] = [];
	const agent = vi.fn(async (context: ExecutionContext) => {
		calls.push(context.stepKey!);
		expect(context.readOnlyResearch).toBe(true);
		const input = context.input as Record<string, any>;
		if (context.step.id === "lead")
			return { summary: "Shared architectural context", limitations: [] };
		if (
			context.step.id.startsWith("coordinate-") &&
			context.step.id !== "coordinate-results"
		)
			return {
				summary: "Focused research",
				assignments: [
					{ id: "first", question: "Inspect ownership", scope: ["README.md"] },
					{
						id: "second",
						question: "Inspect dependency direction",
						scope: ["README.md"],
					},
				],
			};
		if (
			context.step.id === "research-worker" ||
			context.step.id === "coordinate-results"
		)
			return {
				summary: "No additional systemic findings",
				findings: [],
				limitations: [],
			};
		if (context.step.id === "synthesize")
			return {
				summary: input.comments?.length
					? "Follow-up answered with evidence"
					: "Largest architectural opportunities",
				opportunities,
				limitations: [],
			};
		if (context.step.id === "package")
			return {
				packages: [
					{
						id: input.item.id,
						itemIds: [input.item.id],
						title: input.item.title,
						plan: input.item.plan,
						criteria: input.item.criteria,
						dependencies: input.item.dependencies,
						paths: [],
					},
				],
			};
		return { approved: true, feedback: [] };
	});
	const hooks: RuntimeHooks = {
		agent,
		script: async () => ({}),
		prepare: async (run) => {
			if (!run.improvementParent || run.setupComplete) return;
			const workspace = join(home, run.id);
			git("worktree", "add", "--detach", workspace, "main");
			run.workspace = workspace;
			run.setupComplete = true;
		},
		tool: async (context) => {
			await new Promise<void>((resolve, reject) => {
				deliveries.set(context.run.improvementParent!.packageId, resolve);
				context.signal.addEventListener(
					"abort",
					() => reject(context.signal.reason),
					{ once: true },
				);
			});
			context.run.humanDecisions = [
				{
					reviewId: "fixture-human-approval",
					headSha: "fixture",
					decision: "approve",
					at: new Date().toISOString(),
				},
			];
			context.run.outputs["draft-pr"] = {
				url: "https://example.test/pr/1",
				headSha: "fixture",
			};
			return {
				merged: true,
				url: "https://example.test/pr/1",
				headSha: "fixture",
			};
		},
		improvementIssue: async (_run, issue) => ({
			id: "42",
			url: `https://tickets.example/p/project/t/42#${issue.key}`,
		}),
		...extra,
	};
	const load = () => {
		const runtime = new WorkflowRuntime(home, hooks);
		runtimes.push(runtime);
		return runtime;
	};
	const runtime = load();
	const run = runtime.create(
		{
			repositoryId: "repo",
			workspace: repository,
			workflow: definition,
			workflowDefinitions: [definition, factory],
			input: "Improve architecture",
			launchInputs: { focus: "recovery" },
			triggerOrigin: {
				type: "manual",
				workflowId: definition.id,
				at: new Date().toISOString(),
			},
		},
		{ workflow: definition, workflowDefinitions: [definition, factory] },
	);
	const decide = (
		action: ImprovementAction["action"],
		choices?: Record<string, ItemChoice>,
	) =>
		runtime.decideImprovement(
			run.id,
			{
				action,
				version: run.improvementState!.proposals.at(-1)!.version,
				digest: run.improvementState!.proposals.at(-1)!.digest,
				expectedRevision: run.improvementState!.revision,
				manifestDigest: run.improvementState!.manifest?.digest,
				...(choices ? { choices } : {}),
			},
			"fixture-operator",
		);
	return {
		runtime,
		run,
		load,
		home,
		repository,
		calls,
		agent,
		opportunities,
		deliveries,
		decide,
	};
}
async function waitDiscussion(run: FactoryRun) {
	await vi.waitFor(
		() => {
			expect(run.status).toBe("waiting");
			expect(run.improvementState?.phase).toBe("discussion");
		},
		{ timeout: 10000 },
	);
}

describe("improvement action safety", () => {
	it("keeps issue, ignore and follow-up actions out of implementation; rejects missing prerequisites", () => {
		const proposal: ImprovementProposal = {
			summary: "Architecture",
			opportunities: [opportunity("a"), opportunity("b", ["a"])],
			limitations: [],
			version: 1,
			digest: "a".repeat(64),
			at: new Date().toISOString(),
		};
		expect(() =>
			validatePackages(
				proposal,
				{
					a: {
						action: "issue",
						comment: "",
						destination: { provider: "linear", workspaceId: "w", teamId: "t" },
					},
					b: { action: "fix", comment: "" },
				},
				[],
			),
		).toThrow("requires Fix");
		expect(() =>
			validatePackages(
				proposal,
				{ a: { action: "follow-up", comment: "Why?" } },
				[],
			),
		).toThrow("Resolve follow-up");
		expect(() =>
			validatePackages(
				proposal,
				{ a: { action: "ignore", comment: "Good enough" } },
				[],
			),
		).not.toThrow();
	});
	it("rejects a stale proposal or choice revision without changing accepted choices", async () => {
		const f = fixture();
		void f.runtime.launch(f.run);
		await waitDiscussion(f.run);
		await f.decide("choose", {
			a: { action: "ignore", comment: "Good enough" },
		});
		const before = structuredClone(f.run.improvementState);
		expect(() =>
			applyImprovementAction(
				f.run,
				{
					action: "choose",
					expectedRevision: before!.revision - 1,
					version: 1,
					digest: before!.proposals[0]!.digest,
					choices: { a: { action: "fix", comment: "" } },
				},
				"other",
			),
		).toThrow("Choices changed");
		expect(f.run.improvementState).toEqual(before);
	});
});

it("runs bounded coordinator/cheap-worker research, then separates Fix, issue and ignore with dependency-aware children", async () => {
	const f = fixture();
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	expect(f.calls.filter((c) => c.startsWith("worker-")).length).toBe(16);
	expect(
		f.agent.mock.calls
			.filter(([c]) => c.step.id === "research-worker")
			.every(([c]) => c.step.model === "configured-cheaper-model"),
	).toBe(true);
	expect(f.runtime.runs.size).toBe(1);
	await f.decide("prepare", {
		a: { action: "fix", comment: "" },
		b: { action: "fix", comment: "" },
		c: { action: "fix", comment: "" },
		later: {
			action: "issue",
			comment: "Later",
			destination: {
				provider: "taskbot",
				server: "taskbot",
				instance: "https://tickets.example",
				project: "project",
			},
		},
		skip: { action: "ignore", comment: "Good enough" },
	});
	await vi.waitFor(() => {
		expect(f.run.improvementState?.phase).toBe("ready");
		expect(f.run.status).toBe("waiting");
	});
	expect(f.runtime.runs.size).toBe(1);
	await f.decide("apply");
	await vi.waitFor(() =>
		expect([...f.deliveries.keys()].sort()).toEqual(["a", "b"]),
	);
	expect(Object.keys(f.run.improvementState!.children).sort()).toEqual([
		"a",
		"b",
	]);
	expect(f.run.improvementState!.issues.later?.phase).toBe("confirmed");
	const children = [...f.runtime.runs.values()].filter(
		(r) => r.improvementParent,
	);
	expect(new Set(children.map((r) => r.workspace)).size).toBe(2);
	f.deliveries.get("a")!();
	await vi.waitFor(() => expect(f.deliveries.has("c")).toBe(true));
	f.deliveries.get("b")!();
	f.deliveries.get("c")!();
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	expect(f.runtime.runs.size).toBe(4);
	expect(f.run.improvementState!.acceptance?.actor).toBe("fixture-operator");
});

it("preserves research and choices across restart and answers follow-up without silently selecting Fix", async () => {
	const f = fixture();
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	await f.decide("choose", {
		a: { action: "ignore", comment: "Not worth disruption" },
	});
	await f.runtime.shutdown();
	const restored = f.load(),
		run = restored.get(f.run.id);
	const count = f.calls.length;
	restored.resumeAll();
	await waitDiscussion(run);
	expect(f.calls.length).toBe(count);
	expect(run.improvementState!.choices.a?.action).toBe("ignore");
	const p = run.improvementState!.proposals.at(-1)!;
	await restored.decideImprovement(
		run.id,
		{
			action: "follow-up",
			expectedRevision: run.improvementState!.revision,
			version: p.version,
			digest: p.digest,
			itemId: "b",
			comment: "Explain the architectural benefit",
		},
		"human",
	);
	await vi.waitFor(() =>
		expect(run.improvementState!.proposals.length).toBe(2),
	);
	expect(run.improvementState!.choices.b).toBeUndefined();
	expect(run.improvementState!.choices.a?.action).toBe("ignore");
	expect(restored.runs.size).toBe(1);
});

it("reconciles a Taskbot response lost after creation, preserving the one issue and backlog-only intent", async () => {
	const key = "b".repeat(64),
		body = `Plan\n<!-- factory-improvement:${key} -->`;
	const issue = {
		key,
		title: "Architectural improvement",
		body,
		destination: {
			provider: "taskbot" as const,
			server: "taskbot",
			instance: "https://tickets.example",
			project: "project",
		},
		phase: "pending" as const,
	};
	let created = false;
	const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
		if (tool === "list_tickets") return created ? [{ id: 7 }] : [];
		if (tool === "create_ticket") {
			expect(args.status).toBe("backlog");
			created = true;
			throw new Error("Response lost");
		}
		return { id: 7, body, project: "project" };
	});
	await expect(
		fileTaskbotImprovement(issue, call, async () => {}),
	).rejects.toThrow("Response lost");
	await expect(
		fileTaskbotImprovement(issue, call, async () => {}),
	).resolves.toEqual({ id: "7", url: "https://tickets.example/p/project/t/7" });
	expect(
		call.mock.calls.filter(([tool]) => tool === "create_ticket"),
	).toHaveLength(1);
});

it("dispatches independent Fix work when issue filing fails and reconciles without duplicate runs on retry", async () => {
	let attempts = 0;
	const f = fixture({
		improvementIssue: async () => {
			attempts++;
			if (attempts === 1) throw new Error("Tracker temporarily unavailable");
			return { id: "42", url: "https://tickets.example/p/project/t/42" };
		},
	});
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	await f.decide("prepare", {
		a: { action: "fix", comment: "" },
		later: {
			action: "issue",
			comment: "",
			destination: {
				provider: "taskbot",
				server: "taskbot",
				instance: "https://tickets.example",
				project: "project",
			},
		},
	});
	await vi.waitFor(() => {
		expect(f.run.improvementState?.phase).toBe("ready");
		expect(f.run.status).toBe("waiting");
	});
	await f.decide("apply");
	await vi.waitFor(() => {
		expect(f.run.status).toBe("failed");
		expect(f.deliveries.has("a")).toBe(true);
	});
	expect(f.runtime.runs.size).toBe(2);
	expect(f.run.improvementState!.issues.later?.error).toContain(
		"Tracker temporarily unavailable",
	);
	await vi.waitFor(() => expect(f.runtime.isExecuting(f.run.id)).toBe(false));
	void f.runtime.launch(f.run);
	await vi.waitFor(() =>
		expect(f.run.improvementState!.issues.later?.phase).toBe("confirmed"),
	);
	expect(f.runtime.runs.size).toBe(2);
	f.deliveries.get("a")!();
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	expect(attempts).toBe(2);
});

it("samples only matching Bob run histories with dated outcomes, legitimate wait reasons and categorized errors", async () => {
	const f = fixture();
	const history = () =>
		f.runtime.create(
			{
				repositoryId: "repo",
				workspace: f.repository,
				workflow: f.run.workflowDefinitions![1]!,
				workflowDefinitions: f.run.workflowDefinitions!,
				input: "Historical run",
				triggerOrigin: {
					type: "manual",
					workflowId: "factory",
					at: new Date().toISOString(),
				},
			},
			{
				workflow: f.run.workflowDefinitions![1]!,
				workflowDefinitions: f.run.workflowDefinitions!,
			},
		);
	const failed = history();
	failed.status = "failed";
	failed.error = "API timeout token=DO_NOT_COPY";
	const waiting = history();
	waiting.status = "waiting";
	waiting.questions = ["Please approve the scope"];
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	const input = f.agent.mock.calls.find(([c]) => c.step.id === "lead")![0]
		.input as {
		operations: {
			total: number;
			records: { id: string; wait: string; error?: string }[];
		};
	};
	expect(input.operations.total).toBe(2);
	expect(input.operations.records.find((r) => r.id === failed.id)?.error).toBe(
		"timeout",
	);
	expect(input.operations.records.find((r) => r.id === waiting.id)?.wait).toBe(
		"questions",
	);
	expect(JSON.stringify(input.operations)).not.toContain("DO_NOT_COPY");
	expect(failed.status).toBe("failed");
	expect(waiting.status).toBe("waiting");
});

it("retains one native child and confirmed issue across a dispatch restart", async () => {
	let filed = 0;
	const f = fixture({
		improvementIssue: async () => {
			filed++;
			return { id: "42", url: "https://tickets.example/p/project/t/42" };
		},
	});
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	await f.decide("prepare", {
		a: { action: "fix", comment: "" },
		later: {
			action: "issue",
			comment: "",
			destination: {
				provider: "taskbot",
				server: "taskbot",
				instance: "https://tickets.example",
				project: "project",
			},
		},
	});
	await vi.waitFor(() => {
		expect(f.run.improvementState?.phase).toBe("ready");
		expect(f.run.status).toBe("waiting");
	});
	await f.decide("apply");
	await vi.waitFor(() => expect(f.deliveries.has("a")).toBe(true));
	const childId = f.run.improvementState!.children.a!.runId;
	await f.runtime.shutdown();
	f.deliveries.clear();
	const restored = f.load();
	restored.resumeAll();
	await vi.waitFor(() => expect(f.deliveries.has("a")).toBe(true));
	expect(restored.runs.size).toBe(2);
	expect(restored.get(f.run.id).improvementState!.children.a!.runId).toBe(
		childId,
	);
	expect(filed).toBe(1);
	f.deliveries.get("a")!();
	await vi.waitFor(() =>
		expect(restored.get(f.run.id).status).toBe("completed"),
	);
});

it("reconciles a lost Linear creation response using the same UUID without assigning deferred work", async () => {
	let saved: any;
	const issue = {
		key: "c".repeat(64),
		title: "Architectural improvement",
		body: `Plan\n<!-- factory-improvement:${"c".repeat(64)} -->`,
		destination: { provider: "linear" as const, workspaceId: "w", teamId: "t" },
		phase: "pending" as const,
	};
	const createIssue = vi.fn(async (input: any) => {
		expect(input).toMatchObject({
			assigneeId: null,
			delegateId: null,
			stateId: "backlog",
			useDefaultTemplate: false,
		});
		saved = {
			id: input.id,
			url: "https://linear.app/team/issue/T-42",
			description: input.description,
			team: Promise.resolve({ id: "t" }),
		};
		throw new Error("Response lost");
	});
	const client = {
		issues: async () => ({ nodes: saved ? [saved] : [] }),
		team: async () => ({
			states: async () => ({ nodes: [{ id: "backlog", type: "backlog" }] }),
		}),
		createIssue,
	} as unknown as Parameters<typeof fileLinearImprovement>[0];
	await expect(
		fileLinearImprovement(client, issue, async () => {}),
	).rejects.toThrow("Response lost");
	await expect(
		fileLinearImprovement(client, issue, async () => {}),
	).resolves.toEqual({ id: saved.id, url: saved.url });
	expect(createIssue).toHaveBeenCalledTimes(1);
});

it("does not cache an invalid dependency proposal as completed and reuses successful research on Retry", async () => {
	let invalid = true;
	const f = fixture({
		agent: async (context) => {
			const output = await f.agent(context);
			if (context.step.id === "synthesize" && invalid) {
				invalid = false;
				return {
					...output,
					opportunities: [opportunity("a", ["not-in-shortlist"])],
				};
			}
			return output;
		},
	});
	void f.runtime.launch(f.run);
	await waitForRuntime(() => expect(f.run.status).toBe("failed"));
	expect(f.run.improvementState!.proposals).toHaveLength(0);
	expect(f.run.improvementState!.jobs["proposal-0"]!.status).toBe("failed");
	const workers = f.calls.filter((k) => k.startsWith("worker-")).length;
	await vi.waitFor(() => expect(f.runtime.isExecuting(f.run.id)).toBe(false));
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	expect(f.calls.filter((k) => k.startsWith("worker-")).length).toBe(workers);
	expect(f.run.improvementState!.proposals).toHaveLength(1);
});

it("replans after independent feedback instead of replaying a cached rejected plan", async () => {
	let reject = true;
	const f = fixture({
		agent: async (context) => {
			const output = await f.agent(context);
			if (context.step.id === "check-security" && reject) {
				reject = false;
				return {
					approved: false,
					feedback: [
						"Fallback recovery must wait for reconciliation before execution",
					],
				};
			}
			return output;
		},
	});
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	await f.decide("prepare", { a: { action: "fix", comment: "" } });
	await vi.waitFor(() => {
		expect(f.run.status).toBe("waiting");
		expect(f.run.improvementState?.comments.at(-1)?.actor).toBe(
			"independent plan checks",
		);
	});
	expect(f.run.improvementState!.manifest).toBeUndefined();
	expect(f.calls.filter((k) => k.startsWith("package-")).length).toBe(1);
	await f.decide("prepare");
	await vi.waitFor(() => {
		expect(f.run.status).toBe("waiting");
		expect(f.run.improvementState?.phase).toBe("ready");
	});
	expect(f.calls.filter((k) => k.startsWith("package-")).length).toBe(2);
	expect(f.run.improvementState!.manifest!.checks).toHaveLength(3);
	expect(f.runtime.runs.size).toBe(1);
});

it("invalidates a prepared manifest when a new planning comment arrives", async () => {
	const f = fixture();
	void f.runtime.launch(f.run);
	await waitDiscussion(f.run);
	await f.decide("prepare", { a: { action: "fix", comment: "" } });
	await vi.waitFor(() => {
		expect(f.run.status).toBe("waiting");
		expect(f.run.improvementState?.phase).toBe("ready");
	});
	const state = f.run.improvementState!,
		proposal = state.proposals.at(-1)!;
	await f.runtime.decideImprovement(
		f.run.id,
		{
			action: "choose",
			expectedRevision: state.revision,
			version: proposal.version,
			digest: proposal.digest,
			comment: "Keep fallback recovery paused until reconciliation",
		},
		"human",
	);
	await waitDiscussion(f.run);
	expect(f.run.improvementState!.manifest).toBeUndefined();
	expect(f.run.improvementState!.choices.a?.action).toBe("fix");
});
