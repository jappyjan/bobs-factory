import { useQuery } from "@tanstack/react-query";

import { Link } from "react-router-dom";
import type { ViewSnapshot } from "../HumanStep.js";

import {
	active,
	ago,
	api,
	attention,
	currentStepOf,
	elapsed,
	phase,
	stepFixing,
	stepIcon,
	stepsOf,
	useAction,
	useRun,
	workflowOf,
	workingLabel,
} from "./client";
import { activitiesOf } from "./conversation";

import { DisplayDocumentView, DisplayPanel } from "./display";

import { TimingSummary } from "./run-diagnostics";

import { Bob, Button, ConfirmStop, External, Markdown, useToast } from "./ui";
export const labels: Record<string, string> = {
	question: "💬 Question",
	stuck: "🩹 Stuck",
	review: "🎁 Ready to review",
};

/** A decision belongs to its accepted batch; old drafts never target a newer view. */
export function GenericHumanDecision({ run }: { run: any }) {
	const snapshot = run.viewDecision as ViewSnapshot | undefined;
	if (!snapshot) return null;
	return (
		<DisplayPanel
			key={`${run.id}/${snapshot.id}`}
			runId={run.id}
			snapshot={snapshot}
			disabled={run.status !== "waiting" || !!snapshot.answer}
		/>
	);
}

/** Show receipts remain visible after the ordinary recipe has progressed. */
export function RunViewDisplays({ run }: { run: any }) {
	const displays = (run.viewDisplays ?? []) as ViewSnapshot[];
	return displays.length ? (
		<section className="run-view-displays" aria-label="Recipe displays">
			{displays.map((snapshot) => (
				<section key={snapshot.id} className="review-surface">
					<h2>{snapshot.title}</h2>
					<DisplayDocumentView
						snapshot={snapshot}
						runId={run.id}
						disabled
						onSubmit={async () => {}}
					/>
				</section>
			))}
		</section>
	) : null;
}
export function RunMeta({ run, config }: { run: any; config: any }) {
	const repo = config.repositories.find(
			(r: any) =>
				r.id === run.repositoryId ||
				r.repositoryIds?.includes(run.repositoryId),
		),
		workflow = workflowOf(run, config);
	return (
		<span className="run-meta">
			<span className="repo-dot" /> {repo?.name ?? "Workspace"} ·{" "}
			{workflow.icon ?? "🧩"} {workflow.name} ·{" "}
			{ago(run.updatedAt ?? run.createdAt)}
			<span> · {originLabel(run)}</span>
		</span>
	);
}
export function originLabel(run: any): string {
	const origin = run.triggerOrigin;
	if (!origin) return "Origin unavailable for this older run";
	if (origin.type === "manual")
		return origin.manual?.method === "follow-up"
			? "Manual follow-up"
			: "Manual start";
	const ticket = origin.ticket;
	return `${ticket?.provider === "cli" ? "CLI fixture" : "Linear"} ${ticket?.subtype ?? "ticket start"}${ticket?.identifier ? ` · ${ticket.identifier}` : ""} · ${origin.workflowId} · ${selectionLabel(origin)}`;
}

function selectionLabel(origin: any): string {
	const selection = origin?.selection;
	switch (selection?.source) {
		case "manual":
			return "manual workflow choice";
		case "comment-selector":
			return `triggering comment ${selection.selector}`;
		case "description-selector":
			return `issue description ${selection.selector}`;
		case "label":
			return `configured label ${selection.label ?? "(label unavailable)"}`;
		case "default":
			return "saved default";
	}
	return origin?.selectionMethod === "label"
		? "configured label (label unavailable)"
		: origin?.selectionMethod === "default"
			? "saved default"
			: "selection source unavailable for this older run";
}

export function RunTitleStatus({ run }: { run: any }) {
	const action = useAction();
	const job = run.titleGeneration;
	if (job?.state === "pending")
		return (
			<p className="run-title-status" role="status">
				{job.retries ? "Retrying title…" : "Generating title…"}
			</p>
		);
	if (job?.state !== "failed") return null;
	return (
		<div className="run-title-status">
			<p>Title generation failed: {job.error ?? "Unknown error"}</p>
			<Button
				variant="ghost"
				requiresConnection
				busy={action.isPending}
				onClick={() =>
					void action
						.mutateAsync({
							path: `/api/runs/${encodeURIComponent(run.id)}/retry-title`,
						})
						.catch(() => {})
				}
			>
				Retry title
			</Button>
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
		</div>
	);
}

