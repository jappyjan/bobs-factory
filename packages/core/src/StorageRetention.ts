import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { OwnedResourceClaim } from "./OwnedResourceClaim.js";

export const StorageCategorySchema = z.enum([
	"snapshot",
	"staging",
	"preparation",
	"recovery",
	"migration",
	"worktree",
]);
export type StorageCategory = z.infer<typeof StorageCategorySchema>;
const days = z.number().int().min(1).max(36500);
export const StoragePolicySchema = z
	.object({
		version: z.literal(1).default(1),
		revision: z.number().int().nonnegative().default(0),
		enabled: z.boolean().default(true),
		intervalHours: z.number().int().min(1).max(168).default(24),
		snapshotCount: z.number().int().min(1).max(100).default(2),
		ages: z
			.object({
				staging: days.default(7),
				preparation: days.default(7),
				recovery: days.default(7),
				migration: days.default(7),
				worktree: days.default(30),
			})
			.default({
				staging: 7,
				preparation: 7,
				recovery: 7,
				migration: 7,
				worktree: 30,
			}),
		lowDiskBytes: z
			.number()
			.int()
			.min(0)
			.max(Number.MAX_SAFE_INTEGER)
			.default(5 * 1024 ** 3),
	})
	.strict();
export type StoragePolicy = z.infer<typeof StoragePolicySchema>;
export const StorageIdentitySchema = z
	.object({
		device: z.string(),
		inode: z.string(),
		birthtime: z.number(),
	})
	.strict();
export type StorageIdentity = z.infer<typeof StorageIdentitySchema>;
export const StorageRecordSchema = z
	.object({
		version: z.literal(1),
		id: z.string().uuid(),
		category: StorageCategorySchema,
		rollback: z.enum(["usable", "disposable", "unknown"]).optional(),
		path: z.string(),
		root: z.string(),
		identity: StorageIdentitySchema,
		producer: z.string().min(1).max(200),
		operation: z.string().min(1).max(200),
		registeredAt: z.string().datetime(),
		completedAt: z.string().datetime().optional(),
		verifiedAt: z.string().datetime().optional(),
		reconciledAt: z.string().datetime().optional(),
		replacement: z.string().optional(),
		authoritativeReplacement: z
			.object({
				path: z.string(),
				identity: StorageIdentitySchema,
				integrity: z.string(),
			})
			.strict()
			.optional(),
		dependencies: z.array(z.string().max(1000)).max(1000),
		evidence: z.array(z.string().max(1000)).max(100),
		historicalElection: z
			.object({ preview: z.string(), at: z.string().datetime() })
			.optional(),
	})
	.strict();
export type StorageRecord = z.infer<typeof StorageRecordSchema>;
export function storageDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function sameStorageIdentity(a: StorageIdentity, b: StorageIdentity) {
	return (
		a.device === b.device && a.inode === b.inode && a.birthtime === b.birthtime
	);
}
/** Check each ancestor; realpath alone would silently accept an owned-root link. */
export async function storageIdentity(
	path: string,
	root: string,
): Promise<StorageIdentity> {
	path = resolve(path);
	root = resolve(root);
	const rootStat = await lstat(root);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
		throw new Error("Storage owned root must be a real directory");
	const canonicalRoot = await realpath(root),
		canonicalPath = await realpath(path);
	const suffix = relative(canonicalRoot, canonicalPath);
	if (
		!suffix ||
		suffix === ".." ||
		suffix.startsWith(`..${sep}`) ||
		isAbsolute(suffix)
	)
		throw new Error("Storage target must be strictly within its owned root");
	const lexicalSuffix = relative(root, path);
	const boundary =
		lexicalSuffix === ".." ||
		lexicalSuffix.startsWith(`..${sep}`) ||
		isAbsolute(lexicalSuffix)
			? canonicalRoot
			: root;
	let cursor = path;
	while (true) {
		const stat = await lstat(cursor);
		if (stat.isSymbolicLink() || !stat.isDirectory())
			throw new Error("Storage path must contain only real directories");
		if (cursor === boundary) break;
		if (cursor === dirname(cursor))
			throw new Error("Storage path escapes its owned root");
		cursor = dirname(cursor);
	}
	const stat = await lstat(canonicalPath);
	return {
		device: String(stat.dev),
		inode: String(stat.ino),
		birthtime: stat.birthtimeMs,
	};
}
export async function publishStorageJson(file: string, value: unknown) {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, file);
	const directory = await open(dirname(file), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}
