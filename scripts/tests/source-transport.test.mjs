import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	fileRecord,
	jsonBytes,
	releaseAssetRecords,
	validateReleaseManifest,
} from "../lib/binary-release.mjs";
import { ARCHIVE_LIMITS } from "../lib/bounded-archive.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import { verifyManifestSignature } from "../lib/release-signature.mjs";
import {
	reconstructSourceArchive,
	SOURCE_CHUNK_BYTES,
	sourceTransportRecords,
	splitSourceArchive,
} from "../lib/source-transport.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { keys } from "./release-fixtures.mjs";

function fixture() {
	const work = mkdtempSync(join(tmpdir(), "factory-source-transport-test-"));
	const input = join(work, "source-rebuild.tar.gz"),
		chunks = join(work, "chunks"),
		output = join(work, "output");
	mkdirSync(chunks);
	mkdirSync(output);
	writeFileSync(
		input,
		Buffer.from(
			"actual source transport bytes, including repeated content\n".repeat(100),
		),
	);
	const source = fileRecord(input, "source-rebuild.tar.gz");
	const transport = splitSourceArchive(input, source, chunks, 1024);
	return {
		work,
		input,
		chunks,
		output,
		source,
		transport,
		cleanup: () => rmSync(work, { recursive: true, force: true }),
	};
}
test("streamed deterministic chunks reconstruct exact input bytes/hash/size", () => {
	const f = fixture();
	try {
		const another = join(f.work, "another");
		mkdirSync(another);
		assert.deepEqual(
			splitSourceArchive(f.input, f.source, another, 1024),
			f.transport,
		);
		const output = reconstructSourceArchive(
			f.chunks,
			f.source,
			f.transport,
			f.output,
		);
		assert.deepEqual(fileRecord(output, f.source.file), f.source);
		assert.deepEqual(readFileSync(output), readFileSync(f.input));
		assert.throws(
			() => reconstructSourceArchive(f.chunks, f.source, f.transport, f.output),
			/EEXIST/,
		);
		assert.deepEqual(fileRecord(output, f.source.file), f.source);
	} finally {
		f.cleanup();
	}
});
for (const fault of [
	"order",
	"duplicate",
	"count",
	"extra",
	"filename",
	"traversal",
	"absolute",
	"chunkSize",
	"oversize",
	"archiveLimit",
	"hash",
	"zero",
	"fraction",
]) {
	test(`source chunk metadata rejects ${fault} before output`, () => {
		const f = fixture();
		try {
			const transport = structuredClone(f.transport),
				source = { ...f.source };
			if (fault === "order") transport.chunks.reverse();
			if (fault === "duplicate")
				transport.chunks[1] = { ...transport.chunks[0] };
			if (fault === "count") transport.chunks.pop();
			if (fault === "extra") transport.chunks.push({ ...transport.chunks[0] });
			if (fault === "filename") transport.chunks[0].file = "wrong";
			if (fault === "traversal")
				transport.chunks[0].file = "../source-rebuild.tar.gz";
			if (fault === "absolute") transport.chunks[0].file = f.input;
			if (fault === "chunkSize") transport.chunkSize = SOURCE_CHUNK_BYTES + 1;
			if (fault === "oversize")
				transport.chunks[0].size = SOURCE_CHUNK_BYTES + 1;
			if (fault === "archiveLimit")
				source.size = ARCHIVE_LIMITS.maxCompressedBytes + 1;
			if (fault === "hash") transport.chunks[0].sha256 = "malformed";
			if (fault === "zero") transport.chunkSize = 0;
			if (fault === "fraction") transport.chunks[0].order = 1.5;
			assert.throws(
				() => reconstructSourceArchive(f.chunks, source, transport, f.output),
				/Invalid source/,
			);
			assert.equal(existsSync(join(f.output, f.source.file)), false);
		} finally {
			f.cleanup();
		}
	});
}
for (const fault of [
	"missing",
	"changed",
	"truncated",
	"oversized",
	"symlink",
	"hardlink",
	"directory",
	"fifo",
	"swapped",
	"totalHash",
]) {
	test(`source chunk bytes reject ${fault} and clean owned output`, () => {
		const f = fixture();
		try {
			const path = join(f.chunks, f.transport.chunks[0].file),
				source = { ...f.source };
			if (
				["missing", "symlink", "hardlink", "directory", "fifo"].includes(fault)
			)
				rmSync(path);
			if (fault === "changed") writeFileSync(path, Buffer.alloc(1024, 90));
			if (fault === "truncated") truncateSync(path, 1);
			if (fault === "oversized") truncateSync(path, SOURCE_CHUNK_BYTES + 1);
			if (fault === "symlink") symlinkSync(f.input, path);
			if (fault === "hardlink") linkSync(f.input, path);
			if (fault === "directory") mkdirSync(path);
			if (fault === "fifo") execFileSync("mkfifo", [path]);
			if (fault === "swapped") {
				const second = join(f.chunks, f.transport.chunks[1].file),
					bytes = readFileSync(path);
				writeFileSync(path, readFileSync(second));
				writeFileSync(second, bytes);
			}
			if (fault === "totalHash") source.sha256 = "0".repeat(64);
			assert.throws(() =>
				reconstructSourceArchive(f.chunks, source, f.transport, f.output),
			);
			assert.equal(existsSync(join(f.output, f.source.file)), false);
		} finally {
			f.cleanup();
		}
	});
}
test("transport rejects linked directories/outputs and never overwrites conflicts", () => {
	const f = fixture();
	try {
		const alias = join(f.work, "alias");
		symlinkSync(f.chunks, alias);
		assert.throws(
			() => reconstructSourceArchive(alias, f.source, f.transport, f.output),
			/directory/,
		);
		symlinkSync(f.input, join(f.output, f.source.file));
		assert.throws(
			() => reconstructSourceArchive(f.chunks, f.source, f.transport, f.output),
			/EEXIST/,
		);
		assert.deepEqual(fileRecord(f.input, f.source.file), f.source);
		const first = join(f.chunks, f.transport.chunks[0].file),
			original = readFileSync(first);
		assert.throws(
			() => splitSourceArchive(f.input, f.source, f.chunks, 1024),
			/EEXIST/,
		);
		assert.deepEqual(readFileSync(first), original);
	} finally {
		f.cleanup();
	}
});
test("signed prepared chunk fixture runs unchanged semantic intake and rejects hybrid/incomplete inventory", () => {
	const f = preparedFixture("nightly", { sourceChunks: true });
	try {
		validatePreparedRelease(f.assets, f.candidate);
		assert.ok(f.manifest.sourceTransport.chunks.length > 1);
		assert.ok(
			!releaseAssetRecords(f.manifest, false).some(
				(r) => r.file === f.manifest.source.file,
			),
		);
		for (const fault of ["missing", "hybrid", "unexpected", "order"]) {
			const m = structuredClone(f.manifest);
			if (fault === "missing")
				m.assets = m.assets.filter(
					(a) => a.file !== m.sourceTransport.chunks[0].file,
				);
			if (fault === "hybrid") m.assets.push(m.source);
			if (fault === "unexpected")
				m.assets.push({
					...m.sourceTransport.chunks[0],
					file: "source-rebuild.tar.gz.part9999",
				});
			if (fault === "order") m.sourceTransport.chunks.reverse();
			assert.throws(
				() => validateReleaseManifest(m),
				/source|Signed inventory/,
			);
		}
		writeFileSync(join(f.assets, "unexpected"), "extra");
		assert.throws(
			() => validatePreparedRelease(f.assets, f.candidate),
			/Unexpected prepared asset/,
		);
		rmSync(join(f.assets, "unexpected"));
		const evidence = JSON.parse(
			readFileSync(join(f.assets, "release-evidence.json")),
		);
		evidence.source.sha256 = "f".repeat(64);
		writeFileSync(join(f.assets, "release-evidence.json"), jsonBytes(evidence));
		const manifest = structuredClone(f.manifest);
		manifest.assets = manifest.assets.map((a) =>
			a.file === "release-evidence.json"
				? fileRecord(join(f.assets, a.file), a.file)
				: a,
		);
		writeFileSync(join(f.assets, "release.json"), jsonBytes(manifest));
		assert.throws(
			() => validatePreparedRelease(f.assets, f.candidate),
			/Evidence source differs/,
		);
	} finally {
		f.cleanup();
	}
});
test("genuine legacy single-source manifests cannot claim chunk transport", () => {
	const f = preparedFixture("beta", { legacy: true });
	try {
		validateReleaseManifest(f.manifest);
		validatePreparedRelease(f.assets, undefined, { legacyBeta: true });
		assert.deepEqual(sourceTransportRecords(f.manifest.source), [
			f.manifest.source,
		]);
		assert.throws(
			() =>
				validateReleaseManifest({
					...f.manifest,
					sourceTransport: { schemaVersion: 1, type: "chunks" },
				}),
			/legacy boundary/,
		);
	} finally {
		f.cleanup();
	}
});

