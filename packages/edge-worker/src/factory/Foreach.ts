import { z } from "zod";

const unsafe = new Set(["__proto__", "prototype", "constructor"]);
export const foreachPointerSchema = z
	.string()
	.max(400)
	.refine(
		(path) =>
			(path === "" || path.startsWith("/")) &&
			path
				.split("/")
				.slice(1)
				.every(
					(part) =>
						!/~(?![01])/.test(part) &&
						!unsafe.has(part.replace(/~1/g, "/").replace(/~0/g, "~")) &&
						part !== "*",
				),
		"Expected a safe JSON Pointer without wildcards",
	);
/** Inspect every own descriptor before reading any supplied property value. */
function jsonDescriptors(value: object): PropertyDescriptorMap {
	const array = Array.isArray(value);
	const prototype = Object.getPrototypeOf(value);
	if (
		prototype !== null &&
		prototype !== (array ? Array.prototype : Object.prototype)
	)
		throw new Error("For each items must be plain JSON objects");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length > 100_001)
		throw new Error("For each item snapshot exceeds its data complexity limit");
	for (const key of keys) {
		if (typeof key !== "string")
			throw new Error("For each JSON data cannot contain symbol properties");
		if (unsafe.has(key))
			throw new Error(`For each item contains unsafe key ${key}`);
		const descriptor = descriptors[key]!;
		if (!("value" in descriptor))
			throw new Error("For each sources must be JSON data without accessors");
		if (!descriptor.enumerable && !(array && key === "length"))
			throw new Error(
				"For each JSON data cannot contain non-enumerable properties",
			);
	}
	return descriptors;
}

/** Build data with no inherited hooks before serialization or structured cloning. */
function sanitizeItems(value: unknown): unknown {
	const active = new Set<object>();
	let nodes = 0,
		characters = 0;
	const charge = (count: number) => {
		characters += count;
		if (characters > 1_000_000)
			throw new Error(
				"For each item snapshot exceeds its data complexity limit",
			);
	};
	function visit(value: unknown, depth: number): unknown {
		if (++nodes > 100_000 || depth > 32)
			throw new Error(
				"For each item snapshot exceeds its data complexity limit",
			);
		if (typeof value === "string") {
			charge(value.length);
			return value;
		}
		if (
			value === null ||
			typeof value === "boolean" ||
			(typeof value === "number" && Number.isFinite(value))
		)
			return value;
		if (!value || typeof value !== "object")
			throw new Error("For each items must be JSON data");
		if (active.has(value))
			throw new Error("For each items must be acyclic JSON data");
		const descriptors = jsonDescriptors(value);
		active.add(value);
		let result: unknown;
		if (Array.isArray(value)) {
			const length = descriptors.length!.value as number;
			if (length > 100_000)
				throw new Error(
					"For each item snapshot exceeds its data complexity limit",
				);
			for (let index = 0; index < length; index++)
				if (!Object.hasOwn(descriptors, String(index)))
					throw new Error("For each items cannot contain sparse arrays");
			if (Reflect.ownKeys(descriptors).length !== length + 1)
				throw new Error("For each JSON arrays cannot contain extra properties");
			const array: unknown[] = [];
			Object.setPrototypeOf(array, null);
			for (let index = 0; index < length; index++) {
				charge(String(index).length);
				array[index] = visit(descriptors[String(index)]!.value, depth + 1);
			}
			result = array;
		} else {
			const object: Record<string, unknown> = Object.create(null);
			for (const key of Object.keys(descriptors)) {
				charge(key.length);
				object[key] = visit(descriptors[key]!.value, depth + 1);
			}
			result = object;
		}
		active.delete(value);
		return result;
	}
	const sanitized = visit(value, 0);
	if (new TextEncoder().encode(JSON.stringify(sanitized)).length > 1_048_576)
		throw new Error("For each item snapshot exceeds 1 MiB");
	// Restore ordinary JSON collection interfaces only after the hook-free copy
	// has passed validation and serialization. Never clone caller-owned objects.
	return structuredClone(sanitized);
}

function sanitizeSource(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("For each sources must be plain JSON objects");
	const descriptors = jsonDescriptors(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Object.keys(descriptors)) {
		const supplied = descriptors[key]!.value;
		if (key === "values" && Array.isArray(supplied)) {
			const length = Object.getOwnPropertyDescriptor(supplied, "length")!
				.value as number;
			if (length > 1000) throw new Error("For each allows at most 1000 items");
		}
		result[key] = sanitizeItems(supplied);
	}
	return result;
}

