import {
	lstat,
	opendir,
	readFile,
	readlink,
	rmdir,
	unlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";
import {
	publishStorageJson,
	readStorageJson,
	type StorageRecord,
	StorageRetentionStore,
	type StorageVerificationSlice,
	sameStorageIdentity,
	storageIdentity,
	storageIntegrityVerification,
	verifyStorageIntegrity,
} from "bobs-factory-core";
import { UpdateStateSchema } from "../updates/UpdateManager.js";
import type { StorageAdapter, StorageObservation } from "./StorageRetention.js";

/** Fresh update references include terminal transaction state: history is never erased to free a target. */
export class UpdateArtifacts implements StorageAdapter {
	private readonly verifications = new Map<
		string,
		ReturnType<typeof storageIntegrityVerification>
	>();
	constructor(private readonly home: string) {
		this.home = new StorageRetentionStore(home).home;
	}
	async close() {
		await Promise.allSettled(
			[...this.verifications.values()].map((verification) =>
				verification.return(undefined),
			),
		);
		this.verifications.clear();
	}
	private async protections(record: StorageRecord) {
		const reasons: string[] = [];
		const store = new StorageRetentionStore(this.home);
		try {
			const directory = await opendir(
				join(store.directory, "dependencies", record.id),
			);
			for await (const entry of directory) {
				const dependency = (await readStorageJson(
					join(directory.path, entry.name),
				)) as { ownerId: string };
				const receipt = (await readStorageJson(
					join(store.directory, "receipts", `${dependency.ownerId}.json`),
				)) as { phase?: string } | undefined;
				if (receipt?.phase !== "completed") {
					reasons.push(`Retained recovery dependency ${dependency.ownerId}`);
					break;
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				reasons.push("Recovery dependency inventory is unreadable");
		}

		const reference = (value: unknown): boolean => {
			if (typeof value === "string") {
				if (!value.startsWith("/")) return false;
				const path = resolve(value),
					suffix = relative(record.path, path);
				return (
					suffix === "" ||
					(!suffix.startsWith(`..${sep}`) &&
						suffix !== ".." &&
						!suffix.startsWith("/"))
				);
			}
			if (Array.isArray(value)) return value.some(reference);
			return (
				!!value &&
				typeof value === "object" &&
				Object.values(value).some(reference)
			);
		};
		let referenceBudget = 16,
			objectBudget = 1000;
		const executableLinks = async (state: unknown): Promise<void> => {
			if (!state || typeof state !== "object") return;
			for (const [key, value] of Object.entries(state)) {
				if (--objectBudget < 0) {
					reasons.push("Executable dependency inventory is incomplete");
					return;
				}
				if (
					["executable", "previousExecutable", "runtimeLink"].includes(key) &&
					typeof value === "string" &&
					value.startsWith("/")
				) {
					let path = value;
					for (let depth = 0; depth < 16; depth++) {
						if (--referenceBudget < 0) {
							reasons.push("Executable dependency inventory is incomplete");
							return;
						}
						if (reference(path)) {
							reasons.push("Current or previous executable dependency");
							break;
						}
						try {
							const stat = await lstat(path);
							if (!stat.isSymbolicLink()) break;
							path = resolve(dirname(path), await readlink(path));
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "ENOENT")
								reasons.push("Executable dependency cannot be verified");
							break;
						}
						if (depth === 15)
							reasons.push("Executable link chain requires inspection");
					}
				} else if (value && typeof value === "object")
					await executableLinks(value);
			}
		};
		for (const name of [
			"updates/state.json",
			"updates/maintenance.json",
			"runtime/update-owner.json",
			"runtime/desktop-runtime.json",
			"runtime/desktop-update.json",
			"desktop/updates/state.json",
			"desktop/updates/installation.json",
			"desktop/updates/helper-request.json",
			"runtime/service.json",
		]) {
			try {
				const path = join(this.home, name),
					stat = await lstat(path);
				if (
					!stat.isFile() ||
					stat.isSymbolicLink() ||
					stat.size > 4 * 1024 * 1024
				)
					throw new Error("Unverifiable state file");
				const state: unknown = JSON.parse(await readFile(path, "utf8"));
				if (
					name === "updates/state.json" ||
					name === "desktop/updates/state.json"
				)
					UpdateStateSchema.parse(state);
				else if (
					!state ||
					Array.isArray(state) ||
					typeof state !== "object" ||
					!Object.keys(state).some((key) =>
						[
							"schema",
							"schemaVersion",
							"transactionId",
							"executable",
							"install",
							"product",
							"home",
						].includes(key),
					)
				)
					throw new Error("Unrecognized producer state");
				if (reference(state))
					reasons.push(`Retained update reference in ${name}`);
				await executableLinks(state);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					reasons.push(`Cannot verify ${name}; inspect update/recovery state`);
			}
		}
		for (const name of [
			"runtime/current",
			"runtime/previous",
			"runtime/desktop-current",
			"runtime/desktop-previous",
			"runtime/desktop-installed/bin/bobs-factory",
		]) {
			try {
				const path = join(this.home, name),
					target = resolve(path, "..", await readlink(path));
				if (reference(target)) reasons.push(`Live executable link ${name}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					reasons.push(`Cannot verify executable link ${name}`);
			}
		}
		if (reference(process.execPath))
			reasons.push("Currently executing runtime");
		return reasons;
	}
	async observe(
		record: StorageRecord,
		signal: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number } = {},
	): Promise<StorageObservation> {
		signal.throwIfAborted();
		const allowed = [
			join(this.home, "updates", "snapshots"),
			join(this.home, "updates", "staging"),
			join(this.home, "desktop", "updates", "staging"),
			join(this.home, "updates", "preparation"),
			join(this.home, "updates", "recovery-retained"),
		].map((resolvePath) => resolve(resolvePath));
		const protection = await this.protections(record);
		if (
			!allowed.includes(resolve(record.root)) ||
			dirname(record.path) !== record.root
		)
			protection.push("Root is not an enrolled update artifact root");
		if (record.category === "migration" && !record.historicalElection)
			protection.push(
				"Migration source and native backups require explicit verified election",
			);
		if (
			!sameStorageIdentity(
				record.identity,
				await storageIdentity(record.path, record.root),
			)
		)
			protection.push("Filesystem identity changed");
		const previous = (await readStorageJson(
			join(this.home, "storage-retention", "receipts", `${record.id}.json`),
		)) as { phase?: string; identity?: StorageRecord["identity"] } | undefined;
		const resuming =
			previous?.phase === "removing" &&
			!!previous.identity &&
			sameStorageIdentity(previous.identity, record.identity);
		let verification: StorageVerificationSlice | undefined;
		try {
			if (
				record.category === "snapshot" &&
				record.rollback !== "disposable" &&
				!resuming
			) {
				const receipt = JSON.parse(
					await readFile(join(record.path, "lifecycle-receipt.json"), "utf8"),
				);
				if (!record.verifiedAt || !receipt || typeof receipt !== "object")
					throw new Error("No rollback receipt");
			}
			const integrity = record.evidence
				.find((value) => value.startsWith("integrity:"))
				?.slice(10);
			if (!integrity) throw new Error("No complete artifact integrity proof");
			let iterator = this.verifications.get(record.id);
			if (!iterator) {
				iterator = storageIntegrityVerification(
					record.path,
					join(this.home, "storage-retention", "proofs", `${record.id}.ndjson`),
					integrity,
					signal,
					{
						...bounds,
						allowMissing: resuming,
						maxEntries: Math.max(1, (bounds.maxEntries ?? 1000) - 100),
					},
				);
				this.verifications.set(record.id, iterator);
			}
			const next = await iterator.next({
				...bounds,
				maxEntries: Math.max(1, (bounds.maxEntries ?? 1000) - 100),
			});
			verification = next.value as StorageVerificationSlice | undefined;
			if (verification?.complete || next.done) {
				await iterator.return();
				this.verifications.delete(record.id);
			}
			await publishStorageJson(
				join(
					this.home,
					"storage-retention",
					"verification-progress",
					`${record.id}.json`,
				),
				{
					identity: record.identity,
					complete: !!verification?.complete,
					checkedEntries: verification?.entries,
					recheckOnRestart: true,
				},
			);
		} catch {
			this.verifications.delete(record.id);
			protection.push(
				record.category === "snapshot"
					? "Rollback verification failed"
					: "Artifact content changed or complete ownership verification is unavailable",
			);
		}

		return {
			record,
			protection,
			complete: verification?.complete ?? protection.length > 0,
			apparentBytes: verification?.apparentBytes,
			filesystemEntries: 100 + (verification?.entries ?? 0),
			usageObservedAt: verification?.complete
				? new Date().toISOString()
				: undefined,
		};
	}
	async remove(
		record: StorageRecord,
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	) {
		const fresh = await this.observe(record, signal);
		if (fresh.protection.length) throw new Error(fresh.protection.join("; "));
		const integrity = record.evidence
			.find((value) => value.startsWith("integrity:"))
			?.slice(10);
		if (!integrity) throw new Error("Artifact ownership proof is unavailable");
		const previous = (await readStorageJson(
			join(this.home, "storage-retention", "receipts", `${record.id}.json`),
		)) as { phase?: string; identity?: StorageRecord["identity"] } | undefined;
		const resuming =
			previous?.phase === "removing" &&
			!!previous.identity &&
			sameStorageIdentity(previous.identity, record.identity);
		await verifyStorageIntegrity(
			record.path,
			join(this.home, "storage-retention", "proofs", `${record.id}.ndjson`),
			integrity,
			signal,
			resuming,
		);
		await journal("removing");
		// Streaming lstat traversal never follows an external symlink. Yield at each
		// 1,000 entries / one second, and permit cancellation during large removals.
		let entries = 0,
			started = performance.now();
		const remove = async (path: string): Promise<void> => {
			signal.throwIfAborted();
			if (++entries >= 1000 || performance.now() - started >= 1000) {
				await yieldToIO();
				entries = 0;
				started = performance.now();
			}
			const stat = await lstat(path);
			if (!stat.isDirectory() || stat.isSymbolicLink()) {
				await unlink(path);
				return;
			}
			const directory = await opendir(path);
			for await (const entry of directory) await remove(join(path, entry.name));
			await rmdir(path);
		};
		await remove(record.path);
	}
}
