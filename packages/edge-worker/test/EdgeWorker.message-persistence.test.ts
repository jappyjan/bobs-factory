import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "bobs-factory-claude-runner";
import type { JsonSnapshotStore } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const fixtures: {
	home: string;
	runtime: WorkflowRuntime;
	release?: () => void;
}[] = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		fixture.release?.();
		await fixture.runtime.shutdown();
		await rm(fixture.home, { recursive: true, force: true });
	}
	vi.restoreAllMocks();
});

async function fixture() {
	const home = await mkdtemp(join(tmpdir(), "edge-message-persistence-"));
	const runtime = new WorkflowRuntime(home, {});
	const cleanup = {
		home,
		runtime,
		release: undefined as (() => void) | undefined,
	};
	fixtures.push(cleanup);
	const workflow = WorkflowSchema.parse({
		id: "message-persistence",
		name: "Message persistence",
		steps: [{ id: "work", name: "Work", type: "tool", tool: "fixture" }],
	});
	const run = runtime.create({
		id: "message-persistence",
		repositoryId: "fixture",
		workspace: home,
		input: "Synthetic persistence check",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	await runtime.flush(run.id);
	const artifact = {
		marker: 0,
		rows: Array.from({ length: 512 }, (_, index) => ({
			index,
			nested: { content: `retained-${index}` },
		})),
	};
	run.outputs.artifact = artifact;
	const session = {
		id: run.id,
		updatedAt: 0,
		repositories: [],
		workspace: { path: home },
		metadata: { usage: { output_tokens: 0 } },
	};
	const saveState = vi.fn(async () => {});
	const worker = Object.assign(Object.create(EdgeWorker.prototype), {
		factoryRuntime: runtime,
		agentSessionManager: {
			handleClaudeMessage: vi.fn(async () => {}),
			getSession: () => session,
		},
		savePersistedState: saveState,
	});
	const snapshots = (runtime as unknown as { snapshots: JsonSnapshotStore })
		.snapshots;
	const writes = vi.spyOn(snapshots, "write");
	const encoding = snapshots as unknown as {
		encode(value: unknown): Promise<unknown>;
	};
	const encode = encoding.encode.bind(encoding);
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		cleanup.release = resolve;
	});
	vi.spyOn(encoding, "encode").mockImplementationOnce(async (value) => {
		entered();
		await blocked;
		return encode(value);
	});
	return {
		runtime,
		run,
		artifact,
		session,
		worker,
		saveState,
		writes,
		encoding,
		encode,
		started,
		release: () => cleanup.release!(),
		read: () =>
			snapshots.load<FactoryRun>(
				join(home, "factory", "runs", `${run.id}.json`),
			).value,
	};
}

it.each([
	"agent",
	"workflow",
] as const)("coalesces %s bursts behind a busy run commit and flushes the latest native state", async (source) => {
	const {
		runtime,
		run,
		artifact,
		session,
		worker,
		writes,
		started,
		release,
		read,
	} = await fixture();
	const first = runtime.save(run);
	await started;
	for (let revision = 1; revision <= 40; revision++) {
		artifact.marker = revision;
		session.updatedAt = revision;
		session.metadata.usage.output_tokens = revision;
		runtime.log(run, "work", `Activity ${revision}`, source);
		await worker.handleClaudeMessage(
			run.id,
			{ type: "assistant" } as SDKMessage,
			"fixture",
		);
	}
	const flushed = runtime.flush(run.id);
	await Promise.resolve();
	expect(writes).toHaveBeenCalledTimes(1);
	release();
	await Promise.all([first, flushed]);
	expect(writes).toHaveBeenCalledTimes(2);
	const saved = read();
	expect(saved.outputs.artifact).toEqual(artifact);
	expect(saved.events.at(-1)?.message).toBe("Activity 40");
	expect(saved.sessionSnapshot).toEqual(session);
});

it("flushes a message scheduled between an activity save finishing and its cleanup", async () => {
	const { runtime, run, artifact, release, read } = await fixture();
	let finish!: () => void;
	const held = new Promise<void>((resolve) => {
		finish = resolve;
	});
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const save = vi.spyOn(runtime, "save").mockImplementationOnce(() => {
		entered();
		return held;
	});
	runtime.scheduleSave(run);
	const flushed = runtime.flush();
	await started;
	release();
	finish();
	// The activity loop finishes before this callback, while its active marker
	// is removed afterward by a separate Promise reaction.
	queueMicrotask(() => {
		artifact.marker = 1;
		runtime.scheduleSave(run);
	});
	await flushed;
	expect(save).toHaveBeenCalledTimes(2);
	expect((read().outputs.artifact as typeof artifact).marker).toBe(1);
});

