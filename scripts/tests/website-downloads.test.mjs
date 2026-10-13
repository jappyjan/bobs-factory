import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	renderDesktopDownloads,
	updateDownloadsPage,
} from "../lib/website-downloads.mjs";

const selected = (version, files) => ({
	manifest: {
		status: "available",
		repository: "jappyjan/bobs-factory",
		version,
		tag: `v${version}`,
		assets: files.map((file) => ({ file, sha256: "a".repeat(64), size: 123 })),
		desktop: {
			artifacts: files
				.filter((file) => /\.(dmg|AppImage)$/.test(file))
				.map((file) => ({
					target: file.includes("mac-arm64")
						? "darwin-arm64"
						: file.includes("mac-x64")
							? "darwin-x64"
							: file.includes("linux-arm64")
								? "linux-arm64"
								: "linux-x64",
					archive: { file, sha256: "a".repeat(64), size: 123 },
				})),
			additionalAssets: files
				.filter((file) => file.endsWith(".deb"))
				.map((file) => ({ file, sha256: "a".repeat(64), size: 123 })),
		},
	},
});
test("website links only exact selected inventory assets, labeling beta and nightly separately", () => {
	const beta = "1.0.1-beta",
		nightly = "1.0.0-nightly.20261012.123";
	const state = {
		stable: selected(beta, [
			`bobs-factory-desktop-${beta}-mac-arm64.dmg`,
			`bobs-factory-desktop-${beta}-linux-x64.AppImage`,
			`bobs-factory-desktop-${beta}-linux-x64.deb`,
			"unrelated.dmg",
		]),
		nightly: selected(nightly, [`bobs-factory-desktop-${nightly}-mac-x64.dmg`]),
	};
	const rendered = renderDesktopDownloads(state);
	assert.match(rendered, /Default · beta 1.0.1-beta/);
	assert.match(
		rendered,
		/releases\/download\/v1.0.1-beta\/bobs-factory-desktop-1.0.1-beta-mac-arm64.dmg/,
	);
	assert.match(rendered, /Linux x64 · AppImage/);
	assert.match(rendered, /Linux x64 · deb/);
	assert.match(rendered, /Nightly · nightly/);
	assert.equal(rendered.includes("unrelated.dmg"), false);
	assert.equal(rendered.includes("linux-arm64"), false);
	const template = readFileSync(
		new URL("../../website/public/downloads/index.html", import.meta.url),
		"utf8",
	);
	const page = updateDownloadsPage(template, state);
	assert.equal(updateDownloadsPage(page, state), page);
	assert.equal(
		renderDesktopDownloads({}).includes("releases/download/"),
		false,
	);
	assert.equal(
		updateDownloadsPage(page, {}).includes("releases/download/"),
		false,
	);
});
