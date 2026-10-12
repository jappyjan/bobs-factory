import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
	AgentSessionStatus,
	type CyrusAgentSessionEntry,
	type EdgeWorkerConfig,
	immutableJson,
	PersistenceManager,
} from "bobs-factory-core";
import type { AgentSessionManager } from "../../../../packages/edge-worker/src/AgentSessionManager.ts";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync(join(tmpdir(), "f1-persistence-responsiveness-"));
const home = join(root, "home"),
	repo = join(root, "repo"),
	origin = join(root, "origin.git");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git("init", "--bare", origin);
git("init", "-b", "main");
writeFileSync(join(repo, "README.md"), "Isolated persistence fixture\n");
git("add", ".");
git(
	"-c",
	"user.name=F1",
	"-c",
	"user.email=f1@example.test",
	"-c",
	"commit.gpgsign=false",
	"commit",
	"-m",
	"fixture",
);
git("remote", "add", "origin", origin);
git("push", "-u", "origin", "main");

const port = Number(process.env.F1_PERSISTENCE_PORT ?? 3680);
process.env.BOBS_FACTORY_FACTORY_PORT = String(port + 1);
process.env.BOBS_FACTORY_FACTORY_ORIGIN = "";
const config: EdgeWorkerConfig = {
	platform: "cli",
	factoryHome: home,
	serverPort: port,
	serverHost: "127.0.0.1",
	defaultRunner: "claude",
	linearWorkspaces: { "cli-workspace": { linearToken: "mock-only" } },
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(root, "worktrees"),
			baseBranch: "main",
			isActive: true,
			linearWorkspaceId: "cli-workspace",
		},
	],
	handlers: {
		createAgentRunner: (runner, options) => {
			const role = options.workingDirectory?.includes("MANUAL-");
			const answered =
				role &&
				worker &&
				[...internals(worker).getFactoryRuntime().runs.values()].some(
					(run) =>
						run.workspace === options.workingDirectory &&
						run.answers.length > 0,
				);
			return f1AgentHandlers(
				"mock",
				role
					? JSON.stringify({
							questions: answered ? [] : ["Continue the fixture?"],
						})
					: "F1 persistence fixture completed without inference.",
			)!.createAgentRunner!(runner, options);
		},
	},
};
let worker: EdgeWorker | undefined;
let passed = false;
const internals = (value: EdgeWorker) =>
	value as unknown as {
		agentSessionManager: AgentSessionManager;
		persistenceManager: PersistenceManager;
		getFactoryRuntime(): WorkflowRuntime;
		savePersistedState(): Promise<void>;
	};
