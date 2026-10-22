// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot140-native-delivery-round5.mjs
// Supplemental production WorkflowRuntime -> nativeAdapter -> real Linear service,
// durable outbox and request budget. Only the SDK API transport and agents are controlled.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mock } from "node:test";
import { CLIIssueTrackerService } from "../../../../packages/core/dist/index.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import {
	nativeAdapter,
	TicketTracking,
} from "../../../../packages/edge-worker/dist/factory/TicketTracking.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { LinearIssueTrackerService } from "../../../../packages/linear-event-transport/dist/LinearIssueTrackerService.js";

const { LinearClient } = await import(
	createRequire(
		new URL(
			"../../../../packages/linear-event-transport/package.json",
			import.meta.url,
		),
	).resolve("@linear/sdk")
);
assert.equal(process.env.F1_AGENT_MODE, "mock");
assert.match(process.version, /^v24\./);
const root = resolve(import.meta.dirname, "../../../.."),
	directory = realpathSync(
		mkdtempSync(join(tmpdir(), "f1-taskbot140-native-delivery-round5-")),
	);
writeFileSync(
	join(directory, "executed-driver.mjs"),
	readFileSync(import.meta.filename),
);
const git = (...args) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD"),
	dirty = git("status", "--short") !== "";
if (process.env.F1_EXPECTED_SOURCE_COMMIT) {
	assert.equal(head, process.env.F1_EXPECTED_SOURCE_COMMIT);
	assert.equal(dirty, false);
}
const deferred = () => {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
};
async function until(check, label) {
	const end = performance.now() + 15000;
	while (!(await check())) {
		if (performance.now() > end) throw new Error(label);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
const results = [];
for (const boundary of ["budget", "known-429-recovery"]) {
	const home = join(directory, boundary);
	mkdirSync(home);
	const child = deferred(),
		ask = deferred(),
		budget = deferred(),
		budgetEntered = deferred();
	const nativeInputs = [],
		nativeLookups = [],
		accepted = new Map();
	let holdBudget = false,
		reject = false,
		runtime,
		service,
		native,
		nativeClient;
	const cli = new CLIIssueTrackerService();
	cli.seedDefaultData();
	const issue = await cli.createIssue({
		teamId: "team-default",
		title: "Synthetic native delivery",
	});
	const session = await (
		await cli.createAgentSessionOnIssue({ issueId: issue.id })
	).agentSession;
	assert(session);
	const saved = () => {
		const folder = join(home, "state", "linear-activity-delivery");
		return JSON.parse(
			readFileSync(
				join(
					folder,
					readdirSync(folder).find((name) => name.endsWith(".json")),
				),
				"utf8",
			),
		);
	};
	const openNative = () => {
		nativeClient = new LinearClient({ accessToken: home });
		nativeClient.client.request = async (_document, variables) => {
			if (variables.id === "budget-blocker" && holdBudget) {
				budgetEntered.release();
				await budget.promise;
				return { issue: { id: "budget-blocker", reactions: [] } };
			}
			if (variables.input) {
				const input = structuredClone(variables.input);
				nativeInputs.push({ at: Date.now(), input, rejected: reject });
				if (reject) throw { response: { status: 429, headers: new Headers() } };
				accepted.set(input.id, input);
				return {
					agentActivityCreate: {
						success: true,
						agentActivity: { id: input.id },
						lastSyncId: 1,
					},
				};
			}
			nativeLookups.push(variables.id);
			const input = accepted.get(variables.id);
			if (!input) throw { response: { status: 404 } };
			return {
				agentActivity: { ...input, agentSession: { id: input.agentSessionId } },
			};
		};
		native = new LinearIssueTrackerService(nativeClient, undefined, undefined, {
			factoryHome: home,
			workspaceId: home,
			requestIntervalMs: 0,
			resolveView: (identity, input) => ({
				run: (write) => {
					const run = runtime.get(identity.runId),
						receipt = run.ticketSync.receipts.find(
							(entry) => entry.key === identity.receiptKey,
						);
					assert(receipt);
					assert.equal(receipt.deliveryId, input.id);
					assert.equal(receipt.body, input.content.body);
					assert.equal(input.agentSessionId, session.id);
					return runtime.humanViews.dispatchPublication(run, identity, write);
				},
			}),
		});
		cli.createAgentActivity = native.createAgentActivity.bind(native);
		cli.reconcileAgentActivityDelivery =
			native.reconcileAgentActivityDelivery.bind(native);
	};
	openNative();
	const adapter = nativeAdapter(
		{
			provider: "native",
			platform: "linear",
			workspaceId: home,
			id: issue.id,
			url: issue.url,
		},
		cli,
		{ getTranscriptSession: async () => session.id },
	);
	const hooks = {
		agent: async (context) => {
			const wait = context.step.id === "controlled" ? child : ask;
			context.signal.addEventListener("abort", () => wait.release(), {
				once: true,
			});
			await wait.promise;
			return context.step.id === "controlled"
				? { done: true }
				: "Historical bounded Ask";
		},
		tool: async () => {
			throw new Error("Unexpected tool");
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		track: (run, receipt) => service.record(run, receipt),
	};
	runtime = new WorkflowRuntime(home, hooks);
	service = new TicketTracking(
		async () => adapter,
		(run) => runtime.save(run),
		() => {},
		undefined,
		(run, version) => runtime.humanViews.validatePublication(run, version),
		(run, version, write) =>
			runtime.humanViews.dispatchPublication(run, version, write),
	);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "native-child",
			name: "Child",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "controlled",
					name: "Controlled",
					type: "agent",
					prompt: "Synthetic child",
				},
			],
		},
		{
			id: "native-view",
			name: "Native current view",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "launch",
					name: "Launch",
					type: "launch-runs",
					launchRuns: {
						items: {
							values: [{ id: "a", title: "Child", prompt: "Synthetic" }],
						},
						workflow: "native-child",
						wait: false,
						inputMapping: { prompt: "/prompt" },
					},
				},
				{
					id: "choose",
					name: "Decide",
					type: "decide",
					reads: { children: "@childRuns" },
					view: {
						version: "view-v1",
						components: [
							{
								id: "children",
								type: "runList",
								data: { path: "/inputs/children" },
							},
						],
					},
					decide: {
						items: { literal: [{ id: "a", title: "Item" }] },
						actions: [{ id: "skip", label: "Skip" }],
						ask: { prompt: "Bounded context" },
					},
				},
			],
		},
	]);
	runtime.updateWorkflows(definitions);
	const run = runtime.create({
		repositoryId: "synthetic",
		workspace: home,
		workflow: definitions.at(-1),
		workflowDefinitions: definitions,
		input: "Synthetic controlled native publication",
		triggerOrigin: { type: "manual", workflowId: "native-view" },
	});
	// Accepted originating-ticket binding before execution, as in the production admission path.
	run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: home,
		id: issue.id,
		url: issue.url,
	};
	try {
		void runtime.launch(run);
		await until(
			() =>
				run.status === "waiting" &&
				[...accepted.values()].some((input) =>
					input.content.body.includes(run.viewDecision.digest),
				),
			"Initial unchanged native delivery",
		);
		const initial = [...accepted.values()].map((input) =>
			structuredClone(input),
		);
		let blocked;
		if (boundary === "budget") {
			holdBudget = true;
			blocked = nativeClient.issue("budget-blocker");
			await budgetEntered.promise;
		} else reject = true;
		await runtime.askView(run.id, {
			batchId: run.viewDecision.id,
			digest: run.viewDecision.digest,
			itemId: "a",
			question: "Held native queue discussion",
			requestId: randomUUID(),
		});
		const pending = structuredClone(run.viewDecision);
		await until(
			() =>
				saved().records.some(
					(record) =>
						record.view?.digest === pending.digest &&
						record.status === "pending" &&
						(boundary === "budget" ||
							(record.ambiguous === false && record.attempts === 1)),
				),
			"Captured genuine native pending input",
		);
		child.release();
		await until(
			() =>
				Object.values(run.launchActions)[0].progress.a.status === "completed",
			"Actual launched child completion",
		);
		assert.equal(run.viewDecision.digest, pending.digest);
		if (boundary === "budget") {
			budget.release();
			await blocked;
		} else {
			reject = false;
			native.stopDelivery();
			// Move the controlled clock past the real recorded retry deadline; no test/product timeout is changed.
			mock.timers.enable({ apis: ["Date"], now: Date.now() });
			mock.timers.setTime(Date.now() + 31000);
			openNative();
			native.startDelivery();
			await native.flushActivityDelivery();
		}
		await until(
			() =>
				run.viewDecision.id !== pending.id &&
				[...accepted.values()].some(
					(input) =>
						input.content.body.includes(run.viewDecision.digest) &&
						input.content.body.includes("[completed]"),
				),
			"Renewed exact native protocol",
		);
		const acceptedBeforeRestart = [...accepted.values()];
		assert(
			acceptedBeforeRestart.every(
				(input) => !input.content.body.includes(pending.digest),
			),
		);
		for (const original of initial)
			assert.deepEqual(accepted.get(original.id), original);
		const obsolete = saved().records.find(
			(record) => record.view?.digest === pending.digest,
		);
		assert.equal(obsolete.status, "superseded");
		assert.equal(obsolete.activityId, undefined);
		assert.equal(obsolete.ambiguous, false);
		await assert.rejects(
			runtime.replyView(
				run.id,
				"/view-answer " +
					JSON.stringify({
						batchId: pending.id,
						digest: pending.digest,
						accepted: true,
						choices: [{ itemId: "a", action: "skip" }],
					}),
			),
			/changed|superseded/,
		);
		ask.release();
		await runtime.flush(run.id);
		const current = structuredClone(run.viewDecision);
		await runtime.shutdown();
		native.stopDelivery();
		runtime = new WorkflowRuntime(home, hooks);
		openNative();
		native.startDelivery();
		const restored = runtime.get(run.id);
		void runtime.launch(restored);
		await until(
			() => restored.status === "waiting",
			"Restart-safe native waiting",
		);
		await service.flush(restored);
		assert.equal(restored.viewDecision.digest, current.digest);
		assert.equal(accepted.size, acceptedBeforeRestart.length);
		const request = {
			batchId: current.id,
			digest: current.digest,
			accepted: true,
			choices: [{ itemId: "a", action: "skip" }],
		};
		await runtime.replyView(
			restored.id,
			`/view-answer ${JSON.stringify(request)}`,
		);
		await until(
			() => restored.status === "completed",
			"Current native reply accepted",
		);
		results.push({
			boundary,
			pending,
			current,
			obsolete,
			nativeInputs,
			nativeLookups,
			accepted: [...accepted.values()],
			request,
			retainedDecision: restored.viewRecords.find(
				(record) => record.snapshot.id === current.id,
			).answer,
			outbox: saved(),
		});
	} catch (error) {
		writeFileSync(
			join(home, "failure.json"),
			JSON.stringify(
				{
					error: String(error),
					stack: error.stack,
					nativeInputs,
					nativeLookups,
					outbox: saved(),
				},
				null,
				2,
			),
		);
		throw error;
	} finally {
		child.release();
		ask.release();
		budget.release();
		native.stopDelivery();
		await runtime.shutdown();
		service.stop();
		mock.timers.reset();
	}
}
const receipt = {
	result: "PASS",
	head,
	tree: git("rev-parse", "HEAD^{tree}"),
	dirty,
	directory,
	node: process.version,
	driverSha256: createHash("sha256")
		.update(readFileSync(import.meta.filename))
		.digest("hex"),
	paidCalls: 0,
	results,
	limits:
		"Actual production runtime/native adapter/Linear SDK/service/outbox/budget and persisted reconstruction; synthetic CLI issue/session directory plus controlled SDK transport and agent hooks. Not a live Linear/native-model/EdgeWorker native-origin authentication claim.",
};
writeFileSync(
	join(directory, "receipt.json"),
	JSON.stringify(receipt, null, 2),
);
console.log(
	JSON.stringify({
		result: "PASS",
		directory,
		head,
		scenarios: results.length,
		paidCalls: 0,
	}),
);
