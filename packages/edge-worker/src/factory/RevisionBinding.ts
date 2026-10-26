import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { digest } from "./EvidenceDigest.js";
import { runRepositories } from "./RepositoryScope.js";
import { snapshotForRead } from "./RepositorySnapshot.js";
import { stepBindings } from "./StepBindings.js";
import { accessMode, resolveStepConfig } from "./StepConfig.js";
import { stepContextBindingSources } from "./StepContextSources.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
export interface OutputRevisionBinding {
	version: 1;
	repositories: {
		id: string;
		headSha: string;
		treeSha: string;
		workspaceDigest: string;
	}[];
	inputDigest: string;
	historyLength: number;
	inputScope?: { outputKeys: string[]; historyLength: number };
	inputExtrasDigest?: string;
	contextSourcesDigest?: string;
}
/** Appending a producer's own receipt cannot invalidate the inspection it records. */
export function bindingHistory(
	context: ExecutionContext,
	previous?: OutputRevisionBinding,
) {
	const key = context.stepKey ?? context.run.step ?? context.step.id;
	return previous
		? context.run.history.filter(
				(item, index) => index < previous.historyLength || item.step !== key,
			)
		: context.run.history;
}
/** Exact repository HEAD/tree plus working changes; no timestamps enter the digest. */
export async function outputRevisionBinding(
	context: ExecutionContext,
	previous?: OutputRevisionBinding,
	fromInput = false,
): Promise<OutputRevisionBinding | undefined> {
	const config = resolveStepConfig(context.step);
	if (!config.explicit || config.revision !== "bound") return;
	const key = context.stepKey ?? context.run.step ?? context.step.id;
	const historyLength = previous?.historyLength ?? context.run.history.length;
	const history = bindingHistory(context, previous);
	const base = context.bindingInput?.(context.step, previous) ?? context.input;
	const actual = fromInput ? context.input : base;
	const record =
		actual && typeof actual === "object"
			? (actual as Record<string, unknown>)
			: { input: actual };
	const baseRecord =
		base && typeof base === "object"
			? (base as Record<string, unknown>)
			: { input: base };
	const scope = previous?.inputScope ?? {
		outputKeys: Object.keys(
			(record.outputs as Record<string, unknown> | undefined) ??
				context.outputs ??
				context.run.outputs,
		).filter((name) => name !== context.step.id && name !== key),
		historyLength: context.run.history.length,
	};
	const normalized = Object.fromEntries(
		Object.keys(baseRecord).map((name) => [name, record[name]]),
	);
	// Publication of this result updates its own slot and tracking outbox. Neither
	// is new task evidence; hashing them would recursively invalidate the producer.
	delete normalized.ticketSync;
	const selfReads = new Set(
		Object.entries(config.reads)
			.filter(([, read]) => read.from.split("/")[0] === context.step.id)
			.map(([name]) => name),
	);
	for (const name of selfReads) delete normalized[name];
	if (selfReads.has("plan")) delete normalized.deliveryCandidateDigest;
	if (record.outputs && typeof record.outputs === "object")
		normalized.outputs = Object.fromEntries(
			scope.outputKeys
				.filter((name) => Object.hasOwn(record.outputs as object, name))
				.map((name) => [
					name,
					(record.outputs as Record<string, unknown>)[name],
				]),
		);
	if (Array.isArray(record.history))
		normalized.history = record.history
			.slice(0, scope.historyLength)
			.filter((item) => item.step !== key);
	const extras = Object.fromEntries(
		Object.entries(record).filter(([name]) => !Object.hasOwn(baseRecord, name)),
	);
	const inputExtrasDigest =
		fromInput || !previous ? digest(extras) : previous.inputExtrasDigest;
	const contextSourcesDigest =
		fromInput && context.inspectionSources
			? digest(context.inspectionSources)
			: previous?.contextSourcesDigest
				? digest(stepContextBindingSources(context, history))
				: undefined;
	const inputDigest = digest({
		originalInput: context.run.input,
		input: normalized,
		inputExtrasDigest,
		contextSourcesDigest,
		reads: Object.fromEntries(
			Object.entries(
				fromInput && context.step.reads
					? Object.fromEntries(
							Object.keys(config.reads).map((name) => [name, record[name]]),
						)
					: stepBindings(context, history),
			).filter(([name]) => !selfReads.has(name)),
		),
	});
	const snapshot =
		accessMode(context.step) === "read-only"
			? snapshotForRead(context)
			: undefined;
	const repositories = await captureRepositoryRevisions(context, snapshot);
	return {
		version: 1,
		repositories,
		historyLength,
		inputScope: scope,
		inputExtrasDigest,
		contextSourcesDigest,
		inputDigest,
	};
}
/** Shared HEAD/tree/workspace observation for generic node receipts. */
export async function captureRepositoryRevisions(
	context: Pick<ExecutionContext, "run">,
	snapshot?: ReturnType<typeof snapshotForRead>,
	paths?: string[],
): Promise<OutputRevisionBinding["repositories"]> {
	return Promise.all(
		runRepositories(context.run).map(async (repo) => {
			const git = async (args: string[]) =>
				(
					await exec("git", args, {
						cwd: repo.workspace,
						maxBuffer: 32 * 1024 * 1024,
						timeout: 10000,
					})
				).stdout;
			const pinned = snapshot?.repositories.find((item) => item.id === repo.id);
			const headSha =
				pinned?.revision ?? (await git(["rev-parse", "HEAD"])).trim();
			let treeSha = (await git(["rev-parse", `${headSha}^{tree}`])).trim();
			if (paths) {
				// ls-tree accepts literal paths, not glob pathspecs. ls-files expands
				// Git pathspecs against HEAD plus the index, including deleted files.
				const selected = new Set(
					paths.length
						? (
								await git([
									"ls-files",
									"--cached",
									`--with-tree=${headSha}`,
									"-z",
									"--",
									...paths,
								])
							).split("\0")
						: [],
				);
				const entries = (await git(["ls-tree", "-r", "-z", headSha]))
					.split("\0")
					.filter((entry) =>
						selected.has(entry.slice(entry.indexOf("\t") + 1)),
					);
				treeSha = digest(entries);
			}
			if (snapshot) {
				if (
					!pinned ||
					snapshot.repositories.length !== runRepositories(context.run).length
				)
					throw new Error(
						"Snapshot repository scope differs from this read-only role",
					);
				if ((await realpath(repo.workspace)) !== pinned.root)
					throw new Error(
						"Snapshot repository root differs from the retained run scope",
					);
				return {
					id: repo.id,
					headSha,
					treeSha,
					workspaceDigest: paths
						? createHash("sha256").digest("hex")
						: digest({ pinned: headSha, treeSha }),
				};
			}
			const hash = createHash("sha256").update(
				paths?.length === 0
					? ""
					: await git([
							"diff",
							"--no-ext-diff",
							"--binary",
							headSha,
							"--",
							...(paths ?? []),
						]),
			);
			const untracked = (
				paths?.length === 0
					? ""
					: await git([
							"ls-files",
							"--others",
							"--exclude-standard",
							"-z",
							"--",
							...(paths ?? []),
						])
			)
				.split("\0")
				.filter(Boolean)
				.sort();
			for (const path of untracked) {
				const file = join(repo.workspace, path),
					stat = await lstat(file);
				hash.update(path).update("\0");
				if (stat.isSymbolicLink()) hash.update(await readlink(file));
				else if (stat.isFile())
					for await (const chunk of createReadStream(file)) hash.update(chunk);
			}
			if ((await git(["rev-parse", "HEAD"])).trim() !== headSha)
				throw new StaleBoundInspectionError();
			return {
				id: repo.id,
				headSha,
				treeSha,
				workspaceDigest: hash.digest("hex"),
			};
		}),
	);
}

