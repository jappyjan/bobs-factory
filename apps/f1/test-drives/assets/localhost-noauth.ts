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
import { request as httpRequest, createServer as httpServer } from "node:http";
import {
	request as httpsRequest,
	createServer as httpsServer,
} from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
const directory = mkdtempSync(join(tmpdir(), "f1-localhost-noauth-"));
const home = join(directory, "home");
const repository = join(directory, "repository");
const stubs = join(directory, "stubs");
for (const path of [home, repository, stubs]) mkdirSync(path);
writeFileSync(join(home, "config.json"), JSON.stringify({ repositories: [] }), {
	mode: 0o600,
});
// Availability probes only see disposable prepared-tool stubs, never native agent credentials.
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
	execFileSync("git", args, {
		cwd: repository,
		env: gitEnv,
		encoding: "utf8",
	}).trim();
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
writeFileSync(join(repository, "README.md"), "# Local fixture\n");
git("add", ".");
git("commit", "-q", "-m", "Fixture");
const bare = join(directory, "remote.git");
execFileSync("git", ["clone", "-q", "--bare", repository, bare], {
	env: gitEnv,
});
git("remote", "add", "origin", bare);
const port = Number(process.env.F1_LOCAL_ACCESS_PORT ?? 3631);
const tlsPort = Number(process.env.F1_LOCAL_ACCESS_TLS_PORT ?? 3632);
const origin = `http://localhost:${port}`;
const remote = `https://127.0.0.1:${tlsPort}`;
process.env.PATH = `${stubs}:${process.env.PATH}`;
process.env.BOBS_FACTORY_HOME = home;
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"capacity",
);
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
const nativeFetch = fetch;
globalThis.fetch = ((input, init) => {
	const url = new URL(String(input));
	if (
		url.href ===
		"https://linear.app/.well-known/appspecific/app.linear.ips.json"
	)
		return Promise.resolve(Response.json({ ips: ["203.0.113.1/32"] }));
	if (url.href === "https://api.github.com/meta")
		return Promise.resolve(Response.json({ hooks: ["203.0.113.0/24"] }));
	assert(
		[origin, `http://127.0.0.1:${port}`, `http://[::1]:${port}`].includes(
			url.origin,
		),
		`No provider calls: ${url.origin}`,
	);
	return nativeFetch(input, init);
}) as typeof fetch;
let worker: EdgeWorker;
const onboarding = new LocalOnboarding(home, (repo, runner) =>
	worker.configureLocalRepository(repo, runner),
);
worker = new EdgeWorker(
	{
		repositories: [],
		// Inject the tracker explicitly; legacy platform no longer selects dependencies.
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
type Internal = {
	getFactoryRuntime(): WorkflowRuntime;
	startManualFactoryRun(input: unknown): Promise<unknown>;
};
const internal = worker as unknown as Internal;
let server: FactoryServer | undefined;
let tls: ReturnType<typeof httpsServer> | undefined;
let external: ReturnType<typeof httpServer> | undefined;
const externalRequests: {
	method: string;
	path: string;
	status: number;
	origin?: string;
}[] = [];
const checks: string[] = [];
const check = (name: string) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
const request = async (
	path: string,
	method = "GET",
	payload?: unknown,
	extra: Record<string, string> = {},
	base = origin,
) => {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			origin: base,
			"x-factory-request": "1",
			"content-type": "application/json",
			...extra,
		},
		body: payload === undefined ? undefined : JSON.stringify(payload),
	});
	return {
		status: response.status,
		value: await response.json(),
		cookie: response.headers.get("set-cookie"),
	};
};
const tlsRequest = (
	path: string,
	method = "GET",
	body?: unknown,
	cookie?: string,
	raw = false,
) =>
	new Promise<{ status: number; value: any; cookie?: string }>(
		(resolve, reject) => {
			const req = httpsRequest(
				`${remote}${path}`,
				{
					method,
					rejectUnauthorized: false,
					headers: {
						origin: remote,
						"x-factory-request": "1",
						...(body === undefined
							? {}
							: {
									"content-type": "application/json",
									"content-length": Buffer.byteLength(
										raw ? String(body) : JSON.stringify(body),
									),
								}),
						...(cookie ? { cookie } : {}),
					},
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on("error", reject);
					res.on("data", (chunk) => chunks.push(chunk));
					res.on("end", () => {
						try {
							resolve({
								status: res.statusCode!,
								value: JSON.parse(Buffer.concat(chunks).toString()),
								cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
							});
						} catch (error) {
							reject(
								new Error(
									`Invalid JSON from ${method} ${path}: HTTP ${res.statusCode}`,
									{ cause: error },
								),
							);
						}
					});
				},
			);
			req.on("error", reject);
			req.setTimeout(5000, () =>
				req.destroy(
					new Error(`HTTPS fixture request timed out: ${method} ${path}`),
				),
			);
			req.end(
				body === undefined
					? undefined
					: raw
						? String(body)
						: JSON.stringify(body),
			);
		},
	);
