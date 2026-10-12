// Real retained producer ZIP paths with compact controlled payloads. Native,
// installer and receipt bytes here are test fixtures, never release evidence.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DesktopAppSource } from "../../apps/desktop/src/app-source.mjs";
import { generateRecipes } from "../generate-package-recipes.mjs";
import { restoreArtifact } from "../lib/artifact-transport.mjs";
import {
	fileRecord,
	jsonBytes,
	sha256File,
	TARGETS,
	validateArchive,
	validateReleaseManifest,
} from "../lib/binary-release.mjs";
import {
	discoverReleases,
	githubClient,
	verifyPublishedRelease,
} from "../lib/github-release.mjs";
import {
	archiveNativeNotices,
	stageNightlyDesktop,
} from "../lib/nightly-artifacts.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { fixtureTar } from "./source-material-fixture.mjs";

const shapes = JSON.parse(
	readFileSync(new URL("nightly-producer-shapes.json", import.meta.url)),
).shapes;
const publicationTransport = fileURLToPath(
	new URL("publication-transport.mjs", import.meta.url),
);
async function restoredDesktop(f, target) {
	const input = join(f.work, `producer-${target}`),
		restored = join(f.work, `restored-${target}`);
	const members = shapes[`desktop-${target}`].members.map((p) =>
		p.replaceAll("{version}", f.identity.version),
	);
	for (const member of members) {
		mkdirSync(join(input, member, ".."), { recursive: true });
		writeFileSync(join(input, member), `Controlled compact ${member}`);
	}
	const nativeName = `bobs-factory-${f.identity.version}-${target}.tar.gz`;
	copyFileSync(join(f.assets, nativeName), join(input, "runtime", nativeName));
	const directory = join(input, "desktop"),
		record = (file) => fileRecord(join(directory, file), file);
	const assets = members
		.filter((p) => /\.(dmg|AppImage|deb)$/.test(p))
		.map((p) => record(p.slice("desktop/".length)));
	const archive = target.startsWith("darwin")
		? record(
				members.find((p) => p.endsWith(".bobsapp.gz")).slice("desktop/".length),
			)
		: assets.find((a) => a.file.endsWith(".AppImage"));
	const metadata = record(`desktop-update-${target}.json`);
	writeFileSync(
		join(directory, "desktop-build.json"),
		jsonBytes({
			...f.identity,
			target,
			candidateDigest: f.candidate.digest,
			assets,
			update: { archive, metadata },
			licenseValidation: { status: "passed" },
			scope: "Controlled fixture, no native validation claim",
		}),
	);
	writeFileSync(
		join(directory, "native-electron-receipt.json"),
		jsonBytes({
			passed: true,
			platform: target.split("-")[0],
			arch: target.split("-")[1],
			scope: "Controlled fixture",
		}),
	);
	writeFileSync(
		join(directory, "native-service-receipt.json"),
		jsonBytes({ passed: true, scope: "Controlled fixture" }),
	);
	if (target.startsWith("linux"))
		writeFileSync(
			join(directory, "native-shell-update-receipt.json"),
			jsonBytes({ status: "passed", scope: "Controlled fixture" }),
		);
	const zip = join(f.work, `${target}-desktop.zip`);
	execFileSync("zip", ["-q", zip, ...members], { cwd: input });
	assert.deepEqual(
		execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
			.trim()
			.split("\n")
			.sort(),
		members.toSorted(),
	);
	const client = {
		headers: {},
		transport: async (url) =>
			String(url).startsWith("https://api.github.com/")
				? new Response(null, {
						status: 302,
						headers: { location: "https://fixture.invalid/zip" },
					})
				: new Response(readFileSync(zip)),
	};
	await restoreArtifact(
		client,
		{ id: 1, digest: `sha256:${sha256File(zip)}`, expired: false },
		restored,
	);
	return restored;
}

test("valid native five-member archive produces the exact shipped notices without a nonexistent licenses directory", () => {
	const f = preparedFixture();
	try {
		const target = "darwin-arm64",
			stem = `bobs-factory-${f.identity.version}-${target}`,
			archive = join(f.assets, `${stem}.tar.gz`);
		validateArchive(
			archive,
			join(f.assets, `${stem}.manifest.json`),
			f.identity,
			target,
		);
		const extracted = join(f.work, "extracted");
		mkdirSync(extracted);
		fixtureTar(["-xzf", archive, "-C", extracted]);
		const native = join(extracted, stem),
			output = join(f.work, "native-notices.tar.gz");
		archiveNativeNotices(native, output);
		assert.deepEqual(
			fixtureTar(["-tzf", output], { encoding: "utf8" })
				.trim()
				.split("\n")
				.sort(),
			["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"],
		);
		for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"])
			assert.deepEqual(
				fixtureTar(["-xOzf", output, name]),
				readFileSync(join(native, name)),
			);
	} finally {
		f.cleanup();
	}
});

