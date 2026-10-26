import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IIssueTrackerService } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import type { GitProvider } from "../src/factory/GitProvider.js";
import { nodeRegistry } from "../src/factory/nodes/index.js";
import { nodeEffect } from "../src/factory/nodes/metadata.js";
import { fileTicketIO } from "../src/factory/RepositoryTicketIO.js";
import {
	nativeTicketIO,
	type TicketIOAdapter,
	taskbotTicketIO,
} from "../src/factory/TicketIO.js";
import type {
	TicketReference,
	TicketSnapshot,
} from "../src/factory/TicketTracking.js";
import {
	StepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../src/MachineCapacity.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [],
	runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const baseHooks = {
	agent: async () => ({}),
	tool: async () => ({}),
	script: async () => ({}),
};
function setup(
	steps: unknown[],
	hooks: Partial<RuntimeHooks> = {},
	home = mkdtempSync(join(tmpdir(), "factory-io-")),
) {
	if (!homes.includes(home)) homes.push(home);
	const runtime = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
	runtimes.push(runtime);
	const workflow = WorkflowSchema.parse({
		id: "io",
		name: "IO",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		steps,
	});
	const run = runtime.create({
		title: "IO",
		repositoryId: "one",
		workspace: home,
		input: "test",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: "io",
			at: new Date().toISOString(),
		},
	});
	run.repositories = ["one", "two"].map((id) => ({
		id,
		name: id,
		workspace: home,
		repositoryPath: home,
		baseBranch: "main",
		githubUrl: `https://github.com/test/${id}`,
	}));
	return { runtime, run, home };
}
const step = (type: string, fields = {}) => ({
	id: "io",
	name: "IO",
	type,
	...fields,
});
const request = (repositoryId = "one") => ({
	repositoryId,
	url: `https://github.com/test/${repositoryId}/pull/1`,
	headSha: "head",
});
function provider() {
	let state = "OPEN",
		polls = 0;
	const merge = vi.fn(async () => {
		state = "MERGED";
	});
	const view = vi.fn(async () => ({
		state,
		isDraft: false,
		headRefOid: "head",
		...(state === "MERGED" ? { mergeCommitSha: "commit" } : {}),
	}));
	const value = {
		view,
		merge,
		readiness: async () => ({ mergeMethod: "squash" }),
	} as unknown as GitProvider;
	return {
		value,
		merge,
		view,
		set: (value: string) => {
			state = value;
		},
		queued: () => {
			merge.mockImplementation(async () => {
				state = "OPEN";
			});
			view.mockImplementation(async () => {
				if (merge.mock.calls.length && ++polls > 2) state = "MERGED";
				return {
					state,
					isDraft: false,
					headRefOid: "head",
					...(state === "MERGED" ? { mergeCommitSha: "commit" } : {}),
				};
			});
		},
	};
}
it("merges two repositories independently and waits for queue confirmation without holding capacity", async () => {
	const one = provider(),
		two = provider();
	one.queued();
	const ioGitProvider = vi.fn(async (ctx: ExecutionContext) =>
		ctx.run.repositoryId === "one" ? one.value : two.value,
	);
	const { runtime, run } = setup(
		[step("merge", { requests: [request(), request("two")], pollInterval: 1 })],
		{ ioGitProvider },
	);
	await runtime.launch(run);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(run.outputs.io).toEqual({
		repositories: ["one", "two"].map((repositoryId) => ({
			repositoryId,
			merged: true,
			sha: "commit",
			url: request(repositoryId).url,
		})),
	});
	expect(one.merge).toHaveBeenCalledExactlyOnceWith(
		request().url,
		"head",
		"squash",
	);
	expect(two.merge).toHaveBeenCalledTimes(1);
	expect(one.view.mock.calls.length).toBeGreaterThan(3);
	expect(
		Object.values(run.deliveryReservations!).every(
			(reservation) => reservation.phase === "released",
		),
	).toBe(true);
	expect(
		Object.values(run.nodeEffects!).every(
			(effect) => effect.phase === "confirmed",
		),
	).toBe(true);
});
it("reconciles an uncertain merge across a cold restart without another merge request", async () => {
	const fake = provider();
	fake.merge.mockImplementation(async () => {
		throw new Error("lost response");
	});
	const hooks = { ioGitProvider: async () => fake.value };
	const { runtime, run, home } = setup(
		[step("merge", { requests: [request()], pollInterval: 1, timeout: 20 })],
		hooks,
	);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(Object.values(run.nodeEffects!)[0]?.phase).toBe("uncertain");
	await runtime.shutdown();
	const resumed = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
	runtimes.push(resumed);
	fake.set("MERGED");
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect({
			status: resumed.get(run.id).status,
			error: resumed.get(run.id).error,
		}).toMatchObject({ status: "completed" }),
	);
	expect(fake.merge).toHaveBeenCalledTimes(1);
	expect(resumed.get(run.id).outputs.io).toEqual({
		repositories: [
			{ repositoryId: "one", merged: true, sha: "commit", url: request().url },
		],
	});
});
it("does not merge a changed revision or treat an open PR as proof a merge was absent", async () => {
	const fake = provider();
	fake.view.mockResolvedValue({
		state: "OPEN",
		isDraft: false,
		headRefOid: "other",
	});
	const { runtime, run } = setup([step("merge", { requests: [request()] })], {
		ioGitProvider: async () => fake.value,
	});
	await runtime.launch(run);
	expect(run.error).toContain("head changed");
	expect(fake.merge).not.toHaveBeenCalled();
});

