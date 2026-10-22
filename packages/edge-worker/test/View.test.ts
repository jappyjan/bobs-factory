import { describe, expect, it, vi } from "vitest";
import {
	availableViewPaths,
	bindingValue,
	ResolvedViewSchema,
	resolveView,
	VIEW_JSON_SCHEMA,
	VIEW_LIMITS,
	ViewBindingSchema,
	ViewSchema,
	ViewSourceSchema,
	viewText,
	viewUrlSchema,
} from "../src/factory/View.js";

const sha256 = "a".repeat(64);
const markdown = (data: unknown = { literal: { text: "Hello" } }) => ({
	id: "intro",
	type: "markdown",
	data,
});
const view = (components: unknown[] = [markdown()]) => ({
	version: "view-v1",
	components,
});
const literal = (type: string, data: unknown, title?: string) => ({
	id: type,
	type,
	title,
	data: { literal: data },
});

describe("declarative views and declared read bindings", () => {
	it("validates the envelope and literal data on save and again after resolving a path", () => {
		const saved = ViewSourceSchema.parse(
			view([markdown({ path: "/inputs/brief" })]),
		);
		const data = { text: "Exactly displayed" };
		const resolved = resolveView(saved, { inputs: { brief: data } });
		expect(resolved).toEqual({
			version: "view-v1",
			components: [
				{ id: "intro", type: "markdown", data: { text: "Exactly displayed" } },
			],
		});
		data.text = "Changed later";
		expect(resolved.components[0]!.data).toEqual({ text: "Exactly displayed" });
		expect(() =>
			resolveView(saved, { inputs: { brief: { html: "not a component" } } }),
		).toThrow();
		expect(
			ViewSchema.safeParse(
				view([markdown({ literal: { html: "not a component" } })]),
			).success,
		).toBe(false);
	});

	it("resolves an agent-emitted view only through declared reads", () => {
		const source = ViewSourceSchema.parse({ from: "/inputs/agent/view" });
		expect(
			resolveView(source, { inputs: { agent: { view: view() } } }),
		).toEqual({
			version: "view-v1",
			components: [{ id: "intro", type: "markdown", data: { text: "Hello" } }],
		});
		expect(() =>
			resolveView(source, {
				inputs: {
					agent: {
						view: {
							version: "view-v1",
							components: [{ ...markdown(), approve: true }],
						},
					},
				},
			}),
		).toThrow();
	});

	it("supports escaped pointers and lexical item/index without exposing the caller runtime", () => {
		const scope = {
			inputs: { "a/b": { "~key": { text: "Declared" } } },
			item: { text: "Current item" },
			index: 3,
			outputs: { secret: "Not declared" },
			runtime: { credential: "Private" },
		};
		expect(bindingValue({ path: "/inputs/a~1b/~0key" }, scope)).toEqual({
			text: "Declared",
		});
		expect(bindingValue({ path: "/item" }, scope)).toEqual({
			text: "Current item",
		});
		expect(bindingValue({ path: "/index" }, scope)).toBe(3);
		expect(availableViewPaths(scope)).toEqual([
			"/inputs",
			"/inputs/a~1b",
			"/inputs/a~1b/~0key",
			"/inputs/a~1b/~0key/text",
			"/item",
			"/item/text",
			"/index",
		]);
		expect(availableViewPaths({ inputs: { rows: [{ text: "One" }] } })).toEqual(
			["/inputs", "/inputs/rows", "/inputs/rows/0", "/inputs/rows/0/text"],
		);
	});

	it.each([
		"",
		"/",
		"/outputs/private",
		"/runtime/credential",
		"/inputs/__proto__",
		"/inputs/constructor",
		"/inputs/prototype",
		"/inputs/*",
		"/inputs/a~2b",
		"/inputs/a\n",
		`/inputs${"/a".repeat(200)}`,
	])("rejects unsafe or unavailable pointer syntax %s", (path) => {
		expect(ViewSourceSchema.safeParse(view([markdown({ path })])).success).toBe(
			false,
		);
		expect(ViewSourceSchema.safeParse({ from: path }).success).toBe(false);
	});

	it("fails clearly for a missing declared read or unavailable lexical scope", () => {
		for (const path of ["/inputs/missing", "/item/title", "/index"]) {
			expect(() => bindingValue({ path }, {})).toThrow(/does not resolve/);
		}
		expect(() =>
			bindingValue({ path: "/inputs/a" }, { inputs: [] } as never),
		).toThrow(/declared-read object/);
		expect(() => bindingValue({ path: "/index" }, { index: -1 })).toThrow(
			/index/,
		);
	});

	it("keeps declared-source and literal snapshots detached from caller mutations", () => {
		const input = { text: "Original" };
		const first = bindingValue({ literal: input }, {});
		const second = bindingValue(
			{ path: "/inputs/value" },
			{ inputs: { value: input } },
		);
		input.text = "Replaced";
		expect(first).toEqual({ text: "Original" });
		expect(second).toEqual({ text: "Original" });
		expect(ViewBindingSchema.safeParse({}).success).toBe(false);
		expect(ViewBindingSchema.safeParse({ literal: undefined }).success).toBe(
			false,
		);
		expect(bindingValue({ literal: null }, {})).toBeNull();
	});

	it("bounds available-path discovery without traversing private extra roots", () => {
		const privateRead = vi.fn(() => {
			throw new Error("must not inspect private runtime");
		});
		const scope = {
			inputs: Object.fromEntries(
				Array.from({ length: 600 }, (_, index) => [`p${index}`, index]),
			),
		};
		Object.defineProperty(scope, "runtime", { get: privateRead });
		const paths = availableViewPaths(scope);
		expect(paths.length).toBe(VIEW_LIMITS.paths);
		expect(privateRead).not.toHaveBeenCalled();
		const nested = {
			child: {
				child: {
					child: {
						child: {
							child: { child: { child: { child: { child: "deep" } } } },
						},
					},
				},
			},
		};
		expect(
			Math.max(
				...availableViewPaths({ inputs: nested }).map(
					(path) => path.split("/").length - 2,
				),
			),
		).toBe(VIEW_LIMITS.pathDepth);
	});

	it.each([
		{ version: "view-v2", components: [markdown()] },
		{ ...view(), script: "return true" },
		view([{ ...markdown(), type: "html" }]),
		view([{ ...markdown(), id: "constructor" }, markdown()]),
		view([{ ...markdown(), href: "https://example.com" }]),
		view([markdown(), markdown()]),
		view([]),
		view(
			Array.from({ length: VIEW_LIMITS.components + 1 }, (_, index) => ({
				...markdown(),
				id: `c${index}`,
			})),
		),
	])("rejects unsupported, ambiguous or oversized definitions", (source) => {
		expect(ViewSchema.safeParse(source).success).toBe(false);
	});

	it("publishes a JSON schema describing all declarative component types", () => {
		expect(VIEW_JSON_SCHEMA.type).toBe("object");
		expect(VIEW_JSON_SCHEMA.additionalProperties).toBe(false);
		expect(JSON.stringify(VIEW_JSON_SCHEMA)).not.toMatch(
			/function|javascript:/,
		);
	});

	it("accepts inherited For each identity syntax and all public child-run statuses", () => {
		const source = ViewSourceSchema.parse(
			view([
				literal("itemCards", {
					items: [
						{ id: "_first", title: "First" },
						{ id: "-next", title: "Next" },
					],
				}),
				literal("runList", {
					waves: [
						{
							id: "wave",
							runs: ["launched", "merged", "blocked", "uncertain"].map(
								(status) => ({ id: status, title: status, status }),
							),
						},
					],
				}),
			]),
		);
		expect(resolveView(source, {}).components).toHaveLength(2);
	});

	it("rejects ambiguous form identities across literal and bound components", () => {
		const fields = {
			fields: [{ id: "answer", label: "Answer", type: "text" }],
		};
		expect(
			ViewSchema.safeParse(
				view([
					{ ...literal("choices", fields), id: "first" },
					{ ...literal("choices", fields), id: "second" },
				]),
			).success,
		).toBe(false);
		const source = ViewSourceSchema.parse(
			view([
				{ id: "first", type: "choices", data: { path: "/inputs/first" } },
				{ id: "second", type: "choices", data: { path: "/inputs/second" } },
			]),
		);
		expect(() =>
			resolveView(source, { inputs: { first: fields, second: fields } }),
		).toThrow(/unique across components/);
	});

	it("bounds total child-run rows and rejects contradictory duplicate children across waves", () => {
		const run = { id: "child", title: "Child", status: "running" };
		for (const waves of [
			[
				{ id: "one", runs: [run] },
				{ id: "two", runs: [{ ...run, status: "merged" }] },
			],
			[
				{
					id: "one",
					runs: Array.from({ length: 51 }, (_, index) => ({
						...run,
						id: `first${index}`,
					})),
				},
				{
					id: "two",
					runs: Array.from({ length: 50 }, (_, index) => ({
						...run,
						id: `next${index}`,
					})),
				},
			],
		])
			expect(
				ViewSchema.safeParse(view([literal("runList", { waves })])).success,
			).toBe(false);
	});
});

