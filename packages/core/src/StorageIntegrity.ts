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

async function fileHash(path: string, signal?: AbortSignal) {
	const hash = createHash("sha256");
	for await (const bytes of createReadStream(path, { signal }))
		hash.update(bytes);
	return hash.digest("hex");
}
async function* entries(
	root: string,
	signal?: AbortSignal,
): AsyncGenerator<{ path: string; kind: string; value?: string }> {
	let count = 0,
		started = performance.now();
	async function* walk(
		path: string,
	): AsyncGenerator<{ path: string; kind: string; value?: string }> {
		signal?.throwIfAborted();
		if (++count >= 1000 || performance.now() - started >= 1000) {
			await yieldToIO();
			count = 0;
			started = performance.now();
		}
		const stat = await lstat(path),
			name = relative(root, path);
		if (stat.isSymbolicLink()) {
			yield { path: name, kind: "link", value: await readlink(path) };
			return;
		}
		if (stat.isFile()) {
			yield { path: name, kind: "file", value: await fileHash(path, signal) };
			return;
		}
		if (!stat.isDirectory())
			throw new Error("Special snapshot content requires inspection");
		if (name) yield { path: name, kind: "directory" };
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
			};
			if (
				!entry.path ||
				isAbsolute(entry.path) ||
				entry.path.split(sep).includes("..")
			)
				throw new Error("Invalid manifest path");
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
	yield* countTree(root);
	if (actualCount !== count)
		throw new Error("Snapshot contains unexpected files");
	yield { complete: true, entries: operations, apparentBytes: bytes };
}
export async function verifyStorageIntegrity(
	root: string,
	file: string,
	expected: string,
	signal?: AbortSignal,
	allowMissing = false,
) {
	for await (const _slice of storageIntegrityVerification(
		root,
		file,
		expected,
		signal,
		{ allowMissing },
	))
		await yieldToIO();
}
