import { createHash } from "node:crypto";
import {
	closeSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

function ensureRegular(path) {
	const stat = lstatSync(path);
	if (stat.isDirectory()) {
		for (const name of awaitNames(path)) ensureRegular(join(path, name));
	} else if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Desktop runtime contains external/special files");
}
function verifiedBundle(runtime) {
	const identity = JSON.parse(
		readFileSync(join(runtime, "build.json"), "utf8"),
	);
	if (
		identity.product !== "bobs-factory" ||
		identity.target !== `${process.platform}-${process.arch}` ||
		!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(identity.version)
	)
		throw new Error("Packaged desktop runtime identity mismatch");
	const executable = join(runtime, "bobs-factory"),
		bytes = readFileSync(executable);
	if (
		!lstatSync(executable).isFile() ||
		lstatSync(executable).isSymbolicLink() ||
		identity.executable?.sha256 !==
			createHash("sha256").update(bytes).digest("hex") ||
		identity.executable.size !== bytes.length
	)
		throw new Error("Packaged desktop runtime integrity failure");
	return identity;
}
/** An update is in flight or unresolved: the updater owns the runtime link. */
function updateUnresolved(home) {
	if (existsSync(join(home, "runtime", "update-owner.json"))) return true;
	const file = join(home, "updates", "state.json");
	if (!existsSync(file)) return false;
	const transaction = JSON.parse(readFileSync(file, "utf8")).transaction;
	return (
		Boolean(transaction) &&
		!(
			["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
			transaction.release?.status === "acknowledged"
		)
	);
}
function workerRunning(home) {
	try {
		lstatSync(join(home, "runtime", "worker.lock"));
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
/** A newer app installed by hand over a retained home carries a newer bundled
 * runtime. When nothing is running and no update is in flight, switch the runtime
 * link to it (atomic rename, same layout the first install used). The worker
 * then records the identity change itself via observeInstalled. */
function adoptBundledRuntime(
	home,
	runtime,
	record,
	prefix,
	link,
	compareVersions,
) {
	if (workerRunning(home) || updateUnresolved(home)) return;
	let installed;
	try {
		installed = JSON.parse(
			readFileSync(join(dirname(realpathSync(link)), "build.json"), "utf8"),
		);
	} catch {
		return; // Unverifiable current runtime: leave it to the updater/operator.
	}
	const identity = verifiedBundle(runtime);
	if (compareVersions(identity.version, installed.version) <= 0) return;
	const target = join(
		prefix,
		"lib",
		"bobs-factory",
		`bobs-factory-${identity.version}-${identity.target}`,
	);
	if (!existsSync(target)) {
		ensureRegular(resolve(runtime));
		const partial = `${target}.adopting-${process.pid}`;
		rmSync(partial, { recursive: true, force: true });
		mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
		cpSync(resolve(runtime), partial, {
			recursive: true,
			errorOnExist: true,
			force: false,
		});
		renameSync(partial, target);
	}
	// The ownership record binds the link to the identity it was created for. Move
	// it first: a crash leaves the old link, which the next start adopts again.
	const owned = JSON.parse(readFileSync(record, "utf8"));
	writeFileSync(
		`${record}.tmp`,
		JSON.stringify({ ...owned, initial: identity }),
		{ mode: 0o600 },
	);
	renameSync(`${record}.tmp`, record);
	const next = `${link}.next-${process.pid}`;
	rmSync(next, { force: true });
	symlinkSync(join(target, "bobs-factory"), next);
	renameSync(next, link);
}
/** Last lines the worker wrote since this launch, so a failed start explains itself. */
export function workerStartupFailure(logFile, offset, message) {
	let tail = "";
	try {
		const size = statSync(logFile).size,
			start = Math.max(offset, size - 4096),
			buffer = Buffer.alloc(size - start),
			fd = openSync(logFile, "r");
		try {
			readSync(fd, buffer, 0, buffer.length, start);
		} finally {
			closeSync(fd);
		}
		tail = buffer.toString("utf8").trim().split("\n").slice(-15).join("\n");
	} catch {}
	return `${message}\n${tail ? `Worker output:\n${tail}\n` : "The worker wrote no output.\n"}Full log: ${logFile}`;
}
export function desktopExecutable(home, runtime, { compareVersions } = {}) {
	home = realpathSync(home);
	const prefix = join(home, "runtime", "desktop-installed"),
		link = join(prefix, "bin", "bobs-factory"),
		record = join(home, "runtime", "desktop-runtime.json");
	if (existsSync(record)) {
		const value = JSON.parse(readFileSync(record, "utf8"));
		if (
			value.schema !== 1 ||
			value.home !== home ||
			value.executable !== link ||
			!lstatSync(link).isSymbolicLink()
		)
			throw new Error("Desktop runtime ownership mismatch");
		// Preserve an already updated runtime; an older shell cannot roll it back.
		// A newer bundled one is adopted only while the updater owns nothing.
		if (compareVersions)
			adoptBundledRuntime(home, runtime, record, prefix, link, compareVersions);
		return link;
	}
	const identity = verifiedBundle(runtime);
	const target = join(
		prefix,
		"lib",
		"bobs-factory",
		`bobs-factory-${identity.version}-${identity.target}`,
	);
	if (existsSync(target))
		throw new Error(
			"Interrupted desktop runtime setup: reconcile retained bytes before retry",
		);
	ensureRegular(resolve(runtime));
	mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
	cpSync(runtime, target, {
		recursive: true,
		errorOnExist: true,
		force: false,
	});
	mkdirSync(dirname(link), { recursive: true, mode: 0o700 });
	symlinkSync(join(target, "bobs-factory"), link);
	writeFileSync(
		`${record}.tmp`,
		JSON.stringify({ schema: 1, home, executable: link, initial: identity }),
		{ mode: 0o600 },
	);
	renameSync(`${record}.tmp`, record);
	return link;
}

import { readdirSync as awaitNames } from "node:fs";
