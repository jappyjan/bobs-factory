import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmSync,
	statfsSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	verifyStorageIntegrity,
	writeStorageIntegrity,
} from "bobs-factory-core";
import { describe, expect, it, vi } from "vitest";
import {
	copyUpdateStateForRetention,
	copyUpdateState as copyUpdateStateSync,
} from "./UpdateStateSnapshot.js";

vi.mock("node:fs", async (original) => {
	const fs = await original<typeof import("node:fs")>();
	return { ...fs, statfsSync: vi.fn(fs.statfsSync) };
});
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, statfs: vi.fn(fs.statfs) };
});

const copyUpdateState = copyUpdateStateForRetention;

describe.each([
	[
		"sync",
		async (...args: Parameters<typeof copyUpdateStateSync>) =>
			copyUpdateStateSync(...args),
	],
	["retention", copyUpdateStateForRetention],
] as const)("%s copy", (_name, copyUpdateState) => {
	it.each([
		"preflight",
		"snapshot",
	] as const)("refuses insufficient space before copying %s bytes", async (purpose) => {
		const root = mkdtempSync(join(tmpdir(), "factory-copy-space-"));
		try {
			const home = join(root, "home"),
				destination = join(root, "copy");
			mkdirSync(home);
			writeFileSync(join(home, "config.json"), "saved state");
			const volume = statfsSync(root);
			// Enough for the copied file alone, but no room for the safety margin.
			vi.mocked(statfsSync).mockReturnValueOnce({ ...volume, bavail: 1 });
			vi.mocked(statfs).mockResolvedValueOnce({ ...volume, bavail: 1 });
			await expect(copyUpdateState(home, destination, purpose)).rejects.toThrow(
				/Insufficient disk space.*owned state plus margin/,
			);
			expect(existsSync(join(destination, "config.json"))).toBe(false);
			expect(readFileSync(join(home, "config.json"), "utf8")).toBe(
				"saved state",
			);
		} finally {
			vi.mocked(statfsSync).mockReset();
			vi.mocked(statfs).mockReset();
			rmSync(root, { recursive: true, force: true });
		}
	});

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
				expect(
					readlinkSync(join(snapshot, "factory/evidence/task", name)),
				).toBe(target);
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
				expect(
					readlinkSync(join(restored, "factory/evidence/task", name)),
				).toBe(target);
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
		"factory/execution-private/run/jobs/job/codex/home",
		"factory/execution-private/run/jobs/job/codex/cache/link",
		"factory/execution-private/run/jobs/job/home/link",
		"factory/execution-private/run/home/link",
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

	it("preflight omits agent home links; snapshots verify and restore their exact targets", async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-job-links-"));
		try {
			const home = join(root, "home"),
				relative = "factory/execution-private/run/jobs/job/codex/home",
				jobHome = join(home, relative),
				external = join(root, "external");
			mkdirSync(join(jobHome, ".nvm/versions/node/v24.22.1/bin"), {
				recursive: true,
			});
			mkdirSync(join(jobHome, ".pnpm-store/projects"), { recursive: true });
			mkdirSync(external);
			writeFileSync(join(external, "sentinel"), "external bytes");
			writeFileSync(join(jobHome, "saved.txt"), "saved agent state");
			const links = {
				".nvm/versions/node/v24.22.1/bin/corepack":
					"../lib/node_modules/corepack/dist/corepack.js",
				".pnpm-store/projects/hash":
					"../../../../../../../../../../worktrees/ATT-1145",
				absolute: external,
				expired: join(root, "gone"),
			};
			for (const [name, target] of Object.entries(links))
				symlinkSync(target, join(jobHome, name));
			const preflight = join(root, "preflight"),
				snapshot = join(root, "snapshot");
			await copyUpdateState(home, preflight, "preflight");
			await copyUpdateState(home, snapshot, "snapshot");
			const proof = join(root, "proof.ndjson");
			const integrity = await writeStorageIntegrity(snapshot, proof);
			await verifyStorageIntegrity(snapshot, proof, integrity);
			const restored = join(root, "restored");
			cpSync(snapshot, restored, { recursive: true, verbatimSymlinks: true });
			for (const [name, target] of Object.entries(links)) {
				expect(() => lstatSync(join(preflight, relative, name))).toThrow();
				for (const copy of [snapshot, restored])
					expect(readlinkSync(join(copy, relative, name))).toBe(target);
			}
			for (const copy of [preflight, snapshot, restored])
				expect(readFileSync(join(copy, relative, "saved.txt"), "utf8")).toBe(
					"saved agent state",
				);
			expect(readFileSync(join(external, "sentinel"), "utf8")).toBe(
				"external bytes",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("skips runtime sockets and FIFOs only inside agent homes for both purposes", async () => {
		// Bind before moving into the nested home to respect Unix socket path limits.
		const root = mkdtempSync(join(tmpdir(), "fjh-")),
			server = createServer();
		try {
			const home = join(root, "h"),
				relative = "factory/execution-private/r/jobs/j/claude/home",
				jobHome = join(home, relative);
			mkdirSync(jobHome, { recursive: true });
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(join(root, "socket"), resolve);
			});
			renameSync(join(root, "socket"), join(jobHome, "socket"));
			execFileSync("mkfifo", [join(jobHome, "fifo")]);
			writeFileSync(join(jobHome, "saved.txt"), "saved agent state");
			for (const purpose of ["preflight", "snapshot"] as const) {
				const destination = join(root, purpose);
				await copyUpdateState(home, destination, purpose);
				for (const name of ["socket", "fifo"])
					expect(() => lstatSync(join(destination, relative, name))).toThrow();
				expect(
					readFileSync(join(destination, relative, "saved.txt"), "utf8"),
				).toBe("saved agent state");
			}
			for (const name of ["socket", "fifo"]) {
				renameSync(join(jobHome, name), join(home, "factory", name));
				for (const purpose of ["preflight", "snapshot"] as const)
					await expect(
						copyUpdateState(home, join(root, `${purpose}-${name}`), purpose),
					).rejects.toThrow(
						`Snapshot refuses external/special owned state: factory/${name}`,
					);
				renameSync(join(home, "factory", name), join(jobHome, name));
			}
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(root, { recursive: true, force: true });
		}
	});
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
