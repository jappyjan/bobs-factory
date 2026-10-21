import type { Dir } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
	publishStorageJson,
	readStorageJson,
	type StorageIdentity,
	type StorageRecord,
	sameStorageIdentity,
} from "bobs-factory-core";

interface UsageState {
	identity: StorageIdentity;
	bytes: number;
	stack: { path: string; read: number }[];
	observedAt?: string;
}
/** Streaming advisory measurement. Open iterators survive slices; a restart
 * replays directory positions under the same entry/time bounds before advancing. */
export class StorageUsage {
	private states = new Map<string, UsageState>();
	private handles = new Map<string, { directory: Dir; read: number }>();
	constructor(private readonly directory: string) {}
	async step(
		record: StorageRecord,
		signal: AbortSignal,
		bounds: { maxEntries?: number; deadline?: number } = {},
	) {
		const file = join(this.directory, "usage", `${record.id}.json`);
		let state = this.states.get(record.id);
		if (!state) {
			const saved = (await readStorageJson(file)) as UsageState | undefined;
			state =
				saved && sameStorageIdentity(saved.identity, record.identity)
					? saved
					: {
							identity: record.identity,
							bytes: 0,
							stack: [{ path: "", read: 0 }],
						};
			this.states.set(record.id, state);
		}
		let entries = 0;
		const started = performance.now();
		while (
			state.stack.length &&
			entries < Math.max(0, (bounds.maxEntries ?? 1000) - 3) &&
			performance.now() < (bounds.deadline ?? started + 1000)
		) {
			signal.throwIfAborted();
			const frame = state.stack.at(-1)!,
				path = join(record.path, frame.path);
			const suffix = relative(record.path, path);
			if (
				suffix === ".." ||
				suffix.startsWith(`..${sep}`) ||
				suffix.startsWith("/")
			)
				throw new Error("Usage cursor escapes its owned directory");
			const key = `${record.id}:${frame.path}`;
			let handle = this.handles.get(key);
			if (!handle) {
				const stat = await lstat(path);
				entries++;
				if (!stat.isDirectory() || stat.isSymbolicLink())
					throw new Error("Usage directory changed during scan");
				handle = { directory: await opendir(path), read: 0 };
				this.handles.set(key, handle);
			}
			const entry = await handle.directory.read();
			entries++;
			if (!entry) {
				await handle.directory.close();
				this.handles.delete(key);
				state.stack.pop();
				continue;
			}
			handle.read++;
			if (handle.read <= frame.read) continue;
			frame.read++;
			const child = join(path, entry.name),
				stat = await lstat(child);
			entries++;
			if (stat.isDirectory() && !stat.isSymbolicLink())
				state.stack.push({ path: relative(record.path, child), read: 0 });
			else state.bytes += stat.size;
		}
		if (!state.stack.length) state.observedAt ??= new Date().toISOString();
		await publishStorageJson(file, state);
		return {
			complete: !state.stack.length,
			apparentBytes: state.stack.length ? undefined : state.bytes,
			usageObservedAt: state.observedAt,
			entries,
		};
	}
	async close() {
		await Promise.allSettled(
			[...this.handles.values()].map((handle) => handle.directory.close()),
		);
		this.handles.clear();
	}
}
