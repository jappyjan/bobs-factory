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
	StoragePolicySchema,
	type StorageRecord,
	writeStorageIntegrity,
	writeStorageRollbackProof,
} from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import {
	evaluateStorageRetention,
	StorageRetention,
} from "../src/storage/StorageRetention.js";
import { UpdateArtifacts } from "../src/storage/UpdateArtifacts.js";

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
	const updates = new UpdateArtifacts(home);
	const coordinator = new StorageRetention(
		home,
		{ snapshot: updates, staging: updates },
		() => now,
	);
	await coordinator.store.initialize();
	return { home, coordinator };
}
async function artifact(
	coordinator: StorageRetention,
	index: number,
	category: "snapshot" | "staging" = "snapshot",
) {
	const root = join(
			coordinator.home,
			"updates",
			category === "snapshot" ? "snapshots" : "staging",
		),
		path = join(root, String(index));
	await mkdir(path, { recursive: true });
	await writeFile(join(path, "lifecycle-receipt.json"), "{}");
	let record = await coordinator.store.register({
		path,
		root,
		category,
		rollback: category === "snapshot" ? "usable" : undefined,
		producer: "fixture",
		operation: String(index),
		dependencies: [],
		evidence: [],
		completedAt: new Date(now - index * 1000).toISOString(),
		verifiedAt: new Date(now - index * 1000).toISOString(),
		reconciledAt: new Date(now - index * 1000).toISOString(),
	});
	const integrity = await writeStorageIntegrity(
		path,
		join(coordinator.store.directory, "proofs", `${record.id}.ndjson`),
	);
	const runtime = join(coordinator.home, "installed", String(index));
	await mkdir(runtime, { recursive: true });
	await writeFile(join(runtime, "bobs-factory"), "verified rollback runtime", {
		mode: 0o755,
	});
	const runtimeProof = await writeStorageRollbackProof(
		coordinator.home,
		record.id,
		join(runtime, "bobs-factory"),
	);
	record = await coordinator.store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`, runtimeProof];
	});
	return record;
}
async function allCandidates(coordinator: StorageRetention) {
	const candidates: Awaited<
		ReturnType<StorageRetention["preview"]>
	>["candidates"] = [];
	for (let slice = 0; slice < 30; slice++) {
		const preview = await coordinator.preview();
		candidates.push(...preview.candidates);
		if (preview.complete) return candidates;
	}
	throw new Error("Fixture scan did not finish");
}
it("protects the newest two verified rollbacks across five update and restart cycles", async () => {
	const { coordinator } = await fixture();
	const records: StorageRecord[] = [];
	for (let index = 5; index >= 1; index--) {
		records.push(await artifact(coordinator, index));
		const restarted = new StorageRetention(
			coordinator.home,
			coordinator.adapters,
			() => now,
		);
		const candidates = await allCandidates(restarted);
		const protectedIds = candidates
			.filter((candidate) =>
				candidate.reasons.includes("Protected verified rollback snapshot"),
			)
			.map((candidate) => candidate.record.id);
		expect(protectedIds.length).toBe(Math.min(records.length, 2));
		const eligible = candidates.filter((candidate) => candidate.eligible);
		expect(eligible.length).toBe(Math.max(0, records.length - 2));
	}
	const indexPath = join(coordinator.store.directory, "rollback-index.json");
	const savedIndex = JSON.parse(await readFile(indexPath, "utf8"));
	savedIndex.index.newest = [
		{ id: records[0]!.id, completedAt: records[0]!.completedAt },
	];
	await writeFile(indexPath, JSON.stringify(savedIndex));
	const afterCorruption = await allCandidates(coordinator);
	expect(
		afterCorruption
			.filter((candidate) =>
				candidate.reasons.includes("Protected verified rollback snapshot"),
			)
			.map((candidate) => candidate.record.id)
			.sort(),
	).toEqual(
		records
			.slice(-2)
			.map((record) => record.id)
			.sort(),
	);
	const phases: string[] = [];
	for (let slice = 0; slice < 30; slice++) {
		const preview = await coordinator.preview();
		const selected = preview.candidates
			.filter((candidate) => candidate.eligible)
			.map((candidate) => candidate.record.id);
		if (selected.length) {
			await coordinator.execute(preview.id, selected);
			await expect
				.poll(async () => (await coordinator.status()).outcome?.completedAt)
				.toBeTruthy();
			phases.push(
				...(await coordinator.status()).outcome!.results.map(
					(result) => result.phase,
				),
			);
		}
		if (preview.complete) break;
	}
	expect(phases).toEqual(["completed", "completed", "completed"]);
	for (const candidate of await allCandidates(coordinator))
		if (!candidate.eligible && candidate.record.category === "snapshot")
			expect((await stat(candidate.record.path)).isDirectory()).toBe(true);
});
it("preservation overrides count, age, disabled automation and low disk", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 20, "staging");
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
	expect(
		evaluateStorageRetention(observation, policy, new Set(), now).eligible,
	).toBe(false);
	const preview = await coordinator.preview();
	expect(preview.volumes[0]?.lowDisk).toBe(true);
	await expect(
		coordinator.execute("00000000-0000-4000-8000-000000000001", [record.id]),
	).rejects.toThrow("refresh");
});
it("retains tampered rollback files and never reports missing measurements as savings", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 1);
	await writeFile(
		join(record.path, "lifecycle-receipt.json"),
		'{"changed":true}',
	);
	const preview = await coordinator.preview();
	expect(preview.candidates[0]?.reasons).toContain(
		"Rollback verification failed",
	);
	expect(preview.candidates[0]?.apparentBytes).toBeUndefined();
	expect((await coordinator.status()).outcome).toBeUndefined();
	expect(
		await readFile(join(record.path, "lifecycle-receipt.json"), "utf8"),
	).toBe('{"changed":true}');
});

it("reconciles interrupted artifact removal without deleting replacement data", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100, "staging");
	await coordinator.store.revise(record.id, (value) => {
		value.completedAt = "2020-01-01T00:00:00.000Z";
	});
	const adapter = coordinator.adapters.staging!;
	let crash = true;
	const removal = adapter.remove.bind(adapter);
	adapter.remove = async (record, signal, journal) => {
		if (crash) {
			await journal("removing");
			const { unlink } = await import("node:fs/promises");
			await unlink(join(record.path, "lifecycle-receipt.json"));
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
	let record = await artifact(coordinator, 100, "staging");
	for (let index = 0; index < 550; index++)
		await writeFile(join(record.path, `file-${index}`), "owned");
	const integrity = await writeStorageIntegrity(
		record.path,
		join(coordinator.store.directory, "proofs", `${record.id}.ndjson`),
	);
	record = await coordinator.store.revise(record.id, (value) => {
		value.completedAt = "2020-01-01T00:00:00.000Z";
		value.evidence = [`integrity:${integrity}`];
	});
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
it.each([
	"missing",
	"replaced",
	"corrupt",
])("does not count a %s rollback runtime", async (failure) => {
	const { coordinator, home } = await fixture();
	const older = await artifact(coordinator, 10);
	await artifact(coordinator, 2);
	await artifact(coordinator, 1);
	const path = join(home, "installed", "1", "bobs-factory");
	if (failure === "missing") await rm(path);
	else if (failure === "replaced") {
		await rm(join(home, "installed", "1"), { recursive: true });
		await mkdir(join(home, "installed", "1"));
		await writeFile(path, "verified rollback runtime", { mode: 0o755 });
	} else await writeFile(path, "corrupt runtime");
	const candidates = await allCandidates(coordinator);
	expect(
		candidates.find((value) => value.record.id === older.id)?.reasons,
	).toContain("Protected verified rollback snapshot");
	expect(
		candidates.find((value) => value.record.operation === "1")
			?.rollbackVerified,
	).toBe(false);
	await coordinator.stop();
});

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
			category: "staging",
			producer: "bounded inventory fixture",
			operation: String(index),
			dependencies: [],
			evidence: [],
			completedAt: "2020-01-01T00:00:00.000Z",
			verifiedAt: "2020-01-01T00:00:00.000Z",
			reconciledAt: "2020-01-01T00:00:00.000Z",
		});
	}
	coordinator.adapters.staging = {
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
	const record = await artifact(coordinator, 100, "staging");
	await coordinator.store.revise(record.id, (value) => {
		value.completedAt = "2020-01-01T00:00:00.000Z";
	});
	const { rename } = await import("node:fs/promises");
	const { publishStorageJson } = await import("bobs-factory-core");
	const quarantine = join(record.root, `.bobs-factory-removal-${record.id}`);
	await mkdir(quarantine, { mode: 0o700 });
	await rename(record.path, join(quarantine, "payload"));
	const source = join(quarantine, "payload", "lifecycle-receipt.json"),
		info = await stat(source);
	const slot = "00000000-0000-4000-8000-000000000001";
	await publishStorageJson(join(quarantine, "leaf.json"), {
		source: "lifecycle-receipt.json",
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

it("does not certify a rollback with unresolved runtime link dependencies", async () => {
	const { coordinator, home } = await fixture();
	const older = await artifact(coordinator, 10),
		newer = await artifact(coordinator, 1);
	const { symlink } = await import("node:fs/promises");
	const dependency = join(home, "external-runtime-data");
	await writeFile(dependency, "restoration dependency");
	await symlink(dependency, join(home, "installed", "1", "dependency"));
	const proof = await writeStorageRollbackProof(
		home,
		newer.id,
		join(home, "installed", "1", "bobs-factory"),
	);
	await coordinator.store.revise(newer.id, (value) => {
		value.evidence = [
			...value.evidence.filter((entry) => !entry.startsWith("runtime-proof:")),
			proof,
		];
	});
	await rm(dependency);
	const candidates = await allCandidates(coordinator);
	expect(
		candidates.find((value) => value.record.id === newer.id)?.rollbackVerified,
	).toBe(false);
	expect(
		candidates.find((value) => value.record.id === older.id)?.reasons,
	).toContain("Protected verified rollback snapshot");
	await coordinator.stop();
});

it("resumes a real filesystem inventory after crossing the 1000-entry slice boundary", async () => {
	const { coordinator } = await fixture();
	const record = await artifact(coordinator, 100, "staging");
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
