// Run with F1_AGENT_MODE=mock bun run <this-file> [--serve]. No native agents.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { defaultWorkflows } from "../../../../../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { MockAgentRunner } from "../../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "simple-settings-f1-"));
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"legacy-capacity",
);
mkdirSync(process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY);
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
const origin = `http://127.0.0.1:${port}`;
const repositories = ["app", "other"].map((id) => {
	const path = join(home, id);
	mkdirSync(path);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: path, stdio: "pipe" });
	git("init", "-b", "main");
	git("config", "user.email", "f1@example.test");
	git("config", "user.name", "F1");
	writeFileSync(join(path, "README.md"), "Isolated launcher fixture\n");
	git("add", ".");
	git("commit", "-m", "fixture");
	git("remote", "add", "origin", path);
	return {
		id,
		name: id === "app" ? "Launcher fixture" : "Other project",
		repositoryPath: path,
		workspaceBaseDir: join(home, "worktrees"),
		baseBranch: "main",
		githubUrl: `https://github.com/f1-test/${id}`,
		linearWorkspaceId: "cli-workspace",
		isActive: true,
		routingLabels: [id],
	};
});
const received: any[] = [];
const worker: any = new EdgeWorker({
	platform: "cli",
	issueTrackerFactory: createCLIIssueTracker,
	factoryHome: home,
	serverPort: 0,
	serverHost: "localhost",
	repositories,
	defaultRunner: "codex",
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: {
		createAgentRunner: (runner: any, config: any) => {
			received.push({
				runner,
				model: config.model,
				modelReasoningEffort: config.modelReasoningEffort,
				effort: config.effort,
				modelVariant: config.modelVariant,
				serviceTier: config.serviceTier,
				workingDirectory: config.workingDirectory,
			});
			writeFileSync(
				join(home, "received.json"),
				JSON.stringify(received, null, 2),
			);
			return new MockAgentRunner(
				config,
				JSON.stringify({
					status: "completed",
					title: "F1 launch settings",
					summary: "Simulated completion",
					checks: [],
					questions: [],
				}),
			);
		},
	},
});
await worker.start();
const runtime = worker.getFactoryRuntime();
const definitions = structuredClone(defaultWorkflows);
const stock = definitions.find((w) => w.id === "factory")!;
const custom = {
	...structuredClone(stock),
	id: "custom-simple",
	name: "Simple",
	labels: [],
	description: "Two steps configured in Recipes",
	steps: [
		{
			id: "first",
			name: "First configured step",
			type: "agent",
			runner: "codex",
			model: "fixture-codex",
			reasoningEffort: "low",
			serviceTier: "standard",
			prompt: "Return a completion object.",
			inputs: ["prompt"],
			json: true,
			branches: [],
		},
		{
			id: "second",
			name: "Second configured step",
			type: "agent",
			runner: "claude",
			model: "fixture-claude",
			reasoningEffort: "high",
			prompt: "Return a completion object.",
			inputs: ["prompt"],
			json: true,
			branches: [],
		},
	],
};
definitions.push(custom as any);
definitions.push({
	...structuredClone(custom),
	id: "disabled-simple",
	name: "Disabled Simple",
	enabled: false,
} as any);
runtime.updateWorkflows(definitions);
runtime.catalog.setEnabled("disabled-simple", false);
writeFileSync(
	join(home, "notes.txt"),
	"Carry this attachment between recipes.\n",
);
const config = (await (await fetch(`${origin}/api/config`)).json()) as any;
const version = (await (await fetch(`${origin}/api/version`)).json()) as any;
const headers = {
	Origin: origin,
	"X-Factory-Request": "1",
	"X-Factory-Build": version.build,
	"X-Factory-Config": config.configRevision,
	"Content-Type": "application/json",
};
const launch = (body: any) =>
	fetch(`${origin}/api/runs`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			repositoryId: "app",
			workflow: "custom-simple",
			inputs: { prompt: "Check configuration" },
			...body,
		}),
	});
const waitFor = async (id: string) => {
	for (let i = 0; i < 400; i++) {
		const run = runtime.get(id);
		if (run.status === "completed") return run;
		if (run.status === "failed") throw new Error(run.error);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Run ${id} did not complete`);
};
const run = async (body: any) => {
	const response = await launch(body);
	assert.equal(response.status, 202, await response.clone().text());
	return waitFor(((await response.json()) as any).id);
};
try {
	assert.notEqual(
		(await launch({ inputs: {} })).status,
		202,
		"required input rejected",
	);
	assert.notEqual(
		(await launch({ workflow: "disabled-simple" })).status,
		202,
		"disabled workflow rejected",
	);
	await run({});
	assert.ok(
		received.some(
			(c) =>
				c.runner === "codex" &&
				c.model === "fixture-codex" &&
				c.modelReasoningEffort === "low" &&
				c.serviceTier === "standard",
		),
	);
	assert.ok(
		received.some(
			(c) =>
				c.runner === "claude" &&
				c.model === "fixture-claude" &&
				c.effort === "high",
		),
	);
	for (const settings of [
		{
			runner: "codex",
			model: "simple-codex",
			reasoningEffort: "high",
			serviceTier: "fast",
		},
		{
			runner: "opencode",
			model: "fixture/opencode",
			modelVariant: "custom-review",
		},
	]) {
		const simple = await run({ workflow: "simple", ...settings });
		for (const [key, value] of Object.entries(settings))
			assert.equal(simple[key], value);
		assert.ok(
			received.some(
				(c) =>
					c.runner === settings.runner &&
					c.model === settings.model &&
					(settings.runner === "codex"
						? c.modelReasoningEffort === "high" && c.serviceTier === "fast"
						: c.modelVariant === "custom-review"),
			),
		);
	}
	// API callers keep their contract even for a non-Simple workflow.
	const api = await run({
		runner: "codex",
		model: "api-override",
		reasoningEffort: "high",
	});
	assert.equal(api.model, "api-override");
	assert.equal(api.reasoningEffort, "high");
	console.log(
		"F1_ASSERTIONS_PASSED",
		JSON.stringify({
			home,
			origin,
			checks: [
				"required input",
				"disabled selection",
				"two configured steps",
				"Simple codex effort/tier",
				"Simple OpenCode variant",
				"direct API override compatibility",
			],
		}),
	);
	if (process.argv.includes("--serve")) {
		console.log(`BROWSER_FIXTURE ${origin} FILES ${home}`);
		await new Promise<void>((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
	}
} finally {
	await worker.stop();
}
process.exit(0);
