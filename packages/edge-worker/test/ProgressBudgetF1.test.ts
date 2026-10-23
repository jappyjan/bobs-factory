import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

// The drive exercises production runtime/authenticated routes; no web UI changed.
vi.mock("../src/factory/FactoryWebAssets.js", () => ({
	factoryWebAssets: () => ({
		build: "000000000000000000000000",
		protocol: 1,
		assets: [],
	}),
}));

it("drives retained convergence and narrowly scoped Continue through the authenticated Factory API", async () => {
	const previousMode = process.env.F1_AGENT_MODE;
	const previousResult = process.env.F1_RESULT;
	const directory = previousResult
		? undefined
		: mkdtempSync(join(tmpdir(), "task147-f1-result-"));
	process.env.F1_AGENT_MODE = "mock";
	process.env.F1_RESULT ??= join(directory!, "result.json");
	try {
		await import("../../../apps/f1/test-drives/assets/taskbot147-progress.mjs");
		const result = JSON.parse(readFileSync(process.env.F1_RESULT, "utf8"));
		expect(result).toMatchObject({
			mode: "mock",
			initialPhysicalExecutions: 4,
			afterContinueExecutions: 5,
			retainedAfterRestart: true,
			otherObservationNotGranted: true,
			duplicateRetryRejected: true,
			nativeSessionsRetained: true,
			mocks: { nativeAgentCalls: 0, inferenceCalls: 0, providerCalls: 0 },
		});
	} finally {
		if (previousMode === undefined) delete process.env.F1_AGENT_MODE;
		else process.env.F1_AGENT_MODE = previousMode;
		if (previousResult === undefined) delete process.env.F1_RESULT;
		else process.env.F1_RESULT = previousResult;
		if (directory) rmSync(directory, { recursive: true, force: true });
	}
});
