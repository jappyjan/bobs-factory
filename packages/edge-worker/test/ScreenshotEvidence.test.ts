import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifiedScreenshot } from "../src/factory/FactoryTools.js";

const roots: string[] = [];
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
	"base64",
);
const hash = createHash("sha256").update(png).digest("hex");
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "relocated-screenshot-"));
	roots.push(root);
	const directory = join(root, "current", "factory", "evidence", "run");
	const previous = join(
		root,
		"retired",
		"factory",
		"evidence",
		"run",
		"qa",
		"screen.png",
	);
	const current = join(directory, "qa", "screen.png");
	mkdirSync(join(directory, "qa"), { recursive: true });
	writeFileSync(current, png);
	return { root, directory, previous, current };
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it("resolves an immutable retained capture in the current home even after the old home is removed", () => {
	const f = fixture();
	expect(verifiedScreenshot(f.previous, f.directory, hash)).toBe(
		realpathSync(f.current),
	);
});

it("keeps native current-home aliases readable without treating them as relocated receipts", () => {
	const f = fixture();
	const alias = join(f.root, "alias");
	symlinkSync(join(f.root, "current"), alias);
	expect(
		verifiedScreenshot(
			join(alias, "factory", "evidence", "run", "qa", "screen.png"),
			f.directory,
		),
	).toBe(realpathSync(f.current));
	rmSync(f.current);
	expect(() => verifiedScreenshot(f.previous, f.directory, hash)).toThrow();
});

it("requires a recorded digest and the same run-relative evidence path for relocation", () => {
	const f = fixture();
	for (const path of [
		f.previous.replace("/run/", "/other/"),
		join(f.root, "outside.png"),
		f.previous.replace("/qa/", "/../../run/qa/"),
	]) {
		expect(() => verifiedScreenshot(path, f.directory, hash)).toThrow();
	}
	expect(() => verifiedScreenshot(f.previous, f.directory)).toThrow();
	expect(() =>
		verifiedScreenshot(f.previous, f.directory, "invalid"),
	).toThrow();
	writeFileSync(f.current, Buffer.concat([png, Buffer.from("changed")]));
	expect(() => verifiedScreenshot(f.previous, f.directory, hash)).toThrow(
		"changed",
	);
});

it("does not follow relocated symlinks outside the current evidence directory or read the old file", () => {
	const f = fixture();
	mkdirSync(join(f.root, "retired", "factory", "evidence", "run", "qa"), {
		recursive: true,
	});
	writeFileSync(f.previous, "Retired bytes must never be read");
	expect(verifiedScreenshot(f.previous, f.directory, hash)).toBe(
		realpathSync(f.current),
	);
	const outside = join(f.root, "outside.png");
	writeFileSync(outside, png);
	rmSync(f.current);
	symlinkSync(outside, f.current);
	expect(() => verifiedScreenshot(f.previous, f.directory, hash)).toThrow(
		"inside",
	);
});
