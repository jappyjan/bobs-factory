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
	record = await coordinator.store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`];
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
