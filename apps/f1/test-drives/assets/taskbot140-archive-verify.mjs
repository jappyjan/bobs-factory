#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// Verify submitted bytes, never retained working-copy evidence. Examples:
// node taskbot140-archive-verify.mjs --tree 246e422d
// node taskbot140-archive-verify.mjs --index --check-originals
assert.equal(process.versions.node.split(".")[0], "24", "Use Node 24");
const args = process.argv.slice(2);
const index = args.includes("--index");
const originals = args.includes("--check-originals");
const treeOption = args.indexOf("--tree");
const reference = treeOption < 0 ? undefined : args[treeOption + 1];
const accepted = new Set(["--index", "--tree", "--check-originals"]);
for (let at = 0; at < args.length; at++) {
	assert(accepted.has(args[at]), `Unknown argument ${args[at]}`);
	if (args[at] === "--tree") at++;
}
assert(
	index !== Boolean(reference),
	"Supply exactly one --index or --tree REF",
);
assert(!reference?.startsWith("-"), "Invalid tree reference");
const git = (...values) =>
	execFileSync("git", values, { maxBuffer: 128 * 1024 * 1024 });
const repository = git("rev-parse", "--show-toplevel").toString().trim();
process.chdir(repository);
const tree = index
	? git("write-tree").toString().trim()
	: git("rev-parse", "--verify", "--end-of-options", `${reference}^{tree}`)
			.toString()
			.trim();
const archiveRoot = "apps/f1/test-drives/assets/taskbot140-views";
const report = "apps/f1/test-drives/2026-10-22-taskbot140-views.md";
const tracked = new Set(
	git("ls-tree", "-rz", "--name-only", tree)
		.toString()
		.split("\0")
		.filter(Boolean),
);
const exported = git("archive", "--format=tar", tree, archiveRoot, report);
const directory = mkdtempSync(join(tmpdir(), "taskbot140-submitted-archive-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
	version: "taskbot140-archive-v1",
	at: new Date().toISOString(),
	node: process.version,
	verifierSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
	submitted: {
		selection: index ? "index" : "tree",
		reference: reference ?? null,
		tree,
		head: git("rev-parse", "HEAD").toString().trim(),
		archiveExportSha256: hash(exported),
	},
	checks: {},
	failures: [],
	originalCopies: { enabled: originals, checked: 0, failures: [] },
};
const fail = (family, file, problem, details = {}) =>
	receipt.failures.push({ family, file, problem, ...details });
function filePath(file) {
	assert(typeof file === "string" && file.length > 0, "Expected file path");
	assert(!posix.isAbsolute(file), `Absolute archive path: ${file}`);
	assert(!file.split("/").includes(".."), `Escaping archive path: ${file}`);
	return join(directory, file);
}
function read(file) {
	const path = filePath(file);
	assert(lstatSync(path).isFile(), `Expected regular file: ${file}`);
	return readFileSync(path);
}
const json = (file) => JSON.parse(read(file).toString());
function verify(family, file, expected, bytes) {
	receipt.checks[family] = (receipt.checks[family] ?? 0) + 1;
	if (!tracked.has(file)) {
		fail(family, file, "missing from submitted Git tree", { expected });
		return;
	}
	try {
		assert.match(expected, /^[a-f0-9]{64}$/, "Expected SHA-256");
		const content = read(file);
		const actual = hash(content);
		if (actual !== expected)
			fail(family, file, "SHA-256 mismatch", { expected, actual });
		if (bytes !== undefined && content.length !== bytes)
			fail(family, file, "byte length mismatch", {
				expectedBytes: bytes,
				actualBytes: content.length,
			});
	} catch (error) {
		fail(family, file, String(error));
	}
}
function records(family, base, values, key) {
	for (const value of values)
		verify(family, posix.join(base, value[key]), value.sha256, value.bytes);
}
try {
	execFileSync("tar", ["-xf", "-", "-C", directory], { input: exported });
	const inventory = `${archiveRoot}/archive-sha256.json`;
	verify(
		"originalInventory",
		inventory,
		"3b0b2aba788fdf7a3706e118eeba9c0ad47e167fb52fc9386192d604447216f1",
	);
	for (const [file, expected] of Object.entries(json(inventory).files))
		verify("archive", posix.join(archiveRoot, file), expected);
	const rawLogs = json(`${archiveRoot}/gates/raw-log-manifest.json`);
	for (const value of rawLogs) {
		verify(
			"rawLogMappings",
			posix.join(archiveRoot, "gates", value.retained),
			value.sha256,
		);
		if (originals) {
			receipt.originalCopies.checked++;
			try {
				assert.equal(dirname(value.original), "/tmp/taskbot140-validation");
				const actual = hash(readFileSync(value.original));
				if (actual !== value.sha256)
					receipt.originalCopies.failures.push({
						file: value.original,
						expected: value.sha256,
						actual,
					});
			} catch (error) {
				receipt.originalCopies.failures.push({
					file: value.original,
					problem: String(error),
				});
			}
		}
	}
	for (const line of read(`${archiveRoot}/native/SHA256SUMS`)
		.toString()
		.trim()
		.split("\n")) {
		const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
		assert(match, "Invalid native SHA256SUMS record");
		verify("native", posix.join(archiveRoot, "native", match[2]), match[1]);
	}
	const ui = `${archiveRoot}/ui/final`;
	records(
		"uiEvidence",
		"",
		json(`${ui}/evidence-manifest.json.raw`).files,
		"path",
	);
	const uiArchive = json(`${ui}/archive-manifest.json.raw`);
	for (const key of [
		"items",
		"originalJsonByteHashes",
		"immutableSourceArchives",
	])
		records(key, ui, uiArchive[key], "file");
	for (const family of [
		"attempt1-request-header-omission",
		"attempt2-json-prototype-comparison",
		"pre-media-pass",
		"final",
	]) {
		const base = `${archiveRoot}/f1/${family}`;
		for (const [file, expected] of Object.entries(json(`${base}/sha256.json`)))
			verify(`f1:${family}`, posix.join(base, file), expected);
	}
	for (const markdown of [
		report,
		`${archiveRoot}/README.md`,
		`${archiveRoot}/native/README.md`,
	]) {
		for (const match of read(markdown)
			.toString()
			.matchAll(/\]\(([^)]+)\)/g)) {
			const target = match[1].split("#")[0];
			if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
			receipt.checks.reportLinks = (receipt.checks.reportLinks ?? 0) + 1;
			const file = posix.normalize(
				posix.join(posix.dirname(markdown), decodeURIComponent(target)),
			);
			assert(!file.startsWith("../"), "Link escapes repository");
			if (
				!tracked.has(file) &&
				!Array.from(tracked).some((entry) => entry.startsWith(`${file}/`))
			)
				fail(
					"reportLinks",
					file,
					"missing linked path from submitted Git tree",
					{
						markdown,
						target,
					},
				);
		}
	}
} catch (error) {
	fail("verifier", "", String(error));
} finally {
	rmSync(directory, { recursive: true, force: true });
}
receipt.result = receipt.failures.length === 0 ? "pass" : "fail";
receipt.originalCopies.result = originals
	? receipt.originalCopies.failures.length === 0
		? "pass"
		: "fail"
	: "not requested";
console.log(JSON.stringify(receipt, null, 2));
process.exitCode = receipt.result === "pass" ? 0 : 1;
