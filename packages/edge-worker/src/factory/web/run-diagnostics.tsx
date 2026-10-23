import { useQuery } from "@tanstack/react-query";
import type { runDiagnostics } from "../RunDiagnostics";
import type { ResolvedView } from "../View";
import { api } from "./client";
import { DeclarativeView } from "./declarative-view";

type Diagnostics = ReturnType<typeof runDiagnostics>;
const labels: Record<string, string> = {
	execution: "Executing",
	capacity: "Waiting for capacity",
	repository: "Waiting for repository",
	"qa-resource": "Waiting for shared QA resource",
	"provider-ci": "Waiting for provider CI",
	human: "Waiting for a human decision",
	"retry-backoff": "Retry backoff",
	children: "Waiting for child runs",
	recovery: "Recovery preparation",
	unknown: "Unobserved preparation",
};
export function timingLabel(kind: string): string {
	return labels[kind] ?? kind;
}
export function duration(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	if (seconds >= 86400)
		return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
	if (seconds >= 3600)
		return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
	if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${seconds}s`;
}
export function TimingSummary({ diagnostics }: { diagnostics: any }) {
	if (!diagnostics) return <span>Timing unknown for this older run</span>;
	if (diagnostics.legacy)
		return (
			<span>
				Age {duration(diagnostics.ageMs)} · Timing unknown for this older run
			</span>
		);
	const current =
		diagnostics.current
			?.filter((state: any) => state.kind !== "unknown")
			.slice(0, 3) ?? [];
	return (
		<span className="timing-summary">
			<span>Age {duration(diagnostics.ageMs)}</span>
			<span>Execution {duration(diagnostics.executionMs)}</span>
			<span>Wait {duration(diagnostics.waitMs)}</span>
			<span>Unobserved {duration(diagnostics.unobservedMs)}</span>
			{current.map((current: any) => (
				<span key={current.stepIdentity ?? current.step}>
					{labels[current.kind] ?? current.kind} ·{" "}
					{duration(current.measuredMs)}
					{current.resource ? ` · ${current.resource}` : ""}
					{current.blockerRun ? ` · run ${current.blockerRun}` : ""}
				</span>
			))}
		</span>
	);
}
export function diagnosticView(data: Diagnostics): ResolvedView {
	return {
		version: "view-v1",
		components: [
			{
				id: "timing",
				type: "table",
				data: {
					columns: ["Time", "Accounted duration"],
					rows: [
						["Total age", duration(data.ageMs)],
						["Execution · run wall union", duration(data.executionMs)],
						["Wait · excluding concurrent execution", duration(data.waitMs)],
						["Unobserved / offline / legacy gaps", duration(data.unobservedMs)],
						[
							"Agent role wall · sum across concurrent roles",
							duration(data.roleWallMs),
						],
						...Object.entries(data.waits).map(([kind, ms]) => [
							`${labels[kind] ?? kind} · may overlap`,
							duration(ms ?? 0),
						]),
					],
				},
			},
			{
				id: "current",
				type: "table",
				data: {
					columns: [
						"Current operation",
						"State / blocker",
						"Measured in state",
					],
					rows: data.current.map((state) => [
						state.step,
						`${labels[state.kind]}${state.resource ? ` · ${state.resource}` : ""}${state.blockerRun ? ` · blocked by run ${state.blockerRun}` : ""}`,
						duration(state.measuredMs),
					]),
				},
			},
			{
				id: "attempts",
				type: "table",
				data: {
					columns: ["Recent role / check", "Visit reason", "Outcome / source"],
					rows: data.attempts.map((attempt) => [
						`${attempt.step} (${attempt.kind})`,
						attempt.reason,
						`${attempt.outcome} · ${attempt.runtimeCommit?.slice(0, 12) ?? "runtime identity unknown"}`,
					]),
				},
			},
			{
				id: "reuse",
				type: "table",
				data: {
					columns: ["Reused evidence", "Original receipt"],
					rows: data.reuse.map((receipt) => [
						`${receipt.step} · ${receipt.source}`,
						receipt.digest,
					]),
				},
			},
			{
				id: "usage",
				type: "table",
				data: {
					columns: ["Reported usage", "Tokens in / out", "Cost USD"],
					rows: data.usage.map((usage) => [
						`${usage.step} · ${usage.provider}`,
						`${usage.inputTokens ?? "unknown"} / ${usage.outputTokens ?? "unknown"}`,
						usage.costUsd === null ? "unknown" : String(usage.costUsd),
					]),
				},
			},
		],
	};
}
export function RunDiagnosticsPanel({ runId }: { runId: string }) {
	const [url] = [`/api/runs/${encodeURIComponent(runId)}/diagnostics`];
	const query = useQuery<Diagnostics>({
		queryKey: ["run-diagnostics", runId],
		queryFn: () => api(url),
		refetchInterval: 5000,
	});
	const data = query.data;
	return (
		<details className="run-diagnostics review-surface">
			<summary>Run timing and diagnostics</summary>
			{query.isError ? (
				<p role="status">
					Diagnostics unavailable. The run’s original evidence and decisions
					remain authoritative.
				</p>
			) : !data ? (
				<p>Loading diagnostics…</p>
			) : (
				<>
					<p>
						<TimingSummary diagnostics={data} />
					</p>
					<p>{data.semantics}</p>
					<p>
						Measured through{" "}
						{data.observedAt ?? "no retained timing checkpoint"}.{" "}
						{data.clockChanges} clock changes detected. Recent window:{" "}
						{data.recentWindow} attempt records; {data.recentChecks} Check
						visits;{" "}
						{data.repeatedRoles
							.map((role) => `${role.step} ×${role.count}`)
							.join(", ") || "no repeated roles in this window"}
						.
					</p>
					<p>
						{data.context
							? `Context retrieval: ${data.context.pages} pages · ${data.context.utf8Bytes.toLocaleString()} UTF-8 response bytes · ${data.context.fullPages} full pages · ${data.context.preparations} preparations (${duration(data.context.preparationMs)}).`
							: "Context retrieval volume unknown for this older run."}
					</p>
					<p>
						{data.usageAttribution} Retrieval counts cover successful list/read
						responses (one JSON payload, excluding transport duplication),
						including repeated reads and readiness probes; incomplete pre-crash
						checkpoints remain unknown.
					</p>
					<DeclarativeView view={diagnosticView(data)} disabled />
					{data.nextOffset !== null && (
						<p>
							Recent {data.limit} records shown. The bounded JSON endpoint
							supports offset/limit pages within the retained{" "}
							{data.recentWindow}-record window.
						</p>
					)}
					<a
						href={`${url}?limit=32`}
						download={`run-${runId}-diagnostics.json`}
					>
						Export bounded diagnostics
					</a>
				</>
			)}
		</details>
	);
}
