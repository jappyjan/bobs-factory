import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import { type FsOps, realFs, writeAtomicVia } from "./fsOps.js";

/*
 * Single-slot backup of exactly the files a migration declares it touches.
 * Deliberately standalone: nothing here knows about migration code, so a
 * supervisor of any version can call `restoreBackup(slot, home)` from the
 * frozen manifest contract (schema 1).
 */

export type TouchSpec =
	| { file: string }
	/** Non-recursive: the direct children of `dir` ending in `ext`. */
	| { dir: string; ext: string };

export type BackupStatus =
	| "backing-up"
	| "ready"
	| "applying"
	| "applied"
	| "committed"
	| "restored";

export interface BackupFile {
	rel: string;
	state: "cloned" | "absent";
	size: number;
	sha256: string;
}

export interface BackupManifest {
	schema: 1;
	status: BackupStatus;
	transactionId: string | null;
	migrationIds: string[];
	fromFormat: number;
	toFormat: number;
	files: BackupFile[];
	bytes: number;
	createdAt: string;
	updatedAt: string;
	committedAt?: string;
}

export const BACKUP_CAP_BYTES = 1024 ** 3;
export const BACKUP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_FREE_MARGIN = 64 * 1024 * 1024;
const UNRESOLVED: BackupStatus[] = ["ready", "applying", "applied"];

export class InsufficientSpaceError extends Error {
	constructor(needed: number, free: number) {
		super(
			`Not enough free disk space for the migration backup: need ${needed} bytes, ${free} available`,
		);
		this.name = "InsufficientSpaceError";
	}
}

export class BackupTooLargeError extends Error {
	constructor(bytes: number, owners: Map<string, number>) {
		const detail = [...owners]
			.sort((a, b) => b[1] - a[1])
			.map(([owner, size]) => `${owner}: ${size} bytes`)
			.join(", ");
		super(
			`Migration backup would hold ${bytes} bytes, over the ${BACKUP_CAP_BYTES} byte cap (${detail}). A migration declared too much in touches.`,
		);
		this.name = "BackupTooLargeError";
	}
}

export class UnresolvedBackupError extends Error {
	constructor(readonly manifest: BackupManifest) {
		super(
			`An unresolved migration backup exists (status ${manifest.status}, transaction ${manifest.transactionId ?? "none"}). Run "bobs-factory update restore-backup" to restore the pre-migration files, or "bobs-factory update discard-backup" to keep the current files.`,
		);
		this.name = "UnresolvedBackupError";
	}
}

// Content-addressed or high-volume data is out of scope for a rewrite
// migration; none of it can be backed up cheaply, so none may be touched.
const FORBIDDEN_SEGMENTS = new Set([
	"run-chunks",
	"evidence",
	"execution-private",
	"diagnostics",
	"caches",
	"cache",
	"chunks",
	"updates",
	"runtime",
	"state-format.json",
]);
const FORBIDDEN_PREFIXES = ["factory/auth"];

export function normalizeRel(rel: string): string {
	if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.includes("\0"))
		throw new Error(`Invalid migration path "${rel}"`);
	const normal = posix.normalize(rel);
	if (normal === "." || normal.startsWith("..") || normal.endsWith("/"))
		throw new Error(`Invalid migration path "${rel}"`);
	return normal;
}

export function assertTouchAllowed(spec: TouchSpec): void {
	const path = normalizeRel("file" in spec ? spec.file : spec.dir);
	if ("dir" in spec && !/^\.[A-Za-z0-9]+$/.test(spec.ext))
		throw new Error(`Invalid extension "${spec.ext}" for ${spec.dir}`);
	if (
		path.split("/").some((segment) => FORBIDDEN_SEGMENTS.has(segment)) ||
		FORBIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
	)
		throw new Error(`Migrations may not touch "${path}"`);
}

export function touchMatches(spec: TouchSpec, rel: string): boolean {
	if ("file" in spec) return normalizeRel(spec.file) === rel;
	return (
		posix.dirname(rel) === normalizeRel(spec.dir) &&
		posix.extname(rel) === spec.ext
	);
}

