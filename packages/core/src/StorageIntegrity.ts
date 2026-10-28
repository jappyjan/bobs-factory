import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	opendir,
	readlink,
	rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as yieldToIO } from "node:timers/promises";
import {
	type StorageIdentity,
	type StorageRetentionStore,
	sameStorageIdentity,
	storageIdentity,
} from "./StorageRetention.js";

async function fileHash(path: string, signal?: AbortSignal) {
	const hash = createHash("sha256");
	for await (const bytes of createReadStream(path, { signal }))
		hash.update(bytes);
	return hash.digest("hex");
}
async function* entries(
	root: string,
	signal?: AbortSignal,
): AsyncGenerator<{
	path: string;
	kind: string;
	value?: string;
	identity: StorageIdentity;
}> {
	let count = 0,
		started = performance.now();
	async function* walk(path: string): AsyncGenerator<{
		path: string;
		kind: string;
		value?: string;
		identity: StorageIdentity;
	}> {
		signal?.throwIfAborted();
		if (++count >= 1000 || performance.now() - started >= 1000) {
			await yieldToIO();
			count = 0;
			started = performance.now();
		}
		const stat = await lstat(path),
			name = relative(root, path);
		const identity = {
			device: String(stat.dev),
			inode: String(stat.ino),
			birthtime: stat.birthtimeMs,
		};
		if (stat.isSymbolicLink()) {
			yield { path: name, kind: "link", value: await readlink(path), identity };
			return;
		}
		if (stat.isFile()) {
			yield {
				path: name,
				kind: "file",
				value: await fileHash(path, signal),
				identity,
			};
			return;
		}
		if (!stat.isDirectory())
			throw new Error("Special snapshot content requires inspection");
		if (name) yield { path: name, kind: "directory", identity };
		const directory = await opendir(path);
		for await (const entry of directory) yield* walk(join(path, entry.name));
	}
	yield* walk(root);
}
/** The manifest contains paths and digests, never copied file contents. It lives
 * outside snapshots so verification records cannot recursively back themselves up. */
