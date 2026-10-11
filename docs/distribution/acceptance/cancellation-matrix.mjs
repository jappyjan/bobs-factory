import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startOwnedCommand } from "./owned-command.mjs";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.platform, "linux");
const [runtime, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const outcomes = [];
// Every case runs even if a previous cancellation/receipt assertion fails.
for (const phase of [
	"initial-install",
	"manager-mutation",
	"healthy-managed-fixture",
]) {
	for (const signal of ["SIGINT", "SIGTERM"]) {
		const path = join(directory, `cancel-${phase}-${signal}.json`);
		const outcome = { phase, signal, passed: false };
		try {
			const command = startOwnedCommand(
				process.execPath,
				["docs/distribution/acceptance/linux-user-service.mjs", runtime, path],
				{
					timeout: 90000,
					env: {
						...process.env,
						BOBS_FACTORY_ACCEPTANCE_INTERRUPT: signal,
						BOBS_FACTORY_ACCEPTANCE_INTERRUPT_PHASE: phase,
					},
				},
			);
			const result = await command.done.then(
				() => ({ status: 0 }),
				(error) => error,
			);
			assert.equal(result.status, signal === "SIGINT" ? 130 : 143);
			const receipt = JSON.parse(readFileSync(path));
			assert.equal(receipt.passed, false);
			assert.equal(receipt.cleanup, true);
			assert.equal(receipt.interrupted, signal);
			assert.equal(receipt.interruptPhase, phase);
			assert.deepEqual(receipt.survivors, []);
			if (phase !== "healthy-managed-fixture")
				assert.equal(receipt.lateMutation, false);
			outcome.passed = true;
		} catch (error) {
			outcome.error = error.message;
		}
		outcomes.push(outcome);
		console.log(JSON.stringify(outcome));
	}
}
writeFileSync(
	join(directory, "cancellation-matrix.json"),
	JSON.stringify(outcomes, null, 2),
	{ flag: "wx" },
);
assert(
	outcomes.every((outcome) => outcome.passed),
	"Cancellation matrix failed; retain every receipt",
);
