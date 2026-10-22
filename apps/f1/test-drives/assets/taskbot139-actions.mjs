// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot139-actions.mjs
// Actual EdgeWorker/CLI RPC, disposable Git, deterministic mock SDK responses.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"This driver never invokes live providers",
);
assert.match(process.version, /^v24\./);
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const root = process.cwd();
const driver = "apps/f1/test-drives/assets/taskbot139-actions.mjs";
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-taskbot139-actions-")),
);
const home = join(directory, "home"),
	repository = join(directory, "repo"),
	origin = join(directory, "origin.git");
mkdirSync(home);
mkdirSync(repository);
const startedAt = new Date().toISOString();
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const revision = git(root, "rev-parse", "HEAD");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function sourceDelta() {
	const hash = createHash("sha256").update(
		execFileSync("git", ["diff", "HEAD"], { cwd: root }),
	);
	for (const file of git(root, "ls-files", "--others", "--exclude-standard")
		.split("\n")
		.filter(Boolean)
		.sort())
		hash
			.update(file)
			.update("\0")
			.update(readFileSync(join(root, file)))
			.update("\0");
	return hash.digest("hex");
}
function buildIdentity() {
	const hash = createHash("sha256");
	for (const name of ["core", "mcp-tools", "edge-worker"]) {
		const dist = join(root, "packages", name, "dist");
		for (const file of readdirSync(dist, { recursive: true })
			.filter((file) => file.endsWith(".js"))
			.sort())
			hash
				.update(`${name}/${file}`)
				.update("\0")
				.update(readFileSync(join(dist, file)))
				.update("\0");
	}
	hash
		.update("apps/f1/dist/src/MockAgentRunner.js\0")
		.update(readFileSync(join(root, "apps/f1/dist/src/MockAgentRunner.js")))
		.update("\0");
	return hash.digest("hex");
}
const identity = {
	revision,
	deltaSha256: sourceDelta(),
	driverSha256: sha256(readFileSync(join(root, driver))),
	buildSha256: buildIdentity(),
	node: process.version,
};
console.log(
	JSON.stringify({
		phase: "setup",
		directory,
		startedAt,
		paidCalls: 0,
		...identity,
	}),
);
git(directory, "init", "--bare", "-q", origin);
git(repository, "init", "-q", "-b", "main");
git(repository, "config", "user.name", "F1 fixture");
git(repository, "config", "user.email", "f1@example.invalid");
git(repository, "config", "commit.gpgsign", "false");
writeFileSync(join(repository, "README.md"), "# Action controlled fixture\n");
writeFileSync(
	join(repository, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\nAGENTS.md\nCLAUDE.md\n",
);
git(repository, "add", ".");
git(repository, "commit", "-qm", "Fixture baseline");
git(repository, "remote", "add", "origin", origin);
git(repository, "push", "-qu", "origin", "main");
async function freePort() {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}
const rpcPort = await freePort(),
	factoryPort = await freePort();
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);

const requireMcp = createRequire(join(root, "packages/mcp-tools/package.json"));
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = requireMcp(
	"@modelcontextprotocol/sdk/client/stdio.js",
);
const items = [
	{
		id: "base",
		title: "Foundation",
		body: "Retain exact proof",
		labels: ["fixture"],
		prompt: "Implement foundation",
		dependencies: [],
	},
	{
		id: "dependent",
		title: "Dependent",
		body: "Wait for approved merge",
		labels: [],
		prompt: "Implement dependent",
		dependencies: ["base"],
	},
];
const childWorkflow = {
	id: "f1-actions-child",
	name: "Controlled ordinary child",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	steps: [
		{
			id: "work",
			name: "Work",
			type: "agent",
			prompt: "Return controlled work result",
			reads: {},
			output: { format: "json-v1" },
			next: "publish",
		},
		{
			id: "publish",
			name: "Provider draft",
			type: "tool",
			tool: "draft-pr",
			next: "review",
		},
		{
			id: "review",
			name: "Explicit human gate",
			type: "tool",
			tool: "human-review",
			next: "merge",
		},
		{
			id: "merge",
			name: "Provider confirmed merge",
			type: "tool",
			tool: "merge",
			next: "end",
		},
	],
};
const mappedReader = {
	id: "f1-actions-pinned-reader",
	name: "Reusable pinned reader",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	steps: [
		{
			id: "research",
			name: "Read mapped pinned blobs",
			type: "agent",
			prompt: "Return the controlled mapped list",
			reads: { baseline: "@callInputs/baseline" },
			access: "read-only",
			revision: "bound",
			output: { format: "json-v1" },
			next: "end",
		},
	],
};
const itemPath = (id) =>
	id === "f1-actions-uncertain"
		? "/research/outputs/research/items"
		: "/research/items";
