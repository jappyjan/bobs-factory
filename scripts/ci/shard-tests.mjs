#!/usr/bin/env node
// Balanced test sharding. vitest's own --shard splits by file-path hash, which put
// three of the six slowest edge-worker files in one shard. This assigns files
// longest-first to the lightest shard using measured durations (test-weights.json,
// seconds); files not listed there get a small default weight. Output is a
// space-separated list of test paths for one shard. Stale entries are ignored.
//
// Usage: shard-tests.mjs <index> <count> <package-dir>
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_WEIGHT = 3;

export function assignShards(files, weights, count) {
	const shards = Array.from({ length: count }, () => ({ load: 0, files: [] }));
	const ordered = [...files].sort(
		(a, b) =>
			(weights[b] ?? DEFAULT_WEIGHT) - (weights[a] ?? DEFAULT_WEIGHT) ||
			a.localeCompare(b),
	);
	for (const file of ordered) {
		const lightest = shards.reduce((best, shard) =>
			shard.load < best.load ? shard : best,
		);
		lightest.files.push(file);
		lightest.load += weights[file] ?? DEFAULT_WEIGHT;
	}
	return shards;
}

export function listTests(packageDir) {
	const walk = (dir) =>
		readdirSync(join(packageDir, dir), { withFileTypes: true }).flatMap(
			(entry) =>
				entry.isDirectory()
					? walk(join(dir, entry.name))
					: /\.test\.tsx?$/.test(entry.name)
						? [join(dir, entry.name)]
						: [],
		);
	return walk("test");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [index, count, packageDir] = process.argv.slice(2);
	const weights = JSON.parse(
		readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "test-weights.json"),
		),
	);
	const shard = assignShards(listTests(packageDir), weights, Number(count))[
		Number(index) - 1
	];
	if (!shard?.files.length) {
		console.error(`No tests for shard ${index}/${count}`);
		process.exit(1);
	}
	console.log(shard.files.join(" "));
}
