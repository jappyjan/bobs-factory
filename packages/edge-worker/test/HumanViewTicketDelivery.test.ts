import { createHash, randomUUID } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LinearClient } from "@linear/sdk";
import { CodexRunner } from "bobs-factory-codex-runner";
import { CLIIssueTrackerService, publicFailure } from "bobs-factory-core";
import { LinearIssueTrackerService } from "bobs-factory-linear-event-transport";
import { callConfiguredTool } from "bobs-factory-mcp-tools";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runPushEvent } from "../src/factory/PushEvents.js";
import {
	nativeAdapter,
	type TicketSnapshot,
	TicketTracking,
	taskbotAdapter,
	taskbotSource,
} from "../src/factory/TicketTracking.js";
import { askFailureText } from "../src/factory/ViewPresentation.js";
import { humanViewText } from "../src/factory/ViewText.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [],
	services: TicketTracking[] = [],
	servers: FactoryServer[] = [];
const mcpServers: Server[] = [];
const nativeTrackers: LinearIssueTrackerService[] = [];
const releaseGates: (() => void)[] = [];
afterEach(async () => {
	for (const release of releaseGates.splice(0)) release();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const server of servers.splice(0)) await server.stop();
	for (const service of services.splice(0)) service.stop();
	for (const tracker of nativeTrackers.splice(0)) tracker.stopDelivery();
	for (const server of mcpServers.splice(0))
		await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function fixture(
	channel: "taskbot" | "linear" | "mcp" | "linear-budget",
	agent: RuntimeHooks["agent"],
	large = false,
	legacySnapshot?: string,
	children = false,
	assets = false,
) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "human-view-ticket-")));
	homes.push(home);
	if (legacySnapshot) {
		const source = fileURLToPath(
			new URL(
				`./fixtures/taskbot140-legacy-views/${legacySnapshot}/`,
				import.meta.url,
			),
		);
		const copy = (from: string, to: string) => {
			mkdirSync(to, { recursive: true });
			for (const entry of readdirSync(from, { withFileTypes: true })) {
				if (entry.isDirectory())
					copy(join(from, entry.name), join(to, entry.name));
				else
					copyFileSync(
						join(from, entry.name),
						join(to, entry.name.replace(/\.raw$/, "")),
					);
			}
		};
		copy(source, home);
	}

	let failAfterDelivery = false,
		holdRead: ReturnType<typeof deferred> | undefined,
		readEntered: ReturnType<typeof deferred> | undefined,
		holdTranscript: ReturnType<typeof deferred> | undefined,
		transcriptEntered: ReturnType<typeof deferred> | undefined;
	const ticket: TicketSnapshot = {
		id: 77,
		project: "fixture",
		status: "backlog",
		body: "Synthetic scope",
		comments: [],
		attachments: [],
	};
	const ref = {
		...taskbotSource("https://taskbot.example/p/fixture/t/77")!,
		server: "taskbot",
	};
	const awaitHeldRead = async () => {
		if (!holdRead) return;
		const gate = holdRead;
		holdRead = undefined;
		readEntered!.resolve();
		await gate.promise;
	};
	const imageBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
		"base64",
	);
	const imageHash = createHash("sha256").update(imageBytes).digest("hex");
	let image = "";
	const child = deferred();
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Synthetic human decision",
	});
	const session = await (
		await tracker.createAgentSessionOnIssue({ issueId: issue.id })
	).agentSession;
	if (!session) throw new Error("Fixture session missing");
	const taskbotCall = async (tool: string, args: Record<string, unknown>) => {
		if (tool === "get_ticket") {
			await awaitHeldRead();
			return {
				content: [{ type: "text", text: JSON.stringify(ticket) }],
			};
		}
		if (tool === "set_status") {
			ticket.status = String(args.to);
			return { content: [] };
		}
		if (tool === "comment") {
			ticket.comments.push({ body: String(args.body) });
			if (failAfterDelivery) {
				failAfterDelivery = false;
				throw new Error("Synthetic response lost after accepted comment");
			}
			return { content: [] };
		}
		throw new Error(`Unexpected transport ${tool}`);
	};
	let connectionHold:
		| {
				entered: ReturnType<typeof deferred>;
				release: ReturnType<typeof deferred>;
		  }
		| undefined;
	let initializeCount = 0,
		holdInitializeAt = 0;
	const mcpCalls: { tool: string; args: Record<string, unknown> }[] = [];
	let transport: { type: "http"; url: string } | undefined;
	if (channel === "mcp") {
		const server = createServer(async (request, response) => {
			if (request.method !== "POST") {
				response.writeHead(405).end();
				return;
			}
			let raw = "";
			for await (const chunk of request) raw += chunk;
			const message = JSON.parse(raw);
			if (message.method === "notifications/initialized") {
				response.writeHead(202).end();
				return;
			}
			let result: unknown;
			if (message.method === "initialize") {
				initializeCount++;
				if (connectionHold && initializeCount === holdInitializeAt) {
					connectionHold.entered.resolve();
					await connectionHold.release.promise;
				}
				result = {
					protocolVersion: message.params.protocolVersion,
					capabilities: { tools: {} },
					serverInfo: { name: "synthetic-taskbot", version: "1" },
				};
			} else if (message.method === "tools/call") {
				mcpCalls.push({
					tool: message.params.name,
					args: message.params.arguments,
				});
				result = await taskbotCall(
					message.params.name,
					message.params.arguments,
				);
			} else throw new Error(`Unexpected MCP method ${message.method}`);
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
		});
		mcpServers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing local MCP address");
		transport = { type: "http", url: `http://127.0.0.1:${address.port}/mcp` };
	}
	let runtime!: WorkflowRuntime;
	const nativeBodies: string[] = [];
	let nativeHold:
		| {
				entered: ReturnType<typeof deferred>;
				release: ReturnType<typeof deferred>;
		  }
		| undefined;
	let nativeService: LinearIssueTrackerService | undefined,
		nativeClient: LinearClient | undefined;
	if (channel === "linear-budget") {
		nativeClient = new LinearClient({ accessToken: home });
		nativeClient.client.request = async (_document, variables: any) => {
			if (variables.id === "held-budget" && nativeHold) {
				nativeHold.entered.resolve();
				await nativeHold.release.promise;
				return { issue: { id: "held-budget", reactions: [] } };
			}
			if (variables.input) {
				nativeBodies.push(variables.input.content.body);
				return {
					agentActivityCreate: {
						success: true,
						agentActivity: { id: variables.input.id },
						lastSyncId: 1,
					},
				};
			}
			throw new Error("Unexpected native Linear request");
		};
		nativeService = new LinearIssueTrackerService(
			nativeClient,
			undefined,
			undefined,
			{
				factoryHome: home,
				workspaceId: home,
				requestIntervalMs: 0,
				resolveView: (identity, input) => ({
					run: (write) => {
						const run = runtime.get(identity.runId);
						const receipt = run.ticketSync!.receipts.find(
							(entry) => entry.key === identity.receiptKey,
						)!;
						expect(receipt.deliveryId).toBe(input.id);
						expect(receipt.body).toBe(input.content.body);
						return runtime.humanViews.dispatchPublication(run, identity, write);
					},
				}),
			},
		);
		nativeTrackers.push(nativeService);
		tracker.createAgentActivity =
			nativeService.createAgentActivity.bind(nativeService);
		tracker.reconcileAgentActivityDelivery =
			nativeService.reconcileAgentActivityDelivery.bind(nativeService);
	}
	const adapter = !channel.startsWith("linear")
		? taskbotAdapter(
				ref,
				(tool, args) =>
					transport
						? callConfiguredTool(
								transport,
								tool,
								args,
								AbortSignal.timeout(5000),
								home,
							)
						: taskbotCall(tool, args),
				async (tool, args, dispatch) =>
					transport
						? callConfiguredTool(
								transport,
								tool,
								args,
								AbortSignal.timeout(5000),
								home,
								undefined,
								dispatch,
							)
						: (await dispatch.run(() => taskbotCall(tool, args))).value,
			)
		: nativeAdapter(
				{
					provider: "native",
					platform: "linear",
					workspaceId: "fixture",
					id: issue.id,
					url: issue.url,
				},
				tracker,
				{
					getTranscriptSession: async () => {
						if (holdTranscript) {
							const gate = holdTranscript;
							holdTranscript = undefined;
							transcriptEntered!.resolve();
							await gate.promise;
						}
						return session.id;
					},
				},
			);
	const fetchIssue = tracker.fetchIssue.bind(tracker);
	tracker.fetchIssue = async (...args) => {
		await awaitHeldRead();
		return fetchIssue(...args);
	};
	const service = new TicketTracking(
		async () => adapter,
		(run) => runtime.save(run),
		() => {},
		undefined,
		(run, version) => runtime.humanViews.validatePublication(run, version),
		(run, version, write) =>
			runtime.humanViews.dispatchPublication(run, version, write),
	);
	services.push(service);
	const hooks = {
		agent: async (context: Parameters<RuntimeHooks["agent"]>[0]) => {
			if (context.step.id === "view-scope") return { areas: [] };
			if (context.step.id === "view-capture") {
				mkdirSync(context.evidenceDir, { recursive: true });
				image = join(context.evidenceDir, "display.png");
				writeFileSync(image, imageBytes);
				return {
					screenshots: [
						{
							path: image,
							caption: "Retained capture",
							area: "Review",
							imageSha256: imageHash,
						},
					],
					unavailable: [],
				};
			}
			if (context.step.id !== "child-work") return agent(context);
			context.signal.addEventListener("abort", () => child.resolve(), {
				once: true,
			});
			await child.promise;
			return { done: true };
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async () => {
			throw new Error("Unexpected tool");
		},
		track: (
			run: FactoryRun,
			milestone: Parameters<TicketTracking["record"]>[1],
		) => service.record(run, milestone),
	};
	runtime = new WorkflowRuntime(home, hooks);
	runtimes.push(runtime);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...(children
			? [
					{
						id: "ticket-child",
						name: "Controlled child",
						stepConfigVersion: "step-config-v1",
						allowedTriggers: ["workflow"],
						steps: [
							{
								id: "child-work",
								name: "Child",
								type: "agent",
								prompt: "Controlled child",
							},
						],
					},
				]
			: []),
		{
			id: "ticket-views",
			name: "Ticket views",
			stepConfigVersion: "step-config-v1",
			steps: [
				...(assets
					? [
							{
								id: "view-scope",
								name: "Scope",
								type: "agent",
								prompt: "Controlled scope",
							},
							{
								id: "view-capture",
								name: "Capture",
								type: "agent",
								prompt: "Controlled capture",
								reads: { scope: "view-scope" },
								output: { format: "capture-v1" },
								checks: ["capture-evidence"],
							},
						]
					: []),
				...(children
					? [
							{
								id: "launch",
								name: "Launch",
								type: "launch-runs",
								launchRuns: {
									items: {
										values: [
											{ id: "a", title: "Child", prompt: "Controlled child" },
										],
									},
									workflow: "ticket-child",
									wait: false,
									inputMapping: { prompt: "/prompt" },
								},
							},
						]
					: []),
				{
					id: "choose",
					name: "Choose safely",
					type: "decide",
					reads: children ? { children: "@childRuns" } : {},
					notifications: { push: "view-text" },
					view: {
						version: "view-v1",
						components: assets
							? [
									{
										id: "screens",
										type: "screenshots",
										data: {
											literal: {
												items: [
													{
														index: 0,
														sha256: imageHash,
														alt: "Retained screenshot",
													},
												],
											},
										},
									},
								]
							: children
								? [
										{
											id: "children",
											type: "runList",
											data: { path: "/inputs/children" },
										},
									]
								: [
										{
											id: "brief",
											type: "markdown",
											data: { literal: { text: "Public artifact" } },
										},
									],
					},
					decide: {
						items: {
							literal: Array.from({ length: large ? 13 : 1 }, (_, i) => ({
								id: `item${i}`,
								title: `Item ${i}`,
								body: large ? "B".repeat(8000) : "Public context",
							})),
						},
						body: "/body",
						actions: [{ id: "skip", label: "Skip" }],
						ask: { prompt: "Explain supplied context only" },
					},
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const run = legacySnapshot
		? [...runtime.runs.values()].find(
				(run) => run.workflow.id === "ticket-views",
			)!
		: runtime.create({
				repositoryId: "fixture",
				workspace: home,
				input: "Synthetic ticket",
				workflow: definitions.at(-1)!,
				workflowDefinitions: definitions,
				triggerOrigin: { type: "manual", workflowId: "ticket-views" },
			});
	// Trusted originating-ticket binding, before execution, as in EdgeWorker admission.
	if (!legacySnapshot)
		run.ticketReference = !channel.startsWith("linear")
			? ref
			: {
					provider: "native",
					platform: "linear",
					workspaceId: "fixture",
					id: issue.id,
					url: issue.url,
				};
	void runtime.launch(run);
	const bodies = async () =>
		!channel.startsWith("linear")
			? ticket.comments.map((c) => c.body)
			: channel === "linear-budget"
				? nativeBodies
				: (await tracker.listAgentActivities(session.id)).map((a) => a.content);
	const displays = async () =>
		(await bodies()).filter((body) => body.includes("Decision batch:"));
	await waitFor(async () => expect((await displays()).length).toBe(1));
	return {
		home,
		get image() {
			return image;
		},
		child,
		service,
		hooks,
		run,
		get runtime() {
			return runtime;
		},
		displays,
		mcpCalls,
		async blockNativeBudget() {
			nativeHold = { entered: deferred(), release: deferred() };
			releaseGates.push(() => nativeHold!.release.resolve());
			const pending = nativeClient!.issue("held-budget");
			await nativeHold.entered.promise;
			return {
				release: async () => {
					nativeHold!.release.resolve();
					await pending;
				},
			};
		},
		nativeQueued(digest: string) {
			const directory = join(home, "state", "linear-activity-delivery");
			return readdirSync(directory).some(
				(file) =>
					file.endsWith(".json") &&
					JSON.parse(readFileSync(join(directory, file), "utf8")).records.some(
						(entry: any) =>
							entry.view?.digest === digest && entry.status === "pending",
					),
			);
		},
		blockNextConnection() {
			const hold = { entered: deferred(), release: deferred() };
			connectionHold = hold;
			releaseGates.push(() => hold.release.resolve());
			holdInitializeAt = initializeCount + 3;
			return {
				entered: hold.entered.promise,
				release: () => hold.release.resolve(),
			};
		},
		loseResponse() {
			failAfterDelivery = true;
		},
		blockNextRead() {
			const gate = deferred(),
				entered = deferred();
			holdRead = gate;
			readEntered = entered;
			return { release: () => gate.resolve(), entered: entered.promise };
		},
		blockNextTranscript() {
			const gate = deferred(),
				entered = deferred();
			holdTranscript = gate;
			transcriptEntered = entered;
			return { release: () => gate.resolve(), entered: entered.promise };
		},
		async reconstruct() {
			await runtime.flush(run.id);
			await runtime.shutdown();
			runtime = new WorkflowRuntime(home, hooks);
			runtimes.push(runtime);
			const restored = runtime.get(run.id);
			void runtime.launch(restored);
			await waitFor(() => expect(restored.status).toBe("waiting"));
			await service.flush(restored);
			return restored;
		},
	};
}
async function ask(
	f: Awaited<ReturnType<typeof fixture>>,
	question: string,
	run = f.run,
) {
	const snapshot = f.runtime.humanViews.snapshot(run)!;
	return f.runtime.askView(run.id, {
		batchId: snapshot.id,
		digest: snapshot.digest,
		itemId: "item0",
		question,
		requestId: randomUUID(),
	});
}
const accepted = (run: FactoryRun) => ({
	batchId: run.viewDecision!.id,
	digest: run.viewDecision!.digest,
	accepted: true,
	choices: run.viewDecision!.items!.map((item) => ({
		itemId: item.id,
		action: "skip",
	})),
});

it.each([
	"taskbot",
	"linear",
] as const)("publishes current %s discussion at admission and completion, retains history and deduplicates reconstruction", async (channel) => {
	const answer = deferred<string>();
	const f = await fixture(channel, async () => answer.promise, true);
	const initial = f.run.viewDecision!,
		initialBody = (await f.displays())[0]!;
	await ask(f, "CURRENT DISCUSSION QUESTION");
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(f.run.viewDecision!.digest),
	);
	const pending = (await f.displays()).at(-1)!;
	expect(pending).toContain("pending");
	expect(pending).toContain("CURRENT DISCUSSION QUESTION");
	expect(pending).toContain("INCOMPLETE");
	expect(pending).toContain("/view-answer");
	expect(pending.length).toBeLessThan(101000);
	answer.resolve("CURRENT DISCUSSION ANSWER");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![0]!.status).toBe("answered"),
	);
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(f.run.viewDecision!.digest),
	);
	const complete = (await f.displays()).at(-1)!;
	expect(complete).toContain("CURRENT DISCUSSION ANSWER");
	expect(complete).toContain("answered");
	expect((await f.displays())[0]).toBe(initialBody);
	await expect(
		f.runtime.answerView(f.run.id, {
			...accepted(f.run),
			digest: initial.digest,
		}),
	).rejects.toThrow("changed");
	const count = (await f.displays()).length,
		digest = f.run.viewDecision!.digest;
	const restored = await f.reconstruct();
	expect(restored.viewDecision!.digest).toBe(digest);
	expect((await f.displays()).length).toBe(count);
	await f.runtime.replyView(
		restored.id,
		`/view-answer ${JSON.stringify(accepted(restored))}`,
	);
	await waitFor(() => expect(restored.status).toBe("completed"));
	expect(restored.viewRecords![0]!.answer!.request.digest).toBe(digest);
});

