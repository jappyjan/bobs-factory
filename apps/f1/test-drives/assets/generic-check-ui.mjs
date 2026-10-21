// Node 24, after building the combined source. Starts a disposable production
// FactoryServer/WorkflowRuntime for collaborative-preview UI verification.
// No agents, scripts, runs or external providers may launch from this fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { factoryAccess } from "../../../../packages/edge-worker/dist/factory/FactoryAuth.js";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { factoryWebAssets } from "../../../../packages/edge-worker/dist/factory/FactoryWebAssets.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";

assert.match(process.version, /^v24\./);
const root = resolve(import.meta.dirname, "../../../..");
const directory = mkdtempSync(join(tmpdir(), "f1-generic-check-ui-"));
const home = join(directory, "home");
mkdirSync(home);
const port = Number(process.env.F1_CHECK_UI_PORT ?? 3687);
const origin = `http://localhost:${port}`;
const evidence = resolve(
	process.env.F1_CHECK_UI_EVIDENCE ??
		join(import.meta.dirname, "generic-check-ui"),
);
mkdirSync(evidence, { recursive: true });
assert(
	!existsSync(join(evidence, "identity.json")),
	"Preserve prior UI evidence: choose a fresh F1_CHECK_UI_EVIDENCE directory.",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = [
	"packages/edge-worker/src/factory/Check.ts",
	"packages/edge-worker/src/factory/Rules.ts",
	"packages/edge-worker/src/factory/FactoryServer.ts",
	"packages/edge-worker/src/factory/Workflow.ts",
	"packages/edge-worker/src/factory/WorkflowRuntime.ts",
	"packages/edge-worker/src/factory/web/recipe-builder.tsx",
	"packages/edge-worker/src/factory/web/check-step-settings.tsx",
	"packages/edge-worker/src/factory/web/recipe-graph.ts",
	"packages/edge-worker/src/factory/web/styles.css",
];
const blocked = () => {
	throw new Error("UI evidence fixture forbids execution");
};
const runtime = new WorkflowRuntime(home, {
	agent: blocked,
	script: blocked,
	tool: blocked,
});
const recipe = {
	id: "check-ui",
	stepConfigVersion: "step-config-v1",
	name: "Check review results",
	icon: "✓",
	description: "Review a collection, then follow the recipe's declared routes.",
	labels: [],
	allowedTriggers: ["manual", "workflow"],
	steps: [
		{
			id: "collect",
			name: "Collect reviews",
			type: "script",
			script: "printf '{\"reviews\":[]}'",
			branches: [],
		},
		{
			id: "check-reviews",
			name: "Check reviews",
			type: "check",
			configVersion: "step-config-v1",
			reads: { reviews: "collect/reviews" },
			check: {
				results: {
					approved: {
						aggregate: "all",
						path: "/inputs/reviews",
						require: { path: "/approved", equals: true },
					},
					openFindings: {
						aggregate: "count",
						path: "/inputs/reviews/*/findings/*",
						where: { path: "/rating", min: 2 },
					},
				},
				passed: {
					all: [
						{ path: "/results/approved", equals: true },
						{ path: "/results/openFindings", max: 0 },
					],
				},
			},
			branches: [{ when: { path: "passed", equals: false }, next: "changes" }],
			next: "approved",
		},
		{
			id: "approved",
			name: "Review complete",
			type: "script",
			script: "printf '{}'",
			branches: [],
			next: "end",
		},
		{
			id: "changes",
			name: "Request changes",
			type: "script",
			script: "printf '{}'",
			branches: [],
			next: "end",
		},
	],
};
runtime.updateWorkflows([...runtime.listWorkflows(), recipe]);
const server = new FactoryServer(
	runtime,
	{
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: blocked,
		stop: blocked,
		defaultRunner: () => "claude",
	},
	factoryAccess(port),
);
const token = randomBytes(32).toString("base64url");
server.auth.store.update((state) => {
	state.keys.push({
		id: "ui-fixture",
		digest: hash("ui-fixture-key"),
		label: "UI fixture",
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
	});
	state.sessions.push({
		hash: hash(token),
		credential: "ui-fixture",
		origin,
		expires: Date.now() + 3600000,
		verifiedAt: Date.now(),
	});
});
const shell = factoryWebAssets();
const receipt = {
	startedAt: new Date().toISOString(),
	node: process.version,
	base: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	source: Object.fromEntries(
		paths.map((path) => [path, hash(readFileSync(join(root, path)))]),
	),
	backend: Object.fromEntries(
		[
			"Check.js",
			"Rules.js",
			"FactoryServer.js",
			"Workflow.js",
			"WorkflowRuntime.js",
		].map((path) => [
			path,
			hash(readFileSync(join(root, "packages/edge-worker/dist/factory", path))),
		]),
	),
	build: shell.build,
	assets: shell.assets.map(({ path, sha256 }) => ({ path, sha256 })),
	origin,
	limitations: [
		"Fixture-seeded private auth session, no passkey login claim",
		"No agent/run/provider execution",
		"Simulation fixtures are synthetic; no live evidence authentication claim",
	],
	assertions: [],
};
writeFileSync(
	join(evidence, "identity.json"),
	`${JSON.stringify(receipt, null, 2)}\n`,
);
writeFileSync(
	join(directory, "browser-session.json"),
	JSON.stringify({ token, origin }),
	{ mode: 0o600 },
);
await server.start(port);
console.log(
	JSON.stringify({
		origin,
		sessionFile: join(directory, "browser-session.json"),
		evidence,
		build: shell.build,
	}),
);
const close = async () => {
	assert.equal(runtime.runs.size, 0, "UI fixture must never launch a run");
	await server.stop();
	await runtime.shutdown();
	console.log("PASS UI fixture stopped with zero launched runs");
	process.exit(0);
};
process.once("SIGTERM", close);
process.once("SIGINT", close);
await new Promise(() => {});
