import { existsSync } from "node:fs";
import { join } from "node:path";
import { digest } from "./EvidenceDigest.js";
import { foreachPointer } from "./Foreach.js";
import { nodeEffect } from "./nodes/metadata.js";
import { runRepositories } from "./RepositoryScope.js";
import { snapshotForRead } from "./RepositorySnapshot.js";
import { captureRepositoryRevisions } from "./RevisionBinding.js";
import { stepBindings } from "./StepBindings.js";
import { accessMode, resolveStepConfig } from "./StepConfig.js";
import { producerKey, stepForRun } from "./ToolBindings.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** A provider may report only HEAD; local observations also cover uncommitted changes. */
export type NodeRevisions = Record<
	string,
	{
		headSha: string;
		workspaceDigest?: string;
		paths?: string[];
		scopedDigest?: string;
		unobservable?: true;
	}
>;
export interface NodeGuarantee {
	version: 1;
	revisions: NodeRevisions;
	/** Keep distinct inherited scopes when several producers cover one repository. */
	revisionChecks?: Record<string, NodeRevisions>;
	boundDigests: Record<string, string>;
	/** Repository observations owned by this node, rather than inherited reads. */
	observedRepositories?: string[];
	scope: {
		outputs: Record<string, string>;
		callInputs?: ExecutionContext["callInputs"];
		iteration?: ExecutionContext["iteration"];
		historyLength: number;
	};
	outputDigest?: string;
	/** Node-owned pure state, committed atomically with its output receipt. */
	state?: unknown;
}
type Receipt = FactoryRun["history"][number];
const prefixOf = (key: string) => key.replace(/[^/]+$/, "");
export function nodeReference(
	context: ExecutionContext,
	reference: string,
): string {
	return reference.startsWith("/")
		? reference.slice(1)
		: producerKey(
				context.run,
				prefixOf(context.stepKey ?? context.step.id),
				reference,
			);
}
export function latestNodeReceipt(
	context: ExecutionContext,
	key: string,
): Receipt | undefined {
	const index = context.historyIndex?.();
	if (index) {
		for (let i = index.length - 1; i >= 0; i--)
			if (index[i]!.step === key) return context.run.history[i];
		return undefined;
	}
	for (let i = context.run.history.length - 1; i >= 0; i--)
		if (context.run.history[i]!.step === key) return context.run.history[i];
	return undefined;
}
function receiptDigest(receipt: Receipt): string {
	return digest({
		output: receipt.output,
		inputDigest: receipt.inputDigest,
		revisions: receipt.guarantee?.revisions,
		revisionChecks: receipt.guarantee?.revisionChecks,
		boundDigests: receipt.guarantee?.boundDigests,
	});
}

/** Capture failures invalidate evidence without preventing ordinary node execution. */
export async function observeNodeRevisions(
	context: ExecutionContext,
	paths?: string[],
	snapshot?: ReturnType<typeof snapshotForRead>,
): Promise<NodeRevisions> {
	context.signal.throwIfAborted();
	const repositories = runRepositories(context.run).filter((repo) =>
		existsSync(join(repo.workspace, ".git")),
	);
	const entries = await Promise.all(
		repositories.map(async (repo) => {
			try {
				const [revision] = await captureRepositoryRevisions(
					{
						run: { ...context.run, repositories: [repo] },
					},
					snapshot && {
						...snapshot,
						repositories: snapshot.repositories.filter(
							(item) => item.id === repo.id,
						),
					},
					paths,
				);
				const { headSha, workspaceDigest, treeSha } = revision!;
				return [
					repo.id,
					{
						headSha,
						workspaceDigest,
						...(paths
							? { paths, scopedDigest: digest({ treeSha, workspaceDigest }) }
							: {}),
					},
				] as const;
			} catch {
				return [
					repo.id,
					{ headSha: "unobservable", unobservable: true as const },
				] as const;
			}
		}),
	);
	context.signal.throwIfAborted();
	return Object.fromEntries(entries);
}

