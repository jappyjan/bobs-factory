import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { immutableJson } from "bobs-factory-core";
import {
	type SnapshotConfiguration,
	SnapshotConfigurationSchema,
} from "./ActionSteps.js";
import { digest } from "./Delivery.js";
import {
	foreachPointer,
	foreachPointerSchema,
	foreachScope,
} from "./Foreach.js";
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import { stepBindings } from "./StepBindings.js";
import { resolveStepConfig } from "./StepConfig.js";
import { producerKey, producerValue, stepForRun } from "./ToolBindings.js";
import type {
	ExecutionContext,
	FactoryRun,
	GraphCheckpoint,
} from "./WorkflowRuntime.js";

const exec = promisify(execFile);
const sha = /^[a-f0-9]{40,64}$/;
const safeIdentity = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export interface SnapshotHistory {
	observedAt: string;
	lookbackDays: number;
	total: number;
	sampled: boolean;
	records: {
		id: string;
		workflow: string;
		status: FactoryRun["status"];
		step?: string;
		createdAt: string;
		updatedAt: string;
		wait?: string | string[];
		transitions: { at: string; step: string }[];
		attempts: {
			step: string;
			outcome: string;
			startedAt: string;
			endedAt?: string;
			revision?: string;
		}[];
		error?: string;
	}[];
}
/** Private roots are never published in the action output or copied into prompts. */
export interface SnapshotReceipt {
	kind: "repository-snapshot-v1";
	actionId: string;
	producer: {
		key: string;
		iteration?: {
			frame: string;
			id: string;
			index: number;
			itemDigest: string;
		};
	};
	observedAt: string;
	revision: string;
	repositories: {
		id: string;
		root: string;
		revision: string;
		baseBranch: string;
	}[];
	history?: SnapshotHistory;
	limitations: string[];
	digest: string;
}
/** Runtime-only authority: this record is never an agent input or an action output. */
export interface SnapshotInputProvenance {
	runId: string;
	snapshotId: string;
	receiptDigest: string;
	producer: SnapshotReceipt["producer"];
	valueDigest: string;
	hops: {
		callKey: string;
		targetWorkflowId: string;
		inputName: string;
		path: string;
		mappingDigest: string;
		iteration?: NonNullable<SnapshotReceipt["producer"]["iteration"]>;
		wrappers?: {
			key: string;
			outputDigest: string;
			iteration?: SnapshotReceipt["producer"]["iteration"];
		}[];
	}[];
}
export function classifyOperationalError(error: string) {
	if (/timeout|timed out/i.test(error)) return "timeout";
	if (/auth|unauthori|forbidden|credential|401|403/i.test(error))
		return "access";
	if (/capacity|rate.limit|429/i.test(error)) return "capacity-or-rate-limit";
	if (/output|schema|validation|json/i.test(error)) return "invalid-output";
	if (/network|connect|econn|fetch/i.test(error)) return "connectivity";
	return "other-failure (inspect the referenced run locally)";
}
const dated = (value: string) => Number.isFinite(Date.parse(value));
const timestamp = (value: string) => new Date(Date.parse(value)).toISOString();
/** Match the complete retained scope, including repository identity; never include raw logs. */
function matchingScope(run: FactoryRun, candidate: FactoryRun) {
	const expected = runRepositories(run);
	const actual = runRepositories(candidate);
	return (
		expected.length === actual.length &&
		expected.every((repo) =>
			actual.some(
				(item) =>
					item.id === repo.id &&
					resolve(item.repositoryPath) === resolve(repo.repositoryPath),
			),
		)
	);
}
function historySnapshot(
	run: FactoryRun,
	runs: Iterable<FactoryRun>,
	config: NonNullable<SnapshotConfiguration["history"]>,
	observedAt: string,
): SnapshotHistory {
	const end = Date.parse(observedAt),
		cutoff = end - config.lookbackDays * 86400000;
	const matching = [...runs]
		.filter(
			(candidate) =>
				candidate.id !== run.id &&
				matchingScope(run, candidate) &&
				safeIdentity.test(candidate.id) &&
				dated(candidate.createdAt) &&
				dated(candidate.updatedAt) &&
				Date.parse(candidate.updatedAt) >= cutoff &&
				Date.parse(candidate.updatedAt) <= end,
		)
		.sort(
			(a, b) =>
				a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id),
		);
	return {
		observedAt,
		lookbackDays: config.lookbackDays,
		total: matching.length,
		sampled: matching.length > config.maxRuns,
		records: matching.slice(-config.maxRuns).map((candidate) => ({
			id: candidate.id,
			workflow: safeIdentity.test(candidate.workflow.id)
				? candidate.workflow.id
				: "unclassified",
			status: candidate.status,
			step:
				candidate.step && safeIdentity.test(candidate.step)
					? candidate.step
					: undefined,
			createdAt: timestamp(candidate.createdAt),
			updatedAt: timestamp(candidate.updatedAt),
			wait: candidate.architectureGate
				? "architecture"
				: candidate.reviewGate
					? "human-review"
					: candidate.questions?.length
						? "questions"
						: Object.values(candidate.capacityLeaves ?? {})
								.map((leaf) => leaf.phase)
								.filter((phase) => /^[a-z-]+$/.test(phase)),
			transitions: (candidate.activitySteps ?? [])
				.filter((item) => safeIdentity.test(item.step) && dated(item.at))
				.slice(-50)
				.map(({ at, step }) => ({ at: timestamp(at), step })),
			attempts: (candidate.stepAttempts ?? [])
				.filter(
					(attempt) =>
						safeIdentity.test(attempt.step) &&
						dated(attempt.startedAt) &&
						(!attempt.endedAt || dated(attempt.endedAt)),
				)
				.slice(-30)
				.map((attempt) => ({
					step: attempt.step,
					outcome: attempt.outcome,
					startedAt: timestamp(attempt.startedAt),
					endedAt: attempt.endedAt ? timestamp(attempt.endedAt) : undefined,
					revision:
						attempt.revision && sha.test(attempt.revision.headSha)
							? attempt.revision.headSha
							: undefined,
				})),
			error: candidate.error
				? classifyOperationalError(candidate.error)
				: undefined,
		})),
	};
}
/** Capture once, persist before publication, and reuse the original receipt on Retry. */
export async function captureRepositorySnapshot(
	run: FactoryRun,
	actionId: string,
	value: SnapshotConfiguration,
	runs: Iterable<FactoryRun>,
	signal: AbortSignal,
	producer: SnapshotReceipt["producer"] = { key: actionId },
): Promise<SnapshotReceipt> {
	const config = SnapshotConfigurationSchema.parse(value);
	signal.throwIfAborted();
	const scope = runRepositories(run);
	if (
		!scope.length ||
		new Set(scope.map((repo) => repo.id)).size !== scope.length
	)
		throw new Error(
			"Snapshot requires a distinct retained repository identity for every scope member",
		);
	const repositories = await Promise.all(
		scope.map(async (repo) => {
			const root = await realpath(repo.workspace);
			const git = async (args: string[]) =>
				(
					await exec("git", ["--no-pager", "-C", root, ...args], {
						timeout: 15000,
						maxBuffer: 1024 * 1024,
						signal,
					})
				).stdout.trim();
			if (
				(await realpath(await git(["rev-parse", "--show-toplevel"]))) !== root
			)
				throw new Error(
					`Snapshot repository ${repo.id} does not name its exact Git root`,
				);
			const revision = await git(["rev-parse", "--verify", "HEAD^{commit}"]);
			if (!sha.test(revision))
				throw new Error(
					`Snapshot repository ${repo.id} has an invalid tracked revision`,
				);
			return { id: repo.id, root, revision, baseBranch: repo.baseBranch };
		}),
	);
	if (
		new Set(repositories.map((repo) => repo.root)).size !== repositories.length
	)
		throw new Error(
			"Snapshot repository scope cannot reuse another member's Git root",
		);
	signal.throwIfAborted();
	const observedAt = new Date().toISOString();
	const receipt = {
		kind: "repository-snapshot-v1" as const,
		actionId,
		producer: structuredClone(producer),
		observedAt,
		revision: scopeRevision(
			repositories.map((repo) => ({
				repositoryId: repo.id,
				headSha: repo.revision,
			})),
		),
		repositories,
		history: config.history
			? historySnapshot(run, runs, config.history, observedAt)
			: undefined,
		limitations: [
			"Only tracked committed Git blobs are exposed; working changes, untracked files, symlinks and private-looking paths are excluded.",
			...(config.history
				? [
						"History contains dated matching-scope run metadata and categorized failures only; raw logs, prompts, errors and Git commit messages are excluded.",
						`History is limited to ${config.history.maxRuns} runs, 50 transitions and 30 attempts per run.`,
					]
				: []),
		],
	};
	return immutableJson({ ...receipt, digest: digest(receipt) });
}
export function snapshotOutput(receipt: SnapshotReceipt) {
	return immutableJson({
		kind: receipt.kind,
		snapshotId: receipt.actionId,
		digest: receipt.digest,
		revision: receipt.revision,
		repositories: receipt.repositories.map(({ id, revision, baseBranch }) => ({
			id,
			revision,
			baseBranch,
		})),
		history: receipt.history ?? null,
		observedAt: receipt.observedAt,
		limitations: receipt.limitations,
	});
}

