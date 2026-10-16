// F1 drive for the visual Recipes workbench.
// Builds a recipe only through the browser UI (palette, inspector, drawn route,
// typed condition), saves it, then runs it on the real EdgeWorker and asserts the
// runtime follows the authored graph. Also checks bundled agent preferences,
// conflict detection and the simulator. Mock agents only; scripts are local.
//
//   F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/recipe-workbench.ts
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createCLIIssueTracker } from "bobs-factory-core";
import { LocalOnboarding } from "../../../../apps/cli/src/onboarding.js";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.js";
import { factoryAccess } from "../../../../packages/edge-worker/src/factory/FactoryAuth.js";
import { FactoryServer } from "../../../../packages/edge-worker/src/factory/FactoryServer.js";
import type { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"No native agents or inference authorized",
);
const root = resolve(import.meta.dirname, "../../../..");
const evidence = join(import.meta.dirname, "recipe-workbench");
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "f1-recipe-workbench-"));
const home = join(directory, "home");
const repository = join(directory, "repository");
const stubs = join(directory, "stubs");
for (const path of [home, repository, stubs]) mkdirSync(path);
writeFileSync(join(home, "config.json"), JSON.stringify({ repositories: [] }), {
	mode: 0o600,
});
// Availability probes only see disposable prepared-tool stubs.
for (const name of [
	"claude",
	"codex",
	"gemini",
	"cursor",
	"agent",
	"opencode",
	"gh",
])
	writeFileSync(join(stubs, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
const gitEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: join(directory, "gitconfig"),
	GIT_CONFIG_NOSYSTEM: "1",
};
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repository, env: gitEnv, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
writeFileSync(join(repository, "README.md"), "# Recipe workbench fixture\n");
git("add", ".");
git("commit", "-q", "-m", "Fixture");
const bare = join(directory, "remote.git");
execFileSync("git", ["clone", "-q", "--bare", repository, bare], {
	env: gitEnv,
});
git("remote", "add", "origin", bare);

const port = Number(process.env.F1_RECIPES_PORT ?? 3641);
const origin = `http://localhost:${port}`;
process.env.PATH = `${stubs}:${process.env.PATH}`;
process.env.BOBS_FACTORY_HOME = home;
process.env.GIT_CONFIG_GLOBAL = gitEnv.GIT_CONFIG_GLOBAL;
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const name of [
	"BOBS_FACTORY_FACTORY_PORT",
	"BOBS_FACTORY_FACTORY_ORIGIN",
	"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
	"GH_TOKEN",
	"GITHUB_TOKEN",
])
	delete process.env[name];