const dashboard = `http://localhost:${port + 1}`;
async function wait(check: () => boolean, label: string) {
	const deadline = Date.now() + 30000;
	while (!check()) {
		assert(Date.now() < deadline, label);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
async function rpc<T>(
	method: string,
	params: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(`http://127.0.0.1:${port}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
	});
	const result = (await response.json()) as { result: T; error?: unknown };
	assert(!result.error, JSON.stringify(result.error));
	return result.result;
}
async function post(path: string, body: unknown) {
	const response = await fetch(`${dashboard}${path}`, {
		method: "POST",
		headers: {
			Origin: dashboard,
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
		},
		body: JSON.stringify(body),
	});
	assert(
		response.ok,
		`${path}: ${response.status} ${await response.clone().text()}`,
	);
	return response.json();
}
const latency: number[] = [];
async function responsiveDuring(save: Promise<void>) {
	let complete = false;
	const observed = save.then(() => {
		complete = true;
	});
	const deadline = Date.now() + 60000;
	do {
		const started = performance.now();
		const response = await fetch(`${dashboard}/api/version`, {
			signal: AbortSignal.timeout(1000),
		});
		assert.equal(response.status, 200);
		await response.text();
		latency.push(performance.now() - started);
		assert(
			Date.now() < deadline,
			"Persistence did not complete within its drive deadline",
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
	} while (!complete);
	await observed;
}

const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
try {
	worker = new EdgeWorker(config);
	await worker.start();
	const issue = await rpc<{ issue: { id: string } }>("createIssue", {
		teamId: "team-default",
		title: "Persistence drive",
		description: "[workflow=simple]\nReturn a brief deterministic reply.",
	});
	const session = await rpc<{ session: { sessionId: string } }>(
		"startSession",
		{ issueId: issue.issue.id },
	);
	const id = session.session.sessionId;
	await wait(
		() =>
			internals(worker!).agentSessionManager.getSession(id)?.status ===
			AgentSessionStatus.Complete,
		"Mock issue session did not finish",
	);
	const timeline = await rpc<{
		activities: { type: string; content: string }[];
		totalCount: number;
	}>("viewSession", { sessionId: id, limit: 50 });
	assert(timeline.totalCount > 0);
	assert(timeline.activities.some((activity) => activity.type === "response"));
	const entries = internals(worker).agentSessionManager.getSessionEntries(id);
	const content = "synthetic-history-".repeat(32768).slice(0, 512 * 1024);
	for (let index = 0; index < 2048; index++)
		entries.push(
			immutableJson({
				type: "assistant",
				content,
				metadata: { timestamp: Date.now() + index },
			} as CyrusAgentSessionEntry),
		);
	const logicalBytes = content.length * 2048;
	assert.equal(logicalBytes, 1024 * 1024 * 1024);
	await responsiveDuring(internals(worker).savePersistedState());
	const beforeAppend = internals(worker).persistenceManager.metrics;
	entries.push(
		immutableJson({
			type: "assistant",
			content: "tail after 1 GiB",
			metadata: { timestamp: Date.now() + 3000 },
		} as CyrusAgentSessionEntry),
	);
	await responsiveDuring(internals(worker).savePersistedState());
	const afterAppend = internals(worker).persistenceManager.metrics;
	assert(
		afterAppend.bytesWritten - beforeAppend.bytesWritten < 2 * 1024 * 1024,
		"Appending a short entry rewrote large historical payloads",
	);

	const runtime = internals(worker).getFactoryRuntime();
	const definition = WorkflowSchema.parse({
		id: "persistence-drive",
		name: "Persistence drive",
		steps: [
			{
				id: "clarify",
				name: "Clarify",
				type: "agent",
				prompt: "Ask the supplied question, without executing work.",
				askQuestions: true,
			},
			{
				id: "finish",
				name: "Finish",
				type: "script",
				script: "printf '{\"complete\":true}'",
			},
		],
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), definition]);
	const started = (await post("/api/runs", {
		repositoryId: "fixture",
		workflow: definition.id,
		prompt: "Exercise a durable human gate",
	})) as { id: string };
	await wait(
		() => runtime.get(started.id).status === "waiting",
		"Scripted human gate was not reached",
	);
	const run = runtime.get(started.id);
	const legacyBytes = JSON.stringify({
		...run,
		id: "legacy-completed",
		status: "completed",
		outputs: {
			large: { summary: "Legacy retained artifact", text: content.repeat(2) },
		},
		history: [],
		events: [],
	});
	run.outputs.large = {
		summary: "Synthetic retained artifact",
		text: content.repeat(8),
		files: Object.fromEntries(
			Array.from({ length: 4000 }, (_, index) => [
				`path-${index}`,
				`fingerprint-${index}`,
			]),
		),
	};
	for (let index = 0; index < 48; index++)
		run.history.push({
			step: `historical-${index}`,
			at: run.createdAt,
			output: run.outputs.large,
		});
	await responsiveDuring(runtime.save(run));
	await worker.stop();
	worker = undefined;
	const legacyPath = join(home, "factory", "runs", "legacy-completed.json");
	writeFileSync(legacyPath, legacyBytes);
	worker = new EdgeWorker(config);
	await worker.start();
	const restored = internals(worker).getFactoryRuntime();
	await wait(
		() => restored.get(started.id).status === "waiting",
		"Pending gate did not survive restart",
	);
	assert.equal(restored.get(started.id).answers.length, 0);
	// Native role context reads the history before it checkpoints conversation
	// IDs and activity. Read every page, then save those checkpoints repeatedly.
	// Loaded historical payloads must remain immutable and reusable.
	const historical = restored.get(started.id);
	for (const entry of historical.history) {
		assert(Object.isFrozen(entry));
		assert(Object.isFrozen(entry.output));
	}
	await responsiveDuring(
		(async () => {
			for (let index = 0; index < 6; index++) {
				restored.log(historical, "resume", `Native checkpoint ${index}`);
				await restored.save(historical);
			}
		})(),
	);
	assert.equal(
		internals(worker).agentSessionManager.getSessionEntries(id).at(-1)?.content,
		"tail after 1 GiB",
	);
	const detail = (await (
		await fetch(`${dashboard}/api/runs/${started.id}?view=dashboard`)
	).json()) as {
		outputs: { large: { __artifactPreview: boolean } };
		history: unknown[];
	};
	assert.equal(detail.outputs.large.__artifactPreview, true);
	assert(detail.history.length >= 48);
	const legacyDetail = (await (
		await fetch(`${dashboard}/api/runs/legacy-completed?view=dashboard`)
	).json()) as {
		status: string;
		outputs: { large: { __artifactPreview: boolean; text?: string } };
	};
	assert.equal(legacyDetail.status, "completed");
	assert.equal(legacyDetail.outputs.large.__artifactPreview, true);
	assert.equal(legacyDetail.outputs.large.text, undefined);
	assert.equal(readFileSync(`${legacyPath}.legacy`, "utf8"), legacyBytes);
	const activity = (await (
		await fetch(`${dashboard}/api/runs/${id}/activity?limit=8`)
	).json()) as { entries: unknown[]; total: number };
	assert.equal(activity.entries.length, 8);
	assert(activity.total >= 2049);
	await post(`/api/runs/${started.id}/answer`, { answer: "Continue" });
	await wait(
		() => restored.get(started.id).status === "completed",
		"Accepted answer did not finish the scripted workflow",
	);
	assert.equal(restored.get(started.id).answers.length, 1);
	await worker.stop();
	worker = undefined;
	const saved = new PersistenceManager(join(home, "state"));
	assert.equal(
		(await saved.loadEdgeWorkerState())?.agentSessionEntries?.[id]?.at(-1)
			?.content,
		"tail after 1 GiB",
	);
	latency.sort((a, b) => a - b);
	const receipt = {
		passed: true,
		mode: "mock/scripted",
		logicalTranscriptBytes: logicalBytes,
		versionRequests: latency.length,
		p99VersionMs:
			latency[Math.min(latency.length - 1, Math.floor(latency.length * 0.99))],
		maxVersionMs: latency.at(-1),
		maxEventLoopDelayMs: delay.max / 1e6,
		appendBytesWritten: afterAppend.bytesWritten - beforeAppend.bytesWritten,
		maxCaptureMs: afterAppend.maxCaptureMs,
		checks: [
			"CLI issue/session and visible response",
			"1 GiB persistence with responsive HTTP",
			"incremental transcript append",
			"large retained run artifact",
			"restart retains native session and pending human gate",
			"loaded structured history remains immutable through resumed checkpoints",
			"lazy dashboard and activity pages",
			"legacy completed-run dashboard migration preserves original bytes",
			"one explicit answer resumes workflow",
			"shutdown flush and restored tail",
		],
		limitations:
			"Synthetic strings repeat and deduplicate; this checks logical-history scaling, not 1 GiB of unique disk writes. No live provider or production service was used.",
	};
	passed = true;
	console.log(JSON.stringify(receipt, null, 2));
} finally {
	delay.disable();
	await worker?.stop();
	if (passed) rmSync(root, { recursive: true, force: true });
	else console.error(`Failed fixture retained at ${root}`);
}