export async function readStorageJson(
	file: string,
): Promise<unknown | undefined> {
	try {
		const stat = await lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
			throw new Error("Storage record must be a bounded regular file");
		return JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
/** Private per-instance data, deliberately outside state/factory snapshot payloads. */
export class StorageRetentionStore {
	readonly directory: string;
	constructor(readonly home: string) {
		this.home = existsSync(home) ? realpathSync(home) : resolve(home);
		this.directory = join(this.home, "storage-retention");
	}
	async initialize() {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		if (
			(await realpath(this.directory)) !== this.directory ||
			(await lstat(this.directory)).isSymbolicLink()
		)
			throw new Error("Storage retention directory cannot be a symlink");
	}
	async policy(): Promise<StoragePolicy> {
		return StoragePolicySchema.parse(
			(await readStorageJson(join(this.directory, "policy.json"))) ?? {},
		);
	}
	async configure(input: unknown, revision: number) {
		await this.initialize();
		return new OwnedResourceClaim(join(this.directory, "policy.lock")).run(
			async () => {
				const previous = await this.policy();
				if (revision !== previous.revision)
					throw new Error("Storage policy changed; refresh before saving");
				const next = StoragePolicySchema.parse(input);
				next.revision = revision + 1;
				await publishStorageJson(join(this.directory, "policy.json"), next);
				return next;
			},
			true,
		);
	}
	recordPath(id: string) {
		z.string().uuid().parse(id);
		return join(this.directory, "records", `${id}.json`);
	}
	async register(
		input: Omit<StorageRecord, "version" | "id" | "identity" | "registeredAt">,
	) {
		await this.initialize();
		const record = StorageRecordSchema.parse({
			...input,
			version: 1,
			id: randomUUID(),
			root: await realpath(input.root),
			path: await realpath(input.path),
			identity: await storageIdentity(input.path, input.root),
			registeredAt: new Date().toISOString(),
		});
		await new OwnedResourceClaim(join(this.directory, "inventory.lock")).run(
			async () => {
				const existing = (await readStorageJson(
					join(
						this.directory,
						"path-records",
						`${storageDigest(record.path)}.json`,
					),
				)) as { id: string; identity: StorageIdentity } | undefined;
				if (existing) {
					const receipt = (await readStorageJson(
						join(this.directory, "receipts", `${existing.id}.json`),
					)) as { phase?: string } | undefined;
					if (
						sameStorageIdentity(existing.identity, record.identity) ||
						receipt?.phase !== "completed"
					)
						throw new Error(
							"Storage path already has ownership or an unresolved earlier identity; reconcile it before registering again",
						);
				}
				const count = await this.inventoryCount();
				const pagePath = join(
					this.directory,
					"inventory",
					`${Math.floor(count / 100)}.json`,
				);
				const page = z
					.array(z.string().uuid())
					.max(100)
					.parse((await readStorageJson(pagePath)) ?? []);
				if (page.length !== count % 100)
					throw new Error("Storage inventory index requires reconciliation");
				const revision = await this.beginInventoryWrite();
				await publishStorageJson(this.recordPath(record.id), record);
				await publishStorageJson(
					join(
						this.directory,
						"path-records",
						`${storageDigest(record.path)}.json`,
					),
					{ id: record.id, identity: record.identity },
				);
				await publishStorageJson(pagePath, [...page, record.id]);
				await publishStorageJson(
					join(this.directory, "inventory-count.json"),
					count + 1,
				);
				await this.finishInventoryWrite(revision);
			},
			true,
		);
		return record;
	}
	async inventoryRevision(): Promise<number> {
		const revision = z
			.object({
				revision: z.number().int().nonnegative(),
				writing: z.boolean(),
			})
			.parse(
				(await readStorageJson(
					join(this.directory, "inventory-revision.json"),
				)) ?? { revision: 0, writing: false },
			);
		if (revision.writing)
			throw new Error(
				"Storage ownership publication is unfinished; reconcile the interrupted producer before cleanup",
			);
		return revision.revision;
	}
	private async beginInventoryWrite() {
		const revision = await this.inventoryRevision();
		await publishStorageJson(join(this.directory, "inventory-revision.json"), {
			revision: revision + 1,
			writing: true,
		});
		return revision + 1;
	}
	private async finishInventoryWrite(revision: number) {
		await publishStorageJson(join(this.directory, "inventory-revision.json"), {
			revision,
			writing: false,
		});
	}
	async inventoryCount(): Promise<number> {
		return z
			.number()
			.int()
			.nonnegative()
			.parse(
				(await readStorageJson(join(this.directory, "inventory-count.json"))) ??
					0,
			);
	}
	async inventoryPage(offset: number): Promise<string[]> {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset % 100 !== 0)
			throw new Error("Invalid storage inventory cursor");
		return z
			.array(z.string().uuid())
			.max(100)
			.parse(
				(await readStorageJson(
					join(this.directory, "inventory", `${offset / 100}.json`),
				)) ?? [],
			);
	}
	async record(id: string) {
		return StorageRecordSchema.parse(
			await readStorageJson(this.recordPath(id)),
		);
	}
	async revise(id: string, change: (record: StorageRecord) => void) {
		await this.initialize();
		return new OwnedResourceClaim(
			join(this.directory, `record-${id}.lock`),
		).run(async () => {
			const record = await this.record(id);
			if (
				!sameStorageIdentity(
					record.identity,
					await storageIdentity(record.path, record.root),
				)
			)
				throw new Error(
					"Storage identity changed; original ownership is no longer valid",
				);
			change(record);
			StorageRecordSchema.parse(record);
			return new OwnedResourceClaim(join(this.directory, "inventory.lock")).run(
				async () => {
					const revision = await this.beginInventoryWrite();
					await publishStorageJson(this.recordPath(id), record);
					await this.finishInventoryWrite(revision);
					return record;
				},
				true,
			);
		}, true);
	}
	async workspaceResource(path: string) {
		let resource = resolve(path),
			cursor = resource;
		while (true) {
			try {
				resource = join(await realpath(cursor), relative(cursor, resource));
				break;
			} catch (error) {
				if (
					(error as NodeJS.ErrnoException).code !== "ENOENT" ||
					cursor === dirname(cursor)
				)
					throw error;
				cursor = dirname(cursor);
			}
		}
		cursor = resource;
		while (cursor !== dirname(cursor)) {
			const index = (await readStorageJson(
				join(this.directory, "path-records", `${storageDigest(cursor)}.json`),
			)) as { id: string } | undefined;
			if (index) {
				const record = await this.record(index.id);
				if (record.category === "worktree") resource = record.path;
			}
			cursor = dirname(cursor);
		}
		return resource;
	}
	workspaceClaim(path: string) {
		return {
			run: async <T>(work: () => Promise<T>, recover = false): Promise<T> => {
				const resource = await this.workspaceResource(path);
				return new OwnedResourceClaim(
					join(this.directory, `workspace-${storageDigest(resource)}.lock`),
					"workspace",
					0,
				).run(work, recover);
			},
		};
	}
}

export interface StorageWorkspaceUse {
	version: 1;
	owner: string;
	workspace: string;
	state: "reserved" | "retained" | "released";
	updatedAt: string;
	reason: string;
}
/** Publish use under the same canonical claim that cleanup takes. The record
 * remains after process exit; an exited process never implies disposable work. */
export async function reserveStorageWorkspace(
	home: string,
	workspace: string,
	owner: string,
	reason: string,
) {
	const store = new StorageRetentionStore(home);
	await store.initialize();
	return store.workspaceClaim(workspace).run(async () => {
		await storageIdentity(workspace, dirname(resolve(workspace)));
		const use: StorageWorkspaceUse = {
			version: 1,
			owner,
			workspace: resolve(workspace),
			state: "reserved",
			updatedAt: new Date().toISOString(),
			reason,
		};
		await publishStorageJson(
			join(
				store.directory,
				"workspace-use",
				storageDigest(await store.workspaceResource(workspace)),
				`${storageDigest(owner)}.json`,
			),
			use,
		);
	}, true);
}

/** Unregistered roots have no deletion authority. Registered roots must publish
 * use before runnable work, including after preparation selects a new workspace. */
export async function reserveOwnedStorageWorkspace(
	home: string,
	workspace: string,
	owner: string,
	reason: string,
) {
	const store = new StorageRetentionStore(home);
	const resource = await store.workspaceResource(workspace);
	const index = (await readStorageJson(
		join(store.directory, "path-records", `${storageDigest(resource)}.json`),
	)) as { id: string } | undefined;
	if (!index || (await store.record(index.id)).category !== "worktree") return;
	await reserveStorageWorkspace(home, workspace, owner, reason);
}
