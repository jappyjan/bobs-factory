import { type ChildProcess, fork } from "node:child_process";
import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateKey, UpdateManager } from "bobs-factory-edge-worker";
import { expect, it, vi } from "vitest";
import { ownerAlive, workerOwner } from "./InstanceLock.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";
import { runUpdateSupervisor } from "./UpdateSupervisor.js";

it.each([
	"missing",
	"invalid",
	"wrong-home",
	"wrong-start",
	"wrong-port",
])("makes queued Install visibly blocked with a live worker and %s ownership", async (record) => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "update-owner-")));
	const script = join(home, "worker.mjs");
	const installed = {
		product: "bobs-factory",
		version: "1.0.0",
		commit: "a".repeat(40),
		target: "darwin-arm64",
	};
	const prefix = join(home, "runtime", "desktop-installed");
	const previous = join(
		prefix,
		"lib",
		"bobs-factory",
		"bobs-factory-1.0.0-darwin-arm64",
		"bobs-factory",
	);
	const link = join(prefix, "bin", "bobs-factory");
	mkdirSync(dirname(previous), { recursive: true });
	mkdirSync(dirname(link), { recursive: true });
	copyFileSync(process.execPath, previous);
	symlinkSync(previous, link);
	writeFileSync(
		join(dirname(previous), "build.json"),
		JSON.stringify(installed),
	);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({ schema: 1, home, executable: link, initial: installed }),
	);
	const lockModule = fileURLToPath(
		new URL("./InstanceLock.ts", import.meta.url),
	);
	writeFileSync(
		script,
		`const {acquireInstanceLock}=await import(process.argv[2]);const release=await acquireInstanceLock(process.argv[3]);process.send('ready');process.on('message',()=>{release();process.exit(0);});`,
	);
	let worker: ChildProcess | undefined;
	const restart = vi.spyOn(
		OwnedUpdateLifecycle.prototype,
		"restartCrashedDesktop",
	);
	try {
		worker = fork(script, [lockModule, home], {
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			execPath: previous,
			env: {
				...process.env,
				BOBS_FACTORY_DESKTOP_OWNER: "1",
				BOBS_FACTORY_FACTORY_PORT: "3456",
			},
		});
		await new Promise<void>((resolve, reject) => {
			worker?.once("message", () => resolve());
			worker?.once("error", reject);
		});
		const original = workerOwner(home);
		expect(original && ownerAlive(original)).toBe(true);
		const candidate = {
			version: "1.1.0",
			commit: "b".repeat(40),
			channel: "stable" as const,
			target: "darwin-arm64" as const,
			manifestSha256: "c".repeat(64),
			publishedAt: new Date().toISOString(),
		};
		const manager = new UpdateManager(home, {
			discover: async () => candidate,
			stage: async () => ({
				candidate,
				executable: "/candidate",
				previousExecutable: "/previous",
			}),
		});
		await manager.check();
		await manager.stage();
		manager.requestInstall(candidateKey(candidate), manager.status().revision);
		const before = manager.status();
		const lock = join(home, "runtime", "worker.lock");
		const saved = readlinkSync(lock);
		unlinkSync(lock);
		if (record === "invalid") writeFileSync(lock, "not an atomic record");
		else if (record !== "missing") {
			const changed = JSON.parse(saved);
			if (record === "wrong-home") changed.home = `${home}/other`;
			if (record === "wrong-start") changed.processStamp = "different process";
			if (record === "wrong-port") changed.dashboardPort = 65534;
			symlinkSync(JSON.stringify(changed), lock);
		}
		// The supervisor itself is live, and retains its runtime-operation fence.
		const status = await runUpdateSupervisor(home, 3456, true);
		expect(status?.blocked?.code).toBe("worker-ownership");
		expect(status?.blocked?.reason).toBeTruthy();
		expect(status?.blocked?.remedy).toContain("Stop local Factory");
		expect(status?.pending).toEqual(before.pending);
		expect(status?.revision).toBe(before.revision);
		expect(status?.transaction).toBeUndefined();
		expect(new UpdateManager(home).status().blocked).toEqual(status?.blocked);
		expect(restart).not.toHaveBeenCalled();
		expect(original && ownerAlive(original)).toBe(true);
		if (record === "missing") expect(() => lstatSync(lock)).toThrow();
		// Return the fixture's own record so its normal shutdown can release it.
		rmSync(lock, { force: true });
		symlinkSync(saved, lock);
	} finally {
		restart.mockRestore();
		if (worker && worker.exitCode === null) {
			const done = new Promise((resolve) => worker?.once("exit", resolve));
			worker.kill("SIGKILL");
			await done;
		}
		rmSync(home, { recursive: true, force: true });
	}
}, 15000);