export function sameOutputBinding(
	a: OutputRevisionBinding | undefined,
	b: OutputRevisionBinding | undefined,
): boolean {
	return (
		digest(
			a && { repositories: a.repositories, inputDigest: a.inputDigest },
		) ===
		digest(b && { repositories: b.repositories, inputDigest: b.inputDigest })
	);
}

/** Scoped repository tools serve committed blobs at these immutable revisions. */
export async function pinReadOnlyAccess(
	context: ExecutionContext,
): Promise<NonNullable<ExecutionContext["researchAccess"]>> {
	const snapshot = snapshotForRead(context);
	const scope = runRepositories(context.run);
	if (
		snapshot &&
		(snapshot.repositories.length !== scope.length ||
			!scope.every((repo) =>
				snapshot.repositories.some((item) => item.id === repo.id),
			))
	)
		throw new Error(
			"Snapshot repository scope differs from this read-only role",
		);
	if (snapshot)
		for (const repo of scope) {
			const pinned = snapshot.repositories.find((item) => item.id === repo.id)!;
			if ((await realpath(repo.workspace)) !== pinned.root)
				throw new Error(
					"Snapshot repository root differs from the retained run scope",
				);
			await exec("git", ["cat-file", "-e", `${pinned.revision}^{commit}`], {
				cwd: repo.workspace,
				timeout: 10000,
				maxBuffer: 1024,
			});
		}
	const repositories = await Promise.all(
		scope.map(async (repo) => ({
			id: repo.id,
			root: repo.workspace,
			revision:
				snapshot?.repositories.find((item) => item.id === repo.id)?.revision ??
				context.inspectionBinding?.repositories.find(
					(item) => item.id === repo.id,
				)?.headSha ??
				(
					await exec("git", ["rev-parse", "HEAD"], {
						cwd: repo.workspace,
						timeout: 10000,
						maxBuffer: 1024,
					})
				).stdout.trim(),
		})),
	);
	return { repositories, maxCalls: 200 };
}

export class StaleBoundInspectionError extends Error {
	constructor() {
		super(
			"Bound inspection inputs or pinned repository snapshot changed during execution; re-execution required",
		);
	}
}
/** Never relabel an inspection with completion-time provenance. */
export async function assertBoundInspectionFresh(
	context: ExecutionContext,
): Promise<OutputRevisionBinding | undefined> {
	const started = context.inspectionBinding;
	if (!started) return;
	const current = await outputRevisionBinding(context, started);
	if (
		!current ||
		started.inputDigest !== current.inputDigest ||
		(accessMode(context.step) === "read-only" &&
			!sameOutputBinding(started, current))
	)
		throw new StaleBoundInspectionError();
	return accessMode(context.step) === "read-only" ? started : current;
}
