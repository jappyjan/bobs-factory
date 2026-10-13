import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/binary-release.mjs";
import { downloadPinned } from "../lib/nightly-baseline.mjs";

test("baseline assets stream over anonymous HTTPS and reject truncated, oversized or substituted bytes", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-baseline-download-"));
	const bytes = Buffer.from("exact retained release input");
	const record = { file: "input", size: bytes.length, sha256: sha256(bytes) };
	try {
		let calls = 0;
		const transport = async (url, options) => {
			assert.equal(String(url), "https://github.com/retained/input");
			assert.equal(options, undefined);
			calls++;
			const response = new Response(bytes);
			Object.defineProperty(response, "url", {
				value: "https://release-assets.githubusercontent.com/input",
			});
			return response;
		};
		const path = join(root, "good");
		await downloadPinned(
			record,
			"https://github.com/retained/input",
			path,
			transport,
		);
		assert.deepEqual(readFileSync(path), bytes);
		for (const wrong of [
			{ ...record, size: bytes.length + 1 },
			{ ...record, size: bytes.length - 1 },
			{ ...record, sha256: "a".repeat(64) },
		]) {
			const bad = join(root, "bad");
			await assert.rejects(
				downloadPinned(
					wrong,
					"https://github.com/retained/input",
					bad,
					transport,
				),
				/integrity mismatch|size limit/,
			);
			assert.equal(existsSync(bad), false);
		}
		await assert.rejects(
			downloadPinned(
				record,
				"http://github.com/retained/input",
				join(root, "http"),
				transport,
			),
			/Invalid pinned/,
		);
		assert.equal(calls, 4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
