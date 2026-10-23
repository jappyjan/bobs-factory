import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	immutableJson,
	immutableTranscript,
	JsonSnapshotStore,
	snapshotEntryIdentity,
} from "../src/JsonSnapshotStore.js";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "factory-json-snapshot-"));
	directories.push(directory);
	return {
		store: new JsonSnapshotStore(join(directory, "chunks")),
		path: join(directory, "state.json"),
		directory,
	};
}

it("captures ordered revisions without copying large strings or losing subsequent edits", async () => {
	const { store, path } = await fixture();
	const value = {
		status: "waiting",
		outputs: { result: { text: '雪"\\\n'.repeat(10000) } },
		entries: [{ content: "first" }],
	};
	const first = store.write(path, value, {}, ["outputs"]);
	value.status = "running";
	value.outputs.result.text = "changed";
	value.entries.push({ content: "second" });
	const second = store.write(path, value, {}, ["outputs"]);
	await first;
	expect(store.load<typeof value>(path).value.status).toBe("waiting");
	await second;
	expect(store.load<typeof value>(path).value).toEqual(value);
});

it("reuses unchanged payloads and reads only the selected transcript page after restart", async () => {
	const { store, path, directory } = await fixture();
	const entries = Array.from({ length: 192 }, (_, index) => ({
		content: `entry-${index}-${"x".repeat(16384)}`,
	}));
	await store.write(path, { entries, status: "waiting" });
	const chunks = store.metrics.chunksWritten;
	await store.write(path, { entries, status: "running" });
	expect(store.metrics.chunksWritten).toBe(chunks);
	const snapshot = JSON.parse(await readFile(path, "utf8"));
	const oldPage = snapshot.fields.entries.pages[0].chunks[0];
	// A cold, unrelated page must not be read while viewing or appending the tail.
	await rm(join(directory, "chunks", `${oldPage}.json`));
	const restored = new JsonSnapshotStore(join(directory, "chunks"));
	const value = restored.load<{ entries: typeof entries; status: string }>(
		path,
	).value;
	expect(value.entries.slice(-1)).toEqual(entries.slice(-1));
	value.entries.push({ content: "new activity" });
	await restored.write(path, value);
	expect(value.entries.at(-1)?.content).toBe("new activity");
	expect(() => value.entries[0]).toThrow();
});

it("retains legacy bytes and the previous complete manifest when a new revision cannot serialize", async () => {
	const { store, path } = await fixture();
	const legacy = '{"status":"waiting","nativeSession":"preserved"}';
	await writeFile(path, legacy);
	await store.write(path, { status: "waiting", nativeSession: "preserved" });
	const complete = await readFile(path, "utf8");
	expect(() => store.write(path, { unsupported: 1n })).toThrow();
	expect(await readFile(path, "utf8")).toBe(complete);
	expect(await readFile(`${path}.legacy`, "utf8")).toBe(legacy);
});

it("matches native JSON escaping and artifact hashes across surrogate and string boundaries", async () => {
	const { store, path } = await fixture();
	const result = {
		summary: "Complete",
		text: `${"x".repeat(16383)}😀\ud800\n雪`.repeat(4),
	};
	const value = {
		outputs: { result },
		omitted: undefined,
		date: new Date(0),
		array: [undefined, NaN, Infinity],
	};
	await store.write(path, value, {}, ["outputs"]);
	expect(store.load(path).value).toEqual(JSON.parse(JSON.stringify(value)));
	expect(store.preview(value.outputs, "result")).toMatchObject({
		__artifactPreview: true,
		__artifactHash: createHash("sha256")
			.update(JSON.stringify(result))
			.digest("hex"),
	});
});