it("reconciles a lost response by the exact current version marker and skips obsolete versions after a delayed adapter read", async () => {
	const answer = deferred<string>();
	const f = await fixture("taskbot", async () => answer.promise);
	f.loseResponse();
	await ask(f, "RETRY CURRENT QUESTION");
	await waitFor(() =>
		expect(f.run.ticketSync!.receipts.some((r) => r.error)).toBe(true),
	);
	const count = (await f.displays()).length;
	await f.service.flush(f.run);
	expect((await f.displays()).length).toBe(count);
	answer.resolve("RECONCILED ANSWER");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![0]!.status).toBe("answered"),
	);
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(f.run.viewDecision!.digest),
	);
	const gate = f.blockNextRead();
	await ask(f, "SKIP OBSOLETE PENDING");
	await gate.entered;
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![1]!.status).toBe("answered"),
	);
	const current = f.run.viewDecision!.digest;
	gate.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(current),
	);
	const receipts = f.run.ticketSync!.receipts.filter((r) => r.viewDecision);
	expect(
		receipts.some((r) => r.superseded && r.viewDecision!.digest !== current),
	).toBe(true);
	const restored = await f.reconstruct();
	expect(restored.viewDecision!.digest).toBe(current);
	const finalCount = (await f.displays()).length;
	await f.service.flush(restored);
	expect((await f.displays()).length).toBe(finalCount);
});

