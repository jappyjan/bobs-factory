// Run from the repository root: BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY=$(mktemp -d) F1_AGENT_MODE=mock bun <this file>

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgentRunner } from "../../../../../apps/f1/src/MockAgentRunner.ts";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { defaultWorkflows } from "../../../../../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { WorkflowRuntime } from "../../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { proposal } from "../../../../../packages/edge-worker/test/fixtures/architecture.ts";

const evidence = mkdtempSync(join(tmpdir(), "arch-f1-evidence-"));
const home = mkdtempSync(join(tmpdir(), "bf90-f1-"));
const repo = join(home, "repo");
mkdirSync(repo);
const git = (...a: string[]) =>
	execFileSync("git", a, { cwd: repo, stdio: "pipe" });
git("init", "-b", "main");
git("config", "user.email", "f1@example.test");
git("config", "user.name", "F1");
writeFileSync(join(repo, "README.md"), "F1 fixture");
git("add", ".");
git("commit", "-m", "fixture");
git("remote", "add", "origin", repo);
let classification: "meaningful" | "routine" = "meaningful";
const roles: string[] = [];
let current: any;
let version = 0;
let omitChanges = false;
const versioned = () => {
	const p: any = proposal(classification);
	version++;
	if (classification === "meaningful" && version === 1) {
		Object.assign(p.decisions[0], {
			status: "open",
			pick: undefined,
			decidedBy: undefined,
			why: "Depends on how your team reviews.",
		});
	} else if (version > 1) {
		p.decisions[0].decidedBy = "you";
		if (!omitChanges) p.changes = [{ text: "Used your answer.", from: "you" }];
	}
	return p;
};
const worker: any = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: 3991,
	serverHost: "localhost",
	repositories: [
		{
			id: "f1",
			name: "F1",
			repositoryPath: repo,
			baseBranch: "main",
			githubUrl: "https://github.com/f1-test/test-repo",
			linearWorkspaceId: "cli-workspace",
			workspaceBaseDir: join(home, "worktrees"),
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: {
		createAgentRunner: (_type: any, c: any) => {
			const prompt = c.appendSystemPrompt ?? c.systemPrompt ?? "";
			const role =
				prompt.match(/software-factory step: ([^.]+)\./)?.[1] ?? "title";
			roles.push(role);
			let reply: any = { title: "F1 architecture" };
			if (role === "Clarify requirements")
				reply = {
					questions: [],
					decisions: [],
					requirements: ["Require exact architecture acceptance"],
				};
			else if (role === "Write implementation plan")
				reply = proposal(classification).candidate;
			else if (role === "Discuss architecture") reply = versioned();
			else if (role === "Review implementation plan")
				reply = { approved: true, feedback: [] };
			else if (role === "Implement accepted plan")
				reply = {
					status: "completed",
					summary: "Simulated implementation",
					checks: [],
					questions: [],
				};
			else if (role === "Assess completed and remaining work")
				reply = {
					completed: ["existing branch and PR"],
					remaining: ["approval boundary"],
					risks: [],
					assets: [],
				};
			else if (role.toLowerCase().includes("explain"))
				reply = {
					questions: [
						"Accept the exact version or request changes. Explaining does not accept it.",
					],
				};
			return new MockAgentRunner(c, JSON.stringify(reply));
		},
	},
});
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
process.env.BOBS_FACTORY_FACTORY_PORT = "0";
await worker.start();
let runtime: any = worker.getFactoryRuntime();
const defs = structuredClone(defaultWorkflows);
const pipe = defs.find((w) => w.id === "factory-pipeline")!;
pipe.steps = pipe.steps.slice(
	0,
	pipe.steps.findIndex((s) => s.id === "implement") + 1,
);
runtime.updateWorkflows(defs);
const originalAgent = runtime.hooks.agent;
const implementations: any[] = [];
runtime.hooks.agent = async (c: any) => {
	if (c.step.id === "implement")
		implementations.push({ id: c.run.id, input: c.input });
	return originalAgent(c);
};
const tracker = worker.issueTrackers.get("cli-workspace");
const existingIssue = await tracker.createIssue({
	teamId: "team-default",
	title: "Existing architecture fixture",
	description: "Retain existing work",
});
git("branch", existingIssue.branchName);
const originalTool = runtime.hooks.tool;
runtime.hooks.tool = async (c: any) =>
	c.step.tool === "inspect-existing"
		? {
				source: "https://github.com/f1-test/test-repo/pull/90",
				branch: "existing",
				completed: ["existing work"],
			}
		: originalTool(c);
