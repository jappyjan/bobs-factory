// Real admission/version/profile paths; every model/title turn is mocked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { f1AgentHandlers } from "../../../src/MockAgentRunner.ts";

const home = mkdtempSync(join(tmpdir(), "f1-agent-minimum-"));
const repo = join(home, "repo");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
git("init", "-b", "main");
git("config", "user.name", "F1");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "# Minimum-version admission fixture\n");
git("add", ".");
git(
	"-c",
	"commit.gpgsign=false",
	"-c",
	"core.hooksPath=/dev/null",
	"commit",
	"-m",
	"Fixture",
);
const port = Number(process.env.BOBS_FACTORY_F1_MINIMUM_PORT ?? 3630);
const previousPath = process.env.PATH;
const previousPort = process.env.BOBS_FACTORY_FACTORY_PORT;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
process.env.BOBS_FACTORY_F1_MINIMUM_KEY = "synthetic-no-inference-key";
const worker: any = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: port + 1,
	serverHost: "localhost",
	defaultRunner: "codex",
	strictMcpConfig: true,
	issueTrackerFactory: createCLIIssueTracker,
	repositories: [
		{
			id: "fixture",
			name: "Minimum CLI fixture",
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
	handlers: f1AgentHandlers("mock", '{"title":"Minimum CLI fixture"}'),
});
// Controlled local Git preparation: no remote account/server is part of this drive.
const scopedGit = worker.gitService.withEnvironment.bind(worker.gitService);
worker.gitService.withEnvironment = (environment: Record<string, string>) => {
	const service = scopedGit(environment);
	service.createGitWorktree = async (issue: {
		identifier: string;
		branchName: string;
	}) => {
		const path = join(home, "worktrees", issue.identifier);
		mkdirSync(join(home, "worktrees"), { recursive: true });
		git("worktree", "add", "-b", issue.branchName, path, "main");
		return { path, isGitWorktree: true, branchName: issue.branchName };
	};
	return service;
};
try {
	await worker.start();
	await worker.issueTrackers.get("cli-workspace").createIssue({
		teamId: "team-default",
		title: "Minimum CLI fixture",
		description: "Controlled F1 admission",
	});
	const runtime = worker.getFactoryRuntime();
	runtime.executionProfiles.save(
		{
			schemaVersion: 1,
			revision: 0,
			identities: [
				{
					id: "fixture",
					revision: 1,
					name: "Synthetic API fixture",
					author: {
						mode: "factory-only",
						value: { name: "F1", email: "f1@example.test" },
					},
					committer: {
						mode: "factory-only",
						value: { name: "F1", email: "f1@example.test" },
					},
					signing: { format: "disabled" },
					repositories: [],
					runners: {
						codex: {
							mode: "factory-only",
							provider: "openai",
							credential: {
								source: "env",
								name: "BOBS_FACTORY_F1_MINIMUM_KEY",
								version: "v1",
								owner: "F1",
							},
						},
					},
				},
			],
			tools: [
				{
					id: "fixture",
					revision: 1,
					name: "Private fixture",
					mode: "factory-only",
					mcp: {},
				},
			],
			defaults: { identityProfile: "fixture", toolProfile: "fixture" },
			repositories: {},
		},
		0,
	);
	runtime.updateTitleSettings({ runner: "codex", model: "gpt-6-luna" });
	const version = await (
		await fetch(`http://localhost:${port}/api/version`)
	).json();
	const headers = {
		Origin: `http://localhost:${port}`,
		"X-Factory-Request": "1",
		"X-Factory-Build": version.build,
		"Content-Type": "application/json",
	};
	const launch = () =>
		fetch(`http://localhost:${port}/api/runs`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				repositoryId: "fixture",
				workflow: "simple",
				runner: "codex",
				model: "gpt-6.1-sol",
				prompt: "Reply with the fixture response",
			}),
		});
	const accepted = await launch();
	const receipt = await accepted.json();
	assert.equal(accepted.status, 202, JSON.stringify(receipt));
	const run = runtime.get(receipt.id);
	const deadline = Date.now() + 20000;
	while (!["completed", "failed"].includes(run.status) && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(run.status, "completed", run.error);
	assert.match(run.executionDiagnostics.version, /0\.163\.0/);
	assert.equal(run.executionSnapshot.identity.id, "fixture");
	const before = runtime.runs.size;
	const bin = join(home, "old-cli");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "codex"),
		"#!/bin/sh\nprintf 'codex-cli 0.158.99\\n'\n",
	);
	chmodSync(join(bin, "codex"), 0o700);
	process.env.PATH = `${bin}:${previousPath}`;
	const denied = await launch();
	assert.equal(denied.status, 409);
	const error = await denied.json();
	assert.match(error.error, /requires 0\.159\.2 or newer/);
	assert.equal(runtime.runs.size, before);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			home,
			nativeVersion: run.executionDiagnostics.version,
			completedRun: run.id,
			olderCliRejectedBeforeCreation: true,
			inferenceCalls: 0,
		}),
	);
} finally {
	process.env.PATH = previousPath;
	process.env.BOBS_FACTORY_FACTORY_PORT = previousPort;
	delete process.env.BOBS_FACTORY_F1_MINIMUM_KEY;
	await worker.stop();
}
