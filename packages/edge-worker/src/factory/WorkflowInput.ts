import { isImmutableJson, retainSnapshotEntry } from "bobs-factory-core";

const historyRanges = new WeakMap<
	object,
	{ source: unknown[]; start: number; end: number }
>();

function sameHistoryJson(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object")
		return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	if (Array.isArray(left) && left.length !== (right as unknown[]).length)
		return false;
	if (
		!Array.isArray(left) &&
		Object.getPrototypeOf(left) !== null &&
		Object.getPrototypeOf(left) !== Object.prototype
	)
		return false;
	const keys = Object.keys(left),
		other = Object.keys(right);
	return (
		keys.length === other.length &&
		keys.every(
			(key, i) =>
				key === other[i] &&
				sameHistoryJson(
					(left as Record<string, unknown>)[key],
					(right as Record<string, unknown>)[key],
				),
		)
	);
}

const detachedRanges = new WeakMap<
	object,
	{ source: unknown[]; start: number; end: number }
>();

/** Preserve detached native reads; a modified copy cannot borrow its source's identity. */
export function detachedWorkflowRead<T>(value: T): T {
	const copy = structuredClone(value);
	if (value && typeof value === "object" && copy && typeof copy === "object") {
		const range = historySnapshotRange(value);
		if (range) detachedRanges.set(copy, range);
	}
	return copy;
}

/** Runtime-owned provenance, never inferred from role JSON or matching payloads. */
export function historySnapshotRange(value: object) {
	const native = historyRanges.get(value);
	if (native) return native;
	const detached = detachedRanges.get(value);
	// Compare complete declared values, without serializing them or trusting a
	// digest supplied by an agent. Keep altered copies inline in the baseline.
	return detached &&
		sameHistoryJson(
			value,
			snapshotHistory(detached.source, detached.start, detached.end),
		)
		? detached
		: undefined;
}

/** Copy mutable JSON structure while sharing published, deeply frozen receipts. */
export function snapshotWorkflowInput<T>(
	value: T,
	seen = new Map<object, unknown>(),
): T {
	if (!value || typeof value !== "object" || isImmutableJson(value))
		return value;
	if (Array.isArray(value) && historyRanges.has(value))
		return snapshotHistory(value) as T;
	if (seen.has(value)) return seen.get(value) as T;
	if (value instanceof Date) return new Date(value.getTime()) as T;
	const result: Record<string, unknown> | unknown[] = Array.isArray(value)
		? new Array(value.length)
		: {};
	seen.set(value, result);
	const range = historyRanges.get(value);
	if (range) historyRanges.set(result, range);
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
	const parent = historyRanges.get(history);
	if (!project)
		historyRanges.set(
			snapshot,
			parent
				? {
						source: parent.source,
						start: parent.start + offset,
						end: parent.start + limit,
					}
				: { source: history, start: offset, end: limit },
		);
	for (let index = offset; index < limit; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(history, index);
		if (!descriptor) continue;
		if (descriptor.get || project) {
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
			if (!project)
				retainSnapshotEntry(
					history,
					String(index),
					snapshot,
					String(index - offset),
				);
		} else snapshot[index - offset] = snapshotWorkflowInput(descriptor.value);
	}
	return snapshot;
}
