import { describe, expect, it, vi } from "vitest";
import {
	type CheckConfiguration,
	CheckSchema,
	evaluateCheck,
	evaluateCheckAsync,
} from "../src/factory/Check.js";

const configuration: CheckConfiguration = {
	results: {
		approved: {
			aggregate: "all",
			path: "/inputs/parallel/*/results/*",
			where: { path: "/discarded", notEquals: true },
			require: { path: "/approved", equals: true },
		},
		open: {
			aggregate: "count",
			path: "/inputs/findings",
			where: {
				all: [
					{ path: "/settled", notEquals: true },
					{ path: "/rating", min: { path: "$/inputs/threshold" } },
				],
			},
		},
		consequential: {
			aggregate: "filter",
			path: "/inputs/findings",
			where: { path: "/rating", min: 2 },
		},
		external: { path: "/inputs/target/mode", equals: "external" },
		anyEvidence: {
			aggregate: "any",
			path: "/evidence/declared/receipts",
			require: { path: "/valid", equals: true },
		},
	},
	passed: {
		all: [
			{ path: "/results/approved", equals: true },
			{ path: "/results/open", equals: 0 },
			{ path: "/results/anyEvidence", equals: true },
		],
	},
};

describe("generic Check evaluation", () => {
	it("aggregates nested result collections with root-aware filters and explicit evidence", async () => {
		const inputs = {
			parallel: {
				first: {
					results: [{ approved: true }, { approved: false, discarded: true }],
				},
				second: { results: [{ approved: true }] },
			},
			findings: [
				{ id: "nitpick", rating: 1 },
				{ id: "settled", rating: 3, settled: true },
			],
			threshold: 2,
			target: { mode: "external" },
		};
		const evidence = {
			declared: { receipts: [{ valid: false }, { valid: true }] },
		};
		const expected = {
			passed: true,
			approved: true,
			open: 0,
			consequential: [{ id: "settled", rating: 3, settled: true }],
			external: true,
			anyEvidence: true,
		};
		expect(CheckSchema.parse(configuration)).toEqual(configuration);
		expect(evaluateCheck(configuration, inputs, evidence)).toEqual(expected);
		await expect(
			evaluateCheckAsync(configuration, inputs, evidence),
		).resolves.toEqual(expected);
		expect(inputs.findings).toEqual([
			{ id: "nitpick", rating: 1 },
			{ id: "settled", rating: 3, settled: true },
		]);
	});

	it("combines boolean results by default while evaluating every named result", async () => {
		const check: CheckConfiguration = {
			results: {
				first: { path: "/inputs/ready", equals: true },
				second: { path: "/inputs/mode", equals: "external" },
				count: { aggregate: "count", path: "/inputs/items" },
			},
		};
		await expect(
			evaluateCheckAsync(check, {
				ready: false,
				mode: "external",
				items: [1, 2],
			}),
		).resolves.toEqual({
			passed: false,
			first: false,
			second: true,
			count: 2,
		});
		await expect(
			evaluateCheckAsync(check, { ready: false, mode: "external" }),
		).rejects.toThrow("Rule aggregate path");
	});

	it("uses genuine empty collection semantics without treating missing collections as empty", () => {
		const check: CheckConfiguration = {
			results: {
				all: {
					aggregate: "all",
					path: "/inputs/items",
					require: { path: "/ok", equals: true },
				},
				any: {
					aggregate: "any",
					path: "/inputs/items",
					require: { path: "/ok", equals: true },
				},
				count: { aggregate: "count", path: "/inputs/items" },
				filtered: { aggregate: "filter", path: "/inputs/items" },
			},
		};
		expect(evaluateCheck(check, { items: [] })).toEqual({
			passed: false,
			all: true,
			any: false,
			count: 0,
			filtered: [],
		});
		for (const inputs of [
			{},
			{ items: null },
			{ items: {} },
			{ items: "items" },
		])
			expect(() => evaluateCheck(check, inputs)).toThrow("Rule aggregate path");
	});

	it.each([
		["/inputs/missing/*", { items: [] }],
		["/inputs/items/*/results/*", { items: [{ results: [] }, {}] }],
		["/inputs/items/*", { items: 3 }],
	])("fails closed for invalid expanded collection path %s", (path, inputs) => {
		expect(() =>
			evaluateCheck(
				{
					results: { count: { aggregate: "count", path } },
					passed: { path: "/results/count", equals: 0 },
				},
				inputs,
			),
		).toThrow("Rule aggregate path");
	});

	it("does not activate evidence roles from read names or select a next step", () => {
		const check: CheckConfiguration = {
			results: {
				review: { path: "/evidence/review/approved", equals: true },
				ordinary: { path: "/inputs/review/approved", equals: true },
			},
		};
		expect(
			evaluateCheck(check, { review: { approved: true, next: "merge" } }),
		).toEqual({ passed: false, review: false, ordinary: true });
		expect(evaluateCheck(check, {}, { review: { approved: true } })).toEqual({
			passed: false,
			review: true,
			ordinary: false,
		});
	});

	it("projects only explicitly selected JSON fields into independently owned output", async () => {
		const check: CheckConfiguration = {
			results: {
				mode: { select: "/inputs/target/mode" },
				findings: { select: "/evidence/review/findings" },
				headSha: { select: "/evidence/review/headSha" },
				absent: { select: "/evidence/review/missing" },
			},
			passed: { path: "/results/mode", equals: "external" },
		};
		const evidence = {
			review: {
				findings: [{ id: "finding", rating: 2 }],
				headSha: "revision",
				next: "merge",
			},
		};
		const output = await evaluateCheckAsync(
			check,
			{ target: { mode: "external" } },
			evidence,
		);
		expect(CheckSchema.safeParse(check).success).toBe(true);
		expect(output).toEqual({
			passed: true,
			mode: "external",
			findings: [{ id: "finding", rating: 2 }],
			headSha: "revision",
			absent: null,
		});
		expect(output.findings).not.toBe(evidence.review.findings);
		expect((output.findings as { id: string }[])[0]).not.toBe(
			evidence.review.findings[0],
		);
		expect(
			CheckSchema.safeParse({ results: { mode: { select: "/inputs/mode" } } })
				.success,
		).toBe(false);
	});

	it("preserves own JSON fields without traversing prototypes or invoking accessors", () => {
		expect(
			evaluateCheck(
				{
					results: {
						inherited: { path: "/inputs/items/constructor", exists: false },
					},
				},
				{ items: {} },
			),
		).toEqual({ passed: true, inherited: true });
		const getter = vi.fn(() => [1]);
		const inputs = Object.defineProperty({}, "items", {
			enumerable: true,
			get: getter,
		});
		expect(() =>
			evaluateCheck(
				{ results: { all: { path: "/inputs/items", exists: true } } },
				inputs,
			),
		).toThrow("not accessors");
		expect(getter).not.toHaveBeenCalled();
		expect(() =>
			evaluateCheck(
				{ results: { all: { path: "/inputs/items", exists: true } } },
				Object.create({ items: [] }),
			),
		).toThrow("only JSON data");
	});

	it("leaves unselected historical context cold and budgets only useful selected work", async () => {
		const history = vi.fn(() => {
			throw new Error("Unrelated history hydrated");
		});
		const inputs = Object.defineProperty(
			{
				ready: true,
				baseline: { source: "x".repeat(2_000_000) },
				ticket: { createdAt: new Date("2026-10-21T12:00:00.000Z") },
			},
			"history",
			{ enumerable: true, get: history },
		);
		const check: CheckConfiguration = {
			results: { ready: { path: "/inputs/ready", equals: true } },
		};
		expect(evaluateCheck(check, inputs)).toEqual({ passed: true, ready: true });
		await expect(evaluateCheckAsync(check, inputs)).resolves.toEqual({
			passed: true,
			ready: true,
		});
		expect(history).not.toHaveBeenCalled();
		await expect(
			evaluateCheckAsync(
				{
					results: { value: { select: "/inputs/baseline" } },
					passed: { path: "/results/value", exists: true },
				},
				inputs,
			),
		).rejects.toThrow("evaluation operation limit");
		await expect(
			evaluateCheckAsync(
				{
					results: { value: { select: "/inputs/ticket/createdAt" } },
					passed: { path: "/results/value", exists: true },
				},
				inputs,
			),
		).rejects.toThrow("only JSON data");
	});

	it("rejects selected cyclic values and array accessors without invoking a getter or host iterator", async () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const check: CheckConfiguration = {
			results: { value: { select: "/inputs/value" } },
			passed: { path: "/results/value", exists: true },
		};
		await expect(evaluateCheckAsync(check, { value: cyclic })).rejects.toThrow(
			"acyclic",
		);
		const getter = vi.fn(() => true);
		const array: unknown[] = [];
		Object.defineProperty(array, "0", { enumerable: true, get: getter });
		await expect(
			evaluateCheckAsync(
				{
					results: { count: { aggregate: "count", path: "/inputs/value" } },
					passed: { path: "/results/count", min: 0 },
				},
				{ value: array },
			),
		).rejects.toThrow("not accessors");
		expect(getter).not.toHaveBeenCalled();
		const iterator = vi.fn(() => {
			throw new Error("Host iterator invoked");
		});
		const values = Object.assign([1, 2], { [Symbol.iterator]: iterator });
		await expect(
			evaluateCheckAsync(
				{
					results: { count: { aggregate: "count", path: "/inputs/value" } },
					passed: { path: "/results/count", equals: 2 },
				},
				{ value: values },
			),
		).resolves.toEqual({ passed: true, count: 2 });
		expect(iterator).not.toHaveBeenCalled();
	});

	it("uses only the fixed format validator and fails closed when unavailable", async () => {
		const check = {
			results: { valid: { conforms: "json-v1" } },
		} satisfies CheckConfiguration;
		await expect(evaluateCheckAsync(check, {})).rejects.toThrow(
			"library validator",
		);
		const validate = vi.fn(
			(format, document) => format === "json-v1" && document.inputs.ready,
		);
		await expect(
			evaluateCheckAsync(check, { ready: true }, {}, validate),
		).resolves.toEqual({ passed: true, valid: true });
		expect(validate).toHaveBeenCalledWith("json-v1", {
			inputs: { ready: true },
			evidence: {},
		});
	});
});

