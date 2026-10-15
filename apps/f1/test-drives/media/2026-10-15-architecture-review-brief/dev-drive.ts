// F1_AGENT_MODE=live ARCHITECTURE_SOURCE_REPO=/repo ARCHITECTURE_CONTEXT=/context.json bun <this file>
// Context is { input, outputs: { clarify, plan } }. Live mode uses native Claude for both planning and review.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRunner } from "bobs-factory-claude-runner";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { defaultWorkflows } from "../../../../../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { proposal } from "../../../../../packages/edge-worker/test/fixtures/architecture.ts";
import {
	MockAgentRunner,
	parseF1AgentMode,
} from "../../../src/MockAgentRunner.ts";

const mode = parseF1AgentMode(process.env.F1_AGENT_MODE);
const port = Number(process.env.ARCHITECTURE_FACTORY_PORT ?? 3996);
const home = mkdtempSync(join(tmpdir(), "architecture-brief-dev-"));
const repo = join(home, "repo");
const evidence = process.env.ARCHITECTURE_EVIDENCE ?? join(home, "results");
mkdirSync(evidence, { recursive: true });
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
if (mode === "live") {
	assert.ok(process.env.ARCHITECTURE_SOURCE_REPO);
	assert.ok(process.env.ARCHITECTURE_CONTEXT);
	execFileSync(
		"git",
		[
			"clone",
			"--shared",
			"--branch",
			"main",
			process.env.ARCHITECTURE_SOURCE_REPO,
			repo,
		],
		{ stdio: "pipe" },
	);
	git("remote", "set-url", "origin", repo);
} else {
	mkdirSync(repo);
	git("init", "-b", "main");
	git("config", "user.name", "F1");
	git("config", "user.email", "f1@example.test");
	mkdirSync(join(repo, "src/factory"), { recursive: true });
	writeFileSync(
		join(repo, "src/factory/WorkflowRuntime.ts"),
		"export const fixture = true;\n",
	);
	git("add", ".");
	git("commit", "-m", "F1 fixture");
	git("remote", "add", "origin", repo);
}
const sourceSha = git("rev-parse", "HEAD");
const roles: string[] = [];
const nativeRoles: string[] = [];
let implemented = 0;
let implementationInput: any;
let malformed = false;
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
			name: mode === "live" ? "Attraccess" : "F1",
			repositoryPath: repo,
			baseBranch: "main",
			workspaceBaseDir: join(home, "worktrees"),
			isActive: true,
			linearWorkspaceId: "cli-workspace",
			allowedTools: [
				"Read(**)",
				"Glob",
				"Grep",
				"Bash(rg:*)",
				"Bash(git status:*)",
				"Bash(git ls-files:*)",
				"Bash(find:*)",
				"Bash(ls:*)",
				"Bash(cat:*)",
				"Bash(sed:*)",
				"Bash(wc:*)",
				`Write(/${home}/factory/evidence/**)`,
				`Write(/${realpathSync(home)}/factory/evidence/**)`,
			],
			disallowedTools: ["Edit", "NotebookEdit", "Agent", "Task", "SendMessage"],
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: {
		createAgentRunner: (_type: any, config: any) => {
			const prompt = config.appendSystemPrompt ?? config.systemPrompt ?? "";
			const role =
				prompt.match(/software-factory step: ([^.]+)\./)?.[1] ?? "title";
			roles.push(role);
			if (
				mode === "live" &&
				["Discuss architecture", "Review architecture candidate"].includes(role)
			) {
				nativeRoles.push(role);
				console.log(`NATIVE ${role}`);
				return new ClaudeRunner(config, false);
			}
			let reply: any = { title: "Architecture review brief validation" };
			if (role === "Discuss architecture") {
				reply = proposal();
				if (malformed) delete reply.briefVersion;
			} else if (role === "Review architecture candidate")
				reply = { approved: true, feedback: [] };
			else if (role === "Implement accepted plan") {
				implemented++;
				reply = {
					status: "completed",
					summary: "Mocked implementation handoff",
					checks: [],
					questions: [],
				};
			}
			return new MockAgentRunner(config, JSON.stringify(reply));
		},
	},
});
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
await worker.start();
const runtime = worker.getFactoryRuntime();
const pipeline = defaultWorkflows.find((w) => w.id === "factory-pipeline")!;
const steps = pipeline.steps
	.filter((s) =>
		[
			"architecture",
			"architecture-review",
			"architecture-decision",
			"implement",
		].includes(s.id),
	)
	.map((s) => structuredClone(s));
steps.find((s) => s.id === "implement")!.next = "end";
// Always stop at a real approval gate, including for routine classifications.
steps.find((s) => s.id === "architecture-decision")!.arguments!.approval =
	"always";
