// Release candidates build only from commits whose "CI / Validate" run already
// passed. The decision is pure so the safeguard can be tested without GitHub.
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const CI_EVENTS = ["push", "workflow_dispatch"];

/** Runs that count as CI for the exact frozen commit on the canonical repository. */
export function canonicalCiRuns(runs, { commit, repository }) {
	return runs.filter(
		(run) =>
			run.head_sha === commit &&
			run.path === CI_WORKFLOW_PATH &&
			run.head_branch === "main" &&
			CI_EVENTS.includes(run.event) &&
			run.repository?.full_name === repository &&
			run.head_repository?.full_name === repository,
	);
}

/**
 * Decide what the release should do about CI for `commit`:
 * - pass: a completed successful run exists (that run is the evidence);
 * - wait: a run is queued or in progress;
 * - dispatch: no usable run exists (never ran, or only cancelled) and main
 *   still points at the commit, so a fresh run can validate exactly it;
 * - fail: CI failed, or it cannot be produced for a commit main has left.
 */
export function decideCiGate(runs, { commit, repository, mainSha }) {
	const candidates = canonicalCiRuns(runs, { commit, repository });
	const newestFirst = [...candidates].sort(
		(a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
	);
	const passed = newestFirst.find(
		(run) => run.status === "completed" && run.conclusion === "success",
	);
	if (passed) return { action: "pass", run: passed };
	const active = newestFirst.find((run) => run.status !== "completed");
	if (active) return { action: "wait", run: active };
	const failed = newestFirst.find(
		(run) => run.status === "completed" && run.conclusion !== "cancelled",
	);
	if (failed)
		return {
			action: "fail",
			run: failed,
			reason: `CI / Validate ${failed.conclusion} for ${commit}: ${failed.html_url}`,
		};
	if (mainSha === commit) return { action: "dispatch" };
	return {
		action: "fail",
		reason: candidates.length
			? `CI / Validate was cancelled for ${commit} and main has moved on; nothing validates this commit`
			: `No CI / Validate run exists for ${commit} and main has moved on; nothing validates this commit`,
	};
}
