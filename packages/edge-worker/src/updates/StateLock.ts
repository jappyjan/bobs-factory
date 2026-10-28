import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	linkSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";

/** `ps` start time; undefined when the process is gone. Anything else (no `ps`,
 * permissions) is an error: it does not prove an owner exited. */
function processStartSync(pid: number): string | undefined {
	try {
		return (
			execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			}).trim() || undefined
		);
	} catch (error) {
		if ((error as { status?: unknown }).status === 1) return undefined;
		throw error;
	}
}
let ownStart: string | undefined;
const ownProcessStart = () => {
	ownStart ??= processStartSync(process.pid);
	if (!ownStart) throw new Error("Cannot establish update process identity");
	return ownStart;
};

/** A holder is stale only when its process is provably gone or reused. A legacy
 * PID-only lock (older supervisors) is stale only when that PID is not running. */
function staleHolder(text: string): boolean {
	let record: { pid?: unknown; start?: unknown } | number;
	try {
		record = JSON.parse(text);
	} catch {
		return false;
	}
	if (typeof record === "number") {
		try {
			process.kill(record, 0);
			return false;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	}
	if (
		!record ||
		typeof record.pid !== "number" ||
		typeof record.start !== "string"
	)
		return false;
	const live = processStartSync(record.pid);
	return live === undefined || live !== record.start;
}

export class StateLockBusyError extends Error {}

/** Exclusive `state.lock` guarding short `state.json` rewrites. The file holds
 * `{pid, start}` so a SIGKILL inside a write no longer wedges every later write:
 * the next writer takes over a lock whose owner is gone. The lock appears
 * atomically with its content (link of a finished temporary file). */
export function acquireStateLock(file: string): () => void {
	const owner = JSON.stringify({ pid: process.pid, start: ownProcessStart() });
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, owner, { mode: 0o600, flag: "wx" });
	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				linkSync(temporary, file);
				return () => {
					try {
						if (readFileSync(file, "utf8") === owner) rmSync(file);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					}
				};
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (!staleHolder(text)) break;
			// Rename is the claim: only one taker wins the stale file. If what we
			// moved is not what we judged stale, a live writer slipped in; put it back.
			const grave = `${file}.stale-${randomUUID()}`;
			try {
				renameSync(file, grave);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (readFileSync(grave, "utf8") !== text) {
				try {
					linkSync(grave, file);
				} catch {}
				rmSync(grave, { force: true });
				break;
			}
			rmSync(grave, { force: true });
		}
	} finally {
		rmSync(temporary, { force: true });
	}
	throw new StateLockBusyError(
		"Update settings are being saved; retry. Inspect a retained state.lock after interruption.",
	);
}
