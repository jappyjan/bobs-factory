import { lstat, opendir, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";
import {
	publishStorageJson,
	readStorageJson,
	type StorageIdentity,
	StorageRetentionStore,
	storageDigest,
} from "bobs-factory-core";
import { digest } from "../factory/EvidenceDigest.js";
import { stepForRun } from "../factory/ToolBindings.js";

import type {
	FactoryRun,
	GraphCheckpoint,
	WorkflowRuntime,
} from "../factory/WorkflowRuntime.js";
import type { GitService } from "../GitService.js";
import { MigrationArtifacts } from "./MigrationArtifacts.js";
import { StorageRetention } from "./StorageRetention.js";
import { StorageUsage } from "./StorageUsage.js";
import {
	type RetainedWorkspaceProof,
	WorktreeArtifacts,
} from "./WorktreeArtifacts.js";

interface StorageHooks {
	/** Uses the run's accepted provider and execution environment. Never chooses a new provider. */
	verifyDelivery?(
		run: FactoryRun,
		repositoryId: string,
		approved: { url: string; headSha: string },
		signal?: AbortSignal,
	): Promise<boolean>;
	protection?(workspace: string): string[] | Promise<string[]>;
	removeWorkspace?(
		run: FactoryRun,
		workspace: string,
		proofs: RetainedWorkspaceProof[],
		signal: AbortSignal,
		revalidate: (remaining?: string[]) => Promise<void>,
		journal: (phase: string) => Promise<void>,
		issueIdentifier: string,
	): Promise<void>;
}
function hasNative(checkpoint?: GraphCheckpoint): boolean {
	return (
		!!checkpoint &&
		(checkpoint.current !== "end" || !!checkpoint.active) &&
		(Object.values(checkpoint.agentSessions ?? {}).some(
			(agent) => !!agent.sessionId,
		) ||
			!!checkpoint.active?.agent?.sessionId ||
			!!checkpoint.active?.children?.some((child) => hasNative(child)))
	);
}
class ProtectionReasons extends Array<string> {
	total = 0;
	override push(...values: string[]) {
		this.total += values.length;
		for (const value of values)
			if (this.length < 20 && !this.includes(value)) super.push(value);
		return this.length;
	}
}
/** Stream every retained value and evidence link. Identity metadata is handled by
 * the owning record, while actual content paths remain live dependencies. */
async function* retainedReferences(
	value: unknown,
	workspace: string,
	protection: string[],
	signal?: AbortSignal,
): AsyncGenerator<void> {
	signal?.throwIfAborted();
	if (value === undefined || value === null) return;
	yield;
	if (typeof value === "string") {
		if (value.includes(workspace)) {
			protection.push(
				"Retained input, output or evidence references this workspace",
			);
			return;
		}
		if (value.startsWith("/") && !value.includes("\n")) {
			try {
				const target = await realpath(value);
				if (target === workspace || target.startsWith(`${workspace}${sep}`))
					protection.push(
						"Retained evidence link resolves into this workspace",
					);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					protection.push("Retained path dependency cannot be inspected");
			}
		}
	} else if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const key in record) {
			if (Object.hasOwn(record, key))
				yield* retainedReferences(record[key], workspace, protection, signal);
		}
	}
}
async function* evidenceReferences(
	path: string,
	workspace: string,
	protection: string[],
	signal?: AbortSignal,
): AsyncGenerator<void> {
	signal?.throwIfAborted();
	yield;
	try {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			yield* retainedReferences(path, workspace, protection, signal);
		} else if (stat.isDirectory()) {
			const directory = await opendir(path);
			for await (const entry of directory)
				yield* evidenceReferences(
					join(path, entry.name),
					workspace,
					protection,
					signal,
				);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			protection.push("Evidence dependency inventory is unreadable");
	}
}

/** Runtime memory, retained state and durable reservations are consulted again
 * under the deletion claim. No provider conversation is assumed cwd-independent. */
