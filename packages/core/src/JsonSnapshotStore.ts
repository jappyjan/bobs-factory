import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setImmediate as yieldToIO } from "node:timers/promises";

export type SnapshotJson =
	| null
	| boolean
	| number
	| string
	| SnapshotJson[]
	| { [key: string]: SnapshotJson };
export type JsonReference = {
	chunks: string[];
	hash: string;
	bytes: number;
	preview?: SnapshotJson;
	keys?: string[];
	keysTruncated?: boolean;
};
export type SnapshotField =
	| { value: SnapshotJson }
	| { reference: JsonReference }
	| {
			pages: JsonReference[];
			length: number;
			timestamps?: SnapshotJson[];
			pageSize?: number;
	  }
	| { record: Record<string, SnapshotField> };
export interface JsonSnapshot {
	format: "bobs-factory-json-snapshot-1";
	summary: Record<string, SnapshotJson>;
	fields: Record<string, SnapshotField>;
}
const defaultPageSize = 64;
const chunkSize = 128 * 1024;
const owners = new WeakMap<object, string>();
const immutableValues = new WeakSet<object>();
const committedArrays = new WeakMap<
	unknown[],
	{ directory: string; pages: JsonReference[]; members: unknown[][] }
>();
const lazyArrays = new WeakMap<
	unknown[],
	{
		field: Extract<SnapshotField, { pages: unknown }>;
		loaded: Set<number>;
		immutable?: boolean;
		dirty: Set<number>;
	}
>();
type CapturedField = {
	existing?: SnapshotField;
	json?: SnapshotJson;
	pages?: (JsonReference | SnapshotJson[])[];
	source?: unknown[];
	members?: unknown[][];
	length?: number;
	pageSize?: number;
	timestamps?: SnapshotJson[];
	record?: Record<string, CapturedField>;
};
const lazyFields = new WeakMap<
	object,
	Map<string, { field: SnapshotField; loaded: boolean }>
>();

/** Capture mutable structure now; strings remain shared instead of being copied. */
function capture(
	value: unknown,
	ancestors = new Set<object>(),
): SnapshotJson | undefined {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "bigint") throw new TypeError("Cannot serialize BigInt");
	if (typeof value !== "object") return undefined;
	if (immutableValues.has(value)) return value as SnapshotJson;
	if (ancestors.has(value))
		throw new TypeError("Cannot serialize circular state");
	if ("toJSON" in value && typeof value.toJSON === "function") {
		const json = value.toJSON();
		if (json !== value) return capture(json, ancestors);
	}
	ancestors.add(value);
	try {
		if (Array.isArray(value))
			return Array.from(value, (entry) => capture(entry, ancestors) ?? null);
		const result: Record<string, SnapshotJson> = Object.create(null);
		for (const key of Object.keys(value)) {
			const entry = capture((value as Record<string, unknown>)[key], ancestors);
			if (entry !== undefined) result[key] = entry;
		}
		return result;
	} finally {
		ancestors.delete(value);
	}
}

/** Transcript entries are published facts; clone structure once and retain exact JSON data. */
export function immutableJson<T>(value: T): T {
	const json = capture(value);
	const freeze = (entry: SnapshotJson | undefined): void => {
		if (!entry || typeof entry !== "object") return;
		for (const child of Object.values(entry)) freeze(child);
		Object.freeze(entry);
		immutableValues.add(entry);
	};
	freeze(json);
	return json as T;
}
export function immutableTranscript(entries: unknown[]): void {
	const lazy = lazyArrays.get(entries);
	if (lazy) {
		lazy.immutable = true;
		return;
	}
	for (let index = 0; index < entries.length; index++)
		entries[index] = immutableJson(entries[index]);
}

/** Cursor selection can inspect a transcript without materializing its payloads. */
export function snapshotArrayTimestamps(
	entries: unknown[],
): SnapshotJson[] | undefined {
	return lazyArrays.get(entries)?.field.timestamps;
}

