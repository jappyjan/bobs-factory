import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	compareReleaseVersions,
	REPOSITORY,
	selectPublicRelease,
	TARGETS,
	validateBuildProvenance,
} from "../lib/binary-release.mjs";
import {
	candidateDigest,
	candidateIdentity,
	freezeCandidate,
	nightlyEligibility,
	validateCandidate,
	validateCooldownOverride,
} from "../lib/release-candidate.mjs";

const commit = "a".repeat(40),
	workflowSha = "b".repeat(40);
const args = {
	channel: "nightly",
	commit,
	workflowSha,
	committedVersion: "1.0.0-beta",
	sequence: 10,
	date: "2026-10-09T00:00:00Z",
};

test("candidate digest freezes version, recipe and promotion source across retries", () => {
	const nightly = freezeCandidate(args);
	assert.equal(nightly.candidate.version, "1.0.0-nightly.20261009.10");
	assert.deepEqual(
		validateCandidate(JSON.parse(JSON.stringify(nightly))),
		nightly,
	);
	const promotion = {
		channel: "nightly",
		commit,
		version: nightly.candidate.version,
		tag: nightly.candidate.tag,
		manifestSha256: "c".repeat(64),
		releaseId: 4,
	};
	const stable = freezeCandidate({
		...args,
		channel: "stable",
		version: "1.0.0",
		promotion,
	});
	assert.equal(stable.candidate.commit, commit);
	assert.notEqual(stable.digest, nightly.digest);
	for (const change of [
		{ commit: "c".repeat(40) },
		{ workflowSha: commit },
		{ version: "1.0.1" },
		{ recipe: { ...stable.candidate.recipe, versionOverride: "1.0.1" } },
	])
		assert.throws(() =>
			validateCandidate({
				...stable,
				candidate: { ...stable.candidate, ...change },
			}),
		);
	assert.throws(
		() => freezeCandidate({ ...args, channel: "stable", version: "1.0.0" }),
		/verified published nightly/,
	);
	assert.throws(
		() => freezeCandidate({ ...args, date: "2026-02-31T00:00:00Z" }),
		/UTC date/,
	);
	assert.throws(() => freezeCandidate({ ...args, sequence: 0 }), /sequence/);
});
test("nightly eligibility uses successful publication time by default", () => {
	const now = Date.parse("2026-10-09T06:00:00Z");
	const last = { commit: "c".repeat(40), publishedAt: "2026-10-09T00:00:00Z" };
	const base = { mainSha: commit, last, isDescendant: true, now };
	assert.equal(nightlyEligibility({ ...base, last: null }).status, "eligible");
	assert.equal(
		nightlyEligibility({ ...base, now: now - 1 }).status,
		"cooldown",
	);
	assert.equal(nightlyEligibility(base).status, "eligible");
	assert.equal(
		nightlyEligibility({ ...base, mainSha: last.commit }).status,
		"unchanged",
	);
	assert.equal(
		nightlyEligibility({ ...base, candidateSha: "d".repeat(40) }).status,
		"stale",
	);
	assert.equal(
		nightlyEligibility({ ...base, isDescendant: false }).status,
		"stale",
	);
	assert.equal(
		nightlyEligibility({ ...base, last: { ...last, publishedAt: "invalid" } })
			.status,
		"blocked",
	);
});
test("an explicit cooldown override skips only elapsed time", () => {
	const last = { commit: "c".repeat(40), publishedAt: "2026-10-09T00:00:00Z" };
	const base = {
		mainSha: commit,
		last,
		isDescendant: true,
		now: Date.parse("2026-10-09T01:00:00Z"),
		skipCooldown: true,
	};
	assert.equal(nightlyEligibility(base).status, "eligible");
	for (const [change, status] of [
		[{ skipCooldown: false }, "cooldown"],
		[{ skipCooldown: "true" }, "blocked"],
		[{ mainSha: last.commit }, "unchanged"],
		[{ candidateSha: "d".repeat(40) }, "stale"],
		[{ isDescendant: false }, "stale"],
		[{ last: { ...last, publishedAt: "invalid" } }, "blocked"],
		[{ last: { ...last, publishedAt: "2026-10-09T02:00:00Z" } }, "blocked"],
	])
		assert.equal(nightlyEligibility({ ...base, ...change }).status, status);
});
test("cooldown override is digest-bound and requires the original manual allocation", () => {
	const ordinary = freezeCandidate(args);
	const overridden = freezeCandidate({ ...args, skipCooldown: true });
	assert.equal(ordinary.candidate.skipCooldown, undefined);
	assert.notEqual(ordinary.digest, overridden.digest);
	const request = {
		id: args.sequence,
		event: "workflow_dispatch",
		path: ".github/workflows/release-channel.yml",
		head_sha: workflowSha,
		repository: { full_name: "jappyjan/bobs-factory" },
		head_repository: { full_name: "jappyjan/bobs-factory" },
	};
	assert.equal(validateCooldownOverride(overridden, request), true);
	assert.equal(validateCooldownOverride(ordinary, undefined), false);
	for (const change of [
		{ event: "schedule" },
		{ event: "workflow_run" },
		{ id: 11 },
		{ head_sha: commit },
		{ path: ".github/workflows/binary-build.yml" },
		{ head_repository: { full_name: "foreign/fork" } },
		{ repository: { full_name: "foreign/fork" } },
	])
		assert.throws(
			() => validateCooldownOverride(overridden, { ...request, ...change }),
			/original manual/,
		);
	for (const skipCooldown of [false, "true", 1]) {
		const changed = { ...ordinary.candidate, skipCooldown };
		assert.throws(
			() =>
				validateCandidate({
					candidate: changed,
					digest: candidateDigest(changed),
				}),
			/override/,
		);
	}
	assert.throws(
		() =>
			freezeCandidate({
				...args,
				channel: "beta",
				version: "1.0.1-beta",
				skipCooldown: true,
			}),
		/only for nightly/,
	);
});
test("manual override retries preserve the frozen choice and reject scheduled or changed inputs", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-cooldown-retry-"));
	try {
		const candidate = freezeCandidate({ ...args, skipCooldown: true });
		const output = join(work, "candidate.json");
		const bytes = JSON.stringify(candidate);
		writeFileSync(output, bytes);
		const run = (event, extra = []) =>
			spawnSync(
				process.execPath,
				[
					"scripts/prepare-release-candidate.mjs",
					"--channel",
					"nightly",
					"--workflow-sha",
					workflowSha,
					"--output",
					output,
					...extra,
				],
				{ encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: event } },
			);
		assert.equal(run("workflow_dispatch", ["--skip-cooldown"]).status, 0);
		assert.match(run("workflow_dispatch").stderr, /Retry inputs differ/);
		assert.match(run("schedule", ["--skip-cooldown"]).stderr, /manual nightly/);
		assert.equal(readFileSync(output, "utf8"), bytes);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
test("stable defaults exclude nightlies and nightly ordering survives a core-version change", () => {
	const r = (version) => ({
		tag_name: `v${version}`,
		draft: false,
		prerelease: version.includes("-"),
		assets: [{ name: "release.json" }],
	});
	const a = r("9.0.0-nightly.20261009.10"),
		b = r("1.0.0-nightly.20261009.11"),
		beta = r("1.0.0-beta"),
		stable = r("1.0.0");
	assert.equal(selectPublicRelease([a, b, beta]), beta);
	assert.equal(selectPublicRelease([a, b, beta], "nightly"), b);
	assert.equal(selectPublicRelease([a, b]), null);
	assert.equal(selectPublicRelease([a, b, beta, stable]), stable);
	assert.equal(compareReleaseVersions("1.0.0", "1.0.0-nightly.20261009.10"), 1);
});
test("native build provenance binds separate workflow SHA and candidate artifact identity", () => {
	const c = freezeCandidate(args),
		identity = candidateIdentity(c, 123);
	const run = {
		id: 123,
		status: "completed",
		conclusion: "success",
		repository: { full_name: REPOSITORY },
		head_repository: { full_name: REPOSITORY },
		head_sha: workflowSha,
		path: ".github/workflows/binary-build.yml",
		event: "workflow_dispatch",
	};
	const jobs = TARGETS.map((t) => ({
		name: `binary (${t})`,
		status: "completed",
		conclusion: "success",
	}));
	const artifacts = TARGETS.map((t) => ({
		name: `bobs-factory-${t}-${c.digest}-1`,
		expired: false,
		digest: `sha256:${"d".repeat(64)}`,
		workflow_run: { id: 123, head_sha: workflowSha },
	}));
	assert.equal(
		Object.keys(validateBuildProvenance(run, jobs, artifacts, identity)).length,
		4,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				{ ...run, head_sha: commit },
				jobs,
				artifacts,
				identity,
			),
		/Workflow source/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				run,
				jobs,
				[{ ...artifacts[0], name: "stable-artifact" }, ...artifacts.slice(1)],
				identity,
			),
		/candidate artifact/,
	);
});