const definition = (id, wait) => ({
	id,
	name: id,
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		{
			id: "baseline",
			name: "Snapshot",
			type: "snapshot",
			snapshot: { history: { lookbackDays: 30, maxRuns: 20 } },
			next: "research",
		},
		id === "f1-actions-uncertain"
			? {
					id: "research",
					name: "Call reusable pinned reader",
					type: "workflow",
					workflow: mappedReader.id,
					inputMapping: { baseline: "/baseline" },
					next: "file",
				}
			: {
					id: "research",
					name: "Read pinned blobs",
					type: "agent",
					prompt: "Return the controlled mapped list",
					reads: { baseline: "baseline" },
					access: "read-only",
					revision: "bound",
					output: { format: "json-v1" },
					next: "file",
				},
		{
			id: "file",
			name: "File backlog issues",
			type: "file-issues",
			fileIssues: {
				items: { from: itemPath(id) },
				fields: { title: "/title", body: "/body", labels: "/labels" },
				destination: {
					provider: "linear",
					workspaceId: "cli-workspace",
					teamId: "team-default",
				},
			},
			next: "dispatch",
		},
		{
			id: "dispatch",
			name: "Launch dependency waves",
			type: "launch-runs",
			launchRuns: {
				items: { from: itemPath(id) },
				workflow: childWorkflow.id,
				inputMapping: { prompt: "/prompt" },
				dependencies: "/dependencies",
				wait,
			},
			next: "tail",
		},
		{
			id: "tail",
			name: "After launch",
			type: "check",
			reads: { children: "dispatch" },
			check: {
				results: { links: { select: "/inputs/children/children" } },
				passed: { path: "/inputs/children/wait", equals: wait },
			},
			next: "end",
		},
	],
});
const definitions = [
	childWorkflow,
	definition("f1-actions-wait", true),
	definition("f1-actions-detached", false),
	definition("f1-actions-uncertain", false),
	mappedReader,
];
const tracker = createCLIIssueTracker();
const providerIssues = new Map(),
	sends = [],
	turns = [],
	sessions = [],
	results = [];
let runtime,
	worker,
	loseNext = false;
