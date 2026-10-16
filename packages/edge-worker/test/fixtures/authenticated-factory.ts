import { createHash } from "node:crypto";
import { FactoryServer as ProtectedFactoryServer } from "../../src/factory/FactoryServer.js";
import type { WorkflowRuntime } from "../../src/factory/WorkflowRuntime.js";
// Existing route tests exercise handlers with a fixture server-side session.
// Authentication/bypass/real key login are exercised separately, with the real server.
export class FactoryServer extends ProtectedFactoryServer {
	constructor(
		runtime: WorkflowRuntime,
		hooks: ConstructorParameters<typeof ProtectedFactoryServer>[1],
		origin = "http://localhost",
	) {
		super(runtime, hooks, {
			origins: [origin, "http://127.0.0.1:3457"],
		});
		this.auth.store.update((state) => {
			// A restart fixture may create another server against the same auth store.
			state.keys = state.keys.filter((c) => c.id !== "route-fixture");
			state.sessions = state.sessions.filter(
				(s) => s.credential !== "route-fixture",
			);
			state.keys.push({
				id: "route-fixture",
				digest: createHash("sha256").update("fixture-key").digest("hex"),
				label: "Fixture",
				createdAt: Date.now(),
				lastUsedAt: Date.now(),
			});
			state.sessions.push({
				hash: createHash("sha256")
					.update("route-fixture-session")
					.digest("hex"),
				credential: "route-fixture",
				origin,
				expires: Date.now() + 3600000,
				verifiedAt: Date.now(),
			});
		});
		const inject = this.app.inject.bind(this.app);
		this.app.inject = ((options: any) =>
			inject({
				...options,
				headers: {
					host: new URL(origin).host,
					cookie: `${origin.startsWith("https:") ? "__Host-factory-session" : "factory-local-session"}=route-fixture-session`,
					origin,
					...options.headers,
				},
			})) as typeof this.app.inject;
	}
}
