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

export const StorageCategorySchema = z.enum(["migration", "worktree"]);
export type StorageCategory = z.infer<typeof StorageCategorySchema>;
/** Written by the copy-based updater and never produced any more. Records still
 * load so the one-time cleanup can drop them; nothing else may act on them. */
export const LegacyStorageCategorySchema = z.enum([
	"snapshot",
	"staging",
	"preparation",
	"recovery",
]);
export type LegacyStorageCategory = z.infer<typeof LegacyStorageCategorySchema>;
const days = z.number().int().min(1).max(36500);
const StoragePolicyObjectSchema = z
	.object({
		version: z.literal(1).default(1),
		revision: z.number().int().nonnegative().default(0),
		enabled: z.boolean().default(true),
		intervalHours: z.number().int().min(1).max(168).default(24),
		ages: z
			.object({
				migration: days.default(7),
				worktree: days.default(30),
			})
			.default({ migration: 7, worktree: 30 }),
		lowDiskBytes: z
			.number()
			.int()
			.min(0)
			.max(Number.MAX_SAFE_INTEGER)
			.default(5 * 1024 ** 3),
	})
	.strict();
/** Policies saved by the copy-based updater carry rollback-snapshot settings; read and drop them. */
export const StoragePolicySchema = z.preprocess((value) => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const { snapshotCount: _snapshots, ...policy } = value as Record<
		string,
		unknown
	>;
	if (
		policy.ages &&
		typeof policy.ages === "object" &&
		!Array.isArray(policy.ages)
	) {
		const {
			staging: _staging,
			preparation: _preparation,
			recovery: _recovery,
			...ages
		} = policy.ages as Record<string, unknown>;
		policy.ages = ages;
	}
	return policy;
}, StoragePolicyObjectSchema);
export type StoragePolicy = z.infer<typeof StoragePolicyObjectSchema>;
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
		category: z.union([StorageCategorySchema, LegacyStorageCategorySchema]),
		/** Copy-updater fields: loaded for old records, never written. */
		rollback: z.unknown().optional(),
		path: z.string(),
		root: z.string(),
		identity: StorageIdentitySchema,
		producer: z.string().min(1).max(200),
		operation: z.string().min(1).max(200),
		registeredAt: z.string().datetime(),
		completedAt: z.string().datetime().optional(),
		verifiedAt: z.string().datetime().optional(),
		reconciledAt: z.string().datetime().optional(),
		replacement: z.unknown().optional(),
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
		historicalElection: z.unknown().optional(),
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
const InventoryPublicationSchema = z
	.object({
		record: StorageRecordSchema,
		previousRecord: StorageRecordSchema.optional(),
		registration: z
			.object({
				count: z.number().int().nonnegative(),
				page: z.array(z.string().uuid()).max(99),
				previousIndex: z
					.object({ id: z.string().uuid(), identity: StorageIdentitySchema })
					.optional(),
			})
			.optional(),
	})
	.strict();
