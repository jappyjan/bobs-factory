import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ViewSnapshot } from "../HumanStep.js";
import { ArchitectureEntry } from "./architecture";
import { AskView } from "./ask-view";
import {
	active,
	ago,
	api,
	attention,
	currentStepOf,
	elapsed,
	finished,
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
import { DeclarativeView, HumanStepPanel } from "./declarative-view";
import { ExternalRecovery } from "./external-recovery";
import { useCurrentForm, useFormState } from "./form-state";
import { revisionOf } from "./restoration";
import { GuidedReview } from "./review";
import { useApproval } from "./review-approval";
import {
	type FeedbackController,
	useFeedbackController,
	useReviewFeedback,
} from "./review-comments";
import { reviewDiffUrl } from "./review-context";
import {
	emptyFeedback,
	feedbackKey,
	hasFeedback,
	serializeFeedback,
} from "./review-feedback";
import {
	ReviewGuideComponent,
	type ReviewGuideViewComponent,
	reviewGuideValue,
} from "./review-guide-component";
import {
	guideMatchesGate,
	reviewRevision,
	signature,
	ticketTrackingPending,
} from "./review-state";
import { mergeReadinessFor, roleOutput } from "./run-output";
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
		<HumanStepPanel
			key={`${run.id}/${snapshot.id}`}
			runId={run.id}
			snapshot={snapshot}
			disabled={run.status !== "waiting" || Boolean(snapshot.answer)}
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
					<DeclarativeView view={snapshot.view} runId={run.id} disabled />
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
					Workflow: {origin.workflowId} · Selected by {selectionLabel(origin)}
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
export function QuestionForm({ run }: { run: any }) {
	return <AskView run={run} />;
}

function reviewComponent(run: any, presentation = run.nativeView) {
	return presentation?.view.components.find(
		(component: { type: string }) => component.type === "review-guide",
	) as ReviewGuideViewComponent | undefined;
}
function currentGuide(run: any) {
	return roleOutput(run, "guide");
}
function reviewView(run: any) {
	return ["review", "external-review"].includes(run.nativeView?.preset);
}
export function NativeHumanDecision({ run }: { run: any }) {
	if (run.nativeViewError)
		return (
			<p role="alert" className="error">
				{run.nativeViewError}
			</p>
		);
	const snapshot = run.nativeView;
	if (!snapshot) return null;
	if (snapshot.preset === "approve" && snapshot.authority === "approve")
		return <ArchitectureEntry run={run} />;
	if (
		reviewView(run) &&
		["review", "external-review"].includes(snapshot.authority)
	)
		return <ReviewEntry run={run} />;
	return (
		<DeclarativeView
			view={snapshot.view}
			runId={run.id}
			renderComponent={(component) =>
				component.type === "questions" && snapshot.authority === "ask" ? (
					<AskView run={run} data={component.data} />
				) : undefined
			}
		/>
	);
}

export function ReviewEntry({ run }: { run: any }) {
	const guide = currentGuide(run),
		gate = run.reviewGate,
		url = gate?.url ?? roleOutput(run, "draft-pr")?.url;
	return (
		<div className="review-entry">
			<p>
				{String(
					guide?.verdict?.headline ??
						guide?.summary ??
						guide?.goal ??
						"Read the changes, evidence and final checks before deciding.",
				).slice(0, 320)}
			</p>
			<p className="muted">
				{gate?.status === "pending"
					? "Awaiting your review"
					: `Review guide · ${run.status}`}
				{gate?.headSha && (
					<>
						{" "}
						· revision <code>{gate.headSha.slice(0, 8)}</code>
					</>
				)}
			</p>
			<div className="actions">
				<Link
					className="button primary"
					to={`/runs/${run.id}/review`}
					state={{ focusRunId: run.id }}
				>
					Open review guide →
				</Link>
				<Link
					className="button ghost"
					to={`/runs/${run.id}`}
					state={{ focusRunId: run.id }}
				>
					Open run
				</Link>
				{url && (
					<External className="button secondary" href={url}>
						Open PR ↗
					</External>
				)}
			</div>
		</div>
	);
}

export function FullReview({
	run,
	onSettled,
	settling,
	presentation = run.nativeView,
}: {
	run: any;
	onSettled: () => void;
	settling?: boolean;
	presentation?: any;
}) {
	const guide =
			reviewGuideValue(run, reviewComponent(run, presentation), presentation) ??
			currentGuide(run),
		version = `${run.reviewGate?.id ?? "historical"}/${run.reviewGate?.headSha ?? ""}/${guide?.__artifactHash ?? signature(guide ?? null)}`,
		previous = useRef(version),
		[updated, setUpdated] = useState(false);
	useEffect(() => {
		if (previous.current !== version) setUpdated(true);
		previous.current = version;
	}, [version]);
	return (
		<>
			{updated && (
				<p className="notice" role="status">
					This review has been updated. Review the current guide and revision
					before deciding. Unsent feedback has been discarded.
				</p>
			)}
			{presentation ? (
				<DeclarativeView
					view={presentation.view}
					runId={run.id}
					renderComponent={(component) =>
						component.type === "review-guide" ? (
							<ReviewGuideComponent
								component={component}
								run={run}
								presentation={presentation}
								documentPage
								controls={(identity, decisionPage) => (
									<DecisionActions
										key={`${identity}/${run.reviewGate?.id ?? "finished"}`}
										identity={identity}
										decisionPage={decisionPage}
										run={run}
										onSettled={onSettled}
										settling={settling}
									/>
								)}
							/>
						) : undefined
					}
				/>
			) : (
				<GuidedReview
					value={guide}
					run={run}
					documentPage
					controls={(identity, decisionPage) => (
						<DecisionActions
							key={`${identity}/${run.reviewGate?.id ?? "finished"}`}
							identity={identity}
							decisionPage={decisionPage}
							run={run}
							onSettled={onSettled}
							settling={settling}
						/>
					)}
				/>
			)}
			{presentation &&
				["review", "external-review"].includes(presentation.authority) &&
				!reviewComponent(run, presentation) && (
					<DecisionActions
						run={run}
						decisionPage
						onSettled={onSettled}
						settling={settling}
					/>
				)}
		</>
	);
}

type DecisionProps = {
	run: any;
	identity?: string;
	decisionPage?: boolean;
	onSettled: () => void;
	settling?: boolean;
};
function DecisionActions(props: DecisionProps) {
	const controller = useReviewFeedback();
	return controller ? (
		<ReviewDecisions {...props} controller={controller} />
	) : (
		<LocalDecisions {...props} />
	);
}
function LocalDecisions(props: DecisionProps) {
	const controller = useFeedbackController(
		feedbackKey(
			props.identity ?? `factory-review/${props.run.id}/finished`,
			props.run.reviewGate?.id,
		),
		revisionOf([
			props.run.reviewGate,
			props.run.nativeView?.digest,
			props.run.status,
			props.run.chat?.mode,
		]),
	);
	return <ReviewDecisions {...props} controller={controller} />;
}
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
export function GuideRefreshAction({
	run,
	busy,
	onRefresh,
}: {
	run: any;
	busy: boolean;
	onRefresh: () => void;
}) {
	if (run.status !== "waiting" || run.reviewCapabilities?.refreshGuide !== true)
		return null;
	return (
		<Button variant="ghost" requiresConnection busy={busy} onClick={onRefresh}>
			Refresh guide
		</Button>
	);
}

function ReviewDecisions({
	run,
	identity = `factory-review/${run.id}/finished`,
	decisionPage = true,
	onSettled,
	settling,
	controller,
}: DecisionProps & { controller: FeedbackController }) {
	const toast = useToast(),
		navigate = useNavigate(),
		{ action, approve } = useApproval(run, controller),
		[validationError, setValidationError] = useFormState(
			controller.context,
			"",
		);
	const isCurrent = useCurrentForm(controller.context);
	const { draft, update, busy } = controller;
	const feedback = draft.feedback,
		feedbackOpen = draft.open;
	const setFeedback = (feedback: string) => update((d) => ({ ...d, feedback }));
	const setFeedbackOpen = (open: boolean) => update((d) => ({ ...d, open }));
	const guide = currentGuide(run),
		gate = run.reviewGate,
		waiting = gate?.status === "pending",
		trackingPending = ticketTrackingPending(run),
		matching = !waiting || (run.status === "waiting" && guideMatchesGate(run)),
		url = roleOutput(run, "draft-pr")?.url ?? gate?.url;
	const reject = async () => {
		if (!hasFeedback(draft) || busy || action.isPending || !matching) return;
		let feedback: string;
		try {
			feedback = serializeFeedback(
				draft,
				guide
					? {
							revision: reviewRevision(run) || "historical",
							goal:
								guide.verdict?.headline ??
								guide.goal ??
								guide.summary ??
								"Review guide",
							identity,
						}
					: undefined,
			);
			setValidationError("");
		} catch (error) {
			setValidationError((error as Error).message);
			return;
		}
		if (!controller.lock()) return;
		try {
			if (waiting) {
				await action.mutateAsync({
					path: `/api/runs/${run.id}/review`,
					body: {
						reviewId: gate.id,
						headSha: gate.headSha,
						externalDigest: gate.externalDigest,
						...(run.nativeView
							? { display: { digest: run.nativeView.digest } }
							: {}),
						decision: "reject",
						feedback,
					},
				});
			} else if (run.chat?.available && run.chat.mode === "continue") {
				await action.mutateAsync({
					path: `/api/runs/${run.id}/messages`,
					body: { text: feedback },
				});
				if (isCurrent()) navigate(`/runs/${run.id}`);
			} else {
				const next = await action.mutateAsync({
					path: `/api/runs/${run.id}/followup`,
					body: { feedback },
				});
				if (isCurrent()) navigate(`/runs/${next.id}`);
			}
			toast({ text: "Feedback sent — Bob is on it" });
			controller.clear(draft);
		} catch {
			/* error stays visible; the submitted draft is retained. */
		} finally {
			controller.unlock();
		}
	};
	return (
		<>
			{waiting && !matching && (
				<p className="notice" role="status">
					The pending revision changed. Decisions are unavailable until its
					matching guide is loaded.
				</p>
			)}
			{!guide && <FinalMessage run={run} />}
			{(guide || feedbackOpen) && (
				<form
					className="feedback-form"
					onSubmit={(e) => {
						e.preventDefault();
						void reject();
					}}
				>
					{(!guide || decisionPage || feedbackOpen) && (
						<label>
							{guide ? "Additional feedback" : "What should Bob change?"}
							<textarea
								rows={guide ? 6 : 3}
								disabled={busy}
								placeholder="What else should Bob change?"
								value={feedback}
								onChange={(e) => setFeedback(e.target.value)}
							/>
						</label>
					)}
					<div className="actions">
						<Button
							type="submit"
							busy={busy || action.isPending}
							requiresConnection
							disabled={!hasFeedback(draft) || !matching}
						>
							{gate?.mode === "external"
								? "Request changes"
								: "Submit feedback to Bob"}
						</Button>
						{!decisionPage && (
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => setFeedbackOpen(!feedbackOpen)}
							>
								{feedbackOpen
									? "Hide additional feedback"
									: "Add additional feedback"}
							</Button>
						)}
						{!guide && (
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => {
									update(emptyFeedback);
									setValidationError("");
								}}
							>
								Cancel
							</Button>
						)}
					</div>
					{validationError && (
						<p className="error" role="alert">
							{validationError}
						</p>
					)}
				</form>
			)}
			{(guide || !feedbackOpen) && (
				<div className="actions">
					{(!guide || decisionPage) &&
						(waiting || !trackingPending) &&
						!["running", "interrupted"].includes(run.status) && (
							<Button
								variant={guide ? "rainbow" : "primary"}
								requiresConnection
								busy={busy || action.isPending || settling}
								disabled={
									busy || !matching || (!waiting && !finished(run.status))
								}
								onClick={() => {
									if (waiting) return approve();
									if (
										trackingPending ||
										!matching ||
										action.isPending ||
										!controller.lock()
									)
										return;
									onSettled();
									controller.unlock();
								}}
							>
								{waiting
									? gate.mode === "external"
										? "Accept completed work"
										: "Approve this PR"
									: guide
										? "Settle"
										: "Got it — settle"}
							</Button>
						)}

					{finished(run.status) &&
						gate?.externalDigest &&
						run.ticketSync?.error && (
							<Button
								variant="secondary"
								requiresConnection
								busy={busy || action.isPending}
								onClick={() => {
									if (!controller.lock()) return;
									void action
										.mutateAsync({
											path: `/api/runs/${run.id}/external-reverify`,
											body: {},
										})
										.catch(() => {})
										.finally(() => controller.unlock());
								}}
							>
								Reverify ticket changes
							</Button>
						)}
					<GuideRefreshAction
						run={run}
						busy={busy || action.isPending}
						onRefresh={() => {
							if (!controller.lock()) return;
							void action
								.mutateAsync({
									path: `/api/runs/${run.id}/guide/refresh`,
									body: { reviewId: gate.id },
								})
								.then(() =>
									toast({
										text: "Refreshing the guide — existing reviews and images are retained",
									}),
								)
								.catch(() => {})
								.finally(() => controller.unlock());
						}}
					/>

					{url && (
						<External className="button secondary" href={reviewDiffUrl(url)}>
							Open diff ↗
						</External>
					)}
					{url && (
						<External className="button secondary" href={url}>
							Open PR #{url.split("/").at(-1)} ↗
						</External>
					)}
					{!guide && (
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => setFeedbackOpen(true)}
						>
							Ask a follow-up
						</Button>
					)}
					{!guide && (
						<Link className="button ghost" to={`/runs/${run.id}`}>
							Open run
						</Link>
					)}
				</div>
			)}

			{waiting && (
				<small className="muted">
					{gate.mode === "external"
						? "Acceptance applies to the verified ticket state. Completion requires a fresh matching state check."
						: `Approval applies to ${gate.headSha.slice(0, 8)}. Settles after the Git provider confirms the merge.`}
				</small>
			)}
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
		</>
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
				? run.viewDecision.kind === "approve"
					? "✓ Approval needed"
					: "☷ Decide per item"
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
			) : kind !== "stuck" && (run.nativeView || run.nativeViewError) ? (
				<NativeHumanDecision run={run} />
			) : kind === "stuck" ? (
				<>
					<ExternalRecovery key={run.id} run={run} />
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
			) : reviewView(run) ? (
				<ReviewEntry run={run} />
			) : (
				<DecisionActions
					key={`${run.id}/${run.reviewGate?.id ?? "finished"}`}
					run={run}
					onSettled={onSettled}
					settling={settling}
				/>
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
		readiness = mergeReadinessFor(data),
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
				<small>{elapsed(run.createdAt)}</small>
			</button>
			{expanded && (
				<div className="working-peek">
					<small>LATEST</small>
					<Markdown>
						{latest?.body ??
							`${latest?.title ?? "Bob is working"} ${latest?.parameter ?? ""}`}
					</Markdown>
					{readiness?.blockers?.length > 0 && (
						<ul>
							{readiness.blockers.map((b: any, i: number) => (
								<li key={i}>{b.message}</li>
							))}
						</ul>
					)}
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
