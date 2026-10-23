import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

// No UI behavior changed. The API fixture omits the unrelated packaged shell build.
vi.mock("../src/factory/FactoryWebAssets.js", () => ({
	factoryWebAssets: () => ({
		build: "000000000000000000000000",
		protocol: 1,
		assets: [],
	}),
}));

it("drives controlled admission and non-replaying merge recovery through the Factory API", async () => {
	expect(defaultWorkflows.length).toBeGreaterThan(0);
	const provided = process.env.F1_RESULT;
	const home = provided
		? undefined
		: mkdtempSync(join(tmpdir(), "reservation-f1-result-"));
	process.env.F1_AGENT_MODE = "mock";
	process.env.F1_RESULT ??= join(home!, "result.json");
	try {
		await import(
			"../../../apps/f1/test-drives/assets/taskbot146-reservations.mjs"
		);
		const receipt = JSON.parse(readFileSync(process.env.F1_RESULT, "utf8"));
		expect(receipt.restartConfirmedWithoutReplay).toBe(true);
		expect(receipt.submissions).toBe(1);
	} finally {
		if (home) {
			delete process.env.F1_RESULT;
			rmSync(home, { recursive: true, force: true });
		}
	}
}, 30000);