it("retains real native startup diagnostics privately while API, text, actual ticket and opt-in push show safe recovery guidance across restart", async () => {
	let diagnostic = "";
	let f: Awaited<ReturnType<typeof fixture>>;
	f = await fixture("taskbot", async () => {
		const cwd = join(f.home, "empty-private-cwd");
		mkdirSync(cwd, { mode: 0o700 });
		const runner = new CodexRunner({
			factoryHome: f.home,
			workingDirectory: cwd,
			toolProfile: "context-only",
			codexHome: join(f.home, "codex"),
			codexPath: join(f.home, "private-provider-name", "codex-unavailable"),
			childEnvironment: { HOME: f.home, PATH: "/usr/bin:/bin" },
			mcpConfig: { "factory-context": { command: "/usr/bin/true" } },
		});
		runner.on("error", () => {});
		await runner.start("No executable exists; zero model calls");
		const result = runner
			.getMessages()
			.filter((m) => m.type === "result")
			.at(-1)!;
		expect(result).toMatchObject({ is_error: true });
		// Same failure wrapper as EdgeWorker's actual production agent step.
		diagnostic = `Agent step failed: ${publicFailure(JSON.stringify(result))}`;
		throw new Error(diagnostic);
	});
	const before = f.run.viewDecision!.digest;
	await ask(f, "Explain unavailable Ask safely");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![0]!.status).toBe("failed"),
	);
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(f.run.viewDecision!.digest),
	);
	expect(diagnostic).toContain("private-provider-name");
	expect(f.run.viewRecords![0]!.snapshot.threads!.item0![0]!.error).toBe(
		diagnostic,
	);
	for (const run of [f.run, await f.reconstruct()]) {
		const snapshot = f.runtime.humanViews.snapshot(run)!;
		expect(snapshot.digest).not.toBe(before);
		expect(snapshot.threads!.item0![0]!.error).toBe(askFailureText);
		const server = new FactoryServer(f.runtime, {
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("No starts");
			},
			stop: (id) => f.runtime.stop(id),
		});
		servers.push(server);
		const texts = [
			humanViewText(snapshot),
			humanViewText(run.viewRecords![0]!.snapshot),
			f.runtime.humanViews.displayText(run),
			JSON.stringify(runPushEvent(run)),
			...(await f.displays()),
		];
		for (const suffix of ["", "?view=dashboard", "?view=focus"]) {
			const response = await server.app.inject({
				url: `/api/runs/${run.id}${suffix}`,
			});
			expect(response.statusCode).toBe(200);
			texts.push(response.body);
			expect(response.json()).not.toHaveProperty("viewRecords");
		}
		for (const text of texts) {
			expect(text).not.toContain("private-provider-name");
			expect(text).not.toContain("codex-unavailable");
			expect(text).not.toContain(join(f.home, "private-provider-name"));
		}
		expect(f.runtime.humanViews.displayText(run)).toContain(
			"Private agent diagnostics were retained",
		);
		expect((await f.displays()).at(-1)).toContain(
			"Private agent diagnostics were retained",
		);
		expect(runPushEvent(run)!.viewText).toContain("Private agent diagnostics");
		expect(run.viewRecords![0]!.snapshot.threads!.item0![0]!.error).toBe(
			diagnostic,
		);
	}
});

