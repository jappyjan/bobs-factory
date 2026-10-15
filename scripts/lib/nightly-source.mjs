// Accepted source inputs stay historical; only the new Git source, tooling and
// measured native correspondence acquire the new candidate identity.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	sha256,
	TARGETS,
} from "./binary-release.mjs";
import { candidateIdentity, canonical } from "./release-candidate.mjs";
import { validateSourceMaterials } from "./release-material.mjs";

// A published derived bundle retains the original material inventory and bytes.
// Recover those exact inputs, not the gzip/tar container whose temporary host
// may have disappeared. Every recovered member must match its original hash.
export function recoverAcceptedMaterials(directory, baseline) {
	const reuse = JSON.parse(
		readFileSync(join(directory, "nightly-source-reuse.json")),
	);
	const recordIdentity = ({ file, size, sha256 }) => ({ file, size, sha256 });
	requireValue(
		reuse.mode === "CI-derived-nightly" &&
			canonical(reuse.baseline?.candidate) === canonical(baseline.candidate) &&
			reuse.baseline.acceptedBy === baseline.acceptedBy &&
			canonical(recordIdentity(reuse.baseline.source)) ===
				canonical(recordIdentity(baseline.source)) &&
			canonical(recordIdentity(reuse.baseline.receiptArchive)) ===
				canonical(recordIdentity(baseline.receiptArchive)) &&
			Object.entries(baseline.receipts).every(
				([gate, record]) =>
					canonical(recordIdentity(reuse.baseline.receipts?.[gate] ?? {})) ===
					canonical(recordIdentity(record)),
			),
		"Published source does not retain the accepted nightly baseline",
	);
	const materials = reuse.previousMaterials;
	for (const record of materials.records) {
		requireValue(
			/^[A-Za-z0-9_.-]+$/.test(record.file),
			"Unsafe retained material filename",
		);
		const path = join(directory, record.file);
		const matches = (bytes) =>
			bytes.length === record.size && sha256(bytes) === record.sha256;
		const bytes = readFileSync(path);
		if (matches(bytes)) continue;
		let restored;
		if (record.kind === "build-config") {
			const build = materials.builds.find((b) => b.target === record.target);
			// Serialization is transport, not acceptance: accept only the exact
			// already inventoried bytes, regardless of original JSON whitespace.
			restored = [
				jsonBytes(build),
				Buffer.from(JSON.stringify(build)),
				Buffer.from(JSON.stringify(build, null, 2)),
			].find(matches);
		} else if (
			record.kind === "relink-log" &&
			bytes.toString().startsWith("Current CI source assembly ")
		) {
			restored = bytes.subarray(bytes.indexOf(10) + 1);
		} else if (record.kind === "instructions") {
			const marker = Buffer.from("## Retained historical instructions\n\n");
			const start = bytes.indexOf(marker);
			if (start >= 0) restored = bytes.subarray(start + marker.length);
		}
		requireValue(
			restored && matches(restored),
			`Original accepted source member unavailable or changed: ${record.file}`,
		);
		writeFileSync(path, restored);
	}
	validateSourceMaterials(
		materials,
		directory,
		candidateIdentity(baseline.candidate),
	);
	writeFileSync(join(directory, "source-materials.json"), jsonBytes(materials));
	return materials;
}

export function verifyDependencyBaseline(
	root,
	baselineCommit,
	candidateCommit,
	reviews = [],
) {
	requireValue(Array.isArray(reviews), "Dependency reviews must be an array");
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
	// Reviews extend coverage for exact removed inputs, never the sealed baseline.
	// Hashes bind the complete two revisions; additions, changed pins and license
	// edits still need new source material rather than a removal review.
	const reviewedRemoval = (file) => {
		if (file !== "pnpm-lock.yaml" && !file.endsWith("package.json")) return;
		const before = git(["show", `${baselineCommit}:${file}`]);
		const after = git(["show", `${candidateCommit}:${file}`]);
		const matches = reviews.filter((review) => {
			const record = review.files?.find((record) => record.file === file);
			return (
				review.schemaVersion === 1 &&
				review.baselineCommit === baselineCommit &&
				/^[a-f0-9]{40}$/.test(review.commit) &&
				typeof review.reviewedBy === "string" &&
				review.reviewedBy.trim() &&
				typeof review.scope === "string" &&
				review.scope.trim() &&
				record?.beforeSha256 === sha256(before) &&
				record.afterSha256 === sha256(after)
			);
		});
		if (matches.length !== 1) return;
		const review = matches[0];
		if (
			git(["merge-base", review.commit, candidateCommit]).trim() !==
				review.commit ||
			git(["show", `${review.commit}:${file}`]) !== after
		)
			return;
		const [added, removed] = git([
			"diff",
			"--numstat",
			baselineCommit,
			review.commit,
			"--",
			file,
		])
			.trim()
			.split("\t");
		if (added !== "0" || !/^\d+$/.test(removed) || Number(removed) === 0)
			return;
		if (file.endsWith("package.json")) {
			const old = JSON.parse(before),
				current = JSON.parse(after);
			const dependencies = new Set([
				"dependencies",
				"devDependencies",
				"optionalDependencies",
				"peerDependencies",
			]);
			for (const key of new Set([
				...Object.keys(old),
				...Object.keys(current),
			])) {
				if (dependencies.has(key)) {
					if (
						!Object.entries(current[key] ?? {}).every(
							([name, value]) =>
								canonical(old[key]?.[name]) === canonical(value),
						)
					)
						return;
				} else if (
					canonical(old[key] ?? null) !== canonical(current[key] ?? null)
				)
					return;
			}
		}
		return review;
	};
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
		const review =
			select(baselineCommit) === select(candidateCommit)
				? undefined
				: reviewedRemoval(file);
		requireValue(
			select(baselineCommit) === select(candidateCommit) || review,
			`Uncovered dependency/license change: ${file}; update accepted nightly baseline`,
		);
		observations.push({
			file,
			baseline: git(["rev-parse", `${baselineCommit}:${file}`]).trim(),
			current: git(["rev-parse", `${candidateCommit}:${file}`]).trim(),
			...(review ? { review } : {}),
		});
	}
	return observations;
}

export function nativeNoticeMaterialName(materials, identity, target) {
	requireValue(
		TARGETS.includes(target) && /^[a-f0-9]{64}$/.test(identity.candidateDigest),
		"Native notices require a frozen candidate and target",
	);
	const file = `native-notices-${target}-${identity.candidateDigest}.tar.gz`;
	requireValue(
		!materials.records.some((record) => record.file === file),
		"Current native notices would overwrite retained material",
	);
	return file;
}

export function rebindSourceMaterials(
	materials,
	directory,
	identity,
	bindings,
	provenance,
	currentRecords = [],
) {
	requireValue(
		bindings.length === TARGETS.length &&
			TARGETS.every((t) => bindings.filter((b) => b.target === t).length === 1),
		"All four actual Bun byte bindings required",
	);
	const prior = structuredClone(materials);
	// Fresh candidate notices are not part of the accepted historical inventory.
	materials.records.push(...currentRecords);
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
