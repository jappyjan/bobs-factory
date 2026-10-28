import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readStateFormat } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import {
	backupSlot,
	commitBackup,
	ensureStateFormat,
	readManifest,
	restoreMigrationBackupFor,
} from "../src/migrations/index.js";
import { dataRegression } from "../src/updates/DataSummary.js";
import type { JournalStep } from "../src/updates/UpdateJournal.js";
import {
	candidateKey,
	type HealthExpectation,
	type InstalledUpdate,
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "../src/updates/UpdateManager.js";
import {
	faultFs,
	fixtureMigration,
	makeHome,
	SUPPORT_2,
	treeHash,
} from "./migrations/fixtures.js";

// Counts every byte copy and write the update path performs, passing them through.
const spy = vi.hoisted(() => ({
	copies: [] as string[],
	cp: 0,
	written: 0,
}));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		default: actual,
		copyFileSync: ((src: string, ...rest: unknown[]) => {
			spy.copies.push(String(src));
			return (actual.copyFileSync as (...args: unknown[]) => void)(
				src,
				...rest,
			);
		}) as typeof actual.copyFileSync,
		cpSync: ((...args: Parameters<typeof actual.cpSync>) => {
			spy.cp++;
			return actual.cpSync(...args);
		}) as typeof actual.cpSync,
		writeFileSync: ((file: unknown, data: unknown, ...rest: unknown[]) => {
			spy.written +=
				typeof data === "string" || data instanceof Uint8Array
					? Buffer.byteLength(data as string)
					: 0;
			return (actual.writeFileSync as (...args: unknown[]) => void)(
				file,
				data,
				...rest,
			);
		}) as typeof actual.writeFileSync,
	};
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

interface WorldOptions {
	/** The candidate migrates data format 1 → 2 when its worker starts. */
	migrate?: boolean;
	/** The candidate's worker reports this run as missing. */
	hideRun?: string;
	/** Runs during the health window, like a token refresh would. */
	duringHealth?: (home: string) => void;
	/** Fails the migration's Nth write with ENOSPC. */
	enospcOnMigrationWrite?: number;
	failStart?: Error;
}

/** A stand-in owner: a runtime link, one worker slot, real migration engine and
 * real restore. The manager under test cannot tell it from OwnedUpdateLifecycle. */
