import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	readStateFormatRecord,
	STATE_FORMAT_EXIT_CODE,
	StateFormatError,
} from "bobs-factory-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	BackupTooLargeError,
	backupSlot,
	commitBackup,
	createBackup,
	ensureStateFormat,
	InsufficientSpaceError,
	MIGRATIONS,
	pruneBackup,
	readManifest,
	restoreMigrationBackup,
	UnresolvedBackupError,
	UPDATE_TRANSACTION_ENV,
	validateMigrationRegistry,
} from "../../src/migrations/index.js";
import { createMigrationContext } from "../../src/migrations/MigrationContext.js";
import {
	faultFs,
	fixtureMigration,
	listTree,
	makeHome,
	SUPPORT_2,
	treeHash,
} from "./fixtures.js";

const homes: string[] = [];
const newHome = () => {
	const home = makeHome();
	homes.push(home);
	return home;
};
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	delete process.env[UPDATE_TRANSACTION_ENV];
});
const run = (
	home: string,
	extra: Parameters<typeof ensureStateFormat>[1] = {},
) =>
	ensureStateFormat(home, {
		support: SUPPORT_2,
		migrations: [fixtureMigration()],
		...extra,
	});
const slotOf = (home: string) => readManifest(backupSlot(home));
const formatOf = (home: string) => readStateFormatRecord(home)?.format ?? 1;

describe("registry", () => {
	it("keeps every shipped migration readable by pre-framework builds", () => {
		validateMigrationRegistry(MIGRATIONS);
		for (const migration of MIGRATIONS)
			expect(migration.minReader).toBeLessThanOrEqual(1);
	});

	it("rejects touches outside rewrite-friendly data", () => {
		const bad = (touch: object) =>
			validateMigrationRegistry([
				{ ...fixtureMigration(), touches: [touch as never] },
			]);
		for (const touch of [
			{ dir: "factory/run-chunks", ext: ".json" },
			{ file: "factory/evidence/x.json" },
			{ file: "state/chunks/x.json" },
			{ file: "factory/auth/token.json" },
			{ file: "../outside.json" },
			{ file: "/etc/passwd" },
			{ file: "state-format.json" },
		])
			expect(() => bad(touch), JSON.stringify(touch)).toThrow();
	});
});

describe("startup guard", () => {
	it("is a no-op at the current format and records format 1 when the file is missing", async () => {
		const home = newHome();
		const before = treeHash(home);
		expect(await ensureStateFormat(home)).toEqual({
			onDisk: 1,
			migrated: false,
		});
		expect(formatOf(home)).toBe(1);
		expect(existsSync(join(home, "state-format.json"))).toBe(true);
		expect(treeHash(home)).toBe(before);
		expect(existsSync(join(home, "updates"))).toBe(false);
	});

	it("refuses data written by a newer build and touches nothing", async () => {
		const home = newHome();
		writeFileSync(
			join(home, "state-format.json"),
			JSON.stringify({
				schema: 1,
				format: 5,
				minReader: 5,
				updatedAt: "x",
				applied: [],
			}),
		);
		const before = treeHash(home);
		const error = await ensureStateFormat(home).catch((e) => e);
		expect(error).toBeInstanceOf(StateFormatError);
		expect(error.exitCode).toBe(STATE_FORMAT_EXIT_CODE);
		expect(STATE_FORMAT_EXIT_CODE).toBe(78);
		expect(error.message).toMatch(/newer/);
		expect(treeHash(home)).toBe(before);
		expect(formatOf(home)).toBe(5);
		expect(existsSync(join(home, "updates"))).toBe(false);
	});

	it("refuses data older than this build can migrate", async () => {
		const home = newHome();
		const before = treeHash(home);
		const error = await ensureStateFormat(home, {
			support: { writes: 3, migratesFrom: 2 },
			migrations: [],
		}).catch((e) => e);
		expect(error).toBeInstanceOf(StateFormatError);
		expect(error.exitCode).toBe(78);
		expect(error.message).toMatch(/older/);
		expect(treeHash(home)).toBe(before);
		expect(existsSync(join(home, "state-format.json"))).toBe(false);
	});

	it("refuses an unreadable format file instead of guessing", async () => {
		const home = newHome();
		writeFileSync(join(home, "state-format.json"), "{nope");
		await expect(ensureStateFormat(home)).rejects.toBeInstanceOf(
			StateFormatError,
		);
	});

	it("reads the transaction id from the environment", async () => {
		const home = newHome();
		process.env[UPDATE_TRANSACTION_ENV] = "tx-env";
		await run(home);
		expect(slotOf(home)).toMatchObject({
			status: "applied",
			transactionId: "tx-env",
		});
	});
});