const nativeRef: TicketReference = {
	provider: "native",
	platform: "linear",
	workspaceId: "ws",
	id: "ticket",
	url: "https://linear.app/test/issue/T-1",
};
const taskbotRef: TicketReference = {
	provider: "taskbot",
	server: "taskbot",
	instance: "https://tickets.test",
	project: "test",
	id: 1,
	url: "https://tickets.test/p/test/t/1",
};
function tickets(provider: "linear" | "taskbot") {
	const snapshot: TicketSnapshot = {
		id: provider === "linear" ? "ticket" : 1,
		project: "test",
		url: provider === "linear" ? nativeRef.url : taskbotRef.url,
		title: "Before",
		description: "Before",
		body: "Before",
		status: "todo",
		state: { type: "unstarted" },
		team: { id: "team" },
		comments: [],
		attachments: [],
	};
	const writes = vi.fn(async () => {});
	const created = new Map<string, { id: string; url: string }>();
	const create: TicketIOAdapter["create"] = async (_fields, key, reconcile) => {
		if (created.has(key)) return created.get(key);
		if (reconcile) return undefined;
		created.set(key, { id: "new", url: "https://tickets.test/new" });
		await writes();
		return created.get(key);
	};
	let adapter: TicketIOAdapter;
	if (provider === "linear") {
		const tracker = {
			getPlatformType: () => "linear",
			getIssueLabels: async () => [],
			fetchComments: async () => ({ nodes: snapshot.comments }),
			fetchIssueAttachments: async () => snapshot.attachments,
			fetchIssue: async () => ({
				...snapshot,
				createdAt: new Date(),
				updatedAt: new Date(),
				state: snapshot.state,
			}),
			fetchWorkflowStates: async () => ({
				nodes: [{ id: "started", type: "started" }],
			}),
			updateIssue: async (_id: string, fields: Record<string, unknown>) => {
				Object.assign(snapshot, fields);
				if (fields.stateId) snapshot.state = { type: fields.stateId };
				await writes();
				return snapshot;
			},
			createComment: async (_id: string, { body }: { body: string }) => {
				snapshot.comments.push({ body });
				await writes();
				return {};
			},
			linkPullRequest: async (_id: string, url: string) => {
				snapshot.attachments.push({ url });
				await writes();
			},
		} as unknown as IIssueTrackerService;
		adapter = nativeTicketIO(
			nativeRef as Extract<TicketReference, { provider: "native" }>,
			tracker,
			create,
		);
	} else {
		adapter = taskbotTicketIO(
			taskbotRef as Extract<TicketReference, { provider: "taskbot" }>,
			async (tool, args) => {
				if (tool === "get_ticket") return structuredClone(snapshot);
				if (tool === "comment")
					snapshot.comments.push({ body: String(args.body) });
				if (tool === "set_status") {
					snapshot.status = args.to;
					delete snapshot.state;
				}
				if (tool === "update_ticket") {
					if (args.title) snapshot.title = args.title;
					if (args.body) snapshot.body = args.body;
				}
				if (tool === "add_attachment")
					snapshot.attachments.push({ url: String(args.url) });
				await writes();
				return {};
			},
			create,
		);
	}
	return {
		adapter,
		writes,
		snapshot,
		ref: provider === "linear" ? nativeRef : taskbotRef,
	};
}
it.each([
	"linear",
	"taskbot",
] as const)("executes every ticket op on %s and deduplicates each lost mutation across restart", async (name) => {
	const fake = tickets(name);
	for (const op of [
		"read",
		"comment",
		"set-status",
		"update",
		"create",
		"link",
	]) {
		const hooks = {
			ticketIO: async () => fake.adapter,
			track: vi.fn(async () => {}),
		};
		const { runtime, run, home } = setup(
			[
				step("ticket", {
					op,
					reference: fake.ref,
					commentBody: "Bound message",
					fields: { title: "After", description: "After" },
					statusType: "started",
					url: "https://github.com/test/one/pull/1",
				}),
			],
			hooks,
		);
		run.ticketReference = fake.ref;
		const before = fake.writes.mock.calls.length;
		if (op !== "read")
			fake.writes.mockRejectedValueOnce(new Error("lost mutation response"));
		await runtime.launch(run);
		expect(hooks.track).not.toHaveBeenCalled();
		if (op === "read") {
			expect(run.status).toBe("completed");
			expect((run.outputs.io as TicketSnapshot).title).toBe("Before");
			continue;
		}
		expect(run.status).toBe("failed");
		expect(Object.values(run.nodeEffects!)[0]?.phase).toBe("uncertain");
		await runtime.shutdown();
		const resumed = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
		runtimes.push(resumed);
		resumed.retry(run.id);
		await waitForRuntime(() =>
			expect(resumed.get(run.id).status).toBe("completed"),
		);
		expect(fake.writes.mock.calls.length).toBe(before + 1);
		expect(resumed.get(run.id).outputs.io).toMatchObject({ ok: true });
	}
});
it("keeps legacy ticket milestones while nodes-v1 requires explicit ticket operations", async () => {
	const track = vi.fn(async () => {});
	const { runtime, run } = setup(
		[step("exec", { command: "/bin/echo", args: ["test"] })],
		{ track },
	);
	run.ticketReference = nativeRef;
	await runtime.track(run, {
		key: "old-tool-name",
		stage: "in_progress",
		body: "implicit",
	});
	expect(track).not.toHaveBeenCalled();
	expect(run.ticketSync).toBeUndefined();
	delete run.workflow.engineVersion;
	await runtime.track(run, {
		key: "old-tool-name",
		stage: "in_progress",
		body: "implicit",
	});
	expect(track).toHaveBeenCalledTimes(1);
});
it("classifies ticket and exec operations individually for read-only polling", () => {
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			WorkflowSchema.parse({
				id: "exec-io",
				name: "Exec IO",
				engineVersion: "nodes-v1",
				steps: [step("exec", { command: "git", access: "read-only" })],
			}),
		]),
	).not.toThrow();
	expect(
		nodeRegistry.effectFor(StepSchema.parse(step("ticket", { op: "read" }))),
	).toBe("read-only");
	expect(
		nodeRegistry.effectFor(StepSchema.parse(step("ticket", { op: "comment" }))),
	).toBe("effect");
	expect(
		nodeRegistry.effectFor(
			StepSchema.parse(step("exec", { command: "git", access: "read-only" })),
		),
	).toBe("read-only");
	expect(
		nodeRegistry.effectFor(
			StepSchema.parse(step("exec", { command: "git", access: "workspace" })),
		),
	).toBe("effect");
});
it("creates persistent file tickets using the effect identity and supports every operation", async () => {
	const { home } = setup([]);
	const root = fileTicketIO(join(home, "tickets"), "origin");
	const created = await root.create({ title: "Test" }, "effect", false);
	expect(await root.create({ title: "Test" }, "effect", true)).toEqual(created);
	const adapter = fileTicketIO(join(home, "tickets"), created!.id);
	await adapter.comment("one");
	await adapter.comment("one");
	await adapter.link("https://example.test");
	await adapter.setStatus("completed");
	await adapter.update({ title: "Updated" });
	expect(await adapter.read()).toMatchObject({
		title: "Updated",
		state: { type: "completed" },
		comments: [{ body: "one" }],
		attachments: [{ url: "https://example.test" }],
	});
});