function world(options: WorldOptions = {}) {
	const home = makeHome();
	const bin = join(home, "runtime", "desktop-installed", "bin");
	mkdirSync(bin, { recursive: true });
	const exe = (name: string) => {
		const dir = join(home, "runtime", "versions", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "bobs-factory"), name);
		return realpathSync(join(dir, "bobs-factory"));
	};
	const oldExe = exe("old");
	const newExe = exe("new");
	const link = join(bin, "bobs-factory");
	symlinkSync(oldExe, link);
	const state = {
		worker: "old" as "old" | "new" | null,
		maintenance: false,
		transactionId: undefined as string | undefined,
		calls: [] as string[],
	};
	const identityOf = (path: string) => (path === newExe ? "new" : "old");
	const summary = (as: "old" | "new") => {
		const runs = ["a", "b", "c"].filter(
			(id) => !(as === "new" && options.hideRun === id),
		);
		return {
			runs: { count: runs.length, ids: runs },
			workflows: { count: 0, ids: [] },
			sessions: { count: 0, ids: [] },
			loadErrors: [],
		};
	};
	const migrationFs = options.enospcOnMigrationWrite
		? faultFs({
				enospc: {
					op: "writeFileSynced",
					nth: options.enospcOnMigrationWrite,
					match: /factory\/(runs|workflows)|config\.json/,
				},
			}).fs
		: undefined;
	const startWorker = async (bind: boolean) => {
		const target = identityOf(realpathSync(link));
		if (target === "new") {
			if (options.failStart) throw options.failStart;
			await ensureStateFormat(home, {
				transactionId: bind ? state.transactionId : null,
				support: options.migrate ? SUPPORT_2 : { writes: 1, migratesFrom: 1 },
				migrations: options.migrate ? [fixtureMigration()] : [],
				fs: migrationFs,
			});
		}
		state.worker = target;
	};
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: async (id) => {
			state.calls.push("maintenance");
			state.maintenance = true;
			state.transactionId = id;
		},
		isIdle: async () => ({
			idle: true,
			baseline: { runIds: ["a", "b", "c"], workflowIds: [], sessionCount: 0 },
		}),
		prepare: async (_staged, _installed, id) => {
			state.calls.push("prepare");
			state.transactionId = id;
			const next = `${link}.next-${id}`;
			const prev = `${link}.prev-${id}`;
			symlinkSync(newExe, next);
			symlinkSync(oldExe, prev);
			return {
				links: { next, prev },
				migration: options.migrate ? { from: 1, to: 2 } : null,
			};
		},
		stop: async () => {
			state.calls.push("stop");
			state.worker = null;
		},
		activate: async () => {
			state.calls.push("activate");
			renameSync(`${link}.next-${state.transactionId}`, link);
		},
		start: async () => {
			state.calls.push("start");
			await startWorker(true);
		},
		health: async (c, expect?: HealthExpectation) => {
			state.calls.push("health");
			const running = state.worker;
			if (running !== (c.version === candidate.version ? "new" : "old"))
				throw new Error(`Observed worker ${running}`);
			options.duringHealth?.(home);
			const data = dataRegression(summary(running), expect?.baseline);
			if (data) throw new Error(data);
			if (expect?.migration && readStateFormat(home) !== expect.migration.to)
				throw new Error("Data format did not advance");
		},
		rollback: async (transaction, expect) => {
			state.calls.push("rollback");
			state.worker = null;
			restoreMigrationBackupFor(home, transaction.id);
			const prev = `${link}.prev-${transaction.id}`;
			if (existsSync(prev)) renameSync(prev, link);
			else if (identityOf(realpathSync(link)) !== "old") {
				rmSync(link);
				symlinkSync(oldExe, link);
			}
			await startWorker(false);
			const data = dataRegression(summary("old"), expect?.baseline);
			if (data) throw new Error(data);
		},
		discard: (id) => {
			rmSync(`${link}.next-${id}`, { force: true });
			rmSync(`${link}.prev-${id}`, { force: true });
		},
		releaseMaintenance: async () => {
			state.calls.push("release");
			state.maintenance = false;
		},
	};
	const source: UpdateSource = {
		discover: vi.fn(async () => candidate),
		stage: vi.fn(async (current) => ({
			candidate: current,
			executable: newExe,
			previousExecutable: oldExe,
		})),
	};
	const manager = (opts?: ConstructorParameters<typeof UpdateManager>[4]) =>
		new UpdateManager(home, source, lifecycle, installed, opts);
	return {
		home,
		link,
		state,
		lifecycle,
		source,
		manager,
		oldExe,
		newExe,
		linkTarget: () => identityOf(realpathSync(link)),
		strayLinks: () =>
			["next", "prev"].filter((kind) =>
				existsSync(`${link}.${kind}-${state.transactionId}`),
			),
	};
}

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	spy.copies.length = 0;
	spy.cp = 0;
	spy.written = 0;
});
async function ready(
	w: ReturnType<typeof world>,
	opts?: ConstructorParameters<typeof UpdateManager>[4],
) {
	homes.push(w.home);
	const manager = w.manager(opts);
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	return manager;
}
const exists = (p: string) =>
	lstatSync(p, { throwIfNoEntry: false }) !== undefined;
class Crash extends Error {}
const crashAt = (target: JournalStep) => ({
	afterStep: (step: JournalStep) => {
		if (step === target) throw new Crash(`crash after ${step}`);
	},
});

const STEPS: JournalStep[] = [
	"claimed",
	"maintenance",
	"drained",
	"stopped",
	"switched",
	"started",
	"healthy",
	"committed",
];
// What a plain restart must leave behind after the supervisor died right after `step`.
const MATRIX: Record<
	string,
	{ link: "old" | "new"; phase: string; installed: "old" | "new" }
> = {
	claimed: { link: "old", phase: "cancelled", installed: "old" },
	maintenance: { link: "old", phase: "cancelled", installed: "old" },
	drained: { link: "old", phase: "cancelled", installed: "old" },
	stopped: { link: "old", phase: "cancelled", installed: "old" },
	switched: { link: "old", phase: "rolled-back", installed: "old" },
	started: { link: "old", phase: "rolled-back", installed: "old" },
	healthy: { link: "old", phase: "rolled-back", installed: "old" },
	committed: { link: "new", phase: "succeeded", installed: "new" },
};