function captureField(
	value: unknown,
	splitRecord = false,
	paged = true,
	requestedPageSize?: number,
	directory?: string,
): CapturedField {
	if (paged && Array.isArray(value)) {
		const lazy =
			owners.get(value) === directory ? lazyArrays.get(value) : undefined;
		const pageSize =
			requestedPageSize ?? lazy?.field.pageSize ?? defaultPageSize;
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 64)
			throw new Error("Invalid snapshot page size");
		const pages: (JsonReference | SnapshotJson[])[] = [];
		const members: unknown[][] = [];
		const cached = committedArrays.get(value);
		const previous = cached?.directory === directory ? cached : undefined;
		for (let offset = 0; offset < value.length; offset += pageSize) {
			const page = offset / pageSize;
			if (
				lazy &&
				(lazy.field.pageSize ?? defaultPageSize) === pageSize &&
				(!lazy.loaded.has(page) || (lazy.immutable && !lazy.dirty.has(page))) &&
				offset + pageSize <= lazy.field.length &&
				offset + pageSize <= value.length
			)
				pages.push(lazy.field.pages[page]!);
			else {
				const entries = value.slice(offset, offset + pageSize);
				const old = previous?.members[page];
				if (
					old &&
					old.length === entries.length &&
					entries.every(
						(entry, index) =>
							entry === old[index] &&
							entry &&
							typeof entry === "object" &&
							immutableValues.has(entry),
					)
				)
					pages.push(previous!.pages[page]!);
				else pages.push(capture(entries) as SnapshotJson[]);
				members[page] = entries;
			}
		}
		const timestamps = Array.from({ length: value.length }, (_, index) => {
			if (
				lazy?.field.timestamps &&
				!lazy.dirty.has(Math.floor(index / pageSize)) &&
				index < lazy.field.length
			)
				return lazy.field.timestamps[index]!;
			const entry = value[index] as
				| {
						metadata?: { timestamp?: unknown };
						timestamp?: unknown;
						createdAt?: unknown;
				  }
				| undefined;
			return (
				capture(
					entry?.metadata?.timestamp ??
						entry?.timestamp ??
						entry?.createdAt ??
						0,
				) ?? 0
			);
		});
		return {
			pages,
			length: value.length,
			source: value,
			members,
			timestamps,
			pageSize,
		};
	}
	if (splitRecord && value && typeof value === "object")
		return {
			record: captureFields(
				value as Record<string, unknown>,
				[],
				paged,
				[],
				{},
				directory,
			),
		};
	return { json: capture(value) };
}
function captureFields(
	value: Record<string, unknown>,
	records: string[] = [],
	paged = true,
	pagedRecords: string[] = [],
	pageSizes: Record<string, number> = {},
	directory?: string,
): Record<string, CapturedField> {
	const fields: Record<string, CapturedField> = Object.create(null);
	for (const key of Object.keys(value)) {
		const lazy = lazyFields.get(value)?.get(key);
		fields[key] =
			lazy && owners.get(value) === directory && !lazy.loaded
				? { existing: lazy.field }
				: captureField(
						value[key],
						records.includes(key),
						records.includes(key) ? pagedRecords.includes(key) : paged,
						pageSizes[key],
						directory,
					);
	}
	return fields;
}

function boundedSize(value: SnapshotJson, limit: number): number {
	let size = 0;
	const pending = [value];
	while (pending.length && size < limit) {
		const next = pending.pop();
		size += 2;
		if (typeof next === "string") size += next.length * 6;
		else if (Array.isArray(next)) {
			if (next.length > limit - size) return limit;
			pending.push(...next);
		} else if (next && typeof next === "object") {
			for (const [key, part] of Object.entries(next)) {
				size += key.length * 6 + 3;
				pending.push(part);
				if (size >= limit) break;
			}
		} else size += 24;
	}
	return size;
}

