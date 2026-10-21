import { describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	aggregateForeach,
	foreachPointer,
	prepareForeach,
} from "../src/factory/Foreach.js";
import { validateWorkflows } from "../src/factory/Workflow.js";

const settings = (values: unknown[], extra: Record<string, unknown> = {}) => ({
	items: { values },
	...extra,
});
const leaf = {
	id: "inspect",
	name: "Inspect",
	type: "agent",
	prompt: "Inspect",
};
function definition(
	step: Record<string, unknown>,
	dependencies: unknown[] = [],
) {
	return validateWorkflows([
		...defaultWorkflows,
		...dependencies,
		{
			id: "foreach-fixture",
			name: "For each fixture",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "each",
					name: "Each",
					type: "foreach",
					items: { values: [{ id: "one" }] },
					body: [leaf],
					...step,
				},
			],
		},
	]);
}

describe("For each accepted collections", () => {
	it("snapshots source values with original indices and documented defaults", () => {
		const source = [
			{ id: "alpha", nested: { brief: "original" } },
			{ id: "beta" },
		];
		const accepted = prepareForeach(
			{ items: { from: "/coordinate/assignments" } },
			{ outputs: { coordinate: { assignments: source } } },
		);
		source[0]!.nested!.brief = "changed";
		source.reverse();
		expect(accepted).toEqual({
			items: [
				{
					id: "alpha",
					index: 0,
					value: { id: "alpha", nested: { brief: "original" } },
				},
				{ id: "beta", index: 1, value: { id: "beta" } },
			],
			itemId: "/id",
			concurrency: 4,
			maxItems: 100,
			failure: "all-must-succeed",
		});
	});

	it("resolves escaped JSON Pointer segments and lexical item collections", () => {
		const child = { "identity/key": { "~id": "nested" } };
		expect(
			prepareForeach(
				{ items: { from: "/item/assignments" }, itemId: "/identity~1key/~0id" },
				{ outputs: {}, item: { assignments: [child] }, index: 8 },
			).items,
		).toEqual([{ id: "nested", index: 0, value: child }]);
	});

	it.each([
		["missing", { items: { from: "/source/missing" } }, /does not resolve/],
		["non-array", { items: { from: "/source" } }, /resolve to an array/],
		[
			"too many",
			settings([{ id: "a" }, { id: "b" }], { maxItems: 1 }),
			/exceeding maxItems 1/,
		],
		[
			"duplicate",
			settings([{ id: "same" }, { id: "same" }]),
			/duplicate item ID/,
		],
		["missing ID", settings([{}]), /does not resolve/],
		["numeric ID", settings([{ id: 1 }]), /safe string ID/],
		["empty ID", settings([{ id: "" }]), /safe string ID/],
		["path ID", settings([{ id: "a/b" }]), /safe string ID/],
		["overlong ID", settings([{ id: "a".repeat(81) }]), /safe string ID/],
		["prototype ID", settings([{ id: "__proto__" }]), /safe string ID/],
		["constructor ID", settings([{ id: "constructor" }]), /safe string ID/],
		["zero concurrency", settings([], { concurrency: 0 }), /Too small/],
		[
			"fractional concurrency",
			settings([], { concurrency: 1.5 }),
			/expected int/,
		],
		["excessive concurrency", settings([], { concurrency: 33 }), /Too big/],
		["invalid maximum", settings([], { maxItems: 0 }), /Too small/],
		["excessive maximum", settings([], { maxItems: 1001 }), /Too big/],
		[
			"unsafe path",
			{ items: { from: "/source/__proto__" } },
			/safe JSON Pointer/,
		],
		["wildcard path", { items: { from: "/source/*" } }, /safe JSON Pointer/],
		["invalid escape", { items: { from: "/source/~2" } }, /safe JSON Pointer/],
	] as const)("rejects %s before accepting any items", (_name, config, error) => {
		expect(() => prepareForeach(config, { outputs: { source: {} } })).toThrow(
			error,
		);
	});

	it("never evaluates a source accessor or traverses inherited properties", () => {
		const get = vi.fn(() => [{ id: "untrusted" }]);
		const source = Object.defineProperty({}, "items", {
			enumerable: true,
			get,
		});
		expect(() => foreachPointer(source, "/items")).toThrow(/without accessors/);
		expect(get).not.toHaveBeenCalled();
		expect(() =>
			foreachPointer(Object.create({ items: [] }), "/items"),
		).toThrow(/does not resolve/);
	});

	it.each([
		"array index",
		"values property",
	] as const)("rejects an inline %s accessor before either settings or workflow parsing reads it", (location) => {
		for (const parse of [
			(items: unknown) => prepareForeach({ items }, { outputs: {} }),
			(items: unknown) => definition({ items }),
		]) {
			const get = vi.fn(() =>
				location === "array index"
					? { id: "untrusted" }
					: [{ id: "untrusted" }],
			);
			const values: unknown[] = [];
			const items =
				location === "array index"
					? {
							values: Object.defineProperty(values, "0", {
								enumerable: true,
								get,
							}),
						}
					: Object.defineProperty({}, "values", { enumerable: true, get });
			expect(() => parse(items)).toThrow(/accessors|JSON data/);
			expect(get).not.toHaveBeenCalled();
		}
	});

	it("rejects accessor, prototype and non-JSON data before cloning", () => {
		const get = vi.fn(() => "secret");
		const accessor = Object.defineProperty({ id: "a" }, "brief", {
			enumerable: true,
			get,
		});
		const inherited = Object.assign(Object.create({ inherited: "not JSON" }), {
			id: "a",
		});
		const polluted = JSON.parse('{"id":"a","__proto__":{"polluted":true}}');
		const cyclic: { id: string; self?: unknown } = { id: "a" };
		cyclic.self = cyclic;
		for (const value of [
			accessor,
			inherited,
			polluted,
			cyclic,
			{ id: "a", value: Number.NaN },
			{ id: "a", value: undefined },
		])
			expect(() =>
				prepareForeach(settings([value]), { outputs: {} }),
			).toThrow();
		expect(get).not.toHaveBeenCalled();
		expect(Object.prototype).not.toHaveProperty("polluted");
	});

	it("rejects sparse or oversized item data instead of truncating", () => {
		const sparse = new Array(2);
		sparse[1] = { id: "a" };
		expect(() => prepareForeach(settings(sparse), { outputs: {} })).toThrow(
			/sparse/,
		);
		expect(() =>
			prepareForeach(settings([{ id: "a", brief: "a".repeat(1_048_577) }]), {
				outputs: {},
			}),
		).toThrow(/limit|1 MiB/);
	});

	it("aggregates in accepted order with separate explicit failures and retained receipts", () => {
		const snapshot = prepareForeach(
			settings([{ id: "done" }, { id: "bad" }, { id: "stopped" }]),
			{ outputs: {} },
		);
		const receipt = { inspect: { finding: "original" } };
		const result = aggregateForeach(snapshot, [
			{ status: "completed", result: receipt },
			{ status: "failed", error: "Invalid result" },
			{ status: "cancelled", error: "Sibling failed" },
		]);
		receipt.inspect.finding = "changed";
		expect(result).toEqual({
			results: { done: { inspect: { finding: "original" } } },
			summary: {
				total: 3,
				completed: 1,
				failed: 1,
				cancelled: 1,
				failures: [
					{ id: "bad", index: 1, status: "failed", error: "Invalid result" },
					{
						id: "stopped",
						index: 2,
						status: "cancelled",
						error: "Sibling failed",
					},
				],
				limitations: ["bad: Invalid result", "stopped: Sibling failed"],
			},
		});
	});

	it("never reports an unfinished or missing item as aggregate success", () => {
		const snapshot = prepareForeach(settings([{ id: "a" }]), { outputs: {} });
		for (const states of [
			[],
			[{ status: "pending" as const }],
			[{ status: "running" as const }],
		])
			expect(() => aggregateForeach(snapshot, states)).toThrow(/unfinished/);
		expect(
			aggregateForeach(prepareForeach(settings([]), { outputs: {} }), []),
		).toEqual({
			results: {},
			summary: {
				total: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				failures: [],
				limitations: [],
			},
		});
	});
});

