import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeNativeReceipt } from "./native-receipt-output.mjs";

test("native receipt survives noisy Electron streams and immediate exit", () => {
	const directory = mkdtempSync(join(tmpdir(), "factory-native-receipt-"));
	try {
		const path = join(directory, "receipt.json");
		const receipt = { passed: true, platform: "linux", arch: "arm64" };
		const producer = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import {writeNativeReceipt} from ${JSON.stringify(new URL("./native-receipt-output.mjs", import.meta.url).href)};
process.stdout.write('[6017:ERROR:dbus/bus.cc:406] Failed to connect to the bus\\n');
process.stderr.write('retained Chromium diagnostics\\n');
writeNativeReceipt(${JSON.stringify(receipt)}, process.env.BOBS_FACTORY_NATIVE_ELECTRON_RECEIPT);
process.exit(0);`,
			],
			{
				encoding: "utf8",
				env: { ...process.env, BOBS_FACTORY_NATIVE_ELECTRON_RECEIPT: path },
			},
		);
		assert.equal(producer.status, 0, producer.stderr);
		assert.match(producer.stdout, /Failed to connect to the bus/);
		assert.match(producer.stderr, /retained Chromium diagnostics/);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), receipt);
		assert.equal(statSync(path).mode & 0o777, 0o600);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("native receipt refuses relative paths and existing files or links", () => {
	const directory = mkdtempSync(join(tmpdir(), "factory-native-receipt-"));
	try {
		assert.throws(
			() => writeNativeReceipt({ passed: true }, "receipt.json"),
			/receipt path must be absolute/,
		);
		const prior = join(directory, "prior.json");
		writeFileSync(prior, "preserved prior receipt");
		const link = join(directory, "link.json");
		symlinkSync(prior, link);
		for (const path of [prior, link])
			assert.throws(() => writeNativeReceipt({ passed: true }, path), {
				code: "EEXIST",
			});
		assert.equal(readFileSync(prior, "utf8"), "preserved prior receipt");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
