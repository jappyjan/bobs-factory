import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type {
	ReleaseAsset,
	ReleaseClient,
	VerifiedRelease,
} from "../../../scripts/lib/github-release.mjs";
import { PublishedUpdateSource } from "../src/updates/PublishedUpdateSource.js";

it("rechecks staging integrity against the GitHub asset digest before writing or executing downloaded artifacts", async () => {
	const home = mkdtempSync(join(tmpdir(), "published-update-source-"));
	const names = ["release.json"];
	const client: ReleaseClient = {
		api: vi.fn(async () => ({
			id: 1,
			tag_name: "v1.1.0",
			draft: false,
			published_at: "2026-10-10T16:00:00.000Z",
		})),
		pages: vi.fn(async () =>
			names.map((name) => ({
				name,
				state: "uploaded",
				size: 15,
				digest: `sha256:${"a".repeat(64)}`,
				browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/v1.1.0/${name}`,
			})),
		),
		bytes: vi.fn(async (_asset: ReleaseAsset) =>
			Buffer.from("corrupt payload"),
		),
	};
	const source = new PublishedUpdateSource(
		home,
		"/previous/owned-runtime",
		"darwin-arm64",
		client,
	);
	try {
		await expect(
			source.stage({
				version: "1.1.0",
				channel: "stable",
				commit: "a".repeat(40),
				target: "darwin-arm64",
				publishedAt: "2026-10-10T16:00:00.000Z",
				manifestSha256: "b".repeat(64),
			}),
		).rejects.toThrow("checksum mismatch");
		expect(
			vi.mocked(client.bytes).mock.calls.map(([asset]) => asset.name),
		).toEqual(names);
		expect(readdirSync(home)).toEqual([]);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("rejects canonical beta fallback instead of relabeling its release channel", () => {
	const source = new PublishedUpdateSource(
		"/unused",
		"/unused/previous",
		"darwin-arm64",
	);
	const verified: VerifiedRelease = {
		release: {
			id: 1,
			tag_name: "v1.0.0-beta",
			published_at: "2026-10-10T16:00:00.000Z",
			assets: [],
		},
		manifest: {
			version: "1.0.0-beta",
			channel: "beta",
			commit: "a".repeat(40),
			tag: "v1.0.0-beta",
			verifier: { file: "unused", size: 1, sha256: "b".repeat(64) },
			targets: {
				"darwin-arm64": {
					archive: "unused",
					archiveSha256: "b".repeat(64),
					archiveSize: 1,
					manifest: "unused",
					manifestSha256: "b".repeat(64),
					manifestSize: 1,
				},
			},
		},
		manifestSha256: "c".repeat(64),
	};
	// Tests the conversion boundary only; does not claim published release evidence.
	expect(() => (source as any).candidate(verified, "stable")).toThrow(
		"Release belongs to another channel",
	);
	expect(() => (source as any).candidate(verified, "nightly")).toThrow(
		"another channel",
	);
});
