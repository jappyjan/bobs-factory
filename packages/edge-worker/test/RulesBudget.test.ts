import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import {
	evaluateCondition,
	evaluateRules,
	evaluateRulesAsync,
	type Rule,
} from "../src/factory/Rules.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const lookup: Rule[] = [
	{
		message: "Lookup every ID",
		require: {
			each: "/items",
			require: {
				lookup: { collection: "$/items", key: "/id", value: "/id" },
				require: { path: "/match/id", exists: true },
			},
		},
	},
];
function acceptedStep(rules: Rule[], output = true) {
	return validateWorkflows([
		...defaultWorkflows,
		{
			id: "rule-budget",
			name: "Rule budget",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "ordinary",
					name: "Ordinary",
					type: "agent",
					prompt: "Return data",
					...(output ? { output: { format: "json-v1" } } : {}),
					rules,
					checks: [],
					instructions: [],
					next: "end",
				},
			],
		},
	]).at(-1)!.steps[0]!;
}
it.each([
	5000, 20000,
])("bounds accepted %i-item lookup work while timers stay responsive", async (count) => {
	const step = acceptedStep(lookup),
		value = { items: Array.from({ length: count }, (_, id) => ({ id })) };
	const started = Date.now();
	let ticks = 0,
		maxDelay = 0,
		last = started;
	const timer = setInterval(() => {
		const now = Date.now();
		maxDelay = Math.max(maxDelay, now - last);
		last = now;
		ticks++;
	}, 1);
	try {
		const result = parseStepOutputAsync(step, value);
		await expect(result).rejects.toBeInstanceOf(OutputValidationError);
		await expect(result).rejects.toThrow("evaluation operation limit");
		expect(ticks).toBeGreaterThan(0);
		expect(maxDelay).toBeLessThan(1000);
		expect(Date.now() - started).toBeLessThan(3000);
	} finally {
		clearInterval(timer);
	}
});
it.each([
	true,
	false,
])("cancels accepted expensive rules without turning abort into correction (output=%s)", async (output) => {
	const controller = new AbortController(),
		step = acceptedStep(lookup, output);
	const pending = parseStepOutputAsync(
		step,
		{ items: Array.from({ length: 20000 }, (_, id) => ({ id })) },
		undefined,
		controller.signal,
	);
	setTimeout(
		() => controller.abort(new DOMException("Stop rules", "AbortError")),
		5,
	);
	await expect(pending).rejects.toMatchObject({
		name: "AbortError",
		message: "Stop rules",
	});
	await expect(
		evaluateRulesAsync(lookup, { items: [{ id: 1 }, { id: 2 }] }),
	).resolves.toEqual([]);
});
it.each([
	{
		message: "Nested count",
		require: {
			each: "/items",
			require: {
				count: "$/items",
				where: { path: "/id", exists: true },
				min: 0,
			},
		},
	},
	{
		message: "Repeated canonical comparison",
		require: {
			each: "/items",
			require: { path: "$/items", equalsPath: "$/items" },
		},
	},
	{
		message: "Union expansion",
		require: { distinct: ["/items", "/items", "/items"] },
	},
] satisfies Rule[])("charges non-lookup collection work: $message", async (rule) => {
	await expect(
		evaluateRulesAsync([rule], {
			items: Array.from({ length: 10000 }, (_, id) => ({ id })),
		}),
	).rejects.toThrow(/evaluation.*limit/);
});
it("charges object sorting, string encoding and set membership before native operations", async () => {
	const wide = Object.fromEntries(
		Array.from({ length: 5000 }, (_, id) => [`k${id}`, id]),
	);
	for (const [rules, value] of [
		[
			[
				{
					message: "Canonical",
					require: { path: "/left", equalsPath: "/right" },
				},
			],
			{ left: wide, right: { ...wide } },
		],
		[
			[
				{
					message: "Text",
					require: { text: { path: "/text", test: "no-local-path" } },
				},
			],
			{ text: "x".repeat(400000) },
		],
		[
			[{ message: "Set", require: { path: "/items", within: "/allowed" } }],
			{
				items: [],
				allowed: Array.from({ length: 15000 }, (_, id) => `value-${id}`),
			},
		],
	] as [Rule[], unknown][])
		await expect(evaluateRulesAsync(rules, value)).rejects.toThrow(
			/evaluation.*limit/,
		);
});
it("precharges format refinement strings and repeated comparisons before calling the parser", async () => {
	const validator = vi.fn(() => true);
	await expect(
		evaluateRulesAsync(
			[{ message: "Conforms", require: { conforms: "json-v1" } }],
			{ items: Array.from({ length: 50 }, () => ({ id: "x".repeat(2000) })) },
			validator,
		),
	).rejects.toThrow(/evaluation.*limit/);
	expect(validator).not.toHaveBeenCalled();
});
it("preserves useful rules, deterministic object equality and cold lazy context", async () => {
	const rules: Rule[] = [
		...lookup,
		{
			message: "IDs unique",
			require: { path: "/items", unique: true, by: "/id" },
		},
		{ message: "Membership", require: { path: "/items/*/id", within: "/ids" } },
		{ message: "Objects", require: { path: "/first", equalsPath: "/second" } },
	];
	const value = {
		items: [{ id: 1 }, { id: 2 }],
		ids: [1, 2],
		first: { a: 1, b: 2 },
		second: { b: 2, a: 1 },
	};
	expect(evaluateRules(rules, value)).toEqual([]);
	await expect(evaluateRulesAsync(rules, value)).resolves.toEqual([]);
	const cold = vi.fn(() => {
		throw new Error("Unselected host context hydrated");
	});
	const context = Object.defineProperty({ ready: true }, "history", {
		enumerable: true,
		get: cold,
	});
	expect(evaluateCondition({ path: "/ready", equals: true }, context)).toBe(
		true,
	);
	expect(cold).not.toHaveBeenCalled();
});

it("shares total condition work across actual accepted read bindings", () => {
	const binding = () => ({
		from: "@answers",
		when: {
			count: "/items",
			where: { path: "/label", equals: "xxxxxxxx" },
			min: 1000,
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "binding-work",
			name: "Binding work",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "ordinary",
					name: "Ordinary",
					type: "agent",
					prompt: "Read",
					reads: { first: binding(), second: binding() },
				},
			],
		},
	]).at(-1)!;
	const step = workflow.steps[0]!;
	const context = {
		run: {
			workflow,
			outputs: {
				items: Array.from({ length: 5000 }, () => ({ label: "xxxxxxxx" })),
			},
			answers: "safe",
			history: [],
		},
		step,
	} as unknown as ExecutionContext;
	expect(
		stepBindings({
			...context,
			step: { ...step, reads: { first: step.reads!.first! } },
		}),
	).toEqual({ first: "safe" });
	expect(() => stepBindings(context)).toThrow("evaluation operation limit");
});
