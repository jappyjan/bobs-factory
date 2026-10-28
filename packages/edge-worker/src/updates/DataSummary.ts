/** What the running worker actually loaded. The update health check compares this
 * against what the previous worker had loaded, by identity and never by bytes, so a
 * token refresh or recipe re-serialization cannot fail an update. */
export interface DataSummary {
	runtime: { version: string; commit: string | null; target: string | null };
	stateFormat: number;
	runs: { count: number; ids: string[] };
	workflows: { count: number; ids: string[] };
	sessions: { count: number; ids: string[] };
	loadErrors: Array<{ kind: string; id: string; message: string }>;
}

/** Recorded at idle time from the old worker. Anything unknown is not compared. */
export interface DataBaseline {
	runIds: string[];
	workflowIds?: string[];
	sessionCount?: number;
}

export const baselineFromSummary = (summary: DataSummary): DataBaseline => ({
	runIds: summary.runs.ids,
	workflowIds: summary.workflows.ids,
	sessionCount: summary.sessions.count,
});

/** Set containment, not equality: harmless background writes may add records,
 * none may vanish. Returns the reason on failure. */
export function dataRegression(
	summary: Pick<DataSummary, "runs" | "workflows" | "sessions" | "loadErrors">,
	baseline: DataBaseline | undefined | null,
): string | undefined {
	if (summary.loadErrors.length)
		return `Data failed to load: ${summary.loadErrors
			.slice(0, 3)
			.map((error) => `${error.kind} ${error.id} (${error.message})`)
			.join("; ")}`;
	if (!baseline) return undefined;
	const missing = (expected: string[] | undefined, actual: string[]) => {
		const have = new Set(actual);
		return (expected ?? []).filter((id) => !have.has(id));
	};
	const runs = missing(baseline.runIds, summary.runs.ids);
	if (runs.length)
		return `Runs missing after update: ${runs.slice(0, 5).join(", ")}${runs.length > 5 ? ` and ${runs.length - 5} more` : ""}`;
	const workflows = missing(baseline.workflowIds, summary.workflows.ids);
	if (workflows.length)
		return `Workflows missing after update: ${workflows.slice(0, 5).join(", ")}`;
	if (
		baseline.sessionCount !== undefined &&
		summary.sessions.count < baseline.sessionCount
	)
		return `Sessions missing after update: ${summary.sessions.count} loaded, ${baseline.sessionCount} expected`;
	return undefined;
}
