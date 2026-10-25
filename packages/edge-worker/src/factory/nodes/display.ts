import { z } from "zod";
import {
	DisplayDocumentSchema,
	displayInteractive,
	resolveDisplayDocument,
} from "../DisplayDocument.js";
import { viewPointerSchema } from "../View.js";
import { humanBase } from "./human-schema.js";
import type { NodeDefinition } from "./NodeDefinition.js";

export const schema = z
	.object({
		...humanBase,
		type: z.literal("display"),
		view: z.never().optional(),
		document: DisplayDocumentSchema.optional(),
		from: viewPointerSchema.optional(),
		bind: z.array(z.string().min(1).max(500)).max(100).optional(),
	})
	.strict()
	.refine(
		(step) => (step.document === undefined) !== (step.from === undefined),
		"Display requires exactly one of document or from",
	)
	// Make document-local reads visible to generic output stamps and reuse.
	.transform((step) =>
		step.document?.reads ? { ...step, reads: step.document.reads } : step,
	);
export const definition = {
	type: "display",
	schema,
	category: "display",
	effect: "human",
	builder: {
		label: "Display",
		icon: "▤",
		paletteGroup: "display",
		settings: "display",
		defaults: {
			document: {
				version: "view-v1",
				components: [
					{
						id: "text",
						type: "markdown",
						data: { literal: { text: "Your content here" } },
					},
				],
			},
		},
	},
	async execute(ctx) {
		const { viewScope } = await import("../ViewRuntime.js");
		const view = resolveDisplayDocument(
			ctx.step.document ?? { from: ctx.step.from! },
			viewScope(ctx),
		);
		if (!displayInteractive(view))
			return ctx.engine.humanViews.execute(ctx, ctx.frame);
		if (ctx.parallel)
			throw new Error("Interactive displays belong outside concurrent bodies");
		return ctx.phase("waiting-human", () =>
			ctx.engine.humanViews.execute(ctx, ctx.frame),
		);
	},
	summary: () => "Display completed",
} satisfies NodeDefinition<typeof schema>;
