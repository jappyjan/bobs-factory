import { lstatSync, readFileSync as virtualRead } from "node:fs";
import { join } from "node:path";
import { packApp, tree, unpackApp } from "../src/app-archive.mjs";
import { cpSync, readFileSync, writeFileSync } from "../src/app-filesystem.mjs";
import { appFingerprint } from "../src/app-source.mjs";

const app = process.argv[2],
	asar = join(app, "Contents", "Resources", "app.asar");
const noAsarBefore = process.noAsar ?? null;
const virtualDirectory = lstatSync(asar).isDirectory();
const entries = tree(app);
const destination = `${app}.unpacked`;
unpackApp(packApp(app), destination);
const copy = `${app}.copied`;
cpSync(app, copy, {
	recursive: true,
	dereference: false,
	verbatimSymlinks: true,
});
const copied = tree(copy),
	beforeFingerprint = appFingerprint(copy, "darwin-arm64");
const copyAsar = join(copy, "Contents", "Resources", "app.asar"),
	bytes = readFileSync(copyAsar);
bytes[bytes.length - 1] ^= 1;
writeFileSync(copyAsar, bytes);
console.log(
	JSON.stringify({
		electron: process.versions.electron,
		virtualDirectory,
		entries,
		unpacked: tree(destination),
		copied,
		changedFingerprint:
			appFingerprint(copy, "darwin-arm64") !== beforeFingerprint,
		virtualPackageReadable:
			JSON.parse(virtualRead(`${asar}/package.json`, "utf8")).name.length > 0,
		noAsarBefore,
		noAsarAfter: process.noAsar ?? null,
		virtualDirectoryAfter: lstatSync(asar).isDirectory(),
	}),
);
