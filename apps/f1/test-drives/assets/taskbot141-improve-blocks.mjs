// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs [--serve]
// Real EdgeWorker, WorkflowRuntime, CLI RPC, catalog and HTTP decisions. Providers
// are intercepted exclusively by the canonical F1 mock; no native agent runs.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"Only deterministic mocks allowed",
);
assert.match(process.version, /^v24\./);
const root = resolve(import.meta.dirname, "../../../..");
const media = join(root, "apps/f1/test-drives/media/2026-10-22-improve-blocks");
mkdirSync(media, { recursive: true });
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-improve-blocks-")),
);
const home = join(directory, "home"),
	repository = join(directory, "repo");
mkdirSync(home, { mode: 0o700 });
mkdirSync(repository, { mode: 0o700 });
const receipts = [],
	turns = [],
	filed = [],
	checks = [];
const stamp = () => new Date().toISOString();
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
	"packages/edge-worker/src/EdgeWorker.ts",
	...[
		"improvementWorkflow",
		"WorkflowRuntime",
		"WorkflowCatalog",
		"Workflow",
		"StepBindings",
		"View",
		"ResearchPermissions",
		"ResearchFormats",
		"ResearchPrompts",
		"FileIssues",
		"FileIssueProviders",
		"OutputFormats",
	].map((name) => `packages/edge-worker/src/factory/${name}.ts`),
	"apps/f1/src/MockAgentRunner.ts",
];
const sourceIdentity = () =>
	Object.fromEntries(
		sourcePaths.map((path) => [
			path,
			existsSync(join(root, path))
				? hash(readFileSync(join(root, path)))
				: null,
		]),
	);
const sourceBefore = sourceIdentity();
const identity = {
	revision: git(root, "rev-parse", "HEAD"),
	startedAt: stamp(),
	directory,
	pid: process.pid,
	node: process.version,
	driverSha256: hash(readFileSync(import.meta.filename)),
	sourceBefore,
	executedBuilds: Object.fromEntries(
		sourcePaths.map((path) => {
			const built = path.startsWith("apps/f1/")
				? path
						.replace("apps/f1/src/", "apps/f1/dist/src/")
						.replace(/\.ts$/, ".js")
				: path.replace("/src/", "/dist/").replace(/\.ts$/, ".js");
			return [
				built,
				existsSync(join(root, built))
					? hash(readFileSync(join(root, built)))
					: null,
			];
		}),
	),
};
const save = (name, value) =>
	writeFileSync(join(media, name), `${JSON.stringify(value, null, 2)}\n`);
save("identity.json", identity);
console.log(JSON.stringify({ phase: "setup", directory, pid: process.pid }));
// No inherited Factory endpoints or remote storage; native stores are untouched.
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);
process.env.CODEX_HOME = join(directory, "unused-codex-home");
git(repository, "init", "-q", "-b", "main");
git(repository, "config", "user.name", "F1 Improve fixture");
git(repository, "config", "user.email", "f1@example.invalid");
git(repository, "config", "commit.gpgsign", "false");
git(repository, "config", "core.hooksPath", "/dev/null");
writeFileSync(
	join(repository, "README.md"),
	"# Disposable Improve research fixture\n",
);
writeFileSync(
	join(repository, "cache.ts"),
	"export const cache = new Map<string, string>();\n",
);
writeFileSync(
	join(repository, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\nAGENTS.md\nCLAUDE.md\n",
);
git(repository, "add", ".");
// This baseline is only in the fresh disposable repository, never the task checkout.
git(repository, "commit", "-qm", "Disposable F1 baseline");
const origin = join(directory, "origin.git");
git(directory, "init", "--bare", "-q", origin);
git(repository, "remote", "add", "origin", origin);
git(repository, "push", "-qu", "origin", "main");
async function freePort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}
const rpcPort = await freePort(),
	factoryPort = await freePort();
