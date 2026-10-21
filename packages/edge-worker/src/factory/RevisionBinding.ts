import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { digest } from "./Delivery.js";
import { runRepositories } from "./RepositoryScope.js";
import { stepBindings } from "./StepBindings.js";
import { resolveStepConfig } from "./StepConfig.js";
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
}
/** Exact repository HEAD/tree plus working changes; no timestamps enter the digest. */
export async function outputRevisionBinding(
	context: ExecutionContext,
	previous?: OutputRevisionBinding,
): Promise<OutputRevisionBinding | undefined> {
	const config = resolveStepConfig(context.step);
	if (!config.explicit || config.revision !== "bound") return;
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
			const treeSha = (await git(["rev-parse", "HEAD^{tree}"])).trim();
			const hash = createHash("sha256").update(
				await git(["diff", "--no-ext-diff", "--binary", "HEAD"]),
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
			return {
				id: repo.id,
				headSha,
				treeSha,
				workspaceDigest: hash.digest("hex"),
			};
		}),
	);
	const key = context.stepKey ?? context.run.step ?? context.step.id;
	const history = previous
		? context.run.history.filter(
				(item, index) => index < previous.historyLength || item.step !== key,
			)
		: context.run.history;
	return {
		version: 1,
		repositories,
		historyLength: previous?.historyLength ?? context.run.history.length,
		inputDigest: digest({
			originalInput: context.run.input,
			reads: stepBindings(context, history),
			// Legacy unrestricted roles historically receive the whole scope.
			...(resolveStepConfig(context.step).explicit
				? {}
				: { input: context.input }),
		}),
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
			revision: (
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
