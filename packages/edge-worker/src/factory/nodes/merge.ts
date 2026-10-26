import { z } from "zod";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const requestSchema = z.object({
	repositoryId: z.string().min(1),
	url: z.url(),
	headSha: z.string().min(1),
});
export const schema = z.object({
	...stepFields,
	type: z.literal("merge"),
	requests: z.array(requestSchema).min(1).optional(),
	method: z.enum(["merge", "squash", "rebase"]).optional(),
	/** Take expected heads from this stamped, fresh producer rather than payload JSON. */
	expectedRevision: z.string().min(1).max(400).optional(),
	pollInterval: z.number().int().min(1).max(60000).default(10000),
	timeout: z.number().int().min(1).max(86400000).default(3600000),
});
export const definition = {
	type: "merge",
	schema,
	category: "io",
	effect: "effect",
	builder: {
		label: "Merge",
		icon: "⑂",
		paletteGroup: "io",
		defaults: {
			reads: { requests: "pr" },
			pollInterval: 10000,
			timeout: 3600000,
		},
	},
	execute: async (ctx) => (await import("./execute/merge.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
