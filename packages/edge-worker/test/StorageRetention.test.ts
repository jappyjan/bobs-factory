import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	publishStorageJson,
	reconcileStorageCopy,
	StoragePolicySchema,
	writeStorageIntegrity,
} from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { MigrationArtifacts } from "../src/storage/MigrationArtifacts.js";
import {
	evaluateStorageRetention,
	StorageRetention,
} from "../src/storage/StorageRetention.js";

const homes: string[] = [];
const now = Date.parse("2026-10-20T12:00:00Z");
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
async function fixture() {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "storage-coordinator-")),
	);
	homes.push(home);
	const coordinator = new StorageRetention(
		home,
		{ migration: new MigrationArtifacts(home) },
		() => now,
	);
	await coordinator.store.initialize();
	return { home, coordinator };
}
/** A committed migration preparation copy with a verified, identical live replacement. */
async function artifact(coordinator: StorageRetention, index: number) {
	const home = coordinator.home,
		operation = `migration-${index}`,
		backup = join(home, "backups", operation),
		root = join(backup, "staged"),
		path = join(root, "state");
	await mkdir(path, { recursive: true });
	await mkdir(join(home, "state"), { recursive: true });
	await writeFile(join(path, "receipt.json"), "{}");
	await writeFile(join(home, "state", "receipt.json"), "{}");
	await publishStorageJson(join(backup, "journal.json"), {
		phase: "committed",
		sourceDigest: operation,
		destination: home,
	});
	await publishStorageJson(
		join(
			coordinator.store.directory,
			"migration-observations",
			`${operation}.json`,
		),
		{ backup, preparation: root },
	);
	let record = await coordinator.store.register({
		path,
		root,
		category: "migration",
		producer: "applyMigration",
		operation,
		dependencies: ["migration reconciliation incomplete"],
		evidence: [],
		completedAt: "2020-01-01T00:00:00.000Z",
	});
	const integrity = await writeStorageIntegrity(
		path,
		join(coordinator.store.directory, "proofs", `${record.id}.ndjson`),
	);
	await coordinator.store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`];
	});
	record = await reconcileStorageCopy(
		coordinator.store,
		record.id,
		join(home, "state"),
	);
	return record;
}
it("preservation overrides count, age, disabled automation and low disk", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 20);
	const policy = StoragePolicySchema.parse({
		enabled: false,
		lowDiskBytes: Number.MAX_SAFE_INTEGER,
	});
	await coordinator.store.configure(policy, 0);
	const observation = {
		record: { ...record, completedAt: "2020-01-01T00:00:00.000Z" },
		protection: ["Resume needs this path"],
		complete: true,
	};
	expect(evaluateStorageRetention(observation, policy, now).eligible).toBe(
		false,
	);
	const preview = await coordinator.preview();
	expect(preview.volumes[0]?.lowDisk).toBe(true);
	await expect(
		coordinator.execute("00000000-0000-4000-8000-000000000001", [record.id]),
	).rejects.toThrow("refresh");
});
it("retains tampered migration copies and never reports missing measurements as savings", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 1);
	await writeFile(join(record.path, "receipt.json"), '{"changed":true}');
	const preview = await coordinator.preview();
	expect(preview.candidates[0]?.reasons).toContain(
		"Artifact content changed or complete ownership verification is unavailable",
	);
	expect(preview.candidates[0]?.apparentBytes).toBeUndefined();
	expect((await coordinator.status()).outcome).toBeUndefined();
	expect(await readFile(join(record.path, "receipt.json"), "utf8")).toBe(
		'{"changed":true}',
	);
});

it("reconciles interrupted artifact removal without deleting replacement data", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100);
	const adapter = coordinator.adapters.migration!;
	let crash = true;
	const removal = adapter.remove.bind(adapter);
	adapter.remove = async (record, signal, journal) => {
		if (crash) {
			await journal("removing");
			const { unlink } = await import("node:fs/promises");
			await unlink(join(record.path, "receipt.json"));
			crash = false;
			throw new Error("Injected crash after partial removal");
		}
		await removal(record, signal, journal);
	};
	let preview = await coordinator.preview();
	await coordinator.execute(preview.id, [record.id]);
	await expect
		.poll(async () => (await coordinator.status()).outcome?.completedAt)
		.toBeTruthy();
	expect((await coordinator.status()).outcome?.results[0]?.reason).toContain(
		"Injected crash",
	);
	preview = await coordinator.preview();
	expect(
		preview.candidates.find((item) => item.record.id === record.id)?.eligible,
	).toBe(true);
	await coordinator.execute(preview.id, [record.id]);
	await expect
		.poll(async () => (await coordinator.status()).outcome?.completedAt)
		.toBeTruthy();
	expect((await coordinator.status()).outcome?.results[0]?.phase).toBe(
		"completed",
	);
	await mkdir(record.path);
	await writeFile(join(record.path, "replacement-data"), "new unique data");
	preview = await coordinator.preview();
	expect(
		preview.candidates.find((item) => item.record.id === record.id)?.eligible,
	).toBe(false);
	expect(await readFile(join(record.path, "replacement-data"), "utf8")).toBe(
		"new unique data",
	);
});

it("completes fresh multi-slice verification before removing a large artifact", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100);
	await coordinator.store.revise(record.id, (value) => {
		value.dependencies = ["rewriting proofs"];
	});
	for (let index = 0; index < 550; index++) {
		await writeFile(join(record.path, `file-${index}`), "owned");
		await writeFile(join(coordinator.home, "state", `file-${index}`), "owned");
	}
	await rm(join(coordinator.store.directory, "proofs", `${record.id}.ndjson`));
	const integrity = await writeStorageIntegrity(
		record.path,
		join(coordinator.store.directory, "proofs", `${record.id}.ndjson`),
	);
	await coordinator.store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`];
	});
	await reconcileStorageCopy(
		coordinator.store,
		record.id,
		join(coordinator.home, "state"),
	);
	let preview: Awaited<ReturnType<StorageRetention["preview"]>> | undefined;
	for (let index = 0; index < 30; index++) {
		preview = await coordinator.preview();
		if (
			preview.candidates.some(
				(value) => value.record.id === record.id && value.eligible,
			)
		)
			break;
	}
	expect(
		preview!.candidates.find((value) => value.record.id === record.id)
			?.eligible,
	).toBe(true);
	await coordinator.execute(preview!.id, [record.id]);
	await expect
		.poll(async () => (await coordinator.status()).outcome?.completedAt, {
			timeout: 20000,
		})
		.toBeTruthy();
	expect((await coordinator.status()).outcome?.results[0]?.phase).toBe(
		"completed",
	);
	await expect(stat(record.path)).rejects.toMatchObject({ code: "ENOENT" });
	await coordinator.stop();
}, 180000);
it("limits each inventory page to 100 candidates and continues through the retained inventory", async () => {
	const { coordinator, home } = await fixture();
	const root = join(home, "updates", "staging");
	await mkdir(root, { recursive: true });
	for (let index = 0; index < 105; index++) {
		const path = join(root, `bounded-${index}`);
		await mkdir(path);
		await coordinator.store.register({
			path,
			root,
			category: "migration",
			producer: "bounded inventory fixture",
			operation: String(index),
			dependencies: [],
			evidence: [],
			completedAt: "2020-01-01T00:00:00.000Z",
			verifiedAt: "2020-01-01T00:00:00.000Z",
			reconciledAt: "2020-01-01T00:00:00.000Z",
		});
	}
	coordinator.adapters.migration = {
		observe: async (record) => ({
			record,
			complete: true,
			protection: [],
			filesystemEntries: 0,
		}),
		remove: async () => {
			throw new Error("Preview-only fixture");
		},
	};
	const ids = new Set<string>();
	for (let slice = 0; slice < 30; slice++) {
		const preview = await coordinator.preview();
		expect(preview.candidates.length).toBeLessThanOrEqual(100);
		for (const candidate of preview.candidates) ids.add(candidate.record.id);
		if (preview.complete) break;
	}
	expect(ids.size).toBe(105);
	await coordinator.stop();
}, 180000);

