// Mocked UI preview for the improve-codebase dashboard. No agent CLI, inference
// API or external tracker writes. Keeps the server alive until SIGINT/SIGTERM.
//
//   BOBS_FACTORY_IMPROVE_PORT=3700 \
//   BOBS_FACTORY_IMPROVE_WORKER_DELAY_MS=0 \
//   bun apps/f1/test-drives/media/2026-10-20-improve-codebase/design-preview.ts
//
// The fixture carries five varied opportunities (one prerequisite, one
// alternative), a first plan check that requests corrections and delivery
// destinations, so every phase of the review can be inspected in a browser.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { OpportunitySchema } from "../../../../../packages/edge-worker/src/factory/Improvement.ts";
import { MockAgentRunner } from "../../../src/MockAgentRunner.ts";

const home = mkdtempSync(join(tmpdir(), "f1-improve-design-")),
	repo = join(home, "repo");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-b", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "# F1 improvement design fixture\n");
git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "-m", "F1 fixture");
git("remote", "add", "origin", repo);

const items = [
	{
		id: "recovery-owner",
		title: "Give run recovery a single owner",
		problem:
			"Recovery decisions for interrupted runs are made in three places: `WorkflowRuntime` resumes steps, `EdgeWorker` restarts sessions and `Delivery` replays receipts. Each applies its own idea of what is safe to repeat.",
		evidence: [
			"`packages/edge-worker/src/factory/WorkflowRuntime.ts` resumes the current step after restart",
			"`packages/edge-worker/src/EdgeWorker.ts` restarts native sessions independently",
			"Six of the last ten recovery fixes touched two or more of these files",
		],
		consequence:
			"A restart can repeat work that another layer already considered finished. Every recovery fix needs coordinated edits that are easy to get partially wrong.",
		before:
			"Runtime, worker and delivery each decide → partial, overlapping recovery rules",
		after:
			"One `RunRecovery` module decides → callers ask it what to resume, replay or reconcile",
		plan: "1. Introduce `RunRecovery` with one `plan(run)` entry point.\n2. Move the resume, session-restart and receipt-replay checks behind it.\n3. Keep native session identity unchanged.\n4. Cover interruption at each boundary with restart tests.",
		criteria: [
			"Interrupted work resumes without duplicate execution",
			"Recovery rules are covered through a single interface",
			"Native session identity is preserved across restart",
		],
		nonGoals: ["Changing the snapshot format"],
		risks: ["Short-term churn in three hot files"],
		paths: [
			"packages/edge-worker/src/factory/WorkflowRuntime.ts",
			"packages/edge-worker/src/EdgeWorker.ts",
			"packages/edge-worker/src/factory/Delivery.ts",
		],
		strength: "strong",
		effort:
			"Medium: one new module, three call sites and focused restart tests.",
		perspectives: ["reliability", "architecture", "changes"],
	},
	{
		id: "runtime-split",
		title: "Split the workflow runtime into lifecycle and execution",
		problem:
			"`WorkflowRuntime.ts` owns scheduling, persistence, approvals and step execution in one 6,000-line module.",
		evidence: [
			"`WorkflowRuntime.ts` is the most frequently changed file in the last 30 days",
			"Most of its tests construct the whole runtime to check one transition",
		],
		consequence:
			"Changes to approvals regularly break execution tests, and new contributors cannot find where a transition lives.",
		before: "One runtime module → every change touches shared state",
		after:
			"Lifecycle module owns transitions → execution module runs steps through a narrow interface",
		plan: "Extract lifecycle transitions after recovery has one owner, then move step execution behind an interface the lifecycle module calls.",
		criteria: [
			"Approval changes do not require execution test edits",
			"Lifecycle transitions are testable without starting agents",
		],
		risks: ["Large diff; best done after recovery ownership settles"],
		paths: ["packages/edge-worker/src/factory/WorkflowRuntime.ts"],
		strength: "worth-exploring",
		effort: "Large: a staged extraction across the runtime and its tests.",
		dependencies: ["recovery-owner"],
		perspectives: ["structure", "architecture"],
	},
	{
		id: "delivery-outbox",
		title: "Send every external write through the delivery outbox",
		problem:
			"Linear uses a durable outbox, but GitHub comments and Taskbot updates are written directly from step handlers.",
		evidence: [
			"`packages/linear-event-transport/src/LinearDeliveryOutbox.ts` retries and deduplicates",
			"GitHub and Taskbot writes in `Delivery.ts` have no receipt",
		],
		consequence:
			"A crash between write and save can post a duplicate PR comment or lose a ticket update.",
		before: "Linear → outbox · GitHub and Taskbot → direct writes",
		after: "All trackers → one outbox with receipts and retries",
		plan: "Generalise the Linear outbox to a provider-neutral interface and move GitHub and Taskbot writes onto it.",
		criteria: [
			"Every external write has a receipt",
			"Retries never post duplicates",
		],
		paths: [
			"packages/linear-event-transport/src/LinearDeliveryOutbox.ts",
			"packages/edge-worker/src/factory/Delivery.ts",
		],
		strength: "strong",
		effort: "Medium: one shared interface and two provider adapters.",
		conflicts: ["receipts-in-snapshot"],
		perspectives: ["reliability", "patterns"],
	},
	{
		id: "runtime-harness",
		title: "Add a runtime test harness instead of full snapshots",
		problem:
			"Runtime tests assert entire persisted snapshots, so harmless field additions fail dozens of tests.",
		evidence: [
			"412 inline snapshots in `packages/edge-worker/test/WorkflowRuntime.test.ts`",
		],
		consequence:
			"Reviewers approve snapshot updates without reading them, which hides real regressions.",
		before: "Full snapshot assertions → noisy, rubber-stamped updates",
		after:
			"Scenario harness with focused expectations → failures point at behaviour",
		plan: "Add a small scenario harness and migrate the noisiest tests first.",
		criteria: [
			"New runtime tests use the harness",
			"Snapshot count drops by half",
		],
		strength: "worth-exploring",
		effort: "Small: a helper module and incremental migration.",
		perspectives: ["verification"],
	},
	{
		id: "receipts-in-snapshot",
		title: "Keep delivery receipts inside run snapshots",
		problem:
			"An alternative to a shared outbox: store each provider receipt in the run snapshot that triggered it.",
		evidence: ["Run snapshots already persist step outputs atomically"],
		consequence:
			"Avoids a new shared component, but couples delivery retries to run persistence.",
		before: "Receipts only for Linear",
		after: "Receipts stored per run for every provider",
		plan: "Extend the snapshot schema with a receipts map and replay unsent entries on resume.",
		criteria: ["Every external write has a receipt"],
		strength: "speculative",
		effort: "Small: schema change plus replay on resume.",
		conflicts: ["delivery-outbox"],
		perspectives: ["patterns"],
	},
].map((item) => OpportunitySchema.parse(item));

