import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
	killRegisteredGroup,
	registerGroup,
	registryVariable,
	waitForGroupDrain,
} from "./owned-registry.mjs";

export function startOwnedCommand(
	program,
	args,
	{
		signal,
		timeout = 30000,
		env = process.env,
		registry = process.env[registryVariable],
		cooperative = false,
		cleanupGrace = 30000,
		onTimeout = () => {},
		onEscalate = () => {},
	} = {},
) {
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./owned-command-child.mjs", import.meta.url)),
			program,
			...args,
		],
		{ detached: true, env, stdio: ["pipe", "pipe", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	let failure;
	let result;
	let identity;
	let drained = false;
	let killing = false;
	let escalation;
	let graceTimer;
	let closeTimer;
	let settled = false;
	const kill = () => {
		if (!identity || drained || killing) return;
		killing = true;
		try {
			killRegisteredGroup(identity);
		} catch (error) {
			failure ??= error;
			failure.cleanupError = error.message;
		}
	};
	const terminate = (error) => {
		if (failure) return;
		failure = error;
		if (!cooperative) return kill();
		try {
			onTimeout(error);
		} catch (persistError) {
			failure.cleanupError = persistError.message;
		}
		// Signal the fixture only; the held leader and inner groups remain registered.
		child.stdin.write("terminate\n");
		graceTimer = setTimeout(() => {
			escalation = Promise.resolve()
				.then(() => onEscalate(failure))
				.catch((cleanupError) => {
					failure.cleanupError = cleanupError.message;
				})
				.finally(kill);
		}, cleanupGrace);
	};
	const abort = () => terminate(signal.reason);
	let timer;
	const armTimeout = (milliseconds) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const error = Error(`Command timed out: ${program}`);
			error.timedOut = true;
			terminate(error);
		}, milliseconds);
	};
	armTimeout(timeout);
	const capture = (stream, append) =>
		stream.on("data", (bytes) => {
			if (append(bytes) > 4 * 1024 * 1024)
				terminate(Error("Owned command output limit exceeded"));
		});
	capture(child.stdout, (bytes) => {
		stdout += bytes;
		return stdout.length;
	});
	capture(child.stderr, (bytes) => {
		stderr += bytes;
		return stderr.length;
	});
	createInterface({ input: child.stdio[3] }).on("line", (line) => {
		try {
			result = JSON.parse(line);
			if (result.error) failure ??= Error(result.error);
			kill();
		} catch (error) {
			terminate(error);
		}
	});
	child.once("spawn", () => {
		try {
			identity = registerGroup(registry, child.pid);
			if (failure) {
				kill();
				return;
			}
			child.stdin.write("start\n");
			if (signal?.aborted) abort();
		} catch (error) {
			failure = error;
			// No target code ran. This is still our live direct child, not a reused PID.
			child.kill("SIGKILL");
		}
	});
	child.stdin.on("error", (error) => {
		if (error.code !== "EPIPE") terminate(error);
	});
	signal?.addEventListener("abort", abort, { once: true });
	const done = new Promise((resolve, reject) => {
		child.once("error", (error) => {
			failure = error;
		});
		const finish = async () => {
			if (settled) return;
			settled = true;
			clearTimeout(closeTimer);
			clearTimeout(timer);
			clearTimeout(graceTimer);
			signal?.removeEventListener("abort", abort);
			try {
				await escalation;
				if (child.pid) await waitForGroupDrain(child.pid);
				drained = true;
				if (failure || result?.code !== 0)
					throw (
						failure ??
						Error(
							`${program} exited ${result?.code ?? result?.signal ?? "without a result"}`,
						)
					);
				resolve(stdout);
			} catch (cleanupError) {
				const error = failure ?? cleanupError;
				if (failure && cleanupError !== failure)
					error.cleanupError = cleanupError.message;
				error.stdout = stdout;
				error.stderr = stderr;
				error.status = result?.code ?? result?.signal ?? 1;
				reject(error);
			} finally {
				child.stdout.destroy();
				child.stderr.destroy();
				child.stdio[3].destroy();
				child.stdin.destroy();
			}
		};
		child.once("close", finish);
		// An unexpectedly lost leader may leave inherited pipes open. Do not let
		// those pipes bypass the command deadline or mistake unknown groups for clean.
		child.once("exit", () => {
			closeTimer = setTimeout(finish, 2000);
		});
	});
	return {
		child,
		done,
		kill,
		armTimeout,
		signal: (value) => child.stdin.write(`signal:${value}\n`),
		get drained() {
			return drained;
		},
	};
}
