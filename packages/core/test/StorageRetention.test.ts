import * as filesystem from "node:fs/promises";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	StoragePolicySchema,
	StorageRetentionStore,
	sameStorageIdentity,
	storageIdentity,
} from "../src/StorageRetention.js";

vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
}));

const homes: string[] = [];
async function fixture() {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "storage-records-")),
	);
	homes.push(home);
	const root = join(home, "updates", "snapshots"),
		path = join(root, "one");
	await mkdir(path, { recursive: true });
	return { home, root, path, store: new StorageRetentionStore(home) };
}
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
describe("storage records", () => {
	it("retains safe defaults and reads policies saved with rollback-snapshot settings", () => {
		expect(StoragePolicySchema.parse({})).toEqual({
			version: 1,
			revision: 0,
			enabled: true,
			intervalHours: 24,
			ages: { migration: 7, worktree: 30 },
			lowDiskBytes: 5 * 1024 ** 3,
		});
		expect(
			StoragePolicySchema.parse({
				snapshotCount: 4,
				ages: { staging: 3, preparation: 3, recovery: 3, worktree: 9 },
			}),
		).toEqual(
			StoragePolicySchema.parse({ ages: { migration: 7, worktree: 9 } }),
		);
		expect(() => StoragePolicySchema.parse({ unknown: 1 })).toThrow();
	});
	it("saves private durable ownership and revision guards across restarts", async () => {
		const { store, home, path, root } = await fixture();
		const record = await store.register({
			path,
			root,
			producer: "test",
			operation: "one",
			category: "snapshot",
			dependencies: [],
			evidence: [],
		});
		const restarted = new StorageRetentionStore(home);
		expect(await restarted.record(record.id)).toEqual(record);
		expect((await stat(store.recordPath(record.id))).mode & 0o777).toBe(0o600);
		expect(await restarted.inventoryPage(0)).toEqual([record.id]);
		const policy = await restarted.policy();
		await restarted.configure({ ...policy, enabled: false }, 0);
		await expect(store.configure(policy, 0)).rejects.toThrow("refresh");
		expect(
			JSON.parse(await readFile(join(store.directory, "policy.json"), "utf8"))
				.enabled,
		).toBe(false);
	});
	it("rejects symlink roots, escapes and replacement identities", async () => {
		const { home, root, path } = await fixture();
		const original = await storageIdentity(path, root);
		await rename(path, `${path}-old`);
		await mkdir(path);
		expect(
			sameStorageIdentity(original, await storageIdentity(path, root)),
		).toBe(false);
		await symlink(root, join(home, "linked"));
		await expect(
			storageIdentity(join(home, "linked", "one"), join(home, "linked")),
		).rejects.toThrow();
		await expect(storageIdentity(home, root)).rejects.toThrow();
	});
});

it("yields bounded integrity verification and resumes the actual manifest stream", async () => {
	const {
		writeStorageIntegrity,
		storageIntegrityVerification,
		verifyStorageIntegrity,
	} = await import("../src/StorageIntegrity.js");
	const { home, path } = await fixture();
	for (let index = 0; index < 160; index++)
		await (await import("node:fs/promises")).writeFile(
			join(path, `${index}.txt`),
			"owned",
		);
	const manifest = join(home, "manifest.ndjson"),
		digest = await writeStorageIntegrity(path, manifest);
	const iterator = storageIntegrityVerification(
		path,
		manifest,
		digest,
		undefined,
		{ maxEntries: 100 },
	);
	let deferred = 0,
		bytes: number | undefined;
	for (;;) {
		const next = await iterator.next({ maxEntries: 100 });
		if (next.done) break;
		expect(next.value.entries).toBeLessThanOrEqual(100);
		if (!next.value.complete) deferred++;
		else bytes = next.value.apparentBytes;
	}
	expect(deferred).toBeGreaterThan(0);
	expect(bytes).toBe(160 * 5);
	await (await import("node:fs/promises")).writeFile(
		join(path, "new-user-file"),
		"unique",
	);
	await expect(verifyStorageIntegrity(path, manifest, digest)).rejects.toThrow(
		"unexpected files",
	);
});