describe("component field bindings and collection projections", () => {
	it.each([
		0, 1, 2, 3, 4, 5,
	])("displays exactly %i accepted plans and the three Check results without duplicate display data", (count) => {
		const plans = Array.from({ length: count }, (_, index) => ({
			id: `plan-${index}`,
			title: `Actual plan ${index}`,
			plan: `Exact implementation plan ${index}\nKeep the accepted scope.`,
			privateNote: "Not projected",
		}));
		const checks = [
			{ id: "scope", title: "Scope check", result: "Matches accepted scope" },
			{ id: "safety", title: "Safety check", result: "No unsafe effects" },
			{ id: "proof", title: "Proof check", result: "Evidence is present" },
		];
		const source = ViewSourceSchema.parse(
			view([
				markdown({ bindings: { text: { path: "/inputs/proposals/summary" } } }),
				{
					id: "plans",
					type: "itemCards",
					data: {
						bindings: {
							items: {
								from: "/inputs/batch/plans",
								map: { id: "/id", title: "/title", body: "/plan" },
							},
						},
					},
				},
				{
					id: "checks",
					type: "itemCards",
					data: {
						bindings: {
							items: {
								from: "/inputs/checks",
								map: { id: "/id", title: "/title", body: "/result" },
							},
						},
					},
				},
				{
					id: "limitations",
					type: "points",
					data: {
						bindings: {
							items: {
								from: "/inputs/proposals/limitations",
								map: { label: "" },
							},
						},
					},
				},
			]),
		);
		const resolved = resolveView(source, {
			inputs: {
				proposals: {
					summary: "Actual summary",
					limitations: ["Known limitation"],
				},
				batch: { plans },
				checks,
			},
		});
		expect(resolved).toEqual({
			version: "view-v1",
			components: [
				{ id: "intro", type: "markdown", data: { text: "Actual summary" } },
				{
					id: "plans",
					type: "itemCards",
					data: {
						items: plans.map(({ id, title, plan }) => ({
							id,
							title,
							body: plan,
						})),
					},
				},
				{
					id: "checks",
					type: "itemCards",
					data: {
						items: checks.map(({ id, title, result }) => ({
							id,
							title,
							body: result,
						})),
					},
				},
				{
					id: "limitations",
					type: "points",
					data: { items: [{ label: "Known limitation" }] },
				},
			],
		});
		checks[0]!.result = "Changed after display";
		expect(resolved.components[2]!.data).toEqual({
			items: [
				{ id: "scope", title: "Scope check", body: "Matches accepted scope" },
				{ id: "safety", title: "Safety check", body: "No unsafe effects" },
				{ id: "proof", title: "Proof check", body: "Evidence is present" },
			],
		});
	});

	it("combines literal fields, escaped item pointers and public lexical bindings", () => {
		const source = ViewSourceSchema.parse(
			view([
				{
					id: "chart",
					type: "chart",
					data: {
						bindings: {
							kind: { literal: "bar" },
							unit: { path: "/item/unit" },
							series: {
								from: "/item/rows",
								map: { label: "/a~1b/~0key", value: "/value" },
							},
						},
					},
				},
				{
					id: "code",
					type: "code",
					data: {
						bindings: {
							file: { literal: "src/view.ts" },
							startLine: { path: "/index" },
						},
					},
				},
			]),
		);
		const scope = {
			item: {
				unit: "seconds",
				rows: [{ "a/b": { "~key": "Exact label" }, value: 3 }],
			},
			index: 2,
		};
		expect(resolveView(source, scope)).toEqual({
			version: "view-v1",
			components: [
				{
					id: "chart",
					type: "chart",
					data: {
						kind: "bar",
						unit: "seconds",
						series: [{ label: "Exact label", value: 3 }],
					},
				},
				{
					id: "code",
					type: "code",
					data: { file: "src/view.ts", startLine: 2 },
				},
			],
		});
	});

	const pointsProjection = (
		from = "/inputs/rows",
		map: unknown = { label: "" },
	) =>
		view([
			{
				id: "points",
				type: "points",
				data: { bindings: { items: { from, map } } },
			},
		]);

	it("bounds collections at 100 items and maps at 20 fields", () => {
		const source = ViewSourceSchema.parse(pointsProjection());
		const rows = Array.from({ length: 100 }, (_, index) => `Row ${index}`);
		expect(
			resolveView(source, { inputs: { rows } }).components[0]!.data,
		).toEqual({
			items: rows.map((label) => ({ label })),
		});
		expect(() =>
			resolveView(source, { inputs: { rows: [...rows, "Overflow"] } }),
		).toThrow(/at most 100/);
		const map = Object.fromEntries(
			Array.from({ length: 20 }, (_, index) => [`field${index}`, ""]),
		);
		expect(
			ViewSchema.safeParse(pointsProjection("/inputs/rows", map)).success,
		).toBe(true);
		expect(
			ViewSchema.safeParse(
				pointsProjection("/inputs/rows", { ...map, overflow: "" }),
			).success,
		).toBe(false);
		expect(
			ViewSchema.safeParse(pointsProjection("/inputs/rows", {})).success,
		).toBe(false);
	});

	it.each([
		{ bindings: { html: { literal: "<script>run()</script>" } } },
		{ bindings: { id: { literal: "replace-component-id" } } },
		{ bindings: { text: { path: "/runtime/secret" } } },
		{ bindings: { text: { path: "/outputs/private" } } },
		{ bindings: { text: { literal: "x", path: "/inputs/text" } } },
		{ bindings: { text: { literal: "x", script: "return approve()" } } },
		{ bindings: { text: { bindings: { text: { literal: "recursive" } } } } },
		{ bindings: { text: { literal: "x" } }, path: "/inputs/data" },
	])("rejects non-schema fields, private roots and expression syntax", (data) => {
		expect(ViewSchema.safeParse(view([markdown(data)])).success).toBe(false);
	});

	it.each([
		{ label: { path: "/title" } },
		{ label: { from: "/children", map: { label: "/title" } } },
		{ label: "/constructor" },
		{ label: "/prototype" },
		{ label: "/__proto__/secret" },
		{ label: "/title~2" },
		{ label: "/title\n" },
		{ label: "/*" },
		{ label: "return item.title" },
		{ constructor: "/title" },
		{ prototype: "/title" },
		JSON.parse('{"__proto__":"/title"}'),
	])("rejects unsafe keys, pointers and recursive maps", (map) => {
		expect(
			ViewSchema.safeParse(pointsProjection("/inputs/rows", map)).success,
		).toBe(false);
	});

	it("cannot reach host scope or resolve item pointers against the outer scope", () => {
		for (const from of [
			"/runtime/rows",
			"/outputs/rows",
			"/inputs/__proto__",
			"/inputs/*",
		])
			expect(ViewSchema.safeParse(pointsProjection(from)).success).toBe(false);
		const privateRead = vi.fn(() => {
			throw new Error("private host data");
		});
		const scope = Object.defineProperty(
			{ inputs: { rows: ["Declared"] } },
			"runtime",
			{ get: privateRead },
		);
		expect(
			resolveView(ViewSourceSchema.parse(pointsProjection()), scope)
				.components[0]!.data,
		).toEqual({ items: [{ label: "Declared" }] });
		expect(privateRead).not.toHaveBeenCalled();
		const source = ViewSourceSchema.parse(
			pointsProjection("/inputs/rows", { label: "/inputs/secret" }),
		);
		expect(() =>
			resolveView(source, { inputs: { secret: "outer", rows: [{}] } }),
		).toThrow(/does not resolve/);
	});

	it("rejects missing or non-array sources and missing item fields without coercion", () => {
		const source = ViewSourceSchema.parse(pointsProjection());
		for (const rows of [null, "text", 3, { label: "not an array" }])
			expect(() => resolveView(source, { inputs: { rows } })).toThrow(
				/must be an array/,
			);
		expect(() => resolveView(source, {})).toThrow(/does not resolve/);
		expect(() =>
			resolveView(
				ViewSourceSchema.parse(
					pointsProjection("/inputs/rows", { label: "/title" }),
				),
				{ inputs: { rows: [{}] } },
			),
		).toThrow(/does not resolve/);
	});

	it("never executes getters or toJSON in definitions or source items", () => {
		const getter = vi.fn(() => "/title");
		const toJSON = vi.fn(() => ({ title: "forged" }));
		const map = Object.defineProperty({}, "label", {
			enumerable: true,
			get: getter,
		});
		expect(
			ViewSchema.safeParse(pointsProjection("/inputs/rows", map)).success,
		).toBe(false);
		const source = ViewSourceSchema.parse(
			pointsProjection("/inputs/rows", { label: "/title" }),
		);
		for (const item of [
			Object.defineProperty({}, "title", { enumerable: true, get: getter }),
			{ title: "x", toJSON },
			Object.create({ title: "inherited" }),
		])
			expect(() => resolveView(source, { inputs: { rows: [item] } })).toThrow();
		expect(getter).not.toHaveBeenCalled();
		expect(toJSON).not.toHaveBeenCalled();
	});

	it("applies the unchanged resolved schemas to projected and literal field values", () => {
		for (const data of [
			{ bindings: { text: { literal: 42 } } },
			{ bindings: { text: { literal: "x".repeat(16_001) } } },
			{ bindings: {} },
		]) {
			const source = ViewSourceSchema.parse(view([markdown(data)]));
			expect(() => resolveView(source, {})).toThrow();
		}
		const source = ViewSourceSchema.parse(
			pointsProjection("/inputs/rows", { label: "/label", url: "/url" }),
		);
		expect(() =>
			resolveView(source, {
				inputs: { rows: [{ label: "Unsafe", url: "javascript:alert(1)" }] },
			}),
		).toThrow(/HTTP/);
		const extra = ViewSourceSchema.parse(
			pointsProjection("/inputs/rows", { label: "/label", action: "/action" }),
		);
		expect(() =>
			resolveView(extra, {
				inputs: { rows: [{ label: "Authority", action: "approve" }] },
			}),
		).toThrow();
		const scalar = ViewSourceSchema.parse(
			view([markdown({ bindings: { text: { path: "/inputs/value" } } })]),
		);
		expect(() => resolveView(scalar, { inputs: { value: true } })).toThrow();
		const cards = ViewSourceSchema.parse(
			view([
				{
					id: "cards",
					type: "itemCards",
					data: {
						bindings: {
							items: {
								from: "/inputs/rows",
								map: { id: "/id", title: "/title" },
							},
						},
					},
				},
			]),
		);
		expect(() =>
			resolveView(cards, {
				inputs: {
					rows: [
						{ id: "same", title: "First" },
						{ id: "same", title: "Second" },
					],
				},
			}),
		).toThrow(/unique/);
	});
});

