import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { AgentStepSchema } from "./schema.js";

export const schema = AgentStepSchema;

const execute = () => {
	throw new Error("Inline node requires the engine execution boundary");
};

export const definition = {
	...builtinMetadata.agent!,
	schema,
	execute,
	inline: true as const,
} satisfies NodeDefinition<typeof schema>;
