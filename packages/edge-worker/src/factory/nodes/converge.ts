import { z } from "zod";
import { digest } from "../Delivery.js";
import { latestNodeReceipt } from "../NodeGuarantees.js";
import { evaluateNamedRulesAsync } from "../Rules.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

export const schema = z.object({
	...stepFields,
	type: z.literal("converge"),
	watch: z
		.array(
			z
				.string()
				.max(400)
				.regex(/^\$?(\/[^/]*)*$/),
		)
		.min(1)
		.max(50),
	maxCycles: z.number().int().min(2).max(10_000).default(3),
});
export const definition = {
	type: "converge",
	schema,
	category: "logic",
	effect: "pure",
	builder: {
		label: "Converge",
		icon: "◎",
		paletteGroup: "logic",
		defaults: { watch: ["/inputs/value"], maxCycles: 3 },
	},
	async execute(ctx) {
		const watched = await evaluateNamedRulesAsync(
			Object.fromEntries(
				ctx.step.watch.map((path, index) => [
					`value${index}`,
					{ select: path },
				]),
			),
			ctx.reads,
			{},
			{ path: "", exists: true },
			undefined,
			ctx.signal,
		);
		const watchDigest = digest(watched.results);
		const previous = latestNodeReceipt(ctx, ctx.stepKey ?? ctx.step.id);
		const state = previous?.guarantee?.state as
			| { watchDigest?: string }
			| undefined;
		const changed = state?.watchDigest !== watchDigest;
		const previousCycles =
			(previous?.output as { cycles?: number } | undefined)?.cycles ?? 0;
		const cycles = changed ? 1 : previousCycles + 1;
		ctx.guarantee.state = { watchDigest };
		return { stalled: cycles >= ctx.step.maxCycles, cycles, changed };
	},
	summary: (output) =>
		(output as { stalled: boolean }).stalled
			? "Watched values stalled"
			: "Watched values observed",
} satisfies NodeDefinition<typeof schema>;
