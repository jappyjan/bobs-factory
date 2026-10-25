import { z } from "zod";
import { foreachPointerSchema } from "../Foreach.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { nodeId, stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("workflow"),
	delivery: z.never().optional(),
	resources: z.never().optional(),
	workflow: nodeId,
	/** Opt in to freshness at the actual leaf read instead of every Call port. */
	inputFreshness: z.enum(["eager", "on-read"]).optional(),
	/** Named producer ports, relative to the caller's graph. */
	bindings: z
		.record(
			nodeId,
			z
				.string()
				.regex(
					/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*|@bindings\/[A-Za-z0-9_-]+)$/,
				),
		)
		.optional(),
	inputMapping: z
		.record(
			z
				.string()
				.regex(/^[A-Za-z][A-Za-z0-9_-]{0,59}$/)
				.refine(
					(s) =>
						![
							"item",
							"index",
							"inputs",
							"__proto__",
							"constructor",
							"prototype",
						].includes(s),
				),
			foreachPointerSchema,
		)
		.refine((m) => Object.keys(m).length <= 30, "At most 30 call inputs")
		.optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata.workflow!,
	schema,
	execute: async (ctx) => (await import("./execute/workflow.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
