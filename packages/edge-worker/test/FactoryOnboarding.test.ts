import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { factoryAccess } from "../src/factory/FactoryAuth.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { factoryHttp } from "./fixtures/factory-http.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
function fixture(port?: number) {
	const home = mkdtempSync(join(tmpdir(), "factory-guided-access-"));
	const runtime = new WorkflowRuntime(home, {
		agent: vi.fn(),
		script: vi.fn(),
		tool: vi.fn(),
	});
	const onboarding = {
		status: vi.fn(() => ({ available: true, required: true })),
		configure: vi.fn(async () => ({ required: false })),
		connectGithub: vi.fn(async () => ({ connected: true })),
	};
	const server = new FactoryServer(
		runtime,
		{
			onboarding,
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: vi.fn(),
			stop: vi.fn(),
		},
		port
			? factoryAccess(port, "https://remote.example.test")
			: { origins: ["http://localhost", "https://remote.example.test"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	const enroll = async (origin = "https://remote.example.test") => {
		const headers = {
			host: new URL(origin).host,
			origin,
			"x-factory-request": "1",
		};
		const created = server.auth.create(undefined, origin, "Onboarding", true);
		const verify = await server.app.inject({
			method: "POST",
			url: "/api/auth/login",
			headers,
			payload: { key: created.key },
		});
		expect(verify.statusCode).toBe(200);
		return {
			...headers,
			cookie: String(verify.headers["set-cookie"]).split(";")[0],
		};
	};
	return { server, onboarding, enroll };
}
it("opens onboarding and project/GitHub setup over actual IPv4, IPv6 and localhost sockets without enrollment", async () => {
	const reservation = createServer();
	await new Promise<void>((resolve) =>
		reservation.listen(0, "127.0.0.1", resolve),
	);
	const address = reservation.address();
	if (!address || typeof address === "string") throw new Error("Missing port");
	const port = address.port;
	await new Promise<void>((resolve, reject) =>
		reservation.close((error) => (error ? reject(error) : resolve())),
	);
	const f = fixture(port);
	await f.server.start(port);
	for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
		const origin = `http://${hostname}:${port}`;
		const status = await fetch(`${origin}/api/auth/status`);
		expect(await status.json()).toMatchObject({
			access: "local",
			authenticated: true,
			setupRequired: false,
		});
		expect(status.headers.get("set-cookie")).toBeNull();
		const config = await fetch(`${origin}/api/config`).then((r) => r.json());
		const setup = await fetch(`${origin}/api/onboarding`);
		const headers = {
			origin,
			"x-factory-request": "1",
			"content-type": "application/json",
		};
		const project = await fetch(`${origin}/api/onboarding/project`, {
			method: "POST",
			headers,
			body: JSON.stringify({ repositoryPath: "/my/project", runner: "codex" }),
		});
		const github = await fetch(`${origin}/api/onboarding/github`, {
			method: "POST",
			headers,
			body: JSON.stringify({ token: "fixture-secret" }),
		});
		expect(
			{
				config: config.onboarding,
				setup: setup.status,
				project: project.status,
				github: github.status,
			},
			hostname,
		).toEqual({
			config: { available: true, required: true },
			setup: 200,
			project: 200,
			github: 200,
		});
	}
	expect(f.server.auth.store.state.keys).toEqual([]);
	expect(f.server.auth.store.state.sessions).toEqual([]);
	const calls = f.onboarding.status.mock.calls.length;
	const denied = await factoryHttp(`http://[::1]:${port}/api/onboarding`, {
		host: "remote.example.test",
		origin: "https://remote.example.test",
		"x-factory-request": "1",
	});
	expect(denied.status).toBe(401);
	expect(f.onboarding.status).toHaveBeenCalledTimes(calls);
});
it("opens local setup without enrollment while denying unauthenticated remote setup", async () => {
	const f = fixture();
	for (const route of [
		"/api/onboarding",
		"/api/onboarding/project",
		"/api/onboarding/github",
	]) {
		const response = await f.server.app.inject({
			method: route.endsWith("onboarding") ? "GET" : "POST",
			url: route,
			headers: {
				host: "remote.example.test",
				origin: "https://remote.example.test",
				"x-factory-request": "1",
			},
			payload: route.endsWith("onboarding") ? undefined : {},
		});
		expect(response.statusCode).toBe(401);
	}
	expect(f.onboarding.status).not.toHaveBeenCalled();
	expect(f.onboarding.configure).not.toHaveBeenCalled();
	expect(f.onboarding.connectGithub).not.toHaveBeenCalled();
	const headers = {
		host: "localhost",
		origin: "http://localhost",
		"x-factory-request": "1",
	};
	const status = await f.server.app.inject({
		url: "/api/onboarding",
		headers,
	});
	expect(status.statusCode).toBe(200);
	expect(status.json()).toMatchObject({ available: true, required: true });
	expect(status.headers["set-cookie"]).toBeUndefined();
	const configure = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/project",
		headers,
		payload: { repositoryPath: "/my/project", runner: "codex" },
	});
	expect(configure.statusCode).toBe(200);
	expect(f.onboarding.configure).toHaveBeenCalledWith({
		repositoryPath: "/my/project",
		runner: "codex",
	});
	const connect = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/github",
		headers,
		payload: { token: "fixture-secret" },
	});
	expect(connect.statusCode).toBe(200);
	expect(connect.body).not.toContain("fixture-secret");
});
it("does not expose machine setup remotely even to an authenticated remote key session", async () => {
	const f = fixture(),
		headers = await f.enroll("https://remote.example.test");
	const config = await f.server.app.inject({ url: "/api/config", headers });
	expect(config.statusCode).toBe(200);
	expect(config.json()).not.toHaveProperty("onboarding");
	const response = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/github",
		headers,
		payload: { token: "fixture-secret" },
	});
	expect(response.statusCode).toBe(409);
	expect(response.json().error).toContain("localhost");
	expect(f.onboarding.status).not.toHaveBeenCalled();
	expect(f.onboarding.connectGithub).not.toHaveBeenCalled();
});
it("requires exact origin and request headers before local setup mutations", async () => {
	const f = fixture();
	const headers = {
		host: "localhost",
		origin: "http://localhost",
		"x-factory-request": "1",
	};
	for (const bad of [
		{ ...headers, origin: "https://evil.example.test" },
		{ ...headers, "x-factory-request": "0" },
	]) {
		const response = await f.server.app.inject({
			method: "POST",
			url: "/api/onboarding/project",
			headers: bad,
			payload: { repositoryPath: "/my/project", runner: "codex" },
		});
		expect(response.statusCode).toBe(403);
	}
	expect(f.onboarding.configure).not.toHaveBeenCalled();
});
