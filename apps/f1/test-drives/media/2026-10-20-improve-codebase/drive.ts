// Deterministic F1 provider boundary. No agent CLI, inference API or external tracker writes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { factoryWebAssets } from "../../../../../packages/edge-worker/src/factory/FactoryWebAssets.ts";
import { OpportunitySchema } from "../../../../../packages/edge-worker/src/factory/Improvement.ts";
import { MockAgentRunner } from "../../../src/MockAgentRunner.ts";

const home = mkdtempSync(join(tmpdir(), "f1-improve-codebase-")),
	repo = join(home, "repo");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
git("init", "-b", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "# F1 architectural survey fixture\n");
git("add", ".");
git(
	"-c",
	"commit.gpgsign=false",
	"-c",
	"core.hooksPath=/dev/null",
	"commit",
	"-m",
	"F1 fixture",
);
git("remote", "add", "origin", repo);
const opportunity = (id: string, title: string) =>
	OpportunitySchema.parse({
		id,
		title,
		problem:
			"Run recovery ownership spans the orchestration and persistence layers",
		evidence: ["README.md at pinned source revision (scripted fixture)"],
		consequence: "Recovery policy cannot be verified through one interface",
		before: "Callers coordinate persistence and execution",
		after: "A recovery module owns the transition contract",
		plan: "Concentrate recovery ownership behind a single interface; preserve native session identity and verify interruption and restart",
		criteria: ["Interrupted work resumes without duplicate execution"],
		strength: "strong",
		effort: "Small",
		perspectives: ["architecture"],
	});
