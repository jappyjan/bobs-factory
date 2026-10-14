import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { factoryAccess } from "../src/factory/FactoryAuth.js";
import { requestFactoryTerminalSession } from "../src/factory/FactoryAuthOperator.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { factoryHttp } from "./fixtures/factory-http.js";

const origin = "https://factory.example.test",
	host = "factory.example.test";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
function fixture(useEnvironment = false, localPort?: number) {
	const home = mkdtempSync(join(tmpdir(), "factory-access-test-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const start = vi.fn(),
		entries = vi.fn(() => []),
		repositories = vi.fn(() => []);
	const server = new FactoryServer(
		runtime,
		{ repositories, sessions: () => [], entries, start, stop: vi.fn() },
		useEnvironment
			? undefined
			: localPort
				? factoryAccess(localPort, origin)
				: { origins: [origin, "http://localhost"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { force: true, recursive: true });
	});
	const writeHeaders = { host, origin, "x-factory-request": "1" };
	const enroll = async () => {
		const localOrigin = server.auth.access.origins.find(
			(o) => new URL(o).hostname === "localhost",
		)!;
		const localHeaders = {
			host: new URL(localOrigin).host,
			origin: localOrigin,
			"x-factory-request": "1",
		};
		const created = await server.app.inject({
			method: "POST",
			url: "/api/auth/keys",
			headers: localHeaders,
			payload: { label: "Test" },
		});
		expect(created.statusCode).toBe(200);
		const result = await server.app.inject({
			method: "POST",
			url: "/api/auth/login",
			headers: writeHeaders,
			payload: { key: created.json().key },
		});
		expect(result.statusCode).toBe(200);
		return String(result.headers["set-cookie"]);
	};
	return {
		home,
		runtime,
		server,
		start,
		entries,
		repositories,
		writeHeaders,
		enroll,
	};
}

it("grants local operator access without credentials, cookies, enrollment or transferable sessions", async () => {
	const f = fixture();
	const credentials = structuredClone(f.server.auth.store.state);
	for (const peer of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
		for (const host of ["localhost", "[::1]"]) {
			const headers = { host };
			const status = await f.server.app.inject({
				url: "/api/auth/status",
				headers,
				remoteAddress: peer,
			});
			expect(status.json()).toEqual({
				authenticated: true,
				access: "local",
				setupRequired: false,
				origin: `http://${host}`,
			});
			expect(status.headers["set-cookie"]).toBeUndefined();
			for (const url of ["/api/config", "/api/runs", "/api/updates"])
				expect(
					(await f.server.app.inject({ url, headers, remoteAddress: peer }))
						.statusCode,
				).toBe(200);
			const result = await f.server.app.inject({
				method: "POST",
				url: "/api/runs/missing/stop",
				headers: { host, origin: `http://${host}`, "x-factory-request": "1" },
				remoteAddress: peer,
			});
			expect(result.statusCode).toBe(404); // Reached the handler without any login.
		}
	expect(f.server.auth.store.state).toEqual(credentials);
	expect(f.server.auth.store.state.sessions).toEqual([]);
	// The validated local request can manage instance keys.
	expect(
		(
			await f.server.app.inject({
				url: "/api/auth/keys",
				headers: { host: "localhost" },
			})
		).statusCode,
	).toBe(200);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: { host, cookie: "factory-local-session=local-operator" },
				remoteAddress: "203.0.113.1",
			})
		).statusCode,
	).toBe(401);
});