const snapshotError =
	"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read";
const prefixOf = (key: string) => key.replace(/[^/]+$/, "");
function iterationOf(context: Pick<ExecutionContext, "iteration">) {
	const item = context.iteration;
	return item
		? {
				frame: item.frame,
				id: item.id,
				index: item.index,
				itemDigest: digest(item.value),
			}
		: undefined;
}
/** Decode safe paths; only an entire Snapshot reached through proven producers has authority. */
function wholePointer(path: string): string[] | undefined {
	if (!foreachPointerSchema.safeParse(path).success || !path) return undefined;
	return path
		.slice(1)
		.split("/")
		.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function visibleProducer(run: FactoryRun, key: string, source: string) {
	let prefix = prefixOf(key);
	for (;;) {
		const candidate = `${prefix}${source}`;
		if (stepForRun(run, candidate)) return candidate;
		if (!prefix) return undefined;
		prefix = prefixOf(prefix.slice(0, -1));
	}
}
function receiptForValue(context: ExecutionContext, value: unknown) {
	if (
		!value ||
		typeof value !== "object" ||
		(value as { kind?: unknown }).kind !== "repository-snapshot-v1"
	)
		return undefined;
	const id = (value as { snapshotId?: unknown }).snapshotId;
	const receipts = context.run.repositorySnapshots ?? {};
	const receipt =
		typeof id === "string" && Object.hasOwn(receipts, id)
			? receipts[id]
			: undefined;
	if (
		!receipt ||
		digest(value) !== digest(snapshotOutput(receipt)) ||
		stepForRun(context.run, receipt.producer.key)?.type !== "snapshot" ||
		!context.run.history.some(
			(entry) =>
				entry.step === receipt.producer.key &&
				digest(entry.iteration) === digest(receipt.producer.iteration) &&
				digest(entry.output) === digest(value),
		)
	)
		throw new Error(snapshotError);
	return receipt;
}
function validateReceipt(receipt: SnapshotReceipt) {
	const { digest: expected, ...original } = receipt;
	if (digest(original) !== expected) throw new Error(snapshotError);
}
function directSnapshot(
	context: ExecutionContext,
	source: string,
	value: unknown,
	key = context.stepKey ?? context.step.id,
) {
	const receipt = receiptForValue(context, value);
	if (!receipt) return undefined;
	const configured = producerKey(context.run, prefixOf(key), source);
	if (configured !== `${prefixOf(key)}${source}`) {
		if (
			configured !== receipt.producer.key ||
			digest(producerValue(context.run, configured)) !== digest(value)
		)
			throw new Error(snapshotError);
		if (
			receipt.producer.iteration?.frame === context.iteration?.frame &&
			digest(receipt.producer.iteration) !== digest(iterationOf(context))
		)
			throw new Error(snapshotError);
		validateReceipt(receipt);
		return receipt;
	}
	if (source !== receipt.producer.key.split("/").at(-1))
		throw new Error(snapshotError);
	if (!prefixOf(key).startsWith(prefixOf(receipt.producer.key)))
		throw new Error("Snapshot producer belongs to another workflow frame");
	if (visibleProducer(context.run, key, source) !== receipt.producer.key)
		throw new Error(
			"Snapshot read does not belong to the selected producer in this workflow frame",
		);
	// Call inputs are ordinary data aliases in outputs as well. They cannot impersonate
	// an ancestor's output slot; their authority must travel through the private record.
	if (
		Object.hasOwn(context.callInputs ?? {}, source) &&
		receipt.producer.key !== `${prefixOf(key)}${source}`
	)
		throw new Error(snapshotError);
	if (
		receipt.producer.iteration?.frame === context.iteration?.frame &&
		digest(receipt.producer.iteration) !== digest(iterationOf(context))
	)
		throw new Error(snapshotError);
	validateReceipt(receipt);
	return receipt;
}
type WrapperReceipt = NonNullable<
	SnapshotInputProvenance["hops"][number]["wrappers"]
>[number];
/** Runtime Call/For each results contain only outputs owned by the selected child frame. */
function snapshotSource(
	context: ExecutionContext,
	from: string,
	value: unknown,
	key = context.stepKey ?? context.step.id,
	expected?: WrapperReceipt[],
) {
	const parts = wholePointer(`/${from}`);
	if (!parts?.length || from.startsWith("@")) return undefined;
	if (parts.length === 1) {
		if (expected?.length) throw new Error(snapshotError);
		const receipt = directSnapshot(context, parts[0]!, value, key);
		return receipt ? { receipt, wrappers: [] as WrapperReceipt[] } : undefined;
	}
	const receipt = receiptForValue(context, value);
	if (!receipt) return undefined;
	validateReceipt(receipt);
	const source = parts.shift()!,
		rootKey = visibleProducer(context.run, key, source);
	if (
		!rootKey ||
		(Object.hasOwn(context.callInputs ?? {}, source) &&
			rootKey !== `${prefixOf(key)}${source}`)
	)
		throw new Error(snapshotError);
	const wrappers: WrapperReceipt[] = [];
	const first = expected?.[0];
	const root = first
		? context.run.history.find(
				(entry) =>
					entry.step === rootKey &&
					digest(entry.output) === first.outputDigest &&
					digest(entry.iteration) === digest(first.iteration),
			)?.output
		: (context.outputs ?? context.run.outputs)[source];
	// New mappings cannot revive an older result by copying its public wrapper back
	// into the current output slot. Accepted mappings keep their original receipt.
	if (
		!expected &&
		digest(
			[...context.run.history].reverse().find((entry) => entry.step === rootKey)
				?.output,
		) !== digest(root)
	)
		throw new Error(snapshotError);
	const trace = (
		producerKey: string,
		output: unknown,
		remaining: string[],
	): void => {
		const step = stepForRun(context.run, producerKey);
		if (!remaining.length) {
			if (
				step?.type !== "snapshot" ||
				producerKey !== receipt.producer.key ||
				digest(output) !== digest(value)
			)
				throw new Error(snapshotError);
			return;
		}
		if (!step || !["workflow", "foreach"].includes(step.type))
			throw new Error(snapshotError);
		const wanted = expected?.[wrappers.length];
		const history = [...context.run.history]
			.reverse()
			.find(
				(entry) =>
					entry.step === producerKey &&
					digest(entry.output) === digest(output) &&
					(!wanted ||
						(wanted.key === producerKey &&
							wanted.outputDigest === digest(entry.output) &&
							digest(wanted.iteration) === digest(entry.iteration))),
			);
		if (!history || (expected && !wanted)) throw new Error(snapshotError);
		wrappers.push({
			key: producerKey,
			outputDigest: digest(history.output),
			...(history.iteration ? { iteration: history.iteration } : {}),
		});
		if (step.type === "workflow") {
			const result = output as {
				workflow?: unknown;
				completed?: unknown;
				outputs?: Record<string, unknown>;
			};
			const child = remaining[1];
			if (
				remaining[0] !== "outputs" ||
				!child ||
				result?.workflow !== step.workflow ||
				result.completed !== true ||
				history.call?.key !== producerKey ||
				history.call.workflowId !== step.workflow ||
				!Object.hasOwn(result.outputs ?? {}, child)
			)
				throw new Error(snapshotError);
			trace(
				`${producerKey}/${child}`,
				result.outputs![child],
				remaining.slice(2),
			);
		} else {
			const item = remaining[1],
				child = remaining[2];
			const result = output as {
				results?: Record<string, Record<string, unknown>>;
			};
			if (
				remaining[0] !== "results" ||
				!item ||
				!child ||
				!Object.hasOwn(result?.results ?? {}, item) ||
				!Object.hasOwn(result.results![item]!, child) ||
				!context.run.foreachIterations?.some(
					(iteration) =>
						iteration.key === producerKey &&
						iteration.snapshot.items.some((candidate) => candidate.id === item),
				)
			)
				throw new Error(snapshotError);
			trace(
				`${producerKey}/${item}/${child}`,
				result.results![item]![child],
				remaining.slice(3),
			);
		}
	};
	trace(rootKey, root, parts);
	if (expected && digest(expected) !== digest(wrappers))
		throw new Error(snapshotError);
	return { receipt, wrappers };
}
function calledFrame(
	run: FactoryRun,
	callKey: string,
): GraphCheckpoint | undefined {
	const visit = (frame?: GraphCheckpoint): GraphCheckpoint | undefined => {
		if (frame?.active?.call?.key === callKey) return frame.active.children?.[0];
		for (const child of frame?.active?.children ?? []) {
			const found = visit(child);
			if (found) return found;
		}
		return undefined;
	};
	return visit(run.checkpoint);
}
/** Decode a permitted mapping without traversing arbitrary data or copied wrappers. */
function mappingReference(step: ExecutionContext["step"], path: string) {
	const parts = wholePointer(path);
	if (parts?.length && !["inputs", "item", "index"].includes(parts[0]!))
		return path.slice(1);
	if (parts && parts.length >= 2 && parts[0] === "inputs") {
		const binding = resolveStepConfig(step).reads[parts[1]!];
		return binding
			? binding.from +
					path
						.split("/")
						.slice(3)
						.map((part) => `/${part}`)
						.join("")
			: undefined;
	}
	return undefined;
}
function mappingSource(context: ExecutionContext, path: string) {
	const parts = wholePointer(path);
	if (parts?.[0] === "inputs") {
		// Conditional reads must actually be present in the current accepted binding projection.
		if (!Object.hasOwn(stepBindings(context), parts[1]!)) return undefined;
	}
	return mappingReference(context.step, path);
}
function inheritedSnapshot(
	context: ExecutionContext,
	inputName: string,
	value: unknown,
) {
	const provenance = context.snapshotInputs?.[inputName];
	const receipt = receiptForValue(context, value);
	if (
		!receipt ||
		!provenance ||
		provenance.runId !== context.run.id ||
		provenance.snapshotId !== receipt.actionId ||
		provenance.receiptDigest !== receipt.digest ||
		digest(provenance.producer) !== digest(receipt.producer) ||
		provenance.valueDigest !== digest(value) ||
		!provenance.hops.length
	)
		throw new Error(snapshotError);
	validateReceipt(receipt);
	let previous: SnapshotInputProvenance["hops"][number] | undefined;
	for (const [index, hop] of provenance.hops.entries()) {
		const step = stepForRun(context.run, hop.callKey);
		const frame = calledFrame(context.run, hop.callKey);
		if (
			!step ||
			step.type !== "workflow" ||
			step.workflow !== hop.targetWorkflowId ||
			step.inputMapping?.[hop.inputName] !== hop.path ||
			digest(step.inputMapping) !== hop.mappingDigest ||
			!frame ||
			digest(frame.callInputs?.[hop.inputName]) !== provenance.valueDigest ||
			digest(iterationOf({ iteration: frame.iteration })) !==
				digest(hop.iteration) ||
			digest(frame.snapshotInputs?.[hop.inputName]) !==
				digest({ ...provenance, hops: provenance.hops.slice(0, index + 1) })
		)
			throw new Error(snapshotError);
		const from = mappingReference(step, hop.path);
		if (from?.startsWith("@callInputs/")) {
			if (
				!previous ||
				from !== `@callInputs/${previous.inputName}` ||
				!hop.callKey.startsWith(`${previous.callKey}/`)
			)
				throw new Error(snapshotError);
		} else {
			if (previous || !from) throw new Error(snapshotError);
			const sourceContext = {
				...context,
				iteration: frame.iteration,
				callInputs: undefined,
			};
			if (
				snapshotSource(sourceContext, from, value, hop.callKey, hop.wrappers)
					?.receipt.digest !== receipt.digest
			)
				throw new Error(snapshotError);
		}
		previous = hop;
	}
	const owner = provenance.hops.at(-1)!;
	if (
		owner.inputName !== inputName ||
		!(context.stepKey ?? context.step.id).startsWith(`${owner.callKey}/`) ||
		digest(context.callInputs?.[inputName]) !== provenance.valueDigest
	)
		throw new Error(snapshotError);
	return { receipt, provenance };
}
/** Accept authority only from a real producer or an existing private Call input record. */
export function snapshotInputMappings(
	context: ExecutionContext,
	inputMapping: Record<string, string>,
	mappings: Record<string, unknown>,
	callKey: string,
): Record<string, SnapshotInputProvenance> {
	const result: Record<string, SnapshotInputProvenance> = {};
	if (
		context.step.type !== "workflow" ||
		!context.step.workflow ||
		callKey !== (context.stepKey ?? context.step.id) ||
		digest(context.step.inputMapping) !== digest(inputMapping)
	)
		return result;
	const bindings = stepBindings(context);
	for (const [inputName, path] of Object.entries(inputMapping)) {
		try {
			const source = mappingSource(context, path);
			if (!source) continue;
			const current = foreachPointer(
				foreachScope({
					outputs: context.outputs ?? context.run.outputs,
					inputs: bindings,
				}),
				path,
			);
			const value = mappings[inputName];
			if (digest(current) !== digest(value)) continue;
			let receipt: SnapshotReceipt | undefined,
				hops: SnapshotInputProvenance["hops"] = [],
				wrappers: WrapperReceipt[] = [];
			if (source.startsWith("@callInputs/")) {
				const inherited = inheritedSnapshot(
					context,
					source.slice("@callInputs/".length),
					value,
				);
				receipt = inherited.receipt;
				hops = inherited.provenance.hops;
			} else {
				const original = snapshotSource(context, source, value, callKey);
				receipt = original?.receipt;
				wrappers = original?.wrappers ?? [];
			}
			if (!receipt) continue;
			result[inputName] = immutableJson({
				runId: context.run.id,
				snapshotId: receipt.actionId,
				receiptDigest: receipt.digest,
				producer: receipt.producer,
				valueDigest: digest(value),
				hops: [
					...hops,
					{
						callKey,
						targetWorkflowId: context.step.workflow,
						inputName,
						path,
						mappingDigest: digest(inputMapping),
						iteration: iterationOf(context),
						...(wrappers.length ? { wrappers } : {}),
					},
				],
			});
		} catch {
			// Any JSON may be passed as ordinary Call input. Missing proof grants no blob access.
		}
	}
	return result;
}

/** Ordinary outputs cannot select Git roots or forge a snapshot producer. */
export function snapshotForRead(
	context: ExecutionContext,
): SnapshotReceipt | undefined {
	const reads = stepBindings(context);
	let selected: SnapshotReceipt | undefined;
	for (const [name, binding] of Object.entries(
		resolveStepConfig(context.step).reads,
	)) {
		const output = reads[name];
		if (
			!output ||
			typeof output !== "object" ||
			(output as { kind?: unknown }).kind !== "repository-snapshot-v1"
		)
			continue;
		const receipt = binding.from.startsWith("@callInputs/")
			? inheritedSnapshot(
					context,
					binding.from.slice("@callInputs/".length),
					output,
				).receipt
			: snapshotSource(context, binding.from, output)?.receipt;
		if (!receipt) throw new Error(snapshotError);
		if (selected && selected.digest !== receipt.digest)
			throw new Error(
				"Read-only agent cannot combine different repository snapshots",
			);
		selected = receipt;
	}
	return selected;
}
