import type { z } from "zod";
import type { schema } from "../git.js";
import type { NodeContext } from "../NodeDefinition.js";
import { assertWorktree, repositories, textRead } from "./repository-io.js";

export async function execute(ctx: NodeContext<z.output<typeof schema>>) {
	return repositories(ctx, async (io) => {
		const { command, head, branch, repository } = io;
		switch (ctx.step.op) {
			case "status":
				return {
					branch,
					dirty: Boolean(await command("git", ["status", "--porcelain"])),
				};
			case "rev-parse":
				return {
					ref: ctx.step.ref,
					revision: await command("git", [
						"rev-parse",
						"--verify",
						"--end-of-options",
						`${ctx.step.ref}^{commit}`,
					]),
				};
			case "diff": {
				const from =
					ctx.step.from ?? `refs/remotes/origin/${repository.baseBranch}`;
				const to = ctx.step.to;
				// Resolve refs before diff: no path ambiguity or option injection.
				const resolve = (ref: string) =>
					command("git", [
						"rev-parse",
						"--verify",
						"--end-of-options",
						`${ref}^{commit}`,
					]);
				const base = await resolve(from),
					target = await resolve(to);

				const records = (
					await command("git", [
						"diff",
						"--numstat",
						"--no-renames",
						"-z",
						base,
						target,
						"--",
					])
				)
					.split("\0")
					.filter(Boolean);
				const changes = records.map((record) => {
					const match = record.match(/^([0-9]+|-)\t([0-9]+|-)\t([\s\S]*)$/);
					if (!match) throw new Error("Invalid Git diff statistics");
					return {
						path: match[3]!,
						additions: match[1] === "-" ? null : Number(match[1]),
						deletions: match[2] === "-" ? null : Number(match[2]),
					};
				});
				return {
					base,
					target,
					files: changes.map((c) => c.path),
					changes,
					stats: {
						filesChanged: changes.length,
						additions: changes.reduce((n, c) => n + (c.additions ?? 0), 0),
						deletions: changes.reduce((n, c) => n + (c.deletions ?? 0), 0),
						binaryFiles: changes.filter((c) => c.additions === null).length,
					},
				};
			}
			case "commit": {
				await assertWorktree(io);
				const message = textRead(ctx, "message");
				const verify = ctx.step.verify;

				// Retain the pre-commit head separately so a restart can distinguish a lost
				// successful response from a signing/hook failure that created no commit.
				const observe = async () => ({
					parent: await command("git", ["rev-parse", "HEAD"]),
				});
				const { parent } = await ctx.effect(
					`git:commit-parent:${repository.id}`,
					{ message, verify },
					observe,
					observe,
				);
				return ctx.effect(
					`git:commit:${repository.id}`,
					{ message, verify },
					async (key) => {
						if ((await command("git", ["rev-parse", "HEAD"])) !== parent)
							throw new Error("Worktree head changed before commit");
						if (!(await command("git", ["status", "--porcelain"])))
							return { head: parent, committed: false };
						await command("git", ["add", "-A"]);
						// Recipes may bypass hooks; identity, signing and SSH handling still apply.
						await command("git", [
							"commit",
							...(verify ? [] : ["--no-verify"]),
							"-m",
							message,
							"--trailer",
							`Factory-Effect: ${key}`,
						]);
						return {
							head: await command("git", ["rev-parse", "HEAD"]),
							committed: true,
						};
					},
					async (key) => {
						const body = await command("git", ["log", "-1", "--format=%B"]);
						const current = await command("git", ["rev-parse", "HEAD"]);
						return body.split("\n").includes(`Factory-Effect: ${key}`)
							? { head: current, committed: true }
							: current === parent
								? null
								: undefined;
					},
				);
			}
			case "push": {
				await assertWorktree(io);
				const receipt = { head, branch, pushed: true };
				return ctx.effect(
					`git:push:${repository.id}`,
					{ head, branch },
					async () => {
						if ((await command("git", ["rev-parse", "HEAD"])) !== head)
							throw new Error("Worktree head changed before push");
						await command("git", [
							"push",
							"-u",
							"origin",
							`HEAD:refs/heads/${branch}`,
						]);
						return receipt;
					},
					async () => {
						const remote = await command("git", [
							"ls-remote",
							"--heads",
							"origin",
							`refs/heads/${branch}`,
						]);
						// A normal push can safely be resent even when the branch exists.
						return remote.split(/\s/)[0] === head ? receipt : null;
					},
				);
			}
		}
	});
}
