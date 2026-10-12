// Accepted source inputs stay historical; only the new Git source, tooling and
// measured native correspondence acquire the new candidate identity.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	TARGETS,
} from "./binary-release.mjs";
import { canonical } from "./release-candidate.mjs";

export function verifyDependencyBaseline(
	root,
	baselineCommit,
	candidateCommit,
) {
	const git = (args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 16 * 1024 ** 2,
		});
	const files = (commit) =>
		git(["ls-tree", "-r", "--name-only", commit]).trim().split("\n");
	const protectedFile = (f) =>
		f === "pnpm-lock.yaml" ||
		f === "pnpm-workspace.yaml" ||
		f.endsWith("/package.json") ||
		f === "package.json" ||
		f.startsWith("docs/distribution/licenses/") ||
		[
			"LICENSE",
			"NOTICE",
			"apps/desktop/LICENSE",
			"apps/desktop/NOTICE",
			"distribution/npm/bobs-factory-trial/LICENSE",
		].includes(f);
	const before = files(baselineCommit).filter(protectedFile),
		after = files(candidateCommit).filter(protectedFile);
	requireValue(
		canonical(before) === canonical(after),
		"Dependency/license inventory changed; update accepted nightly baseline",
	);
	const observations = [];
	for (const file of before) {
		const select = (commit) => {
			const bytes = git(["show", `${commit}:${file}`]);
			if (!file.endsWith("package.json")) return bytes;
			const p = JSON.parse(bytes);
			return canonical(
				Object.fromEntries(
					[
						"license",
						"dependencies",
						"devDependencies",
						"optionalDependencies",
						"peerDependencies",
						"overrides",
						"pnpm",
						"engines",
						"packageManager",
					].map((k) => [k, p[k] ?? null]),
				),
			);
		};
		requireValue(
			select(baselineCommit) === select(candidateCommit),
			`Uncovered dependency/license change: ${file}; update accepted nightly baseline`,
		);
		observations.push({
			file,
			baseline: git(["rev-parse", `${baselineCommit}:${file}`]).trim(),
			current: git(["rev-parse", `${candidateCommit}:${file}`]).trim(),
		});
	}
	return observations;
}

export function rebindSourceMaterials(
	materials,
	directory,
	identity,
	bindings,
	provenance,
) {
	requireValue(
		bindings.length === TARGETS.length &&
			TARGETS.every((t) => bindings.filter((b) => b.target === t).length === 1),
		"All four actual Bun byte bindings required",
	);
	const prior = structuredClone(materials);
	for (const build of materials.builds) {
		const binding = bindings.find((b) => b.target === build.target);
		requireValue(
			binding.baseSha256 === build.runtimeSha256 &&
				/^[a-f0-9]{64}$/.test(binding.factorySha256) &&
				(binding.entireReconstructedExecutableMatches === true ||
					(build.target === "darwin-arm64" &&
						binding.allBytesOutsidePayloadAndSignatureMatch === true &&
						binding.completeSignatureAccountedForByVerifiedMetadataAndPageHashes ===
							true &&
						binding.allAdHocSignatureCodePageHashesMatch === true)),
			"Uncovered Bun/object correspondence; update accepted nightly baseline",
		);
		build.previousCandidateBinding = structuredClone(build);
		Object.assign(build, {
			commit: identity.commit,
			version: identity.version,
			candidateDigest: identity.candidateDigest,
			executableSha256: binding.factorySha256,
			bindingScope:
				"CI measured exact unchanged Bun bytes. Compiler/objects/relink observations remain historical; no fresh relink claimed.",
		});
		const config = materials.records.find(
				(r) => r.kind === "build-config" && r.target === build.target,
			),
			log = materials.records.find(
				(r) => r.kind === "relink-log" && r.target === build.target,
			);
		writeFileSync(join(directory, config.file), jsonBytes(build));
		writeFileSync(
			join(directory, log.file),
			`Current CI source assembly ${identity.candidateDigest}. Actual unchanged runtime correspondence is in nightly-source-reuse.json. Following log is retained historical relink evidence, not a new relink:\n${readFileSync(join(directory, log.file), "utf8")}`,
		);
	}
	for (const record of materials.records) {
		if (["objects", "build-config", "relink-log"].includes(record.kind)) {
			record.originalMaterialRecord = structuredClone(record);
			record.revision = identity.commit;
			record.bindingScope =
				"Current assembly correspondence; original input source/bytes and observations retained.";
		}
		Object.assign(
			record,
			fileRecord(join(directory, record.file), record.file),
		);
	}
	const instructions = materials.records.find((r) => r.kind === "instructions");
	const priorInstructions = readFileSync(
		join(directory, instructions.file),
		"utf8",
	);
	instructions.originalMaterialRecord = structuredClone(instructions);
	instructions.revision = identity.commit;
	writeFileSync(
		join(directory, instructions.file),
		`# Current nightly source assembly\n\nCandidate ${identity.candidateDigest}, source ${identity.commit}, tooling ${identity.workflowSha}, version ${identity.version}. Fresh full source/tooling archives are supplied. Build from clean checkouts using the frozen lockfile and candidate version override:\n\n bun run scripts/build-binary.ts --source-root CLEAN_SOURCE --candidate candidate.json --release-version ${identity.version} --target TARGET --output NEW_OUTPUT\n\nnightly-source-reuse.json contains measured full-byte native correspondence with the accepted unchanged Bun/object baseline. All compiler, relink and physical acceptance observations below remain historical; none are represented as newly executed.\n\n## Retained historical instructions\n\n${priorInstructions}`,
	);
	Object.assign(
		instructions,
		fileRecord(join(directory, instructions.file), instructions.file),
	);
	const file = "nightly-source-reuse.json";
	writeFileSync(
		join(directory, file),
		jsonBytes({ ...provenance, identity, bindings, previousMaterials: prior }),
	);
	materials.records.push({
		kind: "current-candidate-provenance",
		...fileRecord(join(directory, file), file),
		source: `https://github.com/jappyjan/bobs-factory/commit/${identity.commit}`,
		revision: identity.commit,
	});
	delete materials.bundled;
	Object.assign(materials, {
		commit: identity.commit,
		version: identity.version,
		workflowSha: identity.workflowSha,
		candidateDigest: identity.candidateDigest,
		baselineReuse: {
			candidateDigest: prior.candidateDigest,
			commit: prior.commit,
			scope:
				"Accepted unchanged sources/notices/objects; fresh full Git source/tooling and native provider observations.",
		},
	});
	writeFileSync(join(directory, "source-materials.json"), jsonBytes(materials));
	return materials;
}
