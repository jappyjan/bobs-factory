import { randomUUID } from "node:crypto";
import { mkdir, opendir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
	publishStorageJson,
	readStorageJson,
	reconcileStorageCopy,
	type StorageCategory,
	type StorageIdentity,
	type StorageRetentionStore,
	sameStorageIdentity,
	storageDigest,
	storageIdentity,
	verifyStorageIntegrity,
	writeStorageIntegrity,
} from "bobs-factory-core";
import {
	UpdateStateSchema,
	UpdateTransactionSchema,
} from "../updates/UpdateManager.js";

interface HistoricalCandidate {
	id: string;
	path: string;
	root: string;
	category: StorageCategory;
	identity: StorageIdentity;
	ownershipEvidence: string;
	reconciliationProof: string;
	dependencies: string[];
	recordId?: string;
	operation?: string;
	authoritativePath?: string;
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
	private migrations?: Awaited<ReturnType<typeof opendir>>;
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
			if (
				!entry.isDirectory() ||
				entry.isSymbolicLink() ||
				entry.name.startsWith(".bobs-factory-removal-")
			)
				continue;
			const path = join(root, entry.name);
			const indexed = (await readStorageJson(
				join(
					this.store.directory,
					"path-records",
					`${storageDigest(resolve(path))}.json`,
				),
			)) as { id: string } | undefined;
			const retained = indexed
				? await this.store.record(indexed.id)
				: undefined;
			if (retained?.reconciledAt && !retained.dependencies.length) continue;
			const identity = await storageIdentity(path, root);
			preview.candidates.push({
				id: storageDigest({ path, identity }),
				recordId: retained?.id,
				operation: retained?.operation,
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
		let migrationsComplete = false;
		if (this.root === roots.length) {
			try {
				this.migrations ??= await opendir(
					join(this.store.directory, "migration-observations"),
				);
				while (
					preview.candidates.length < 98 &&
					entries < 1000 &&
					performance.now() - started < 1000
				) {
					const entry = await this.migrations.read();
					entries++;
					if (!entry) {
						await this.migrations.close();
						this.migrations = undefined;
						migrationsComplete = true;
						break;
					}
					const observation = (await readStorageJson(
						join(this.migrations.path, entry.name),
					)) as
						| { operation?: string; preparation?: string; backup?: string }
						| undefined;
					if (
						!observation?.operation ||
						!observation.backup ||
						observation.preparation !== join(observation.backup, "staged")
					)
						continue;
					const journal = (await readStorageJson(
						join(observation.backup, "journal.json"),
					)) as
						| { phase?: string; destination?: string; sourceDigest?: string }
						| undefined;
					if (
						journal?.phase !== "committed" ||
						resolve(journal.destination ?? "") !== home ||
						journal.sourceDigest !== observation.operation
					)
						continue;
					for (const name of ["state", "factory"]) {
						const root = observation.preparation,
							path = join(root, name);
						try {
							if (
								await readStorageJson(
									join(
										this.store.directory,
										"path-records",
										`${storageDigest(path)}.json`,
									),
								)
							)
								continue;
							const identity = await storageIdentity(path, root);
							preview.candidates.push({
								id: storageDigest({ path, identity }),
								path,
								root,
								category: "migration",
								identity,
								operation: observation.operation,
								authoritativePath: join(home, name),
								ownershipEvidence:
									"Narrow migration preparation only; source and native backups stay protected",
								reconciliationProof:
									"Every selected file must match current authoritative state; credentials and links are refused",
								dependencies: [
									"Committed migration journal and replacement identities are rechecked",
								],
							});
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "ENOENT")
								throw error;
						}
					}
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					migrationsComplete = true;
				else throw error;
			}
		}
		preview.complete = this.root === roots.length && migrationsComplete;
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
		const classify = async () =>
			this.store.workspaceClaim(candidate.path).run(async () => {
				if (
					!sameStorageIdentity(
						candidate.identity,
						await storageIdentity(candidate.path, candidate.root),
					)
				)
					throw new Error(
						"Historical directory identity changed; refresh preview",
					);
				const copiedState = ["preparation", "recovery", "migration"].includes(
					candidate.category,
				);
				if (candidate.operation && candidate.operation !== input.operation)
					throw new Error(
						"Producer operation does not match the previewed candidate",
					);
				if (candidate.category === "migration") {
					const journal = (await readStorageJson(
						join(candidate.root, "..", "journal.json"),
					)) as
						| { phase?: string; sourceDigest?: string; destination?: string }
						| undefined;
					if (
						journal?.phase !== "committed" ||
						journal.sourceDigest !== input.operation ||
						resolve(journal.destination ?? "") !== this.store.home
					)
						throw new Error(
							"Migration is not independently committed at this home",
						);
				}
				if (!copiedState) {
					const state = (await readStorageJson(
						join(this.store.home, "updates", "state.json"),
					)) as { transaction?: Record<string, any> } | undefined;
					const current = state ? UpdateStateSchema.parse(state) : undefined;
					if (
						candidate.category === "snapshot" &&
						(current?.transaction?.snapshot === candidate.path ||
							current?.rollbackSnapshot?.path === candidate.path ||
							(current?.transaction?.id === input.operation &&
								!(
									["succeeded", "rolled-back", "cancelled"].includes(
										current.transaction.phase,
									) && current.transaction.release?.status === "acknowledged"
								)))
					)
						throw new Error(
							"Snapshot is still required by the latest completed or in-flight update",
						);
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
							? transaction.snapshot === candidate.path ||
								(candidate.recordId !== undefined &&
									candidate.operation === transaction.id &&
									candidate.path ===
										join(
											this.store.home,
											"updates",
											"snapshots",
											transaction.id,
										) &&
									(await this.store.record(candidate.recordId)).producer ===
										"OwnedUpdateLifecycle")
							: candidate.category === "staging"
								? suffix !== ".." &&
									!suffix.startsWith(`..${sep}`) &&
									!suffix.startsWith("/")
								: false;
					if (!owns)
						throw new Error(
							"The producer transaction does not prove disposable Bob-owned content at this exact directory. Migration/native/external backups remain protected",
						);
				}
				const registered = candidate.recordId
					? await this.store.record(candidate.recordId)
					: await this.store.register({
							path: candidate.path,
							root: candidate.root,
							category: candidate.category,
							rollback:
								candidate.category === "snapshot" ? "disposable" : undefined,
							producer:
								"Historical operator election with retained update proof",
							operation: input.operation,
							dependencies: copiedState
								? ["Historical copy requires authoritative reconciliation"]
								: [],
							evidence: [],
							completedAt: new Date().toISOString(),
							reconciledAt: copiedState ? undefined : new Date().toISOString(),
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
				const verified = await this.store.revise(registered.id, (record) => {
					record.evidence = [
						`integrity:${integrity}`,
						`transaction:${input.operation}`,
					];
					record.verifiedAt = new Date().toISOString();
					if (!copiedState) {
						record.completedAt ??= record.verifiedAt;
						record.reconciledAt = record.verifiedAt;
						if (record.category === "snapshot") record.rollback = "disposable";
					}
					record.historicalElection = {
						preview: preview.id,
						at: new Date().toISOString(),
					};
				});
				return copiedState
					? reconcileStorageCopy(
							this.store,
							verified.id,
							candidate.authoritativePath ?? this.store.home,
							true,
						)
					: verified;
			}, true);
		// Classification and update writers share the same operation lock order as deletion.
		await this.store.initialize();
		await mkdir(join(this.store.home, "updates"), {
			recursive: true,
			mode: 0o700,
		});
		const { OwnedResourceClaim } = await import("bobs-factory-core");
		return new OwnedResourceClaim(
			join(this.store.home, "updates", "operation.lock"),
			"update",
			0,
		).run(classify, true);
	}
	async close() {
		await this.iterator?.close();
		await this.migrations?.close();
		this.migrations = undefined;
		this.iterator = undefined;
	}
}
