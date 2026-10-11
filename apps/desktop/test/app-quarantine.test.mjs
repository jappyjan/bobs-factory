import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileRecord, jsonBytes } from "../../../scripts/lib/binary-release.mjs";
import { preparedFixture } from "../../../scripts/tests/prepared-fixture.mjs";
import { packApp } from "../src/app-archive.mjs";
import { DesktopAppLifecycle, read, save } from "../src/app-lifecycle.mjs";
import { appFingerprint, DesktopAppSource } from "../src/app-source.mjs";
import * as services from "../src/update-services.mjs";
import { fixtureClient } from "./shell-fixture.mjs";

const target = "darwin-arm64";
const q1 = "0081;67090000;QuarantineFixture;";
const q2 = "0081;67090001;QuarantineFixture;";
const mark = (path, value) =>
	execFileSync("/usr/bin/xattr", ["-w", "com.apple.quarantine", value, path]);
const attribute = (path) =>
	execFileSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", path], {
		encoding: "utf8",
	}).trim();
function fixture() {
	const f = preparedFixture("nightly", { desktop: true });
	const container = join(f.work, "app-container"),
		app = join(container, "Bob's Factory.app");
	const notices = join(app, "Contents", "Resources", "electron-licenses");
	mkdirSync(notices, { recursive: true });
	writeFileSync(join(app, "fixture"), "controlled app bytes, never executed");
	const files = ["LICENSE", "LICENSES.chromium.html"].map((file) => {
		writeFileSync(join(notices, file), `fixture ${file}`);
		const record = fileRecord(join(notices, file), file);
		return { file, size: record.size, sha256: record.sha256 };
	});
	const electronLicenses = {
		schemaVersion: 1,
		product: "electron",
		version: "44.7.0",
		files,
	};
	const item = f.manifest.desktop.artifacts[0];
	const archive = "fixture.bobsapp.gz";
	writeFileSync(join(f.assets, archive), packApp(container));
	item.updateArchive = fileRecord(join(f.assets, archive), archive);
	const metadata = {
		...f.identity,
		schemaVersion: 1,
		product: "bobs-factory-desktop",
		target,
		format: "bobs-app-v1",
		osSigning: "unsigned",
		fingerprint: appFingerprint(app, target),
		electronLicenses,
		archive: item.updateArchive,
	};
	writeFileSync(join(f.assets, item.updateMetadata.file), jsonBytes(metadata));
	item.updateMetadata = fileRecord(
		join(f.assets, item.updateMetadata.file),
		item.updateMetadata.file,
	);
	for (const r of [item.updateArchive, item.updateMetadata])
		f.manifest.assets = [
			...f.manifest.assets.filter((x) => x.file !== r.file),
			r,
		];
	writeFileSync(join(f.assets, "release.json"), jsonBytes(f.manifest));
	f.records = [
		...f.manifest.assets,
		fileRecord(join(f.assets, "release.json"), "release.json"),
	];
	const install = join(f.work, "Installed.app"),
		home = join(f.work, "home"),
		directory = join(home, "desktop", "updates");
	cpSync(app, install, { recursive: true });
	mark(install, q1);
	const controlled = { ...services, workerOwner: () => undefined };
	const source = new DesktopAppSource(
		directory,
		install,
		target,
		controlled,
		fixtureClient([f], services),
	);
	const life = new DesktopAppLifecycle(
		{ home, install, target, port: 3457, uiPid: 999999, uiStamp: "absent" },
		controlled,
	);
	// No executable or service launch: real archive, filesystem, proofs and lifecycle.
	life.start = async () => {};
	life.health = async () => {};
	return {
		...f,
		install,
		home,
		directory,
		source,
		life,
		fingerprint: metadata.fingerprint,
	};
}
for (const mode of [
	"staging",
	"replacement and rollback",
	"interrupted recovery",
]) {
	test(`macOS complete-app ${mode} preserves actual quarantine without changing byte identity`, {
		skip: process.platform !== "darwin",
	}, async () => {
		const f = fixture();
		try {
			const candidate = f.source.candidate(
				await f.source.verified(f.identity.version),
				"nightly",
			);
			const staged = await f.source.stage(candidate);
			assert.equal(appFingerprint(staged.executable, target), f.fingerprint);
			if (mode === "staging") {
				assert.equal(attribute(staged.executable), q1);
				return;
			}
			save(f.life.receipt, await f.source.enroll(f.identity));
			const id = "quarantine-fixture";
			const snapshot = await f.life.snapshot(id);
			const transaction = {
				id,
				candidate,
				staged,
				snapshot,
				previous: f.identity,
			};
			save(join(f.directory, "state.json"), { transaction });
			// OS metadata can change between staging/snapshot and activation; retain live state.
			mark(f.install, q2);
			await f.life.activate(staged);
			assert.equal(attribute(f.install), q2);
			const retained = read(snapshot);
			assert.equal(attribute(retained.previous), q2);
			assert.equal(appFingerprint(f.install, target), f.fingerprint);
			if (mode === "interrupted recovery")
				rmSync(f.install, { recursive: true });
			await f.life.rollback(transaction);
			assert.equal(attribute(f.install), q2);
			assert.equal(appFingerprint(f.install, target), f.fingerprint);
			if (mode === "replacement and rollback")
				assert.equal(attribute(`${f.install}.bobs-failed-${id}`), q2);
		} finally {
			f.cleanup();
		}
	});
}
