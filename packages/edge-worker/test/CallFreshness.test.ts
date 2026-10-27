import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const instances: WorkflowRuntime[] = [],
	homes: string[] = [];
afterEach(async () => {
	for (const r of instances.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const role = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	configVersion: "step-config-v1",
	prompt: "Return JSON",
	output: { format: "json-v1" },
	next: "end",
	...extra,
});
it.each([
	false,
	true,
])("refreshes the actual revision-bound producer imported through a Call port (completed Parallel=%s)", async (parallel) => {
	const h = mkdtempSync(join(tmpdir(), "review142-freshness-"));
	homes.push(h);
	const repo = join(h, "repo");
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Review");
	git("config", "user.email", "review@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "record.txt"), "before");
	git("add", ".");
	git("commit", "-m", "fixture [skip ci]");
	const sourceKey = parallel ? "first/work/0/original" : "first/original";
	const source = {
		engineVersion: "nodes-v1",
		id: "source-recipe",
		name: "Source",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		outcomes: ["completed"],
		steps: parallel
			? [
					{
						id: "work",
						name: "Work",
						type: "fanout",
						groups: [[role("original", { revision: "bound" })]],
						next: "end",
					},
				]
			: [role("original", { revision: "bound" })],
	};
	const consumer = {
		engineVersion: "nodes-v1",
		id: "consumer-recipe",
		name: "Consumer",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		inputs: ["source"],
		outcomes: ["completed"],
		steps: [role("consume", { reads: { source: "source" } })],
	};
	const parent = {
		engineVersion: "nodes-v1",
		id: "cross-call-reader",
		name: "Parent",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "first",
				name: "Source",
				type: "workflow",
				workflow: source.id,
				next: "mutate",
			},
			{
				id: "mutate",
				name: "Mutate",
				type: "agent",
				prompt: "fixture-tool",
				next: "second",
			},
			{
				id: "second",
				name: "Consumer",
				type: "workflow",
				workflow: consumer.id,
				bindings: { source: sourceKey },
				next: "end",
			},
		],
	};
	const defs = validateWorkflows([
		...defaultWorkflows,
		source,
		consumer,
		parent,
	]);
	let calls = 0,
		received: any;
	const r = new WorkflowRuntime(join(h, "state"), {
		agent: async (context) => {
			if (context.step.prompt === "fixture-tool")
				return (async () => {
					writeFileSync(join(repo, "record.txt"), "after");
					git("add", ".");
					git("commit", "-m", "changed [skip ci]");
					return {};
				})(context);
			if (context.step.prompt === "fixture-script")
				return (async () => ({}))(context);
			return (async (c) => {
				if (c.step.id === "original") {
					calls++;
					return { text: readFileSync(join(repo, "record.txt"), "utf8") };
				}
				received = (c.input as any).source;
				return { received };
			})(context);
		},
	});
	instances.push(r);
	r.updateWorkflows(defs, parent.id);
	const run = r.create({
		title: "Fresh bound input",
		repositoryId: "fixture",
		workspace: repo,
		input: "Use fresh data",
		workflow: defs.at(-1)!,
		triggerOrigin: { type: "manual", workflowId: parent.id },
	});
	await r.launch(run);
	writeFileSync(
		`/tmp/taskbot142-r1-freshness-${parallel}.json`,
		JSON.stringify(
			{
				status: run.status,
				error: run.error,
				calls,
				received,
				binding: run.boundOutputs?.[sourceKey],
				current: git("rev-parse", "HEAD"),
				history: run.history,
			},
			null,
			2,
		),
	);
	expect(run.status, run.error).toBe("completed");
	expect(run.boundOutputs?.[sourceKey]).toBeDefined();
	expect(received).toEqual({ text: "after" });
	expect(calls).toBe(2);
});