describe("Check configuration and evaluation bounds", () => {
	it.each([
		"passed",
		"constructor",
		"prototype",
		"__proto__",
	])("rejects reserved output name %s", (name) => {
		const results = JSON.parse(
			`{"valid":{"path":"/inputs/ready","equals":true},"${name}":{"path":"/inputs/ready","equals":true}}`,
		);
		expect(CheckSchema.safeParse({ results }).success).toBe(false);
		expect(() => evaluateCheck({ results }, { ready: true })).toThrow(
			"Reserved named rule result",
		);
	});

	it("requires a meaningful passed condition and validates aggregate-specific fields", () => {
		const results = { count: { aggregate: "count", path: "/inputs/items" } };
		expect(CheckSchema.safeParse({ results }).success).toBe(false);
		expect(
			CheckSchema.safeParse({
				results,
				passed: { path: "/results/count", equals: 0 },
			}).success,
		).toBe(true);
		expect(
			CheckSchema.safeParse({
				results: { all: { aggregate: "all", path: "/inputs/items" } },
			}).success,
		).toBe(false);
		expect(
			CheckSchema.safeParse({
				results: {
					count: { ...results.count, require: { path: "", exists: true } },
				},
				passed: { path: "/results/count", min: 0 },
			}).success,
		).toBe(false);
		expect(() => evaluateCheck({ results: {} }, {})).toThrow("boolean result");
	});

	it("bounds expression count and cyclic configuration before recursive schema parsing", () => {
		const results = Object.fromEntries(
			Array.from({ length: 51 }, (_, index) => [
				`r${index}`,
				{ path: "/inputs/ready", equals: true },
			]),
		);
		expect(CheckSchema.safeParse({ results }).success).toBe(false);
		expect(() => evaluateCheck({ results }, {})).toThrow(
			"50 named rule results",
		);
		const recursive: Record<string, unknown> = {};
		recursive.not = recursive;
		expect(
			CheckSchema.safeParse({ results: { cyclic: recursive } }).success,
		).toBe(false);
	});

	it("shares the total work budget across every named aggregate", async () => {
		const check: CheckConfiguration = {
			results: Object.fromEntries(
				Array.from({ length: 12 }, (_, index) => [
					`r${index}`,
					{
						aggregate: "count",
						path: "/inputs/items",
						where: { path: "/label", equals: "xxxxxxxx" },
					},
				]),
			),
			passed: { path: "/results/r0", min: 1 },
		};
		await expect(
			evaluateCheckAsync(check, {
				items: Array.from({ length: 5000 }, () => ({ label: "xxxxxxxx" })),
			}),
		).rejects.toThrow("evaluation operation limit");
	});

	it("bounds emitted filter data as well as the scan", async () => {
		const check: CheckConfiguration = {
			results: Object.fromEntries(
				Array.from({ length: 5 }, (_, index) => [
					`r${index}`,
					{ aggregate: "filter", path: "/inputs/items" },
				]),
			),
			passed: { path: "/results/r0", exists: true },
		};
		await expect(
			evaluateCheckAsync(check, {
				items: Array.from({ length: 250 }, () => "x".repeat(1000)),
			}),
		).rejects.toThrow("evaluation operation limit");
		await expect(
			evaluateCheckAsync(
				{
					results: {
						all: {
							aggregate: "all",
							path: "/inputs/items",
							require: { path: "", exists: true },
						},
					},
				},
				{ items: Array.from({ length: 20001 }, () => true) },
			),
		).rejects.toThrow("collection exceeds");
	});

	it("charges repeated JSON projection serialization and cloning", async () => {
		const check: CheckConfiguration = {
			results: Object.fromEntries(
				Array.from({ length: 10 }, (_, index) => [
					`r${index}`,
					{ select: "/inputs/value" },
				]),
			),
			passed: { path: "/results/r0", exists: true },
		};
		await expect(
			evaluateCheckAsync(check, { value: "x".repeat(20000) }),
		).rejects.toThrow("evaluation operation limit");
	});

	it("yields during large traversals and preserves cancellation as an abort", async () => {
		const controller = new AbortController();
		const pending = evaluateCheckAsync(
			{
				results: {
					count: {
						aggregate: "count",
						path: "/inputs/items",
						where: { path: "/id", min: 0 },
					},
				},
				passed: { path: "/results/count", min: 0 },
			},
			{ items: Array.from({ length: 20000 }, (_, id) => ({ id })) },
			{},
			undefined,
			controller.signal,
		);
		let ticks = 0;
		const timer = setInterval(() => ticks++, 1);
		setTimeout(
			() => controller.abort(new DOMException("Stop Check", "AbortError")),
			5,
		);
		try {
			await expect(pending).rejects.toMatchObject({
				name: "AbortError",
				message: "Stop Check",
			});
			expect(ticks).toBeGreaterThan(0);
		} finally {
			clearInterval(timer);
		}
	});
});
