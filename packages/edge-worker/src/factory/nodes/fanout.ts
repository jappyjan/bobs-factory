import { z } from "zod";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { registeredStepSchema } from "./registry.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("fanout"),
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
	groups: z.array(z.array(registeredStepSchema).min(1)).min(1).max(8),
});

export const definition = {
	...builtinMetadata.fanout!,
	schema,
	execute: async (ctx) => (await import("./execute/fanout.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
