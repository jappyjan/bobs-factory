import { factoryFeedbackContext } from "./FeedbackPolicy.js";
import { qaReuseBindingInputs } from "./QaReuse.js";
import { factoryReviewFixContext } from "./ReviewRecovery.js";
import { hasCheck } from "./StepConfig.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** These live sources are shared by native context assembly and binding checks. */
export function stepContextSources(
	context: ExecutionContext,
): Record<string, unknown> {
	return {
		...(hasCheck(context.step, "feedback-assessment") ||
		hasCheck(context.step, "impact-reuse")
			? { feedback: factoryFeedbackContext(context) }
			: {}),
		...(hasCheck(context.step, "review-dispositions")
			? { reviewFix: factoryReviewFixContext(context) }
			: {}),
	};
}

/** QA reuse binds its immutable decision inputs, without re-running environment probes. */
export function stepContextBindingSources(
	context: ExecutionContext,
	history = context.run.history,
) {
	const qaReuse = qaReuseBindingInputs(context, history);
	return { ...stepContextSources(context), ...(qaReuse ? { qaReuse } : {}) };
}