const delay = Number(process.env.BOBS_FACTORY_IMPROVE_WORKER_DELAY_MS ?? 0);
let checks = 0;
class PreviewRunner extends MockAgentRunner {
	constructor(
		private readonly config: any,
		private readonly role: string,
		private readonly reply: (prompt: string) => unknown,
	) {
		super(config, "");
	}
	override async start(prompt: string) {
		let config = "";
		try {
			config = JSON.stringify(this.config);
		} catch {}
		(this as any).response = JSON.stringify(this.reply(`${prompt}\n${config}`));
		if (this.role === "Cheaper research worker" && delay)
			await new Promise((r) => setTimeout(r, delay * (0.4 + Math.random())));
		return super.start(prompt);
	}
}
const respond = (role: string) => (prompt: string) => {
	if (role === "title") return { title: "Improve the codebase" };
	if (role === "Prepare shared research context")
		return { summary: "Design fixture", limitations: [] };
	if (role.endsWith(": coordinator"))
		return {
			summary: "Bounded perspective",
			assignments: [
				{
					id: "ownership",
					question: "Inspect ownership",
					scope: ["README.md"],
				},
				{
					id: "boundaries",
					question: "Inspect boundaries",
					scope: ["README.md"],
				},
			],
		};
	if (["Cheaper research worker", "Verify perspective evidence"].includes(role))
		return { summary: "Scripted evidence", findings: [], limitations: [] };
	if (role === "Consolidate improvement proposals")
		return {
			summary:
				"Bob found **five opportunities**. Recovery ownership is the clearest first change: it removes the main source of duplicate work after restarts and unblocks splitting the runtime. The delivery outbox and receipts-in-snapshot are alternatives — pick one.",
			opportunities: items,
			limitations: [
				"Scripted design fixture; no live model investigation",
				"Operational history covered the last 30 days only",
			],
		};
	if (role === "Refine an approved improvement") {
		// The job key (package-<version>-<item>) appears in the runner config.
		const item =
			items.find((i) =>
				new RegExp(`package-[0-9a-f]+-${i.id}\\b`).test(prompt),
			) ??
			items.find(
				(i) =>
					prompt.match(
						/\\?"item\\?"\s*:\s*\{\s*\\?"id\\?"\s*:\s*\\?"([a-z-]+)/,
					)?.[1] === i.id,
			) ??
			items[0]!;
		return {
			packages: [
				{
					id: item.id,
					itemIds: [item.id],
					title: item.title,
					plan: item.plan,
					criteria: item.criteria,
					dependencies: item.dependencies,
					paths: item.paths,
				},
			],
		};
	}
	if (role.startsWith("Check ")) {
		checks++;
		return checks === 2
			? {
					approved: false,
					feedback: [
						"Recovery must not replay a delivery whose receipt is uncertain. Mark those runs for operator reconciliation instead of retrying automatically.",
					],
				}
			: { approved: true, feedback: [] };
	}
	return {
		questions: ["Review the independent Factory implementation scope"],
		decisions: [],
		requirements: ["Preserve native recovery identity"],
	};
};

const port = Number(process.env.BOBS_FACTORY_IMPROVE_PORT ?? 3700);
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
const worker: any = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: port + 1,
	serverHost: "localhost",
	strictMcpConfig: true,
	issueTrackerFactory: createCLIIssueTracker,
	repositories: [
		{
			id: "repo",
			name: "Bob’s Factory",
			repositoryPath: repo,
			baseBranch: "main",
			workspaceBaseDir: join(home, "worktrees"),
			isActive: true,
			linearWorkspaceId: "cli-workspace",
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: {
		createAgentRunner: (_type: any, config: any) => {
			const role =
				(config.appendSystemPrompt ?? config.systemPrompt ?? "").match(
					/software-factory step: ([^.]+)\./,
				)?.[1] ?? "title";
			return new PreviewRunner(config, role, respond(role));
		},
	},
});
await worker.start();
const runtime = worker.getFactoryRuntime();
const workflows = runtime.listWorkflows();
workflows
	.find((w: any) => w.id === "improve-codebase")
	.steps.find((s: any) => s.id === "research-worker").model = "gpt-6-luna";
runtime.updateWorkflows(workflows);
runtime.hooks.improvementDestinations = async () => ({
	options: [
		{
			name: "Taskbot · architecture backlog",
			destination: {
				provider: "taskbot",
				server: "fixture",
				instance: "https://tickets.example",
				project: "architecture",
			},
		},
		{
			name: "Linear · Platform team",
			destination: {
				provider: "linear",
				workspaceId: "fixture",
				teamId: "platform",
			},
		},
	],
	limitations: [],
});
let filed = 0;
runtime.hooks.improvementIssue = async () => {
	filed++;
	return {
		id: String(40 + filed),
		url: `https://tickets.example/p/architecture/t/${40 + filed}`,
	};
};
const run = await worker.startManualFactoryRun({
	repositoryId: "repo",
	workflow: "improve-codebase",
	runner: "claude",
	inputs: {},
});
console.log(
	JSON.stringify({
		preview: `http://localhost:${port}/#/runs/${run.id}`,
		home,
	}),
);
await new Promise<void>((resolve) => {
	process.once("SIGINT", resolve);
	process.once("SIGTERM", resolve);
});
await worker.stop();
