import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("drives nested parallel execution, capacity/shared QA/CI/human waits and retained restart through the Factory API", async () => {
	const directory = mkdtempSync(join(tmpdir(), "task148-f1-result-"));
	const previousMode = process.env.F1_AGENT_MODE,
		previousResult = process.env.F1_RESULT;
	process.env.F1_AGENT_MODE = "mock";
	process.env.F1_RESULT = join(directory, "result.json");
	try {
		await import(
			"../../../apps/f1/test-drives/assets/taskbot148-diagnostics.mjs"
		);
		const result = JSON.parse(readFileSync(process.env.F1_RESULT, "utf8"));
		expect(result).toMatchObject({
			mode: "mock",
			executionMs: 5000,
			waitMs: 5000,
			roleWallMs: 5000,
			restartPreserved: true,
			noReplay: true,
			staleHumanDigestRejected: true,
			providerCalls: 0,
			nativeCalls: 0,
			inferenceCalls: 0,
		});
		if (previousResult)
			writeResult(previousResult, readFileSync(process.env.F1_RESULT, "utf8"));
	} finally {
		if (previousMode === undefined) delete process.env.F1_AGENT_MODE;
		else process.env.F1_AGENT_MODE = previousMode;
		if (previousResult === undefined) delete process.env.F1_RESULT;
		else process.env.F1_RESULT = previousResult;
		rmSync(directory, { recursive: true, force: true });
	}
});

import { writeFileSync as writeResult } from "node:fs";
