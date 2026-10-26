import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IAgentRunner } from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import {
	acquireDelivery,
	deliveryScopes,
	releaseDelivery,
} from "../src/factory/DeliveryCoordination.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { timingOperation } from "../src/factory/RunDiagnostics.js";
import { validateWorkflows, type Workflow } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import type {
	CapacityRequest,
	ExecutionCapacity,
} from "../src/MachineCapacity.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

// Narrow mocked F1 seams: real runtime reconstruction, question continuation,
// runner admission and grouped reservation owners. No server/web shell, native or provider I/O.
const runtimes: WorkflowRuntime[] = [],
	homes: string[] = [],
	gates: (() => void)[] = [];
afterEach(async () => {
	for (const release of gates.splice(0)) release();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function gate() {
	let release!: () => void;
	const promise = new Promise<void>((done) => {
		release = done;
	});
	gates.push(release);
	return { promise, release };
}
function request(
	phase: CapacityRequest["phase"],
	parked = false,
): CapacityRequest {
	return {
		id: "mock",
		token: "mock",
		identity: "mock",
		sequence: 1,
		queuedAt: "2026-10-23T10:00:00.000Z",
		owner: { pid: 1, start: "mock", incarnation: "mock" },
		phase,
		parked,
		remote: false,
		recoverable: true,
		background: false,
	};
}
const capacity: ExecutionCapacity = {
	async acquireLease(signal, options) {
		signal?.throwIfAborted();
		options?.onChange?.(request("queued"));
		options?.onChange?.(request("executing"));
		return {
			token: "mock",
			run: (work) => work(),
			release: async () => options?.onChange?.(undefined),
		};
	},
};
function fixture(hooks: Partial<RuntimeHooks> = {}, home?: string) {
	if (!home) {
		home = mkdtempSync(join(tmpdir(), "task148-boundary-"));
		homes.push(home);
	}
	let wall = Date.parse("2026-10-23T10:00:00.000Z"),
		mono = 0;
	const runtime = new WorkflowRuntime(
		home,
		{ agent: async () => ({}), ...hooks },
		{ wall: () => wall, mono: () => mono },
	);
	runtimes.push(runtime);
	const create = (
		workflow: Workflow = {
			engineVersion: "nodes-v1",
			id: "timed",
			name: "Timed",
			steps: [
				{
					id: "role",
					name: "Role",
					type: "agent",
					prompt: "Mock only",
					access: { mode: "read-only" },
					next: "end",
				},
			],
		},
	) => {
		const definitions = validateWorkflows([
			...defaultWorkflows.filter((w) => w.id !== workflow.id),
			workflow,
		]);
		runtime.updateWorkflows(definitions);
		return runtime.create({
			title: "Synthetic timing boundary",
			repositoryId: "fixture",
			workspace: home!,
			workflow,
			workflowDefinitions: definitions,
			input: "mock",
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date(wall).toISOString(),
			},
		});
	};
	return {
		runtime,
		home,
		create,
		tick: async (run: FactoryRun, ms: number) => {
			wall += ms;
			mono += ms;
			await runtime.save(run);
		},
	};
}

it("P148-R1-S1: reconstructed executing and parked scheduling records stay unknown during actual preparation", async () => {
	const original = fixture();
	const runs = [original.create(), original.create()];
	original.runtime.capacityOptions(runs[0], "retained").onChange!(
		request("executing"),
	);
	original.runtime.capacityOptions(runs[1], "retained").onChange!(
		request("queued", true),
	);
	await original.runtime.flush();
	const saved = runs.map((run) => structuredClone(run.capacityLeaves));
	await original.runtime.shutdown();
	const preparing = gate();
	let preparations = 0;
	const resumed = fixture(
		{
			prepare: async () => {
				preparations++;
				await preparing.promise;
			},
		},
		original.home,
	);
	const restored = runs.map((run) => resumed.runtime.get(run.id));
	const completed = restored.map((run) => resumed.runtime.launch(run));
	await waitFor(() => expect(preparations).toBe(2));
	for (let i = 0; i < restored.length; i++) {
		await resumed.tick(restored[i], 2000);
		expect(restored[i].diagnostics).toMatchObject({
			executionMs: 0,
			waitMs: 0,
			roleWallMs: 0,
		});
		expect(restored[i].capacityLeaves).toEqual(saved[i]);
		expect(
			Object.values(restored[i].diagnostics!.active).map((s) => s.kind),
		).toEqual(["recovery"]);
	}
	preparing.release();
	await Promise.all(completed);
});

it("R148-R1-01: a generic lease with zero agent turns keeps execution but no agent-role sum", async () => {
	const hold = gate();
	let entered = false;
	const f = fixture(),
		run = f.create();
	const done = f.runtime.launch(run, async (signal) => {
		const lease = await capacity.acquireLease(
			signal,
			f.runtime.capacityOptions(run, "arbitrary-discovery-lease"),
		);
		try {
			await lease.run(async () => {
				entered = true;
				await hold.promise;
			});
		} finally {
			await lease.release();
		}
	});
	await waitFor(() => expect(entered).toBe(true));
	await f.tick(run, 2000);
	expect(
		run.stepAttempts?.filter((a) => a.kind === "agent-turn") ?? [],
	).toEqual([]);
	expect(run.diagnostics).toMatchObject({ executionMs: 2000, roleWallMs: 0 });
	hold.release();
	await done;
});

it("keeps actual Simple runner timing when capacity fallback has no role attribution", async () => {
	const hold = gate();
	let entered = false;
	const f = fixture();
	const run = f.create(defaultWorkflows.find((w) => w.id === "simple")!);
	run.simpleExecution = {
		runner: "codex",
		userPrompt: "mock",
		systemPrompt: "mock",
	};
	const mockRunner = {
		start: async () => {
			entered = true;
			await hold.promise;
		},
		stop() {},
		getMessages: () => [],
	} as unknown as IAgentRunner;
	const owner = {
		agentSessionManager: { getSession: () => ({}), addAgentRunner() {} },
		factoryRepositories: () => [{ id: "fixture", repositoryPath: f.home }],
		buildAgentRunnerConfig: async () => ({ config: {}, runnerType: "codex" }),
		buildAllowedTools: () => [],
		buildDisallowedTools: () => [],
		getDefaultFallbackModelForRunner: () => undefined,
		applyRunExecution: async () => {},
		buildRunnerForType: () => mockRunner,
		runnerSlots: capacity,
		getFactoryRuntime: () => f.runtime,
	};
	const execute = (
		EdgeWorker.prototype as unknown as {
			executeSimpleFactoryRun(
				run: FactoryRun,
				signal: AbortSignal,
			): Promise<void>;
		}
	).executeSimpleFactoryRun;
	const done = f.runtime.launch(run, (signal) =>
		execute.call(owner, run, signal),
	);
	await waitFor(() => expect(entered).toBe(true));
	await f.tick(run, 2000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 2000,
		roleWallMs: 2000,
	});
	hold.release();
	await done;
	expect(run.diagnostics!.operations.simple).toBeUndefined();
});

