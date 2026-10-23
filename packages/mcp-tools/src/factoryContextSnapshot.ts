import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { isImmutableJson, snapshotEntryIdentity } from "bobs-factory-core";
import {
	type TranscriptScope,
	transcriptFieldSources,
	transcriptProvenanceEpoch,
	transcriptSource,
} from "./factoryContextAccess.js";
import type { ContextMemoryAccess } from "./factoryContextMemory.js";

type Node = {
	transcript?: TranscriptScope;
	containsTranscript?: true;
	kind: "null" | "boolean" | "number" | "string" | "array" | "object";
	characters: number;
	value?: null | boolean | number | string;
	length?: number;
	chunks?: { hash: string; length: number; characters: number }[];
	entries?: [string, string][];
};
type Reference = object;
type StringChunk = { chunk: string; raw: boolean; length: number };
const references = new WeakMap<
	Reference,
	{ store: FactoryContextSnapshot; id: string }
>();
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;
const format = "factory-context-snapshot-v1";
const transcriptFormat = "factory-context-snapshot-v2";
const chunkCharacters = 16 * 1024;
// Only core-published immutable JSON may skip capture across role handoffs.
// Directory-scoped weak keys neither retain receipts nor trust shallow freezes.
const immutableInputs = new Map<string, WeakMap<object, string>>();
// Bounded metadata only: no decoded receipts are held by stable source keys.
const immutableEntries = new Map<string, Map<string, string>>();

/** Keep JSON escaping identical at chunk boundaries, including surrogate pairs. */
function* stringParts(value: string): Generator<string> {
	for (let offset = 0; offset < value.length; ) {
		let end = Math.min(value.length, offset + chunkCharacters);
		if (
			end < value.length &&
			/[\uD800-\uDBFF]/u.test(value[end - 1]!) &&
			/[\uDC00-\uDFFF]/u.test(value[end]!)
		)
			end--;
		yield value.slice(offset, end);
		offset = end;
	}
}
function* escaped(value: string): Generator<string> {
	yield '"';
	for (const part of stringParts(value))
		yield JSON.stringify(part).slice(1, -1);
	yield '"';
}
const stringLength = (value: string) => {
	let length = 0;
	for (const part of escaped(value)) length += part.length;
	return length;
};

/** Only machine fingerprint hashing needs a serialized traversal; never join it. */
function* jsonParts(
	value: unknown,
	ancestors = new Set<object>(),
	key = "",
	converted = false,
): Generator<string> {
	if (
		!converted &&
		value &&
		typeof value === "object" &&
		"toJSON" in value &&
		typeof value.toJSON === "function"
	)
		return yield* jsonParts(value.toJSON(key), ancestors, key, true);
	if (typeof value === "string") return yield* escaped(value);
	if (value === null || typeof value !== "object") {
		yield JSON.stringify(value) ?? "null";
		return;
	}
	if (ancestors.has(value))
		throw new TypeError("Cannot serialize circular context");
	ancestors.add(value);
	try {
		const array = Array.isArray(value);
		yield array ? "[" : "{";
		let separator = "";
		for (const key of array
			? Array.from({ length: value.length }, (_, index) => String(index))
			: Object.keys(value)) {
			let child = (value as Record<string, unknown>)[key];
			if (
				child &&
				typeof child === "object" &&
				"toJSON" in child &&
				typeof child.toJSON === "function"
			)
				child = child.toJSON(key);
			if (
				!array &&
				(child === undefined ||
					typeof child === "function" ||
					typeof child === "symbol")
			)
				continue;
			yield separator;
			if (!array) {
				yield* escaped(key);
				yield ":";
			}
			yield* jsonParts(child, ancestors, key, true);
			separator = ",";
		}
		yield array ? "]" : "}";
	} finally {
		ancestors.delete(value);
	}
}

/** Preflight a transcript handoff without serializing or cloning its complete graph. */
export function boundedFactoryContextBytes(
	value: unknown,
	limit: number,
): number | undefined {
	let bytes = 0;
	for (const part of jsonParts(value)) {
		bytes += Buffer.byteLength(part, "utf8");
		if (bytes > limit) return undefined;
	}
	return bytes;
}

function privateDirectory(path: string) {
	const stat = lstatSync(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.mode & 0o077 ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error(
			"Context snapshot requires a private operator-owned directory",
		);
}
function privateFile(path: string): string {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = fstatSync(fd);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.mode & 0o077 ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("Context snapshot requires a private regular file");
		return readFileSync(fd, "utf8");
	} finally {
		closeSync(fd);
	}
}

