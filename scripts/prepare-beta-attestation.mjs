#!/usr/bin/env node
// Produces additive integrity assets for historical beta; never edits/releases it.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	sha256,
} from "./lib/binary-release.mjs";
import { validatePreparedRelease } from "./lib/prepared-release.mjs";

const { values } = parseArgs({
	options: {
		assets: { type: "string" },
		output: { type: "string" },
		approval: { type: "string" },
	},
});
requireValue(
	values.assets && values.output && values.approval,
	"Historical beta needs immutable assets, explicit inventory approval",
);
const directory = resolve(values.assets),
	output = resolve(values.output);
requireValue(
	directory !== output &&
		(!existsSync(output) || readdirSync(output).length === 0),
	"Use a separate empty output; historical assets are never modified",
);
const { manifest, manifestBytes, inventory } = validatePreparedRelease(
	directory,
	undefined,
	{ legacyBeta: true },
);
requireValue(
	manifest.schemaVersion === 1,
	"Only historical beta uses attestation; new releases use schema 2",
);
const assetsDigest = sha256(
	jsonBytes(inventory.sort((a, b) => a.file.localeCompare(b.file))),
);
const approval = JSON.parse(readFileSync(resolve(values.approval)));
requireValue(
	approval.manifestSha256 === sha256(manifestBytes) &&
		approval.assetsDigest === assetsDigest &&
		typeof approval.approvedBy === "string" &&
		approval.approvedBy.trim(),
	"Approval must bind exact historical manifest and full inventory",
);
const attestation = jsonBytes({
	schemaVersion: 1,
	product: "bobs-factory",
	repository: manifest.repository,
	version: manifest.version,
	tag: manifest.tag,
	commit: manifest.commit,
	manifest: fileRecord(join(directory, "release.json"), "release.json"),
	assets: inventory,
	approvedBy: approval.approvedBy,
});
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "release-attestation.json"), attestation, {
	flag: "wx",
});
console.log(
	`Prepared additive integrity only. No existing archive, manifest or tag was modified. Inventory: ${assetsDigest}`,
);
