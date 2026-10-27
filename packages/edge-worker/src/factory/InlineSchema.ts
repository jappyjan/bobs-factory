import { AsyncLocalStorage } from "node:async_hooks";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { executeInlineSchemaJob } from "./InlineSchemaEngine.js";

import {
	INLINE_SCHEMA_LIMITS,
	type InlineSchemaIssue as Issue,
	type InlineSchemaJob as Job,
	type InlineSchemaResult as Result,
} from "./InlineSchemaProtocol.js";

export { INLINE_SCHEMA_LIMITS } from "./InlineSchemaProtocol.js";

const compiled = new Map<string, string[]>();
const asyncBoundary = new AsyncLocalStorage<boolean>();
/** HTTP saves must never fall back to the synchronous compatibility bridge. */
export function withAsyncInlineSchemas<T>(run: () => T): T {
	return asyncBoundary.run(true, run);
}
const usesChild = Boolean(process.versions.bun);
function childArgs(): string[] {
	return import.meta.url.startsWith("file:///$bunfs/")
		? ["internal-schema-validator"]
		: [
				fileURLToPath(
					new URL(
						import.meta.url.endsWith(".ts")
							? "./InlineSchemaChild.ts"
							: "./InlineSchemaChild.js",
						import.meta.url,
					),
				),
				"--inline-schema-child",
			];
}
function childSync(job: Job): Result {
	const result = spawnSync(process.execPath, childArgs(), {
		input: JSON.stringify(job),
		encoding: "utf8",
		timeout: INLINE_SCHEMA_LIMITS.wallMs,
		killSignal: "SIGKILL",
		maxBuffer: INLINE_SCHEMA_LIMITS.responseBytes,
	});
	if (result.error || result.signal || result.status !== 0)
		return limitFailure(
			"Inline JSON Schema child exceeded its wall/resource limit or failed",
			job.validate,
		);
	try {
		return JSON.parse(result.stdout) as Result;
	} catch {
		return limitFailure(
			"Inline JSON Schema child returned an invalid result",
			job.validate,
		);
	}
}
async function childAsync(job: Job, signal?: AbortSignal): Promise<Result> {
	return new Promise<Result>((resolve, reject) => {
		const child = spawn(process.execPath, childArgs(), {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let final: Result | undefined,
			failure: Error | undefined,
			stdout = "",
			bytes = 0,
			stderrBytes = 0,
			probing = false,
			closed = false,
			exited = false,
			submitted = false;
		let unavailable: ReturnType<typeof setTimeout> | undefined;
		let probe: ReturnType<typeof execFile> | undefined;
		const stop = (result?: Result, error?: Error) => {
			if (final || failure || closed) return;
			final = result;
			failure = error;
			child.kill("SIGKILL");
		};
		const cancel = () => stop(undefined, abortReason(signal!));
		const deadline = setTimeout(
			() => stop(limitFailure(deadlineMessage, job.validate)),
			INLINE_SCHEMA_LIMITS.wallMs,
		);
		// Do not send untrusted work until the external watchdog has sampled the
		// live process. Bun can briefly expose zero RSS during exec or retirement,
		// before its exit event reaches this parent. Recheck that lifecycle race
		// for at most 100 ms; a persistently unobservable live child fails closed.
		// The independent wall deadline and the RSS limit remain active throughout.
		const measure = () => {
			if (probing || closed || exited || final || failure || !child.pid) return;
			probing = true;
			probe = execFile(
				"ps",
				["-o", "rss=", "-p", String(child.pid)],
				{ timeout: 500, maxBuffer: 1024 },
				(error, output) => {
					probing = false;
					probe = undefined;
					if (closed || exited || final || failure) return;
					const rss = Number(output.trim()) * 1024;
					if (error || !Number.isFinite(rss) || rss <= 0) {
						unavailable ??= setTimeout(() => {
							unavailable = undefined;
							if (closed || exited) return;
							try {
								process.kill(child.pid!, 0);
							} catch (error) {
								if (
									error instanceof Error &&
									"code" in error &&
									error.code === "ESRCH"
								) {
									// The OS has already reclaimed the process, even if
									// Bun has not delivered exit/close yet. Drain its
									// result under the existing independent wall deadline.
									exited = true;
									clearInterval(memory);
									return;
								}
								// EPERM and other errors cannot establish reclamation.
							}
							stop(
								limitFailure(
									"Inline JSON Schema child memory watchdog unavailable; validation stopped",
									job.validate,
								),
							);
						}, 100);
						return;
					}
					clearTimeout(unavailable);
					unavailable = undefined;
					if (rss > INLINE_SCHEMA_LIMITS.childRssBytes)
						stop(
							limitFailure(
								"Inline JSON Schema child exceeded the 256 MiB RSS limit",
								job.validate,
							),
						);
					else if (!submitted) {
						submitted = true;
						child.stdin.end(JSON.stringify(job));
					}
				},
			);
		};
		const memory = setInterval(measure, 50);
		child.once("spawn", measure);
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > INLINE_SCHEMA_LIMITS.responseBytes)
				stop(
					limitFailure(
						"Inline JSON Schema child exceeded its response limit",
						job.validate,
					),
				);
			else stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderrBytes > INLINE_SCHEMA_LIMITS.responseBytes)
				stop(
					limitFailure(
						"Inline JSON Schema child exceeded its diagnostic limit",
						job.validate,
					),
				);
		});
		child.stdin.on("error", () => {});
		child.once("error", (error) => {
			final = limitFailure(
				`Inline JSON Schema child failed: ${error.message}`,
				job.validate,
			);
		});
		child.once("exit", () => {
			exited = true;
			clearInterval(memory);
			clearTimeout(unavailable);
		});
		child.once("close", (code, exitSignal) => {
			closed = true;
			clearTimeout(deadline);
			clearInterval(memory);
			clearTimeout(unavailable);
			probe?.kill("SIGKILL");
			signal?.removeEventListener("abort", cancel);
			if (failure) {
				reject(failure);
				return;
			}
			if (!final && (code !== 0 || exitSignal))
				final = limitFailure(
					"Inline JSON Schema child exited without a successful result",
					job.validate,
				);
			if (!final) {
				try {
					final = JSON.parse(stdout) as Result;
				} catch {
					final = limitFailure(
						"Inline JSON Schema child exited without a result",
						job.validate,
					);
				}
			}
			resolve(final);
		});
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
	});
}
function worker(
	job: Job,
	response?: { control: SharedArrayBuffer; bytes: SharedArrayBuffer },
) {
	// Only trusted engine source is evaluated. Schemas/results travel as data,
	// never interpolated code. Node resolves Ajv; compiled Bun uses an OS child.
	const source = `const {parentPort,workerData}=require("node:worker_threads");
	const result = (${executeInlineSchemaJob.toString()})(workerData, require(workerData.ajvModule).Ajv, require("node:vm").runInNewContext, ${INLINE_SCHEMA_LIMITS.executionMs});
	if(workerData.response){const control=new Int32Array(workerData.response.control),bytes=new Uint8Array(workerData.response.bytes),encoded=new TextEncoder().encode(JSON.stringify(result));
	if(encoded.length<=bytes.length){bytes.set(encoded);Atomics.store(control,1,encoded.length);Atomics.store(control,0,1);}else Atomics.store(control,0,-1);Atomics.notify(control,0);}
	else parentPort.postMessage(result);parentPort.close();`;
	return new Worker(source, {
		eval: true,
		workerData: {
			...job,
			response,
			ajvModule: createRequire(import.meta.url).resolve("ajv"),
		},
		resourceLimits: {
			maxOldGenerationSizeMb: 96,
			maxYoungGenerationSizeMb: 16,
			stackSizeMb: 2,
		},
	});
}
function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("Inline schema validation cancelled", "AbortError");
}
function limitFailure(message: string, validate = false): Result {
	return {
		schemaIssues: validate ? [] : [message],
		issues: validate ? [{ path: "/", message }] : [],
		resourceFailure: true,
	};
}
const deadlineMessage = `Inline JSON Schema worker exceeded the ${INLINE_SCHEMA_LIMITS.wallMs} ms wall limit`;