const checks: string[] = [];
const check = (name: string) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
const call = async (path: string, method = "GET", body?: unknown) => {
	const config =
		method === "GET"
			? undefined
			: (
					(await (
						await fetch(`${origin}/api/config`, {
							headers: { origin, "x-factory-request": "1" },
						})
					).json()) as { configRevision: string }
				).configRevision;
	const response = await fetch(`${origin}${path}`, {
		method,
		headers: {
			origin,
			"x-factory-request": "1",
			"content-type": "application/json",
			...(config ? { "x-factory-config": config } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, value: (await response.json()) as any };
};

// Browser helpers: one isolated headless agent-browser session for the drive.
const session = `f1-recipes-${process.pid}`;
const run = promisify(execFile);
const browserOutput = join(directory, "browser-output.txt");
// Asynchronous so this process keeps serving the page under test; output goes
// through a file because the browser daemon would otherwise hold our pipes.
const browser = async (...args: string[]) => {
	try {
		await run("sh", ["-c", 'agent-browser "$@" >"$OUT" 2>&1', "sh", ...args], {
			env: {
				...process.env,
				AGENT_BROWSER_SESSION: session,
				OUT: browserOutput,
			},
			timeout: 60_000,
		});
	} catch (error) {
		throw new Error(
			`agent-browser ${args[0]} failed: ${readFileSync(browserOutput, "utf8")}`,
			{ cause: error },
		);
	}
	return readFileSync(browserOutput, "utf8").trim();
};
const evaluate = async <T>(script: string): Promise<T> => {
	const out = (await browser("eval", script)).split("\n").pop()!;
	const value = JSON.parse(out);
	return (
		typeof value === "string" && /^[[{"]/.test(value)
			? JSON.parse(value)
			: value
	) as T;
};
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const open = async (hash: string) => {
	await browser("open", `${origin}/?drive=${Date.now()}#${hash}`);
	await pause(2500);
};
const clickText = (scope: string, text: string) =>
	evaluate<string>(
		`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return "missing"; b.click(); return "ok"; })()`,
	);
const save = async () => {
	assert.equal(await clickText(".recipe-topbar button", "Save"), "ok");
	await pause(2000);
};
const centre = (selector: string) =>
	evaluate<{ x: number; y: number }>(
		`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`,
	);
let lastGesture: unknown;
const hitAt = (point: { x: number; y: number }) =>
	evaluate<string>(
		`(() => { const e = document.elementFromPoint(${point.x}, ${point.y}); return String(e?.className?.baseVal ?? e?.className); })()`,
	);
/** A real pointer gesture from a step's route handle onto another step. */
const drawRoute = async (handle: string, target: string) => {
	const from = await centre(handle);
	const to = await centre(target);
	// Hidden headless tabs hit-test against their last paint. Repaint until the
	// handle is the element under the pointer, as it is in a visible browser.
	let atStart = await hitAt(from);
	for (let i = 0; i < 10 && !atStart.includes("react-flow__handle"); i++) {
		await browser("screenshot", join(directory, "repaint.png"));
		atStart = await hitAt(from);
	}
	lastGesture = { from, to, atStart };
	assert.match(
		atStart,
		/react-flow__handle/,
		`route handle never became hit-testable: ${JSON.stringify(
			await evaluate<unknown>(
				`JSON.stringify({ stack: document.elementsFromPoint(${from.x}, ${from.y}).map((e) => String(e.className?.baseVal ?? e.className).slice(0, 60)), node: (() => { const n = document.querySelector(".react-flow__node[data-id=script-1]"); const c = getComputedStyle(n); return { pe: c.pointerEvents, vis: c.visibility, op: c.opacity, z: c.zIndex, rect: JSON.stringify(n.getBoundingClientRect()), cls: n.className }; })(), nodesLayer: getComputedStyle(document.querySelector(".react-flow__nodes")).pointerEvents })`,
			),
		)}`,
	);
	await browser("mouse", "move", String(from.x), String(from.y));
	await browser("mouse", "down");
	for (let i = 1; i <= 6; i++)
		await browser(
			"mouse",
			"move",
			String(Math.round(from.x + ((to.x - from.x) * i) / 6)),
			String(Math.round(from.y + ((to.y - from.y) * i) / 6)),
		);
	await browser("mouse", "up");
};
const shot = (name: string) =>
	browser("screenshot", join(evidence, `${name}.png`));

let worker: EdgeWorker;
const onboarding = new LocalOnboarding(home, (repo, runner) =>
	worker.configureLocalRepository(repo, runner),
);
worker = new EdgeWorker(
	{
		repositories: [],
		issueTrackerFactory: createCLIIssueTracker,
		factoryHome: home,
		serverPort: port + 2,
		serverHost: "127.0.0.1",
		linearWorkspaces: {
			"cli-workspace": { linearToken: "fixture-not-a-provider-token" },
		},
		handlers: f1AgentHandlers("mock"),
	},
	onboarding,
);
const internal = worker as unknown as {
	getFactoryRuntime(): WorkflowRuntime;
	startManualFactoryRun(input: unknown): Promise<unknown>;
};
let server: FactoryServer | undefined;
let success = false;
let runSummary: unknown;
try {
	await worker.start();
	const runtime = internal.getFactoryRuntime();
	server = new FactoryServer(
		runtime,
		{
			onboarding,
			repositories: () =>
				JSON.parse(readFileSync(join(home, "config.json"), "utf8"))
					.repositories,
			sessions: () => [],
			entries: () => [],
			start: (input) =>
				internal.startManualFactoryRun(input) as ReturnType<
					ConstructorParameters<typeof FactoryServer>[1]["start"]
				>,
			stop: (id) => runtime.stop(id),
		},
		factoryAccess(port),
	);
	await server.start(port);
	const configured = await call("/api/onboarding/project", "POST", {
		repositoryPath: repository,
		runner: "claude",
	});
	assert.equal(configured.status, 200, JSON.stringify(configured.value));
	await browser("set", "viewport", "1280", "800");

	// 1. Gallery renders every recipe from the live catalog.
	await open("/recipes");
	const cards = await evaluate<string[]>(
		`JSON.stringify([...document.querySelectorAll(".recipe-card b")].map((b) => b.textContent))`,
	);
	const catalog = (await call("/api/config")).value.workflows as {
		name: string;
	}[];
	assert.deepEqual([...cards].sort(), catalog.map((w) => w.name).sort());
	await shot("gallery");
	check("gallery shows one card per catalog recipe");

	// 2. Build a branching recipe only through the UI.
	assert.equal(await clickText("button", "New recipe"), "ok");
	await pause(1500);
	await browser("fill", ".recipe-title input", "F1 workbench branch");
	await evaluate(`location.hash = location.hash + "&step=work"; "ok"`);
	await pause(500);
	const addScript = async (name: string, script: string) => {
		assert.equal(
			await clickText(".recipe-palette-items button", "Script"),
			"ok",
		);
		await pause(400);
		await browser("fill", ".recipe-panel-head h2 input", name);
		await browser("fill", ".recipe-panel textarea.recipe-prompt", script);
	};
	await addScript("Check approval", `printf '{"approved":false}\\n'`);
	await addScript("Default path", `printf '{"path":"default"}\\n'`);
	await addScript("Branch path", `printf '{"path":"branch"}\\n'`);
	await evaluate(
		`location.hash = location.hash.replace(/step=[^&]*/, "step=work"); "ok"`,
	);
	await pause(500);
	assert.equal(await clickText(".recipe-panel button", "Delete step"), "ok");
	await pause(500);
	await pause(1000);
	await shot("authored-steps");
	await drawRoute(
		".react-flow__node[data-id=script-1] .react-flow__handle-right",
		".react-flow__node[data-id=script-3]",
	);
	await pause(600);
	assert.equal(
		await evaluate<boolean>(
			`!!document.querySelector('.recipe-routes li[data-new="true"]')`,
		),
		true,
		`drawn route opens with an empty condition: ${JSON.stringify({ lastGesture, after: await evaluate<string>(`JSON.stringify({ hash: location.hash, viewport: document.querySelector(".react-flow__viewport").style.transform, connection: !!document.querySelector(".react-flow__connection") })`) })}`,
	);
	await save();
	assert.match(
		await evaluate<string>(
			`document.querySelector(".recipe-alerts")?.innerText ?? ""`,
		),
		/route without a condition/,
	);
	check("drawing a route needs a condition before the draft can be saved");
	await browser(
		"fill",
		'.recipe-routes input[aria-label="Output field"]',
		"approved",
	);
	await browser("fill", '.recipe-routes input[aria-label="Value"]', "false");
	await shot("authored-branch");
	await save();
	const created = await evaluate<string>(
		`new URLSearchParams(location.hash.split("?")[1]).get("recipe")`,
	);
	const authored = (await call("/api/config")).value.workflows.find(
		(w: { id: string }) => w.id === created,
	);
	assert.ok(authored, `saved recipe ${created}`);
	assert.deepEqual(
		authored.steps.map(
			(s: { id: string; type: string }) => `${s.id}:${s.type}`,
		),
		["script-1:script", "script-2:script", "script-3:script"],
	);
	assert.deepEqual(authored.steps[0].branches, [
		{ when: { path: "approved", equals: false }, next: "script-3" },
	]);
	assert.equal(authored.name, "F1 workbench branch");
	check(
		"UI-authored recipe saved with the inserted steps and drawn conditional route",
	);

	// 3. The runtime executes the graph as drawn.
	const repo = JSON.parse(readFileSync(join(home, "config.json"), "utf8"))
		.repositories[0];
	const launch = await call("/api/runs", "POST", {
		repositoryId: repo.id,
		workflow: created,
		prompt: "Exercise the authored branch",
		runner: "claude",
	});
	assert.equal(launch.status, 202, JSON.stringify(launch.value));
	for (
		let i = 0;
		i < 200 &&
		!["completed", "failed"].includes(runtime.get(launch.value.id).status);
		i++
	)
		await new Promise((done) => setTimeout(done, 100));
	const run = runtime.get(launch.value.id);
	runSummary = {
		status: run.status,
		steps: run.history.map((item) => item.step),
		outputs: run.outputs,
	};
	assert.equal(run.status, "completed", JSON.stringify(runSummary));
	assert.deepEqual(
		run.history.map((item) => item.step),
		["script-1", "script-3"],
	);
	assert.deepEqual(run.outputs["script-3"], { path: "branch" });
	check(
		"EdgeWorker run followed the drawn branch and skipped the default step",
	);

	// 4. Simulation offers the authored outcomes and reaches the same step.
	await open(`/recipes?recipe=${created}`);
	assert.equal(await clickText(".recipe-topbar button", "Simulate"), "ok");
	await pause(400);
	const outcomes = await evaluate<string[]>(
		`JSON.stringify([...document.querySelectorAll(".recipe-simulation .actions button")].map((b) => b.textContent.trim()))`,
	);
	assert.deepEqual(outcomes, [
		"✓ All good → Default path",
		"Changes requested → Branch path",
	]);
	assert.equal(
		await clickText(".recipe-simulation .actions button", "Changes requested"),
		"ok",
	);
	await pause(300);
	assert.deepEqual(
		await evaluate<string[]>(
			`JSON.stringify([...document.querySelectorAll(".recipe-trail li")].map((l) => l.textContent))`,
		),
		["Check approval", "Branch path"],
	);
	await shot("simulation");
	check("simulator offers the authored outcomes and walks the drawn branch");

	// 5. Bundled recipes keep their graph but save agent settings as preferences.
	await open("/recipes?recipe=factory&step=plan");
	assert.equal(
		await evaluate<string>(
			`document.querySelector(".recipe-palette-items p")?.textContent`,
		),
		"Fork to add steps",
	);
	await browser("select", ".recipe-panel .agent-settings select", "codex");
	await save();
	const preferences = (await call("/api/config")).value.workflowConfiguration
		.preferences;
	assert.equal(
		preferences["factory-pipeline"]?.plan?.runner,
		"codex",
		JSON.stringify(preferences["factory-pipeline"]),
	);
	const bundledPlan = runtime
		.listWorkflows()
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "plan")!;
	assert.equal(bundledPlan.runner, "codex");
	await shot("bundled-preference");
	check(
		"bundled pipeline is read-only in the canvas and agent edits save as preferences",
	);

	// 6. A change made elsewhere is reported instead of overwritten.
	await open(`/recipes?recipe=${created}&step=script-2`);
	await browser("fill", ".recipe-panel-head h2 input", "Edited in the browser");
	const current = (await call("/api/config")).value;
	const elsewhere = await call("/api/workflows", "PUT", {
		workflows: current.workflows.map((w: { id: string; name: string }) =>
			w.id === created ? { ...w, name: "Edited elsewhere" } : w,
		),
		defaultWorkflow: current.defaultWorkflow,
	});
	assert.equal(elsewhere.status, 200, JSON.stringify(elsewhere.value));
	await pause(2500);
	assert.match(
		await evaluate<string>(
			`document.querySelector(".recipe-alerts")?.innerText ?? ""`,
		),
		/changed elsewhere/,
	);
	assert.equal(
		await evaluate<boolean>(
			`[...document.querySelectorAll(".recipe-topbar button")].find((b) => b.textContent.trim() === "Save").disabled`,
		),
		true,
	);
	await shot("conflict");
	assert.equal(await clickText(".recipe-alerts button", "Discard"), "ok");
	await pause(500);
	assert.equal(
		(await call("/api/config")).value.workflows.find(
			(w: { id: string }) => w.id === created,
		).name,
		"Edited elsewhere",
	);
	check(
		"concurrent server change blocks Save and Discard reloads the stored recipe",
	);
	success = true;
} finally {
	await browser("close").catch(() => {});
	await server?.stop();
	await worker.stop();
	const files = [
		"packages/edge-worker/src/factory/web/recipes.tsx",
		"packages/edge-worker/src/factory/web/recipe-builder.tsx",
		"packages/edge-worker/src/factory/web/recipe-canvas.tsx",
		"packages/edge-worker/src/factory/web/recipe-graph.ts",
		"packages/edge-worker/src/factory/web/styles.css",
		"apps/f1/test-drives/assets/recipe-workbench.ts",
	];
	const result = {
		success,
		commit: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
		sourceSha256: Object.fromEntries(
			files.map((file) => [
				file,
				createHash("sha256")
					.update(readFileSync(join(root, file)))
					.digest("hex"),
			]),
		),
		checks,
		run: runSummary,
		directory,
		limitations:
			"Mock agents and local script steps; headless Chromium via agent-browser at 1280×800. No provider calls or physical mobile device.",
	};
	writeFileSync(
		join(evidence, "receipt.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	);
	console.log(JSON.stringify(result, null, 2));
}
process.exit(success ? 0 : 1);
