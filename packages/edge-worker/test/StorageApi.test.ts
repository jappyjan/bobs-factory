import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { StorageRetention } from "../src/storage/StorageRetention.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

it("guards storage mutations, rejects stale previews and persists instance policy", async () => {
	const home = await realpath(await mkdtemp(join(tmpdir(), "storage-api-")));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const storage = new StorageRetention(home, {});
	await storage.store.configure({ enabled: false }, 0);
	const server = new FactoryServer(runtime, {
		storage,
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw Error("unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const headers = { "x-factory-request": "1" };
	try {
		await server.app.ready();
		await expect
			.poll(async () => !!(await storage.status()).preview)
			.toBe(true);
		expect(
			(await server.app.inject({ method: "POST", url: "/api/storage/preview" }))
				.statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/storage/preview",
					headers: { ...headers, origin: "https://untrusted.test" },
				})
			).statusCode,
		).toBe(403);
		const preview = await server.app.inject({
			method: "POST",
			url: "/api/storage/preview",
			headers,
		});
		expect(preview.statusCode).toBe(200);
		const policy = (await storage.status()).policy;
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/storage/policy",
					headers,
					payload: {
						revision: policy.revision,
						policy: { ...policy, snapshotCount: 3 },
					},
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/storage/execute",
					headers,
					payload: { previewId: preview.json().id, selected: [] },
				})
			).statusCode,
		).toBeGreaterThanOrEqual(400);
		expect(
			(await new StorageRetention(home, {}).store.policy()).snapshotCount,
		).toBe(3);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/storage/execute",
					headers,
					payload: { path: "/tmp/arbitrary-user-data" },
				})
			).statusCode,
		).toBe(400);
	} finally {
		await server.app.close();
		await runtime.shutdown();
		await rm(home, { recursive: true, force: true });
	}
});