/** A bounded compatibility bridge; HTTP and native execution use the async path. */
function executeSync(job: Job): Result {
	if (active >= INLINE_SCHEMA_LIMITS.workers)
		return limitFailure(
			"Inline JSON Schema workers are busy; use asynchronous validation",
			job.validate,
		);
	if (usesChild) return childSync(job);
	const control = new SharedArrayBuffer(8),
		bytes = new SharedArrayBuffer(24 * 1024);
	const handle = worker(job, { control, bytes });
	handle.on("error", () => {}); // Failure is reported by the fixed deadline below.
	try {
		const state = new Int32Array(control);
		if (Atomics.wait(state, 0, 0, INLINE_SCHEMA_LIMITS.wallMs) === "timed-out")
			return limitFailure(deadlineMessage, job.validate);
		if (Atomics.load(state, 0) !== 1)
			return limitFailure(
				"Inline JSON Schema worker exceeded its response limit",
				job.validate,
			);
		return JSON.parse(
			new TextDecoder().decode(
				new Uint8Array(bytes, 0, Atomics.load(state, 1)),
			),
		) as Result;
	} finally {
		void handle.terminate();
	}
}
let active = 0;
const waiting: (() => void)[] = [];
async function execute(job: Job, signal?: AbortSignal): Promise<Result> {
	if (signal?.aborted) throw abortReason(signal);
	if (active >= INLINE_SCHEMA_LIMITS.workers) {
		if (waiting.length >= INLINE_SCHEMA_LIMITS.queued)
			return limitFailure(
				"Inline JSON Schema validation queue is full; try again",
				job.validate,
			);
		await new Promise<void>((resolve, reject) => {
			const start = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
				active++; // Reserve the released slot before resolving the waiter.
				resolve();
			};
			const remove = () => {
				const index = waiting.indexOf(start);
				if (index !== -1) waiting.splice(index, 1);
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
			};
			const cancel = () => {
				remove();
				reject(abortReason(signal!));
			};
			const timer = setTimeout(() => {
				remove();
				reject(
					new Error(
						"Inline JSON Schema validation queue wait exceeded 2000 ms",
					),
				);
			}, INLINE_SCHEMA_LIMITS.wallMs);
			waiting.push(start);
			signal?.addEventListener("abort", cancel, { once: true });
		});
	} else active++;
	try {
		if (signal?.aborted) throw abortReason(signal);
		if (usesChild) return await childAsync(job, signal);
		return await new Promise<Result>((resolve, reject) => {
			const handle = worker(job);
			let finished = false;
			const finish = (result?: Result, error?: Error) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
				void (async () => {
					try {
						await handle.terminate();
					} catch {
						// An already exited worker has no resources left to reclaim.
					} finally {
						if (error) reject(error);
						else resolve(result!);
					}
				})();
			};
			const cancel = () => finish(undefined, abortReason(signal!));
			const timer = setTimeout(
				() => finish(limitFailure(deadlineMessage, job.validate)),
				INLINE_SCHEMA_LIMITS.wallMs,
			);
			handle.once("message", (result: Result) => finish(result));
			handle.once("error", (error) =>
				finish(
					limitFailure(
						`Inline JSON Schema worker failed within its resource limits: ${error.message}`,
						job.validate,
					),
				),
			);
			handle.once("exit", (code) => {
				if (!finished)
					finish(
						limitFailure(
							`Inline JSON Schema worker exited before returning a result (${code})`,
							job.validate,
						),
					);
			});
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
		});
	} finally {
		active--;
		waiting.shift()?.();
	}
}
function remember(schema: Record<string, unknown>, result: Result) {
	if (result.resourceFailure) return;
	const key = JSON.stringify(schema);
	if (compiled.size >= 64) compiled.delete(compiled.keys().next().value!);
	compiled.set(key, result.schemaIssues);
}

