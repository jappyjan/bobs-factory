import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { digest } from "../src/factory/Delivery.js";
import {
	outputRevisionBinding,
	pinReadOnlyAccess,
	sameOutputBinding,
} from "../src/factory/RevisionBinding.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "bound-output-"));
	homes.push(home);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: home,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(home, "record.txt"), "original\n");
	git("add", ".");
	git("commit", "-m", "Initial");
	const step = {
		id: "arbitrary-name",
		name: "Inspect",
		type: "agent" as const,
		revision: "bound" as const,
		reads: { request: "request/value", answers: "@answers" },
		branches: [],
		maxVisits: 16,
	};
	const context = {
		run: {
			id: "bound",
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			outputs: { request: { value: { accepted: true } } },
			answers: [],
			history: [],
		},
		step,
		input: {},
		signal: new AbortController().signal,
		evidenceDir: home,
		log: () => {},
	} as unknown as ExecutionContext;
	return { home, git, context };
}
it("binds every repository tree and input across JSON restart, including dirty and untracked changes", async () => {
	const { home, git, context } = fixture();
	const original = await outputRevisionBinding(context);
	expect(
		sameOutputBinding(
			JSON.parse(JSON.stringify(original)),
			await outputRevisionBinding(context),
		),
	).toBe(true);
	(
		context.run.outputs.request as { value: { accepted: boolean } }
	).value.accepted = false;
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context)),
	).toBe(false);
	(
		context.run.outputs.request as { value: { accepted: boolean } }
	).value.accepted = true;
	writeFileSync(join(home, "record.txt"), "dirty\n");
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context)),
	).toBe(false);
	writeFileSync(join(home, "record.txt"), "original\n");
	writeFileSync(join(home, "new.txt"), "untracked\n");
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context)),
	).toBe(false);
	git("add", ".");
	git("commit", "-m", "Changed tree");
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context)),
	).toBe(false);
});
it("resolves named output paths and contexts without depending on role names and pins read-only access", async () => {
	const { home, git, context } = fixture();
	expect(stepBindings(context)).toEqual({
		request: { accepted: true },
		answers: [],
	});
	const pinned = await pinReadOnlyAccess(context);
	writeFileSync(join(home, "record.txt"), "changed\n");
	git("add", ".");
	git("commit", "-m", "Later");
	expect(pinned.repositories[0]!.revision).not.toBe(git("rev-parse", "HEAD"));
	expect(git("show", `${pinned.repositories[0]!.revision}:record.txt`)).toBe(
		"original",
	);
});
it("reruns a restored bound result when its revision changed, retaining the frozen definition", async () => {
	const { home, git } = fixture();
	let calls = 0;
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-runtime-"));
	homes.push(runtimeHome);
	const runtime = new WorkflowRuntime(runtimeHome, {
		agent: async () => ({ call: ++calls }),
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const workflow = WorkflowSchema.parse({
			id: "bound-recipe",
			name: "Bound",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "inspect-renamed",
					name: "Inspect",
					type: "agent",
					prompt: "Inspect",
					revision: "bound",
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		const definition = JSON.stringify(run.workflow);
		const context = {
			run,
			step: run.workflow.steps[0]!,
			input: {},
			signal: new AbortController().signal,
			evidenceDir: home,
			log: () => {},
		} as ExecutionContext;
		run.boundOutputs = {
			"inspect-renamed": (await outputRevisionBinding(context))!,
		};
		run.outputs["inspect-renamed"] = { call: 0 };
		run.checkpoint = {
			current: "inspect-renamed",
			visits: { "inspect-renamed": 1 },
			active: { phase: "result" },
		};
		writeFileSync(join(home, "record.txt"), "changed\n");
		git("add", ".");
		git("commit", "-m", "Changed");
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(calls).toBe(1);
		expect(run.outputs["inspect-renamed"]).toEqual({ call: 1 });
		expect(JSON.stringify(run.workflow)).toBe(definition);
	} finally {
		await runtime.shutdown();
	}
});

it("does not stale a history binding merely by persisting its own result", async () => {
	const { context } = fixture();
	context.step.reads = { history: "@history" };
	const binding = await outputRevisionBinding(context);
	context.run.history.push({
		step: context.step.id,
		output: { complete: true },
		at: "now",
	});
	expect(
		sameOutputBinding(binding, await outputRevisionBinding(context, binding)),
	).toBe(true);
	context.run.history.push({
		step: "another-source",
		output: { changed: true },
		at: "later",
	});
	expect(
		sameOutputBinding(binding, await outputRevisionBinding(context, binding)),
	).toBe(false);
});

it("excludes self-result bindings and publication bookkeeping while retaining real input freshness", async () => {
	const { context } = fixture();
	context.step.reads = { previous: context.step.id, plan: context.step.id };
	context.run.outputs[context.step.id] = { old: true };
	context.input = {
		previous: { old: true },
		plan: { old: true },
		answers: [],
		ticketSync: { receipts: [] },
		deliveryCandidateDigest: "before",
	};
	const original = await outputRevisionBinding(context);
	context.run.outputs[context.step.id] = { completed: true };
	context.input = {
		previous: { completed: true },
		plan: { completed: true },
		answers: [],
		ticketSync: { receipts: [{ delivered: true }] },
		deliveryCandidateDigest: "after",
	};
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context, original)),
	).toBe(true);
	context.input = { ...(context.input as object), answers: ["New task input"] };
	expect(
		sameOutputBinding(original, await outputRevisionBinding(context, original)),
	).toBe(false);
});