it("refreshes a completed Parallel producer after its enclosing declared seed port changes", async () => {
	const h = mkdtempSync(join(tmpdir(), "enclosing-port-"));
	homes.push(h);
	const repo = join(h, "repo");
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "record.txt"), "same");
	git("add", ".");
	git("commit", "-m", "fixture [skip ci]");
	const revision = git("rev-parse", "HEAD");
	const source = {
		engineVersion: "nodes-v1",
		id: "source-recipe",
		name: "Source",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		inputs: ["seed"],
		outcomes: ["completed"],
		steps: [
			{
				id: "work",
				name: "Work",
				type: "fanout",
				next: "end",
				groups: [
					[
						role("original", {
							session: "resume",
							revision: "bound",
							reads: { seed: "seed" },
							next: "adjacent",
						}),
						{
							id: "adjacent",
							name: "Adjacent",
							type: "agent",
							prompt: "fixture-tool",
							next: "end",
						},
					],
				],
			},
		],
	};
	const consumer = {
		engineVersion: "nodes-v1",
		id: "consumer-recipe",
		name: "Consumer",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["workflow"],
		inputs: ["source"],
		outcomes: ["completed"],
		steps: [role("consume", { reads: { source: "source" } })],
	};
	const sourceKey = "first/work/0/original";
	const parent = {
		engineVersion: "nodes-v1",
		id: "enclosing-port-parent",
		name: "Parent",
		stepConfigVersion: "step-config-v1",
		steps: [
			role("seed", {
				next: "first",
				branches: [{ when: { path: "version", equals: 2 }, next: "second" }],
			}),
			{
				id: "first",
				name: "Source",
				type: "workflow",
				workflow: source.id,
				bindings: { seed: "seed" },
				next: "seed",
			},
			{
				id: "second",
				name: "Consumer",
				type: "workflow",
				workflow: consumer.id,
				bindings: { source: sourceKey },
				next: "end",
			},
		],
	};
	const defs = validateWorkflows([
		...defaultWorkflows,
		source,
		consumer,
		parent,
	]);
	let seed = 0,
		calls = 0,
		adjacent = 0;
	let received: unknown, originalHistory: unknown;
	const sessions: (string | undefined)[] = [];
	const r = new WorkflowRuntime(join(h, "state"), {
		agent: async (context) => {
			if (context.step.prompt === "fixture-tool")
				return (async () => {
					adjacent++;
					return { executed: true };
				})(context);
			if (context.step.prompt === "fixture-script")
				return (async () => ({}))(context);
			return (async (c) => {
				if (c.step.id === "seed") {
					if (seed === 1) originalHistory = structuredClone(c.run.history);
					return { version: ++seed };
				}
				if (c.step.id === "original") {
					calls++;
					sessions.push(c.resumeAgent?.sessionId);
					await c.checkpointAgent?.({
						runner: "codex",
						sessionId: "controlled-enclosing-producer",
					});
					return { seed: (c.input as { seed: unknown }).seed };
				}
				received = (c.input as { source: unknown }).source;
				return { received };
			})(context);
		},
	});
	instances.push(r);
	r.updateWorkflows(defs, parent.id);
	const run = r.create({
		title: "Enclosing input drift",
		repositoryId: "fixture",
		workspace: repo,
		input: "Use current seed",
		workflow: defs.at(-1)!,
		triggerOrigin: { type: "manual", workflowId: parent.id },
	});
	await r.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(received).toEqual({ seed: { version: 2 } });
	expect(calls).toBe(2);
	expect(adjacent).toBe(1);
	expect(sessions).toEqual([undefined, "controlled-enclosing-producer"]);
	expect(git("rev-parse", "HEAD")).toBe(revision);
	expect(run.history.slice(0, (originalHistory as unknown[]).length)).toEqual(
		originalHistory,
	);
	expect(
		run.checkpoint!.calls!.first!.branches!.work![0]!.visits.original,
	).toBe(2);
	expect(
		run.history.filter((h) => h.step === sourceKey).map((h) => h.output),
	).toEqual([{ seed: { version: 1 } }, { seed: { version: 2 } }]);
	writeFileSync(
		"/tmp/taskbot142-r2-enclosing-input.json",
		JSON.stringify(
			{
				status: run.status,
				calls,
				received,
				sessions,
				adjacent,
				revision,
				binding: run.boundOutputs?.[sourceKey],
				history: run.history,
				checkpoint: run.checkpoint,
			},
			null,
			2,
		),
	);
});