it("rejects rebinding, remote peers, forwarding and external web pages before protected handlers", async () => {
	const f = fixture();
	const cases = [
		{ host: "evil.example" },
		{ host: "localhost.evil.example" },
		{ host: "localhost:9999" },
		{ host: "127.0.0.2" },
		{ host: "localhost", origin: "https://evil.example" },
		{ host: "localhost", origin: "null" },
		{ host: "localhost", "sec-fetch-site": "cross-site" },
		{ host: "localhost", "sec-fetch-site": "same-site" },
		{ host: "localhost", referer: "https://evil.example/page" },
		{ host: "localhost", forwarded: "for=127.0.0.1;host=localhost;proto=http" },
		{ host: "localhost", "x-forwarded-for": "127.0.0.1" },
		{ host: "localhost", "x-forwarded-host": "localhost" },
		{ host: "localhost", "x-forwarded-proto": "http" },
		{ host: "localhost", "x-real-ip": "127.0.0.1" },
		{ host: "localhost", via: "1.1 proxy" },
	];
	for (const headers of cases)
		for (const url of ["/", "/api/config", "/api/runs", "/api/events"])
			expect(
				(await f.server.app.inject({ url, headers })).statusCode,
				JSON.stringify(headers),
			).toBe(403);
	for (const peer of [
		"203.0.113.1",
		"192.168.1.2",
		"2001:db8::1",
		"::ffff:192.168.1.2",
	])
		for (const host of ["localhost", "[::1]"])
			expect(
				(
					await f.server.app.inject({
						url: "/api/config",
						remoteAddress: peer,
						headers: { host, "x-forwarded-for": "127.0.0.1" },
					})
				).statusCode,
			).toBe(403);
	for (const headers of [
		{ host: "localhost" },
		{ host: "localhost", origin: "http://localhost" },
		{ host: "localhost", "x-factory-request": "1" },
		{
			host: "localhost",
			origin: "https://evil.example",
			"x-factory-request": "1",
		},
		{
			host: "localhost",
			origin: "http://localhost",
			"x-factory-request": "1",
			"sec-fetch-site": "cross-site",
		},
	])
		expect(
			(
				await f.server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers,
					payload: {},
				})
			).statusCode,
		).toBe(403);
	for (const headers of [
		f.writeHeaders,
		{ ...f.writeHeaders, origin: "https://evil.test" },
	]) {
		const response = await f.server.app.inject({
			method: "POST",
			url: "/api/launch-assets?metadata=invalid",
			headers: { ...headers, "content-type": "application/octet-stream" },
			payload: Buffer.from("private file"),
		});
		expect(response.statusCode).toBe(headers.origin === origin ? 401 : 403);
	}

	expect(f.start).not.toHaveBeenCalled();
	expect(f.entries).not.toHaveBeenCalled();
	expect(f.repositories).not.toHaveBeenCalled();
});