for (const boundary of [
	"records",
	"path-records",
	"inventory",
	"inventory-count.json",
	"finish",
] as const) {
	it(`recovers interrupted registration at ${boundary} without duplicating inventory`, async () => {
		const { store, home, path, root } = await fixture();
		const rename = filesystem.rename;
		let interrupted = false;
		const spy = vi
			.spyOn(filesystem, "rename")
			.mockImplementation(async (source, destination) => {
				const target = String(destination);
				const matches =
					boundary === "finish"
						? target.endsWith("inventory-revision.json") &&
							JSON.parse(await readFile(String(source), "utf8")).writing ===
								false
						: target.includes(`/${boundary}/`) ||
							target.endsWith(`/${boundary}`);
				if (!interrupted && matches) {
					interrupted = true;
					throw new Error("injected publication interruption");
				}
				return rename(source, destination);
			});
		try {
			await expect(
				store.register({
					path,
					root,
					category: "migration",
					producer: "test",
					operation: "interrupted",
					dependencies: ["unreconciled"],
					evidence: [],
				}),
			).rejects.toThrow("injected");
		} finally {
			spy.mockRestore();
		}
		expect(interrupted).toBe(true);
		const restarted = new StorageRetentionStore(home);
		await expect(restarted.inventoryRevision()).rejects.toThrow("unfinished");
		await restarted.recoverPublication();
		await restarted.recoverPublication();
		expect(await restarted.inventoryRevision()).toBe(1);
		expect(await restarted.inventoryCount()).toBe(1);
		const ids = await restarted.inventoryPage(0);
		expect(ids).toHaveLength(1);
		const record = await restarted.record(ids[0]!);
		expect(record.path).toBe(path);
		expect(record.dependencies).toEqual(["unreconciled"]);
		const { storageDigest } = await import("../src/StorageRetention.js");
		expect(
			JSON.parse(
				await readFile(
					join(store.directory, "path-records", `${storageDigest(path)}.json`),
					"utf8",
				),
			),
		).toEqual({ id: record.id, identity: record.identity });
	}, 30_000);
}

it.each([
	"identity",
	"record",
	"index",
	"page",
	"count",
])("preserves the unfinished marker when interrupted publication has conflicting %s", async (conflict) => {
	const { store, path, root } = await fixture();
	const rename = filesystem.rename;
	const spy = vi
		.spyOn(filesystem, "rename")
		.mockImplementation(async (source, destination) => {
			if (
				String(destination).endsWith("inventory-revision.json") &&
				JSON.parse(await readFile(String(source), "utf8")).writing === false
			)
				throw new Error("injected publication interruption");
			return rename(source, destination);
		});
	try {
		await expect(
			store.register({
				path,
				root,
				category: "migration",
				producer: "test",
				operation: "one",
				dependencies: ["unreconciled"],
				evidence: [],
			}),
		).rejects.toThrow("injected");
	} finally {
		spy.mockRestore();
	}
	const { publishStorageJson, storageDigest } = await import(
		"../src/StorageRetention.js"
	);
	if (conflict === "identity") {
		await filesystem.rename(path, `${path}-retained`);
		await mkdir(path);
	}
	if (conflict === "index")
		await publishStorageJson(
			join(store.directory, "path-records", `${storageDigest(path)}.json`),
			{ id: "conflict" },
		);

	if (conflict === "page")
		await publishStorageJson(join(store.directory, "inventory", "0.json"), [
			"10000000-0000-4000-8000-000000000001",
		]);
	if (conflict === "record") {
		const id = (await store.inventoryPage(0))[0]!;
		await publishStorageJson(store.recordPath(id), {
			...(await store.record(id)),
			operation: "foreign change",
		});
	}

	if (conflict === "count")
		await publishStorageJson(join(store.directory, "inventory-count.json"), 8);
	await expect(store.recoverPublication()).rejects.toThrow();
	await expect(store.inventoryRevision()).rejects.toThrow("unfinished");
	expect((await filesystem.stat(path)).isDirectory()).toBe(true);
}, 30_000);

