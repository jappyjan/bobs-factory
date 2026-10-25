import { z } from "zod";
import { CheckSchema } from "../Check.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("check"),
	check: CheckSchema,
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata.check!,
	schema,
	execute: async (ctx) => (await import("./execute/check.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
