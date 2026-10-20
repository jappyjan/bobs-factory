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
import { request as httpRequest } from "node:http";
import { createServer, request as httpsRequest } from "node:https";
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
	"Only mock agents are authorized",
);
const directory = mkdtempSync(join(tmpdir(), "f1-device-pairing-approval-"));
const home = join(directory, "home"),
	repository = join(directory, "repository"),
	stubs = join(directory, "stubs");
for (const path of [home, repository, stubs]) mkdirSync(path);
writeFileSync(join(home, "config.json"), JSON.stringify({ repositories: [] }), {
	mode: 0o600,
});
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
process.env.PATH = `${stubs}:${process.env.PATH}`;
process.env.BOBS_FACTORY_HOME = home;
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"capacity",
);
process.env.GIT_CONFIG_GLOBAL = join(directory, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const name of [
	"BOBS_FACTORY_FACTORY_PORT",
	"BOBS_FACTORY_FACTORY_ORIGIN",
	"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
	"GH_TOKEN",
	"GITHUB_TOKEN",
])
	delete process.env[name];
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "fixture@example.invalid");
writeFileSync(join(repository, "README.md"), "# Device pairing fixture\n");
git("add", ".");
git("commit", "-q", "-m", "Fixture");
const bare = join(directory, "remote.git");
execFileSync("git", ["clone", "-q", "--bare", repository, bare]);
git("remote", "add", "origin", bare);
const port = Number(process.env.F1_DEVICE_PORT ?? 3600);
const origin = `http://localhost:${port}`,
	remote = `https://127.0.0.1:${port + 1}`;
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
	assert.equal(url.origin, origin, `No provider calls: ${url.origin}`);
	return nativeFetch(input, init);
}) as typeof fetch;
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
let server: FactoryServer | undefined,
	tls: ReturnType<typeof createServer> | undefined;
