// F1 driver for show & tell review guides: real CLI-platform EdgeWorker, real Git
// worktrees, deterministic MockAgentRunner roles and scripted GitHub responses.
//   pnpm --filter bobs-factory-edge-worker build && pnpm --filter f1 build
//   F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-story.ts
// Set F1_HOLD=1 to keep the dashboard on :3542 until <root>/stop exists.
import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createCLIIssueTracker } from "bobs-factory-core";
import {
	executeCommand,
	FactoryTools,
} from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { storyPrompt } from "../../../../packages/edge-worker/dist/factory/GuideAuthoring.js";
import { legacyGuidePrompt } from "../../../../packages/edge-worker/dist/factory/legacyGuidePrompt.js";
import {
	EdgeWorker,
	requestFactoryTerminalSession,
} from "../../../../packages/edge-worker/dist/index.js";
import type { Workflow } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type {
	FactoryRun,
	WorkflowRuntime,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import {
	githubApiReceipt,
	githubRequest,
} from "../../../../packages/edge-worker/test/fixtures/github-api.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

const execFile = promisify(execFileCallback);
assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync("/tmp/bobs-review-story-f1-"),
	home = join(root, "home"),
	repo = join(root, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "F1 fixture");
git(repo, "config", "user.email", "f1@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(join(repo, "README.md"), "F1 show & tell fixture\n");
writeFileSync(join(repo, ".gitignore"), ".claude/\n.codex/\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Initial fixture");
git(repo, "remote", "add", "origin", repo);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	root,
	"legacy-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3542";
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;

// story: a new brief-v2 guide; upgrade: an old stock chapter guide regenerated.
const modes = ["story", "upgrade"] as const;
type Mode = (typeof modes)[number];
const counts: Record<string, number> = {};
const descriptions: string[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
const receipts: Record<string, unknown> = { root, counts };

type Internals = {
	getFactoryRuntime(): WorkflowRuntime;
	startRunTitle: () => void;
};
const inside = (worker: EdgeWorker) => worker as unknown as Internals;

const workflow = (mode: Mode): Workflow => ({
	id: `story-${mode}`,
	name: `Show and tell ${mode}`,
	labels: [`workflow:story-${mode}`],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		{
			id: "seed",
			name: "Seed a delivered change",
			type: "tool",
			tool: "fixture-seed",
			next: "guide",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "guide",
			name: "Fixture guide",
			type: "agent",
			runner: "codex",
			model: "fixture-model",
			...(mode === "story"
				? { prompt: storyPrompt, guideContract: "brief-v2" as const }
				: { prompt: legacyGuidePrompt }),
			next: "handoff",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "handoff",
			name: "Verify revision and hand off",
			type: "tool",
			tool: "handoff",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
			next: "human-review",
			maxVisits: 100,
		},
		{
			id: "ci-fix",
			name: "Fixture ci-fix",
			type: "agent",
			runner: "codex",
			prompt: "Correct review gaps",
			next: "guide",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "human-review",
			name: "Explicit human approval",
			type: "tool",
			tool: "human-review",
			next: "end",
			branches: [],
			maxVisits: 100,
		},
	],
});

function story(unacceptedScreenshot: boolean) {
	return {
		title: "I shipped the feature file with its greeting.",
		summary: "The repository now contains feature.txt, and it greets readers.",
		stats: [{ value: "1", label: "file added" }],
		slides: [
			{
				kind: "checklist",
				title: "You asked for one thing",
				items: [
					{
						state: "done",
						label: "Ship the feature file",
						detail: "It is in the change",
					},
					{
						state: "done",
						label: "Greet the reader",
						detail: "It says Hello from F1",
					},
				],
			},
			{
				kind: "beforeAfter",
				title: "Readers now get a greeting",
				before: [{ label: "Nothing" }],
				after: [
					{ label: "Open feature.txt" },
					{ label: "Read the greeting", change: "new" },
				],
			},
			unacceptedScreenshot
				? {
						kind: "screens",
						title: "Here it is",
						shots: [{ area: "Editor", state: "open", label: "Greeting" }],
					}
				: {
						kind: "points",
						title: "How I checked it",
						items: [{ icon: "🔎", title: "Read the delivered file" }],
					},
		],
	};
}

function brief(files: string[], attempt: number) {
	return {
		story: story(attempt === 1),
		verdict: {
			headline: "The feature file ships with its greeting.",
			readiness: "ready",
			why: "The greeting is observed in the delivered file.",
		},
		ask: {
			source: "F1 issue",
			quote: "Ship the feature file with a greeting.",
		},
		interpretation: [
			{
				topic: "Greeting text",
				chosen: "Hello from F1",
				alternatives: ["Hello"],
				decidedBy: "bob",
			},
		],
		requirements: [
			{
				id: "greeting",
				text: "The feature file contains the greeting.",
				origin: "ask",
				status: "shown",
				proof: {
					kind: "table",
					method: "Read the delivered file",
					columns: ["File", "Observed"],
					rows: [{ cells: ["feature.txt", "Hello from F1"], mark: "good" }],
				},
				files,
			},
		],
		yourCall: [
			{
				question: "Is “Hello from F1” the greeting you want?",
				context: "The ticket asked for a greeting without naming one.",
				bobChose: "A short greeting that names the fixture.",
			},
		],
		beyondAsk: [],
		notVerified: [],
		hygiene: [{ text: "No generated files committed" }],
	};
}

function legacyGuide(files: string[]) {
	return {
		scope: { kind: "purely-visual", rationale: "One text file", files },
		tldr: "Feature file ships",
		goal: "Ship the feature file",
		summary: "The feature file ships",
		decision: {
			status: "ready",
			summary: "Ready",
			summaryShort: "Ready for review",
		},
		requirements: [
			{
				criterion: "Ship the file",
				status: "supported",
				evidence: ["Read it"],
			},
		],
		behavior: [],
		checks: ["Fixture check"],
		risks: [],
		reviewInstructions: ["Approve explicitly"],
		chapters: [
			{
				id: "feature",
				title: "Feature file",
				summary: "Adds the file",
				before: "Absent",
				after: "Present",
				tldr: "Adds the file",
				beforeShort: "Absent",
				afterShort: "Present",
				risk: { level: "low", text: "Text only" },
				keyChecks: [{ do: "Open the file", expect: "Greeting shown" }],
				requirementIndexes: [0],
				files,
				screenshots: [],
				diagrams: [],
				reviewChecks: ["Open it"],
				risks: [],
				evidence: ["Fixture"],
			},
		],
	};
}

function makeWorker() {
	const worker = new EdgeWorker({
		platform: "cli",
		issueTrackerFactory: createCLIIssueTracker,
		linearWorkspaces: {
			"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
		},
		factoryHome: home,
		serverHost: "127.0.0.1",
		serverPort: 3602,
		maxConcurrentSessions: 1,
		defaultRunner: "codex",
		repositories: [
			{
				id: "fixture",
				name: "Show and tell fixture",
				repositoryPath: repo,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		handlers: {
			createAgentRunner: (_runner, config) => {
				const contextConfig = config.mcpConfig?.["factory-context"];
				assert(contextConfig && "args" in contextConfig);
				const context = JSON.parse(
					readFileSync(contextConfig.args![1]!, "utf8"),
				);
				const role = config.appendSystemPrompt?.match(
					/software-factory step: Fixture (guide|ci-fix)\./,
				)?.[1];
				assert.equal(role, "guide", "no correction route is expected");
				const mode = String(
					context.originalInput ?? context.feedback?.userInstructions.input,
				).match(/MODE:(\w+)/)?.[1] as Mode;
				assert(modes.includes(mode));
				counts[`${mode}:guide`] = (counts[`${mode}:guide`] ?? 0) + 1;
				// Brief steps receive brief runtime instructions; chapter steps do not.
				const briefStep = Boolean(
					config.appendSystemPrompt?.includes(
						"never author contract, reviewFiles",
					),
				);
				const files = context.progress.reviewScope.files as string[];
				assert.deepEqual(files, ["feature.txt"]);
				let output: unknown;
				if (mode === "story") {
					assert(briefStep);
					output = brief(files, counts["story:guide"]!);
				} else if (!briefStep) {
					// The run starts on the old stock chapter guide.
					assert.equal(counts["upgrade:guide"], 1);
					output = legacyGuide(files);
				} else {
					output = brief(files, 2);
				}
				return new MockAgentRunner(config, JSON.stringify(output));
			},
		},
	});
	inside(worker).startRunTitle = () => {};
	const runtime = inside(worker).getFactoryRuntime();
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (ctx, exe, args) => {
			if (exe === "git") return executeCommand(ctx, exe, args);
			const head = git(ctx.run.workspace, "rev-parse", "HEAD");
			const base = git(ctx.run.workspace, "rev-parse", "HEAD~1");
			const request = githubRequest(args);
			if (request.method === "PATCH")
				descriptions.push(String((request.body as { body?: string }).body));
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid: head,
					baseRefOid: base,
					reviewDecision: "APPROVED",
				}),
			);
		},
	});
	const hooks = runtime as unknown as {
		hooks: {
			tool: (context: Parameters<FactoryTools["tool"]>[0]) => Promise<unknown>;
		};
	};
	hooks.hooks.tool = async (ctx) => {
		if (ctx.step.tool === "fixture-seed") {
			counts[`${ctx.run.workflow.id}:seed`] =
				(counts[`${ctx.run.workflow.id}:seed`] ?? 0) + 1;
			const base = git(ctx.run.workspace, "rev-parse", "HEAD");
			writeFileSync(join(ctx.run.workspace, "feature.txt"), "Hello from F1\n");
			git(ctx.run.workspace, "add", "feature.txt");
			git(ctx.run.workspace, "commit", "-qm", "Add feature file");
			const head = git(ctx.run.workspace, "rev-parse", "HEAD");
			ctx.run.outputs["draft-pr"] = {
				url: "https://github.com/test/repo/pull/1",
				headSha: head,
				baseSha: base,
			};
			ctx.run.outputs.ci = { headSha: head, baseSha: base, reviewReady: true };
			return { seeded: true };
		}
		return tools.tool(ctx);
	};
	if (!runtime.listWorkflows().some((w) => w.id === "story-story"))
		runtime.updateWorkflows(
			[...runtime.listWorkflows(), ...modes.map(workflow)],
			"story-story",
		);
	return worker;
}

