import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";
import { runRepositories } from "./RepositoryScope.js";
import {
	RULE_EVALUATION_LIMITS,
	type RuleEvaluationBudget,
	selectRuleValuesAsync,
} from "./Rules.js";
import {
	CHECK_IDS,
	type CheckId,
	isNodeEngineStep,
	readOutput,
	resolveStepConfig,
} from "./StepConfig.js";
import {
	inspectMedia,
	type MediaCandidate,
	retainVerifiedMedia,
} from "./VerifiedMedia.js";
import { evidenceFile } from "./Video.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** Generic Display components retain their ordinary shapes during reference verification. */
function codeReferences(value: unknown, depth = 0): unknown[] {
	if (depth > 8) throw new Error("Code reference sections exceed eight levels");
	if (!value || typeof value !== "object") return [value];
	const component = value as Record<string, any>;
	if (!["code", "codeTour", "section"].includes(component.type)) {
		// A selected non-code Display component contains no code references.
		return typeof component.type === "string" && component.data ? [] : [value];
	}
	const data = component.data?.literal;
	if (!data || typeof data !== "object")
		throw new Error(
			"Code reference verification requires literal Display component data",
		);
	if (component.type === "section")
		return (data.components ?? []).flatMap((child: unknown) =>
			codeReferences(child, depth + 1),
		);
	if (component.type === "code")
		return [
			{ file: data.file, line: data.startLine ?? 1, lineEnd: data.endLine },
		];
	return (data.files ?? []).flatMap((file: Record<string, any>) =>
		file.notes?.length
			? file.notes.map((note: Record<string, any>) => ({
					file: file.path,
					line: note.line,
					side: note.side,
				}))
			: [{ file: file.path, line: 1 }],
	);
}

