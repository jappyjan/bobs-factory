import { describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	aggregateForeach,
	ForeachSettingsSchema,
	foreachPointer,
	prepareForeach,
} from "../src/factory/Foreach.js";
import {
	StepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";

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
			engineVersion: "nodes-v1",
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

	it.each([
		"hidden getter",
		"hidden function",
		"symbol getter",
		"hidden data",
	] as const)("rejects %s hooks before any inline, output, direct-schema or workflow read", (kind) => {
		for (const parse of [
			(values: unknown[]) => prepareForeach(settings(values), { outputs: {} }),
			(values: unknown[]) =>
				prepareForeach(
					{ items: { from: "/source/items" } },
					{ outputs: { source: { items: values } } },
				),
			(values: unknown[]) => ForeachSettingsSchema.parse(settings(values)),
			(values: unknown[]) => definition({ items: { values } }),
		]) {
			const hook = vi.fn(() => ({ id: "changed" }));
			const item = { id: "original" };
			if (kind === "hidden getter")
				Object.defineProperty(item, "toJSON", { get: hook });
			if (kind === "hidden function")
				Object.defineProperty(item, "toJSON", { value: hook });
			if (kind === "symbol getter")
				Object.defineProperty(item, Symbol.toPrimitive, {
					enumerable: true,
					get: hook,
				});
			if (kind === "hidden data")
				Object.defineProperty(item, "brief", { value: "hidden" });
			expect(() => parse([item])).toThrow(
				/JSON data|accessors|non-enumerable|symbol/,
			);
			expect(hook).not.toHaveBeenCalled();
		}
	});

	it("rejects inherited settings and source getters before direct or workflow schema parsing", () => {
		for (const parse of [
			(value: unknown) => prepareForeach(value, { outputs: {} }),
			(value: unknown) => ForeachSettingsSchema.parse(value),
		]) {
			const get = vi.fn(() => ({ values: [{ id: "untrusted" }] }));
			expect(() =>
				parse(
					Object.create({
						get items() {
							return get();
						},
					}),
				),
			).toThrow(/plain JSON/);
			expect(get).not.toHaveBeenCalled();
		}
		for (const parse of [
			(items: unknown) => prepareForeach({ items }, { outputs: {} }),
			(items: unknown) => ForeachSettingsSchema.parse({ items }),
			(items: unknown) => definition({ items }),
		]) {
			const get = vi.fn(() => [{ id: "untrusted" }]);
			const inherited = Object.create({
				get values() {
					return get();
				},
			});
			expect(() => parse(inherited)).toThrow(/plain JSON/);
			expect(get).not.toHaveBeenCalled();
		}
	});

	it("checks every relevant top-level setting descriptor without reading getters or unrelated config", () => {
		for (const field of [
			"items",
			"itemId",
			"concurrency",
			"maxItems",
			"failure",
		]) {
			for (const parse of [
				(value: unknown) => prepareForeach(value, { outputs: {} }),
				(value: unknown) => ForeachSettingsSchema.parse(value),
			]) {
				const get = vi.fn(() => (field === "items" ? { values: [] } : 1));
				const config = Object.defineProperty(settings([]), field, {
					enumerable: true,
					get,
				});
				expect(() => parse(config)).toThrow(/without accessors/);
				expect(get).not.toHaveBeenCalled();
			}
		}
		expect(
			prepareForeach(
				{
					...settings(["first"]),
					itemId: "",
					model: undefined,
					body: [{ optionalConfig: undefined }],
				},
				{ outputs: {} },
			).items,
		).toEqual([{ id: "first", index: 0, value: "first" }]);
	});

	it.each([
		"own hidden items",
		"own enumerable items",
		"inherited items",
		"type getter",
	] as const)("rejects raw workflow step %s before the union parser reads it", (location) => {
		for (const parse of [
			(step: unknown) => StepSchema.parse(step),
			(step: unknown) =>
				WorkflowSchema.parse({
					engineVersion: "nodes-v1",
					id: "raw-fixture",
					name: "Raw fixture",
					steps: [step],
				}),
		]) {
			const get = vi.fn(() =>
				location === "type getter"
					? "foreach"
					: { values: [{ id: "untrusted" }] },
			);
			const raw = { id: "each", name: "Each", type: "foreach", body: [leaf] };
			if (location === "inherited items")
				Object.setPrototypeOf(raw, Object.defineProperty({}, "items", { get }));
			else
				Object.defineProperty(
					raw,
					location === "type getter" ? "type" : "items",
					{ enumerable: location !== "own hidden items", get },
				);
			expect(() => parse(raw)).toThrow(/Workflow steps/);
			expect(get).not.toHaveBeenCalled();
		}
	});

	it("preserves null-prototype step data and ordinary undefined generic configuration", () => {
		const raw = Object.assign(Object.create(null), {
			id: "each",
			name: "Each",
			type: "foreach",
			items: { values: [] },
			body: [leaf],
			model: undefined,
			reads: undefined,
			concurrency: undefined,
		});
		expect(StepSchema.parse(raw)).toMatchObject({
			id: "each",
			type: "foreach",
			concurrency: 4,
			maxItems: 100,
			maxVisits: 16,
			failure: "all-must-succeed",
		});
		expect(
			StepSchema.parse({ ...leaf, model: undefined, reads: undefined }),
		).toMatchObject({ id: "inspect", type: "agent", maxVisits: 16 });
	});

	it("rejects inherited item and array prototypes without invoking their hooks", () => {
		for (const parse of [
			(values: unknown[]) => prepareForeach(settings(values), { outputs: {} }),
			(values: unknown[]) =>
				prepareForeach(
					{ items: { from: "/source" } },
					{ outputs: { source: values } },
				),
			(values: unknown[]) => ForeachSettingsSchema.parse(settings(values)),
			(values: unknown[]) => definition({ items: { values } }),
		]) {
			const get = vi.fn(() => () => ({ id: "changed" }));
			const inheritedItem = Object.assign(
				Object.create(Object.defineProperty({}, "toJSON", { get })),
				{ id: "first" },
			);
			expect(() => parse([inheritedItem])).toThrow(/plain JSON/);
			const inheritedArray = [{ id: "first" }];
			Object.setPrototypeOf(
				inheritedArray,
				Object.create(Array.prototype, { toJSON: { get } }),
			);
			expect(() => parse(inheritedArray)).toThrow(/plain JSON/);
			expect(get).not.toHaveBeenCalled();
		}
	});

	it("rejects holes balanced by extra properties, dense arrays with extras and hidden indices", () => {
		for (const make of [
			() => Object.assign(new Array(1), { foo: { id: "first" } }),
			() => Object.assign([{ id: "first" }], { foo: { id: "extra" } }),
			() => Object.assign([{ id: "first" }], { "01": { id: "extra" } }),
			() =>
				Object.defineProperty([{ id: "first" }], "0", {
					value: { id: "first" },
					enumerable: false,
				}),
		]) {
			for (const parse of [
				(values: unknown[]) =>
					prepareForeach(settings(values), { outputs: {} }),
				(values: unknown[]) => ForeachSettingsSchema.parse(settings(values)),
				(values: unknown[]) => definition({ items: { values } }),
			])
				expect(() => parse(make())).toThrow(
					/sparse|extra properties|non-enumerable/,
				);
		}
		const get = vi.fn(() => "not JSON");
		const values = Object.defineProperty([{ id: "first" }], "extra", { get });
		expect(() => prepareForeach(settings(values), { outputs: {} })).toThrow(
			/without accessors/,
		);
		expect(get).not.toHaveBeenCalled();
	});

	it("reads output and lexical pointers through own data descriptors before any spread or property read", () => {
		const get = vi.fn(() => [{ id: "first" }]);
		const outputs = Object.defineProperty({}, "source", {
			enumerable: true,
			get,
		});
		expect(() =>
			prepareForeach({ items: { from: "/source" } }, { outputs }),
		).toThrow(/without accessors/);
		const source = Object.create(Object.defineProperty({}, "items", { get }));
		expect(() =>
			prepareForeach(
				{ items: { from: "/source/items" } },
				{ outputs: { source } },
			),
		).toThrow(/plain JSON|does not resolve/);
		const scope = Object.defineProperty({}, "outputs", {
			enumerable: true,
			get,
		});
		expect(() =>
			prepareForeach(
				{ items: { from: "/source" } },
				scope as { outputs: Record<string, unknown> },
			),
		).toThrow(/without accessors/);
		expect(get).not.toHaveBeenCalled();
	});

	it("preserves plain and null-prototype JSON data, dense arrays and scalar string identities", () => {
		const item = Object.assign(Object.create(null), {
			id: "first",
			nested: Object.assign(Object.create(null), { note: "kept" }),
		});
		const values = [item];
		Object.setPrototypeOf(values, null);
		const config = Object.assign(Object.create(null), {
			items: Object.assign(Object.create(null), { values }),
		});
		expect(prepareForeach(config, { outputs: {} }).items).toEqual([
			{
				id: "first",
				index: 0,
				value: { id: "first", nested: { note: "kept" } },
			},
		]);
		const parsed = ForeachSettingsSchema.parse(config);
		if (!("values" in parsed.items)) throw new Error("Expected inline items");
		expect(parsed.items.values.map((value) => value)).toEqual([
			{ id: "first", nested: { note: "kept" } },
		]);
		expect(Object.getPrototypeOf(parsed.items.values)).toBe(Array.prototype);
		expect(
			ForeachSettingsSchema.parse(
				settings([], {
					itemId: undefined,
					concurrency: undefined,
					maxItems: undefined,
					failure: undefined,
				}),
			),
		).toMatchObject({
			itemId: "/id",
			concurrency: 4,
			maxItems: 100,
			failure: "all-must-succeed",
		});
		expect(
			prepareForeach(settings(["first", "second"], { itemId: "" }), {
				outputs: {},
			}).items,
		).toEqual([
			{ id: "first", index: 0, value: "first" },
			{ id: "second", index: 1, value: "second" },
		]);
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
		{
			body: [
				{
					id: "approval",
					name: "Approval",
					type: "display",
					document: {
						version: "view-v1",
						components: [
							{
								id: "actions",
								type: "actions",
								data: {
									literal: { actions: [{ id: "continue", label: "Continue" }] },
								},
							},
						],
					},
				},
			],
		},
		{
			body: [
				{
					id: "approval",
					name: "Approval",
					type: "display",
					document: {
						version: "view-v1",
						components: [
							{
								id: "actions",
								type: "actions",
								data: {
									literal: { actions: [{ id: "continue", label: "Continue" }] },
								},
							},
						],
					},
				},
			],
		},
		{
			body: [
				{
					id: "nested",
					name: "Nested",
					type: "foreach",
					items: { values: [] },
					body: [
						{
							id: "approval",
							name: "Approval",
							type: "display",
							document: {
								version: "view-v1",
								components: [
									{
										id: "actions",
										type: "actions",
										data: {
											literal: {
												actions: [{ id: "continue", label: "Continue" }],
											},
										},
									},
								],
							},
						},
					],
				},
			],
		},
	])("rejects a human checkpoint inside a body", ({ body }) => {
		expect(() => definition({ body })).toThrow(/Human checkpoints/);
	});

	it("rejects human checkpoints transitively through called recipes", () => {
		const dependencies = [
			{
				engineVersion: "nodes-v1",
				id: "human-child",
				name: "Child",
				steps: [
					{
						id: "approval",
						name: "Approval",
						type: "display",
						document: {
							version: "view-v1",
							components: [
								{
									id: "actions",
									type: "actions",
									data: {
										literal: {
											actions: [{ id: "continue", label: "Continue" }],
										},
									},
								},
							],
						},
					},
				],
				allowedTriggers: ["workflow"],
			},
			{
				engineVersion: "nodes-v1",
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
