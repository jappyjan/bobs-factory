import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { executeCommand } from "../../FactoryTools.js";
import { type GitProvider, resolveGitProvider } from "../../GitProvider.js";
import { PullRequestSchema } from "../../GitProviderContracts.js";
import type { ProviderCommand } from "../../MergeReadiness.js";
import {
	type RunRepository,
	repositoryRun,
	runRepositories,
} from "../../RepositoryScope.js";
import type { NodeContext } from "../NodeDefinition.js";

export interface RepositoryIO {
	repository: RunRepository;
	command: ProviderCommand;
	head: string;
	branch: string;
	provider(): Promise<GitProvider>;
}
export async function repositories<T>(
	ctx: NodeContext,
	execute: (io: RepositoryIO) => Promise<T>,
) {
	// Repository runs are shallow copies; keep provider evidence on their shared owner.
	ctx.run.ciSupervision ??= { retries: [] };
	const result = [];
	for (const repository of runRepositories(ctx.run)) {
		ctx.signal.throwIfAborted();
		const child = {
			...ctx,
			run: repositoryRun(ctx.run, repository),
			log: () => {},
		};
		const command: ProviderCommand = (exe, args, timeout) =>
			executeCommand(child, exe, args, timeout);
		const head = await command("git", ["rev-parse", "HEAD"]);
		const branch = await command("git", ["branch", "--show-current"]);
		let selected: Promise<GitProvider> | undefined;
		const provider = () =>
			(selected ??= resolveGitProvider(child, command).then(async (value) => {
				repository.providerSnapshot = child.run.gitProvider;
				await ctx.checkpoint();
				return value;
			}));
		result.push({
			id: repository.id,
			head,
			...(await execute({ repository, command, head, branch, provider })),
		});
	}
	return { repositories: result };
}

/** Mutations operate only on the run's dedicated worktree, never its source clone. */
export async function assertWorktree(io: RepositoryIO) {
	const { repository, command, branch } = io;
	if (
		!lstatSync(join(repository.workspace, ".git")).isFile() ||
		realpathSync(await command("git", ["rev-parse", "--show-toplevel"])) !==
			realpathSync(repository.workspace)
	)
		throw new Error("Git mutations require the run's dedicated worktree");
	if (!branch || branch === repository.baseBranch)
		throw new Error("Git mutations require a non-base worktree branch");
}
export function textRead(ctx: NodeContext, name: string, allowEmpty = false) {
	const value = ctx.reads[name];
	if (typeof value !== "string" || (!allowEmpty && !value.trim()))
		throw new Error(`Bind a nonempty ${name} read`);
	return value;
}
export async function requestUrl(
	ctx: NodeContext,
	io: RepositoryIO,
	provider: GitProvider,
) {
	const bound = ctx.reads.pr as
		| { url?: unknown; repositories?: { id: string; url?: unknown }[] }
		| undefined;
	if (bound !== undefined) {
		const url =
			bound?.repositories?.find((r) => r.id === io.repository.id)?.url ??
			(runRepositories(ctx.run).length === 1 ? bound?.url : undefined);
		if (typeof url !== "string")
			throw new Error(`Bind pr with a URL for repository ${io.repository.id}`);
		return url;
	}
	const candidates = await provider.list(io.branch);
	if (candidates.length !== 1)
		throw new Error(
			`Expected one PR for ${io.repository.id}:${io.branch}; found ${candidates.length}`,
		);
	return candidates[0]!.url;
}
export async function requestDetails(provider: GitProvider, url: string) {
	return PullRequestSchema.parse(await provider.view(url));
}
export function assertRequest(
	io: RepositoryIO,
	pr: Awaited<ReturnType<typeof requestDetails>>,
) {
	if (
		pr.state !== "OPEN" ||
		pr.isCrossRepository ||
		pr.headRefName !== io.branch ||
		pr.baseRefName !== io.repository.baseBranch
	)
		throw new Error(
			"PR must be open and match the scoped worktree branch and base",
		);
}
export const marker = (key: string) => `<!-- factory-effect:${key} -->`;

export function checksSummary(checks: { bucket: string }[], complete = true) {
	return {
		total: checks.length,
		passed: checks.filter((c) => c.bucket === "pass").length,
		failed: checks.filter((c) => c.bucket === "fail").length,
		pending: checks.filter((c) => c.bucket === "pending").length,
		complete: complete && checks.every((check) => check.bucket !== "pending"),
	};
}
