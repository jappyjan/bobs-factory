import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionManager } from "../../../../packages/edge-worker/src/AgentSessionManager.ts";
import { LinearActivitySink } from "../../../../packages/edge-worker/src/sinks/LinearActivitySink.ts";
import { LinearEventTransport } from "../../../../packages/linear-event-transport/src/LinearEventTransport.ts";
import { LinearIssueTrackerService } from "../../../../packages/linear-event-transport/src/LinearIssueTrackerService.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

const require = createRequire(
	new URL(
		"../../../../packages/linear-event-transport/package.json",
		import.meta.url,
	),
);
const { LinearClient } = require("@linear/sdk");
const Fastify = require("fastify");
const home = mkdtempSync(join(tmpdir(), "f1-linear-busy-budget-"));
const provider = Fastify();
const ingress = Fastify();
const requests: { at: number; kind: string }[] = [];
const publications: { type: string; body?: string }[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
let tracker: LinearIssueTrackerService | undefined;
let polling = true;
let reads: Promise<void> | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let starts = 0;
const acknowledgment = "Starting work on your ticket.";
const finalBody =
	"Completed the mocked assignment while Linear reads continued.";

try {
	provider.post("/graphql", async (request: any) => {
		const input = request.body.variables.input;
		requests.push({ at: Date.now(), kind: input ? "activity" : "read" });
		if (!input) return { data: { issue: { id: "issue", reactions: [] } } };
		publications.push(input.content);
		return {
			data: {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: input.id },
					lastSyncId: 1,
				},
			},
		};
	});
	const url = await provider.listen({ host: "127.0.0.1", port: 0 });
	const workspace = randomUUID();
	const sessionId = randomUUID();
	tracker = new LinearIssueTrackerService(
		new LinearClient({
			accessToken: "f1-busy-budget",
			apiUrl: `${url}/graphql`,
		}),
		undefined,
		undefined,
		{ factoryHome: home, workspaceId: workspace, requestIntervalMs: 100 },
	);
	tracker.startDelivery();
	const manager = new AgentSessionManager();
	manager.createCyrusAgentSession(
		sessionId,
		"issue",
		{ id: "issue", identifier: "F1-BUSY", title: "Busy Linear request budget" },
		{ path: home, isGitWorktree: false },
	);
	manager.setActivitySink(
		sessionId,
		new LinearActivitySink(tracker, workspace),
	);
	const runner = new MockAgentRunner(
		{
			factoryHome: home,
			workingDirectory: home,
			onMessage: (message: any) =>
				manager.handleClaudeMessage(sessionId, message),
		},
		finalBody,
	);
	await tracker.getClient().issue("warmup");
	reads = (async () => {
		while (polling) await tracker!.getClient().issue("background-read");
	})();
	let work: Promise<void> | undefined;
	const transport = new LinearEventTransport({
		fastifyServer: ingress,
		verificationMode: "direct",
		secret: "f1-busy-budget-secret",
	});
	transport.on("event", () => {
		starts++;
		work = (async () => {
			await tracker!.createAgentActivity({
				agentSessionId: sessionId,
				content: { type: "thought", body: acknowledgment },
			});
			await runner.start("Process the fixture assignment");
		})();
		void work.catch(() => undefined);
	});
	transport.register();
	const payload = {
		type: "AgentSessionEvent",
		action: "created",
		organizationId: workspace,
		agentSession: {
			id: sessionId,
			issue: { id: "issue", identifier: "F1-BUSY" },
		},
	};
	const response = await ingress.inject({
		method: "POST",
		url: "/linear-webhook",
		headers: {
			"linear-signature": createHmac("sha256", "f1-busy-budget-secret")
				.update(JSON.stringify(payload))
				.digest("hex"),
		},
		payload,
	});
	assert.equal(response.statusCode, 200);
	assert(work);
	await Promise.race([
		work,
		new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(
				() => reject(new Error("Activity delivery starved")),
				5000,
			);
		}),
	]);
	assert.equal(polling, true);
	assert(publications.some((content) => content.body === acknowledgment));
	assert(publications.some((content) => content.body === finalBody));
	assert.equal(starts, 1);
	assert.equal(tracker.getActivityDeliveryStatus().pending, 0);
	assert(requests.filter((request) => request.kind === "read").length >= 3);
	for (let i = 1; i < requests.length; i++)
		assert(
			requests[i].at - requests[i - 1].at >= 80,
			"API pacing remains enforced",
		);
	assert.equal(unhandled.length, 0);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			starts,
			requests: requests.length,
			publications: publications.length,
			pending: 0,
			unhandled: 0,
		}),
	);
} finally {
	if (timeout) clearTimeout(timeout);
	polling = false;
	await reads;
	tracker?.stopDelivery();
	await ingress.close();
	await provider.close();
	process.off("unhandledRejection", onUnhandled);
	rmSync(home, { recursive: true, force: true });
}
