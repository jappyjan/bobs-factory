import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withOwnedCleanup } from "./owned-cleanup.mjs";

for (const signal of ["SIGTERM", "SIGINT"]) {
	test(`${signal} unwinds work, cleans its child once and persists FAIL`, {
		timeout: 5000,
	}, async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-cleanup-check-"));
		const receiptPath = join(root, "receipt.json");
		const fixture = spawn(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ stdio: "ignore" },
		);
		const fixtureExited = new Promise((resolve) =>
			fixture.once("exit", resolve),
		);
		const script = `
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { withOwnedCleanup } from ${JSON.stringify(new URL("./owned-cleanup.mjs", import.meta.url).href)};
const receipt = { passed: false, cleanup: false, calls: 0 };
await withOwnedCleanup({ receipt,
  work: async (signal) => {
    receipt.child = ${fixture.pid};
    console.log('ready');
    await delay(60000, undefined, { signal });
    receipt.passed = true;
  },
  cleanup: async () => {
    receipt.calls++;
    const confirmed = new Promise((resolve) => process.once('message', resolve));
    process.send('cleanup');
    await confirmed;
    receipt.cleanup = true;
  },
  persist: () => writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify(receipt))
});
process.disconnect();`;
		const processUnderTest = spawn(
			process.execPath,
			["--input-type=module", "-e", script],
			{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
		);
		processUnderTest.on("message", async () => {
			processUnderTest.kill(signal);
			fixture.kill("SIGTERM");
			await fixtureExited;
			if (processUnderTest.connected) processUnderTest.send("exited");
		});
		try {
			const exited = new Promise((resolve) =>
				processUnderTest.once("exit", (code, receivedSignal) =>
					resolve({ code, receivedSignal }),
				),
			);
			await new Promise((resolve, reject) => {
				processUnderTest.stdout.once("data", resolve);
				processUnderTest.once("error", reject);
			});
			processUnderTest.kill(signal);
			const result = await exited;
			assert.deepEqual(result, {
				code: signal === "SIGINT" ? 130 : 143,
				receivedSignal: null,
			});
			const receipt = JSON.parse(readFileSync(receiptPath));
			assert.equal(receipt.passed, false);
			assert.equal(receipt.cleanup, true);
			assert.equal(receipt.calls, 1);
			assert.equal(receipt.interrupted, signal);
			assert.throws(() => process.kill(receipt.child, 0), { code: "ESRCH" });
		} finally {
			processUnderTest.kill("SIGKILL");
			fixture.kill("SIGKILL");
			await fixtureExited;
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("failure and cleanup failure remain nonpassing and persist both errors", async () => {
	const receipt = { passed: false, cleanup: false };
	let persisted;
	await withOwnedCleanup({
		receipt,
		work: async () => {
			throw Error("acceptance failed");
		},
		cleanup: async () => {
			throw Error("owned child survived");
		},
		persist: () => {
			persisted = { ...receipt };
		},
	});
	assert.deepEqual(persisted, {
		passed: false,
		cleanup: false,
		error: "acceptance failed",
		cleanupError: "owned child survived",
	});
});
