import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compareReleaseVersions } from "../../../scripts/lib/binary-release.mjs";
import {
	desktopExecutable,
	workerStartupFailure,
} from "../src/local-runtime.mjs";

const target = `${process.platform}-${process.arch}`;
function bundle(root, version) {
	const directory = join(root, `bundle-${version}`);
	mkdirSync(directory, { recursive: true });
	const bytes = Buffer.from(`runtime ${version}`);
	writeFileSync(join(directory, "bobs-factory"), bytes, { mode: 0o755 });
	writeFileSync(
		join(directory, "build.json"),
		JSON.stringify({
			product: "bobs-factory",
			version,
			commit: createHash("sha1").update(version).digest("hex").padEnd(40, "0"),
			target,
			executable: {
				sha256: createHash("sha256").update(bytes).digest("hex"),
				size: bytes.length,
			},
		}),
	);
	return directory;
}
function retainedHome() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "desktop-runtime-")));
	const home = join(root, "home");
	mkdirSync(join(home, "runtime"), { recursive: true });
	const old = bundle(root, "1.0.0");
	const link = desktopExecutable(home, old);
	return { root, home, link, old, current: () => realpathSync(link) };
}
const options = { compareVersions: compareReleaseVersions };
const version = (path) =>
	JSON.parse(readFileSync(join(path, "..", "build.json"), "utf8")).version;

test("a newer bundled runtime replaces the old one when no worker or update is active", (t) => {
	const { root, home, link, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(version(current()), "1.0.0");
	const newer = bundle(root, "1.1.0");

	assert.equal(desktopExecutable(home, newer, options), link);

	assert.equal(version(current()), "1.1.0");
	const record = JSON.parse(
		readFileSync(join(home, "runtime", "desktop-runtime.json"), "utf8"),
	);
	assert.equal(record.initial.version, "1.1.0");
	// The previous runtime is retained and the adoption is idempotent.
	assert.equal(desktopExecutable(home, newer, options), link);
	assert.equal(version(current()), "1.1.0");
});

test("adoption never switches a runtime while a worker is running", (t) => {
	const { root, home, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	symlinkSync("{}", join(home, "runtime", "worker.lock"));

	desktopExecutable(home, bundle(root, "1.1.0"), options);

	assert.equal(version(current()), "1.0.0");
});

test("adoption never switches a runtime while an update is in flight", (t) => {
	const { root, home, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(home, "updates"));
	writeFileSync(
		join(home, "updates", "state.json"),
		JSON.stringify({ transaction: { phase: "health" } }),
	);
	desktopExecutable(home, bundle(root, "1.1.0"), options);
	assert.equal(version(current()), "1.0.0");

	rmSync(join(home, "updates", "state.json"));
	writeFileSync(join(home, "runtime", "update-owner.json"), "{}");
	desktopExecutable(home, bundle(root, "1.1.0"), options);
	assert.equal(version(current()), "1.0.0");
});

test("a completed, acknowledged update does not block adoption", (t) => {
	const { root, home, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(home, "updates"));
	writeFileSync(
		join(home, "updates", "state.json"),
		JSON.stringify({
			transaction: {
				phase: "succeeded",
				release: { status: "acknowledged" },
			},
		}),
	);

	desktopExecutable(home, bundle(root, "1.1.0"), options);

	assert.equal(version(current()), "1.1.0");
});

test("an older or equal bundled runtime never replaces the installed one", (t) => {
	const { root, home, old, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	desktopExecutable(home, bundle(root, "1.2.0"), options);
	assert.equal(version(current()), "1.2.0");

	desktopExecutable(home, old, options);
	desktopExecutable(home, bundle(root, "1.2.0"), options);

	assert.equal(version(current()), "1.2.0");
});

test("without a version comparer the retained runtime is preserved as before", (t) => {
	const { root, home, current } = retainedHome();
	t.after(() => rmSync(root, { recursive: true, force: true }));
	desktopExecutable(home, bundle(root, "1.1.0"));
	assert.equal(version(current()), "1.0.0");
});

test("worker startup failures carry the output written during this launch only", (t) => {
	const root = mkdtempSync(join(tmpdir(), "desktop-log-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const log = join(root, "desktop-worker.log");
	const earlier = "ancient failure from a previous launch\n";
	writeFileSync(log, `${earlier}starting\nError: State format 9 is newer\n`);

	const message = workerStartupFailure(
		log,
		earlier.length,
		"Factory stopped while starting (exit code 78).",
	);

	assert.match(message, /exit code 78/);
	assert.match(message, /Error: State format 9 is newer/);
	assert.doesNotMatch(message, /ancient failure/);
	assert.match(message, new RegExp(`Full log: ${log}`));
	assert.match(
		workerStartupFailure(join(root, "missing.log"), 0, "Factory failed."),
		/wrote no output/,
	);
});
