import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface FactoryContextCounters {
	pages: number;
	utf8Bytes: number;
	readPages: number;
	listPages: number;
	fullPages: number;
}
export const emptyContextCounters = (): FactoryContextCounters => ({
	pages: 0,
	utf8Bytes: 0,
	readPages: 0,
	listPages: 0,
	fullPages: 0,
});
/** One constant-size receipt per MCP connection avoids lost updates across pooled/reconnected processes. */
export function contextCounterWriter(snapshotPath: string) {
	const directory = join(dirname(snapshotPath), "retrievals");
	const path = join(directory, `${randomUUID()}.json`);
	const counters = emptyContextCounters();
	return (kind: "read" | "list", data: Record<string, unknown>) => {
		counters.pages++;
		counters.utf8Bytes += Buffer.byteLength(JSON.stringify(data), "utf8");
		counters[kind === "read" ? "readPages" : "listPages"]++;
		if (data.view === "full") counters.fullPages++;
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		writeFileSync(`${path}.tmp`, JSON.stringify(counters), { mode: 0o600 });
		renameSync(`${path}.tmp`, path);
	};
}
export function readContextCounters(
	snapshotPath: string,
): FactoryContextCounters {
	const directory = join(dirname(snapshotPath), "retrievals");
	const total = emptyContextCounters();
	if (!existsSync(directory)) return total;
	for (const name of readdirSync(directory)) {
		if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
		const counters = JSON.parse(readFileSync(join(directory, name), "utf8"));
		for (const key of Object.keys(total) as (keyof FactoryContextCounters)[]) {
			const value = counters[key];
			if (typeof value === "number" && Number.isFinite(value) && value >= 0)
				total[key] += value;
		}
	}
	return total;
}
