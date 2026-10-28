import {
	existsSync,
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
import { pruneStagedRuntimes } from "../src/storage/RuntimePruner.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

it("removes only staged runtimes nothing refers to", () => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "runtime-pruner-")));
	homes.push(home);
	const updates = join(home, "updates");
	const stage = (name: string) => {
		const executable = join(
			updates,
			"staging",
			name,
			"runtime",
			"bobs-factory",
		);
		mkdirSync(join(executable, ".."), { recursive: true });
		writeFileSync(executable, name, { mode: 0o755 });
		return executable;
	};
	const live = stage("stage-live"),
		next = stage("stage-next"),
		prev = stage("stage-prev"),
		previousTransaction = stage("stage-previous"),
		pending = stage("stage-pending");
	stage("stage-orphan");
	const link = join(
		home,
		"runtime",
		"desktop-installed",
		"bin",
		"bobs-factory",
	);
	mkdirSync(join(link, ".."), { recursive: true });
	symlinkSync(live, link);
	symlinkSync(next, `${link}.next-txn`);
	symlinkSync(prev, `${link}.prev-txn`);
	writeFileSync(
		join(updates, "state.json"),
		JSON.stringify({
			pending: { staged: { executable: pending } },
			transaction: {
				snapshot: join(updates, "staging", "stage-orphan"),
				staged: { executable: next, previousExecutable: previousTransaction },
			},
		}),
	);

	const removed = pruneStagedRuntimes(home, updates);

	// A transaction's record path is not a runtime reference.
	expect(removed).toEqual([join(updates, "staging", "stage-orphan")]);
	for (const kept of [live, next, prev, previousTransaction, pending])
		expect(existsSync(kept)).toBe(true);
	expect(realpathSync(link)).toBe(live);
});
