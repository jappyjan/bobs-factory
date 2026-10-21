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

it("omits only a reconciled obsolete copy and restores copying when authoritative state drifts", async () => {
	const { StorageRetentionStore, writeStorageIntegrity, reconcileStorageCopy } =
		await import("bobs-factory-core");
	const root = mkdtempSync(join(tmpdir(), "factory-obsolete-copy-"));
	try {
		const home = join(root, "home"),
			stale = join(home, "factory", "obsolete"),
			target = join(root, "snapshots");
		mkdirSync(join(home, "state"), { recursive: true });
		mkdirSync(join(stale, "state"), { recursive: true });
		writeFileSync(join(home, "state", "run.json"), '{"accepted":true}');
		writeFileSync(join(stale, "state", "run.json"), '{"accepted":true}');
		const store = new StorageRetentionStore(home);
		const record = await store.register({
			category: "recovery",
			path: stale,
			root: join(home, "factory"),
			producer: "retained legacy producer",
			operation: "legacy",
			dependencies: ["needs reconciliation"],
			evidence: [],
		});
		const integrity = await writeStorageIntegrity(
			stale,
			join(store.directory, "proofs", `${record.id}.ndjson`),
		);
		await store.revise(record.id, (value) => {
			value.evidence = [`integrity:${integrity}`];
			value.completedAt = new Date().toISOString();
		});
		const reconciled = await reconcileStorageCopy(store, record.id);
		expect(reconciled.authoritativeReplacement?.path).toBe(store.home);
		for (let cycle = 0; cycle < 3; cycle++) {
			await copyUpdateState(home, join(target, String(cycle)), "snapshot");
			expect(
				existsSync(join(target, String(cycle), "factory", "obsolete")),
			).toBe(false);
			expect(
				readFileSync(join(target, String(cycle), "state", "run.json"), "utf8"),
			).toBe('{"accepted":true}');
		}
		writeFileSync(join(home, "state", "run.json"), '{"accepted":"changed"}');
		await copyUpdateState(home, join(target, "drift"), "snapshot");
		expect(
			readFileSync(
				join(target, "drift", "factory", "obsolete", "state", "run.json"),
				"utf8",
			),
		).toBe('{"accepted":true}');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
