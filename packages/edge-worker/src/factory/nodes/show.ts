import { z } from "zod";
import { ViewSourceSchema } from "../View.js";
import { humanBase } from "./human-schema.js";
import { builtinMetadata } from "./metadata.js";
import type { NodeDefinition } from "./NodeDefinition.js";

export const schema = z
	.object({
		...humanBase,
		type: z.literal("show"),
		view: ViewSourceSchema,
		delivery: z.never().optional(),
		resources: z.never().optional(),
		computeIntensive: z.never().optional(),
	})
	.strict();

async function execute(ctx: import("./NodeDefinition.js").NodeContext) {
	if (ctx.parallel && ctx.step.type !== "show")
		throw new Error("Human checkpoints belong outside concurrent bodies");
	return ctx.engine.humanViews.execute(ctx, ctx.frame);
}

export const definition = {
	...builtinMetadata.show!,
	schema,
	execute,
} satisfies NodeDefinition<typeof schema>;
