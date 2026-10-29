/** Agents often wrap the JSON result in a short prose preamble and a ```json fence. */
function jsonCandidates(text: string): string[] {
	const trimmed = text.trim();
	const candidates = [trimmed];
	const fences = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/g)];
	for (const fence of fences.reverse())
		candidates.push((fence[1] ?? "").trim());
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
	return candidates;
}

export function parseAgentOutput(text: string): unknown {
	let firstError: unknown;
	for (const [index, candidate] of jsonCandidates(text).entries()) {
		try {
			const value = JSON.parse(candidate);
			if (index === 0 || (value && typeof value === "object")) return value;
		} catch (error) {
			firstError ??= error;
		}
	}
	const reason =
		firstError instanceof Error ? firstError.message : "no JSON object found";
	throw new Error(
		`Agent did not return the required JSON result (${text.length} characters; ${reason}). Reply with only the JSON object, with every string properly escaped. Message ends: ${text.trim().slice(-200)}`,
	);
}

/** A completed capture needs agent correction, rather than another finalization retry. */