it.each([
	"notified-crash-gap",
	"unsent-initial-after-ask",
])("reconstructs actual original339 persisted %s without losing or replaying obsolete publication", async (mode) => {
	const f = await fixture(
		"taskbot",
		async () => {
			throw new Error("Completed original Ask must not rerun");
		},
		false,
		mode,
	);
	const receipt = f.run.ticketSync!.receipts.find(
		(r) => r.key === `view:${f.run.viewDecision!.id}`,
	);
	if (mode === "unsent-initial-after-ask") {
		expect(receipt?.superseded).toBe(true);
		expect(receipt?.delivered).not.toBe(true);
		const current = (await f.displays()).at(-1)!;
		expect(current).toContain("ORIGINAL COMPLETED ASK DISCUSSION");
		expect(current).toContain(f.run.viewDecision!.digest);
		const oldDigest = receipt!.body
			.split("Displayed digest: ")[1]!
			.split("\n", 1)[0]!;
		await expect(
			f.runtime.answerView(f.run.id, { ...accepted(f.run), digest: oldDigest }),
		).rejects.toThrow("changed");
	} else {
		expect(f.run.viewRecords![0]!.notified).toBe(true);
		expect(
			f.run.ticketSync!.receipts.filter((r) => r.viewDecision),
		).toHaveLength(1);
	}
	expect((await f.displays()).length).toBe(1);
	const restored = await f.reconstruct();
	expect((await f.displays()).length).toBe(1);
	await f.runtime.answerView(restored.id, accepted(restored));
	await waitFor(() => expect(restored.status).toBe("completed"));
});

