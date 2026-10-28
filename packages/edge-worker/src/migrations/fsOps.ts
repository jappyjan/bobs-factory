import {
	closeSync,
	constants,
	copyFileSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statfsSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** Every filesystem effect of the backup and migration engine goes through
 * this seam so tests can inject ENOSPC or a crash at any single write. */
export interface FsOps {
	readFile(path: string): Buffer;
	/** Create or replace `path` with `data`, fsynced, mode 0600. */
	writeFileSynced(path: string, data: Uint8Array | string): void;
	/** Reflink where the filesystem supports it, otherwise a plain copy. */
	cloneFile(src: string, dst: string): void;
	rename(from: string, to: string): void;
	unlink(path: string): void;
	removeTree(path: string): void;
	mkdirp(path: string): void;
	/** Size in bytes, or undefined when the path does not exist. */
	size(path: string): number | undefined;
	readdir(path: string): string[];
	freeBytes(path: string): number;
}

export const realFs: FsOps = {
	readFile: (path) => readFileSync(path),
	writeFileSynced(path, data) {
		const fd = openSync(path, "w", 0o600);
		try {
			const bytes = typeof data === "string" ? Buffer.from(data) : data;
			writeSync(fd, bytes);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	},
	cloneFile(src, dst) {
		copyFileSync(src, dst, constants.COPYFILE_FICLONE);
		const fd = openSync(dst, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	},
	rename: renameSync,
	unlink: unlinkSync,
	removeTree: (path) => rmSync(path, { recursive: true, force: true }),
	mkdirp: (path) => {
		mkdirSync(path, { recursive: true, mode: 0o700 });
	},
	size(path) {
		try {
			const stat = lstatSync(path);
			return stat.isFile() ? stat.size : undefined;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	},
	readdir(path) {
		try {
			return readdirSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	},
	freeBytes(path) {
		const stat = statfsSync(path);
		return stat.bavail * stat.bsize;
	},
};

/** tmp + fsync + rename in the same directory. The tmp name is deterministic so
 * a crash leaves at most one stray file that the next attempt overwrites. */
export function writeAtomicVia(
	fs: FsOps,
	path: string,
	data: Uint8Array | string,
) {
	fs.mkdirp(dirname(path));
	const tmp = `${path}.migrating`;
	try {
		fs.writeFileSynced(tmp, data);
	} catch (error) {
		try {
			fs.unlink(tmp);
		} catch {}
		throw error;
	}
	fs.rename(tmp, path);
}
