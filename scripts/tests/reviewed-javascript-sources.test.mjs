import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { sha256 } from "../lib/binary-release.mjs";
import {
	retainReviewedJavascriptSources,
	reviewedJavascriptDelta,
} from "../lib/reviewed-javascript-sources.mjs";

function fixture(changeRetained = false) {
	const root = mkdtempSync(join(tmpdir(), "factory-js-source-review-"));
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-q");
	git("config", "user.name", "Controlled fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	const commit = () => {
		git("add", ".");
		git("commit", "-qm", "Controlled input");
		return git("rev-parse", "HEAD");
	};
	mkdirSync(join(root, "packages/edge-worker"), { recursive: true });
	mkdirSync(join(root, "distribution/dependency-reviews"), { recursive: true });
	const oldManifest = JSON.stringify({
			version: "1.0.0",
			license: "Apache-2.0",
			devDependencies: { retained: "1.0.0" },
		}),
		oldLock =
			"packages:\n\n  retained@1.0.0:\n    resolution: {integrity: sha512-AAAA}\n\nsnapshots:\n";
	writeFileSync(join(root, "packages/edge-worker/package.json"), oldManifest);
	writeFileSync(join(root, "pnpm-lock.yaml"), oldLock);
	const baseline = commit();
	const pkg = JSON.stringify({
			name: "browser",
			version: "2.0.0",
			license: "MIT",
		}),
		license = "Controlled complete upstream notice";
	const source = join(root, "source");
	mkdirSync(join(source, "package"), { recursive: true });
	writeFileSync(join(source, "package/package.json"), pkg);
	writeFileSync(join(source, "package/LICENSE"), license);
	const archive = join(root, "browser.tgz");
	execFileSync("tar", ["-czf", archive, "-C", source, "package"], {
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	});
	const bytes = readFileSync(archive),
		integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	const newManifest = JSON.stringify({
			version: "1.0.0",
			license: "Apache-2.0",
			devDependencies: { retained: "1.0.0", browser: "^2.0.0" },
		}),
		newLock = oldLock
			.replace("sha512-AAAA", changeRetained ? "sha512-BBBB" : "sha512-AAAA")
			.replace(
				"\nsnapshots:\n",
				`\n  browser@2.0.0:\n    resolution: {integrity: ${integrity}}\n\nsnapshots:\n`,
			);
	writeFileSync(join(root, "packages/edge-worker/package.json"), newManifest);
	writeFileSync(join(root, "pnpm-lock.yaml"), newLock);
	const reviewed = commit();
	const review = {
		schemaVersion: 2,
		baselineCommit: baseline,
		commit: reviewed,
		reviewedBy: "Independent controlled reviewer",
		scope: "Exact controlled browser source addition",
		files: [
			{
				file: "packages/edge-worker/package.json",
				beforeSha256: sha256(oldManifest),
				afterSha256: sha256(newManifest),
			},
			{
				file: "pnpm-lock.yaml",
				beforeSha256: sha256(oldLock),
				afterSha256: sha256(newLock),
			},
		],
		packages: [
			{
				name: "browser",
				version: "2.0.0",
				integrity,
				license: "MIT",
				packageJson: { path: "package/package.json", sha256: sha256(pkg) },
				licenses: [
					{ path: "package/LICENSE", sha256: sha256(license), text: license },
				],
				archive: {
					file: "npm-browser-2.0.0.tgz",
					url: "https://registry.npmjs.org/browser/-/browser-2.0.0.tgz",
					size: bytes.length,
					sha256: sha256(bytes),
				},
			},
		],
	};
	const reference = () => {
		const text = JSON.stringify(review);
		writeFileSync(
			join(root, "distribution/dependency-reviews/browser.json"),
			text,
		);
		return {
			schemaVersion: 2,
			file: "distribution/dependency-reviews/browser.json",
			sha256: sha256(text),
		};
	};
	const ref = reference(),
		candidate = commit();
	return {
		root,
		git,
		commit,
		baseline,
		review,
		ref,
		candidate,
		reference,
		bytes,
		source,
	};
}
test("fresh hash-bound JavaScript source review covers every added package and refuses altered or incomplete reviews", () => {
	const f = fixture();
	try {
		assert.equal(
			reviewedJavascriptDelta(f.root, f.baseline, f.candidate, f.ref).packages
				.length,
			1,
		);
		assert.throws(
			() =>
				reviewedJavascriptDelta(f.root, f.baseline, f.candidate, {
					...f.ref,
					sha256: "0".repeat(64),
				}),
			/hash mismatch/,
		);
		f.review.packages = [];
		const ref = f.reference(),
			candidate = f.commit();
		assert.throws(
			() => reviewedJavascriptDelta(f.root, f.baseline, candidate, ref),
			/every added package/,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
test("a JavaScript review cannot authorize changes to a retained package even with freshly matching input hashes", () => {
	const f = fixture(true);
	try {
		assert.throws(
			() => reviewedJavascriptDelta(f.root, f.baseline, f.candidate, f.ref),
			/retained package/,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
test("source retention checks actual archive integrity, package metadata and license bytes before retaining source records", async () => {
	const f = fixture();
	try {
		const review = reviewedJavascriptDelta(
				f.root,
				f.baseline,
				f.candidate,
				f.ref,
			),
			observations = [{ review }, { review }],
			out = join(f.root, "retained");
		mkdirSync(out);
		const records = await retainReviewedJavascriptSources(
			observations,
			out,
			async () => new Response(f.bytes),
		);
		assert.equal(records.length, 1);
		assert.equal(
			readFileSync(join(out, records[0].file)).length,
			f.bytes.length,
		);
		await assert.rejects(
			() =>
				retainReviewedJavascriptSources(
					observations,
					out,
					async () => new Response(Buffer.from("wrong bytes")),
				),
			/integrity mismatch/,
		);
		const modified = structuredClone(review);
		modified.packages[0].licenses[0].sha256 = "0".repeat(64);
		await assert.rejects(
			() =>
				retainReviewedJavascriptSources(
					[{ review: modified }],
					out,
					async () => new Response(f.bytes),
				),
			/upstream notice missing/,
		);
		writeFileSync(join(f.source, "package/native.node"), "native");
		execFileSync(
			"tar",
			["-czf", join(f.root, "native.tgz"), "-C", f.source, "package"],
			{ env: { ...process.env, COPYFILE_DISABLE: "1" } },
		);
		const native = readFileSync(join(f.root, "native.tgz"));
		const withNative = structuredClone(review),
			p = withNative.packages[0];
		p.integrity = `sha512-${createHash("sha512").update(native).digest("base64")}`;
		Object.assign(p.archive, {
			file: "npm-native-2.0.0.tgz",
			size: native.length,
			sha256: sha256(native),
		});
		await assert.rejects(
			() =>
				retainReviewedJavascriptSources(
					[{ review: withNative }],
					out,
					async () => new Response(native),
				),
			/Native component/,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
