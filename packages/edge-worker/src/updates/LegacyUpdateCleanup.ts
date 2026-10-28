import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import {
	LegacyStorageCategorySchema,
	OwnedResourceClaim,
	publishStorageJson,
	StorageRecordSchema,
	StorageRetentionStore,
	storageDigest,
} from "bobs-factory-core";
import {
	containsTarget,
	protectedRuntimeTargets,
} from "../storage/RuntimePruner.js";
import { UpdateManager } from "./UpdateManager.js";

export interface LegacyCleanupResult {
	/** `deferred`: an update transaction is unresolved, so nothing copy-era was touched. */
	status: "done" | "deferred";
	removed: string[];
	retained: { path: string; reason: string }[];
	droppedRecords: number;
}

const COPY_DIRECTORIES = ["preparation", "snapshots", "recovery-retained"];
const LEGACY_FILES = [
	"rollback-index.json",
	"historical-preview.json",
	"update-completed.json",
	"preview.json",
	"continuation.json",
];
const LEGACY_DIRECTORIES = ["rollback-proofs", "verification-progress"];
const remove = (path: string) => rmSync(path, { recursive: true, force: true });
const json = (file: string): unknown => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
};

/** Staged space is given back immediately: a rename is atomic and a crash during
 * the slow delete leaves a `.trash-*` directory that every later start sweeps. */
function sweepTrash(updates: string) {
	let entries: string[] = [];
	try {
		entries = readdirSync(updates);
	} catch {}
	for (const entry of entries)
		if (entry.startsWith(".trash-")) remove(join(updates, entry));
}

/** Drops records of the copy-based updater from the retention inventory. The
 * artifacts were removed above (or by hand); records and their proofs are only
 * metadata. Safe to repeat and safe after a crash between any two steps. */
async function dropLegacyRecords(home: string) {
	const store = new StorageRetentionStore(home);
	const directory = store.directory;
	if (!existsSync(directory)) return 0;
	await store.recoverPublication();
	return new OwnedResourceClaim(join(directory, "inventory.lock")).run(
		async () => {
			const pages = existsSync(join(directory, "inventory"))
				? readdirSync(join(directory, "inventory"))
						.filter((name) => /^\d+\.json$/.test(name))
						.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
				: [];
			const listed: string[] = [];
			for (const page of pages) {
				const ids = json(join(directory, "inventory", page));
				if (Array.isArray(ids))
					for (const id of ids) if (typeof id === "string") listed.push(id);
			}
			const listedSet = new Set(listed);
			const known = new Set(listed);
			if (existsSync(join(directory, "records")))
				for (const name of readdirSync(join(directory, "records")))
					if (name.endsWith(".json")) known.add(name.slice(0, -5));
			const kept = new Set<string>();
			const dropped: { id: string; path?: string }[] = [];
			for (const id of known) {
				const parsed = StorageRecordSchema.safeParse(
					json(join(directory, "records", `${id}.json`)),
				);
				if (parsed.success) {
					if (
						LegacyStorageCategorySchema.safeParse(parsed.data.category).success
					)
						dropped.push({ id, path: parsed.data.path });
					else if (listedSet.has(id)) kept.add(id);
				} else if (!existsSync(join(directory, "records", `${id}.json`)))
					// Listed but gone, e.g. a crash after record removal: nothing to keep.
					dropped.push({ id });
				else if (listedSet.has(id)) kept.add(id);
			}
			const order = [...new Set(listed)].filter((id) => kept.has(id));
			for (const { id, path } of dropped) {
				remove(join(directory, "proofs", `${id}.ndjson`));
				remove(join(directory, "receipts", `${id}.json`));
				remove(join(directory, "receipt-history", id));
				remove(join(directory, "dependencies", id));
				if (path)
					remove(
						join(directory, "path-records", `${storageDigest(path)}.json`),
					);
			}
			if (dropped.length || listed.length !== order.length) {
				for (let index = 0; index * 100 < order.length; index++)
					await publishStorageJson(
						join(directory, "inventory", `${index}.json`),
						order.slice(index * 100, index * 100 + 100),
					);
				for (const page of pages)
					if (Number.parseInt(page, 10) * 100 >= order.length)
						remove(join(directory, "inventory", page));
				await publishStorageJson(
					join(directory, "inventory-count.json"),
					order.length,
				);
				const revision = json(join(directory, "inventory-revision.json")) as
					| { revision?: number }
					| undefined;
				await publishStorageJson(join(directory, "inventory-revision.json"), {
					revision: (revision?.revision ?? 0) + 1,
					writing: false,
				});
			}
			for (const { id } of dropped)
				remove(join(directory, "records", `${id}.json`));
			for (const file of LEGACY_FILES) remove(join(directory, file));
			for (const name of LEGACY_DIRECTORIES) remove(join(directory, name));
			return dropped.length;
		},
		true,
	);
}

/** One-time removal of what the copy-based updater left behind: full-home
 * preparation and snapshot copies, recovery copies, their retention records and
 * integrity proofs. Never touches an unresolved update's paths or any directory
 * holding a runtime that is linked, staged or running. Idempotent. */
export async function cleanupLegacyUpdates(
	home: string,
): Promise<LegacyCleanupResult> {
	const updates = join(home, "updates");
	const result: LegacyCleanupResult = {
		status: "done",
		removed: [],
		retained: [],
		droppedRecords: 0,
	};
	sweepTrash(updates);
	const manager = new UpdateManager(home);
	const { transaction } = manager.status();
	const settled =
		!transaction ||
		(["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
			transaction.release?.status === "acknowledged");
	if (!settled) {
		result.status = "deferred";
		for (const name of COPY_DIRECTORIES)
			if (existsSync(join(updates, name)))
				result.retained.push({
					path: join(updates, name),
					reason: `Update ${transaction!.id} is unresolved (${transaction!.phase})`,
				});
		return result;
	}
	const targets = protectedRuntimeTargets(home, updates);
	const stamp = Date.now();
	let counter = 0;
	for (const name of COPY_DIRECTORIES) {
		const root = join(updates, name);
		let entries: string[] = [];
		try {
			entries = readdirSync(root);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(root, entry);
			if (containsTarget(path, targets)) {
				result.retained.push({
					path,
					reason: "Holds a linked, staged or running runtime",
				});
				continue;
			}
			const trash = join(updates, `.trash-${stamp}-${counter++}`);
			renameSync(path, trash);
			remove(trash);
			result.removed.push(path);
		}
		try {
			rmdirSync(root);
		} catch {}
	}
	// Records and proofs never outlive what they describe, whether it was
	// removed above, earlier, or by hand.
	result.droppedRecords = await dropLegacyRecords(home);
	if (
		(json(join(updates, "state.json")) as Record<string, unknown> | undefined)
			?.rollbackSnapshot
	)
		manager.compact();
	return result;
}
