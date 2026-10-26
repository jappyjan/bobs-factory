import { z } from "zod";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("pr"),
	op: z.enum(["ensure", "read", "comment", "ready"]),
});
export const definition = {
	type: "pr",
	schema,
	category: "io",
	effect: "effect",
	operationEffects: {
		read: "read-only",
		ensure: "effect",
		comment: "effect",
		ready: "effect",
	},
	builder: {
		label: "PR",
		icon: "↗",
		paletteGroup: "io",
		defaults: { op: "read" },
	},
	execute: async (ctx) => (await import("./execute/pr.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