it.each(
	STEPS,
)("a supervisor killed right after journal step %s recovers by one rule on a plain restart", async (step) => {
	const w = world({ migrate: true });
	const manager = await ready(w, crashAt(step));
	const before = treeHash(w.home);
	await expect(manager.reconcile()).rejects.toThrow(Crash);

	const fresh = w.manager();
	const status = await fresh.recover("operation owner stopped");
	const expected = MATRIX[step]!;
	expect(w.linkTarget()).toBe(expected.link);
	expect(w.state.worker).toBe(expected.link);
	expect(w.state.maintenance).toBe(false);
	expect(status.transaction).toMatchObject({
		phase: expected.phase,
		release: { outcome: expected.phase, status: "acknowledged" },
	});
	expect(status.installed.version).toBe(
		expected.installed === "new" ? candidate.version : installed.version,
	);
	expect(w.strayLinks()).toEqual([]);
	if (expected.link === "old") {
		// Rolled back: the data is the data it was, down to the format file.
		expect(treeHash(w.home)).toBe(before);
		expect(readStateFormat(w.home)).toBe(1);
		expect(exists(backupSlot(w.home))).toBe(false);
		// One interrupted attempt does not blame the candidate.
		expect(status.badCandidates).toEqual([]);
	} else {
		expect(readStateFormat(w.home)).toBe(2);
		expect(readManifest(backupSlot(w.home))?.status).toBe("committed");
	}
	expect(
		exists(
			join(w.home, "updates", "journal", `${status.transaction!.id}.json`),
		),
	).toBe(false);

	// A second run finds nothing to do.
	const calls = [...w.state.calls];
	const again = await w.manager().recover("operation owner stopped");
	expect(w.state.calls).toEqual(calls);
	expect(again.transaction?.phase).toBe(expected.phase);
});

it("a crash after the journal says committed finishes the commit from the journal", async () => {
	const w = world({ migrate: true });
	const manager = await ready(w, crashAt("committed"));
	await expect(manager.reconcile()).rejects.toThrow(Crash);
	// state.json was never written: the journal is the commit point.
	expect(new UpdateManager(w.home).status().transaction?.phase).toBe("health");
	const status = await w.manager().recover("operation owner stopped");
	expect(status.installed.version).toBe(candidate.version);
	expect(status.pending).toBeUndefined();
});

it("takes over a state.lock whose owner died inside change(), and never from a live owner", async () => {
	const w = world();
	const manager = await ready(w);
	const lock = join(w.home, "updates", "state.lock");
	const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
	for (const stale of [
		JSON.stringify({ pid: dead, start: "Thu Jan  1 00:00:00 1970" }),
		// The pid was reused by a different process.
		JSON.stringify({ pid: process.pid, start: "Thu Jan  1 00:00:00 1970" }),
		// Older supervisors wrote just the pid.
		String(dead),
	]) {
		writeFileSync(lock, stale);
		manager.configure({ paused: false }, manager.status().revision);
		expect(existsSync(lock)).toBe(false);
	}
	writeFileSync(lock, String(process.pid));
	expect(() =>
		manager.configure({ paused: true }, manager.status().revision),
	).toThrow("Inspect a retained state.lock");
	expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
});

it("a migration whose health check fails goes back by link and rename, without copying the home", async () => {
	const w = world({ migrate: true, hideRun: "b" });
	const manager = await ready(w);
	const before = treeHash(w.home);
	spy.copies.length = 0;
	spy.cp = 0;
	await manager.reconcile();
	const status = manager.status();
	expect(status.transaction).toMatchObject({ phase: "rolled-back" });
	expect(status.transaction?.error).toContain("Runs missing after update: b");
	expect(status.badCandidates).toEqual([candidateKey(candidate)]);
	expect(w.linkTarget()).toBe("old");
	expect(w.state.worker).toBe("old");
	// Config, manifests and the format file are what they were.
	expect(treeHash(w.home)).toBe(before);
	expect(readStateFormat(w.home)).toBe(1);
	expect(exists(backupSlot(w.home))).toBe(false);
	// Only the declared files were cloned for the backup, and nothing used cp.
	expect(spy.cp).toBe(0);
	expect(spy.copies.length).toBeGreaterThan(0);
	for (const source of spy.copies)
		expect(source).toMatch(
			/(config\.json|workflows\.json|factory\/runs\/[abc]\.json)$/,
		);
});

it("a no-migration update copies nothing and writes almost nothing", async () => {
	const w = world();
	const manager = await ready(w);
	spy.copies.length = 0;
	spy.written = 0;
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(w.linkTarget()).toBe("new");
	expect(spy.copies).toEqual([]);
	expect(spy.cp).toBe(0);
	// The 1 MiB failure reserve is the biggest write; everything else is small JSON.
	expect(spy.written).toBeLessThan(5 * 1024 * 1024);
	expect(readManifest(backupSlot(w.home))).toBeUndefined();
});

