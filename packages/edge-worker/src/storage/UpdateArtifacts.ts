import { createHash, randomUUID } from "node:crypto";
import {
	createReadStream,
	linkSync,
	lstatSync,
	renameSync,
	rmdirSync,
	unlinkSync,
} from "node:fs";
import {
	lstat,
	mkdir,
	opendir,
	readFile,
	readlink,
	rename,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as yieldToIO } from "node:timers/promises";
import {
	publishStorageJson,
	readStorageJson,
	type StorageIdentity,
	type StorageRecord,
	StorageRetentionStore,
	type StorageVerificationSlice,
	sameStorageIdentity,
	storageDigest,
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
		AsyncGenerator<
			StorageVerificationSlice,
			void,
			{ maxEntries?: number; deadline?: number } | undefined
		>
	>();
	constructor(private readonly home: string) {
		this.home = new StorageRetentionStore(home).home;
	}
	async reset(record: StorageRecord) {
		await this.verifications.get(record.id)?.return();
		this.verifications.delete(record.id);
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
	private async *verify(
		record: StorageRecord,
		integrity: string,
		signal: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number; allowMissing?: boolean },
	): AsyncGenerator<
		StorageVerificationSlice,
		void,
		{ maxEntries?: number; deadline?: number } | undefined
	> {
		if (
			record.category === "snapshot" &&
			record.rollback === "usable" &&
			!bounds.allowMissing
		) {
			const proof = (await readStorageJson(
				join(
					this.home,
					"storage-retention",
					"rollback-proofs",
					`${record.id}.json`,
				),
			)) as
				| {
						root: string;
						executable: string;
						identity: StorageIdentity;
						integrity: string;
				  }
				| undefined;
			if (
				!proof ||
				!record.evidence.includes(`runtime-proof:${storageDigest(proof)}`) ||
				!sameStorageIdentity(
					proof.identity,
					await storageIdentity(proof.root, dirname(proof.root)),
				) ||
				dirname(proof.executable) !== proof.root
			)
				throw new Error("Rollback runtime proof is unavailable");
			const executable = await lstat(proof.executable);
			if (
				!executable.isFile() ||
				executable.isSymbolicLink() ||
				!(executable.mode & 0o111)
			)
				throw new Error("Rollback runtime is unavailable");
			const runtime = storageIntegrityVerification(
				proof.root,
				join(
					this.home,
					"storage-retention",
					"rollback-proofs",
					`${record.id}.ndjson`,
				),
				proof.integrity,
				signal,
				{ ...bounds, rejectLinks: true },
			);
			try {
				let next = await runtime.next();
				while (!next.done) {
					if (next.value.complete) {
						bounds = {
							...bounds,
							maxEntries: Math.max(
								1,
								(bounds.maxEntries ?? 1000) - next.value.entries,
							),
						};
						break;
					}
					bounds = (yield { ...next.value, complete: false }) ?? {};
					next = await runtime.next(bounds);
				}
			} finally {
				await runtime.return();
			}
		}
		if (record.authoritativeReplacement) {
			const replacement = record.authoritativeReplacement;
			if (
				![
					this.home,
					join(this.home, "state"),
					join(this.home, "factory"),
				].includes(replacement.path) ||
				!sameStorageIdentity(
					replacement.identity,
					await storageIdentity(replacement.path, dirname(replacement.path)),
				)
			)
				throw new Error("Authoritative replacement identity changed");
			const replacementVerification = storageIntegrityVerification(
				replacement.path,
				join(this.home, "storage-retention", "proofs", `${record.id}.ndjson`),
				replacement.integrity,
				signal,
				{ ...bounds, allowMissing: false, allowExtra: true },
			);
			try {
				let next = await replacementVerification.next();
				while (!next.done) {
					if (next.value.complete) {
						bounds = {
							...bounds,
							maxEntries: Math.max(
								1,
								(bounds.maxEntries ?? 1000) - next.value.entries,
							),
						};
						break;
					}
					bounds = (yield { ...next.value, complete: false }) ?? {};
					next = await replacementVerification.next(bounds);
				}
			} finally {
				await replacementVerification.return();
			}
		}

		yield* storageIntegrityVerification(
			record.path,
			join(this.home, "storage-retention", "proofs", `${record.id}.ndjson`),
			integrity,
			signal,
			{ ...bounds, requireIdentity: true },
		);
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
		if (
			record.category === "migration" &&
			(record.historicalElection || record.producer === "applyMigration") &&
			record.authoritativeReplacement
		) {
			const observation = (await readStorageJson(
				join(
					this.home,
					"storage-retention",
					"migration-observations",
					`${record.operation}.json`,
				),
			)) as { backup?: string; preparation?: string } | undefined;
			const journal = observation?.backup
				? ((await readStorageJson(join(observation.backup, "journal.json"))) as
						| { phase?: string; sourceDigest?: string; destination?: string }
						| undefined)
				: undefined;
			if (
				observation?.preparation === record.root &&
				observation.preparation === join(observation.backup!, "staged") &&
				journal?.phase === "committed" &&
				journal.sourceDigest === record.operation &&
				journal.destination === this.home &&
				["state", "factory"].includes(relative(record.root, record.path))
			)
				allowed.push(resolve(record.root));
		}
		const protection = await this.protections(record);
		if (
			!allowed.includes(resolve(record.root)) ||
			dirname(record.path) !== record.root
		)
			protection.push("Root is not an enrolled update artifact root");
		if (
			record.category === "migration" &&
			!record.historicalElection &&
			record.producer !== "applyMigration"
		)
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
				iterator = this.verify(record, integrity, signal, {
					...bounds,
					allowMissing: resuming,
					maxEntries: Math.max(1, (bounds.maxEntries ?? 1000) - 100),
				});
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
			rollbackVerified:
				record.category === "snapshot" &&
				record.rollback === "usable" &&
				!!verification?.complete,
			apparentBytes: verification?.apparentBytes,
			filesystemEntries: 100 + (verification?.entries ?? 0),
			usageObservedAt: verification?.complete
				? new Date().toISOString()
				: undefined,
		};
	}
	private quarantine(record: StorageRecord) {
		return join(record.root, `.bobs-factory-removal-${record.id}`);
	}
	/** A crash leaves the original inode in a private quarantine. Restore it before
	 * normal reconciliation; a replacement at the public path always wins preservation. */
	async recover(record: StorageRecord) {
		const quarantine = this.quarantine(record),
			path = join(quarantine, "payload");
		let identity: StorageIdentity;
		try {
			identity = await storageIdentity(path, quarantine);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				try {
					rmdirSync(quarantine);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				return;
			}
			throw error;
		}
		if (!sameStorageIdentity(identity, record.identity))
			throw new Error(
				"Quarantined identity changed; inspect retained contents",
			);
		try {
			await lstat(record.path);
			throw new Error(
				"Replacement and original quarantine both retained; reconcile before cleanup",
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const leafPath = join(quarantine, "leaf.json");
		const leaf = (await readStorageJson(leafPath)) as
			| { source: string; slot: string; identity: StorageIdentity }
			| undefined;
		if (leaf) {
			if (
				!leaf.source ||
				leaf.source.split(sep).includes("..") ||
				leaf.source.startsWith("/") ||
				!/^[a-f0-9-]{36}$/.test(leaf.slot)
			)
				throw new Error("Detached leaf receipt is invalid");
			const source = join(path, leaf.source),
				slot = join(quarantine, leaf.slot);
			try {
				const stat = await lstat(slot);
				if (
					!sameStorageIdentity(leaf.identity, {
						device: String(stat.dev),
						inode: String(stat.ino),
						birthtime: stat.birthtimeMs,
					})
				)
					throw new Error("Detached leaf identity changed");
				await storageIdentity(dirname(source), dirname(path));
				try {
					await lstat(source);
					throw new Error(
						"Detached leaf has a replacement; both files remain protected",
					);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				// link is exclusive: a concurrently occupied name is never overwritten.
				linkSync(slot, source);
				unlinkSync(slot);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			unlinkSync(leafPath);
		}
		const directory = await opendir(quarantine);
		for await (const entry of directory)
			if (entry.name !== "payload")
				throw new Error(
					"Quarantine contains unresolved detached files; inspect before retry",
				);
		await rename(path, record.path);
		rmdirSync(quarantine);
	}
	async remove(
		record: StorageRecord,
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	) {
		await this.reset(record);
		let observation: StorageObservation;
		do {
			observation = await this.observe(record, signal);
			if (!observation.complete) await yieldToIO();
		} while (!observation.complete);
		if (observation.protection.length)
			throw new Error(observation.protection.join("; "));
		const integrity = record.evidence
			.find((value) => value.startsWith("integrity:"))
			?.slice(10);
		if (!integrity) throw new Error("Artifact ownership proof is unavailable");
		const proof = join(
			this.home,
			"storage-retention",
			"proofs",
			`${record.id}.ndjson`,
		);
		const previous = (await readStorageJson(
			join(this.home, "storage-retention", "receipts", `${record.id}.json`),
		)) as { phase?: string; identity?: StorageIdentity } | undefined;
		const resuming =
			previous?.phase === "removing" &&
			!!previous.identity &&
			sameStorageIdentity(previous.identity, record.identity);
		await verifyStorageIntegrity(
			record.path,
			proof,
			integrity,
			signal,
			resuming,
		);
		await journal("removing");
		if (
			!sameStorageIdentity(
				record.identity,
				await storageIdentity(record.path, record.root),
			)
		)
			throw new Error("Artifact identity changed after journal publication");
		const protections = await this.protections(record);
		if (protections.length) throw new Error(protections.join("; "));
		// No asynchronous publication is allowed between the final identity check
		// and detaching the object. Ordinary writers keep using the public path,
		// never the private, unpredictable quarantine path.
		const quarantine = this.quarantine(record);
		await mkdir(dirname(quarantine), { recursive: true, mode: 0o700 });
		await mkdir(quarantine, { mode: 0o700 });
		const detached = join(quarantine, "payload");
		const identity = (path: string) => {
			const stat = lstatSync(path);
			if (!stat.isDirectory() || stat.isSymbolicLink())
				throw new Error("Artifact directory changed");
			return {
				device: String(stat.dev),
				inode: String(stat.ino),
				birthtime: stat.birthtimeMs,
			};
		};
		try {
			if (!sameStorageIdentity(record.identity, identity(record.path)))
				throw new Error("Artifact identity changed after journal publication");
			renameSync(record.path, detached);
			if (!sameStorageIdentity(record.identity, identity(detached)))
				throw new Error("Detached artifact identity changed");
			await verifyStorageIntegrity(
				detached,
				proof,
				integrity,
				signal,
				resuming,
			);
			// Stream authenticated manifest records. Move each leaf to a private
			// random name before verifying and unlinking it. Never recurse into a
			// directory found by its current public name or remove unknown content.
			const input = createReadStream(proof, { signal });
			const lines = createInterface({ input, crlfDelay: Infinity });
			const directories: { path: string; identity: StorageIdentity }[] = [];
			const ancestors = new Map<string, StorageIdentity>([
				[detached, record.identity],
			]);
			const checkParents = (path: string) => {
				let parent = dirname(path);
				while (parent !== quarantine) {
					const expected = ancestors.get(parent);
					if (!expected || !sameStorageIdentity(expected, identity(parent)))
						throw new Error("Quarantine ancestor changed");
					parent = dirname(parent);
				}
			};
			try {
				for await (const line of lines) {
					signal.throwIfAborted();
					const entry = JSON.parse(line) as {
						path: string;
						kind: string;
						value?: string;
						identity?: StorageIdentity;
					};
					const path = join(detached, entry.path);
					let stat: ReturnType<typeof lstatSync>;
					try {
						stat = lstatSync(path);
					} catch (error) {
						if (resuming && (error as NodeJS.ErrnoException).code === "ENOENT")
							continue;
						throw error;
					}
					checkParents(path);
					if (
						!entry.identity ||
						!sameStorageIdentity(entry.identity, {
							device: String(stat.dev),
							inode: String(stat.ino),
							birthtime: stat.birthtimeMs,
						})
					)
						throw new Error("Artifact object identity changed");
					if (entry.kind === "directory") {
						const expected = identity(path);
						ancestors.set(path, expected);
						directories.push({ path, identity: expected });
						continue;
					}
					const slotId = randomUUID(),
						slot = join(quarantine, slotId);
					await publishStorageJson(join(quarantine, "leaf.json"), {
						source: entry.path,
						slot: slotId,
						identity: entry.identity,
					});
					checkParents(path);
					// Atomic detachment makes subsequent verification refer to the
					// selected leaf even if its former name is replaced concurrently.
					renameSync(path, slot);
					const moved = lstatSync(slot);
					if (
						moved.dev !== stat.dev ||
						moved.ino !== stat.ino ||
						moved.birthtimeMs !== stat.birthtimeMs
					)
						throw new Error("Artifact leaf identity changed");
					let valid = false;
					if (entry.kind === "link" && moved.isSymbolicLink())
						valid = (await readlink(slot)) === entry.value;
					if (
						entry.kind === "file" &&
						moved.isFile() &&
						!moved.isSymbolicLink()
					) {
						const hash = createHash("sha256");
						for await (const bytes of createReadStream(slot, { signal }))
							hash.update(bytes);
						valid = hash.digest("hex") === entry.value;
					}
					if (!valid) throw new Error("Detached artifact content changed");
					const final = lstatSync(slot);
					if (
						final.ino !== moved.ino ||
						final.dev !== moved.dev ||
						final.mtimeMs !== moved.mtimeMs ||
						final.size !== moved.size
					)
						throw new Error("Detached artifact changed during verification");
					unlinkSync(slot);
					unlinkSync(join(quarantine, "leaf.json"));
					await yieldToIO();
				}
			} finally {
				lines.close();
				input.destroy();
			}
			for (const directory of directories.reverse()) {
				checkParents(directory.path);
				if (!sameStorageIdentity(directory.identity, identity(directory.path)))
					throw new Error("Quarantine directory changed");
				rmdirSync(directory.path); // Empty-only: unexpected files survive.
			}
			if (!sameStorageIdentity(record.identity, identity(detached)))
				throw new Error("Quarantine root changed");
			rmdirSync(detached);
			rmdirSync(quarantine);
		} catch (error) {
			// Restore only the original object, never overwrite a newly created path.
			try {
				await this.recover(record);
			} catch {
				/* Preserve quarantine for explicit reconciliation. */
			}
			throw error;
		}
	}
}