it("coalesces concurrent Ask completions by the current digest without holding a model wait lock", async () => {
	const a = deferred<string>(),
		b = deferred<string>();
	const f = await fixture("taskbot", async (context) =>
		(context.input as { question: string }).question === "FIRST HELD QUESTION"
			? a.promise
			: b.promise,
	);
	await ask(f, "FIRST HELD QUESTION");
	await ask(f, "SECOND HELD QUESTION");
	expect(f.run.viewDecision!.threads!.item0!.map((t) => t.status)).toEqual([
		"pending",
		"pending",
	]);
	b.resolve("SECOND OUT OF ORDER ANSWER");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![1]!.status).toBe("answered"),
	);
	a.resolve("FIRST LATE ANSWER");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![0]!.status).toBe("answered"),
	);
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain(f.run.viewDecision!.digest),
	);
	const body = (await f.displays()).at(-1)!;
	expect(body).toContain("SECOND OUT OF ORDER ANSWER");
	expect(body).toContain("FIRST LATE ANSWER");
	const count = (await f.displays()).length;
	await f.reconstruct();
	expect((await f.displays()).length).toBe(count);
});

it("projects an actual old persisted raw native failure safely and renews only its pending display digest", async () => {
	const provenance = JSON.parse(
		readFileSync(
			new URL(
				"./fixtures/taskbot140-legacy-views/provenance-native-error.json.raw",
				import.meta.url,
			),
			"utf8",
		),
	);
	const oldDigest = provenance.fixtures[0].digest;
	const f = await fixture(
		"taskbot",
		async () => {
			throw new Error("Finished original native failure must not rerun");
		},
		false,
		"raw-native-failure",
	);
	const record = f.run.viewRecords![0]!,
		diagnostic = record.snapshot.threads!.item0![0]!.error!;
	expect(diagnostic).toContain("private-provider-name");
	expect(f.run.viewDecision!.digest).not.toBe(oldDigest);
	const current = f.runtime.humanViews.snapshot(f.run)!;
	expect(current.threads!.item0![0]!.error).toBe(askFailureText);
	const server = new FactoryServer(f.runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("No starts");
		},
		stop: (id) => f.runtime.stop(id),
	});
	servers.push(server);
	for (const suffix of ["", "?view=dashboard", "?view=focus"]) {
		const response = await server.app.inject({
			url: `/api/runs/${f.run.id}${suffix}`,
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).not.toContain("private-provider-name");
		expect(response.json().viewDecision.digest).toBe(current.digest);
	}
	expect(humanViewText(record.snapshot)).not.toContain("private-provider-name");
	expect((await f.displays()).at(-1)).toContain(current.digest);
	await expect(
		f.runtime.answerView(f.run.id, { ...accepted(f.run), digest: oldDigest }),
	).rejects.toThrow("changed");
	await f.runtime.answerView(f.run.id, accepted(f.run));
	await waitFor(() => expect(f.run.status).toBe("completed"));
	expect(record.answer!.request.digest).toBe(current.digest);
	expect(record.snapshot.threads!.item0![0]!.error).toBe(diagnostic);
});

