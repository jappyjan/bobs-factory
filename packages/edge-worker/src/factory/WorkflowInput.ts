import { isImmutableJson } from "bobs-factory-core";

/** Copy mutable JSON structure while sharing published, deeply frozen receipts. */
export function snapshotWorkflowInput<T>(
	value: T,
	seen = new Map<object, unknown>(),
): T {
	if (!value || typeof value !== "object" || isImmutableJson(value))
		return value;
	if (seen.has(value)) return seen.get(value) as T;
	if (value instanceof Date) return new Date(value.getTime()) as T;
	const result: Record<string, unknown> | unknown[] = Array.isArray(value)
		? new Array(value.length)
		: {};
	seen.set(value, result);
	for (const key of Object.keys(value)) {
		Object.defineProperty(result, key, {
			value: snapshotWorkflowInput(
				(value as Record<string, unknown>)[key],
				seen,
			),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return result as T;
}

/** Retain an exact history cutoff without retaining every lazily decoded page. */
export function snapshotHistory<T>(
	history: T[],
	start = 0,
	end = history.length,
	project?: (entry: T) => T,
): T[] {
	const limit = Math.max(0, Math.min(end, history.length));
	const offset = Math.max(0, Math.min(start, limit));
	const snapshot = new Array<T>(limit - offset);
	for (let index = offset; index < limit; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(history, index);
		if (!descriptor) continue;
		if (descriptor.get || project)
			Object.defineProperty(snapshot, index - offset, {
				enumerable: true,
				configurable: true,
				// History entries are immutable. Let the source store's bounded cache
				// serve them again instead of caching every old receipt in this input.
				get: () => {
					const entry = descriptor.get
						? descriptor.get.call(history)
						: descriptor.value;
					return project ? project(entry) : entry;
				},
			});
		else snapshot[index - offset] = snapshotWorkflowInput(descriptor.value);
	}
	return snapshot;
}