export type EvidencePhase = "correction" | "finalization";
/** Runtime-owned adapters retain their historical stage, retry and failure semantics. */
export const evidenceCheckCatalog = CHECK_IDS.map((id) => ({
	id,
	version: 1,
	name: id.replaceAll("-", " "),
}));
const exec = promisify(execFile);
function values(document: unknown, path: string): unknown[] {
	let selected: unknown[] = [document];
	for (const part of path.split("/").slice(1)) {
		const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
		selected = selected.flatMap((value) =>
			key === "*"
				? Array.isArray(value)
					? value
					: value && typeof value === "object"
						? Object.values(value)
						: []
				: value && typeof value === "object" && Object.hasOwn(value, key)
					? [(value as Record<string, unknown>)[key]]
					: [],
		);
		if (selected.length > 20_000)
			throw new Error("Evidence selection exceeds the limit");
	}
	return selected.flatMap((value) => (Array.isArray(value) ? value : [value]));
}
function strings(document: unknown, path: string): string[] {
	const selected = values(document, path);
	if (selected.some((value) => typeof value !== "string"))
		throw new Error(`${path}: expected file paths or IDs`);
	return selected as string[];
}
function repository(context: ExecutionContext, id: unknown) {
	const repositories = runRepositories(context.run);
	const selected =
		id === undefined
			? (repositories.find((r) => r.id === context.run.repositoryId) ??
				repositories[0])
			: repositories.find((r) => r.id === id);
	if (!selected)
		throw new Error(`Evidence check names unknown repository ${String(id)}`);
	return selected;
}
function safeRelative(path: string) {
	if (
		!path ||
		isAbsolute(path) ||
		path.split(/[\\/]/).some((part) => part === ".." || part === ".git") ||
		path.includes("\0")
	)
		throw new Error(`Unsafe repository evidence path: ${path}`);
	return path;
}
function fileInWorkspace(root: string, path: string) {
	const canonicalRoot = realpathSync(root),
		file = realpathSync(resolve(root, safeRelative(path))),
		fromRoot = relative(canonicalRoot, file);
	if (
		!fromRoot ||
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot) ||
		!statSync(file).isFile()
	)
		throw new Error(`Evidence must be a file within the repository: ${path}`);
	return file;
}
async function repositoryBlob(
	context: ExecutionContext,
	workspace: string,
	head: string,
	file: string,
): Promise<string> {
	const object = `${head}:${safeRelative(file)}`;
	const { stdout } = await exec("git", ["cat-file", "-t", object], {
		cwd: workspace,
		signal: context.signal,
		maxBuffer: 1024,
	});
	if (stdout.trim() !== "blob")
		throw new Error(
			`Repository evidence must reference a file (Git blob): ${file} at ${head}`,
		);
	return object;
}
async function revision(
	context: ExecutionContext,
	repositoryId: string,
	workspace: string,
) {
	const pinned =
		context.step.type === "check"
			? context.inspectionBinding?.repositories.find(
					(entry) => entry.id === repositoryId,
				)
			: undefined;
	if (pinned) return pinned.headSha;
	const revisions = context.progress?.currentRevision;
	const scoped = revisions?.repositories?.find(
		(repository) => repository.repositoryId === repositoryId,
	);
	if (scoped) return scoped.headSha;
	if (
		runRepositories(context.run).length === 1 &&
		context.run.repositoryId === repositoryId &&
		revisions?.headSha
	)
		return revisions.headSha;
	const result = await exec("git", ["rev-parse", "HEAD"], {
		cwd: workspace,
		signal: context.signal,
		maxBuffer: 1024,
	});
	return result.stdout.trim();
}
/** Verify explicitly selected file, media, source-reference and identifier evidence. */
export async function runEvidenceChecks(
	context: ExecutionContext,
	output: unknown,
	phase: EvidencePhase = "correction",
): Promise<unknown> {
	const budget: RuleEvaluationBudget | undefined =
		context.step.type === "check"
			? {
					remaining: RULE_EVALUATION_LIMITS.conditions,
					workRemaining: RULE_EVALUATION_LIMITS.work,
				}
			: undefined;
	const selectedValues = async (document: unknown, path: string) =>
		budget
			? selectRuleValuesAsync(document, path, budget, context.signal)
			: values(document, path);
	const selectedStrings = async (
		document: unknown,
		path: string,
	): Promise<string[]> => {
		if (!budget) return strings(document, path);
		const selected = await selectedValues(document, path);
		if (selected.some((value) => typeof value !== "string"))
			throw new Error(`${path}: expected file paths or IDs`);
		return selected as string[];
	};
	const verifiedMedia: MediaCandidate[] = [];
	let operations = 0;
	const checkpoint = async () => {
		context.signal.throwIfAborted();
		if (budget && operations++ % 64 === 0) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			context.signal.throwIfAborted();
		}
	};
	for (const { check, args } of resolveStepConfig(context.step).checks) {
		context.signal.throwIfAborted();
		// Generic selectors validate authored output before acceptance.
		if (phase !== "correction") continue;
		if (typeof args.path !== "string")
			throw outputValidationError(
				output,
				new Error(`${check} requires a path selector`),
			);
		try {
			switch (check as CheckId) {
				case "files-exist": {
					const repo = repository(context, args.repositoryId);
					for (const file of await selectedStrings(output, args.path)) {
						await checkpoint();
						if (isNodeEngineStep(context.step) && isAbsolute(file)) {
							evidenceFile(file, context.evidenceDir);
						} else if (resolveStepConfig(context.step).revision === "bound") {
							const head = await revision(context, repo.id, repo.workspace);
							await repositoryBlob(context, repo.workspace, head, file);
						} else fileInWorkspace(repo.workspace, file);
					}
					break;
				}
				case "code-refs-valid": {
					for (const reference of (
						await selectedValues(output, args.path)
					).flatMap((value) => codeReferences(value))) {
						await checkpoint();
						const match =
							typeof reference === "string"
								? /^(.*):(\d+)(?:-(\d+))?$/.exec(reference)
								: undefined;
						const entry =
							reference && typeof reference === "object"
								? (reference as Record<string, unknown>)
								: {};
						const file = match?.[1] ?? entry.file,
							line = match ? Number(match[2]) : entry.line,
							end = match
								? Number(match[3] ?? match[2])
								: (entry.lineEnd ?? line);
						if (
							typeof file !== "string" ||
							!Number.isInteger(line) ||
							!Number.isInteger(end) ||
							Number(line) < 1 ||
							Number(end) < Number(line)
						)
							throw new Error(
								"Code references require file:line[-line] or {file,line,lineEnd?}",
							);
						const repo = repository(
								context,
								entry.repositoryId ?? args.repositoryId,
							),
							head = await revision(context, repo.id, repo.workspace);
						// Old-side tour notes refer to the common base, not the new file.
						const referenceHead =
							entry.side === "old"
								? (
										await exec(
											"git",
											["merge-base", `origin/${repo.baseBranch}`, head],
											{ cwd: repo.workspace, signal: context.signal },
										)
									).stdout.trim()
								: head;
						const blob = await repositoryBlob(
							context,
							repo.workspace,
							referenceHead,
							file,
						);
						const { stdout } = await exec("git", ["cat-file", "blob", blob], {
							cwd: repo.workspace,
							signal: context.signal,
							maxBuffer: 8 * 1024 * 1024,
						});
						if (
							Number(end) >
							stdout.split("\n").length - (stdout.endsWith("\n") ? 1 : 0)
						)
							throw new Error(`Code reference exceeds ${file} at ${head}`);
					}
					break;
				}
				case "ids-resolve": {
					if (typeof args.source !== "string" || typeof args.ids !== "string")
						throw new Error(
							"ids-resolve requires source (a named read) and ids (a JSON Pointer)",
						);
					const inputs =
						context.step.type === "check" &&
						output &&
						typeof output === "object"
							? (output as { inputs?: Record<string, unknown> }).inputs
							: undefined;
					const bound = inputs
						? Object.hasOwn(inputs, args.source)
							? inputs[args.source]
							: undefined
						: isNodeEngineStep(context.step)
							? (context.input as Record<string, unknown> | undefined)?.[
									args.source
								]
							: readOutput(
									context.step,
									args.source,
									context.outputs ?? context.run.outputs,
								);
					if (bound === undefined)
						throw new Error(
							`ids-resolve has no bound output for ${args.source}`,
						);
					const ids = new Set(await selectedStrings(bound, args.ids));
					for (const id of await selectedStrings(output, args.path)) {
						await checkpoint();
						if (!ids.has(id)) throw new Error(`Unknown referenced ID: ${id}`);
					}
					break;
				}
				case "media-valid": {
					for (const value of await selectedValues(output, args.path)) {
						await checkpoint();
						verifiedMedia.push(
							await inspectMedia(
								context,
								value,
								args.kind === "video" ? "video" : "image",
							),
						);
					}
					break;
				}
				default:
					throw new Error(
						`${check} uses a runtime-owned contract adapter and does not accept path`,
					);
			}
		} catch (error) {
			if (context.signal.aborted)
				throw context.signal.reason instanceof Error
					? context.signal.reason
					: new DOMException("Evidence verification cancelled", "AbortError");
			const issues = outputValidationError(output, error).issues.map(
				(issue) => ({
					...issue,
					path: args.path as string,
					message: `${check}: ${issue.message}`,
				}),
			);
			throw new OutputValidationError(output, issues);
		}
	}
	if (isNodeEngineStep(context.step))
		retainVerifiedMedia(context, output, verifiedMedia);
	return output;
}