for (const target of TARGETS)
	test(`nightly consumer reads retained ${target} desktop/runtime ZIP paths and keeps native/hash checks`, async () => {
		const f = preparedFixture();
		try {
			const restored = await restoredDesktop(f, target),
				output = join(f.work, "staged");
			mkdirSync(output);
			stageNightlyDesktop(restored, f.assets, output, f.identity, target);
			const stem = `bobs-factory-${f.identity.version}-${target}.tar.gz`,
				archive = join(restored, "runtime", stem),
				original = readFileSync(archive);
			// A root basename cannot override the producer's runtime/ member.
			writeFileSync(join(restored, stem), original);
			writeFileSync(archive, "changed runtime");
			const rejected = join(f.work, "rejected");
			mkdirSync(rejected);
			assert.throws(
				() =>
					stageNightlyDesktop(restored, f.assets, rejected, f.identity, target),
				/exact canonical native runtime/,
			);
			assert.deepEqual(readdirSync(rejected), []);
			writeFileSync(archive, original);
			writeFileSync(
				join(restored, "desktop", `desktop-update-${target}.json`),
				"changed metadata",
			);
			assert.throws(
				() =>
					stageNightlyDesktop(restored, f.assets, rejected, f.identity, target),
				/integrity mismatch/,
			);
		} finally {
			f.cleanup();
		}
	});