it("fails closed for corrupt or traversing chunk references", async () => {
	const { store, path, directory } = await fixture();
	await store.write(path, { entries: [{ content: "private".repeat(1000) }] });
	const snapshot = JSON.parse(await readFile(path, "utf8"));
	const hash = snapshot.fields.entries.pages[0].chunks[0];
	await writeFile(join(directory, "chunks", `${hash}.json`), "[]");
	expect(
		() => store.load<{ entries: unknown[] }>(path).value.entries[0],
	).toThrow(/integrity/);
	snapshot.fields.entries.pages[0].chunks = ["../outside"];
	await writeFile(path, JSON.stringify(snapshot));
	expect(
		() => store.load<{ entries: unknown[] }>(path).value.entries[0],
	).toThrow(/reference/);
});

it("bounds dashboard previews for artifacts with many individually small fields", async () => {
	const { store, path } = await fixture();
	const artifact = Object.fromEntries(
		Array.from({ length: 1024 }, (_, index) => [
			`field-${index}`,
			"x".repeat(500),
		]),
	);
	const outputs = { artifact };
	await store.write(path, { outputs }, {}, ["outputs"]);
	const preview = store.preview(outputs, "artifact");
	expect(preview).toMatchObject({
		__artifactPreview: true,
		keysTruncated: true,
	});
	expect(JSON.stringify(preview).length).toBeLessThan(25000);
	expect((preview as { keys: string[] }).keys).toHaveLength(256);
	expect(store.load<{ outputs: typeof outputs }>(path).value.outputs).toEqual(
		outputs,
	);
});

it("reads compact artifact metadata without loading small retained payloads", async () => {
	const { store, path, directory } = await fixture();
	await store.write(
		path,
		{
			outputs: {
				result: { summary: "Readable summary", notes: "x".repeat(10000) },
				inline: { complete: true },
			},
		},
		{},
		["outputs"],
	);
	const snapshot = JSON.parse(await readFile(path, "utf8"));
	const reference = snapshot.fields.outputs.record.result.reference;
	expect(reference.bytes).toBeLessThan(30000);
	await rm(join(directory, "chunks", `${reference.chunks[0]}.json`));
	const restored = store.load<{ outputs: Record<string, unknown> }>(path).value;
	const preview = store.preview(restored.outputs, "result", { compact: true });
	expect(preview).toMatchObject({
		summary: "Readable summary",
		__artifactPreview: true,
		__artifactHash: reference.hash,
		size: reference.bytes,
		keys: ["summary", "notes"],
	});
	expect(preview).not.toHaveProperty("notes");
	expect(store.preview(restored.outputs, "inline", { compact: true })).toEqual({
		complete: true,
	});
	// The default remains an explicit read for small artifacts, with integrity checks.
	expect(() => store.preview(restored.outputs, "result")).toThrow();
});

it("checks cold checkpoint presence without reading payloads and observes replaced values", async () => {
	const { store, path, directory } = await fixture();
	await store.write(path, {
		checkpoint: { text: "x".repeat(10000) },
		nullable: null,
		missing: undefined,
		disabled: false,
		empty: "",
		array: [],
	});
	const snapshot = JSON.parse(await readFile(path, "utf8"));
	const reference = snapshot.fields.checkpoint.reference;
	await rm(join(directory, "chunks", `${reference.chunks[0]}.json`));
	const restored = store.load<Record<string, unknown>>(path).value;
	expect(store.hasValue(restored, "checkpoint")).toBe(true);
	for (const key of ["nullable", "missing", "disabled", "empty", "absent"])
		expect(store.hasValue(restored, key)).toBe(false);
	expect(store.hasValue(restored, "array")).toBe(true);
	expect(() => restored.checkpoint).toThrow();
	restored.checkpoint = undefined;
	expect(store.hasValue(restored, "checkpoint")).toBe(false);
});

it("writes only new immutable events when the capped activity window rolls forward", async () => {
	const { store, path } = await fixture();
	const events = Array.from({ length: 128 }, (_, sequence) =>
		immutableJson({ sequence, message: "x".repeat(20000) }),
	);
	await store.write(path, { events }, {}, [], [], { events: 1 });
	const before = store.metrics.bytesWritten;
	events.shift();
	events.push(
		immutableJson({ sequence: 128, message: "New activity".repeat(2000) }),
	);
	await store.write(path, { events }, {}, [], [], { events: 1 });
	expect(store.metrics.bytesWritten - before).toBeLessThan(100000);
	expect(store.load<{ events: typeof events }>(path).value.events).toEqual(
		events,
	);
});

