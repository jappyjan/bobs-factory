import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCLIIssueTracker,
	JsonSnapshotStore,
	StorageRetentionStore,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../../../packages/edge-worker/src/EdgeWorker.js";
import { f1AgentHandlers } from "../src/MockAgentRunner.js";

const homes: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});
async function port() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No fixture port");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}
it("keeps native continuation and durable ownership after a terminal issue event and worker restart with simulated agents", async () => {
	vi.stubEnv("F1_AGENT_MODE", "mock");
	vi.stubEnv("BOBS_FACTORY_FACTORY_PORT", "0");
	vi.stubEnv("BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE", "1");
	const home = await realpath(await mkdtemp(join(tmpdir(), "f1-storage-134-")));
	homes.push(home);
	const repository = join(home, "repository"),
		remote = join(home, "remote.git");
	await mkdir(repository);
	const environment = {
		PATH: process.env.PATH!,
		HOME: home,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.test",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.test",
	};
	const git = (args: string[], cwd = repository) =>
		execFileSync("git", args, { cwd, env: environment, stdio: "pipe" });
	git(["init", "-q", "-b", "main"]);
	await writeFile(join(repository, "sentinel"), "delivered bytes");
	git(["add", "."]);
	git(["commit", "-qm", "fixture"]);
	git(["init", "--bare", "-q", remote]);
	git(["remote", "add", "origin", remote]);
	git(["push", "-q", "-u", "origin", "main"]);
	const storage = new StorageRetentionStore(home);
	await storage.configure({ enabled: false }, 0);
	const serverPort = await port();
	const configuration = {
		factoryHome: home,
		serverPort,
		serverHost: "127.0.0.1",
		issueTrackerFactory: createCLIIssueTracker,
		handlers: f1AgentHandlers(
			"mock",
			"Saved mock continuation remains available",
		),
		repositories: [
			{
				id: "fixture",
				name: "Fixture",
				repositoryPath: repository,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				githubUrl: "https://github.com/f1-fixture/storage",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		linearWorkspaces: {
			"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
		},
	};
	const worker = new EdgeWorker(configuration);
	const rpc = async (method: string, params: unknown) => {
		const response = await fetch(`http://127.0.0.1:${serverPort}/cli/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
		});
		const value = (await response.json()) as { error?: unknown; result: any };
		if (value.error) throw Error(JSON.stringify(value.error));
		return value.result;
	};
	let workspace = "",
		nativeRunPath = "",
		nativeSessionId = "";
	try {
		await worker.start();
		const created = await rpc("createIssue", {
			teamId: "team-default",
			title: "Retain saved continuation",
			description: "[workflow=simple]\nReturn a short response.",
		});
		const started = await rpc("startSession", { issueId: created.issue.id });
		await expect
			.poll(
				async () =>
					(
						await rpc("viewSession", {
							sessionId: started.session.sessionId,
							limit: 100,
						})
					).activities.some(
						(activity: { type: string }) => activity.type === "response",
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
		const count = await storage.inventoryCount();
		expect(count).toBeGreaterThan(0);
		const records = await Promise.all(
			(await storage.inventoryPage(0)).map((id) => storage.record(id)),
		);
		workspace = records.find((record) => record.category === "worktree")!.path;
		await writeFile(
			join(workspace, "unique-ignored-user-data"),
			"must survive terminal event",
		);
		await rpc("terminateIssue", {
			issueId: created.issue.id,
			action: "completed",
		});
		await expect
			.poll(async () => {
				try {
					const { readdir } = await import("node:fs/promises");
					return (
						(await readdir(join(storage.directory, "terminal-observations")))
							.length > 0
					);
				} catch {
					return false;
				}
			})
			.toBe(true);
		const { readdir } = await import("node:fs/promises");
		nativeRunPath = join(
			storage.directory,
			"terminal-observations",
			(await readdir(join(storage.directory, "terminal-observations")))[0]!,
		);
		nativeSessionId = JSON.parse(await readFile(nativeRunPath, "utf8"))
			.nativeSessionIds.claude;
		expect(nativeSessionId).toMatch(/^f1-mock-/);
		expect(
			await readFile(join(workspace, "unique-ignored-user-data"), "utf8"),
		).toBe("must survive terminal event");
		expect((await stat(workspace)).isDirectory()).toBe(true);
	} finally {
		await worker.stop();
	}
	const restarted = new EdgeWorker(configuration);
	try {
		await restarted.start();
		const receipt = JSON.parse(await readFile(nativeRunPath, "utf8"));
		expect(receipt.nativeSessionIds.claude).toBe(nativeSessionId);
		const resumed = f1AgentHandlers("mock")!.createAgentRunner!("claude", {
			factoryHome: home,
			workingDirectory: workspace,
			resumeSessionId: nativeSessionId,
		});
		expect((await resumed.start("Resume saved fixture")).sessionId).toBe(
			nativeSessionId,
		);
		expect(
			await readFile(join(workspace, "unique-ignored-user-data"), "utf8"),
		).toBe("must survive terminal event");
		expect((await stat(workspace)).isDirectory()).toBe(true);
	} finally {
		await restarted.stop();
	}
}, 60_000);

it("removes an aged delivered worktree through startup reconciliation while retaining stopped Resume work", async () => {
	const { GitService } = await import(
		"../../../packages/edge-worker/src/GitService.js"
	);
	const { WorkflowRuntime } = await import(
		"../../../packages/edge-worker/src/factory/WorkflowRuntime.js"
	);
	const { validateWorkflows } = await import(
		"../../../packages/edge-worker/src/factory/Workflow.js"
	);
	const { defaultWorkflows } = await import(
		"../../../packages/edge-worker/src/factory/defaultWorkflows.js"
	);
	const { factoryStorage } = await import(
		"../../../packages/edge-worker/src/storage/FactoryStorage.js"
	);
	const { StorageRetention } = await import(
		"../../../packages/edge-worker/src/storage/StorageRetention.js"
	);
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "f1-delivered-storage-")),
	);
	homes.push(home);
	const repository = join(home, "repo"),
		root = join(home, "custom-root");
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
	};
	const git = (args: string[]) =>
		execFileSync("git", args, {
			cwd: repository,
			env: environment,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git(["init", "-q", "-b", "main"]);
	await writeFile(join(repository, "file"), "delivered");
	git(["add", "."]);
	git(["commit", "-qm", "delivered"]);
	const head = git(["rev-parse", "HEAD"]),
		remote = join(home, "remote.git");
	git(["init", "--bare", "-q", remote]);
	git(["remote", "add", "origin", remote]);
	git(["push", "-q", "-u", "origin", "main"]);
	const service = new GitService({
		factoryHome: home,
		childEnvironment: environment,
	});
	const configured = {
		id: "fixture",
		name: "Fixture",
		repositoryPath: repository,
		workspaceBaseDir: root,
		baseBranch: "main",
		githubUrl: "https://github.com/f1-fixture/storage",
	};
	const issue = (id: string) => ({
		id,
		identifier: id,
		labels: async () => ({ nodes: [] }),
		parent: async () => undefined,
		title: "Storage fixture",
		description: "",
		branchName: `fixture/${id}`,
		team: { id: "team", name: "Fixture", key: "FIX" },
		state: { id: "state", name: "Done", type: "completed" },
		url: "https://example.test/fixture",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const delivered = await service.createGitWorktree(issue("delivered"), [
		configured,
	]);
	const resumable = await service.createGitWorktree(issue("resumable"), [
		configured,
	]);
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "storage-fixture",
			name: "Storage fixture",
			steps: [
				{
					id: "finish",
					name: "Finish",
					type: "script",
					script: "fixture",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({ done: true }),
		tool: async () => ({}),
	});
	const create = (id: string, workspace: string) =>
		runtime.create({
			id,
			issueId: id,
			repositoryId: configured.id,
			title: id,
			workspace,
			workflow,
			input: "Controlled fixture",
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	const run = create("delivered-run", delivered.path);
	run.issueId = "delivered";
	const stopped = create("resumable-run", resumable.path);
	stopped.issueId = "resumable";
	runtime.stop(stopped.id);
	await runtime.launch(run);
	run.humanDecisions = [
		{
			decision: "approve",
			reviewId: "simulated-fixture-approval",
			headSha: head,
			url: "https://github.com/f1-fixture/storage/pull/1",
			at: new Date().toISOString(),
		},
	];
	await runtime.save(run);
	await runtime.flush(run.id);
	const expectedOutputs = structuredClone(run.outputs);
	// A controlled local remote supplies simulated provider proof. No forge or
	// provider inference request is made, and no real human decision is claimed.
	const base = factoryStorage(runtime, service, {
		protection: () => [],
		verifyDelivery: async (_run, _repository, approved) =>
			approved.headSha === head &&
			git(["--git-dir", remote, "rev-parse", "main"]) === head,
	});
	const retention = new StorageRetention(
		home,
		base.adapters,
		() => Date.now() + 31 * 86_400_000,
	);
	try {
		await retention.start();
		await expect
			.poll(
				async () => {
					try {
						await stat(delivered.path);
						return false;
					} catch {
						return true;
					}
				},
				{ timeout: 10_000 },
			)
			.toBe(true);
		expect((await stat(resumable.path)).isDirectory()).toBe(true);
		const snapshots = new JsonSnapshotStore(
			join(home, "factory", "run-chunks"),
		);
		const retained = snapshots.load<{
			outputs: { finish: { done: boolean } };
			humanDecisions: { headSha: string }[];
		}>(join(home, "factory", "runs", `${run.id}.json`)).value;
		expect(retained.outputs).toEqual(expectedOutputs);
		expect(retained.humanDecisions[0]?.headSha).toBe(head);
		await expect
			.poll(async () =>
				(await retention.status()).outcome?.results.some(
					(result) => result.phase === "completed",
				),
			)
			.toBe(true);
	} finally {
		await retention.stop();
		await runtime.shutdown();
	}
}, 30_000);

it("keeps update retention bounded through five preflight/update/restart cycles without changing saved-state sentinels", async () => {
	const { UpdateManager, candidateKey } = await import(
		"../../../packages/edge-worker/src/updates/UpdateManager.js"
	);
	const { UpdateArtifacts } = await import(
		"../../../packages/edge-worker/src/storage/UpdateArtifacts.js"
	);
	const { StorageRetention } = await import(
		"../../../packages/edge-worker/src/storage/StorageRetention.js"
	);
	const { writeStorageIntegrity } = await import("bobs-factory-core");
	const { copyUpdateStateForRetention } = await import(
		"../../cli/src/services/UpdateStateSnapshot.js"
	);
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "f1-storage-updates-")),
	);
	homes.push(home);
	const store = new StorageRetentionStore(home);
	await store.configure({ enabled: false }, 0);
	for (const path of [
		"state",
		"factory/runs",
		"factory/evidence/run",
		"factory/auth",
		"native-sentinel",
	])
		await mkdir(join(home, path), { recursive: true });
	const sentinels = {
		"config.json": '{"fixture":true}',
		"factory/runs/run.json":
			'{"id":"retained-run","gate":"accepted","chunk":"retained-chunk"}',
		"factory/evidence/run/check.txt": "executed evidence",
		"state/retained-chunk": "retained manifest chunk",
		"factory/auth/key-sentinel": "private fixture auth",
		"native-sentinel/conversation": "native fixture record",
	};
	for (const [path, content] of Object.entries(sentinels))
		await writeFile(join(home, path), content);
	let cycle = 0,
		workers = 1,
		maximumWorkers = 1;
	const candidate = () => ({
		version: `1.0.${cycle}`,
		commit: String(cycle).repeat(40),
		channel: "stable" as const,
		target: "linux-x64" as const,
		manifestSha256: String(cycle).repeat(64),
		publishedAt: "2026-10-01T00:00:00.000Z",
	});
	const source = {
		discover: async () => candidate(),
		stage: async () => {
			const root = join(home, "updates", "staging"),
				path = join(root, `cycle-${cycle}`);
			await mkdir(path, { recursive: true });
			await writeFile(
				join(path, "bobs-factory"),
				"controlled fixture executable",
			);
			const record = await store.register({
				category: "staging",
				path,
				root,
				producer: "F1 scripted update source",
				operation: `cycle-${cycle}`,
				dependencies: [],
				evidence: [],
			});
			const integrity = await writeStorageIntegrity(
				path,
				join(store.directory, "proofs", `${record.id}.ndjson`),
			);
			await store.revise(record.id, (value) => {
				value.evidence = [`integrity:${integrity}`];
				value.completedAt =
					value.verifiedAt =
					value.reconciledAt =
						new Date().toISOString();
			});
			return {
				candidate: candidate(),
				executable: join(path, "bobs-factory"),
				previousExecutable: join(home, "previous-owned-runtime"),
			};
		},
	};
	const measurements: {
		cycle: number;
		snapshotBytes: number;
		preparationBytes: number;
	}[] = [];
	const { readdir, lstat } = await import("node:fs/promises");
	const apparentBytes = async (path: string): Promise<number> => {
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) return info.size;
		let bytes = 0;
		for (const name of await readdir(path))
			bytes += await apparentBytes(join(path, name));
		return bytes;
	};
	let firstSnapshotBytes = 0,
		firstPreparationBytes = 0;
	const lifecycle = {
		acquireMaintenance: async () => {},
		isIdle: async () => true,
		preflight: async () => {
			const root = join(home, "updates", "preparation"),
				path = join(root, `cycle-${cycle}`);
			await mkdir(path, { recursive: true });
			const record = await store.register({
				category: "preparation",
				path,
				root,
				producer: "F1 scripted preflight",
				operation: `cycle-${cycle}`,
				dependencies: [],
				evidence: [],
			});
			await copyUpdateStateForRetention(home, path, "preflight");
			expect(await readFile(join(path, "factory/runs/run.json"), "utf8")).toBe(
				sentinels["factory/runs/run.json"],
			);
			const integrity = await writeStorageIntegrity(
				path,
				join(store.directory, "proofs", `${record.id}.ndjson`),
			);
			await store.revise(record.id, (value) => {
				value.evidence = [`integrity:${integrity}`];
				value.completedAt =
					value.verifiedAt =
					value.reconciledAt =
						new Date().toISOString();
			});
			return { stateCompatible: true as const };
		},
		snapshot: async (id: string) => {
			const root = join(home, "updates", "snapshots"),
				path = join(root, id);
			await mkdir(path, { recursive: true });
			const record = await store.register({
				category: "snapshot",
				rollback: "usable",
				path,
				root,
				producer: "F1 scripted lifecycle",
				operation: id,
				dependencies: [],
				evidence: [],
			});
			await copyUpdateStateForRetention(home, path, "snapshot");
			await writeFile(
				join(path, "lifecycle-receipt.json"),
				'{"fixture":"preserved"}',
			);
			const integrity = await writeStorageIntegrity(
				path,
				join(store.directory, "proofs", `${record.id}.ndjson`),
			);
			await store.revise(record.id, (value) => {
				value.evidence = [`integrity:${integrity}`];
				value.completedAt = value.verifiedAt = new Date().toISOString();
			});
			return path;
		},
		stop: async () => {
			workers--;
		},
		activate: async () => {},
		start: async () => {
			workers++;
			maximumWorkers = Math.max(maximumWorkers, workers);
		},
		health: async () => {},
		rollback: async () => {
			throw Error("Unexpected fixture rollback");
		},
		releaseMaintenance: async () => {},
	};
	let manager = new UpdateManager(home, source, lifecycle, {
		version: "1.0.0",
		commit: "0".repeat(40),
		target: "linux-x64",
	});
	for (cycle = 1; cycle <= 5; cycle++) {
		await manager.check();
		await manager.stage();
		const state = manager.status();
		manager.requestInstall(
			candidateKey(state.pending!.candidate),
			state.revision,
		);
		await manager.reconcile();
		expect(manager.status().transaction?.phase).toBe("succeeded");
		expect(workers).toBe(1);
		manager = new UpdateManager(home, source, lifecycle);
		const updates = new UpdateArtifacts(home),
			retention = new StorageRetention(home, {
				snapshot: updates,
				staging: updates,
			});
		for (let slice = 0; slice < 20; slice++) {
			const preview = await retention.preview();
			const eligible = preview.candidates
				.filter((item) => item.eligible)
				.map((item) => item.record.id);
			if (eligible.length) {
				await retention.execute(preview.id, eligible);
				await expect
					.poll(async () => (await retention.status()).outcome?.completedAt)
					.toBeTruthy();
			}
			if (preview.complete) break;
		}
		await retention.stop();
		for (const [path, content] of Object.entries(sentinels))
			expect(await readFile(join(home, path), "utf8")).toBe(content);
		const snapshotBytes = await apparentBytes(
				join(home, "updates", "snapshots"),
			),
			preparationBytes = await apparentBytes(
				join(home, "updates", "preparation"),
			);
		if (cycle === 1) {
			firstSnapshotBytes = snapshotBytes;
			firstPreparationBytes = preparationBytes;
		}
		expect(snapshotBytes).toBe(firstSnapshotBytes * Math.min(cycle, 2));
		expect(preparationBytes).toBe(firstPreparationBytes * cycle);
		measurements.push({ cycle, snapshotBytes, preparationBytes });
	}
	expect(maximumWorkers).toBe(1);
	process.stdout.write(
		`${JSON.stringify({ storageRetentionCycles: measurements, maximumSimulatedWorkers: maximumWorkers })}\n`,
	);
	expect(
		(await readdir(join(home, "updates", "snapshots"))).length,
	).toBeLessThanOrEqual(2);
}, 60_000);