it("serves real IPv4 and IPv6 loopback APIs and streams without auth while preserving public-host authentication", async () => {
	const reservation = createServer();
	await new Promise<void>((resolve) =>
		reservation.listen(0, "127.0.0.1", resolve),
	);
	const address = reservation.address();
	if (!address || typeof address === "string") throw Error("Missing test port");
	const port = address.port;
	await new Promise<void>((resolve) => reservation.close(() => resolve()));
	const f = fixture(false, port);
	await f.server.start(port);
	for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) {
		const local = `http://${hostname}:${port}`;
		const status = await fetch(`${local}/api/auth/status`, {
			headers: { Connection: "close" },
		});
		expect(await status.json()).toEqual({
			authenticated: true,
			access: "local",
			setupRequired: false,
			origin: local,
		});
		expect(status.headers.get("set-cookie")).toBeNull();
		const config = await fetch(`${local}/api/config`, {
			headers: { Connection: "close" },
		});
		expect(config.status).toBe(200);
		await config.arrayBuffer();
		const streamController = new AbortController();
		const events = await fetch(`${local}/api/events`, {
			signal: streamController.signal,
			headers: { Connection: "close" },
		});
		expect(events.status).toBe(200);
		const reader = events.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"event: ready",
		);
		streamController.abort();
		await reader.cancel().catch((error: Error) => {
			if (error.name !== "AbortError") throw error;
		});
		expect(
			(
				await fetch(`${local}/api/runs/missing/stop`, {
					method: "POST",
					headers: {
						Origin: local,
						"X-Factory-Request": "1",
						Connection: "close",
					},
				})
			).status,
		).toBe(404);
	}
	const url = `http://127.0.0.1:${port}/api/runs`;
	expect(
		(await factoryHttp(url, { host, "x-forwarded-for": "203.0.113.1" })).status,
	).toBe(401);
	const cookie = (await f.enroll()).split(";")[0]!;
	expect(
		(
			await factoryHttp(url, {
				host,
				cookie,
				"x-forwarded-for": "203.0.113.1",
				"x-forwarded-proto": "https",
			})
		).status,
	).toBe(200);
	expect(
		(
			await factoryHttp(url, {
				host: `localhost:${port}`,
				cookie,
				"x-forwarded-for": "203.0.113.1",
			})
		).status,
	).toBe(403);
	expect((await factoryHttp(url, { host: "evil.example" })).status).toBe(403);
	await f.server.stop();
	for (const hostname of ["127.0.0.1", "[::1]"])
		await expect(
			fetch(`http://${hostname}:${port}/api/config`),
		).rejects.toThrow();
});
it("denies remote protected GET/HEAD/write before hooks, including unknown paths and spoofed identities", async () => {
	const f = fixture();
	for (const url of [
		"/api/runs",
		"/api/launch-assets",
		"/api/config",
		"/api/events",
		"/api/runs/id",
		"/api/runs/id/transcript",
		"/api/runs/id/raw",
		"/api/runs/id/screenshots/0",
		"/api/runs/id/videos/demo/media?v=hash",
		"/api/runs/id/videos/demo/poster?v=hash",
		"/api/runs/id/videos/demo/captions?v=hash",
		"/api/runs/id/question-images/a.png",
		"/api/runs/id/review-files",
		"/api/auth/keys",
		"/api/new-route",
		"/private-file",
	]) {
		for (const method of ["GET", "HEAD"] as const) {
			const response = await f.server.app.inject({
				method,
				url,
				headers: { host },
			});
			expect(response.statusCode, `${method} ${url}`).toBe(401);
			expect(response.headers["cache-control"]).toBe("no-store");
		}
	}
	for (const headers of [
		{ host: "localhost" },
		{
			host,
			"x-forwarded-host": "localhost",
			"x-forwarded-for": "127.0.0.1",
			"x-forwarded-proto": "http",
		},
		{ host, origin: "http://localhost" },
	]) {
		expect(
			(
				await f.server.app.inject({
					url: "/api/runs",
					headers,
					remoteAddress: "203.0.113.1",
				})
			).statusCode,
		).toBe(headers.origin || headers.host === "localhost" ? 403 : 401);
	}
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs",
				headers: f.writeHeaders,
				payload: {},
			})
		).statusCode,
	).toBe(401);
	expect(f.start).not.toHaveBeenCalled();
	expect(f.entries).not.toHaveBeenCalled();
	expect(f.repositories).not.toHaveBeenCalled();
	expect(
		(
			await f.server.app.inject({ url: "/api/auth/status", headers: { host } })
		).json(),
	).toMatchObject({ authenticated: false, setupRequired: true });
	expect(
		(await f.server.app.inject({ url: "/", headers: { host } })).statusCode,
	).toBe(200);
});
it("requires exact Origin/action headers, performs key sign-in, and uses secure opaque cookies", async () => {
	const f = fixture();
	for (const headers of [
		{ host, "x-factory-request": "1" },
		{ host, origin },
		{ ...f.writeHeaders, origin: "https://evil.test" },
	]) {
		expect(
			(
				await f.server.app.inject({
					method: "POST",
					url: "/api/auth/login",
					headers,
					payload: {},
				})
			).statusCode,
		).toBe(403);
	}
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/auth/login",
				headers: f.writeHeaders,
				payload: {},
			})
		).statusCode,
	).toBe(400);
	const cookie = await f.enroll();
	expect(cookie).toContain("__Host-factory-session=");
	expect(cookie).toContain("HttpOnly");
	expect(cookie).toContain("Secure");
	expect(cookie).toContain("SameSite=Strict");
	expect(cookie).toContain("Path=/");
	expect(cookie).not.toContain("Domain");
	const headers = { host, cookie: cookie.split(";")[0] };
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers })).statusCode,
	).toBe(200);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: { ...headers, cookie: "__Host-factory-session=forged" },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/auth/logout",
				headers: { ...headers, ...f.writeHeaders },
			})
		).statusCode,
	).toBe(200);
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers })).statusCode,
	).toBe(401);
});
it.each([
	"logout",
	"expiry",
	"recovery",
	"rotation",
	"removal",
])("closes real idle SSE on %s and denies reconnect", async (reason) => {
	const f = fixture(),
		cookie = (await f.enroll()).split(";")[0]!;
	if (reason === "expiry")
		f.server.auth.store.update((state) => {
			state.sessions[0]!.expires = Date.now() + 250;
		});
	const address = await f.server.app.listen({ host: "127.0.0.1", port: 0 });
	const response = await factoryHttp(
		`${address}/api/events`,
		{ host, cookie },
		AbortSignal.timeout(3000),
	);
	expect(response.status).toBe(200);
	const reader = response.body!.getReader();
	expect(new TextDecoder().decode((await reader.read()).value)).toContain(
		"event: ready",
	);
	if (reason === "logout")
		await f.server.app.inject({
			method: "POST",
			url: "/api/auth/logout",
			headers: { ...f.writeHeaders, cookie },
		});
	if (reason === "recovery") {
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			join(f.server.auth.store.directory, "recover"),
			"RESET FACTORY AUTHENTICATION",
		);
		f.server.auth.checkRecovery();
	}
	if (reason === "rotation" || reason === "removal") {
		const id = f.server.auth.store.state.keys[0]!.id;
		const result = await f.server.app.inject({
			method: reason === "rotation" ? "POST" : "DELETE",
			url: `/api/auth/keys/${id}${reason === "rotation" ? "/rotate" : ""}`,
			headers: { ...f.writeHeaders, cookie },
		});
		expect(result.statusCode).toBe(200);
		expect(result.json().sessionRevoked).toBe(true);
	}
	expect((await reader.read()).done).toBe(true);
	expect(
		(
			await f.server.app.inject({
				url: "/api/events",
				headers: { host, cookie },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs/id/screenshots/0",
				headers: { host, cookie },
			})
		).statusCode,
	).toBe(401);
});

