import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentSessionStatus,
	createCLIIssueTracker,
	type EdgeWorkerConfig,
	immutableJson,
} from "bobs-factory-core";
import type { AgentSessionManager } from "../../../../packages/edge-worker/src/AgentSessionManager.ts";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";
import { displayAnswer, nodeDisplay } from "./node-display.mjs";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync(join(tmpdir(), "f1-api-responsiveness-"));
const requireMcp = createRequire(
	new URL("../../../../packages/mcp-tools/package.json", import.meta.url),
);
const { Client } = requireMcp("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = requireMcp(
	"@modelcontextprotocol/sdk/client/stdio.js",
);
const evidenceMarker = "Original review snapshot: retained exactly 😀 é";
let memoryContextReads = 0;
const memoryProbes: number[] = [];
const home = join(root, "home");
const repo = join(root, "repo");
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repo, stdio: "pipe" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
git("config", "commit.gpgsign", "false");
writeFileSync(
	join(repo, "README.md"),
	"# Isolated API responsiveness fixture\n",
);
git("add", ".");
git("commit", "-qm", "Fixture");
git("clone", "-q", "--bare", repo, join(root, "origin.git"));
git("remote", "add", "origin", join(root, "origin.git"));

const port = Number(process.env.F1_API_PORT ?? 3686);
const origin = `http://localhost:${port + 1}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port + 1);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
let worker: EdgeWorker | undefined;
let passed = false;
type Inside = {
	getFactoryRuntime(): WorkflowRuntime;
	agentSessionManager: AgentSessionManager;
};
const inside = () => worker as unknown as Inside;
const config: EdgeWorkerConfig = {
	platform: "cli",
	issueTrackerFactory: createCLIIssueTracker,
	factoryHome: home,
	serverHost: "127.0.0.1",
	serverPort: port,
	defaultRunner: "claude",
	linearWorkspaces: { "cli-workspace": { linearToken: "fixture-no-provider" } },
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
			const run =
				worker &&
				[...inside().getFactoryRuntime().runs.values()].find(
					(item) => item.workspace === options.workingDirectory,
				);
			const response = run
				? JSON.stringify({
						summary: "Controlled role completed",
					})
				: "F1 API fixture completed without live inference.";
			const mock = f1AgentHandlers("mock", response)!.createAgentRunner!(
				runner,
				options,
			);
			if (run?.step === "memory-check") {
				const start = mock.start.bind(mock);
				mock.start = async (prompt) => {
					const scoped = options.mcpConfig?.["factory-context"];
					assert(scoped && "command" in scoped);
					const client = new Client({ name: "f1-memory", version: "1" });
					await client.connect(
						new StdioClientTransport({
							command: scoped.command,
							args: scoped.args ?? [],
							cwd: options.workingDirectory,
							stderr: "pipe",
						}),
					);
					try {
						const read = async (path: string, offset = 0, limit = 16000) => {
							const result = await client.callTool({
								name: "read_context",
								arguments: { path, view: "full", offset, limit },
							});
							assert(!result.isError, JSON.stringify(result));
							return result.structuredContent as {
								text: string;
								totalCharacters: number;
								nextOffset: number | null;
							};
						};
						const marker = await read(
							"/history/1/output/baseline/context/marker",
						);
						assert.equal(marker.text, evidenceMarker);
						assert.equal(marker.nextOffset, null);
						const page = await read("/history/1/output/notes", 1000, 31);
						assert.equal(
							page.text,
							"large evidence\n".repeat(150000).slice(1000, 1031),
						);
						assert.equal(
							page.totalCharacters,
							"large evidence\n".length * 150000,
						);
						assert.equal(page.nextOffset, 1031);
						memoryContextReads++;
					} finally {
						await client.close();
					}
					return start(prompt);
				};
			}
			return mock;
		},
	},
};

type Measurement = {
	path: string;
	status: number;
	requestBytes: number;
	bytes: number;
	ms: number;
};
const measurements: Measurement[] = [];
async function request<T>(
	path: string,
	body?: unknown,
	method?: string,
	headers: Record<string, string> = {},
) {
	const start = performance.now();
	const requestBody = body === undefined ? undefined : JSON.stringify(body);
	const response = await fetch(`${origin}${path}`, {
		method: method ?? (body === undefined ? "GET" : "POST"),
		headers: {
			Origin: origin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
			...headers,
		},
		body: requestBody,
		signal: AbortSignal.timeout(10000),
	});
	const text = await response.text();
	measurements.push({
		path,
		status: response.status,
		requestBytes: requestBody ? Buffer.byteLength(requestBody) : 0,
		bytes: Buffer.byteLength(text),
		ms: performance.now() - start,
	});
	assert(response.ok, `${path}: ${response.status} ${text.slice(0, 1000)}`);
	return JSON.parse(text) as T;
}
async function wait(check: () => boolean, label: string) {
	const deadline = Date.now() + 15000;
	while (!check()) {
		assert(Date.now() < deadline, label);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
async function rpc<T>(method: string, params: Record<string, unknown>) {
	const response = await fetch(`http://127.0.0.1:${port}/cli/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
	});
	const result = (await response.json()) as { result: T; error?: unknown };
	assert(!result.error, JSON.stringify(result.error));
	return result.result;
}