describe("view JSON boundary and safe references", () => {
	it("never executes accessors, toJSON or inherited hooks", () => {
		const getter = vi.fn(() => "never");
		const accessor = Object.defineProperty({}, "text", {
			enumerable: true,
			get: getter,
		});
		expect(
			ViewSchema.safeParse(view([markdown({ literal: accessor })])).success,
		).toBe(false);
		const toJSON = vi.fn(() => ({ text: "forged" }));
		expect(
			ViewSchema.safeParse(view([markdown({ literal: { text: "x", toJSON } })]))
				.success,
		).toBe(false);
		expect(
			ViewSchema.safeParse(
				view([markdown({ literal: Object.create({ text: "inherited" }) })]),
			).success,
		).toBe(false);
		const scope = Object.defineProperty({}, "inputs", { get: getter });
		expect(() => availableViewPaths(scope)).toThrow(/accessors/);
		expect(getter).not.toHaveBeenCalled();
		expect(toJSON).not.toHaveBeenCalled();
	});

	it("rejects unsafe own keys, symbols, hidden properties, cycles and non-JSON data", () => {
		const cycle: { again?: unknown } = {};
		cycle.again = cycle;
		const values = [
			JSON.parse('{"__proto__":{"polluted":true}}'),
			{ constructor: {} },
			{ prototype: {} },
			{ [Symbol("private")]: true },
			Object.defineProperty({}, "secret", { value: true }),
			cycle,
			new Date(),
			Number.POSITIVE_INFINITY,
			1n,
			() => "x",
		];
		for (const value of values)
			expect(ViewBindingSchema.safeParse({ literal: value }).success).toBe(
				false,
			);
		expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
	});

	it("rejects sparse/augmented arrays and depth/byte complexity limits", () => {
		const sparse = new Array(2);
		const augmented = Object.assign(["row"], { extra: "hidden semantics" });
		let depth: unknown = "leaf";
		for (let index = 0; index < 34; index++) depth = { child: depth };
		for (const value of [sparse, augmented, depth, "a".repeat(1_000_001)]) {
			expect(ViewBindingSchema.safeParse({ literal: value }).success).toBe(
				false,
			);
		}
	});

	it.each([
		"javascript:alert(1)",
		"data:text/html,<script>1</script>",
		"file:///etc/passwd",
		"//evil.example/path",
		"https://user:password@example.com",
		"https://user@example.com",
		"not a url",
		"https://example.com/\nsecret",
	])("rejects unsafe view URLs %s", (url) => {
		expect(viewUrlSchema.safeParse(url).success).toBe(false);
		expect(
			ViewSchema.safeParse(
				view([literal("points", { items: [{ label: "Link", url }] })]),
			).success,
		).toBe(false);
	});

	it("permits credential-free HTTP(S) display links", () => {
		for (const url of [
			"https://example.com/docs#part",
			"http://localhost:3000/test?q=one",
		]) {
			expect(viewUrlSchema.parse(url)).toBe(url);
		}
	});

	it.each([
		[
			"screenshots",
			{
				items: [
					{
						index: 0,
						sha256,
						alt: "Image",
						url: "https://evil.example/image.png",
					},
				],
			},
		],
		[
			"screenshots",
			{ items: [{ index: 0, sha256, alt: "Image", runId: "another-run" }] },
		],
		["screenshots", { items: [{ index: 0, sha256: "bad", alt: "Image" }] }],
		[
			"video",
			{
				taskId: "clip",
				sha256,
				label: "Clip",
				transcript: "Text",
				path: "/etc/private",
			},
		],
		["video", { taskId: "../clip", sha256, label: "Clip", transcript: "Text" }],
		["code", { file: "../private.txt" }],
		["code", { file: "/etc/passwd" }],
		["code", { file: "C:\\private" }],
		["code", { file: ".git/config" }],
		["code", { file: "file:///private" }],
		["code", { file: "src/a.ts", endLine: 4 }],
		["code", { file: "src/a.ts", startLine: 5, endLine: 4 }],
	])("rejects unsafe %s media/code refs", (type, data) => {
		expect(ViewSchema.safeParse(view([literal(type, data)])).success).toBe(
			false,
		);
	});

	it.each([
		["table", { columns: ["One", "Two"], rows: [["one"]] }],
		["chart", { kind: "script", series: [] }],
		[
			"chart",
			{
				kind: "bar",
				series: [{ label: "Large", value: Number.POSITIVE_INFINITY }],
			},
		],
		[
			"itemCards",
			{
				items: [
					{ id: "one", title: "First" },
					{ id: "one", title: "Second" },
				],
			},
		],
		[
			"itemCards",
			{ items: [{ id: "one", title: "First", action: "approve" }] },
		],
		[
			"choices",
			{ fields: [{ id: "x", label: "X", type: "checkbox", value: "yes" }] },
		],
		[
			"choices",
			{
				fields: [
					{
						id: "x",
						label: "X",
						type: "select",
						options: [{ id: "a", label: "A" }],
						value: "b",
					},
				],
			},
		],
		[
			"choices",
			{
				fields: [
					{
						id: "x",
						label: "X",
						type: "select",
						options: [
							{ id: "a", label: "A" },
							{ id: "a", label: "Again" },
						],
					},
				],
			},
		],
		[
			"decisionBar",
			{
				actions: [
					{
						id: "approve",
						label: "Approve",
						url: "https://example.com/approve",
					},
				],
			},
		],
		[
			"runList",
			{
				waves: [
					{
						id: "one",
						runs: [{ id: "child", title: "Task", status: "green-ish" }],
					},
				],
			},
		],
	])("rejects invalid %s component data both literal and bound", (type, data) => {
		expect(ViewSchema.safeParse(view([literal(type, data)])).success).toBe(
			false,
		);
		const source = ViewSourceSchema.parse(
			view([{ id: "dynamic", type, data: { path: "/inputs/data" } }]),
		);
		expect(() => resolveView(source, { inputs: { data } })).toThrow();
	});
});

