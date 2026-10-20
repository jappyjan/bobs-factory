import { opendir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
	publishStorageJson,
	readStorageJson,
	type StorageIdentity,
	StorageRetentionStore,
	storageDigest,
} from "bobs-factory-core";
import type {
	FactoryRun,
	GraphCheckpoint,
	WorkflowRuntime,
} from "../factory/WorkflowRuntime.js";
import type { GitService } from "../GitService.js";
import { StorageRetention } from "./StorageRetention.js";
import { StorageUsage } from "./StorageUsage.js";
import { UpdateArtifacts } from "./UpdateArtifacts.js";
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
		(Object.values(checkpoint.agentSessions ?? {}).some(
			(agent) => !!agent.sessionId,
		) ||
			!!checkpoint.active?.agent?.sessionId ||
			!!checkpoint.active?.questionExplanation?.agent?.sessionId ||
			!!checkpoint.active?.children?.some((child) => hasNative(child)))
	);
}
/** Bounded reference inspection fails closed rather than materializing unbounded transcripts. */
function retainedReference(value: unknown, workspace: string): boolean {
	let remaining = 1000;
	const visit = (entry: unknown): boolean => {
		if (--remaining < 0) return true;
		if (typeof entry === "string") return entry.includes(workspace);
		return (
			!!entry && typeof entry === "object" && Object.values(entry).some(visit)
		);
	};
	return visit(value);
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
	const inspect = async (
		workspace: string,
		signal?: AbortSignal,
	): Promise<RetainedWorkspaceProof[]> => {
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
		const owners = [...runtime.runs.values()].filter(
			(run) =>
				run.workspace === workspace ||
				run.workspace.startsWith(`${workspace}${sep}`) ||
				run.repositories?.some(
					(repo) =>
						repo.workspace === workspace ||
						repo.workspace.startsWith(`${workspace}${sep}`),
				),
		);
		const protection: string[] = [
			...((await hooks.protection?.(workspace)) ?? [
				"Active process and descendant ownership is unavailable",
			]),
		];
		if (!owners.length)
			protection.push("No retained run proves complete workspace ownership");
		for (const run of owners) {
			signal?.throwIfAborted();
			await runtime.flush(run.id);
			if (run.status !== "completed" || runtime.isExecuting(run.id))
				protection.push(`Run ${run.id} needs this workspace (${run.status})`);
			if (run.capacityLeaves && Object.keys(run.capacityLeaves).length)
				protection.push(`Run ${run.id} retains capacity or descendant work`);
			if (
				run.reviewGate ||
				run.reviewRounds?.length ||
				Object.keys(run.roleRevisions ?? {}).length ||
				run.outputs.guide
			)
				protection.push(
					`Run ${run.id}: retained review state has not been proven independent of this workspace`,
				);
			if (
				hasNative(run.checkpoint) ||
				run.simpleExecution?.agent?.sessionId ||
				run.sessionSnapshot
			)
				protection.push(
					`Run ${run.id}: native continuation has not been proven independent of this directory`,
				);
			if (
				retainedReference(
					[run.outputs, run.input, run.launchAttachments],
					workspace,
				)
			)
				protection.push(
					`Run ${run.id}: retained input, output or evidence still references this workspace`,
				);
		}
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
				if (uses.length >= 100) {
					protection.push("Workspace owner inventory exceeds this scan slice");
					break;
				}
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
			const reasons = [...protection];
			let mergedHead: string | undefined;
			for (const run of owners) {
				const approval = run.humanDecisions?.at(-1);
				const approved =
					approval?.decision === "approve"
						? (approval.repositories?.find(
								(item) => item.repositoryId === repo.id,
							) ??
							(run.repositoryId === repo.id && approval.url
								? { url: approval.url, headSha: approval.headSha }
								: undefined))
						: undefined;
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
							void hooks.verifyDelivery!(run, repo.id, approved, signal)
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
	const worktrees = new WorktreeArtifacts(
		{
			inspect,
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
					const checked = await worktrees.observe(
						await store.record(descriptor.recordId),
						signal,
						{ members: remaining },
					);
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
	const updates = new UpdateArtifacts(home);
	return new StorageRetention(home, {
		snapshot: updates,
		staging: updates,
		preparation: updates,
		recovery: updates,
		migration: updates,
		worktree: worktrees,
	});
}