it("a migration that commits keeps its backup bound to the transaction until the next start", async () => {
	const w = world({ migrate: true });
	const manager = await ready(w);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("succeeded");
	const manifest = readManifest(backupSlot(w.home));
	expect(manifest).toMatchObject({
		status: "committed",
		transactionId: manager.status().transaction?.id,
	});
	expect(commitBackup(w.home, "other")).toBeUndefined();
});

it("a token refresh and a recipe re-serialization during the health window do not fail the update", async () => {
	const w = world({
		duringHealth: (home) => {
			writeFileSync(
				join(home, "config.json"),
				JSON.stringify({ repositories: [], note: "keep", token: "refreshed" }),
			);
			// Same run, different bytes: key order and whitespace changed.
			writeFileSync(
				join(home, "factory", "runs", "a.json"),
				'{\n  "id": "a",\n  "recipe": { "b": 2, "a": 1 }\n}\n',
			);
		},
	});
	const manager = await ready(w);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(manager.status().installed.version).toBe(candidate.version);
});

it("a disk-full failure marks nobody bad, and the candidate waits instead of looping", async () => {
	const w = world({ migrate: true, enospcOnMigrationWrite: 2 });
	const manager = await ready(w);
	const before = treeHash(w.home);
	await manager.reconcile();
	const status = manager.status();
	expect(status.transaction?.phase).toBe("rolled-back");
	expect(status.transaction?.error).toMatch(/ENOSPC/);
	expect(status.badCandidates).toEqual([]);
	expect(treeHash(w.home)).toBe(before);
	expect(w.state.worker).toBe("old");
	// tick() does not retry straight away.
	const prepared = w.state.calls.filter((call) => call === "prepare").length;
	await w.manager().tick();
	expect(w.state.calls.filter((call) => call === "prepare").length).toBe(
		prepared,
	);
});

it("staging out of disk keeps the release and backs off", async () => {
	const w = world();
	homes.push(w.home);
	const manager = w.manager();
	manager.configure({ channel: "nightly" }, 0);
	vi.mocked(w.source.stage).mockRejectedValue(
		Object.assign(new Error("ENOSPC: no space left on device"), {
			code: "ENOSPC",
		}),
	);
	await expect(manager.tick()).rejects.toThrow("ENOSPC");
	expect(manager.status().badCandidates).toEqual([]);
	expect(manager.status().error).toContain("ENOSPC");
	vi.mocked(w.source.stage).mockClear();
	await manager.tick();
	expect(w.source.stage).not.toHaveBeenCalled();
});

it("a journal write that hits a full disk still reaches a terminal state, then the lock and reserve are freed", async () => {
	const w = world();
	let full = false;
	const realIdle = w.lifecycle.isIdle;
	w.lifecycle.isIdle = async () => {
		full = true;
		return realIdle();
	};
	const manager = await ready(w, {
		// Full until the failure reserve is released.
		journalIo: {
			write(path, text) {
				const reserved = readdirSync(join(w.home, "updates")).some((name) =>
					name.startsWith("operation-reserve-"),
				);
				if (full && reserved)
					throw Object.assign(new Error("ENOSPC: journal"), { code: "ENOSPC" });
				writeFileSync(path, text);
			},
		},
	});
	await manager.reconcile();
	const status = manager.status();
	expect(status.transaction).toMatchObject({
		phase: "cancelled",
		release: { status: "acknowledged" },
	});
	expect(status.badCandidates).toEqual([]);
	expect(w.state.maintenance).toBe(false);
	expect(existsSync(join(w.home, "updates", "operation.lock"))).toBe(false);
});

it("two interrupted attempts at the same candidate mark it bad, one does not", async () => {
	const w = world();
	const manager = await ready(w, crashAt("started"));
	await expect(manager.reconcile()).rejects.toThrow(Crash);
	let status = await w.manager().recover("operation owner stopped");
	expect(status.badCandidates).toEqual([]);

	// The supervisor tick waits before retrying an interrupted candidate.
	const prepared = () =>
		w.state.calls.filter((call) => call === "prepare").length;
	const first = prepared();
	await w.manager().tick();
	expect(prepared()).toBe(first);

	// Explicit consent skips the wait; the same crash again is the second strike.
	const again = w.manager(crashAt("started"));
	again.requestInstall(candidateKey(candidate), again.status().revision, true);
	await expect(again.reconcile()).rejects.toThrow(Crash);
	status = await w.manager().recover("operation owner stopped");
	expect(status.badCandidates).toEqual([candidateKey(candidate)]);
});
