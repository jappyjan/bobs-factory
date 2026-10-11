import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { processStamp, read } from "../src/app-lifecycle.mjs";
import { appFingerprint } from "../src/app-source.mjs";

async function fixture(mode) {
	const root = mkdtempSync(join(tmpdir(), "retained-app-helper-"));
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./helper-ui-fixture.mjs", import.meta.url)),
			root,
			mode,
		],
		{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	let output = "";
	child.stdout.on("data", (bytes) => (output += bytes));
	child.stderr.on("data", (bytes) => (output += bytes));
	const exit = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	const data = await Promise.race([
		new Promise((resolve) => child.once("message", resolve)),
		exit.then((code) => {
			throw Error(`Fixture exited ${code}: ${output}`);
		}),
	]);
	return {
		root,
		child,
		exit,
		data,
		output: () => output,
		async cleanup() {
			if (child.exitCode === null) child.kill("SIGTERM");
			await exit;
			const file = join(data.home, "desktop", "updates", "state.json");
			if (existsSync(file)) {
				const transaction = read(file).transaction;
				if (transaction?.snapshot && existsSync(transaction.snapshot)) {
					const owned = read(transaction.snapshot).child;
					if (owned?.stamp && processStamp(owned.pid) === owned.stamp) {
						process.kill(owned.pid, "SIGTERM");
						const deadline = Date.now() + 3000;
						while (
							processStamp(owned.pid) === owned.stamp &&
							Date.now() < deadline
						)
							await new Promise((resolve) => setTimeout(resolve, 50));
						assert.notEqual(
							processStamp(owned.pid),
							owned.stamp,
							"Fixture candidate must stop before deleting its state",
						);
					}
				}
			}
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test("retained standalone helper resolves its full module closure and runs recovery without repository modules", async () => {
	const f = await fixture("imports");
	try {
		const directory = join(f.data.home, "desktop", "updates");
		const result = spawnSync(
			process.execPath,
			[
				join(directory, "helper", "app-helper.mjs"),
				join(directory, "helper-request.json"),
				"recover",
			],
			{ encoding: "utf8", timeout: 5000 },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			existsSync(join(directory, "helper", "app-quarantine.mjs")),
			true,
		);
	} finally {
		await f.cleanup();
	}
});

test("actual Install action's retained helper exits exact UI, activates bytes and validates launched candidate health", async () => {
	const f = await fixture("install");
	try {
		assert.equal(await f.exit, 0, f.output());
		const directory = join(f.data.home, "desktop", "updates"),
			stateFile = join(directory, "state.json");
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const current = read(stateFile).transaction;
			if (
				current?.phase === "succeeded" &&
				current.release?.status === "acknowledged"
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const transaction = read(stateFile).transaction;
		assert.equal(transaction?.phase, "succeeded", JSON.stringify(transaction));
		assert.equal(transaction.release.status, "acknowledged");
		const snapshot = read(transaction.snapshot),
			receipt = read(join(directory, "installation.json"));
		assert.deepEqual(
			readFileSync(snapshot.previous),
			Buffer.from("old fixture; never executed"),
		);
		assert.equal(
			appFingerprint(f.data.install, "linux-arm64"),
			receipt.fingerprint,
		);
		assert.equal(
			receipt.candidate.manifestSha256,
			f.data.candidate.manifestSha256,
		);
		const health = read(join(directory, `health-${snapshot.healthToken}.json`));
		assert.equal(health.pid, snapshot.child.pid);
		assert.equal(processStamp(health.pid), health.stamp);
		assert.equal(health.version, f.data.candidate.version);
		assert.equal(
			existsSync(join(f.data.home, "runtime", "update-owner.json")),
			false,
		);
	} finally {
		await f.cleanup();
	}
});
