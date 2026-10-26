import { FactoryContextInfrastructureError } from "bobs-factory-mcp-tools";

/** Classify native execution errors only, never model-authored result content. */
export function nativeInfrastructureFailure(
	error: unknown,
	output?: unknown,
): FactoryContextInfrastructureError | undefined {
	if (error instanceof FactoryContextInfrastructureError) return error;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	if (
		!/(?:ECONN(?:RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|transport (?:offline|closed|unavailable)|socket hang up|network (?:error|unavailable)|authentication (?:failed|required)|unauthori[sz]ed|invalid api key|expired (?:access |oauth )?token|HTTP\s*(?:401|403|429)|rate[ _-]limit|too many requests|quota exceeded|Required MCP server ['"]factory-context['"] is unavailable before model work|required MCP servers? failed to initialize|MCP.*(?:connection closed|startup failed)|(?:initialize|thread\/(?:start|resume)) timed out|app-server produced no activity)/i.test(
			message,
		)
	)
		return;
	return new FactoryContextInfrastructureError(message, output);
}

/** Only missing native conversations/executables justify abandoning a resume. */
export function nativeResumeUnavailable(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /(?:no (?:rollout|session|conversation|thread) found|(?:session|conversation|thread)[^\n]{0,100}(?:not found|does not exist|no longer exists)|(?:unknown|missing|invalid) (?:session|conversation|thread)(?: id)?|spawn[^\n]*ENOENT|(?:runner|executable|command)[^\n]{0,80}(?:not found|unavailable|not available|not installed))/i.test(
		message,
	);
}