it("does not confirm Taskbot mutations when the provider returns an error payload", async () => {
	const adapter = taskbotTicketIO(
		taskbotRef as Extract<TicketReference, { provider: "taskbot" }>,
		async () => ({ error: "denied" }),
		async () => undefined,
	);
	await expect(adapter.update({ title: "Changed" })).rejects.toThrow("failed");
});

it.each([
	"provider",
	"view",
	"readiness",
])("retries a merge after a pre-dispatch %s failure across restart", async (failure) => {
	const fake = provider();
	const ioGitProvider = vi.fn(async () => fake.value);
	if (failure === "provider")
		ioGitProvider.mockRejectedValueOnce(new Error("preflight unavailable"));
	if (failure === "view")
		fake.view.mockRejectedValueOnce(new Error("preflight unavailable"));
	if (failure === "readiness")
		fake.value.readiness = vi
			.fn(fake.value.readiness)
			.mockRejectedValueOnce(new Error("preflight unavailable"));
	const hooks = { ioGitProvider };
	const { runtime, run, home } = setup(
		[step("merge", { requests: [request()], pollInterval: 1, timeout: 100 })],
		hooks,
	);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain("preflight unavailable");
	expect(fake.merge).not.toHaveBeenCalled();
	expect(Object.values(run.nodeEffects ?? {})).toEqual([]);
	await runtime.shutdown();
	const resumed = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
	runtimes.push(resumed);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(fake.merge).toHaveBeenCalledTimes(1);
});

