// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot140-views.mjs
// Run only after the owner freezes and builds the combined source. This drives
// actual EdgeWorker/CLI/catalog/API/reconstruction with deterministic providers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { runPushEvent } from "../../../../packages/edge-worker/dist/factory/PushEvents.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"Live providers are prohibited in this driver",
);
assert.match(process.version, /^v24\./, "Use supported Node 24 tooling");
const root = resolve(import.meta.dirname, "../../../..");
const driver = "apps/f1/test-drives/assets/taskbot140-views.mjs";
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-taskbot140-views-")),
);
const home = join(directory, "home"),
	repository = join(directory, "repo"),
	origin = join(directory, "origin.git");
mkdirSync(home, { mode: 0o700 });
mkdirSync(repository, { mode: 0o700 });
const startedAt = new Date().toISOString();
const journal = join(directory, "actions.jsonl");
const record = (event, data = {}) =>
	appendFileSync(
		journal,
		`${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`,
	);
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// Runtime snapshots intentionally use null prototypes. Compare the complete
// persisted JSON contract without asking JavaScript prototype identity to match.
const assertJsonEqual = (actual, expected, message) =>
	assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
function backendSourceManifest() {
	const files = git(root, "ls-files", "packages", "apps/f1/src")
		.split("\n")
		.filter(
			(file) =>
				file.includes("/src/") &&
				/\.(?:tsx?|mjs|js|json)$/.test(file) &&
				!file.includes("/factory/web/"),
		)
		.sort();
	return Object.fromEntries(
		files.map((file) => [file, sha256(readFileSync(join(root, file)))]),
	);
}
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
				.update(`${name}/${file}\0`)
				.update(readFileSync(join(dist, file)))
				.update("\0");
	}
	hash
		.update("apps/f1/dist/src/MockAgentRunner.js\0")
		.update(readFileSync(join(root, "apps/f1/dist/src/MockAgentRunner.js")))
		.update("\0");
	return hash.digest("hex");
}
const sourceFiles = backendSourceManifest();
writeFileSync(
	join(directory, "source-files.json"),
	JSON.stringify(sourceFiles, null, 2),
);
const identity = {
	revision: git(root, "rev-parse", "HEAD"),
	deltaSha256: sourceDelta(),
	driverSha256: sha256(readFileSync(join(root, driver))),
	buildSha256: buildIdentity(),
	backendSourceSha256: sha256(JSON.stringify(sourceFiles)),
	node: process.version,
};
record("setup", { directory, startedAt, paidCalls: 0, ...identity });
console.log(JSON.stringify({ phase: "setup", directory, ...identity }));
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
git(directory, "init", "--bare", "-q", origin);
git(repository, "init", "-q", "-b", "main");
git(repository, "config", "user.name", "F1 view fixture");
git(repository, "config", "user.email", "f1@example.invalid");
git(repository, "config", "commit.gpgsign", "false");
writeFileSync(
	join(repository, "README.md"),
	"# Disposable declarative view fixture\n",
);
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
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const port = server.address().port;
	await new Promise((done) => server.close(done));
	return port;
}
const rpcPort = await freePort(),
	factoryPort = await freePort();
