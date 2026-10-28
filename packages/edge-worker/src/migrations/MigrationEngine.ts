import { join } from "node:path";
import {
	compareStateFormat,
	factoryRuntimeIdentity,
	newStateFormatRecord,
	readStateFormatRecord,
	STATE_FORMAT,
	STATE_FORMAT_MIN_MIGRATE,
	StateFormatError,
	type StateFormatSupport,
	writeStateFormatRecord,
} from "bobs-factory-core";
import { type FsOps, realFs, writeAtomicVia } from "./fsOps.js";
import {
	assertTouchAllowed,
	backupSlot,
	beginRestore,
	commitBackup,
	createBackup,
	isUnresolved,
	readManifest,
	resolveTouch,
	restoreBackup,
	setBackupStatus,
	UnresolvedBackupError,
} from "./MigrationBackup.js";
import { createMigrationContext } from "./MigrationContext.js";
import { MIGRATIONS } from "./registry.js";
import type { StateMigration } from "./types.js";

export const UPDATE_TRANSACTION_ENV = "BOBS_FACTORY_UPDATE_TRANSACTION";

export const currentStateFormatSupport = (): StateFormatSupport => ({
	writes: STATE_FORMAT,
	migratesFrom: STATE_FORMAT_MIN_MIGRATE,
});

export interface EnsureStateFormatOptions {
	/** Bound into the backup. Defaults to `$BOBS_FACTORY_UPDATE_TRANSACTION`, else null. */
	transactionId?: string | null;
	support?: StateFormatSupport;
	migrations?: readonly StateMigration[];
	fs?: FsOps;
	now?: () => Date;
}

export function validateMigrationRegistry(
	migrations: readonly StateMigration[],
): void {
	const ids = new Set<string>();
	migrations.forEach((m, index) => {
		if (ids.has(m.id)) throw new Error(`Duplicate migration id ${m.id}`);
		ids.add(m.id);
		if (m.to !== m.from + 1)
			throw new Error(`Migration ${m.id} must go from N to N+1`);
		if (index > 0 && migrations[index - 1]?.to !== m.from)
			throw new Error(`Migration ${m.id} does not follow the previous one`);
		for (const spec of m.touches) assertTouchAllowed(spec);
	});
}

export function planMigrations(
	onDisk: number,
	support: StateFormatSupport,
	registry: readonly StateMigration[] = MIGRATIONS,
): StateMigration[] {
	validateMigrationRegistry(registry);
	const plan = registry.filter(
		(m) => m.from >= onDisk && m.to <= support.writes,
	);
	if (
		onDisk < support.writes &&
		(plan[0]?.from !== onDisk || plan.at(-1)?.to !== support.writes)
	)
		throw new StateFormatError(
			`This build has no migration path from data format ${onDisk} to ${support.writes}.`,
		);
	return plan;
}

export async function describeMigrationPlan(
	home: string,
	plan: readonly StateMigration[],
	fs: FsOps = realFs,
) {
	return Promise.all(
		plan.map(async (m) => {
			const reader = createMigrationContext(home, m.touches, { fs });
			const touched = m.touches
				.flatMap((spec) => resolveTouch(home, spec, fs))
				.reduce(
					(sum, rel) => sum + (fs.size(join(home, ...rel.split("/"))) ?? 0),
					0,
				);
			return {
				id: m.id,
				from: m.from,
				to: m.to,
				touches: m.touches,
				estimateBytes: touched + ((await m.estimate?.(reader)) ?? 0),
			};
		}),
	);
}

/** What `GET /api/version` and `service format --json` report. */
export function stateFormatReport(
	home: string,
	support: StateFormatSupport = currentStateFormatSupport(),
) {
	return {
		...support,
		onDisk: readStateFormatRecord(home)?.format ?? 1,
	};
}

/**
 * Put the pre-migration files back by rename and, if the format file already
 * advanced, move it back first. A completed restore leaves the old files, the
 * old format marker and a `restored` slot.
 */
export function restoreMigrationBackup(
	home: string,
	options: { fs?: FsOps; now?: () => Date } = {},
) {
	const fs = options.fs ?? realFs;
	const slot = backupSlot(home);
	// `restoring` lands first: from here on a crash finishes the restore on
	// the next start instead of resuming the migration over half-restored files.
	const manifest = beginRestore(slot, { fs, now: options.now?.() });
	if (!manifest) return;
	const record = readStateFormatRecord(home);
	if (
		manifest.status !== "backing-up" &&
		manifest.status !== "ready" &&
		(record?.format ?? 1) !== manifest.fromFormat
	)
		writeStateFormatRecord(
			home,
			newStateFormatRecord(manifest.fromFormat, {
				previous: record,
				now: options.now?.(),
			}),
			(path, text) => writeAtomicVia(fs, path, text),
		);
	return restoreBackup(slot, home, { fs, now: options.now?.() });
}

const refuse = (message: string, cause?: unknown) =>
	new StateFormatError(message, cause ? { cause } : undefined);

/**
 * The only place migrations run. First thing in worker startup, before any
 * state is opened. Refuses (exit code 78) rather than guess.
 */
