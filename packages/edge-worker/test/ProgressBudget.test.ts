import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const releaseWaits: (() => void)[] = [];
afterEach(async () => {
	for (const release of releaseWaits.splice(0)) release();
	vi.useRealTimers();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

const policy = { maxUnchangedAttempts: 2, continueAttempts: 1 };
const role = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Controlled progress fixture",
	maxVisits: 100,
	...extra,
});
const loop = (extra = {}) => role("work", { next: "work", ...extra });
function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	releaseWaits.push(release);
	return { promise, release };
}
function load(home: string, hooks: Partial<RuntimeHooks> = {}) {
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		...hooks,
	});
	runtimes.push(runtime);
	return runtime;
}
function fixture(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "task147-progress-"));
	homes.push(home);
	const workspace = join(home, "source");
	mkdirSync(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: workspace,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-qb", "main");
	const commit = (source?: string) => {
		if (source !== undefined)
			writeFileSync(join(workspace, "source.ts"), source);
		git("add", "source.ts");
		git(
			"-c",
			"user.name=Progress fixture",
			"-c",
			"user.email=progress@example.test",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"--allow-empty",
			"-qm",
			"Controlled fixture [skip ci]",
		);
	};
	commit("export const state = 'A';\n");
	const runtime = load(home, hooks);
	const create = (
		steps: unknown[],
		dependencies: unknown[] = [],
		convergence: unknown = policy,
	) => {
		const definitions = validateWorkflows([
			...defaultWorkflows,
			...dependencies,
			{
				id: "progress-fixture",
				name: "Progress fixture",
				steps,
				...(convergence === undefined ? {} : { convergence }),
			},
		]);
		runtime.updateWorkflows(definitions);
		return runtime.create({
			title: "Retained progress",
			repositoryId: "fixture",
			workspace,
			input: "Accepted host input",
			workflow: definitions.at(-1)!,
			triggerOrigin: {
				type: "manual",
				workflowId: "progress-fixture",
				at: new Date().toISOString(),
			},
		});
	};
	return { home, workspace, runtime, create, commit, git };
}
const observations = (run: FactoryRun) =>
	Object.values(run.progressBudget!.observations);
const attempts = (run: FactoryRun) =>
	observations(run).reduce((sum, entry) => sum + entry.attempts, 0);
async function settled(runtime: WorkflowRuntime, run: FactoryRun) {
	await waitForRuntime(() => {
		expect(runtime.isExecuting(run.id)).toBe(false);
		expect(["failed", "interrupted", "completed"]).toContain(run.status);
	});
}

describe("accepted progress policy", () => {
	it("validates the public policy defaults and bounds without opting old recipes in", async () => {
		const definition = { id: "schema", name: "Schema", steps: [role("work")] };
		expect(WorkflowSchema.parse(definition).convergence).toBeUndefined();
		expect(
			WorkflowSchema.parse({ ...definition, convergence: {} }).convergence,
		).toEqual({ maxUnchangedAttempts: 8, continueAttempts: 2 });
		for (const convergence of [
			{ maxUnchangedAttempts: 1 },
			{ maxUnchangedAttempts: 101 },
			{ maxUnchangedAttempts: 2.5 },
			{ continueAttempts: 0 },
			{ continueAttempts: 21 },
			{ continueAttempts: 1.5 },
		])
			expect(
				WorkflowSchema.safeParse({ ...definition, convergence }).success,
			).toBe(false);
		const { runtime, create } = fixture();
		const run = create([role("work", { next: "end" })]);
		expect(run.progressBudget).toMatchObject({
			version: 1,
			policy,
			window: { kind: "new-run", historyLength: 0 },
		});
		const accepted = structuredClone(run.progressBudget!.policy);
		runtime.updateWorkflows(
			runtime.listWorkflows().map((definition) =>
				definition.id === run.workflow.id
					? {
							...definition,
							convergence: {
								maxUnchangedAttempts: 100,
								continueAttempts: 20,
							},
						}
					: definition,
			),
		);
		await runtime.launch(run);
		expect(run.progressBudget!.policy).toEqual(accepted);
	});

	it("keeps a saved legacy run outside convergence even when its catalog opts in", async () => {
		const { home, workspace, runtime, create } = fixture();
		const definition = validateWorkflows([
			...defaultWorkflows,
			{
				id: "legacy-progress",
				name: "Legacy",
				steps: [role("work", { maxVisits: 2, next: "work" })],
			},
		]).at(-1)!;
		const run = runtime.create({
			title: "Legacy",
			repositoryId: "fixture",
			workspace,
			input: "Accepted",
			workflow: definition,
			triggerOrigin: {
				type: "manual",
				workflowId: definition.id,
				at: new Date().toISOString(),
			},
		});
		create([role("unused", { next: "end" })]);
		runtime.updateWorkflows([
			...runtime.listWorkflows(),
			{ ...definition, convergence: policy },
		]);
		await runtime.save(run);
		await runtime.shutdown();
		const restarted = load(home);
		const restored = restarted.get(run.id);
		await restarted.launch(restored);
		expect(restored.status).toBe("failed");
		expect(restored.iterationLimit).toMatchObject({ step: "work", limit: 2 });
		expect(restored.progressBudget).toBeUndefined();
	});
});