describe("migration and backup", () => {
	it("backs up exactly the declared files, migrates them, and writes the format last", async () => {
		const home = newHome();
		const chunks = treeHash(join(home, "factory", "run-chunks"));
		await run(home, { transactionId: "tx1" });
		const manifest = slotOf(home)!;
		expect(manifest).toMatchObject({
			status: "applied",
			transactionId: "tx1",
			fromFormat: 1,
			toFormat: 2,
			migrationIds: ["0002-fixture"],
		});
		const expected = [
			"config.json",
			"factory/migrated.json",
			"factory/runs/a.json",
			"factory/runs/b.json",
			"factory/runs/c.json",
			"factory/workflows.json",
		];
		expect(manifest.files.map((f) => f.rel).sort()).toEqual(expected);
		expect(
			manifest.files.find((f) => f.rel === "factory/migrated.json")?.state,
		).toBe("absent");
		expect(listTree(join(backupSlot(home), "files")).sort()).toEqual(
			expected.filter((rel) => rel !== "factory/migrated.json"),
		);
		expect(treeHash(join(home, "factory", "run-chunks"))).toBe(chunks);
		expect(
			JSON.parse(readFileSync(join(home, "config.json"), "utf8")).format,
		).toBe(2);
		expect(formatOf(home)).toBe(2);
		expect(readStateFormatRecord(home)?.applied.map((a) => a.id)).toEqual([
			"0002-fixture",
		]);
	});

	it("commits the slot itself for a manual install (no transaction)", async () => {
		const home = newHome();
		await run(home);
		expect(slotOf(home)).toMatchObject({
			status: "committed",
			transactionId: null,
		});
	});

	it("restores a byte-identical tree when a migration fails after some files", async () => {
		const home = newHome();
		const before = treeHash(home);
		const error = await run(home, {
			migrations: [fixtureMigration({ failAfterWrites: 2 })],
		}).catch((e) => e);
		expect(error).toBeInstanceOf(StateFormatError);
		expect(error.exitCode).toBe(78);
		expect(error.message).toMatch(/fixture failure/);
		expect(treeHash(home)).toBe(before);
		expect(formatOf(home)).toBe(1);
		expect(existsSync(backupSlot(home))).toBe(false);
	});

	it("removes a file the migration created when it fails afterwards", async () => {
		const home = newHome();
		const before = treeHash(home);
		await expect(
			run(home, { migrations: [fixtureMigration({ failVerify: true })] }),
		).rejects.toThrow(/verify failed/);
		expect(existsSync(join(home, "factory", "migrated.json"))).toBe(false);
		expect(treeHash(home)).toBe(before);
	});

	it("rejects a write outside the declared touches and rolls back", async () => {
		const home = newHome();
		const before = treeHash(home);
		await expect(
			run(home, {
				migrations: [
					fixtureMigration({ touchOutside: "state/edge-worker-state.json" }),
				],
			}),
		).rejects.toThrow(/outside its declared touches/);
		expect(treeHash(home)).toBe(before);
	});

	it("limits the context to declared files and refuses to create files in a directory touch", () => {
		const home = newHome();
		const touches = [
			{ file: "config.json" },
			{ dir: "factory/runs", ext: ".json" },
		];
		const ctx = createMigrationContext(home, touches);
		expect(() => ctx.writeAtomic("factory/workflows.json", "x")).toThrow(
			/outside/,
		);
		expect(() => ctx.read("factory/run-chunks/r/0001.bin")).toThrow(/outside/);
		expect(() => ctx.writeAtomic("../x.json", "x")).toThrow();
		expect(() => ctx.list({ dir: "factory", ext: ".json" })).toThrow();
		expect(ctx.list({ dir: "factory/runs", ext: ".json" })).toEqual([
			"factory/runs/a.json",
			"factory/runs/b.json",
			"factory/runs/c.json",
		]);
		const manifest = createBackup({
			home,
			transactionId: null,
			migrationIds: ["x"],
			fromFormat: 1,
			toFormat: 2,
			touches: [{ owner: "x", spec: touches[1] }],
		});
		const bound = createMigrationContext(home, touches, { manifest });
		expect(() => bound.writeAtomic("factory/runs/new.json", "{}")).toThrow(
			/not part of the backup/,
		);
		bound.writeAtomic("factory/runs/a.json", "{}");
	});

	it("converges after a crash at every single write", async () => {
		const reference = newHome();
		await run(reference, { transactionId: "tx" });
		const expected = treeHash(reference);
		let crashes = 0;
		for (let n = 0; n < 200; n++) {
			const home = newHome();
			const { fs } = faultFs({ crashAfter: n });
			const first = await run(home, { fs, transactionId: "tx" }).then(
				() => "done",
				() => "crashed",
			);
			if (first === "done") {
				expect(treeHash(home), `no crash at n=${n}`).toBe(expected);
				break;
			}
			crashes++;
			await run(home, { transactionId: "tx" });
			expect(treeHash(home), `crash after ${n} writes`).toBe(expected);
			expect(formatOf(home), `crash after ${n} writes`).toBe(2);
			// Rerunning a finished migration changes nothing.
			await run(home, { transactionId: "tx" });
			expect(treeHash(home)).toBe(expected);
			if (n === 199) throw new Error("migration never completed");
		}
		expect(crashes).toBeGreaterThan(10);
	});

	it("converges after a crash at every write for a manual install too", async () => {
		const reference = newHome();
		await run(reference);
		const expected = treeHash(reference);
		for (let n = 0; n < 200; n++) {
			const home = newHome();
			const { fs } = faultFs({ crashAfter: n });
			const first = await run(home, { fs }).then(
				() => "done",
				() => "crashed",
			);
			if (first === "done") break;
			await run(home);
			expect(treeHash(home), `crash after ${n} writes`).toBe(expected);
			expect(formatOf(home)).toBe(2);
			expect(slotOf(home)?.status).toBe("committed");
		}
	});

	it("leaves the home untouched and migratable when the clone runs out of space", async () => {
		const home = newHome();
		const before = treeHash(home);
		const { fs } = faultFs({ enospc: { op: "cloneFile", nth: 2 } });
		await expect(run(home, { fs })).rejects.toThrow(/ENOSPC/);
		expect(treeHash(home)).toBe(before);
		expect(existsSync(backupSlot(home))).toBe(false);
		await run(home);
		expect(formatOf(home)).toBe(2);
	});

	it("restores everything when an atomic write runs out of space mid-migration", async () => {
		const home = newHome();
		const before = treeHash(home);
		const { fs } = faultFs({
			enospc: { op: "writeFileSynced", nth: 2, match: /runs\/.*\.migrating$/ },
		});
		await expect(run(home, { fs })).rejects.toThrow(/ENOSPC/);
		expect(treeHash(home)).toBe(before);
		expect(formatOf(home)).toBe(1);
		await run(home);
		expect(formatOf(home)).toBe(2);
	});

	it("refuses before touching anything when there is not enough free space", async () => {
		const home = newHome();
		const before = treeHash(home);
		const { fs } = faultFs({ freeBytes: 1024 });
		await expect(run(home, { fs })).rejects.toThrow(
			/Not enough free disk space/,
		);
		expect(treeHash(home)).toBe(before);
		expect(existsSync(backupSlot(home))).toBe(false);
	});
});

