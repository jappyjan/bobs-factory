import { existsSync } from "node:fs";
import { join } from "node:path";
import { digest } from "./Delivery.js";
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
	{ headSha: string; workspaceDigest?: string }
>;
export interface NodeGuarantee {
	version: 1;
	revisions: NodeRevisions;
	boundDigests: Record<string, string>;
	readDigests?: Record<string, string>;
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
		boundDigests: receipt.guarantee?.boundDigests,
		readDigests: receipt.guarantee?.readDigests,
	});
}

/** Capture local revisions once per observation. Non-repository runs have no local revisions. */
export async function observeNodeRevisions(
	context: ExecutionContext,
): Promise<NodeRevisions> {
	context.signal.throwIfAborted();
	const repositories = runRepositories(context.run).filter((repo) =>
		existsSync(join(repo.workspace, ".git")),
	);
	if (!repositories.length) return {};
	const observed = await captureRepositoryRevisions({
		run: { ...context.run, repositories },
	});
	context.signal.throwIfAborted();
	return Object.fromEntries(
		observed.map(({ id, headSha, workspaceDigest }) => [
			id,
			{ headSha, workspaceDigest },
		]),
	);
}

export async function prepareNodeGuarantee(
	context: ExecutionContext,
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
	const readDigests: Record<string, string> = {};
	for (const name of readSources) {
		const key = sources[name]!;
		const receipt = latestNodeReceipt(context, key);
		if (receipt?.guarantee) readDigests[key] = receiptDigest(receipt);
		Object.assign(revisions, receipt?.guarantee?.revisions);
	}
	const boundDigests: Record<string, string> = {};
	for (const reference of context.step.bind ?? []) {
		const key = nodeReference(context, reference);
		const receipt = latestNodeReceipt(context, key);
		if (!receipt?.guarantee)
			throw new Error(`Bound output ${reference} has no stamped receipt`);
		boundDigests[key] = receiptDigest(receipt);
		Object.assign(revisions, receipt.guarantee.revisions);
	}
	const observedRepositories = new Set<string>();
	let localObservation: NodeRevisions | undefined;
	if (context.step.type === "agent" || context.step.type === "snapshot") {
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
				localObservation = await observeNodeRevisions(context);
				Object.assign(revisions, localObservation);
			}
		} else {
			localObservation = await observeNodeRevisions(context);
			Object.assign(revisions, localObservation);
		}
		for (const id of Object.keys(localObservation ?? {}))
			observedRepositories.add(id);
	}
	const previous = latestNodeReceipt(
		context,
		context.stepKey ?? context.step.id,
	)?.guarantee;
	if (previous?.observedRepositories?.length) {
		const current = localObservation ?? (await observeNodeRevisions(context));
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
		observedRepositories: [
			...new Set([
				...observedRepositories,
				...(previous?.observedRepositories ?? []),
			]),
		],
		boundDigests,
		readDigests,
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
): Promise<boolean> {
	context.signal.throwIfAborted();
	const visiting = new Set<string>();
	let revisions: Promise<NodeRevisions> | undefined;
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
			if (Object.keys(guarantee.revisions).length) {
				revisions ??= observeNodeRevisions(context);
				const current = await revisions;
				for (const [id, accepted] of Object.entries(guarantee.revisions)) {
					if (
						current[id]?.headSha !== accepted.headSha ||
						(accepted.workspaceDigest !== undefined &&
							current[id]?.workspaceDigest !== accepted.workspaceDigest)
					)
						return false;
				}
			}
			for (const [bound, accepted] of Object.entries({
				...guarantee.readDigests,
				...guarantee.boundDigests,
			})) {
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
		digest(receipt.guarantee.revisions) === digest(guarantee.revisions) &&
		digest(receipt.guarantee.boundDigests) === digest(guarantee.boundDigests) &&
		digest(receipt.guarantee.readDigests) === digest(guarantee.readDigests) &&
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
