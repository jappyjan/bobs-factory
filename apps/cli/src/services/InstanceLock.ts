import { type ChildProcess, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readlinkSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
export interface WorkerOwner {
	schema: 1;
	pid: number;
	nonce: string;
	home: string;
	executable: string;
	owner: "foreground" | "desktop" | "service";
	startedAt: string;
	processStamp: string;
	dashboardPort: number;
}
export function canonicalHome(home: string) {
	mkdirSync(resolve(home), { recursive: true, mode: 0o700 });
	return realpathSync(home);
}
function readOwner(path: string, home: string): WorkerOwner | undefined {
	let text: string;
	try {
		text = readlinkSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new Error(
			"Worker ownership is not an atomic record; reconcile before launch",
			{ cause: error },
		);
	}
	const value = JSON.parse(text);
	if (
		value.schema !== 1 ||
		!Number.isInteger(value.pid) ||
		value.pid <= 0 ||
		typeof value.nonce !== "string" ||
		value.home !== home ||
		typeof value.processStamp !== "string"
	)
		throw new Error("Invalid worker ownership record");
	return value;
}
export function workerOwner(home: string) {
	home = canonicalHome(home);
	return readOwner(join(home, "runtime", "worker.lock"), home);
}
export function ownerAlive(owner: WorkerOwner) {
	try {
		return (
			execFileSync("/bin/ps", ["-p", String(owner.pid), "-o", "lstart="], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim() === owner.processStamp
		);
	} catch (error) {
		if ((error as { status?: number }).status === 1) return false;
		throw error;
	}
}
/** A mismatched start time is unverifiable ownership, not evidence of exit. */
export function ownerProcessExited(owner: WorkerOwner) {
	try {
		execFileSync("/bin/ps", ["-p", String(owner.pid), "-o", "lstart="], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		return false;
	} catch (error) {
		if ((error as { status?: number }).status === 1) return true;
		throw error;
	}
}
/** The process is alive (same start stamp), belongs to this home/port, and its OS
 * executable is the one it recorded. Says nothing about which runtime the link names. */
export function ownerProcessVerified(
	owner: WorkerOwner,
	home: string,
	port?: number,
) {
	if (
		owner.home !== canonicalHome(home) ||
		(port !== undefined && owner.dashboardPort !== port) ||
		!ownerAlive(owner)
	)
		return false;
	const command =
		process.platform === "linux"
			? `/proc/${owner.pid}/exe`
			: execFileSync("/bin/ps", ["-p", String(owner.pid), "-o", "comm="], {
					encoding: "utf8",
				}).trim();
	return realpathSync(command) === owner.executable && ownerAlive(owner);
}
/** Reuse the start-time and OS executable checks before trusting a live worker. */
export function workerIdentityMatches(
	owner: WorkerOwner,
	home: string,
	executable: string,
	port: number,
) {
	return (
		owner.executable === realpathSync(executable) &&
		ownerProcessVerified(owner, home, port)
	);
}
/** A runtime-level lock such as update-supervisor.lock. */
export function runtimeOperationOwner(home: string, name: string) {
	home = canonicalHome(home);
	return readOwner(join(home, "runtime", name), home);
}
/** Caller retains its own previously verified child's record and holds the lifecycle guard. */
export function reconcileChildWorkerOwner(
	home: string,
	child: ChildProcess,
	owner: WorkerOwner,
	executable: string,
	port: number,
) {
	if (
		workerOwner(home) ||
		child.pid !== owner.pid ||
		child.exitCode !== null ||
		child.signalCode !== null ||
		!workerIdentityMatches(owner, home, executable, port)
	)
		return false;
	// Exclusive publication cannot overwrite a newly acquired record.
	symlinkSync(JSON.stringify(owner), join(home, "runtime", "worker.lock"));
	return true;
}
/** Scan inside the process only: never log process environments or credentials. */
function descendants(nonce: string) {
	const stdout = execFileSync("/bin/ps", ["axeww", "-o", "pid=,command="], {
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const marker = `BOBS_FACTORY_WORKER_ID=${nonce}`;
	return stdout
		.split("\n")
		.filter((line) => line.split(/\s+/).includes(marker))
		.map((line) => Number(line.trim().split(/\s+/)[0]))
		.filter((pid) => pid !== process.pid);
}
async function drain(nonce: string) {
	for (let attempt = 0; attempt < 60; attempt++) {
		const pids = descendants(nonce);
		if (!pids.length) return;
		for (const pid of pids) {
			if (!descendants(nonce).includes(pid)) continue;
			try {
				process.kill(pid, attempt < 40 ? "SIGTERM" : "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		"Cannot verify orphan worker descendants stopped; replacement remains blocked",
	);
}
/** Atomic identity records and recursively recoverable fences prevent double takeover. */
export async function acquireInstanceLock(
	home: string,
	options: { name?: string; worker?: boolean; markWorker?: boolean } = {},
): Promise<() => void> {
	home = canonicalHome(home);
	const runtime = join(home, "runtime");
	mkdirSync(runtime, { recursive: true, mode: 0o700 });
	if (lstatSync(runtime).isSymbolicLink())
		throw new Error("Runtime directory must not be linked");
	const owner: WorkerOwner = {
		schema: 1,
		pid: process.pid,
		nonce: randomUUID(),
		home,
		executable: process.execPath,
		owner: process.env.BOBS_FACTORY_SERVICE_ID
			? "service"
			: process.env.BOBS_FACTORY_DESKTOP_OWNER
				? "desktop"
				: "foreground",
		startedAt: new Date().toISOString(),
		processStamp: execFileSync(
			"/bin/ps",
			["-p", String(process.pid), "-o", "lstart="],
			{ encoding: "utf8" },
		).trim(),
		dashboardPort: Number(process.env.BOBS_FACTORY_FACTORY_PORT ?? 3457),
	};
	const text = JSON.stringify(owner),
		lock = join(runtime, options.name ?? "worker.lock"),
		deadline = Date.now() + 15000;
	async function claim(path: string, primary: boolean): Promise<void> {
		while (true) {
			try {
				symlinkSync(text, path);
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			const previous = readOwner(path, home);
			if (!previous) continue;
			if (ownerAlive(previous)) {
				if (primary)
					throw new Error(
						`Factory home already owned by ${previous.owner} PID ${previous.pid}. Attach to the existing dashboard.`,
					);
			} else {
				const guard = `${path}.reclaim`;
				await claim(guard, false);
				try {
					if (readOwner(path, home)?.nonce === previous.nonce) {
						if (primary && options.worker !== false)
							await drain(previous.nonce);
						if (readOwner(path, home)?.nonce === previous.nonce)
							unlinkSync(path);
					}
				} finally {
					if (readOwner(guard, home)?.nonce === owner.nonce) unlinkSync(guard);
				}
			}
			if (Date.now() > deadline)
				throw new Error(
					"Worker ownership recovery timed out; no replacement started",
				);
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	await claim(lock, true);
	// Every worker subprocess inherits this marker, including detached/reparented helpers.
	// MachineCapacity independently reconciles execution lease markers before admission.
	if (options.worker !== false && options.markWorker !== false)
		process.env.BOBS_FACTORY_WORKER_ID = owner.nonce;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		process.removeListener("exit", release);
		if (readOwner(lock, home)?.nonce === owner.nonce) unlinkSync(lock);
	};
	process.once("exit", release);
	return release;
}

export const acquireRuntimeOperation = (home: string, name: string) =>
	acquireInstanceLock(home, { name, worker: false });
