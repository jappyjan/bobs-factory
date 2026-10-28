import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

const installed = {
	product: "bobs-factory",
	version: "1.0.0",
	target: "linux-x64",
	commit: "a".repeat(40),
};

/** A desktop-owned runtime link, and a staged candidate whose `service format`
 * answer is the given script body. */
function fixture(options: { format: string; onDisk?: number }) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "update-prepare-")));
	homes.push(home);
	const prefix = join(home, "runtime", "desktop-installed");
	const previous = join(
		prefix,
		"lib",
		"bobs-factory",
		"bobs-factory-1.0.0-linux-x64",
		"bobs-factory",
	);
	const link = join(prefix, "bin", "bobs-factory");
	mkdirSync(dirname(previous), { recursive: true });
	mkdirSync(dirname(link), { recursive: true });
	writeFileSync(previous, "previous runtime");
	symlinkSync(previous, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({ schema: 1, home, executable: link, initial: installed }),
	);
	if (options.onDisk)
		writeFileSync(
			join(home, "state-format.json"),
			JSON.stringify({
				schema: 1,
				format: options.onDisk,
				minReader: 1,
				updatedAt: new Date().toISOString(),
				applied: [],
			}),
		);
	const candidate = { ...installed, version: "1.1.0", commit: "b".repeat(40) };
	const executable = join(home, "candidate", "bobs-factory");
	const source = `#!/usr/bin/env node\n${options.format}\n`;
	mkdirSync(dirname(executable));
	writeFileSync(executable, source, { mode: 0o700 });
	writeFileSync(
		join(dirname(executable), "build.json"),
		JSON.stringify({
			...candidate,
			product: "bobs-factory",
			dirty: false,
			executable: {
				sha256: createHash("sha256").update(source).digest("hex"),
				size: Buffer.byteLength(source),
			},
		}),
	);
	return {
		home,
		link,
		previous,
		executable,
		staged: { candidate, executable, previousExecutable: previous },
		lifecycle: new OwnedUpdateLifecycle(home, 3457),
	};
}
const answer = (report: object) =>
	`console.log(${JSON.stringify(JSON.stringify({ contract: 1, onDisk: 1, ...report }))});`;
const legacyBuild =
	"console.error(\"error: unknown command 'format'\"); process.exit(1);";

it("prepares a legacy candidate without copying anything and pre-creates both links", async () => {
	const f = fixture({ format: legacyBuild });
	const plan = await f.lifecycle.prepare(f.staged, installed, "txn-1");
	expect(plan.migration).toBeNull();
	expect(plan.links).toEqual({
		next: `${f.link}.next-txn-1`,
		prev: `${f.link}.prev-txn-1`,
	});
	// The running link is untouched until activation, and nothing else was written.
	expect(realpathSync(f.link)).toBe(f.previous);
	expect(realpathSync(plan.links!.next)).toBe(realpathSync(f.executable));
	expect(realpathSync(plan.links!.prev)).toBe(f.previous);
	expect(existsSync(join(f.home, "updates"))).toBe(false);

	// Switching is one rename of the pre-created link; so is going back.
	await f.lifecycle.activate(f.staged);
	expect(realpathSync(f.link)).toBe(realpathSync(f.executable));
	expect(existsSync(plan.links!.next)).toBe(false);
	f.lifecycle.discard("txn-1");
	expect(readdirSync(dirname(f.link))).toEqual(["bobs-factory"]);
});

it("plans a migration when the candidate writes a newer data format", async () => {
	const f = fixture({
		format: answer({
			writes: 2,
			migratesFrom: 1,
			plan: [{ estimateBytes: 4096 }],
		}),
	});
	const plan = await f.lifecycle.prepare(f.staged, installed, "txn-2");
	expect(plan.migration).toEqual({ from: 1, to: 2 });
});

it.each([
	[
		"older than the data on disk",
		{ writes: 1, migratesFrom: 1 },
		2,
		"Candidate understands data format 1; yours is 2",
	],
	[
		"unable to migrate from the data on disk",
		{ writes: 4, migratesFrom: 3 },
		2,
		"Candidate migrates data from format 3; yours is 2",
	],
])("rejects a candidate %s before anything is touched, without blaming it", async (_name, report, onDisk, message) => {
	const f = fixture({ format: answer(report), onDisk });
	await expect(
		f.lifecycle.prepare(f.staged, installed, "txn-3"),
	).rejects.toMatchObject({
		name: "UpdateRejectedError",
		message: expect.stringContaining(message),
	});
	expect(readdirSync(dirname(f.link))).toEqual(["bobs-factory"]);
});

it("refuses a migration the disk cannot hold, as an environmental failure", async () => {
	const f = fixture({
		format: answer({
			writes: 2,
			migratesFrom: 1,
			plan: [{ estimateBytes: 10 ** 18 }],
		}),
	});
	await expect(
		f.lifecycle.prepare(f.staged, installed, "txn-4"),
	).rejects.toMatchObject({
		name: "InsufficientSpaceError",
	});
	expect(lstatSync(f.link).isSymbolicLink()).toBe(true);
	expect(realpathSync(f.link)).toBe(f.previous);
});

it("sweeps links left behind by an abandoned transaction", async () => {
	const f = fixture({ format: legacyBuild });
	symlinkSync(f.previous, `${f.link}.prev-abandoned`);
	symlinkSync(f.previous, `${f.link}.next-abandoned`);
	await f.lifecycle.prepare(f.staged, installed, "txn-5");
	expect(readdirSync(dirname(f.link)).sort()).toEqual([
		"bobs-factory",
		"bobs-factory.next-txn-5",
		"bobs-factory.prev-txn-5",
	]);
});
