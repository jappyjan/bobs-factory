import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { StorageRetentionStore } from "bobs-factory-core";
import { afterEach, expect, it } from "vitest";
import { acquireInstanceLock } from "../../../apps/cli/src/services/InstanceLock.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";
import { cleanupLegacyUpdates } from "../src/updates/LegacyUpdateCleanup.js";
import { UpdateDrain } from "../src/updates/UpdateDrain.js";
import { UpdateManager as CurrentUpdateManager } from "../src/updates/UpdateManager.js";
import { OwnedUpdateLifecycle } from "./fixtures/v2-supervisor/OwnedUpdateLifecycle.v2.js";
import { UpdateManager as V2UpdateManager } from "./fixtures/v2-supervisor/UpdateManager.v2.js";

/**
 * The first update into the swap-and-rollback build is driven by the supervisor
 * that is already running on installed machines (5d5f2760). That supervisor keeps
 * its own code: its UpdateManager and OwnedUpdateLifecycle are frozen under
 * fixtures/v2-supervisor and run here unchanged against workers serving the
 * current build's /api/updates/*, /api/version and `service validate-state`.
 *
 * Only the process surfaces are replaced (stopping and starting the worker); the
 * supervisor's checks, copies, link switch, receipts and rollback are the real v2 code.
 */