it.each([
	"none",
	"captured",
	"waiting",
] as const)("returns a dashboard read after its call-time state commits during a continuing stream (active batch: %s)", async (activeBatch) => {
	const { runtime, run, artifact, encoding, encode, started, release, read } =
		await fixture();
	const gates = new Map<
		number,
		{
			entered: Promise<void>;
			start: () => void;
			held: Promise<void>;
			release: () => void;
		}
	>();
	for (const marker of [1, 2]) {
		let start!: () => void;
		let finish!: () => void;
		gates.set(marker, {
			entered: new Promise<void>((resolve) => {
				start = resolve;
			}),
			start: () => start(),
			held: new Promise<void>((resolve) => {
				finish = resolve;
			}),
			release: () => finish(),
		});
	}
	vi.mocked(encoding.encode).mockImplementation(async (value) => {
		const marker =
			value && typeof value === "object" && "marker" in value
				? (value as { marker: number }).marker
				: undefined;
		const gate = marker === undefined ? undefined : gates.get(marker);
		if (gate) {
			gate.start();
			await gate.held;
		}
		return encode(value);
	});
	let first: Promise<void> | undefined;
	let queued: Promise<void> | undefined;
	let prepared: Promise<void> | undefined;
	let draining: Promise<void> | undefined;
	try {
		if (activeBatch === "captured") {
			runtime.scheduleSave(run);
			first = runtime.flush();
		} else first = runtime.save(run);
		await started;
		artifact.marker = 1;
		runtime.scheduleSave(run);
		if (activeBatch === "waiting") queued = runtime.flush(run.id);
		let readCompleted = false;
		prepared = runtime.prepareDashboard(run).then(() => {
			readCompleted = true;
		});
		release();
		await gates.get(1)!.entered;
		expect(readCompleted).toBe(false);
		artifact.marker = 2;
		runtime.scheduleSave(run);
		gates.get(1)!.release();
		await gates.get(2)!.entered;
		expect((read().outputs.artifact as typeof artifact).marker).toBe(1);
		expect(readCompleted).toBe(true);
		let fullyDrained = false;
		draining = runtime.flush().then(() => {
			fullyDrained = true;
		});
		artifact.marker = 3;
		runtime.scheduleSave(run);
		await Promise.resolve();
		expect(fullyDrained).toBe(false);
		gates.get(2)!.release();
		await Promise.all([first, queued, prepared, draining]);
		expect((read().outputs.artifact as typeof artifact).marker).toBe(3);
	} finally {
		release();
		for (const gate of gates.values()) gate.release();
		await Promise.allSettled([first, queued, prepared, draining]);
	}
});

it("retries scheduled state after a failed checkpoint while retaining its original rejection", async () => {
	const { runtime, run, artifact, release, read, writes } = await fixture();
	const failure = new Error("Transient snapshot write failure");
	writes.mockImplementationOnce(() => Promise.reject(failure));
	const failed = runtime.save(run);
	await expect(failed).rejects.toBe(failure);
	artifact.marker = 1;
	runtime.scheduleSave(run);
	release();
	await runtime.flush(run.id);
	expect(writes).toHaveBeenCalledTimes(2);
	expect((read().outputs.artifact as typeof artifact).marker).toBe(1);
	await expect(failed).rejects.toBe(failure);
});

it.each([
	{ type: "system", subtype: "init", session_id: "native-conversation" },
	{ type: "result", session_id: "native-conversation" },
] as SDKMessage[])("durably captures a $type message before completing its lifecycle save", async (message) => {
	const { run, artifact, session, worker, saveState, started, release, read } =
		await fixture();
	artifact.marker = 1;
	session.updatedAt = 1;
	let complete = false;
	const handled = worker
		.handleClaudeMessage(run.id, message, "fixture")
		.then(() => {
			complete = true;
		});
	await started;
	expect(complete).toBe(false);
	expect(saveState).not.toHaveBeenCalled();
	// Explicit saves retain the state from their call, even if live objects change
	// while chunk I/O is pending.
	artifact.marker = 2;
	session.updatedAt = 2;
	release();
	await handled;
	expect(saveState).toHaveBeenCalledTimes(1);
	const saved = read();
	expect((saved.outputs.artifact as typeof artifact).marker).toBe(1);
	expect(saved.sessionSnapshot?.updatedAt).toBe(1);
});
