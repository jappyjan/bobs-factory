import { execFile } from "node:child_process";
import { lstat, opendir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";
import { promisify } from "node:util";
import {
	type StorageIdentity,
	type StorageRecord,
	sameStorageIdentity,
	storageIdentity,
} from "bobs-factory-core";
import type { StorageAdapter, StorageObservation } from "./StorageRetention.js";
import type { StorageUsage } from "./StorageUsage.js";

const runFile = promisify(execFile);
export interface RetainedWorkspaceProof {
	path: string;
	repository: string;
	root: string;
	creator: string;
	identity?: StorageIdentity;
	completedAt?: string;
	mergedHead?: string;
	mergeConfirmed: boolean;
	/** All owners, including retained native/evidence references, must independently release use. */
	protection: string[];
}
export interface WorkspaceInspection {
	proofs: RetainedWorkspaceProof[];
	entries: number;
	complete: boolean;
}
export interface WorkspaceRetentionSource {
	close?(): Promise<void>;
	reset?(path: string): Promise<void>;
	generation?(): number;
	inspect(
		path: string,
		signal?: AbortSignal,
		bounds?: { maxEntries?: number; deadline?: number },
	): Promise<RetainedWorkspaceProof[] | WorkspaceInspection>;
	remove(
		proofs: RetainedWorkspaceProof[],
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	): Promise<void>;
}
/** Gitignore never authorizes disposal: ignored files are included in status. */
export class WorktreeArtifacts implements StorageAdapter {
	private states = new Map<
		string,
		{
			generation?: number;
			iterator: AsyncGenerator<number, StorageObservation>;
			pending?: Promise<IteratorResult<number, StorageObservation>>;
		}
	>();
	async reset(record: StorageRecord) {
		const state = this.states.get(record.id);
		if (state) {
			await state.pending;
			await state.iterator.return({ record, protection: [], complete: false });
		}
		this.states.delete(record.id);
		await this.source.reset?.(record.path);
	}
	async observe(
		record: StorageRecord,
		signal: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number; members?: string[] } = {},
	): Promise<StorageObservation> {
		let state = this.states.get(record.id);
		if (state && state.generation !== this.source.generation?.()) {
			await this.reset(record);
			state = undefined;
		}
		if (!state) {
			state = {
				generation: this.source.generation?.(),
				iterator: this.observeAll(record, signal, bounds.members),
			};
			this.states.set(record.id, state);
		}
		const deadline = bounds.deadline ?? performance.now() + 1000;
		let entries = 100;
		while (
			entries < Math.max(100, (bounds.maxEntries ?? 1000) - 100) &&
			performance.now() < deadline
		) {
			signal.throwIfAborted();
			state.pending ??= state.iterator.next();
			let timer: ReturnType<typeof setTimeout> | undefined;
			let next: IteratorResult<number, StorageObservation> | undefined;
			try {
				next = await Promise.race([
					state.pending,
					new Promise<undefined>((resolve) => {
						timer = setTimeout(
							() => resolve(undefined),
							Math.max(1, deadline - performance.now()),
						);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
			if (!next) break; // Keep the exact in-flight operation for the next slice.
			state.pending = undefined;
			if (next.done) {
				this.states.delete(record.id);
				if (state.generation !== this.source.generation?.())
					return {
						record,
						complete: false,
						protection: [],
						filesystemEntries: entries,
					};
				return { ...next.value, filesystemEntries: entries };
			}
			entries += next.value;
		}
		return {
			record,
			protection: [],
			complete: false,
			filesystemEntries: entries,
		};
	}
	constructor(
		private readonly source: WorkspaceRetentionSource,
		private readonly environment: NodeJS.ProcessEnv,
		private readonly usage?: StorageUsage,
	) {}
	async close() {
		for (const state of this.states.values()) {
			await state.pending?.catch(() => {});
			await state.iterator.return(undefined as never);
		}
		this.states.clear();
		await this.usage?.close();
		await this.source.close?.();
	}
	private async git(path: string, args: string[], signal: AbortSignal) {
		return (
			await runFile("git", ["-C", path, ...args], {
				env: this.environment,
				signal,
				timeout: 30_000,
				maxBuffer: 1024 * 1024,
			})
		).stdout.trim();
	}
	private async *observeAll(
		record: StorageRecord,
		signal: AbortSignal,
		members?: string[],
	): AsyncGenerator<number, StorageObservation> {
		signal.throwIfAborted();
		const protection: string[] = [];
		let mapping: RetainedWorkspaceProof[];
		while (true) {
			const inspected = await this.source.inspect(record.path, signal, {
				maxEntries: 100,
				deadline: performance.now() + 1000,
			});
			if (Array.isArray(inspected)) {
				mapping = inspected;
				break;
			}
			yield inspected.entries;
			if (inspected.complete) {
				mapping = inspected.proofs;
				break;
			}
		}

		const proofs = members
			? mapping.filter((proof) => members.includes(proof.path))
			: mapping;
		if (!proofs.length)
			protection.push(
				"Workspace ownership and retained owner inventory are unavailable",
			);
		if (
			!sameStorageIdentity(
				record.identity,
				await storageIdentity(record.path, record.root),
			)
		)
			protection.push("Workspace identity changed");
		for (const proof of proofs) {
			yield 1;
			signal.throwIfAborted();
			protection.push(...proof.protection);
			if (!proof.creator || resolve(proof.root) !== resolve(record.root))
				protection.push("Creator or configured workspace root is unverified");
			if (!proof.completedAt || !proof.mergeConfirmed || !proof.mergedHead)
				protection.push(
					"Durable completion and exact provider-confirmed delivery are required",
				);
			const suffix = relative(record.path, proof.path);
			if (
				suffix === ".." ||
				suffix.startsWith(`..${sep}`) ||
				suffix.startsWith("/")
			) {
				protection.push("Repository mapping escapes workspace group");
				continue;
			}
			try {
				const identity = await storageIdentity(proof.path, proof.root);
				if (!proof.identity || !sameStorageIdentity(identity, proof.identity))
					throw new Error(
						"Member filesystem identity is unavailable or changed",
					);
				const admin = join(proof.path, ".git"),
					stat = await lstat(admin);
				if (!stat.isFile() || stat.isSymbolicLink())
					throw new Error("Git administration is not a linked worktree file");
				const text = await readFile(admin, "utf8");
				if (!text.startsWith("gitdir: "))
					throw new Error("Invalid Git administration");
				const common = await this.git(
					proof.path,
					["rev-parse", "--path-format=absolute", "--git-common-dir"],
					signal,
				);
				const repositoryCommon = await this.git(
					proof.repository,
					["rev-parse", "--path-format=absolute", "--git-common-dir"],
					signal,
				);
				if (common !== repositoryCommon)
					throw new Error("Source repository identity differs");
				if (
					await this.git(
						proof.path,
						[
							"status",
							"--porcelain=v1",
							"--untracked-files=all",
							"--ignored=matching",
						],
						signal,
					)
				)
					protection.push(
						"Tracked changes, untracked files or unique ignored content remain",
					);
				if (
					await this.git(
						proof.path,
						["submodule", "status", "--recursive"],
						signal,
					)
				)
					protection.push("Submodule content needs explicit retention proof");
				const head = await this.git(proof.path, ["rev-parse", "HEAD"], signal);
				if (head !== proof.mergedHead)
					protection.push("Local commits differ from the delivered revision");
				// A merge receipt alone does not establish durable object retention in the source repository.
				if (proof.mergedHead)
					await this.git(
						proof.repository,
						["cat-file", "-e", `${proof.mergedHead}^{commit}`],
						signal,
					);
			} catch (error) {
				protection.push(
					`Cannot verify Git contents: ${String(error).slice(0, 500)}`,
				);
			}
		}
		if (mapping.length > 1) {
			const directory = await opendir(record.path);
			for await (const entry of directory) {
				yield 1;
				signal.throwIfAborted();
				if (
					!proofs.some(
						(proof) =>
							dirname(proof.path) === record.path &&
							proof.path === join(record.path, entry.name),
					)
				)
					protection.push(
						"Unexpected parent-level content retains the workspace group",
					);
				break;
			}
		}
		const completedAt =
			proofs.length && proofs.every((proof) => proof.completedAt)
				? new Date(
						Math.max(...proofs.map((proof) => Date.parse(proof.completedAt!))),
					).toISOString()
				: record.completedAt;
		let usage: Awaited<ReturnType<StorageUsage["step"]>> | undefined;
		if (this.usage) {
			do {
				usage = await this.usage.step(record, signal, {
					maxEntries: 100,
					deadline: performance.now() + 1000,
				});
				yield usage.entries;
				if (!usage.complete) await yieldToIO();
			} while (!usage.complete);
		}
		return {
			filesystemEntries: usage?.entries ?? 0,
			apparentBytes: usage?.apparentBytes,
			usageObservedAt: usage?.usageObservedAt,
			record: {
				...record,
				completedAt,
				verifiedAt: protection.length ? record.verifiedAt : completedAt,
				reconciledAt: protection.length ? record.reconciledAt : completedAt,
			},
			complete: usage?.complete ?? true,
			protection: [...new Set(protection)].slice(0, 20),
		};
	}
	async remove(
		record: StorageRecord,
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	) {
		await this.reset(record);
		let fresh: StorageObservation;
		do {
			fresh = await this.observe(record, signal);
			if (!fresh.complete) await yieldToIO();
		} while (!fresh.complete);
		if (fresh.protection.length) throw new Error(fresh.protection.join("; "));
		let mapping: RetainedWorkspaceProof[];
		while (true) {
			const inspected = await this.source.inspect(record.path, signal);
			if (Array.isArray(inspected)) {
				mapping = inspected;
				break;
			}
			if (inspected.complete) {
				mapping = inspected.proofs;
				break;
			}
			await yieldToIO();
		}
		await this.source.remove(mapping, signal, journal);
	}
}
