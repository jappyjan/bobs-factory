import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ILogger, StorageRetentionStore } from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { GitService } from "../src/GitService.js";
import {
	type RetainedWorkspaceProof,
	WorktreeArtifacts,
} from "../src/storage/WorktreeArtifacts.js";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
async function fixture(
	hook = '#!/bin/sh\nprintf \'%s\' "$RETENTION_MARKER" > "$RETENTION_OUTPUT"\n',
) {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "retention-worktree-")),
	);
	homes.push(home);
	const repository = join(home, "repo"),
		root = join(home, "custom-workspaces"),
		workspace = join(root, "delivered");
	await mkdir(repository);
	await mkdir(root);
	const environment = {
		PATH: process.env.PATH!,
		HOME: home,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.test",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.test",
		RETENTION_MARKER: "accepted-environment",
		RETENTION_OUTPUT: join(home, "hook-output"),
	};
	const git = (args: string[], path = repository) =>
		execFileSync("git", args, {
			cwd: path,
			env: environment,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(["init", "-q", "-b", "main"]);
	await writeFile(join(repository, "file"), "durable delivered content");
	await writeFile(join(repository, ".gitignore"), "unique-ignored\n");
	await writeFile(join(repository, "bobs-factory-teardown.sh"), hook, {
		mode: 0o755,
	});
	git(["add", "."]);
	git(["commit", "-qm", "delivered"]);
	const head = git(["rev-parse", "HEAD"]);
	git(["worktree", "add", "-qb", "delivered", workspace]);
	const store = new StorageRetentionStore(home);
	const record = await store.register({
		path: workspace,
		root,
		category: "worktree",
		producer: "fixture",
		operation: "delivered",
		dependencies: [],
		evidence: [],
		completedAt: "2020-01-01T00:00:00.000Z",
		verifiedAt: "2020-01-01T00:00:00.000Z",
		reconciledAt: "2020-01-01T00:00:00.000Z",
	});
	const proof: RetainedWorkspaceProof = {
		path: workspace,
		repository,
		root,
		creator: "fixture",
		identity: record.identity,
		completedAt: record.completedAt,
		mergeConfirmed: true,
		mergedHead: head,
		protection: [],
	};
	const service = new GitService(
		{ factoryHome: home, childEnvironment: environment },
		{
			info() {},
			warn() {},
			error() {},
			debug() {},
			withContext() {
				return this;
			},
		} as ILogger,
	);
	const adapter = new WorktreeArtifacts(
		{
			inspect: async () => [proof],
			remove: async (members, signal, journal) =>
				service.removeRetainedWorktrees(
					workspace,
					members,
					"FIXTURE-134",
					signal,
					async () => {
						const fresh = await adapter.observe(record, signal);
						if (fresh.protection.length)
							throw new Error(fresh.protection.join("; "));
					},
					journal,
				),
		},
		environment,
	);
	return { home, workspace, record, proof, adapter, git, environment };
}
it("runs teardown with the accepted environment and safely removes the exact custom-root worktree", async () => {
	const { home, workspace, record, adapter, git } = await fixture();
	expect(
		(await adapter.observe(record, new AbortController().signal)).protection,
	).toEqual([]);
	const phases: string[] = [];
	await adapter.remove(record, new AbortController().signal, async (phase) => {
		phases.push(phase);
	});
	expect(await readFile(join(home, "hook-output"), "utf8")).toBe(
		"accepted-environment",
	);
	expect(git(["worktree", "list", "--porcelain"])).not.toContain(workspace);
	expect(phases.some((phase) => phase.startsWith("hook-completed:"))).toBe(
		true,
	);
});
it.each([
	"untracked",
	"unique-ignored",
	"file",
])("retains %s user content, including ignored files", async (name) => {
	const { workspace, record, adapter } = await fixture();
	await writeFile(join(workspace, name), "unique user data");
	const checked = await adapter.observe(record, new AbortController().signal);
	expect(checked.protection).toContain(
		"Tracked changes, untracked files or unique ignored content remain",
	);
	await expect(
		adapter.remove(record, new AbortController().signal, async () => {}),
	).rejects.toThrow();
	expect(await readFile(join(workspace, name), "utf8")).toBe(
		"unique user data",
	);
});
it("retains commits added after the delivered revision and saved native dependencies", async () => {
	const { workspace, record, proof, adapter, git } = await fixture();
	await writeFile(join(workspace, "file"), "later local work");
	git(["add", "."], workspace);
	git(["commit", "-qm", "local only"], workspace);
	proof.protection = ["Saved native continuation needs this directory"];
	const checked = await adapter.observe(record, new AbortController().signal);
	expect(checked.protection).toEqual(
		expect.arrayContaining([
			"Local commits differ from the delivered revision",
			"Saved native continuation needs this directory",
		]),
	);
});
it("retains the target when teardown creates new user files or fails", async () => {
	for (const hook of [
		"#!/bin/sh\nprintf new > new-user-file\n",
		"#!/bin/sh\nexit 1\n",
	]) {
		const { workspace, record, adapter } = await fixture(hook);
		await expect(
			adapter.remove(record, new AbortController().signal, async () => {}),
		).rejects.toThrow();
		expect(await readFile(join(workspace, "file"), "utf8")).toBe(
			"durable delivered content",
		);
	}
});

it("protects a whole group for one waiting member, then revalidates remaining members during safe removal", async () => {
	const { home, workspace, proof, git, environment } = await fixture();
	const { storageIdentity } = await import("bobs-factory-core");
	const group = join(proof.root, "group"),
		first = join(group, "first"),
		second = join(group, "second");
	await mkdir(group);
	git(["worktree", "move", workspace, first]);
	git(["worktree", "add", "-qb", "second", second]);
	const store = new StorageRetentionStore(home);
	const record = await store.register({
		path: group,
		root: proof.root,
		category: "worktree",
		producer: "fixture",
		operation: "group",
		dependencies: [],
		evidence: [],
		completedAt: proof.completedAt,
		verifiedAt: proof.completedAt,
		reconciledAt: proof.completedAt,
	});
	const members: RetainedWorkspaceProof[] = [
		{
			...proof,
			path: first,
			identity: await storageIdentity(first, proof.root),
		},
		{
			...proof,
			path: second,
			identity: await storageIdentity(second, proof.root),
			protection: ["Waiting member needs Resume"],
		},
	];
	const service = new GitService({
		factoryHome: home,
		childEnvironment: environment,
	});
	const adapter = new WorktreeArtifacts(
		{
			inspect: async () => members,
			remove: async (proofs, signal, journal) =>
				service.removeRetainedWorktrees(
					group,
					proofs,
					"GROUP-134",
					signal,
					async (remaining) => {
						const fresh = await adapter.observe(record, signal, {
							members: remaining,
						});
						if (fresh.protection.length)
							throw Error(fresh.protection.join("; "));
					},
					journal,
				),
		},
		environment,
	);
	await expect(
		adapter.remove(record, new AbortController().signal, async () => {}),
	).rejects.toThrow("Waiting member");
	expect(await readFile(join(first, "file"), "utf8")).toBe(
		"durable delivered content",
	);
	members[1]!.protection = [];
	await writeFile(join(group, "unexpected-parent-data"), "unique");
	await expect(
		adapter.remove(record, new AbortController().signal, async () => {}),
	).rejects.toThrow("Unexpected parent-level");
	expect(await readFile(join(first, "file"), "utf8")).toBe(
		"durable delivered content",
	);
	expect(await readFile(join(second, "file"), "utf8")).toBe(
		"durable delivered content",
	);
	await expect(readFile(join(home, "hook-output"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	await rm(join(group, "unexpected-parent-data"));
	await adapter.remove(record, new AbortController().signal, async () => {});
	expect(git(["worktree", "list", "--porcelain"])).not.toContain(group);
});

it("cancels an in-flight teardown and retains the original Git worktree", async () => {
	const { home, workspace, record, adapter } = await fixture(
		'#!/bin/sh\nprintf started > "$RETENTION_OUTPUT"\nsleep 30\n',
	);
	const controller = new AbortController();
	const removing = adapter.remove(record, controller.signal, async () => {});
	await expect
		.poll(async () => {
			try {
				return await readFile(join(home, "hook-output"), "utf8");
			} catch {
				return "";
			}
		})
		.toBe("started");
	controller.abort(new Error("Fixture cancellation"));
	await expect(removing).rejects.toThrow("cancelled");
	expect(await readFile(join(workspace, "file"), "utf8")).toBe(
		"durable delivered content",
	);
});

it("yields at one second while an ownership check is still in flight and resumes that exact check", async () => {
	const { record } = await fixture();
	let release!: (proofs: RetainedWorkspaceProof[]) => void;
	const pending = new Promise<RetainedWorkspaceProof[]>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const adapter = new WorktreeArtifacts(
		{
			inspect: async () => {
				calls++;
				return pending;
			},
			remove: async () => {},
		},
		process.env,
	);
	const started = performance.now();
	try {
		const first = await adapter.observe(record, new AbortController().signal);
		expect(first.complete).toBe(false);
		expect(performance.now() - started).toBeLessThan(1600);
		release([]);
		const next = await adapter.observe(record, new AbortController().signal);
		expect(next.complete).toBe(true);
		expect(calls).toBe(1);
	} finally {
		release([]);
		await adapter.close();
	}
});

it("times out stalled Git removal and retains the exact original workspace", async () => {
	const { home, workspace, proof, environment } = await fixture();
	const bin = join(home, "controlled-bin");
	await mkdir(bin);
	await writeFile(
		join(bin, "git"),
		'#!/bin/sh\ncase "$*" in *"worktree remove"*) exec sleep 60;; *) exec /usr/bin/git "$@";; esac\n',
		{ mode: 0o755 },
	);
	const service = new GitService({
		factoryHome: home,
		childEnvironment: { ...environment, PATH: `${bin}:${environment.PATH}` },
	});
	const started = performance.now();
	await expect(
		service.removeRetainedWorktrees(
			workspace,
			[proof],
			"TIMEOUT-134",
			new AbortController().signal,
			async () => {},
			async () => {},
		),
	).rejects.toThrow();
	expect(performance.now() - started).toBeLessThan(35000);
	expect(await readFile(join(workspace, "file"), "utf8")).toBe(
		"durable delivered content",
	);
}, 180000);

it("requires explicit idempotent retry after a crash between teardown effects and its success receipt", async () => {
	const { home, workspace, record, adapter } = await fixture(
		'#!/bin/sh\nprintf "run\\n" >> "$RETENTION_OUTPUT"\n',
	);
	const { StorageRetention } = await import(
		"../src/storage/StorageRetention.js"
	);
	const coordinator = new StorageRetention(home, { worktree: adapter });
	const remove = adapter.remove.bind(adapter);
	let crash = true;
	adapter.remove = (record, signal, journal) =>
		remove(record, signal, async (phase) => {
			if (crash && phase.startsWith("hook-completed:")) {
				crash = false;
				throw new Error("Injected crash before hook success receipt");
			}
			await journal(phase);
		});
	const execute = async (idempotent = false) => {
		let preview = await coordinator.preview();
		while (!preview.complete) preview = await coordinator.preview();
		await coordinator.execute(preview.id, [record.id], idempotent);
		await expect
			.poll(async () => (await coordinator.status()).outcome?.completedAt, {
				timeout: 10000,
			})
			.toBeTruthy();
		return (await coordinator.status()).outcome!;
	};
	try {
		expect((await execute()).results[0]?.reason).toContain("Injected crash");
		expect((await execute()).results[0]?.reason).toContain(
			"Interrupted teardown may have run",
		);
		expect(await readFile(join(home, "hook-output"), "utf8")).toBe("run\n");
		expect(await readFile(join(workspace, "file"), "utf8")).toBe(
			"durable delivered content",
		);
		expect((await execute(true)).results[0]?.phase).toBe("completed");
		expect(await readFile(join(home, "hook-output"), "utf8")).toBe(
			"run\nrun\n",
		);
	} finally {
		await coordinator.stop();
	}
});

it("expires the two-minute teardown limit and cancels its process before removing Git content", async () => {
	const { home, workspace, record, adapter } = await fixture(
		'#!/bin/sh\nprintf started > "$RETENTION_OUTPUT"\nsleep 150\nprintf finished > "$RETENTION_OUTPUT"\n',
	);
	const started = performance.now();
	await expect(
		adapter.remove(record, new AbortController().signal, async () => {}),
	).rejects.toThrow(/timed out/);
	expect(performance.now() - started).toBeGreaterThanOrEqual(119000);
	expect(performance.now() - started).toBeLessThan(128000);
	expect(await readFile(join(home, "hook-output"), "utf8")).toBe("started");
	expect(await readFile(join(workspace, "file"), "utf8")).toBe(
		"durable delivered content",
	);
}, 135000);