export function factoryStorage(
	runtime: WorkflowRuntime,
	git: GitService,
	hooks: StorageHooks = {},
) {
	const home = dirname(runtime.directory),
		store = new StorageRetentionStore(home);
	const inspectAll = async function* (
		workspace: string,
		signal?: AbortSignal,
	): AsyncGenerator<void, RetainedWorkspaceProof[]> {
		const descriptor = (await readStorageJson(
			join(
				store.directory,
				"workspaces",
				`${storageDigest(resolve(workspace))}.json`,
			),
		)) as
			| {
					recordId: string;
					issueIdentifier: string;
					repositories: {
						id: string;
						repository: string;
						path: string;
						root: string;
						creator: string;
						identity?: StorageIdentity;
					}[];
			  }
			| undefined;
		if (!descriptor) return [];
		const owners: FactoryRun[] = [];
		const protection = new ProtectionReasons();
		protection.push(
			...((await hooks.protection?.(workspace)) ?? [
				"Active process and descendant ownership is unavailable",
			]),
		);
		for (const run of runtime.runs.values()) {
			signal?.throwIfAborted();
			yield;
			const owns =
				run.workspace === workspace ||
				run.workspace.startsWith(`${workspace}${sep}`) ||
				run.repositories?.some(
					(repo) =>
						repo.workspace === workspace ||
						repo.workspace.startsWith(`${workspace}${sep}`),
				);
			// References are independent of ownership, including stopped and completed runs.
			yield* retainedReferences(
				[
					run.input,
					run.launchInputs,
					run.launchAttachments,
					run.repositoryOutputs,
					(run as unknown as Record<string, unknown>).answers,
					(run as unknown as Record<string, unknown>).questionRequests,
					(run as unknown as Record<string, unknown>).questions,
					run.simplePrompt,
					run.simpleExecution,
					(run as unknown as Record<string, unknown>).architectureProposals,
					(run as unknown as Record<string, unknown>).architectureDecisions,
					(run as unknown as Record<string, unknown>).humanDecisions,
					(run as unknown as Record<string, unknown>).reviewRounds,
					(run as unknown as Record<string, unknown>).impactDecisions,
					(run as unknown as Record<string, unknown>).delivery,
					run.viewRecords,
					run.events,
					(run as unknown as Record<string, unknown>).reviewGate,
					run.sessionSnapshot,
				],
				workspace,
				protection,
				signal,
			);
			for (const value of [
				run.outputs,
				run.history,

				run.checkpoint,
			] as const)
				yield* retainedReferences(value, workspace, protection, signal);
			if (!owns) continue;
			owners.push(run);
			await runtime.flush(run.id);
			if (run.status !== "completed" || runtime.isExecuting(run.id))
				protection.push(`Run ${run.id} needs this workspace (${run.status})`);
			if (run.capacityLeaves && Object.keys(run.capacityLeaves).length)
				protection.push(`Run ${run.id} retains capacity or descendant work`);
			if (run.viewDecision && !run.viewDecision.answer)
				protection.push(`Run ${run.id} is awaiting human review`);
			if (
				hasNative(run.checkpoint) ||
				run.simpleExecution?.agent?.sessionId ||
				run.sessionSnapshot
			)
				protection.push(
					`Run ${run.id}: native continuation has not been proven independent of this directory`,
				);
		}
		if (!owners.length)
			protection.push("No retained run proves complete workspace ownership");
		yield* evidenceReferences(
			join(runtime.directory, "evidence"),
			workspace,
			protection,
			signal,
		);
		const uses: { file: string; owner?: string; state?: string }[] = [];
		try {
			const directory = await opendir(
				join(
					store.directory,
					"workspace-use",
					storageDigest(resolve(workspace)),
				),
			);
			for await (const entry of directory) {
				yield;
				signal?.throwIfAborted();
				const file = join(directory.path, entry.name),
					use = (await readStorageJson(file)) as
						| { state?: string; owner?: string }
						| undefined;
				uses.push({ file, ...use });
				if (
					use?.state !== "released" &&
					(!use?.owner ||
						!owners.some(
							(run) => run.id === use.owner || run.issueId === use.owner,
						))
				)
					protection.push(
						`Saved reservation ${use?.owner ?? "unknown owner"} needs independent release proof`,
					);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				protection.push("Workspace reservation inventory is unreadable");
		}
		const completedAt = owners.length
			? new Date(
					Math.max(...owners.map((run) => Date.parse(run.updatedAt))),
				).toISOString()
			: undefined;
		const proofs: RetainedWorkspaceProof[] = [];
		for (const repo of descriptor.repositories) {
			yield;
			const reasons = [...new Set(protection)].slice(0, 20);
			if (protection.total > 20)
				reasons.push(
					`${protection.total} protection observations; inspect retained runs and evidence`,
				);
			let mergedHead: string | undefined;
			for (const run of owners) {
				yield;
				// Only a completed merge node with a stamped provider head is delivery evidence.
				const approved = [...run.history].reverse().flatMap((receipt) => {
					if (
						!receipt.guarantee ||
						receipt.guarantee.outputDigest !== digest(receipt.output)
					)
						return [];
					const step = stepForRun(run, receipt.step);
					const headSha = receipt.guarantee?.revisions[repo.id]?.headSha;
					const output = receipt.output as
						| {
								repositories?: {
									repositoryId: string;
									merged: boolean;
									url: string;
								}[];
						  }
						| undefined;
					const result = output?.repositories?.find(
						(item) => item.repositoryId === repo.id && item.merged,
					);
					return step?.type === "merge" && result && headSha
						? [{ url: result.url, headSha }]
						: [];
				})[0];
				if (!approved || !hooks.verifyDelivery) {
					reasons.push(
						`Run ${run.id}: exact delivered revision is unavailable`,
					);
					continue;
				}
				try {
					if (
						!(await new Promise<boolean>((resolve, reject) => {
							const abort = () =>
								reject(
									signal?.reason ?? new Error("Storage inspection cancelled"),
								);
							signal?.addEventListener("abort", abort, { once: true });
							if (signal?.aborted) {
								abort();
								return;
							}
							void hooks.verifyDelivery!(
								run,
								repo.id,
								approved,
								signal
									? AbortSignal.any([signal, AbortSignal.timeout(1000)])
									: AbortSignal.timeout(1000),
							)
								.then(resolve, reject)
								.finally(() => signal?.removeEventListener("abort", abort));
						}))
					)
						reasons.push(
							`Run ${run.id}: provider has not confirmed this exact merge`,
						);
					else if (mergedHead && mergedHead !== approved.headSha)
						reasons.push("Sharing runs delivered different local revisions");
					else mergedHead = approved.headSha;
				} catch {
					reasons.push(
						`Run ${run.id}: provider merge proof is unavailable; restore access and retry`,
					);
				}
			}
			proofs.push({
				...repo,
				completedAt,
				mergedHead,
				mergeConfirmed: !!mergedHead && reasons.length === 0,
				protection: reasons,
			});
		}
		if (
			proofs.length &&
			proofs.every((proof) => proof.mergeConfirmed && !proof.protection.length)
		) {
			// Explicit retention semantics: only identity fields remain in retained
			// runs; all content/native dependencies were checked above. Preserve the
			// original run, decisions, gate and evidence rather than rewriting paths.
			await publishStorageJson(
				join(
					store.directory,
					"workspace-releases",
					`${descriptor.recordId}.json`,
				),
				{
					version: 1,
					workspace,
					completedAt,
					owners: owners.map((run) => ({
						id: run.id,
						revision: run.updatedAt,
					})),
					repositories: proofs.map((proof) => ({
						path: proof.path,
						mergedHead: proof.mergedHead,
					})),
					semantics:
						"Identity references retained; content and native dependencies independently absent",
				},
			);
			for (const use of uses)
				await publishStorageJson(use.file, {
					version: 1,
					owner: use.owner,
					workspace,
					state: "released",
					updatedAt: new Date().toISOString(),
					reason: "Verified workspace release",
					recordId: descriptor.recordId,
				});
		}
		return proofs;
	};
	let generation = 0;
	const pending = new Map<
		string,
		{
			generation: number;
			iterator: AsyncGenerator<void, RetainedWorkspaceProof[]>;
		}
	>();
	const unsubscribe = runtime.subscribe(() => {
		generation++;
	});
	const inspect = async (
		workspace: string,
		signal?: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number } = {},
	) => {
		let state = pending.get(workspace);
		if (state && state.generation !== generation) {
			await state.iterator.return([]);
			pending.delete(workspace);
			state = undefined;
		}
		if (!state) {
			state = { generation, iterator: inspectAll(workspace, signal) };
			pending.set(workspace, state);
		}
		let entries = 0;
		const deadline = bounds.deadline ?? performance.now() + 1000;
		while (
			entries < (bounds.maxEntries ?? 1000) &&
			performance.now() < deadline
		) {
			signal?.throwIfAborted();
			const next = await state.iterator.next();
			entries++;
			if (next.done) {
				pending.delete(workspace);
				if (state.generation !== generation)
					return { proofs: [], entries, complete: false };
				return { proofs: next.value, entries, complete: true };
			}
		}
		await publishStorageJson(
			join(
				store.directory,
				"workspace-inspection",
				`${storageDigest(workspace)}.json`,
			),
			{
				workspace,
				complete: false,
				observedEntries: entries,
				restart:
					"Reinspect retained dependencies from the beginning after restart",
			},
		);
		return { proofs: [], entries, complete: false };
	};

	const worktrees = new WorktreeArtifacts(
		{
			inspect,
			generation: () => generation,
			finished: (workspace) =>
				![...runtime.runs.values()].some(
					(run) =>
						(run.workspace === workspace ||
							run.workspace.startsWith(`${workspace}${sep}`) ||
							run.repositories?.some(
								(repo) =>
									repo.workspace === workspace ||
									repo.workspace.startsWith(`${workspace}${sep}`),
							)) &&
						!runtime.runFinished(run.id),
				),
			reset: async (workspace) => {
				const state = pending.get(workspace);
				if (state) await state.iterator.return([]);
				pending.delete(workspace);
			},
			close: async () => {
				unsubscribe();
				for (const state of pending.values()) await state.iterator.return([]);
				pending.clear();
			},
			remove: async (proofs, signal, journal) => {
				const workspace =
					proofs.length === 1 ? proofs[0]!.path : dirname(proofs[0]!.path);
				const revalidate = async (remaining?: string[]) => {
					const descriptor = (await readStorageJson(
						join(
							store.directory,
							"workspaces",
							`${storageDigest(resolve(workspace))}.json`,
						),
					)) as { recordId: string };
					await worktrees.reset(await store.record(descriptor.recordId));
					let checked: Awaited<ReturnType<WorktreeArtifacts["observe"]>>;
					do {
						checked = await worktrees.observe(
							await store.record(descriptor.recordId),
							signal,
							{ members: remaining },
						);
						if (!checked.complete) await yieldToIO();
					} while (!checked.complete);
					if (checked.protection.length)
						throw new Error(checked.protection.join("; "));
				};
				const descriptor = (await readStorageJson(
					join(
						store.directory,
						"workspaces",
						`${storageDigest(resolve(workspace))}.json`,
					),
				)) as { issueIdentifier: string };
				const owner = [...runtime.runs.values()].find(
					(run) => run.workspace === workspace,
				);
				if (owner && hooks.removeWorkspace)
					await hooks.removeWorkspace(
						owner,
						workspace,
						proofs,
						signal,
						revalidate,
						journal,
						descriptor.issueIdentifier,
					);
				else
					await git.removeRetainedWorktrees(
						workspace,
						proofs,
						descriptor.issueIdentifier,
						signal,
						revalidate,
						journal,
					);
			},
		},
		process.env,
		new StorageUsage(store.directory),
	);
	return new StorageRetention(home, {
		migration: new MigrationArtifacts(home),
		worktree: worktrees,
	});
}
