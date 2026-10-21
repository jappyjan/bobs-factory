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
		expect(
			await readFile(join(workspace, "unique-ignored-user-data"), "utf8"),
		).toBe("must survive terminal event");
		expect((await stat(workspace)).isDirectory()).toBe(true);
	} finally {
		await restarted.stop();
	}
}, 60_000);

it.each([
	"manual",
	"ticket",
	"nested",
	"grouped",
	"takeover",
])("releases reviewed delivered %s work through startup reconciliation while retaining Resume work and cross-run evidence", async (route) => {
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
	const configurations = [configured];
	if (route === "grouped") {
		const secondRepository = join(home, "repo-second");
		execFileSync("git", ["clone", "-q", repository, secondRepository], {
			env: environment,
		});
		configurations.push({
			...configured,
			id: "second",
			name: "Second",
			repositoryPath: secondRepository,
		});
	}
	const delivered = await service.createGitWorktree(
		issue("delivered"),
		configurations,
	);
	const resumable = await service.createGitWorktree(issue("resumable"), [
		configured,
	]);
	const nested = validateWorkflows([
		...defaultWorkflows,
		{
			id: "storage-parent",
			name: "Nested stock Factory",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "child",
					name: "Stock child",
					type: "workflow",
					workflow: "factory",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const definitions = [...defaultWorkflows, nested];
	const workflow =
		route === "nested"
			? nested
			: defaultWorkflows.find(
					(value) =>
						value.id === (route === "takeover" ? "takeover" : "factory"),
				)!;
	const createRuntime = () =>
		new WorkflowRuntime(home, {
			agent: async () => {
				throw new Error(
					"Fixture must start from its retained reviewed checkpoint",
				);
			},
			script: async () => ({}),
			tool: async (context) =>
				context.step.tool === "merge"
					? {
							merged: true,
							url: "https://github.com/f1-fixture/storage/pull/1",
							headSha: head,
						}
					: {
							headSha: head,
							url: "https://github.com/f1-fixture/storage/pull/1",
						},
		});
	let runtime = createRuntime();
	const create = (id: string, workspace: string) =>
		runtime.create({
			id,
			issueId: id,
			repositoryId: configured.id,
			title: id,
			workspace,
			workflow,
			workflowDefinitions: definitions,
			input: "Controlled fixture",
			triggerOrigin: {
				type: route === "ticket" ? "ticket-assignment" : "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	let run = create("delivered-run", delivered.path);
	run.issueId = "delivered";
	let stopped = create("resumable-run", resumable.path);
	stopped.issueId = "resumable";
	runtime.stop(stopped.id);
	if (route === "grouped")
		run.repositories = configurations.map((config) => ({
			repositoryId: config.id,
			name: config.name,
			repositoryPath: config.repositoryPath,
			baseBranch: "main",
			workspace: join(delivered.path, config.name),
			gitProvider: {
				type: "github",
				host: "github.com",
				owner: "f1-fixture",
				repository: "storage",
				url: config.githubUrl,
			},
		})) as typeof run.repositories;
	// A retained, already reviewed stock graph resumes at its delivery segment.
	// All previous review records are synthetic; the stock graph is unchanged.
	const terminal = {
		current: "merge",
		visits: {},
		agentSessions: {
			guide: { runner: "claude" as const, sessionId: "f1-mock-retained-role" },
		},
	};
	const pipeline = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: { phase: "executing" as const, children: [terminal] },
	};
	run.checkpoint =
		route === "nested"
			? {
					current: "child",
					visits: { child: 1 },
					active: { phase: "executing", children: [pipeline] },
				}
			: pipeline;
	run.reviewRounds = [
		{
			schemaVersion: 1,
			round: 1,
			key:
				route === "nested"
					? "child/pipeline/specialist-review"
					: "pipeline/specialist-review",
			inventory: { schemaVersion: 1, requirements: [] },
			headSha: head,
			baseSha: head,
			historyLength: 0,
			reviewers: [],
			context: {
				workspace: run.workspace,
				repositories: run.repositories,
				outputs: {
					"assess-impact": {
						snapshot: {
							schemaVersion: 1,
							digest: "retained-impact-fixture",
							key:
								route === "nested"
									? "child/pipeline/specialist-review"
									: "pipeline/specialist-review",
							repositories: [
								{
									repositoryId: configured.id,
									workspace: run.repositories?.[0]?.workspace ?? run.workspace,
									headSha: head,
									files: [],
								},
							],
						},
					},
					review: { summary: "Retained independent review" },
				},
			},
			at: new Date().toISOString(),
		},
	] as typeof run.reviewRounds;
	run.roleRevisions = {
		guide: {
			headSha: head,
			dirty: false,
			historyLength: 0,
			at: new Date().toISOString(),
		},
	};
	run.outputs["assess-impact"] = {
		snapshot: {
			schemaVersion: 1,
			digest: "retained-impact-fixture",
			key:
				route === "nested"
					? "child/pipeline/specialist-review"
					: "pipeline/specialist-review",
			repositories: [
				{
					repositoryId: configured.id,
					workspace: run.repositories?.[0]?.workspace ?? run.workspace,
					headSha: head,
					files: [],
				},
			],
		},
	};
	const impact = run.outputs["assess-impact"] as {
		at?: string;
		snapshot: unknown;
		checkResults?: unknown[];
	};
	impact.at = new Date().toISOString();
	impact.checkResults = [
		{
			id: "build",
			exitCode: 0,
			evidence: `> build ${run.workspace}\nBuild completed successfully`,
		},
	];
	run.impactDecisions = [structuredClone(impact)] as typeof run.impactDecisions;
	(
		run.reviewRounds[0]!.context as { outputs: Record<string, unknown> }
	).outputs["assess-impact"] = structuredClone(impact);

	run.history.push({
		step: "assess-impact",
		output: run.outputs["assess-impact"],
		at: new Date().toISOString(),
	});
	const checkOutput = {
		questions: [],
		checks: structuredClone(impact.checkResults),
	};
	run.outputs["impact-checks"] = checkOutput;
	run.history.push({
		step:
			route === "nested"
				? "child/pipeline/impact-checks"
				: "pipeline/impact-checks",
		output: structuredClone(checkOutput),
		at: new Date().toISOString(),
	});
	const frozen = run.reviewRounds[0]!.context as {
		outputs: Record<string, unknown>;
		history?: unknown[];
	};
	frozen.outputs["impact-checks"] = structuredClone(checkOutput);
	frozen.history = [
		{
			step:
				route === "nested"
					? "child/pipeline/impact-checks"
					: "pipeline/impact-checks",
			output: structuredClone(checkOutput),
			at: new Date().toISOString(),
		},
	];

	// More than four one-entry pages must evict and recreate restored history.
	for (let index = 0; index < 6; index++) {
		run.history.push({
			step: index % 2 === 0 ? "assess-impact" : "impact-checks",
			output: structuredClone(index % 2 === 0 ? impact : checkOutput),
			at: new Date().toISOString(),
		});
	}

	run.outputs.guide = {
		title: "Retained reviewed delivery",
		summary: "Independent historical guide",
	};
	run.humanDecisions = [
		{
			decision: "approve",
			reviewId: "simulated-fixture-approval",
			headSha: head,
			url: "https://github.com/f1-fixture/storage/pull/1",
			repositories:
				route === "grouped"
					? configurations.map((config) => ({
							repositoryId: config.id,
							name: config.name,
							headSha: head,
							url: `${config.githubUrl}/pull/1`,
						}))
					: undefined,
			at: new Date().toISOString(),
		},
	];
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	await runtime.save(run);
	await runtime.flush(run.id);
	const expectedOutputs = structuredClone(run.outputs);
	await runtime.shutdown();
	runtime = createRuntime();
	run = runtime.runs.get(run.id)!;
	stopped = runtime.runs.get(stopped.id)!;
	const firstEntry = run.history[0];
	for (let index = 1; index < run.history.length; index++)
		void run.history[index]; // Force the real snapshot cache to evict.
	expect(run.history[0]).not.toBe(firstEntry);

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
		const candidate = (
			await Promise.all(
				(
					await retention.store.inventoryPage(0)
				).map((id) => retention.store.record(id)),
			)
		).find((value) => value.path === delivered.path)!;
		const observe = async () => {
			let observed: Awaited<
				ReturnType<NonNullable<typeof retention.adapters.worktree>["observe"]>
			>;
			do {
				observed = await retention.adapters.worktree!.observe(
					candidate,
					new AbortController().signal,
				);
			} while (!observed.complete);
			return observed;
		};
		if (route === "manual") {
			for (let index = 0; index < 1200; index++)
				runtime.runs.set(`retained-${index}`, {
					...stopped,
					id: `retained-${index}`,
					outputs: {
						note:
							index === 1199
								? join(delivered.path, "file")
								: "independent retained result",
					},
				});
			const firstSlice = await retention.adapters.worktree!.observe(
				candidate,
				new AbortController().signal,
			);
			expect(firstSlice.complete).toBe(false);
			expect(firstSlice.filesystemEntries).toBeLessThanOrEqual(1000);
			let observed = firstSlice;
			for (let slice = 0; !observed.complete && slice < 40; slice++) {
				observed = await retention.adapters.worktree!.observe(
					candidate,
					new AbortController().signal,
				);
				expect(observed.filesystemEntries).toBeLessThanOrEqual(1000);
			}
			expect(observed.complete).toBe(true);
			expect(observed.protection.join(" ")).toContain(
				"references this workspace",
			);
			expect(observed.protection.length).toBeLessThanOrEqual(20);
			for (let index = 0; index < 1200; index++)
				runtime.runs.delete(`retained-${index}`);
		}
		for (const reference of [
			{
				id: configured.id,
				repositoryPath: configured.repositoryPath,
				baseBranch: "main",
				workspace: join(delivered.path, "file"),
			},
			{
				id: configured.id,
				repositoryPath: configured.repositoryPath,
				baseBranch: "main",
				workspace: delivered.path,
			},
			{
				snapshot: {
					digest: "retained-impact-fixture",
					repositories: [
						{
							repositoryId: configured.id,
							workspace: join(delivered.path, "file"),
							headSha: head,
							files: [],
						},
					],
				},
			},
			{
				snapshot: structuredClone(
					impact.snapshot as { repositories: unknown[] },
				),
			},
			structuredClone(impact),
			structuredClone(checkOutput),
		]) {
			stopped.outputs.repositoryShaped = reference;
			await runtime.save(stopped);
			await runtime.flush(stopped.id);
			expect((await observe()).protection.join(" ")).toContain(
				"references this workspace",
			);
		}
		// Copying a complete record does not enroll it in another run, even under a real step name.
		stopped.outputs["assess-impact"] = structuredClone(impact);
		stopped.outputs["impact-checks"] = structuredClone(checkOutput);
		delete stopped.outputs.repositoryShaped;
		expect((await observe()).protection.join(" ")).toContain(
			"references this workspace",
		);
		delete stopped.outputs["assess-impact"];
		delete stopped.outputs["impact-checks"];
		for (const copied of [
			structuredClone(impact),
			structuredClone(checkOutput),
		]) {
			run.outputs.arbitraryCopy = copied;
			expect((await observe()).protection.join(" ")).toContain(
				"references this workspace",
			);
			delete run.outputs.arbitraryCopy;
			run.history.push({
				step: "arbitraryCopy",
				output: copied,
				at: new Date().toISOString(),
			});
			expect((await observe()).protection.join(" ")).toContain(
				"references this workspace",
			);
			run.history.pop();
		}

		delete stopped.outputs.repositoryShaped;

		stopped.outputs.otherWorkspaceEvidence = join(delivered.path, "file");
		await runtime.save(stopped);
		await runtime.flush(stopped.id);
		expect((await observe()).protection.join(" ")).toContain(
			"references this workspace",
		);
		delete stopped.outputs.otherWorkspaceEvidence;
		stopped.history.push({
			step: "capture",
			output: { evidence: join(delivered.path, "file") },
			at: new Date().toISOString(),
		});
		await runtime.save(stopped);
		await runtime.flush(stopped.id);
		expect((await observe()).protection.join(" ")).toContain(
			"references this workspace",
		);
		stopped.history.pop();
		await runtime.save(stopped);
		await runtime.flush(stopped.id);
		const { symlink, unlink } = await import("node:fs/promises");
		await mkdir(join(home, "factory", "evidence"), { recursive: true });
		const evidenceLink = join(home, "factory", "evidence", "cross-workspace");
		await symlink(
			route === "grouped"
				? join(delivered.path, configured.name, "file")
				: join(delivered.path, "file"),
			evidenceLink,
		);
		expect((await observe()).protection.join(" ")).toContain("evidence link");
		await unlink(evidenceLink);
		expect((await observe()).protection).toEqual([]);
		await retention.store.workspaceClaim(delivered.path).run(async () => {
			await expect(
				service.createGitWorktree(issue("delivered"), configurations),
			).rejects.toThrow("owner is still running");
		});
		await retention.start();
		await expect
			.poll(
				async () => {
					const current = (await retention.status()).outcome;
					if (
						current?.completedAt &&
						current.results.some((value) => value.phase !== "completed")
					)
						throw new Error(JSON.stringify(current));
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
	const { writeStorageIntegrity, writeStorageRollbackProof } = await import(
		"bobs-factory-core"
	);
	const { copyUpdateStateForRetention } = await import(
		"../../cli/src/services/UpdateStateSnapshot.js"
	);
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "f1-storage-updates-")),
	);
	homes.push(home);
	const store = new StorageRetentionStore(home);
	await store.configure({ enabled: false }, 0);
	const previousExecutable = join(home, "installed", "bobs-factory");
	await mkdir(join(home, "installed"));
	await writeFile(previousExecutable, "verified controlled rollback runtime", {
		mode: 0o755,
	});
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
	let rollbackCalls = 0;
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
	let stageBarrier: Promise<void> | undefined;
	let stageEntered = false;
	const source = {
		discover: async () => candidate(),
		stage: async () => {
			if (stageBarrier) {
				stageEntered = true;
				await stageBarrier;
			}
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
				previousExecutable,
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
			const runtimeProof = await writeStorageRollbackProof(
				home,
				record.id,
				previousExecutable,
			);
			await store.revise(record.id, (value) => {
				value.evidence = [`integrity:${integrity}`, runtimeProof];
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
		health: async () => {
			if (cycle === 6) {
				await writeFile(
					join(home, "state", "retained-chunk"),
					"failed replacement state",
				);
				throw new Error("Injected replacement health failure");
			}
		},
		rollback: async (transaction: { snapshot?: string }) => {
			if (!transaction.snapshot) throw new Error("No rollback snapshot");
			workers--;
			await copyUpdateStateForRetention(transaction.snapshot, home, "snapshot");
			workers++;
			rollbackCalls++;
		},
		releaseMaintenance: async () => {},
	};
	let manager = new UpdateManager(home, source, lifecycle, {
		version: "1.0.0",
		commit: "0".repeat(40),
		target: "linux-x64",
	});
	const unusedRoot = join(home, "updates", "staging"),
		unusedPath = join(unusedRoot, "expired-before-update");
	await mkdir(unusedPath, { recursive: true });
	await writeFile(join(unusedPath, "owned"), "disposable staging");
	const unused = await store.register({
		category: "staging",
		path: unusedPath,
		root: unusedRoot,
		producer: "race fixture",
		operation: "old-operation",
		dependencies: [],
		evidence: [],
		completedAt: "2020-01-01T00:00:00.000Z",
		verifiedAt: "2020-01-01T00:00:00.000Z",
		reconciledAt: "2020-01-01T00:00:00.000Z",
	});
	const unusedIntegrity = await writeStorageIntegrity(
		unusedPath,
		join(store.directory, "proofs", `${unused.id}.ndjson`),
	);
	await store.revise(unused.id, (value) => {
		value.evidence = [`integrity:${unusedIntegrity}`];
	});
	for (cycle = 1; cycle <= 5; cycle++) {
		await manager.check();
		if (cycle === 1) {
			let release!: () => void;
			stageBarrier = new Promise<void>((resolve) => {
				release = resolve;
			});
			const racing = manager.stage();
			await expect.poll(() => stageEntered).toBe(true);
			const adapter = new UpdateArtifacts(home),
				concurrent = new StorageRetention(home, { staging: adapter });
			try {
				const preview = await concurrent.preview();
				await concurrent.execute(preview.id, [unused.id]);
				await expect
					.poll(async () => (await concurrent.status()).outcome?.completedAt, {
						timeout: 10000,
					})
					.toBeTruthy();
				expect((await concurrent.status()).outcome?.error).toContain(
					"update operation",
				);
				expect(await readFile(join(unusedPath, "owned"), "utf8")).toBe(
					"disposable staging",
				);
			} finally {
				release();
				await racing;
				stageBarrier = undefined;
				await concurrent.stop();
			}
		} else await manager.stage();
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
				preparation: updates,
			});
		for (let slice = 0; slice < 20; slice++) {
			const preview = await retention.preview();
			const eligible = preview.candidates
				.filter((item) => item.eligible)
				.map((item) => item.record.id);
			if (eligible.length) {
				await retention.execute(preview.id, eligible);
				await expect
					.poll(async () => (await retention.status()).outcome?.completedAt, {
						timeout: 10000,
					})
					.toBeTruthy();
				expect(
					(await retention.status()).outcome?.results.map((value) => ({
						phase: value.phase,
						reason: value.reason,
					})),
				).toEqual(
					eligible.map(() => ({ phase: "completed", reason: undefined })),
				);
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
	cycle = 6;
	await manager.check();
	await manager.stage();
	const rollbackState = manager.status();
	manager.requestInstall(
		candidateKey(rollbackState.pending!.candidate),
		rollbackState.revision,
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("rolled-back");
	expect(rollbackCalls).toBe(1);
	expect(workers).toBe(1);
	for (const [path, content] of Object.entries(sentinels))
		expect(await readFile(join(home, path), "utf8")).toBe(content);
	const expiredArtifacts = new UpdateArtifacts(home);
	const expired = new StorageRetention(
		home,
		{
			snapshot: expiredArtifacts,
			staging: expiredArtifacts,
			preparation: expiredArtifacts,
		},
		() => Date.now() + 8 * 86400000,
	);
	for (let slice = 0; slice < 30; slice++) {
		const preview = await expired.preview();
		const selected = preview.candidates
			.filter((value) => value.eligible)
			.map((value) => value.record.id);
		if (selected.length) {
			await expired.execute(preview.id, selected);
			await expect
				.poll(async () => (await expired.status()).outcome?.completedAt, {
					timeout: 10000,
				})
				.toBeTruthy();
		}
		if (preview.complete) break;
	}
	await expired.stop();
	expect(await readdir(join(home, "updates", "preparation"))).toEqual([]);
	for (const [path, content] of Object.entries(sentinels))
		expect(await readFile(join(home, path), "utf8")).toBe(content);
	expect(maximumWorkers).toBe(1);
	process.stdout.write(
		`${JSON.stringify({ storageRetentionCycles: measurements, maximumSimulatedWorkers: maximumWorkers })}\n`,
	);
	expect(
		(await readdir(join(home, "updates", "snapshots"))).length,
	).toBeLessThanOrEqual(2);
}, 60_000);

it("resumes saved native progress through the runtime while cleanup sees durable active ownership", async () => {
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
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "f1-retention-resume-")),
	);
	homes.push(home);
	const workspace = join(home, "worktrees", "resume");
	await mkdir(workspace, { recursive: true });
	await writeFile(
		join(workspace, "native-sentinel"),
		"saved conversation files",
	);
	const store = new StorageRetentionStore(home);
	const record = await store.register({
		path: workspace,
		root: join(home, "worktrees"),
		category: "worktree",
		producer: "resume fixture",
		operation: "resume",
		dependencies: [],
		evidence: [],
	});
	const { publishStorageJson, storageDigest } = await import(
		"bobs-factory-core"
	);
	await publishStorageJson(
		join(store.directory, "workspaces", `${storageDigest(workspace)}.json`),
		{
			recordId: record.id,
			issueIdentifier: "resume",
			repositories: [
				{
					id: "fixture",
					repository: home,
					path: workspace,
					root: record.root,
					creator: "resume fixture",
					identity: record.identity,
				},
			],
		},
	);
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "resume-fixture",
			name: "Resume fixture",
			steps: [
				{
					id: "continue",
					name: "Continue saved progress",
					type: "agent",
					prompt: "Continue",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = false;
	const hooks = {
		script: async () => ({}),
		tool: async () => ({}),
		agent: async (
			context: import("../../../packages/edge-worker/src/factory/WorkflowRuntime.js").ExecutionContext,
		) => {
			expect(context.resumeAgent?.sessionId).toBe("f1-mock-saved-native");
			entered = true;
			await held;
			const runner = f1AgentHandlers("mock")!.createAgentRunner!("claude", {
				factoryHome: home,
				workingDirectory: workspace,
				resumeSessionId: context.resumeAgent!.sessionId,
			});
			expect((await runner.start("Continue saved fixture")).sessionId).toBe(
				"f1-mock-saved-native",
			);
			return { continued: true };
		},
	};
	const initial = new WorkflowRuntime(home, hooks);
	const run = initial.create({
		id: "resume-run",
		issueId: "resume",
		repositoryId: "fixture",
		workspace,
		workflow,
		input: "Saved continuation",
		triggerOrigin: { type: "manual", workflowId: workflow.id },
	});
	run.checkpoint = {
		current: "continue",
		visits: { continue: 1 },
		active: {
			phase: "executing",
			agent: { runner: "claude", sessionId: "f1-mock-saved-native" },
		},
	};
	initial.stop(run.id);
	await initial.flush(run.id);
	await initial.shutdown();
	const runtime = new WorkflowRuntime(home, hooks);
	const retention = factoryStorage(
		runtime,
		{} as import("../../../packages/edge-worker/src/GitService.js").GitService,
		{ protection: () => [], verifyDelivery: async () => false },
	);
	const { StorageRetention } = await import(
		"../../../packages/edge-worker/src/storage/StorageRetention.js"
	);
	let deletionEntered = false;
	let finishDeletion!: () => void;
	const deleting = new Promise<void>((resolve) => {
		finishDeletion = resolve;
	});
	// Control eligibility to isolate the race boundary. The real coordinator
	// acquires its deletion claim and calls remove; no native content is erased.
	const cleanup = new StorageRetention(home, {
		worktree: {
			observe: async (record) => ({
				record,
				complete: true,
				protection: [],
				filesystemEntries: 0,
			}),
			remove: async (_record, _signal, journal) => {
				await journal("controlled-deletion-barrier");
				deletionEntered = true;
				await deleting;
				throw new Error("Controlled cleanup interruption retains native files");
			},
		},
	});
	await store.revise(record.id, (value) => {
		value.completedAt =
			value.verifiedAt =
			value.reconciledAt =
				"2020-01-01T00:00:00.000Z";
	});
	try {
		let preview = await cleanup.preview();
		while (!preview.complete) preview = await cleanup.preview();
		await cleanup.execute(preview.id, [record.id]);
		await expect.poll(() => deletionEntered).toBe(true);
		try {
			runtime.resume(run.id);
			// Admission waits briefly for transient inspection claims. A held
			// deletion claim must still fail without entering provider execution.
			await expect
				.poll(() => runtime.get(run.id).status, { timeout: 10000 })
				.toBe("failed");
			expect(entered).toBe(false);
			expect(runtime.get(run.id).error).toMatch(
				/owner is still running|owns this resource/,
			);
			expect(await readFile(join(workspace, "native-sentinel"), "utf8")).toBe(
				"saved conversation files",
			);
		} finally {
			finishDeletion();
		}
		await expect
			.poll(async () => (await cleanup.status()).outcome?.completedAt)
			.toBeTruthy();
		expect((await cleanup.status()).outcome?.results[0]?.phase).toBe(
			"controlled-deletion-barrier",
		);
		expect((await cleanup.status()).outcome?.results[0]?.reason).toContain(
			"Controlled cleanup interruption",
		);
		// A failed admission retains the saved checkpoint for an explicit retry.
		runtime.stop(run.id);
		runtime.resume(run.id);
		await expect.poll(() => entered).toBe(true);
		let observation: Awaited<
			ReturnType<NonNullable<typeof retention.adapters.worktree>["observe"]>
		>;
		do {
			observation = await retention.adapters.worktree!.observe(
				record,
				new AbortController().signal,
			);
		} while (!observation.complete);
		expect(observation.protection.join(" ")).toContain("running");
		expect(await readFile(join(workspace, "native-sentinel"), "utf8")).toBe(
			"saved conversation files",
		);
		release();
		await expect.poll(() => runtime.get(run.id).status).toBe("completed");
		expect(runtime.get(run.id).outputs.continue).toEqual({ continued: true });
	} finally {
		finishDeletion();
		await cleanup.stop();
		release();
		await runtime.shutdown();
		await retention.stop();
	}
}, 30000);
