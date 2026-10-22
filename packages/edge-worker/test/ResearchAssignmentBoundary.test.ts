import { describe, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { prepareForeach } from "../src/factory/Foreach.js";
import {
	parseOutputFormat,
	parseStepOutputAsync,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";

const research = defaultWorkflows.find((w) => w.id === "research-perspective")!;
const coordinate = research.steps[0]!;
const assignments = research.steps[1]!;
function plan(kind: "ascii" | "utf8", count: number) {
	return {
		summary: "Two disjoint full-scope assignments",
		assignments: ["one", "two"].map((id) => ({
			id,
			question: `Inspect ${id} ownership`,
			scope: Array.from({ length: count }, () =>
				(kind === "utf8" ? "界" : "s").repeat(24000),
			),
		})),
	};
}

describe("coordinator output composes with the actual nested assignment snapshot", () => {
	it.each([
		{ kind: "ascii" as const, count: 22, message: /data complexity limit/ },
		{ kind: "utf8" as const, count: 8, message: /1 MiB/ },
	])("rejects complete $kind overflow at the producer with raw output and assignment diagnostic", async ({
		kind,
		count,
		message,
	}) => {
		const raw = plan(kind, count);
		let rejected: unknown, receiverError: unknown;
		try {
			const accepted = await parseStepOutputAsync(coordinate, raw);
			try {
				prepareForeach(assignments, { outputs: { coordinate: accepted } });
			} catch (error) {
				receiverError = error;
			}
		} catch (error) {
			rejected = error;
		}
		expect(
			rejected instanceof OutputValidationError,
			String(receiverError),
		).toBe(true);
		if (!(rejected instanceof OutputValidationError)) return;
		expect(rejected.output).toEqual(raw);
		expect(rejected.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/assignments",
					message: expect.stringMatching(message),
				}),
			]),
		);
		const legacy = parseOutputFormat("improvement-research-plan-v1", raw);
		expect(() =>
			prepareForeach(assignments, { outputs: { coordinate: legacy } }),
		).toThrow(message);
	});
	it.each([
		{ kind: "ascii" as const, count: 20 },
		{ kind: "utf8" as const, count: 7 },
	])("keeps both near-boundary $kind assignments intact at actual prepareForeach", async ({
		kind,
		count,
	}) => {
		const raw = plan(kind, count);
		const accepted = await parseStepOutputAsync(coordinate, raw);
		const snapshot = prepareForeach(assignments, {
			outputs: { coordinate: accepted },
		});
		expect(snapshot.items.map((item) => item.value)).toEqual(raw.assignments);
		expect(snapshot).toMatchObject({
			concurrency: 1,
			maxItems: 2,
			failure: "keep-successful",
		});
		expect(snapshot.items.map((item) => item.id)).toEqual(["one", "two"]);
		expect(parseOutputFormat("improvement-research-plan-v1", raw)).toEqual(
			accepted,
		);
	});
	it("keeps a valid skipped research plan as an actual empty collection", async () => {
		const accepted = await parseStepOutputAsync(coordinate, {
			summary: "No applicable assignment",
			assignments: [],
			skippedReason: "Pinned history has no relevant observations",
		});
		expect(
			prepareForeach(assignments, { outputs: { coordinate: accepted } }).items,
		).toEqual([]);
	});
});
