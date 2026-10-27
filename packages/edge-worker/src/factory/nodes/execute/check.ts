import { evaluateCheckAsync } from "../../Check.js";
import { nodeFreshnessRules } from "../../NodeGuarantees.js";
import { conforms } from "../../OutputFormats.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext) {
	if (!ctx.step.check) throw new Error("Check configuration is missing");
	return evaluateCheckAsync(
		ctx.step.check,
		ctx.reads,
		{},
		conforms,
		ctx.signal,
		await nodeFreshnessRules(ctx.step.check, ctx.fresh),
	);
}