it("stops two-route ping-pong across fresh Call frames despite new summaries, attempt IDs and loose child policy", async () => {
	const calls: { key: string; attempt?: string; frame?: object }[] = [];
	const { runtime, create } = fixture({
		agent: async (context) => {
			calls.push({
				key: context.stepKey!,
				attempt: context.attemptId,
				frame: context.run.checkpoint?.active?.children?.[0],
			});
			return {
				summary: randomUUID(),
				attemptUUID: randomUUID(),
				evidence: { verified: randomUUID() },
			};
		},
	});
	const child = (id: string) => ({
		id,
		name: id,
		convergence: { maxUnchangedAttempts: 100 },
		steps: [role("repair", { next: "end" })],
	});
	const run = create(
		[
			{
				id: "left",
				name: "Left",
				type: "workflow",
				workflow: "left-child",
				next: "right",
				maxVisits: 100,
			},
			{
				id: "right",
				name: "Right",
				type: "workflow",
				workflow: "right-child",
				next: "left",
				maxVisits: 100,
			},
		],
		[child("left-child"), child("right-child")],
	);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toMatch(/^No progress at left\/repair:/);
	expect(calls.map(({ key }) => key)).toEqual([
		"left/repair",
		"right/repair",
		"left/repair",
		"right/repair",
	]);
	expect(calls[0]!.frame).not.toBe(calls[2]!.frame);
	expect(
		new Set(run.stepAttempts?.map((entry) => entry.id)).size,
	).toBeGreaterThan(2);
	expect(run.progressBudget!.policy).toEqual(policy);
	expect(run.progressBudget!.blocked).toMatchObject({
		step: "left/repair",
		attempts: 2,
		limit: 2,
		reason: "unchanged-work",
	});
	expect(observations(run).map((entry) => entry.attempts)).toEqual([2, 2]);
	expect(run.iterationLimit).toBeUndefined();
});

it("allows genuinely changed committed trees to make progress", async () => {
	let count = 0;
	const { runtime, create, commit } = fixture({
		agent: async () => {
			count++;
			if (count < 5) commit(`export const state = ${count};\n`);
			return { done: count === 5 };
		},
	});
	const run = create([
		loop({ branches: [{ when: { path: "done", equals: true }, next: "end" }] }),
	]);
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(count).toBe(5);
	expect(observations(run)).toHaveLength(5);
	expect(observations(run).every((entry) => entry.attempts === 1)).toBe(true);
});

it("retains the old counter when source oscillates A → B → A across new commits", async () => {
	let count = 0;
	const { runtime, create, commit, git } = fixture({
		agent: async () => {
			commit(`export const state = '${++count % 2 ? "B" : "A"}';\n`);
			return {};
		},
	});
	const initialTree = git("rev-parse", "HEAD^{tree}");
	const initialCommit = git("rev-parse", "HEAD");
	const run = create([loop()]);
	await runtime.launch(run);
	expect(count).toBe(4);
	expect(git("rev-parse", "HEAD^{tree}")).toBe(initialTree);
	expect(git("rev-parse", "HEAD")).not.toBe(initialCommit);
	expect(run.status).toBe("failed");
	expect(
		observations(run)
			.map((entry) => entry.attempts)
			.sort(),
	).toEqual([2, 2]);
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
});

