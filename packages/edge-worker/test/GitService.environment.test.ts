import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogger, Issue, RepositoryConfig } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { GitService } from "../src/GitService.js";

const roots: string[] = [];
const logger: ILogger = {
	info() {},
	debug() {},
	warn() {},
	error() {},
	withContext() {
		return this;
	},
} as ILogger;
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "git-service-env-"));
	roots.push(root);
	const repo = join(root, "repo");
	mkdirSync(repo);
	const env = {
		PATH: process.env.PATH!,
		HOME: root,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Selected author",
		GIT_AUTHOR_EMAIL: "author@example.test",
		GIT_COMMITTER_NAME: "Selected committer",
		GIT_COMMITTER_EMAIL: "committer@example.test",
	};
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
	git(["init", "-q", "-b", "main"]);
	writeFileSync(
		join(repo, "bobs-factory-setup.sh"),
		`#!/bin/sh\nnode -e 'require("node:fs").writeFileSync("probe.json",JSON.stringify({author:process.env.GIT_AUTHOR_NAME,home:process.env.HOME,ambient:process.env.GIT_SERVICE_HOST_CANARY??null}))'\n`,
		{ mode: 0o755 },
	);
	git(["add", "bobs-factory-setup.sh"]);
	git(["commit", "-qm", "fixture"]);
	git(["remote", "add", "origin", repo]);
	const repository = {
		id: "fixture",
		name: "fixture",
		repositoryPath: repo,
		workspaceBaseDir: join(root, "worktrees"),
		baseBranch: "main",
	} as RepositoryConfig;
	const issue = {
		id: "fixture",
		identifier: "ENV-57",
		title: "fixture",
		branchName: "env-test",
		labels: async () => ({ nodes: [] }),
	} as unknown as Issue;
	return { root, repo, env, git, repository, issue };
}
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
it("keeps a scoped service environment through real worktree and hook grandchildren without changing the shared service", async () => {
	const { root, env, repository, issue } = fixture();
	vi.stubEnv("GIT_SERVICE_HOST_CANARY", "host-secret");
	const base = new GitService({ factoryHome: root }, logger);
	const scoped = base.withEnvironment(env);
	const workspace = await scoped.createGitWorktree(issue, [repository]);
	expect(workspace.isGitWorktree).toBe(true);
	expect(
		JSON.parse(readFileSync(join(workspace.path, "probe.json"), "utf8")),
	).toEqual({ author: "Selected author", home: root, ambient: null });
	expect(process.env.GIT_SERVICE_HOST_CANARY).toBe("host-secret");
	// The base service still uses the host environment; scoped construction did not switch it.
	const legacy = await base.createGitWorktree(
		{ ...issue, identifier: "ENV-58", branchName: "legacy-test" },
		[repository],
	);
	expect(
		JSON.parse(readFileSync(join(legacy.path, "probe.json"), "utf8")).ambient,
	).toBe("host-secret");
});
it("rejects failed selected fetches without silently creating an unauthenticated fallback workspace", async () => {
	const { root, env, repository, issue, git } = fixture();
	git(["remote", "set-url", "origin", join(root, "missing-remote")]);
	const service = new GitService({ factoryHome: root }, logger).withEnvironment(
		env,
	);
	await expect(service.createGitWorktree(issue, [repository])).rejects.toThrow(
		"No fallback workspace",
	);
	expect(existsSync(join(repository.workspaceBaseDir, issue.identifier))).toBe(
		false,
	);
});

it("retains capacity admission and selected credentials through fetch and setup in a scoped service", async () => {
	const { MachineCapacity } = await import("../src/MachineCapacity.js");
	const { root, env, repo, repository, issue, git } = fixture();
	const capacity = new MachineCapacity(1, join(root, "capacity"));
	const blocker = await capacity.acquireLease();
	const fetchProbe = join(root, "fetch.json");
	const upload = join(root, "upload.sh");
	writeFileSync(
		upload,
		`#!/bin/sh\nnode -e 'require("node:fs").appendFileSync(${JSON.stringify(fetchProbe)},JSON.stringify({author:process.env.GIT_AUTHOR_NAME,ambient:process.env.GIT_SERVICE_HOST_CANARY??null,lease:process.env.BOBS_FACTORY_EXECUTION_LEASE})+"\\n")'\nexec git-upload-pack "$@"\n`,
		{ mode: 0o755 },
	);
	git(["config", "remote.origin.uploadpack", upload]);
	writeFileSync(
		join(repo, "bobs-factory-setup.sh"),
		`#!/bin/sh\nnode -e 'require("node:fs").writeFileSync("probe.json",JSON.stringify({author:process.env.GIT_AUTHOR_NAME,ambient:process.env.GIT_SERVICE_HOST_CANARY??null,lease:process.env.BOBS_FACTORY_EXECUTION_LEASE}))'\n`,
		{ mode: 0o755 },
	);
	git(["add", "bobs-factory-setup.sh"]);
	git(["commit", "-qm", "capacity probe"]);
	vi.stubEnv("GIT_SERVICE_HOST_CANARY", "host-secret");
	const service = new GitService(
		{ factoryHome: root, capacity: () => capacity },
		logger,
	).withEnvironment(env);
	const pending = service.createGitWorktree(issue, [repository]);
	try {
		await vi.waitFor(async () =>
			expect((await capacity.snapshot()).queued).toBe(1),
		);
		expect(existsSync(fetchProbe)).toBe(false);
		expect(
			existsSync(join(repository.workspaceBaseDir, issue.identifier)),
		).toBe(false);
	} finally {
		await blocker.release();
	}
	const workspace = await pending;
	const fetches = readFileSync(fetchProbe, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const probe of fetches)
		expect(probe).toMatchObject({ author: "Selected author", ambient: null });
	const probes = [
		fetches.find((probe) => probe.lease),
		JSON.parse(readFileSync(join(workspace.path, "probe.json"), "utf8")),
	];
	for (const probe of probes) {
		expect(probe).toEqual({
			author: "Selected author",
			ambient: null,
			lease: expect.any(String),
		});
		expect(probe.lease.length).toBeGreaterThan(0);
	}
	expect((await capacity.snapshot()).active).toBe(0);
	expect(process.env.GIT_SERVICE_HOST_CANARY).toBe("host-secret");
});

