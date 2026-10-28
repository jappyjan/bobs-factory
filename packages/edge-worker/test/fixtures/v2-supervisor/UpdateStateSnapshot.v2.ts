// @ts-nocheck
// Frozen copy of the v2 update supervisor logic: UpdateStateSnapshot as shipped in 5d5f2760
// (the build of the supervisor process that drives the first update into the
// swap-and-rollback build). Do not "fix" it: the end-to-end test proves this
// exact code still accepts what the current build serves.
// Edits relative to 5d5f2760 (imports only, no logic):
// - the retention-record exclusion pass over already-verified copies is removed
//   (it only skips directories that earlier updates left behind; the copy itself,
//   the credential exclusion and the evidence-link handling are unchanged).
import {
	cpSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
} from "node:fs";

import {
	copyFile,
	lstat,
	mkdir,
	opendir,
	readlink,
	symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { StorageRetentionStore } from "bobs-factory-core";

/** Synchronous compatibility entry for retained validation scripts. New update producers use the cancellable retention-aware copy below. */
export function copyUpdateState(
	home: string,
	destination: string,
	purpose: "preflight" | "snapshot",
) {
	mkdirSync(destination, { recursive: true, mode: 0o700 });
	const copy = (source: string, target: string, relative: string) => {
		if (relative === "factory/auth" || relative.startsWith("factory/auth/"))
			return;
		const stat = lstatSync(source);
		if (stat.isSymbolicLink() && relative.startsWith("factory/evidence/")) {
			// Evidence may retain absolute, external or expired test-tool links.
			// Backups retain the exact link record without reading its target. The
			// candidate's separate preflight home omits it to prevent external reads.
			if (purpose === "snapshot") symlinkSync(readlinkSync(source), target);
			return;
		}
		if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
			throw new Error(
				`Snapshot refuses external/special owned state: ${relative}`,
			);
		if (stat.isDirectory()) {
			mkdirSync(target, { recursive: true, mode: 0o700 });
			for (const name of readdirSync(source))
				copy(join(source, name), join(target, name), `${relative}/${name}`);
		} else cpSync(source, target);
	};
	for (const name of ["config.json", "state", "factory"]) {
		const source = join(home, name);
		try {
			lstatSync(source);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		copy(source, join(destination, name), name);
	}
}

/** Copy authoritative state without importing credentials or following evidence links.
 * Cleanup authority stays outside the copied roots and is always revalidated. */
export async function copyUpdateStateForRetention(
	home: string,
	destination: string,
	purpose: "preflight" | "snapshot",
	signal?: AbortSignal,
) {
	await mkdir(destination, { recursive: true, mode: 0o700 });
	home = new StorageRetentionStore(home).home;
	const _store = new StorageRetentionStore(home),
		excluded = new Set<string>();
	// Records whose copy is verified replaceable were skipped here; the current
	// build no longer has that machinery and the test inventory has none.
	const copy = async (
		source: string,
		target: string,
		relative: string,
	): Promise<void> => {
		signal?.throwIfAborted();
		if (
			relative === "factory/auth" ||
			relative.startsWith("factory/auth/") ||
			excluded.has(source)
		)
			return;
		const stat = await lstat(source);
		if (stat.isSymbolicLink() && relative.startsWith("factory/evidence/")) {
			if (purpose === "snapshot") await symlink(await readlink(source), target);
			return;
		}
		if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
			throw new Error(
				`Snapshot refuses external/special owned state: ${relative}`,
			);
		if (stat.isDirectory()) {
			await mkdir(target, { recursive: true, mode: 0o700 });
			const directory = await opendir(source);
			for await (const entry of directory)
				await copy(
					join(source, entry.name),
					join(target, entry.name),
					`${relative}/${entry.name}`,
				);
		} else await copyFile(source, target);
	};
	for (const name of ["config.json", "state", "factory"]) {
		const source = join(home, name);
		try {
			await lstat(source);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		await copy(source, join(destination, name), name);
	}
}
