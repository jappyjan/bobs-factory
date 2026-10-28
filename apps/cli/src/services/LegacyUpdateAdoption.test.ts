import { type ChildProcess, fork } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateManager } from "bobs-factory-edge-worker";
import { afterEach, expect, it, vi } from "vitest";
import { ownerAlive, runtimeOperationOwner } from "./InstanceLock.js";
import { retireOutdatedSupervisor } from "./LegacyUpdateAdoption.js";

// Forked workers import TypeScript; under a loaded machine that exceeds 5 s.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const lockModule = fileURLToPath(new URL("./InstanceLock.ts", import.meta.url));
const children: ChildProcess[] = [];
const homes: string[] = [];
afterEach(async () => {
	for (const child of children.splice(0))
		if (child.exitCode === null && child.signalCode === null) {
			const done = new Promise((resolve) => child.once("exit", resolve));
			child.kill("SIGKILL");
			await done;
		}
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

/** An "old" update supervisor: a live process (running its own copy of the
 * executable) holding runtime/update-supervisor.lock, as the v2 desktop shell starts it. */
async function oldSupervisor(env: Record<string, string> = {}) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "retire-supervisor-")));
	homes.push(home);
	const old = join(home, "old-build", "bobs-factory");
	mkdirSync(join(home, "old-build"));
	copyFileSync(process.execPath, old);
	const script = join(home, "supervisor.mjs");
	writeFileSync(
		script,
		`const {acquireRuntimeOperation}=await import(process.argv[2]);await acquireRuntimeOperation(process.argv[3],'update-supervisor.lock');process.send('ready');setInterval(()=>{},1000);`,
	);
	const child = fork(script, [lockModule, home], {
		stdio: ["ignore", "ignore", "ignore", "ipc"],
		execPath: old,
		env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1", ...env },
	});
	children.push(child);
	await new Promise<void>((resolve, reject) => {
		child.once("message", () => resolve());
		child.once("error", reject);
	});
	const owner = runtimeOperationOwner(home, "update-supervisor.lock");
	if (!owner) throw new Error("fixture supervisor holds no lock");
	const current = join(home, "new-build", "bobs-factory");
	mkdirSync(join(home, "new-build"));
	copyFileSync(process.execPath, current);
	return { home, child, owner, current };
}
const settleWithUnresolvedTransaction = async (home: string) => {
	const installed = {
		version: "1.0.0",
		commit: "a".repeat(40),
		target: "darwin-arm64",
	};
	const candidate = {
		version: "1.1.0",
		commit: "b".repeat(40),
		channel: "stable" as const,
		target: "darwin-arm64" as const,
		manifestSha256: "c".repeat(64),
		publishedAt: new Date().toISOString(),
	};
	const manager = new UpdateManager(
		home,
		{
			discover: async () => candidate,
			stage: async () => ({
				candidate,
				executable: "/candidate",
				previousExecutable: "/previous",
			}),
		},
		{
			acquireMaintenance: async () => {},
			isIdle: async () => true,
			preflight: async () => ({ stateCompatible: true as const }),
			snapshot: async () => "/snapshot",
			stop: async () => {},
			activate: async () => {},
			start: async () => {},
			health: async () => {
				throw new Error("stop here");
			},
			rollback: async () => {
				throw new Error("rollback fails");
			},
			releaseMaintenance: async () => {},
		},
		installed,
	);
	manager.configure({ policy: "idle-auto" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	// Rollback failed: the transaction stays unresolved (recovery-required).
	expect(manager.status().transaction?.phase).toBe("recovery-required");
};

it("retires a verified outdated desktop supervisor and starts its replacement", async () => {
	const { home, child, owner, current } = await oldSupervisor();
	const kill = vi.fn((pid: number, signal: NodeJS.Signals) =>
		process.kill(pid, signal),
	);
	const spawnSupervisor = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: current,
		kill,
		spawnSupervisor,
	});

	expect(result).toBe("retired");
	expect(kill).toHaveBeenCalledExactlyOnceWith(owner.pid, "SIGTERM");
	expect(ownerAlive(owner)).toBe(false);
	expect(child.signalCode ?? child.exitCode).not.toBeNull();
	expect(spawnSupervisor).toHaveBeenCalledExactlyOnceWith(home, 3456);
});

it("never signals a PID whose process start stamp differs from the lock", async () => {
	const { home, child, owner, current } = await oldSupervisor();
	const lock = join(home, "runtime", "update-supervisor.lock");
	unlinkSync(lock);
	symlinkSync(
		JSON.stringify({ ...owner, processStamp: "Thu Jan  1 00:00:00 1970" }),
		lock,
	);
	const kill = vi.fn();
	const spawnSupervisor = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: current,
		kill,
		spawnSupervisor,
	});

	expect(result).toBe("unverified");
	expect(kill).not.toHaveBeenCalled();
	expect(spawnSupervisor).not.toHaveBeenCalled();
	expect(child.exitCode).toBeNull();
	expect(child.signalCode).toBeNull();
});

it("never signals a process that is not the executable the lock names", async () => {
	const { home, child, owner, current } = await oldSupervisor();
	const lock = join(home, "runtime", "update-supervisor.lock");
	unlinkSync(lock);
	symlinkSync(JSON.stringify({ ...owner, executable: current }), lock);
	const kill = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: join(home, "elsewhere"),
		kill,
		spawnSupervisor: vi.fn(),
	});

	expect(result).toBe("unverified");
	expect(kill).not.toHaveBeenCalled();
	expect(child.exitCode).toBeNull();
});

it("leaves a supervisor already running the current build alone", async () => {
	const { home, owner } = await oldSupervisor();
	const kill = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: owner.executable,
		kill,
		spawnSupervisor: vi.fn(),
	});

	expect(result).toBe("current");
	expect(kill).not.toHaveBeenCalled();
});

it("leaves service-managed supervisors alone: a clean exit would not be restarted", async () => {
	const { home, current } = await oldSupervisor({
		BOBS_FACTORY_SERVICE_ID: "com.example.factory",
		BOBS_FACTORY_DESKTOP_OWNER: "",
	});
	const kill = vi.fn();
	const spawnSupervisor = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: current,
		kill,
		spawnSupervisor,
	});

	expect(result).toBe("externally-managed");
	expect(kill).not.toHaveBeenCalled();
	expect(spawnSupervisor).not.toHaveBeenCalled();
});

it("waits for an unresolved update to finish before retiring anything", async () => {
	const { home, current } = await oldSupervisor();
	await settleWithUnresolvedTransaction(home);
	const kill = vi.fn();

	const result = await retireOutdatedSupervisor(home, {
		port: 3456,
		executable: current,
		kill,
		spawnSupervisor: vi.fn(),
	});

	expect(result).toBe("update-in-progress");
	expect(kill).not.toHaveBeenCalled();
});

it("does nothing when no supervisor is recorded", async () => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "retire-none-")));
	homes.push(home);
	mkdirSync(join(home, "runtime"));
	expect(
		await retireOutdatedSupervisor(home, { port: 3456, kill: vi.fn() }),
	).toBe("no-supervisor");
});
