import { z } from "zod";
import { SnapshotConfigurationSchema } from "../ActionSteps.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("snapshot"),
	snapshot: SnapshotConfigurationSchema.default({}),
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata.snapshot!,
	schema,
	execute: async (ctx) => (await import("./execute/snapshot.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