it("recovers a crash after root and leaf detachment using the durable leaf receipt", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100);
	const { rename } = await import("node:fs/promises");
	const quarantine = join(record.root, `.bobs-factory-removal-${record.id}`);
	await mkdir(quarantine, { mode: 0o700 });
	await rename(record.path, join(quarantine, "payload"));
	const source = join(quarantine, "payload", "receipt.json"),
		info = await stat(source);
	const slot = "00000000-0000-4000-8000-000000000001";
	await publishStorageJson(join(quarantine, "leaf.json"), {
		source: "receipt.json",
		slot,
		identity: {
			device: String(info.dev),
			inode: String(info.ino),
			birthtime: info.birthtimeMs,
		},
	});
	await rename(source, join(quarantine, slot));
	await publishStorageJson(
		join(coordinator.store.directory, "receipts", `${record.id}.json`),
		{ phase: "removing", identity: record.identity },
	);
	const preview = await coordinator.preview();
	expect(
		preview.candidates.find((value) => value.record.id === record.id)?.eligible,
	).toBe(true);
	await coordinator.execute(preview.id, [record.id]);
	await expect
		.poll(async () => (await coordinator.status()).outcome?.completedAt)
		.toBeTruthy();
	expect((await coordinator.status()).outcome?.results[0]?.phase).toBe(
		"completed",
	);
	await expect(stat(quarantine)).rejects.toMatchObject({ code: "ENOENT" });
	await coordinator.stop();
});

