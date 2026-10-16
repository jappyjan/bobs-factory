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
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
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
