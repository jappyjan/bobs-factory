import {
	cpSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	type Stats,
	statfsSync,
	symlinkSync,
} from "node:fs";

import {
	copyFile,
	lstat,
	mkdir,
	opendir,
	readlink,
	statfs,
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

function copyAction(
	relative: string,
	stat: Stats,
	purpose: "preflight" | "snapshot",
): "copy" | "link" | "skip" {
	const inJobHome =
		/^factory\/execution-private\/[^/]+\/jobs\/[^/]+\/[^/]+\/home\//.test(
			relative,
		);
	if (
		stat.isSymbolicLink() &&
		(inJobHome || relative.startsWith("factory/evidence/"))
	) {
		// Evidence and agent toolchains may contain external or expired links.
		// Keep the exact link record without reading its target; omit it from
		// the candidate's preflight home to prevent external reads.
		return purpose === "snapshot" ? "link" : "skip";
	}
	// Sockets and FIFOs in isolated agent homes are transient runtime artifacts.
	if (inJobHome && (stat.isSocket() || stat.isFIFO())) return "skip";
	if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
		throw new Error(
			`Snapshot refuses external/special owned state: ${relative}`,
		);
	return "copy";
}

// Allow metadata/proofs and modest growth between estimation and the copy.
function requiredCopySpace(bytes: number) {
	return bytes + Math.max(64 * 1024 * 1024, Math.ceil(bytes * 0.1));
}
function assertCopySpace(bytes: number, free: number, purpose: string) {
	const required = requiredCopySpace(bytes);
	if (free < required)
		throw new Error(
			`Insufficient disk space for update ${purpose}: need ${required} bytes (${bytes} bytes of owned state plus margin), available ${free} bytes. Free space in Settings → Storage before retrying.`,
		);
}

/** Synchronous compatibility entry for retained validation scripts. New update producers use the cancellable retention-aware copy below. */
export function copyUpdateState(
	home: string,
	destination: string,
	purpose: "preflight" | "snapshot",
) {
	mkdirSync(destination, { recursive: true, mode: 0o700 });
	const copy = (
		source: string,
		target: string,
		relative: string,
		estimate: boolean,
	): number => {
		if (relative === "factory/auth" || relative.startsWith("factory/auth/"))
			return 0;
		const stat = lstatSync(source);
		const action = copyAction(relative, stat, purpose);
		if (action === "skip") return 0;
		if (action === "link") {
			if (!estimate) symlinkSync(readlinkSync(source), target);
			return 4096;
		}
		if (stat.isDirectory()) {
			if (!estimate) mkdirSync(target, { recursive: true, mode: 0o700 });
			let bytes = 4096;
			for (const name of readdirSync(source))
				bytes += copy(
					join(source, name),
					join(target, name),
					`${relative}/${name}`,
					estimate,
				);
			return bytes;
		}
		if (!estimate) cpSync(source, target);
		return Math.max(4096, stat.size);
	};
	let bytes = 0;
	for (const estimate of [true, false]) {
		if (!estimate) {
			const volume = statfsSync(destination);
			assertCopySpace(bytes, volume.bavail * volume.bsize, purpose);
		}
		for (const name of ["config.json", "state", "factory"]) {
			const source = join(home, name);
			try {
				lstatSync(source);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			bytes += copy(source, join(destination, name), name, estimate);
		}
	}
}

/** Copy authoritative state without importing credentials or following retained links.
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
		estimate: boolean,
	): Promise<number> => {
		signal?.throwIfAborted();
		if (
			relative === "factory/auth" ||
			relative.startsWith("factory/auth/") ||
			excluded.has(source)
		)
			return 0;
		const stat = await lstat(source);
		const action = copyAction(relative, stat, purpose);
		if (action === "skip") return 0;
		if (action === "link") {
			if (!estimate) await symlink(await readlink(source), target);
			return 4096;
		}
		if (stat.isDirectory()) {
			if (!estimate) await mkdir(target, { recursive: true, mode: 0o700 });
			let bytes = 4096;
			const directory = await opendir(source);
			for await (const entry of directory)
				bytes += await copy(
					join(source, entry.name),
					join(target, entry.name),
					`${relative}/${entry.name}`,
					estimate,
				);
			return bytes;
		}
		if (!estimate) await copyFile(source, target);
		return Math.max(4096, stat.size);
	};
	let bytes = 0;
	for (const estimate of [true, false]) {
		if (!estimate) {
			const volume = await statfs(destination);
			assertCopySpace(bytes, volume.bavail * volume.bsize, purpose);
		}
		for (const name of ["config.json", "state", "factory"]) {
			const source = join(home, name);
			try {
				await lstat(source);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			bytes += await copy(source, join(destination, name), name, estimate);
		}
	}
}