export function RunOrigin({ run }: { run: any }) {
	const origin = run.triggerOrigin;
	const calls =
		run.workflowCalls ?? (run.events ?? []).filter((event: any) => event.call);
	return (
		<section className="run-origin" aria-label="Launch origin">
			<p>
				{originLabel(run)}{" "}
				{origin?.ticket?.url && (
					<External href={origin.ticket.url}>Source ticket ↗</External>
				)}
				{origin?.manual?.sourceRunId && (
					<Link to={`/runs/${origin.manual.sourceRunId}`}>Source run</Link>
				)}
			</p>
			{origin && (
				<p>
					Workflow: {origin.workflowId} · Selected by{" "}
					{run.recipeParent
						? `the parent recipe ${run.recipeParent.workflowId}`
						: selectionLabel(origin)}
				</p>
			)}
			{(origin || calls.length > 0) && (
				<details>
					<summary>
						Launch details
						{calls.length ? ` and ${calls.length} workflow call(s)` : ""}
					</summary>
					<pre>{JSON.stringify(origin, null, 2)}</pre>
					{calls.map((event: any, index: number) => (
						<div key={event.sequence ?? index}>
							<p>
								Called {event.call.workflowId} from{" "}
								{event.call.callerWorkflowId}/{event.call.step} · {event.at}
							</p>
							<pre>{JSON.stringify(event.call, null, 2)}</pre>
						</div>
					))}
				</details>
			)}
		</section>
	);
}
/** Retained export for cached clients; the runtime supplies the stock Ask declaration. */
export function FinalMessage({ run }: { run: any }) {
	const latest = activitiesOf(run)
		.filter((item) => item.type === "response" || item.type === "thought")
		.at(-1);
	const index = latest?.raw?.activityIndex;
	const full = useQuery({
		queryKey: ["raw-entry", run.id, index],
		enabled: latest?.raw?.activityTruncated && typeof index === "number",
		queryFn: ({ signal }) =>
			api(`/api/runs/${encodeURIComponent(run.id)}/activity/entries/${index}`, {
				signal,
			}),
		staleTime: 60000,
		gcTime: 60000,
	});
	const message = full.data
		? activitiesOf({ ...run, entries: [full.data], events: [] })
				.filter((item) => item.type === "response" || item.type === "thought")
				.at(-1)?.body
		: latest?.body;
	return (
		<div className="final-message">
			<Bob mood="happy" size={32} />
			<Markdown>{message ?? "Bob finished this run."}</Markdown>
			{full.isLoading && <p role="status">Loading the complete response…</p>}
			{full.error && <p role="alert">{full.error.message}</p>}
		</div>
	);
}
export function FocusCard({
	summary,
	config,
	full = false,
	onInspect: _onInspect,
	onSettled,
	settling,
	onSkip,
	navigation,
}: {
	summary: any;
	config: any;
	full?: boolean;
	onInspect: (run: any, name: string, image?: number) => void;
	onSettled: () => void;
	settling?: boolean;
	onSkip?: () => void;
	navigation?: React.ReactNode;
}) {
	const detail = useRun(summary.id, full ? "dashboard" : "focus"),
		run = detail.data ?? summary,
		kind = attention(run) ?? "review",
		stopped = ["stopped", "cancelled"].includes(run.status),
		iterationExhausted =
			!!run.iterationLimit &&
			run.iterationLimit.visits > run.iterationLimit.limit,
		canResume = run.status === "stopped" && run.resumeAvailable === true,
		label =
			run.status === "waiting" && run.viewDecision && !run.viewDecision.answer
				? "Your response is needed"
				: labels[kind],
		toast = useToast(),
		action = useAction();
	return (
		<section
			className={`focus-card kind-${kind}`}
			aria-label={`${stopped ? "Stopped" : label}: ${run.title}`}
		>
			<div className="focus-top">
				{!full && (
					<>
						<span className={`chip ${kind}`}>
							{stopped ? "■ Stopped" : label}
						</span>
						<RunMeta run={run} config={config} />
						{navigation}
					</>
				)}
			</div>
			{!full && (
				<h2>
					<Link to={`/runs/${run.id}`}>{run.title}</Link>
				</h2>
			)}
			{detail.isLoading || run.pendingContext ? (
				<p role="status">Bob is loading this run…</p>
			) : run.status === "waiting" &&
				run.viewDecision &&
				!run.viewDecision.answer ? (
				<GenericHumanDecision run={run} />
			) : kind === "stuck" ? (
				<>
					<div className="stuck-panel">
						<Bob mood="oops" size={48} />
						<div>
							<strong>
								{stopped
									? "Stopped"
									: run.status === "interrupted"
										? "Interrupted"
										: "Stuck"}{" "}
								at {stepIcon(currentStepOf(run, config))}{" "}
								{currentStepOf(run, config)?.name ??
									run.step ??
									"Bob’s Factory session"}
							</strong>
							<Markdown>
								{run.workflowBlock?.reason ??
									run.error ??
									"The run stopped before finishing."}
							</Markdown>
							<small>
								{run.workflowBlock
									? "Enable the workflow and its dependencies in Recipes. Resume continues this saved checkpoint after the previous executor stops."
									: stopped
										? "Bring back keeps this run visible. Resume continues its saved progress; it does not restart finished steps."
										: iterationExhausted
											? "Continue grants 4 more passes for this step. Your work and history stay intact."
											: run.iterationLimit
												? `The saved budget now allows ${run.iterationLimit.limit} passes for this step. Retry continues from saved progress.`
												: "Retry keeps the worktree, your answers and every finished step."}
							</small>
						</div>
					</div>
					<div className="actions">
						<Button
							disabled={
								(stopped && !canResume) ||
								(!!run.workflowBlock && !run.resumeEligible)
							}
							requiresConnection
							busy={action.isPending}
							onClick={() =>
								void action
									.mutateAsync({
										path: `/api/runs/${run.id}/${stopped || run.workflowBlock ? "resume" : "retry"}`,
									})
									.then(() =>
										toast({
											text:
												stopped || run.workflowBlock
													? "Resuming from saved progress"
													: "Retrying from saved progress",
										}),
									)
									.catch(() => {})
							}
						>
							↻{" "}
							{run.workflowBlock
								? "Resume"
								: stopped
									? "Resume run"
									: iterationExhausted
										? "Continue (+4 passes)"
										: "Retry step"}{" "}
							<kbd>r</kbd>
						</Button>
						<Link className="button secondary" to={`/runs/${run.id}`}>
							What happened?
						</Link>
						<Button variant="ghost" busy={settling} onClick={onSettled}>
							Settle <kbd>e</kbd>
						</Button>
					</div>
					{action.error && (
						<p className="error" role="alert">
							{action.error.message}
						</p>
					)}
				</>
			) : (
				<>
					<FinalMessage run={run} />
					<Button busy={settling} onClick={onSettled}>
						Settle
					</Button>
				</>
			)}

			{onSkip && (
				<Button variant="ghost" className="skip-action" onClick={onSkip}>
					{kind === "review" ? "Later" : "Skip for now"} <kbd>s</kbd>
				</Button>
			)}
		</section>
	);
}
export function Progress({ run, config }: { run: any; config: any }) {
	const steps = stepsOf(run, config),
		visited = new Set(run.history?.map((h: any) => h.step));
	return (
		<span
			className={`progress ${!steps.length ? "single" : ""}`}
			role="img"
			aria-label={
				steps.length
					? `${visited.size} of ${steps.length} steps completed`
					: "Bob’s Factory session working"
			}
		>
			{(steps.length ? steps : [{ key: "simple" }]).map((step) => (
				<i
					key={step.key}
					className={
						run.capacityLeaves?.[step.key] ||
						run.step === step.key ||
						(!steps.length && active(run.status))
							? ["failed", "error"].includes(run.status)
								? "failed"
								: "current"
							: visited.has(step.key)
								? "done"
								: ""
					}
				/>
			))}
		</span>
	);
}
export function WorkingRow({
	run,
	config,
	expanded,
	onExpand,
}: {
	run: any;
	config: any;
	expanded: boolean;
	onExpand: () => void;
}) {
	const detail = useRun(expanded ? run.id : undefined),
		data = detail.data ?? run,
		action = useAction(),
		toast = useToast(),
		step = currentStepOf(data, config),
		latest = expanded ? activitiesOf(data).at(-1) : undefined;
	const visits =
		(data.history ?? []).filter((h: any) => h.step === data.step).length + 1;
	return (
		<article className="working-row">
			<button
				type="button"
				className="working-main"
				aria-expanded={expanded}
				onClick={onExpand}
			>
				<span className="repo-dot" />
				<strong>{run.title}</strong>
				<span className={`step-chip ${phase(step)}`}>
					{workingLabel(data)} · {stepIcon(step)}{" "}
					{step?.name ?? run.step ?? "Bob’s Factory session"}
					{stepFixing(step) && " · fixing"}
					{visits > 1 && ` · ↺${visits}`}
				</span>
				<Progress run={data} config={config} />
				<small>
					<TimingSummary diagnostics={data.diagnostics} />
					{!data.diagnostics && ` · Age ${elapsed(run.createdAt)}`}
				</small>
			</button>
			{expanded && (
				<div className="working-peek">
					<small>LATEST</small>
					<Markdown>
						{latest?.body ??
							`${latest?.title ?? "Bob is working"} ${latest?.parameter ?? ""}`}
					</Markdown>

					<div className="actions">
						<Link className="button secondary" to={`/runs/${run.id}`}>
							Open run
						</Link>
						<ConfirmStop
							requiresConnection
							busy={action.isPending}
							onStop={() =>
								void action
									.mutateAsync({ path: `/api/runs/${run.id}/stop` })
									.then(() => toast({ text: "Run stopped" }))
									.catch(() => {})
							}
						/>
					</div>
					{action.error && <p role="alert">{action.error.message}</p>}
				</div>
			)}
		</article>
	);
}
