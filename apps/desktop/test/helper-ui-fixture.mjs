// Scripted UI/AppImage processes only; no native Electron or production install.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appUpdates } from "../src/app-updates.mjs";
import * as services from "../src/update-services.mjs";
import { appRelease, fixtureClient } from "./shell-fixture.mjs";

const root = process.argv[2],
	mode = process.argv[3],
	target = "linux-arm64";
const candidateScript = Buffer.from(`#!${process.execPath}
const {readFileSync,writeFileSync} = require("node:fs");
const {join} = require("node:path");
(async () => {
const {appUpdates} = await import(${JSON.stringify(new URL("../src/app-updates.mjs", import.meta.url).href)});
const services = await import(${JSON.stringify(new URL("../src/update-services.mjs", import.meta.url).href)});
const home = process.env.BOBS_FACTORY_DESKTOP_HOME;
const state = JSON.parse(readFileSync(join(home,"desktop","updates","state.json")));
const updates = await appUpdates({home, install:process.argv[1], target:"linux-arm64", identity:state.transaction.candidate, port:3999, services});
updates.health(process.env.BOBS_FACTORY_DESKTOP_HEALTH);
setInterval(() => { if (updates.quitRequested()) process.exit(0); }, 50);
})().catch(error => {writeFileSync(join(process.env.BOBS_FACTORY_DESKTOP_HOME,"candidate-error.log"),error.stack);process.exit(1);});
`);
const old = appRelease(
	"stable",
	Buffer.from("old fixture; never executed"),
	target,
	{ stableVersion: "0.9.0" },
);
const good = appRelease("nightly", candidateScript, target);
const cleanup = () => {
	old.cleanup();
	good.cleanup();
};
process.on("SIGTERM", () => {
	cleanup();
	process.exit(0);
});
try {
	const home = join(root, "home"),
		install = join(root, "UI.AppImage");
	writeFileSync(install, readFileSync(join(old.assets, "fixture.AppImage")), {
		mode: 0o755,
	});
	const client = fixtureClient([old, good], services);
	const updates = await appUpdates({
		home,
		install,
		target,
		identity: { ...old.identity, target },
		port: 3999,
		sourceDirectory: fileURLToPath(new URL("../src", import.meta.url)),
		services: { ...services, githubClient: () => client },
	});
	await updates.action("verify-installation");
	if (mode === "imports") {
		await updates.action("recover");
		process.send({ home, install });
		await new Promise((resolve) => process.once("message", resolve));
	} else {
		await updates.action(
			"configure",
			{ channel: "nightly" },
			updates.status().revision,
		);
		await updates.action("check");
		const state = updates.status();
		await updates.action(
			"install",
			services.candidateKey(state.pending.candidate),
			state.revision,
		);
		process.send({ home, install, candidate: state.pending.candidate });
		const deadline = Date.now() + 5000;
		while (!updates.quitRequested()) {
			if (Date.now() > deadline)
				throw Error("Install helper never requested exact UI exit");
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
} finally {
	cleanup();
}
process.disconnect();
