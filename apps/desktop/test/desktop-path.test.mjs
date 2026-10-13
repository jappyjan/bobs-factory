import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { desktopPath } from "../src/desktop-path.mjs";

const run = promisify(execFile);
const guiPath = "/usr/bin:/bin:/usr/sbin:/sbin";

test("macOS desktop children find prepared CLIs from a noisy login shell", async () => {
	const home = mkdtempSync(join(tmpdir(), "desktop path "));
	try {
		const bin = join(home, "custom tools");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "bobs-test-agent"),
			"#!/bin/sh\nprintf 'prepared-codex\\n'\n",
			{
				mode: 0o755,
			},
		);
		writeFileSync(
			join(home, ".bash_profile"),
			'printf "startup banner\\n"\nexport PATH="$HOME/custom tools:$PATH"\n',
		);
		const env = {
			HOME: home,
			SHELL: "/bin/bash",
			PATH: guiPath,
		};
		await assert.rejects(run("bobs-test-agent", [], { env }), {
			code: "ENOENT",
		});
		const PATH = await desktopPath(env, { platform: "darwin", home });
		const child = await run("bobs-test-agent", [], { env: { ...env, PATH } });
		assert.equal(child.stdout, "prepared-codex\n");
		assert.equal(PATH.split(":")[0], bin);
		assert.equal(PATH.includes("startup banner"), false);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("missing or slow macOS shells retain PATH and find user-local CLIs", async () => {
	const home = mkdtempSync(join(tmpdir(), "desktop-path-fallback-"));
	try {
		const bin = join(home, ".local", "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(
			join(bin, "bobs-test-agent"),
			"#!/bin/sh\nprintf 'local-codex\\n'\n",
			{
				mode: 0o755,
			},
		);
		const slowShell = join(home, "slow-shell");
		writeFileSync(slowShell, "#!/bin/sh\n/bin/sleep 10\n", {
			mode: 0o755,
		});
		for (const SHELL of [join(home, "missing-shell"), slowShell]) {
			const env = { HOME: home, SHELL, PATH: guiPath };
			const started = Date.now();
			const PATH = await desktopPath(env, {
				platform: "darwin",
				home,
				timeout: 100,
			});
			assert.ok(
				Date.now() - started < 5000,
				"Shell descendants delayed startup",
			);
			assert.equal(PATH.startsWith(`${guiPath}:`), true);
			assert.equal(PATH.split(":").includes("/opt/homebrew/bin"), true);
			assert.equal(PATH.split(":").includes("/usr/local/bin"), true);
			assert.equal(
				(await run("bobs-test-agent", [], { env: { ...env, PATH } })).stdout,
				"local-codex\n",
			);
		}
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("Linux desktop retains its supplied environment", async () => {
	const PATH = "/custom/bin:relative::/usr/bin";
	assert.equal(await desktopPath({ PATH }, { platform: "linux" }), PATH);
	assert.equal(await desktopPath({}, { platform: "linux" }), undefined);
});
