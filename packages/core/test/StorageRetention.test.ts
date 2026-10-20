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
import { afterEach, describe, expect, it } from "vitest";
import {
	StoragePolicySchema,
	StorageRetentionStore,
	sameStorageIdentity,
	storageIdentity,
} from "../src/StorageRetention.js";

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
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
describe("storage records", () => {
	it("retains safe defaults and rejects a policy with no rollback", () => {
		expect(StoragePolicySchema.parse({})).toEqual({
			version: 1,
			revision: 0,
			enabled: true,
			intervalHours: 24,
			snapshotCount: 2,
			ages: {
				staging: 7,
				preparation: 7,
				recovery: 7,
				migration: 7,
				worktree: 30,
			},
			lowDiskBytes: 5 * 1024 ** 3,
		});
		expect(() => StoragePolicySchema.parse({ snapshotCount: 0 })).toThrow();
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
