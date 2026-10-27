import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseStepOutput } from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { evaluateRules, RulesSchema } from "../src/factory/Rules.js";
import {
	inlineSchemaIssues,
	readOutput,
	resolveStepConfig,
} from "../src/factory/StepConfig.js";
import {
	AgentStepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";

it("never interprets a modern optional setting or an unconfigured agent by its ID", () => {
	for (const settings of [
		{},
		{ reads: {} },
		{ revision: "bound" },
		{ access: "read-only" },
		{ checks: [] },
		{ instructions: [] },
		{ rules: [] },
	]) {
		const step = AgentStepSchema.parse({
			id: "implement",
			name: "Generic",
			type: "agent",
			prompt: "Read",
			...settings,
		});
		expect(resolveStepConfig(step).output).toBeUndefined();
		expect(parseStepOutput(step, { ordinary: "result" })).toEqual({
			ordinary: "result",
		});
	}
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "factory",
		name: "Modern",
		stepConfigVersion: "step-config-v1",
		steps: [
			{ id: "implement", name: "Generic", type: "agent", prompt: "Read" },
		],
	});
	expect(resolveStepConfig(workflow.steps[0]!).output).toBeUndefined();
});

it("validates inline schemas at save and uses the existing correction error for schema or cross-field failures", () => {
	expect(
		inlineSchemaIssues({
			type: "object",
			properties: { status: { type: "string" } },
		}),
	).toEqual([]);
	expect(inlineSchemaIssues({ type: "imaginary" }).length).toBeGreaterThan(0);
	expect(inlineSchemaIssues({ $ref: "https://example.test/schema" })).toEqual([
		"/$ref: only local references (#/...) are allowed",
	]);
	const step = AgentStepSchema.parse({
		id: "anything",
		type: "agent",
		name: "Custom",
		prompt: "Return data",
		output: {
			schema: {
				type: "object",
				properties: {
					status: { enum: ["completed", "blocked"] },
					questions: { type: "array", items: { type: "string" } },
					architectureRevision: { type: "boolean" },
				},
				required: ["status", "questions"],
				additionalProperties: false,
			},
		},
		rules: [
			{
				message: "Must complete",
				require: {
					all: [
						{ path: "/status", equals: "completed" },
						{ path: "/questions", maxLength: 0 },
					],
				},
			},
		],
	});
	expect(() =>
		parseStepOutput(step, { status: "completed", questions: ["Why?"] }),
	).toThrow(OutputValidationError);
	expect(() =>
		parseStepOutput(step, { status: "unknown", questions: [] }),
	).toThrow(OutputValidationError);
	expect(parseStepOutput(step, { status: "completed", questions: [] })).toEqual(
		{ status: "completed", questions: [] },
	);
	for (const config of [
		{ output: { format: "missing-v1" } },
		{ checks: ["missing"] },
		{ instructions: ["missing"] },
		{ output: { schema: { $ref: "https://example.test/schema" } } },
	])
		expect(() =>
			validateWorkflows([
				...defaultWorkflows,
				{
					engineVersion: "nodes-v1",
					id: "invalid",
					name: "Invalid",
					stepConfigVersion: "step-config-v1",
					steps: [
						{
							id: "check",
							type: "agent",
							name: "Check",
							prompt: "Check",
							...config,
						},
					],
				},
			]),
		).toThrow();
});
it("resolves renamed output reads and nested values", () => {
	const step = {
		reads: { plan: "renamed/plan", scope: { from: "other/requirements/0" } },
	};
	expect(readOutput(step, "plan", { renamed: { plan: "Accepted" } })).toBe(
		"Accepted",
	);
	expect(
		readOutput(step, "scope", { other: { requirements: [{ id: "one" }] } }),
	).toEqual({ id: "one" });
});
it("expresses implication, unique IDs, references, bounded counts and filtered nested constraints as data", () => {
	const rules = [
		{
			message: "Unique IDs",
			require: { path: "/items", unique: true as const, by: "/id" },
		},
		{
			message: "Known references",
			require: { path: "/references", within: "/items/*/id" },
		},
		{
			message: "Completed has no blockers",
			when: { path: "/status", equals: "completed" },
			require: { path: "/blockers", empty: true },
		},
		{
			message: "Budget",
			require: { count: "/items", max: { path: "/budget" } },
		},
		{
			message: "Every selected item has evidence",
			require: {
				each: "/items",
				where: { path: "/selected", equals: true },
				require: { path: "/evidence", minLength: 1 },
			},
		},
	];
	expect(RulesSchema.parse(rules)).toEqual(rules);
	expect(
		evaluateRules(rules, {
			status: "completed",
			blockers: [],
			budget: 2,
			items: [{ id: "a", selected: true, evidence: ["proof"] }],
			references: ["a"],
		}),
	).toEqual([]);
	expect(
		evaluateRules(rules, {
			status: "completed",
			blockers: ["missing"],
			budget: 1,
			items: [{ id: "a", selected: true }, { id: "a" }],
			references: ["unknown"],
		}).map((issue) => issue.message),
	).toEqual([
		"Unique IDs",
		"Known references",
		"Completed has no blockers",
		"Budget",
		"Every selected item has evidence",
	]);
	let nested: unknown = { path: "/status", equals: "done" };
	for (let i = 0; i < 100; i++) nested = { not: nested };
	expect(
		RulesSchema.safeParse([{ message: "Too deep", require: nested }]).success,
	).toBe(false);
});

it("supports safe crop arithmetic, tuple uniqueness, table widths and cross-output flow lookups", () => {
	const rules = RulesSchema.parse([
		{
			message: "Crop fits",
			require: {
				compare: {
					left: { sum: [{ path: "/crop/x" }, { path: "/crop/w" }] },
					op: "lte",
					right: 100.5,
				},
			},
		},
		{
			message: "Directed pairs unique",
			require: { path: "/edges", unique: true, by: ["/from", "/to"] },
		},
		{
			message: "Table widths",
			require: { sameLength: { items: "/rows/*/cells", as: "/columns" } },
		},
		{
			message: "Files appear once",
			require: {
				distinct: ["/tour/*/file", "/tour/*/related/*", "/tour/*/same/*"],
			},
		},
		{
			message: "Flow exists and steps resolve",
			require: {
				lookup: { collection: "/flows", key: "/id", value: "/proof/flow" },
				require: {
					path: "/item/proof/steps",
					maxItem: { length: "/match/steps" },
				},
			},
		},
	]);
	const valid = {
		crop: { x: 30, w: 70 },
		edges: [
			{ from: "one", to: "two" },
			{ from: "two", to: "one" },
		],
		columns: ["Given", "Observed"],
		rows: [{ cells: ["A", "B"] }],
		tour: [{ file: "one.ts", related: ["one.test.ts"], same: ["two.ts"] }],
		flows: [
			{ engineVersion: "nodes-v1", id: "save", steps: ["request", "save"] },
		],
		proof: { flow: "save", steps: [1, 2] },
	};
	expect(evaluateRules(rules, valid)).toEqual([]);
	expect(
		evaluateRules(rules, {
			...valid,
			crop: { x: 80, w: 40 },
			edges: [
				{ from: "one", to: "two" },
				{ from: "one", to: "two" },
			],
			rows: [{ cells: ["A"] }],
			tour: [{ file: "one.ts", related: ["one.ts"] }],
			proof: { flow: "save", steps: [3] },
		}).map((issue) => issue.message),
	).toEqual([
		"Crop fits",
		"Directed pairs unique",
		"Table widths",
		"Files appear once",
		"Flow exists and steps resolve",
	]);
});
