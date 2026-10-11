// Only directories allocated by this provider are eligible for fixture removal.
import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export const fixtureRootVariable = "BOBS_FACTORY_ACCEPTANCE_FIXTURE_ROOT";

const identity = (stat) =>
	Object.fromEntries(
		["dev", "ino", "uid", "birthtimeNs"].map((key) => [key, String(stat[key])]),
	);

export function createFixtureDirectory() {
	const parent = realpathSync(tmpdir());
	const root = mkdtempSync(join(parent, "factory-isolated-service-"));
	return { root, parent, ...identity(lstatSync(root, { bigint: true })) };
}

export function removeFixtureDirectory(binding, receiptPath) {
	const { root, parent } = binding;
	assert.equal(
		parent,
		realpathSync(tmpdir()),
		"Fixture directory parent changed",
	);
	assert.equal(
		dirname(root),
		parent,
		"Fixture directory is outside temporary parent",
	);
	assert.match(basename(root), /^factory-isolated-service-[A-Za-z0-9]+$/);
	// A retained receipt (or its parent symlink) must never be inside the tree.
	let receipt = join(
		realpathSync(dirname(resolve(receiptPath))),
		basename(receiptPath),
	);
	try {
		receipt = realpathSync(receiptPath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const inside = relative(root, receipt);
	assert(
		inside.startsWith("../"),
		"Fixture directory contains retained evidence",
	);
	let stat;
	try {
		stat = lstatSync(root, { bigint: true });
	} catch (error) {
		if (error.code === "ENOENT") return; // Cooperative cleanup already removed it.
		throw error;
	}
	assert(
		stat.isDirectory() && !stat.isSymbolicLink(),
		"Fixture directory became a symlink or file",
	);
	assert.equal(realpathSync(root), root, "Fixture directory realpath changed");
	assert.deepEqual(
		identity(stat),
		identity(binding),
		"Fixture directory identity changed",
	);
	assert.equal(
		String(stat.uid),
		String(process.getuid()),
		"Fixture directory owner changed",
	);
	assert.equal(
		Number(stat.mode & 0o077n),
		0,
		"Fixture directory is no longer private",
	);
	// Node removes descendant symlinks themselves, without following their targets.
	rmSync(root, { recursive: true });
	assert.throws(() => lstatSync(root), { code: "ENOENT" });
}
