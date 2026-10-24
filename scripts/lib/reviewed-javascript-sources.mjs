import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireValue, sha256 } from "./binary-release.mjs";
import { inspectArchive } from "./bounded-archive.mjs";
import { canonical } from "./release-candidate.mjs";

function lockPackages(bytes) {
	const sections = `\n${bytes}`.split("\npackages:\n");
	requireValue(
		sections.length === 2,
		"Unsupported reviewed lockfile package section",
	);
	const section = sections[1].split("\nsnapshots:\n")[0];
	return new Map(
		section.split(/\n(?= {2}\S)/).flatMap((block) => {
			const match =
				/^ {2}(.+):\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/.exec(
					block,
				);
			return match
				? [
						[
							match[1].replace(/^'|'$/g, ""),
							{ integrity: match[2], block: block.trim() },
						],
					]
				: [];
		}),
	);
}
export function reviewedJavascriptDelta(
	root,
	baselineCommit,
	candidateCommit,
	reference,
) {
	if (reference.schemaVersion !== 2) return;
	requireValue(
		/^distribution\/dependency-reviews\/[a-z0-9-]+\.json$/.test(
			reference.file,
		) && /^[a-f0-9]{64}$/.test(reference.sha256),
		"Invalid JavaScript source review reference",
	);
	const git = (args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 16 * 1024 ** 2,
		});
	const text = git(["show", `${candidateCommit}:${reference.file}`]);
	requireValue(
		sha256(text) === reference.sha256,
		"JavaScript source review hash mismatch",
	);
	const review = JSON.parse(text);
	requireValue(
		review.schemaVersion === 2 &&
			review.baselineCommit === baselineCommit &&
			/^[a-f0-9]{40}$/.test(review.commit) &&
			typeof review.reviewedBy === "string" &&
			review.reviewedBy.trim() &&
			typeof review.scope === "string" &&
			review.scope.trim(),
		"Missing independent JavaScript source review",
	);
	requireValue(
		git(["merge-base", review.commit, candidateCommit]).trim() ===
			review.commit,
		"Reviewed dependency commit is not an ancestor",
	);
	const files = ["packages/edge-worker/package.json", "pnpm-lock.yaml"];
	requireValue(
		canonical(review.files?.map((r) => r.file).sort()) ===
			canonical([...files].sort()),
		"JavaScript source review must bind only the frontend manifest and lockfile",
	);
	for (const file of files) {
		const record = review.files.find((r) => r.file === file),
			before = git(["show", `${baselineCommit}:${file}`]),
			after = git(["show", `${candidateCommit}:${file}`]);
		requireValue(
			record.beforeSha256 === sha256(before) &&
				record.afterSha256 === sha256(after) &&
				git(["show", `${review.commit}:${file}`]) === after,
			"Reviewed dependency inputs changed",
		);
	}
	const before = lockPackages(
			git(["show", `${baselineCommit}:pnpm-lock.yaml`]),
		),
		after = lockPackages(git(["show", `${candidateCommit}:pnpm-lock.yaml`]));
	for (const [key, old] of before)
		if (after.has(key))
			requireValue(
				after.get(key).block === old.block,
				"Reviewed JavaScript additions cannot change retained package pins or metadata",
			);
	const added = [...after.keys()].filter((k) => !before.has(k)).sort();
	requireValue(
		Array.isArray(review.packages) &&
			review.packages.length > 0 &&
			review.packages.length <= 64 &&
			canonical(review.packages.map((p) => `${p.name}@${p.version}`).sort()) ===
				canonical(added),
		"JavaScript source review does not cover every added package",
	);
	for (const p of review.packages)
		verifyReviewedSource(p, after, ["MIT", "BSD-3-Clause", "ISC"]);
	const old = JSON.parse(
			git(["show", `${baselineCommit}:packages/edge-worker/package.json`]),
		),
		current = JSON.parse(
			git(["show", `${candidateCommit}:packages/edge-worker/package.json`]),
		);
	for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) {
		if (
			[
				"dependencies",
				"devDependencies",
				"optionalDependencies",
				"peerDependencies",
			].includes(key)
		) {
			for (const [name, pin] of Object.entries(current[key] ?? {})) {
				if (old[key]?.[name] !== undefined)
					requireValue(
						old[key][name] === pin,
						"JavaScript review cannot change a retained direct dependency",
					);
				else
					requireValue(
						key === "devDependencies" &&
							review.packages.some((p) => p.name === name),
						"JavaScript review only covers frontend development dependency additions",
					);
			}
		} else if (key !== "version")
			requireValue(
				canonical(old[key] ?? null) === canonical(current[key] ?? null),
				"JavaScript review cannot change package policy or licensing",
			);
	}
	verifySupplementalNotices(review, before, after);
	return {
		...review,
		reviewFile: reference.file,
		reviewSha256: reference.sha256,
	};
}