type InventoryPublication = z.infer<typeof InventoryPublicationSchema>;
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
				await this.recoverInventoryWrite();
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
				const revision = await this.beginInventoryWrite({
					record,
					registration: { count, page, previousIndex: existing },
				});
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
	private async beginInventoryWrite(publication: InventoryPublication) {
		const revision = await this.inventoryRevision();
		await publishStorageJson(join(this.directory, "inventory-revision.json"), {
			revision: revision + 1,
			writing: true,
			publication: InventoryPublicationSchema.parse(publication),
		});
		return revision + 1;
	}
	private async finishInventoryWrite(revision: number) {
		await publishStorageJson(join(this.directory, "inventory-revision.json"), {
			revision,
			writing: false,
		});
	}
	/** Only the producer retries publication; readers continue to fail closed. */
	async recoverPublication() {
		await this.initialize();
		return new OwnedResourceClaim(join(this.directory, "inventory.lock")).run(
			() => this.recoverInventoryWrite(),
			true,
		);
	}
	private async recoverInventoryWrite() {
		const state = (await readStorageJson(
			join(this.directory, "inventory-revision.json"),
		)) as
			| { revision: number; writing: boolean; publication?: unknown }
			| undefined;
		if (!state?.writing) return;
		z.number().int().positive().parse(state.revision);
		if (!state.publication)
			throw new Error(
				"Interrupted storage publication has no saved intent; independent reconciliation is required",
			);
		const intent = InventoryPublicationSchema.parse(state.publication);
		const { record, previousRecord, registration } = intent;
		if (
			!sameStorageIdentity(
				record.identity,
				await storageIdentity(record.path, record.root),
			)
		)
			throw new Error(
				"Interrupted storage publication identity changed; refusing recovery",
			);
		const writes: { path: string; before: unknown; after: unknown }[] = [
			{
				path: this.recordPath(record.id),
				before: previousRecord,
				after: record,
			},
		];
		if (registration) {
			const { count, page, previousIndex } = registration;
			if (
				previousRecord ||
				page.length !== count % 100 ||
				page.includes(record.id)
			)
				throw new Error("Interrupted storage inventory intent is inconsistent");
			writes.push(
				{
					path: join(
						this.directory,
						"path-records",
						`${storageDigest(record.path)}.json`,
					),
					before: previousIndex,
					after: { id: record.id, identity: record.identity },
				},
				{
					path: join(
						this.directory,
						"inventory",
						`${Math.floor(count / 100)}.json`,
					),
					before: page,
					after: [...page, record.id],
				},
				{
					path: join(this.directory, "inventory-count.json"),
					before: count,
					after: count + 1,
				},
			);
		} else {
			if (
				!previousRecord ||
				previousRecord.id !== record.id ||
				previousRecord.path !== record.path ||
				previousRecord.root !== record.root ||
				!sameStorageIdentity(previousRecord.identity, record.identity)
			)
				throw new Error("Interrupted storage revision intent is inconsistent");
			const index = await readStorageJson(
				join(
					this.directory,
					"path-records",
					`${storageDigest(record.path)}.json`,
				),
			);
			if (
				JSON.stringify(index) !==
				JSON.stringify({ id: record.id, identity: record.identity })
			)
				throw new Error("Interrupted storage revision path index changed");
		}
		const count = await this.inventoryCount();
		const expectedCount = registration?.count ?? count;
		const seen = new Set<string>();
		for (let offset = 0; offset < expectedCount; offset += 100) {
			const page = await this.inventoryPage(offset);
			const expectedLength = Math.min(100, expectedCount - offset);
			const lastRegistrationPage =
				registration && Math.floor(expectedCount / 100) === offset / 100;
			const ids =
				lastRegistrationPage && page.at(-1) === record.id
					? page.slice(0, -1)
					: page;
			if (ids.length !== expectedLength)
				throw new Error("Interrupted storage inventory page count changed");
			for (const id of ids) {
				if (seen.has(id))
					throw new Error(
						"Interrupted storage inventory contains duplicate ownership",
					);
				seen.add(id);
			}
		}
		if (registration ? seen.has(record.id) : !seen.has(record.id))
			throw new Error(
				"Interrupted storage inventory record association changed",
			);
		// Validate every file before repairing any of them. A conflict preserves the marker.
		for (const write of writes) {
			let current = await readStorageJson(write.path);
			if (current === undefined && write.path.includes("/inventory/"))
				current = [];
			if (current === undefined && write.path.endsWith("/inventory-count.json"))
				current = 0;
			if (
				JSON.stringify(current) !== JSON.stringify(write.before) &&
				JSON.stringify(current) !== JSON.stringify(write.after)
			)
				throw new Error(
					"Interrupted storage publication conflicts with retained inventory",
				);
		}
		for (const write of writes)
			await publishStorageJson(write.path, write.after);
		await this.finishInventoryWrite(state.revision);
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
			await this.recoverPublication();
			const record = await this.record(id);
			const previousRecord = structuredClone(record);
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
					await this.recoverInventoryWrite();
					const revision = await this.beginInventoryWrite({
						record,
						previousRecord,
					});
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
