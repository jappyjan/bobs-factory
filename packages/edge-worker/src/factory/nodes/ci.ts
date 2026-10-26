import { z } from "zod";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("ci"),
	op: z.enum(["status", "rerun"]),
});
export const definition = {
	type: "ci",
	schema,
	category: "io",
	effect: "effect",
	operationEffects: { status: "read-only", rerun: "effect" },
	builder: {
		label: "CI",
		icon: "✓",
		paletteGroup: "io",
		defaults: { op: "status" },
	},
	execute: async (ctx) => (await import("./execute/ci.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
