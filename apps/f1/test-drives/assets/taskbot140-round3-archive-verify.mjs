#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

assert.equal(process.versions.node.split(".")[0], "24");
const args = process.argv.slice(2);
assert(args.length === 1 || args.length === 2, "Use --index or --tree REF");
assert(
	(args.length === 1 && args[0] === "--index") ||
		(args.length === 2 && args[0] === "--tree" && !args[1].startsWith("-")),
);
const git = (...values) =>
	execFileSync("git", values, { maxBuffer: 256 * 1024 * 1024 });
process.chdir(git("rev-parse", "--show-toplevel").toString().trim());
const tree = (
	args[0] === "--index"
		? git("write-tree")
		: git("rev-parse", "--verify", "--end-of-options", `${args[1]}^{tree}`)
)
	.toString()
	.trim();
const directory = mkdtempSync(join(tmpdir(), "taskbot140-round3-git-export-"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
// This existing LFS run backup is not a build/runtime/resource input. Verify its
// unchanged Git pointer separately without hydrating or exporting accepted-run data.
const nonRuntimeLfs =
	"docs/run-backups/manual-ca2bb7eb-c67e-4b8b-ac2f-1e62bf6cad37/run-backup.zip";
const roots = git("ls-tree", "--name-only", tree)
	.toString()
	.trim()
	.split("\n")
	.filter((path) => path !== "docs");
const docs = git("ls-tree", "-rz", "--name-only", tree, "docs")
	.toString()
	.split("\0")
	.filter((path) => path && path !== nonRuntimeLfs);
const archive = join(directory, "submitted.tar");
git(
	"archive",
	"--format=tar",
	`--output=${archive}`,
	tree,
	"--",
	...roots,
	...docs,
);
const exportHash = createHash("sha256");
for await (const chunk of createReadStream(archive)) exportHash.update(chunk);
const report = {
	version: "taskbot140-round3-archive-v1",
	at: new Date().toISOString(),
	tree,
	selection: args,
	exportSha256: exportHash.digest("hex"),
	nonRuntimeLfsPointers: 0,
	files: 0,
	originalCopies: 0,
	sourceInputs: 0,
	driverInputs: 0,
	reportLinks: 0,
	failures: [],
	originalVerifier: null,
};
try {
	execFileSync("tar", ["-xf", archive, "-C", directory]);
	const root = "apps/f1/test-drives/assets/taskbot140-views";
	const inventory = JSON.parse(
		readFileSync(join(directory, root, "round3/archive-sha256.json")),
	);
	assert(inventory.files.length > 0, "An empty archive is not evidence");
	const modes = new Map(
		git("ls-tree", "-rz", tree)
			.toString()
			.split("\0")
			.filter(Boolean)
			.map((row) => {
				const [metadata, path] = row.split("\t");
				return [path, metadata.split(" ")[0]];
			}),
	);
	const source = JSON.parse(
		readFileSync(join(directory, root, "round3/gates/source-inputs.json.raw")),
	);
	const equivalence = JSON.parse(
		readFileSync(join(directory, root, "round3/input-equivalence.json")),
	);
	assert.equal(source.head, equivalence.validatedHead);
	assert.equal(source.fingerprint, equivalence.sourceFingerprint);
	for (const [family, inputs] of [
		["sourceInputs", source.files],
		["driverInputs", equivalence.drivers],
	]) {
		for (const input of inputs) {
			try {
				assert.equal(modes.get(input.path), input.mode);
				if (input.path === nonRuntimeLfs) {
					const expected = equivalence.nonRuntimeLfsPointer;
					assert.equal(expected.path, input.path);
					const pointer = git("show", `${tree}:${input.path}`);
					assert.equal(sha(pointer), expected.gitBlobSha256);
					assert.equal(pointer.length, expected.gitBytes);
					assert(
						pointer
							.toString()
							.startsWith("version https://git-lfs.github.com/spec/v1\n"),
					);
					report.nonRuntimeLfsPointers++;
					continue;
				}
				const file = join(directory, input.path);
				const bytes =
					input.mode === "120000"
						? Buffer.from(readlinkSync(file))
						: readFileSync(file);
				assert.equal(bytes.length, input.bytes);
				assert.equal(sha(bytes), input.sha256);
				report[family]++;
			} catch (error) {
				report.failures.push({ path: input.path, error: String(error) });
			}
		}
	}
	for (const entry of inventory.files) {
		try {
			assert(!isAbsolute(entry.path));
			const file = resolve(directory, entry.path);
			assert(!relative(directory, file).startsWith(".."));
			assert(lstatSync(file).isFile());
			const bytes = readFileSync(file);
			assert.equal(bytes.length, entry.bytes);
			assert.equal(sha(bytes), entry.sha256);
			report.files++;
			if (entry.original && existsSync(entry.original)) {
				assert.equal(sha(readFileSync(entry.original)), entry.sha256);
				report.originalCopies++;
			}
		} catch (error) {
			report.failures.push({ path: entry.path, error: String(error) });
		}
	}
	for (const path of [
		"apps/f1/test-drives/2026-10-22-taskbot140-views.md",
		"apps/f1/test-drives/2026-10-22-taskbot140-views-round2.md",
		"apps/f1/test-drives/2026-10-22-taskbot140-views-round3.md",
	]) {
		const markdown = readFileSync(join(directory, path), "utf8");
		for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
			const target = match[1];
			if (/^[a-z][a-z0-9+.-]*:|^#/i.test(target)) continue;
			const link = resolve(directory, dirname(path), target.split("#")[0]);
			if (!existsSync(link))
				report.failures.push({
					path,
					target,
					error: "Missing relative report link in fresh Git export",
				});
			else report.reportLinks++;
		}
	}
	// The original verifier pins the original inventories and verifies the186
	// original entries and nested manifests directly from the same submitted tree.
	const verifier = join(
		directory,
		"apps/f1/test-drives/assets/taskbot140-archive-verify.mjs",
	);
	const original = execFileSync(process.execPath, [verifier, "--tree", tree], {
		maxBuffer: 16 * 1024 * 1024,
	});
	report.originalVerifier = JSON.parse(original.toString());
	assert.equal(report.originalVerifier.failures.length, 0);
	report.result = report.failures.length ? "FAIL" : "PASS";
} catch (error) {
	report.failures.push({ error: String(error) });
	report.result = "FAIL";
} finally {
	rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.result === "PASS" ? 0 : 1;
