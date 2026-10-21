// Build mcp-tools, then optionally pass the original snapshot module as argv[2].
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/factoryContextSnapshot.js";

const fixture = {
	findings: Array.from({ length: 256 }, (_, index) => ({
		id: `finding-${index}`,
		summary: `Evidence ${index}`,
		status: "resolved",
		requirementIds: [`R${index}`, `R${index + 1}`],
		evidence: `Retained execution receipt ${index}`,
	})),
};
const modules = [];
if (process.argv[2])
	modules.push([
		"baseline",
		(await import(pathToFileURL(resolve(process.argv[2])).href))
			.FactoryContextSnapshot,
	]);
modules.push(["candidate", FactoryContextSnapshot]);
for (const [mode, Snapshot] of modules) {
	const directory = mkdtempSync(join(tmpdir(), "f1-capture-benchmark-"));
	chmodSync(directory, 0o700);
	try {
		// Cold decoded records have distinct identities despite repeated evidence.
		const history = Array.from({ length: 32 }, (_, index) => ({
			step: `review/${index}`,
			output: structuredClone(fixture),
		}));
		const path = join(directory, "input.json");
		const snapshot = new Snapshot(path),
			started = performance.now();
		await snapshot.writeAsync({ history }, true);
		const captureMs = performance.now() - started;
		const expected = JSON.stringify({ history });
		assert.equal(
			snapshot.read(snapshot.root, 0, expected.length + 1).text,
			expected,
		);
		const reopened = Snapshot.open(path);
		assert.equal(
			reopened.read(reopened.root, 0, expected.length + 1).text,
			expected,
		);
		console.log(
			JSON.stringify({
				mode,
				rows: history.length,
				characters: expected.length,
				captureMs: Math.round(captureMs),
				exact: true,
				coldReopenExact: true,
			}),
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