describe("single slot", () => {
	const backup = (
		home: string,
		transactionId: string | null = null,
		extra = {},
	) =>
		createBackup({
			home,
			transactionId,
			migrationIds: ["m"],
			fromFormat: 1,
			toFormat: 2,
			touches: [{ owner: "m", spec: { file: "config.json" } }],
			...extra,
		});

	it("replaces a committed slot but refuses an unresolved one", async () => {
		const home = newHome();
		await run(home); // committed
		const next = backup(home, "next");
		expect(next.transactionId).toBe("next");
		expect(next.status).toBe("ready");
		expect(() => backup(home, "other")).toThrow(UnresolvedBackupError);
		expect(slotOf(home)?.transactionId).toBe("next");
	});

	it("refuses to migrate over another transaction's unresolved slot", async () => {
		const home = newHome();
		await run(home, { transactionId: "tx-a" }); // applied, unresolved
		writeFileSync(
			join(home, "state-format.json"),
			JSON.stringify({
				schema: 1,
				format: 1,
				minReader: 1,
				updatedAt: "x",
				applied: [],
			}),
		);
		const before = treeHash(home);
		const error = await run(home, { transactionId: "tx-b" }).catch((e) => e);
		expect(error).toBeInstanceOf(StateFormatError);
		expect(error.message).toMatch(/restore-backup/);
		expect(treeHash(home)).toBe(before);
	});

	it("refuses a backup over the size cap and names who declared it", () => {
		const home = newHome();
		const error = (() => {
			try {
				backup(home, null, { capBytes: 10 });
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(BackupTooLargeError);
		expect((error as Error).message).toMatch(/m: \d+ bytes/);
		expect(existsSync(backupSlot(home))).toBe(false);
	});

	it("reports insufficient space", () => {
		const home = newHome();
		expect(() =>
			backup(home, null, { fs: faultFs({ freeBytes: 1 }).fs }),
		).toThrow(InsufficientSpaceError);
	});
});

describe("restore and prune", () => {
	it("puts the previous files and format back after a committed migration", async () => {
		const home = newHome();
		const before = treeHash(home);
		await run(home, { transactionId: "tx" });
		commitBackup(home, "tx");
		expect(formatOf(home)).toBe(2);
		restoreMigrationBackup(home);
		expect(treeHash(home)).toBe(before);
		expect(formatOf(home)).toBe(1);
		expect(existsSync(backupSlot(home))).toBe(false);
	});

	/** A migrated home whose restore died after `n` writes. Undefined when it completed. */
	const crashedRestore = async (n: number, transactionId: string | null) => {
		const home = newHome();
		const before = treeHash(home);
		await run(home, { transactionId });
		try {
			restoreMigrationBackup(home, { fs: faultFs({ crashAfter: n }).fs });
		} catch {
			return { home, before };
		}
	};

	it("finishes an interrupted restore on a plain restart, whatever the crash point", async () => {
		const reference = newHome();
		await run(reference, { transactionId: "tx" });
		const migrated = treeHash(reference);
		const stayOnOld = { writes: 1, migratesFrom: 1 };
		let resumed = 0;
		for (const transactionId of ["tx", null]) {
			for (let n = 0; n < 200; n++) {
				const crashed = await crashedRestore(n, transactionId);
				if (!crashed) {
					expect(n).toBeGreaterThan(5);
					break;
				}
				const { home, before } = crashed;
				const label = `crash after ${n} restore writes (${transactionId})`;
				if (!["applied", "committed"].includes(slotOf(home)?.status ?? "")) {
					resumed++;
					await ensureStateFormat(home, {
						support: stayOnOld,
						migrations: [],
						transactionId,
					});
					expect(treeHash(home), label).toBe(before);
					expect(formatOf(home), label).toBe(1);
					const status = slotOf(home)?.status;
					expect(status === undefined || status === "restored", label).toBe(
						true,
					);
				} else {
					// The restore never began: the home is still the complete migration.
					expect(formatOf(home), label).toBe(2);
				}
			}
		}
		expect(resumed).toBeGreaterThan(5);

		// The same restart on a build that migrates re-runs apply from a clean old state.
		for (let n = 0; n < 200; n++) {
			const crashed = await crashedRestore(n, "tx");
			if (!crashed) break;
			await run(crashed.home, { transactionId: "tx" });
			expect(treeHash(crashed.home), `crash after ${n} writes`).toBe(migrated);
			expect(formatOf(crashed.home)).toBe(2);
		}
	});

	it("stops with recovery steps when a live file changed during a resumed restore", async () => {
		let n = 0;
		let crashed: Awaited<ReturnType<typeof crashedRestore>>;
		let consumed: string | undefined;
		for (; n < 200; n++) {
			crashed = await crashedRestore(n, "tx");
			if (!crashed) throw new Error("restore never crashed mid-way");
			const manifest = slotOf(crashed.home);
			if (manifest?.status !== "restoring") continue;
			consumed = manifest.files.find(
				(file) =>
					file.state === "cloned" &&
					!existsSync(join(backupSlot(crashed!.home), "files", file.rel)),
			)?.rel;
			if (consumed) break;
		}
		expect(consumed).toBeDefined();
		const { home } = crashed!;
		writeFileSync(join(home, consumed!), "edited by someone");
		const treeBefore = treeHash(home);
		const slotBefore = listTree(backupSlot(home));
		const formatBefore = formatOf(home);
		const error = await run(home, { transactionId: "tx" }).catch((e) => e);
		expect(error).toBeInstanceOf(StateFormatError);
		expect((error as StateFormatError).cause).toBeInstanceOf(
			UnresolvedBackupError,
		);
		expect((error as Error).message).toContain(consumed);
		expect((error as Error).message).toContain("discard-backup");
		expect(treeHash(home)).toBe(treeBefore);
		expect(listTree(backupSlot(home))).toEqual(slotBefore);
		expect(formatOf(home)).toBe(formatBefore);
		expect(slotOf(home)?.status).toBe("restoring");
	});

	it("prunes a committed slot at the first start after it, or after 14 days", async () => {
		const home = newHome();
		await run(home);
		const committedAt = new Date(slotOf(home)!.committedAt!);
		const sameProcess = new Date(committedAt.getTime() - 1000);
		expect(
			pruneBackup(home, { processStartedAt: sameProcess, now: committedAt }),
		).toBe(false);
		expect(existsSync(backupSlot(home))).toBe(true);
		expect(
			pruneBackup(home, {
				processStartedAt: sameProcess,
				now: new Date(committedAt.getTime() + 15 * 24 * 3600 * 1000),
			}),
		).toBe(true);
		expect(existsSync(backupSlot(home))).toBe(false);

		const second = newHome();
		await run(second);
		const at = new Date(slotOf(second)!.committedAt!);
		expect(
			pruneBackup(second, { processStartedAt: new Date(at.getTime() + 1) }),
		).toBe(true);
		expect(existsSync(backupSlot(second))).toBe(false);
	});

	it("never prunes an unresolved slot", async () => {
		const home = newHome();
		await run(home, { transactionId: "tx" });
		const long = new Date(Date.now() + 365 * 24 * 3600 * 1000);
		expect(pruneBackup(home, { processStartedAt: long, now: long })).toBe(
			false,
		);
		expect(slotOf(home)?.status).toBe("applied");
		// Another transaction cannot commit it either.
		expect(commitBackup(home, "someone-else")).toBeUndefined();
		expect(slotOf(home)?.status).toBe("applied");
	});
});

describe("directory fixtures", () => {
	it("does not leave migration temp files behind on success", async () => {
		const home = newHome();
		await run(home);
		expect(listTree(home).filter((rel) => rel.endsWith(".migrating"))).toEqual(
			[],
		);
	});
});
