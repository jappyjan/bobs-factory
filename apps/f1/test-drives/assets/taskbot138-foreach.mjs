// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot138-foreach.mjs
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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const driver = "apps/f1/test-drives/assets/taskbot138-foreach.mjs";
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-taskbot138-foreach-")),
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
writeFileSync(join(repository, "README.md"), "# For each controlled fixture\n");
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

const items = [
	{ id: "alpha", name: "Alpha" },
	{ id: "beta", name: "Beta" },
	{ id: "gamma", name: "Gamma" },
];
const failingItems = [
	{ id: "good", name: "Good" },
	{ id: "bad", name: "Bad" },
	{ id: "later", name: "Later" },
];
const regions = [
	{
		id: "north",
		name: "North",
		assignments: [
			{ id: "a1", name: "North first" },
			{ id: "a2", name: "North second" },
		],
	},
	{
		id: "south",
		name: "South",
		assignments: [{ id: "b1", name: "South only" }],
	},
];
const agent = (id, reads = {}, next = "end") => ({
	id,
	name: id,
	type: "agent",
	prompt: "Return the deterministic fixture JSON without changing files.",
	reads,
	output: { format: "json-v1" },
	next,
});
const check = (expectedCompleted, expectedFailed = 0) => ({
	id: "verify",
	name: "Verify keyed results and failure summary",
	type: "check",
	reads: { batch: "batch" },
	check: {
		results: {
			completed: {
				path: "/inputs/batch/summary/completed",
				equals: expectedCompleted,
			},
			failed: { path: "/inputs/batch/summary/failed", equals: expectedFailed },
			results: { select: "/inputs/batch/results" },
		},
		passed: {
			all: [
				{ path: "/results/completed", equals: true },
				{ path: "/results/failed", equals: true },
			],
		},
	},
	next: "end",
});
const definition = (id, steps, internal = false) => ({
	id,
	name: `F1 ${id}`,
	stepConfigVersion: "step-config-v1",
	steps,
	...(internal
		? { internal, allowedTriggers: ["workflow"] }
		: { allowedTriggers: ["manual", "ticket-assignment"] }),
});
const loop = (settings) => ({
	id: "batch",
	name: "For each fixture item",
	type: "foreach",
	concurrency: 2,
	maxItems: 10,
	itemId: "/id",
	body: [agent("inspect", { current: "@item", position: "@index" })],
	next: "verify",
	...settings,
});
const definitions = [
	definition("f1-foreach-output", [
		agent("source", {}, "batch"),
		loop({ items: { from: "/source/items" } }),
		check(3),
	]),
	definition("f1-foreach-inline", [
		loop({ items: { values: items } }),
		check(3),
	]),
	definition("f1-foreach-call-nested", [
		loop({
			items: { values: regions },
			body: [
				{
					id: "call",
					name: "Call nested assignment recipe",
					type: "workflow",
					workflow: "f1-assignment-child",
					inputMapping: { topic: "/item/name", owner: "/item/id" },
					next: "end",
				},
			],
		}),
		check(2),
	]),
	definition(
		"f1-assignment-child",
		[
			agent(
				"owner",
				{
					topic: "@callInputs/topic",
					owner: "@callInputs/owner",
					current: "@item",
					position: "@index",
				},
				"assignments",
			),
			{
				...loop({
					items: { from: "/item/assignments" },
					body: [
						agent("inspect", {
							current: "@item",
							position: "@index",
							owner: "@callInputs/owner",
						}),
					],
					next: "end",
				}),
				id: "assignments",
			},
		],
		true,
	),
	...["all-must-succeed", "keep-successful"].map((failure) =>
		definition(`f1-foreach-${failure}`, [
			loop({ items: { values: failingItems }, failure, concurrency: 1 }),
			check(2, 1),
		]),
	),
	definition("f1-foreach-missing-path", [
		agent("source", {}, "batch"),
		loop({ items: { from: "/source/missing" } }),
		check(0),
	]),
];
const tracker = createCLIIssueTracker(),
	turns = [],
	sessions = [],
	results = [];
let runtime,
	active = 0,
	maxActive = 0;
