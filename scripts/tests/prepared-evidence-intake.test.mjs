import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	fileRecord,
	jsonBytes,
	validateEvidence,
} from "../lib/binary-release.mjs";
import { extractEvidenceArchive } from "../lib/release-material.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { fixtureTar } from "./source-material-fixture.mjs";

test("prepared envelope reconstructs inventoried source without a duplicate root monolith, then passes unchanged semantic intake", () => {
	const f = preparedFixture("nightly", { sourceChunks: true });
	try {
		const stage = join(f.work, "release-evidence");
		mkdirSync(stage);
		cpSync(f.assets, join(stage, "assets"), { recursive: true });
		for (const name of ["candidate.json", "release-evidence.json"])
			cpSync(join(f.assets, name), join(stage, name));
		cpSync(join(f.work, "receipt.txt"), join(stage, "receipt.txt"));
		const archive = join(f.work, "envelope.tar.gz");
		const pack = () =>
			fixtureTar(["-czf", archive, "-C", f.work, "release-evidence"]);
		const options = {
			expectedCandidate: f.candidate,
			expectedIdentity: f.identity,
		};
		pack();
		const output = join(f.work, "intake");
		extractEvidenceArchive(archive, output, options);
		assert.deepEqual(
			fileRecord(join(output, f.manifest.source.file), f.manifest.source.file),
			f.manifest.source,
		);
		validateEvidence(
			JSON.parse(readFileSync(join(output, "release-evidence.json"))),
			output,
			f.identity,
		);
		assert.throws(
			() => extractEvidenceArchive(archive, output, options),
			/EEXIST/,
		);
		assert.ok(
			existsSync(join(output, "source-rebuild.tar.gz")),
			"existing outputs survive refusal",
		);
		assert.throws(
			() => extractEvidenceArchive(archive, join(f.work, "unbound")),
			/candidate/,
		);
		const rejects = (mutate, restore) => {
			mutate();
			pack();
			const dest = join(f.work, "rejected");
			assert.throws(() => extractEvidenceArchive(archive, dest, options));
			assert.equal(existsSync(join(dest, "source-rebuild.tar.gz")), false);
			assert.equal(existsSync(join(dest, "release-evidence.json")), false);
			restore();
			rmSync(dest, { recursive: true, force: true });
		};
		const manifestPath = join(stage, "assets/release.json"),
			original = readFileSync(manifestPath);
		for (const mutate of [
			(m) => {
				m.sourceTransport.chunks.reverse();
			},
			(m) => {
				m.sourceTransport.chunks[1] = m.sourceTransport.chunks[0];
			},
			(m) => {
				m.source.sha256 = "f".repeat(64);
			},
			(m) => {
				m.source.size++;
			},
			(m) => {
				m.candidateDigest = "f".repeat(64);
			},
			(m) => {
				m.buildRunId++;
			},
		])
			rejects(
				() => {
					const m = JSON.parse(original);
					mutate(m);
					writeFileSync(manifestPath, jsonBytes(m));
				},
				() => writeFileSync(manifestPath, original),
			);
		const chunk = join(
				stage,
				"assets",
				f.manifest.sourceTransport.chunks[0].file,
			),
			bytes = readFileSync(chunk);
		rejects(
			() => rmSync(chunk),
			() => writeFileSync(chunk, bytes),
		);
		rejects(
			() => {
				const b = Buffer.from(bytes);
				b[0] ^= 1;
				writeFileSync(chunk, b);
			},
			() => writeFileSync(chunk, bytes),
		);
		for (const name of [
			"candidate.json",
			"assets/candidate.json",
			"release-evidence.json",
			"assets/release-evidence.json",
		]) {
			const path = join(stage, name),
				before = readFileSync(path);
			rejects(
				() => {
					const v = JSON.parse(before);
					if (v.digest) v.digest = "f".repeat(64);
					else v.source.sha256 = "f".repeat(64);
					writeFileSync(path, jsonBytes(v));
				},
				() => writeFileSync(path, before),
			);
		}
		pack();
		assert.throws(() =>
			extractEvidenceArchive(archive, join(f.work, "wrong-run"), {
				...options,
				expectedIdentity: { ...f.identity, runId: 124 },
			}),
		);
		assert.throws(
			() =>
				extractEvidenceArchive(archive, join(f.work, "oversized"), {
					...options,
					limits: { maxCompressedBytes: 1 },
				}),
			/limit/,
		);
	} finally {
		f.cleanup();
	}
});
