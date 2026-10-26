import { z } from "zod";
import { validateInlineSchema } from "../InlineSchema.js";
import { evaluateTransformAsync, TransformSchema } from "../Rules.js";
import type { StepOutput } from "../StepConfig.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

export const schema = z.object({
	...stepFields,
	type: z.literal("transform"),
	transform: TransformSchema,
	output: z
		.object({ schema: z.record(z.string(), z.unknown()) })
		.strict()
		.optional(),
	checks: z.never().optional(),
	revision: z.never().optional(),
});

/** Shared by runtime and HTTP simulation; schemas validate without modifying data. */
export async function transformOutput(
	template: z.output<typeof TransformSchema>,
	reads: unknown,
	output?: StepOutput,
	signal?: AbortSignal,
) {
	const result = await evaluateTransformAsync(template, reads, signal);
	if (output && "schema" in output) {
		const checked = await validateInlineSchema(output.schema, result, signal);
		const issues = [
			...checked.schemaIssues,
			...checked.issues.map((issue) => `${issue.path}: ${issue.message}`),
		];
		if (issues.length)
			throw new Error(`Transform output: ${issues.join("; ")}`);
	}
	return result;
}
export const definition = {
	type: "transform",
	schema,
	category: "logic",
	effect: "pure",
	builder: {
		label: "Transform",
		icon: "◇",
		paletteGroup: "logic",
		settings: "transform",
		hint: "Build an object with rules-v1 expressions, literals and item templates",
		defaults: { transform: { value: { select: "/inputs/value" } }, reads: {} },
	},
	execute: (ctx) =>
		transformOutput(ctx.step.transform, ctx.reads, ctx.step.output, ctx.signal),
} satisfies NodeDefinition<typeof schema>;