const previous = {
	product: "bobs-factory",
	version: "1.0.0-nightly.20261025.1",
	target: "linux-x64",
	commit: "a".repeat(40),
};
const next = {
	...previous,
	version: "1.1.0-nightly.20261029.2",
	commit: "b".repeat(40),
};
const homes: string[] = [];
const servers: Server[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.close();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function freePort() {
	const server = createNetServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No fixture port");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}
const hooks = { agent: async () => ({}) };
const capacity = {
	pauseAdmissionsForUpdate: async () => ({
		active: 0,
		stopping: 0,
		queued: 0,
	}),
	resumeAdmissionsAfterUpdate: async () => {},
} as unknown as MachineCapacity;
const edgeWorkerDist = pathToFileURL(
	join(
		dirname(new URL(import.meta.url).pathname),
		"../dist/lifecycle/PreflightState.js",
	),
).href;

function runtimeDirectory(
	root: string,
	identity: typeof previous,
	script?: string,
) {
	const directory = join(
		root,
		"lib",
		"bobs-factory",
		`bobs-factory-${identity.version}-${identity.target}`,
	);
	mkdirSync(directory, { recursive: true });
	const executable = join(directory, "bobs-factory");
	const source = script ?? `runtime ${identity.version}\n`;
	writeFileSync(executable, source, { mode: 0o755 });
	writeFileSync(
		join(directory, "build.json"),
		JSON.stringify({
			...identity,
			dirty: false,
			executable: { sha256: sha(source), size: Buffer.byteLength(source) },
		}),
	);
	return executable;
}

/** Installed runtime v1 serving a home with one saved run; candidate v2 staged beside it. */
async function machine() {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "v2-supervisor-")));
	homes.push(home);
	const port = await freePort();
	const prefix = join(home, "runtime", "desktop-installed");
	const oldExecutable = runtimeDirectory(prefix, previous);
	const link = join(prefix, "bin", "bobs-factory");
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(oldExecutable, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({ schema: 1, home, executable: link, initial: previous }),
	);
	// `service validate-state` of the candidate: this build's PreflightState.
	const candidate = runtimeDirectory(
		join(home, "updates", "staging", "stage-fixture", "runtime"),
		next,
		`#!/usr/bin/env node
const home = process.argv[process.argv.indexOf("--home") + 1];
import(${JSON.stringify(edgeWorkerDist)}).then(
	(m) => console.log(JSON.stringify(m.preflightFactoryState(home))),
	(error) => { console.error(error); process.exit(1); },
);
`,
	);

	writeFileSync(
		join(home, "config.json"),
		'{"repositories":[],"linearToken":"first"}\n',
	);
	const seed = new WorkflowRuntime(home, hooks);
	const run = seed.create({
		id: "saved-run",
		triggerOrigin: {
			type: "manual",
			workflowId: "w",
			at: "2026-10-25T00:00:00.000Z",
		},
		workflow: { id: "w", name: "W", description: "", labels: [], steps: [] },
		workflowDefinitions: [],
		repositoryId: "repo",
		workspace: "/fixture",
		input: "fixture",
	});
	await seed.save(run);
	await seed.shutdown();

	// The worker on the other end of the port: whichever build the link points at.
	let server: Server | undefined;
	let runtime: WorkflowRuntime | undefined;
	let release: (() => void) | undefined;
	const workers = {
		kind: () =>
			JSON.parse(
				readFileSync(join(dirname(realpathSync(link)), "build.json"), "utf8"),
			).version === previous.version
				? ("previous" as const)
				: ("next" as const),
		async start() {
			const identity = JSON.parse(
				readFileSync(join(dirname(realpathSync(link)), "build.json"), "utf8"),
			);
			const kind = workers.kind();
			runtime = new WorkflowRuntime(home, hooks);
			// A booted worker has read its catalog, which creates factory/workflows.json.
			runtime.catalog.read();
			const drain = new UpdateDrain(
				home,
				runtime,
				capacity,
				() => false,
				() => {},
				() => ({ sessions: [] }),
			);
			// The installed build predates the echo and always computes its digest.
			if (kind === "previous")
				(drain as unknown as { echo: () => undefined }).echo = () => undefined;
			server = createServer(async (request, response) => {
				const send = (status: number, body: unknown) => {
					response.writeHead(status, { "content-type": "application/json" });
					response.end(JSON.stringify(body));
				};
				try {
					const chunks: Buffer[] = [];
					for await (const chunk of request) chunks.push(chunk as Buffer);
					const body = chunks.length
						? JSON.parse(Buffer.concat(chunks).toString("utf8"))
						: undefined;
					if (request.url === "/api/version")
						return send(200, {
							runtime: {
								version: identity.version,
								commit: identity.commit,
								target: identity.target,
							},
						});
					if (request.url === "/api/updates/maintenance") {
						await drain[body.action as "begin" | "end"](body.transactionId);
						return send(200, { maintenance: drain.active() });
					}
					if (request.url?.startsWith("/api/updates/drain")) {
						const receipt = await drain.inspect();
						// The installed build's own whole-state digest: it can never equal
						// the next build's, whatever either computes.
						return send(
							200,
							kind === "previous"
								? {
										...receipt,
										preservedStateSha256: sha(
											`previous-build:${receipt.preservedStateSha256}`,
										),
									}
								: receipt,
						);
					}
					send(404, { error: "not found" });
				} catch (error) {
					send(500, { error: (error as Error).message });
				}
			});
			servers.push(server);
			await new Promise<void>((resolve) =>
				server!.listen(port, "127.0.0.1", resolve),
			);
			release = await acquireInstanceLock(home, { markWorker: false });
		},
		async stop() {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
			server = undefined;
			await runtime?.shutdown();
			release?.();
			release = undefined;
		},
	};
	/** What happens on disk between the snapshot and the new worker starting. */
	const window = { duringWindow: () => {} };
	class SupervisorLifecycle extends OwnedUpdateLifecycle {
		async stopDesktopOwner() {
			await workers.stop();
		}
		async startOwned() {
			// Once: the rollback starts the previous worker the same way.
			const happen = window.duringWindow;
			window.duringWindow = () => {};
			happen();
			await workers.start();
		}
	}
	// The supervisor refuses to be built inside the worker it replaces, so it
	// exists before the first worker takes the home.
	const lifecycle = new SupervisorLifecycle(home, port);
	await workers.start();
	const source = {
		discover: async () => ({
			version: next.version,
			commit: next.commit,
			channel: "nightly" as const,
			target: next.target as "linux-x64",
			manifestSha256: "c".repeat(64),
			publishedAt: "2026-10-29T08:00:00.000Z",
		}),
		stage: async (found: unknown) => ({
			candidate: found,
			executable: candidate,
			previousExecutable: oldExecutable,
		}),
	};
	const manager = new V2UpdateManager(home, source, lifecycle, previous);
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	const pending = manager.status().pending!.candidate;
	manager.requestInstall(
		`nightly:${pending.version}:${pending.commit}:${pending.target}:${pending.manifestSha256}`,
		manager.status().revision,
	);
	await manager.stage();
	return {
		home,
		link,
		manager,
		workers,
		window,
		oldExecutable,
		candidate,
		run,
	};
}