/** A private immutable JSON DAG. Only bounded strings and node descriptors are parsed. */
export class FactoryContextSnapshot {
	private readonly cache = new Map<string, Node>();
	private readonly handles = new Map<string, Reference>();
	private readonly seen = new WeakMap<object, Reference>();
	private readonly ancestors = new Set<object>();
	private readonly written = new Set<string>();
	private readonly manifests = new WeakMap<
		object,
		{ digest: string; entries: number; version: number }
	>();
	readonly directory: string;
	root!: Reference;
	constructor(
		readonly path: string,
		directory = dirname(path),
	) {
		this.directory = directory;
	}
	get identity(): string {
		return this.id(this.root);
	}
	private immutableCache(project: boolean) {
		const key = `${this.directory}:${project ? "projected" : "original"}:${transcriptProvenanceEpoch()}`;
		let cache = immutableInputs.get(key);
		if (!cache) {
			cache = new WeakMap();
			immutableInputs.set(key, cache);
			if (immutableInputs.size > 16)
				immutableInputs.delete(immutableInputs.keys().next().value!);
		}
		return cache;
	}
	private entryCache(project: boolean) {
		const key = `${this.directory}:${project ? "projected" : "original"}:${transcriptProvenanceEpoch()}`;
		let cache = immutableEntries.get(key);
		if (!cache) {
			cache = new Map();
			immutableEntries.set(key, cache);
			if (immutableEntries.size > 16)
				immutableEntries.delete(immutableEntries.keys().next().value!);
		}
		return cache;
	}
	private reference(id: string): Reference {
		let reference = this.handles.get(id);
		if (!reference) {
			reference = Object.freeze({});
			references.set(reference, { store: this, id });
			this.handles.set(id, reference);
		}
		return reference;
	}
	private id(reference: unknown): string {
		const binding =
			reference && typeof reference === "object"
				? references.get(reference)
				: undefined;
		if (binding?.store !== this)
			throw new Error("Foreign context snapshot reference");
		return binding.id;
	}
	private file(kind: "nodes" | "chunks", id: string) {
		if (!hashPattern.test(id))
			throw new Error("Invalid context snapshot reference");
		return join(this.directory, kind, `${id}.json`);
	}
	private write(kind: "nodes" | "chunks", body: string): string {
		const id = hash(body),
			key = `${kind}/${id}`;
		if (!this.written.has(key)) {
			try {
				writeFileSync(this.file(kind, id), body, { mode: 0o600, flag: "wx" });
			} catch (error) {
				if (
					(error as NodeJS.ErrnoException).code !== "EEXIST" ||
					privateFile(this.file(kind, id)) !== body
				)
					throw error;
			}
			this.written.add(key);
		}
		return id;
	}
	private put(node: Node): Reference {
		return this.reference(this.write("nodes", JSON.stringify(node)));
	}
	node(reference: unknown): Node {
		const id = this.id(reference);
		let node = this.cache.get(id);
		if (!node) {
			const body = privateFile(this.file("nodes", id));
			if (hash(body) !== id)
				throw new Error("Context snapshot integrity failure");
			node = JSON.parse(body) as Node;
			if (
				!["null", "boolean", "number", "string", "array", "object"].includes(
					node.kind,
				) ||
				!Number.isSafeInteger(node.characters) ||
				node.characters < 0
			)
				throw new Error("Invalid context snapshot node");
			this.cache.set(id, node);
			if (this.cache.size > 128)
				this.cache.delete(this.cache.keys().next().value!);
		}
		return node;
	}
	private chunk(id: string): string {
		const body = privateFile(this.file("chunks", id));
		if (hash(body) !== id)
			throw new Error("Context snapshot integrity failure");
		return body;
	}
	private *capture(
		value: unknown,
		project: boolean,
		key = "",
		converted = false,
		inheritedTranscript?: TranscriptScope,
	): Generator<void, Reference | undefined> {
		const transcript =
			value && typeof value === "object"
				? (transcriptSource(value) ?? inheritedTranscript)
				: inheritedTranscript;
		const put = (node: Node) =>
			this.put({
				...node,
				...(transcript
					? { transcript, containsTranscript: true as const }
					: {}),
			});
		if (value && typeof value === "object") {
			const binding = references.get(value);
			if (binding) {
				if (binding.store !== this)
					throw new Error("Foreign context snapshot reference");
				return value;
			}
			if (!converted && "toJSON" in value && typeof value.toJSON === "function")
				return yield* this.capture(
					value.toJSON(key),
					project,
					key,
					true,
					transcript,
				);
			if (this.ancestors.has(value))
				throw new TypeError("Cannot serialize circular context");
			const previous = !transcript && this.seen.get(value);
			if (previous) return previous;
			if (!transcript && isImmutableJson(value)) {
				const cached = this.immutableCache(project).get(value);
				if (cached) return this.reference(cached);
			}
		}
		if (
			value === undefined ||
			typeof value === "function" ||
			typeof value === "symbol"
		)
			return undefined;
		if (typeof value === "bigint")
			throw new TypeError("Cannot serialize BigInt");
		if (
			value === null ||
			typeof value === "boolean" ||
			typeof value === "number"
		) {
			const scalar =
				typeof value === "number" && !Number.isFinite(value) ? null : value;
			yield;
			return put({
				kind:
					scalar === null ? "null" : (typeof scalar as "boolean" | "number"),
				value: scalar,
				characters: JSON.stringify(scalar).length,
			});
		}
		if (typeof value === "string") {
			if (value.length <= chunkCharacters) {
				yield;
				return put({
					kind: "string",
					value,
					length: value.length,
					characters: JSON.stringify(value).length,
				});
			}
			const chunks: NonNullable<Node["chunks"]> = [];
			let characters = 2;
			for (const part of stringParts(value)) {
				const body = JSON.stringify(part);
				chunks.push({
					hash: this.write("chunks", body),
					length: part.length,
					characters: body.length - 2,
				});
				characters += body.length - 2;
				yield;
			}
			return put({
				kind: "string",
				length: value.length,
				characters,
				chunks,
			});
		}
		const object = value as Record<string, unknown>;
		this.ancestors.add(object);
		try {
			const array = Array.isArray(object),
				entries: [string, string][] = [],
				positions = new Map<string, number>();
			let characters = 2;
			let containsTranscript = false;
			for (const original of array
				? Array.from({ length: object.length }, (_, index) => String(index))
				: Object.keys(object)) {
				const stableIdentity = snapshotEntryIdentity(object, original);
				const cached =
					!transcript &&
					stableIdentity &&
					this.entryCache(project).get(stableIdentity);
				let key = original,
					child = cached ? this.reference(cached) : object[original];
				if (project && child && typeof child === "object") {
					if (
						key === "dependencyManifests" ||
						key === "videoDependencyManifests"
					) {
						key =
							key === "dependencyManifests"
								? "manifestInventory"
								: "videoManifestInventory";
						child = { count: Object.keys(child).length, runtimeOnly: true };
					} else if (key === "dependencyHashes") {
						let manifest = this.manifests.get(child);
						if (!manifest) {
							const digest = createHash("sha256");
							for (const part of jsonParts(child)) {
								digest.update(part);
								yield;
							}
							manifest = {
								digest: digest.digest("hex"),
								entries: Object.keys(child).length,
								version: Number(object.fingerprintVersion ?? 1),
							};
							this.manifests.set(child, manifest);
						}
						key = "sourceFingerprint";
						child = manifest;
					}
				}
				const reference =
					(yield* this.capture(
						child,
						project,
						key,
						false,
						transcriptFieldSources(object)?.get(original) ?? transcript,
					)) ?? (array ? yield* this.capture(null, project) : undefined);
				if (!reference) continue;
				containsTranscript ||= !!this.node(reference).containsTranscript;
				const identity =
					stableIdentity ?? snapshotEntryIdentity(object, original);
				if (identity && !transcript) {
					const cache = this.entryCache(project);
					cache.set(identity, this.id(reference));
					if (cache.size > 8192) cache.delete(cache.keys().next().value!);
				}
				const previous = positions.get(key);
				if (previous === undefined) {
					characters +=
						(entries.length ? 1 : 0) +
						(array ? 0 : stringLength(key) + 1) +
						this.node(reference).characters;
					positions.set(key, entries.length);
					entries.push([key, this.id(reference)]);
				} else {
					characters +=
						this.node(reference).characters -
						this.node(this.reference(entries[previous]![1])).characters;
					entries[previous] = [key, this.id(reference)];
				}
				yield;
			}
			const reference = put({
				kind: array ? "array" : "object",
				entries,
				characters,
				...(containsTranscript ? { containsTranscript: true as const } : {}),
			});
			if (!transcript) this.seen.set(object, reference);
			if (!transcript && isImmutableJson(object))
				this.immutableCache(project).set(object, this.id(reference));
			return reference;
		} finally {
			this.ancestors.delete(object);
		}
	}
	private *writeSnapshot(input: unknown, project: boolean): Generator<void> {
		privateDirectory(this.directory);
		for (const kind of ["nodes", "chunks"]) {
			mkdirSync(join(this.directory, kind), { mode: 0o700, recursive: true });
			privateDirectory(join(this.directory, kind));
		}
		this.root =
			(yield* this.capture(input, project)) ??
			(yield* this.capture(null, project))!;
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		writeFileSync(
			temporary,
			JSON.stringify({
				format: this.node(this.root).containsTranscript
					? transcriptFormat
					: format,
				root: this.identity,
				...(this.directory !== dirname(this.path)
					? { directory: this.directory }
					: {}),
			}),
			{ mode: 0o600, flag: "wx" },
		);
		renameSync(temporary, this.path);
	}
	writeSync(input: unknown, project = false) {
		for (const _ of this.writeSnapshot(input, project)) {
			/* bounded synchronous compatibility path */
		}
	}
	async writeAsync(input: unknown, project = false) {
		let count = 0,
			started = performance.now();
		for (const _ of this.writeSnapshot(input, project)) {
			if (++count >= 64 || performance.now() - started >= 8) {
				await setImmediate();
				count = 0;
				started = performance.now();
			}
		}
	}
	static open(path: string) {
		privateDirectory(dirname(path));
		const manifest = JSON.parse(privateFile(path));
		if (
			(manifest.format !== format && manifest.format !== transcriptFormat) ||
			!hashPattern.test(manifest.root) ||
			(manifest.directory !== undefined &&
				(typeof manifest.directory !== "string" ||
					!isAbsolute(manifest.directory)))
		)
			throw new Error("Invalid context snapshot manifest");
		const store = new FactoryContextSnapshot(path, manifest.directory);
		privateDirectory(store.directory);
		privateDirectory(join(store.directory, "nodes"));
		privateDirectory(join(store.directory, "chunks"));
		store.root = store.reference(manifest.root);
		store.node(store.root);
		return store;
	}
	/** Derived indexes are private, root-bound and built only on explicit navigation. */
	memoized(name: string, build: () => unknown): Reference {
		if (!/^[a-z0-9-]+$/.test(name))
			throw new Error("Invalid context index name");
		const path = join(this.directory, `index-${this.identity}-${name}.json`);
		try {
			const index = JSON.parse(privateFile(path));
			if (
				index.format !== "factory-context-index-v1" ||
				index.root !== this.identity ||
				!hashPattern.test(index.value)
			)
				throw new Error("Invalid context snapshot index");
			const value = this.reference(index.value);
			this.node(value);
			return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const value = this.append(build());
		const body = JSON.stringify({
			format: "factory-context-index-v1",
			root: this.identity,
			value: this.id(value),
		});
		try {
			writeFileSync(path, body, { mode: 0o600, flag: "wx" });
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code !== "EEXIST" ||
				privateFile(path) !== body
			)
				throw error;
		}
		return value;
	}
	append(value: unknown): Reference {
		const writer = this.capture(value, false);
		let next = writer.next();
		while (!next.done) next = writer.next();
		return next.value!;
	}
	keys(value: unknown): string[] {
		return this.node(value).entries?.map(([key]) => key) ?? [];
	}
	entries(
		value: unknown,
		offset: number,
		limit: number,
	): [string, Reference][] {
		return (this.node(value).entries ?? [])
			.slice(offset, offset + limit)
			.map(([key, id]) => [key, this.reference(id)]);
	}
	get(value: unknown, key: string): Reference | undefined {
		const node = this.node(value);
		const id =
			node.kind === "array"
				? /^(0|[1-9][0-9]*)$/.test(key)
					? node.entries?.[Number(key)]?.[1]
					: undefined
				: node.entries?.find(([name]) => name === key)?.[1];
		return id ? this.reference(id) : undefined;
	}
	resolve(path: string, root = this.root): Reference {
		if (path === "") return root;
		if (!path.startsWith("/") || /~(?![01])/u.test(path))
			throw new Error("Use a JSON Pointer path, or an empty path for the root");
		let reference = root;
		for (const part of path.slice(1).split("/")) {
			const child = this.get(
				reference,
				part.replace(/~1/g, "/").replace(/~0/g, "~"),
			);
			if (!child) throw new Error("Context path not found");
			reference = child;
		}
		return reference;
	}
	private *parts(
		reference: Reference,
		raw = false,
	): Generator<string | Reference | StringChunk> {
		const node = this.node(reference);
		if (node.kind === "string") {
			if (typeof node.value === "string") {
				if (raw) yield node.value;
				else yield* escaped(node.value);
			} else {
				if (!raw) yield '"';
				for (const chunk of node.chunks!) {
					yield {
						chunk: chunk.hash,
						raw,
						length: raw ? chunk.length : chunk.characters,
					};
				}
				if (!raw) yield '"';
			}
		} else if (node.entries) {
			const array = node.kind === "array";
			yield array ? "[" : "{";
			for (const [index, [key, id]] of node.entries.entries()) {
				if (index) yield ",";
				if (!array) {
					yield* escaped(key);
					yield ":";
				}
				yield this.reference(id);
			}
			yield array ? "]" : "}";
		} else yield JSON.stringify(node.value);
	}
	/** Count a bounded page without joining or returning its transcript payload. */
	pageUtf8Bytes(reference: Reference, offset: number, limit: number): number {
		let skip = offset,
			remaining = limit,
			bytes = 0;
		const visit = (reference: Reference, raw = false) => {
			for (const part of this.parts(reference, raw)) {
				if (!remaining) break;
				const length =
					typeof part === "string"
						? part.length
						: "chunk" in part
							? (part as StringChunk).length
							: this.node(part).characters;
				if (skip >= length) {
					skip -= length;
					continue;
				}
				if (typeof part !== "string" && !("chunk" in part)) visit(part);
				else {
					const body =
						typeof part === "string"
							? part
							: (() => {
									const chunk = part as StringChunk;
									const encoded = this.chunk(chunk.chunk);
									return chunk.raw
										? (JSON.parse(encoded) as string)
										: encoded.slice(1, -1);
								})();
					const page = body.slice(skip, skip + remaining);
					bytes += Buffer.byteLength(page, "utf8");
					remaining -= page.length;
					skip = 0;
				}
			}
		};
		visit(reference, this.node(reference).kind === "string");
		return bytes;
	}

