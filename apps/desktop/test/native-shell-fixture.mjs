// Controlled shell identities only. No fixture record claims real publication.
import {
	freezeCandidate,
	validateCandidate,
} from "../../../scripts/lib/release-candidate.mjs";

export function nativeShellPlan(frozen) {
	const c = validateCandidate(frozen).candidate;
	const source = {
		commit: c.commit,
		workflowSha: c.workflowSha,
		committedVersion: c.committedVersion,
	};
	const stable = (version, origin) =>
		freezeCandidate({
			...source,
			channel: "stable",
			version,
			promotion: {
				channel: "nightly",
				version: origin.candidate.version,
				tag: origin.candidate.tag,
				commit: c.commit,
				manifestSha256: "a".repeat(64),
				releaseId: 1,
			},
		});
	if (c.channel === "beta") {
		const origin = freezeCandidate({
			...source,
			channel: "nightly",
			sequence: 1,
			date: "2026-10-10T00:00:00Z",
		});
		const [major, minor, patch] = c.version.split("-")[0].split(".");
		return {
			baseline: frozen,
			successful: stable(`${major}.${minor}.${Number(patch) + 1}`, origin),
			failed: stable(`${major}.${minor}.${Number(patch) + 2}`, origin),
			inputRole: "installed-baseline",
			settings: { channel: "stable", policy: "idle-auto" },
		};
	}
	if (c.channel !== "nightly")
		throw Error("Native shell fixture requires a nightly or beta input");
	return {
		baseline: stable("0.9.0", frozen),
		successful: frozen,
		failed: freezeCandidate({
			...source,
			channel: "nightly",
			sequence: c.sequence + 1,
			date: `${c.version
				.match(/nightly\.(\d{4})(\d{2})(\d{2})\./)
				.slice(1)
				.join("-")}T00:00:00Z`,
		}),
		inputRole: "successful-update",
		settings: { channel: "nightly" },
	};
}

export function nativeShellInputReceipt(frozen, plan, inputSha256, good, bad) {
	const update = (record, imageSha256) => ({
		synthetic: record.digest !== frozen.digest,
		version: record.candidate.version,
		channel: record.candidate.channel,
		candidateDigest: record.digest,
		imageSha256,
	});
	return {
		imageSha256: inputSha256,
		inputImage: {
			role: plan.inputRole,
			version: frozen.candidate.version,
			channel: frozen.candidate.channel,
			candidateDigest: frozen.digest,
			imageSha256: inputSha256,
		},
		testedUpdates: {
			successful: update(plan.successful, good),
			deliberateHealthFailure: update(plan.failed, bad),
		},
	};
}
