import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentSessionStatus,
	AgentSessionType,
	createCLIIssueTracker,
} from "bobs-factory-core";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/src/factory/defaultWorkflows.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"Only deterministic fixture agents are authorized",
);
const directory = mkdtempSync(join(tmpdir(), "f1-ticket-managers-"));
const home = join(directory, "home"),
	repo = join(directory, "repository");
mkdirSync(home);
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		stdio: "pipe",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: join(directory, "gitconfig"),
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
writeFileSync(join(repo, "README.md"), "# Ticket connection fixture\n");
git("add", ".");
git("commit", "-q", "-m", "Fixture");
execFileSync("git", [
	"clone",
	"-q",
	"--bare",
	repo,
	join(directory, "remote.git"),
]);
git("remote", "add", "origin", join(directory, "remote.git"));
const dashboard = 3637,
	webhooks = 3638,
	origin = `http://localhost:${dashboard}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(dashboard);
process.env.WEBHOOK_IP_VALIDATION = "false";
for (const key of [
	"CLOUDFLARE_TOKEN",
	"BOBS_FACTORY_FACTORY_ORIGIN",
	"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
	"LINEAR_CLIENT_ID",
	"LINEAR_CLIENT_SECRET",
	"GH_TOKEN",
	"GITHUB_TOKEN",
])
	delete process.env[key];
const tracker = createCLIIssueTracker();
const config = {
	factoryHome: home,
	repositories: [
		{
			id: "repo",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": {
			linearToken: "fixture-no-provider-token",
			linearWorkspaceName: "Fixture workspace",
		},
	},
	ticketManagers: {
		linear: {
			enabled: true,
			webhookBaseUrl: `http://localhost:${webhooks}`,
			webhookSecret: "fixture-signing",
		},
	},
};
const configPath = join(home, "config.json");
// Retain the real failure trigger on disk: an old guided setup home.
writeFileSync(configPath, JSON.stringify({ ...config, platform: "cli" }), {
	mode: 0o600,
});
const nativeFetch = fetch;
globalThis.fetch = ((input, init) => {
	const url = new URL(String(input));
	assert(
		[origin, `http://localhost:${webhooks}`].includes(url.origin),
		`Unexpected provider I/O: ${url.origin}`,
	);
	return nativeFetch(input, init);
}) as typeof fetch;
const runtimeConfig = () => ({
	...JSON.parse(readFileSync(configPath, "utf8")),
	factoryHome: home,
	serverPort: webhooks,
	serverHost: "127.0.0.1",
	issueTrackerFactory: () => tracker,
	handlers: f1AgentHandlers("mock"),
});
let worker = new EdgeWorker(runtimeConfig());
worker.setConfigPath(configPath);
const edge = () => worker as any;
const api = async (path: string, method = "GET", body?: unknown) => {
	const response = await fetch(`${origin}${path}`, {
		method,
		headers: {
			Origin: origin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const value = await response.json();
	assert(
		response.status >= 200 && response.status < 300,
		`HTTP ${response.status}: ${JSON.stringify(value).slice(0, 500)}`,
	);
	return value;
};
const webhook = async (sessionId: string, issue: any) => {
	tracker.getState().agentSessions.set(sessionId, {
		id: sessionId,
		status: AgentSessionStatus.Active,
		type: AgentSessionType.CommentThread,
		createdAt: new Date(),
		updatedAt: new Date(),
		issueId: issue.id,
	});
	const payload = JSON.stringify({
		type: "AgentSessionEvent",
		action: "created",
		organizationId: "cli-workspace",
		webhookTimestamp: Date.now(),
		createdAt: new Date().toISOString(),
		agentSession: {
			id: sessionId,
			issue: {
				id: issue.id,
				identifier: issue.identifier,
				title: issue.title,
				teamId: "team-default",
			},
		},
		guidance: [],
	});
	return fetch(`http://localhost:${webhooks}/linear-webhook`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"linear-signature": createHmac("sha256", "fixture-signing")
				.update(payload)
				.digest("hex"),
		},
		body: payload,
	});
};
const waitFor = async (test: () => boolean, label: string) => {
	const limit = Date.now() + 15000;
	while (!test()) {
		assert(Date.now() < limit, `Timed out: ${label}`);
		await new Promise((r) => setTimeout(r, 25));
	}
};
try {
	await worker.start();
	const runtime = edge().getFactoryRuntime();
	runtime.updateWorkflows(
		[
			...defaultWorkflows,
			{
				id: "ticket-smoke",
				name: "Ticket manager smoke",
				allowedTriggers: ["manual", "ticket-assignment"],
				steps: [
					{
						id: "work",
						name: "Work",
						type: "script",
						script: "printf '%s' '{\"ok\":true}'",
					},
				],
			},
		],
		"ticket-smoke",
	);
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Signed assignment",
		description: "Exercise the configured connection",
	});
	assert.equal((await webhook("fixture-signed", issue)).status, 200);
	await waitFor(
		() => runtime.runs.get("fixture-signed")?.status === "completed",
		"signed ticket workflow completion",
	);
	assert.equal(runtime.runs.get("fixture-signed").outputs.work.ok, true);
	const activities = [...tracker.getState().agentActivities.values()];
	assert(
		activities.some((a) => a.agentSessionId === "fixture-signed"),
		"ticket activities are visible",
	);
	let status = await api("/api/ticket-managers");
	assert(
		!JSON.stringify(status).includes("fixture-signing"),
		"no signing credentials in the API",
	);
	status = await api("/api/ticket-managers/linear", "PUT", {
		expectedRevision: status.revision,
		enabled: false,
	});
	assert.equal((await webhook("fixture-disabled", issue)).status, 503);
	assert(!runtime.runs.has("fixture-disabled"));
	assert.equal(
		JSON.parse(readFileSync(configPath, "utf8")).platform,
		undefined,
	);
	// Standalone work remains available while the tracker is disabled.
	const manual = await api("/api/runs", "POST", {
		repositoryId: "repo",
		workflow: "ticket-smoke",
		prompt: "A standalone local task",
	});
	await waitFor(
		() => runtime.runs.get(manual.id)?.status === "completed",
		"manual workflow with disabled ticket manager",
	);
	await worker.stop();
	worker = new EdgeWorker(runtimeConfig());
	worker.setConfigPath(configPath);
	await worker.start();
	status = await api("/api/ticket-managers");
	assert.equal(
		status.managers.find((m: any) => m.id === "linear").enabled,
		false,
	);
	assert.equal((await webhook("fixture-after-restart", issue)).status, 503);
	status = await api("/api/ticket-managers/linear", "PUT", {
		expectedRevision: status.revision,
		enabled: true,
	});
	const next = await tracker.createIssue({
		teamId: "team-default",
		title: "Re-enabled assignment",
		description: "A new task",
	});
	assert.equal((await webhook("fixture-reenabled", next)).status, 200);
	await waitFor(
		() =>
			edge().getFactoryRuntime().runs.get("fixture-reenabled")?.status ===
			"completed",
		"re-enabled assignment completion",
	);
	status = await api("/api/ticket-managers");
	assert(status.managers.find((m: any) => m.id === "linear").lastAcceptedAt);
	const protectedResponse = await nativeFetch(`${origin}/api/ticket-managers`, {
		headers: { Origin: origin, Forwarded: "for=203.0.113.5;proto=https" },
	});
	assert.notEqual(
		protectedResponse.status,
		200,
		"forwarded callers do not gain local credential settings access",
	);
	console.log(
		JSON.stringify(
			{
				passed: true,
				home,
				mocked: true,
				providerNetworkCalls: 0,
				assertions: [
					"signed assignment to worktree and complete script workflow",
					"ticket activities visible",
					"live disable returns 503 and starts no run",
					"standalone workflow remains available",
					"disabled state survives restart",
					"re-enable accepts new signed assignment",
					"legacy platform removed with native credentials retained",
					"secrets redacted and forwarded callers rejected",
				],
			},
			null,
			2,
		),
	);
	if (process.env.F1_KEEP_SERVER === "1") {
		console.log(`UI fixture ready: ${origin}/#/settings/tickets`);
		await new Promise<void>((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
	}
} finally {
	await worker.stop();
	globalThis.fetch = nativeFetch;
}
