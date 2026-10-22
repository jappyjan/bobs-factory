import { useEffect } from "react";
import {
	FileIssuesConfigurationSchema,
	LaunchRunsConfigurationSchema,
	SnapshotConfigurationSchema,
} from "../ActionSteps";
import { CheckJsonField } from "./check-step-settings";
import type { Recipe, Step } from "./recipe-graph";

export function actionConfigurationProblem(step: Step, value: unknown) {
	const schema =
		step.type === "snapshot"
			? SnapshotConfigurationSchema
			: step.type === "file-issues"
				? FileIssuesConfigurationSchema
				: LaunchRunsConfigurationSchema;
	const result = schema.safeParse(value);
	return result.success
		? undefined
		: result.error.issues
				.map((issue) => `${issue.path.join("/")}: ${issue.message}`)
				.join("; ");
}

export function ActionStepSettings({
	step,
	readOnly,
	recipes,
	ownerId,
	onChange,
	onError,
}: {
	step: Step;
	readOnly: boolean;
	recipes: Recipe[];
	ownerId: string;
	onChange: (patch: Partial<Step>) => void;
	onError: (field: string, error: string) => void;
}) {
	const key =
		step.type === "snapshot"
			? "snapshot"
			: step.type === "file-issues"
				? "fileIssues"
				: "launchRuns";
	const value = step[key] ?? {};
	const problem = actionConfigurationProblem(step, value);
	useEffect(() => {
		onError("Action configuration", problem ?? "");
		return () => onError("Action configuration", "");
	}, [problem, onError]);
	const targetId = step.launchRuns?.workflow ?? "factory";
	const target = recipes.find((recipe) => recipe.id === targetId);
	const targetProblem =
		step.type !== "launch-runs"
			? ""
			: targetId === ownerId
				? "A recipe cannot launch itself."
				: !target
					? "The target recipe is unavailable."
					: !target.allowedTriggers.includes("workflow")
						? "Allow the target recipe’s Callable trigger before launching its runs."
						: "";
	useEffect(() => {
		onError("Launch target", targetProblem);
		return () => onError("Launch target", "");
	}, [targetProblem, onError]);
	return (
		<section
			className="recipe-section action-step-settings"
			aria-label="Action configuration"
		>
			<h3>
				{step.type === "snapshot"
					? "Pinned repository context"
					: step.type === "file-issues"
						? "Issue items and mapping"
						: "Child runs and dependency waves"}
			</h3>
			{step.type === "snapshot" ? (
				<p className="recipe-note">
					Pins tracked revisions of every repository in this run. Declare a
					named read of this Snapshot output on a read-only agent to read its
					immutable tracked blobs. Optional history uses dated,
					repository-matched operational summaries.
				</p>
			) : (
				<>
					<p className="recipe-note">
						Use items.from with a JSON Pointer such as /inputs/proposals/items,
						or items.values for an inline list. Field mappings and itemId are
						JSON Pointers relative to each item. Stable unique item IDs retain
						original receipts across retries and restart.
					</p>
					<CheckJsonField
						label="Action reads"
						value={step.reads ?? {}}
						object
						readOnly={readOnly}
						onError={onError}
						onChange={(reads) => onChange({ reads })}
					/>
					<small>{`For example {"proposals":"research"} binds research output at /inputs/proposals. Inside For each, /item and /index retain their lexical scope.`}</small>
				</>
			)}
			{step.type === "file-issues" && (
				<p className="recipe-note">
					The destination defaults to the project’s configured Linear or Taskbot
					tracker. Map fields.title, fields.body and optional fields.labels.
					Tickets are always backlog-only and unassigned. An uncertain send is
					reconciled before another send; unresolved ambiguity needs operator
					attention.
				</p>
			)}
			{step.type === "launch-runs" && (
				<>
					<p className="recipe-note">
						Set workflow (default factory), inputMapping.prompt, optional plan
						and repositoryIds, and optional dependencies pointing to item IDs.
						Children retain the accepted repository scope and execution
						profiles. Prerequisites require exact human approval and
						provider-confirmed merge.
					</p>
					<p className="recipe-note">
						wait: true waits for outcomes. wait: false returns child links while
						durable reconciliation and later waves continue. Stopping this
						parent pauses new dispatch; “Stop batch and active runs” also
						cancels children. Cycles through Call recipe are rejected.
					</p>
					<label>
						Target recipe
						<select
							aria-label="Launch target recipe"
							disabled={readOnly}
							value={targetId}
							onChange={(event) =>
								onChange({
									launchRuns: {
										...step.launchRuns!,
										workflow: event.target.value,
									},
								})
							}
						>
							{(!target?.allowedTriggers.includes("workflow") ||
								targetId === ownerId) && (
								<option value={targetId}>
									{target?.name ?? targetId} · unavailable
								</option>
							)}
							{recipes
								.filter(
									(recipe) =>
										recipe.id !== ownerId &&
										recipe.allowedTriggers.includes("workflow"),
								)
								.map((recipe) => (
									<option key={recipe.id} value={recipe.id}>
										{recipe.name}
									</option>
								))}
						</select>
					</label>
					<small>
						Only recipes allowing the workflow / Callable trigger may be
						launched, including default and indirectly called targets.
					</small>
					{targetProblem && (
						<p className="error" role="alert">
							{targetProblem}
						</p>
					)}
				</>
			)}
			<CheckJsonField
				label="Action configuration JSON"
				value={value}
				object
				rows={step.type === "snapshot" ? 5 : 16}
				readOnly={readOnly}
				onError={onError}
				validate={(next) => actionConfigurationProblem(step, next)}
				onChange={(next) =>
					onChange({ configVersion: "step-config-v1", [key]: next })
				}
			/>
			{step.type === "snapshot" && (
				<small>{`Use {} for tracked revisions only, or {"history":{"lookbackDays":30,"maxRuns":100}} for bounded history.`}</small>
			)}
			{problem && (
				<p className="error" role="alert">
					{problem}
				</p>
			)}
		</section>
	);
}
