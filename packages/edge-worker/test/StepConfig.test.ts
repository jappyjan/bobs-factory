import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	outputFormatCatalog,
	parseStepOutput,
} from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { evaluateRules, RulesSchema } from "../src/factory/Rules.js";
import {
	consumesImpact,
	consumesReview,
	inlineSchemaIssues,
	readOutput,
	readStep,
	resolveStepConfig,
	stockRules,
} from "../src/factory/StepConfig.js";
import {
	AgentStepSchema,
	validateWorkflows,
	WorkflowSchema,
} from "../src/factory/Workflow.js";
import { qaScope } from "./fixtures/qa.js";

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
		id: "factory",
		name: "Modern",
		stepConfigVersion: "step-config-v1",
		steps: [
			{ id: "implement", name: "Generic", type: "agent", prompt: "Read" },
		],
	});
	expect(resolveStepConfig(workflow.steps[0]!).output).toBeUndefined();
});
it("loads actual legacy flags and historical stock roles in memory without rewriting definitions", () => {
	const workflow = WorkflowSchema.parse({
		id: "factory",
		name: "Frozen",
		steps: [
			{
				id: "implement",
				type: "agent",
				name: "Build",
				prompt: "Preserved prompt",
			},
			{
				id: "renamed-inventory",
				type: "agent",
				name: "Scope",
				prompt: "Inventory",
				reviewContract: "inventory-v1",
				askQuestions: true,
			},
		],
	});
	const bytes = JSON.stringify(workflow);
	expect(resolveStepConfig(workflow.steps[0]!).output).toEqual({
		format: "implement-v1",
	});
	expect(resolveStepConfig(workflow.steps[1]!).output).toEqual({
		format: "inventory-v1",
	});
	expect(() =>
		parseStepOutput(workflow.steps[0]!, {
			status: "blocked",
			summary: "Need input",
			checks: [],
			questions: [],
		}),
	).toThrow(OutputValidationError);
	expect(JSON.stringify(workflow)).toBe(bytes);
	const restrictedQa = WorkflowSchema.parse({
		id: "frozen-qa",
		name: "Frozen QA",
		steps: [
			{
				id: "visual-scope",
				type: "agent",
				name: "QA",
				prompt: "QA",
				qaContract: "qa-v1",
				inputs: ["plan"],
			},
		],
	}).steps[0]!;
	expect(readStep(restrictedQa, "scopeClarify")).toBe("clarify");
	expect(readStep(restrictedQa, "scopeDecisions")).toBe("decisions");
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
		rules: [stockRules.implementCompletion],
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
it("publishes stable versioned formats for all contract families", () => {
	const catalog = outputFormatCatalog();
	for (const [format, value] of [
		["improvement-settings-v1", {}],
		[
			"improvement-issue-destination-v1",
			{ provider: "linear", workspaceId: "workspace", teamId: "team" },
		],
		["improvement-item-choice-v1", { action: "ignore" }],
		[
			"improvement-action-v1",
			{
				expectedRevision: 0,
				version: 1,
				digest: "a".repeat(64),
				action: "finish",
			},
		],
	] as const) {
		const step = AgentStepSchema.parse({
			id: "data",
			name: "Data",
			type: "agent",
			prompt: "Return data",
			output: { format },
		});
		expect(() => parseStepOutput(step, value)).not.toThrow();
		expect(resolveStepConfig(step).checks).toEqual([]);
	}
	expect(new Set(catalog.map((format) => format.id)).size).toBe(catalog.length);
	for (const family of [
		"architecture-checkin-v1",
		"impact-v1",
		"inventory-v1",
		"coverage-v1",
		"delivery-contract-v1",
		"improvement-packages-v1",
		"review-brief-v3",
	])
		expect(catalog.some((format) => format.id === family)).toBe(true);
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
		flows: [{ id: "save", steps: ["request", "save"] }],
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

it("reuses every fixed schema-native invariant through a semantic format rule", () => {
	const step = AgentStepSchema.parse({
		id: "custom-qa",
		type: "agent",
		name: "Custom QA",
		prompt: "Return QA",
		output: { format: "json-v1" },
		rules: [
			{ message: "QA scope semantics", require: { conforms: "qa-scope-v1" } },
		],
	});
	const scope = qaScope();
	expect(parseStepOutput(step, scope)).toEqual(scope);
	expect(() =>
		parseStepOutput(step, {
			...scope,
			stories: [...scope.stories, ...scope.stories],
		}),
	).toThrow("QA scope semantics");
	expect(inlineSchemaIssues({ $async: true, type: "string" })).toEqual([
		"/$async: asynchronous schemas are not supported",
	]);
	for (const checks of [
		["files-exist"],
		["media-valid"],
		["code-refs-valid"],
		["ids-resolve"],
	])
		expect(() =>
			validateWorkflows([
				...defaultWorkflows,
				{
					id: "unusable",
					name: "Unusable",
					stepConfigVersion: "step-config-v1",
					steps: [
						{
							id: "agent",
							type: "agent",
							name: "Agent",
							prompt: "Read",
							checks,
						},
					],
				},
			]),
		).toThrow("requires a path selector");
	expect(() =>
		validateWorkflows([
			...defaultWorkflows,
			{
				id: "unknown-rule",
				name: "Unknown",
				stepConfigVersion: "step-config-v1",
				steps: [
					{
						id: "agent",
						type: "agent",
						name: "Agent",
						prompt: "Read",
						rules: [
							{ message: "Unknown", require: { conforms: "missing-v1" } },
						],
					},
				],
			},
		]),
	).toThrow("unknown rule format");
});

it("preserves legacy video scope prevalidation and normalized output exactly", () => {
	const legacy = WorkflowSchema.parse({
		id: "factory",
		name: "Frozen video",
		steps: [
			{
				id: "visual-scope",
				name: "Scope",
				type: "agent",
				prompt: "Scope",
				videoContract: "video-v1",
			},
		],
	}).steps[0]!;
	const raw = { changed: false, areas: [], videoContract: "video-v1" };
	expect(parseStepOutput(legacy, raw)).toEqual({
		changed: false,
		captureBudget: 24,
		areas: [],
	});
	expect(() =>
		parseStepOutput(legacy, { changed: false, areas: [] }),
	).toThrow();
});

it("retains old terminal receipts only for wholly unversioned accepted graphs", async () => {
	const { legacyToolOutput } = await import("../src/factory/StepConfig.js");
	const receipt = { merged: true, headSha: "accepted" };
	const workflow = {
		id: "old",
		steps: [{ id: "finish", type: "agent", prompt: "Complete" }],
	};
	expect(
		legacyToolOutput({ workflow, outputs: { merge: receipt } }, "merge"),
	).toBe(receipt);
	expect(
		legacyToolOutput(
			{
				workflow: { ...workflow, stepConfigVersion: "step-config-v1" },
				outputs: { merge: receipt },
			},
			"merge",
		),
	).toBeUndefined();
	expect(
		legacyToolOutput(
			{
				workflow: {
					...workflow,
					steps: [{ id: "merge", type: "agent", reads: {} }],
				},
				outputs: { merge: receipt },
			},
			"merge",
		),
	).toBeUndefined();
	expect(
		legacyToolOutput(
			{
				workflow: {
					id: "old",
					steps: [{ id: "call", type: "workflow", workflow: "modern" }],
				},
				workflowDefinitions: [
					{ id: "modern", stepConfigVersion: "step-config-v1", steps: [] },
				],
				outputs: { merge: receipt },
			},
			"merge",
		),
	).toBeUndefined();
});

it("keeps inventory and specialist formats usable without activating live evidence protocols", () => {
	const recipes = validateWorkflows([
		...defaultWorkflows,
		{
			id: "format-only",
			name: "Formats on their own",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "specialist",
					name: "Specialist data",
					type: "agent",
					prompt: "Return data",
					output: { format: "specialist-v1" },
				},
				{
					id: "inventory",
					name: "Inventory data",
					type: "agent",
					prompt: "Return data",
					output: { format: "inventory-v1" },
				},
				{
					id: "parallel-observers",
					name: "Parallel data consumers",
					type: "fanout",
					reads: { inventory: "inventory", impact: "specialist" },
					groups: [
						[
							{
								id: "observer",
								name: "Observer",
								type: "agent",
								prompt: "Read data",
							},
						],
					],
				},
			],
		},
	]);
	const step = recipes.at(-1)!.steps[0]!;
	expect(consumesReview(recipes.at(-1)!.steps[2]!)).toBe(false);
	expect(consumesImpact(recipes.at(-1)!.steps[2]!)).toBe(false);
	expect(resolveStepConfig(step).checks).toEqual([]);
	expect(
		parseStepOutput(step, {
			status: "completed",
			summary: "Reviewed",
			findings: [],
		}),
	).toMatchObject({ status: "completed", summary: "Reviewed", findings: [] });
});

it("selecting QA and fixer schemas alone never activates receipts or human recovery", () => {
	for (const format of ["qa-review-v1", "ci-fix-v1", "review-fix-v1"]) {
		const step = AgentStepSchema.parse({
			id: "standalone",
			type: "agent",
			name: "Data only",
			prompt: "Return data",
			output: { format },
		});
		expect(resolveStepConfig(step).checks).toEqual([]);
		expect(resolveStepConfig(step).instructions).toEqual([]);
	}
});
