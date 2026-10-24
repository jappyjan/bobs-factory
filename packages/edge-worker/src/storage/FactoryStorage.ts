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
import {
	consumesImpact,
	hasCheck,
	readStep,
	resolveStepConfig,
} from "../factory/StepConfig.js";
import type { WorkflowStep } from "../factory/Workflow.js";
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
		(checkpoint.current !== "end" || !!checkpoint.active) &&
		(Object.values(checkpoint.agentSessions ?? {}).some(
			(agent) => !!agent.sessionId,
		) ||
			!!checkpoint.active?.agent?.sessionId ||
			!!checkpoint.active?.questionExplanation?.agent?.sessionId ||
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
interface ReferencePolicy {
	// Exemptions are scoped to the record currently being traversed.
	snapshots: WeakMap<
		object,
		NonNullable<FactoryRun["impactDecisions"]>[number]["snapshot"]
	>;
	receipts: WeakSet<object>;
	prefix: string;
	step(key: string): WorkflowStep | undefined;
	inFrame(prefix: string): ReferencePolicy;
	enroll(value: unknown, key?: string): ReferencePolicy;
}
function* referencePolicy(run: FactoryRun): Generator<void, ReferencePolicy> {
	const decisions = run.impactDecisions ?? [];

	const steps = new Map<string, WorkflowStep>();
	const collect = function* (
		items: WorkflowStep[],
		prefix = "",
		ancestors: string[] = [],
	): Generator<void> {
		for (const step of items) {
			yield;
			const key = `${prefix}${step.id}`;
			steps.set(key, step);
			for (const [index, group] of (step.groups ?? []).entries())
				yield* collect(group, `${key}/${index}/`, ancestors);
			if (
				step.type === "workflow" &&
				step.workflow &&
				!ancestors.includes(step.workflow)
			) {
				const child = run.workflowDefinitions?.find(
					(w) => w.id === step.workflow,
				);
				if (child)
					yield* collect(child.steps, `${key}/`, [...ancestors, child.id]);
			}
		}
	};
	if (decisions.length)
		yield* collect(run.workflow.steps, "", [run.workflow.id]);
	const prefixOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);
	// A Call frame names imported values by input port; follow the caller's bindings.
	const boundProducer = (prefix: string, name: string): string | undefined => {
		for (let scope = prefix; scope; ) {
			const callKey = scope.slice(0, -1);
			const call = steps.get(callKey);
			const binding =
				call?.type === "workflow" ? call.bindings?.[name] : undefined;
			if (!binding) return undefined;
			scope = prefixOf(callKey);
			if (!binding.startsWith("@bindings/")) return `${scope}${binding}`;
			name = binding.slice("@bindings/".length);
		}
		return undefined;
	};
	const makePolicy = (prefix = ""): ReferencePolicy => {
		const enroll = (value: unknown, key?: string): ReferencePolicy => {
			const policy: ReferencePolicy = {
				snapshots: new WeakMap(),
				receipts: new WeakSet(),
				prefix,
				step: (key) => steps.get(key),
				inFrame: makePolicy,
				enroll,
			};
			if (!value || typeof value !== "object") return policy;
			const record = value as Record<string, unknown>;
			const associated = (decision: (typeof decisions)[number]) => {
				if (key === undefined || prefix === "@unbound/") return undefined;
				const qualified = key.includes("/") ? key : `${prefix}${key}`;
				const exact = steps.get(qualified);
				if (exact) return { step: exact, key: qualified };
				const bound = key.includes("/")
					? undefined
					: boundProducer(prefix, key);
				if (bound && steps.get(bound))
					return { step: steps.get(bound)!, key: bound };
				// Old calls shared a global leaf output map. Only a normalized old
				// producer may recover that alias, and never over an authored root step.
				if (prefix || key.includes("/") || steps.has(key)) return undefined;
				const legacyKey = `${prefixOf(decision.snapshot.key)}${key}`;
				const legacy = steps.get(legacyKey);
				return legacy && !resolveStepConfig(legacy).explicit
					? { step: legacy, key: legacyKey }
					: undefined;
			};
			const assesses = (
				producer: ReturnType<typeof associated>,
				decision: (typeof decisions)[number],
			) =>
				!!producer &&
				hasCheck(producer.step, "impact-reuse") &&
				!!readStep(producer.step, "fanout") &&
				`${prefixOf(producer.key)}${readStep(producer.step, "fanout")}` ===
					decision.snapshot.key;
			if (record.snapshot) {
				const decision = decisions.find(
					(d) =>
						(key === undefined || assesses(associated(d), d)) &&
						storageDigest(record.snapshot) === storageDigest(d.snapshot) &&
						record.at === d.at,
				);
				if (decision) {
					policy.snapshots.set(value, decision.snapshot);
					if (Array.isArray(record.checkResults))
						for (const receipt of record.checkResults)
							if (
								receipt &&
								typeof receipt === "object" &&
								decision.checkResults.some(
									(r) => storageDigest(r) === storageDigest(receipt),
								)
							)
								policy.receipts.add(receipt);
				}
			}
			if (Array.isArray(record.checks))
				for (const receipt of record.checks)
					if (
						receipt &&
						typeof receipt === "object" &&
						decisions.some((d) => {
							const producer = associated(d);
							const source = producer && readStep(producer.step, "impact");
							const sourceKey =
								producer && source
									? `${prefixOf(producer.key)}${source}`
									: undefined;
							const assessor = sourceKey && steps.get(sourceKey);
							return (
								!!producer &&
								producer.step.type === "tool" &&
								producer.step.tool === "impact-checks" &&
								consumesImpact(producer.step) &&
								!!assessor &&
								!!sourceKey &&
								assesses({ step: assessor, key: sourceKey }, d) &&
								d.checkResults.some(
									(r) => storageDigest(r) === storageDigest(receipt),
								)
							);
						})
					)
						policy.receipts.add(receipt);
			return policy;
		};
		return enroll(undefined);
	};
	return makePolicy();
}
type ReferenceLocation =
	| "content"
	| "context"
	| "snapshot"
	| "repositories"
	| "repository"
	| "outputs"
	| "history"
	| "historyEntry"
	| "decisions"
	| "checkpoint"
	| "active"
	| "children"
	| "calls";
