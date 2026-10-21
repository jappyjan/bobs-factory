import { useQuery } from "@tanstack/react-query";
import type { StoragePolicy } from "bobs-factory-core";
import type { StorageRetention } from "../../storage/StorageRetention.js";
import { api, useAction } from "./client";
import { useFormState } from "./form-state";
import { Button } from "./ui";

type Status = Awaited<ReturnType<StorageRetention["status"]>>;
const bytes = (value: number | undefined) => {
	if (value === undefined) return "Unavailable";
	const size = Math.abs(value);
	const power =
		size >= 1024 ** 3 ? 3 : size >= 1024 ** 2 ? 2 : size >= 1024 ? 1 : 0;
	return `${power ? (value / 1024 ** power).toFixed(2) : value} ${["B", "KiB", "MiB", "GiB"][power]}`;
};
const categoryNames = {
	staging: "Staged updates",
	preparation: "Preparation copies",
	recovery: "Reconciled recovery copies",
	migration: "Migration preparation",
	worktree: "Completed delivered worktrees",
};
export function StorageSettings() {
	const query = useQuery({
		queryKey: ["storage"],
		queryFn: ({ signal }) => api<Status>("/api/storage", { signal }),
		refetchInterval: 5000,
	});
	const status = query.data;
	const action = useAction("storage", String(status?.policy.revision));
	const [draft, setDraft] = useFormState<StoragePolicy | undefined>(
		String(status?.policy.revision),
		undefined,
	);
	const [idempotentTeardown, setIdempotentTeardown] = useFormState<boolean>(
		String(status?.preview?.id),
		false,
	);
	const [operation, setOperation] = useFormState<string>(
		String(status?.historicalPreview?.id),
		"",
	);
	const [selected, setSelected] = useFormState<string[]>(
		String(status?.preview?.id),
		[],
	);
	const perform = async (path: string, body: unknown = {}, method = "POST") => {
		await action.mutateAsync({ path, body, method });
		await query.refetch();
	};
	if (!status)
		return <p role="status">{query.error?.message ?? "Loading storage…"}</p>;
	const policy = draft ?? status.policy;
	return (
		<section
			className="recipe execution-editor"
			aria-labelledby="storage-settings"
		>
			<h2 id="storage-settings">Storage</h2>
			<p>
				Manage storage on this connected Factory instance. Protected recovery
				data and resumable work stay retained regardless of age or free space.
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void perform(
						"/api/storage/policy",
						{ revision: status.policy.revision, policy },
						"PUT",
					)
						.then(() => setDraft(undefined))
						.catch(() => {});
				}}
			>
				<label>
					<input
						type="checkbox"
						checked={policy.enabled}
						onChange={(event) =>
							setDraft({ ...policy, enabled: event.target.checked })
						}
					/>{" "}
					Automatic cleanup
				</label>
				<label>
					Verified rollback snapshots to keep
					<input
						type="number"
						min="1"
						max="100"
						value={policy.snapshotCount}
						onChange={(event) =>
							setDraft({ ...policy, snapshotCount: Number(event.target.value) })
						}
					/>
				</label>
				<p>
					The newest verified rollback is always protected. Excess snapshots can
					be eligible immediately; protected dependencies stay retained.
				</p>
				{(
					[
						"staging",
						"preparation",
						"recovery",
						"migration",
						"worktree",
					] as const
				).map((category) => (
					<label key={category}>
						{categoryNames[category]} retention (days)
						<input
							type="number"
							min="1"
							max="36500"
							value={policy.ages[category]}
							onChange={(event) =>
								setDraft({
									...policy,
									ages: {
										...policy.ages,
										[category]: Number(event.target.value),
									},
								})
							}
						/>
					</label>
				))}
				<label>
					Reconcile every (hours)
					<input
						type="number"
						min="1"
						max="168"
						value={policy.intervalHours}
						onChange={(event) =>
							setDraft({ ...policy, intervalHours: Number(event.target.value) })
						}
					/>
				</label>
				<label>
					Low disk warning threshold (GiB)
					<input
						type="number"
						min="0"
						step="1"
						value={policy.lowDiskBytes / 1024 ** 3}
						onChange={(event) =>
							setDraft({
								...policy,
								lowDiskBytes: Number(event.target.value) * 1024 ** 3,
							})
						}
					/>
				</label>
				<Button type="submit" disabled={action.isPending || !draft}>
					Save policy
				</Button>
			</form>
			<h3>Cleanup preview</h3>
			<p>
				Scanning is bounded and may need several slices. Unknown ownership and
				incomplete evidence retain a directory. Apparent bytes are separate from
				observed free-space change; shared APFS blocks and concurrent writes
				affect disk measurements.
			</p>
			<Button
				disabled={action.isPending}
				onClick={() => void perform("/api/storage/preview").catch(() => {})}
			>
				{status.preview?.deferred ? "Continue scan" : "Refresh preview"}
			</Button>
			{status.preview && (
				<>
					<p role="status">
						{status.preview.complete
							? "Scan complete"
							: "Scan incomplete; more work is deferred"}{" "}
						· Last scan: {status.preview.createdAt}
					</p>
					{status.preview.volumes.map((volume) => (
						<p key={volume.device} role={volume.lowDisk ? "alert" : undefined}>
							{volume.lowDisk ? "Low disk: " : "Volume free space: "}
							{bytes(volume.freeBytes)}
							{volume.error ? ` · ${volume.error}` : ""}. Low disk never
							bypasses preservation checks.
						</p>
					))}
					<ul>
						{status.preview.candidates.map((candidate) => (
							<li key={candidate.record.id}>
								<label>
									<input
										type="checkbox"
										disabled={!candidate.eligible || action.isPending}
										checked={selected.includes(candidate.record.id)}
										onChange={(event) =>
											setSelected(
												event.target.checked
													? [...selected, candidate.record.id]
													: selected.filter((id) => id !== candidate.record.id),
											)
										}
									/>{" "}
									{candidate.record.category}: {candidate.record.path}
								</label>
								<p>
									{candidate.eligible
										? "Eligible after fresh verification"
										: `Retained: ${candidate.reasons.join("; ")}`}{" "}
									· Apparent directory bytes: {bytes(candidate.apparentBytes)}
								</p>
							</li>
						))}
					</ul>
					{!status.preview.candidates.length && (
						<p>No candidates in this scan slice.</p>
					)}
					<label>
						<input
							type="checkbox"
							checked={idempotentTeardown}
							onChange={(event) => setIdempotentTeardown(event.target.checked)}
						/>{" "}
						Retry interrupted teardown: I verified the scripts can safely run
						again.
					</label>
					<Button
						disabled={!selected.length || action.isPending}
						onClick={() =>
							void perform("/api/storage/execute", {
								previewId: status.preview!.id,
								selected,
								idempotentTeardown,
							})
								.then(() => setSelected([]))
								.catch(() => {})
						}
					>
						Clean selected directories
					</Button>
				</>
			)}
			<h3>Historical directories</h3>
			<p>
				Names alone never establish ownership. Classification requires a
				producer proof or an exact verified copy of current Factory state, plus
				your explicit election that the selected contents are disposable.
				Classification still applies ordinary retention and preservation checks.
			</p>
			<Button
				disabled={action.isPending}
				onClick={() =>
					void perform("/api/storage/historical/preview").catch(() => {})
				}
			>
				Inspect historical directories
			</Button>
			{status.historicalPreview && (
				<>
					<p>
						{status.historicalPreview.complete
							? "Historical scan complete"
							: "Historical scan incomplete; inspect again for the next slice"}
					</p>
					<label>
						Originating operation ID
						<input
							value={operation}
							onChange={(event) => setOperation(event.target.value)}
						/>
					</label>
					<ul>
						{status.historicalPreview.candidates.map((candidate) => (
							<li key={candidate.id}>
								<strong>{candidate.path}</strong> · Category:{" "}
								{candidate.category}
								<p>
									{candidate.ownershipEvidence} {candidate.reconciliationProof}.{" "}
									{candidate.dependencies.join("; ")}
								</p>
								<Button
									disabled={action.isPending || !operation}
									onClick={() =>
										void perform("/api/storage/classify", {
											previewId: status.historicalPreview!.id,
											candidateId: candidate.id,
											category: candidate.category,
											operation,
											contentsVerifiedDisposable: true,
										}).catch(() => {})
									}
								>
									I verified disposable Bob-owned contents: classify this exact
									directory
								</Button>
							</li>
						))}
					</ul>
				</>
			)}
			<h3>Last cleanup attempt</h3>
			{status.outcome ? (
				<>
					<p>
						{status.outcome.startedAt} ·{" "}
						{status.outcome.completedAt ? "Finished" : "In progress"}
					</p>
					{status.outcome.error && <p role="alert">{status.outcome.error}</p>}
					<ul>
						{status.outcome.results.map((result) => (
							<li key={result.id}>
								{result.phase}
								{result.reason ? ` · ${result.reason}` : ""} · Observed
								free-space change: {bytes(result.observedFreeSpaceChange)}
							</li>
						))}
					</ul>
				</>
			) : (
				<p>No cleanup has run.</p>
			)}
			{status.lastError && <p role="alert">{status.lastError.error}</p>}
			{action.error && <p role="alert">{action.error.message}</p>}
		</section>
	);
}