const worker = new EdgeWorker({
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
			id: "foreach-fixture",
			name: "For each F1 fixture",
			repositoryPath: repository,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: "https://github.com/fixture/foreach",
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
					JSON.stringify({ title: "For each F1" }),
				).createAgentRunner(type, config);
			const snapshot = loadFactoryContextSnapshot(connection.args.at(-1));
			const run = [...runtime.runs.values()].find(
				(run) =>
					run.status === "running" && run.workspace === config.workingDirectory,
			);
			assert(
				run,
				"Each mock provider belongs to the actual active Factory run",
			);
			const { key, id } = snapshot.workflowExecution.currentStep;
			const turn = {
				run: run.id,
				workflow: run.workflow.id,
				key,
				id,
				item: snapshot.item,
				index: snapshot.index,
				current: snapshot.current,
				position: snapshot.position,
				owner: snapshot.owner,
				topic: snapshot.topic,
				resumeSessionId: config.resumeSessionId ?? null,
			};
			turns.push(turn);
			if (id !== "source") {
				assert.equal(
					snapshot.item.id,
					snapshot.current.id,
					"Named @item read follows the lexical frame",
				);
				assert.equal(
					snapshot.index,
					snapshot.position,
					"Named @index read follows the lexical frame",
				);
				assert(
					key.includes(`/${snapshot.item.id}/`),
					"Native role identity retains the item ID",
				);
			}
			const response =
				id === "source"
					? { items }
					: {
							id: snapshot.item.id,
							index: snapshot.index,
							name: snapshot.item.name,
							...(snapshot.owner ? { owner: snapshot.owner } : {}),
							...(snapshot.topic ? { topic: snapshot.topic } : {}),
						};
			if (id === "owner") {
				assert.equal(snapshot.topic, snapshot.item.name);
				assert.equal(snapshot.owner, snapshot.item.id);
			}
			if (id === "inspect" && run.workflow.id === "f1-foreach-call-nested")
				assert.equal(
					snapshot.owner,
					key.split("/")[1],
					"Call inputs retain the outer item while nested /item changes",
				);
			const runner = f1AgentHandlers(
				"mock",
				JSON.stringify(response),
			).createAgentRunner(type, config);
			const start = runner.start.bind(runner);
			runner.start = async (prompt) => {
				active++;
				maxActive = Math.max(maxActive, active);
				assert(
					active <= 2,
					"Actual MachineCapacity caps native provider starts",
				);
				try {
					await new Promise((resolve) => setTimeout(resolve, 25));
					if (snapshot.item?.id === "bad")
						throw new Error("Controlled F1 provider failure for bad");
					const result = await start(prompt);
					turn.sessionId = result.sessionId;
					return result;
				} finally {
					active--;
				}
			};
			return runner;
		},
	},
});
runtime = worker.getFactoryRuntime();
async function rpc(method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${rpcPort}/cli/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const payload = await response.json();
	assert(!payload.error, JSON.stringify(payload));
	return payload.result;
}
async function until(check, message) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(
		`${message}: ${JSON.stringify([...runtime.runs.values()].map(({ id, status, step, error }) => ({ id, status, step, error })))}`,
	);
}
try {
	runtime.updateWorkflows(
		[...defaultWorkflows, ...definitions],
		"f1-foreach-output",
	);
	await worker.start();
	await rpc("ping");
	for (const workflow of definitions.filter((workflow) => !workflow.internal)) {
		runtime.updateWorkflows(runtime.listWorkflows(), workflow.id);
		const { issue } = await rpc("createIssue", {
			teamId: "team-default",
			title: workflow.name,
			description:
				"Run the deterministic For each orchestration fixture without changing repository files.",
		});
		const { session } = await rpc("startSession", { issueId: issue.id });
		sessions.push(session.sessionId);
		await until(
			() =>
				["completed", "failed"].includes(
					runtime.runs.get(session.sessionId)?.status,
				),
			`Scenario ${workflow.id} did not settle`,
		);
		const run = runtime.get(session.sessionId),
			actualTurns = turns.filter((turn) => turn.run === run.id);
		assert.equal(
			new Set(actualTurns.map((turn) => turn.key)).size,
			actualTurns.length,
			"Each item leaf is invoked once during this fresh drive",
		);
		const shouldFail =
			workflow.id.endsWith("all-must-succeed") ||
			workflow.id.endsWith("missing-path");
		assert.equal(
			run.status,
			shouldFail ? "failed" : "completed",
			`${workflow.id}: ${run.error}`,
		);
		const progress = run.foreach?.batch;
		if (shouldFail) {
			assert.equal(
				run.outputs.verify,
				undefined,
				"A failed loop never reaches the downstream Check",
			);
			if (workflow.id.endsWith("missing-path")) {
				assert.match(run.error, /does not resolve/);
				assert.deepEqual(
					actualTurns.map((turn) => turn.id),
					["source"],
				);
			} else {
				assert.match(run.error, /bad.*Controlled F1 provider failure/);
				assert.deepEqual(
					actualTurns.map((turn) => turn.item.id),
					["good", "bad"],
				);
				assert.deepEqual(
					progress.items.map(({ id, status }) => ({ id, status })),
					[
						{ id: "good", status: "completed" },
						{ id: "bad", status: "failed" },
						{ id: "later", status: "cancelled" },
					],
				);
			}
		} else {
			assert.equal(run.outputs.verify.passed, true);
			assert.deepEqual(
				JSON.parse(JSON.stringify(run.outputs.verify.results)),
				JSON.parse(JSON.stringify(run.outputs.batch.results)),
				"Check consumes the complete keyed result via named reads",
			);
			if (workflow.id.endsWith("keep-successful")) {
				assert.deepEqual(Object.keys(run.outputs.batch.results), [
					"good",
					"later",
				]);
				assert.equal(run.outputs.batch.summary.failed, 1);
				assert.equal(run.outputs.batch.summary.cancelled, 0);
				assert.equal(run.outputs.batch.summary.failures[0].id, "bad");
				assert.equal(run.outputs.batch.summary.limitations.length, 1);
			} else if (workflow.id.endsWith("call-nested")) {
				for (const [index, region] of regions.entries()) {
					const child = run.outputs.batch.results[region.id].call;
					assert.equal(child.workflow, "f1-assignment-child");
					assert.equal(child.completed, true);
					assert.deepEqual(JSON.parse(JSON.stringify(child.outputs.owner)), {
						id: region.id,
						index,
						name: region.name,
						owner: region.id,
						topic: region.name,
					});
					for (const [innerIndex, assignment] of region.assignments.entries())
						assert.deepEqual(
							JSON.parse(
								JSON.stringify(
									child.outputs.assignments.results[assignment.id].inspect,
								),
							),
							{
								id: assignment.id,
								index: innerIndex,
								name: assignment.name,
								owner: region.id,
							},
						);
				}
				assert.equal(actualTurns.length, 5);
			} else {
				assert.deepEqual(
					Object.keys(run.outputs.batch.results),
					items.map(({ id }) => id),
				);
				for (const [index, item] of items.entries())
					assert.deepEqual(
						JSON.parse(
							JSON.stringify(run.outputs.batch.results[item.id].inspect),
						),
						{ ...item, index },
					);
			}
			assert(
				actualTurns
					.filter((turn) => turn.item?.id !== "bad")
					.every((turn) => turn.sessionId && turn.resumeSessionId === null),
				"This fresh run records real mock SDK identities, with no invented continuation",
			);
		}
		const timeline = await rpc("viewSession", {
			sessionId: run.id,
			limit: 1000,
			offset: 0,
		});
		assert(timeline.totalCount > 0);
		assert(
			timeline.activities.every(
				(activity) => activity.content && activity.createdAt,
			),
		);
		const page = await rpc("viewSession", {
			sessionId: run.id,
			limit: 1,
			offset: 0,
		});
		assert.equal(page.activities.length, 1);
		assert.equal(page.hasMore, timeline.totalCount > 1);
		await worker.getTicketTracking().flush(run);
		const comments = await tracker.fetchComments(issue.id);
		assert(
			comments.nodes.length > 0,
			"Milestone/completion information reaches the CLI tracker",
		);
		const evidence = {
			workflow: workflow.id,
			run: run.id,
			status: run.status,
			error: run.error,
			outputs: run.outputs,
			foreach: run.foreach,
			turns: actualTurns,
			history: run.history,
			activityCount: timeline.totalCount,
			activityTypes: [
				...new Set(timeline.activities.map((activity) => activity.type)),
			],
			commentCount: comments.nodes.length,
		};
		writeFileSync(
			join(directory, `${workflow.id}.json`),
			JSON.stringify(evidence, null, 2),
		);
		results.push(evidence);
		console.log(
			JSON.stringify({
				phase: "scenario",
				workflow: workflow.id,
				status: run.status,
				turns: actualTurns.length,
				activityCount: timeline.totalCount,
			}),
		);
	}
	assert(
		maxActive >= 2,
		"The controlled scenario exercises concurrent provider starts",
	);
	assert.equal(
		buildIdentity(),
		identity.buildSha256,
		"Executed JavaScript stays unchanged throughout the drive",
	);
	assert.equal(
		sourceDelta(),
		identity.deltaSha256,
		"Source inputs stay unchanged throughout the drive",
	);
	writeFileSync(
		join(directory, "results-index.json"),
		JSON.stringify(
			{
				result: "PASS",
				...identity,
				directory,
				startedAt,
				endedAt: new Date().toISOString(),
				paidCalls: 0,
				maxActive,
				results,
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			directory,
			scenarios: results.length,
			turns: turns.length,
			maxActive,
			...identity,
		}),
	);
} catch (error) {
	writeFileSync(
		join(directory, "failed-results.json"),
		JSON.stringify(
			{
				result: "FAIL",
				...identity,
				directory,
				startedAt,
				endedAt: new Date().toISOString(),
				error: String(error),
				results,
				turns,
				runs: [...runtime.runs.values()].map(
					({ id, status, step, error, foreach, outputs }) => ({
						id,
						status,
						step,
						error,
						foreach,
						outputs,
					}),
				),
			},
			null,
			2,
		),
	);
	console.error(
		JSON.stringify({ result: "FAIL", directory, error: String(error) }),
	);
	throw error;
} finally {
	for (const sessionId of sessions)
		try {
			await rpc("stopSession", { sessionId });
		} catch {
			runtime.stop(sessionId);
		}
	await worker.stop();
}