test("offline recovery authenticates before retaining source and preserves conflicting output", () => {
	const f = preparedFixture("nightly", { sourceChunks: true });
	try {
		const output = join(f.work, "recovered");
		const run = () =>
			spawnSync(
				process.execPath,
				[
					join(f.work, "scripts/recover-release-source.mjs"),
					"--assets",
					f.assets,
					"--output",
					output,
				],
				{ encoding: "utf8" },
			);
		const result = run();
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(
			fileRecord(join(output, f.manifest.source.file), f.manifest.source.file),
			f.manifest.source,
		);
		const conflict = run();
		assert.notEqual(conflict.status, 0);
		assert.match(conflict.stderr, /EEXIST/);
		assert.deepEqual(
			fileRecord(join(output, f.manifest.source.file), f.manifest.source.file),
			f.manifest.source,
		);
		rmSync(output, { recursive: true });
		const chunk = join(f.assets, f.manifest.sourceTransport.chunks[0].file);
		const bytes = readFileSync(chunk);
		writeFileSync(chunk, Buffer.alloc(bytes.length));
		const corrupted = run();
		assert.notEqual(corrupted.status, 0);
		assert.match(corrupted.stderr, /Prepared asset changed/);
		assert.equal(existsSync(output), false);
		writeFileSync(chunk, bytes);
		writeFileSync(join(f.assets, "release.json.sig"), "corrupt");
		const unsigned = run();
		assert.notEqual(unsigned.status, 0);
		assert.match(unsigned.stderr, /signature/);
		assert.equal(existsSync(output), false);
	} finally {
		f.cleanup();
	}
});