it.each([
	true,
	false,
])("reuses an existing branch worktree without adopting ownership (registered=%s)", async (registered) => {
	const { StorageRetentionStore, storageDigest } = await import(
		"bobs-factory-core"
	);
	const { root, env, repository, issue, git } = fixture();
	const service = new GitService({ factoryHome: root }, logger).withEnvironment(
		env,
	);
	let original: { path: string };
	if (registered)
		original = await service.createGitWorktree(issue, [repository]);
	else {
		const path = join(root, "external-worktree");
		git(["worktree", "add", "-b", issue.branchName!, path, "main"]);
		original = { path: realpathSync(path) };
	}
	const continued = { ...issue, id: "takeover", identifier: "MANUAL-takeover" };
	const workspace = await service.createGitWorktree(continued, [repository]);
	expect(workspace.path).toBe(original.path);
	expect(
		existsSync(join(repository.workspaceBaseDir, continued.identifier)),
	).toBe(false);
	const store = new StorageRetentionStore(root);
	const resource = await store.workspaceResource(original.path);
	const use = JSON.parse(
		readFileSync(
			join(
				store.directory,
				"workspace-use",
				storageDigest(resource),
				`${storageDigest(continued.id)}.json`,
			),
			"utf8",
		),
	);
	expect(use).toMatchObject({
		owner: continued.id,
		workspace: resource,
		state: "reserved",
	});
	const records = await Promise.all(
		(await store.inventoryPage(0)).map((id) => store.record(id)),
	);
	expect(
		records
			.filter((record) => record.category === "worktree")
			.map((record) => record.path),
	).toEqual(registered ? [original.path] : []);
});

it.each([
	["recreated by the next run", false],
	["left behind by a run that stopped before registering it", true],
])("re-registers a ticket worktree that was removed and %s", async (_name, leftover) => {
	const { StorageRetentionStore, publishStorageJson, storageDigest } =
		await import("bobs-factory-core");
	const { root, env, repository, issue, git } = fixture();
	const service = new GitService({ factoryHome: root }, logger).withEnvironment(
		env,
	);
	const first = await service.createGitWorktree(issue, [repository]);
	git(["worktree", "remove", "--force", first.path]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	if (leftover) git(["worktree", "add", first.path, issue.branchName!]);
	const second = await service.createGitWorktree(issue, [repository]);
	expect(second.path).toBe(first.path);
	const store = new StorageRetentionStore(root);
	const records = await Promise.all(
		(await store.inventoryPage(0)).map((id) => store.record(id)),
	);
	expect(records.map((record) => record.path)).toEqual([
		first.path,
		first.path,
	]);
	// A third launch over the now-registered worktree is a plain continuation.
	await service.createGitWorktree(issue, [repository]);
	expect(await store.inventoryCount()).toBe(2);

	// A reservation owned by a run that is still active keeps the earlier record
	// blocking.
	git(["worktree", "remove", "--force", first.path]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	const reserve = async (owner: string) => {
		await publishStorageJson(
			join(
				store.directory,
				"workspace-use",
				storageDigest(first.path),
				`${storageDigest(owner)}.json`,
			),
			{
				version: 1,
				owner,
				workspace: first.path,
				state: "reserved",
				updatedAt: new Date().toISOString(),
				reason: "Another producer",
			},
		);
		return join(
			store.directory,
			"workspace-use",
			storageDigest(first.path),
			`${storageDigest(owner)}.json`,
		);
	};
	await reserve("running-run");
	const states: Record<string, boolean | undefined> = {
		"running-run": false,
		"failed-run": true,
	};
	const tracked = new GitService(
		{ factoryHome: root, runFinished: (id) => states[id] },
		logger,
	).withEnvironment(env);
	await expect(tracked.createGitWorktree(issue, [repository])).rejects.toThrow(
		"reconcile it",
	);
	// An unknown owner is never assumed finished.
	await reserve("unknown-owner");
	await expect(tracked.createGitWorktree(issue, [repository])).rejects.toThrow(
		"reconcile it",
	);

	// A reservation owned by a failed run is retired with the stale record.
	for (const owner of ["running-run", "unknown-owner"])
		rmSync(
			join(
				store.directory,
				"workspace-use",
				storageDigest(first.path),
				`${storageDigest(owner)}.json`,
			),
		);
	const failedUse = await reserve("failed-run");
	const third = await tracked.createGitWorktree(issue, [repository]);
	expect(third.path).toBe(first.path);
	expect(JSON.parse(readFileSync(failedUse, "utf8"))).toMatchObject({
		owner: "failed-run",
		state: "released",
	});
	const latest = await Promise.all(
		(await store.inventoryPage(0)).map((id) => store.record(id)),
	);
	expect(latest.filter((record) => record.path === first.path)).toHaveLength(3);
});