/** Owned by one evaluation/step attempt; never shared across steps or mutations. */
export function nodeRevisionObserver(context: ExecutionContext) {
	const observations = new Map<string, Promise<NodeRevisions>>();
	return (paths?: string[], snapshot?: ReturnType<typeof snapshotForRead>) => {
		const key = digest({ paths, snapshot });
		let observed = observations.get(key);
		if (!observed) {
			observed = observeNodeRevisions(context, paths, snapshot);
			observations.set(key, observed);
		}
		return observed;
	};
}
type RevisionObserver = ReturnType<typeof nodeRevisionObserver>;

/** Pointers are into declared reads, matching the /inputs convention of Check. */
function revisionPaths(context: ExecutionContext): string[] | undefined {
	const scope = context.step.revisionScope;
	if (!scope || typeof scope === "string") return;
	let paths: unknown = scope.paths;
	if (!Array.isArray(paths)) {
		paths = foreachPointer(
			{ inputs: stepBindings(context) },
			(paths as { from: string }).from,
		);
	}
	if (
		!Array.isArray(paths) ||
		paths.length > 1000 ||
		paths.some(
			(path) => typeof path !== "string" || !path.length || path.length > 400,
		)
	)
		throw new Error(
			"revisionScope paths must resolve to a list of paths/globs in reads",
		);
	return [...new Set(paths as string[])].sort();
}

/** Explicit scopes replace inherited repository-wide stamps, while reads still bind inputs. */
export async function scopedNodeRevisions(
	context: ExecutionContext,
	observe: RevisionObserver = nodeRevisionObserver(context),
): Promise<NodeRevisions> {
	if (context.step.revisionScope === "none") return {};
	try {
		return await observe(
			revisionPaths(context),
			accessMode(context.step) === "read-only"
				? snapshotForRead(context)
				: undefined,
		);
	} catch (error) {
		if (context.signal.aborted) throw error;
		return Object.fromEntries(
			runRepositories(context.run).map((repo) => [
				repo.id,
				{ headSha: "unobservable", unobservable: true },
			]),
		);
	}
}
function sameRevision(
	accepted: NodeRevisions[string],
	current?: NodeRevisions[string],
): boolean {
	if (!current || accepted.unobservable || current.unobservable) return false;
	if (accepted.scopedDigest !== undefined)
		return (
			accepted.scopedDigest === current.scopedDigest &&
			digest(accepted.paths) === digest(current.paths)
		);
	return (
		accepted.headSha === current.headSha &&
		(accepted.workspaceDigest === undefined ||
			accepted.workspaceDigest === current.workspaceDigest)
	);
}

