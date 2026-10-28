import { type ChildProcess, fork } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UpdateManager } from "bobs-factory-edge-worker";
import { expect, it } from "vitest";
import { ownerAlive, workerOwner } from "./InstanceLock.js";
import { runUpdateSupervisor } from "./UpdateSupervisor.js";

/** A live worker runs build 1.0.0 while the runtime link already names 1.1.0
 * (a manual install moved the link). That is skew, not an ownership failure. */
async function skewedHome() {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "update-skew-")));
	const prefix = join(home, "runtime", "desktop-installed");
	const build = (version: string, commit: string) => {
		const executable = join(
			prefix,
			"lib",
			"bobs-factory",
			`bobs-factory-${version}-darwin-arm64`,
			"bobs-factory",
		);
		mkdirSync(dirname(executable), { recursive: true });
		copyFileSync(process.execPath, executable);
		writeFileSync(
			join(dirname(executable), "build.json"),
			JSON.stringify({
				product: "bobs-factory",
				version,
				commit,
				target: "darwin-arm64",
			}),
		);
		return executable;
	};
	const running = build("1.0.0", "a".repeat(40));
	const installedNow = build("1.1.0", "b".repeat(40));
	const link = join(prefix, "bin", "bobs-factory");
	mkdirSync(dirname(link), { recursive: true });
	symlinkSync(running, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({
			schema: 1,
			home,
			executable: link,
			initial: {
				product: "bobs-factory",
				version: "1.0.0",
				commit: "a".repeat(40),
				target: "darwin-arm64",
			},
		}),
	);
	const script = join(home, "worker.mjs");
	writeFileSync(
		script,
		`const {acquireInstanceLock}=await import(process.argv[2]);await acquireInstanceLock(process.argv[3]);process.send('ready');setInterval(()=>{},1000);`,
	);
	const worker: ChildProcess = fork(
		script,
		[fileURLToPath(new URL("./InstanceLock.ts", import.meta.url)), home],
		{
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			execPath: running,
			env: {
				...process.env,
				BOBS_FACTORY_DESKTOP_OWNER: "1",
				BOBS_FACTORY_FACTORY_PORT: "3456",
			},
		},
	);
	await new Promise<void>((resolve, reject) => {
		worker.once("message", () => resolve());
		worker.once("error", reject);
	});
	// Point the link at the newer build after the worker started, as an installer
	// would, with ownership re-bound to it.
	rmSync(link);
	symlinkSync(installedNow, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({
			schema: 1,
			home,
			executable: link,
			initial: {
				product: "bobs-factory",
				version: "1.1.0",
				commit: "b".repeat(40),
				target: "darwin-arm64",
			},
		}),
	);
	return { home, worker };
}

it("treats a live worker running another build than the runtime link as normal skew", async () => {
	const { home, worker } = await skewedHome();
	try {
		const owner = workerOwner(home);
		expect(owner && ownerAlive(owner)).toBe(true);

		const status = await runUpdateSupervisor(home, 3456, true);

		expect(status?.blocked).toBeUndefined();
		expect(new UpdateManager(home).status().blocked).toBeUndefined();
		expect(owner && ownerAlive(owner)).toBe(true);
	} finally {
		const done = new Promise((resolve) => worker.once("exit", resolve));
		worker.kill("SIGKILL");
		await done;
		rmSync(home, { recursive: true, force: true });
	}
}, 15000);
