import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileRecord, TARGETS } from "../lib/binary-release.mjs";
import {
	nativeNoticeMaterialName,
	rebindSourceMaterials,
	recoverAcceptedMaterials,
	verifyDependencyBaseline,
} from "../lib/nightly-source.mjs";
import {
	candidateIdentity,
	freezeCandidate,
} from "../lib/release-candidate.mjs";
import { validateSourceMaterials } from "../lib/release-material.mjs";
import { sourceMaterialFixture } from "./source-material-fixture.mjs";

test("nightly source policy allows app/version changes but refuses changed dependencies, notices or uncovered material inventory", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-nightly-policy-"));
	try {
		const git = (...args) =>
			execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
		git("init", "-q");
		git("config", "user.name", "Controlled fixture");
		git("config", "user.email", "fixture@example.invalid");
		mkdirSync(join(work, "docs/distribution/licenses"), { recursive: true });
		const manifest = (version, dependency = "1.0.0") =>
			JSON.stringify({ version, dependencies: { library: dependency } });
		writeFileSync(join(work, "package.json"), manifest("1.0.0"));
		writeFileSync(join(work, "pnpm-lock.yaml"), "controlled lock");
		writeFileSync(
			join(work, "docs/distribution/licenses/license.txt"),
			"controlled notice",
		);
		writeFileSync(join(work, "app.js"), "original app");
		const commit = () => {
			git("add", ".");
			return git(
				"commit-tree",
				git("write-tree"),
				"-m",
				"Controlled fixture tree",
			);
		};
		const baseline = commit();
		writeFileSync(join(work, "package.json"), manifest("1.0.1"));
		writeFileSync(join(work, "app.js"), "changed app");
		assert.equal(verifyDependencyBaseline(work, baseline, commit()).length, 3);
		writeFileSync(join(work, "package.json"), manifest("1.0.1", "2.0.0"));
		assert.throws(
			() => verifyDependencyBaseline(work, baseline, commit()),
			/Uncovered dependency/,
		);
		writeFileSync(join(work, "package.json"), manifest("1.0.1"));
		writeFileSync(
			join(work, "docs/distribution/licenses/license.txt"),
			"changed license",
		);
		assert.throws(
			() => verifyDependencyBaseline(work, baseline, commit()),
			/Uncovered dependency/,
		);
		writeFileSync(
			join(work, "docs/distribution/licenses/license.txt"),
			"controlled notice",
		);
		writeFileSync(join(work, "pnpm-lock.yaml"), "changed lock");
		assert.throws(
			() => verifyDependencyBaseline(work, baseline, commit()),
			/Uncovered dependency/,
		);
		writeFileSync(join(work, "pnpm-lock.yaml"), "controlled lock");
		writeFileSync(
			join(work, "docs/distribution/licenses/extra.txt"),
			"extra notice",
		);
		assert.throws(
			() => verifyDependencyBaseline(work, baseline, commit()),
			/inventory changed/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test("shipped desktop/native/npm notice inputs and package license declarations refuse baseline reuse while package versions remain allowed", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-nightly-shipped-license-"));
	try {
		const git = (...args) =>
			execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
		git("init", "-q");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.invalid");
		const shipped = [
			"LICENSE",
			"NOTICE",
			"apps/desktop/LICENSE",
			"apps/desktop/NOTICE",
			"distribution/npm/bobs-factory-trial/LICENSE",
		];
		for (const name of shipped) {
			mkdirSync(join(work, name, ".."), { recursive: true });
			writeFileSync(join(work, name), `Controlled ${name}`);
		}
		const path = join(work, "apps/desktop/package.json"),
			original = {
				version: "1.0.0",
				license: "Apache-2.0",
				devDependencies: { electron: "44.7.0" },
			};
		writeFileSync(path, JSON.stringify(original));
		const commit = () => {
			git("add", ".");
			return git(
				"commit-tree",
				git("write-tree"),
				"-m",
				"Controlled notice tree",
			);
		};
		const baseline = commit();
		writeFileSync(path, JSON.stringify({ ...original, version: "1.0.1" }));
		verifyDependencyBaseline(work, baseline, commit());
		writeFileSync(path, JSON.stringify(original));
		for (const name of shipped) {
			const before = readFileSync(join(work, name));
			writeFileSync(join(work, name), "Changed redistribution terms");
			assert.throws(
				() => verifyDependencyBaseline(work, baseline, commit()),
				/update accepted nightly baseline/,
				name,
			);
			writeFileSync(join(work, name), before);
		}
		writeFileSync(path, JSON.stringify({ ...original, license: "MPL-2.0" }));
		assert.throws(
			() => verifyDependencyBaseline(work, baseline, commit()),
			/update accepted nightly baseline/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test("candidate source assembly preserves real historical input identities and requires complete exact native-base correspondence", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-nightly-materials-"));
	try {
		const candidate = (commit, sequence) =>
			freezeCandidate({
				channel: "nightly",
				commit,
				workflowSha: commit,
				committedVersion: "1.0.0",
				sequence,
				date: "2026-10-12T00:00:00Z",
			});
		const old = candidateIdentity(candidate("a".repeat(40), 1)),
			current = candidateIdentity(candidate("b".repeat(40), 2));
		const material = sourceMaterialFixture(work, old),
			original = structuredClone(material);
		const bindings = TARGETS.map((target) => ({
			target,
			baseSha256: "1".repeat(64),
			factorySha256: "3".repeat(64),
			entireReconstructedExecutableMatches: true,
		}));
		assert.throws(
			() =>
				rebindSourceMaterials(
					structuredClone(material),
					work,
					current,
					bindings.slice(1),
					{},
				),
			/All four/,
		);
		assert.throws(
			() =>
				rebindSourceMaterials(
					structuredClone(material),
					work,
					current,
					bindings.map((b) => ({ ...b, baseSha256: "f".repeat(64) })),
					{},
				),
			/Uncovered Bun/,
		);
		assert.throws(
			() =>
				rebindSourceMaterials(
					structuredClone(material),
					work,
					current,
					bindings.map((b) => ({
						...b,
						entireReconstructedExecutableMatches: false,
					})),
					{},
				),
			/Uncovered Bun/,
		);
		rebindSourceMaterials(material, work, current, bindings, {
			mode: "controlled fixture, never release evidence",
		});
		validateSourceMaterials(material, work, current);
		assert.equal(material.candidateDigest, current.candidateDigest);
		for (const build of material.builds) {
			assert.deepEqual(
				build.previousCandidateBinding,
				original.builds.find((b) => b.target === build.target),
			);
			assert.equal(build.executableSha256, "3".repeat(64));
			assert.match(build.bindingScope, /no fresh relink/);
		}
		for (const record of material.records.filter((r) => r.kind === "objects")) {
			const before = original.records.find((r) => r.file === record.file);
			assert.deepEqual(record.originalMaterialRecord, before);
			assert.equal(record.sha256, before.sha256);
			assert.equal(record.revision, current.commit);
			assert.deepEqual(fileRecord(join(work, record.file), record.file), {
				file: record.file,
				size: before.size,
				sha256: before.sha256,
			});
		}
		assert.match(
			readFileSync(
				join(work, material.records.find((r) => r.kind === "relink-log").file),
				"utf8",
			),
			/retained historical relink evidence, not a new relink/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test("fresh native notices coexist with retained legacy notice names without changing historical bytes or provenance", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-nightly-notice-collision-"));
	try {
		const frozen = (commit, sequence) =>
			freezeCandidate({
				channel: "nightly",
				commit,
				workflowSha: commit,
				committedVersion: "1.0.0",
				sequence,
				date: "2026-10-12T00:00:00Z",
			});
		const old = candidateIdentity(frozen("a".repeat(40), 1));
		const current = candidateIdentity(frozen("b".repeat(40), 2));
		const materials = sourceMaterialFixture(work, old);
		const record = (file, identity, target) => ({
			kind: "candidate-notices",
			...fileRecord(join(work, file), file),
			source: `https://github.com/jappyjan/bobs-factory/commit/${identity.commit}`,
			revision: identity.commit,
			target,
		});
		const historical = TARGETS.map((target) => {
			const file = `native-notices-${target}.tar.gz`;
			writeFileSync(join(work, file), `Historical notice bytes ${target}`);
			return record(file, old, target);
		});
		materials.records.push(...historical);
		const original = JSON.parse(JSON.stringify(materials));
		const fresh = TARGETS.map((target) => {
			const file = nativeNoticeMaterialName(materials, current, target);
			writeFileSync(join(work, file), `Current notice bytes ${target}`);
			return record(file, current, target);
		});
		rebindSourceMaterials(
			materials,
			work,
			current,
			TARGETS.map((target) => ({
				target,
				baseSha256: "1".repeat(64),
				factorySha256: "3".repeat(64),
				entireReconstructedExecutableMatches: true,
			})),
			{ mode: "controlled fixture, never release evidence" },
			fresh,
		);
		validateSourceMaterials(materials, work, current);
		assert.deepEqual(
			JSON.parse(readFileSync(join(work, "nightly-source-reuse.json")))
				.previousMaterials,
			original,
		);
		for (const before of historical) {
			assert.deepEqual(
				materials.records.find((r) => r.file === before.file),
				before,
			);
			assert.equal(
				fileRecord(join(work, before.file), before.file).sha256,
				before.sha256,
			);
		}
		assert.throws(
			() => nativeNoticeMaterialName(materials, current, TARGETS[0]),
			/overwrite retained/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});

test("published source recovers exact accepted members without the expired archive host and refuses changed bytes or acceptance", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-retained-materials-"));
	try {
		const frozen = (sha, sequence) =>
			freezeCandidate({
				channel: "nightly",
				commit: sha.repeat(40),
				workflowSha: sha.repeat(40),
				committedVersion: "1.0.0",
				sequence,
				date: "2026-10-12T00:00:00Z",
			});
		const accepted = frozen("a", 1),
			current = frozen("b", 2);
		const material = sourceMaterialFixture(work, candidateIdentity(accepted));
		const original = structuredClone(material);
		const baseline = {
			candidate: accepted,
			acceptedBy: "controlled fixture, never release acceptance",
			source: {
				file: "source-rebuild.tar.gz",
				size: 1,
				sha256: "a".repeat(64),
			},
			receiptArchive: {
				file: "validation-receipts.tar.gz",
				size: 1,
				sha256: "b".repeat(64),
			},
			receipts: {},
		};
		rebindSourceMaterials(
			material,
			work,
			candidateIdentity(current),
			TARGETS.map((target) => ({
				target,
				baseSha256: "1".repeat(64),
				factorySha256: "3".repeat(64),
				entireReconstructedExecutableMatches: true,
			})),
			{ mode: "CI-derived-nightly", baseline },
		);
		assert.throws(
			() =>
				recoverAcceptedMaterials(work, {
					...baseline,
					acceptedBy: "different acceptance",
				}),
			/does not retain/,
		);
		assert.deepEqual(
			recoverAcceptedMaterials(work, baseline),
			JSON.parse(JSON.stringify(original)),
		);
		for (const record of original.records)
			assert.equal(
				fileRecord(join(work, record.file), record.file).sha256,
				record.sha256,
			);
		const object = original.records.find((r) => r.kind === "objects");
		writeFileSync(join(work, object.file), "tampered original objects");
		assert.throws(
			() => recoverAcceptedMaterials(work, baseline),
			/unavailable or changed/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
