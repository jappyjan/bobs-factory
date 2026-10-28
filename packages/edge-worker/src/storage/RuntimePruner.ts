import { readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, sep } from "node:path";

const EXECUTABLE_KEYS = new Set([
	"executable",
	"previousExecutable",
	"runtimeLink",
]);

/** Everything that may still point into a staged runtime: the live link and any
 * pre-created `.next-*` / `.prev-*` link beside it, the transaction state that
 * names the current and previous executables, the runtime ownership records and
 * this process itself. A path is only protected if it is mentioned here. */
export function protectedRuntimeTargets(home: string, directory: string) {
	const targets = new Set<string>();
	const add = (path: string) => {
		try {
			targets.add(realpathSync(path));
		} catch {
			targets.add(path);
		}
	};
	add(process.execPath);
	for (const bin of [
		join(home, "runtime", "desktop-installed", "bin"),
		join(home, "runtime", "installed", "bin"),
	]) {
		let entries: string[] = [];
		try {
			entries = readdirSync(bin);
		} catch {}
		for (const entry of entries)
			if (/^bobs-factory(\.(next|prev)-.+)?$/.test(entry))
				add(join(bin, entry));
	}
	// Only executable-valued fields count: a transaction's `snapshot` record path
	// is not a runtime and must not keep copy-era directories alive.
	const walk = (value: unknown, key = "") => {
		if (typeof value === "string") {
			if (EXECUTABLE_KEYS.has(key) && value.startsWith("/")) add(value);
		} else if (Array.isArray(value)) for (const item of value) walk(item, key);
		else if (value && typeof value === "object")
			for (const [name, item] of Object.entries(value)) walk(item, name);
	};
	for (const file of [
		join(directory, "state.json"),
		join(home, "runtime", "update-owner.json"),
		join(home, "runtime", "desktop-runtime.json"),
		join(home, "runtime", "desktop-update.json"),
		join(home, "runtime", "service.json"),
	]) {
		try {
			walk(JSON.parse(readFileSync(file, "utf8")));
		} catch {}
	}
	return targets;
}

export const containsTarget = (directory: string, targets: Set<string>) => {
	for (const target of targets)
		if (target === directory || target.startsWith(`${directory}${sep}`))
			return true;
	return false;
};

/** Removes staged runtimes nothing refers to. The live runtime is itself a staged
 * directory on installed machines, so removal is by reference, never by age: the
 * target of the live link and of any `.next-*` / `.prev-*` link, and the
 * executables of the current and previous update transaction, are always kept.
 * Must run while holding the update operation lock so no stage is half written. */
export function pruneStagedRuntimes(home: string, directory: string) {
	const root = join(directory, "staging");
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return [];
	}
	const targets = protectedRuntimeTargets(home, directory);
	const removed: string[] = [];
	for (const entry of entries) {
		if (!entry.startsWith("stage-")) continue;
		const path = join(root, entry);
		if (containsTarget(path, targets)) continue;
		rmSync(path, { recursive: true, force: true });
		removed.push(path);
	}
	return removed;
}
