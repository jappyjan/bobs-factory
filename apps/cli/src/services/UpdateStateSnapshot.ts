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
import {
	StorageRetentionStore,
	sameStorageIdentity,
	storageIdentity,
	verifyStorageIntegrity,
	verifyStorageReplacement,
} from "bobs-factory-core";

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
	const store = new StorageRetentionStore(home),
		excluded = new Set<string>();
	const count = await store.inventoryCount();
	for (let offset = 0; offset < count; offset += 100) {
		for (const id of await store.inventoryPage(offset)) {
			const record = await store.record(id);
			if (record.authoritativeReplacement) {
				try {
					if (await verifyStorageReplacement(store, id, signal))
						excluded.add(record.path);
				} catch {
					/* Replacement drift revokes exclusion; preserve the old copy. */
				}
				continue;
			}
			if (
				!record.replacement ||
				!record.verifiedAt ||
				!record.reconciledAt ||
				record.dependencies.length
			)
				continue;
			const replacement = await store.record(record.replacement);
			const integrity = replacement.evidence
				.find((value) => value.startsWith("integrity:"))
				?.slice(10);
			if (
				!integrity ||
				!replacement.verifiedAt ||
				!replacement.reconciledAt ||
				replacement.dependencies.length
			)
				continue;
			if (
				!sameStorageIdentity(
					record.identity,
					await storageIdentity(record.path, record.root),
				) ||
				!sameStorageIdentity(
					replacement.identity,
					await storageIdentity(replacement.path, replacement.root),
				)
			)
				continue;
			await verifyStorageIntegrity(
				replacement.path,
				join(store.directory, "proofs", `${replacement.id}.ndjson`),
				integrity,
				signal,
			);
			excluded.add(record.path);
		}
	}
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