it("does not treat empty commits, dirty source or alleged output evidence as new progress", async () => {
	let count = 0;
	const { runtime, workspace, create, commit, git } = fixture({
		agent: async () => {
			count++;
			commit();
			writeFileSync(join(workspace, "uncommitted.ts"), randomUUID());
			return {
				summary: randomUUID(),
				attemptUUID: randomUUID(),
				verified: true,
				status: `new-${count}`,
			};
		},
	});
	const before = git("rev-parse", "HEAD");
	const run = create([loop()]);
	await runtime.launch(run);
	expect(git("rev-parse", "HEAD")).not.toBe(before);
	expect(count).toBe(2);
	expect(observations(run)).toHaveLength(1);
	expect(run.progressBudget!.facts).toEqual({});
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
});

it("accepts new host answers while a passive human wait consumes no elapsed-time budget", async () => {
	const agent = vi.fn(async (context: ExecutionContext) =>
		context.run.answers.length < 3
			? { questions: ["Which accepted requirement should change?"] }
			: { questions: [], done: true },
	);
	const { runtime, create } = fixture({ agent });
	const run = create([
		loop({
			askQuestions: true,
			branches: [{ when: { path: "done", equals: true }, next: "end" }],
		}),
	]);
	const running = runtime.launch(run);
	for (const answer of [
		"Implement requirement A",
		"Implement requirement B",
		"Implement requirement C",
	]) {
		await waitForRuntime(() => expect(run.status, run.error).toBe("waiting"));
		const before = structuredClone(run.progressBudget);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 86_400_000);
		await runtime.save(run);
		expect(run.progressBudget).toEqual(before);
		vi.useRealTimers();
		runtime.answer(run.id, answer);
	}
	await running;
	expect(run.status, run.error).toBe("completed");
	expect(run.answers.map((entry) => entry.answer)).toEqual([
		"Implement requirement A",
		"Implement requirement B",
		"Implement requirement C",
	]);
	expect(agent.mock.calls.length).toBeGreaterThan(2);
	expect(run.progressBudget!.blocked).toBeUndefined();
});

it("uses production Check evidence once, then stops when the same verified evidence repeats", async () => {
	let executions = 0;
	const { runtime, create } = fixture({
		agent: async () => {
			executions++;
			return { files: ["source.ts"], ok: true, summary: randomUUID() };
		},
	});
	const run = create([
		role("work", { next: "proof" }),
		{
			id: "proof",
			name: "Verify committed source",
			type: "check",
			maxVisits: 100,
			reads: { candidate: "work" },
			checks: [{ check: "files-exist", path: "/inputs/candidate/files/*" }],
			check: {
				results: {
					present: { path: "/evidence/files-exist/verified", equals: true },
				},
			},
			next: "work",
		},
	]);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(executions).toBe(3);
	expect(run.history.find((entry) => entry.step === "proof")).toMatchObject({
		output: { passed: true, present: true },
		evidence: { "files-exist": { verified: true } },
	});
	expect(Object.keys(run.progressBudget!.facts).length).toBeGreaterThan(0);
	expect(run.progressBudget!.blocked).toMatchObject({
		step: "work",
		attempts: 2,
		limit: 2,
	});
});

