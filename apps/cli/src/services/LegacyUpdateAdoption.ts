import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { cleanupLegacyUpdates, UpdateManager } from "bobs-factory-edge-worker";
import {
	ownerAlive,
	ownerProcessVerified,
	runtimeOperationOwner,
	type WorkerOwner,
} from "./InstanceLock.js";

export type SupervisorRetirement =
	| "no-supervisor"
	| "current"
	| "update-in-progress"
	| "unverified"
	| "externally-managed"
	| "still-running"
	| "retired";

interface Retirement {
	port: number;
	/** The runtime that is starting this worker; supervisors running other bytes are outdated. */
	executable?: string;
	kill?: (pid: number, signal: NodeJS.Signals) => void;
	/** Starts the replacement supervisor from the runtime link. */
	spawnSupervisor?: (home: string, port: number) => void;
	waitMs?: number;
}

const resolved = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
};
const verified = (owner: WorkerOwner, home: string) => {
	try {
		return ownerProcessVerified(owner, home);
	} catch {
		return false;
	}
};
const settled = (
	transaction: ReturnType<UpdateManager["status"]>["transaction"],
) =>
	!transaction ||
	(["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
		transaction.release?.status === "acknowledged");

/** Detached, from the runtime link, with the worker marker removed: a supervisor
 * that inherited BOBS_FACTORY_WORKER_ID would be reaped as a worker descendant. */
function spawnDesktopSupervisor(home: string, port: number) {
	const link = join(
		home,
		"runtime",
		"desktop-installed",
		"bin",
		"bobs-factory",
	);
	const log = openSync(
		join(home, "runtime", "desktop-updates.log"),
		"a",
		0o600,
	);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		BOBS_FACTORY_DESKTOP_OWNER: "1",
	};
	delete env.BOBS_FACTORY_WORKER_ID;
	try {
		const child = spawn(
			existsSync(link) ? link : process.execPath,
			[
				"--home",
				home,
				"--port",
				String(port),
				"--no-open",
				"service",
				"updates-run",
			],
			{ detached: true, cwd: home, stdio: ["ignore", log, log], env },
		);
		child.unref();
	} finally {
		closeSync(log);
	}
}

/** A supervisor started by an older desktop build keeps running its own old code
 * after the runtime link moved on (the v2 updater replaces the worker, not itself).
 * Once its last transaction is acknowledged, replace it so updates run with the
 * installed build's logic.
 *
 * The desktop shell starts the supervisor once per launch and never respawns it,
 * and launchd/systemd do not restart a clean exit (KeepAlive SuccessfulExit=false,
 * Restart=on-failure), so SIGTERM alone would leave no supervisor. Desktop-owned
 * supervisors are therefore replaced here; service and foreground ones are left
 * alone, which stays correct because supervisor/worker skew is tolerated.
 * Only a process whose PID, start stamp, home and executable all match the lock
 * is ever signalled.
 */
export async function retireOutdatedSupervisor(
	home: string,
	options: Retirement,
): Promise<SupervisorRetirement> {
	const owner = runtimeOperationOwner(home, "update-supervisor.lock");
	if (!owner) return "no-supervisor";
	const own = resolved(options.executable ?? process.execPath);
	if (owner.pid === process.pid || resolved(owner.executable) === own)
		return "current";
	const state = new UpdateManager(home).status();
	if (!settled(state.transaction) || state.recovery)
		return "update-in-progress";
	if (!verified(owner, home)) return "unverified";
	if (owner.owner !== "desktop") return "externally-managed";
	(options.kill ?? process.kill)(owner.pid, "SIGTERM");
	// SIGTERM is delivered; a supervisor mid-tick (e.g. a staged download) exits
	// only after that tick, so wait long enough that a replacement always follows.
	const deadline = Date.now() + (options.waitMs ?? 10 * 60_000);
	while (ownerAlive(owner)) {
		if (Date.now() >= deadline) return "still-running";
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	(options.spawnSupervisor ?? spawnDesktopSupervisor)(home, options.port);
	return "retired";
}

/** Retries while the v2 supervisor that started this worker is still finishing the
 * transaction (health, then acknowledging maintenance release). */
export function scheduleSupervisorRetirement(home: string, port: number) {
	let attempts = 0;
	const attempt = async () => {
		try {
			const result = await retireOutdatedSupervisor(home, { port });
			if (result === "update-in-progress" && ++attempts < 120) {
				setTimeout(attempt, 5_000).unref();
			} else if (result === "retired")
				console.log("Replaced an outdated update supervisor.");
		} catch (error) {
			console.warn(
				`Outdated update supervisor left running: ${(error as Error).message}`,
			);
		}
	};
	setTimeout(attempt, 1_000).unref();
}

/** Removes the copies and records the copy-based updater left behind. While a
 * v2 supervisor's update is still unresolved nothing is touched, so retry until
 * its transaction is acknowledged. A crash resumes on the next start. */
export function scheduleLegacyCleanup(home: string) {
	let attempts = 0;
	const attempt = async () => {
		try {
			const result = await cleanupLegacyUpdates(home);
			if (result.status === "deferred" && ++attempts < 240)
				setTimeout(attempt, 30_000).unref();
			else if (result.removed.length || result.droppedRecords)
				console.log(
					`Removed ${result.removed.length} leftover update copies and ${result.droppedRecords} retention records.`,
				);
		} catch (error) {
			console.warn(
				`Leftover update copies remain: ${(error as Error).message}`,
			);
		}
	};
	setTimeout(attempt, 2_000).unref();
}
