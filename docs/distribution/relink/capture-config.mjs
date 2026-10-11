import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Call the unmodified pinned generator again to capture its returned Config.
// configure.json alone records unresolved overrides, not the resolved config.
const [source, build, output] = process.argv.slice(2);
const { configure } = await import(
	pathToFileURL(join(source, "scripts/build/configure.ts"))
);
const { computeFlags } = await import(
	pathToFileURL(join(source, "scripts/build/flags.ts"))
);
const input = JSON.parse(readFileSync(join(build, "configure.json"), "utf8"));
const result = await configure(input);
writeFileSync(
	output,
	`${JSON.stringify({ ...result, flags: computeFlags(result.cfg) }, null, 2)}\n`,
);
const cfg = result.cfg;
for (const [key, expected] of Object.entries({
	os: "linux",
	arch: "x64",
	abi: "gnu",
	buildType: "Release",
	mode: "link-only",
	webkit: "prebuilt",
	lto: true,
	crossLangLto: true,
	ci: true,
	buildkite: false,
	archiveDeps: false,
	asan: false,
	canary: false,
	revision: "744846f844374847c902b5e7fd59b4342a51ef99",
})) {
	assert.equal(cfg[key], expected, key);
}
assert.match(cfg.sysroot, /sysroot$/);
assert.equal(cfg.webkitVersion, "2e2aa2290fac856d6f451ceacb58f7f5b44dd057");