const settingNames = [
	"items",
	"itemId",
	"concurrency",
	"maxItems",
	"failure",
] as const;
function ownSettings(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("For each settings must be plain JSON objects");
	const descriptors = jsonDescriptors(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const name of settingNames) {
		const descriptor = descriptors[name];
		if (!descriptor) continue;
		// The workflow owns other fields, including optional undefined config. Only
		// the relevant settings are sanitized; defaults still accept undefined.
		result[name] =
			descriptor.value === undefined
				? undefined
				: name === "items"
					? sanitizeSource(descriptor.value)
					: sanitizeItems(descriptor.value);
	}
	return result;
}
function safePreprocess(sanitize: (value: unknown) => unknown) {
	return (value: unknown, context: z.RefinementCtx) => {
		try {
			return sanitize(value);
		} catch (error) {
			context.addIssue({
				code: "custom",
				message:
					error instanceof Error ? error.message : "Invalid For each JSON data",
			});
			return z.NEVER;
		}
	};
}
export const foreachFields = {
	items: z.preprocess(
		safePreprocess(sanitizeSource),
		z.union([
			z
				.object({ from: foreachPointerSchema.refine((s) => s.length > 0) })
				.strict(),
			z
				.object({
					values: z.custom<unknown[]>(
						(value) => Array.isArray(value),
						"Expected an item array",
					),
				})
				.strict(),
		]),
	),
	itemId: foreachPointerSchema.default("/id"),
	concurrency: z.number().int().min(1).max(32).default(4),
	maxItems: z.number().int().min(1).max(1000).default(100),
	failure: z
		.enum(["all-must-succeed", "keep-successful"])
		.default("all-must-succeed"),
};
export const ForeachSettingsSchema = z.preprocess(
	safePreprocess(ownSettings),
	z.object(foreachFields),
);
export type ForeachSettings = z.infer<typeof ForeachSettingsSchema>;
export interface ForeachScope {
	outputs: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	item?: unknown;
	index?: number;
}
export interface ForeachItem {
	id: string;
	index: number;
	value: unknown;
}
export interface ForeachSnapshot extends Omit<ForeachSettings, "items"> {
	items: ForeachItem[];
}
export interface ForeachItemState {
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	result?: Record<string, unknown>;
	error?: string;
}
export interface ForeachProgress {
	key: string;
	visit: number;
	concurrency: number;
	maxItems: number;
	failure: ForeachSettings["failure"];
	items: (Omit<ForeachItem, "value"> & Omit<ForeachItemState, "result">)[];
	completed: number;
	failed: number;
	total: number;
}

/** Own-property JSON Pointer traversal; no prototype, wildcard or expression evaluation. */
export function foreachPointer(root: unknown, path: string): unknown {
	foreachPointerSchema.parse(path);
	let value = root;
	for (const part of path === "" ? [] : path.slice(1).split("/")) {
		const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
			throw new Error(
				`For each path ${JSON.stringify(path)} does not resolve (missing ${JSON.stringify(key)})`,
			);
		const descriptors = jsonDescriptors(value);
		value = descriptors[key]!.value;
	}
	if (value && typeof value === "object") jsonDescriptors(value);
	return value;
}
export function foreachScope(scope: ForeachScope): Record<string, unknown> {
	const descriptors = jsonDescriptors(scope);
	const outputs = descriptors.outputs?.value;
	if (!outputs || typeof outputs !== "object" || Array.isArray(outputs))
		throw new Error("For each outputs must be plain JSON objects");
	const outputDescriptors = jsonDescriptors(outputs);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Object.keys(outputDescriptors))
		result[key] = outputDescriptors[key]!.value;
	result.inputs = descriptors.inputs?.value ?? Object.create(null);
	result.item = descriptors.item?.value;
	result.index = descriptors.index?.value;
	return result;
}

/** Shared by native dispatch and the builder simulator. No dispatch occurs before this succeeds. */
export function prepareForeach(
	step: unknown,
	scope: ForeachScope,
): ForeachSnapshot {
	const settings = ForeachSettingsSchema.parse(step);
	const values =
		"values" in settings.items
			? settings.items.values
			: foreachPointer(foreachScope(scope), settings.items.from);
	if (!Array.isArray(values))
		throw new Error("For each items path must resolve to an array");
	if (values.length > settings.maxItems)
		throw new Error(
			`For each has ${values.length} items, exceeding maxItems ${settings.maxItems}; no items were dispatched`,
		);
	const sanitized = sanitizeItems(values) as unknown[];
	const ids = new Set<string>();
	const items = Array.from(sanitized, (value, index) => {
		const id = foreachPointer(value, settings.itemId);
		if (
			typeof id !== "string" ||
			!/^[A-Za-z0-9_-]{1,80}$/.test(id) ||
			unsafe.has(id)
		)
			throw new Error(
				`For each item ${index} needs a safe string ID at ${JSON.stringify(settings.itemId)}`,
			);
		if (ids.has(id)) throw new Error(`For each duplicate item ID: ${id}`);
		ids.add(id);
		return { id, index, value: structuredClone(value) };
	});
	return {
		items,
		itemId: settings.itemId,
		concurrency: settings.concurrency,
		maxItems: settings.maxItems,
		failure: settings.failure,
	};
}

/** Stable accepted order, independent of completion order and object prototype names. */
export function aggregateForeach(
	snapshot: ForeachSnapshot,
	states: ForeachItemState[],
) {
	if (
		states.length !== snapshot.items.length ||
		states.some(
			(s) =>
				!["completed", "failed", "cancelled"].includes(s.status) ||
				(s.status === "completed" &&
					(!s.result ||
						typeof s.result !== "object" ||
						Array.isArray(s.result))),
		)
	)
		throw new Error("For each cannot aggregate unfinished items");
	const results = Object.fromEntries(
		snapshot.items.flatMap((item, i) =>
			states[i]!.status === "completed"
				? [[item.id, structuredClone(states[i]!.result ?? {})]]
				: [],
		),
	);
	const failures = snapshot.items.flatMap((item, i) =>
		states[i]!.status !== "completed"
			? [
					{
						id: item.id,
						index: item.index,
						status: states[i]!.status,
						error: states[i]!.error ?? "Item did not complete",
					},
				]
			: [],
	);
	return {
		results,
		summary: {
			total: snapshot.items.length,
			completed: snapshot.items.length - failures.length,
			failed: states.filter((s) => s.status === "failed").length,
			cancelled: states.filter((s) => s.status === "cancelled").length,
			failures,
			limitations: failures.map((f) => `${f.id}: ${f.error}`),
		},
	};
}
