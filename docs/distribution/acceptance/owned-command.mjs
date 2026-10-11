import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Every command gets a new session/group. Never signal the harness/host group.
// CLI execFileSync descendants inherit this group, including after leader exit.
export function startOwnedCommand(
	program,
	args,
	{ signal, timeout = 30000, env = process.env } = {},
) {
	const child = spawn(program, args, {
		detached: true,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let failure;
	let drained = false;
	const kill = () => {
		if (!child.pid || drained) return;
		assert(child.pid > 1 && child.pid !== process.pid);
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	};
	const abort = () => {
		failure = signal.reason;
		kill();
	};
	const timer = setTimeout(() => {
		failure = Error(`Command timed out: ${program}`);
		kill();
	}, timeout);
	child.stdout.on("data", (bytes) => {
		stdout += bytes;
		if (stdout.length > 4 * 1024 * 1024) {
			failure = Error("Owned command output limit exceeded");
			kill();
		}
	});
	child.stderr.on("data", (bytes) => {
		stderr += bytes;
		if (stderr.length > 4 * 1024 * 1024) {
			failure = Error("Owned command error output limit exceeded");
			kill();
		}
	});
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	const done = new Promise((resolve, reject) => {
		child.once("error", (error) => {
			failure = error;
		});
		// Kill asynchronous descendants even when they closed inherited pipes.
		child.once("exit", kill);
		child.once("close", async (code, receivedSignal) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			try {
				if (!child.pid) drained = true;
				const deadline = Date.now() + 2000;
				while (child.pid) {
					const members = execFileSync("ps", ["-eo", "pgid=,stat="], {
						encoding: "utf8",
						timeout: 1000,
					})
						.split("\n")
						.filter((line) => {
							const [group, state] = line.trim().split(/\s+/);
							return Number(group) === child.pid && !state?.startsWith("Z");
						});
					// Zombies cannot execute mutations; their reaping belongs to init.
					if (!members.length) {
						drained = true;
						break;
					}
					assert(
						Date.now() < deadline,
						"Owned command descendants did not drain",
					);
					await delay(20);
				}
				if (failure || code !== 0) {
					const error =
						failure ?? Error(`${program} exited ${code ?? receivedSignal}`);
					error.stdout = stdout;
					error.stderr = stderr;
					error.status = code ?? receivedSignal ?? 1;
					throw error;
				}
				resolve(stdout);
			} catch (error) {
				reject(error);
			}
		});
	});
	return {
		child,
		done,
		kill,
		get drained() {
			return drained;
		},
	};
}