/** Reject known exponential regex forms; remaining evaluation still has a hard deadline. */
function unsafePattern(pattern: string): boolean {
	const groups: { repeat: boolean; alternation: boolean }[] = [
		{ repeat: false, alternation: false },
	];
	let closed: { repeat: boolean; alternation: boolean } | undefined;
	for (let i = 0; i < pattern.length; i++) {
		const token = pattern[i]!;
		if (token === "\\") {
			if (/[1-9k]/.test(pattern[++i] ?? "")) return true;
			closed = undefined;
			continue;
		}
		if (token === "[") {
			for (++i; i < pattern.length; i++) {
				if (pattern[i] === "\\") i++;
				else if (pattern[i] === "]") break;
			}
			closed = undefined;
			continue;
		}
		if (token === "(") {
			if (pattern[i + 1] === "?" && pattern[i + 2] !== ":") return true;
			groups.push({ repeat: false, alternation: false });
			closed = undefined;
		} else if (token === ")") {
			closed = groups.pop();
			if (!groups.length) groups.push({ repeat: false, alternation: false });
			groups.at(-1)!.repeat ||= closed?.repeat ?? false;
			groups.at(-1)!.alternation ||= closed?.alternation ?? false;
		} else if (token === "|") {
			groups.at(-1)!.alternation = true;
			closed = undefined;
		} else if (token === "+" || token === "*" || token === "{") {
			if (closed?.repeat || closed?.alternation) return true;
			groups.at(-1)!.repeat = true;
			closed = undefined;
		} else if (token !== "?") closed = undefined;
	}
	return false;
}
const maps = new Set([
	"properties",
	"patternProperties",
	"definitions",
	"$defs",
]);
const singles = new Set([
	"additionalProperties",
	"additionalItems",
	"contains",
	"propertyNames",
	"if",
	"then",
	"else",
	"not",
]);
const arrays = new Set(["allOf", "anyOf", "oneOf"]);
const encode = (value: string) =>
	value.replaceAll("~", "~0").replaceAll("/", "~1");