const linearClient = {
	teams: async () => ({
		nodes: [{ id: "team-default", name: "Fixture" }],
		pageInfo: { hasNextPage: false },
	}),
	team: async () => ({
		states: async () => ({ nodes: [{ id: "backlog", type: "backlog" }] }),
	}),
	issueLabels: async () => ({
		nodes: [{ id: "fixture-label", name: "fixture" }],
		pageInfo: { hasNextPage: false },
	}),
	issues: async ({ filter }) => ({
		nodes: providerIssues.has(filter.id.eq)
			? [providerIssues.get(filter.id.eq)]
			: [],
	}),
	createIssue: async (input) => {
		assert.equal(input.stateId, "backlog");
		assert.equal(input.assigneeId, null);
		assert.equal(input.delegateId, null);
		assert.equal(input.useDefaultTemplate, false);
		assert(!providerIssues.has(input.id), "No duplicate provider creation");
		sends.push({ ...input });
		const issue = {
			id: input.id,
			url: `https://linear.app/fixture/issue/${input.id}`,
			description: input.description,
			team: Promise.resolve({ id: input.teamId }),
			state: Promise.resolve({ type: "backlog" }),
			assignee: Promise.resolve(null),
			delegate: Promise.resolve(null),
			project: Promise.resolve(null),
			labels: async () => ({
				nodes: (input.labelIds ?? []).map(() => ({ name: "fixture" })),
			}),
		};
		providerIssues.set(input.id, issue);
		if (loseNext) {
			loseNext = false;
			throw new Error("Controlled lost creation response");
		}
		return { success: true, issue: Promise.resolve(issue) };
	},
};
tracker.getClient = () => linearClient;
async function validatePinnedMcp(config, snapshot, run) {
	const connection = config.mcpConfig["factory-context"],
		path = connection.args.at(-1);
	const research = JSON.parse(
		readFileSync(join(dirname(path), "research.json"), "utf8"),
	);
	assert.equal(research.maxCalls, 200);
	assert.equal(
		research.repositories[0].revision,
		snapshot.baseline.repositories[0].revision,
	);
	writeFileSync(
		join(run.workspace, "README.md"),
		"mutable working tree must stay invisible\n",
	);
	writeFileSync(join(run.workspace, ".env"), "FAKE_SECRET=never-copy\n");
	const client = new Client({ name: "f1-actions", version: "1" });
	const transport = new StdioClientTransport({
		command: connection.command,
		args: connection.args,
		stderr: "pipe",
	});
	try {
		await client.connect(transport);
		const tools = await client.listTools();
		assert(tools.tools.some((tool) => tool.name === "read_repository"));
		const read = await client.callTool({
			name: "read_repository",
			arguments: { repositoryId: "actions-fixture", path: "README.md" },
		});
		const data = JSON.parse(
			read.content.find((block) => block.type === "text").text,
		);
		assert.equal(data.revision, research.repositories[0].revision);
		assert.equal(data.text, "# Action controlled fixture\n");
		const secret = await client.callTool({
			name: "read_repository",
			arguments: { repositoryId: "actions-fixture", path: ".env" },
		});
		assert.equal(secret.isError, true);
		const foreign = await client.callTool({
			name: "read_repository",
			arguments: { repositoryId: "foreign", path: "README.md" },
		});
		assert.equal(foreign.isError, true);
		return {
			revision: data.revision,
			registeredTools: tools.tools.map((tool) => tool.name),
			privateDenied: true,
			foreignDenied: true,
		};
	} finally {
		await client.close();
	}
}
const pinned = [];
function newWorker() {
	const instance = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		serverPort: rpcPort,
		serverHost: "127.0.0.1",
		defaultRunner: "codex",
		maxConcurrentSessions: 2,
		issueTrackerFactory: () => tracker,
		linearWorkspaces: {
			"cli-workspace": { linearToken: "fixture-no-provider-token" },
		},
		repositories: [
			{
				id: "actions-fixture",
				name: "Action F1 fixture",
				repositoryPath: repository,
				workspaceBaseDir: join(directory, "worktrees"),
				baseBranch: "main",
				githubUrl: "https://github.com/fixture/actions",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		handlers: {
			createAgentRunner: (type, config) => {
				const connection = config.mcpConfig?.["factory-context"];
				if (!connection)
					return f1AgentHandlers(
						"mock",
						JSON.stringify({ title: "Actions F1" }),
					).createAgentRunner(type, config);
				const snapshot = loadFactoryContextSnapshot(connection.args.at(-1));
				const run = [...runtime.runs.values()].find(
					(run) =>
						(run.workspace === config.workingDirectory ||
							join(runtime.directory, "evidence", run.id) ===
								config.workingDirectory) &&
						run.status === "running",
				);
				assert(run, "Mock runner belongs to actual run workspace");
				const role = snapshot.workflowExecution.currentStep.id;
				turns.push({
					runId: run.id,
					role,
					workspace: run.workspace,
					resume: config.resumeSessionId ?? null,
				});
				const runner = f1AgentHandlers(
					"mock",
					JSON.stringify(
						role === "research"
							? { items }
							: { summary: "Controlled independent work" },
					),
				).createAgentRunner(type, config);
				if (role === "research") {
					const start = runner.start.bind(runner);
					runner.start = async (...args) => {
						pinned.push(await validatePinnedMcp(config, snapshot, run));
						return start(...args);
					};
				}
				return runner;
			},
		},
	});
	const instanceRuntime = instance.getFactoryRuntime();
	const originalTool = instanceRuntime.hooks.tool;
	// Script only the forge boundary. Runtime human gates, immutable histories,
	// dependency dispatch, worktree setup and CLI tracking remain production code.
	instanceRuntime.hooks.tool = async (context) => {
		if (context.run.workflow.id !== childWorkflow.id)
			return originalTool(context);
		const headSha = git(context.run.workspace, "rev-parse", "HEAD"),
			url = `https://github.com/fixture/actions/pull/${context.run.recipeParent.itemId === "base" ? 1 : 2}`;
		if (
			context.step.tool === "draft-pr" ||
			context.step.tool === "human-review"
		)
			return { headSha, url };
		if (context.step.tool === "merge") {
			assert.equal(context.run.humanDecisions.at(-1).headSha, headSha);
			return { merged: true, headSha, url };
		}
		throw new Error(`Unexpected fixture provider tool ${context.step.tool}`);
	};
	return { instance, instanceRuntime };
}
async function rpc(method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${rpcPort}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const value = await response.json();
	assert(!value.error, JSON.stringify(value));
	return value.result;
}
async function until(check, message) {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(
		`${message}: ${JSON.stringify([...runtime.runs.values()].map(({ id, status, step, error }) => ({ id, status, step, error })))}`,
	);
}
async function startScenario(id) {
	runtime.updateWorkflows(runtime.listWorkflows(), id);
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: id,
		description: "Controlled generic actions fixture",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	sessions.push(session.sessionId);
	await until(
		() => runtime.runs.has(session.sessionId),
		"CLI workflow admission",
	);
	return session.sessionId;
}
function batchOf(run) {
	return Object.values(run.launchActions ?? {})[0];
}
async function approveChild(child) {
	await until(
		() => child.reviewGate?.status === "pending" && child.status === "waiting",
		"Child human gate",
	);
	runtime.decide(child.id, {
		reviewId: child.reviewGate.id,
		headSha: child.reviewGate.headSha,
		decision: "approve",
	});
	await runtime.flush(child.id);
}
try {
	({ instance: worker, instanceRuntime: runtime } = newWorker());
	runtime.updateWorkflows(
		[...defaultWorkflows, ...definitions],
		definitions[1].id,
	);
	await worker.start();
	await rpc("ping");
	for (const [id, wait, restart] of [
		["f1-actions-wait", true, false],
		["f1-actions-detached", false, true],
	]) {
		const parentId = await startScenario(id);
		let parent = runtime.get(parentId);
		await until(
			() => batchOf(parent)?.progress.base.creation === "confirmed",
			"Base child admission",
		);
		let batch = batchOf(parent),
			base = runtime.get(batch.accepted.items[0].runId);
		await until(() => base.status === "waiting", "Base waiting human");
		assert.equal(
			runtime.runs.has(batch.accepted.items[1].runId),
			false,
			"Dependent cannot precede explicit approval and merged provider receipt",
		);
		if (!wait)
			await until(
				() => parent.checkpoint.current === "end",
				"Detached action advances parent graph",
			);
		await until(
			() => parent.status === "waiting",
			"Parent enters passive child tracking",
		);
		assert.equal(parent.status, "waiting");
		const frozenOutput = wait
			? undefined
			: JSON.stringify(parent.outputs.dispatch);
		const accepted = JSON.stringify(batch.accepted),
			baseWorkspace = base.workspace;
		if (restart) {
			await worker.stop();
			({ instance: worker, instanceRuntime: runtime } = newWorker());
			await worker.start();
			parent = runtime.get(parentId);
			batch = batchOf(parent);
			base = runtime.get(base.id);
			assert.equal(JSON.stringify(batch.accepted), accepted);
			assert.equal(base.workspace, baseWorkspace);
			assert.equal(JSON.stringify(parent.outputs.dispatch), frozenOutput);
			await until(
				() => base.status === "waiting",
				"Restart restores ordinary human gate",
			);
		}
		await approveChild(base);
		await until(
			() => batch.progress.dependent.creation === "confirmed",
			"Next dependency wave after exact human/provider proof",
		);
		const dependent = runtime.get(batch.accepted.items[1].runId);
		assert.notEqual(
			dependent.workspace,
			base.workspace,
			"Children independent worktrees",
		);
		assert.equal(dependent.recipeParent.runId, parentId);
		await approveChild(dependent);
		await until(
			() => parent.status === "completed",
			"Parent terminal after child merge outcomes",
		);
		await until(
			() => parent.launchOutcomePublication?.phase === "confirmed",
			"Terminal tracking publication",
		);
		if (!wait)
			assert.equal(
				JSON.stringify(parent.outputs.dispatch),
				frozenOutput,
				"Background progress never rewrites accepted links",
			);
		results.push({
			scenario: id,
			parentId,
			wait,
			restart,
			children: batch.accepted.items.map((item) => ({
				id: item.id,
				runId: item.runId,
				status: batch.progress[item.id].status,
				wave: item.wave,
			})),
			filed: parent.outputs.file,
			scopeRetained: true,
			independentWorktrees: true,
		});
	}
	loseNext = true;
	const parentId = await startScenario("f1-actions-uncertain");
	let parent = runtime.get(parentId);
	await until(() => parent.status === "failed", "Lost issue response retained");
	const sendCount = sends.length;
	assert.equal(
		Object.values(parent.issueActions)[0].items[0].phase,
		"uncertain",
	);
	await worker.stop();
	({ instance: worker, instanceRuntime: runtime } = newWorker());
	await worker.start();
	parent = runtime.get(parentId);
	runtime.retry(parentId);
	await until(
		() => batchOf(parent)?.progress.base.creation === "confirmed",
		"Retry reconciles lost issue then dispatches",
	);
	assert.equal(
		sends.length,
		sendCount,
		"Lost response lookup avoids duplicate creation",
	);
	let batch = batchOf(parent);
	const base = runtime.get(batch.accepted.items[0].runId);
	const originalChildIds = batch.accepted.items.map((item) => item.runId);
	await until(
		() => parent.checkpoint?.current === "end" && parent.outputs.dispatch,
		"Detached action publishes its original receipt before pause",
	);
	// Compare the persisted JSON value; optional undefined fields do not survive JSON storage.
	const originalAccepted = JSON.parse(JSON.stringify(batch.accepted));
	const originalDispatchOutput = structuredClone(parent.outputs.dispatch);
	await until(() => base.status === "waiting", "Base waiting before stop");
	runtime.stop(parentId);
	await runtime.flush(parentId);
	await until(
		() => !runtime.isExecuting(parentId),
		"Stopped parent executor drains",
	);
	assert.equal(base.status, "waiting", "Parent stop leaves child gate intact");
	await approveChild(base);
	await until(
		() => base.status === "completed",
		"Existing child continues after parent stop",
	);
	await until(
		() => batch.progress.base.status === "merged",
		"Paused parent observes original provider-confirmed merge",
	);
	assert.equal(parent.status, "stopped");
	assert.equal(batch.progress.dependent.status, "queued");
	assert.equal(
		runtime.runs.has(batch.accepted.items[1].runId),
		false,
		"Paused parent prevents next wave",
	);
	await worker.stop();
	({ instance: worker, instanceRuntime: runtime } = newWorker());
	await worker.start();
	parent = runtime.get(parentId);
	batch = batchOf(parent);
	await until(
		() => batch.progress.base.status === "merged",
		"Paused child projection survives worker reconstruction",
	);
	assert.equal(parent.status, "stopped");
	assert.equal(batch.progress.dependent.status, "queued");
	assert.equal(runtime.runs.has(originalChildIds[1]), false);
	assert.deepEqual(
		JSON.parse(JSON.stringify(batch.accepted)),
		originalAccepted,
	);
	assert.deepEqual(parent.outputs.dispatch, originalDispatchOutput);
	assert.deepEqual(
		batch.accepted.items.map((item) => item.runId),
		originalChildIds,
	);
	runtime.resume(parentId);
	await until(
		() => batch.progress.dependent.creation === "confirmed",
		"Resume dispatches original queued wave",
	);
	const dependent = runtime.get(batch.accepted.items[1].runId);
	await runtime.stopBatch(parentId);
	await until(
		() => !runtime.isExecuting(dependent.id),
		"Explicit batch stop drains child",
	);
	assert.equal(parent.status, "stopped");
	assert.equal(dependent.status, "stopped");
	assert.equal(batch.cancelled, true);
	results.push({
		scenario: "uncertain-stop-resume-stopbatch",
		parentId,
		lostReplyReconciled: true,
		duplicateSends: 0,
		parentPausePreservedChild: true,
		pausedObservationAndReconstruction: true,
		mappedSnapshotPinnedMcp: true,
		resumeRetainedOriginalWave: true,
		batchStopPersisted: true,
	});
	const activities = await rpc("viewSession", { sessionId: sessions[0] });
	assert(activities.activities.length > 0, "CLI activities are published");
	for (const activity of activities.activities) {
		assert(activity.type && typeof activity.content === "string");
		assert(Number.isFinite(new Date(activity.createdAt).getTime()));
	}
	const page = await rpc("viewSession", {
		sessionId: sessions[0],
		limit: 1,
		offset: 0,
	});
	assert.equal(page.activities.length, 1);
	assert.equal(page.totalCount, activities.totalCount);
	const completedParent = runtime.get(sessions[0]);
	await worker.getTicketTracking().flush(completedParent);
	const completion = completedParent.ticketSync.receipts.find((receipt) =>
		receipt.key.startsWith("outcome:completed:"),
	);
	assert(completion, "Durable terminal outcome intent is retained");
	const trackerIssue = await tracker.fetchIssue(completedParent.issueId);
	const trackerState = await trackerIssue.state;
	if (completion.superseded) {
		assert.equal(
			trackerState.type,
			"completed",
			"Only an already terminal mock tracker ticket supersedes late progress",
		);
		assert.equal(
			completion.limitation,
			"Terminal ticket retained; stale progress omitted.",
		);
		assert.notEqual(
			completion.delivered,
			true,
			"Superseded progress never fabricates delivery",
		);
	} else {
		assert.equal(
			completion.delivered,
			true,
			"Open-ticket terminal outcome is delivered",
		);
		const comments = await tracker.fetchComments(completedParent.issueId, {
			first: 100,
		});
		assert(
			comments.nodes.some((comment) => comment.body.includes(completion.body)),
			"CLI completion reaches its configured comment receiver",
		);
	}
	assert(
		completedParent.ticketSync.receipts.some(
			(receipt) => receipt.key === "started" && receipt.delivered,
		),
		"CLI start milestone reaches tracker",
	);

	assert.equal(
		buildIdentity(),
		identity.buildSha256,
		"Executed build stays unchanged during drive",
	);
	assert.equal(
		sourceDelta(),
		identity.deltaSha256,
		"Source stays unchanged during drive",
	);
	const endedAt = new Date().toISOString();
	const receipt = {
		result: "PASS",
		startedAt,
		endedAt,
		directory,
		paidCalls: 0,
		...identity,
		results,
		pinnedMcp: pinned,
		activityCount: activities.totalCount,
		terminalTracking: {
			retained: true,
			delivered: completion.delivered === true,
			superseded: completion.superseded === true,
			trackerState: trackerState.type,
		},
		providerSends: sends.length,
		mockTurns: turns.length,
	};
	writeFileSync(
		join(directory, "results.json"),
		JSON.stringify(receipt, null, 2),
	);
	console.log(JSON.stringify(receipt));
} finally {
	if (worker) await worker.stop();
}