test("stable preparation retries retain the selected nightly and reject changed selection", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-candidate-retry-"));
	try {
		const promotion = {
			channel: "nightly",
			commit,
			version: "1.0.0-nightly.20261009.9",
			tag: "v1.0.0-nightly.20261009.9",
			manifestSha256: "c".repeat(64),
			releaseId: 4,
		};
		const candidate = freezeCandidate({
			...args,
			channel: "stable",
			version: "1.0.0",
			promotion,
		});
		const output = join(work, "candidate.json");
		const bytes = JSON.stringify(candidate);
		writeFileSync(output, bytes);
		const run = (...extra) =>
			spawnSync(
				process.execPath,
				[
					"scripts/prepare-release-candidate.mjs",
					"--channel",
					"stable",
					"--version",
					"1.0.0",
					"--workflow-sha",
					workflowSha,
					"--output",
					output,
					...extra,
				],
				{ encoding: "utf8" },
			);
		const retained = run("--nightly-tag", promotion.tag);
		assert.equal(retained.status, 0, retained.stderr);
		assert.match(retained.stdout, /Retained frozen candidate/);
		assert.notEqual(run().status, 0);
		const changed = run("--nightly-tag", "v1.0.0-nightly.20261009.10");
		assert.notEqual(changed.status, 0);
		assert.match(changed.stderr, /Retry inputs differ/);
		assert.equal(readFileSync(output, "utf8"), bytes);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test("beta freezes explicit version and retry rejects changed version without nightly allocation", () => {
	const candidate = freezeCandidate({
		...args,
		channel: "beta",
		version: "1.0.1-beta",
	});
	assert.equal(candidate.candidate.version, "1.0.1-beta");
	assert.equal(candidate.candidate.channel, "beta");
	assert.equal(candidate.candidate.sequence, undefined);
	assert.equal(candidate.candidate.promotion, undefined);
	const sequenced = { ...candidate.candidate, sequence: 10 };
	assert.throws(
		() =>
			validateCandidate({
				candidate: sequenced,
				digest: candidateDigest(sequenced),
			}),
		/Beta is an explicit frozen source/,
	);
	assert.throws(
		() => freezeCandidate({ ...args, channel: "beta", version: "1.0.1" }),
		/mismatch/,
	);
	const work = mkdtempSync(join(tmpdir(), "factory-beta-retry-"));
	try {
		const output = join(work, "candidate.json"),
			bytes = JSON.stringify(candidate);
		writeFileSync(output, bytes);
		const run = (version) =>
			spawnSync(
				process.execPath,
				[
					"scripts/prepare-release-candidate.mjs",
					"--channel",
					"beta",
					"--version",
					version,
					"--workflow-sha",
					workflowSha,
					"--output",
					output,
				],
				{ encoding: "utf8" },
			);
		const retained = run("1.0.1-beta");
		assert.equal(retained.status, 0, retained.stderr);
		assert.match(run("1.0.2-beta").stderr, /Retry inputs differ/);
		assert.equal(readFileSync(output, "utf8"), bytes);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
