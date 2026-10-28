import { existsSync, readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { PublishedUpdateSource, UpdateManager } from "bobs-factory-edge-worker";
import {
	acquireRuntimeOperation,
	ownerAlive,
	ownerProcessExited,
	ownerProcessVerified,
	workerIdentityMatches,
	workerOwner,
} from "./InstanceLock.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";

const portInUse = (port: number) =>
	new Promise<boolean>((resolve) => {
		const socket = connect({ host: "localhost", port });
		socket.setTimeout(1000);
		socket.once("connect", () => resolve(true));
		socket.once("timeout", () => resolve(true));
		socket.once("error", () => resolve(false));
		socket.once("close", () => socket.destroy());
	});
const settled = (
	transaction: ReturnType<UpdateManager["status"]>["transaction"],
) =>
	!transaction ||
	(["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
		transaction.release?.status === "acknowledged");
export async function runUpdateSupervisor(
	home: string,
	port: number,
	once = false,
) {
	const release = await acquireRuntimeOperation(home, "update-supervisor.lock");
	let stopping = false;
	const drainAbort = new AbortController();
	const onStop = () => {
		stopping = true;
		drainAbort.abort();
	};
	process.once("SIGTERM", onStop);
	process.once("SIGINT", onStop);
	let lifecycle: OwnedUpdateLifecycle | undefined;
	let lastStatus: ReturnType<UpdateManager["status"]> | undefined;
	let crashRestarts = 0;
	try {
		do {
			let manager = new UpdateManager(home);
			const service = new ServiceLifecycle(home).record();
			if (service && service.desired === "stopped") break;
			if (existsSync(join(home, "runtime", "desktop-stopped.json"))) break;
			try {
				let owner = workerOwner(home);
				if (!owner && (await lifecycle?.reconcileChildOwnership()))
					owner = workerOwner(home);
				// A supervisor that died after the old worker stopped and before the
				// candidate held worker.lock leaves an open transaction and no live
				// owner. That is the journal's job, not an ownership failure. A live
				// PID that cannot be verified, or something answering on the port,
				// still blocks.
				const interrupted = manager.status();
				if (
					!settled(interrupted.transaction) &&
					!interrupted.recovery &&
					(owner
						? !ownerAlive(owner) && ownerProcessExited(owner)
						: !(await portInUse(port)))
				) {
					lifecycle ??= new OwnedUpdateLifecycle(home, port, drainAbort.signal);
					manager.reportWorkerOwnership();
					manager = new UpdateManager(home, undefined, lifecycle);
					try {
						await manager.recover("operation owner stopped");
					} catch (error) {
						console.error(`Update supervisor: ${(error as Error).message}`);
					}
				} else {
					if (!owner)
						throw new Error(
							"Worker ownership record is missing; the worker may still be running.",
						);
					lifecycle ??= new OwnedUpdateLifecycle(home, port, drainAbort.signal);
					const executable = lifecycle.runtimeLink;
					if (!ownerAlive(owner)) {
						if (!ownerProcessExited(owner))
							throw new Error(
								"Worker process start time cannot be verified; the PID is still live.",
							);
						manager.reportWorkerOwnership(
							"Recorded worker is no longer live; waiting for verified owner recovery.",
						);
						if (existsSync(join(home, "runtime", "update-owner.json"))) {
							throw new Error(
								"Interrupted update worker ownership cannot be verified; recovery remains blocked.",
							);
						} else if (!service && crashRestarts < 3) {
							crashRestarts++;
							await lifecycle.restartCrashedDesktop();
						}
					} else if (!workerIdentityMatches(owner, home, executable, port)) {
						// A verified process of this home runs another build than the runtime
						// link names (a manual install moved the link, or this supervisor is
						// older/newer than the worker). That is normal skew, not an ownership
						// failure: leave the worker alone until it restarts onto the link.
						// Mid-transaction it stays an error.
						if (
							!settled(manager.status().transaction) ||
							!ownerProcessVerified(owner, home, port)
						)
							throw new Error(
								"Worker PID, process start time, executable, home or port cannot be verified.",
							);
						manager.reportWorkerOwnership();
					} else {
						const identity = JSON.parse(
							readFileSync(
								join(dirname(realpathSync(executable)), "build.json"),
								"utf8",
							),
						);
						const source = new PublishedUpdateSource(
							join(home, "updates"),
							realpathSync(executable),
							identity.target,
						);
						manager = new UpdateManager(home, source, lifecycle, identity);
						manager.reportWorkerOwnership();
						const { transaction, recovery } = manager.status();
						try {
							// A deliberate installation that differs from the unresolved
							// transaction is not rolled back; the operator resolves it with
							// `update recover --adopt-installed`.
							if (!recovery) {
								if (settled(transaction)) await manager.tick();
								else await manager.recover("operation owner stopped");
							}
						} catch (error) {
							console.error(`Update supervisor: ${(error as Error).message}`);
						}
					}
				}
			} catch (error) {
				// Recording the problem needs a write too; on a full disk that must
				// not end the loop that is waiting for space to come back.
				try {
					manager.reportWorkerOwnership((error as Error).message);
				} catch (reportError) {
					console.error(`Update supervisor: ${(reportError as Error).message}`);
				}
			}
			try {
				lastStatus = manager.status();
			} catch (error) {
				console.error(`Update supervisor: ${(error as Error).message}`);
			}
			if (!once && !stopping)
				for (let n = 0; n < 100 && !stopping; n++)
					await new Promise((resolve) => setTimeout(resolve, 100));
		} while (!once && !stopping);
		return lastStatus;
	} finally {
		process.removeListener("SIGTERM", onStop);
		process.removeListener("SIGINT", onStop);
		try {
			release();
		} catch (error) {
			console.error(`Update supervisor: ${(error as Error).message}`);
		}
	}
}
