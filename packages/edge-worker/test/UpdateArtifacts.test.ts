import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	StorageRetentionStore,
	writeStorageIntegrity,
} from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { HistoricalStorage } from "../src/storage/HistoricalStorage.js";
import { UpdateArtifacts } from "../src/storage/UpdateArtifacts.js";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
async function fixture() {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "retention-updates-")),
	);
	homes.push(home);
	const root = join(home, "updates", "staging"),
		path = join(root, "historical");
	await mkdir(path, { recursive: true });
	await writeFile(join(path, "unique"), "preserved data");
	const store = new StorageRetentionStore(home);
	await store.initialize();
	return { home, path, root, store, historical: new HistoricalStorage(store) };
}
it("never infers ownership from historical directory names or enrolls arbitrary external paths", async () => {
	const { path, historical } = await fixture();
	const preview = await historical.preview(),
		candidate = preview.candidates[0]!;
	await expect(
		historical.classify({
			previewId: preview.id,
			candidateId: candidate.id,
			category: candidate.category,
			operation: "unknown",
			contentsVerifiedDisposable: true,
		}),
	).rejects.toThrow("No completed");
	expect(await readFile(join(path, "unique"), "utf8")).toBe("preserved data");
	await historical.close();
});
it("binds the classification election to the actual filesystem identity", async () => {
	const { path, historical } = await fixture();
	const preview = await historical.preview(),
		candidate = preview.candidates[0]!;
	await rename(path, `${path}-original`);
	await mkdir(path);
	await expect(
		historical.classify({
			previewId: preview.id,
			candidateId: candidate.id,
			category: candidate.category,
			operation: "transaction",
			contentsVerifiedDisposable: true,
		}),
	).rejects.toThrow("identity changed");
	expect(await readFile(join(`${path}-original`, "unique"), "utf8")).toBe(
		"preserved data",
	);
	await historical.close();
});
it("preserves malformed producer state and content added after ownership verification", async () => {
	const { home, path, root, store } = await fixture();
	const record = await store.register({
		category: "staging",
		path,
		root,
		producer: "fixture",
		operation: "transaction",
		dependencies: [],
		evidence: [],
		completedAt: "2020-01-01T00:00:00.000Z",
		verifiedAt: "2020-01-01T00:00:00.000Z",
		reconciledAt: "2020-01-01T00:00:00.000Z",
	});
	const integrity = await writeStorageIntegrity(
		path,
		join(store.directory, "proofs", `${record.id}.ndjson`),
	);
	const verified = await store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`];
	});
	await writeFile(join(home, "updates", "state.json"), "{broken");
	await writeFile(join(path, "new-user-data"), "unique");
	const checked = await new UpdateArtifacts(home).observe(
		verified,
		new AbortController().signal,
	);
	expect(checked.protection).toEqual(
		expect.arrayContaining([
			"Cannot verify updates/state.json; inspect update/recovery state",
			"Artifact content changed or complete ownership verification is unavailable",
		]),
	);
	expect(await readFile(join(path, "new-user-data"), "utf8")).toBe("unique");
});

it("classifies a proven historical directory only after exact explicit election", async () => {
	const { home, path, store, historical } = await fixture();
	const operation = "completed-fixture",
		candidate = {
			version: "1.0.1",
			commit: "b".repeat(40),
			channel: "stable",
			target: "linux-x64",
			manifestSha256: "b".repeat(64),
			publishedAt: "2026-10-01T00:00:00.000Z",
		};
	await mkdir(join(home, "updates", "history"), { recursive: true });
	await writeFile(
		join(home, "updates", "history", `${operation}.json`),
		JSON.stringify({
			id: operation,
			candidate,
			staged: {
				candidate,
				executable: join(path, "bobs-factory"),
				previousExecutable: join(home, "previous"),
			},
			previous: {
				version: "1.0.0",
				commit: "a".repeat(40),
				target: "linux-x64",
			},
			revision: 0,
			phase: "succeeded",
			switchStarted: true,
			startedAt: "2026-10-01T00:00:00.000Z",
			release: {
				transactionId: operation,
				outcome: "succeeded",
				status: "acknowledged",
			},
		}),
	);
	const preview = await historical.preview(),
		directory = preview.candidates[0]!;
	const classified = await historical.classify({
		previewId: preview.id,
		candidateId: directory.id,
		category: "staging",
		operation,
		contentsVerifiedDisposable: true,
	});
	expect((await store.record(classified.id)).historicalElection?.preview).toBe(
		preview.id,
	);
	expect(classified.verifiedAt).toBeTruthy();
	expect(
		(
			await new UpdateArtifacts(home).observe(
				classified,
				new AbortController().signal,
			)
		).protection,
	).toEqual([]);
	await historical.close();
});