it.each([
	"taskbot",
	"linear",
] as const)("suppresses a source-only obsolete %s write after an actual held provider read and renews without waiting for Ask", async (channel) => {
	const answer = deferred<string>();
	const f = await fixture(
		channel,
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Stopped historical Ask"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		true,
	);
	const initialBody = (await f.displays())[0]!;
	const held = f.blockNextRead();
	await ask(f, "Explain child progress while provider read is held");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	f.child.resolve();
	await waitFor(() =>
		expect(Object.values(f.run.launchActions!)[0]!.progress.a!.status).toBe(
			"completed",
		),
	);
	// Real child progress changed; the saved public snapshot has not been rotated.
	expect(f.run.viewDecision!.digest).toBe(pending.digest);
	held.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain("[completed]"),
	);
	expect(
		(await f.displays())
			.slice(1)
			.every((body) => !body.includes(pending.digest)),
	).toBe(true);
	expect((await f.displays())[0]).toBe(initialBody);
	expect(f.run.viewDecision!.id).not.toBe(pending.id);
	const obsolete = f.run.ticketSync!.receipts.find(
		(receipt) => receipt.viewDecision?.digest === pending.digest,
	)!;
	expect(obsolete.superseded).toBe(true);
	expect(obsolete.delivered).not.toBe(true);
	await expect(
		f.runtime.answerView(f.run.id, {
			...accepted(f.run),
			batchId: pending.id,
			digest: pending.digest,
		}),
	).rejects.toThrow("superseded");
	const renewed = f.run.viewDecision!,
		count = (await f.displays()).length;
	await f.runtime.replyView(
		f.run.id,
		`/view-answer ${JSON.stringify(accepted(f.run))}`,
	);
	await waitFor(() => expect(f.run.status).toBe("completed"));
	// Late native Ask result stays on the historical record and cannot republish it.
	answer.resolve("Historical child explanation");
	await waitFor(() =>
		expect(
			f.run.viewRecords!.find((r) => r.snapshot.id === pending.id)!.snapshot
				.threads!.item0![0]!.status,
		).toBe("answered"),
	);
	expect(f.run.viewDecision!.id).toBe(renewed.id);
	expect((await f.displays()).length).toBe(count);
	await f.service.flush(f.run);
	expect((await f.displays()).length).toBe(count);
});

