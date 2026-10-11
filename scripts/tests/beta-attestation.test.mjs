import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	fileRecord,
	jsonBytes,
	sha256,
	validateArchive,
	validateEvidence,
	validateNativeHelpers,
	validateReleaseManifest,
} from "../lib/binary-release.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { fixtureTar } from "./source-material-fixture.mjs";

test("historical beta inventory validates old bytes and emits only additive integrity", () => {
	const f = preparedFixture("beta", { legacy: true });
	try {
		const legacy = f.manifest;
		const immutable = new Map(
			readdirSync(f.assets).map((file) => [
				file,
				readFileSync(join(f.assets, file)),
			]),
		);
		const inventory = readdirSync(f.assets)
			.filter(
				(file) =>
					!["release.json", "release.json.sig", "release.json.key-id"].includes(
						file,
					),
			)
			.map((file) => fileRecord(join(f.assets, file), file))
			.sort((a, b) => a.file.localeCompare(b.file));
		const approval = join(f.work, "approval.json"),
			output = join(f.work, "authentication");
		const call = () =>
			spawnSync(
				process.execPath,
				[
					join(f.work, "scripts/prepare-beta-attestation.mjs"),
					"--assets",
					f.assets,
					"--output",
					output,
					"--approval",
					approval,
				],
				{
					encoding: "utf8",
				},
			);
		writeFileSync(
			approval,
			JSON.stringify({
				manifestSha256: "f".repeat(64),
				assetsDigest: sha256(jsonBytes(inventory)),
				approvedBy: "fixture",
			}),
		);
		assert.notEqual(call().status, 0);
		writeFileSync(
			approval,
			JSON.stringify({
				manifestSha256: sha256(jsonBytes(legacy)),
				assetsDigest: sha256(jsonBytes(inventory)),
				approvedBy: "fixture",
			}),
		);
		const result = call();
		assert.equal(result.status, 0, result.stderr);
		for (const [file, bytes] of immutable)
			assert.deepEqual(readFileSync(join(f.assets, file)), bytes);
		assert.deepEqual(readdirSync(output).sort(), ["release-attestation.json"]);
		const att = readFileSync(join(output, "release-attestation.json"));
		assert.equal(JSON.parse(att).manifest.sha256, sha256(jsonBytes(legacy)));
	} finally {
		f.cleanup();
	}
});

