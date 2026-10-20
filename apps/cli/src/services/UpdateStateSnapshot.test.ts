import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { copyUpdateStateForRetention as copyUpdateState } from "./UpdateStateSnapshot.js";

it("does not silently discard a dangling saved-state root", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-dangling-state-"));
	try {
		const home = join(root, "home");
		mkdirSync(home);
		symlinkSync(join(root, "gone"), join(home, "state"));
		for (const purpose of ["preflight", "snapshot"] as const)
			await expect(
				copyUpdateState(home, join(root, purpose), purpose),
			).rejects.toThrow("Snapshot refuses external/special owned state");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("preflight omits retained evidence links; snapshots and rollback keep their exact targets", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-linked-evidence-"));
	try {
		const home = join(root, "home"),
			evidence = join(home, "factory/evidence/task");
		mkdirSync(evidence, { recursive: true });
		mkdirSync(join(home, "factory/auth"));
		writeFileSync(
			join(home, "factory/auth/credential"),
			"native credential boundary",
		);
		writeFileSync(join(evidence, "result.txt"), "retained result");
		const external = join(root, "external");
		mkdirSync(external);
		writeFileSync(join(external, "sentinel"), "external bytes");
		const links = {
			relative: "result.txt",
			absolute: external,
			expired: join(root, "gone"),
		};
		for (const [name, target] of Object.entries(links))
			symlinkSync(target, join(evidence, name));
		const preflight = join(root, "preflight"),
			snapshot = join(root, "snapshot");
		await copyUpdateState(home, preflight, "preflight");
		await copyUpdateState(home, snapshot, "snapshot");
		for (const [name, target] of Object.entries(links)) {
			expect(() =>
				lstatSync(join(preflight, "factory/evidence/task", name)),
			).toThrow();
			expect(
				lstatSync(
					join(snapshot, "factory/evidence/task", name),
				).isSymbolicLink(),
			).toBe(true);
			expect(readlinkSync(join(snapshot, "factory/evidence/task", name))).toBe(
				target,
			);
		}
		for (const copy of [preflight, snapshot]) {
			expect(existsSync(join(copy, "factory/auth"))).toBe(false);
			expect(
				readFileSync(join(copy, "factory/evidence/task/result.txt"), "utf8"),
			).toBe("retained result");
		}
		const restored = join(root, "restored");
		cpSync(snapshot, restored, { recursive: true, verbatimSymlinks: true });
		for (const [name, target] of Object.entries(links))
			expect(readlinkSync(join(restored, "factory/evidence/task", name))).toBe(
				target,
			);
		expect(readFileSync(join(external, "sentinel"), "utf8")).toBe(
			"external bytes",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it.each([
	"config.json",
	"state",
	"factory/evidence",
	"factory/runs/run.json",
])("refuses linked configuration/state at %s for both snapshot purposes", async (relative) => {
	const root = mkdtempSync(join(tmpdir(), "factory-linked-state-"));
	try {
		const home = join(root, "home"),
			source = join(home, relative),
			external = join(root, "external");
		mkdirSync(join(source, ".."), { recursive: true });
		writeFileSync(external, "external state");
		symlinkSync(external, source);
		for (const purpose of ["preflight", "snapshot"] as const)
			await expect(
				copyUpdateState(home, join(root, purpose), purpose),
			).rejects.toThrow("Snapshot refuses external/special owned state");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
