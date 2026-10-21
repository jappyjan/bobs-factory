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
export const foreachFields = {
	items: z
		.unknown()
		.superRefine((value, context) => {
			if (value && typeof value === "object")
				for (const name of ["values", "from"]) {
					const descriptor = Object.getOwnPropertyDescriptor(value, name);
					if (descriptor && !("value" in descriptor))
						context.addIssue({
							code: "custom",
							message: "For each sources must be JSON data without accessors",
						});
				}
		})
		.pipe(
			z.union([
				z
					.object({ from: foreachPointerSchema.refine((s) => s.length > 0) })
					.strict(),
				z
					.object({
						values: z
							.custom<unknown[]>(
								(value) => Array.isArray(value),
								"Expected an item array",
							)
							.superRefine((value, context) => {
								if (value.length > 1000) {
									context.addIssue({
										code: "custom",
										message: "For each allows at most 1000 items",
									});
									return;
								}
								try {
									validateItems(value);
								} catch (error) {
									context.addIssue({
										code: "custom",
										message:
											error instanceof Error ? error.message : String(error),
									});
								}
							}),
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
export const ForeachSettingsSchema = z.object(foreachFields);
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
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if (!("value" in descriptor))
			throw new Error("For each sources must be JSON data without accessors");
		value = descriptor.value;
	}
	return value;
}
export function foreachScope(scope: ForeachScope): Record<string, unknown> {
	return {
		...scope.outputs,
		inputs: scope.inputs ?? {},
		item: scope.item,
		index: scope.index,
	};
}

/** Bound before cloning/stringification; the accepted collection is never truncated. */
function validateItems(value: unknown): void {
	const active = new Set<object>();
	let nodes = 0,
		characters = 0;
	function visit(value: unknown, depth: number): void {
		if (++nodes > 100_000 || depth > 32 || characters > 1_000_000)
			throw new Error(
				"For each item snapshot exceeds its data complexity limit",
			);
		if (typeof value === "string") {
			characters += value.length;
			if (characters > 1_000_000)
				throw new Error(
					"For each item snapshot exceeds its data complexity limit",
				);
			return;
		}
		if (
			value === null ||
			typeof value === "boolean" ||
			(typeof value === "number" && Number.isFinite(value))
		)
			return;
		if (!value || typeof value !== "object")
			throw new Error("For each items must be JSON data");
		if (active.has(value))
			throw new Error("For each items must be acyclic JSON data");
		const prototype = Object.getPrototypeOf(value);
		if (
			prototype !== null &&
			prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)
		)
			throw new Error("For each items must be plain JSON objects");
		active.add(value);
		if (Array.isArray(value) && value.length > 100_000)
			throw new Error(
				"For each item snapshot exceeds its data complexity limit",
			);
		for (const key of Object.keys(value)) {
			if (unsafe.has(key))
				throw new Error(`For each item contains unsafe key ${key}`);
			characters += key.length;
			if (characters > 1_000_000)
				throw new Error(
					"For each item snapshot exceeds its data complexity limit",
				);
			const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
			if (!("value" in descriptor))
				throw new Error("For each items must be JSON data without accessors");
			visit(descriptor.value, depth + 1);
		}
		if (Array.isArray(value) && Object.keys(value).length !== value.length)
			throw new Error("For each items cannot contain sparse arrays");
		active.delete(value);
	}
	visit(value, 0);
	if (new TextEncoder().encode(JSON.stringify(value)).length > 1_048_576)
		throw new Error("For each item snapshot exceeds 1 MiB");
}

/** Shared by native dispatch and the builder simulator. No dispatch occurs before this succeeds. */
export function prepareForeach(
	step: unknown,
	scope: ForeachScope,
): ForeachSnapshot {
	// Inspect descriptors before Zod can read inline recipe fields or array indices.
	if (step && typeof step === "object") {
		for (const name of Object.keys(foreachFields)) {
			const descriptor = Object.getOwnPropertyDescriptor(step, name);
			if (descriptor && !("value" in descriptor))
				throw new Error(
					"For each settings must be JSON data without accessors",
				);
		}
		const items = Object.getOwnPropertyDescriptor(step, "items")?.value;
		if (items && typeof items === "object")
			for (const name of ["values", "from"]) {
				const descriptor = Object.getOwnPropertyDescriptor(items, name);
				if (descriptor && !("value" in descriptor))
					throw new Error(
						"For each sources must be JSON data without accessors",
					);
			}
	}
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
	validateItems(values);
	const ids = new Set<string>();
	const items = values.map((value, index) => {
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