/** A shipped package: exact npm archive identity and complete upstream notices. */
function verifyReviewedSource(p, lock, licenses) {
	const a = p.archive;
	requireValue(
		lock.get(`${p.name}@${p.version}`)?.integrity === p.integrity &&
			/^https:\/\/registry\.npmjs\.org\//.test(a?.url) &&
			new URL(a.url).hostname === "registry.npmjs.org" &&
			/^npm-[A-Za-z0-9._-]+\.tgz$/.test(a.file) &&
			/^[a-f0-9]{64}$/.test(a.sha256) &&
			Number.isSafeInteger(a.size) &&
			a.size > 0 &&
			a.size <= 8 * 1024 ** 2,
		"Invalid reviewed npm source identity",
	);
	requireValue(
		licenses.includes(p.license) &&
			p.licenses?.length > 0 &&
			p.licenses.every(
				(l) => /^[a-f0-9]{64}$/.test(l.sha256) && sha256(l.text) === l.sha256,
			),
		"Missing exact reviewed upstream license text",
	);
}

function verifySupplementalNotices(review, before, after) {
	for (const notice of review.supplementalNotices ?? [])
		requireValue(
			typeof notice.package === "string" &&
				typeof notice.version === "string" &&
				notice.source.startsWith("https://raw.githubusercontent.com/") &&
				notice.source.includes(`/${notice.revision}/`) &&
				before.has(`${notice.package}@${notice.version}`) &&
				after.has(`${notice.package}@${notice.version}`) &&
				/^[a-f0-9]{40}$/.test(notice.revision) &&
				/^[A-Za-z0-9._-]+$/.test(notice.file) &&
				/^[a-f0-9]{64}$/.test(notice.sha256) &&
				sha256(notice.text) === notice.sha256,
			"Invalid reviewed supplemental upstream notice",
		);
}

const DEPENDENCY_POLICY_KEYS = [
	"license",
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
	"overrides",
	"pnpm",
	"engines",
	"packageManager",
];
/** The dependency policy of a protected input; package versions are not policy. */
export function dependencyProjection(file, bytes) {
	if (!file.endsWith("package.json")) return bytes;
	const p = JSON.parse(bytes);
	return canonical(
		Object.fromEntries(DEPENDENCY_POLICY_KEYS.map((k) => [k, p[k] ?? null])),
	);
}
const refreshInput = (file) =>
	file === "pnpm-lock.yaml" ||
	file === "pnpm-workspace.yaml" ||
	file === "package.json" ||
	file.endsWith("/package.json");
/** Licenses accepted for packages that ship inside the binary or web bundle. */
const SHIPPED_LICENSES = [
	"MIT",
	"ISC",
	"BSD-3-Clause",
	"BSD-2-Clause",
	"Apache-2.0",
	"0BSD",
];

/**
 * Schema 3 reviews a dependency refresh: changed pins, workspace overrides and
 * additions across the workspace. Every added or changed lockfile package is
 * enumerated. Packages the binary or web bundle actually ship carry their exact
 * npm archive and full notices; build and test tooling is pinned by integrity
 * and declared license, and the binary build refuses to bundle it.
 */