it.each([
	"base-mismatch",
	"output-rejection",
	"infrastructure",
] as const)("retains repeated %s failures across restart without automatic continuation grants", async (kind) => {
	let physical = 0;
	const agent = async (context: ExecutionContext) => {
		physical++;
		await context.checkpointAgent?.({
			runner: "codex",
			sessionId: "retained-native-thread",
		});
		if (kind === "output-rejection")
			throw new OutputValidationError({ incomplete: true }, [
				{ path: "/required", message: "Required output absent" },
			]);
		throw new Error(
			kind === "base-mismatch"
				? "Base revision mismatch remains"
				: "Execution environment unavailable",
		);
	};
	const { home, runtime, create } = fixture({ agent });
	const run = create([role("work", { next: "end" })]);
	await runtime.launch(run);
	expect(physical).toBe(1);
	expect(run.status).toBe("failed");
	runtime.retry(run.id);
	await settled(runtime, run);
	expect(physical).toBe(2);
	expect(run.progressBudget!.grants).toEqual([]);
	const saved = structuredClone(run.progressBudget);
	await runtime.shutdown();
	const restarted = load(home, { agent });
	const restored = restarted.get(run.id);
	restarted.resumeAll();
	expect(restored.progressBudget).toEqual(saved);
	expect(physical).toBe(2);
	restarted.retry(run.id);
	await settled(restarted, restored);
	expect(physical).toBe(2);
	expect(restored.progressBudget!.blocked).toMatchObject({
		attempts: 2,
		limit: 2,
		lastFailure: { reason: expect.any(String) },
	});
	expect(restored.checkpoint?.active?.agent?.sessionId).toBe(
		"retained-native-thread",
	);
	expect(restored.progressBudget!.grants).toEqual([]);
});

it("charges each capable hook attempt including infrastructure failure before native startup", async () => {
	let physical = 0;
	const { runtime, create } = fixture({
		agentExecutionBoundary: true,
		agent: async (context) => {
			expect(context.beginProgressAttempt).toBeTypeOf("function");
			for (let startup = 0; startup < 3; startup++) {
				await context.beginProgressAttempt!("infrastructure-startup");
				physical++;
				try {
					throw new Error("Execution environment cannot start");
				} catch (error) {
					context.log(String(error));
				}
			}
			throw new Error("Unchanged infrastructure attempts were not bounded");
		},
	});
	const run = create([role("work", { next: "end" })]);
	await runtime.launch(run);
	expect(physical).toBe(2);
	expect(run.status).toBe("failed");
	expect(run.progressBudget!.recent.map((entry) => entry.reason)).toEqual([
		"infrastructure-startup",
		"infrastructure-startup",
	]);
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
	expect(run.checkpoint?.active?.agent).toBeUndefined();
});

it.each([
	"fanout",
	"foreach",
] as const)("retains completed %s siblings and native checkpoints when a blocked leaf is retried", async (type) => {
	const completed = barrier();
	const visits: string[] = [];
	let recover = false;
	const agent = async (context: ExecutionContext) => {
		const item = type === "fanout" ? context.step.id : context.iteration!.id;
		visits.push(item);
		if (item === "accepted") {
			completed.release();
			return { accepted: true };
		}
		await completed.promise;
		await waitForRuntime(() =>
			expect(
				context.run.history.some((entry) => entry.step.includes("accepted")),
			).toBe(true),
		);
		await context.checkpointAgent?.({
			runner: "codex",
			sessionId: "blocked-leaf-thread",
		});
		if (recover) {
			expect(context.resumeAgent?.sessionId).toBe("blocked-leaf-thread");
			return { recovered: true };
		}
		throw new Error("Output cannot complete yet");
	};
	const { home, runtime, create } = fixture({ agent });
	const run = create([
		type === "fanout"
			? {
					id: "batch",
					name: "Parallel",
					type,
					groups: [[role("accepted")], [role("blocked")]],
				}
			: {
					id: "batch",
					name: "For each",
					type,
					items: { values: [{ id: "accepted" }, { id: "blocked" }] },
					itemId: "/id",
					concurrency: 1,
					body: [role("work")],
				},
	]);
	await runtime.launch(run);
	runtime.retry(run.id);
	await settled(runtime, run);
	runtime.retry(run.id);
	await settled(runtime, run);
	expect(visits.filter((item) => item === "accepted")).toHaveLength(1);
	expect(visits.filter((item) => item === "blocked")).toHaveLength(2);
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
	const checkpoint = structuredClone(run.checkpoint);
	const history = structuredClone(run.history);
	await runtime.shutdown();
	const restarted = load(home, { agent });
	const restored = restarted.get(run.id);
	expect(restored.checkpoint).toEqual(checkpoint);
	expect(restored.history).toEqual(history);
	recover = true;
	restarted.retry(run.id);
	await settled(restarted, restored);
	expect(restored.status, restored.error).toBe("completed");
	expect(visits.filter((item) => item === "accepted")).toHaveLength(1);
	expect(visits.filter((item) => item === "blocked")).toHaveLength(3);
	expect(restored.history.slice(0, history.length)).toEqual(history);
	expect(restored.progressBudget!.grantCount).toBe(1);
});