try {
	worker = new EdgeWorker(config);
	await worker.start();
	const issue = await rpc<{ issue: { id: string } }>("createIssue", {
		teamId: "team-default",
		title: "API responsiveness",
		description: "[workflow=simple]\nReturn a brief fixture response.",
	});
	const session = await rpc<{ session: { sessionId: string } }>(
		"startSession",
		{ issueId: issue.issue.id },
	);
	const sessionId = session.session.sessionId;
	await wait(
		() =>
			inside().agentSessionManager.getSession(sessionId)?.status ===
			AgentSessionStatus.Complete,
		"Mock ticket session did not finish",
	);
	const timeline = await rpc<{
		activities: { type: string }[];
		totalCount: number;
	}>("viewSession", { sessionId, limit: 50 });
	assert(timeline.totalCount > 0);
	assert(timeline.activities.some((item) => item.type === "response"));

	const runtime = inside().getFactoryRuntime();
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "api-fixture",
		name: "API fixture",
		allowedTriggers: ["manual"],
		steps: [
			nodeDisplay("ask", "Continue this run?", "memory-check"),
			{
				id: "memory-check",
				name: "Read retained evidence",
				type: "agent",
				prompt: "Inspect the supplied retained evidence without inference.",
			},
			{
				id: "finish",
				name: "Finish",
				type: "exec",
				command: "sh",
				json: true,
				args: ["-c", "printf '{\"complete\":true}'"],
			},
		],
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
	const started = await request<{ id: string; accepted: boolean }>(
		"/api/runs",
		{
			workflow: workflow.id,
			repositoryId: "fixture",
			prompt: "Exercise the saved human gate",
		},
	);
	assert.equal(started.accepted, true);
	assert(
		measurements.at(-1)!.bytes < 1024,
		"Launch returned saved execution data",
	);
	await wait(
		() => runtime.get(started.id).status === "waiting",
		"Human gate was not reached",
	);
	const run = runtime.get(started.id);
	const payload = {
		summary: "Retained evidence",
		notes: "large evidence\n".repeat(150000),
		baseline: {
			context: { marker: evidenceMarker },
		},
	};
	run.outputs.large = payload;
	for (let index = 0; index < 24; index++)
		run.history.push(
			immutableJson({ step: "retained", at: run.createdAt, output: payload }),
		);
	await runtime.save(run);
	const context = {
		step: run.step,
		viewDecision: structuredClone(run.viewDecision),
	};
	await worker.stop();
	worker = new EdgeWorker(config);
	await worker.start();
	const restored = inside().getFactoryRuntime();
	await wait(
		() => restored.get(started.id).status === "waiting",
		"Human gate did not survive restart",
	);

	const fullConfig = await request<{ workflows: unknown[] }>("/api/config");
	const fullConfigBytes = measurements.at(-1)!.bytes;
	const dashboardConfig = await request<{
		workflows: { id: string; steps?: unknown[] }[];
	}>("/api/config?view=dashboard");
	assert(dashboardConfig.workflows.length === fullConfig.workflows.length);
	assert(
		measurements.at(-1)!.bytes < fullConfigBytes / 2,
		"Dashboard still received full workflow instructions",
	);
	const list =
		await request<{ id: string; history?: unknown[] }[]>("/api/runs");
	assert(list.some((item) => item.id === started.id));
	assert(
		(list.find((item) => item.id === started.id)!.history?.length ?? 0) < 24,
		"Run list repeated retained receipts",
	);
	const focus = await request<{
		status: string;
		viewDecision: typeof run.viewDecision;
		step?: string;
		checkpoint?: unknown;
		history?: unknown;
	}>(`/api/runs/${started.id}?view=focus`);
	assert.equal(focus.status, "waiting");
	assert.equal(focus.viewDecision?.id, context.viewDecision?.id);
	assert.equal(
		focus.viewDecision?.documentDigest,
		context.viewDecision?.documentDigest,
	);
	assert.equal(focus.checkpoint, undefined);
	assert.equal(focus.history, undefined);
	assert(measurements.at(-1)!.bytes < 50000, "Focus loaded execution evidence");
	const detail = await request<{
		outputs: { large: { __artifactPreview?: boolean; notes?: string } };
		history: unknown[];
	}>(`/api/runs/${started.id}?view=dashboard`);
	assert.equal(detail.outputs.large.__artifactPreview, true);
	assert.equal(detail.outputs.large.notes, undefined);
	assert(detail.history.length >= 24, "Run detail lost receipt order/counts");
	assert(
		measurements.at(-1)!.bytes < 100000,
		"Dashboard loaded retained payloads",
	);
	const artifact = await request<typeof payload>(
		`/api/runs/${started.id}/artifacts/large`,
	);
	assert.deepEqual(artifact, payload, "Explicit artifact read lost evidence");
	let probing = true;
	const probes = (async () => {
		while (probing) {
			const startedAt = performance.now();
			const response = await fetch(`${origin}/api/version`, {
				signal: AbortSignal.timeout(1000),
			});
			assert.equal(response.status, 200);
			await response.text();
			memoryProbes.push(performance.now() - startedAt);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	})();
	void probes.catch(() => {});
	try {
		const answer = await request<{ accepted: boolean }>(
			`/api/runs/${started.id}/view-answer`,
			displayAnswer(restored.get(started.id), "Continue"),
		);
		assert.equal(answer.accepted, true);
		assert(measurements.at(-1)!.bytes < 1024);
		await wait(
			() => restored.get(started.id).status === "completed",
			"Accepted answer did not continue the saved run",
		);
	} finally {
		probing = false;
		await probes;
	}
	assert.equal(
		memoryContextReads,
		1,
		"Resumed role did not inspect full saved evidence",
	);
	assert(
		memoryProbes.length > 0,
		"No HTTP probes ran during retained-history preparation",
	);
	assert.equal(restored.get(started.id).outputs.ask.action, "continue");

	const marker = join(root, "retry-ready");
	const retryWorkflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "api-retry",
		name: "API Retry",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "work",
				name: "Work",
				type: "exec",
				command: "sh",
				json: true,
				args: ["-c", `test -f '${marker}' && printf '{"complete":true}'`],
			},
		],
	});
	restored.updateWorkflows([...restored.listWorkflows(), retryWorkflow]);
	const retry = await request<{ id: string }>("/api/runs", {
		workflow: retryWorkflow.id,
		repositoryId: "fixture",
		prompt: "Retry retained state",
	});
	await wait(
		() => restored.get(retry.id).status === "failed",
		"Retry fixture did not fail",
	);
	restored.get(retry.id).outputs.large = payload;
	await restored.save(restored.get(retry.id));
	writeFileSync(marker, "ready");
	const retried = await request<{ id: string; accepted: boolean }>(
		`/api/runs/${retry.id}/retry`,
		{},
	);
	assert.equal(retried.id, retry.id);
	assert.equal(retried.accepted, true);
	assert(measurements.at(-1)!.bytes < 1024, "Retry returned the saved run");
	await wait(
		() => restored.get(retry.id).status === "completed",
		"Retry did not continue retained work",
	);
	assert.deepEqual(restored.get(retry.id).outputs.large, payload);
	const activity = await request<{ entries: unknown[]; events: unknown[] }>(
		`/api/runs/${sessionId}/activity?limit=8`,
	);
	assert(activity.entries.length + activity.events.length <= 8);
	const version = await request<{ build: string }>("/api/version");
	assert(version.build);
	const capacity = await request<{
		capacity: { active: number; requests?: unknown };
	}>("/api/capacity");
	assert.equal(typeof capacity.capacity.active, "number");
	assert.equal(capacity.capacity.requests, undefined);
	assert(measurements.at(-1)!.bytes < 1024);
	const recipes = await request<{
		configRevision: string;
		workflows: { id: string }[];
	}>("/api/config?view=recipes");
	assert(recipes.workflows.some((item) => item.id === workflow.id));
	const edited = await request<{
		configRevision: string;
		updatedWorkflows: { id: string; name: string }[];
	}>(
		"/api/workflows",
		{ workflows: [{ ...workflow, name: "Edited API fixture" }] },
		"PATCH",
		{ "X-Factory-Config": recipes.configRevision },
	);
	assert.deepEqual(
		edited.updatedWorkflows.map((item) => item.id),
		[workflow.id],
	);
	assert.equal(edited.updatedWorkflows[0]!.name, "Edited API fixture");
	assert(
		measurements.at(-1)!.requestBytes < 2048,
		"Recipe edit uploaded unrelated definitions",
	);
	const selected = await request<{ defaultWorkflow: string }>(
		"/api/workflows/default",
		{ defaultWorkflow: "simple" },
		"PUT",
		{ "X-Factory-Config": edited.configRevision },
	);
	assert.equal(selected.defaultWorkflow, "simple");
	assert(measurements.at(-1)!.requestBytes < 100);
	assert(measurements.at(-1)!.bytes < 1024);
	passed = true;
	const receipt = {
		mode: "mock",
		source: {
			commit: execFileSync("git", ["rev-parse", "HEAD"], {
				encoding: "utf8",
			}).trim(),
			workingTree:
				execFileSync("git", ["status", "--porcelain"], {
					encoding: "utf8",
				}).trim().length > 0,
		},
		checks: [
			"ticket response visible",
			"compact launch/retry acknowledgements",
			"cold saved question context",
			"lean dashboard configuration",
			"compact inbox history",
			"bounded focus and detail",
			"explicit full artifact",
			"durable answer continuation",
			"responsive resumed role preparation with large saved history",
			"stdio full-history reads preserve original baseline context and Unicode",
			"retry preserves evidence",
			"dedicated capacity counts",
			"guarded partial recipe edit and default choice",
		],
		measurements,
		memory: {
			logicalHistoryBytes: Buffer.byteLength(JSON.stringify(payload)) * 24,
			fullContextReads: memoryContextReads,
			versionRequests: memoryProbes.length,
			maxVersionMs: Math.max(...memoryProbes),
		},
	};
	const receiptPath = process.env.F1_API_RECEIPT;
	if (receiptPath)
		writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(JSON.stringify(receipt, null, 2));
	if (process.env.F1_API_CAPTURE === "1") {
		console.log(`Browser fixture ready at ${origin}; home=${home}`);
		await new Promise((resolve) => setTimeout(resolve, 60000));
	}
} finally {
	await worker?.stop();
	if (passed) rmSync(root, { recursive: true, force: true });
	else console.error(`Failed fixture retained at ${root}`);
}
