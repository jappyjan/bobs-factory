import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { OwnedResourceClaim } from "../src/OwnedResourceClaim.js";

// The reclaim guard is a symlink: creating one needs a free inode. Flip this
// while the work runs to make the release guard fail like a full volume.
const volume = vi.hoisted(() => ({ full: false }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		default: actual,
		symlinkSync: ((...args: Parameters<typeof actual.symlinkSync>) => {
			if (volume.full)
				throw Object.assign(new Error("ENOSPC: no space left on device"), {
					code: "ENOSPC",
				});
			return actual.symlinkSync(...args);
		}) as typeof actual.symlinkSync,
	};
});

const directories: string[] = [];
afterEach(() => {
	volume.full = false;
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

it("releases its claim on a full disk without failing the finished work or stranding the lock", async () => {
	const directory = mkdtempSync(join(tmpdir(), "claim-release-"));
	directories.push(directory);
	const file = join(directory, "operation.lock");
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const claim = new OwnedResourceClaim(file);
		await expect(
			claim.run(async () => {
				volume.full = true;
				return "done";
			}),
		).resolves.toBe("done");
		// The claim is gone, so the next operation (or supervisor loop) proceeds.
		expect(existsSync(file)).toBe(false);
		volume.full = false;
		await expect(claim.run(async () => "again")).resolves.toBe("again");
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("without its guard"),
		);
	} finally {
		error.mockRestore();
	}
});