const checks: string[] = [];
const requests: { method: string; path: string; status: number }[] = [];
const check = (name: string) => {
	checks.push(name);
	console.log(`PASS ${name}`);
};
const local = async (path: string, method = "GET", body?: unknown) => {
	const response = await fetch(`${origin}${path}`, {
		method,
		headers: {
			origin,
			"x-factory-request": "1",
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: response.status, value: await response.json() };
};
function publicRequest(
	path: string,
	method = "GET",
	body?: unknown,
	cookie?: string,
) {
	return new Promise<{
		status: number;
		value: any;
		cookie?: string;
		retryAfter?: number;
	}>((resolve, reject) => {
		const req = httpsRequest(
			`${remote}${path}`,
			{
				method,
				rejectUnauthorized: false,
				headers: {
					origin: remote,
					"x-factory-request": "1",
					...(body === undefined ? {} : { "content-type": "application/json" }),
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
							retryAfter: res.headers["retry-after"]
								? Number(res.headers["retry-after"])
								: undefined,
						});
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on("error", reject);
		req.setTimeout(5000, () =>
			req.destroy(new Error(`HTTPS timeout: ${method} ${path}`)),
		);
		req.end(body === undefined ? undefined : JSON.stringify(body));
	});
}
let success = false;
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
		factoryAccess(port, remote),
	);
	server.app.addHook("onResponse", async (req, reply) => {
		requests.push({
			method: req.method,
			path: req.url.split("?")[0]!,
			status: reply.statusCode,
		});
	});
	await server.start(port);
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
	tls = createServer(
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
			upstream.on("error", () => res.destroy());
			req.pipe(upstream);
		},
	);
	await new Promise<void>((done, reject) => {
		tls!.once("error", reject);
		tls!.listen(port + 1, "127.0.0.1", done);
	});
	assert.equal((await publicRequest("/api/runs")).status, 401);
	assert.equal(
		(await publicRequest("/api/auth/status")).value.pairingAvailable,
		undefined,
	);
	assert.equal(
		(
			await publicRequest("/api/auth/pairing/request", "POST", {
				code: "123456",
			})
		).status,
		409,
	);
	assert.equal(
		(
			await publicRequest("/api/auth/pairing", "POST", {
				label: "Unauthorized",
			})
		).status,
		401,
	);
	check(
		"remote access and code redemption start locked; anonymous code generation is denied",
	);
	const grant = await local("/api/auth/pairing", "POST", {
		label: "F1 device",
	});
	assert.equal(grant.status, 200);
	assert.match(grant.value.code, /^[0-9]{6}$/);
	assert.equal(server.auth.store.state.keys.length, 0);
	const status = (await publicRequest("/api/auth/status")).value;
	assert.equal(status.pairingAvailable, true);
	assert.equal(status.code, undefined);
	const pending = await Promise.all(
		[1, 2].map(() =>
			publicRequest("/api/auth/pairing/request", "POST", {
				code: grant.value.code,
			}),
		),
	);
	assert.deepEqual(
		pending.map((result) => result.status),
		[200, 200],
	);
	assert.equal(server.auth.store.state.keys.length, 0);
	for (const request of pending) {
		assert.equal(request.value.key, undefined);
		assert.equal(request.value.token, undefined);
	}
	const attacker = pending[0]!,
		deviceRequest = pending[1]!;
	assert.notEqual(
		attacker.value.confirmation,
		deviceRequest.value.confirmation,
	);
	assert.equal(
		(
			await publicRequest(
				"/api/auth/pairing/claim",
				"POST",
				{ id: deviceRequest.value.id },
				deviceRequest.cookie,
			)
		).status,
		409,
	);
	assert.equal(
		(
			await publicRequest("/api/auth/pairing/claim", "POST", {
				id: deviceRequest.value.id,
			})
		).status,
		409,
	);
	assert.equal(
		(await publicRequest("/api/auth/status")).value.pairingRequest,
		undefined,
	);
	assert.equal(
		(
			await publicRequest(
				"/api/auth/status",
				"GET",
				undefined,
				deviceRequest.cookie,
			)
		).value.pairingRequest.id,
		deviceRequest.value.id,
	);
	const approved = await local(
		`/api/auth/pairing/${grant.value.id}/approve`,
		"POST",
		{
			requestId: deviceRequest.value.id,
			confirmation: deviceRequest.value.confirmation,
		},
	);
	assert.equal(approved.status, 200);
	assert.equal(server.auth.store.state.keys.length, 0);
	assert.equal(
		(
			await publicRequest(
				"/api/auth/pairing/claim",
				"POST",
				{ id: deviceRequest.value.id },
				attacker.cookie,
			)
		).status,
		409,
	);
	assert.equal(
		(
			await publicRequest(
				"/api/auth/pairing/claim",
				"POST",
				{ id: attacker.value.id },
				attacker.cookie,
			)
		).status,
		409,
	);
	const claimed = await Promise.all(
		[1, 2].map(() =>
			publicRequest(
				"/api/auth/pairing/claim",
				"POST",
				{ id: deviceRequest.value.id },
				deviceRequest.cookie,
			),
		),
	);
	assert.deepEqual(claimed.map((result) => result.status).sort(), [200, 409]);
	const device = claimed.find((result) => result.status === 200)!.value;
	assert.match(device.key, /^[A-Za-z0-9_-]{43}$/);
	assert(!readFileSync(server.auth.store.path, "utf8").includes(device.key));
	check(
		"stolen-code requests get distinct confirmations and no key; exact trusted approval releases one key only to its bound browser",
	);
	const login = await publicRequest("/api/auth/login", "POST", {
		key: device.key,
		staySignedIn: true,
	});
	assert.equal(login.status, 200);
	assert.equal(login.value.expires, null);
	assert.equal(
		(await publicRequest("/api/config", "GET", undefined, login.cookie)).status,
		200,
	);
	check(
		"approved device receives a normal digest-only key over HTTPS and uses standard persistent-session login",
	);
	const configured = await local("/api/onboarding/project", "POST", {
		repositoryPath: repository,
		runner: "codex",
	});
	assert.equal(configured.status, 200);
	const repo = JSON.parse(readFileSync(join(home, "config.json"), "utf8"))
		.repositories[0];
	const recipe = {
		id: "device-pairing",
		name: "Device pairing",
		steps: [
			{
				id: "run",
				name: "Pairing fixture",
				type: "script",
				script: "printf '{\"paired\":true}\\n'",
			},
		],
	};
	assert.equal(
		(
			await local("/api/workflows", "PUT", {
				workflows: [...runtime.listWorkflows(), recipe],
				defaultWorkflow: recipe.id,
			})
		).status,
		200,
	);
	const launch = await publicRequest(
		"/api/runs",
		"POST",
		{
			repositoryId: repo.id,
			workflow: recipe.id,
			prompt: "Verify paired device access",
			runner: "codex",
		},
		login.cookie,
	);
	assert.equal(launch.status, 202);
	for (
		let i = 0;
		i < 100 &&
		!["completed", "failed"].includes(runtime.get(launch.value.id).status);
		i++
	)
		await new Promise((done) => setTimeout(done, 100));
	assert.equal(runtime.get(launch.value.id).status, "completed");
	assert.equal(runtime.get(launch.value.id).outputs.run.paired, true);
	assert.equal(
		(
			await publicRequest(
				`/api/runs/${launch.value.id}`,
				"GET",
				undefined,
				login.cookie,
			)
		).value.status,
		"completed",
	);
	check(
		"paired device launches and reads a completed scripted workflow in a real isolated EdgeWorker worktree",
	);
	assert.equal(
		(await local(`/api/auth/keys/${device.id}`, "DELETE", {})).status,
		200,
	);
	assert.equal(
		(await publicRequest("/api/runs", "GET", undefined, login.cookie)).status,
		401,
	);
	assert.equal(
		(await publicRequest("/api/auth/login", "POST", { key: device.key }))
			.status,
		409,
	);
	check(
		"removing the paired device key revokes its normal session and key without affecting local operator access",
	);
	const guessing = (
		await local("/api/auth/pairing", "POST", { label: "Guess limit" })
	).value;
	let throttled: Awaited<ReturnType<typeof publicRequest>> | undefined;
	for (let i = 0; i < 6; i++) {
		const result = await publicRequest("/api/auth/pairing/request", "POST", {
			code: guessing.code === "000000" ? "000001" : "000000",
		});
		if (result.status === 429) {
			throttled = result;
			break;
		}
		assert.equal(result.status, 409);
	}
	assert(throttled);
	assert(
		throttled.retryAfter &&
			throttled.retryAfter > 0 &&
			throttled.retryAfter <= 60,
	);
	assert.equal(server.auth.pairingAvailable(), true);
	assert.equal(server.auth.store.state.keys.length, 0);
	check(
		"repeated HTTPS guesses are throttled with Retry-After while the active code remains enabled",
	);
	console.log("WAITING_FOR_RATE_WINDOW");
	await new Promise((done) =>
		setTimeout(done, throttled.retryAfter! * 1000 + 100),
	);
	const afterLimit = await publicRequest("/api/auth/pairing/request", "POST", {
		code: guessing.code,
	});
	assert.equal(afterLimit.status, 200);
	assert.equal(afterLimit.value.approved, false);
	assert.equal(
		(await local(`/api/auth/pairing/${guessing.id}`, "DELETE", {})).status,
		200,
	);
	assert.equal(
		(
			await publicRequest(
				"/api/auth/pairing/claim",
				"POST",
				{ id: afterLimit.value.id },
				afterLimit.cookie,
			)
		).status,
		409,
	);
	check(
		"the code recovers after throttling without regeneration; explicit cancellation revokes its pending browser request",
	);
	console.log(
		`BROWSER_READY ${JSON.stringify({ directory, local: `${origin}/#/settings/access`, remote })}`,
	);
	if (process.env.F1_DEVICE_HOLD === "1") {
		for (let i = 0; i < 12000 && !existsSync(join(directory, "continue")); i++)
			await new Promise((done) => setTimeout(done, 100));
		assert(existsSync(join(directory, "continue")), "Browser hold timed out");
	}
	success = true;
} finally {
	if (tls?.listening)
		await new Promise<void>((done) => tls!.close(() => done()));
	await server?.stop();
	await worker.stop();
	const root = resolve(import.meta.dirname, "../../../..");
	const files = [
		"packages/edge-worker/src/factory/FactoryAuth.ts",
		"packages/edge-worker/src/factory/FactoryServer.ts",
		"packages/edge-worker/src/factory/web/auth.tsx",
		"packages/edge-worker/src/factory/web/styles.css",
		"apps/f1/test-drives/assets/device-pairing-approval.ts",
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
		requests: requests.filter((request) => request.method !== "GET"),
		readCounts: Object.fromEntries(
			[
				...new Set(
					requests
						.filter((request) => request.method === "GET")
						.map((request) => `${request.status} ${request.path}`),
				),
			].map((key) => [
				key,
				requests.filter(
					(request) =>
						request.method === "GET" &&
						`${request.status} ${request.path}` === key,
				).length,
			]),
		),
		directory,
		limitations:
			"Mock agents, disposable tool stubs, real scripted workflow and local self-signed TLS proxy. No provider calls, packaged desktop or physical mobile/PWA validation. Fixture retained for inspection; worker and listeners stopped.",
	};
	writeFileSync(
		join(directory, "result.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
}
// Like other embedded F1 drives, release mock-only background timers after owned cleanup.
process.exit(success ? 0 : 1);
