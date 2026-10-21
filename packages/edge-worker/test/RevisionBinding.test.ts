import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
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
		expect(run.outputs.consume).toEqual({ received: 2 });
	} finally {
		await runtime.shutdown();
	}
});