export async function writeStorageIntegrity(
	root: string,
	file: string,
	signal?: AbortSignal,
) {
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`,
		handle = await open(temporary, "wx", 0o600),
		digest = createHash("sha256");
	try {
		for await (const entry of entries(root, signal)) {
			const line = `${JSON.stringify(entry)}\n`;
			digest.update(line);
			await handle.writeFile(line);
		}
		await handle.sync();
	} finally {
		await handle.close();
	}
	await rename(temporary, file);
	const directory = await open(dirname(file), "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
	return digest.digest("hex");
}
export interface StorageVerificationSlice {
	complete: boolean;
	entries: number;
	apparentBytes?: number;
}
/** A suspended generator retains hash/stream state between scan slices. Restart
 * safely rechecks from the manifest; persisted progress never authorizes skipping verification. */
export async function* storageIntegrityVerification(
	root: string,
	file: string,
	expected: string,
	signal?: AbortSignal,
	initialBounds: {
		maxEntries?: number;
		deadline?: number;
		allowMissing?: boolean;
		allowExtra?: boolean;
		requireIdentity?: boolean;
		rejectLinks?: boolean;
	} = {},
): AsyncGenerator<
	StorageVerificationSlice,
	void,
	{ maxEntries?: number; deadline?: number } | undefined
> {
	let operations = 0,
		started = performance.now(),
		bytes = 0,
		bounds = initialBounds;
	function* tick(
		count = 1,
	): Generator<
		StorageVerificationSlice,
		void,
		{ maxEntries?: number; deadline?: number } | undefined
	> {
		operations += count;
		if (
			operations >= (bounds.maxEntries ?? 1000) ||
			performance.now() >= (bounds.deadline ?? started + 1000)
		) {
			bounds = (yield { complete: false, entries: operations }) ?? {};
			operations = 0;
			started = performance.now();
		}
	}
	async function* hashFile(
		path: string,
	): AsyncGenerator<
		StorageVerificationSlice,
		string,
		{ maxEntries?: number; deadline?: number } | undefined
	> {
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(path, { signal })) {
			hash.update(chunk);
			yield* tick(0);
		}
		return hash.digest("hex");
	}
	const stat = await lstat(file);
	yield* tick();
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Invalid snapshot integrity manifest");
	const digest = createHash("sha256"),
		input = createReadStream(file, { signal });
	const lines = createInterface({ input, crlfDelay: Infinity });
	let count = 0;
	try {
		for await (const line of lines) {
			signal?.throwIfAborted();
			digest.update(`${line}\n`);
			const entry = JSON.parse(line) as {
				path: string;
				kind: string;
				value?: string;
				identity?: StorageIdentity;
			};
			if (
				!entry.path ||
				isAbsolute(entry.path) ||
				entry.path.split(sep).includes("..")
			)
				throw new Error("Invalid manifest path");
			if (initialBounds.rejectLinks && entry.kind === "link")
				throw new Error(
					"Runtime link dependencies require independent restoration proof",
				);
			const path = join(root, entry.path);
			try {
				let ancestor = dirname(path);
				while (ancestor !== root) {
					const parent = await lstat(ancestor);
					yield* tick();
					if (!parent.isDirectory() || parent.isSymbolicLink())
						throw new Error("Snapshot ancestor changed");
					ancestor = dirname(ancestor);
				}
				const actual = await lstat(path);
				yield* tick();
				if (
					!initialBounds.allowExtra &&
					(entry.identity || initialBounds.requireIdentity)
				) {
					if (
						!entry.identity ||
						!sameStorageIdentity(entry.identity, {
							device: String(actual.dev),
							inode: String(actual.ino),
							birthtime: actual.birthtimeMs,
						})
					)
						throw new Error(
							"Storage object identity changed or is unavailable",
						);
				}
				let valid = false;
				if (entry.kind === "directory")
					valid = actual.isDirectory() && !actual.isSymbolicLink();
				else if (entry.kind === "link") {
					valid =
						actual.isSymbolicLink() && (await readlink(path)) === entry.value;
					bytes += actual.size;
					yield* tick();
				} else if (
					entry.kind === "file" &&
					actual.isFile() &&
					!actual.isSymbolicLink()
				) {
					const hashing = hashFile(path);
					let part = await hashing.next();
					while (!part.done) {
						const nextBounds = yield part.value;
						part = await hashing.next(nextBounds);
					}
					valid = part.value === entry.value;
					bytes += actual.size;
				}
				if (!valid) throw new Error("Snapshot integrity changed");
				count++;
			} catch (error) {
				if (
					!(
						initialBounds.allowMissing &&
						(error as NodeJS.ErrnoException).code === "ENOENT"
					)
				)
					throw error;
			}
		}
	} finally {
		lines.close();
		input.destroy();
	}
	if (digest.digest("hex") !== expected)
		throw new Error("Snapshot integrity manifest changed");
	let actualCount = 0;
	async function* countTree(
		path: string,
	): AsyncGenerator<
		StorageVerificationSlice,
		void,
		{ maxEntries?: number; deadline?: number } | undefined
	> {
		const actual = await lstat(path);
		yield* tick();
		if (path !== root) actualCount++;
		if (!actual.isDirectory() || actual.isSymbolicLink()) return;
		const directory = await opendir(path);
		yield* tick();
		for await (const entry of directory)
			yield* countTree(join(path, entry.name));
	}
	if (!initialBounds.allowExtra) yield* countTree(root);
	if (!initialBounds.allowExtra && actualCount !== count)
		throw new Error("Snapshot contains unexpected files");
	yield { complete: true, entries: operations, apparentBytes: bytes };
}
export async function verifyStorageIntegrity(
	root: string,
	file: string,
	expected: string,
	signal?: AbortSignal,
	allowMissing = false,
	allowExtra = false,
) {
	for await (const _slice of storageIntegrityVerification(
		root,
		file,
		expected,
		signal,
		{ allowMissing, allowExtra },
	))
		await yieldToIO();
}

/** Only exact, independently verified copies of current Factory-owned state can
 * release a recovery dependency. Unknown files, credentials and links stay held. */
export async function reconcileStorageCopy(
	store: StorageRetentionStore,
	id: string,
	authoritativePath = store.home,
	claimHeld = false,
) {
	if (
		![
			store.home,
			join(store.home, "state"),
			join(store.home, "factory"),
		].includes(authoritativePath)
	)
		throw new Error("Replacement must be current authoritative Factory state");
	const record = await store.record(id);
	const reconcile = async () => {
		const fresh = await store.record(id);
		const integrity = fresh.evidence
			.find((value) => value.startsWith("integrity:"))
			?.slice(10);
		if (!integrity)
			throw new Error("Complete producer integrity evidence is required");
		if (
			authoritativePath === fresh.path ||
			authoritativePath.startsWith(`${fresh.path}${sep}`)
		)
			throw new Error("Replacement cannot depend on the obsolete copy");
		const manifest = join(store.directory, "proofs", `${id}.ndjson`);
		await verifyStorageIntegrity(fresh.path, manifest, integrity);
		const input = createReadStream(manifest);
		const lines = createInterface({ input, crlfDelay: Infinity });
		try {
			for await (const line of lines) {
				const entry = JSON.parse(line) as { path: string; kind: string };
				const path =
					authoritativePath === store.home
						? entry.path
						: `${relative(store.home, authoritativePath)}/${entry.path}`;
				if (
					!(
						path === "config.json" ||
						path === "state" ||
						path.startsWith(`state${sep}`) ||
						path === "factory" ||
						path.startsWith(`factory${sep}`)
					) ||
					path === "factory/auth" ||
					path.startsWith("factory/auth/") ||
					entry.kind === "link"
				)
					throw new Error(
						"Mixed, native, authentication or linked backups cannot be elected disposable",
					);
			}
		} finally {
			lines.close();
			input.destroy();
		}
		const identity = await storageIdentity(
			authoritativePath,
			dirname(authoritativePath),
		);
		await verifyStorageIntegrity(
			authoritativePath,
			manifest,
			integrity,
			undefined,
			false,
			true,
		);
		if (
			!sameStorageIdentity(
				identity,
				await storageIdentity(authoritativePath, dirname(authoritativePath)),
			)
		)
			throw new Error("Authoritative replacement identity changed");
		return store.revise(id, (value) => {
			value.authoritativeReplacement = {
				path: authoritativePath,
				identity,
				integrity,
			};
			value.dependencies = [];
			value.reconciledAt = value.verifiedAt = new Date().toISOString();
		});
	};
	return claimHeld
		? reconcile()
		: store.workspaceClaim(record.path).run(reconcile, true);
}
