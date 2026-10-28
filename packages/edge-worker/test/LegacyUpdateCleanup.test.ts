import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageRetentionStore } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupLegacyUpdates } from "../src/updates/LegacyUpdateCleanup.js";
import {
	type InstalledUpdate,
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "../src/updates/UpdateManager.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const installed: InstalledUpdate = {
	version: "1.0.0",
	commit: "a".repeat(40),
	target: "darwin-arm64",
};
const candidate: UpdateCandidate = {
	version: "1.1.0-nightly.20261010.100",
	commit: "b".repeat(40),
	channel: "nightly",
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};

/** The operator machine: a successful, acknowledged v2 update left a two-directory
 * preflight, a snapshot, their retention records and proofs, while the live runtime
 * is the staged directory the update installed. */
async function machine() {
	const home = realpathSync(
		mkdtempSync(join(tmpdir(), "legacy-update-cleanup-")),
	);
	roots.push(home);
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: vi.fn(async () => {}),
		isIdle: vi.fn(async () => true),
		prepare: vi.fn(async () => ({ migration: null })),
		stop: vi.fn(async () => {}),
		activate: vi.fn(async () => {}),
		start: vi.fn(async () => {}),
		health: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		releaseMaintenance: vi.fn(async () => {}),
	};
	const stage = join(home, "updates", "staging", "stage-AjpnuO");
	const executable = join(
		stage,
		"runtime",
		"lib",
		"bobs-factory",
		"bobs-factory",
	);
	mkdirSync(join(stage, "runtime", "lib", "bobs-factory"), { recursive: true });
	writeFileSync(executable, "live runtime", { mode: 0o755 });
	const link = join(
		home,
		"runtime",
		"desktop-installed",
		"bin",
		"bobs-factory",
	);
	mkdirSync(join(link, ".."), { recursive: true });
	symlinkSync(executable, link);
	const source: UpdateSource = {
		discover: vi.fn(async () => candidate),
		stage: vi.fn(async (current) => ({
			candidate: current,
			executable,
			previousExecutable: join(stage, "previous"),
		})),
	};
	const manager = new UpdateManager(home, source, lifecycle, installed);
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	manager.requestInstall(
		`nightly:${candidate.version}:${candidate.commit}:${candidate.target}:${candidate.manifestSha256}`,
		1,
	);
	await manager.stage();
	await manager.reconcile();
	const transaction = manager.status().transaction!;
	expect(transaction.release?.status).toBe("acknowledged");

	const copy = (directory: string) => {
		mkdirSync(join(directory, "factory", "runs"), { recursive: true });
		mkdirSync(join(directory, "state"), { recursive: true });
		writeFileSync(join(directory, "config.json"), "{}");
		writeFileSync(join(directory, "factory", "runs", "run.json"), "{}");
		writeFileSync(join(directory, "state", "edge-worker-state.json"), "{}");
	};
	const preflight = join(home, "updates", "preparation", "preflight-vgADnq");
	const snapshot = join(home, "updates", "snapshots", transaction.id);
	copy(preflight);
	copy(snapshot);
	writeFileSync(join(snapshot, "lifecycle-receipt.json"), "{}");
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.snapshot = snapshot;
	state.rollbackSnapshot = { transactionId: transaction.id, path: snapshot };
	writeFileSync(manager.file, JSON.stringify(state));

	const store = new StorageRetentionStore(home);
	const register = async (
		category: "snapshot" | "preparation" | "staging" | "worktree",
		root: string,
		path: string,
	) => {
		mkdirSync(path, { recursive: true });
		const record = await store.register({
			category,
			root,
			path,
			producer: "OwnedUpdateLifecycle",
			operation: transaction.id,
			dependencies: [],
			evidence: [],
		});
		mkdirSync(join(store.directory, "proofs"), { recursive: true });
		writeFileSync(join(store.directory, "proofs", `${record.id}.ndjson`), "{}");
		return record;
	};
	const records = {
		snapshot: await register(
			"snapshot",
			join(home, "updates", "snapshots"),
			snapshot,
		),
		preparation: await register(
			"preparation",
			join(home, "updates", "preparation"),
			preflight,
		),
		staging: await register("staging", join(home, "updates", "staging"), stage),
		// Hand-deleted after it was registered: the record outlives its path.
		deleted: await register(
			"snapshot",
			join(home, "updates", "snapshots"),
			join(home, "updates", "snapshots", "older"),
		),
		worktree: await register(
			"worktree",
			join(home, "worktrees"),
			join(home, "worktrees", "ISSUE-1"),
		),
	};
	rmSync(join(home, "updates", "snapshots", "older"), { recursive: true });
	writeFileSync(join(store.directory, "rollback-index.json"), "{}");
	writeFileSync(join(store.directory, "historical-preview.json"), "{}");
	mkdirSync(join(store.directory, "rollback-proofs"));
	writeFileSync(
		join(store.directory, "rollback-proofs", `${records.snapshot.id}.json`),
		"{}",
	);
	return {
		home,
		manager,
		store,
		records,
		stage,
		executable,
		link,
		snapshot,
		preflight,
	};
}