/** Linear, bounded preflight only. Ajv compilation never runs on the caller thread. */
export function inlineSchemaPreflight(
	schema: Record<string, unknown>,
): string[] {
	const issues: string[] = [],
		pending: { value: unknown; path: string; depth: number }[] = [
			{ value: schema, path: "", depth: 0 },
		];
	const seen = new Set<object>();
	let count = 0,
		size = 0;
	while (pending.length) {
		const { value, path, depth } = pending.pop()!;
		if (++count > 10_000 || depth > INLINE_SCHEMA_LIMITS.depth)
			return [
				"Inline JSON Schema nesting/complexity limit exceeded (40 levels, 10000 JSON values)",
			];
		if (typeof value === "string") size += Buffer.byteLength(value) + 2;
		else if (value && typeof value === "object") {
			if (seen.has(value))
				return ["Inline JSON Schemas must be acyclic JSON data"];
			seen.add(value);
			for (const [key, child] of Object.entries(value)) {
				size += Buffer.byteLength(key) + 4;
				pending.push({
					value: child,
					path: `${path}/${encode(key)}`,
					depth: depth + 1,
				});
			}
		}
		if (size > INLINE_SCHEMA_LIMITS.schemaBytes)
			return ["Inline JSON Schemas are limited to 64 KiB"];
	}
	if (
		Buffer.byteLength(JSON.stringify(schema)) > INLINE_SCHEMA_LIMITS.schemaBytes
	)
		return ["Inline JSON Schemas are limited to 64 KiB"];
	const nodes = new Map<
		string,
		{ value: Record<string, unknown> | boolean; children: string[] }
	>();
	const visit = (value: unknown, path: string): void => {
		if (
			typeof value !== "boolean" &&
			(!value || typeof value !== "object" || Array.isArray(value))
		)
			return;
		if (nodes.size >= INLINE_SCHEMA_LIMITS.schemaNodes) {
			issues.push("Inline JSON Schemas are limited to 512 schema nodes");
			return;
		}
		const children: string[] = [];
		if (typeof value === "boolean") {
			nodes.set(path, { value, children });
			return;
		}
		const object = value as Record<string, unknown>;
		nodes.set(path, { value: object, children });
		const child = (entry: unknown, pointer: string) => {
			if (
				typeof entry === "boolean" ||
				(entry && typeof entry === "object" && !Array.isArray(entry))
			) {
				children.push(pointer);
				visit(entry, pointer);
			}
		};
		for (const [key, item] of Object.entries(object)) {
			const pointer = `${path}/${encode(key)}`;
			if (key === "$async" && item !== false)
				issues.push(`${path}/$async: asynchronous schemas are not supported`);
			if (key === "$id")
				issues.push(
					`${pointer}: nested/custom schema IDs are not supported; use local JSON Pointer references`,
				);
			if (
				key === "$ref" &&
				typeof item === "string" &&
				item !== "#" &&
				!item.startsWith("#/")
			)
				issues.push(`${path}/$ref: only local references (#/...) are allowed`);
			const patterns =
				key === "pattern" && typeof item === "string"
					? [item]
					: key === "patternProperties" && item && typeof item === "object"
						? Object.keys(item)
						: [];
			for (const pattern of patterns) {
				if (pattern.length > INLINE_SCHEMA_LIMITS.patternLength)
					issues.push(`${pointer}: patterns are limited to 512 characters`);
				else if (unsafePattern(pattern))
					issues.push(
						`${pointer}: unsafe pattern; nested repetition, repeated alternatives, lookarounds and backreferences are not supported`,
					);
			}
			if (
				maps.has(key) &&
				item &&
				typeof item === "object" &&
				!Array.isArray(item)
			)
				for (const [name, entry] of Object.entries(item))
					child(entry, `${pointer}/${encode(name)}`);
			else if (singles.has(key)) child(item, pointer);
			else if (arrays.has(key) && Array.isArray(item))
				item.forEach((entry, index) => {
					child(entry, `${pointer}/${index}`);
				});
			else if (key === "items") {
				if (Array.isArray(item))
					item.forEach((entry, index) => {
						child(entry, `${pointer}/${index}`);
					});
				else child(item, pointer);
			} else if (key === "dependencies" && item && typeof item === "object")
				for (const [name, entry] of Object.entries(item))
					child(entry, `${pointer}/${encode(name)}`);
		}
	};
	visit(schema, "");
	for (const [path, node] of nodes) {
		const ref = typeof node.value === "object" ? node.value.$ref : undefined;
		if (typeof ref !== "string" || (ref !== "#" && !ref.startsWith("#/")))
			continue;
		let target: string;
		try {
			target = decodeURIComponent(ref.slice(1));
		} catch {
			issues.push(`${path}/$ref: invalid local JSON Pointer reference`);
			continue;
		}
		if (!nodes.has(target))
			issues.push(
				`${path}/$ref: reference must resolve to an object schema in this document`,
			);
		else node.children.push(target);
	}
	const done = new Set<string>(),
		active = new Set<string>();
	const check = (path: string): boolean => {
		if (active.has(path)) return false;
		if (done.has(path)) return true;
		active.add(path);
		for (const child of nodes.get(path)?.children ?? [])
			if (!check(child)) return false;
		active.delete(path);
		done.add(path);
		return true;
	};
	for (const path of nodes.keys())
		if (!check(path)) {
			issues.push("Inline JSON Schema reference cycles are not supported");
			break;
		}
	return issues;
}
function dataIssues(value: unknown): Issue[] {
	const pending = [{ value, depth: 0 }];
	let count = 0,
		bytes = 0;
	const seen = new Set<object>();
	while (pending.length) {
		const item = pending.pop()!;
		if (++count > INLINE_SCHEMA_LIMITS.dataNodes || item.depth > 64)
			return [
				{
					path: "/",
					message:
						"Inline JSON Schema output exceeds 20000 values or 64 levels",
				},
			];
		if (typeof item.value === "string") bytes += Buffer.byteLength(item.value);
		else if (item.value && typeof item.value === "object") {
			if (seen.has(item.value))
				return [
					{
						path: "/",
						message: "Inline JSON Schema output must be acyclic JSON data",
					},
				];
			seen.add(item.value);
			for (const [key, child] of Object.entries(item.value)) {
				bytes += Buffer.byteLength(key) + 4;
				pending.push({ value: child, depth: item.depth + 1 });
			}
		}
		if (bytes > INLINE_SCHEMA_LIMITS.dataBytes)
			return [
				{
					path: "/",
					message: "Inline JSON Schema output is limited to 256 KiB",
				},
			];
	}
	if (
		Buffer.byteLength(JSON.stringify(value) ?? "null") >
		INLINE_SCHEMA_LIMITS.dataBytes
	)
		return [
			{ path: "/", message: "Inline JSON Schema output is limited to 256 KiB" },
		];
	return [];
}
function compileSchemaSync(
	schema: Record<string, unknown>,
	trusted: boolean,
): string[] {
	const preflight = inlineSchemaPreflight(schema);
	if (preflight.length) return preflight;
	const cached = compiled.get(JSON.stringify(schema));
	if (cached) return cached;
	if (asyncBoundary.getStore())
		return [
			"Inline JSON Schema compilation result expired; retry the save request",
		];
	const job = { schema, validate: false };
	const result = trusted ? executeInlineSchemaJob(job) : executeSync(job);
	remember(schema, result);
	return result.schemaIssues;
}
export function compileInlineSchemaSync(
	schema: Record<string, unknown>,
): string[] {
	return compileSchemaSync(schema, false);
}
/** Only for constants defined by bundled code, never saved or request data.
 * Validate with the same preflight/Ajv engine and warm the content-keyed cache
 * without spawning a process per trusted schema. User-authored compilation and
 * every output validation retain their isolated resource boundaries. */
