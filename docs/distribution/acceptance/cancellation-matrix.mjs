import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runOwnedFixture } from "./owned-fixture.mjs";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.platform, "linux");
const [runtime, directory] = process.argv.slice(2);
mkdirSync(directory, { recursive: true });
const outcomes = [];
const cases = [
	"initial-install",
	"manager-mutation",
	"healthy-managed-fixture",
].flatMap((phase) =>
	["SIGINT", "SIGTERM"].map((signal) => ({ phase, signal })),
);
cases.push({
	phase: "manager-mutation",
	signal: "SIGTERM",
	outerTimeout: true,
});
// Every case runs even if a previous cancellation/receipt assertion fails.
for (const { phase, signal, outerTimeout = false } of cases) {
	const path = join(
		directory,
		`cancel-${phase}-${outerTimeout ? "outer-timeout" : signal}.json`,
	);
	const outcome = { phase, signal, outerTimeout, passed: false };
	try {
		const result = await runOwnedFixture(
			process.execPath,
			["docs/distribution/acceptance/linux-user-service.mjs", runtime, path],
			{
				timeout: 90000,
				receiptPath: path,
				timeoutAfterBoundary: outerTimeout ? 100 : undefined,
				env: {
					...process.env,
					BOBS_FACTORY_ACCEPTANCE_INTERRUPT: signal,
					BOBS_FACTORY_ACCEPTANCE_OUTER_TIMEOUT: String(outerTimeout),
					BOBS_FACTORY_ACCEPTANCE_INTERRUPT_PHASE: phase,
				},
			},
		).then(
			() => ({ status: 0 }),
			(error) => error,
		);
		outcome.commandError = result.message;
		outcome.commandCleanupError = result.cleanupError;
		outcome.status = result.status;
		outcome.stdout = result.stdout;
		outcome.stderr = result.stderr;
		assert.equal(result.status, signal === "SIGINT" ? 130 : 143);
		if (outerTimeout) assert.equal(result.timedOut, true);
		const receipt = JSON.parse(readFileSync(path));
		assert.equal(receipt.passed, false);
		assert.equal(receipt.cleanup, true);
		assert.equal(receipt.interrupted, signal);
		assert.equal(receipt.interruptPhase, phase);
		assert.deepEqual(receipt.survivors, []);
		if (phase !== "healthy-managed-fixture") {
			assert.equal(receipt.lateMutation, false);
			const boundary = JSON.parse(receipt.managerBoundary);
			assert(
				boundary.includes(
					phase === "initial-install" ? "daemon-reload" : "start",
				),
			);
		}
		if (outerTimeout) {
			assert.equal(receipt.outerTimedOut, true);
			assert.match(receipt.outerError, /Command timed out/);
		}
		outcome.passed = true;
	} catch (error) {
		outcome.error = error.message;
		outcome.cleanupError = error.cleanupError;
		if (error.stdout !== undefined) outcome.stdout = error.stdout;
		if (error.stderr !== undefined) outcome.stderr = error.stderr;
		if (error.status !== undefined) outcome.status = error.status;
	}
	outcomes.push(outcome);
	console.log(JSON.stringify(outcome));
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