it("refreshes a stale producer before consuming its named binding", async () => {
	const { home, git } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-consumer-"));
	homes.push(runtimeHome);
	let calls = 0,
		mutations = 0;
	const runtime = new WorkflowRuntime(runtimeHome, {
		agent: async () => ({ receipt: ++calls }),
		script: async () => ({}),
		tool: async (context) => {
			if (context.step.id === "mutate" && !mutations++) {
				writeFileSync(join(home, "record.txt"), "later\n");
				git("add", ".");
				git("commit", "-m", "Later");
			}
			return context.step.id === "consume"
				? {
						received: (context.input as { source: { receipt: number } }).source
							.receipt,
					}
				: {};
		},
	});
	try {
		const source = {
			id: "inspection",
			name: "Inspection",
			type: "agent",
			prompt: "Inspect",
			revision: "bound",
			next: "mutate",
		};
		const root = WorkflowSchema.parse({
			id: "consumer",
			name: "Consumer",
			stepConfigVersion: "step-config-v1",
			steps: [
				source,
				{
					id: "mutate",
					name: "Change revision once",
					type: "tool",
					tool: "fixture",
					next: "consume",
				},
				{
					id: "consume",
					name: "Consume",
					type: "tool",
					tool: "fixture",
					reads: { source: "inspection" },
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow: root,
			triggerOrigin: { type: "manual", workflowId: root.id },
		});
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(calls).toBe(2);
		expect(mutations).toBe(1);
		expect(run.outputs.consume).toEqual({ received: 2 });
	} finally {
		await runtime.shutdown();
	}
});

it.each([
	"answers",
	"prior-output",
	"called-frame",
])("binds effective optional-read inputs (%s), refreshing only the producer", async (change) => {
	const { home } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-effective-"));
	homes.push(runtimeHome);
	let calls = 0,
		mutations = 0;
	const seen: unknown[] = [];
	const runtime = new WorkflowRuntime(runtimeHome, {
		agent: async (context) => {
			calls++;
			const input = context.input as {
				answers: string[];
				outputs: { seed: { value: number } };
			};
			return { answers: input.answers.length, seed: input.outputs.seed.value };
		},
		script: async () => ({}),
		tool: async (context) => {
			if (context.step.tool === "seed") return { value: 0 };
			if (context.step.tool === "mutate") {
				mutations++;
				if (change === "prior-output") context.outputs!.seed = { value: 1 };
				else context.run.answers.push("New answer");
			}
			if (context.step.tool === "consume")
				seen.push((context.input as { source: unknown }).source);
			return {};
		},
	});
	try {
		const child = WorkflowSchema.parse({
			id: "effective-child",
			name: "Effective child",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "seed",
					name: "Seed",
					type: "tool",
					tool: "seed",
					next: "inspect",
				},
				{
					id: "inspect",
					name: "Inspect",
					type: "agent",
					prompt: "Inspect all supplied context",
					revision: "bound",
					next: "mutate",
				},
				{
					id: "mutate",
					name: "Mutate",
					type: "tool",
					tool: "mutate",
					next: "consume",
				},
				{
					id: "consume",
					name: "Consume",
					type: "tool",
					tool: "consume",
					reads: { source: "inspect" },
					next: "end",
				},
			],
		});
		if (change === "called-frame")
			runtime.updateWorkflows([...runtime.listWorkflows(), child]);
		const workflow =
			change === "called-frame"
				? WorkflowSchema.parse({
						id: "effective-parent",
						name: "Parent",
						stepConfigVersion: "step-config-v1",
						steps: [
							{
								id: "nested",
								name: "Nested",
								type: "workflow",
								workflow: child.id,
								next: "end",
							},
						],
					})
				: child;
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		const definition = JSON.stringify(run.workflow);
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(calls).toBe(2);
		expect(mutations).toBe(1);
		expect(seen).toEqual([
			{
				answers: change === "prior-output" ? 0 : 1,
				seed: change === "prior-output" ? 1 : 0,
			},
		]);
		expect(JSON.stringify(run.workflow)).toBe(definition);
	} finally {
		await runtime.shutdown();
	}
});

