import { execFile } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { verifiedScreenshot } from "./FactoryTools.js";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";
import { runRepositories } from "./RepositoryScope.js";
import {
	CHECK_IDS,
	type CheckId,
	readOutput,
	resolveStepConfig,
} from "./StepConfig.js";
import { evidenceFile, probeVideo } from "./Video.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

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
/**
 * Generic checks with explicit path arguments execute during output correction.
 * Stock contract adapters (media receipts, QA, guides, architecture, impact reuse)
 * are selected by the same IDs at their existing runtime stages. In particular,
 * impact-reuse owns live snapshots, prior receipts and convergence; pure rules
 * never replace its independent evidence comparisons or alter its hard failures.
 */
export async function runEvidenceChecks(
	context: ExecutionContext,
	output: unknown,
	phase: EvidencePhase = "correction",
): Promise<unknown> {
	for (const { check, args } of resolveStepConfig(context.step).checks) {
		// Checks without explicit selector arguments are stock adapters. Their
		// existing authoring/finalization/gate implementations own that stage.
		if (phase !== "correction") continue;
		if (typeof args.path !== "string") {
			if (
				[
					"files-exist",
					"media-valid",
					"code-refs-valid",
					"ids-resolve",
				].includes(check) &&
				!["capture", "guide", "qa-scope", "qa-gate"].includes(
					String(args.adapter),
				)
			)
				throw outputValidationError(
					output,
					new Error(
						`${check} requires a path selector or an explicit stock adapter`,
					),
				);
			continue;
		}
		try {
			switch (check as CheckId) {
				case "files-exist": {
					const repo = repository(context, args.repositoryId);
					for (const file of strings(output, args.path)) {
						if (resolveStepConfig(context.step).revision === "bound") {
							const head = await revision(context, repo.id, repo.workspace);
							await repositoryBlob(context, repo.workspace, head, file);
						} else fileInWorkspace(repo.workspace, file);
					}
					break;
				}
				case "code-refs-valid": {
					for (const reference of values(output, args.path)) {
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
						const blob = await repositoryBlob(
							context,
							repo.workspace,
							head,
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
					const bound = readOutput(
						context.step,
						args.source,
						context.outputs ?? context.run.outputs,
					);
					if (bound === undefined)
						throw new Error(
							`ids-resolve has no bound output for ${args.source}`,
						);
					const ids = new Set(strings(bound, args.ids));
					for (const id of strings(output, args.path))
						if (!ids.has(id)) throw new Error(`Unknown referenced ID: ${id}`);
					break;
				}
				case "media-valid": {
					for (const file of strings(output, args.path)) {
						if (args.kind === "video")
							await probeVideo(
								evidenceFile(file, context.evidenceDir),
								context.signal,
							);
						else {
							const path = verifiedScreenshot(file, context.evidenceDir);
							if (!readFileSync(path).length) throw new Error("Image is empty");
						}
					}
					break;
				}
				default:
					throw new Error(
						`${check} uses a runtime-owned contract adapter and does not accept path`,
					);
			}
		} catch (error) {
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
	return output;
}
