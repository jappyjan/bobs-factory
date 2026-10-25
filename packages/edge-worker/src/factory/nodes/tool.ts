import { z } from "zod";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

export const schema = z.object({
	...stepFields,
	type: z.literal("tool"),
	tool: z.string().min(1),
	computeIntensive: z.boolean().optional(),
	args: z.array(z.string()).default([]),
	arguments: z.record(z.string(), z.unknown()).optional(),
});

const execute = () => {
	throw new Error("Inline node requires the engine execution boundary");
};

export const definition = {
	...builtinMetadata.tool!,
	schema,
	execute,
	inline: true as const,
} satisfies NodeDefinition<typeof schema>;