for (const { sourceChunks, duringValidation } of [
	{ sourceChunks: false, duringValidation: false },
	{ sourceChunks: true, duringValidation: false },
	{ sourceChunks: true, duringValidation: true },
]) {
	test(`offline recovery refuses unsigned directory swap ${duringValidation ? "during validation" : "after authentication"} (${sourceChunks ? "chunks" : "single archive"})`, () => {
		const f = preparedFixture("nightly", { sourceChunks });
		const replacement = preparedFixture("nightly", { sourceChunks });
		try {
			assert.equal(f.candidate.digest, replacement.candidate.digest);
			const root = join(replacement.work, "source-rebuild");
			writeFileSync(
				join(root, "README.md"),
				"UNSIGNED replacement rebuild instructions, different from authenticated source.",
			);
			const materialsPath = join(root, "source-materials.json");
			const materials = JSON.parse(readFileSync(materialsPath));
			materials.records = materials.records.map((record) =>
				record.file === "README.md"
					? { ...record, ...fileRecord(join(root, record.file), record.file) }
					: record,
			);
			writeFileSync(materialsPath, jsonBytes(materials));
			const archive = join(replacement.assets, "source-rebuild.tar.gz");
			execFileSync(
				"tar",
				["-czf", archive, "-C", replacement.work, "source-rebuild"],
				{
					env: { ...process.env, COPYFILE_DISABLE: "1" },
				},
			);
			const source = fileRecord(archive, "source-rebuild.tar.gz");
			assert.notEqual(source.sha256, f.manifest.source.sha256);
			const manifest = { ...replacement.manifest, source };
			if (sourceChunks) {
				for (const chunk of manifest.sourceTransport.chunks)
					rmSync(join(replacement.assets, chunk.file));
				manifest.sourceTransport = splitSourceArchive(
					archive,
					source,
					replacement.assets,
					1024,
				);
				rmSync(archive);
			}
			const evidencePath = join(replacement.assets, "release-evidence.json");
			const evidence = JSON.parse(readFileSync(evidencePath));
			evidence.source = source;
			writeFileSync(evidencePath, jsonBytes(evidence));
			manifest.assets = readdirSync(replacement.assets)
				.filter(
					(file) =>
						![
							"release.json",
							"release.json.sig",
							"release.json.key-id",
						].includes(file),
				)
				.sort()
				.map((file) => fileRecord(join(replacement.assets, file), file));
			writeFileSync(
				join(replacement.assets, "release.json"),
				jsonBytes(manifest),
			);
			const originalSignature = readFileSync(
				join(f.assets, "release.json.sig"),
			);
			writeFileSync(
				join(replacement.assets, "release.json.sig"),
				originalSignature,
			);
			assert.throws(
				() =>
					verifyManifestSignature(
						jsonBytes(manifest),
						originalSignature,
						"fixture",
						keys,
					),
				/signature/,
			);
			// The replacement passes every semantic check: only authentication binds
			// recovery to the original archive. No validator or hash check is stubbed.
			validatePreparedRelease(replacement.assets, f.candidate);
			const output = join(f.work, "swapped-recovery");
			const temporary = join(f.work, "recovery-temporary");
			mkdirSync(temporary);
			const preload = join(f.work, "swap-after-authentication.mjs");
			writeFileSync(
				preload,
				`import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = fs.${duringValidation ? "readFileSync" : "mkdirSync"};
fs.${duringValidation ? "readFileSync" : "mkdirSync"} = function(path, ...args) {
 const result = original.call(this, path, ...args);
 if (path === ${JSON.stringify(duringValidation ? join(f.assets, "release-evidence.json") : output)}) {
  fs.rmSync(${JSON.stringify(f.assets)}, {recursive: true, force: true});
  fs.cpSync(${JSON.stringify(replacement.assets)}, ${JSON.stringify(f.assets)}, {recursive: true});
 }
 return result;
};
syncBuiltinESMExports();
`,
			);
			const result = spawnSync(
				process.execPath,
				[
					"--import",
					preload,
					join(f.work, "scripts/recover-release-source.mjs"),
					"--assets",
					f.assets,
					"--output",
					output,
				],
				{ encoding: "utf8", env: { ...process.env, TMPDIR: temporary } },
			);
			assert.notEqual(result.status, 0, result.stdout);
			assert.match(
				result.stderr,
				duringValidation
					? /Prepared manifest changed during authenticated validation/
					: /Prepared manifest differs from authenticated bytes/,
			);
			assert.equal(existsSync(output), false);
			assert.deepEqual(readdirSync(temporary), []);
		} finally {
			f.cleanup();
			replacement.cleanup();
		}
	});
}

