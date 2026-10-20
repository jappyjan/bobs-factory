import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ProjectArtifactLease } from "../src/ProjectArtifactLease.js";
import {
	reserveStorageWorkspace,
	StorageRetentionStore,
	storageDigest,
} from "../src/StorageRetention.js";

it("serializes member reservations and artifact acquisition with the whole workspace group", async () => {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "storage-claim-race-")),
	);
	const root = join(home, "custom-root"),
		group = join(root, "group"),
		member = join(group, "member");
	await mkdir(member, { recursive: true });
	const store = new StorageRetentionStore(home);
	await store.register({
		path: group,
		root,
		producer: "fixture",
		operation: "group",
		category: "worktree",
		dependencies: [],
		evidence: [],
	});
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>((resolve) => {
			enter = resolve;
		}),
		barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
	const deletion = store.workspaceClaim(group).run(async () => {
		enter();
		await barrier;
	}, true);
	try {
		await entered;
		await expect(
			reserveStorageWorkspace(home, member, "resume", "Resume fixture"),
		).rejects.toThrow("still running");
		await expect(
			ProjectArtifactLease.acquire(
				member,
				"fixture",
				join(home, "leases"),
				undefined,
				home,
			),
		).rejects.toThrow("still running");
		release();
		await deletion;
		await reserveStorageWorkspace(home, member, "resume", "Resume fixture");
		const lease = await ProjectArtifactLease.acquire(
			member,
			"fixture",
			join(home, "leases"),
			undefined,
			home,
		);
		lease.write("generated.json", "temporary configuration");
		lease.release();
		const uses = join(store.directory, "workspace-use", storageDigest(group));
		const values = await Promise.all(
			(await readdir(uses)).map(async (name) =>
				JSON.parse(await readFile(join(uses, name), "utf8")),
			),
		);
		expect(
			values.some(
				(value) => value.owner === "resume" && value.state === "reserved",
			),
		).toBe(true);
		expect(
			values.some(
				(value) =>
					value.owner.startsWith("artifact:") && value.state === "released",
			),
		).toBe(true);
	} finally {
		release();
		await deletion;
		await rm(home, { recursive: true, force: true });
	}
});
