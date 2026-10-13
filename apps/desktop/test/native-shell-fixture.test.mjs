import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../../../scripts/lib/binary-release.mjs";
import { freezeCandidate } from "../../../scripts/lib/release-candidate.mjs";
import { DesktopAppSource } from "../src/app-source.mjs";
import * as services from "../src/update-services.mjs";
import {
	nativeShellInputReceipt,
	nativeShellPlan,
} from "./native-shell-fixture.mjs";
import { appRelease, fixtureClient } from "./shell-fixture.mjs";

const source = {
	commit: "a".repeat(40),
	workflowSha: "b".repeat(40),
	committedVersion: "1.0.0-beta",
};
for (const channel of ["nightly", "beta"])
	test(`${channel} native shell lane preserves input identity, selects an eligible supported update and binds its receipt truthfully`, async () => {
		const frozen = freezeCandidate({
			...source,
			channel,
			version: channel === "beta" ? "1.0.1-beta" : undefined,
			sequence: 10,
			date: "2026-10-09T00:00:00Z",
		});
		const plan = nativeShellPlan(frozen);
		const input = Buffer.from(`actual ${channel} input bytes`);
		const baseline = channel === "beta" ? input : Buffer.from("prior shell");
		const successful =
			channel === "nightly" ? input : Buffer.from("synthetic stable shell");
		const failed = Buffer.from("deliberate health failure shell");
		const directory = mkdtempSync(join(tmpdir(), "native-shell-plan-"));
		const fixtures = [];
		try {
			for (const [candidate, bytes] of [
				[plan.baseline, baseline],
				[plan.successful, successful],
				[plan.failed, failed],
			])
				fixtures.push(
					appRelease(candidate.candidate.channel, bytes, "linux-arm64", {
						frozenCandidate: candidate,
					}),
				);
			const [old, good, bad] = fixtures;
			const install = join(directory, "Bob.AppImage");
			writeFileSync(install, baseline, { mode: 0o755 });
			const appSource = new DesktopAppSource(
				join(directory, "staging"),
				install,
				"linux-arm64",
				services,
				fixtureClient([old, good], services),
			);
			const enrollment = await appSource.enroll(old.identity);
			assert.equal(
				enrollment.candidate.version,
				plan.baseline.candidate.version,
			);
			assert.equal(
				enrollment.candidate.channel,
				plan.baseline.candidate.channel,
			);
			const manager = new services.UpdateManager(
				join(directory, "manager"),
				appSource,
				undefined,
				{ ...old.identity, target: "linux-arm64" },
			);
			manager.configure(plan.settings, 0);
			await manager.check();
			await manager.stage();
			assert.equal(
				manager.status().pending.candidate.version,
				plan.successful.candidate.version,
			);
			assert.equal(
				manager.status().pending.candidate.channel,
				channel === "beta" ? "stable" : "nightly",
			);
			assert.equal(manager.status().effectivePolicy, "idle-auto");
			assert.equal(manager.activationEligible(), true);
			assert.deepEqual(
				readFileSync(manager.status().pending.staged.executable),
				successful,
			);
			appSource.client = fixtureClient([old, bad], services);
			const next = await appSource.discover(manager.status().settings);
			assert.equal(next.version, plan.failed.candidate.version);
			assert.equal(next.channel, plan.failed.candidate.channel);
			assert.equal(next.commit, frozen.candidate.commit);
			assert.deepEqual(
				readFileSync((await appSource.stage(next)).executable),
				failed,
			);
			const receipt = nativeShellInputReceipt(
				frozen,
				plan,
				sha256(input),
				good.manifest.desktop.artifacts[0].updateArchive.sha256,
				bad.manifest.desktop.artifacts[0].updateArchive.sha256,
			);
			assert.deepEqual(receipt.inputImage, {
				role: channel === "beta" ? "installed-baseline" : "successful-update",
				version: frozen.candidate.version,
				channel,
				candidateDigest: frozen.digest,
				imageSha256: sha256(input),
			});
			assert.equal(receipt.imageSha256, sha256(input));
			assert.equal(
				receipt.testedUpdates.successful.synthetic,
				channel === "beta",
			);
			assert.equal(
				receipt.testedUpdates.successful.imageSha256,
				sha256(successful),
			);
			assert.equal(
				receipt.testedUpdates.deliberateHealthFailure.synthetic,
				true,
			);
			assert.equal(
				receipt.testedUpdates.deliberateHealthFailure.imageSha256,
				sha256(failed),
			);
			if (channel === "beta") {
				assert.strictEqual(plan.baseline, frozen);
				assert.equal(plan.successful.candidate.version, "1.0.2");
				assert.equal(plan.failed.candidate.version, "1.0.3");
				assert.match(plan.successful.candidate.promotion.version, /-nightly\./);
				assert.equal(manager.status().settings.overrides.stable, "idle-auto");
				await assert.rejects(
					() =>
						appSource.discover({
							channel: "stable",
							pin: frozen.candidate.version,
						}),
					/channel/,
				);
			} else {
				assert.strictEqual(plan.successful, frozen);
				assert.equal(plan.baseline.candidate.version, "0.9.0");
				assert.equal(plan.failed.candidate.sequence, 11);
				assert.deepEqual(manager.status().settings.overrides, {});
			}
		} finally {
			for (const fixture of fixtures) fixture.cleanup();
			rmSync(directory, { recursive: true, force: true });
		}
	});