it("distinguishes genuine initial For each items even when their source and operation match", async () => {
	const seen: string[] = [];
	const { runtime, create } = fixture({
		agent: async (context) => {
			seen.push(context.iteration!.id);
			return { complete: true };
		},
	});
	const run = create([
		{
			id: "batch",
			name: "Items",
			type: "foreach",
			items: { values: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] },
			itemId: "/id",
			concurrency: 2,
			body: [role("work")],
		},
	]);
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
	expect(attempts(run)).toBe(4);
});

it("leaves passive CI polling uncharged as time passes", async () => {
	const waiting = barrier();
	const entered = barrier();
	const { runtime, create } = fixture({
		tool: async () => {
			entered.release();
			await waiting.promise;
			return { ready: true };
		},
	});
	const run = create([
		{
			id: "ci",
			name: "Wait for checks",
			type: "tool",
			tool: "ci",
			next: "end",
		},
	]);
	const running = runtime.launch(run);
	await entered.promise;
	const before = structuredClone(run.progressBudget);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(Date.now() + 7 * 86_400_000);
	await runtime.save(run);
	expect(run.progressBudget).toEqual(before);
	expect(attempts(run)).toBe(0);
	vi.useRealTimers();
	waiting.release();
	await running;
	expect(run.status, run.error).toBe("completed");
	expect(attempts(run)).toBe(0);
});

it("retains interrupted physical attempts and native identity over repeated automatic restarts", async () => {
	let physical = 0;
	const agent = async (context: ExecutionContext) => {
		physical++;
		if (physical > 1)
			expect(context.resumeAgent?.sessionId).toBe("interrupted-native");
		await context.checkpointAgent?.({
			runner: "codex",
			sessionId: "interrupted-native",
		});
		await new Promise<void>((_resolve, reject) => {
			const abort = () => reject(new Error("Interrupted physical execution"));
			if (context.signal.aborted) abort();
			else context.signal.addEventListener("abort", abort, { once: true });
		});
		return {};
	};
	const { home, runtime, create } = fixture({ agent });
	const run = create([role("work", { next: "end" })]);
	void runtime.launch(run);
	await waitForRuntime(() =>
		expect(run.checkpoint?.active?.agent?.sessionId).toBe("interrupted-native"),
	);
	await runtime.shutdown();
	expect(physical).toBe(1);
	expect(attempts(run)).toBe(1);
	const second = load(home, { agent });
	second.resumeAll();
	await waitForRuntime(() => expect(physical).toBe(2));
	await second.shutdown();
	const third = load(home, { agent });
	const restored = third.get(run.id);
	third.resumeAll();
	await settled(third, restored);
	expect(physical).toBe(2);
	expect(restored.status).toBe("failed");
	expect(restored.progressBudget!.blocked).toMatchObject({
		attempts: 2,
		limit: 2,
		lastFailure: { kind: "interrupted" },
	});
	expect(restored.progressBudget!.grantCount).toBe(0);
	expect(restored.checkpoint?.active?.agent?.sessionId).toBe(
		"interrupted-native",
	);
});

it("does not charge a script waiting for capacity before admission", async () => {
	const capacityEntered = barrier();
	const admit = barrier();
	const script = vi.fn(async () => ({ completed: true }));
	const { runtime, create } = fixture({
		script,
		capacity: {
			acquireLease: async () => {
				capacityEntered.release();
				await admit.promise;
				return {
					token: "fixture-only-capacity",
					run: (operation) => operation(),
					release: async () => {},
				};
			},
		},
	});
	const run = create([
		{
			id: "work",
			name: "Script",
			type: "script",
			script: "Controlled hook",
			next: "end",
		},
	]);
	const running = runtime.launch(run);
	await capacityEntered.promise;
	const before = structuredClone(run.progressBudget);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(Date.now() + 86_400_000);
	await runtime.save(run);
	expect(run.progressBudget).toEqual(before);
	expect(attempts(run)).toBe(0);
	expect(script).not.toHaveBeenCalled();
	vi.useRealTimers();
	admit.release();
	await running;
	expect(run.status, run.error).toBe("completed");
	expect(attempts(run)).toBe(1);
	expect(script).toHaveBeenCalledOnce();
});