const items = [
	opportunity("recovery", "Concentrate recovery ownership"),
	opportunity("boundaries", "Clarify package boundaries"),
	opportunity("structure", "Simplify repository navigation"),
];
const roles: string[] = [];
const configs: any[] = [];
let filed = 0;
const port = Number(process.env.BOBS_FACTORY_IMPROVE_PORT ?? 3600);
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
			name: "F1 architectural survey",
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
			roles.push(role);
			configs.push(config);
			let response: any = {
				questions: ["Review the independent Factory implementation scope"],
				decisions: [],
				requirements: ["Preserve native recovery identity"],
			};
			if (role === "title") response = { title: "Codebase improvement survey" };
			else if (role === "Prepare shared research context")
				response = { summary: "Architecture fixture", limitations: [] };
			else if (role.endsWith(": coordinator"))
				response = {
					summary: "Bounded perspective",
					assignments: [
						{
							id: "ownership",
							question: "Inspect architectural ownership",
							scope: ["README.md"],
						},
					],
				};
			else if (
				["Cheaper research worker", "Verify perspective evidence"].includes(
					role,
				)
			)
				response = {
					summary: "Scripted architectural evidence",
					findings: [],
					limitations: [],
				};
			else if (role === "Consolidate improvement proposals")
				response = {
					summary:
						"Three worthwhile architectural opportunities. Recovery is the clearest first change.",
					opportunities: items,
					limitations: ["Scripted F1 evidence; no live model investigation"],
				};
			else if (role === "Refine an approved improvement")
				response = {
					packages: [
						{
							id: "recovery",
							itemIds: ["recovery"],
							title: items[0]!.title,
							plan: items[0]!.plan,
							criteria: items[0]!.criteria,
							dependencies: [],
							paths: [],
						},
					],
				};
			else if (role.startsWith("Check "))
				response = { approved: true, feedback: [] };
			return new MockAgentRunner(config, JSON.stringify(response));
		},
	},
});
const wait = async (test: () => boolean) => {
	const start = Date.now();
	while (!test()) {
		if (Date.now() - start > 60000)
			throw new Error("Timed out waiting for workflow");
		await new Promise((r) => setTimeout(r, 50));
	}
};
await worker.start();
const runtime = worker.getFactoryRuntime();
const workflows = runtime.listWorkflows();
workflows
	.find((w: any) => w.id === "improve-codebase")
	.steps.find((s: any) => s.id === "research-worker").model =
	"f1-cheaper-model";
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
	],
	limitations: [],
});
runtime.hooks.improvementIssue = async (_run: any, issue: any) => {
	assert.match(issue.body, /Acceptance criteria/);
	filed++;
	return { id: "42", url: "https://tickets.example/p/architecture/t/42" };
};
const origin = `http://localhost:${port}`;
const request = async (path: string, body?: unknown) => {
	const response = await fetch(origin + path, {
		method: body ? "POST" : "GET",
		headers: body
			? {
					"Content-Type": "application/json",
					Origin: origin,
					"X-Factory-Request": "1",
					"X-Factory-Build": factoryWebAssets().build,
				}
			: {},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const data = await response.json();
	assert.ok(response.ok, JSON.stringify(data));
	return data;
};
let run: any;
try {
	run = await worker.startManualFactoryRun({
		repositoryId: "repo",
		workflow: "improve-codebase",
		runner: "claude",
		inputs: {},
	});
	await wait(
		() =>
			run.status === "failed" ||
			(run.status === "waiting" &&
				run.improvementState?.phase === "discussion"),
	);
	assert.equal(run.status, "waiting", run.error);
	assert.equal(roles.filter((r) => r === "Cheaper research worker").length, 8);
	assert.equal(runtime.runs.size, 1);
	assert.ok(
		configs
			.filter((c) => c.model === "f1-cheaper-model")
			.every(
				(c) =>
					c.tools.length === 0 &&
					c.allowedTools.every((t: string) =>
						t.startsWith("mcp__factory-context__"),
					),
			),
	);
	const decide = async (action: string, extra: object = {}) => {
		const p = run.improvementState.proposals.at(-1);
		return request(`/api/runs/${run.id}/improvements`, {
			action,
			expectedRevision: run.improvementState.revision,
			version: p.version,
			digest: p.digest,
			...extra,
		});
	};
	const read = await request(`/api/runs/${run.id}/improvements`);
	assert.equal(read.proposals.length, 1);
	assert.equal(read.jobs.lead.status, "completed");
	await decide("follow-up", {
		itemId: "recovery",
		comment: "Explain the architectural benefit",
	});
	await wait(
		() =>
			run.status === "waiting" && run.improvementState.proposals.length === 2,
	);
	assert.equal(run.improvementState.choices.recovery, undefined);
	assert.equal(runtime.runs.size, 1);
	const choices = {
		recovery: { action: "fix" },
		boundaries: {
			action: "issue",
			destination: {
				provider: "taskbot",
				server: "fixture",
				instance: "https://tickets.example",
				project: "architecture",
			},
		},
		structure: { action: "ignore", comment: "Good enough" },
	};
	await decide("prepare", { choices });
	await wait(
		() => run.status === "waiting" && run.improvementState.phase === "ready",
	);
	assert.equal(filed, 0);
	assert.equal(runtime.runs.size, 1);
	if (process.env.BOBS_FACTORY_IMPROVE_PREVIEW === "1") {
		console.log(
			JSON.stringify({
				preview: `${origin}/#/runs/${run.id}`,
				home,
				runId: run.id,
				phase: "ready",
			}),
		);
		await new Promise<void>((resolve) => {
			process.once("SIGINT", resolve);
			process.once("SIGTERM", resolve);
		});
	} else {
		await decide("apply", {
			manifestDigest: run.improvementState.manifest.digest,
		});
		await wait(
			() =>
				Object.keys(run.improvementState.children).length === 1 && filed === 1,
		);
		const child = runtime.get(
			Object.values(run.improvementState.children)[0].runId,
		);
		await wait(() => child.status === "waiting" || child.status === "failed");
		assert.equal(child.status, "waiting", child.error);
		assert.equal(child.workflow.id, "factory");
		assert.notEqual(child.workspace, run.workspace);
		assert.equal(child.improvementParent.runId, run.id);
		assert.equal(child.humanDecisions?.length ?? 0, 0);
		assert.equal(child.questions.length, 1);
		const count = runtime.runs.size;
		await runtime.save(run);
		assert.equal(count, 2);
		assert.equal(run.improvementState.issues.boundaries.phase, "confirmed");
		assert.equal(run.status, "waiting");
		console.log(
			JSON.stringify({
				result: "PASS",
				mode: "mock",
				home,
				runId: run.id,
				childId: child.id,
				researchWorkers: roles.filter((r) => r === "Cheaper research worker")
					.length,
				proposalVersions: run.improvementState.proposals.length,
				filed,
				independentChildWorktree: child.workspace,
				humanGateRetained: true,
				sourceSha: git("rev-parse", "HEAD"),
			}),
		);
	}
} finally {
	await worker.stop();
}