it("refuses changed real protected asset bytes at the final write boundary without rewriting accepted capture history", async () => {
	const answer = deferred<string>();
	const f = await fixture(
		"taskbot",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Stopped"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		false,
		true,
	);
	const capture = JSON.stringify(f.run.outputs["view-capture"]);
	const original = (await f.displays())[0]!;
	const held = f.blockNextRead();
	await ask(f, "Explain the displayed screenshot");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	const changed = readFileSync(f.image);
	changed[changed.length - 1] ^= 1;
	writeFileSync(f.image, changed);
	held.release();
	await waitFor(() => expect(f.run.status).toBe("failed"));
	await f.service.flush(f.run);
	expect(await f.displays()).toEqual([original]);
	expect(JSON.stringify(f.run.outputs["view-capture"])).toBe(capture);
	expect(
		f.run.viewRecords!.find((r) => r.snapshot.id === pending.id)!.superseded,
	).toBe(true);
	expect(
		f.run.ticketSync!.receipts.find(
			(r) => r.viewDecision?.digest === pending.digest,
		)!.superseded,
	).toBe(true);
	await expect(
		f.runtime.answerView(f.run.id, {
			batchId: pending.id,
			digest: pending.digest,
			accepted: true,
			choices: [{ itemId: "item0", action: "skip" }],
		}),
	).rejects.toThrow("superseded");
});

it("retains a source-renewed outgoing version through real persisted reconstruction without replaying the obsolete intent", async () => {
	const answer = deferred<string>();
	const f = await fixture(
		"taskbot",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Stopped historical Ask"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		true,
	);
	const held = f.blockNextRead();
	await ask(f, "Question before source renewal and restart");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	f.child.resolve();
	await waitFor(() =>
		expect(Object.values(f.run.launchActions!)[0]!.progress.a!.status).toBe(
			"completed",
		),
	);
	held.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain("[completed]"),
	);
	const current = structuredClone(f.run.viewDecision!),
		history = await f.displays();
	const restored = await f.reconstruct();
	expect(restored.viewDecision!.id).toBe(current.id);
	expect(restored.viewDecision!.digest).toBe(current.digest);
	expect(await f.displays()).toEqual(history);
	expect(
		restored.ticketSync!.receipts.find(
			(r) => r.viewDecision?.digest === pending.digest,
		)!.superseded,
	).toBe(true);
	await expect(
		f.runtime.answerView(restored.id, {
			...accepted(restored),
			batchId: pending.id,
			digest: pending.digest,
		}),
	).rejects.toThrow("superseded");
	await f.runtime.replyView(
		restored.id,
		`/view-answer ${JSON.stringify(accepted(restored))}`,
	);
	await waitFor(() => expect(restored.status).toBe("completed"));
	expect(restored.viewRecords!.at(-1)!.answer!.request.digest).toBe(
		current.digest,
	);
});

it("rechecks Linear source ownership after asynchronous transcript preparation and before activity creation", async () => {
	const answer = deferred<string>();
	const f = await fixture(
		"linear",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Stopped"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		true,
	);
	const initial = (await f.displays())[0]!;
	const held = f.blockNextTranscript();
	await ask(f, "Explain child while transcript preparation is held");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	f.child.resolve();
	await waitFor(() =>
		expect(Object.values(f.run.launchActions!)[0]!.progress.a!.status).toBe(
			"completed",
		),
	);
	held.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain("[completed]"),
	);
	expect((await f.displays())[0]).toBe(initial);
	expect(
		(await f.displays()).every((body) => !body.includes(pending.digest)),
	).toBe(true);
	expect(
		f.run.ticketSync!.receipts.find(
			(r) => r.viewDecision?.digest === pending.digest,
		)!.superseded,
	).toBe(true);
	await f.runtime.replyView(
		f.run.id,
		`/view-answer ${JSON.stringify(accepted(f.run))}`,
	);
	await waitFor(() => expect(f.run.status).toBe("completed"));
	answer.resolve("Historical explanation");
});