it("removes the copies, records and proofs of a finished v2 update and leaves the live runtime alone", async () => {
	const {
		home,
		manager,
		store,
		records,
		executable,
		link,
		snapshot,
		preflight,
	} = await machine();

	const result = await cleanupLegacyUpdates(home);

	expect(result).toMatchObject({
		status: "done",
		retained: [],
		droppedRecords: 4,
	});
	expect(result.removed.sort()).toEqual([preflight, snapshot].sort());
	expect(existsSync(join(home, "updates", "preparation"))).toBe(false);
	expect(existsSync(join(home, "updates", "snapshots"))).toBe(false);
	expect(readFileSync(executable, "utf8")).toBe("live runtime");
	expect(realpathSync(link)).toBe(executable);
	expect(await store.inventoryCount()).toBe(1);
	expect(await store.inventoryPage(0)).toEqual([records.worktree.id]);
	expect((await store.record(records.worktree.id)).category).toBe("worktree");
	for (const legacy of [
		records.snapshot,
		records.preparation,
		records.staging,
		records.deleted,
	]) {
		expect(existsSync(store.recordPath(legacy.id))).toBe(false);
		expect(
			existsSync(join(store.directory, "proofs", `${legacy.id}.ndjson`)),
		).toBe(false);
	}
	expect(
		existsSync(
			join(store.directory, "proofs", `${records.worktree.id}.ndjson`),
		),
	).toBe(true);
	for (const name of [
		"rollback-index.json",
		"historical-preview.json",
		"rollback-proofs",
	])
		expect(existsSync(join(store.directory, name))).toBe(false);
	expect(
		JSON.parse(readFileSync(manager.file, "utf8")).rollbackSnapshot,
	).toBeUndefined();
	expect(manager.status()).toMatchObject({
		installed: { version: candidate.version },
		transaction: { phase: "succeeded", release: { status: "acknowledged" } },
	});

	// Idempotent: nothing left to do and no error.
	expect(await cleanupLegacyUpdates(home)).toEqual({
		status: "done",
		removed: [],
		retained: [],
		droppedRecords: 0,
	});
});

it("touches nothing while an update transaction is unresolved and reports what it kept", async () => {
	const { home, manager, store, snapshot, preflight } = await machine();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "health";
	delete state.transaction.release;
	writeFileSync(manager.file, JSON.stringify(state));

	const result = await cleanupLegacyUpdates(home);

	expect(result.status).toBe("deferred");
	expect(result.removed).toEqual([]);
	expect(result.retained.map((entry) => entry.path).sort()).toEqual([
		join(home, "updates", "preparation"),
		join(home, "updates", "snapshots"),
	]);
	expect(existsSync(snapshot)).toBe(true);
	expect(existsSync(preflight)).toBe(true);
	expect(await store.inventoryCount()).toBe(5);
});

it("keeps a directory that holds the runtime the link points at", async () => {
	const { home, link, snapshot, preflight } = await machine();
	const runtime = join(snapshot, "runtime", "bobs-factory");
	mkdirSync(join(snapshot, "runtime"), { recursive: true });
	writeFileSync(runtime, "rolled-back runtime", { mode: 0o755 });
	unlinkSync(link);
	symlinkSync(runtime, link);

	const result = await cleanupLegacyUpdates(home);

	expect(result.removed).toEqual([preflight]);
	expect(result.retained).toEqual([
		{ path: snapshot, reason: "Holds a linked, staged or running runtime" },
	]);
	expect(readFileSync(runtime, "utf8")).toBe("rolled-back runtime");
});

it("resumes after a crash during the delete or the record rewrite", async () => {
	const { home, store, records } = await machine();
	const saved = join(home, "saved-record.json");
	copyFileSync(store.recordPath(records.snapshot.id), saved);
	await cleanupLegacyUpdates(home);
	// A crash left a half-deleted trash directory and a record file that the
	// rewritten inventory no longer lists.
	mkdirSync(join(home, "updates", ".trash-1-0", "factory"), {
		recursive: true,
	});
	writeFileSync(join(home, "updates", ".trash-1-0", "factory", "partial"), "x");
	copyFileSync(saved, store.recordPath(records.snapshot.id));

	const result = await cleanupLegacyUpdates(home);

	expect(result).toMatchObject({ status: "done", droppedRecords: 1 });
	expect(existsSync(join(home, "updates", ".trash-1-0"))).toBe(false);
	expect(existsSync(store.recordPath(records.snapshot.id))).toBe(false);
	expect(await store.inventoryPage(0)).toEqual([records.worktree.id]);
});