test("split failures remove only new partial chunks and preserve retained collisions", () => {
	const f = fixture();
	try {
		const collision = join(f.work, "collision");
		mkdirSync(collision);
		const retained = join(collision, f.transport.chunks[1].file);
		writeFileSync(retained, "retained conflict");
		assert.throws(
			() => splitSourceArchive(f.input, f.source, collision, 1024),
			/EEXIST/,
		);
		assert.equal(
			existsSync(join(collision, f.transport.chunks[0].file)),
			false,
		);
		assert.equal(readFileSync(retained, "utf8"), "retained conflict");
		const empty = join(f.work, "empty");
		mkdirSync(empty);
		assert.throws(
			() =>
				splitSourceArchive(
					f.input,
					{ ...f.source, sha256: "f".repeat(64) },
					empty,
					1024,
				),
			/changed during/,
		);
		assert.equal(existsSync(join(empty, f.transport.chunks[0].file)), false);
		assert.deepEqual(fileRecord(f.input, f.source.file), f.source);
	} finally {
		f.cleanup();
	}
});

test("hash-valid reconstructed transport cannot bypass semantic source intake", () => {
	const f = preparedFixture();
	try {
		const archive = join(f.assets, f.manifest.source.file);
		writeFileSync(archive, "Exact hashed bytes that are not a source archive");
		const source = fileRecord(archive, f.manifest.source.file);
		const transport = splitSourceArchive(archive, source, f.assets, 16);
		rmSync(archive);
		const evidence = JSON.parse(
			readFileSync(join(f.assets, "release-evidence.json")),
		);
		evidence.source = source;
		writeFileSync(join(f.assets, "release-evidence.json"), jsonBytes(evidence));
		const manifest = { ...f.manifest, source, sourceTransport: transport };
		manifest.assets = manifest.assets
			.filter((a) => a.file !== source.file)
			.map((a) =>
				a.file === "release-evidence.json"
					? fileRecord(join(f.assets, a.file), a.file)
					: a,
			);
		manifest.assets.push(...sourceTransportRecords(source, transport));
		writeFileSync(join(f.assets, "release.json"), jsonBytes(manifest));
		validateReleaseManifest(manifest);
		const output = join(f.work, "semantic");
		mkdirSync(output);
		assert.deepEqual(
			fileRecord(
				reconstructSourceArchive(f.assets, source, transport, output),
				source.file,
			),
			source,
		);
		assert.throws(
			() => validatePreparedRelease(f.assets, f.candidate),
			/incorrect header check/,
		);
	} finally {
		f.cleanup();
	}
});