it("suppresses an obsolete actual tools/call after held HTTP initialize and real child completion", async () => {
	const answer = deferred<string>();
	const f = await fixture(
		"mcp",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Historical Ask"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		true,
	);
	const original = (await f.displays())[0]!;
	const held = f.blockNextConnection();
	await ask(f, "Explain the child during MCP initialization");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	f.child.resolve();
	await waitFor(() =>
		expect(Object.values(f.run.launchActions!)[0]!.progress.a!.status).toBe(
			"completed",
		),
	);
	expect(f.run.viewDecision!.digest).toBe(pending.digest);
	held.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain("[completed]"),
	);
	expect(
		f.mcpCalls
			.filter((call) => call.tool === "comment")
			.every((call) => !String(call.args.body).includes(pending.digest)),
	).toBe(true);
	expect((await f.displays())[0]).toBe(original);
	const obsolete = f.run.ticketSync!.receipts.find(
		(receipt) => receipt.viewDecision?.digest === pending.digest,
	)!;
	expect(obsolete.superseded).toBe(true);
	expect(obsolete.delivered).not.toBe(true);
	await expect(
		f.runtime.replyView(
			f.run.id,
			`/view-answer ${JSON.stringify({ ...accepted(f.run), batchId: pending.id, digest: pending.digest })}`,
		),
	).rejects.toThrow(/superseded|changed/);
	answer.resolve("Historical answer");
	await f.runtime.flush(f.run.id);
	const restored = await f.reconstruct();
	await f.runtime.replyView(
		restored.id,
		`/view-answer ${JSON.stringify(accepted(restored))}`,
	);
	await waitFor(() => expect(restored.status).toBe("completed"));
	expect(
		restored.viewRecords!.find((record) => record.snapshot.id === pending.id)!
			.superseded,
	).toBe(true);
});

it("carries current runtime authority through the native durable outbox and a held shared budget", async () => {
	const answer = deferred<string>();
	const f = await fixture(
		"linear-budget",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => answer.resolve("Historical Ask"),
				{ once: true },
			);
			return answer.promise;
		},
		false,
		undefined,
		true,
	);
	const original = (await f.displays())[0]!;
	const held = await f.blockNativeBudget();
	await ask(f, "Explain pending child while native request budget is held");
	const pending = structuredClone(f.run.viewDecision!);
	await waitFor(() => expect(f.nativeQueued(pending.digest)).toBe(true));
	f.child.resolve();
	await waitFor(() =>
		expect(Object.values(f.run.launchActions!)[0]!.progress.a!.status).toBe(
			"completed",
		),
	);
	expect(f.run.viewDecision!.digest).toBe(pending.digest);
	await held.release();
	await waitFor(async () =>
		expect((await f.displays()).at(-1)).toContain("[completed]"),
	);
	expect(
		(await f.displays())
			.slice(1)
			.every((body) => !body.includes(pending.digest)),
	).toBe(true);
	expect((await f.displays())[0]).toBe(original);
	const obsolete = f.run.ticketSync!.receipts.find(
		(entry) => entry.viewDecision?.digest === pending.digest,
	)!;
	expect(obsolete.superseded).toBe(true);
	expect(obsolete.delivered).not.toBe(true);
	answer.resolve("Historical completion");
	await f.runtime.flush(f.run.id);
	const restored = await f.reconstruct();
	await f.runtime.replyView(
		restored.id,
		`/view-answer ${JSON.stringify(accepted(restored))}`,
	);
	await waitFor(() => expect(restored.status).toBe("completed"));
});

it("does not hold the human transition while a legitimately dispatched response is pending", async () => {
	const f = await fixture("taskbot", async () => "Current bounded answer");
	const remote = deferred<string>();
	const initial = f.run.viewDecision!;
	const dispatched = await f.runtime.humanViews.dispatchPublication(
		f.run,
		{ batchId: initial.id, digest: initial.digest },
		() => remote.promise,
	);
	await ask(f, "Ask while the external response is pending");
	await waitFor(() =>
		expect(f.run.viewDecision!.threads!.item0![0]!.status).toBe("answered"),
	);
	expect(f.run.viewDecision!.digest).not.toBe(initial.digest);
	remote.resolve("Original dispatched response");
	expect(await dispatched.value).toBe("Original dispatched response");
});

it("revalidates protected real-file assets after actual MCP initialization before any outgoing comment", async () => {
	const reply = deferred<string>();
	const f = await fixture(
		"mcp",
		async (context) => {
			context.signal.addEventListener(
				"abort",
				() => reply.resolve("Historical Ask"),
				{ once: true },
			);
			return reply.promise;
		},
		false,
		undefined,
		false,
		true,
	);
	const initial = (await f.displays())[0]!;
	const held = f.blockNextConnection();
	await ask(f, "Review the captured asset while connection setup is held");
	await held.entered;
	const pending = structuredClone(f.run.viewDecision!);
	writeFileSync(f.image, "Changed actual protected asset");
	held.release();
	await waitFor(() =>
		expect(
			f.run.ticketSync!.receipts.find(
				(entry) => entry.viewDecision?.digest === pending.digest,
			)?.superseded,
		).toBe(true),
	);
	expect(await f.displays()).toEqual([initial]);
	expect(
		f.mcpCalls
			.filter((call) => call.tool === "comment")
			.every((call) => !String(call.args.body).includes(pending.digest)),
	).toBe(true);
	reply.resolve("Historical Ask");
});
