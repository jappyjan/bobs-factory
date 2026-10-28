import { join } from "node:path";
import { type FsOps, realFs, writeAtomicVia } from "./fsOps.js";
import {
	type BackupManifest,
	normalizeRel,
	resolveTouch,
	type TouchSpec,
	touchMatches,
} from "./MigrationBackup.js";

export interface MigrationReader {
	read(rel: string): Buffer;
	exists(rel: string): boolean;
	/** Existing files covered by one of the migration's declared `touches`. */
	list(spec: TouchSpec): string[];
}

export interface MigrationContext extends MigrationReader {
	/** tmp + fsync + rename. Rewrites a file; it may only create files named by a `file` touch. */
	writeAtomic(rel: string, data: Uint8Array | string): void;
	remove(rel: string): void;
}

const sameSpec = (a: TouchSpec, b: TouchSpec) =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * The only door a migration has to the home. Every path is checked against
 * the migration's declared `touches`, which makes the backup complete by
 * construction: a write the backup did not cover cannot happen.
 */
export function createMigrationContext(
	home: string,
	touches: readonly TouchSpec[],
	options: { fs?: FsOps; manifest?: BackupManifest } = {},
): MigrationContext {
	const fs = options.fs ?? realFs;
	const backedUp = options.manifest
		? new Set(options.manifest.files.map((file) => file.rel))
		: undefined;
	const live = (rel: string) => join(home, ...rel.split("/"));
	const declared = (path: string) => {
		const rel = normalizeRel(path);
		if (!touches.some((spec) => touchMatches(spec, rel)))
			throw new Error(
				`Migration touched "${rel}" outside its declared touches`,
			);
		return rel;
	};
	const writable = (path: string) => {
		const rel = declared(path);
		// A directory touch only covers files that existed when the backup was
		// taken; a file created later could not be restored away.
		if (backedUp && !backedUp.has(rel))
			throw new Error(
				`Migration may not create "${rel}": it was not part of the backup`,
			);
		return rel;
	};
	return {
		read: (rel) => fs.readFile(live(declared(rel))),
		exists: (rel) => fs.size(live(declared(rel))) !== undefined,
		list(spec) {
			if (!touches.some((declaredSpec) => sameSpec(declaredSpec, spec)))
				throw new Error("Migration listed a spec it did not declare");
			return resolveTouch(home, spec, fs).filter(
				(rel) => fs.size(live(rel)) !== undefined,
			);
		},
		writeAtomic: (rel, data) => writeAtomicVia(fs, live(writable(rel)), data),
		remove(rel) {
			const path = live(writable(rel));
			try {
				fs.unlink(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		},
	};
}