const workflow = {
	id: "architecture-brief-validation",
	name: "Architecture brief validation",
	steps,
};
runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
const original = runtime.hooks.agent;
runtime.hooks.agent = async (context: any) => {
	if (context.step.id === "implement")
		implementationInput = structuredClone(context.input);
	return original(context);
};
const context =
	mode === "live"
		? JSON.parse(readFileSync(process.env.ARCHITECTURE_CONTEXT!, "utf8"))
		: { input: "Require exact architecture approval.", outputs: {} };
const prompt = `${context.input}\n\nRetained clarification and draft plan for review:\n${JSON.stringify(context.outputs)}\n\nThis is a local architecture-only validation. Inspect this run's selected local repository. Do not implement, publish, post messages or change any external service. Repository scope supplied by this dev instance supersedes old working-directory paths in retained context. For large JSON results use Write only within the evidence directory shown by /resultSubmission, then submit_result_artifact; do not write shell helper scripts.`;
const until = async (check: () => boolean, timeout = 20 * 60_000) => {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeout)
			throw new Error("Timed out waiting for architecture workflow");
		await new Promise((r) => setTimeout(r, 250));
	}
};
let run: any;
try {
	run = await worker.startManualFactoryRun({
		repositoryId: "repo",
		workflow: workflow.id,
		prompt,
		runner: "claude",
		inputs: {},
	});
	console.log(
		JSON.stringify({
			mode,
			home,
			evidence,
			runId: run.id,
			url: `http://localhost:${port}/#/runs/${run.id}/architecture`,
			sourceSha,
		}),
	);
	await until(() =>
		["waiting", "failed", "blocked", "interrupted"].includes(run.status),
	);
	assert.equal(
		run.status,
		"waiting",
		JSON.stringify({ status: run.status, error: run.error }),
	);
	const p = run.architectureProposals.at(-1);
	assert.equal(p.content.briefVersion, 1);
	assert.ok(
		p.content.problem.length &&
			p.content.criteria.length &&
			p.content.acceptance.length,
	);
	assert.ok(
		p.content.candidate.steps.every(
			(s: any) => s.what && s.kind && s.size && s.traces.length,
		),
	);
	assert.ok(p.footprint.files.length);
	assert.equal(implemented, 0);
	writeFileSync(join(evidence, "proposal.json"), JSON.stringify(p, null, 2));
	writeFileSync(
		join(evidence, "result.json"),
		JSON.stringify(
			{
				mode,
				home,
				runId: run.id,
				sourceSha,
				status: run.status,
				roles,
				nativeRoles,
				noImplementation: implemented === 0,
				criteria: p.content.criteria.length,
				deliverables: p.content.candidate.steps.length,
				paths: p.footprint.files.length,
				warnings: p.footprint.warnings,
			},
			null,
			2,
		),
	);
	console.log(`READY ${join(evidence, "result.json")}`);
	if (mode === "mock") {
		const issue = await worker.issueTrackers.get("cli-workspace").createIssue({
			teamId: "team-default",
			title: "F1 architecture brief",
			description:
				"Require exact-version architecture acceptance before implementation.",
		});
		assert.ok(issue.id);
		runtime.decideArchitecture(run.id, {
			proposalId: p.id,
			version: p.version,
			digest: p.digest,
			decision: "accept",
		});
		await until(() => ["completed", "failed"].includes(run.status), 30_000);
		assert.equal(run.status, "completed");
		assert.equal(implemented, 1);
		assert.deepEqual(implementationInput.plan.steps, p.content.candidate.steps);
		assert.match(implementationInput.plan.plan, /Accepted review brief/);
		malformed = true;
		const invalid = await worker.startManualFactoryRun({
			repositoryId: "repo",
			workflow: workflow.id,
			prompt: "Incomplete brief",
			runner: "claude",
			inputs: {},
		});
		await until(
			() =>
				["failed", "waiting", "blocked", "interrupted"].includes(
					invalid.status,
				),
			60_000,
		);
		assert.equal(invalid.architectureProposals?.length ?? 0, 0);
		assert.equal(implemented, 1);
		assert.match(JSON.stringify(invalid), /requires briefVersion=1/);
		writeFileSync(
			join(evidence, "mock-assertions.json"),
			JSON.stringify(
				{
					issueCreated: issue.id,
					acceptedPlanPreserved: true,
					incompleteBriefBlocked: true,
					implemented,
				},
				null,
				2,
			),
		);
		console.log("PASS mock orchestration and implementation handoff");
	} else {
		// Keep the isolated instance available for browser inspection. Never accept a real proposal here.
		await new Promise<void>((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
	}
} finally {
	await worker.stop();
}