it("does not charge work queued behind an owned shared resource", async () => {
	const entered = barrier();
	const releaseOwner = barrier();
	const visits: string[] = [];
	let ownerId: string;
	const { runtime, create } = fixture({
		agent: async (context) => {
			visits.push(context.run.id);
			if (context.run.id === ownerId) {
				entered.release();
				await releaseOwner.promise;
			}
			return { done: true };
		},
	});
	const steps = [
		role("work", { resources: ["task147-shared-qa"], next: "end" }),
	];
	const owner = create(steps);
	ownerId = owner.id;
	const first = runtime.launch(owner);
	await entered.promise;
	const queued = create(steps);
	const second = runtime.launch(queued);
	await waitForRuntime(() =>
		expect(queued.deliveryCoordination?.phase).toBe("queued"),
	);
	const before = structuredClone(queued.progressBudget);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(Date.now() + 86_400_000);
	await runtime.save(queued);
	expect(queued.progressBudget).toEqual(before);
	expect(attempts(queued)).toBe(0);
	expect(visits).toEqual([owner.id]);
	vi.useRealTimers();
	releaseOwner.release();
	await Promise.all([first, second]);
	expect(queued.status, queued.error).toBe("completed");
	expect(attempts(queued)).toBe(1);
});

it("bounded Continue retains the actual human approval requirement before merge", async () => {
	let corrected = false;
	const tools = new FactoryTools({ postComment: async () => {} });
	const { runtime, create } = fixture({
		agent: async () => ({ finished: corrected }),
		tool: (context) => tools.tool(context),
	});
	const run = create([
		loop({
			branches: [{ when: { path: "finished", equals: true }, next: "merge" }],
		}),
		{
			id: "merge",
			name: "Merge guarded revision",
			type: "tool",
			tool: "merge",
			next: "end",
		},
	]);
	await runtime.launch(run);
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
	const history = structuredClone(run.history);
	const workflow = structuredClone(run.workflow);
	corrected = true;
	runtime.retry(run.id);
	await settled(runtime, run);
	expect(run.status).toBe("failed");
	expect(run.error).toMatch(/Explicit human approval required before merge/);
	expect(run.workflow).toEqual(workflow);
	expect(run.history.slice(0, history.length)).toEqual(history);
	expect(run.humanDecisions ?? []).toEqual([]);
	expect(run.outputs.merge).toBeUndefined();
	expect(run.progressBudget!.grants).toHaveLength(1);
	expect(run.progressBudget!.grants[0]!.attempts).toBe(1);
});

it("retains the original custom visit limit and its explicit additional-visit grant", async () => {
	const { runtime, create } = fixture();
	const run = create([loop({ maxVisits: 1 })]);
	await runtime.launch(run);
	expect(run.iterationLimit).toEqual({ step: "work", visits: 2, limit: 1 });
	expect(attempts(run)).toBe(1);
	expect(run.progressBudget!.grants).toEqual([]);
	runtime.retry(run.id);
	await settled(runtime, run);
	expect(run.workflow.steps[0]!.maxVisits).toBe(1);
	expect(run.checkpoint!.additionalVisits!.work).toBe(4);
	expect(run.progressBudget!.blocked).toMatchObject({ attempts: 2, limit: 2 });
	expect(run.progressBudget!.grants).toEqual([]);
});

it("keeps distinct structural For each bodies independent when their role and item names match", async () => {
	const visits: string[] = [];
	const { runtime, create } = fixture({
		agent: async (context) => {
			visits.push(context.stepKey!);
			return { complete: true };
		},
	});
	const run = create(
		["first", "second", "third"].map((id) => ({
			id,
			name: id,
			type: "foreach",
			items: { values: [{ id: "a" }] },
			itemId: "/id",
			body: [role("work")],
		})),
	);
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(visits).toEqual(["first/a/work", "second/a/work", "third/a/work"]);
	expect(observations(run)).toHaveLength(3);
	expect(new Set(observations(run).map((entry) => entry.operation)).size).toBe(
		3,
	);
});
