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
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import { stepBindings } from "./StepBindings.js";
import { resolveStepConfig } from "./StepConfig.js";
import { stepForRun } from "./ToolBindings.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

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

/** Ordinary outputs cannot select Git roots or forge a snapshot producer. */
export function snapshotForRead(
	context: ExecutionContext,
): SnapshotReceipt | undefined {
	const snapshots = context.run.repositorySnapshots ?? {};
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
		const id = (output as { snapshotId?: unknown }).snapshotId;
		const receipt =
			typeof id === "string" && Object.hasOwn(snapshots, id)
				? snapshots[id]
				: undefined;
		if (
			!receipt ||
			binding.from !== receipt.producer.key.split("/").at(-1) ||
			digest(output) !== digest(snapshotOutput(receipt)) ||
			stepForRun(context.run, receipt.producer.key)?.type !== "snapshot" ||
			!context.run.history.some(
				(entry) =>
					entry.step === receipt.producer.key &&
					digest(entry.iteration) === digest(receipt.producer.iteration) &&
					digest(entry.output) === digest(output),
			)
		)
			throw new Error(
				"Read-only snapshot requires the exact runtime-produced Snapshot receipt through a named step read",
			);
		const prefix = (context.stepKey ?? context.step.id).replace(/[^/]+$/, "");
		if (!prefix.startsWith(receipt.producer.key.replace(/[^/]+$/, "")))
			throw new Error("Snapshot producer belongs to another workflow frame");
		const local = stepForRun(context.run, `${prefix}${binding.from}`);
		if (local && receipt.producer.key !== `${prefix}${binding.from}`)
			throw new Error(
				"Snapshot read does not belong to the selected producer in this workflow frame",
			);
		if (selected && selected.digest !== receipt.digest)
			throw new Error(
				"Read-only agent cannot combine different repository snapshots",
			);
		selected = receipt;
	}
	return selected;
}