	read(reference: Reference, offset: number, limit: number) {
		const node = this.node(reference),
			raw = node.kind === "string";
		const totalCharacters = raw ? node.length! : node.characters;
		let remaining = limit,
			skip = offset,
			text = "";
		const visit = (reference: Reference, raw = false) => {
			for (const part of this.parts(reference, raw)) {
				if (!remaining) break;
				const length =
					typeof part === "string"
						? part.length
						: "chunk" in part
							? (part as StringChunk).length
							: this.node(part).characters;
				if (skip >= length) {
					skip -= length;
					continue;
				}
				if (typeof part !== "string" && !("chunk" in part)) visit(part);
				else {
					let body: string;
					if (typeof part === "string") body = part;
					else {
						const chunk = part as StringChunk;
						const encoded = this.chunk(chunk.chunk);
						body = chunk.raw ? JSON.parse(encoded) : encoded.slice(1, -1);
					}
					const page = body.slice(skip, skip + remaining);
					text += page;
					remaining -= page.length;
					skip = 0;
				}
			}
		};
		if (offset < totalCharacters) visit(reference, raw);
		return {
			text,
			totalCharacters,
			encoding: raw ? "text" : "json",
			nextOffset:
				offset + text.length < totalCharacters ? offset + text.length : null,
		};
	}
	readonly access: ContextMemoryAccess = {
		isRecord: (value) =>
			Boolean(
				value &&
					references.has(value as object) &&
					this.node(value).kind === "object",
			),
		array: (value) =>
			value &&
			references.has(value as object) &&
			this.node(value).kind === "array"
				? this.keys(value).map((key) => this.get(value, key)!)
				: undefined,
		fields: (value) =>
			Object.fromEntries(
				this.keys(value).map((key) => [key, this.get(value, key)!]),
			),
		string: (value) =>
			value &&
			references.has(value as object) &&
			this.node(value).kind === "string"
				? this.read(value as Reference, 0, this.node(value).length!).text
				: undefined,
		serializedLength: (value) => this.node(value).characters,
		signature: (value) => this.id(value),
	};
}

/** Explicit detached reads for small controlled fixtures. Production uses indexed MCP pages.
 * Never infer a filesystem reference from role JSON; callers supply the owned transport path. */
export function loadFactoryContextSnapshot<T = unknown>(
	path: string,
	pointer = "",
): T {
	const snapshot = FactoryContextSnapshot.open(path),
		reference = snapshot.resolve(pointer),
		parts: string[] = [];
	let offset: number | null = 0,
		encoding = "json";
	while (offset !== null) {
		const page = snapshot.read(reference, offset, 16000);
		parts.push(page.text);
		offset = page.nextOffset;
		encoding = page.encoding;
	}
	const text = parts.join("");
	return (encoding === "text" ? text : JSON.parse(text)) as T;
}