it("opens the IP and localhost dashboard without enrollment", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-loopback-redirect-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(
		runtime,
		{
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("Unused");
			},
			stop: () => {},
		},
		{ origins: ["http://127.0.0.1", "http://localhost"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	const entry = await server.app.inject({
		url: "/",
		headers: { host: "127.0.0.1" },
	});
	expect(entry.statusCode).toBe(302);
	expect(entry.headers.location).toBe("http://localhost");
	for (const host of ["127.0.0.1", "localhost"])
		expect(
			(await server.app.inject({ url: "/api/runs", headers: { host } }))
				.statusCode,
		).toBe(200);
});

// The existing public-tunnel setting must remain usable after adding authentication.
it.each([
	false,
	true,
])("protects the configured public origin with explicit-setting precedence (%s)", async (explicit) => {
	vi.stubEnv(
		"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
		explicit ? "https://old.example.test" : origin,
	);
	vi.stubEnv("BOBS_FACTORY_FACTORY_ORIGIN", explicit ? origin : undefined);
	vi.stubEnv("BOBS_FACTORY_FACTORY_SESSION_HOURS", "12");
	try {
		const f = fixture(true);
		expect(
			(await f.server.app.inject({ url: "/api/runs", headers: { host } }))
				.statusCode,
		).toBe(401);
		const cookie = (await f.enroll()).split(";")[0]!;
		expect(
			(
				await f.server.app.inject({
					url: "/api/runs",
					headers: { host, cookie },
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await f.server.app.inject({
					url: "/api/runs",
					headers: { host: "old.example.test", cookie },
				})
			).statusCode,
		).toBe(403);
	} finally {
		vi.unstubAllEnvs();
	}
});
it("protects explicit resume with the existing session and same-origin write requirements", async () => {
	const f = fixture();
	const url = "/api/runs/missing/resume";
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url,
				headers: f.writeHeaders,
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url,
				headers: { host: "localhost" },
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url,
				headers: {
					host: "localhost",
					origin: "http://localhost",
					"x-factory-request": "1",
				},
			})
		).statusCode,
	).toBe(409); // Authorized request reaches run validation; the fixture ID is absent.
});
it("keeps terminal tokens confined to local access and rejects transplant to a remote authority", async () => {
	const f = fixture();
	const token = requestFactoryTerminalSession(f.home);
	const local = { host: "localhost", authorization: `Bearer ${token}` };
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers: local }))
			.statusCode,
	).toBe(200);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: { host, authorization: `Bearer ${token}` },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: {
					host: "localhost",
					authorization: `Bearer ${"x".repeat(43)}`,
				},
			})
		).statusCode,
	).toBe(200);
	// Writes keep the browser CSRF requirements.
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs/missing/stop",
				headers: local,
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs/missing/stop",
				headers: {
					...local,
					origin: "http://localhost",
					"x-factory-request": "1",
				},
			})
		).statusCode,
	).toBe(404);
	expect(
		(
			await f.server.app.inject({
				url: "/api/auth/keys",
				headers: local,
			})
		).statusCode,
	).toBe(200);
});