test("restored all-format nightly round-trips through fresh preparation, Homebrew recipes and desktop discovery with DEBs only in the generic inventory", async () => {
	const f = preparedFixture("nightly", { gitTooling: true });
	try {
		const evidenceDirectory = join(f.work, "evidence");
		mkdirSync(evidenceDirectory);
		const artifacts = [],
			additionalAssets = [];
		for (const target of TARGETS) {
			const restored = await restoredDesktop(f, target);
			const staged = stageNightlyDesktop(
				restored,
				f.assets,
				evidenceDirectory,
				f.identity,
				target,
			);
			artifacts.push(...staged.artifacts);
			additionalAssets.push(...(staged.additionalAssets ?? []));
		}
		const evidence = JSON.parse(
			readFileSync(join(f.assets, "release-evidence.json")),
		);
		evidence.desktop = { schemaVersion: 1, artifacts, additionalAssets };
		for (const file of ["candidate.json", "source-rebuild.tar.gz"])
			copyFileSync(join(f.assets, file), join(evidenceDirectory, file));
		copyFileSync(
			join(f.work, "receipt.txt"),
			join(evidenceDirectory, "receipt.txt"),
		);
		writeFileSync(
			join(evidenceDirectory, "release-evidence.json"),
			jsonBytes(evidence),
		);
		const zips = join(f.work, "native-zips");
		mkdirSync(zips);
		const provenance = JSON.parse(
			readFileSync(join(f.assets, "build-provenance.json")),
		);
		for (const [target, artifact] of Object.entries(provenance.artifacts)) {
			const input = join(f.work, `native-${target}`);
			mkdirSync(input);
			const stem = `bobs-factory-${f.identity.version}-${target}`;
			for (const suffix of [".tar.gz", ".manifest.json"])
				copyFileSync(join(f.assets, stem + suffix), join(input, stem + suffix));
			for (const name of [
				"runtime-smoke",
				"native-helpers",
				"prepared-agent-boundaries",
				"public-installer",
			]) {
				const ext = name === "runtime-smoke" ? "txt" : "json";
				copyFileSync(
					join(f.assets, `${name}-${target}.${ext}`),
					join(input, `${name}.${ext}`),
				);
			}
			const members = shapes[`binary-${target}`].members.map((p) =>
				p.replaceAll("{version}", f.identity.version),
			);
			for (const member of members.filter((p) => p.startsWith(`${stem}/`))) {
				mkdirSync(join(input, member, ".."), { recursive: true });
				copyFileSync(join(f.work, member), join(input, member));
			}
			const zip = join(zips, `${target}.zip`);
			execFileSync("zip", ["-q", zip, ...members], { cwd: input });
			artifact.digest = `sha256:${sha256File(zip)}`;
		}
		const provider = join(f.work, "provider.json"),
			output = join(f.work, "fresh"),
			contents = {
				"apps/cli/package.json": Buffer.from(
					JSON.stringify({ version: f.identity.committedVersion }),
				).toString("base64"),
			};
		for (const name of ["install.sh", "install-binary.sh"])
			contents[`scripts/${name}`] = readFileSync(
				join(f.work, "scripts", name),
			).toString("base64");
		writeFileSync(
			provider,
			jsonBytes({
				assets: [],
				operations: [],
				buildProvenance: provenance,
				contents,
			}),
		);
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				publicationTransport,
				join(f.work, "scripts/publish-binary-release.mjs"),
				"--candidate",
				join(evidenceDirectory, "candidate.json"),
				"--run-id",
				"123",
				"--evidence",
				join(evidenceDirectory, "release-evidence.json"),
				"--artifact-zips",
				zips,
				"--output",
				output,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GH_TOKEN: "synthetic-fixture",
					BOBS_FACTORY_TEST_PROVIDER: provider,
				},
			},
		);
		assert.equal(result.status, 0, result.stderr);
		const prepared = validatePreparedRelease(
				join(output, "assets"),
				f.candidate,
			),
			manifest = prepared.manifest;
		const records = [
			...manifest.assets,
			fileRecord(join(output, "assets/release.json"), "release.json"),
		];
		const release = {
			id: 1,
			tag_name: manifest.tag,
			prerelease: true,
			draft: false,
			published_at: "2026-10-12T00:00:00Z",
			assets: records.map((r) => ({
				name: r.file,
				state: "uploaded",
				size: r.size,
				digest: `sha256:${r.sha256}`,
				browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${manifest.tag}/${r.file}`,
			})),
		};
		const client = githubClient("", async (url) => {
			const p = new URL(url).pathname;
			if (new URL(url).hostname === "github.com")
				return new Response(
					readFileSync(join(output, "assets", p.split("/").at(-1))),
				);
			if (p === "/repos/jappyjan/bobs-factory")
				return Response.json({
					full_name: "jappyjan/bobs-factory",
					private: false,
					visibility: "public",
				});
			if (p.endsWith("/releases")) return Response.json([release]);
			if (p.endsWith(`/releases/tags/${manifest.tag}`))
				return Response.json(release);
			if (p.endsWith("/releases/1/assets"))
				return Response.json(release.assets);
			if (p.endsWith(`/git/ref/tags/${manifest.tag}`))
				return Response.json({
					object: { type: "commit", sha: manifest.commit },
				});
			throw Error(`Unexpected fixture request ${url}`);
		});
		const recipes = await generateRecipes(client, manifest.version, "desktop");
		assert.match(
			recipes["Casks/bobs-factory@nightly.rb"],
			/mac-arm64|mac-#\{arch\}/,
		);
		assert.deepEqual(
			manifest.desktop.artifacts.map((a) => a.target).toSorted(),
			TARGETS.toSorted(),
		);
		assert.equal(
			manifest.assets.filter((a) => /\.(dmg|AppImage|deb)$/.test(a.file))
				.length,
			6,
		);
		const verified = await discoverReleases(client, {
			selectedOnly: true,
			allowBetaFallback: false,
		});
		for (const target of TARGETS) {
			const source = new DesktopAppSource(
				f.work,
				"unused-fixture-install",
				target,
				{ discoverReleases, verifyPublishedRelease, validateReleaseManifest },
				client,
			);
			assert.equal(
				(await source.discover({ channel: "nightly" })).target,
				target,
			);
			const item = verified.nightly.manifest.desktop.artifacts.find(
				(a) => a.target === target,
			);
			assert.equal(
				item.archive.file.endsWith(
					target.startsWith("linux") ? ".AppImage" : ".dmg",
				),
				true,
			);
			assert.equal(Boolean(item.updateArchive), target.startsWith("darwin"));
		}
		assert.deepEqual(
			JSON.parse(readFileSync(provider)).operations.filter(
				(o) => o.method !== "GET",
			),
			[],
		);
		// The generic DEB is still bound to the producer's measured bytes.
		const deb = additionalAssets[0];
		writeFileSync(
			join(evidenceDirectory, deb.file),
			"Changed DEB after staging",
		);
		const rejected = spawnSync(
			process.execPath,
			[
				"--import",
				publicationTransport,
				join(f.work, "scripts/publish-binary-release.mjs"),
				"--candidate",
				join(evidenceDirectory, "candidate.json"),
				"--run-id",
				"123",
				"--evidence",
				join(evidenceDirectory, "release-evidence.json"),
				"--artifact-zips",
				zips,
				"--output",
				join(f.work, "rejected-deb"),
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GH_TOKEN: "synthetic-fixture",
					BOBS_FACTORY_TEST_PROVIDER: provider,
				},
			},
		);
		assert.notEqual(rejected.status, 0);
		assert.match(rejected.stderr, /Delivered desktop integrity mismatch/);
	} finally {
		f.cleanup();
	}
});