const apiOrigin = `http://127.0.0.1:${factoryPort}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);

const items = [
	{
		id: "cache",
		title: "<script>cache()</script>",
		body: "Keep HTML inert; [unsafe](javascript:alert(1))",
		impact: "Reuse accepted cache receipts",
	},
	{
		id: "labels",
		title: "Clarify progress",
		body: "Keep the stage labels readable",
		impact: "Show truthful waiting state",
	},
];
const markdown = (id, text) => ({
	id,
	type: "markdown",
	data: { literal: { text } },
});
const literalView = (text) => ({
	version: "view-v1",
	components: [markdown("message", text)],
});
const authoredView = {
	version: "view-v1",
	components: [
		markdown(
			"intro",
			"Agent-authored view: <script>window.__f1Pwned=true</script> [bad](javascript:alert(1))",
		),
		{
			id: "notes",
			type: "points",
			data: {
				literal: {
					items: [
						{
							label: "Accepted evidence",
							detail: "No raw HTML or script executes.",
						},
					],
				},
			},
		},
		{
			id: "catalog",
			type: "itemCards",
			data: {
				literal: {
					items: items.map(({ id, title, body }) => ({ id, title, body })),
				},
			},
		},
		{
			id: "form",
			type: "choices",
			data: {
				literal: {
					fields: [
						{
							id: "reason",
							label: "Decision note",
							type: "text",
							required: true,
						},
					],
				},
			},
		},
		{
			id: "bar",
			type: "decisionBar",
			data: {
				literal: {
					summary: "Choose every item, then explicitly save.",
					actions: [{ id: "review", label: "Review every item" }],
				},
			},
		},
	],
};
const base = { configVersion: "step-config-v1", maxVisits: 16, branches: [] };
const agent = (id, next, output = "json-v1", reads = {}) => ({
	...base,
	id,
	name: id,
	type: "agent",
	prompt: `Return the deterministic ${id} fixture.`,
	reads,
	output: { format: output },
	next,
});
const sourceRecipe = {
	id: "f1-views-source",
	name: "Reusable view source",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	steps: [agent("research", "story"), agent("story", "end", "view-v1")],
};
const childRecipe = {
	id: "f1-views-child",
	name: "Ordinary child with a human view",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow"],
	steps: [
		{
			...base,
			id: "child-accept",
			name: "Child acceptance",
			type: "approve",
			view: literalView(
				"Approve this isolated child fixture. No publication or merge is requested.",
			),
			next: "child-summary",
		},
		{
			...base,
			id: "child-summary",
			name: "Child summary",
			type: "show",
			view: literalView("The isolated child completed its recipe."),
			next: "end",
		},
	],
};
const launch = (id, next, waves = false) => ({
	...base,
	id,
	name: "Launch ordinary children",
	type: "launch-runs",
	launchRuns: {
		items: {
			values: [
				{
					id: "first",
					title: "Independent child",
					prompt: "Controlled child",
					dependencies: [],
				},
				...(waves
					? [
							{
								id: "later",
								title: "Dependent child",
								prompt: "Dependent controlled child",
								dependencies: ["first"],
							},
						]
					: []),
			],
		},
		workflow: childRecipe.id,
		inputMapping: { prompt: "/prompt" },
		dependencies: "/dependencies",
		wait: false,
	},
	next,
});
const approvalView = {
	version: "view-v1",
	components: [
		markdown(
			"artifact",
			"Review the exact artifact and current child-run state. <img src=x onerror=alert(1)>",
		),
		{ id: "runs", type: "runList", data: { path: "/inputs/children" } },
		{
			id: "confirmation",
			type: "choices",
			data: {
				literal: {
					fields: [
						{
							id: "understood",
							label: "I checked the artifact",
							type: "checkbox",
							required: true,
						},
					],
				},
			},
		},
	],
};
const mainRecipe = {
	id: "f1-views-main",
	name: "Custom declarative human recipe",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		{
			...base,
			id: "collect",
			name: "Call reusable source",
			type: "workflow",
			workflow: sourceRecipe.id,
			inputMapping: {},
			next: "inspect-each",
		},
		{
			...base,
			id: "inspect-each",
			name: "Inspect every accepted item",
			type: "foreach",
			items: { from: "/collect/outputs/research/items" },
			itemId: "/id",
			concurrency: 2,
			maxItems: 10,
			failure: "all-must-succeed",
			body: [
				agent("detail", "item-display", "json-v1", { item: "@item" }),
				{
					...base,
					id: "item-display",
					name: "Per-item nonblocking display",
					type: "show",
					view: literalView(
						"This per-item Show does not stop For each progression.",
					),
					next: "end",
				},
			],
			next: "choose",
		},
		{
			...base,
			id: "choose",
			name: "Choose actions for each item",
			type: "decide",
			reads: {
				catalog: "collect/outputs/research",
				story: "collect/outputs/story",
				inspected: "inspect-each",
			},
			view: { from: "/inputs/story" },
			decide: {
				items: { path: "/inputs/catalog/items" },
				itemId: "/id",
				title: "/title",
				body: "/body",
				details: [{ label: "Impact", path: "/impact" }],
				actions: [
					{ id: "fix", label: "Fix", comment: true },
					{ id: "skip", label: "Skip", comment: true },
					{ id: "discuss", label: "Follow up", comment: true, followUp: true },
				],
				ask: {
					prompt:
						"Answer only the supplied item question from its accepted data. Do not rerun research or change files.",
				},
			},
			branches: [
				{ when: { path: "hasFollowUps", equals: true }, next: "follow-path" },
			],
			next: "no-follow-path",
		},
		{
			...base,
			id: "follow-path",
			name: "Configured follow-up route",
			type: "check",
			reads: { answer: "choose" },
			check: {
				results: {
					followed: { path: "/inputs/answer/hasFollowUps", equals: true },
					selected: { select: "/inputs/answer/itemsByAction/fix" },
				},
			},
			next: "dispatch",
		},
		{
			...base,
			id: "no-follow-path",
			name: "Configured no-follow-up route",
			type: "show",
			view: literalView("The ordinary no-follow-up route was selected."),
			next: "dispatch",
		},
		launch("dispatch", "approval"),
		{
			...base,
			id: "approval",
			name: "Approve the displayed artifact",
			type: "approve",
			reads: { children: "@childRuns" },
			view: approvalView,
			branches: [
				{
					when: { path: "approved", equals: false },
					next: "requested-changes",
				},
			],
			next: "approved-summary",
		},
		{
			...base,
			id: "requested-changes",
			name: "Requested changes retained",
			type: "show",
			reads: { decision: "approval" },
			view: literalView(
				"Request changes remains explicit feedback and follows the configured route.",
			),
			next: "end",
		},
		{
			...base,
			id: "approved-summary",
			name: "Approved summary",
			type: "show",
			view: literalView(
				"Explicit artifact approval reached the normal summary route.",
			),
			next: "tail",
		},
		{
			...base,
			id: "tail",
			name: "Show continued to the next ordinary block",
			type: "check",
			reads: { result: "approved-summary" },
			check: {
				results: { progressed: { path: "/inputs/result/shown", equals: true } },
			},
			next: "end",
		},
	],
};
const waveRecipe = {
	id: "f1-views-waves",
	name: "View actual dependency waves",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["ticket-assignment", "manual"],
	steps: [
		launch("launch", "show-waves", true),
		{
			...base,
			id: "show-waves",
			name: "Actual child waves and statuses",
			type: "show",
			reads: { children: "@childRuns" },
			view: {
				version: "view-v1",
				components: [
					{ id: "waves", type: "runList", data: { path: "/inputs/children" } },
				],
			},
			next: "after-display",
		},
		{
			...base,
			id: "after-display",
			name: "Nonblocking list continuation",
			type: "check",
			reads: { display: "show-waves" },
			check: {
				results: { shown: { path: "/inputs/display/shown", equals: true } },
			},
			next: "end",
		},
	],
};
const definitions = [sourceRecipe, childRecipe, mainRecipe, waveRecipe];
const tracker = createCLIIssueTracker();
const turns = [],
	http = [],
	sessions = [],
	results = [],
	pushEvents = [];
let worker, runtime;
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
				id: "views-fixture",
				name: "View F1 fixture",
				repositoryPath: repository,
				workspaceBaseDir: join(directory, "worktrees"),
				baseBranch: "main",
				githubUrl: "https://github.com/fixture/views",
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
						JSON.stringify({ title: "Views F1" }),
					).createAgentRunner(type, config);
				const context = loadFactoryContextSnapshot(connection.args.at(-1));
				const role = context.workflowExecution.currentStep.id;
				const run = [...runtime.runs.values()].find(
					(run) =>
						run.workspace === config.workingDirectory ||
						join(runtime.directory, "evidence", run.id) ===
							config.workingDirectory,
				);
				assert(
					run,
					"Every mocked role belongs to its actual isolated run workspace",
				);
				const turn = {
					runId: run.id,
					role,
					runner: type,
					model: config.model ?? null,
					resume: config.resumeSessionId ?? null,
					at: new Date().toISOString(),
				};
				turns.push(turn);
				record("mock-turn", turn);
				let output;
				if (role === "research") output = { items };
				else if (role === "story") output = authoredView;
				else if (role === "detail")
					output = { inspected: true, originalItemPreserved: true };
				else if (role === "view-follow-up")
					output =
						"The accepted cache item concerns preserving validated receipts. <script>inertAsk()</script> No research was rerun.";
				else
					throw new Error(
						`Unexpected role ${role}; no native provider fallback is allowed`,
					);
				const response =
					typeof output === "string" ? output : JSON.stringify(output);
				return f1AgentHandlers("mock", response).createAgentRunner(
					type,
					config,
				);
			},
		},
	});
	const nextRuntime = instance.getFactoryRuntime();
	nextRuntime.subscribe(({ id }) => {
		if (!id) return;
		const run = nextRuntime.runs.get(id),
			event = run && runPushEvent(run);
		if (event) pushEvents.push({ runId: id, ...event });
	});
	return { instance, instanceRuntime: nextRuntime };
}
async function rpc(method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${rpcPort}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
	});
	const body = await response.json();
	record("rpc", { method, params, status: response.status, body });
	assert(!body.error, JSON.stringify(body));
	return body.result;
}
async function api(path, body, expected = 200) {
	const response = await fetch(`${apiOrigin}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			Origin: apiOrigin,
			"Sec-Fetch-Site": "same-origin",
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json();
	const receipt = { path, request: body, status: response.status, body: value };
	http.push(receipt);
	record("api", receipt);
	assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
	return value;
}
async function until(check, label) {
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((done) => setTimeout(done, 20));
	}
	throw new Error(
		`${label}: ${JSON.stringify([...runtime.runs.values()].map(({ id, status, step, error }) => ({ id, status, step, error })))}`,
	);
}
const current = (id) => runtime.get(id);
async function startScenario(workflowId) {
	runtime.updateWorkflows(runtime.listWorkflows(), workflowId);
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title: workflowId,
		description:
			"Controlled generic declarative human workflow. No real tracker, provider calls, publication or deployment.",
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	sessions.push(session.sessionId);
	await until(
		() => runtime.runs.has(session.sessionId),
		"Accepted CLI workflow admission",
	);
	return { id: session.sessionId, issueId: issue.id };
}
async function comments(issueId) {
	return (await tracker.fetchComments(issueId, { first: 100 })).nodes.map(
		({ id, body, createdAt }) => ({ id, body, createdAt }),
	);
}
async function waitDecision(id, kind, step) {
	await until(
		() =>
			current(id).status === "waiting" &&
			current(id).viewDecision?.kind === kind &&
			!current(id).viewDecision.answer &&
			(!step || current(id).viewDecision.stepKey === step),
		`Waiting ${kind} ${step ?? ""}`,
	);
	return structuredClone(current(id).viewDecision);
}
async function restart() {
	await worker.stop();
	({ instance: worker, instanceRuntime: runtime } = newWorker());
	await worker.start();
	await rpc("ping");
	record("reconstructed", { runs: [...runtime.runs.keys()] });
}
async function completeChild(parentId) {
	const parent = current(parentId),
		batch = Object.values(parent.launchActions)[0];
	const childId = batch.accepted.items[0].runId;
	const child = await waitDecision(childId, "approve");
	const answer = {
		batchId: child.id,
		digest: child.digest,
		accepted: true,
		approved: true,
		feedback: "Explicit isolated child acceptance",
	};
	await api(`/api/runs/${childId}/view-answer`, answer, 200);
	await until(
		() =>
			current(childId).status === "completed" &&
			Object.values(current(parentId).launchActions)[0].progress.first
				.status === "completed",
		"Real child completion updates public run-list content",
	);
	assert.equal(
		current(childId).humanDecisions?.length ?? 0,
		0,
		"Generic approval grants no native delivery approval",
	);
	return childId;
}
async function refreshStaleApproval(id, stale) {
	await api(
		`/api/runs/${id}/view-answer`,
		{
			batchId: stale.id,
			digest: stale.digest,
			accepted: true,
			approved: true,
			fields: { understood: true },
		},
		409,
	);
	await until(
		() =>
			current(id).viewDecision?.id !== stale.id &&
			current(id).status === "waiting",
		"Changed displayed data creates a fresh decision batch",
	);
	const fresh = await waitDecision(id, "approve", "approval");
	assert.notEqual(fresh.digest, stale.digest);
	assert.equal(
		current(id).viewRecords.find((record) => record.snapshot.id === stale.id)
			.answer,
		undefined,
		"Stale data grants no acceptance",
	);
	return fresh;
}

