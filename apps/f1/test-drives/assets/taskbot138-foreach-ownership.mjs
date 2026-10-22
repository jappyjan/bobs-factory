// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot138-foreach-ownership.mjs
// Actual EdgeWorker/CLI: inherited reads must never become child-produced receipts.
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
	"No live provider is permitted",
);
assert.match(process.version, /^v24\./);
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const root = process.cwd();
const driver = "apps/f1/test-drives/assets/taskbot138-foreach-ownership.mjs";
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-taskbot138-ownership-")),
);
const home = join(directory, "home"),
	repository = join(directory, "repo");
mkdirSync(home);
mkdirSync(repository);
const startedAt = new Date().toISOString();
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
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
	return hash
		.update("apps/f1/dist/src/MockAgentRunner.js\0")
		.update(readFileSync(join(root, "apps/f1/dist/src/MockAgentRunner.js")))
		.update("\0")
		.digest("hex");
}
const identity = {
	revision: git(root, "rev-parse", "HEAD"),
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
git(directory, "init", "--bare", "-q", join(directory, "origin.git"));
git(repository, "init", "-q", "-b", "main");
git(repository, "config", "user.name", "F1 fixture");
git(repository, "config", "user.email", "fixture@example.invalid");
git(repository, "config", "commit.gpgsign", "false");
writeFileSync(
	join(repository, "README.md"),
	"# Disposable frame ownership fixture\n",
);
writeFileSync(
	join(repository, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\nAGENTS.md\nCLAUDE.md\n",
);
git(repository, "add", ".");
git(repository, "commit", "-qm", "Ownership fixture baseline");
git(repository, "remote", "add", "origin", join(directory, "origin.git"));
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
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);

const outer = { approved: true, authority: "outer-only" };
const items = [{ id: "a" }, { id: "b" }];
const agent = (id, reads = {}, next = "end") => ({
	id,
	name: id,
	type: "agent",
	prompt: "Return the controlled JSON without changing files.",
	reads,
	output: { format: "json-v1" },
	next,
});
// The same authored `skipped` ID exists in both frames; the child one is unreachable.
const body = (mapped = false) => [
	agent("route", {
		ancestor: "skipped",
		...(mapped ? { mappedOuter: "@callInputs/mappedOuter" } : {}),
		current: "@item",
		position: "@index",
	}),
	agent("skipped"),
];
const each = (mapped = false, next = "end") => ({
	id: "each",
	name: "For each ownership fixture",
	type: "foreach",
	items: { values: items },
	concurrency: 2,
	body: body(mapped),
	next,
});
const definition = (id, steps, internal = false) => ({
	id,
	name: id,
	stepConfigVersion: "step-config-v1",
	steps,
	allowedTriggers: internal ? ["workflow"] : ["manual", "ticket-assignment"],
	...(internal ? { internal } : {}),
});
const decision = (source, path) => [
	{
		id: "verify",
		name: "Deny inherited child authority",
		type: "check",
		reads: { children: source },
		check: {
			results: { childApproved: { path, equals: true } },
			passed: { path: "/results/childApproved", equals: true },
		},
		branches: [{ when: { path: "passed", equals: true }, next: "approve" }],
		next: "deny",
	},
	{
		id: "deny",
		name: "Record the ordinary denied route",
		type: "check",
		reads: { decision: "verify" },
		check: {
			results: { denied: { path: "/inputs/decision/passed", equals: false } },
			passed: { path: "/results/denied", equals: true },
		},
		next: "end",
	},
	agent("approve"),
];
const mappedCall = (workflow) => ({
	id: "call",
	name: "Call ownership fixture",
	type: "workflow",
	workflow,
	inputMapping: { mappedOuter: "/skipped" },
	next: "verify",
});
const definitions = [
	definition("f1-ownership-inline", [
		agent("skipped", {}, "each"),
		each(false, "verify"),
		...decision("each", "/inputs/children/results/a/skipped/approved"),
	]),
	definition("f1-ownership-call", [
		agent("skipped", {}, "call"),
		mappedCall("f1-ownership-child"),
		...decision("call", "/inputs/children/outputs/skipped/approved"),
	]),
	definition("f1-ownership-call-nested", [
		agent("skipped", {}, "call"),
		mappedCall("f1-ownership-nested-child"),
		...decision(
			"call",
			"/inputs/children/outputs/each/results/a/skipped/approved",
		),
	]),
	definition("f1-ownership-child", body(true), true),
	definition("f1-ownership-nested-child", [each(true), agent("skipped")], true),
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
			id: "ownership-fixture",
			name: "Ownership F1 fixture",
			repositoryPath: repository,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: "https://github.com/fixture/ownership",
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
					JSON.stringify({ title: "Ownership F1" }),
				).createAgentRunner(type, config);
			const snapshot = loadFactoryContextSnapshot(connection.args.at(-1));
			const run = [...runtime.runs.values()].find(
				(run) =>
					run.status === "running" && run.workspace === config.workingDirectory,
			);
			assert(run, "Native turn belongs to the active fixture run");
			const { key, id } = snapshot.workflowExecution.currentStep;
			let response;
			if (key === "skipped") response = outer;
			else {
				assert.equal(
					id,
					"route",
					"Neither a skipped child nor approval role may execute",
				);
				assert.deepEqual(
					JSON.parse(JSON.stringify(snapshot.ancestor)),
					outer,
					"Inherited ordinary output remains readable",
				);
				if (run.workflow.id !== "f1-ownership-inline")
					assert.deepEqual(
						JSON.parse(JSON.stringify(snapshot.mappedOuter)),
						outer,
						"Call mapping retains ordinary inherited read authority",
					);
				if (snapshot.item) {
					assert.equal(snapshot.current.id, snapshot.item.id);
					assert.equal(snapshot.position, snapshot.index);
				}
				response = {
					routed: true,
					authority: "child-produced",
					inheritedAuthority: snapshot.ancestor.authority,
					frame: key,
					...(snapshot.item
						? { item: snapshot.item.id, index: snapshot.index }
						: {}),
				};
			}
			const turn = {
				run: run.id,
				workflow: run.workflow.id,
				key,
				id,
				response: structuredClone(response),
				ancestor: snapshot.ancestor,
				mappedOuter: snapshot.mappedOuter,
				item: snapshot.item,
				index: snapshot.index,
				resumeSessionId: config.resumeSessionId ?? null,
			};
			turns.push(turn);
			const runner = f1AgentHandlers(
					"mock",
					JSON.stringify(response),
				).createAgentRunner(type, config),
				start = runner.start.bind(runner);
			runner.start = async (prompt) => {
				active++;
				maxActive = Math.max(maxActive, active);
				try {
					assert(active <= 2);
					await new Promise((done) => setTimeout(done, 25));
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
	const end = Date.now() + 90_000;
	while (Date.now() < end) {
		if (check()) return;
		await new Promise((done) => setTimeout(done, 25));
	}
	throw new Error(
		`${message}: ${JSON.stringify([...runtime.runs.values()].map(({ id, status, step, error }) => ({ id, status, step, error })))}`,
	);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
try {
	runtime.updateWorkflows(
		[...defaultWorkflows, ...definitions],
		"f1-ownership-inline",
	);
	await worker.start();
	await rpc("ping");
	for (const workflow of definitions.filter((workflow) => !workflow.internal)) {
		runtime.updateWorkflows(runtime.listWorkflows(), workflow.id);
		const { issue } = await rpc("createIssue", {
			teamId: "team-default",
			title: workflow.name,
			description:
				"Keep inherited read context separate from child-produced output authority.",
		});
		const { session } = await rpc("startSession", { issueId: issue.id });
		sessions.push(session.sessionId);
		await until(
			() =>
				["completed", "failed"].includes(
					runtime.runs.get(session.sessionId)?.status,
				),
			workflow.id,
		);
		const run = runtime.get(session.sessionId),
			actual = turns.filter((turn) => turn.run === run.id);
		assert.equal(run.status, "completed", run.error);
		const nested = workflow.id.endsWith("call-nested"),
			inline = workflow.id.endsWith("inline");
		const keys = inline
			? ["skipped", "each/a/route", "each/b/route"]
			: nested
				? ["skipped", "call/each/a/route", "call/each/b/route"]
				: ["skipped", "call/route"];
		assert.deepEqual(
			actual.map((turn) => turn.key).sort(),
			[...keys].sort(),
			"Exactly the configured producer turns execute once",
		);
		assert.equal(
			actual[0].key,
			"skipped",
			"Original outer receipt precedes child work",
		);
		assert(
			actual.every((turn) => turn.sessionId && turn.resumeSessionId === null),
		);
		assert.deepEqual(
			plain(run.outputs.skipped),
			outer,
			"Original outer output is retained exactly",
		);
		assert.deepEqual(
			plain(run.history.find((entry) => entry.step === "skipped").output),
			outer,
			"Original immutable receipt is retained exactly",
		);
		const called = inline ? undefined : run.outputs.call;
		if (called) {
			assert.equal(called.completed, true);
			assert.equal(
				called.workflow,
				nested ? "f1-ownership-nested-child" : "f1-ownership-child",
			);
			assert.deepEqual(
				Object.keys(called.outputs),
				nested ? ["each"] : ["route"],
				"Call outputs contain only its frame's produced receipts",
			);
			assert(
				!Object.hasOwn(called.outputs, "skipped"),
				"Skipped child cannot borrow inherited authority",
			);
		}
		if (inline || nested) {
			const loop = inline ? run.outputs.each : called.outputs.each;
			assert.deepEqual(plain(loop.summary), {
				total: 2,
				completed: 2,
				failed: 0,
				cancelled: 0,
				failures: [],
				limitations: [],
			});
			assert.deepEqual(Object.keys(loop.results), ["a", "b"]);
			for (const item of items) {
				assert.deepEqual(
					Object.keys(loop.results[item.id]),
					["route"],
					"Each item publishes only its own executed steps",
				);
				assert(!Object.hasOwn(loop.results[item.id], "skipped"));
				const expected = actual.find(
					(turn) =>
						turn.key === `${nested ? "call/" : ""}each/${item.id}/route`,
				).response;
				assert.deepEqual(
					plain(loop.results[item.id].route),
					expected,
					"Legitimate executed child output remains complete",
				);
			}
		} else
			assert.deepEqual(
				plain(called.outputs.route),
				actual.find((turn) => turn.key === "call/route").response,
			);
		assert.deepEqual(
			plain(run.outputs.verify),
			{ passed: false, childApproved: false },
			"Downstream Check cannot approve unproduced child evidence",
		);
		assert.deepEqual(
			plain(run.outputs.deny),
			{ passed: true, denied: true },
			"Declared denial route executes",
		);
		assert(!Object.hasOwn(run.outputs, "approve"));
		const history = run.history.map((entry) => entry.step);
		const expectedHistory = [
			...keys,
			...(nested ? ["call/each", "call"] : inline ? ["each"] : ["call"]),
			"verify",
			"deny",
		];
		assert.deepEqual(
			[...history].sort(),
			[...expectedHistory].sort(),
			"History contains only the original receipt and actual exact-frame producers/decisions",
		);
		assert.deepEqual(history.slice(-2), ["verify", "deny"]);
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
		await worker.getTicketTracking().flush(run);
		const comments = await tracker.fetchComments(issue.id);
		const result = {
			workflow: workflow.id,
			run: run.id,
			status: run.status,
			outputs: run.outputs,
			history: run.history,
			foreach: run.foreach,
			turns: actual,
			activityCount: timeline.totalCount,
			commentCount: comments.nodes.length,
		};
		results.push(result);
		writeFileSync(
			join(directory, `${workflow.id}.json`),
			JSON.stringify(result, null, 2),
		);
		console.log(
			JSON.stringify({
				phase: "scenario",
				workflow: workflow.id,
				status: run.status,
				turns: actual.length,
				downstreamPassed: run.outputs.verify.passed,
				denied: run.outputs.deny.denied,
			}),
		);
	}
	assert.equal(active, 0);
	assert(maxActive >= 1 && maxActive <= 2);
	assert.equal(
		sourceDelta(),
		identity.deltaSha256,
		"Source delta remains unchanged",
	);
	assert.equal(
		buildIdentity(),
		identity.buildSha256,
		"Executed built JavaScript remains unchanged",
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
				turns,
				results,
				runs: [...runtime.runs.values()].map(
					({ id, status, error, outputs, history }) => ({
						id,
						status,
						error,
						outputs,
						history,
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
