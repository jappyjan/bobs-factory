// Free local Mach-O signing for native Apple Silicon packaging. No certificate,
// Apple account, keychain identity discovery, notarization or stapling.
const { execFileSync, spawnSync } = require("node:child_process");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
module.exports = async (context) => {
	if (context.electronPlatformName !== "darwin" || process.arch !== "arm64")
		return;
	const app = join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	);
	const runtime = join(app, "Contents", "Resources", "runtime", "bobs-factory");
	const frozenRuntime = readFileSync(runtime);
	const sign = (path) =>
		execFileSync(
			"/usr/bin/codesign",
			[
				"--force",
				"--sign",
				"-",
				"--timestamp=none",
				"--preserve-metadata=entitlements,flags,runtime",
				path,
			],
			{ stdio: "inherit" },
		);
	// Existing framework code and the frozen Bun runtime retain their bytes. Repair
	// only nested Electron bundles invalidated by packaging, before the outer seal.
	const frameworks = join(app, "Contents", "Frameworks");
	for (const entry of readdirSync(frameworks)) {
		if (!/\.(app|framework)$/.test(entry)) continue;
		const path = join(frameworks, entry);
		if (
			spawnSync("/usr/bin/codesign", ["--verify", "--strict", path]).status !==
			0
		)
			sign(path);
	}
	sign(app);
	execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
		stdio: "inherit",
	});
	if (!readFileSync(runtime).equals(frozenRuntime))
		throw Error("Local signing changed the frozen runtime");
};
