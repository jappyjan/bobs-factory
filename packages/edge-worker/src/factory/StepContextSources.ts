import type { ExecutionContext } from "./WorkflowRuntime.js";
export function stepContextSources(
	_context: ExecutionContext,
): Record<string, unknown> {
	return {};
}
export function stepContextBindingSources(
	context: ExecutionContext,
	_history = context.run.history,
) {
	return stepContextSources(context);
}
