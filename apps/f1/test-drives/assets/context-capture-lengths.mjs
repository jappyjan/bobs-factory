// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/context-capture-lengths.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const require = createRequire(
	new URL("../../../../packages/mcp-tools/package.json", import.meta.url),
);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
	StdioClientTransport,
} = require("@modelcontextprotocol/sdk/client/stdio.js");
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-context-lengths-")),
);
const home = join(directory, "home"),
	repo = join(directory, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (...args) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "f1@example.invalid");
git("config", "commit.gpgsign", "false");
writeFileSync(join(repo, "source.txt"), "Unchanged fixture source\n");
writeFileSync(join(repo, ".gitignore"), ".claude/\n.codex/\n.agents/\n");
git("add", ".");
git("commit", "-qm", "Fixture base");
async function freePort() {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}
const rpcOrigin = `http://127.0.0.1:${await freePort()}`;
const factoryPort = await freePort(),
	factoryOrigin = `http://127.0.0.1:${factoryPort}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"absent-capacity",
);
const fixture = {
	findings: Array.from({ length: 256 }, (_, index) => ({
		id: `finding-${index}`,
		status: "resolved",
		summary: `Evidence ${index}`,
		requirementIds: [`R${index}`, `R${index + 1}`],
		evidence: `Retained receipt ${index}`,
	})),
};
const rows = Array.from({ length: 32 }, (_, index) => ({
	step: `review/${index}`,
	output: structuredClone(fixture),
}));
const workflow = {
	id: "context-lengths",
	name: "Cold context lengths",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		{
			id: "entry",
			name: "Retain fixture checkpoint",
			type: "agent",
			runner: "claude",
			prompt: "[F1_CONTEXT_ENTRY] Retain the checkpoint",
			askQuestions: true,
		},
		{
			id: "inspect",
			name: "Inspect exact cold evidence",
			type: "agent",
			runner: "claude",
			prompt: "[F1_CONTEXT_INSPECT] Inspect declared evidence",
			inputs: ["seed", "savedHistory"],
			askQuestions: true,
		},
	],
};
let worker,
	runtime,
	fixtureId,
	continued = false,
	checked = false;
const tracker = createCLIIssueTracker();
const turns = [];
async function read(client, path) {
	let offset = 0,
		text = "",
		encoding;
	do {
		const result = await client.callTool({
			name: "read_context",
			arguments: { path, view: "full", offset, limit: 16000 },
		});
		assert.notEqual(result.isError, true);
		const page = result.structuredContent;
		text += page.text;
		encoding = page.encoding;
		offset = page.nextOffset;
	} while (offset !== null);
	return encoding === "json" ? JSON.parse(text) : text;
}
function scriptedRunner(_type, config) {
	let delegate = new MockAgentRunner(
		config,
		JSON.stringify({ title: "Cold context fixture" }),
	);
	return {
		supportsStreamingInput: false,
		stop: () => delegate.stop(),
		isRunning: () => delegate.isRunning(),
		getMessages: () => delegate.getMessages(),
		getFormatter: () => delegate.getFormatter(),
		async start(prompt) {
			const instructions = `${config.systemPrompt ?? ""}\n${config.appendSystemPrompt ?? ""}`;
			let output;
			if (instructions.includes("[F1_CONTEXT_ENTRY]")) {
				turns.push("entry");
				output = {
					summary: "Retained fixture checkpoint",
					questions: continued ? [] : ["Continue isolated fixture?"],
				};
			} else if (instructions.includes("[F1_CONTEXT_INSPECT]")) {
				turns.push("inspect");
				const scoped = config.mcpConfig["factory-context"];
				const client = new Client({ name: "f1-cold-context", version: "1" });
				try {
					await client.connect(
						new StdioClientTransport({
							command: scoped.command,
							args: scoped.args,
							cwd: config.workingDirectory,
						}),
					);
					for (const index of [0, 16, 31]) {
						assert.deepEqual(
							await read(client, `/seed/rows/${index}`),
							rows[index],
						);
						assert.deepEqual(
							await read(client, `/savedHistory/${index}/output`),
							fixture,
						);
					}
					const denied = await client.callTool({
						name: "read_context",
						arguments: { path: "/private", view: "full" },
					});
					assert.equal(
						denied.isError,
						true,
						"Undeclared output must stay unavailable",
					);
					checked = true;
				} finally {
					await client.close();
				}
				output = {
					summary: "Exact cold evidence inspected",
					questions: ["Human fixture decision remains required"],
				};
			} else return delegate.start(prompt);
			delegate = new MockAgentRunner(config, JSON.stringify(output));
			return delegate.start(prompt);
		},
	};
}
const config = {
	platform: "cli",
	factoryHome: home,
	serverHost: "127.0.0.1",
	serverPort: Number(new URL(rpcOrigin).port),
	defaultRunner: "claude",
	issueTrackerFactory: () => tracker,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "fixture-no-provider-token" },
	},
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: { createAgentRunner: scriptedRunner },
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
}
async function rpc(method, params = {}) {
	const response = await fetch(`${rpcOrigin}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const result = await response.json();
	assert(!result.error, JSON.stringify(result));
	return result.result;
}
async function until(check) {
	const deadline = Date.now() + 120000;
	while (Date.now() < deadline) {
		const run = fixtureId && runtime.runs.get(fixtureId);
		assert.notEqual(run?.status, "failed", run?.error);
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Controlled context drive timed out");
}
try {
	construct();
	runtime.updateWorkflows([...defaultWorkflows, workflow], workflow.id);
	await worker.start();
	assert(await rpc("ping"));
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: "Inspect cold retained context",
		description: "Retain exact declared evidence and pending human decisions",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	const id = session.sessionId;
	fixtureId = id;
	await until(() => runtime.runs.get(id)?.status === "waiting");
	const run = runtime.get(id),
		at = run.updatedAt;
	// This is an isolated checkpoint fixture, never a production run mutation.
	run.outputs.seed = { rows };
	run.outputs.savedHistory = rows;
	run.outputs.private = "Undeclared fixture value";
	run.history = rows.map((row) => ({ ...row, at }));
	await runtime.save(run);
	await runtime.flush();
	await worker.stop();
	construct();
	await worker.start();
	await until(() => runtime.runs.get(id)?.status === "waiting");
	assert.equal(runtime.get(id).status, "waiting");
	assert.deepEqual(runtime.get(id).questions, ["Continue isolated fixture?"]);
	continued = true;
	const response = await fetch(`${factoryOrigin}/api/runs/${id}/answer`, {
		method: "POST",
		headers: {
			Origin: factoryOrigin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			answer: "Continue isolated fixture",
			context: { step: "entry", questions: ["Continue isolated fixture?"] },
		}),
	});
	assert.equal(response.status, 200, await response.text());
	await until(
		() =>
			runtime.get(id)?.status === "waiting" &&
			runtime.get(id)?.step === "inspect",
	);
	assert(checked);
	assert.deepEqual(runtime.get(id).questions, [
		"Human fixture decision remains required",
	]);
	assert.equal(runtime.get(id).history[0].output.findings.length, 256);
	assert.equal(runtime.get(id).reviewGate?.status, undefined);
	await until(async () => {
		const activities = await rpc("viewSession", { sessionId: id, limit: 100 });
		return JSON.stringify(activities).includes(
			"Human fixture decision remains required",
		);
	});
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mocked/no-inference",
			rows: rows.length,
			claimsPerRow: fixture.findings.length,
			turns,
			coldRestartRetained: true,
			selectedCompleteEvidenceExact: true,
			undeclaredOutputDenied: true,
			humanDecisionStillRequired: true,
			activitiesVisible: true,
		}),
	);
} finally {
	await worker?.stop();
	rmSync(directory, { recursive: true, force: true });
}