it("lets an independent document commit while a large document is still being encoded", async () => {
	const { store, path, directory } = await fixture();
	let complete = false;
	const large = store
		.write(path, { text: "x".repeat(64 * 1024 * 1024) })
		.then(() => {
			complete = true;
		});
	await store.write(join(directory, "independent.json"), { status: "waiting" });
	expect(complete).toBe(false);
	await large;
});

it("copies payloads when a snapshot moves to another home instead of reusing foreign chunk references", async () => {
	const source = await fixture(),
		target = await fixture();
	const value = {
		entries: [
			immutableJson({ content: "retained native conversation".repeat(10000) }),
		],
	};
	await source.store.write(source.path, value);
	await target.store.write(target.path, value);
	const cold = source.store.load<Record<string, unknown>>(source.path).value;
	await target.store.write(target.path, cold);
	await rm(source.directory, { recursive: true });
	expect(target.store.load(target.path).value).toEqual(value);
});

it("services HTTP requests while persisting a large payload and writes no partial manifest", async () => {
	const { store, path, directory } = await fixture();
	const server = createServer((_request, response) => response.end("ready"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as { port: number };
	let completed = false;
	const save = store
		.write(path, { text: "x".repeat(32 * 1024 * 1024) })
		.then(() => {
			completed = true;
		});
	try {
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/version`,
		);
		expect(await response.text()).toBe("ready");
		expect(completed).toBe(false);
		await save;
		expect(store.load<{ text: string }>(path).value.text).toHaveLength(
			32 * 1024 * 1024,
		);
		expect(
			(await readdir(directory)).filter((name) => name.endsWith(".tmp")),
		).toEqual([]);
	} finally {
		await save;
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("retains verified entry identities across four-page eviction without pinning decoded receipts", async () => {
	const { store, path, directory } = await fixture();
	const history = Array.from({ length: 12 }, (_, i) =>
		immutableJson({
			at: `t${i}`,
			output: { text: `${i}:` + "evidence".repeat(1000) },
		}),
	);
	await store.write(path, { history, equal: history }, {}, [], [], {
		history: 1,
		equal: 1,
	});
	const saved = store.load<{ history: typeof history; equal: typeof history }>(
		path,
	).value;
	expect(snapshotEntryIdentity(saved.history, "0")).toBeUndefined();
	immutableTranscript(saved.history);
	const first = saved.history[0];
	const identity = snapshotEntryIdentity(saved.history, "0");
	expect(identity).toBeTypeOf("string");
	for (let i = 0; i < 12; i++) expect(saved.history[i]).toEqual(history[i]);
	const retained = saved.history.slice(-4);
	expect(
		saved.history.slice(-4).every((entry, i) => entry === retained[i]),
	).toBe(true);
	// A new first object proves that old payloads were evicted rather than pinned.
	expect(saved.history[0]).not.toBe(first);
	expect(snapshotEntryIdentity(saved.history, "0")).toBe(identity);
	immutableTranscript(saved.equal);
	void saved.equal[0];
	expect(snapshotEntryIdentity(saved.equal, "0")).not.toBe(identity);
	saved.history[1] = immutableJson({ at: "new", output: { text: "changed" } });
	expect(snapshotEntryIdentity(saved.history, "1")).toBeUndefined();
	const manifest = JSON.parse(await readFile(path, "utf8"));
	const hash = manifest.fields.history.pages[0].chunks[0];
	await writeFile(join(directory, "chunks", `${hash}.json`), "[]");
	expect(() => snapshotEntryIdentity(saved.history, "0")).toThrow(/integrity/);
});
