import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { RepositoryConfig } from "bobs-factory-core";
import { stepForRun } from "./ToolBindings.js";
import type { WorkflowStep } from "./Workflow.js";
import type { FactoryRun, GraphCheckpoint } from "./WorkflowRuntime.js";

type Command = (exe: string, args: string[]) => Promise<string>;
const passive = new Set(["ci", "handoff", "human-review", "merge"]);

/** A clean completed role followed only by passive gates can be reconstructed.
 * In-flight agents/scripts and grouped workspaces require their original data. */
export function committedRecoveryRevision(run: FactoryRun): string | undefined {
	if ((run.repositories?.length ?? 0) > 1) return;
	const current = (
		frame: GraphCheckpoint | undefined,
		steps: WorkflowStep[],
	): WorkflowStep | undefined => {
		if (!frame) return;
		const step = steps.find((s) => s.id === frame.current);
		if (step?.type !== "workflow") return step;
		const child = run.workflowDefinitions?.find((w) => w.id === step.workflow);
		return child && current(frame.active?.children?.[0], child.steps);
	};
	const step = current(run.checkpoint, run.workflow.steps);
	if (!step || step.type !== "tool" || !passive.has(step.tool ?? "")) return;
	const revision = Object.values(run.roleRevisions ?? {}).sort(
		(a, b) => b.historyLength - a.historyLength,
	)[0];
	if (
		!revision ||
		revision.dirty ||
		!/^[a-f\d]{40,64}$/i.test(revision.headSha) ||
		revision.historyLength < 1 ||
		revision.historyLength > run.history.length
	)
		return;
	for (const item of run.history.slice(revision.historyLength)) {
		const saved = stepForRun(run, item.step);
		if (!saved || saved.type !== "tool" || !passive.has(saved.tool ?? ""))
			return;
	}
	return revision.headSha;
}

/** Restore only an exact retained local branch that the provider still publishes.
 * Never fetch, reset, prune unrelated worktrees, overwrite a path, or invent lost work. */
export async function restoreCommittedWorktree(
	run: FactoryRun,
	repository: RepositoryConfig,
	published: { headRefName: string; headRefOid: string; state: string },
	command: Command,
): Promise<boolean> {
	const head = committedRecoveryRevision(run);
	if (!head || published.state !== "OPEN") return false;
	if (head !== published.headRefOid)
		throw new Error(
			"Worktree recovery blocked: published head differs from the saved clean revision",
		);
	const base = resolve(repository.workspaceBaseDir),
		destination = resolve(run.workspace);
	const inside = (root: string, path: string) => {
		const part = relative(root, path);
		return (
			!!part &&
			part !== ".." &&
			!part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
			!isAbsolute(part)
		);
	};
	if (!inside(base, destination))
		throw new Error(
			"Worktree recovery path is outside the configured workspace directory",
		);
	try {
		lstatSync(destination);
		throw new Error("Worktree recovery refuses to overwrite an existing path");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	// Resolve the existing ancestor before creating anything, including dangling symlinks.
	let ancestor = dirname(destination);
	while (!existsSync(ancestor)) {
		try {
			lstatSync(ancestor);
			throw new Error("Worktree recovery found a dangling ancestor link");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		ancestor = dirname(ancestor);
	}
	let baseAncestor = base;
	while (!existsSync(baseAncestor)) baseAncestor = dirname(baseAncestor);
	const realBase = resolve(
		realpathSync(baseAncestor),
		relative(baseAncestor, base),
	);
	const realDestination = resolve(
		realpathSync(ancestor),
		relative(ancestor, destination),
	);
	if (!inside(realBase, realDestination))
		throw new Error("Worktree recovery path escapes through a symlink");
	const branch = published.headRefName;
	await command("git", ["check-ref-format", `refs/heads/${branch}`]);
	if (
		(await command("git", [
			"rev-parse",
			"--verify",
			`refs/heads/${branch}^{commit}`,
		])) !== head
	)
		throw new Error(
			"Worktree recovery blocked: retained local branch differs from the saved revision",
		);
	const entries = (
		await command("git", ["worktree", "list", "--porcelain", "-z"])
	)
		.split("\0\0")
		.filter(Boolean)
		.map((entry) => entry.split("\0"));
	const stale = entries.find((entry) =>
		entry.includes(`worktree ${destination}`),
	);
	for (const entry of entries) {
		if (entry.includes(`branch refs/heads/${branch}`) && entry !== stale)
			throw new Error(
				"Worktree recovery blocked: branch is checked out elsewhere",
			);
	}
	if (stale) {
		if (
			!stale.includes(`branch refs/heads/${branch}`) ||
			!stale.includes(`HEAD ${head}`) ||
			stale.some((s) => s.startsWith("locked"))
		)
			throw new Error(
				"Worktree recovery blocked: retained worktree registration is changed or locked",
			);
		const common = await command("git", [
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		]);
		const registrations = join(common, "worktrees");
		const admin = readdirSync(registrations)
			.map((name) => join(registrations, name))
			.find(
				(path) =>
					readFileSync(join(path, "gitdir"), "utf8").trim() ===
					join(destination, ".git"),
			);
		if (
			!admin ||
			(await command("git", [
				`--git-dir=${admin}`,
				"diff",
				"--cached",
				"--name-only",
				head,
				"--",
			]))
		)
			throw new Error(
				"Worktree recovery blocked: retained index contains uncommitted work or is unavailable",
			);
	}
	mkdirSync(dirname(destination), { recursive: true });
	await command("git", [
		"worktree",
		"add",
		...(stale ? ["--force"] : []),
		destination,
		branch,
	]);
	return true;
}
