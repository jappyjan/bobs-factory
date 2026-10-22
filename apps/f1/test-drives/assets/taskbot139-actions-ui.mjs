// Node 24 after the coordinated combined build. Every state below is produced
// by production WorkflowRuntime/FactoryServer with disposable Git and mock hooks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { factoryAccess } from "../../../../packages/edge-worker/dist/factory/FactoryAuth.js";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { factoryWebAssets } from "../../../../packages/edge-worker/dist/factory/FactoryWebAssets.js";
import { launchBatchProjection } from "../../../../packages/edge-worker/dist/factory/LaunchRuns.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";

assert.match(process.version, /^v24\./, "Use supported Node 24 source tooling");
const root = resolve(import.meta.dirname, "../../../..");
const evidence = resolve(
	process.env.F1_ACTIONS_UI_EVIDENCE ?? "/tmp/taskbot139-ui",
);
assert(
	!existsSync(join(evidence, "identity.json")),
	"Choose fresh evidence; never overwrite a prior receipt",
);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(tmpdir(), "taskbot139-actions-ui-"));
const home = join(directory, "home"),
	repositoryPath = join(directory, "repository");
mkdirSync(home, { mode: 0o700 });
mkdirSync(repositoryPath, { mode: 0o700 });
const git = (cwd, ...args) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repositoryPath, "init", "-b", "main");
writeFileSync(
	join(repositoryPath, "README.md"),
	"# Disposable generic actions UI fixture\n",
);
git(repositoryPath, "add", "README.md");
git(
	repositoryPath,
	"-c",
	"user.name=Scripted UI",
	"-c",
	"user.email=fixture@example.invalid",
	"commit",
	"-m",
	"Initial fixture",
);
const sourceRevision = git(repositoryPath, "rev-parse", "HEAD");
const port = Number(process.env.F1_ACTIONS_UI_PORT ?? 3689);
assert(
	Number.isInteger(port) && port > 0 && port < 65536,
	"Invalid fixture port",
);
const origin = `http://localhost:${port}`;
const destination = {
	provider: "taskbot",
	server: "fixture",
	instance: "https://tracker.example.invalid",
	project: "disposable",
};
const parentId = "generic-actions-ui-run";
const runItems = [
	{
		id: "readiness",
		prompt: "Review dependency readiness",
		body: "Scripted question checkpoint",
		dependencies: [],
	},
	{
		id: "runtime",
		prompt: "Inspect runtime durability",
		body: "Scripted active child",
		dependencies: [],
	},
	{
		id: "documentation",
		prompt: "Document accepted behavior",
		body: "Scripted completed child without a merge",
		dependencies: [],
	},
	{
		id: "integration",
		prompt: "Integrate approved dependency",
		body: "Queued until readiness actually merges",
		dependencies: ["readiness"],
	},
	{
		id: "follow-up",
		prompt: "Follow completed documentation",
		body: "Blocked because completion is not a merge",
		dependencies: ["documentation"],
	},
];
const hookCalls = [],
	prepared = [],
	issueSends = [];
