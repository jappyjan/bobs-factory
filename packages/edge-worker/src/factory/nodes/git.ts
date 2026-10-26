import { z } from "zod";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

const ref = z
	.string()
	.min(1)
	.refine(
		(value) => !value.startsWith("-") && !/[\s\0]/.test(value),
		"Invalid Git ref",
	);
export const schema = z.object({
	...stepFields,
	type: z.literal("git"),
	op: z.enum(["status", "commit", "push", "rev-parse", "diff"]),
	/** Run commit hooks; false passes --no-verify for mechanical delivery. */
	hooks: z.boolean().default(true),
	ref: ref.default("HEAD"),
	from: ref.optional(),
	to: ref.default("HEAD"),
});
export const definition = {
	type: "git",
	schema,
	category: "io",
	effect: "effect",
	operationEffects: {
		status: "read-only",
		"rev-parse": "read-only",
		diff: "read-only",
		commit: "effect",
		push: "effect",
	},
	builder: {
		label: "Git",
		icon: "⑂",
		paletteGroup: "io",
		defaults: { op: "status" },
	},
	execute: async (ctx) => (await import("./execute/git.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
