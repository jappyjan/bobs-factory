import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryConfig } from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { StepSchema } from "../src/factory/Workflow.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";
import {
	committedRecoveryRevision,
	restoreCommittedWorktree,
} from "../src/factory/WorktreeRecovery.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function fixture() {
	const directory = realpathSync(
		mkdtempSync(join(tmpdir(), "worktree-recovery-")),
	);
	directories.push(directory);
	const repo = join(directory, "repo"),
		base = join(directory, "worktrees");
	mkdirSync(repo);
	mkdirSync(base);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-q", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	writeFileSync(join(repo, "file.txt"), "Retained committed work");
	git("add", ".");
	git("-c", "commit.gpgsign=false", "commit", "-qm", "Initial");
	const head = git("rev-parse", "HEAD"),
		workspace = join(base, "TASK-1");
	git("worktree", "add", "-b", "task-1", workspace);
	const guide = StepSchema.parse({
		id: "guide",
		name: "Guide",
		type: "agent",
		prompt: "Guide",
	});
	const handoff = StepSchema.parse({
		id: "handoff",
		name: "Handoff",
		type: "tool",
		tool: "handoff",
	});
	const run = {
		workspace,
		history: [{ step: "guide", output: {}, at: "now" }],
		roleRevisions: {
			guide: { headSha: head, dirty: false, historyLength: 1, at: "now" },
		},
		workflow: { id: "test", steps: [guide, handoff] },
		checkpoint: {
			current: "handoff",
			visits: { handoff: 1 },
			active: { phase: "executing" },
		},
	} as unknown as FactoryRun;
	const repository = {
		repositoryPath: repo,
		workspaceBaseDir: base,
	} as RepositoryConfig;
	const published = { headRefName: "task-1", headRefOid: head, state: "OPEN" };
	const commands: string[][] = [];
	const command = async (exe: string, args: string[]) => {
		expect(exe).toBe("git");
		commands.push(args);
		return git(...args);
	};
	return {
		run,
		repository,
		published,
		command,
		commands,
		workspace,
		git,
		directory,
		head,
	};
}
it.each([
	false,
	true,
])("restores the exact retained committed branch after cleanup (registration pruned=%s)", async (pruned) => {
	const f = fixture();
	if (pruned) f.git("worktree", "remove", f.workspace);
	else rmSync(f.workspace, { recursive: true });
	const saved = structuredClone(f.run);
	expect(
		await restoreCommittedWorktree(f.run, f.repository, f.published, f.command),
	).toBe(true);
	expect(f.run).toEqual(saved);
	expect(
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: f.workspace,
			encoding: "utf8",
		}).trim(),
	).toBe(f.head);
	expect(
		execFileSync("git", ["status", "--porcelain"], {
			cwd: f.workspace,
			encoding: "utf8",
		}),
	).toBe("");
	expect(
		f.commands.some(
			(c) => c.includes("prune") || c.includes("reset") || c.includes("fetch"),
		),
	).toBe(false);
});
it.each([
	"dirty",
	"inflight",
	"later-script",
	"grouped",
])("refuses unprovable checkpoint recovery: %s", async (reason) => {
	const f = fixture();
	if (reason === "dirty") f.run.roleRevisions!.guide!.dirty = true;
	if (reason === "inflight") f.run.checkpoint!.current = "guide";
	if (reason === "later-script")
		f.run.history.push({ step: "unknown-script", output: {}, at: "later" });
	if (reason === "grouped")
		f.run.repositories = [{}, {}] as FactoryRun["repositories"];
	rmSync(f.workspace, { recursive: true });
	expect(committedRecoveryRevision(f.run)).toBeUndefined();
	expect(
		await restoreCommittedWorktree(f.run, f.repository, f.published, f.command),
	).toBe(false);
	expect(f.commands).toEqual([]);
	expect(existsSync(f.workspace)).toBe(false);
});
it.each([
	"published-head",
	"local-head",
	"staged-index",
	"locked",
	"other-checkout",
	"outside",
	"symlink",
	"existing",
])("does not overwrite work or cross a proof boundary: %s", async (reason) => {
	const f = fixture();
	if (reason === "published-head") f.published.headRefOid = "a".repeat(40);
	if (reason === "staged-index") {
		writeFileSync(join(f.workspace, "file.txt"), "Uncommitted staged work");
		execFileSync("git", ["add", "."], { cwd: f.workspace });
	}
	if (reason === "locked") f.git("worktree", "lock", f.workspace);
	if (reason !== "existing") rmSync(f.workspace, { recursive: true });
	if (reason === "local-head") {
		f.git(
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--allow-empty",
			"-qm",
			"Different",
		);
		f.git("update-ref", "refs/heads/task-1", f.git("rev-parse", "main"));
	}
	if (reason === "other-checkout")
		f.git("worktree", "add", "--force", join(f.directory, "other"), "task-1");
	if (reason === "outside") f.run.workspace = join(f.directory, "outside");
	if (reason === "symlink") {
		mkdirSync(join(f.directory, "external"));
		symlinkSync(
			join(f.directory, "external"),
			join(f.repository.workspaceBaseDir, "link"),
			"dir",
		);
		f.run.workspace = join(f.repository.workspaceBaseDir, "link", "TASK-1");
	}
	await expect(
		restoreCommittedWorktree(f.run, f.repository, f.published, f.command),
	).rejects.toThrow(/recovery|differs/i);
	expect(
		f.commands.filter((c) => c[0] === "worktree" && c[1] === "add"),
	).toEqual([]);
});
