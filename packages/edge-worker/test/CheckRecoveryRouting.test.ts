import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { readStep } from "../src/factory/StepConfig.js";
import { routeResult, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type GraphCheckpoint,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { renamedFactory } from "./fixtures/renamed-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const directories: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function directory() {
	const value = mkdtempSync(join(tmpdir(), "check-recovery-routing-"));
	directories.push(value);
	return value;
}
function runtime(home: string, hooks: Partial<RuntimeHooks> = {}) {
	const value = new WorkflowRuntime(home, {
		agent: async () => {
			throw new Error("Unexpected agent");
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async () => {
			throw new Error("Unexpected action");
		},
		...hooks,
	});
	runtimes.push(value);
	return value;
}

it.each([
	"factory",
	"takeover",
	"renamed-factory",
	"renamed-takeover",
])("routes incomplete specialist assistance through the declared impact producer in %s's called graph", (workflowId) => {
	const definitions = renamedFactory(defaultWorkflows).definitions;
	const workflow = definitions.find((item) => item.id === workflowId)!;
	const call = workflow.steps.find((step) => step.type === "workflow")!;
	const child = definitions.find((item) => item.id === call.workflow)!;
	const gate = child.steps.find(
		(step) => step.type === "check" && readStep(step, "fanout"),
	)!;
	expect(readStep(gate, "review")).toBeUndefined();
	const impact = readStep(gate, "impact")!;
	expect(impact).toBeTruthy();
	expect(
		routeResult(gate, {
			passed: false,
			approved: false,
			reviewIncomplete: true,
			reviewBlocked: true,
			questions: ["Restore specialist access"],
		}),
	).toBe(impact);
	const correction = gate.branches.find(
		(branch) => branch.when.path === "approved" && !branch.when.equals,
	)!.next;
	expect(
		routeResult(gate, {
			approved: false,
			reviewIncomplete: false,
			reviewBlocked: true,
		}),
	).toBe(correction);
	const qa = child.steps.find(
		(step) => readStep(step, "capture") && step.type === "check",
	)!;
	// The historical runtime retries missing QA evidence before impact-aware
	// incomplete-review assistance, and both precede a product fixer.
	expect(
		routeResult(qa, {
			qaRetry: true,
			reviewIncomplete: true,
			reviewBlocked: true,
		}),
	).toBe(readStep(qa, "capture"));
	expect(routeResult(qa, { reviewIncomplete: true, reviewBlocked: true })).toBe(
		readStep(qa, "impact"),
	);
});

it.each([
	false,
	true,
])("does not infer assistance from ordinary named results (read-only review evidence=%s)", async (evidence) => {
	const home = directory();
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "ordinary-review-data",
			name: "Ordinary review data",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "source",
					name: "Completed data",
					type: "tool",
					tool: "fixture-source",
				},
				{
					id: "ordinary",
					name: "Ordinary results",
					type: "check",
					reads: { review: "source", request: "@launchInputs" },
					checks: evidence ? ["review-evidence"] : [],
					check: {
						results: {
							reviewBlocked: { path: "/inputs/request/blocked", equals: true },
							reviewIncomplete: {
								path: "/inputs/request/blocked",
								equals: true,
							},
							questions: { select: "/inputs/request/questions" },
						},
					},
					next: "end",
				},
			],
		},
	]);
	const instance = runtime(home, {
		tool: async () => ({
			status: "completed",
			blockers: [],
			findings: [],
			summary: "Reviewed",
		}),
	});
	instance.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = instance.create({
		workflow,
		title: "Ordinary named results",
		repositoryId: "fixture",
		workspace: home,
		input: "Read data",
		launchInputs: { blocked: true, questions: ["An ordinary data question"] },
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	await instance.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(run.outputs.ordinary).toEqual({
		passed: true,
		reviewBlocked: true,
		reviewIncomplete: true,
		questions: ["An ordinary data question"],
	});
	expect(run.answers).toEqual([]);
	expect(instance.pendingAnswers.has(run.id)).toBe(false);
});

