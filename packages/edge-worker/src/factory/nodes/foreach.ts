import { z } from "zod";
import { foreachFields } from "../Foreach.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { registeredStepSchema } from "./registry.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("foreach"),
	...foreachFields,
	body: z.array(registeredStepSchema).min(1).max(100),
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata.foreach!,
	schema,
	execute: async (ctx) => (await import("./execute/foreach.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
