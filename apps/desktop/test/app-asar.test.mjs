import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tree } from "../src/app-archive.mjs";

const require = createRequire(import.meta.url);
let electron = process.env.BOBS_FACTORY_TEST_ELECTRON;
if (!electron) {
	const packageDirectory = dirname(require.resolve("electron/package.json"));
	const pathFile = join(packageDirectory, "path.txt");
	if (existsSync(pathFile))
		electron = join(
			packageDirectory,
			"dist",
			readFileSync(pathFile, "utf8").trim(),
		);
}

test("pinned Electron Node helper inventories and archives the physical ASAR bytes, mode and symlinks", {
	skip: !electron && "Electron binary is not materialized",
}, () => {
	const resources =
		process.platform === "darwin"
			? join(dirname(electron), "..", "Resources")
			: dirname(electron);
	const asar =
		process.env.BOBS_FACTORY_TEST_ASAR ?? join(resources, "default_app.asar");
	const root = mkdtempSync(join(tmpdir(), "physical-app-asar-"));
	try {
		const app = join(root, "fixture.app");
		mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
		copyFileSync(asar, join(app, "Contents", "Resources", "app.asar"));
		chmodSync(join(app, "Contents", "Resources", "app.asar"), 0o751);
		symlinkSync("app.asar", join(app, "Contents", "Resources", "archive-link"));
		const expected = tree(app);
		const result = spawnSync(
			electron,
			[fileURLToPath(new URL("./app-asar-fixture.mjs", import.meta.url)), app],
			{
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				encoding: "utf8",
				timeout: 30000,
			},
		);
		assert.equal(result.status, 0, result.stderr);
		const observed = JSON.parse(result.stdout);
		assert.equal(
			observed.electron,
			require("../package.json").devDependencies.electron,
		);
		assert.equal(
			observed.virtualDirectory,
			true,
			"Fixture must exercise Electron's ASAR virtualization",
		);
		assert.deepEqual(
			observed.entries,
			expected,
			"Electron helper must match system Node's complete physical inventory",
		);
		assert.deepEqual(
			observed.unpacked,
			expected,
			"Archive round trip must retain physical ASAR bytes and modes",
		);
		assert.deepEqual(
			observed.copied,
			expected,
			"Replacement copy must retain the ASAR container and internal symlinks",
		);
		assert.equal(
			observed.changedFingerprint,
			true,
			"Changing physical ASAR bytes must change the complete app fingerprint",
		);
		assert.equal(observed.virtualPackageReadable, true);
		assert.equal(observed.noAsarAfter, observed.noAsarBefore);
		assert.equal(
			observed.virtualDirectoryAfter,
			true,
			"Virtual module access must remain enabled",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
