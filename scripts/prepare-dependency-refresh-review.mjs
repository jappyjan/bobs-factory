#!/usr/bin/env node
// Prepare a schema-3 dependency refresh review. Run from a clean checkout of the
// reviewed commit. `--bundled` lists the name@version inputs the binary and web
// bundle actually ship (measured by the build); every other added or changed
// lockfile package is recorded as tooling. The output is review material: a
// reviewer still inspects the delta and signs it with --reviewer and --scope.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { jsonBytes, requireValue, sha256 } from "./lib/binary-release.mjs";
import { inspectArchive } from "./lib/bounded-archive.mjs";
import { canonical } from "./lib/release-candidate.mjs";
import { dependencyProjection } from "./lib/reviewed-javascript-sources.mjs";

const { values } = parseArgs({
	options: {
		baseline: { type: "string" },
		bundled: { type: "string" },
		previous: { type: "string" },
		reviewer: { type: "string" },
		scope: { type: "string" },
		output: { type: "string" },
	},
});
for (const key of ["baseline", "bundled", "reviewer", "scope", "output"])
	requireValue(values[key], `--${key} is required`);
const root = process.cwd();
const git = (args) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 ** 2 });
const show = (commit, file) => git(["show", `${commit}:${file}`]);
const commit = git(["rev-parse", "HEAD"]).trim();
requireValue(
	!git(["status", "--porcelain", "--untracked-files=no"]).trim(),
	"Review a clean checkout of the exact commit",
);

function lockPackages(bytes) {
	const section = `\n${bytes}`
		.split("\npackages:\n")[1]
		.split("\nsnapshots:\n")[0];
	return new Map(
		section.split(/\n(?= {2}\S)/).flatMap((block) => {
			const match =
				/^ {2}(.+):\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/.exec(
					block,
				);
			return match
				? [[match[1].replace(/^'|'$/g, ""), { integrity: match[2], block }]]
				: [];
		}),
	);
}
const before = lockPackages(show(values.baseline, "pnpm-lock.yaml"));
const after = lockPackages(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
const delta = [...after.keys()]
	.filter((k) => !before.has(k) || before.get(k).block !== after.get(k).block)
	.sort();
const bundled = new Set(JSON.parse(readFileSync(values.bundled, "utf8")));

const files = git(["ls-tree", "-r", "--name-only", "HEAD"])
	.trim()
	.split("\n")
	.filter(
		(f) =>
			f === "pnpm-lock.yaml" ||
			f === "pnpm-workspace.yaml" ||
			f === "package.json" ||
			f.endsWith("/package.json"),
	)
	.flatMap((file) => {
		const old = dependencyProjection(file, show(values.baseline, file));
		const current = dependencyProjection(file, show("HEAD", file));
		return old === current
			? []
			: [{ file, beforeSha256: sha256(old), afterSha256: sha256(current) }];
	});

const nameAndVersion = (key) => {
	const at = key.lastIndexOf("@");
	return { name: key.slice(0, at), version: key.slice(at + 1) };
};
const registry = async (name, version) => {
	const response = await fetch(
		`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`,
	);
	requireValue(
		response.ok,
		`Registry metadata unavailable: ${name}@${version}`,
	);
	return response.json();
};
const declared = (license) =>
	typeof license === "string" ? license : (license?.type ?? "");

const work = mkdtempSync(join(tmpdir(), "dependency-refresh-review-"));
const packages = [];
try {
	for (const key of delta) {
		const { name, version } = nameAndVersion(key);
		const integrity = after.get(key).integrity;
		const metadata = await registry(name, version);
		requireValue(
			metadata.dist?.integrity === integrity,
			`Registry integrity differs from the lockfile: ${key}`,
		);
		const license = declared(metadata.license);
		if (!bundled.has(key)) {
			packages.push({
				name,
				version,
				integrity,
				distribution: "tooling",
				license,
			});
			continue;
		}
		const url = metadata.dist.tarball;
		const response = await fetch(url);
		requireValue(response.ok, `Archive download failed: ${key}`);
		const bytes = Buffer.from(await response.arrayBuffer());
		requireValue(
			`sha512-${createHash("sha512").update(bytes).digest("base64")}` ===
				integrity,
			`Archive integrity mismatch: ${key}`,
		);
		const file = `npm-${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
		const path = join(work, file);
		writeFileSync(path, bytes);
		// npm archives use one top-level `package/` directory.
		const prefix = "package";
		const listing = inspectArchive(path, {
			prefix: `${prefix}/`,
			regularOnly: true,
		});
		const notices = listing.entries
			.map((e) => e.name)
			.filter((n) =>
				/^[^/]+\/(?:license|licence|notice|copying)(?:[._-][^/]*)?$/i.test(n),
			);
		const inspected = inspectArchive(path, {
			prefix: `${prefix}/`,
			regularOnly: true,
			collect: [`${prefix}/package.json`, ...notices],
		});
		requireValue(
			!inspected.entries.some((e) =>
				/\.(node|so(?:\.[0-9]+)*|dll|dylib|a|o|lib|exe|wasm)$/.test(e.name),
			),
			`Shipped package contains native code: ${key}`,
		);
		const packageText = inspected.texts[`${prefix}/package.json`];
		const pkg = JSON.parse(packageText);
		requireValue(
			pkg.name === name &&
				pkg.version === version &&
				!["preinstall", "install", "postinstall"].some((k) => pkg.scripts?.[k]),
			`Unexpected package metadata or install hook: ${key}`,
		);
		requireValue(notices.length > 0, `No upstream notice in archive: ${key}`);
		packages.push({
			name,
			version,
			integrity,
			distribution: "bundled",
			license: declared(pkg.license),
			packageJson: {
				path: `${prefix}/package.json`,
				sha256: sha256(packageText),
			},
			licenses: notices.map((n) => ({
				path: n,
				sha256: sha256(inspected.texts[n]),
				text: inspected.texts[n],
			})),
			archive: { file, url, size: bytes.length, sha256: sha256(bytes) },
		});
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

// Notices pinned separately for retained packages whose archives omit them.
const supplementalNotices = values.previous
	? (JSON.parse(readFileSync(values.previous, "utf8")).supplementalNotices ??
		[])
	: [];
const review = {
	schemaVersion: 3,
	baselineCommit: values.baseline,
	commit,
	reviewedBy: values.reviewer,
	scope: values.scope,
	files,
	packages,
	supplementalNotices,
};
writeFileSync(values.output, jsonBytes(review));
console.log(
	canonical({
		files: files.length,
		bundled: packages.filter((p) => p.distribution === "bundled").length,
		tooling: packages.filter((p) => p.distribution === "tooling").length,
		review: sha256(readFileSync(values.output)),
	}),
);
