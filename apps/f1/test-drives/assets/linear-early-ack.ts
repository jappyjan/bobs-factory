import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.ts";
import {
	nativeAdapter,
	TicketTracking,
} from "../../../../packages/edge-worker/src/factory/TicketTracking.ts";
import { LinearEventTransport } from "../../../../packages/linear-event-transport/src/LinearEventTransport.ts";
import { LinearIssueTrackerService } from "../../../../packages/linear-event-transport/src/LinearIssueTrackerService.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const require = createRequire(
	new URL(
		"../../../../packages/linear-event-transport/package.json",
		import.meta.url,
	),
);
const { LinearClient } = require("@linear/sdk");
const Fastify = require("fastify");
const home = mkdtempSync(join(tmpdir(), "f1-linear-early-ack-"));
const provider = Fastify();
const ingress = Fastify();
const requests: number[] = [];
const requestIds: string[] = [];
const publications: { session: string; body: string; at: number }[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
const workspace = "cli-workspace";
const session = randomUUID();
const secret = "f1-early-ack-signature";
let release!: () => void;
const preflight = new Promise<void>((resolve) => {
	release = resolve;
});
let preflightReads = 0;
let workspaceStarts = 0;
let runnerStarts = 0;
let tracker: LinearIssueTrackerService | undefined;
let worker: EdgeWorker | undefined;
let work: Promise<void> | undefined;
let launch: Promise<void> | undefined;
let backlog: Promise<unknown> | undefined;
let routine: Promise<unknown> | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let tracking: TicketTracking | undefined;
let acknowledged!: () => void;
const acknowledgment = new Promise<void>((resolve) => {
	acknowledged = resolve;
});

try {
	provider.post("/graphql", async (request: any) => {
		const input = request.body.variables.input;
		if (!input) return { data: { issue: { id: "background", reactions: [] } } };
		assert(
			!("priority" in input),
			"Delivery scheduling must not enter GraphQL input",
		);
		publications.push({
			session: input.agentSessionId,
			body: input.content.body,
			at: Date.now(),
		});
		if (input.agentSessionId === session) acknowledged();
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
	const client = new LinearClient({
		accessToken: "f1-early-ack",
		apiUrl: `${url}/graphql`,
	});
	const request = client.client.request.bind(client.client);
	client.client.request = (...args: unknown[]) => {
		requests.push(Date.now());
		requestIds.push((args[1] as { id?: string } | undefined)?.id ?? "activity");
		return request(...args);
	};
	tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		factoryHome: home,
		workspaceId: workspace,
		requestIntervalMs: 100,
	});
	tracker.startDelivery();
	const repository = {
		id: "fixture",
		name: "Fixture",
		repositoryPath: home,
		workspaceBaseDir: home,
		baseBranch: "main",
		linearWorkspaceId: workspace,
		isActive: true,
	};
	const mock = f1AgentHandlers("mock")!;
	worker = new EdgeWorker({
		factoryHome: home,
		issueTrackerFactory: createCLIIssueTracker,
		repositories: [repository],
		handlers: {
			...mock,
			createWorkspace: async () => {
				workspaceStarts++;
				return { path: home, isGitWorktree: false };
			},
			createAgentRunner: (...args) => {
				runnerStarts++;
				return mock.createAgentRunner!(...args);
			},
		},
	});
	const edge = worker as any;
	edge.issueTrackers.set(workspace, tracker);
	edge.repositoryRouter.getIssueRepositoryCache().set("issue", [repository.id]);
	// Script only the external ticket-read boundary. Admission, workflow selection,
	// dependency checking, publication, duplicate detection and stop are production code.
	edge.fetchFullIssueDetails = async () => {
		preflightReads++;
		await preflight;
		return {
			id: "issue",
			identifier: "F1-EARLY",
			title: "Delayed ticket context",
			description: "[workflow=simple]",
			labels: async () => ({ nodes: [] }),
			inverseRelations: async () => ({
				nodes: [
					{
						type: "blocks",
						issue: {
							id: "blocker",
							identifier: "F1-BLOCKER",
							state: { type: "unstarted" },
						},
					},
				],
			}),
		};
	};
	await tracker.getClient().issue("warmup");
	backlog = tracker.withBackgroundRequests(() =>
		Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				tracker!.getClient().issue(`background-${index}`),
			),
		),
	);
	routine = tracker.createAgentActivity({
		agentSessionId: "earlier-session",
		content: { type: "thought", body: "Earlier progress" },
	});
	const transport = new LinearEventTransport({
		fastifyServer: ingress,
		verificationMode: "direct",
		secret,
	});
	transport.on("event", (event) => {
		work = edge.handleWebhook(event, [repository]);
		void work!.catch(() => undefined);
	});
	transport.register();
	const event = {
		type: "AgentSessionEvent",
		action: "created",
		createdAt: new Date().toISOString(),
		organizationId: workspace,
		agentSession: {
			id: session,
			issue: {
				id: "issue",
				identifier: "F1-EARLY",
				title: "Delayed ticket context",
			},
			comment: { id: "comment", body: "This thread is for an agent session" },
		},
	};
	const inject = () =>
		ingress.inject({
			method: "POST",
			url: "/linear-webhook",
			headers: {
				"linear-signature": createHmac("sha256", secret)
					.update(JSON.stringify(event))
					.digest("hex"),
			},
			payload: event,
		});
	const started = Date.now();
	assert.equal((await inject()).statusCode, 200);
	launch = work!;
	await Promise.race([
		acknowledgment,
		new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(
				() =>
					reject(
						new Error("Acknowledgment blocked by preflight or API backlog"),
					),
				1000,
			);
		}),
	]);
	clearTimeout(timeout);
	const latencyMs =
		publications.find((p) => p.session === session)!.at - started;
	assert(
		latencyMs < 1000,
		"Acknowledgment stays within five paced request slots",
	);
	assert.equal(workspaceStarts, 0);
	assert.equal(runnerStarts, 0);
	await tracker.getClient().issue("foreground-context");
	assert(
		requestIds.indexOf("background-0") === -1 ||
			requestIds.indexOf("foreground-context") <
				requestIds.indexOf("background-0"),
		"Foreground context proceeds before saved synchronization reads",
	);
	assert.equal((await inject()).statusCode, 200);
	await work;
	release();
	await launch;
	await Promise.all([routine, backlog]);
	assert(preflightReads > 0);
	assert.equal(
		publications.filter(
			(p) => p.session === session && p.body.startsWith("I've received"),
		).length,
		1,
	);
	assert(
		publications.some(
			(p) =>
				p.session === session && p.body.includes("Blocked by **F1-BLOCKER**"),
		),
	);
	assert(edge.parkedSessions.has("issue"));
	assert.equal(workspaceStarts, 0);
	assert.equal(runnerStarts, 0);
	await edge.handleIssueUnassigned(event.agentSession.issue, workspace);
	assert.equal(
		edge.getLaunchAdmission().get(workspace, session).phase,
		"settled",
	);
	assert(!edge.parkedSessions.has("issue"));
	const fixtureTracker = createCLIIssueTracker();
	const ticket = await fixtureTracker.createIssue({
		teamId: "team-default",
		title: "Busy status synchronization",
	});
	for (let i = 0; i < 16; i++)
		await fixtureTracker.createComment(ticket.id, { body: `Discussion ${i}` });
	const fetchComments = fixtureTracker.fetchComments.bind(fixtureTracker);
	let profileReads = 0;
	fixtureTracker.fetchComments = async (...args) => {
		const page = await fetchComments(...args);
		for (const comment of page.nodes)
			Object.defineProperty(comment, "user", {
				get() {
					profileReads++;
					return Promise.resolve({ id: "author", name: "Fixture author" });
				},
			});
		return page;
	};
	const reference = {
		provider: "native" as const,
		platform: "cli",
		workspaceId: workspace,
		id: ticket.id,
		url: ticket.url,
	};
	const adapter = nativeAdapter(reference, fixtureTracker);
	const fullContext = await adapter.read();
	assert.equal(fullContext.comments.length, 16);
	assert.equal(profileReads, 16, "Agent context retains authors");
	const fullContextProfileReads = profileReads;
	profileReads = 0;
	const runtime = edge.getFactoryRuntime();
	const run = runtime.create({
		repositoryId: repository.id,
		workflow: runtime.selectWorkflow([], "manual", "factory"),
		workspace: home,
		input: "Fixture lifecycle",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = reference;
	tracking = new TicketTracking(
		async () => adapter,
		(run) => runtime.save(run),
		() => {},
	);
	await tracking.record(run, {
		key: "start",
		body: "Started fixture work",
		stage: "in_progress",
	});
	assert.equal(run.ticketSync.error, undefined);
	assert.equal(run.ticketSync.receipts[0].delivered, true);
	assert.equal(
		(await (await fixtureTracker.fetchIssue(ticket.id)).state)?.type,
		"started",
	);
	assert.equal(
		profileReads,
		0,
		"Background lifecycle does not fetch comment profiles",
	);
	await fixtureTracker.updateIssue(ticket.id, { stateId: "state-todo" });
	await tracking.record(run, {
		key: "later",
		body: "Later progress",
		stage: "in_progress",
	});
	assert.equal(
		run.ticketSync.receipts.at(-1).conflict,
		true,
		"Fresh outside-run state changes remain protected",
	);
	assert.equal(
		(await (await fixtureTracker.fetchIssue(ticket.id)).state)?.id,
		"state-todo",
	);
	for (let i = 1; i < requests.length; i++)
		assert(
			requests[i] - requests[i - 1] >= 80,
			"Shared API pacing remains enforced",
		);
	assert.equal(tracker.getActivityDeliveryStatus().pending, 0);
	assert.equal(unhandled.length, 0);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			acknowledgmentLatencyMs: latencyMs,
			duplicateAcknowledgments: 0,
			blockedWithoutStartingWork: true,
			stopped: true,
			pending: 0,
			unhandled: 0,
			fullContextProfileReads,
			trackingProfileReads: profileReads,
			outsideRunStateProtected: true,
			foregroundContextBeforeBacklog: true,
		}),
	);
} finally {
	release();
	if (timeout) clearTimeout(timeout);
	tracking?.stop();
	await work?.catch(() => undefined);
	await launch?.catch(() => undefined);
	await Promise.allSettled([backlog, routine]);
	if (worker) {
		const edge = worker as any;
		await edge.getFactoryRuntime().shutdown();
		edge.ticketTracking?.stop();
		await edge.stateSaveQueue;
		await edge.runnerSlots.ready();
		await edge.runnerSlots.shutdown();
	}
	tracker?.stopDelivery();
	await ingress.close();
	await provider.close();
	process.off("unhandledRejection", onUnhandled);
	rmSync(home, { recursive: true, force: true });
}
