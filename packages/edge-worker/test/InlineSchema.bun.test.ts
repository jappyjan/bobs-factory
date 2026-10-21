import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const available = spawnSync("bun", ["--version"]).status === 0;
const fixture = fileURLToPath(
	new URL(
		"../../../scripts/fixtures/inline-schema-vm-clock.mjs",
		import.meta.url,
	),
);
it.skipIf(!available)(
	"permits a scheduling pause during ordinary Bun compilation within the parent wall budget",
	() => {
		const child = spawnSync("bun", [fixture, "500"], {
			encoding: "utf8",
			timeout: 3000,
		});
		expect(child.status, child.stderr).toBe(0);
		const result = JSON.parse(child.stdout);
		expect(result.executionMs).toBe(1000);
		expect(result.result).toEqual({ schemaIssues: [], issues: [] });
	},
);
it.skipIf(!available)(
	"retains the Bun VM cutoff independently of the external parent deadline",
	() => {
		const child = spawnSync("bun", [fixture, "1500"], {
			encoding: "utf8",
			timeout: 3000,
		});
		expect(child.status, child.stderr).toBe(0);
		const result = JSON.parse(child.stdout);
		expect(result.result).toEqual({
			schemaIssues: [
				"Inline JSON Schema compilation exceeded the 1000 ms execution limit",
			],
			issues: [],
			resourceFailure: true,
		});
		expect(result.elapsedMs).toBeLessThan(2000);
	},
);
