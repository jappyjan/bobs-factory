import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "bobs-factory-edge-worker";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryClient } from "../tui/client.js";
import { workerOwner } from "./InstanceLock.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";
import { runUpdateSupervisor } from "./UpdateSupervisor.js";

const installed = {
	product: "bobs-factory" as const,
	version: "1.0.0",
	commit: "a".repeat(40),
	target: "darwin-arm64",
};
const candidate: UpdateCandidate = {
	version: "1.1.0-nightly.20261010.100",
	commit: "b".repeat(40),
	channel: "nightly",
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};
class Crash extends Error {}

const homes: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

async function freePort() {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
	const port = (server.address() as { port: number }).port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

/** A desktop-owned home whose update was driven up to `crashAfter` and whose
 * supervisor then died. No worker runs and `worker.lock` is absent. */
async function interruptedHome(crashAfter: string, port: number) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "update-recover-")));
	homes.push(home);
	const prefix = join(home, "runtime", "desktop-installed");
	const build = (identity: typeof installed) => {
		const executable = join(
			prefix,
			"lib",
			"bobs-factory",
			`bobs-factory-${identity.version}-darwin-arm64`,
			"bobs-factory",
		);
		mkdirSync(dirname(executable), { recursive: true });
		copyFileSync(process.execPath, executable);
		writeFileSync(
			join(dirname(executable), "build.json"),
			JSON.stringify(identity),
		);
		return realpathSync(executable);
	};
	const oldExe = build(installed);
	const newExe = build({
		product: "bobs-factory",
		version: candidate.version,
		commit: candidate.commit,
		target: "darwin-arm64",
	});
	const link = join(prefix, "bin", "bobs-factory");
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(oldExe, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({ schema: 1, home, executable: link, initial: installed }),
	);
	const fence = join(home, "runtime", "update-owner.json");
	let transactionId = "";
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: async (id) => {
			transactionId = id;
		},
		isIdle: async () => {
			writeFileSync(fence, JSON.stringify({ transactionId, drained: true }));
			return { idle: true, baseline: { runIds: [], workflowIds: [] } };
		},
		prepare: async (_staged, _installed, id) => {
			transactionId = id;
			const next = `${link}.next-${id}`;
			const prev = `${link}.prev-${id}`;
			symlinkSync(newExe, next);
			symlinkSync(oldExe, prev);
			return { links: { next, prev }, migration: null };
		},
		stop: async () => {},
		activate: async () => {
			renameSync(`${link}.next-${transactionId}`, link);
		},
		start: async () => {},
		health: async () => {},
		rollback: async () => {},
		releaseMaintenance: async () => {},
	};
	const source: UpdateSource = {
		discover: async () => candidate,
		stage: async (current) => ({
			candidate: current,
			executable: newExe,
			previousExecutable: oldExe,
		}),
	};
	const manager = new UpdateManager(home, source, lifecycle, installed, {
		afterStep: (step) => {
			if (step === crashAfter) throw new Crash(`crash after ${step}`);
		},
	});
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await expect(manager.reconcile()).rejects.toThrow(Crash);
	expect(new UpdateManager(home).status().transaction).toBeDefined();
	expect(workerOwner(home)).toBeUndefined();
	return { home, link, oldExe, newExe, port };
}

/** What the old worker's restart and health would do, without a real binary. */
function fakeWorkerStart() {
	const started: string[] = [];
	vi.spyOn(
		OwnedUpdateLifecycle.prototype as never,
		"start" as never,
	).mockImplementation(async function (this: OwnedUpdateLifecycle) {
		started.push(realpathSync(this.runtimeLink));
	} as never);
	vi.spyOn(
		OwnedUpdateLifecycle.prototype as never,
		"health" as never,
	).mockResolvedValue(undefined as never);
	vi.spyOn(FactoryClient.prototype, "post").mockResolvedValue(
		undefined as never,
	);
	return started;
}

const journals = (home: string) => {
	try {
		return readdirSync(join(home, "updates", "journal")).filter(
			(name) => name !== "attempts.json",
		);
	} catch {
		return [];
	}
};

it.each([
	["stopped", "cancelled", false],
	["switched", "rolled-back", false],
	["started", "rolled-back", false],
	["stopped", "cancelled", true],
	["switched", "rolled-back", true],
	["started", "rolled-back", true],
])(
	"a restarted supervisor recovers an update killed after %s ends %s (stale worker.lock: %s)",
	async (step, phase, staleLock) => {
		const port = await freePort();
		const w = await interruptedHome(step, port);
		if (staleLock) {
			// The candidate's worker was up for a moment and died with the supervisor.
			const dead = spawnSync(process.execPath, ["-e", ""]).pid as number;
			symlinkSync(
				JSON.stringify({
					schema: 1,
					pid: dead,
					nonce: "dead-worker",
					home: w.home,
					executable: realpathSync(w.link),
					owner: "desktop",
					startedAt: new Date().toISOString(),
					processStamp: "Thu Jan  1 00:00:00 1970",
					dashboardPort: port,
				}),
				join(w.home, "runtime", "worker.lock"),
			);
			expect(existsSync(join(w.home, "runtime", "update-owner.json"))).toBe(
				true,
			);
		}
		const started = fakeWorkerStart();

		const status = await runUpdateSupervisor(w.home, port, true);

		expect(status?.blocked).toBeUndefined();
		expect(status?.transaction).toMatchObject({
			phase,
			release: { status: "acknowledged" },
		});
		expect(status?.installed.version).toBe(installed.version);
		// The old runtime is the runnable one and was the one started.
		expect(realpathSync(w.link)).toBe(w.oldExe);
		expect(started.length).toBeGreaterThan(0);
		expect(new Set(started)).toEqual(new Set([w.oldExe]));
		expect(journals(w.home)).toEqual([]);
		expect(existsSync(join(w.home, "runtime", "update-owner.json"))).toBe(
			false,
		);
		expect(
			readdirSync(dirname(w.link)).filter((name) =>
				/\.(next|prev)-/.test(name),
			),
		).toEqual([]);
		expect(lstatSync(w.link).isSymbolicLink()).toBe(true);
	},
	30000,
);

it("still blocks when an unverifiable live PID owns worker.lock", async () => {
	const port = await freePort();
	const w = await interruptedHome("stopped", port);
	symlinkSync(
		JSON.stringify({
			schema: 1,
			pid: process.pid,
			nonce: "foreign",
			home: w.home,
			executable: realpathSync(w.link),
			owner: "desktop",
			startedAt: new Date().toISOString(),
			processStamp: "a different process start",
			dashboardPort: port,
		}),
		join(w.home, "runtime", "worker.lock"),
	);
	const started = fakeWorkerStart();
	const before = new UpdateManager(w.home).status().transaction;

	const status = await runUpdateSupervisor(w.home, port, true);

	expect(status?.blocked?.code).toBe("worker-ownership");
	expect(status?.transaction).toEqual(before);
	expect(started).toEqual([]);
	expect(journals(w.home)).toHaveLength(1);
}, 30000);

it("still blocks when no worker.lock exists but something answers on the port", async () => {
	const port = await freePort();
	const w = await interruptedHome("stopped", port);
	const started = fakeWorkerStart();
	const foreign = createServer();
	await new Promise<void>((resolve) =>
		foreign.listen(port, "localhost", resolve),
	);
	try {
		const status = await runUpdateSupervisor(w.home, port, true);
		expect(status?.blocked?.code).toBe("worker-ownership");
		expect(started).toEqual([]);
		expect(journals(w.home)).toHaveLength(1);
	} finally {
		await new Promise((resolve) => foreign.close(resolve));
	}
}, 30000);
