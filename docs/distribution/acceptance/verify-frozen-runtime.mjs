// Validate the retained unsigned candidate; this never establishes publisher trust.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

assert.equal(process.env.GITHUB_ACTIONS, "true");
const index = JSON.parse(
	readFileSync(
		new URL(
			"../evidence/taskbot116-source-b82/artifact-index.json",
			import.meta.url,
		),
	),
);
const expected = index.targets["linux-x64"].binary;
const response = await fetch(
	`https://api.github.com/repos/jappyjan/bobs-factory/actions/artifacts/${expected.artifact.id}`,
	{
		headers: {
			Authorization: `Bearer ${process.env.GH_TOKEN}`,
			Accept: "application/vnd.github+json",
		},
		signal: AbortSignal.timeout(30000),
	},
);
assert(response.ok, `Artifact provenance unavailable: HTTP ${response.status}`);
const actual = await response.json();
assert.equal(actual.expired, false);
assert.equal(actual.workflow_run.id, 38086228778);
assert.equal(actual.workflow_run.head_sha, expected.archive.commit);
assert.equal(actual.name, expected.artifact.name);
assert.equal(actual.digest, expected.artifact.digest);
const directory = process.argv[2];
const bytes = readFileSync(join(directory, expected.archive.file));
assert.equal(bytes.length, expected.archive.size);
assert.equal(
	createHash("sha256").update(bytes).digest("hex"),
	expected.archive.sha256,
);
execFileSync(
	"tar",
	["-xzf", join(directory, expected.archive.file), "-C", directory],
	{ timeout: 30000 },
);
const build = JSON.parse(
	readFileSync(
		join(
			directory,
			expected.archive.file.replace(/\.tar\.gz$/, ""),
			"build.json",
		),
	),
);
assert.equal(build.commit, expected.archive.commit);
assert.equal(build.target, "linux-x64");
assert.equal(build.version, expected.archive.version);
console.log(
	JSON.stringify({
		source: build.commit,
		candidateDigest: expected.archive.candidateDigest,
		archiveSha256: expected.archive.sha256,
		artifactId: actual.id,
		runId: actual.workflow_run.id,
		publisherTrust: "unsigned preparation only",
	}),
);
