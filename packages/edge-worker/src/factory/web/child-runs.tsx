import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { launchBatchProjection } from "../LaunchRuns";
import { useAction } from "./client";
import { Button } from "./ui";

/** A presentation boundary over retained action data; accepted items stay immutable. */
export type ChildRunBatchView = ReturnType<typeof launchBatchProjection>;

export function childRunWaves(batch: ChildRunBatchView) {
	const waves = new Map<number, ChildRunBatchView["items"]>();
	for (const item of batch.items) {
		const wave = waves.get(item.wave) ?? [];
		wave.push(item);
		waves.set(item.wave, wave);
	}
	return [...waves]
		.sort(([a], [b]) => a - b)
		.map(([wave, items]) => ({ wave, items }));
}

export function childBatchLabel(
	batch: ChildRunBatchView,
	parentStatus: string,
) {
	const unresolved = batch.items.some(
		(item) =>
			["creating", "uncertain"].includes(item.creation) ||
			!["merged", "completed", "blocked", "cancelled"].includes(item.status),
	);
	if (batch.cancelled) return unresolved ? "Stopping batch" : "Batch stopped";
	if (batch.paused || parentStatus === "stopped") return "Dispatch paused";
	if (
		batch.items.some(
			(item) => item.status === "uncertain" || item.creation === "uncertain",
		)
	)
		return "Reconciliation needed";
	if (!batch.items.length) return "No child items";
	if (!unresolved)
		return batch.items.some((item) => item.status === "blocked")
			? "Blocked outcomes"
			: "Children finished";
	return "Tracking";
}

export function recipeParentOf(run: {
	recipeParent?: { runId: string; workflowId?: string };
}) {
	if (run.recipeParent?.runId)
		return {
			runId: run.recipeParent.runId,
			label: run.recipeParent.workflowId
				? `recipe ${run.recipeParent.workflowId}`
				: "a recipe run",
		};
	return undefined;
}

export function RecipeParentLink({
	run,
}: {
	run: Parameters<typeof recipeParentOf>[0];
}) {
	const parent = recipeParentOf(run);
	return parent ? (
		<p className="recipe-parent">
			↳ Part of {parent.label} ·{" "}
			<Link to={`/runs/${encodeURIComponent(parent.runId)}`}>
				See parent run →
			</Link>
		</p>
	) : null;
}

export function ChildRunList({
	batches,
	parentStatus,
	onStop,
	busy = false,
}: {
	batches?: Record<string, ChildRunBatchView>;
	parentStatus: string;
	onStop?: (actionId: string) => void;
	busy?: boolean;
}) {
	const entries = Object.entries(batches ?? {});
	if (!entries.length) return null;
	return (
		<section className="child-run-list" aria-label="Child runs">
			<h2>Child runs</h2>
			{entries.map(([key, batch]) => {
				const paused = batch.paused || parentStatus === "stopped";
				const stopAvailable =
					!batch.cancelled &&
					batch.items.some(
						(item) =>
							!["merged", "completed", "cancelled"].includes(
								item.status ?? "queued",
							),
					);
				return (
					<article key={key} className="child-run-batch">
						<div className="section-heading">
							<h3>{batch.key}</h3>
							<span className="chip">
								{childBatchLabel(batch, parentStatus)}
							</span>
						</div>
						<p className="muted">
							Recipe {batch.targetWorkflowId} · {batch.items.length} child runs.
							Each dependency waits for exact human approval and
							provider-confirmed merge.
						</p>
						{!paused && !batch.cancelled && stopAvailable && (
							<p className="muted">
								Stopping the parent pauses dispatch. Existing children keep
								working unless you stop the batch too.
							</p>
						)}
						{paused && !batch.cancelled && (
							<p role="status">
								New dispatch is paused. Existing children keep working; resume
								the parent to continue queued waves.
							</p>
						)}
						{batch.cancelled && (
							<p role="status">
								Batch stop is retained. Pending or uncertain children are
								reconciled and stopped; no further waves launch.
							</p>
						)}
						{childRunWaves(batch).map(({ wave, items }) => (
							<section
								key={wave}
								className="child-run-wave"
								aria-label={`Wave ${wave + 1}`}
							>
								<h4>Wave {wave + 1}</h4>
								<ol>
									{items.map((item) => {
										const progress = item;
										const status = progress?.status ?? "queued";
										return (
											<li key={item.id} data-status={status}>
												<div className="child-run-item">
													<b>
														{progress?.creation === "confirmed" ? (
															<Link
																to={`/runs/${encodeURIComponent(item.runId)}`}
															>
																{item.title || item.id}
															</Link>
														) : (
															item.title || item.id
														)}
													</b>
													<span className="chip">{status}</span>
												</div>
												<small>
													{item.id}
													{item.dependencies.length
														? ` · Depends on ${item.dependencies.join(", ")}`
														: " · Independent"}
												</small>
												{progress?.creation === "uncertain" && (
													<p role="status">
														Child creation is uncertain. Reconciliation retains
														its original identity before any retry.
													</p>
												)}
												{progress?.error && (
													<p className="error">{progress.error}</p>
												)}
											</li>
										);
									})}
								</ol>
							</section>
						))}
						{!batch.items.length && <p>No child items.</p>}
						{stopAvailable && onStop && (
							<StopBatchButton busy={busy} onStop={() => onStop(key)} />
						)}
					</article>
				);
			})}
		</section>
	);
}

function StopBatchButton({
	busy,
	onStop,
}: {
	busy: boolean;
	onStop: () => void;
}) {
	const [confirm, setConfirm] = useState(false);
	useEffect(() => {
		if (!confirm) return;
		const timer = setTimeout(() => setConfirm(false), 4000);
		return () => clearTimeout(timer);
	}, [confirm]);
	return (
		<Button
			requiresConnection
			busy={busy}
			variant={confirm ? "danger" : "secondary"}
			onClick={() => (confirm ? onStop() : setConfirm(true))}
		>
			{confirm
				? "Confirm stop batch and active runs"
				: "Stop batch and active runs"}
		</Button>
	);
}

export function RunChildren({
	run,
}: {
	run: {
		id: string;
		status: string;
		launchActions?: Record<string, ChildRunBatchView>;
	};
}) {
	const action = useAction(`child-runs/${run.id}`);
	return (
		<>
			<ChildRunList
				batches={run.launchActions}
				parentStatus={run.status}
				busy={action.isPending}
				onStop={(actionId) =>
					void action
						.mutateAsync({
							path: `/api/runs/${encodeURIComponent(run.id)}/stop-batch`,
							body: { actionId },
						})
						.catch(() => {})
				}
			/>
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
		</>
	);
}