const blocked = () => {
	throw new Error(
		"Fixture forbids external tools, native agents and extra user runs",
	);
};
let runtime,
	server,
	stopping = false,
	restarting = false;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = [
	"apps/f1/test-drives/assets/taskbot139-actions-ui.mjs",
	"packages/edge-worker/src/factory/ActionSteps.ts",
	"packages/edge-worker/src/factory/IssueDestination.ts",
	"packages/edge-worker/src/factory/RepositorySnapshot.ts",
	"packages/edge-worker/src/factory/FileIssues.ts",
	"packages/edge-worker/src/factory/LaunchRuns.ts",
	"packages/edge-worker/src/factory/Workflow.ts",
	"packages/edge-worker/src/factory/WorkflowRuntime.ts",
	"packages/edge-worker/src/factory/RunProjection.ts",
	"packages/edge-worker/src/factory/RunAttention.ts",
	"packages/edge-worker/src/factory/FactoryServer.ts",
	"packages/edge-worker/src/factory/web/action-step-settings.tsx",
	"packages/edge-worker/src/factory/web/child-runs.tsx",
	"packages/edge-worker/src/factory/web/recipe-builder.tsx",
	"packages/edge-worker/src/factory/web/recipe-graph.ts",
	"packages/edge-worker/src/factory/web/app.tsx",
	"packages/edge-worker/src/factory/web/artifacts.tsx",
	"packages/edge-worker/src/factory/web/styles.css",
];
const source = Object.fromEntries(
	paths.map((path) => [path, hash(readFileSync(join(root, path)))]),
);
const shell = factoryWebAssets();
const receipt = {
	mode: "Production WorkflowRuntime and FactoryServer; scripted agents and tracker, disposable Git worktrees",
	startedAt: new Date().toISOString(),
	node: process.version,
	head: git(root, "rev-parse", "HEAD"),
	tree: git(root, "rev-parse", "HEAD^{tree}"),
	worktree: root,
	workingStatus: git(root, "status", "--short"),
	trackedDiffSha256: hash(
		execFileSync("git", ["diff", "HEAD", "--"], { cwd: root }),
	),
	source,
	sourceFingerprint: hash(JSON.stringify(source)),
	backend: Object.fromEntries(
		[
			"ActionSteps.js",
			"RepositorySnapshot.js",
			"FileIssues.js",
			"LaunchRuns.js",
			"Workflow.js",
			"WorkflowRuntime.js",
			"RunProjection.js",
			"FactoryServer.js",
		].map((path) => [
			path,
			hash(readFileSync(join(root, "packages/edge-worker/dist/factory", path))),
		]),
	),
	build: shell.build,
	assets: shell.assets.map(({ path, sha256 }) => ({ path, sha256 })),
	origin,
	runtimeDirectory: directory,
	factoryHome: home,
	repositoryPath,
	sourceRevision,
	runId: parentId,
	runUrl: `${origin}/#/runs/${parentId}`,
	builderUrl: `${origin}/#/recipes?recipe=generic-actions-ui&step=dispatch`,
	limitations: [
		"Scripted agents produce deterministic outputs; no paid/native model or provider effects.",
		"Mock tracker acknowledges synthetic example.invalid issue links; real provider send/reconciliation is covered separately.",
		"Child recipe is a generic question-capable agent; completed output has no merge proof and correctly blocks its dependant.",
		"Fixture uses production persistence, action dispatch and disposable git worktree preparation. No accepted receipts or run state are patched for screenshots.",
		"UI evidence does not establish EdgeWorker intake, real delivery-provider merge, native execution or machine-capacity correctness.",
	],
	assertions: [],
	restarts: [],
};
const saveReceipt = () =>
	writeFileSync(
		join(evidence, "identity.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ mode: 0o600 },
	);
const hooks = {
	prepare: async (run) => {
		assert(
			run.id === parentId || run.recipeParent?.runId === parentId,
			"Only fixture parent and exact children execute",
		);
		if (!run.workspace) {
			const workspace = join(directory, "worktrees", run.id);
			mkdirSync(join(directory, "worktrees"), { recursive: true });
			git(
				repositoryPath,
				"worktree",
				"add",
				"-b",
				`fixture/${run.id}`,
				workspace,
				"main",
			);
			run.workspace = workspace;
			run.repositories = run.repositories.map((repository) => ({
				...repository,
				workspace,
			}));
			run.setupComplete = true;
			prepared.push({
				runId: run.id,
				workspace,
				revision: git(workspace, "rev-parse", "HEAD"),
			});
			await runtime.save(run);
			await runtime.flush(run.id);
		}
	},
	agent: async (context) => {
		hookCalls.push({
			runId: context.run.id,
			itemId: context.run.recipeParent?.itemId,
			step: context.stepKey,
			at: new Date().toISOString(),
		});
		if (context.run.id === parentId) {
			assert.equal(context.step.id, "propose");
			assert.equal(context.outputs.snapshot.revision, sourceRevision);
			context.log(
				"Scripted agent read the accepted repository snapshot and returned issue and run items.",
			);
			return {
				issues: [
					{
						id: "safe-issue",
						title: "Track the accepted review",
						body: "Synthetic issue in a mocked tracker",
					},
				],
				runs: runItems,
			};
		}
		assert.equal(context.run.recipeParent?.runId, parentId);
		const item = context.run.recipeParent.itemId;
		if (item === "readiness")
			return {
				questions: [
					"Scripted checkpoint: confirm the intended dependency plan?",
				],
			};
		if (item === "documentation")
			return {
				questions: [],
				complete: true,
				summary: "Scripted task completed without provider merge proof.",
			};
		assert.equal(
			item,
			"runtime",
			"Queued and blocked child items must never execute",
		);
		context.log(
			"Scripted runtime child remains active until stop or fixture shutdown.",
		);
		await new Promise((resolveWait) =>
			context.signal.aborted
				? resolveWait()
				: context.signal.addEventListener("abort", resolveWait, { once: true }),
		);
		return { questions: [], stopped: true };
	},
	script: blocked,
	tool: blocked,
	improvementDestinations: async () => ({
		options: [{ name: "Disposable mock Taskbot", destination }],
		limitations: [],
	}),
	improvementIssue: async (_run, intent) => {
		assert.deepEqual(intent.destination, destination);
		assert.match(intent.body, /<!-- factory-file-issue:[a-f0-9]{64} -->/);
		issueSends.push({
			key: intent.key,
			itemId: intent.itemId,
			title: intent.title,
		});
		assert.equal(
			issueSends.filter((send) => send.key === intent.key).length,
			1,
			"No duplicate mocked issue send",
		);
		return {
			id: `mock-${intent.itemId}`,
			url: `https://tracker.example.invalid/t/${intent.itemId}`,
		};
	},
};
const recipe = {
	id: "generic-actions-ui",
	name: "Snapshot and dispatch review work",
	icon: "◈",
	description:
		"Reusable actions with pinned context, mocked issues and retained child dependency waves.",
	labels: [],
	allowedTriggers: ["manual", "workflow"],
	stepConfigVersion: "step-config-v1",
	steps: [
		{
			id: "snapshot",
			name: "Snapshot repositories",
			type: "snapshot",
			snapshot: { history: { lookbackDays: 30, maxRuns: 100 } },
		},
		{
			id: "propose",
			name: "Propose bounded work",
			type: "agent",
			access: "read-only",
			reads: { snapshot: "snapshot" },
			prompt:
				"Use the pinned snapshot. Return issues and runs with stable IDs.",
		},
		{
			id: "tickets",
			name: "File backlog issues",
			type: "file-issues",
			reads: { proposals: "propose" },
			fileIssues: {
				items: { from: "/inputs/proposals/issues" },
				itemId: "/id",
				maxItems: 100,
				fields: { title: "/title", body: "/body" },
			},
		},
		{
			id: "dispatch",
			name: "Launch dependency waves",
			type: "launch-runs",
			reads: { proposals: "propose" },
			launchRuns: {
				items: { from: "/inputs/proposals/runs" },
				itemId: "/id",
				maxItems: 100,
				workflow: "generic-actions-child",
				inputMapping: { prompt: "/prompt" },
				dependencies: "/dependencies",
				wait: false,
			},
		},
	],
};
const childRecipe = {
	id: "generic-actions-child",
	name: "Independent review work",
	icon: "↗",
	description: "Controlled child used by the generic-actions UI fixture.",
	labels: [],
	allowedTriggers: ["workflow"],
	stepConfigVersion: "step-config-v1",
	steps: [
		{
			id: "work",
			name: "Work independently",
			type: "agent",
			askQuestions: true,
			prompt:
				"Complete this isolated scripted item or ask its explicit checkpoint question.",
		},
	],
};
const launchServer = async () => {
	runtime = new WorkflowRuntime(home, hooks);
	server = new FactoryServer(
		runtime,
		{
			repositories: () => [
				{ id: "ui-project", name: "Disposable action project" },
			],
			sessions: () => [],
			entries: () => [],
			start: blocked,
			stop: (id) => runtime.stop(id),
			defaultRunner: () => "claude",
		},
		factoryAccess(port),
	);
	await server.start(port);
};
const batch = () => Object.values(runtime.get(parentId).launchActions ?? {})[0];
const snapshot = () => ({
	status: runtime.get(parentId).status,
	batches: Object.fromEntries(
		Object.entries(runtime.get(parentId).launchActions ?? {}).map(
			([id, value]) => [id, launchBatchProjection(value)],
		),
	),
	hookCalls: [...hookCalls],
	issueSends: [...issueSends],
	prepared: [...prepared],
});
const ready = async () => {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		const current = batch();
		if (
			current &&
			current.progress.readiness.status === "waiting" &&
			current.progress.runtime.status === "running" &&
			current.progress.documentation.status === "completed" &&
			current.progress.integration.status === "queued" &&
			current.progress["follow-up"].status === "blocked"
		)
			return;
		if (["failed", "stopped"].includes(runtime.get(parentId).status))
			throw new Error(
				`Parent became ${runtime.get(parentId).status}: ${runtime.get(parentId).error}`,
			);
		await delay(30);
	}
	throw new Error(
		`Timed out waiting for genuine child states: ${JSON.stringify(snapshot())}`,
	);
};
const close = async (exitCode = 0) => {
	if (stopping) return;
	stopping = true;
	await runtime?.shutdown();
	await server?.stop();
	receipt.stoppedAt = new Date().toISOString();
	if (runtime?.runs.has(parentId)) receipt.final = snapshot();
	saveReceipt();
	console.log(
		`${exitCode ? "FAIL" : "PASS"} generic action UI fixture stopped; state retained`,
	);
	process.exit(exitCode);
};
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
try {
	await launchServer();
	const definitions = validateWorkflows([
		...runtime.listWorkflows(),
		recipe,
		childRecipe,
	]);
	runtime.updateWorkflows(definitions);
	const run = runtime.create({
		id: parentId,
		repositoryId: "ui-project",
		repositories: [
			{
				id: "ui-project",
				name: "Disposable action project",
				repositoryPath,
				workspace: "",
				baseBranch: "main",
			},
		],
		workspace: "",
		workflow: definitions.find((item) => item.id === recipe.id),
		workflowDefinitions: definitions,
		input: "Scripted generic actions browser verification",
		triggerOrigin: {
			type: "manual",
			workflowId: recipe.id,
			at: new Date().toISOString(),
		},
	});
	runtime.updateTitle(
		run.id,
		run.titleGeneration,
		"Review work · dependency waves",
	);
	void runtime.launch(run);
	await ready();
	await runtime.flush(run.id);
	assert.equal(issueSends.length, 1);
	assert.equal(
		runtime.get(parentId).history.filter((entry) => entry.step === "dispatch")
			.length,
		1,
	);
	assert.equal(
		runtime.get(parentId).status,
		"waiting",
		"Detached child obligations keep parent stop available",
	);
	assert.equal(
		prepared.length,
		4,
		"Parent and three admitted child worktrees only",
	);
	receipt.readyAt = new Date().toISOString();
	receipt.ready = snapshot();
	receipt.assertions.push(
		"Snapshot→scripted agent→mock File issues→Launch runs traversed production action graph",
		"Three children created in distinct Git worktrees; two dependent intents retained without a child",
		"waiting/running/completed/queued/blocked projection reflects actual runtime",
		"wait:false action returned exactly once while parent remains waiting for child obligations",
		"Completed-without-merge child cannot release its dependant",
	);
	saveReceipt();
	console.log(
		JSON.stringify({
			ready: true,
			origin,
			runUrl: receipt.runUrl,
			builderUrl: receipt.builderUrl,
			evidence,
			directory,
			build: shell.build,
		}),
	);
	const lines = createInterface({ input: process.stdin });
	lines.on("line", (line) => {
		if (line === "exit") void close();
		if (line === "status") {
			receipt.observed = snapshot();
			saveReceipt();
			console.log(JSON.stringify(receipt.observed));
		}
		if (line === "restart" && !restarting) {
			restarting = true;
			void (async () => {
				const before = snapshot();
				const original = JSON.stringify(batch().accepted);
				await runtime.shutdown();
				await server.stop();
				await launchServer();
				assert.equal(
					JSON.stringify(batch().accepted),
					original,
					"Restart retains original accepted batch",
				);
				runtime.resumeAll();
				await delay(200);
				assert.equal(
					issueSends.length,
					1,
					"Restart cannot refile confirmed issue",
				);
				assert.equal(
					prepared.length,
					4,
					"Restart cannot recreate child worktrees",
				);
				receipt.restarts.push({
					at: new Date().toISOString(),
					before,
					after: snapshot(),
				});
				saveReceipt();
				console.log(JSON.stringify({ restarted: true, snapshot: snapshot() }));
			})()
				.catch(async (error) => {
					receipt.error = error.stack;
					await close(1);
				})
				.finally(() => {
					restarting = false;
				});
		}
	});
} catch (error) {
	receipt.error = error instanceof Error ? error.stack : String(error);
	saveReceipt();
	console.error(receipt.error);
	await close(1);
}