const apiOrigin = `http://127.0.0.1:${factoryPort}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
const tracker = createCLIIssueTracker();
// Seed a real backlog in the disposable CLI tracker. The SDK-shaped shim below
// deliberately has no network transport and adapts to that same tracker state.
const backlog = {
	...tracker.getState().workflowStates.get("state-todo"),
	id: "state-backlog",
	name: "Backlog",
	type: "backlog",
};
tracker.getState().workflowStates.set(backlog.id, backlog);
const providerIssues = new Map();
tracker.getClient = () => ({
	teams: async () => ({
		nodes: [{ id: "team-default", name: "F1 disposable team" }],
		pageInfo: { hasNextPage: false },
	}),
	team: async () => ({ states: async () => ({ nodes: [backlog] }) }),
	issues: async ({ filter }) => ({
		nodes: providerIssues.has(filter.id.eq)
			? [providerIssues.get(filter.id.eq)]
			: [],
	}),
	createIssue: async (input) => {
		assert.equal(input.stateId, "state-backlog");
		assert.equal(input.assigneeId, null);
		assert.equal(input.delegateId, null);
		assert.equal(input.useDefaultTemplate, false);
		const issue = await tracker.createIssue({ ...input, id: undefined });
		const value = {
			id: input.id,
			url: issue.url,
			description: input.description,
			team: { id: input.teamId },
			state: backlog,
			assignee: null,
			delegate: null,
			project: null,
			labels: async () => ({ nodes: [] }),
		};
		providerIssues.set(input.id, value);
		filed.push({
			at: stamp(),
			cliId: issue.id,
			providerId: input.id,
			title: input.title,
			body: input.description,
			state: "backlog",
			assignee: null,
			delegate: null,
		});
		return { success: true, issue: value };
	},
});
const inheritance =
	"No step model is configured; this agent inherits the accepted run model.";
const opportunities = [
	["cache", "Isolate cache ownership"],
	["deferred", "Document cache lifecycle"],
	["optional", "Inspect a future adapter"],
].map(([id, title]) => ({
	id,
	title,
	problem: "The fixture exports mutable cache state without an owner.",
	evidence: ["cache.ts:1 at the pinned Snapshot revision"],
	consequence: "Callers can couple to shared mutation.",
	before: "Callers → exported Map",
	after: "Callers → cache owner → private Map",
	plan: "Wrap the fixture cache behind a narrow owner; verify read/write and explicit clear behavior.",
	criteria: ["Callers use the owner and clear has an observable check."],
	nonGoals: ["No external services or new dependencies."],
	risks: ["Check current callers before changing exports."],
	paths: ["cache.ts"],
	strength: "worth-exploring",
	effort: "Small",
	dependencies: [],
	conflicts: [],
	perspectives: ["modules"],
	issueBody: `# ${title}\n\nProblem: exported cache ownership is unclear.\nEvidence: cache.ts:1 at the pinned baseline.\nBenefit/design: a narrow cache owner.\nPlan: inspect callers, wrap mutation, verify read/write and clear.\nAcceptance: existing observable behavior survives.\nNon-goals: external services.\nRisk/prerequisite: inspect callers first; deferred backlog work only.`,
}));
let runtime, worker;
const mock = (runner, config, output) =>
	f1AgentHandlers("mock", JSON.stringify(output)).createAgentRunner(
		runner,
		config,
	);
worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: rpcPort,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	codexDefaultModel: "gpt-6.1-sol",
	maxConcurrentSessions: 4,
	issueTrackerFactory: () => tracker,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "fixture-no-auth-or-transport" },
	},
	repositories: [
		{
			id: "improve-fixture",
			name: "Improve F1 fixture",
			repositoryPath: repository,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: "https://github.com/fixture/improve",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
			allowedTools: ["mcp__linear__get_issue", "mcp__linear__save_issue"],
		},
	],
	handlers: {
		createAgentRunner: (runner, config) => {
			const connection = config.mcpConfig?.["factory-context"];
			if (!connection) return mock(runner, config, { title: "F1 Improve" });
			const context = loadFactoryContextSnapshot(connection.args.at(-1));
			const role = context.workflowExecution.currentStep.id;
			const run = [...runtime.runs.values()].find(
				(run) =>
					run.workspace === config.workingDirectory ||
					join(runtime.directory, "evidence", run.id) ===
						config.workingDirectory,
			);
			assert(run, "Every provider hook belongs to a real runtime workspace");
			const turn = {
				at: stamp(),
				runId: run.id,
				role,
				stepKey: context.workflowExecution.currentStep.key,
				runner,
				model: config.model ?? null,
				perspective: context.perspective?.id ?? null,
				promptSha256: hash(config.appendSystemPrompt ?? ""),
				forkPromptObserved: (config.appendSystemPrompt ?? "").includes(
					"F1_FORK_PROMPT",
				),
				focus: context.focus ?? null,
				execution: context.execution ?? null,
				allowedTools: [...new Set(config.allowedTools)],
				tools: config.tools,
				mcpServers: Object.keys(config.mcpConfig ?? {}),
				strictMcpConfig: config.strictMcpConfig,
				sandbox: config.sandbox,
				configOverrides: config.configOverrides,
				workingDirectory: config.workingDirectory,
			};
			turns.push(turn);
			if (run.recipeParent) {
				assert.equal(
					role,
					"clarify",
					"Real stock Factory child stops before implementation",
				);
				return mock(runner, config, {
					questions: [
						"This is a disposable F1 child. Keep implementation paused while inspecting this page?",
					],
					decisions: [],
					requirements: [
						"No implementation or external publication during the drive.",
					],
				});
			}
			assert.equal(runner, "codex");
			assert.equal(config.model, "gpt-6.1-sol");
			assert.deepEqual(
				[...new Set(config.allowedTools)].sort(),
				["list_context", "read_context", "list_repository", "read_repository"]
					.map((tool) => `mcp__factory-context__${tool}`)
					.sort(),
			);
			assert.deepEqual(config.tools, []);
			assert.deepEqual(config.skills, []);
			assert.deepEqual(config.plugins, []);
			assert.deepEqual(Object.keys(config.mcpConfig), ["factory-context"]);
			assert.equal(config.strictMcpConfig, true);
			assert.equal(config.sandbox, "read-only");
			for (const tool of [
				"Bash",
				"Shell",
				"Read",
				"Write",
				"Edit",
				"Task",
				"Agent",
				"WebSearch",
				"WebFetch",
			])
				assert(config.disallowedTools.includes(tool));
			assert.equal(config.configOverrides.features.shell_tool, false);
			assert.equal(config.configOverrides.features.apply_patch_tool, false);
			assert.equal(config.configOverrides.features.multi_agent, false);
			assert.equal(config.webSearchMode, "disabled");
			assert.equal(
				config.workingDirectory,
				join(runtime.directory, "evidence", run.id),
			);
			let output;
			switch (role) {
				case "map":
					output = {
						summary: "Fixture cache ownership map",
						focus: context.focus ?? "",
						context:
							"cache.ts exports a Map; README describes the disposable fixture.",
						limitations: [
							"Only the disposable repository was inspected by scripted fixture output.",
						],
					};
					break;
				case "coordinate":
					assert(context.baseline && context.perspective && context.context);
					output = {
						summary: `Bounded ${context.perspective.name}`,
						assignments: [
							{
								id: "one",
								question: `Inspect ${context.perspective.id} cache ownership`,
								scope: ["cache.ts"],
							},
						],
					};
					break;
				case "worker":
					assert.equal(context.execution.modelSource, "run");
					assert.equal(context.execution.model, "gpt-6.1-sol");
					assert(context.execution.limitations.includes(inheritance));
					assert.equal(context.assignment.id, "one");
					output = {
						summary: "One bounded finding",
						findings: [
							{
								observation: "Exported mutable state",
								evidence: ["cache.ts:1"],
								consequence: "Shared lifecycle",
								direction: "Encapsulate ownership",
								confidence: "medium",
							},
						],
						limitations: [inheritance, "Scripted output; no native inference."],
					};
					break;
				case "verify":
					assert.equal(context.workers.summary.completed, 1);
					output = {
						summary: "Bounded evidence retained",
						findings: [
							{
								observation: "Exported mutable cache",
								evidence: ["cache.ts:1"],
								consequence: "Shared lifecycle",
								direction: "Encapsulate ownership",
								confidence: "medium",
							},
						],
						limitations: [inheritance],
					};
					break;
				case "proposals":
					assert(context.reports.summary.completed >= 1);
					output = {
						summary: context.followUps
							? "The targeted answer was folded into the same stable shortlist."
							: "Three fixture opportunities",
						opportunities,
						limitations: [
							inheritance,
							"Mocked providers; no native source inspection was executed.",
						],
					};
					break;
				case "answer":
					output = {
						itemId: context.question.itemId,
						answer:
							"The proposed owner preserves read/write and explicit clear semantics.",
						evidence: ["cache.ts:1"],
						limitations: ["Fixture evidence only."],
					};
					break;
				case "plan":
					output = {
						id: context.item.id,
						itemIds: [context.item.id],
						title: context.item.title,
						plan: context.item.plan,
						criteria: context.item.criteria,
						dependencies: [],
						paths: context.item.paths,
					};
					break;
				case "architecture":
				case "security":
				case "dependencies":
					assert(Array.isArray(context.plans));
					output = { approved: true, feedback: [] };
					break;
				default:
					throw new Error(`Unexpected ${role}; no native fallback permitted`);
			}
			return mock(runner, config, output);
		},
	},
});
runtime = worker.getFactoryRuntime();
const execAsync = promisify(execFile);
async function cli(...args) {
	const { stdout, stderr } = await execAsync(join(root, "apps/f1/f1"), args, {
		cwd: root,
		env: { ...process.env, BOBS_FACTORY_PORT: String(rpcPort), NO_COLOR: "1" },
		timeout: 15000,
	});
	receipts.push({ at: stamp(), cli: args, stdout, stderr });
	return stdout.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
}
async function rpc(method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${rpcPort}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
	});
	const body = await response.json();
	assert(!body.error, JSON.stringify(body));
	return body.result;
}
async function api(
	path,
	body,
	expected = 200,
	method = body === undefined ? "GET" : "POST",
) {
	const response = await fetch(`${apiOrigin}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			Origin: apiOrigin,
			"Sec-Fetch-Site": "same-origin",
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json();
	receipts.push({
		at: stamp(),
		method,
		path,
		status: response.status,
		request:
			path === "/api/workflows" && body
				? {
						defaultWorkflow: body.defaultWorkflow,
						workflows: body.workflows.map((workflow) => ({
							id: workflow.id,
							name: workflow.name,
							allowedTriggers: workflow.allowedTriggers,
							sha256: hash(JSON.stringify(workflow)),
						})),
						omitted:
							"Full catalog bodies; each exact definition is hashed above.",
					}
				: body,
		result:
			response.status === expected
				? { id: value.id, status: value.status }
				: value,
	});
	assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
	return value;
}
async function until(check, label, ms = 120000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return;
		const failure = [...runtime.runs.values()].find(
			(run) => run.status === "failed",
		);
		if (failure) throw new Error(`${label}: ${failure.id}: ${failure.error}`);
		await new Promise((done) => setTimeout(done, 25));
	}
	throw new Error(
		`${label}: ${JSON.stringify([...runtime.runs.values()].map(({ id, status, step, error }) => ({ id, status, step, error })))}`,
	);
}
const current = (id) => runtime.get(id);
async function decision(id, kind) {
	await until(
		() =>
			current(id).status === "waiting" &&
			current(id).viewDecision?.kind === kind &&
			!current(id).viewDecision.answer,
		`Wait ${kind}`,
	);
	return structuredClone(current(id).viewDecision);
}
async function choose(id, actions) {
	const batch = await decision(id, "decide");
	await api(`/api/runs/${id}/view-answer`, {
		batchId: batch.id,
		digest: batch.digest,
		accepted: true,
		choices: batch.items.map((item) => ({
			itemId: item.id,
			action: actions[item.id] ?? "skip",
			...(actions[item.id] === "ask"
				? { comment: "Will clear semantics be preserved?" }
				: {}),
		})),
	});
	return batch;
}
async function manual(workflow = "improve-codebase") {
	const accepted = await api(
		"/api/runs",
		{
			repositoryId: "improve-fixture",
			workflow,
			runner: "codex",
			model: "gpt-6.1-sol",
			inputs: { focus: "Cache ownership in the disposable fixture" },
		},
		202,
	);
	return accepted.id;
}
let retained = false;
try {
	await worker.start();
	assert.match(await cli("ping"), /Server is healthy/i);
	assert.match(await cli("status"), /status/i);
	const stockId = await manual();
	const first = await decision(stockId, "decide");
	const stockRun = current(stockId);
	assert.equal(stockRun.workflow.id, "improve-codebase");
	assert.deepEqual(stockRun.workflow.allowedTriggers, ["manual"]);
	assert.equal(stockRun.outputs.perspectives.summary.completed, 8);
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "worker")
			.length,
		8,
	);
	assert(
		first.view.components.some((component) =>
			JSON.stringify(component.data).includes(inheritance),
		),
	);
	checks.push(
		"Stock manual launch, without a worker model, invoked Map + eight coordinator/worker/verifier calls + Consolidate under real EdgeWorker read-only restrictions.",
	);
	await choose(stockId, { cache: "ask" });
	await until(
		() =>
			current(stockId).viewDecision?.id !== first.id &&
			current(stockId).status === "waiting",
		"Ask reconsolidates",
	);
	const second = await decision(stockId, "decide");
	assert.notEqual(first.digest, second.digest);
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "map")
			.length,
		1,
	);
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "worker")
			.length,
		8,
	);
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "answer")
			.length,
		1,
	);
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "proposals")
			.length,
		2,
	);
	await choose(stockId, { cache: "fix", deferred: "issue" });
	const approval = await decision(stockId, "approve");
	assert.equal(
		turns.filter((turn) => turn.runId === stockId && turn.role === "plan")
			.length,
		1,
	);
	assert(
		JSON.stringify(approval.view).includes(opportunities[0].criteria[0]),
		"Approval displays actual plan criteria",
	);
	assert.equal(filed.length, 0, "No issue before exact human approval");
	await api(
		`/api/runs/${stockId}/view-answer`,
		{
			batchId: approval.id,
			digest: "0".repeat(64),
			accepted: true,
			approved: true,
		},
		409,
	);
	await api(`/api/runs/${stockId}/view-answer`, {
		batchId: approval.id,
		digest: approval.digest,
		accepted: true,
		approved: true,
	});
	await until(
		() =>
			filed.length === 1 &&
			[...runtime.runs.values()].some(
				(run) =>
					run.recipeParent?.runId === stockId &&
					run.status === "waiting" &&
					run.questions?.length,
			),
		"Approved batch files issue and launches ordinary child",
	);
	const child = [...runtime.runs.values()].find(
		(run) => run.recipeParent?.runId === stockId,
	);
	assert.equal(child.workflow.id, "factory");
	assert.notEqual(child.workspace, stockRun.workspace);
	assert.equal(child.humanDecisions?.length ?? 0, 0);
	const deferredIssue = await tracker.fetchIssue(filed[0].cliId);
	assert.equal(deferredIssue.stateId, "state-backlog");
	assert(deferredIssue.assigneeId == null);
	checks.push(
		"Exact human approval rejected a stale digest, then created one confirmed unassigned backlog issue through the real filing adapter and admitted one ordinary Factory child at its clarification gate.",
	);
	// Use the real fork operation, then edit only a copied perspective collection,
	// one copied prompt and this fixture's explicit ticket admission permission.
	const fork = await api("/api/workflows/improve-codebase/fork", {
		name: "F1 one-perspective prompt fork",
	});
	const definitions = runtime
		.listWorkflows()
		.map((workflow) => structuredClone(workflow));
	const forked = definitions.find((workflow) => workflow.id === fork.id);
	forked.allowedTriggers = ["manual", "ticket-assignment"];
	const perspectives = forked.steps.find((step) => step.id === "perspectives");
	perspectives.items.values = [
		{
			id: "fixture-perspective",
			name: "Fixture ownership perspective",
			brief: "Only inspect cache ownership; copied recipe customization.",
		},
	];
	const mapId = forked.steps.find((step) => step.id === "map").workflow;
	const mapRecipe = definitions.find((workflow) => workflow.id === mapId);
	mapRecipe.steps[0].prompt +=
		"\nF1_FORK_PROMPT: focus only on cache ownership.";
	await api(
		"/api/workflows",
		{ workflows: definitions, defaultWorkflow: fork.id },
		200,
		"PUT",
	);
	const issueOutput = await cli(
		"create-issue",
		"--title",
		"F1 forked Improve via CLI",
		"--description",
		"Controlled local recipe run. No remote tracker or native inference.",
	);
	const issueId = issueOutput.match(/\bID:\s*(issue-\d+)/)?.[1];
	assert(issueId, issueOutput);
	const sessionOutput = await cli("start-session", "--issue-id", issueId);
	const sessionId = sessionOutput.match(/Session ID:\s*(\S+)/)?.[1];
	assert(sessionId, sessionOutput);
	await until(() => runtime.runs.has(sessionId), "CLI admits fork");
	await decision(sessionId, "decide");
	assert.equal(current(sessionId).outputs.perspectives.summary.completed, 1);
	const forkTurns = turns.filter((turn) => turn.runId === sessionId);
	assert.equal(forkTurns.filter((turn) => turn.role === "worker").length, 1);
	assert.equal(
		forkTurns.find((turn) => turn.role === "coordinate").perspective,
		"fixture-perspective",
	);
	assert(forkTurns.find((turn) => turn.role === "map").forkPromptObserved);
	assert.equal(
		runtime
			.listWorkflows()
			.find((workflow) => workflow.id === "improve-codebase")
			.steps.find((step) => step.id === "perspectives").items.values.length,
		8,
	);
	await until(
		async () =>
			(await tracker.fetchComments(issueId, { first: 100 })).nodes.some(
				(comment) => comment.body.includes("Decision batch:"),
			),
		"Tracker receives real decision notification",
	);
	const activities = await rpc("viewSession", {
		sessionId,
		limit: 3,
		offset: 0,
	});
	assert(activities.totalCount > 0);
	assert(activities.activities.length <= 3);
	assert(
		activities.activities.every(
			(activity) => activity.createdAt && activity.content,
		),
	);
	assert.match(
		await cli("view-session", "--session-id", sessionId, "--limit", "3"),
		/Session Details/,
	);
	await cli("stop-session", "--session-id", sessionId);
	await until(
		() => current(sessionId).status === "stopped",
		"CLI stop settles fork",
	);
	checks.push(
		"A real catalog fork changed one perspective and one prompt; actual F1 CLI admission invoked only that copied perspective, notified the in-memory tracker, rendered paginated activity and stopped cleanly. Stock remained eight perspectives/manual-only.",
	);
	// Reuse the exercised one-perspective fork for preview preparation. The
	// primary stock run above already exercised all eight perspectives.
	const decideId = await manual(fork.id);
	await decision(decideId, "decide");
	const approveId = await manual(fork.id);
	await decision(approveId, "decide");
	await choose(approveId, { cache: "fix" });
	await decision(approveId, "approve");
	const sourceAfter = sourceIdentity();
	const moving = sourcePaths.filter(
		(path) => sourceBefore[path] !== sourceAfter[path],
	);
	const preview = {
		apiOrigin,
		rpcPort,
		factoryPort,
		pid: process.pid,
		directory,
		stockId,
		decideId,
		approveId,
		childId: child.id,
		stoppedCliId: sessionId,
		forkId: fork.id,
		previewWorkflow:
			"The one-perspective, one-prompt catalog fork; stock canvas and eight-perspective primary run remain separate.",
		serveCommand:
			"F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot141-improve-blocks.mjs --serve",
		stop: `kill -TERM ${process.pid} (only this disposable driver)`,
	};
	save("preview.json", preview);
	save("turns.json", turns);
	save("http-cli.json", receipts);
	save("results.json", {
		completedAt: stamp(),
		checks,
		sourceChangedDuringDrive: moving,
		sourceAfter,
		paidCalls: 0,
		nativeRuns: 0,
		restartTested: false,
		preview,
	});
	save("tracker.json", {
		filed,
		comments: (await tracker.fetchComments(issueId, { first: 100 })).nodes.map(
			({ body, createdAt }) => ({ body, createdAt }),
		),
		activities,
	});
	console.log(
		JSON.stringify({
			phase: "checks-complete",
			checks: checks.length,
			...preview,
		}),
	);
	if (process.argv.includes("--serve")) {
		retained = true;
		await new Promise((done) => {
			process.once("SIGTERM", done);
			process.once("SIGINT", done);
		});
	}
} catch (error) {
	save("failure.json", {
		at: stamp(),
		error: error.stack,
		runs: [...runtime.runs.values()].map(
			({ id, status, step, error, viewDecision }) => ({
				id,
				status,
				step,
				error,
				viewDecision,
			}),
		),
		checks,
	});
	console.error(error);
	process.exitCode = 1;
} finally {
	save("turns.json", turns);
	save("http-cli.json", receipts);
	for (const run of runtime.runs.values()) {
		if (!["completed", "stopped", "failed"].includes(run.status))
			await runtime.stop(run.id);
	}
	await worker.stop();
	save("cleanup.json", {
		at: stamp(),
		retainedUntilSignal: retained,
		workerStopped: true,
		ownDisposableDirectoryRetained: directory,
		runs: [...runtime.runs.values()].map(({ id, status }) => ({ id, status })),
	});
	console.log(
		JSON.stringify({ phase: "cleanup", directory, workerStopped: true }),
	);
}
