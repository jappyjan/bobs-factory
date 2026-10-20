import { randomUUID } from "node:crypto";
import { opendir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
	publishStorageJson,
	readStorageJson,
	type StorageCategory,
	type StorageIdentity,
	type StorageRetentionStore,
	sameStorageIdentity,
	storageDigest,
	storageIdentity,
	verifyStorageIntegrity,
	writeStorageIntegrity,
} from "bobs-factory-core";
import { UpdateTransactionSchema } from "../updates/UpdateManager.js";

interface HistoricalCandidate {
	id: string;
	path: string;
	root: string;
	category: StorageCategory;
	identity: StorageIdentity;
	ownershipEvidence: string;
	reconciliationProof: string;
	dependencies: string[];
}
export interface HistoricalPreview {
	id: string;
	candidates: HistoricalCandidate[];
	complete: boolean;
	at: string;
}
/** Historical names discover candidates only. An exact operator election and an
 * independently retained producer transaction must both establish ownership. */
export class HistoricalStorage {
	private root = 0;
	private iterator?: Awaited<ReturnType<typeof opendir>>;
	constructor(private readonly store: StorageRetentionStore) {}
	async preview(): Promise<HistoricalPreview> {
		await this.store.initialize();
		const home = this.store.home;
		const roots: [string, StorageCategory][] = [
			[join(home, "updates", "snapshots"), "snapshot"],
			[join(home, "updates", "staging"), "staging"],
			[join(home, "updates", "preparation"), "preparation"],
			[join(home, "updates", "recovery-retained"), "recovery"],
		];
		const preview: HistoricalPreview = {
			id: randomUUID(),
			candidates: [],
			complete: false,
			at: new Date().toISOString(),
		};
		let entries = 0;
		const started = performance.now();
		while (
			this.root < roots.length &&
			preview.candidates.length < 100 &&
			entries < 1000 &&
			performance.now() - started < 1000
		) {
			const [root, category] = roots[this.root]!;
			try {
				this.iterator ??= await opendir(root);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				this.root++;
				continue;
			}
			const entry = await this.iterator.read();
			entries++;
			if (!entry) {
				await this.iterator.close();
				this.iterator = undefined;
				this.root++;
				continue;
			}
			if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
			const path = join(root, entry.name);
			if (
				await readStorageJson(
					join(
						this.store.directory,
						"path-records",
						`${storageDigest(resolve(path))}.json`,
					),
				)
			)
				continue;
			const identity = await storageIdentity(path, root);
			preview.candidates.push({
				id: storageDigest({ path, identity }),
				path,
				root,
				category,
				identity,
				ownershipEvidence:
					"Directory name alone is insufficient. Supply the exact retained update transaction when classifying.",
				reconciliationProof:
					"Must verify a completed, acknowledged producer transaction",
				dependencies: [
					"Fresh update, rollback and executable references will be rechecked",
				],
			});
		}
		preview.complete = this.root === roots.length;
		if (preview.complete) this.root = 0;
		await publishStorageJson(
			join(this.store.directory, "historical-preview.json"),
			preview,
		);
		return preview;
	}
	async classify(input: {
		previewId: string;
		candidateId: string;
		category: StorageCategory;
		operation: string;
		contentsVerifiedDisposable: true;
	}) {
		const preview = (await readStorageJson(
			join(this.store.directory, "historical-preview.json"),
		)) as HistoricalPreview | undefined;
		const candidate = preview?.candidates.find(
			(item) => item.id === input.candidateId,
		);
		if (!preview || preview.id !== input.previewId || !candidate)
			throw new Error("Historical preview changed; refresh before classifying");
		if (
			input.category !== candidate.category ||
			!input.contentsVerifiedDisposable
		)
			throw new Error(
				"Elect the previewed category and verify the exact directory contents",
			);
		if (!/^[\w-]{1,100}$/.test(input.operation))
			throw new Error("Use a retained producer transaction ID");
		return this.store.workspaceClaim(candidate.path).run(async () => {
			if (
				!sameStorageIdentity(
					candidate.identity,
					await storageIdentity(candidate.path, candidate.root),
				)
			)
				throw new Error(
					"Historical directory identity changed; refresh preview",
				);
			const state = (await readStorageJson(
				join(this.store.home, "updates", "state.json"),
			)) as { transaction?: Record<string, any> } | undefined;
			const transaction =
				state?.transaction?.id === input.operation
					? state.transaction
					: ((await readStorageJson(
							join(
								this.store.home,
								"updates",
								"history",
								`${input.operation}.json`,
							),
						)) as Record<string, any> | undefined);
			if (
				!transaction ||
				transaction.id !== input.operation ||
				!["succeeded", "rolled-back", "cancelled"].includes(
					transaction.phase,
				) ||
				transaction.release?.status !== "acknowledged"
			)
				throw new Error(
					"No completed, acknowledged update transaction proves ownership. Keep the directory and reconcile its producer first",
				);
			UpdateTransactionSchema.parse(transaction);
			const executable = transaction.staged?.executable;
			const suffix =
				typeof executable === "string"
					? relative(candidate.path, executable)
					: "..";
			const owns =
				candidate.category === "snapshot"
					? transaction.snapshot === candidate.path
					: candidate.category === "staging"
						? suffix !== ".." &&
							!suffix.startsWith(`..${sep}`) &&
							!suffix.startsWith("/")
						: false;
			if (!owns)
				throw new Error(
					"The producer transaction does not prove disposable Bob-owned content at this exact directory. Migration/native/external backups remain protected",
				);
			const registered = await this.store.register({
				path: candidate.path,
				root: candidate.root,
				category: candidate.category,
				rollback: candidate.category === "snapshot" ? "disposable" : undefined,
				producer: "Historical operator election with retained update proof",
				operation: input.operation,
				dependencies: [],
				evidence: [],
				completedAt: new Date().toISOString(),
				reconciledAt: new Date().toISOString(),
				historicalElection: {
					preview: preview.id,
					at: new Date().toISOString(),
				},
			});
			const manifest = join(
				this.store.directory,
				"proofs",
				`${registered.id}.ndjson`,
			);
			const integrity = await writeStorageIntegrity(candidate.path, manifest);
			await verifyStorageIntegrity(candidate.path, manifest, integrity);
			return this.store.revise(registered.id, (record) => {
				record.evidence = [
					`integrity:${integrity}`,
					`transaction:${input.operation}`,
				];
				record.verifiedAt = new Date().toISOString();
			});
		}, true);
	}
	async close() {
		await this.iterator?.close();
		this.iterator = undefined;
	}
}