export function reviewedDependencyRefresh(
	root,
	baselineCommit,
	candidateCommit,
	reference,
) {
	if (reference.schemaVersion !== 3) return;
	requireValue(
		/^distribution\/dependency-reviews\/[a-z0-9-]+\.json$/.test(
			reference.file,
		) && /^[a-f0-9]{64}$/.test(reference.sha256),
		"Invalid dependency refresh review reference",
	);
	const git = (args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			maxBuffer: 64 * 1024 ** 2,
		});
	const show = (commit, file) => git(["show", `${commit}:${file}`]);
	const text = show(candidateCommit, reference.file);
	requireValue(
		sha256(text) === reference.sha256,
		"Dependency refresh review hash mismatch",
	);
	const review = JSON.parse(text);
	requireValue(
		review.schemaVersion === 3 &&
			review.baselineCommit === baselineCommit &&
			/^[a-f0-9]{40}$/.test(review.commit) &&
			typeof review.reviewedBy === "string" &&
			review.reviewedBy.trim() &&
			typeof review.scope === "string" &&
			review.scope.trim(),
		"Missing independent dependency refresh review",
	);
	requireValue(
		git(["merge-base", review.commit, candidateCommit]).trim() ===
			review.commit,
		"Reviewed dependency commit is not an ancestor",
	);
	// Added or removed inputs fail the protected inventory check separately.
	const tree = (commit) =>
		git(["ls-tree", "-r", "--name-only", commit]).trim().split("\n");
	const existing = new Set(tree(baselineCommit));
	const inputs = tree(candidateCommit).filter(
		(file) => refreshInput(file) && existing.has(file),
	);
	const changed = inputs.filter(
		(file) =>
			dependencyProjection(file, show(baselineCommit, file)) !==
			dependencyProjection(file, show(candidateCommit, file)),
	);
	requireValue(
		canonical((review.files ?? []).map((r) => r.file).sort()) ===
			canonical([...changed].sort()),
		"Dependency refresh review must bind exactly the changed dependency inputs",
	);
	for (const record of review.files) {
		const before = dependencyProjection(
				record.file,
				show(baselineCommit, record.file),
			),
			after = dependencyProjection(
				record.file,
				show(candidateCommit, record.file),
			);
		requireValue(
			record.beforeSha256 === sha256(before) &&
				record.afterSha256 === sha256(after) &&
				dependencyProjection(record.file, show(review.commit, record.file)) ===
					after,
			"Reviewed dependency inputs changed",
		);
		if (record.file.endsWith("package.json"))
			requireValue(
				canonical(
					JSON.parse(show(baselineCommit, record.file)).license ?? null,
				) ===
					canonical(
						JSON.parse(show(candidateCommit, record.file)).license ?? null,
					),
				"Dependency refresh review cannot change package licensing",
			);
	}
	const before = lockPackages(show(baselineCommit, "pnpm-lock.yaml")),
		after = lockPackages(show(candidateCommit, "pnpm-lock.yaml"));
	const delta = [...after.keys()]
		.filter((k) => !before.has(k) || before.get(k).block !== after.get(k).block)
		.sort();
	requireValue(
		Array.isArray(review.packages) &&
			review.packages.length > 0 &&
			review.packages.length <= 400 &&
			canonical(review.packages.map((p) => `${p.name}@${p.version}`).sort()) ===
				canonical(delta),
		"Dependency refresh review does not cover every added or changed package",
	);
	for (const p of review.packages) {
		requireValue(
			["bundled", "tooling"].includes(p.distribution) &&
				typeof p.license === "string" &&
				p.license.trim(),
			"Reviewed package needs its distribution role and declared license",
		);
		if (p.distribution === "bundled")
			verifyReviewedSource(p, after, SHIPPED_LICENSES);
		else
			requireValue(
				after.get(`${p.name}@${p.version}`).integrity === p.integrity,
				"Reviewed tooling package integrity changed",
			);
	}
	verifySupplementalNotices(review, before, after);
	return {
		...review,
		reviewFile: reference.file,
		reviewSha256: reference.sha256,
	};
}