/** Stream every retained value and evidence link. Identity metadata is handled by
 * the owning record, while actual content paths remain live dependencies. */
async function* retainedReferences(
	value: unknown,
	workspace: string,
	protection: string[],
	signal?: AbortSignal,
	policy?: ReferencePolicy,
	location: ReferenceLocation = "content",
	identity?: unknown,
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
		const canonical = policy?.snapshots.get(record);
		for (const key in record) {
			if (!Object.hasOwn(record, key)) continue;
			const item = record[key];
			// Only runtime locations and exact enrolled identities have identity semantics.
			// Arbitrary agent output never acquires them from sibling property names.
			if (
				key === "workspace" &&
				item ===
					(location === "context"
						? (identity as { workspace?: string })?.workspace
						: identity) &&
				(location === "context" || location === "repository")
			)
				continue;
			if (key === "evidence" && policy?.receipts.has(record)) continue; // Exact enrolled command receipt at a runtime-owned location.

			let next: ReferenceLocation = "content";
			let nextIdentity: unknown;
			let nextPolicy = policy;
			// Classify at the trusted location while holding this exact loaded record.
			// Paged transcripts may recreate objects after cache eviction.
			if (location === "outputs") nextPolicy = policy?.enroll(item, key);
			if (location === "decisions") nextPolicy = policy?.enroll(item);
			if (location === "history") next = "historyEntry";
			if (
				location === "historyEntry" &&
				key === "output" &&
				typeof record.step === "string"
			)
				nextPolicy = policy?.inFrame("").enroll(item, record.step);
			if (location === "context" || location === "checkpoint") {
				if (key === "outputs") next = "outputs";
				if (location === "context" && key === "history") next = "history";
				if (location === "checkpoint" && key === "active") {
					next = "active";
					nextPolicy = policy?.inFrame(`${policy.prefix}${record.current}`);
				}
			}
			if (location === "checkpoint" && key === "calls") next = "calls";
			// A completed Call keeps its lexical frame, keyed by the Call step.
			if (location === "calls") {
				next = "checkpoint";
				nextPolicy = policy?.inFrame(`${policy.prefix}${key}/`);
			}
			if (location === "active" && key === "children") next = "children";
			if (location === "children") {
				next = "checkpoint";
				const parent = policy?.step(policy.prefix);
				nextPolicy = policy?.inFrame(
					parent?.type === "workflow" && key === "0"
						? `${policy.prefix}/`
						: parent?.groups?.[Number(key)]
							? `${policy.prefix}/${key}/`
							: "@unbound/",
				);
			}
			if (canonical && key === "snapshot") {
				next = "snapshot";
				nextIdentity = canonical;
			}
			if (location === "snapshot" && key === "repositories") {
				next = "repositories";
				nextIdentity = identity;
			}
			if (location === "context" && key === "repositories") {
				next = "repositories";
				nextIdentity = identity;
			}
			if (location === "repositories") {
				const repo = item as Record<string, unknown> | null;
				const candidates =
					typeof identity === "object" && identity && "repositories" in identity
						? (
								identity as {
									repositories: {
										repositoryId?: string;
										id?: string;
										workspace: string;
									}[];
								}
							).repositories
						: [];
				const match = candidates.find(
					(candidate) =>
						repo &&
						(candidate.repositoryId ?? candidate.id) ===
							(repo.repositoryId ?? repo.id) &&
						candidate.workspace === repo.workspace,
				);
				if (match) {
					next = "repository";
					nextIdentity = match.workspace;
				}
			}
			yield* retainedReferences(
				item,
				workspace,
				protection,
				signal,
				nextPolicy,
				next,
				nextIdentity,
			);
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
			const policy = yield* referencePolicy(run);
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
					run.answers,
					run.questionRequests,
					run.questions,
					run.simplePrompt,
					run.simpleExecution,
					run.architectureProposals,
					run.architectureDecisions,
					run.humanDecisions,
					run.events,
					run.reviewGate,
					run.sessionSnapshot,
				],
				workspace,
				protection,
				signal,
				policy,
			);
			for (const [value, location] of [
				[run.outputs, "outputs"],
				[run.history, "history"],
				[run.impactDecisions, "decisions"],
				[run.checkpoint, "checkpoint"],
			] as const)
				yield* retainedReferences(
					value,
					workspace,
					protection,
					signal,
					policy,
					location,
				);
			for (const round of run.reviewRounds ?? []) {
				const context = round.context as Record<string, unknown> | undefined;
				if (context)
					yield* retainedReferences(
						context,
						workspace,
						protection,
						signal,
						policy.inFrame(
							policy.step(round.key)
								? round.key.slice(0, round.key.lastIndexOf("/") + 1)
								: "@unbound/",
						),
						"context",
						run,
					);
			}
			if (!owns) continue;
			owners.push(run);
			await runtime.flush(run.id);
			if (run.status !== "completed" || runtime.isExecuting(run.id))
				protection.push(`Run ${run.id} needs this workspace (${run.status})`);
			if (run.capacityLeaves && Object.keys(run.capacityLeaves).length)
				protection.push(`Run ${run.id} retains capacity or descendant work`);
			if (run.reviewGate?.status === "pending")
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
