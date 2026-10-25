import { z } from "zod";
import { FileIssuesConfigurationSchema } from "../ActionSteps.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("file-issues"),
	fileIssues: FileIssuesConfigurationSchema,
	delivery: z.never().optional(),
	resources: z.never().optional(),
	computeIntensive: z.never().optional(),
});

export const definition = {
	...builtinMetadata["file-issues"]!,
	schema,
	execute: async (ctx) =>
		(await import("./execute/file-issues.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