export async function retainReviewedJavascriptSources(
	observations,
	directory,
	transport = fetch,
) {
	const reviews = new Map(
		observations
			.filter((o) => [2, 3].includes(o.review?.schemaVersion))
			.map((o) => [o.review.reviewSha256, o.review]),
	);
	const records = [];
	for (const review of reviews.values())
		for (const p of review.packages) {
			// Tooling never ships; the binary build refuses to bundle it.
			if (p.distribution === "tooling") continue;
			const a = p.archive,
				response = await transport(a.url, {
					signal: AbortSignal.timeout(60000),
				});
			requireValue(
				response.ok && response.body,
				"Reviewed npm source download failed",
			);
			const chunks = [];
			let size = 0;
			for await (const chunk of response.body) {
				size += chunk.length;
				requireValue(size <= a.size, "Reviewed npm source exceeds pinned size");
				chunks.push(chunk);
			}
			const bytes = Buffer.concat(chunks);
			requireValue(
				bytes.length === a.size &&
					sha256(bytes) === a.sha256 &&
					`sha512-${createHash("sha512").update(bytes).digest("base64")}` ===
						p.integrity,
				"Reviewed npm source integrity mismatch",
			);
			const path = join(directory, a.file);
			if (existsSync(path))
				requireValue(
					sha256(readFileSync(path)) === a.sha256,
					"Retained npm source conflicts with reviewed archive",
				);
			else writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
			const collect = [p.packageJson.path, ...p.licenses.map((l) => l.path)];
			const inspected = inspectArchive(path, {
				prefix: `${p.packageJson.path.split("/")[0]}/`,
				regularOnly: true,
				collect,
				limits: {
					maxCompressedBytes: 8 * 1024 ** 2,
					maxExpandedBytes: 32 * 1024 ** 2,
					maxMembers: 10000,
				},
			});
			requireValue(
				!inspected.entries.some((e) =>
					/\.(node|so(?:\.[0-9]+)*|dll|dylib|a|o|lib|exe|wasm)$/.test(e.name),
				),
				"Native component requires a fresh native source baseline",
			);
			const packageText = inspected.texts[p.packageJson.path],
				pkg = JSON.parse(packageText);
			requireValue(
				sha256(packageText) === p.packageJson.sha256 &&
					pkg.name === p.name &&
					pkg.version === p.version &&
					pkg.license === p.license &&
					!["preinstall", "install", "postinstall"].some(
						(k) => pkg.scripts?.[k],
					),
				"Reviewed npm package metadata changed or contains native installation hooks",
			);
			for (const license of p.licenses)
				requireValue(
					sha256(inspected.texts[license.path] ?? "") === license.sha256,
					"Reviewed upstream notice missing from package source",
				);
			records.push({
				kind: "javascript-dependency-source",
				file: a.file,
				source: a.url,
				revision: `${p.name}@${p.version}`,
				size: a.size,
				sha256: a.sha256,
			});
		}
	for (const review of reviews.values())
		for (const notice of review.supplementalNotices ?? []) {
			const path = join(directory, notice.file);
			const bytes = Buffer.from(notice.text);
			requireValue(
				sha256(bytes) === notice.sha256,
				"Supplemental JavaScript license changed",
			);
			if (existsSync(path))
				requireValue(
					sha256(readFileSync(path)) === notice.sha256,
					"Retained JavaScript license conflicts",
				);
			else writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
			records.push({
				kind: "javascript-license",
				file: notice.file,
				source: notice.source,
				revision: notice.revision,
				size: bytes.length,
				sha256: notice.sha256,
			});
		}
	return records;
}