it("refreshes implicit answers after production persistence/restart without replaying completed work", async () => {
	const { home } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-restart-"));
	homes.push(runtimeHome);
	let calls = 0,
		consumers = 0;
	const hooks = {
		agent: async (context: ExecutionContext) => ({
			answers: (context.input as { answers: string[] }).answers.length,
			call: ++calls,
		}),
		script: async () => ({}),
		tool: async (context: ExecutionContext) => {
			if (!consumers++) {
				context.run.answers.push("Persisted answer");
				throw new Error("Simulated interrupted consumer");
			}
			return { received: (context.input as { source: unknown }).source };
		},
	};
	let runtime = new WorkflowRuntime(runtimeHome, hooks);
	try {
		const workflow = WorkflowSchema.parse({
			id: "effective-restart",
			name: "Restart",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "inspect",
					name: "Inspect",
					type: "agent",
					prompt: "Inspect",
					revision: "bound",
					next: "consume",
				},
				{
					id: "consume",
					name: "Consume",
					type: "tool",
					tool: "consume",
					reads: { source: "inspect" },
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		await runtime.shutdown();
		runtime = new WorkflowRuntime(runtimeHome, hooks);
		const restored = runtime.get(run.id);
		expect(restored.answers).toEqual(["Persisted answer"]);
		runtime.retry(run.id);
		await expect
			.poll(() => restored.status, { timeout: 15000 })
			.toBe("completed");
		expect(restored.status, restored.error).toBe("completed");
		expect(restored.outputs.consume).toEqual({
			received: { answers: 1, call: 2 },
		});
		expect(calls).toBe(2);
	} finally {
		await runtime.shutdown();
	}
});

it.each([
	"answers",
	"repository",
])("rejects an in-flight inspection after concurrent %s drift and reruns against fresh context", async (change) => {
	const { home, git } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-concurrent-"));
	homes.push(runtimeHome);
	let calls = 0;
	const runtime = new WorkflowRuntime(runtimeHome, {
		execution: async () => ({
			environment: {},
			mcp: {},
			root: runtimeHome,
			settings: {},
			runner: "codex",
			disabledMcp: [],
			accounts: [],
			redact: (value) => value,
		}),
		agent: async (context) => {
			const answers = (context.input as { answers: string[] }).answers.length;
			if (!calls++) {
				if (change === "answers") context.run.answers.push("Concurrent answer");
				else {
					writeFileSync(join(home, "record.txt"), "concurrent\n");
					git("add", ".");
					git("commit", "-m", "Concurrent");
				}
			}
			return { answers, call: calls };
		},
		script: async () => ({}),
		tool: async (context) => ({
			received: (context.input as { source: unknown }).source,
		}),
	});
	try {
		const workflow = WorkflowSchema.parse({
			id: "effective-concurrent",
			name: "Concurrent",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "inspect",
					name: "Inspect",
					type: "agent",
					prompt: "Inspect",
					revision: "bound",
					access: "read-only",
					next: "consume",
				},
				{
					id: "consume",
					name: "Consume",
					type: "tool",
					tool: "consume",
					reads: { source: "inspect" },
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(calls).toBe(2);
		expect(run.outputs.consume).toEqual({
			received: { answers: change === "answers" ? 1 : 0, call: 2 },
		});
		expect(run.boundOutputs!.inspect!.repositories[0]!.headSha).toBe(
			git("rev-parse", "HEAD"),
		);
	} finally {
		await runtime.shutdown();
	}
});

it("bounds repeated stale native-session retries with the accepted visit budget", async () => {
	const { home } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-visit-budget-"));
	homes.push(runtimeHome);
	let calls = 0;
	const runtime = new WorkflowRuntime(runtimeHome, {
		agent: async (context) => {
			await context.checkpointAgent!({
				runner: "codex",
				sessionId: "retained-session",
				inspection: context.inspectionBinding,
			});
			context.run.answers.push(`Change ${++calls}`);
			return { call: calls };
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const workflow = WorkflowSchema.parse({
			id: "effective-budget",
			name: "Bound retries",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "inspect",
					name: "Inspect",
					type: "agent",
					prompt: "Inspect",
					revision: "bound",
					maxVisits: 2,
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Inspect",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		expect(run.error).toMatch(/Iteration limit reached/);
		expect(calls).toBe(2);
		expect(run.history).toHaveLength(0);
		expect(run.outputs.inspect).toBeUndefined();
	} finally {
		await runtime.shutdown();
	}
});

it("validates a called delivery candidate in its producing frame without replaying the author", async () => {
	const { home, git } = fixture();
	const runtimeHome = mkdtempSync(join(tmpdir(), "bound-delivery-frame-"));
	homes.push(runtimeHome);
	const visits: string[] = [];
	const runtime = new WorkflowRuntime(runtimeHome, {
		agent: async (context) => {
			const key = context.stepKey!;
			visits.push(key);
			if (key === "author") return { unrelated: true };
			if (context.step.id === "reviewer") return { approved: true };
			context.run.roleRevisions ??= {};
			context.run.roleRevisions[key] = {
				headSha: git("rev-parse", "HEAD"),
				dirty: false,
				historyLength: context.run.history.length,
				at: new Date().toISOString(),
			};
			return {
				deliveryContract: {
					format: "delivery-v1",
					version: 1,
					mode: "repository",
					authorization: {
						status: "authorized",
						reference: "Accepted request",
					},
					executionReference: digest({
						runner: context.run.runner,
						repositoryId: context.run.repositoryId,
					}),
					targets: [],
				},
			};
		},
		script: async () => ({}),
		tool: async (context) => {
			expect(
				(context.input as { plan: { deliveryContract: { mode: string } } }).plan
					.deliveryContract.mode,
			).toBe("repository");
			return {};
		},
	});
	try {
		const child = WorkflowSchema.parse({
			id: "delivery-child",
			name: "Delivery",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "author",
					name: "Author",
					type: "agent",
					prompt: "Plan",
					next: "reviewer",
				},
				{
					id: "reviewer",
					name: "Reviewer",
					type: "agent",
					prompt: "Review",
					next: "route",
				},
				{
					id: "route",
					name: "Route",
					type: "tool",
					tool: "delivery-route",
					reads: { plan: "author", review: "reviewer" },
					next: "end",
				},
			],
		});
		runtime.updateWorkflows([...runtime.listWorkflows(), child]);
		const workflow = WorkflowSchema.parse({
			id: "delivery-parent",
			name: "Parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "author",
					name: "Unrelated root author",
					type: "agent",
					prompt: "Generic",
					next: "pipeline",
				},
				{
					id: "pipeline",
					name: "Call delivery",
					type: "workflow",
					workflow: child.id,
					next: "end",
				},
			],
		});
		const run = runtime.create({
			repositoryId: "fixture",
			workspace: home,
			input: "Plan",
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(visits).toEqual(["author", "pipeline/author", "pipeline/reviewer"]);
		expect(run.outputs.author).toEqual({ unrelated: true });
		expect(run.outputs["pipeline/author"]).toHaveProperty(
			"deliveryContract.mode",
			"repository",
		);
	} finally {
		await runtime.shutdown();
	}
});
