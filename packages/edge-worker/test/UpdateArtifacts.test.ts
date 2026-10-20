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

it("preserves a replacement installed during journal publication", async () => {
	const { home, path, root, store } = await fixture();
	let record = await store.register({
		category: "staging",
		path,
		root,
		producer: "fixture",
		operation: "race",
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
	record = await store.revise(record.id, (value) => {
		value.evidence = [`integrity:${integrity}`];
	});
	await expect(
		new UpdateArtifacts(home).remove(
			record,
			new AbortController().signal,
			async () => {
				await rename(path, `${path}-original`);
				await mkdir(path);
				await writeFile(join(path, "replacement"), "unique replacement");
			},
		),
	).rejects.toThrow("identity changed");
	expect(await readFile(join(path, "replacement"), "utf8")).toBe(
		"unique replacement",
	);
	expect(await readFile(join(`${path}-original`, "unique"), "utf8")).toBe(
		"preserved data",
	);
});

it.each([
	"preparation",
	"recovery",
] as const)("elects only an exact authoritative historical %s copy", async (category) => {
	const { home, historical } = await fixture();
	const root = join(
			home,
			"updates",
			category === "recovery" ? "recovery-retained" : "preparation",
		),
		path = join(root, "legacy-copy");
	await mkdir(join(path, "state"), { recursive: true });
	await mkdir(join(home, "state"));
	await writeFile(join(path, "state", "saved.json"), '{"retained":true}');
	await writeFile(join(home, "state", "saved.json"), '{"retained":true}');
	const preview = await historical.preview(),
		candidate = preview.candidates.find((value) => value.path === path)!;
	const elected = await historical.classify({
		previewId: preview.id,
		candidateId: candidate.id,
		category,
		operation: "manual-copy",
		contentsVerifiedDisposable: true,
	});
	expect(elected.dependencies).toEqual([]);
	expect(elected.authoritativeReplacement?.path).toBe(home);
	const adapter = new UpdateArtifacts(home);
	let observation: Awaited<ReturnType<UpdateArtifacts["observe"]>>;
	do {
		observation = await adapter.observe(elected, new AbortController().signal);
	} while (!observation.complete);
	expect(observation.protection).toEqual([]);
	await adapter.remove(elected, new AbortController().signal, async () => {});
	expect(await readFile(join(home, "state", "saved.json"), "utf8")).toBe(
		'{"retained":true}',
	);
	await historical.close();
});

it("preserves mixed and unique historical recovery contents after election fails", async () => {
	const { home, historical, store } = await fixture();
	const root = join(home, "updates", "recovery-retained"),
		path = join(root, "mixed");
	await mkdir(join(path, "factory", "auth"), { recursive: true });
	await mkdir(join(home, "factory", "auth"), { recursive: true });
	for (const base of [path, home])
		await writeFile(
			join(base, "factory", "auth", "key"),
			"credential sentinel",
		);
	const preview = await historical.preview(),
		candidate = preview.candidates.find((value) => value.path === path)!;
	await expect(
		historical.classify({
			previewId: preview.id,
			candidateId: candidate.id,
			category: "recovery",
			operation: "manual-copy",
			contentsVerifiedDisposable: true,
		}),
	).rejects.toThrow("Mixed");
	const record = await store.record((await store.inventoryPage(0))[0]!);
	expect(record.dependencies.length).toBeGreaterThan(0);
	expect(record.reconciledAt).toBeUndefined();
	expect(await readFile(join(path, "factory", "auth", "key"), "utf8")).toBe(
		"credential sentinel",
	);
	await historical.close();
});

it("discovers and elects narrow committed migration preparation while preserving source and native backups", async () => {
	const { home, store, historical } = await fixture();
	const backup = join(home, "migration-backup"),
		preparation = join(backup, "staged"),
		path = join(preparation, "state"),
		operation = "a".repeat(64);
	await mkdir(path, { recursive: true });
	await mkdir(join(home, "state"));
	await mkdir(join(backup, "source"));
	await writeFile(join(backup, "source", "native"), "native source sentinel");
	await writeFile(join(path, "run.json"), '{"saved":true}');
	await writeFile(join(home, "state", "run.json"), '{"saved":true}');
	await writeFile(
		join(backup, "journal.json"),
		JSON.stringify({
			phase: "committed",
			sourceDigest: operation,
			destination: home,
		}),
	);
	const { publishStorageJson } = await import("bobs-factory-core");
	await publishStorageJson(
		join(store.directory, "migration-observations", `${operation}.json`),
		{ operation, preparation, backup, protected: true },
	);
	const preview = await historical.preview(),
		candidate = preview.candidates.find((value) => value.path === path)!;
	expect(candidate.category).toBe("migration");
	const elected = await historical.classify({
		previewId: preview.id,
		candidateId: candidate.id,
		category: "migration",
		operation,
		contentsVerifiedDisposable: true,
	});
	const adapter = new UpdateArtifacts(home);
	let observation: Awaited<ReturnType<UpdateArtifacts["observe"]>>;
	do {
		observation = await adapter.observe(elected, new AbortController().signal);
	} while (!observation.complete);
	expect(observation.protection).toEqual([]);
	await adapter.remove(elected, new AbortController().signal, async () => {});
	expect(await readFile(join(backup, "source", "native"), "utf8")).toBe(
		"native source sentinel",
	);
	expect(await readFile(join(home, "state", "run.json"), "utf8")).toBe(
		'{"saved":true}',
	);
	await historical.close();
});