it("restarts a merge aborted while queued for its repository reservation", async () => {
	const { acquireDelivery, releaseDelivery } = await import(
		"../src/factory/DeliveryCoordination.js"
	);
	const fake = provider();
	const hooks = { ioGitProvider: async () => fake.value };
	const { runtime, run, home } = setup(
		[step("merge", { requests: [request()], pollInterval: 1 })],
		hooks,
	);
	const blocker = structuredClone(run);
	blocker.id = "reservation-holder";
	blocker.status = "running";
	runtime.runs.set(blocker.id, blocker);
	await acquireDelivery(
		blocker,
		() => runtime.runs.values(),
		new AbortController().signal,
		async () => {},
		() => {},
		{
			key: "holder",
			scopes: [JSON.stringify(["https://github.com/test/one", "main"])],
		},
	);
	const pending = runtime.launch(run);
	await waitForRuntime(() =>
		expect(
			Object.values(run.deliveryReservations ?? {}).some(
				(value) => value.phase === "queued",
			),
		).toBe(true),
	);
	expect(fake.merge).not.toHaveBeenCalled();
	expect(Object.values(run.nodeEffects ?? {})).toEqual([]);
	await runtime.shutdown();
	await pending;
	releaseDelivery(blocker, "test release", "holder");
	const resumed = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
	runtimes.push(resumed);
	resumed.resumeAll();
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(fake.merge).toHaveBeenCalledTimes(1);
});

it("lets another run acquire the same repository while merge confirmation is queued", async () => {
	const { acquireDelivery, releaseDelivery } = await import(
		"../src/factory/DeliveryCoordination.js"
	);
	const fake = provider();
	fake.merge.mockImplementation(async () => {});
	const { runtime, run } = setup(
		[step("merge", { requests: [request()], pollInterval: 1 })],
		{ ioGitProvider: async () => fake.value },
	);
	const pending = runtime.launch(run);
	await waitForRuntime(() =>
		expect(fake.view.mock.calls.length).toBeGreaterThan(2),
	);
	expect(run.capacityLeaves?.io).toEqual({ phase: "waiting-ci" });
	expect(
		Object.values(run.deliveryReservations!).every(
			(value) => value.phase === "released",
		),
	).toBe(true);
	const contender = structuredClone(run);
	contender.id = "contender";
	contender.deliveryReservations = {};
	runtime.runs.set(contender.id, contender);
	await acquireDelivery(
		contender,
		() => runtime.runs.values(),
		AbortSignal.timeout(1000),
		async () => {},
		() => {},
		{
			key: "contender",
			scopes: [JSON.stringify(["https://github.com/test/one", "main"])],
		},
	);
	expect(contender.deliveryReservations?.contender?.phase).toBe("active");
	releaseDelivery(contender, "test release", "contender");
	fake.set("MERGED");
	await pending;
	expect(run.status).toBe("completed");
});

