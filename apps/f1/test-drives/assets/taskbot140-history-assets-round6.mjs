import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd(),
	out = realpathSync(
		mkdtempSync(join(tmpdir(), "f1-taskbot140-assets-round6-")),
	);
const { execFileSync } = await import("node:child_process");
const git = (...args) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
assert.equal(process.env.F1_AGENT_MODE, "mock");
if (process.env.F1_EXPECTED_SOURCE_COMMIT) {
	assert.equal(head, process.env.F1_EXPECTED_SOURCE_COMMIT);
	assert.equal(git("status", "--short"), "");
}
writeFileSync(
	join(out, "executed-driver.mjs"),
	readFileSync(import.meta.filename),
);
const { WorkflowRuntime } = await import(
	`${root}/packages/edge-worker/dist/factory/WorkflowRuntime.js`
);
const { defaultWorkflows } = await import(
	`${root}/packages/edge-worker/dist/factory/defaultWorkflows.js`
);
const { validateWorkflows } = await import(
	`${root}/packages/edge-worker/dist/factory/Workflow.js`
);
const { TicketTracking, taskbotAdapter, taskbotSource, nativeAdapter } =
	await import(`${root}/packages/edge-worker/dist/factory/TicketTracking.js`);
const { CLIIssueTrackerService, publicFailure } = await import(
	`${root}/packages/core/dist/index.js`
);
const { CodexRunner } = await import(
	`${root}/packages/codex-runner/dist/CodexRunner.js`
);
const { viewRecordDigest } = await import(
	`${root}/packages/edge-worker/dist/factory/ViewPresentation.js`
);
const { runPushEvent } = await import(
	`${root}/packages/edge-worker/dist/factory/PushEvents.js`
);
const wait = async (fn) => {
	const end = Date.now() + 15000;
	while (!(await fn())) {
		if (Date.now() > end) throw Error("Probe timeout");
		await new Promise((r) => setTimeout(r, 10));
	}
};
const defer = () => {
	let resolve;
	const promise = new Promise((r) => (resolve = r));
	return { promise, resolve };
};
const { callConfiguredTool } = await import(
	`${root}/packages/mcp-tools/dist/callConfiguredTool.js`
);
const _receipt = { head, cases: [] };
async function fixture(channel = "taskbot", children = true) {
	const home = realpathSync(
			mkdtempSync(join(tmpdir(), "taskbot140-review-r5-probe-")),
		),
		childGate = defer(),
		askGate = defer();
	let image, askContext;
	const imageBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
			"base64",
		),
		imageHash = createHash("sha256").update(imageBytes).digest("hex");
	let readHold,
		transcriptHold,
		handshakeHold,
		admissionHold,
		initCount = 0,
		holdInitializeAt = 0,
		diagnostic = "",
		mode = "held",
		runtime;
	const ticket = {
		id: 1,
		project: "synthetic",
		status: "backlog",
		body: "Public scope",
		comments: [],
		attachments: [],
	};
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Synthetic reviewer decision",
	});
	const session = await (
		await tracker.createAgentSessionOnIssue({ issueId: issue.id })
	).agentSession;
	assert(session);
	const read = async () => {
		if (readHold) {
			const h = readHold;
			readHold = undefined;
			h.entered.resolve();
			await h.release.promise;
		}
	};
	const fetchIssue = tracker.fetchIssue.bind(tracker);
	tracker.fetchIssue = async (...args) => {
		await read();
		return fetchIssue(...args);
	};
	const taskbotRef = {
		...taskbotSource("https://taskbot.example/p/synthetic/t/1"),
		server: "taskbot",
	};
	const nativeRef = {
		provider: "native",
		platform: "linear",
		workspaceId: "synthetic",
		id: issue.id,
		url: issue.url,
	};
	const ref = channel === "linear" ? nativeRef : taskbotRef;
	const calls = [];
	const dispatch = async (tool, args) => {
		calls.push({ at: Date.now(), tool, args });
		if (tool === "get_ticket")
			return { content: [{ type: "text", text: JSON.stringify(ticket) }] };
		if (tool === "comment") {
			ticket.comments.push({ body: args.body });
			return { content: [] };
		}
		if (tool === "set_status") {
			ticket.status = args.to;
			return { content: [] };
		}
		throw Error(tool);
	};
	const server = createServer(async (req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const msg = JSON.parse(raw);
		if (msg.method === "notifications/initialized") {
			res.writeHead(202);
			res.end();
			return;
		}
		let result;
		if (msg.method === "initialize") {
			initCount++;
			if (handshakeHold && initCount === holdInitializeAt) {
				const h = handshakeHold;
				handshakeHold = undefined;
				h.entered.resolve();
				await h.release.promise;
			}
			result = {
				protocolVersion: msg.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "synthetic-taskbot", version: "1" },
			};
		} else if (msg.method === "tools/call")
			result = await dispatch(msg.params.name, msg.params.arguments);
		else throw Error(msg.method);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const transport = {
		type: "http",
		url: `http://127.0.0.1:${server.address().port}/mcp`,
	};
	const adapter =
		channel === "mcp"
			? taskbotAdapter(
					ref,
					(tool, args) =>
						callConfiguredTool(
							transport,
							tool,
							args,
							new AbortController().signal,
							home,
						),
					async (tool, args, control) => {
						if (admissionHold) {
							const h = admissionHold;
							admissionHold = undefined;
							h.entered.resolve();
							await h.release.promise;
						}
						return callConfiguredTool(
							transport,
							tool,
							args,
							AbortSignal.timeout(15000),
							home,
							undefined,
							control,
						);
					},
				)
			: channel === "taskbot"
				? taskbotAdapter(ref, async (tool, args) => {
						if (tool === "get_ticket") {
							await read();
							return {
								content: [{ type: "text", text: JSON.stringify(ticket) }],
							};
						}
						if (tool === "comment") {
							ticket.comments.push({ body: args.body });
							return { content: [] };
						}
						if (tool === "set_status") {
							ticket.status = args.to;
							return { content: [] };
						}
						throw Error(tool);
					})
				: nativeAdapter(nativeRef, tracker, {
						getTranscriptSession: async () => {
							if (transcriptHold) {
								const h = transcriptHold;
								transcriptHold = undefined;
								h.entered.resolve();
								await h.release.promise;
							}
							return session.id;
						},
					});
	const service = new TicketTracking(
		async () => adapter,
		(run) => runtime.save(run),
		() => {},
		undefined,
		(run, version) => runtime.humanViews.validatePublication(run, version),
		(run, version, write) =>
			runtime.humanViews.dispatchPublication(run, version, write),
	);
	const hooks = {
		agent: async (context) => {
			if (context.step.id === "scope") return { areas: [] };
			if (context.step.id === "capture") {
				mkdirSync(context.evidenceDir, { recursive: true });
				image = join(context.evidenceDir, "display.png");
				writeFileSync(image, imageBytes);
				return {
					screenshots: [
						{
							path: image,
							caption: "Original",
							area: "Review",
							imageSha256: imageHash,
						},
					],
					unavailable: [],
				};
			}
			if (context.contextAssistance) askContext = context;
			if (context.step.id === "child") {
				context.signal.addEventListener("abort", () => childGate.resolve(), {
					once: true,
				});
				await childGate.promise;
				return { done: true };
			}
			if (mode === "held") {
				context.signal.addEventListener("abort", () => askGate.resolve(), {
					once: true,
				});
				await askGate.promise;
				return "Public held answer";
			}
			if (mode === "success") return "Public subsequent answer";
			const cwd = join(home, "empty-private-cwd");
			mkdirSync(cwd, { recursive: true, mode: 0o700 });
			const runner = new CodexRunner({
				workingDirectory: cwd,
				factoryHome: home,
				toolProfile: "context-only",
				codexHome: join(home, "codex"),
				codexPath: join(home, "private-provider-name", "codex-unavailable"),
				childEnvironment: { HOME: home, PATH: "/usr/bin:/bin" },
				mcpConfig: { "factory-context": { command: "/usr/bin/true" } },
			});
			runner.on("error", () => {});
			await runner.start("Unavailable executable; no model");
			const result = runner.getMessages().findLast((m) => m.type === "result");
			assert(result.is_error);
			diagnostic = `Agent step failed: ${publicFailure(JSON.stringify(result))}`;
			throw Error(diagnostic);
		},
		tool: async () => {
			throw Error("Unexpected tool");
		},
		script: async () => {
			throw Error("Unexpected script");
		},
		track: (run, m) => service.record(run, m),
	};
	runtime = new WorkflowRuntime(home, hooks);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...(children
			? [
					{
						id: "child-recipe",
						name: "Child",
						stepConfigVersion: "step-config-v1",
						allowedTriggers: ["workflow"],
						steps: [
							{
								id: "child",
								name: "Child",
								type: "agent",
								prompt: "Controlled child",
							},
						],
					},
				]
			: []),
		{
			id: "probe",
			name: "Probe",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "scope",
					name: "Scope",
					type: "agent",
					prompt: "Controlled scope",
				},
				{
					id: "capture",
					name: "Capture",
					type: "agent",
					prompt: "Controlled capture",
					reads: { scope: "scope" },
					output: { format: "capture-v1" },
					checks: ["capture-evidence"],
				},
				...(children
					? [
							{
								id: "launch",
								name: "Launch",
								type: "launch-runs",
								launchRuns: {
									items: {
										values: [{ id: "a", title: "Child", prompt: "Child" }],
									},
									workflow: "child-recipe",
									wait: false,
									inputMapping: { prompt: "/prompt" },
								},
							},
						]
					: []),
				{
					id: "choose",
					name: "Choose",
					type: "decide",
					notifications: { push: "view-text" },
					reads: children ? { children: "@childRuns" } : {},
					view: {
						version: "view-v1",
						components: [
							{
								id: "shot",
								type: "screenshots",
								data: {
									literal: {
										items: [
											{
												index: 0,
												sha256: imageHash,
												alt: "Original protected image",
											},
										],
									},
								},
							},
						],
					},
					decide: {
						items: { literal: [{ id: "a", title: "Public item" }] },
						actions: [{ id: "skip", label: "Skip" }],
						ask: { prompt: "Context only" },
					},
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const run = runtime.create({
		repositoryId: "synthetic",
		workspace: home,
		input: "Controlled probe",
		workflow: definitions.at(-1),
		workflowDefinitions: definitions,
		triggerOrigin: { type: "manual", workflowId: "probe" },
	});
	run.ticketReference = ref;
	void runtime.launch(run);
	const displays = async () => {
		if (channel !== "linear")
			return ticket.comments
				.filter((c) => c.body.includes("Decision batch:"))
				.map((c) => c.body);
		const activities = await tracker.listAgentActivities(session.id);
		return activities
			.map((a) => a.content)
			.filter((b) => b?.includes("Decision batch:"));
	};
	await wait(
		async () => run.status === "waiting" && (await displays()).length === 1,
	);
	const ask = (question) =>
		runtime.askView(run.id, {
			batchId: run.viewDecision.id,
			digest: run.viewDecision.digest,
			itemId: "a",
			question,
			requestId: randomUUID(),
		});
	const hold = (where) => {
		const h = { entered: defer(), release: defer() };
		if (where === "admission") admissionHold = h;
		else if (where === "handshake") {
			handshakeHold = h;
			holdInitializeAt = initCount + 3;
		} else if (where === "transcript") transcriptHold = h;
		else readHold = h;
		return h;
	};
	return {
		home,
		run,
		service,
		hooks,
		image: () => image,
		imageHash,
		askContext: () => askContext,
		get runtime() {
			return runtime;
		},
		calls,
		setMode: (x) => (mode = x),
		diagnostic: () => diagnostic,
		displays,
		ask,
		childGate,
		askGate,
		hold,
		reconstruct: async () => {
			await runtime.flush(run.id);
			await runtime.shutdown();
			runtime = new WorkflowRuntime(home, hooks);
			const restored = runtime.get(run.id);
			void runtime.launch(restored);
			await wait(() => restored.status === "waiting");
			return restored;
		},
		stop: async () => {
			childGate.resolve();
			askGate.resolve();
			readHold?.release.resolve();
			transcriptHold?.release.resolve();
			await runtime.shutdown();
			service.stop();
			await new Promise((r) => server.close(r));
		},
	};
}
const _accepted = (run) => ({
	batchId: run.viewDecision.id,
	digest: run.viewDecision.digest,
	accepted: true,
	choices: [{ itemId: "a", action: "skip" }],
});

const f = await fixture("mcp", false),
	gate = defer();
try {
	const held = f.hold("handshake");
	await f.ask("Native checkpoint while final asset comparison is queued");
	await held.entered.promise;
	await wait(() => f.askContext());
	const pending = structuredClone(f.run.viewDecision),
		hv = f.runtime.humanViews,
		originalDispatch = hv.dispatchPublication.bind(hv),
		originalTransition = hv.transition.bind(hv),
		originalSave = f.runtime.save.bind(f.runtime);
	let active = false,
		phase = 0,
		armed = true,
		holdSave = false,
		checkpoint,
		verifiedAt,
		changedAt;
	f.runtime.save = (run) => {
		const actual = originalSave(run);
		if (holdSave) {
			holdSave = false;
			return actual.then(async () => {
				verifiedAt = Date.now();
				writeFileSync(
					f.image(),
					"Changed real protected bytes while private checkpoint save owns transition",
				);
				changedAt = Date.now();
				await new Promise((r) => setTimeout(r, 75));
				gate.resolve();
				await gate.promise;
			});
		}
		return actual;
	};
	hv.dispatchPublication = (...args) => {
		active = true;
		phase = 0;
		return originalDispatch(...args).finally(() => (active = false));
	};
	hv.transition = (run, operation) => {
		if (active && armed && ++phase === 2) {
			armed = false;
			holdSave = true;
			checkpoint = f.askContext().checkpointAgent({
				runner: "codex",
				sessionId: "synthetic-owned-native-checkpoint",
			});
		}
		return originalTransition(run, operation);
	};
	held.release.resolve();
	await wait(() =>
		f.run.ticketSync.receipts.some(
			(r) => r.viewDecision?.digest === pending.digest && r.superseded,
		),
	);
	await checkpoint;
	const bodies = await f.displays(),
		sent = f.calls.find(
			(c) => c.tool === "comment" && c.args.body.includes(pending.digest),
		);
	assert.equal(sent, undefined);
	assert(changedAt >= verifiedAt);
	assert.notEqual(
		createHash("sha256").update(readFileSync(f.image())).digest("hex"),
		f.imageHash,
	);
	const original = f.run.viewRecords.find((r) => r.snapshot.id === pending.id);
	assert(original.superseded);
	assert.equal(
		original.snapshot.threads.a[0].agent.sessionId,
		"synthetic-owned-native-checkpoint",
	);
	const evidence = {
		result: "PASS",
		head,
		tree: git("rev-parse", "HEAD^{tree}"),
		dirty: git("status", "--short") !== "",
		directory: out,
		driver: import.meta.filename,
		driverSha256: createHash("sha256")
			.update(readFileSync(import.meta.filename))
			.digest("hex"),
		paidCalls: 0,
		scenarios: 1,
		qualification:
			"Supplemental compiled production runtime/tracking/configured HTTP; controlled scheduling and75ms durable-save acknowledgement only. Actual checkpointAgent persistence and real protected PNG; no receipt/source/answer/progress patch. All agent hooks controlled, no paid/native model. Actual EdgeWorker/CLI flows covered by separate drivers.",
		home: f.home,
		image: f.image(),
		originalHash: f.imageHash,
		pending,
		verifiedAt,
		changedAt,
		sent: sent ?? null,
		bodies,
		privateCheckpoint: original.snapshot.threads,
		calls: f.calls,
	};
	writeFileSync(
		join(out, "receipt.json"),
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			head,
			directory: out,
			scenarios: 1,
			paidCalls: 0,
		}),
	);
} finally {
	gate.resolve();
	await f.stop();
}