try {
	({ instance: worker, instanceRuntime: runtime } = newWorker());
	runtime.updateWorkflows([...defaultWorkflows, ...definitions], mainRecipe.id);
	await worker.start();
	await rpc("ping");
	const config = await api("/api/config?view=recipes");
	assert(
		config.workflows.some((definition) => definition.id === mainRecipe.id),
		"Saved custom recipe is served from the real catalog",
	);
	const first = await startScenario(mainRecipe.id);
	let decide = await waitDecision(first.id, "decide", "choose");
	assert.equal(current(first.id).workflow.id, mainRecipe.id);
	assert.equal(
		decide.view.components.find((component) => component.id === "intro").data
			.text,
		authoredView.components[0].data.literal.text,
		"Library view-v1 output is resolved through configured Call bindings",
	);
	assert.equal(
		current(first.id).viewDisplays.length,
		2,
		"Show advanced both concurrent item bodies",
	);
	assert.equal(current(first.id).outputs["inspect-each"].summary.completed, 2);
	const originalTurns = turns.filter((turn) => turn.runId === first.id).length;
	await until(
		() =>
			current(first.id).ticketSync?.receipts.some(
				(receipt) => receipt.key === `view:${decide.id}` && receipt.delivered,
			),
		"Plain-text decision reaches configured ticket receiver",
	);
	const beforeComments = await comments(first.issueId);
	assert.equal(
		beforeComments.filter((comment) =>
			comment.body.includes(`Decision batch: ${decide.id}`),
		).length,
		1,
	);
	assert(
		beforeComments.some((comment) => comment.body.includes("&lt;script&gt;")),
		"Malicious view/item text is inert in ticket fallback",
	);
	assert(
		!beforeComments.some((comment) => /<script>|<img\s/i.test(comment.body)),
		"No executable HTML is inserted into ticket fallback",
	);
	const originalPush = runPushEvent(current(first.id));
	assert(originalPush && originalPush.category === "question");
	await restart();
	decide = await waitDecision(first.id, "decide", "choose");
	assert.equal(
		turns.filter((turn) => turn.runId === first.id).length,
		originalTurns,
		"Waiting reconstruction does not rerun completed source agents or items",
	);
	assert.equal(
		beforeComments.filter((comment) =>
			comment.body.includes(`Decision batch: ${decide.id}`),
		).length,
		1,
	);
	assert.equal(
		(await comments(first.issueId)).filter((comment) =>
			comment.body.includes(`Decision batch: ${decide.id}`),
		).length,
		1,
		"Restored batch notification is not duplicated",
	);
	assert.deepEqual(
		runPushEvent(current(first.id)),
		originalPush,
		"Restored wait has the original attention identity",
	);
	const focus = await api(`/api/runs/${first.id}?view=focus`);
	assert.equal(focus.viewDecision.digest, decide.digest);
	await api(
		`/api/runs/${first.id}/answer`,
		{ answer: "Approve everything" },
		409,
	);
	const askId = randomUUID();
	await api(`/api/runs/${first.id}/view-ask`, {
		batchId: decide.id,
		digest: decide.digest,
		itemId: "cache",
		question: "What does this retained item change?",
		requestId: askId,
	});
	await until(
		() =>
			current(first.id).viewDecision.threads?.cache?.[0]?.status === "answered",
		"Dedicated item Ask produces a retained answer",
	);
	const afterAsk = structuredClone(current(first.id).viewDecision);
	assert.notEqual(
		afterAsk.digest,
		decide.digest,
		"The exact displayed Ask content invalidates the old digest",
	);
	assert.equal(
		turns.filter(
			(turn) => turn.runId === first.id && turn.role === "view-follow-up",
		).length,
		1,
	);
	assert.equal(
		turns.filter(
			(turn) => turn.runId === first.id && turn.role !== "view-follow-up",
		).length,
		originalTurns,
		"Ask does not rerun research or item producers",
	);
	const choices = [
		{ itemId: "cache", action: "fix", comment: "Retain exact receipts" },
		{ itemId: "labels", action: "discuss", comment: "Follow up on wording" },
	];
	await api(
		`/api/runs/${first.id}/view-answer`,
		{
			batchId: decide.id,
			digest: decide.digest,
			accepted: true,
			choices,
			fields: { reason: "Explicit decisions" },
		},
		409,
	);
	const choiceRequest = {
		batchId: afterAsk.id,
		digest: afterAsk.digest,
		accepted: true,
		choices,
		fields: { reason: "Explicit decisions" },
	};
	await Promise.all([
		api(`/api/runs/${first.id}/view-answer`, choiceRequest, 200),
		api(`/api/runs/${first.id}/view-answer`, choiceRequest, 200),
	]);
	let approval = await waitDecision(first.id, "approve", "approval");
	assertJsonEqual(current(first.id).outputs.choose.choices, choices);
	assert.equal(current(first.id).outputs.choose.hasFollowUps, true);
	assertJsonEqual(current(first.id).outputs.choose.itemsByAction.fix, [
		items[0],
	]);
	assert.equal(current(first.id).outputs.choose.followUps.length, 1);
	assert.equal(current(first.id).outputs["follow-path"].followed, true);
	assert.equal(
		current(first.id).history.filter((entry) => entry.step === "choose").length,
		1,
		"Concurrent identical submissions create one accepted result receipt",
	);
	await api(
		`/api/runs/${first.id}/view-answer`,
		{
			...choiceRequest,
			choices: choices.map((choice) => ({ ...choice, action: "skip" })),
		},
		409,
	);
	const accepted = structuredClone(current(first.id).outputs.choose),
		originalApprovalId = approval.id;
	await restart();
	approval = await waitDecision(first.id, "approve", "approval");
	assert.equal(approval.id, originalApprovalId);
	assertJsonEqual(
		current(first.id).outputs.choose,
		accepted,
		"Accepted choices survive ordinary persisted reconstruction",
	);
	const childId = await completeChild(first.id);
	approval = await refreshStaleApproval(first.id, approval);
	const finalRequest = {
		batchId: approval.id,
		digest: approval.digest,
		accepted: true,
		approved: true,
		feedback: "Explicit acceptance of the current displayed artifact",
		fields: { understood: true },
	};
	await rpc("promptSession", {
		sessionId: first.id,
		message: `/view-answer ${JSON.stringify(finalRequest)}`,
	});
	await until(
		() => current(first.id).status === "completed",
		"Explicit ticket reply acceptance follows the normal approval route",
	);
	assert.equal(current(first.id).outputs.approval.approved, true);
	assert.equal(
		current(first.id).outputs.tail.progressed,
		true,
		"Show does not block ordinary progression",
	);
	assert.equal(
		current(first.id).humanDecisions?.length ?? 0,
		0,
		"Generic output cannot authorize native merge/recovery",
	);
	assert.equal(current(first.id).architectureDecisions?.length ?? 0, 0);
	assertJsonEqual(current(first.id).outputs.choose, accepted);
	await api(`/api/runs/${first.id}/view-answer`, finalRequest, 200);
	const lastPreview = await api("/api/recipes/view-preview", {
		workflowId: mainRecipe.id,
		stepId: "choose",
		view: mainRecipe.steps[2].view,
		decide: mainRecipe.steps[2].decide,
		reads: mainRecipe.steps[2].reads,
		lastRun: true,
	});
	assert.equal(lastPreview.provenance.kind, "last-run");
	assert.equal(lastPreview.provenance.runId, first.id);
	assert(lastPreview.paths.includes("/inputs/catalog/items/0/id"));
	assert.equal(lastPreview.scope.factoryHome, undefined);
	assert.equal(lastPreview.scope.checkpoint, undefined);
	results.push({
		scenario: "composed-decide-ask-approve-restart",
		runId: first.id,
		childId,
		choiceRequest,
		acceptedChoices: accepted,
		finalApprovalRequest: finalRequest,
		originalApprovalId,
		staleBatchRejected: true,
		exactDisplayedAskDigest: afterAsk.digest,
		parentCompleted: true,
		originalSourceTurns: originalTurns,
		sourceReruns: 0,
		duplicateResultReceipts: 0,
		restoredBatchNotificationCount: 1,
		lastRunPreview: lastPreview.provenance,
	});

	const second = await startScenario(mainRecipe.id);
	const skip = await waitDecision(second.id, "decide", "choose");
	await api(
		`/api/runs/${second.id}/view-answer`,
		{
			batchId: skip.id,
			digest: skip.digest,
			accepted: true,
			choices: items.map((item) => ({ itemId: item.id, action: "skip" })),
			fields: { reason: "No follow-ups selected" },
		},
		200,
	);
	let changes = await waitDecision(second.id, "approve", "approval");
	assert.equal(current(second.id).outputs.choose.hasFollowUps, false);
	assert(
		current(second.id).viewDisplays.some(
			(display) => display.stepKey === "no-follow-path",
		),
	);
	await completeChild(second.id);
	changes = await refreshStaleApproval(second.id, changes);
	const feedback =
		"Change the proposed wording before any later implementation.";
	await api(
		`/api/runs/${second.id}/view-answer`,
		{
			batchId: changes.id,
			digest: changes.digest,
			accepted: true,
			approved: false,
			feedback,
			fields: { understood: true },
		},
		200,
	);
	await until(
		() => current(second.id).status === "completed",
		"Request changes follows its configured feedback route",
	);
	assert.equal(current(second.id).outputs.approval.approved, false);
	assert.equal(current(second.id).outputs.approval.feedback, feedback);
	assert.equal(current(second.id).outputs["approved-summary"], undefined);
	assert.equal(current(second.id).outputs["requested-changes"].shown, true);
	results.push({
		scenario: "no-followups-request-changes",
		runId: second.id,
		feedback,
		approved: false,
		correctRoute: true,
	});

	const waves = await startScenario(waveRecipe.id);
	await until(
		() =>
			current(waves.id).checkpoint?.current === "end" &&
			current(waves.id).viewDisplays?.length === 1,
		"Run-list Show immediately advances its ordinary successor",
	);
	const waveRun = current(waves.id),
		batch = Object.values(waveRun.launchActions)[0],
		shown = structuredClone(waveRun.viewDisplays[0]);
	assert.equal(waveRun.outputs["after-display"].shown, true);
	assert.equal(shown.view.components[0].type, "runList");
	assert.deepEqual(
		shown.view.components[0].data.waves.map((wave) =>
			wave.runs.map((run) => run.id),
		),
		[[batch.accepted.items[0].runId], [batch.accepted.items[1].runId]],
	);
	assert.equal(shown.view.components[0].data.waves[1].runs[0].status, "queued");
	assert.equal(
		runtime.runs.has(batch.accepted.items[1].runId),
		false,
		"Dependency view does not grant launch/merge authority",
	);
	assert(!JSON.stringify(shown).includes("executionSnapshot"));
	assert(!JSON.stringify(shown).includes("repositoryPath"));
	await api(
		`/api/runs/${waves.id}/stop-batch`,
		{ actionId: batch.accepted.actionId },
		200,
	);
	await until(
		() => !runtime.isExecuting(batch.accepted.items[0].runId),
		"Explicit batch stop drains the actual child",
	);
	assertJsonEqual(
		current(waves.id).viewDisplays[0],
		shown,
		"Operational status changes do not rewrite accepted Show receipts",
	);
	results.push({
		scenario: "actual-run-list-waves",
		runId: waves.id,
		shown,
		dependencyUnlaunched: true,
		explicitStopCompleted: true,
	});

	const activities = await rpc("viewSession", { sessionId: first.id });
	assert(activities.activities.length > 0);
	for (const activity of activities.activities) {
		assert(activity.type && typeof activity.content === "string");
		assert(Number.isFinite(new Date(activity.createdAt).getTime()));
	}
	const page = await rpc("viewSession", {
		sessionId: first.id,
		limit: 1,
		offset: 0,
	});
	assert.equal(page.activities.length, 1);
	assert.equal(page.totalCount, activities.totalCount);
	for (const session of [first, second, waves])
		writeFileSync(
			join(directory, `${session.id}-comments.json`),
			JSON.stringify(await comments(session.issueId), null, 2),
		);
	writeFileSync(
		join(directory, "mock-invocations.json"),
		JSON.stringify(turns, null, 2),
	);
	writeFileSync(
		join(directory, "push-events.json"),
		JSON.stringify(pushEvents, null, 2),
	);
	writeFileSync(
		join(directory, "activities.json"),
		JSON.stringify(activities, null, 2),
	);
	assert.deepEqual(
		backendSourceManifest(),
		sourceFiles,
		"Every executed backend source input remained unchanged during the drive",
	);
	assert.equal(
		sha256(readFileSync(join(root, driver))),
		identity.driverSha256,
		"The executed driver remained unchanged during the drive",
	);
	assert.equal(
		buildIdentity(),
		identity.buildSha256,
		"Executed compiled build remained unchanged",
	);
	const receipt = {
		result: "PASS",
		directory,
		startedAt,
		endedAt: new Date().toISOString(),
		paidCalls: 0,
		...identity,
		repositoryDeltaAfter: sourceDelta(),
		results,
		mockTurns: turns.length,
		activityCount: activities.totalCount,
		httpRequests: http.length,
		nativeModelsExercised: false,
		livePushDeliveryExercised: false,
		nativeMergeApprovalsProduced: 0,
	};
	writeFileSync(
		join(directory, "results.json"),
		JSON.stringify(receipt, null, 2),
	);
	console.log(JSON.stringify(receipt));
} catch (error) {
	const failure = {
		result: "FAIL",
		directory,
		...identity,
		error: error.stack ?? String(error),
		runs: runtime
			? [...runtime.runs.values()].map(({ id, status, step, error }) => ({
					id,
					status,
					step,
					error,
				}))
			: [],
		turns,
	};
	writeFileSync(
		join(directory, "failure.json"),
		JSON.stringify(failure, null, 2),
	);
	record("failure", failure);
	console.error(JSON.stringify(failure));
	throw error;
} finally {
	if (worker) await worker.stop();
	record("cleanup", { ownedWorkerStopped: true, retainedDirectory: directory });
}