const reviewerSession = {
	runner: "codex" as const,
	sessionId: "original-reviewer-session",
};
const alternateSession = {
	runner: "codex" as const,
	sessionId: "alternate-own-session",
};
it.each([
	["reviewer", false],
	["reviewer", true],
	["reviewer-events", false],
	["reviewer-events", true],
	["alternate", false],
	["alternate", true],
	["alternate-own", false],
	["alternate-own", true],
] as const)("restores exact native destination and visits after incomplete assistance (%s, called=%s)", async (destination, called) => {
	const home = directory();
	const source = "inspect-original",
		alternate = "handle-access",
		gate = "decide-next";
	const target = destination.startsWith("reviewer") ? source : alternate;
	const own = destination === "alternate-own";
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "renamed-recovery",
			name: "Renamed recovery",
			stepConfigVersion: "step-config-v1",
			steps: [
				...(own
					? [
							{
								id: "prepare",
								name: "Prepare alternate",
								type: "check",
								check: {
									results: { ready: { path: "/inputs", exists: true } },
								},
								next: alternate,
							},
						]
					: []),
				{
					id: source,
					name: "Original reviewer",
					type: "agent",
					runner: "codex",
					prompt: "Review",
					next: gate,
				},
				{
					id: gate,
					name: "Configured recovery",
					type: "check",
					reads: { review: source },
					checks: ["review-evidence", "review-assistance"],
					check: {
						results: {
							reviewIncomplete: {
								path: "/evidence/review-evidence/reviewIncomplete",
								equals: true,
							},
							questions: { select: "/evidence/review-evidence/questions" },
						},
						passed: {
							path: "/evidence/review-evidence/incomplete",
							equals: false,
						},
					},
					branches: [
						{ when: { path: "reviewIncomplete", equals: true }, next: target },
					],
					next: "end",
				},
				{
					id: alternate,
					name: "Alternate agent",
					type: "agent",
					runner: "codex",
					prompt: "Handle access independently",
					branches: [{ when: { path: "prepare", equals: true }, next: source }],
					next: "end",
				},
			],
		},
		...(called
			? [
					{
						id: "enclosed-recovery",
						name: "Enclosed recovery",
						stepConfigVersion: "step-config-v1",
						steps: [
							{
								id: "invocation",
								name: "Invocation",
								type: "workflow",
								workflow: "renamed-recovery",
								next: "end",
							},
						],
					},
				]
			: []),
	]);
	const visits: { step: string; resume: unknown }[] = [];
	const hooks: Partial<RuntimeHooks> = {
		agent: async (context) => {
			visits.push({ step: context.step.id, resume: context.resumeAgent });
			if (context.step.id === alternate) {
				await context.checkpointAgent?.(alternateSession);
				return { prepare: own && !context.run.answers.length };
			}
			await context.checkpointAgent?.(reviewerSession);
			context.log(
				JSON.stringify({
					type: "system",
					subtype: "init",
					session_id: reviewerSession.sessionId,
				}),
				"agent",
			);
			return context.run.answers.length
				? {
						status: "completed",
						blockers: [],
						findings: [],
						summary: "Review completed",
					}
				: {
						status: "blocked",
						blockers: ["Missing access"],
						findings: [],
						summary: "Review blocked",
					};
		},
	};
	const first = runtime(home, hooks);
	first.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = first.create({
		workflow,
		title: "Exact recovery identity",
		repositoryId: "fixture",
		workspace: home,
		input: "Review",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	const execution = first.launch(run);
	await waitForRuntime(() =>
		expect(first.pendingAnswers.has(run.id), run.error).toBe(true),
	);
	const frame = (value: typeof run): GraphCheckpoint =>
		called ? value.checkpoint!.active!.children![0]! : value.checkpoint!;
	if (destination === "reviewer-events") {
		delete frame(run).agentSessions![source];
		await first.save(run);
	}
	const accepted = JSON.stringify(run.workflowDefinitions);
	const history = structuredClone(run.history);
	const native = run.events.filter((event) => event.source === "agent");
	const batch = run.questionBatchId;
	expect(frame(run).visits[source]).toBe(1);
	await first.shutdown();
	await execution;
	const restored = runtime(home, hooks);
	let recovered = restored.get(run.id);
	const resumed = restored.launch(recovered);
	await waitForRuntime(() =>
		expect(restored.pendingAnswers.has(run.id)).toBe(true),
	);
	expect(recovered.history).toEqual(history);
	expect(recovered.questionBatchId).toBe(batch);
	expect(recovered.events.filter((event) => event.source === "agent")).toEqual(
		native,
	);
	let recoveredFrame = frame(recovered);
	let interruption: Promise<void> | undefined;
	let routed: GraphCheckpoint | undefined;
	const save = restored.save.bind(restored);
	restored.save = async (value) => {
		await save(value);
		if (!interruption && value.answers.length) {
			const selected = frame(value);
			if (
				selected.current === target &&
				selected.active?.phase === "executing"
			) {
				routed = structuredClone(selected);
				// Stop after the destination/visit/session checkpoint is durable and
				// before its agent starts, then exercise normal loading once more.
				interruption = restored.shutdown();
			}
		}
	};
	restored.answer(run.id, "Access restored");
	await resumed;
	expect(interruption).toBeDefined();
	await interruption;
	expect(routed!.active!.agent).toEqual(
		target === source ? reviewerSession : own ? alternateSession : undefined,
	);
	expect(visits).toHaveLength(own ? 2 : 1);
	const final = runtime(home, hooks);
	recovered = final.get(run.id);
	recoveredFrame = frame(recovered);
	expect(recoveredFrame).toEqual(routed);
	await final.launch(recovered);
	expect(recovered.status, recovered.error).toBe("completed");
	expect(visits.at(-1)).toEqual({
		step: target,
		resume:
			target === source ? reviewerSession : own ? alternateSession : undefined,
	});
	expect(recoveredFrame.visits[source]).toBe(target === source ? 2 : 1);
	expect(recoveredFrame.visits[alternate]).toBe(
		target === source ? undefined : own ? 2 : 1,
	);
	expect(recovered.history.slice(0, history.length)).toEqual(history);
	expect(JSON.stringify(recovered.workflowDefinitions)).toBe(accepted);
});
