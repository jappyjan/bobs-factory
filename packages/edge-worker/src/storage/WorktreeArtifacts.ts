import { execFile } from "node:child_process";
import { lstat, opendir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
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
export interface WorkspaceRetentionSource {
	inspect(
		path: string,
		signal?: AbortSignal,
	): Promise<RetainedWorkspaceProof[]>;
	remove(
		proofs: RetainedWorkspaceProof[],
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	): Promise<void>;
}
/** Gitignore never authorizes disposal: ignored files are included in status. */
export class WorktreeArtifacts implements StorageAdapter {
	constructor(
		private readonly source: WorkspaceRetentionSource,
		private readonly environment: NodeJS.ProcessEnv,
		private readonly usage?: StorageUsage,
	) {}
	async close() {
		await this.usage?.close();
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
	async observe(
		record: StorageRecord,
		signal: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number; members?: string[] } = {},
	): Promise<StorageObservation> {
		signal.throwIfAborted();
		const protection: string[] = [];
		const inspectionSignal = bounds.deadline
			? AbortSignal.any([
					signal,
					AbortSignal.timeout(
						Math.max(1, Math.ceil(bounds.deadline - performance.now())),
					),
				])
			: signal;
		const mapping = await this.source.inspect(record.path, inspectionSignal);
		const proofs = bounds.members
			? mapping.filter((proof) => bounds.members!.includes(proof.path))
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
					inspectionSignal,
				);
				const repositoryCommon = await this.git(
					proof.repository,
					["rev-parse", "--path-format=absolute", "--git-common-dir"],
					inspectionSignal,
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
						inspectionSignal,
					)
				)
					protection.push(
						"Tracked changes, untracked files or unique ignored content remain",
					);
				if (
					await this.git(
						proof.path,
						["submodule", "status", "--recursive"],
						inspectionSignal,
					)
				)
					protection.push("Submodule content needs explicit retention proof");
				const head = await this.git(
					proof.path,
					["rev-parse", "HEAD"],
					inspectionSignal,
				);
				if (head !== proof.mergedHead)
					protection.push("Local commits differ from the delivered revision");
				// A merge receipt alone does not establish durable object retention in the source repository.
				if (proof.mergedHead)
					await this.git(
						proof.repository,
						["cat-file", "-e", `${proof.mergedHead}^{commit}`],
						inspectionSignal,
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
			}
		}
		const completedAt =
			proofs.length && proofs.every((proof) => proof.completedAt)
				? new Date(
						Math.max(...proofs.map((proof) => Date.parse(proof.completedAt!))),
					).toISOString()
				: record.completedAt;
		const usage = await this.usage?.step(record, signal, bounds);
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
			protection: [...new Set(protection)],
		};
	}
	async remove(
		record: StorageRecord,
		signal: AbortSignal,
		journal: (phase: string) => Promise<void>,
	) {
		const fresh = await this.observe(record, signal);
		if (fresh.protection.length) throw new Error(fresh.protection.join("; "));
		await this.source.remove(
			await this.source.inspect(record.path, signal),
			signal,
			journal,
		);
	}
}