it("resumes a real filesystem inventory after crossing the 1000-entry slice boundary", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100);
	for (let i = 0; i < 1100; i++)
		await writeFile(join(record.path, `entry-${i}`), "bytes");
	const { StorageUsage } = await import("../src/storage/StorageUsage.js");
	const usage = new StorageUsage(coordinator.store.directory);
	try {
		let slice = await usage.step(record, new AbortController().signal);
		expect(slice.complete).toBe(false);
		expect(slice.entries).toBeLessThanOrEqual(1000);
		let total = slice.entries;
		while (!slice.complete) {
			slice = await usage.step(record, new AbortController().signal);
			expect(slice.entries).toBeLessThanOrEqual(1000);
			total += slice.entries;
		}
		expect(total).toBeGreaterThan(1000);
		expect(slice.apparentBytes).toBe(1100 * 5 + 2);
	} finally {
		await usage.close();
		await coordinator.stop();
	}
});

it("covers records that became eligible behind a resumed sweep after a mid-sweep wake-up", async () => {
	const { coordinator } = await fixture();
	const behind = await artifact(coordinator, 100);
	const slow = await artifact(coordinator, 101);
	for (const record of [behind, slow])
		await coordinator.store.revise(record.id, (value) => {
			value.completedAt = "2020-01-01T00:00:00.000Z";
		});
	let behindHeld = true,
		slowObservations = 0;
	let slowEntered!: () => void, releaseSlow!: () => void;
	const entered = new Promise<void>((resolve) => {
			slowEntered = resolve;
		}),
		gate = new Promise<void>((resolve) => {
			releaseSlow = resolve;
		});
	const removed: string[] = [];
	coordinator.adapters.migration = {
		observe: async (record) => {
			if (record.id === slow.id) {
				// The first slice of the later record stays incomplete, so the sweep
				// resumes at it while the earlier record has already been evaluated.
				if (slowObservations++ === 0) {
					slowEntered();
					await gate;
					return { record, complete: false, protection: [] };
				}
				return { record, complete: true, protection: ["pinned"] };
			}
			return {
				record,
				complete: true,
				protection: behindHeld ? ["held"] : [],
				filesystemEntries: 0,
			};
		},
		remove: async (record) => {
			removed.push(record.id);
			await rm(record.path, { recursive: true });
		},
	};
	await coordinator.store.configure(
		{ enabled: true },
		(await coordinator.store.policy()).revision,
	);
	await coordinator.start();
	await entered;
	// The earlier record was evaluated as held; now it becomes disposable and the
	// producer wakes the coordinator while the sweep is still in progress.
	behindHeld = false;
	coordinator.requestReconciliation();
	releaseSlow();
	await expect.poll(() => removed, { timeout: 10000 }).toEqual([behind.id]);
	await coordinator.stop();
});
