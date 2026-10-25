import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryClient } from "../tui/client.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";

it.each([
	[undefined, "factory-preservation-v2"],
	["factory-preservation-v2", undefined],
	["factory-preservation-v2", "factory-preservation-v2"],
	["factory-preservation-v2", "future-contract"],
])("checks preservation contracts %s → %s before replacing the worker", async (currentContract, candidateContract) => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "update-contract-")));
	const installed = {
		product: "bobs-factory",
		version: "1.0.0",
		target: "linux-x64",
		commit: "a".repeat(40),
	};
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
		JSON.stringify({
			schema: 1,
			home,
			executable: link,
			initial: installed,
		}),
	);
	const candidate = { ...installed, version: "1.1.0", commit: "b".repeat(40) };
	const executable = join(home, "candidate", "bobs-factory");
	const source = `#!/usr/bin/env node\nconsole.log(${JSON.stringify(
		JSON.stringify({
			stateCompatible: true,
			preservationContract: candidateContract,
			runIds: ["retained-run"],
		}),
	)});\n`;
	mkdirSync(dirname(executable));
	writeFileSync(executable, source, { mode: 0o700 });
	writeFileSync(
		join(dirname(executable), "build.json"),
		JSON.stringify({
			...candidate,
			dirty: false,
			executable: {
				sha256: createHash("sha256").update(source).digest("hex"),
				size: Buffer.byteLength(source),
			},
		}),
	);
	const get = vi.spyOn(FactoryClient.prototype, "get").mockResolvedValue({
		idle: true,
		preservationContract: currentContract,
		preservedStateSha256: "c".repeat(64),
		runIds: ["retained-run"],
	});
	try {
		const lifecycle = new OwnedUpdateLifecycle(home, 3457);
		expect(await lifecycle.isIdle()).toBe(true);
		const preflight = lifecycle.preflight(
			{ candidate, executable, previousExecutable: previous },
			installed,
		);
		if (candidateContract === currentContract)
			await expect(preflight).resolves.toEqual({ stateCompatible: true });
		else
			await expect(preflight).rejects.toThrow(
				"owner-managed stopped-worker upgrade",
			);
		expect(realpathSync(link)).toBe(previous);
	} finally {
		get.mockRestore();
		rmSync(home, { recursive: true, force: true });
	}
});

afterEach(() => {
	vi.restoreAllMocks();
});

function desktopHome() {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-rollback-")));
	const prefix = join(home, "runtime", "desktop-installed"),
		name = "bobs-factory-1.0.0-linux-x64",
		target = join(prefix, "lib", "bobs-factory", name, "bobs-factory"),
		link = join(prefix, "bin", "bobs-factory");
	mkdirSync(join(prefix, "bin"), { recursive: true });
	mkdirSync(join(prefix, "lib", "bobs-factory", name), { recursive: true });
	writeFileSync(target, "owned");
	const identity = {
		product: "bobs-factory",
		version: "1.0.0",
		target: "linux-x64",
		commit: "a".repeat(40),
	};
	writeFileSync(
		join(prefix, "lib", "bobs-factory", name, "build.json"),
		JSON.stringify(identity),
	);
	symlinkSync(target, link);
	writeFileSync(
		join(home, "runtime", "desktop-runtime.json"),
		JSON.stringify({ schema: 1, home, executable: link, initial: identity }),
	);
	// Failure-era state and the snapshot taken before the switch.
	const snapshot = join(home, "updates", "snapshots", "failed-update");
	for (const root of [home, snapshot]) {
		const era = root === home ? "failure" : "snapshot";
		mkdirSync(join(root, "state"), { recursive: true });
		mkdirSync(join(root, "factory"), { recursive: true });
		writeFileSync(join(root, "config.json"), era);
		writeFileSync(join(root, "state", "edge.json"), era);
		writeFileSync(join(root, "factory", "runs.json"), era);
	}
	mkdirSync(join(home, "factory", "auth"));
	writeFileSync(join(home, "factory", "auth", "token"), "current-auth");
	const transaction = {
		id: "failed-update",
		snapshot,
		staged: {
			candidate: identity,
			executable: target,
			previousExecutable: target,
		},
	};
	return { home, transaction };
}

const read = (...path: string[]) => readFileSync(join(...path), "utf8");

it("resumes a rollback whose restart failed without restoring state again", async () => {
	const { home, transaction } = desktopHome();
	const retained = join(home, "updates", "recovery-retained", "failed-update");
	const adapter = new OwnedUpdateLifecycle(home, 3457);
	writeFileSync(join(home, "runtime", "desktop-stopped.json"), "{}");
	await expect(adapter.rollback(transaction)).rejects.toThrow(
		"Deliberate Stop",
	);
	expect(read(home, "state", "edge.json")).toBe("snapshot");
	expect(read(home, "factory", "auth", "token")).toBe("current-auth");
	expect(read(retained, "state", "edge.json")).toBe("failure");

	// The previous runtime may have written state before the retry.
	writeFileSync(join(home, "state", "edge.json"), "after-restart");
	rmSync(join(home, "runtime", "desktop-stopped.json"));
	const start = vi
		.spyOn(OwnedUpdateLifecycle.prototype, "start")
		.mockResolvedValue();
	const health = vi
		.spyOn(OwnedUpdateLifecycle.prototype, "health")
		.mockResolvedValue();
	await adapter.rollback(transaction);
	expect(start).toHaveBeenCalledOnce();
	expect(health).toHaveBeenCalledOnce();
	expect(read(home, "state", "edge.json")).toBe("after-restart");
	expect(read(retained, "state", "edge.json")).toBe("failure");
	expect(read(home, "factory", "auth", "token")).toBe("current-auth");
});

it("redoes a restore interrupted after auth moved into the partial copy", async () => {
	const { home, transaction } = desktopHome();
	const retained = join(home, "updates", "recovery-retained", "failed-update");
	const adapter = new OwnedUpdateLifecycle(home, 3457);
	writeFileSync(join(home, "runtime", "desktop-stopped.json"), "{}");
	await expect(adapter.rollback(transaction)).rejects.toThrow(
		"Deliberate Stop",
	);
	// Rewind the journal to the moment factory was copied and auth moved,
	// but the entry was not yet recorded as restored.
	writeFileSync(
		join(retained, "rollback-progress.json"),
		JSON.stringify({ restored: ["config.json", "state"] }),
	);
	rmSync(join(home, "factory", "runs.json"));
	rmSync(join(home, "runtime", "desktop-stopped.json"));
	vi.spyOn(OwnedUpdateLifecycle.prototype, "start").mockResolvedValue();
	vi.spyOn(OwnedUpdateLifecycle.prototype, "health").mockResolvedValue();
	await adapter.rollback(transaction);
	expect(read(home, "factory", "runs.json")).toBe("snapshot");
	expect(read(home, "factory", "auth", "token")).toBe("current-auth");
	expect(read(retained, "factory", "runs.json")).toBe("failure");
	expect(existsSync(join(retained, "factory", "auth"))).toBe(false);
});

it("refuses retained state without a rollback journal", async () => {
	const { home, transaction } = desktopHome();
	const retained = join(home, "updates", "recovery-retained", "failed-update");
	mkdirSync(join(retained, "state"), { recursive: true });
	const adapter = new OwnedUpdateLifecycle(home, 3457);
	await expect(adapter.rollback(transaction)).rejects.toThrow(
		"Interrupted rollback requires reconciliation",
	);
	expect(read(home, "state", "edge.json")).toBe("failure");
});
