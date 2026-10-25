import { z } from "zod";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

export const schema = z.object({
	...stepFields,
	type: z.literal("script"),
	script: z.string().min(1),
	computeIntensive: z.boolean().optional(),
});

const execute = () => {
	throw new Error("Inline node requires the engine execution boundary");
};

export const definition = {
	...builtinMetadata.script!,
	schema,
	execute,
	inline: true as const,
} satisfies NodeDefinition<typeof schema>;
