export function parseAgentOutput(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?\s*/, "")
		.replace(/\s*```$/, "");
	try {
		return JSON.parse(cleaned);
	} catch {
		throw new Error(
			`Agent did not return the required JSON result: ${cleaned.slice(-2000)}`,
		);
	}
}

/** A completed capture needs agent correction, rather than another finalization retry. */