/** Files a spec covers right now. A `file` spec is always listed (it may be absent). */
export function resolveTouch(
	home: string,
	spec: TouchSpec,
	fs: FsOps = realFs,
): string[] {
	if ("file" in spec) return [normalizeRel(spec.file)];
	const dir = normalizeRel(spec.dir);
	return fs
		.readdir(join(home, ...dir.split("/")))
		.filter((name) => name.endsWith(spec.ext))
		.sort()
		.map((name) => `${dir}/${name}`)
		.filter((rel) => fs.size(livePath(home, rel)) !== undefined);
}

const livePath = (home: string, rel: string) => join(home, ...rel.split("/"));
export const backupRoot = (home: string) =>
	join(home, "updates", "migration-backup");
export const backupSlot = (home: string) => join(backupRoot(home), "current");
const manifestPath = (slot: string) => join(slot, "manifest.json");
const filePath = (slot: string, rel: string) =>
	join(slot, "files", ...rel.split("/"));

export function readManifest(
	slot: string,
	fs: FsOps = realFs,
): BackupManifest | undefined {
	let text: string;
	try {
		text = fs.readFile(manifestPath(slot)).toString("utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const value = JSON.parse(text) as BackupManifest;
	if (value.schema !== 1)
		throw new Error(`Unsupported migration backup manifest in ${slot}`);
	return value;
}

const writeManifest = (slot: string, manifest: BackupManifest, fs: FsOps) =>
	writeAtomicVia(
		fs,
		manifestPath(slot),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

export function isUnresolved(manifest: BackupManifest | undefined): boolean {
	return !!manifest && UNRESOLVED.includes(manifest.status);
}

export function setBackupStatus(
	slot: string,
	status: BackupStatus,
	options: { now?: Date; fs?: FsOps } = {},
): BackupManifest {
	const fs = options.fs ?? realFs;
	const manifest = readManifest(slot, fs);
	if (!manifest) throw new Error("No migration backup to update");
	const at = (options.now ?? new Date()).toISOString();
	const next: BackupManifest = {
		...manifest,
		status,
		updatedAt: at,
		...(status === "committed" ? { committedAt: at } : {}),
	};
	writeManifest(slot, next, fs);
	return next;
}

export interface CreateBackupOptions {
	home: string;
	transactionId: string | null;
	migrationIds: string[];
	fromFormat: number;
	toFormat: number;
	/** `owner` is only used to say who declared too much. */
	touches: Array<{ owner: string; spec: TouchSpec }>;
	fs?: FsOps;
	now?: () => Date;
	capBytes?: number;
}

export function createBackup(options: CreateBackupOptions): BackupManifest {
	const fs = options.fs ?? realFs;
	const now = options.now ?? (() => new Date());
	const slot = backupSlot(options.home);
	const existing = readManifest(slot, fs);
	if (isUnresolved(existing)) throw new UnresolvedBackupError(existing!);
	// A committed or restored slot is spent, and a half-built one never
	// changed live data: dropping them frees space and keeps one slot.
	fs.removeTree(slot);

	const owners = new Map<string, number>();
	const wanted = new Map<string, number | undefined>();
	for (const { owner, spec } of options.touches) {
		assertTouchAllowed(spec);
		for (const rel of resolveTouch(options.home, spec, fs)) {
			if (wanted.has(rel)) continue;
			const size = fs.size(livePath(options.home, rel));
			wanted.set(rel, size);
			owners.set(owner, (owners.get(owner) ?? 0) + (size ?? 0));
		}
	}
	const bytes = [...wanted.values()].reduce<number>((a, b) => a + (b ?? 0), 0);
	if (bytes > (options.capBytes ?? BACKUP_CAP_BYTES))
		throw new BackupTooLargeError(bytes, owners);
	fs.mkdirp(backupRoot(options.home));
	const needed = bytes + Math.max(MIN_FREE_MARGIN, Math.ceil(bytes * 0.1));
	const free = fs.freeBytes(backupRoot(options.home));
	if (free < needed) throw new InsufficientSpaceError(needed, free);

	const created = now().toISOString();
	const base: BackupManifest = {
		schema: 1,
		status: "backing-up",
		transactionId: options.transactionId,
		migrationIds: options.migrationIds,
		fromFormat: options.fromFormat,
		toFormat: options.toFormat,
		files: [],
		bytes,
		createdAt: created,
		updatedAt: created,
	};
	try {
		fs.mkdirp(join(slot, "files"));
		writeManifest(slot, base, fs);
		const files: BackupFile[] = [];
		for (const [rel, size] of wanted) {
			if (size === undefined) {
				files.push({ rel, state: "absent", size: 0, sha256: "" });
				continue;
			}
			const target = filePath(slot, rel);
			fs.mkdirp(dirname(target));
			fs.cloneFile(livePath(options.home, rel), target);
			files.push({
				rel,
				state: "cloned",
				size,
				sha256: createHash("sha256").update(fs.readFile(target)).digest("hex"),
			});
		}
		const ready: BackupManifest = {
			...base,
			status: "ready",
			files,
			updatedAt: now().toISOString(),
		};
		writeManifest(slot, ready, fs);
		return ready;
	} catch (error) {
		// Live data is untouched until `ready`; leave no half-built slot behind.
		try {
			fs.removeTree(slot);
		} catch {}
		throw error;
	}
}

/**
 * Put every backed-up file back by rename (no byte copy, no extra space) and
 * unlink files that did not exist before. Idempotent: the files still present
 * in the slot are exactly what is left to do, so a crash mid-restore re-runs.
 */
export function restoreBackup(
	slot: string,
	home: string,
	options: { fs?: FsOps; now?: Date } = {},
): BackupManifest | undefined {
	const fs = options.fs ?? realFs;
	const manifest = readManifest(slot, fs);
	if (!manifest) {
		fs.removeTree(slot);
		return;
	}
	// Before `applying` nothing live changed; there is nothing to put back.
	if (manifest.status !== "backing-up" && manifest.status !== "ready") {
		for (const file of manifest.files) {
			const live = livePath(home, file.rel);
			if (file.state === "absent") {
				try {
					fs.unlink(live);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				continue;
			}
			const saved = filePath(slot, file.rel);
			if (fs.size(saved) === undefined) continue;
			fs.mkdirp(dirname(live));
			fs.rename(saved, live);
		}
	}
	const restored = setBackupStatus(slot, "restored", { fs, now: options.now });
	fs.removeTree(slot);
	return restored;
}

export const discardBackup = (home: string, fs: FsOps = realFs) =>
	fs.removeTree(backupSlot(home));

/** `applied` → `committed`, only for the transaction the slot is bound to. */
export function commitBackup(
	home: string,
	transactionId: string | null,
	options: { fs?: FsOps; now?: Date } = {},
): BackupManifest | undefined {
	const slot = backupSlot(home);
	const manifest = readManifest(slot, options.fs);
	if (!manifest || manifest.transactionId !== transactionId) return;
	if (manifest.status === "committed") return manifest;
	if (manifest.status !== "applied") return;
	return setBackupStatus(slot, "committed", options);
}

/**
 * A committed slot goes away at the first start after it was committed, or
 * after 14 days. An unresolved slot is never pruned.
 */
export function pruneBackup(
	home: string,
	options: { now?: Date; processStartedAt?: Date; fs?: FsOps } = {},
): boolean {
	const fs = options.fs ?? realFs;
	const slot = backupSlot(home);
	const manifest = readManifest(slot, fs);
	if (manifest?.status !== "committed" && manifest?.status !== "restored")
		return false;
	const committedAt = Date.parse(manifest.committedAt ?? manifest.updatedAt);
	const now = (options.now ?? new Date()).getTime();
	const startedAt = options.processStartedAt?.getTime();
	if (
		manifest.status === "restored" ||
		(startedAt !== undefined && startedAt > committedAt) ||
		now - committedAt > BACKUP_RETENTION_MS
	) {
		fs.removeTree(slot);
		return true;
	}
	return false;
}