it("a v2 supervisor completes the update into this build while config.json and a run recipe are rewritten during the window", async () => {
	const { home, link, manager, workers, window, candidate } = await machine();
	const config = join(home, "config.json");
	const recipe = join(home, "factory", "runs", "saved-run.json");
	let before = "";
	window.duringWindow = () => {
		before = readFileSync(config, "utf8") + readFileSync(recipe, "utf8");
		// A Linear OAuth refresh, and the same run re-serialized by another build.
		writeFileSync(
			config,
			'{"repositories":[],"linearToken":"refreshed","linearTokenExpiresAt":1}\n',
		);
		const stored = JSON.parse(readFileSync(recipe, "utf8"));
		writeFileSync(
			recipe,
			JSON.stringify({ ...stored, reserialized: true }, null, 4),
		);
	};

	await manager.reconcile();

	expect(before).not.toBe(
		readFileSync(config, "utf8") + readFileSync(recipe, "utf8"),
	);
	const status = manager.status();
	expect(status.transaction?.error).toBeUndefined();
	expect(status.transaction).toMatchObject({
		phase: "succeeded",
		release: { outcome: "succeeded", status: "acknowledged" },
	});
	expect(status.installed).toMatchObject({ version: next.version });
	expect(realpathSync(link)).toBe(realpathSync(candidate));
	expect(workers.kind()).toBe("next");
	// Maintenance and the supervisor's fence are gone; the new worker serves.
	expect(existsSync(join(home, "updates", "maintenance.json"))).toBe(false);
	expect(existsSync(join(home, "runtime", "update-owner.json"))).toBe(false);
	expect(existsSync(recipe)).toBe(true);
	// The current build reads the v2-written transaction as settled ...
	expect(new CurrentUpdateManager(home).status().transaction).toMatchObject({
		phase: "succeeded",
		release: { status: "acknowledged" },
	});
	// ... and removes the two copies the v2 flow just made, keeping the live runtime.
	expect(existsSync(join(home, "updates", "snapshots"))).toBe(true);
	const cleanup = await cleanupLegacyUpdates(home);
	expect(cleanup.status).toBe("done");
	expect(cleanup.retained).toEqual([]);
	expect(cleanup.removed.length).toBe(2);
	expect(existsSync(join(home, "updates", "snapshots"))).toBe(false);
	expect(existsSync(join(home, "updates", "preparation"))).toBe(false);
	expect(await new StorageRetentionStore(home).inventoryCount()).toBe(0);
	expect(existsSync(candidate)).toBe(true);
	await workers.stop();
}, 120_000);

it("a v2 supervisor rolls the update back when the new worker lost a run", async () => {
	const { home, link, manager, workers, window, oldExecutable } =
		await machine();
	const recipe = join(home, "factory", "runs", "saved-run.json");
	window.duringWindow = () => rmSync(recipe);

	await manager.reconcile().catch(() => undefined);

	const status = manager.status();
	expect(status.transaction?.phase).toBe("rolled-back");
	expect(status.transaction?.release?.status).toBe("acknowledged");
	expect(status.installed).toMatchObject({ version: previous.version });
	expect(realpathSync(link)).toBe(realpathSync(oldExecutable));
	expect(workers.kind()).toBe("previous");
	// The v2 rollback put the snapshot back, so the lost run is restored.
	expect(existsSync(recipe)).toBe(true);
	await workers.stop();
}, 120_000);