it("retries exec after shutdown during capacity admission without an uncertain command", async () => {
	let queued = false;
	const { runtime, run, home } = setup(
		[
			step("exec", {
				command: "/bin/sh",
				args: ["-c", "printf executed > executed"],
				access: "workspace",
			}),
		],
		{
			capacity: {
				acquireLease: async (signal) => {
					queued = true;
					return await new Promise((_resolve, reject) => {
						if (signal!.aborted) reject(signal!.reason);
						else
							signal!.addEventListener("abort", () => reject(signal!.reason), {
								once: true,
							});
					});
				},
			},
		},
	);
	const pending = runtime.launch(run);
	await waitForRuntime(() => expect(queued).toBe(true));
	await runtime.shutdown();
	await pending;
	expect(Object.values(run.nodeEffects ?? {})).toEqual([]);
	const resumed = new WorkflowRuntime(home, baseHooks);
	runtimes.push(resumed);
	resumed.resumeAll();
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(resumed.get(run.id).outputs.io).toMatchObject({ exitCode: 0 });
	expect(readFileSync(join(home, "executed"), "utf8")).toBe("executed");
});

it.each([
	"set-status",
	"update",
	"link",
])("retries idempotent ticket %s after a failure before writing", async (op) => {
	const fake = tickets("linear");
	const method = op === "set-status" ? "setStatus" : op;
	const write = vi
		.spyOn(fake.adapter, method as "setStatus")
		.mockRejectedValueOnce(new Error("before write"));
	const hooks = { ticketIO: async () => fake.adapter };
	const { runtime, run, home } = setup(
		[
			step("ticket", {
				op,
				reference: fake.ref,
				fields: { title: "After" },
				statusType: "started",
				url: "https://example.test/link",
			}),
		],
		hooks,
	);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(fake.writes).not.toHaveBeenCalled();
	await runtime.shutdown();
	const resumed = new WorkflowRuntime(home, { ...baseHooks, ...hooks });
	runtimes.push(resumed);
	resumed.retry(run.id);
	await waitForRuntime(() =>
		expect(resumed.get(run.id).status).toBe("completed"),
	);
	expect(write).toHaveBeenCalledTimes(2);
	expect(fake.writes).toHaveBeenCalledTimes(1);
});

it("resolves effect defaults and ignores inherited operation/access map entries", () => {
	expect(
		nodeRegistry.effectFor({
			id: "read",
			name: "Read",
			type: "ticket",
		} as Parameters<typeof nodeRegistry.effectFor>[0]),
	).toBe("read-only");
	expect(
		nodeRegistry.effectFor({
			id: "exec",
			name: "Exec",
			type: "exec",
			command: "git",
		} as Parameters<typeof nodeRegistry.effectFor>[0]),
	).toBe("read-only");
	expect(nodeEffect({ type: "ticket", op: "toString" })).toBe("effect");
	expect(nodeEffect({ type: "exec", access: "constructor" })).toBe("effect");
});

it.runIf(["darwin", "linux"].includes(process.platform))(
	"wait polls read-only exec inside its phase with capacity leases and one receipt",
	async () => {
		const home = mkdtempSync(join(tmpdir(), "factory-wait-exec-"));
		homes.push(home);
		const capacity = new MachineCapacity(1, join(home, "machine-capacity"));
		const acquire = vi.spyOn(capacity, "acquireLease");
		const { runtime, run } = setup(
			[
				step("wait", {
					body: {
						id: "poll",
						name: "Poll",
						type: "exec",
						command: "/bin/sh",
						args: [
							"-c",
							`printf '{"lease":"%s"}' "$BOBS_FACTORY_EXECUTION_LEASE"`,
						],
						access: "read-only",
						json: true,
						env: [],
					},
					interval: 5,
					timeout: 10000,
					maxErrors: 1,
					until: { path: "/polls", equals: 2 },
				}),
			],
			{ capacity },
			home,
		);
		try {
			await runtime.launch(run);
			expect(run.error).toBeUndefined();
			expect(run.status).toBe("completed");
			expect(run.outputs.io).toMatchObject({
				exitCode: 0,
				stderr: "",
				timedOut: false,
				polls: 2,
				json: { lease: expect.stringMatching(/^[0-9a-f-]{36}$/) },
			});
			expect(acquire).toHaveBeenCalledTimes(2);
			expect(run.history.map((entry) => entry.step)).toEqual(["io"]);
			expect(run.nodeEffects ?? {}).toEqual({});
			expect(run.capacityLeaves ?? {}).toEqual({});
			expect(await capacity.snapshot()).toMatchObject({ active: 0, queued: 0 });
		} finally {
			await runtime.shutdown();
			await capacity.shutdown();
		}
	},
);
