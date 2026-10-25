import { z } from "zod";
import {
	evaluateNamedRules,
	evaluateNamedRulesAsync,
	type FreshnessResolver,
	type RuleCondition,
	RuleConditionSchema,
	RuleDataSchema,
	type RuleExpression,
	RuleExpressionSchema,
	type RuleResult,
} from "./Rules.js";

/** Check performs no actions and never names a destination in the recipe. */
export interface CheckConfiguration {
	results: Record<string, RuleExpression>;
	passed?: RuleCondition;
}

const reservedNames = ["passed", "__proto__", "constructor", "prototype"];
// Complete the bounded data preflight first, then inspect original names before
// a record parser can discard __proto__ and hide an invalid authored result.
const checkData = RuleDataSchema.pipe(
	z.unknown().superRefine((value, context) => {
		const property =
			value && typeof value === "object"
				? Object.getOwnPropertyDescriptor(value, "results")
				: undefined;
		const results =
			property && "value" in property ? property.value : undefined;
		if (!results || typeof results !== "object") return;
		for (const name of Object.keys(results)) {
			const message = reservedNames.includes(name)
				? `Check result "${name}" is reserved`
				: !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) || name.length > 80
					? "Check result names must start with a letter and use at most 80 letters, digits, underscores or hyphens"
					: undefined;
			if (message)
				context.addIssue({ code: "custom", path: ["results", name], message });
		}
	}),
);

export const CheckSchema: z.ZodType<CheckConfiguration> = checkData.pipe(
	z
		.object({
			results: z
				.record(z.string(), RuleExpressionSchema)
				.refine(
					(results) => Object.keys(results).length <= 50,
					"At most 50 Check results are allowed",
				),
			passed: RuleConditionSchema.optional(),
		})
		.strict()
		.refine(
			(config) =>
				config.passed !== undefined ||
				Object.values(config.results).some(
					(expression) =>
						!("select" in expression) &&
						(!("aggregate" in expression) ||
							expression.aggregate === "all" ||
							expression.aggregate === "any"),
				),
			"Check needs a boolean result or an explicit passed rule",
		),
);

export type CheckOutput = { passed: boolean } & Record<string, RuleResult>;
type FormatValidator = (format: string, value: unknown) => boolean;

/** Inputs and declared evidence are explicit namespaces, independent of names. */
export function evaluateCheck(
	configuration: CheckConfiguration,
	inputs: unknown,
	evidence: unknown = {},
	validateFormat?: FormatValidator,
	fresh?: FreshnessResolver,
): CheckOutput {
	const evaluated = evaluateNamedRules(
		configuration.results,
		inputs,
		evidence,
		configuration.passed,
		validateFormat,
		fresh,
	);
	return { passed: evaluated.passed, ...evaluated.results };
}

/** The runtime and simulation use this yielding, cancellable implementation. */
export async function evaluateCheckAsync(
	configuration: CheckConfiguration,
	inputs: unknown,
	evidence: unknown = {},
	validateFormat?: FormatValidator,
	signal?: AbortSignal,
	fresh?: FreshnessResolver,
): Promise<CheckOutput> {
	const evaluated = await evaluateNamedRulesAsync(
		configuration.results,
		inputs,
		evidence,
		configuration.passed,
		validateFormat,
		signal,
		fresh,
	);
	return { passed: evaluated.passed, ...evaluated.results };
}