async function until(f: () => boolean) {
	for (let i = 0; i < 1600; i++) {
		if (f()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`Timed out ${JSON.stringify(current)}`);
}
const receipts: any[] = [];
try {
	for (const workflow of ["factory", "takeover"]) {
		classification = "meaningful";
		version = 0;
		current = await worker.startManualFactoryRun({
			repositoryId: "f1",
			workflow,
			prompt: "Validate architecture discussion",
			source: workflow === "takeover" ? existingIssue.identifier : undefined,
			inputs: {},
		});
		await until(
			() => current.status === "waiting" || current.status === "failed",
		);
		assert.equal(current.status, "waiting");
		assert.equal(implementations.filter((x) => x.id === current.id).length, 0);
		const first = current.architectureProposals.at(-1);
		assert.equal(first.content.decisions[0].status, "open");
		assert.throws(
			() =>
				runtime.decideArchitecture(current.id, {
					proposalId: first.id,
					version: first.version,
					digest: first.digest,
					decision: "accept",
				}),
			/open questions/,
		);
		runtime.answer(
			current.id,
			"Why is merge approval separate?",
			"explanation",
		);
		await until(
			() =>
				current.status === "waiting" &&
				current.architectureProposals
					.at(-1)
					.feedback.some((f: any) => f.kind === "explanation"),
		);
		assert.equal(current.architectureProposals.at(-1).id, first.id);
		const savedId = current.id;
		const hooks = runtime.hooks;
		await runtime.shutdown();
		runtime = new WorkflowRuntime(home, hooks);
		worker.factoryRuntime = runtime;
		current = runtime.get(savedId);
		void runtime.launch(current);
		await until(() => current.status === "waiting");
		assert.equal(current.architectureProposals.at(-1).id, first.id);
		assert.equal(implementations.filter((x) => x.id === savedId).length, 0);
		runtime.answer(current.id, "Keep merge approval separate");
		await until(
			() =>
				current.status === "waiting" &&
				current.architectureProposals.length === 2,
		);
		assert.equal(implementations.filter((x) => x.id === current.id).length, 0);
		let p = current.architectureProposals.at(-1);
		runtime.decideArchitecture(current.id, {
			proposalId: p.id,
			version: p.version,
			digest: p.digest,
			decision: "revise",
			feedback: "Retain the existing interface",
		});
		await until(
			() =>
				current.status === "waiting" &&
				current.architectureProposals.length === 3,
		);
		assert.throws(() =>
			runtime.decideArchitecture(current.id, {
				proposalId: first.id,
				version: first.version,
				digest: first.digest,
				decision: "accept",
			}),
		);
		p = current.architectureProposals.at(-1);
		runtime.decideArchitecture(current.id, {
			proposalId: p.id,
			version: p.version,
			digest: p.digest,
			decision: "accept",
		});
		await until(() => ["completed", "failed"].includes(current.status));
		assert.equal(current.status, "completed");
		const calls = implementations.filter((x) => x.id === current.id);
		assert.equal(calls.length, 1);
		assert.deepEqual(
			Object.keys(calls[0].input)
				.filter((k) => !["ticketReference", "ticketSync"].includes(k))
				.sort(),
			["answers", "plan"],
		);
		assert.match(calls[0].input.plan.plan, /branch existing/);
		assert.deepEqual(
			current.architectureProposals
				.slice(1)
				.map((x: any) => x.content.changes.length > 0),
			[true, true],
		);
		assert.match(calls[0].input.plan.plan, /Chosen by the human/);
		receipts.push({
			workflow,
			status: current.status,
			versions: 3,
			implemented: 1,
			openDecisionBlockedAcceptance: true,
			id: current.id,
		});
		classification = "routine";
		version = 0;
		current = await worker.startManualFactoryRun({
			repositoryId: "f1",
			workflow,
			prompt: "Routine existing pattern",
			source: workflow === "takeover" ? existingIssue.identifier : undefined,
			inputs: {},
		});
		await until(() => ["completed", "failed"].includes(current.status));
		assert.equal(current.status, "completed");
		assert.equal((current.architectureDecisions ?? []).length, 0);
		assert.equal(current.architectureProposals.at(-1).status, "routine");
		receipts.push({
			workflow,
			classification,
			status: current.status,
			id: current.id,
		});
	}
	classification = "meaningful";
	version = 0;
	omitChanges = true;
	current = await worker.startManualFactoryRun({
		repositoryId: "f1",
		workflow: "factory",
		prompt: "Missing change list",
		inputs: {},
	});
	await until(() => current.status === "waiting");
	{
		const q = current.architectureProposals.at(-1);
		runtime.decideArchitecture(current.id, {
			proposalId: q.id,
			version: q.version,
			digest: q.digest,
			decision: "revise",
			feedback: "Use the checkpoint.",
		});
	}
	await until(
		() =>
			["failed", "waiting", "interrupted"].includes(current.status) &&
			current.architectureProposals.length === 1 &&
			current.status !== "running",
	);
	const probe = {
		status: current.status,
		versions: current.architectureProposals.length,
		error: String(current.error ?? ""),
	};
	assert.equal(probe.versions, 1);
	assert.match(JSON.stringify(current), /List what changed since version 1/);
	receipts.push({ probe: "revision without changes", ...probe });
	omitChanges = false;
	writeFileSync(
		join(evidence, "architecture-f1-results.json"),
		JSON.stringify(
			{
				mode: "mock",
				home,
				receipts,
				roles,
				limitations: [
					"Forge inspection is simulated; delivery is deliberately excluded. Native model quality is not exercised.",
				],
			},
			null,
			2,
		),
	);
	console.log(`PASS ${JSON.stringify(receipts)}`);
} finally {
	await worker.stop();
}
