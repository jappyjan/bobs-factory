import { randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { lstat, mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";
import {
	OwnedResourceClaim,
	publishStorageJson,
	readStorageJson,
	type StoragePolicy,
	type StorageRecord,
	StorageRetentionStore,
	sameStorageIdentity,
	storageDigest,
	storageIdentity,
} from "bobs-factory-core";
import { UpdateOperationLock } from "../updates/UpdateOperationLock.js";
import {
	type HistoricalPreview,
	HistoricalStorage,
} from "./HistoricalStorage.js";

export interface StorageObservation {
	record: StorageRecord;
	protection: string[];
	apparentBytes?: number;
	usageObservedAt?: string;
	filesystemEntries?: number;
	complete: boolean;
	rollbackVerified?: boolean;
}
export interface StorageAdapter {
	close?(): Promise<void>;
	recover?(record: StorageRecord): Promise<void>;
	reset?(record: StorageRecord): Promise<void>;
	observe(
		record: StorageRecord,
		signal: AbortSignal,
		bounds?: { maxEntries?: number; deadline?: number },
	): Promise<StorageObservation>;
	remove(
		record: StorageRecord,
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	): Promise<void>;
}
export interface StorageCandidate extends StorageObservation {
	eligible: boolean;
	reasons: string[];
}
export function evaluateStorageRetention(
	observation: StorageObservation,
	policy: StoragePolicy,
	protectedSnapshots: ReadonlySet<string>,
	now: number,
): StorageCandidate {
	const { record } = observation;
	const reasons = [...observation.protection];
	if (!observation.complete)
		reasons.push("Inventory is incomplete; wait for reconciliation");
	if (!record.completedAt || !record.verifiedAt || !record.reconciledAt)
		reasons.push(
			"Producer completion, verification and reconciliation are required",
		);
	if (record.dependencies.length)
		reasons.push("Retained dependencies have not been released");
	if (record.category === "snapshot") {
		if (!protectedSnapshots.size)
			reasons.push(
				"At least one independently verified usable rollback must remain",
			);
		if (protectedSnapshots.has(record.id))
			reasons.push("Protected verified rollback snapshot");
	} else if (record.completedAt) {
		if (
			now - Date.parse(record.completedAt) <
			policy.ages[record.category] * 86_400_000
		)
			reasons.push("Retention period has not elapsed");
	}
	return { ...observation, eligible: reasons.length === 0, reasons };
}
export interface StoragePreview {
	id: string;
	policyRevision: number;
	createdAt: string;
	candidates: StorageCandidate[];
	complete: boolean;
	deferred: boolean;
	volumes: {
		device: string;
		freeBytes?: number;
		lowDisk?: boolean;
		error?: string;
	}[];
}
export interface StorageOutcome {
	id: string;
	startedAt: string;
	completedAt?: string;
	results: {
		id: string;
		phase: string;
		reason?: string;
		observedFreeSpaceChange?: number;
	}[];
	error?: string;
}

/** One coordinator owns all deletion. Inventories are observations, never deletion authority. */
export class StorageRetention {
	readonly store: StorageRetentionStore;
	readonly historical: HistoricalStorage;
	private timer?: ReturnType<typeof setTimeout>;
	private running?: Promise<void>;
	private stopped = false;
	private requested = false;
	// External wake-ups since start; a sweep that began before the latest one may
	// have evaluated records before they changed, so it must be repeated.
	private wakeups = 0;
	private sweepWakeups?: number;
	private watcher?: FSWatcher;
	private abort = new AbortController();
	constructor(
		readonly home: string,
		readonly adapters: Partial<
			Record<StorageRecord["category"], StorageAdapter>
		>,
		private readonly clock = Date.now,
	) {
		this.store = new StorageRetentionStore(home);
		this.home = this.store.home;
		this.historical = new HistoricalStorage(this.store);
	}
	async start() {
		await this.store.initialize();
		this.stopped = false;
		if (this.abort.signal.aborted) this.abort = new AbortController();
		if (!this.watcher) {
			this.watcher = watch(this.store.directory, (_event, name) => {
				if (
					name === "inventory-revision.json" ||
					name === "update-completed.json"
				)
					this.requestReconciliation();
			});
			this.watcher.on("error", () => this.requestReconciliation());
			this.watcher.unref();
		}
		this.requestReconciliation();
	}
	async stop() {
		this.stopped = true;
		clearTimeout(this.timer);
		this.abort.abort();
		this.watcher?.close();
		this.watcher = undefined;
		await this.running?.catch(() => {});
		await this.historical.close();
		await Promise.allSettled(
			[...new Set(Object.values(this.adapters))].map((adapter) =>
				adapter?.close?.(),
			),
		);
	}
	requestReconciliation() {
		if (this.stopped) return;
		this.wakeups++;
		this.queueReconciliation();
	}
	/** Continue or repeat work without recording a new external wake-up. */
	private queueReconciliation() {
		if (this.stopped) return;
		const alreadyRequested = this.requested;
		this.requested = true;
		if (this.running || (this.timer && alreadyRequested)) return;
		clearTimeout(this.timer);
		this.schedule(100);
	}
	private schedule(delay: number) {
		if (this.stopped) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.running || this.stopped) return;
			this.requested = false;
			this.running = this.reconcile()
				.catch(async (error) => {
					await publishStorageJson(
						join(this.store.directory, "last-error.json"),
						{
							at: new Date(this.clock()).toISOString(),
							error: String(error).slice(0, 1000),
						},
					);
				})
				.finally(async () => {
					this.running = undefined;
					const policy = await this.store.policy().catch(() => undefined);
					this.schedule(
						this.requested ? 100 : (policy?.intervalHours ?? 24) * 3_600_000,
					);
				});
			void this.running.catch(() => {});
		}, delay);
		this.timer.unref();
	}

	/** Build the rollback set across bounded, restartable inventory slices. */
	private async rollbacks(
		policy: StoragePolicy,
		deadline = performance.now() + 1000,
	): Promise<{
		ids: Set<string>;
		complete: boolean;
		count: number;
		evaluated: number;
		entries: number;
	}> {
		const generation = await this.store.inventoryRevision();
		const count = await this.store.inventoryCount();
		type Index = {
			generation: number;
			count: number;
			revision: number;
			offset: number;
			newest: { id: string; completedAt: string }[];
		};
		const path = join(this.store.directory, "rollback-index.json");
		const saved = (await readStorageJson(path)) as
			| { index?: Index; checksum?: string; completedPreview?: boolean }
			| undefined;
		let index = saved?.index;
		if (
			!index ||
			saved?.completedPreview ||
			saved?.checksum !== storageDigest(JSON.stringify(index))
		)
			index = undefined;
		if (
			!index ||
			index.count !== count ||
			index.revision !== policy.revision ||
			index.generation !== generation
		)
			index = {
				generation,
				count,
				revision: policy.revision,
				offset: 0,
				newest: [],
			};
		const ids = await this.store.inventoryPage(
			Math.floor(index.offset / 100) * 100,
		);
		let evaluated = 0,
			entries = 0;
		while (
			index.offset < count &&
			evaluated < 100 &&
			entries < 900 &&
			performance.now() < deadline
		) {
			this.abort.signal.throwIfAborted();
			const id = ids[index.offset % 100];
			if (!id)
				throw new Error(
					"Storage inventory index is incomplete; inspect registration receipts",
				);
			const record = await this.store.record(id);
			if (
				record.category === "snapshot" &&
				record.rollback === "usable" &&
				record.verifiedAt &&
				record.completedAt &&
				this.adapters.snapshot
			) {
				const receipt = (await readStorageJson(
					join(this.store.directory, "receipts", `${record.id}.json`),
				)) as { phase?: string } | undefined;
				if (receipt?.phase === "completed" || receipt?.phase === "removing") {
					index.offset++;
					evaluated++;
					if (index.offset % 100 === 0) break;
					continue;
				}
				const observation = await this.adapters.snapshot.observe(
					record,
					this.abort.signal,
					{ maxEntries: 1000 - entries, deadline },
				);
				entries += observation.filesystemEntries ?? 0;
				if (!observation.complete) break;
				if (observation.complete && observation.rollbackVerified === true) {
					index.newest.push({ id, completedAt: record.completedAt });
					index.newest.sort(
						(a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
					);
					index.newest.splice(Math.max(1, policy.snapshotCount));
				}
			}
			index.offset++;
			evaluated++;
			if (index.offset % 100 === 0) break;
		}
		if ((await this.store.inventoryRevision()) !== generation)
			throw new Error("Storage producer state changed; refresh inventory");
		await publishStorageJson(path, {
			index,
			checksum: storageDigest(JSON.stringify(index)),
		});
		return {
			ids: new Set(index.newest.map((record) => record.id)),
			complete: index.offset === count,
			count,
			evaluated,
			entries,
		};
	}
	async preview(): Promise<StoragePreview> {
		await this.store.initialize();
		const policy = await this.store.policy();
		const deadline = performance.now() + 1000;
		const rollbackIndex = await this.rollbacks(policy, deadline);
		const previous = (await readStorageJson(
			join(this.store.directory, "continuation.json"),
		)) as { offset: number; count: number; revision: number } | undefined;
		let offset =
			previous?.count === rollbackIndex.count &&
			previous.revision === policy.revision
				? previous.offset
				: 0;
		// A sweep resumed from a saved cursor was started by an earlier pass whose
		// view of the records already behind the cursor may be stale.
		if (offset === 0) this.sweepWakeups = this.wakeups;
		else this.sweepWakeups ??= -1;
		const preview: StoragePreview = {
			id: randomUUID(),
			policyRevision: policy.revision,
			createdAt: new Date(this.clock()).toISOString(),
			candidates: [],
			complete: rollbackIndex.complete,
			deferred: !rollbackIndex.complete,
			volumes: [],
		};
		try {
			const info = await statfs(this.home),
				stat = await lstat(this.home),
				freeBytes = info.bavail * info.bsize;
			preview.volumes.push({
				device: String(stat.dev),
				freeBytes,
				lowDisk: freeBytes < policy.lowDiskBytes,
			});
		} catch (error) {
			preview.volumes.push({
				device: "instance",
				error: String(error).slice(0, 500),
			});
		}
		if (rollbackIndex.complete) {
			let entries = rollbackIndex.entries;
			const ids = await this.store.inventoryPage(
				Math.floor(offset / 100) * 100,
			);
			while (
				offset < rollbackIndex.count &&
				preview.candidates.length < 100 - rollbackIndex.evaluated &&
				entries < 900 &&
				performance.now() < deadline
			) {
				this.abort.signal.throwIfAborted();
				const id = ids[offset % 100];
				if (!id)
					throw new Error("Storage inventory index requires reconciliation");
				const record = await this.store.record(id);
				const receipt = (await readStorageJson(
					join(this.store.directory, "receipts", `${id}.json`),
				)) as
					| { phase?: string; identity?: StorageRecord["identity"] }
					| undefined;
				if (
					receipt?.identity &&
					sameStorageIdentity(receipt.identity, record.identity)
				) {
					try {
						await lstat(record.path);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
						if (receipt.phase !== "completed")
							preview.candidates.push({
								record,
								complete: true,
								protection: [],
								eligible: true,
								reasons: [
									"Original target is absent; reconcile the retained deletion receipt",
								],
							});
						offset++;
						if (offset % 100 === 0) break;
						continue;
					}
				}
				const adapter = this.adapters[record.category];
				let observation: StorageObservation = {
					record,
					complete: false,
					protection: ["No verified producer adapter"],
				};
				try {
					if (
						!sameStorageIdentity(
							record.identity,
							await storageIdentity(record.path, record.root),
						)
					) {
						if (receipt)
							await publishStorageJson(
								join(this.store.directory, "receipts", `${id}.json`),
								{
									id,
									identity: record.identity,
									phase: "identity-changed",
									at: new Date(this.clock()).toISOString(),
								},
							);
						throw new Error("Filesystem identity changed; retain replacement");
					}
					if (adapter)
						observation = await adapter.observe(record, this.abort.signal, {
							maxEntries: 1000 - entries,
							deadline,
						});
					entries += observation.filesystemEntries ?? 0;
				} catch (error) {
					observation.protection = [String(error).slice(0, 1000)];
					observation.complete = true;
				}
				preview.candidates.push(
					evaluateStorageRetention(
						observation,
						policy,
						rollbackIndex.ids,
						this.clock(),
					),
				);
				if (
					!preview.volumes.some(
						(volume) => volume.device === record.identity.device,
					)
				) {
					try {
						const info = await statfs(record.root);
						const freeBytes = info.bavail * info.bsize;
						preview.volumes.push({
							device: record.identity.device,
							freeBytes,
							lowDisk: freeBytes < policy.lowDiskBytes,
						});
					} catch (error) {
						preview.volumes.push({
							device: record.identity.device,
							error: String(error).slice(0, 500),
						});
					}
				}
				if (!observation.complete) break;
				offset++;
				if (offset % 100 === 0) break;
			}
			preview.complete = offset === rollbackIndex.count;
			preview.deferred = !preview.complete;
			if (preview.complete && this.sweepWakeups !== this.wakeups) {
				// A wake-up arrived during this sweep; sweep again from the start so
				// records changed behind the cursor are not left for the next interval.
				// Only a started coordinator owns automatic passes.
				this.sweepWakeups = undefined;
				if (this.watcher) this.queueReconciliation();
			}
			await publishStorageJson(
				join(this.store.directory, "continuation.json"),
				{
					offset: preview.complete ? 0 : offset,
					count: rollbackIndex.count,
					revision: policy.revision,
				},
			);
		}
		if (preview.complete) {
			const path = join(this.store.directory, "rollback-index.json");
			const index = await readStorageJson(path);
			await publishStorageJson(path, {
				...(index as object),
				completedPreview: true,
			});
		}
		await publishStorageJson(
			join(this.store.directory, "preview.json"),
			preview,
		);
		return preview;
	}
	async status() {
		return {
			policy: await this.store.policy(),
			historicalPreview: (await readStorageJson(
				join(this.store.directory, "historical-preview.json"),
			)) as HistoricalPreview | undefined,
			preview: (await readStorageJson(
				join(this.store.directory, "preview.json"),
			)) as StoragePreview | undefined,
			outcome: (await readStorageJson(
				join(this.store.directory, "outcome.json"),
			)) as StorageOutcome | undefined,
			lastError: (await readStorageJson(
				join(this.store.directory, "last-error.json"),
			)) as { at: string; error: string } | undefined,
		};
	}
	async execute(
		previewId: string,
		selected: string[],
		idempotentTeardown = false,
	) {
		const preview = (await readStorageJson(
			join(this.store.directory, "preview.json"),
		)) as StoragePreview | undefined;
		const policy = await this.store.policy();
		if (
			!preview ||
			preview.id !== previewId ||
			preview.policyRevision !== policy.revision
		)
			throw new Error("Storage preview changed; refresh before cleanup");
		if (
			selected.length > 100 ||
			new Set(selected).size !== selected.length ||
			selected.some(
				(id) =>
					!preview.candidates.some(
						(candidate) => candidate.record.id === id && candidate.eligible,
					),
			)
		)
			throw new Error(
				"Select eligible identities from the current storage preview",
			);
		if (this.running)
			throw new Error("Storage cleanup is busy; refresh its outcome");
		const outcome: StorageOutcome = {
			id: randomUUID(),
			startedAt: new Date(this.clock()).toISOString(),
			results: [],
		};
		await publishStorageJson(
			join(this.store.directory, "outcome.json"),
			outcome,
		);
		this.running = this.perform(
			preview,
			selected,
			outcome,
			idempotentTeardown,
		).finally(() => {
			this.running = undefined;
			if (this.requested) this.schedule(100);
		});
		void this.running.catch(() => {});
		return { operationId: outcome.id };
	}
	private async observeComplete(
		adapter: StorageAdapter,
		record: StorageRecord,
	) {
		await adapter.reset?.(record);
		let observation: StorageObservation;
		do {
			this.abort.signal.throwIfAborted();
			observation = await adapter.observe(record, this.abort.signal, {
				maxEntries: 1000,
				deadline: performance.now() + 1000,
			});
			if (!observation.complete) await yieldToIO();
		} while (!observation.complete);
		return observation;
	}

	private async perform(
		preview: StoragePreview,
		selected: string[],
		outcome: StorageOutcome,
		idempotentTeardown = false,
	) {
		try {
			await mkdir(join(this.home, "updates"), { recursive: true, mode: 0o700 });
			await new UpdateOperationLock(
				join(this.home, "updates", "operation.lock"),
				"update",
				0,
			).run(async () => {
				const desktopDirectory = join(this.home, "desktop", "updates");
				const withDesktop = async (work: () => Promise<void>) => {
					try {
						await lstat(desktopDirectory);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT")
							return work();
						throw error;
					}
					return new UpdateOperationLock(
						join(desktopDirectory, "operation.lock"),
						"desktop update",
						0,
					).run(work);
				};
				await withDesktop(async () => {
					await new OwnedResourceClaim(
						join(this.store.directory, "cleanup.lock"),
						"cleanup",
						0,
					).run(async () => {
						for (const id of selected) {
							this.abort.signal.throwIfAborted();
							const result: StorageOutcome["results"][number] = {
								id,
								phase: "retained",
							};
							outcome.results.push(result);
							try {
								const record = await this.store.record(id);
								await this.store.workspaceClaim(record.path).run(async () => {
									const policy = await this.store.policy();
									if (policy.revision !== preview.policyRevision)
										throw new Error("Policy changed; refresh preview");
									const adapter = this.adapters[record.category];
									if (!adapter) throw new Error("No producer adapter");
									const journalPath = join(
										this.store.directory,
										"receipts",
										`${id}.json`,
									);
									await adapter.recover?.(record);
									const previous = (await readStorageJson(journalPath)) as
										| { phase?: string; identity?: StorageRecord["identity"] }
										| undefined;
									let identity: StorageRecord["identity"];
									try {
										identity = await storageIdentity(record.path, record.root);
									} catch (error) {
										if (
											(error as NodeJS.ErrnoException).code === "ENOENT" &&
											previous?.identity &&
											sameStorageIdentity(previous.identity, record.identity)
										) {
											result.phase = "completed";
											result.reason =
												"Original target is absent; reconciled without rerunning hooks or claiming measured savings";
											await publishStorageJson(journalPath, {
												id,
												identity: record.identity,
												phase: "completed",
												previousPhase: previous.phase,
												reason: result.reason,
												at: new Date(this.clock()).toISOString(),
											});
											return;
										}
										throw error;
									}
									if (!sameStorageIdentity(record.identity, identity)) {
										if (previous)
											await publishStorageJson(journalPath, {
												id,
												identity: record.identity,
												phase: "identity-changed",
												at: new Date(this.clock()).toISOString(),
											});
										throw new Error(
											"Identity changed; original intent ended and replacement retained",
										);
									}
									const fresh = await this.observeComplete(adapter, record);
									let rollbackIndex = await this.rollbacks(policy);
									while (!rollbackIndex.complete) {
										await yieldToIO();
										rollbackIndex = await this.rollbacks(policy);
									}
									for (const protectedId of rollbackIndex.ids) {
										const protectedRecord =
											await this.store.record(protectedId);
										const verified = this.adapters.snapshot
											? await this.observeComplete(
													this.adapters.snapshot,
													protectedRecord,
												)
											: undefined;
										if (
											!verified?.complete ||
											verified.rollbackVerified !== true
										)
											throw new Error(
												"Protected rollback changed; refresh inventory",
											);
									}
									const candidate = evaluateStorageRetention(
										fresh,
										policy,
										rollbackIndex.ids,
										this.clock(),
									);
									if (!candidate.eligible)
										throw new Error(candidate.reasons.join("; "));
									if (
										previous &&
										!(
											previous.phase === "removing" &&
											record.category !== "worktree"
										) &&
										!(
											record.category === "worktree" &&
											idempotentTeardown &&
											previous.phase !== "completed" &&
											previous.phase !== "identity-changed"
										)
									)
										throw new Error(
											"Interrupted teardown may have run without a success receipt. Establish hook idempotency and reconcile its outcome before retrying",
										);
									if (previous)
										await publishStorageJson(
											join(
												this.store.directory,
												"receipt-history",
												id,
												`${outcome.id}.json`,
											),
											{
												...previous,
												retryAt: new Date(this.clock()).toISOString(),
												idempotentTeardown,
											},
										);
									const journal = async (phase: string) => {
										result.phase = phase;
										await publishStorageJson(journalPath, {
											id,
											operationId: outcome.id,
											identity: record.identity,
											phase,
											at: new Date(this.clock()).toISOString(),
										});
									};
									let before: number | undefined;
									try {
										const info = await statfs(record.path);
										before = info.bavail * info.bsize;
									} catch {}
									if (!previous) await journal("intent");
									await adapter.remove(record, this.abort.signal, journal);
									try {
										const info = await statfs(record.root);
										if (before !== undefined)
											result.observedFreeSpaceChange =
												info.bavail * info.bsize - before;
									} catch {}
									await journal("completed");
								}, true);
							} catch (error) {
								result.reason = String(error).slice(0, 1000);
							}
							await publishStorageJson(
								join(this.store.directory, "outcome.json"),
								outcome,
							);
							await yieldToIO();
						}
					}, true);
				});
			});
		} catch (error) {
			outcome.error = String(error).slice(0, 1000);
		} finally {
			outcome.completedAt = new Date(this.clock()).toISOString();
			await publishStorageJson(
				join(this.store.directory, "outcome.json"),
				outcome,
			);
		}
	}
	private async reconcile() {
		const policy = await this.store.policy();
		const preview = await this.preview();
		if (!policy.enabled) return;
		const selected = preview.candidates
			.filter((candidate) => candidate.eligible)
			.map((candidate) => candidate.record.id);
		if (selected.length) {
			const outcome: StorageOutcome = {
				id: randomUUID(),
				startedAt: new Date(this.clock()).toISOString(),
				results: [],
			};
			await this.perform(preview, selected, outcome);
		}
		if (preview.deferred) this.queueReconciliation();
	}
}
