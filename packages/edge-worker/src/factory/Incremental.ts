import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { instructionSlot } from "./InstructionLibrary.js";
import {
	type RepositoryRevision,
	type RunRepository,
	repositoryRun,
	runRepositories,
	scopeRevision,
} from "./RepositoryScope.js";
import { outputRevisionBinding, sameOutputBinding } from "./RevisionBinding.js";
import { hasCheck, readOutput, readsSource } from "./StepConfig.js";
import { snapshotHistory } from "./WorkflowInput.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
export interface RoleRevision {
	headSha: string;
	dirty: boolean;
	historyLength: number;
	at: string;
	repositories?: RepositoryRevision[];
}
export interface RoleProgress {
	visit: number;
	previousOutput?: unknown;
	previousRevision?: RoleRevision;
	currentRevision?: RoleRevision;
	changedFiles: string[];
	diff?: string;
	unchangedCode: boolean;
	uncertain: boolean;
	newHistory: unknown[];
	approvalDelta?: { headSha: string; files: string[] };
	reviewScope?: {
		baseSha: string;
		headSha: string;
		files: string[];
		diffStat: string;
		source: "whole-pr";
		repositories?: (NonNullable<RoleProgress["reviewScope"]> & {
			repositoryId: string;
			name: string;
			workspace: string;
		})[];
	};
}
function historyProgress(context: ExecutionContext) {
	const { run } = context;
	const key = context.stepKey ?? run.step ?? context.step.id;
	const index = context.historyIndex?.() ?? run.history;
	let visits = 0;
	let previous = -1;
	for (let position = 0; position < index.length; position++)
		if (index[position]!.step === key) {
			visits++;
			previous = position;
		}
	return {
		visit: visits + 1,
		previousOutput: previous < 0 ? undefined : run.history[previous]!.output,
		newHistory: context.step.inputs
			? []
			: snapshotHistory(
					run.history,
					run.roleRevisions?.[key]?.historyLength ?? 0,
					context.reviewBaseline?.historyLength ?? run.history.length,
				),
	};
}
export async function roleProgress(
	context: ExecutionContext,
): Promise<RoleProgress> {
	const repositories = runRepositories(context.run);
	if (repositories.length > 1) {
		const parts = await Promise.all(
			repositories.map(async (repository) => ({
				repository,
				progress: await roleProgress({
					...context,
					run: repositoryRun(context.run, repository),
				}),
			})),
		);
		const first = parts[0]!.progress;
		const key = context.stepKey ?? context.run.step ?? context.step.id;
		const previousRevision = context.run.roleRevisions?.[key];
		const revisions = parts.flatMap(({ repository, progress }) =>
			progress.currentRevision
				? [
						{
							repositoryId: repository.id,
							name: repository.name,
							headSha: progress.currentRevision.headSha,
							dirty: progress.currentRevision.dirty,
						},
					]
				: [],
		);
		const scopes = parts.flatMap(({ repository, progress }) =>
			progress.reviewScope
				? [
						{
							...progress.reviewScope,
							repositoryId: repository.id,
							name: repository.name,
							workspace: repository.workspace,
						},
					]
				: [],
		);
		return {
			...first,
			previousRevision,
			...historyProgress(context),
			currentRevision:
				revisions.length === repositories.length
					? {
							...first.currentRevision!,
							headSha: scopeRevision(revisions),
							dirty: revisions.some((item) => item.dirty),
							repositories: revisions,
						}
					: undefined,
			changedFiles: parts.flatMap(({ repository, progress }) =>
				progress.changedFiles.map((file) => `${repository.name}/${file}`),
			),
			diff: parts
				.map(
					({ repository, progress }) =>
						`${repository.name}:\n${progress.diff ?? ""}`,
				)
				.join("\n"),
			uncertain: parts.some(({ progress }) => progress.uncertain),
			unchangedCode: parts.every(({ progress }) => progress.unchangedCode),
			approvalDelta: parts.some(({ progress }) => progress.approvalDelta)
				? {
						headSha:
							context.run.humanDecisions
								?.filter((item) => item.decision === "approve")
								.at(-1)?.headSha ?? "",
						files: parts.flatMap(({ repository, progress }) =>
							(progress.approvalDelta?.files ?? []).map(
								(file) => `${repository.name}/${file}`,
							),
						),
					}
				: undefined,
			reviewScope:
				scopes.length && revisions.length === repositories.length
					? {
							baseSha: scopeRevision(
								scopes.map((scope) => ({
									repositoryId: scope.repositoryId,
									headSha: scope.baseSha,
								})),
							),
							headSha: scopeRevision(revisions),
							source: "whole-pr",
							repositories: scopes,
							files: scopes.flatMap((scope) =>
								scope.files.map((file) => `${scope.name}/${file}`),
							),
							diffStat: scopes
								.map((scope) => `${scope.name}:\n${scope.diffStat}`)
								.join("\n"),
						}
					: undefined,
		};
	}
	const { run } = context,
		key = context.stepKey ?? run.step ?? context.step.id;
	const previousRevision = run.roleRevisions?.[key];
	const result: RoleProgress = {
		...historyProgress(context),
		previousRevision,
		changedFiles: [],
		unchangedCode: false,
		uncertain: true,
	};
	const git = async (args: string[]) =>
		(
			await exec("git", args, {
				cwd: run.workspace,
				timeout: 10000,
				maxBuffer: 2 * 1024 * 1024,
			})
		).stdout;
	try {
		const headSha = (await git(["rev-parse", "HEAD"])).trim();
		const dirty = Boolean((await git(["status", "--porcelain"])).trim());
		result.currentRevision = {
			headSha,
			dirty,
			historyLength: run.history.length,
			at: new Date().toISOString(),
		};
		// Guide snapshots need runtime-owned revision scope even when the agent's
		// upstream outputs are restricted by a customized recipe.
		if (readsSource(context.step, "mergeReadiness")) {
			const receipt = (run.mergeReadiness ??
				readOutput(context.step, "ci", context.outputs ?? run.outputs)) as
				| { baseSha?: string }
				| undefined;
			if (receipt?.baseSha) {
				const baseSha = (
					await git(["merge-base", receipt.baseSha, headSha])
				).trim();
				result.reviewScope = {
					baseSha,
					headSha,
					source: "whole-pr",
					files: (
						await git(["diff", "--name-only", "-z", `${baseSha}...${headSha}`])
					)
						.split("\0")
						.filter(Boolean),
					diffStat: await git(["diff", "--stat", `${baseSha}...${headSha}`]),
				};
			}
		}
		if (hasCheck(context.step, "requirement-coverage")) {
			const approval = [...(run.humanDecisions ?? [])]
				.reverse()
				.find((d) => d.decision === "approve");
			if (approval)
				result.approvalDelta = {
					headSha: approval.headSha,
					files: (
						await git(["diff", "--name-only", "-z", approval.headSha, headSha])
					)
						.split("\0")
						.filter(Boolean),
				};
		}
		if (previousRevision) {
			result.changedFiles = (
				await git(["diff", "--name-only", "-z", previousRevision.headSha])
			)
				.split("\0")
				.filter(Boolean);
			result.diff = await git([
				"diff",
				"--no-ext-diff",
				"--unified=3",
				previousRevision.headSha,
			]);
			result.uncertain = dirty || previousRevision.dirty;
			result.unchangedCode =
				!result.uncertain && previousRevision.headSha === headSha;
		}
	} catch {
		/* Missing/huge revision data requires a full inspection, never evidence reuse. */
	}
	return result;
}
export function dependencyHashes(
	workspace: string,
	paths: string[],
	repositories: RunRepository[] = [],
): Record<string, string> {
	if (!paths.length)
		throw new Error("An unchanged area needs explicit file dependencies");
	const root = realpathSync(workspace);
	const hashes: Record<string, string> = {};
	// Git supplies source membership, including deleted tracked files. Explicit file
	// dependencies still include ignored runtime assets when requested by the scope.
	const sourceFiles = new Set(
		(repositories.length > 1 ? repositories : [{ workspace: root }]).flatMap(
			(repository) =>
				execFileSync(
					"git",
					["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
					{
						cwd: repository.workspace,
						encoding: "utf8",
						maxBuffer: 32 * 1024 * 1024,
					},
				)
					.split("\0")
					.filter(Boolean)
					.map((file) =>
						relative(root, resolve(realpathSync(repository.workspace), file)),
					),
		),
	);
	const membership = new Set(sourceFiles);
	for (const file of sourceFiles) {
		const parts = file.split("/");
		for (let i = 1; i < parts.length; i++)
			membership.add(parts.slice(0, i).join("/"));
	}
	const included = (path: string) => membership.has(path);

	const inside = (path: string) => {
		const name = relative(root, path);
		if (
			!name ||
			name === ".." ||
			name.split(/[\\/]/)[0] === ".." ||
			isAbsolute(name)
		)
			throw new Error("Visual dependencies must be repository files");
	};
	const visit = (path: string, ancestors = new Set<string>()) => {
		const full = resolve(root, path);
		inside(full);
		if (!existsSync(full)) {
			hashes[path] = "missing";
			return;
		}
		const real = realpathSync(full);
		inside(real);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			if (ancestors.has(real))
				throw new Error(`Cyclic visual dependency directory: ${path}`);
			const next = new Set([...ancestors, real]);
			hashes[`${path}/`] = createHash("sha256")
				.update("directory")
				.digest("hex");
			for (const entry of readdirSync(full).sort()) {
				if ([".git", "node_modules"].includes(entry)) continue;
				const child = `${path}/${entry}`;
				// A tracked internal symlink may target a directory: apply ignore rules
				// against the real target as well, while retaining cycle/escape checks.
				if (!included(child)) {
					if (real === full) continue;
					const realChild = relative(root, realpathSync(resolve(root, child)));
					if (!included(realChild)) continue;
				}
				visit(child, next);
			}
		} else
			hashes[path] = createHash("sha256")
				.update(readFileSync(full))
				.digest("hex");
	};
	for (const path of [...new Set(paths)].sort()) {
		const prefix = path.replace(/\/\*\*\/?$/, "");
		if (/[*?[\]{}]/.test(prefix))
			throw new Error(
				"Visual dependencies support exact files or directory/** paths",
			);
		visit(prefix);
		for (const file of [...sourceFiles].sort()) {
			if (file.startsWith(`${prefix}/`) && !existsSync(resolve(root, file)))
				hashes[file] = "missing";
		}
	}
	return Object.fromEntries(
		Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)),
	);
}