export async function ensureStateFormat(
	home: string,
	options: EnsureStateFormatOptions = {},
): Promise<{ onDisk: number; migrated: boolean }> {
	const fs = options.fs ?? realFs;
	const now = options.now ?? (() => new Date());
	const support = options.support ?? currentStateFormatSupport();
	const registry = options.migrations ?? MIGRATIONS;
	const transactionId =
		options.transactionId !== undefined
			? options.transactionId
			: process.env[UPDATE_TRANSACTION_ENV] || null;
	const writtenBy = {
		version: factoryRuntimeIdentity.version,
		commit: factoryRuntimeIdentity.commit,
	};
	const write = (path: string, text: string) => writeAtomicVia(fs, path, text);
	const slot = backupSlot(home);
	// A restore that was interrupted always finishes first, whatever the
	// transaction; the guard below then sees a clean old state.
	if (readManifest(slot, fs)?.status === "restoring") {
		try {
			restoreMigrationBackup(home, { fs, now });
		} catch (error) {
			throw refuse(
				`An interrupted migration restore could not be finished: ${(error as Error).message}`,
				error,
			);
		}
	}
	const record = readStateFormatRecord(home);
	const onDisk = record?.format ?? 1;

	switch (compareStateFormat(onDisk, support)) {
		case "too-new":
			throw refuse(
				`Data format ${onDisk} was written by a newer Bob's Factory${record?.writtenBy ? ` (${record.writtenBy.version})` : ""}; this build writes format ${support.writes}. Install that newer build or later, or restore the migration backup with "bobs-factory update restore-backup". No data was touched.`,
			);
		case "too-old":
			throw refuse(
				`Data format ${onDisk} is older than the oldest format this build migrates from (${support.migratesFrom}). Upgrade through an intermediate Bob's Factory version first. No data was touched.`,
			);
		case "current": {
			// A crash after the format file was written but before the slot
			// advanced leaves an applying slot behind; finish what it was doing.
			const pending = readManifest(slot, fs);
			if (
				pending?.status === "applying" &&
				pending.transactionId === transactionId &&
				pending.toFormat <= onDisk
			)
				setBackupStatus(slot, "applied", { fs, now: now() });
			if (transactionId === null) commitBackup(home, null, { fs, now: now() });
			if (!record)
				writeStateFormatRecord(
					home,
					newStateFormatRecord(onDisk, { writtenBy, now: now() }),
					write,
				);
			return { onDisk, migrated: false };
		}
	}

	const plan = planMigrations(onDisk, support, registry);
	const migrationIds = plan.map((m) => m.id);
	const existing = readManifest(slot, fs);
	let manifest = existing;
	try {
		if (isUnresolved(existing)) {
			const resumable =
				existing!.transactionId === transactionId &&
				existing!.migrationIds.join() === migrationIds.join();
			if (!resumable) throw new UnresolvedBackupError(existing!);
		} else {
			manifest = createBackup({
				home,
				transactionId,
				migrationIds,
				fromFormat: onDisk,
				toFormat: support.writes,
				touches: plan.flatMap((m) =>
					m.touches.map((spec) => ({ owner: m.id, spec })),
				),
				fs,
				now,
			});
		}
	} catch (error) {
		throw refuse(
			`Cannot migrate data format ${onDisk} to ${support.writes}: ${(error as Error).message} No data was changed.`,
			error,
		);
	}

	try {
		manifest = setBackupStatus(slot, "applying", { fs, now: now() });
		for (const migration of plan) {
			const ctx = createMigrationContext(home, migration.touches, {
				fs,
				manifest,
			});
			await migration.apply(ctx);
			await migration.verify?.(ctx);
		}
		const last = plan.at(-1);
		if (!last) throw new Error("Empty migration plan");
		// Last: until this lands, the home still reads as the old format.
		writeStateFormatRecord(
			home,
			newStateFormatRecord(last.to, {
				minReader: last.minReader,
				writtenBy,
				previous: record,
				applied: plan.map((m) => ({
					id: m.id,
					from: m.from,
					to: m.to,
					at: now().toISOString(),
				})),
				now: now(),
			}),
			write,
		);
		setBackupStatus(slot, "applied", { fs, now: now() });
		// Under a supervisor the transaction owner commits after its health
		// check; a manual install has no one else, so the slot is final here.
		if (transactionId === null) commitBackup(home, null, { fs, now: now() });
	} catch (error) {
		try {
			restoreMigrationBackup(home, { fs, now });
		} catch (restoreError) {
			throw refuse(
				`Migration ${migrationIds.join(", ")} failed (${(error as Error).message}) and restoring the backup also failed (${(restoreError as Error).message}). Run "bobs-factory update restore-backup" to finish restoring.`,
				error,
			);
		}
		throw refuse(
			`Migration ${migrationIds.join(", ")} failed: ${(error as Error).message}. The data was restored to format ${onDisk} and Bob's Factory did not start.`,
			error,
		);
	}
	return { onDisk: support.writes, migrated: true };
}