describe("plain-text component fallbacks", () => {
	it("provides meaningful text for every component, including forms, waves, statuses and actions", () => {
		const definition = ViewSourceSchema.parse(
			view([
				literal("markdown", { text: "A brief introduction" }, "Summary"),
				literal("checklist", {
					items: [
						{ label: "Tests", state: "done", detail: "Passed" },
						{ label: "Review", state: "partly" },
						{ label: "Ship", state: "open" },
					],
				}),
				literal("beforeAfter", {
					before: "Old behavior",
					after: "New behavior",
					note: "Why it changed",
				}),
				literal("chart", {
					kind: "bar",
					series: [
						{ label: "Before", value: 5 },
						{ label: "After", value: 2 },
					],
					unit: "seconds",
				}),
				literal("screenshots", {
					items: [
						{ index: 0, sha256, alt: "The decision screen", caption: "Mobile" },
					],
				}),
				literal("video", {
					taskId: "clip",
					sha256,
					label: "Demonstration",
					transcript: "Open the page and choose Fix",
				}),
				literal("table", {
					columns: ["Check", "Value"],
					rows: [
						["Count", 2],
						["Active", true],
						["Pending", null],
					],
				}),
				literal("code", {
					file: "src/view.ts",
					startLine: 5,
					endLine: 9,
					language: "ts",
					excerpt: "const safe = true;",
				}),
				literal("steps", {
					items: [
						{
							label: "Inspect",
							status: "completed",
							detail: "Read the report",
						},
						{ label: "Decide" },
					],
				}),
				literal("points", {
					items: [
						{
							label: "Documentation",
							detail: "Read more",
							url: "https://example.com/docs",
						},
					],
				}),
				literal("itemCards", {
					items: [
						{
							id: "finding",
							title: "A concrete finding",
							body: "The report",
							details: [{ label: "Location", value: "src/file.ts" }],
						},
					],
				}),
				literal("choices", {
					fields: [
						{
							id: "name",
							type: "text",
							label: "Name",
							required: true,
							value: "Jo",
						},
						{ id: "notes", type: "textarea", label: "Notes" },
						{ id: "ready", type: "checkbox", label: "Ready", value: false },
						{
							id: "route",
							type: "select",
							label: "Route",
							options: [
								{ id: "fix", label: "Fix" },
								{ id: "skip", label: "Skip" },
							],
							value: "fix",
						},
					],
				}),
				literal("runList", {
					waves: [
						{
							id: "first",
							label: "First",
							runs: [
								{
									id: "child",
									title: "Fix a bug",
									status: "waiting",
									note: "Needs approval",
								},
							],
						},
						{ id: "next", runs: [] },
					],
				}),
				literal("decisionBar", {
					summary: "One choice remains",
					actions: [
						{ id: "approve", label: "Approve" },
						{ id: "changes", label: "Request changes" },
					],
				}),
			]),
		);
		expect(viewText(resolveView(definition, {}))).toBe(
			[
				"Summary\nA brief introduction",
				"checklist:\n- [x] Tests — Passed\n- [~] Review\n- [ ] Ship",
				"beforeAfter:\nBefore: Old behavior\nAfter: New behavior\nWhy it changed",
				"chart:\nBar chart (seconds)\n- Before: 5\n- After: 2",
				`screenshots:\n- Screenshot 1: The decision screen — Mobile (SHA-256 ${sha256})`,
				`video:\nVideo: Demonstration (SHA-256 ${sha256})\nTranscript: Open the page and choose Fix`,
				"table:\nCheck: Count; Value: 2\nCheck: Active; Value: true\nCheck: Pending; Value: —",
				"code:\nFile: src/view\\.ts, line 5–9\nLanguage: ts\nconst safe = true;",
				"steps:\n1. Inspect [completed] — Read the report\n2. Decide",
				"points:\n- Documentation — Read more (https\\://example\\.com/docs)",
				"itemCards:\nfinding: A concrete finding\nThe report\n  Location: src/file\\.ts",
				"choices:\nName (name, text, required): Jo\nNotes (notes, textarea, optional)\nReady (ready, checkbox, optional): false\nRoute (route, select, optional): fix\n  - fix: Fix\n  - skip: Skip",
				"runList:\nWave First:\n- child: Fix a bug [waiting] — Needs approval\nWave next:\nNo child runs in this wave.",
				"decisionBar:\nOne choice remains\nAvailable actions: approve (Approve), changes (Request changes)",
			].join("\n\n"),
		);
	});

	it.each([
		"literal",
		"bindings",
	])("leaves %s HTML, script, Markdown and terminal escape strings inert", (source) => {
		const dangerous =
			"<script>alert(1)</script> [open](javascript:alert(1))\u001b]8;;https://evil.test\u0007**approve**";
		const rendered = resolveView(
			ViewSourceSchema.parse(
				view([
					markdown(
						source === "literal"
							? { literal: { text: dangerous } }
							: { bindings: { text: { path: "/inputs/text" } } },
					),
				]),
			),
			{ inputs: { text: dangerous } },
		);
		expect(rendered.components[0]!.data).toEqual({ text: dangerous });
		expect(viewText(rendered)).toBe(
			"markdown:\n&lt;script&gt;alert\\(1\\)&lt;/script&gt; \\[open\\]\\(javascript\\:alert\\(1\\)\\)\\[U\\+001B\\]\\]8;;https\\://evil\\.test\\[U\\+0007\\]\\*\\*approve\\*\\*",
		);
	});

	it("revalidates untrusted resolved data before producing a fallback", () => {
		const getter = vi.fn(() => "not read");
		const supplied = {
			version: "view-v1",
			components: [
				{
					id: "intro",
					type: "markdown",
					data: Object.defineProperty({}, "text", {
						get: getter,
						enumerable: true,
					}),
				},
			],
		};
		expect(ResolvedViewSchema.safeParse(supplied).success).toBe(false);
		expect(() => viewText(supplied as never)).toThrow();
		expect(getter).not.toHaveBeenCalled();
	});

	it("bounds lengthy fallback output and tells the reader when content is omitted", () => {
		const definition = ViewSourceSchema.parse(
			view(
				Array.from({ length: 5 }, (_, index) => ({
					...markdown({ literal: { text: "x".repeat(16_000) } }),
					id: `part${index}`,
				})),
			),
		);
		const text = viewText(resolveView(definition, {}));
		expect(text.length).toBeLessThan(VIEW_LIMITS.text + 100);
		expect(
			text.endsWith(
				"\n[View truncated; open the dashboard for all displayed content.]",
			),
		).toBe(true);
	});
});