let success = false;
try {
	await worker.start();
	const runtime = internal.getFactoryRuntime();
	const hooks = {
		onboarding,
		repositories: () =>
			JSON.parse(readFileSync(join(home, "config.json"), "utf8")).repositories,
		sessions: () => [],
		entries: () => [],
		start: (input) =>
			internal.startManualFactoryRun(input) as ReturnType<
				ConstructorParameters<typeof FactoryServer>[1]["start"]
			>,
		stop: (id) => runtime.stop(id),
	};
	const createServer = () => {
		const next = new FactoryServer(runtime, hooks, factoryAccess(port, remote));
		next.app.addHook("onResponse", async (req, reply) => {
			if (
				req.headers.origin === `http://localhost:${port + 3}` ||
				req.headers.referer?.startsWith(`http://localhost:${port + 3}/`)
			)
				externalRequests.push({
					method: req.method,
					path: req.url,
					status: reply.statusCode,
					origin: req.headers.origin,
				});
		});
		return next;
	};
	server = createServer();
	await server.start(port);
	for (const base of [
		origin,
		`http://127.0.0.1:${port}`,
		`http://[::1]:${port}`,
	]) {
		const status = await request(
			"/api/auth/status",
			"GET",
			undefined,
			{},
			base,
		);
		assert.equal(status.status, 200);
		assert.deepEqual(status.value, {
			authenticated: true,
			access: "local",
			setupRequired: false,
			origin: base,
		});
		assert.equal(status.cookie, null);
		const config = await request("/api/config", "GET", undefined, {}, base);
		assert.equal(config.status, 200);
		assert.equal(config.value.onboarding.required, true);
		const setup = await request("/api/onboarding", "GET", undefined, {}, base);
		assert.equal(setup.status, 200);
		assert.equal(setup.value.required, true);
	}
	check(
		"actual localhost/IPv4/IPv6 APIs open without credentials, cookies or enrollment",
	);
	assert.equal((await request("/api/onboarding")).value.required, true);
	check(
		"fresh first-launch project/provider onboarding accessible without key setup",
	);
	if (process.env.F1_LOCAL_ACCESS_HOLD === "1") {
		console.log(`ONBOARDING_READY ${directory}`);
		for (
			let i = 0;
			i < 18000 && !existsSync(join(directory, "onboarding-continue"));
			i++
		)
			await new Promise((done) => setTimeout(done, 100));
	}
	const configured = await request(
		"/api/onboarding/project",
		"POST",
		{ repositoryPath: repository, runner: "codex" },
		{},
		`http://[::1]:${port}`,
	);
	assert.equal(configured.status, 200, JSON.stringify(configured.value));
	assert.equal(configured.value.required, false);
	check(
		"IPv6 project onboarding mutation completes without authentication (prepared-tool stubs only)",
	);
	const recipe = {
		id: "local-access",
		name: "Local access",
		steps: [
			{
				id: "run",
				name: "Fixture script",
				type: "script",
				script: "printf '{\"local\":true}\\n'",
			},
		],
	};
	const saved = await request("/api/workflows", "PUT", {
		workflows: [...runtime.listWorkflows(), recipe],
		defaultWorkflow: recipe.id,
	});
	assert.equal(saved.status, 200, JSON.stringify(saved.value));
	const repo = JSON.parse(readFileSync(join(home, "config.json"), "utf8"))
		.repositories[0];
	const launch = await request("/api/runs", "POST", {
		repositoryId: repo.id,
		workflow: recipe.id,
		prompt: "Verify local access",
		runner: "codex",
	});
	assert.equal(launch.status, 202, JSON.stringify(launch.value));
	for (
		let i = 0;
		i < 100 &&
		!["completed", "failed"].includes(runtime.get(launch.value.id).status);
		i++
	)
		await new Promise((done) => setTimeout(done, 100));
	const run = runtime.get(launch.value.id);
	assert.equal(run.status, "completed", JSON.stringify(run));
	assert.equal(run.outputs.run.local, true);
	assert.equal((await request(`/api/runs/${run.id}`)).status, 200);
	check(
		"noauth dashboard recipe save/start creates actual EdgeWorker worktree, executes script and returns completed run",
	);
	for (const headers of [
		{ origin: "https://evil.example" },
		{ "sec-fetch-site": "cross-site" },
		{ forwarded: "for=203.0.113.1" },
		{ "x-forwarded-for": "127.0.0.1" },
	])
		assert.equal(
			(await request("/api/config", "GET", undefined, headers)).status,
			403,
		);
	assert.equal(
		(await request("/api/runs", "POST", {}, { origin: "https://evil.example" }))
			.status,
		403,
	);
	check(
		"actual socket external Origin/Fetch Metadata and forwarded localhost reads/mutations rejected",
	);
	const cert = join(directory, "cert.pem"),
		key = join(directory, "key.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			key,
			"-out",
			cert,
			"-days",
			"1",
			"-subj",
			"/CN=localhost",
		],
		{ stdio: "ignore" },
	);
	tls = httpsServer(
		{ key: readFileSync(key), cert: readFileSync(cert) },
		(req, res) => {
			const upstream = httpRequest(
				`http://127.0.0.1:${port}${req.url}`,
				{
					method: req.method,
					headers: { ...req.headers, forwarded: "for=203.0.113.1;proto=https" },
				},
				(reply) => {
					res.writeHead(reply.statusCode!, reply.headers);
					reply.pipe(res);
				},
			);
			upstream.on("error", () => res.end());
			req.pipe(upstream);
		},
	);
	await new Promise<void>((done, reject) => {
		tls!.once("error", reject);
		tls!.listen(tlsPort, "127.0.0.1", done);
	});
	assert.equal((await tlsRequest("/api/config")).status, 401);
	assert.equal(
		(await tlsRequest("/api/auth/status")).value.setupRequired,
		true,
	);
	assert.equal(
		(await tlsRequest("/api/auth/keys", "POST", { label: "Unauthorized" }))
			.status,
		401,
	);
	const created = await request("/api/auth/keys", "POST", {
		label: "F1 primary",
	});
	assert.equal(created.status, 200);
	assert(
		!readFileSync(server.auth.store.path, "utf8").includes(created.value.key),
	);
	const malformed = await tlsRequest(
		"/api/auth/login",
		"POST",
		created.value.key,
		undefined,
		true,
	);
	assert.equal(malformed.status, 400);
	assert.deepEqual(malformed.value, { error: "Invalid API key" });
	check(
		"malformed HTTPS login requests return generic errors without reflecting submitted secrets",
	);
	const enrolled = await tlsRequest("/api/auth/login", "POST", {
		key: created.value.key,
	});
	assert.equal(enrolled.status, 200);
	assert(enrolled.cookie?.startsWith("__Host-factory-session="));
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, enrolled.cookie)).status,
		200,
	);
	assert.equal(
		(await tlsRequest(`/api/runs/${run.id}`, "GET", undefined, enrolled.cookie))
			.value.status,
		"completed",
	);
	const remoteLaunch = await tlsRequest(
		"/api/runs",
		"POST",
		{
			repositoryId: repo.id,
			workflow: recipe.id,
			prompt: "Authenticated workflow",
			runner: "codex",
		},
		enrolled.cookie,
	);
	assert.equal(remoteLaunch.status, 202);
	for (
		let i = 0;
		i < 100 && runtime.get(remoteLaunch.value.id).status !== "completed";
		i++
	)
		await new Promise((done) => setTimeout(done, 100));
	assert.equal(runtime.get(remoteLaunch.value.id).outputs.run.local, true);
	assert.equal(
		(await tlsRequest("/api/auth/keys", "GET", undefined, enrolled.cookie))
			.value.length,
		1,
	);
	const other = await tlsRequest(
		"/api/auth/keys",
		"POST",
		{ label: "F1 other" },
		enrolled.cookie,
	);
	assert.equal(other.status, 200);
	const otherLogin = await tlsRequest("/api/auth/login", "POST", {
		key: other.value.key,
	});
	const rotated = await tlsRequest(
		`/api/auth/keys/${created.value.id}/rotate`,
		"POST",
		{},
		enrolled.cookie,
	);
	assert.equal(rotated.status, 200);
	assert.equal(rotated.value.sessionRevoked, true);
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, enrolled.cookie)).status,
		401,
	);
	assert.equal(
		(await tlsRequest("/api/auth/login", "POST", { key: created.value.key }))
			.status,
		409,
	);
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, otherLogin.cookie))
			.status,
		200,
	);
	const replacement = await tlsRequest("/api/auth/login", "POST", {
		key: rotated.value.key,
	});
	assert.equal(replacement.status, 200);
	await server.stop();
	server = createServer();
	await server.start(port);
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, replacement.cookie))
			.status,
		200,
	);
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, enrolled.cookie)).status,
		401,
	);
	assert.equal(
		(await request(`/api/auth/keys/${created.value.id}`, "DELETE", {})).status,
		200,
	);
	assert.equal(
		(await tlsRequest("/api/config", "GET", undefined, replacement.cookie))
			.status,
		401,
	);
	assert.equal(
		(
			await tlsRequest(
				`/api/auth/keys/${other.value.id}`,
				"DELETE",
				{},
				otherLogin.cookie,
			)
		).value.sessionRevoked,
		true,
	);
	assert.equal(
		(await tlsRequest("/api/auth/status")).value.setupRequired,
		true,
	);
	assert.equal((await request("/api/auth/keys")).value.length, 0);
	assert.equal((await request("/api/config")).status, 200);
	assert.equal(
		(await tlsRequest("/api/auth/keys", "POST", { label: "Anonymous" })).status,
		401,
	);
	check(
		"TLS remote locked state, key login, local/remote key management, issuing-session revocation, other-key preservation, restart and last-key recovery",
	);
	check(
		"authenticated dashboard workflow creates a real EdgeWorker worktree and returns completed scripted output",
	);
	// Migration is exercised by an actual server restart against valid legacy state.
	await server.stop();
	const statePath = join(home, "factory/auth/state.json");
	writeFileSync(
		statePath,
		JSON.stringify({
			version: 1,
			origins: factoryAccess(port, remote).origins,
			user: "legacy",
			credentials: [
				{
					id: "old",
					origin: remote,
					publicKey: "old-public",
					counter: 0,
					deviceType: "multiDevice",
					backedUp: true,
					label: "Legacy",
					createdAt: 1,
					lastUsedAt: 1,
				},
			],
			sessions: [
				{
					hash: createHash("sha256").update("old-session").digest("hex"),
					credential: "old",
					origin: remote,
					verifiedAt: 1,
					expires: Date.now() + 3600000,
				},
			],
		}),
		{ mode: 0o600 },
	);
	server = createServer();
	await server.start(port);
	assert.equal(server.auth.store.state.version, 2);
	assert.equal(server.auth.store.state.keys.length, 0);
	assert.equal(
		(
			await tlsRequest(
				"/api/config",
				"GET",
				undefined,
				"__Host-factory-session=old-session",
			)
		).status,
		401,
	);
	assert.equal(runtime.get(run.id).status, "completed");
	check(
		"version-1 server migration invalidates legacy sessions and preserves workflow history",
	);
	// Keep the instance empty for the first-key browser demonstration.
	assert.equal(
		(
			await request("/api/config", "GET", undefined, {
				forwarded: "for=203.0.113.1",
				cookie: enrolled.cookie!,
			})
		).status,
		403,
	);
	const events = await fetch(`${origin}/api/events`);
	const reader = events.body!.getReader();
	assert(
		new TextDecoder()
			.decode((await reader.read()).value)
			.includes("event: ready"),
	);
	await reader.cancel();
	check(
		"local SSE opens without a session and remote key changes do not revoke local authority",
	);
	writeFileSync(
		join(directory, "ready.json"),
		JSON.stringify({ directory, home, origin, remote, runId: run.id }),
	);
	external = httpServer((_req, res) => {
		res.setHeader("content-type", "text/html");
		res.end(
			`<!doctype html><title>External origin fixture</title><h1>External origin fixture</h1><iframe src="${origin}/"></iframe><script>Promise.allSettled([fetch('${origin}/api/config'),fetch('${origin}/api/runs/${run.id}/stop',{method:'POST'})]).then(r=>{document.body.dataset.results=JSON.stringify(r.map(x=>({status:x.status,error:x.reason?.name})));document.body.append(' requests completed')})</script>`,
		);
	});
	await new Promise<void>((done, reject) => {
		external!.once("error", reject);
		external!.listen(port + 3, "127.0.0.1", done);
	});
	console.log(`BROWSER_READY ${directory}`);
	if (process.env.F1_LOCAL_ACCESS_HOLD === "1")
		for (let i = 0; i < 18000 && !existsSync(join(directory, "continue")); i++)
			await new Promise((done) => setTimeout(done, 100));
	if (process.env.F1_LOCAL_ACCESS_HOLD === "1") {
		assert(
			externalRequests.some((r) => r.method === "POST" && r.status === 403),
			JSON.stringify(externalRequests),
		);
		assert(
			externalRequests.some(
				(r) => r.method === "GET" && r.path === "/" && r.status === 403,
			),
			JSON.stringify(externalRequests),
		);
		assert(
			externalRequests.every((r) => r.status === 403),
			JSON.stringify(externalRequests),
		);
		check(
			"actual external-origin browser navigation/read/POST all denied with no run mutation",
		);
	}
	success = true;
} finally {
	if (external?.listening)
		await new Promise<void>((done) => external!.close(() => done()));
	if (tls?.listening)
		await new Promise<void>((done) => tls!.close(() => done()));
	await server?.stop();
	await worker.stop();
	const root = resolve(import.meta.dirname, "../../../..");
	const files = [
		"packages/edge-worker/src/factory/FactoryServer.ts",
		"packages/edge-worker/src/factory/LocalFactoryAccess.ts",
		"packages/edge-worker/src/factory/FactoryAuth.ts",
		"packages/edge-worker/src/factory/FactoryAuthStore.ts",
		"packages/edge-worker/src/factory/FactoryAuthOperator.ts",
		"packages/edge-worker/src/factory/FactoryOnboarding.ts",
		"packages/edge-worker/src/factory/Workflow.ts",
		"packages/edge-worker/src/factory/web/auth-state.ts",
		"packages/edge-worker/src/factory/web/auth.tsx",
		"packages/edge-worker/src/factory/web/settings.tsx",
		"apps/desktop/src/main.mjs",
		"apps/desktop/src/launcher.html",
		"apps/cli/src/local.ts",
		"apps/f1/test-drives/assets/localhost-noauth.ts",
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
		externalRequests,
		directory,
		limitations:
			"Mock agents, disposable prepared-tool stubs, scripted workflow and self-signed local TLS proxy. No provider calls, OS desktop packaging or physical mobile/PWA proof. Fixture retained; listeners and worker stopped.",
	};
	writeFileSync(
		join(directory, "result.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
}

// All owned listeners and the worker have closed; release mock-only background timers.
process.exit(success ? 0 : 1);