export function dependencyCovers(file: string, dependency: string): boolean {
	const prefix = dependency.replace(/\/\*\*\/?$/, "");
	return file === prefix || file.startsWith(`${prefix}/`);
}

/** Revalidate saved output after a post-processing failure without launching another agent. */
export async function completedAgentResult(
	context: ExecutionContext,
): Promise<{ output: unknown } | undefined> {
	const saved = context.resumeAgent?.result;
	if (!saved) return;
	const binding = await outputRevisionBinding(context, saved.binding);
	if (binding && !sameOutputBinding(saved.binding, binding)) return;
	context.progress = await roleProgress(context);
	const current = context.progress.currentRevision;
	if (
		!current ||
		current.dirty ||
		saved.revision.dirty ||
		current.headSha !== saved.revision.headSha
	)
		return;
	context.log(
		"Revalidating completed agent output; existing work is preserved.",
	);
	return { output: structuredClone(saved.output) };
}
export const incrementalInstructions = `On repeated visits, start with /progress through factory-context: previous role result, revision, changed files/diff and new history. When compact memory is present, /progress/newHistory is an index: follow outputPath only for relevant new evidence, and use /contextMemory/reviewLedger and /contextMemory/reviewRounds for past findings, dispositions and review reasoning. Reuse established decisions and supported findings; inspect only changed requirements/files and affected dependencies, while retaining all unresolved findings and disputes. Do not reread the entire ticket/plan/repository by default. Fetch unchanged context only when needed to assess a new change. An uncertain or dirty revision requires full relevant inspection. Automated F1 validation uses deterministic mocked agents or recorded transcript replays. Set F1_AGENT_MODE=mock and inject mocked runners in embedded harnesses; older worktree harnesses may require explicit mocking. Live agent CLI/API validation requires explicit user authorization for provider credits. Report mocked evidence accurately. Never skip required checks or assume human approval. If code is unchanged, validate new feedback/results rather than redoing the same repository exploration. Planning/clarification should update prior results for new answers/feedback, not start over; reviewers assess the delta, regressions and all unresolved findings, preserving stable issue IDs and past dispositions.`;

export { incrementalRoleInstructions } from "./InstructionLibrary.js";

/** Runtime role instructions follow the accepted shared instruction IDs. */
export function roleInstructions(step: object): string {
	return instructionSlot(step, "role");
}