export async function prepareNodeGuarantee(
	context: ExecutionContext,
	observe: RevisionObserver = nodeRevisionObserver(context),
): Promise<NodeGuarantee> {
	const outputs = context.outputs ?? context.run.outputs;
	const prefix = prefixOf(context.stepKey ?? context.step.id);
	const reads = Object.values(resolveStepConfig(context.step).reads);
	const readSources = reads
		.filter((read) => !read.from.startsWith("@"))
		.map((read) => read.from.split("/")[0]!);
	const sources = Object.fromEntries(
		[
			...new Set([
				...(reads.some((read) => read.when) ? Object.keys(outputs) : []),
				...readSources,
			]),
		].map((name) => {
			let key = producerKey(context.run, prefix, name);
			// Inherited lexical values need their owning ancestor, even without a Call alias.
			if (!stepForRun(context.run, key)) {
				let parent = prefix;
				while (parent) {
					parent = prefixOf(parent.replace(/\/$/, ""));
					if (stepForRun(context.run, `${parent}${name}`)) {
						key = `${parent}${name}`;
						break;
					}
				}
			}
			return [name, key];
		}),
	);
	const revisions: NodeRevisions = {};
	const revisionChecks: Record<string, NodeRevisions> = {};
	for (const name of readSources) {
		const key = sources[name]!;
		const receipt = latestNodeReceipt(context, key);
		Object.assign(revisions, receipt?.guarantee?.revisions);
		if (receipt?.guarantee) {
			revisionChecks[key] = receipt.guarantee.revisions;
			Object.assign(revisionChecks, receipt.guarantee.revisionChecks);
		}
	}
	const boundDigests: Record<string, string> = {};
	for (const reference of context.step.bind ?? []) {
		const key = nodeReference(context, reference);
		const receipt = latestNodeReceipt(context, key);
		if (!receipt?.guarantee)
			throw new Error(`Bound output ${reference} has no stamped receipt`);
		boundDigests[key] = receiptDigest(receipt);
		Object.assign(revisions, receipt.guarantee.revisions);
		revisionChecks[key] = receipt.guarantee.revisions;
		Object.assign(revisionChecks, receipt.guarantee.revisionChecks);
	}
	const observedRepositories = new Set<string>();
	let localObservation: NodeRevisions | undefined;
	const narrowedScope =
		context.step.revisionScope && context.step.revisionScope !== "repository";
	if (narrowedScope) {
		for (const id of Object.keys(revisions)) delete revisions[id];
		localObservation = await scopedNodeRevisions(context, observe);
		Object.assign(revisions, localObservation);
		for (const id of Object.keys(localObservation))
			observedRepositories.add(id);
	} else {
		// Every repository-scoped node owns an observation before execution/wait.
		// Inherited checks remain separate so this cannot renew old evidence.
		if (
			context.step.type === "agent" &&
			accessMode(context.step) === "read-only"
		) {
			const pinned = snapshotForRead(context);
			if (pinned)
				Object.assign(
					revisions,
					Object.fromEntries(
						pinned.repositories.map((repo) => [
							repo.id,
							{ headSha: repo.revision },
						]),
					),
				);
			else {
				localObservation = await observe();
				Object.assign(revisions, localObservation);
			}
		} else {
			localObservation = await observe();
			Object.assign(revisions, localObservation);
		}
		for (const id of Object.keys(localObservation ?? {}))
			observedRepositories.add(id);
	}
	if (!narrowedScope && nodeEffect(context.step) === "effect") {
		// Fresh input observations are superseded by the effect's resulting state.
		// Keep already-stale observations so an effect cannot renew stale evidence.
		for (const [key, checks] of Object.entries(revisionChecks)) {
			const stale: NodeRevisions = {};
			for (const [id, accepted] of Object.entries(checks)) {
				if (!sameRevision(accepted, (await observe(accepted.paths))[id]))
					stale[id] = accepted;
			}
			if (Object.keys(stale).length) revisionChecks[key] = stale;
			else delete revisionChecks[key];
		}
	}

	const previous = latestNodeReceipt(
		context,
		context.stepKey ?? context.step.id,
	)?.guarantee;
	if (
		!narrowedScope &&
		!localObservation &&
		previous?.observedRepositories?.length
	) {
		const current = await observe();
		for (const id of previous.observedRepositories) {
			const accepted = previous.revisions[id]!;
			const observed = current[id];
			if (observed)
				revisions[id] =
					accepted.workspaceDigest === undefined
						? { headSha: observed.headSha }
						: observed;
		}
	}
	return {
		version: 1,
		revisions,
		revisionChecks:
			!narrowedScope &&
			context.step.type !== "agent" &&
			context.step.type !== "snapshot" &&
			Object.keys(revisionChecks).length > 0
				? revisionChecks
				: undefined,
		observedRepositories: [
			...new Set([
				...observedRepositories,
				...(!narrowedScope ? (previous?.observedRepositories ?? []) : []),
			]),
		],
		boundDigests,
		scope: {
			outputs: sources,
			callInputs: reads.some(
				(read) =>
					read.from === "@callInputs" || read.from.startsWith("@callInputs/"),
			)
				? context.callInputs
				: undefined,
			iteration: context.iteration,
			historyLength: context.run.history.length,
		},
	};
}

