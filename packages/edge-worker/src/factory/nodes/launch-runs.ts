import { z } from "zod";
import { LaunchRunsConfigurationSchema } from "../ActionSteps.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("launch-runs"),
	launchRuns: LaunchRunsConfigurationSchema,
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata["launch-runs"]!,
	schema,
	execute: async (ctx) =>
		(await import("./execute/launch-runs.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
