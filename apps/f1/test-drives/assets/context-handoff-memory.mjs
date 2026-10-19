import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import {
	createFactoryContextServerFromSnapshot,
	prepareFactoryContextAsync,
} from "../../../../packages/mcp-tools/dist/factoryContext.js";
import { FactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/factoryContextSnapshot.js";

// Run with node --max-old-space-size=64 after pnpm build. Repeated published
// evidence makes the logical input exceed V8's single-string limit without
// allocating a gigabyte of fixture data or claiming unique-disk throughput.
const receipt = "Exact evidence 🏭\n".repeat(116509);
const baseline = {
	context: { receipt },
	digest: "preserved-exact-baseline",
	nativeSessionId: "native-preserved",
};
const history = Array.from({ length: 512 }, (_, index) => ({
	step: `review/${index}`,
	output: { baseline, nativeSessionId: `native-${index}` },
	at: `round-${index}`,
}));
const input = { history, plan: { answer: "Exact declared scope" } };
let beats = 0;
let maxGap = 0;
let last = performance.now();
const timer = setInterval(() => {
	beats++;
	const now = performance.now();
	maxGap = Math.max(maxGap, now - last);
	last = now;
}, 1);
let prepared;
let server;
try {
	prepared = await prepareFactoryContextAsync(input);
	clearInterval(timer);
	const path = prepared.config.args.at(-1);
	const snapshot = FactoryContextSnapshot.open(path);
	const logicalCharacters = snapshot.node(snapshot.root).characters;
	assert(logicalCharacters > 1024 ** 3);
	assert(beats > 0, "Context preparation never yielded to I/O");
	assert.equal(snapshot.keys(snapshot.resolve("/history")).length, 512);
	const first = snapshot.read(snapshot.root, 0, 16000);
	assert(first.text.startsWith('{"history":[{"step":"review/0"'));
	const tail = snapshot.read(snapshot.root, logicalCharacters - 16000, 16000);
	assert(tail.text.endsWith(',"plan":{"answer":"Exact declared scope"}}'));
	for (const index of [0, 256, 511]) {
		const original = snapshot.resolve(
			`/history/${index}/output/baseline/context/receipt`,
		);
		assert.equal(snapshot.node(original).length, receipt.length);
		for (let offset = 0; offset < receipt.length; offset += 16000) {
			assert.equal(
				snapshot.read(original, offset, 16000).text,
				receipt.slice(offset, offset + 16000),
			);
		}
		assert.equal(
			snapshot.read(
				snapshot.resolve(`/history/${index}/output/nativeSessionId`),
				0,
				100,
			).text,
			`native-${index}`,
		);
	}
	server = createFactoryContextServerFromSnapshot(path);
	let diskBytes = statSync(path).size;
	for (const directory of ["nodes", "chunks"])
		for (const name of readdirSync(join(dirname(path), directory)))
			diskBytes += statSync(join(dirname(path), directory, name)).size;
	assert(
		diskBytes < 4 * 1024 ** 2,
		"Shared evidence was duplicated in transport",
	);
	console.log(
		JSON.stringify(
			{
				mode: "controlled/no-inference",
				logicalCharacters,
				diskBytes,
				heartbeats: beats,
				maxHeartbeatGapMs: maxGap,
				peakRssMiB: process.resourceUsage().maxRSS / 1024,
				heapSizeLimitMiB: getHeapStatistics().heap_size_limit / 1024 ** 2,
				execArgv: process.execArgv,
				selectedCompleteReceiptsAndNativeIdsPreserved: true,
				limitations:
					"Repeated shared strings; logical-history scaling, not unique-disk throughput or live provider execution.",
			},
			null,
			2,
		),
	);
} finally {
	clearInterval(timer);
	await server?.close();
	prepared?.cleanup();
}