it.each([
	"qa-only",
	"repository-only",
	"both",
] as const)("P148-R1-S3: grouped mutation follows actual %s blockers without double-counting", async (scenario) => {
	let entered = false;
	const hold = gate();
	const f = fixture({
		agentExecutionBoundary: true,
		agent: async (context) => {
			context.capacity!.onChange!(request("executing"));
			const release = await context.reserveExecution!();
			try {
				timingOperation(context.run, context.stepKey!, {
					kind: "execution",
					role: true,
				});
				await context.save?.();
				entered = true;
				await hold.promise;
				return {};
			} finally {
				timingOperation(context.run, context.stepKey!);
				await release();
				context.capacity!.onChange!(undefined);
			}
		},
	});
	const qaOwner = f.create(),
		repoOwner = f.create();
	const run = f.create({
		engineVersion: "nodes-v1",
		id: "combined",
		name: "Combined",
		steps: [
			{
				id: "publisher",
				name: "Publisher",
				type: "agent",
				prompt: "Mock",
				access: { mode: "push" },
				resources: ["docker"],
				next: "end",
			},
		],
	});
	const qa = '["resource","docker"]',
		scopes = deliveryScopes(run);
	expect(scopes.length).toBeGreaterThan(0);
	const acquire = (owner: FactoryRun, targets: string[]) =>
		acquireDelivery(
			owner,
			() => f.runtime.runs.values(),
			new AbortController().signal,
			() => f.runtime.save(owner),
			() => {},
			{ key: "held:mutation", scopes: targets },
		);
	if (scenario !== "repository-only") await acquire(qaOwner, [qa]);
	if (scenario !== "qa-only") await acquire(repoOwner, scopes);
	const done = f.runtime.launch(run);
	await waitFor(() =>
		expect(
			run.deliveryReservations?.["publisher:mutation"]?.blockers,
		).toHaveLength(scenario === "both" ? 2 : 1),
	);
	const claim = run.deliveryReservations!["publisher:mutation"]!;
	await f.tick(run, 2000);
	expect(run.diagnostics!.waits).toEqual(
		scenario === "qa-only"
			? { "qa-resource": 2000 }
			: scenario === "repository-only"
				? { repository: 2000 }
				: { "qa-resource": 2000, repository: 2000 },
	);
	expect(run.diagnostics).toMatchObject({
		executionMs: 0,
		waitMs: 2000,
		roleWallMs: 0,
	});
	expect(run.deliveryReservations!["publisher:mutation"]).toBe(claim);
	if (scenario === "both") {
		releaseDelivery(qaOwner, "Synthetic QA owner finished");
		await f.runtime.save(qaOwner);
		await waitFor(() =>
			expect(claim.blockers?.map((b) => b.runId)).toEqual([repoOwner.id]),
		);
		await f.tick(run, 2000);
		expect(run.diagnostics).toMatchObject({
			waitMs: 4000,
			waits: { "qa-resource": 2000, repository: 4000 },
		});
		expect(run.diagnostics!.active.publisher.kind).toBe("repository");
	}
	expect(entered).toBe(false);
	releaseDelivery(qaOwner, "Synthetic owner finished");
	releaseDelivery(repoOwner, "Synthetic owner finished");
	await f.runtime.save(qaOwner);
	await f.runtime.save(repoOwner);
	await waitFor(() => expect(entered).toBe(true));
	await f.tick(run, 1000);
	expect(run.diagnostics).toMatchObject({
		executionMs: 1000,
		waitMs: scenario === "both" ? 4000 : 2000,
		roleWallMs: 1000,
	});
	expect(claim.phase).toBe("active");
	expect(claim.scopes).toEqual([...new Set([...scopes, qa])].sort());
	hold.release();
	await done;
	expect(claim.phase).toBe("released");
});