const worker = makeWorker();
let token = "";
async function api(path: string, body?: unknown) {
	const response = await fetch(`http://localhost:3542${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			authorization: `Bearer ${token}`,
			origin: "http://localhost:3542",
			"content-type": "application/json",
			"x-factory-request": "1",
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json();
	assert(response.ok, JSON.stringify(value));
	return value;
}
async function until(id: string, predicate: (run: FactoryRun) => boolean) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const run = inside(worker).getFactoryRuntime().runs.get(id);
		if (run?.status === "failed") throw new Error(run.error);
		if (run && predicate(run)) return run;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out ${id}`);
}
const pending = (r: FactoryRun) =>
	r.status === "waiting" && r.reviewGate?.status === "pending";
const cli = async (...args: string[]) =>
	(
		await execFile(join(process.cwd(), "apps/f1/f1"), args, {
			env: { ...process.env, BOBS_FACTORY_PORT: "3602" },
		})
	).stdout;
const guideStep = (run: FactoryRun) =>
	run.workflow.steps.find((s) => s.id === "guide")!;

try {
	await worker.start();
	token = requestFactoryTerminalSession(home);
	await cli("ping");
	for (const [index, mode] of modes.entries()) {
		await cli(
			"create-issue",
			"--title",
			`Show and tell ${mode}`,
			"--description",
			`MODE:${mode}`,
			"--labels",
			`workflow:story-${mode}`,
		);
		await cli("start-session", "--issue-id", `issue-${index + 1}`);
		const id = `session-${index + 1}`;
		let run = await until(id, pending);
		let guide = run.outputs.guide as Record<string, any>;
		if (mode === "story") {
			// An unaccepted screenshot in a story slide returns for brief-only correction.
			assert.equal(counts["story:guide"], 2);
			const rejection = run.events.find((e) =>
				e.message.startsWith("Output validation rejected guide"),
			)?.message;
			assert.match(
				rejection ?? "",
				/Screenshot is not in the accepted capture inventory: Editor \/ open/,
			);
			assert.equal(guide.contract, "brief-v2");
			assert.equal(guide.story.slides.length, 3);
			assert.equal(guide.story.slides[2].kind, "points");
			assert(guide.reviewFiles, "runtime binds the reviewed file snapshot");
			const detail = await api(`/api/runs/${id}`);
			assert.equal(detail.outputs.guide.contract, "brief-v2");
			assert.equal(detail.outputs.guide.story.title, guide.story.title);
			assert.match(descriptions.at(-1)!, /### Does it do that\?/);
			assert.doesNotMatch(descriptions.at(-1)!, /\/Users\//);
		} else {
			assert.equal(guide.contract, undefined);
			assert.equal(guide.chapters.length, 1);
			assert.equal(guideStep(run).guideContract, undefined);
			const gate = run.reviewGate!;
			await api(`/api/runs/${id}/guide/refresh`, { reviewId: gate.id });
			run = await until(id, (r) => pending(r) && r.reviewGate!.id !== gate.id);
			guide = run.outputs.guide as Record<string, any>;
			// Only the guide reran, in the current stock show & tell format.
			assert.equal(counts["upgrade:guide"], 2);
			assert.equal(counts["story-upgrade:seed"], 1);
			assert.equal(guideStep(run).guideContract, "brief-v2");
			assert.equal(guideStep(run).prompt, storyPrompt);
			assert.equal(guideStep(run).model, "fixture-model");
			assert.equal(guide.contract, "brief-v2");
			assert(guide.story.slides.length >= 2);
			assert.equal(run.reviewGate!.headSha, gate.headSha);
			assert.equal(run.humanDecisions?.length ?? 0, 0);
			assert(
				run.events.some((e) =>
					e.message.includes("in the current show & tell format"),
				),
			);
		}
		const activities = await cli("view-session", "--session-id", id);
		assert(activities.length > 100);
		writeFileSync(join(root, `${mode}.json`), JSON.stringify(run, null, 2));
		receipts[mode] = {
			id,
			status: run.status,
			steps: run.history.map((h) => h.step),
			guideContract: guide.contract,
			slides: guide.story.slides.map((s: { kind: string }) => s.kind),
			approvalStillRequired: run.reviewGate?.status === "pending",
		};
	}
	assert.equal(descriptions.length, 3, "one publication per accepted guide");
	assert.equal(unhandled.length, 0);
	console.log("F1_REVIEW_STORY_PASS", JSON.stringify(receipts));
	if (process.env.F1_HOLD === "1") {
		writeFileSync(join(root, "ready"), "");
		console.log("F1_HOLD", root);
		while (!existsSync(join(root, "stop")))
			await new Promise((resolve) => setTimeout(resolve, 500));
	}
} finally {
	await worker.stop();
	process.off("unhandledRejection", onUnhandled);
	writeFileSync(join(root, "receipts.json"), JSON.stringify(receipts, null, 2));
	console.log("EVIDENCE_ROOT", root);
}