test("legacy identity rejects new manifest, evidence and source claims without rewriting old bytes", () => {
	const f = preparedFixture("beta", { legacy: true });
	try {
		const manifestBytes = readFileSync(join(f.assets, "release.json"));
		const evidenceBytes = readFileSync(join(f.assets, "release-evidence.json"));
		const legacyIdentity = {
			version: f.manifest.version,
			commit: f.manifest.commit,
			runId: f.manifest.buildRunId,
		};
		const evidence = JSON.parse(evidenceBytes);
		const receiptDirectory = join(f.work, "receipts");
		mkdirSync(receiptDirectory);
		writeFileSync(
			join(receiptDirectory, "receipt.txt"),
			readFileSync(join(f.work, "receipt.txt")),
		);
		copyFileSync(
			join(f.assets, "source-rebuild.tar.gz"),
			join(receiptDirectory, "source-rebuild.tar.gz"),
		);
		validateEvidence(evidence, receiptDirectory, legacyIdentity);
		for (const value of [f.candidate.digest, "invalid", null]) {
			assert.throws(
				() =>
					validateReleaseManifest({ ...f.manifest, candidateDigest: value }),
				/legacy boundary/,
			);
			assert.throws(
				() =>
					validateEvidence(
						{ ...evidence, candidateDigest: value },
						receiptDirectory,
						legacyIdentity,
					),
				/legacy boundary/,
			);
		}
		assert.throws(
			() =>
				validateEvidence(
					{ ...evidence, workflowSha: f.candidate.candidate.workflowSha },
					receiptDirectory,
					legacyIdentity,
				),
			/legacy boundary/,
		);
		assert.throws(
			() =>
				validateEvidence(evidence, receiptDirectory, {
					...legacyIdentity,
					workflowSha: f.candidate.candidate.workflowSha,
				}),
			/legacy boundary/,
		);
		assert.throws(
			() =>
				validateEvidence(
					{
						...evidence,
						targets: {
							...evidence.targets,
							"linux-x64": {
								...evidence.targets["linux-x64"],
								candidateDigest: f.candidate.digest,
							},
						},
					},
					receiptDirectory,
					legacyIdentity,
				),
			/legacy boundary/,
		);
		const target = "linux-x64";
		const archiveRecord = f.manifest.targets[target];
		const archivePath = join(f.assets, archiveRecord.archive);
		const sidecarPath = join(f.assets, archiveRecord.manifest);
		const sidecarBytes = readFileSync(sidecarPath);
		const sidecar = JSON.parse(sidecarBytes);
		writeFileSync(
			sidecarPath,
			jsonBytes({ ...sidecar, candidateDigest: f.candidate.digest }),
		);
		assert.throws(
			() => validateArchive(archivePath, sidecarPath, legacyIdentity, target),
			/legacy boundary/,
		);
		writeFileSync(sidecarPath, sidecarBytes);
		const native = JSON.parse(
			readFileSync(join(f.assets, `native-helpers-${target}.json`)),
		);
		assert.throws(
			() =>
				validateNativeHelpers(
					{ ...native, candidateDigest: f.candidate.digest },
					legacyIdentity,
					target,
					{},
				),
			/legacy boundary/,
		);
		const source = join(f.work, "source-rebuild");
		// Review's downgrade: legacy caller plus new-digest material, missing all
		// WebKit/TinyCC/native object/relink records. Inventory/hash stay internally valid.
		writeFileSync(
			join(source, "source-materials.json"),
			jsonBytes({
				schemaVersion: 1,
				candidateDigest: f.candidate.digest,
				records: [],
			}),
		);
		fixtureTar([
			"-czf",
			join(receiptDirectory, "source-rebuild.tar.gz"),
			"-C",
			f.work,
			"source-rebuild",
		]);
		const newSource = {
			...evidence,
			source: fileRecord(
				join(receiptDirectory, "source-rebuild.tar.gz"),
				"source-rebuild.tar.gz",
			),
		};
		assert.throws(
			() => validateEvidence(newSource, receiptDirectory, legacyIdentity),
			/legacy boundary/,
		);
		writeFileSync(
			join(source, "source-materials.json"),
			jsonBytes({ schemaVersion: 2, records: [] }),
		);
		fixtureTar([
			"-czf",
			join(receiptDirectory, "source-rebuild.tar.gz"),
			"-C",
			f.work,
			"source-rebuild",
		]);
		assert.throws(
			() =>
				validateEvidence(
					{
						...evidence,
						source: fileRecord(
							join(receiptDirectory, "source-rebuild.tar.gz"),
							"source-rebuild.tar.gz",
						),
					},
					receiptDirectory,
					legacyIdentity,
				),
			/source schema at legacy boundary/,
		);
		writeFileSync(join(source, "candidate.json"), jsonBytes(f.candidate));
		fixtureTar([
			"-czf",
			join(receiptDirectory, "source-rebuild.tar.gz"),
			"-C",
			f.work,
			"source-rebuild",
		]);
		assert.throws(
			() =>
				validateEvidence(
					{
						...evidence,
						source: fileRecord(
							join(receiptDirectory, "source-rebuild.tar.gz"),
							"source-rebuild.tar.gz",
						),
					},
					receiptDirectory,
					legacyIdentity,
				),
			/candidate inputs at legacy boundary/,
		);
		assert.deepEqual(
			readFileSync(join(f.assets, "release.json")),
			manifestBytes,
		);
		assert.deepEqual(
			readFileSync(join(f.assets, "release-evidence.json")),
			evidenceBytes,
		);
	} finally {
		f.cleanup();
	}
});