it("allows local IPv6 key creation and remote management, rejects anonymous management and key Bearer access", async () => {
	const f = fixture();
	const created = await f.server.app.inject({
		method: "POST",
		url: "/api/auth/keys",
		headers: {
			host: "[::1]",
			origin: "http://[::1]",
			"x-factory-request": "1",
		},
		payload: { label: "IPv6 key" },
		remoteAddress: "::1",
	});
	expect(created.statusCode).toBe(200);
	const { key, id } = created.json();
	expect(
		(
			await f.server.app.inject({
				url: "/api/config",
				headers: { host, authorization: `Bearer ${key}` },
			})
		).statusCode,
	).toBe(401);
	const malformed = await f.server.app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: { ...f.writeHeaders, "content-type": "application/json" },
		payload: key,
	});
	expect(malformed.statusCode).toBe(400);
	expect(malformed.json()).toEqual({ error: "Invalid API key" });
	const login = await f.server.app.inject({
		method: "POST",
		url: "/api/auth/login",
		headers: f.writeHeaders,
		payload: { key },
	});
	expect(login.statusCode).toBe(200);
	const headers = {
		...f.writeHeaders,
		cookie: String(login.headers["set-cookie"]).split(";")[0],
	};
	const list = await f.server.app.inject({ url: "/api/auth/keys", headers });
	expect(list.statusCode).toBe(200);
	expect(list.body).not.toContain(key);
	expect(list.body).not.toContain("digest");
	for (const [method, url, payload] of [
		["POST", "/api/auth/keys", { label: "Anonymous" }],
		["DELETE", `/api/auth/keys/${id}`, undefined],
		["POST", `/api/auth/keys/${id}/rotate`, {}],
	] as const)
		expect(
			(
				await f.server.app.inject({
					method,
					url,
					payload,
					headers: f.writeHeaders,
				})
			).statusCode,
		).toBe(401);
	const other = await f.server.app.inject({
		method: "POST",
		url: "/api/auth/keys",
		headers,
		payload: { label: "Remote key" },
	});
	expect(other.statusCode).toBe(200);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: `/api/auth/keys/${other.json().id}/rotate`,
				headers,
				payload: {},
			})
		).json().sessionRevoked,
	).toBe(false);
	const removed = await f.server.app.inject({
		method: "DELETE",
		url: `/api/auth/keys/${id}`,
		headers,
	});
	expect(removed.json()).toEqual({ removed: true, sessionRevoked: true });
	expect(
		(await f.server.app.inject({ url: "/api/config", headers })).statusCode,
	).toBe(401);
	for (const url of [
		"/api/auth/login/options",
		"/api/auth/login/verify",
		"/api/auth/register/options",
		"/api/auth/register/verify",
	])
		expect(
			(
				await f.server.app.inject({
					method: "POST",
					url,
					headers: {
						host: "localhost",
						origin: "http://localhost",
						"x-factory-request": "1",
					},
					payload: { grant: "old-enrollment-code" },
				})
			).statusCode,
		).toBe(404);
});