it("recovers an interrupted record revision while preserving its index and count", async () => {
	const { store, home, path, root } = await fixture();
	const record = await store.register({
		path,
		root,
		category: "migration",
		producer: "test",
		operation: "one",
		dependencies: ["pending"],
		evidence: [],
	});
	const rename = filesystem.rename;
	const spy = vi
		.spyOn(filesystem, "rename")
		.mockImplementation(async (source, destination) => {
			if (
				String(destination).endsWith("inventory-revision.json") &&
				JSON.parse(await readFile(String(source), "utf8")).writing === false
			)
				throw new Error("injected revision interruption");
			return rename(source, destination);
		});
	try {
		await expect(
			store.revise(record.id, (value) => {
				value.evidence = ["verified proof"];
			}),
		).rejects.toThrow("injected");
	} finally {
		spy.mockRestore();
	}
	const restarted = new StorageRetentionStore(home);
	await restarted.recoverPublication();
	expect(await restarted.inventoryCount()).toBe(1);
	expect(await restarted.inventoryPage(0)).toEqual([record.id]);
	expect((await restarted.record(record.id)).evidence).toEqual([
		"verified proof",
	]);
	expect((await restarted.record(record.id)).dependencies).toEqual(["pending"]);
	expect(await restarted.inventoryRevision()).toBe(2);
}, 30_000);

describe("re-registering a path whose earlier object was removed", () => {
	async function recreated() {
		const { store, home, root, path } = await fixture();
		const input = {
			path,
			root,
			producer: "test",
			operation: "ATT-1",
			category: "worktree" as const,
			dependencies: [],
			evidence: [],
		};
		const earlier = await store.register(input);
		await rm(path, { recursive: true });
		return { store, home, root, path, input, earlier };
	}
	async function recreate(path: string) {
		// Distinct birth time so the replacement has a different identity.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await mkdir(path);
	}
	it("still blocks without proof that the earlier producer finished", async () => {
		const { store, path, input } = await recreated();
		await recreate(path);
		await expect(store.register(input)).rejects.toThrow("reconcile it");
		await expect(
			store.register(input, { producerFinished: () => false }),
		).rejects.toThrow("reconcile it");
		expect(await store.inventoryCount()).toBe(1);
	});
	it("supersedes the earlier record once its producer finished", async () => {
		const { store, home, root, path, input, earlier } = await recreated();
		await recreate(path);
		expect(await store.hasReplacedRecord(path, root)).toBe(true);
		const next = await store.register(input, {
			producerFinished: (record) => record.id === earlier.id,
		});
		expect(next.id).not.toBe(earlier.id);
		expect(await store.hasReplacedRecord(path, root)).toBe(false);
		expect(await store.inventoryPage(0)).toEqual([earlier.id, next.id]);
		expect(
			JSON.parse(
				await readFile(
					join(store.directory, "receipts", `${earlier.id}.json`),
					"utf8",
				),
			),
		).toMatchObject({ phase: "completed", supersededBy: next.id });
		// The new object now owns the path, so a further registration is real double ownership.
		await expect(
			new StorageRetentionStore(home).register(input, {
				producerFinished: () => true,
			}),
		).rejects.toThrow("reconcile it");
	});
	it("registers over a removed path whose earlier record was already retired", async () => {
		const { store, path, input } = await recreated();
		await recreate(path);
		await store.register(input, { producerFinished: () => true });
		await rm(path, { recursive: true });
		await recreate(path);
		const third = await store.register(input, { producerFinished: () => true });
		expect(await store.inventoryPage(0)).toHaveLength(3);
		expect((await store.record(third.id)).path).toBe(path);
	});
	it("never retires a record whose object is still the one registered", async () => {
		const { store, path, root, input } = await fixture().then(async (f) => {
			const input = {
				path: f.path,
				root: f.root,
				producer: "test",
				operation: "ATT-1",
				category: "worktree" as const,
				dependencies: [],
				evidence: [],
			};
			await f.store.register(input);
			return { ...f, input };
		});
		expect(await store.hasReplacedRecord(path, root)).toBe(false);
		await expect(
			store.register(input, { producerFinished: () => true }),
		).rejects.toThrow("reconcile it");
	});
});
