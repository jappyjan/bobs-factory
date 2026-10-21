import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { digest } from "./Delivery.js";
import { runRepositories } from "./RepositoryScope.js";
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
		reads:
			fromInput && context.step.reads
				? Object.fromEntries(
						Object.keys(config.reads).map((name) => [name, record[name]]),
					)
				: stepBindings(context, history),
	});
	const repositories = await Promise.all(
		runRepositories(context.run).map(async (repo) => {
			const git = async (args: string[]) =>
				(
					await exec("git", args, {
						cwd: repo.workspace,
						maxBuffer: 32 * 1024 * 1024,
						timeout: 10000,
					})
				).stdout;
			const headSha = (await git(["rev-parse", "HEAD"])).trim();
			const treeSha = (await git(["rev-parse", `${headSha}^{tree}`])).trim();
			const hash = createHash("sha256").update(
				await git(["diff", "--no-ext-diff", "--binary", headSha]),
			);
			const untracked = (
				await git(["ls-files", "--others", "--exclude-standard", "-z"])
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
	const repositories = await Promise.all(
		runRepositories(context.run).map(async (repo) => ({
			id: repo.id,
			root: repo.workspace,
			revision:
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
	return { repositories, maxCalls: 1000 };
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