/** No individual stringify sees an entire transcript or even a large string. */
function* tokens(value: SnapshotJson): Generator<string> {
	if (typeof value === "string") {
		yield '"';
		for (let offset = 0; offset < value.length; ) {
			let end = Math.min(value.length, offset + 16 * 1024);
			if (
				end < value.length &&
				/[\uD800-\uDBFF]/.test(value[end - 1]!) &&
				/[\uDC00-\uDFFF]/.test(value[end]!)
			)
				end--;
			yield JSON.stringify(value.slice(offset, end)).slice(1, -1);
			offset = end;
		}
		yield '"';
	} else if (Array.isArray(value)) {
		yield "[";
		for (let index = 0; index < value.length; index++) {
			if (index) yield ",";
			yield* tokens(value[index]!);
		}
		yield "]";
	} else if (value && typeof value === "object") {
		yield "{";
		let separator = "";
		for (const [key, entry] of Object.entries(value)) {
			yield separator;
			yield* tokens(key);
			yield ":";
			yield* tokens(entry);
			separator = ",";
		}
		yield "}";
	} else yield JSON.stringify(value);
}

/** Immutable content chunks plus an atomic manifest; old manifests never reference partial writes. */
export class JsonSnapshotStore {
	private queues = new Map<string, Promise<void>>();
	private known = new Set<string>();
	private backedUp = new Set<string>();
	private failures = new Map<string, unknown>();
	private immutablePages = new WeakMap<object, JsonReference>();
	private previews = new WeakMap<object, Record<string, SnapshotField>>();
	readonly metrics = {
		commits: 0,
		chunksWritten: 0,
		bytesWritten: 0,
		lastCommitMs: 0,
		lastCaptureMs: 0,
		maxCaptureMs: 0,
	};
	constructor(readonly directory: string) {
		this.directory = resolve(directory);
	}
	private chunkPath(hash: string): string {
		if (!/^[a-f0-9]{64}$/.test(hash))
			throw new Error("Invalid snapshot chunk reference");
		return join(this.directory, `${hash}.json`);
	}
	private async encode(value: SnapshotJson): Promise<JsonReference> {
		const chunks: string[] = [];
		const digest = createHash("sha256");
		let bytes = 0;
		let parts: string[] = [],
			length = 0;
		const flush = async () => {
			const body = parts.join("");
			parts = [];
			length = 0;
			digest.update(body);
			bytes += Buffer.byteLength(body);
			const hash = createHash("sha256").update(body).digest("hex");
			chunks.push(hash);
			if (!this.known.has(hash)) {
				try {
					const temporary = `${this.chunkPath(hash)}.${randomUUID()}.tmp`;
					await writeFile(temporary, body, {
						encoding: "utf8",
						mode: 0o600,
						flag: "wx",
					});
					await rename(temporary, this.chunkPath(hash));
					this.metrics.chunksWritten++;
					this.metrics.bytesWritten += Buffer.byteLength(body);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
				this.known.add(hash);
			}
			await yieldToIO();
		};
		for (const token of tokens(value)) {
			parts.push(token);
			length += token.length;
			if (length >= chunkSize) await flush();
		}
		if (length) await flush();
		let preview: SnapshotJson | undefined;
		if (value && !Array.isArray(value) && typeof value === "object") {
			const kept: Record<string, SnapshotJson> = Object.create(null);
			let remaining = 16000;
			for (const [key, part] of Object.entries(value)) {
				const size =
					boundedSize(part, Math.min(remaining, 12000)) + key.length * 6;
				if (size < Math.min(remaining, 12000)) {
					kept[key] = part;
					remaining -= size;
				}
				if (remaining < 64) break;
			}
			preview = kept;
		}
		return {
			chunks,
			hash: digest.digest("hex"),
			bytes,
			...(preview
				? {
						preview,
						keys: Object.keys(value as object).slice(0, 256),
						keysTruncated: Object.keys(value as object).length > 256,
					}
				: {}),
		};
	}
	private decode(reference: JsonReference): SnapshotJson {
		if (!Array.isArray(reference.chunks) || !reference.chunks.length)
			throw new Error("Invalid snapshot reference");
		const digest = createHash("sha256");
		let bytes = 0;
		const parts = reference.chunks.map((hash) => {
			const body = readFileSync(this.chunkPath(hash), "utf8");
			if (createHash("sha256").update(body).digest("hex") !== hash)
				throw new Error("Snapshot chunk integrity failure");
			digest.update(body);
			bytes += Buffer.byteLength(body);
			return body;
		});
		if (digest.digest("hex") !== reference.hash || bytes !== reference.bytes)
			throw new Error("Snapshot document integrity failure");
		return JSON.parse(parts.join(""));
	}
	private hydrate(field: SnapshotField): unknown {
		if ("value" in field) return field.value;
		if ("reference" in field) return this.decode(field.reference);
		if ("record" in field) return this.fields(field.record);
		const pageSize = field.pageSize ?? defaultPageSize;
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 64)
			throw new Error("Invalid snapshot page size");
		if (
			!Number.isSafeInteger(field.length) ||
			field.length < 0 ||
			field.pages.length !== Math.ceil(field.length / pageSize)
		)
			throw new Error("Invalid snapshot array");
		const array = new Array(field.length);
		const pages = new Map<number, SnapshotJson[]>();
		const loaded = new Set<number>();
		const lazy = { field, loaded, dirty: new Set<number>(), immutable: false };
		lazyArrays.set(array, lazy);
		owners.set(array, this.directory);
		for (let index = 0; index < field.length; index++) {
			Object.defineProperty(array, index, {
				configurable: true,
				enumerable: true,
				get: () => {
					const page = Math.floor(index / pageSize);
					loaded.add(page);
					let entries = pages.get(page);
					if (!entries) {
						entries = this.decode(field.pages[page]!) as SnapshotJson[];
						if (!Array.isArray(entries))
							throw new Error("Invalid snapshot page");
						if (lazy.immutable)
							entries = entries.map((entry) => immutableJson(entry));
						pages.set(page, entries);
						if (lazy.immutable && pages.size > 4)
							pages.delete(pages.keys().next().value!);
					}
					return entries[index % pageSize];
				},
				set: (value) => {
					loaded.add(Math.floor(index / pageSize));
					lazy.dirty.add(Math.floor(index / pageSize));
					Object.defineProperty(array, index, {
						value,
						writable: true,
						configurable: true,
						enumerable: true,
					});
				},
			});
		}
		return array;
	}
	private fields(
		fields: Record<string, SnapshotField>,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const metadata = new Map<
			string,
			{ field: SnapshotField; loaded: boolean }
		>();
		lazyFields.set(result, metadata);
		owners.set(result, this.directory);
		for (const [key, field] of Object.entries(fields)) {
			const state = { field, loaded: false };
			metadata.set(key, state);
			Object.defineProperty(result, key, {
				enumerable: true,
				configurable: true,
				get: () => {
					const value = this.hydrate(field);
					state.loaded = true;
					Object.defineProperty(result, key, {
						value,
						writable: true,
						enumerable: true,
						configurable: true,
					});
					return value;
				},
				set: (value) => {
					state.loaded = true;
					Object.defineProperty(result, key, {
						value,
						writable: true,
						enumerable: true,
						configurable: true,
					});
				},
			});
		}
		return result;
	}
	load<T>(path: string): { value: T; summary: JsonSnapshot["summary"] } {
		const snapshot = JSON.parse(readFileSync(path, "utf8")) as JsonSnapshot;
		if (
			snapshot.format !== "bobs-factory-json-snapshot-1" ||
			!snapshot.fields ||
			!snapshot.summary
		)
			throw new Error("Unsupported snapshot format");
		return {
			value: this.fields(snapshot.fields) as T,
			summary: snapshot.summary,
		};
	}
	write(
		path: string,
		value: Record<string, unknown>,
		summary: Record<string, unknown> = {},
		records: string[] = [],
		pagedRecords: string[] = [],
		pageSizes: Record<string, number> = {},
	): Promise<void> {
		// Reuse untouched lazy fields without loading historical payloads. Loaded
		// fields are recaptured, so edits within restored objects are never lost.
		const capturedAt = performance.now();
		const fields = captureFields(
			value,
			records,
			true,
			pagedRecords,
			pageSizes,
			this.directory,
		);
		this.metrics.lastCaptureMs = performance.now() - capturedAt;
		this.metrics.maxCaptureMs = Math.max(
			this.metrics.maxCaptureMs,
			this.metrics.lastCaptureMs,
		);
		const savedSummary = capture(summary) as JsonSnapshot["summary"];
		const commit = (this.queues.get(path) ?? Promise.resolve()).then(
			async () => {
				const started = performance.now();
				if (!this.backedUp.has(path)) {
					try {
						await copyFile(path, `${path}.legacy`, 1);
					} catch (error) {
						if (
							!["ENOENT", "EEXIST"].includes(
								(error as NodeJS.ErrnoException).code ?? "",
							)
						)
							throw error;
					}
					this.backedUp.add(path);
				}
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const encodeField = async (
					field: CapturedField,
				): Promise<SnapshotField | undefined> => {
					if (field.existing) return field.existing;
					if (field.record) {
						const record: Record<string, SnapshotField> = Object.create(null);
						for (const [key, entry] of Object.entries(field.record)) {
							const saved = await encodeField(entry);
							if (saved) record[key] = saved;
						}
						return { record };
					}
					if (field.pages) {
						if (
							field.pages.length <= 1 &&
							field.pages.every(Array.isArray) &&
							boundedSize((field.pages as SnapshotJson[][]).flat(), 4096) < 4096
						)
							return { value: (field.pages as SnapshotJson[][]).flat() };
						const pages: JsonReference[] = [];
						for (const page of field.pages)
							if (!Array.isArray(page)) pages.push(page);
							else {
								const identity =
									page.length === 1 &&
									page[0] &&
									typeof page[0] === "object" &&
									immutableValues.has(page[0])
										? page[0]
										: undefined;
								const reference =
									(identity && this.immutablePages.get(identity)) ||
									(await this.encode(page));
								if (identity) this.immutablePages.set(identity, reference);
								pages.push(reference);
							}
						if (field.source && field.members)
							committedArrays.set(field.source, {
								directory: this.directory,
								pages,
								members: field.members,
							});
						return {
							pages,
							length: field.length!,
							timestamps: field.timestamps,
							pageSize: field.pageSize,
						};
					}
					const entry = field.json;
					if (entry !== undefined && boundedSize(entry, 4096) < 4096)
						return { value: entry };
					if (entry === undefined) return undefined;
					if (
						entry === null ||
						(typeof entry !== "object" &&
							(typeof entry !== "string" || entry.length < 4096))
					)
						return { value: entry };
					return { reference: await this.encode(entry) };
				};
				const snapshot: JsonSnapshot = {
					format: "bobs-factory-json-snapshot-1",
					summary: savedSummary,
					fields: Object.create(null),
				};
				for (const [key, field] of Object.entries(fields)) {
					const saved = await encodeField(field);
					if (saved) snapshot.fields[key] = saved;
				}

				const temporary = `${path}.${randomUUID()}.tmp`;
				await writeFile(temporary, JSON.stringify(snapshot), {
					encoding: "utf8",
					mode: 0o600,
				});
				await rename(temporary, path);
				for (const name of records) {
					const field = snapshot.fields[name];
					if (
						field &&
						"record" in field &&
						!Object.getOwnPropertyDescriptor(value, name)?.get &&
						value[name] &&
						typeof value[name] === "object"
					)
						this.previews.set(value[name] as object, field.record);
				}
				this.failures.delete(path);
				this.metrics.commits++;
				this.metrics.lastCommitMs = performance.now() - started;
			},
		);
		this.queues.set(
			path,
			commit.catch((error) => {
				this.failures.set(path, error);
			}),
		);
		return commit;
	}
	preview(record: Record<string, unknown>, key: string): unknown {
		const field =
			this.previews.get(record)?.[key] ??
			lazyFields.get(record)?.get(key)?.field;
		if (field && "reference" in field && field.reference.bytes >= 30000) {
			return {
				...(field.reference.preview &&
				typeof field.reference.preview === "object"
					? field.reference.preview
					: {}),
				__artifactPreview: true,
				__artifactHash: field.reference.hash,
				size: field.reference.bytes,
				keys: field.reference.keys ?? [],
				keysTruncated: field.reference.keysTruncated ?? false,
			};
		}
		return record[key];
	}
	async flush(): Promise<void> {
		await Promise.all(this.queues.values());
		if (this.failures.size) throw this.failures.values().next().value;
	}
}
