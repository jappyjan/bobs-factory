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
	rebindSourceMaterials,
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