/** Always re-resolve a producer's reads in its own persisted lexical scope. */
export async function freshNodeOutput(
	context: ExecutionContext,
	reference: string,
	observe: RevisionObserver = nodeRevisionObserver(context),
): Promise<boolean> {
	context.signal.throwIfAborted();
	const visiting = new Set<string>();
	const check = async (key: string, depth: number): Promise<boolean> => {
		if (depth > 50 || visiting.has(key)) return false;
		const receipt = latestNodeReceipt(context, key);
		const guarantee = receipt?.guarantee;
		const step = stepForRun(context.run, key);
		if (!receipt || !guarantee || !step || !receipt.inputDigest) return false;
		visiting.add(key);
		try {
			const sameFrame =
				prefixOf(key) === prefixOf(context.stepKey ?? context.step.id);
			const outputs = Object.fromEntries(
				Object.entries(guarantee.scope.outputs).map(([name, source]) => [
					name,
					sameFrame && context.outputs && Object.hasOwn(context.outputs, name)
						? context.outputs[name]
						: context.run.outputs[source],
				]),
			);
			if (
				!(
					sameFrame &&
					context.outputs &&
					Object.hasOwn(context.outputs, step.id)
				) &&
				!Object.hasOwn(context.run.outputs, key)
			)
				return false;
			const currentOutput =
				sameFrame && context.outputs && Object.hasOwn(context.outputs, step.id)
					? context.outputs[step.id]
					: context.run.outputs[key];
			if (digest(currentOutput) !== guarantee.outputDigest) return false;
			const readsHistory = Object.values(resolveStepConfig(step).reads).some(
				(read) => !!read.when || /^@history(\/|$)/.test(read.from),
			);
			const history = readsHistory
				? context.run.history.filter(
						(entry, index) =>
							index < guarantee.scope.historyLength || entry.step !== key,
					)
				: context.run.history;
			const producer = {
				...context,
				step,
				stepKey: key,
				outputs,
				callInputs: guarantee.scope.callInputs,
				iteration: guarantee.scope.iteration,
			};
			if (
				digest(stepBindings(producer, history, { checkJson: true })) !==
				receipt.inputDigest
			)
				return false;
			for (const checks of [
				guarantee.revisions,
				...Object.values(guarantee.revisionChecks ?? {}),
			]) {
				for (const [id, accepted] of Object.entries(checks)) {
					if (
						accepted.unobservable ||
						!sameRevision(accepted, (await observe(accepted.paths))[id])
					)
						return false;
				}
			}
			for (const [bound, accepted] of Object.entries(guarantee.boundDigests)) {
				const current = latestNodeReceipt(context, bound);
				if (
					!current ||
					receiptDigest(current) !== accepted ||
					!(await check(bound, depth + 1))
				)
					return false;
			}
			return true;
		} catch (error) {
			if (context.signal.aborted) throw error;
			return false;
		} finally {
			visiting.delete(key);
		}
	};
	return check(nodeReference(context, reference), 0);
}

function sameRevisionMap(
	accepted: NodeRevisions,
	current: NodeRevisions,
): boolean {
	return (
		digest(Object.keys(accepted).sort()) ===
			digest(Object.keys(current).sort()) &&
		Object.entries(accepted).every(([id, revision]) =>
			sameRevision(revision, current[id]),
		)
	);
}
function sameRevisionChecks(
	accepted: NodeGuarantee,
	current: NodeGuarantee,
): boolean {
	const a = accepted.revisionChecks ?? {},
		b = current.revisionChecks ?? {};
	return (
		sameRevisionMap(accepted.revisions, current.revisions) &&
		digest(Object.keys(a).sort()) === digest(Object.keys(b).sort()) &&
		Object.entries(a).every(([key, revisions]) =>
			sameRevisionMap(revisions, b[key]!),
		)
	);
}

export function reusableNodeOutput(
	context: ExecutionContext,
	inputDigest: string,
	guarantee: NodeGuarantee,
): Receipt | undefined {
	if (context.step.reuse !== "unchanged-inputs") return;
	const receipt = latestNodeReceipt(
		context,
		context.stepKey ?? context.step.id,
	);
	return receipt &&
		receipt.inputDigest === inputDigest &&
		receipt.guarantee &&
		sameRevisionChecks(receipt.guarantee, guarantee) &&
		digest(receipt.guarantee.boundDigests) === digest(guarantee.boundDigests) &&
		(!context.iteration ||
			receipt.iteration?.itemDigest === digest(context.iteration.value))
		? receipt
		: undefined;
}

/** Resolve only declared fresh operators; rule evaluation itself stays synchronous and pure. */
export async function nodeFreshnessRules(
	value: unknown,
	fresh?: (reference: string) => Promise<boolean>,
): Promise<(reference: string) => boolean> {
	const refs = new Set<string>();
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		for (const [key, item] of Object.entries(value)) {
			if (key === "fresh" && typeof item === "string") refs.add(item);
			else visit(item);
		}
	};
	visit(value);
	const values = new Map(
		await Promise.all(
			[...refs].map(
				async (ref) => [ref, (await fresh?.(ref)) === true] as const,
			),
		),
	);
	return (reference) => values.get(reference) === true;
}