export function compileTrustedInlineSchemaSync(
	schema: Record<string, unknown>,
): string[] {
	return compileSchemaSync(schema, true);
}
export async function compileInlineSchema(
	schema: Record<string, unknown>,
	options: { signal?: AbortSignal } = {},
): Promise<string[]> {
	if (options.signal?.aborted) throw abortReason(options.signal);
	const preflight = inlineSchemaPreflight(schema);
	if (preflight.length) return preflight;
	const cached = compiled.get(JSON.stringify(schema));
	if (cached) return cached;
	const result = await execute({ schema, validate: false }, options.signal);
	remember(schema, result);
	return result.schemaIssues;
}
export function validateInlineSchemaSync(
	schema: Record<string, unknown>,
	value: unknown,
): Result {
	const schemaIssues = inlineSchemaPreflight(schema);
	if (schemaIssues.length) return { schemaIssues, issues: [] };
	const issues = dataIssues(value);
	return issues.length
		? { schemaIssues: [], issues }
		: executeSync({ schema, value, validate: true });
}
export async function validateInlineSchema(
	schema: Record<string, unknown>,
	value: unknown,
	signal?: AbortSignal,
): Promise<Result> {
	const schemaIssues = inlineSchemaPreflight(schema);
	if (schemaIssues.length) return { schemaIssues, issues: [] };
	const issues = dataIssues(value);
	return issues.length
		? { schemaIssues: [], issues }
		: execute({ schema, value, validate: true }, signal);
}
