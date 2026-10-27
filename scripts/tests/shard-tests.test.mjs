import assert from "node:assert/strict";
import test from "node:test";
import { assignShards, listTests } from "../ci/shard-tests.mjs";

test("every edge-worker test file lands in exactly one shard", () => {
	const files = listTests("packages/edge-worker");
	const shards = assignShards(files, { "test/slow.test.ts": 100 }, 6);
	const assigned = shards.flatMap((shard) => shard.files);
	assert.equal(new Set(assigned).size, assigned.length);
	assert.deepEqual([...assigned].sort(), [...files].sort());
	assert.ok(shards.every((shard) => shard.files.length > 0));
});

test("the slowest files are spread across shards, not stacked", () => {
	const weights = { "a.test.ts": 100, "b.test.ts": 100, "c.test.ts": 100 };
	const shards = assignShards(
		["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"],
		weights,
		3,
	);
	assert.deepEqual(
		shards.map((shard) => shard.files.filter((f) => weights[f]).length),
		[1, 1, 1],
	);
});
