// Node 24, after the combined production source/UI build. This disposable
// FactoryServer + WorkflowRuntime fixture uses scripted hooks, never native agents.
// Start only during the coordinated browser-verification slot.
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
import { setTimeout as delay } from "node:timers/promises";
import { factoryAccess } from "../../../../packages/edge-worker/dist/factory/FactoryAuth.js";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { factoryWebAssets } from "../../../../packages/edge-worker/dist/factory/FactoryWebAssets.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";

assert.match(
	process.version,
	/^v24\./,
	"Use the supported Node 24 source toolchain",
);
const root = resolve(import.meta.dirname, "../../../..");
const evidence = resolve(
	process.env.F1_FOREACH_UI_EVIDENCE ?? "/tmp/taskbot138-ui",
);
assert(
	!existsSync(join(evidence, "identity.json")),
	"Preserve previous UI evidence: choose a fresh F1_FOREACH_UI_EVIDENCE directory.",
);
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(tmpdir(), "taskbot138-foreach-ui-"));
const home = join(directory, "home");
const workspace = join(directory, "workspace");
mkdirSync(home, { mode: 0o700 });
mkdirSync(workspace, { mode: 0o700 });
writeFileSync(join(workspace, "README.md"), "# Scripted For each UI fixture\n");
const port = Number(process.env.F1_FOREACH_UI_PORT ?? 3688);
assert(
	Number.isInteger(port) && port > 0 && port < 65536,
	"Invalid fixture port",
);
const origin = `http://localhost:${port}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sourcePaths = [
	"apps/f1/test-drives/assets/taskbot138-foreach-ui.mjs",
	"packages/edge-worker/src/factory/Foreach.ts",
	"packages/edge-worker/src/factory/Check.ts",
	"packages/edge-worker/src/factory/Rules.ts",
	"packages/edge-worker/src/factory/Workflow.ts",
	"packages/edge-worker/src/factory/WorkflowRuntime.ts",
	"packages/edge-worker/src/factory/StepBindings.ts",
	"packages/edge-worker/src/factory/StepConfig.ts",
	"packages/edge-worker/src/factory/ConfigProjection.ts",
	"packages/edge-worker/src/factory/RunProjection.ts",
	"packages/edge-worker/src/factory/FactoryServer.ts",
	"packages/edge-worker/src/factory/web/recipe-builder.tsx",
	"packages/edge-worker/src/factory/web/recipe-graph.ts",
	"packages/edge-worker/src/factory/web/recipe-canvas.tsx",
	"packages/edge-worker/src/factory/web/foreach-step-settings.tsx",
	"packages/edge-worker/src/factory/web/foreach-simulation.tsx",
	"packages/edge-worker/src/factory/web/foreach-progress.tsx",
	"packages/edge-worker/src/factory/web/client.ts",
	"packages/edge-worker/src/factory/web/app.tsx",
	"packages/edge-worker/src/factory/web/styles.css",
];
const backendPaths = [
	"Foreach.js",
	"Check.js",
	"Rules.js",
	"Workflow.js",
	"WorkflowRuntime.js",
	"StepBindings.js",
	"StepConfig.js",
	"ConfigProjection.js",
	"RunProjection.js",
	"FactoryServer.js",
];
const blocked = () => {
	throw new Error(
		"This isolated UI fixture forbids additional runs and external execution",
	);
};
const assignments = [
	{
		id: "security",
		name: "Security",
		brief: "Check safe input and output boundaries.",
	},
	{
		id: "runtime",
		name: "Runtime",
		brief: "Check durable execution and failure handling.",
	},
	{
		id: "accessibility",
		name: "Accessibility",
		brief: "Check keyboard and small-screen use.",
	},
	{
		id: "performance",
		name: "Performance",
		brief: "Check bounded work and capacity.",
	},
	{
		id: "maintainability",
		name: "Maintainability",
		brief: "Check clear interfaces and documentation.",
	},
];
const hookCalls = [];
const runtime = new WorkflowRuntime(home, {
	agent: async (context) => {
		assert.equal(
			context.run.id,
			"foreach-ui-run",
			"Only the fixture's run may execute",
		);
		hookCalls.push({
			at: new Date().toISOString(),
			step: context.stepKey,
			item: context.iteration?.id,
		});
		if (context.step.id === "coordinate") {
			context.log(
				"Scripted source accepted five bounded perspective assignments.",
			);
			return { assignments };
		}
		assert.equal(context.step.id, "inspect", "Unexpected fixture agent step");
		assert(
			context.iteration,
			"Worker requires its actual runtime-owned item frame",
		);
		const { id, value, index } = context.iteration;
		assert.equal(value.id, id);
		assert.equal(assignments[index]?.id, id);
		if (id === "security") {
			context.log(
				"Scripted security item completed; its original receipt is retained.",
			);
			return {
				perspective: id,
				complete: true,
				summary: "Input boundaries reviewed in this scripted fixture.",
			};
		}
		if (id === "runtime") {
			context.log(
				"Scripted runtime item reports a controlled failure for progress verification.",
			);
			throw new Error(
				"Scripted fixture limitation: runtime evidence is unavailable",
			);
		}
		context.log(
			`Scripted ${id} item remains active until fixture shutdown; no native agent was started.`,
		);
		await new Promise((resolveWait) => {
			if (context.signal.aborted) resolveWait();
			else
				context.signal.addEventListener("abort", resolveWait, { once: true });
		});
		return { perspective: id, stopped: true };
	},
	script: blocked,
	tool: blocked,
});
const recipe = {
	id: "foreach-ui",
	stepConfigVersion: "step-config-v1",
	name: "Research each perspective",
	icon: "↻",
	description:
		"Bounded assignments, durable per-item work and an explicit final Check.",
	labels: [],
	allowedTriggers: ["manual", "workflow"],
	steps: [
		{
			id: "coordinate",
			name: "Collect perspective assignments",
			type: "agent",
			configVersion: "step-config-v1",
			prompt: "Return a JSON object with assignments: [{id, name, brief}].",
		},
		{
			id: "perspectives",
			name: "For each perspective",
			type: "foreach",
			configVersion: "step-config-v1",
			reads: { assignments: "coordinate/assignments" },
			items: { from: "/inputs/assignments" },
			itemId: "/id",
			concurrency: 2,
			maxItems: 20,
			failure: "keep-successful",
			body: [
				{
					id: "inspect",
					name: "Inspect this perspective",
					type: "agent",
					configVersion: "step-config-v1",
					reads: { assignment: "@item", position: "@index" },
					prompt:
						"Inspect /item using its brief. Return complete, perspective and summary. /index is its original position.",
					maxVisits: 3,
				},
			],
		},
		{
			id: "verify",
			name: "Check retained results and limitations",
			type: "check",
			configVersion: "step-config-v1",
			reads: { batch: "perspectives" },
			check: {
				results: {
					allSucceeded: { path: "/inputs/batch/summary/failed", equals: 0 },
					securityRetained: {
						path: "/inputs/batch/results/security/inspect/complete",
						equals: true,
					},
				},
			},
			next: "end",
		},
	],
};
const definitions = validateWorkflows([...runtime.listWorkflows(), recipe]);
runtime.updateWorkflows(definitions);
const acceptedRecipe = definitions.find(
	(definition) => definition.id === recipe.id,
);
assert(acceptedRecipe);
const run = runtime.create({
	id: "foreach-ui-run",
	title: "Research each perspective — scripted progress",
	repositoryId: "foreach-ui-project",
	workspace,
	workflow: acceptedRecipe,
	input:
		"Scripted browser fixture: retain successful perspective outputs and show explicit limitations.",
	triggerOrigin: {
		type: "manual",
		workflowId: recipe.id,
		at: new Date().toISOString(),
	},
});
runtime.updateTitle(
	run.id,
	run.titleGeneration,
	"Research each perspective · scripted progress",
);
const server = new FactoryServer(
	runtime,
	{
		repositories: () => [
			{ id: "foreach-ui-project", name: "Scripted For each project" },
		],
		sessions: () => [],
		entries: () => [],
		start: blocked,
		stop: (id) => {
			assert.equal(id, run.id);
			runtime.stop(id);
		},
		defaultRunner: () => "claude",
	},
	factoryAccess(port),
);
const shell = factoryWebAssets();
const source = Object.fromEntries(
	sourcePaths.map((path) => [path, hash(readFileSync(join(root, path)))]),
);
const receipt = {
	startedAt: new Date().toISOString(),
	mode: "scripted mocked hooks through production WorkflowRuntime and FactoryServer",
	node: process.version,
	head: git("rev-parse", "HEAD"),
	tree: git("rev-parse", "HEAD^{tree}"),
	worktree: root,
	workingStatus: git("status", "--short"),
	trackedDiffSha256: hash(
		execFileSync("git", ["diff", "HEAD", "--"], { cwd: root }),
	),
	source,
	sourceFingerprint: hash(JSON.stringify(source)),
	backend: Object.fromEntries(
		backendPaths.map((path) => [
			path,
			hash(readFileSync(join(root, "packages/edge-worker/dist/factory", path))),
		]),
	),
	build: shell.build,
	assets: shell.assets.map(({ path, sha256 }) => ({ path, sha256 })),
	origin,
	runtimeDirectory: directory,
	factoryHome: home,
	workspace,
	recipeId: recipe.id,
	runId: run.id,
	builderUrl: `${origin}/#/recipes?recipe=${recipe.id}&step=perspectives`,
	runUrl: `${origin}/#/runs/${run.id}`,
	limitations: [
		"Scripted hooks return deterministic JSON; no native model, CLI runner or provider side effects.",
		"Production per-item states are observed, never patched. Concurrency 2 requires five items to show completed, failed, active and pending together.",
		"Two scripted items intentionally wait until shutdown. The final Check is declared but remains unreached in this in-progress run.",
		"No EdgeWorker intake, restart, native continuation or machine-capacity behavior claim from this browser fixture; those have separate runtime/F1 evidence.",
		"Private local Factory home with direct loopback access; no seeded authentication or external credentials.",
	],
	assertions: [],
};
const writeReceipt = () =>
	writeFileSync(
		join(evidence, "identity.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ mode: 0o600 },
	);
writeReceipt();
let stopping = false;
let execution;
const close = async (exitCode = 0) => {
	if (stopping) return;
	stopping = true;
	runtime.stop(run.id);
	await runtime.shutdown();
	await execution;
	await server.stop();
	receipt.stoppedAt = new Date().toISOString();
	receipt.finalStatus = runtime.get(run.id).status;
	receipt.finalProgress = structuredClone(
		runtime.get(run.id).foreach?.perspectives,
	);
	receipt.hookCalls = hookCalls;
	writeReceipt();
	console.log(
		`${exitCode ? "FAIL" : "PASS"} scripted For each UI fixture stopped; private state and receipts retained`,
	);
	process.exit(exitCode);
};
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
try {
	await server.start(port);
	execution = runtime.launch(run);
	const expected = ["completed", "failed", "running", "running", "pending"];
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const statuses = runtime
			.get(run.id)
			.foreach?.perspectives?.items.map((item) => item.status);
		if (
			JSON.stringify(statuses) === JSON.stringify(expected) &&
			hookCalls.length === 5
		)
			break;
		if (runtime.get(run.id).status !== "running")
			throw new Error(
				`Fixture run unexpectedly became ${runtime.get(run.id).status}: ${runtime.get(run.id).error}`,
			);
		await delay(20);
	}
	await runtime.flush(run.id);
	assert.deepEqual(
		runtime.get(run.id).foreach?.perspectives?.items.map((item) => item.status),
		expected,
	);
	assert.equal(
		runtime
			.get(run.id)
			.history.filter((entry) => entry.step === "perspectives/security/inspect")
			.length,
		1,
	);
	assert.equal(
		hookCalls.filter((call) => call.step === "coordinate").length,
		1,
	);
	assert.equal(
		hookCalls.length,
		5,
		"One source plus four dispatched workers; final item stays pending",
	);
	assert.equal(
		runtime.get(run.id).outputs.verify,
		undefined,
		"Check must not falsely complete while items remain unfinished",
	);
	receipt.readyAt = new Date().toISOString();
	receipt.assertions.push(
		"Production snapshot statuses completed/failed/running/running/pending",
		"One retained security receipt and one source invocation",
		"Only four of five item workers dispatched",
		"Final Check has not executed while items remain unfinished",
	);
	receipt.readyProgress = structuredClone(
		runtime.get(run.id).foreach.perspectives,
	);
	receipt.hookCalls = hookCalls;
	writeReceipt();
	console.log(
		JSON.stringify({
			ready: true,
			origin,
			builderUrl: receipt.builderUrl,
			runUrl: receipt.runUrl,
			evidence,
			runtimeDirectory: directory,
			build: shell.build,
		}),
	);
	await new Promise(() => {});
} catch (error) {
	receipt.error = error instanceof Error ? error.stack : String(error);
	writeReceipt();
	console.error(receipt.error);
	await close(1);
}