describe("For each graph restrictions", () => {
	it.each([
		{ body: [{ ...leaf, askQuestions: true }] },
		{
			body: [
				{ id: "approve", name: "Approve", type: "tool", tool: "human-review" },
			],
		},
		{
			body: [
				{
					id: "nested",
					name: "Nested",
					type: "foreach",
					items: { values: [] },
					body: [{ ...leaf, askQuestions: true }],
				},
			],
		},
	])("rejects a human checkpoint inside a body", ({ body }) => {
		expect(() => definition({ body })).toThrow(/Human checkpoints/);
	});

	it("rejects human checkpoints transitively through called recipes", () => {
		const dependencies = [
			{
				id: "human-child",
				name: "Child",
				steps: [{ ...leaf, askQuestions: true }],
				allowedTriggers: ["workflow"],
			},
			{
				id: "intermediate",
				name: "Intermediate",
				steps: [
					{
						id: "call",
						name: "Call",
						type: "workflow",
						workflow: "human-child",
					},
				],
				allowedTriggers: ["workflow"],
			},
		];
		expect(() =>
			definition(
				{
					body: [
						{
							id: "call",
							name: "Call",
							type: "workflow",
							workflow: "intermediate",
						},
					],
				},
				dependencies,
			),
		).toThrow(/Human checkpoints/);
	});

	it("preserves recursive call and depth rejection inside nested iterations", () => {
		expect(() =>
			definition({
				body: [
					{
						id: "call",
						name: "Call",
						type: "workflow",
						workflow: "foreach-fixture",
					},
				],
			}),
		).toThrow(/Recursive workflow call/);
		let body: unknown[] = [leaf];
		for (let i = 0; i < 12; i++)
			body = [
				{
					id: `nested-${i}`,
					name: "Nested",
					type: "foreach",
					items: { values: [] },
					body,
				},
			];
		expect(() => definition({ body })).toThrow(/nesting exceeds/);
	});
});
