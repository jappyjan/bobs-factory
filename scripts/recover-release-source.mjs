#!/usr/bin/env node
// Offline source recovery from a retained complete signed release. Never publishes.
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { requireValue } from "./lib/binary-release.mjs";
import { validatePreparedRelease } from "./lib/prepared-release.mjs";
import { verifyManifestSignature } from "./lib/release-signature.mjs";

const { values } = parseArgs({
	options: {
		assets: { type: "string" },
		output: { type: "string" },
	},
});
requireValue(
	values.assets && values.output,
	"Provide --assets SIGNED_ASSETS_DIRECTORY --output NEW_DIRECTORY",
);
const assets = resolve(values.assets),
	output = resolve(values.output);
requireValue(
	lstatSync(assets).isDirectory(),
	"Recovery assets directory must not be a link",
);
for (const file of ["release.json", "release.json.sig", "release.json.key-id"])
	requireValue(
		lstatSync(join(assets, file)).isFile(),
		"Recovery manifest/signatures must be regular files",
	);
const bytes = readFileSync(join(assets, "release.json"));
verifyManifestSignature(
	bytes,
	readFileSync(join(assets, "release.json.sig")),
	readFileSync(join(assets, "release.json.key-id"), "utf8").trim(),
);
// Full prepared validation reconstructs into an owned temporary directory and
// runs the unchanged source/evidence intake before retaining any recovered bytes.
mkdirSync(output, { mode: 0o700 });
try {
	const { manifest } = validatePreparedRelease(assets, undefined, {
		recoveredSourceDirectory: output,
		expectedManifestBytes: bytes,
	});
	console.log(
		`Recovered ${manifest.source.file}: ${manifest.source.size} bytes, SHA256 ${manifest.source.sha256}`,
	);
} catch (error) {
	rmSync(output, { recursive: true, force: true });
	throw error;
}
