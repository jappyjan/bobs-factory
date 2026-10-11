// Functional unsigned transport/update boundary. Native and review receipts are
// explicitly simulated by preparedFixture; this never publishes a real release.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PublishedUpdateSource } from "../../packages/edge-worker/dist/updates/PublishedUpdateSource.js";
import { UpdateManager } from "../../packages/edge-worker/dist/updates/UpdateManager.js";
import { fileRecord, jsonBytes } from "../lib/binary-release.mjs";
import { discoverReleases, githubClient } from "../lib/github-release.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";

const transport = fileURLToPath(
	new URL("./publication-transport.mjs", import.meta.url),
);
test("unsigned publisher → discovery → prepared/offline chunks → updater preserves integrity and rollback", async () => {
	const f = preparedFixture("nightly", { sourceChunks: true });
	try {
		const provider = join(f.work, "provider.json");
		writeFileSync(
			provider,
			jsonBytes({ assets: [], operations: [], mainSha: f.identity.commit }),
		);
		const publish = spawnSync(
			process.execPath,
			[
				"--import",
				transport,
				join(f.work, "scripts/publish-binary-release.mjs"),
				"--candidate",
				join(f.assets, "candidate.json"),
				"--run-id",
				"123",
				"--output",
				f.output,
				"--resume",
				"--publish",
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					TMPDIR: f.work,
					GH_TOKEN: "synthetic-test-token",
					BOBS_FACTORY_TEST_PROVIDER: provider,
					BOBS_FACTORY_AUTOMATIC_NIGHTLIES: "enabled",
					BOBS_FACTORY_RELEASE_PUBLICATION_LOCK: "repository",
				},
			},
		);
		assert.equal(publish.status, 0, publish.stderr);
		assert.equal(existsSync(join(f.assets, "release.json.sig")), false);
		const state = JSON.parse(readFileSync(provider));
		assert.equal(state.release.draft, false);
		assert.equal(state.release.make_latest, "false");
		const plan = JSON.parse(
			readFileSync(join(f.output, "publication-plan.json")),
		);
		assert.equal(plan.publisherSignature, "none");
		validatePreparedRelease(f.assets, f.candidate);
		const recovered = join(f.work, "offline-source");
		const recovery = spawnSync(
			process.execPath,
			[
				join(f.work, "scripts/recover-release-source.mjs"),
				"--assets",
				f.assets,
				"--output",
				recovered,
			],
			{ encoding: "utf8" },
		);
		assert.equal(recovery.status, 0, recovery.stderr);
		assert.deepEqual(
			fileRecord(
				join(recovered, f.manifest.source.file),
				f.manifest.source.file,
			),
			f.manifest.source,
		);
		let corruptArchive = false;
		const client = githubClient("", async (url) => {
			const u = new URL(url),
				p = u.pathname;
			if (u.hostname === "github.com") {
				const asset = state.assets.find(
					(a) => a.browser_download_url === String(url),
				);
				assert.ok(asset, "Only exact published HTTPS assets may be downloaded");
				const bytes = Buffer.from(asset.bytes, "base64");
				if (
					corruptArchive &&
					asset.name.endsWith(".tar.gz") &&
					asset.name.startsWith("bobs-factory-")
				)
					bytes[0] ^= 255;
				return new Response(bytes);
			}
			if (p.endsWith("/releases"))
				return Response.json([{ ...state.release, assets: state.assets }]);
			if (p.includes("/releases/tags/")) return Response.json(state.release);
			if (p.includes(`/releases/${state.release.id}/assets`))
				return Response.json(state.assets);
			if (p.includes("/git/ref/tags/")) return Response.json(state.tag);
			if (p.includes("/git/tags/")) return Response.json(state.annotation);
			if (p.endsWith("/repos/jappyjan/bobs-factory"))
				return Response.json({
					full_name: "jappyjan/bobs-factory",
					private: false,
					visibility: "public",
				});
			throw Error(`Unexpected fixture request: ${url}`);
		});
		const discovered = await discoverReleases(client, {
			selectedOnly: true,
			allowBetaFallback: false,
		});
		assert.equal(discovered.stable, null);
		assert.equal(
			discovered.nightly.manifest.candidateDigest,
			f.candidate.digest,
		);
		const target = `${process.platform}-${process.arch}`;
		const previous = join(f.work, "previous-runtime");
		writeFileSync(previous, "prior runtime stays owned and unchanged");
		const source = new PublishedUpdateSource(
			join(f.work, "staging"),
			previous,
			target,
			client,
		);
		const settings = { channel: "nightly", overrides: {}, paused: false };
		const installed = { version: "0.9.0", commit: "b".repeat(40), target };
		const candidate = await source.discover(settings, installed);
		await assert.rejects(
			source.stage({ ...candidate, commit: "f".repeat(40) }),
			/candidate changed/,
		);
		corruptArchive = true;
		await assert.rejects(source.stage(candidate), /checksum mismatch/);
		assert.equal(
			readFileSync(previous, "utf8"),
			"prior runtime stays owned and unchanged",
		);
		corruptArchive = false;
		const uncheckedClient = {
			...client,
			bytes: async (asset) => {
				const bytes = await client.bytes(asset);
				if (asset.name === f.manifest.targets[target].archive) bytes[0] ^= 255;
				return bytes;
			},
		};
		await assert.rejects(
			new PublishedUpdateSource(
				join(f.work, "unchecked-staging"),
				previous,
				target,
				uncheckedClient,
			).stage(candidate),
			/Downloaded asset integrity mismatch/,
		);
		const calls = [];
		const lifecycle = {
			acquireMaintenance: async () => calls.push("maintenance"),
			isIdle: async () => true,
			preflight: async (staged) => {
				assert.equal(staged.candidate.manifestSha256, candidate.manifestSha256);
				return { stateCompatible: true };
			},
			snapshot: async () => "controlled-compatible-snapshot",
			stop: async () => calls.push("stop"),
			activate: async () => calls.push("activate"),
			start: async () => calls.push("start"),
			health: async () => {
				throw Error("controlled trial health failure");
			},
			rollback: async () => calls.push("rollback"),
			releaseMaintenance: async () => calls.push("release"),
		};
		const manager = new UpdateManager(
			join(f.work, "update-home"),
			source,
			lifecycle,
			installed,
		);
		manager.configure({ channel: "nightly" }, manager.status().revision);
		await manager.check();
		const outcome = await manager.tick();
		assert.equal(outcome.transaction.phase, "rolled-back");
		assert.deepEqual(outcome.installed, installed);
		assert.deepEqual(
			calls.filter((c) =>
				["stop", "activate", "start", "rollback"].includes(c),
			),
			["stop", "activate", "start", "rollback"],
		);
		assert.equal(
			readFileSync(previous, "utf8"),
			"prior runtime stays owned and unchanged",
		);
	} finally {
		f.cleanup();
	}
});
