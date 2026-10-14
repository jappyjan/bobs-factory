// Executes the maintained F1 entry point, protecting its import/runtime closure
// and complete-app replacement/recovery assertions without native product builds.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

for (const delayedWrites of [false, true]) {
	test(`maintained unsigned complete-shell F1 drive preserves worker state and recovers failed replacement${delayedWrites ? " with delayed receipt writes" : ""}`, () => {
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(
					new URL(
						"../../apps/f1/test-drives/assets/desktop-shell-update.mjs",
						import.meta.url,
					),
				),
			],
			{
				encoding: "utf8",
				timeout: 120000,
				env: {
					...process.env,
					F1_AGENT_MODE: "mock",
					...(delayedWrites
						? {
								NODE_OPTIONS: [
									process.env.NODE_OPTIONS,
									`--require=${JSON.stringify(fileURLToPath(new URL("./fixtures/slow-desktop-receipt.cjs", import.meta.url)))}`,
								]
									.filter(Boolean)
									.join(" "),
							}
						: {}),
				},
			},
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.status, "passed");
		assert.equal(receipt.workerPidUnchanged, true);
		assert.match(receipt.preservedStateSha256, /^[a-f0-9]{64}$/);
		assert.deepEqual(receipt.checks, [
			"active lease defers app switch without signaling UI/worker",
			"unsigned app activation retains exact worker PID/nonce and waiting checkpoints/definitions/outputs/config",
			"interrupted complete-app switch recovers prior UI from candidate-bound integrity receipt without worker resurrection",
			"failed shell exits before rollback; worker and checkpoint bytes remain untouched; bad candidate suppressed",
			"repeat tick never retries bad candidate; local shell settings independent from backend settings",
		]);
	});
}
