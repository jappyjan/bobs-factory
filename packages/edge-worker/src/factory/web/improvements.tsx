import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
	ImprovementPackage,
	ImprovementState,
	IssueDestination,
	ItemChoice,
	Opportunity,
} from "../Improvement";
import { api, useAction } from "./client";
import { useFormState } from "./form-state";
import { Bob, Button, External, Markdown } from "./ui";

type View = Pick<
	ImprovementState,
	| "phase"
	| "revision"
	| "proposals"
	| "choices"
	| "comments"
	| "manifest"
	| "children"
	| "issues"
	| "limitations"
> & {
	acceptance?: { digest: string; actor: string; at: string };
	jobs: Record<
		string,
		{
			role: string;
			status: string;
			error?: string;
			settings?: { runner?: string; model?: string };
		}
	>;
};
type Action = ItemChoice["action"];
type Destinations = {
	options: { name: string; destination: IssueDestination }[];
	limitations: string[];
};

export function useImprovementResearch(
	run: { id: string; improvement?: unknown } | undefined,
) {
	return useQuery({
		queryKey: ["run", run?.id, "improvements"],
		enabled: Boolean(run?.improvement),
		queryFn: ({ signal }) =>
			api<View>(`/api/runs/${run!.id}/improvements`, { signal }),
	});
}

const choiceOptions: {
	value: Action;
	label: string;
	icon: string;
	tone: string;
}[] = [
	{ value: "fix", label: "Fix it", icon: "🛠️", tone: "green" },
	{ value: "issue", label: "File issue", icon: "🎫", tone: "blue" },
	{ value: "ignore", label: "Skip", icon: "💤", tone: "quiet" },
	{ value: "follow-up", label: "Ask Bob", icon: "💬", tone: "orange" },
];
const choiceLabel = (action?: Action) =>
	choiceOptions.find((o) => o.value === action);
const strengths = {
	strong: { label: "Strong case", tone: "green" },
	"worth-exploring": { label: "Worth exploring", tone: "blue" },
	speculative: { label: "Speculative", tone: "amber" },
} as const;
const stages = ["Research", "Choose", "Check plans", "Launch", "Track"];
const groupLabels: Record<string, string> = {
	context: "Shared context",
	changes: "Recent changes",
	architecture: "Architecture",
	security: "Security",
	structure: "Structure",
	patterns: "Patterns",
	verification: "Verification",
	reliability: "Reliability",
	operations: "Operations",
	synthesis: "Proposal",
	plans: "Plans",
	checks: "Plan checks",
};
const checkNames = ["Architecture", "Security", "Dependencies"];
const plural = (n: number, word: string, many = `${word}s`) =>
	`${n} ${n === 1 ? word : many}`;
const actorName = (actor: string) =>
	actor === "local-operator"
		? "You"
		: actor === "independent plan checks"
			? "Plan checks"
			: actor;

function stageOf(state: View) {
	switch (state.phase) {
		case "research":
			return state.proposals.length ? 1 : 0;
		case "discussion":
			return 1;
		case "planning":
			return 2;
		case "ready":
			return 3;
		case "dispatch":
			return 4;
		default:
			return state.acceptance ? stages.length : -1;
	}
}

/** Group research jobs by the perspective or stage named in their stable IDs. */
function researchGroups(jobs: View["jobs"]) {
	const groups = new Map<
		string,
		{
			key: string;
			total: number;
			done: number;
			running: number;
			failed: number;
			workers: number;
		}
	>();
	for (const [id, job] of Object.entries(jobs)) {
		const key =
			id === "lead"
				? "context"
				: id.startsWith("proposal-")
					? "synthesis"
					: id.startsWith("package-")
						? "plans"
						: id.startsWith("check-")
							? "checks"
							: (id.match(/^(?:coordinate|worker|results)-([a-z]+)/)?.[1] ??
								"other");
		const group = groups.get(key) ?? {
			key,
			total: 0,
			done: 0,
			running: 0,
			failed: 0,
			workers: 0,
		};
		group.total++;
		if (job.status === "completed") group.done++;
		else if (job.status === "failed") group.failed++;
		else group.running++;
		if (job.role === "research-worker") group.workers++;
		groups.set(key, group);
	}
	const order = Object.keys(groupLabels);
	const rank = (key: string) =>
		order.includes(key) ? order.indexOf(key) : order.length;
	return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Order work packages into waves: each wave can run in parallel once the previous ones are delivered. */
function wavesOf(packages: ImprovementPackage[]) {
	const level = new Map<string, number>();
	const visit = (pkg: ImprovementPackage): number => {
		if (level.has(pkg.id)) return level.get(pkg.id)!;
		level.set(pkg.id, 0);
		const value = Math.max(
			0,
			...pkg.dependencies.map((id) => {
				const dep = packages.find((p) => p.id === id);
				return dep ? visit(dep) + 1 : 0;
			}),
		);
		level.set(pkg.id, value);
		return value;
	};
	const waves: ImprovementPackage[][] = [];
	for (const pkg of packages) {
		const wave = visit(pkg);
		waves[wave] = [...(waves[wave] ?? []), pkg];
	}
	return waves.filter(Boolean);
}

/** Mirrors the server's final choice validation so problems show on the card, not after submitting. */
function choiceProblems(
	item: Opportunity,
	choices: Record<string, ItemChoice>,
	items: Opportunity[],
) {
	const choice = choices[item.id],
		title = (id: string) => items.find((i) => i.id === id)?.title ?? id,
		problems: string[] = [];
	if (choice?.action === "fix") {
		for (const dep of item.dependencies)
			if (choices[dep]?.action !== "fix")
				problems.push(`This builds on “${title(dep)}”. Fix that one too.`);
		for (const other of item.conflicts)
			if (choices[other]?.action === "fix")
				problems.push(
					`“${title(other)}” is an alternative approach. Fix only one of them.`,
				);
	}
	if (choice?.action === "issue" && !choice.destination)
		problems.push("Choose where to file this issue.");
	if (choice?.action === "follow-up")
		problems.push("Send your question to Bob, or pick another option.");
	return problems;
}

export function ImprovementPanel({ run }: { run: any }) {
	const query = useImprovementResearch(run);
	return (
		<section className="improve" aria-label="Codebase improvement proposals">
			{query.isLoading ? (
				<p role="status" className="muted">
					Loading Bob’s research…
				</p>
			) : query.error ? (
				<p role="alert" className="error">
					{query.error.message}
				</p>
			) : query.data ? (
				<ImprovementContent key={run.id} run={run} state={query.data} />
			) : null}
		</section>
	);
}

function ImprovementContent({ run, state }: { run: any; state: View }) {
	const proposal = state.proposals.at(-1),
		context = `${run.id}:${proposal?.digest ?? "research"}:${state.revision}`;
	const [choices, setChoices] = useFormState<Record<string, ItemChoice>>(
		context,
		() => structuredClone(state.choices),
	);
	const [questions, setQuestions] = useFormState<Record<string, string>>(
		context,
		{},
	);
	const [error, setError] = useState("");
	const [historical, setHistorical] = useState<number>();
	const action = useAction(`improvements/${run.id}`, context);
	const wantsIssue = Object.values(choices).some((c) => c.action === "issue");
	const destinations = useQuery({
		queryKey: ["run", run.id, "improvement-destinations"],
		enabled: wantsIssue && !state.acceptance,
		queryFn: ({ signal }) =>
			api<Destinations>(`/api/runs/${run.id}/improvement-destinations`, {
				signal,
			}),
	});
	const lastComment = state.comments.at(-1);
	const planFeedback =
		state.phase === "discussion" &&
		lastComment?.actor === "independent plan checks"
			? lastComment
			: undefined;
	const pending =
		run.status === "waiting" &&
		!state.acceptance &&
		["discussion", "ready"].includes(state.phase);
	const busy = ["research", "planning"].includes(state.phase);
	const submit = async (kind: string, extra: Record<string, unknown> = {}) => {
		if (!proposal) return;
		setError("");
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/improvements`,
				body: {
					version: proposal.version,
					digest: proposal.digest,
					expectedRevision: state.revision,
					action: kind,
					...extra,
				},
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	const visible =
			historical === undefined
				? proposal
				: state.proposals.find((p) => p.version === historical),
		current = visible === proposal,
		items = visible?.opportunities ?? [],
		stage = stageOf(state),
		editable = current && !state.acceptance;
	const setChoice = (id: string, patch: Partial<ItemChoice>) =>
		setChoices((old) => ({
			...old,
			[id]: {
				action: old[id]?.action ?? "fix",
				comment: old[id]?.comment ?? "",
				destination: old[id]?.destination,
				...patch,
			},
		}));
	const problems = Object.fromEntries(
		(proposal?.opportunities ?? []).map((item) => [
			item.id,
			choiceProblems(item, choices, proposal!.opportunities),
		]),
	);
	const overallComments = state.comments.filter(
		(c) => !c.itemId && c !== planFeedback,
	);
	const limitations = [
		...new Set([...state.limitations, ...(visible?.limitations ?? [])]),
	];
	return (
		<>
			{stage >= 0 && <PhaseTrack stage={stage} />}
			{(busy || Object.keys(state.jobs).length > 0) && (
				<ResearchCard state={state} active={busy} />
			)}
			{state.phase === "finished" && !state.acceptance && (
				<div className="imp-card imp-done">
					<Bob mood="sleepy" size={48} />
					<div>
						<h3>
							{proposal?.opportunities.length
								? "Finished without changes"
								: "Nothing worth changing right now"}
						</h3>
						<p className="muted">
							{proposal?.opportunities.length
								? "No runs were started and no issues were filed."
								: "Bob didn’t find substantial architectural improvements in the inspected scope. Good enough is fine."}
						</p>
					</div>
				</div>
			)}
			{planFeedback && (
				<section className="imp-card imp-feedback" role="status">
					<header>
						<Bob mood="alert" size={40} />
						<div>
							<h3>The plan checks asked for changes</h3>
							<p className="muted">
								Independent reviewers found problems in the implementation plan.
								Adjust your choices or ask Bob below, then revise the plans.
							</p>
						</div>
					</header>
					<Markdown>
						{planFeedback.text.replace(/^Independent plan corrections:\s*/, "")}
					</Markdown>
				</section>
			)}
			{visible && (
				<section
					className="imp-proposal"
					aria-labelledby="improvement-proposal"
				>
					<div className="imp-proposal-top">
						<span className="imp-eyebrow">
							Proposal {visible.version}
							{!current && " · earlier version"}
						</span>
						{state.proposals.length > 1 && (
							<nav className="imp-versions" aria-label="Proposal versions">
								{state.proposals.map((p) => (
									<button
										key={p.version}
										type="button"
										aria-pressed={p.version === visible.version}
										onClick={() =>
											setHistorical(p === proposal ? undefined : p.version)
										}
									>
										v{p.version}
										{p === proposal && (
											<span className="sr-only"> (current)</span>
										)}
									</button>
								))}
							</nav>
						)}
					</div>
					<h2 id="improvement-proposal">
						{items.length
							? `Bob found ${plural(items.length, "improvement")} worth considering`
							: "No substantial improvements found"}
					</h2>
					<div className="imp-summary">
						<Markdown>{visible.summary}</Markdown>
					</div>
					{limitations.length > 0 && (
						<details className="imp-limits">
							<summary>
								What this research didn’t cover ({limitations.length})
							</summary>
							<ul>
								{limitations.map((l) => (
									<li key={l}>{l}</li>
								))}
							</ul>
						</details>
					)}
					{!current && (
						<p className="imp-notice" role="status">
							You’re viewing an earlier version.{" "}
							<button
								type="button"
								className="link"
								onClick={() => setHistorical(undefined)}
							>
								Back to the current proposal
							</button>
						</p>
					)}
				</section>
			)}
			{items.length > 0 && (
				<ol className="imp-items">
					{items.map((item, index) => (
						<li key={item.id}>
							<OpportunityCard
								item={item}
								index={index}
								items={items}
								choice={
									state.acceptance || !current
										? state.choices[item.id]
										: choices[item.id]
								}
								editable={editable}
								disabled={!pending || action.isPending}
								accepted={Boolean(state.acceptance) && current}
								problems={editable ? (problems[item.id] ?? []) : []}
								comments={state.comments.filter((c) => c.itemId === item.id)}
								question={questions[item.id] ?? ""}
								destinations={destinations}
								onChoose={(value) => setChoice(item.id, { action: value })}
								onChange={(patch) => setChoice(item.id, patch)}
								onQuestion={(text) =>
									setQuestions((old) => ({ ...old, [item.id]: text }))
								}
								onAsk={() =>
									void submit("follow-up", {
										itemId: item.id,
										comment: questions[item.id],
										choices,
									})
								}
								busy={action.isPending}
							/>
						</li>
					))}
				</ol>
			)}
			{editable && items.length > 0 && (
				<section
					className="imp-card imp-discuss"
					aria-labelledby="improvement-discuss"
				>
					<h3 id="improvement-discuss">Anything missing?</h3>
					<p className="muted">
						Ask about the whole proposal — look deeper somewhere, merge items or
						challenge a conclusion. Bob researches again and updates the
						proposal.
					</p>
					{overallComments.length > 0 && <Thread comments={overallComments} />}
					<div className="imp-composer">
						<textarea
							rows={2}
							aria-label="Comment on the whole proposal"
							placeholder="e.g. Also look at how secrets reach agent sessions"
							value={questions.overall ?? ""}
							disabled={!pending || action.isPending}
							onChange={(e) =>
								setQuestions((old) => ({ ...old, overall: e.target.value }))
							}
						/>
						<Button
							variant="secondary"
							disabled={
								!pending || !questions.overall?.trim() || action.isPending
							}
							onClick={() =>
								void submit("follow-up", {
									comment: questions.overall,
									choices,
								})
							}
						>
							Send to Bob
						</Button>
					</div>
					<div className="imp-finish">
						<span className="muted">Nothing here worth doing?</span>
						<ConfirmButton
							label="Finish without changes"
							confirm="Really finish?"
							disabled={!pending}
							busy={action.isPending}
							onConfirm={() => void submit("finish")}
						/>
					</div>
				</section>
			)}
			{state.manifest && current && (
				<BatchSection
					state={state}
					items={proposal?.opportunities ?? []}
					stale={
						!state.acceptance &&
						JSON.stringify(choices) !== JSON.stringify(state.manifest.choices)
					}
					destinations={destinations.data}
					running={run.status !== "completed"}
					busy={action.isPending}
					onStop={() => void submit("stop-batch")}
				/>
			)}
			{error && (
				<p role="alert" className="error imp-error">
					{error}
				</p>
			)}
			{editable && items.length > 0 && (
				<DecisionBar
					state={state}
					choices={choices}
					items={items}
					problems={Object.values(problems).flat().length}
					pending={pending}
					busy={action.isPending}
					planFeedback={Boolean(planFeedback)}
					onSave={() => void submit("choose", { choices })}
					onPrepare={() => void submit("prepare", { choices })}
					onApply={() =>
						void submit("apply", { manifestDigest: state.manifest?.digest })
					}
				/>
			)}
		</>
	);
}

function PhaseTrack({ stage }: { stage: number }) {
	return (
		<ol className="imp-track" aria-label="Improvement progress">
			{stages.map((label, i) => (
				<li
					key={label}
					className={i < stage ? "done" : i === stage ? "current" : undefined}
					aria-current={i === stage ? "step" : undefined}
				>
					<span className="imp-track-dot" aria-hidden="true">
						{i < stage ? "✓" : i + 1}
					</span>
					<span className="imp-track-label">{label}</span>
				</li>
			))}
		</ol>
	);
}

function ResearchCard({ state, active }: { state: View; active: boolean }) {
	const jobs = Object.values(state.jobs),
		done = jobs.filter((j) => j.status === "completed").length,
		groups = researchGroups(state.jobs),
		perspectives = groups.filter((g) => g.workers > 0).length,
		model = jobs.find((j) => j.role === "research-worker" && j.settings?.model)
			?.settings?.model,
		failed = Object.entries(state.jobs).filter(([, j]) => j.error);
	const grid = (
		<>
			<ul className="imp-groups">
				{groups.map((g) => {
					const status = g.running ? "running" : g.failed ? "failed" : "done";
					return (
						<li key={g.key} className={`imp-group ${status}`}>
							<span className="imp-group-dot" aria-hidden="true" />
							<span>
								<strong>{groupLabels[g.key] ?? "Other"}</strong>
								<small>
									{status === "running"
										? `Working · ${g.done}/${g.total}`
										: status === "failed"
											? `${g.failed} failed`
											: g.workers
												? `${plural(g.workers, "worker")} · done`
												: "Done"}
								</small>
							</span>
						</li>
					);
				})}
			</ul>
			{failed.map(([id, j]) => (
				<p key={id} className="error imp-job-error">
					<strong>{id.replaceAll("-", " ")}:</strong> {j.error}
				</p>
			))}
		</>
	);
	if (!active)
		return (
			<details className="imp-research-summary">
				<summary>
					<span className="imp-emoji" aria-hidden="true">
						🔎
					</span>{" "}
					Researched from {plural(perspectives, "perspective")} ·{" "}
					{plural(done, "assignment")}
					{model ? ` · workers on ${model}` : ""}
				</summary>
				{grid}
			</details>
		);
	const planning = state.phase === "planning";
	return (
		<section className="imp-card imp-research" aria-live="polite">
			<header>
				<Bob mood="busy" size={52} />
				<div>
					<h3>
						{planning
							? "Bob is planning your batch"
							: state.proposals.length
								? "Bob is looking into your feedback"
								: "Bob is surveying the codebase"}
					</h3>
					<p className="muted">
						{planning
							? "Each fix gets an implementation plan. Independent architecture, security and dependency checks then review the whole batch."
							: state.proposals.length
								? "Targeted research is running. The proposal updates when it finishes; your other choices are kept."
								: "Eight perspectives research in parallel, from recent changes to security. Bob looks for architectural and systemic improvements, not nits."}
					</p>
				</div>
			</header>
			{jobs.length > 0 && (
				<>
					<div
						className="imp-progress"
						role="progressbar"
						aria-label="Research progress"
						aria-valuemin={0}
						aria-valuemax={jobs.length}
						aria-valuenow={done}
					>
						<span style={{ width: `${(done / jobs.length) * 100}%` }} />
					</div>
					<p className="imp-progress-label">
						{done} of {plural(jobs.length, "assignment")} done
						{model ? ` · workers on ${model}` : ""}
					</p>
					{grid}
				</>
			)}
		</section>
	);
}

function OpportunityCard({
	item,
	index,
	items,
	choice,
	editable,
	disabled,
	accepted,
	problems,
	comments,
	question,
	destinations,
	onChoose,
	onChange,
	onQuestion,
	onAsk,
	busy,
}: {
	item: Opportunity;
	index: number;
	items: Opportunity[];
	choice?: ItemChoice;
	editable: boolean;
	disabled: boolean;
	accepted: boolean;
	problems: string[];
	comments: View["comments"];
	question: string;
	destinations: UseQueryResult<Destinations>;
	onChoose: (value: Action) => void;
	onChange: (patch: Partial<ItemChoice>) => void;
	onQuestion: (text: string) => void;
	onAsk: () => void;
	busy: boolean;
}) {
	const strength = strengths[item.strength],
		[size, ...effortDetail] = item.effort.split(":"),
		shortEffort = size!.length <= 14 ? size : "Effort",
		number = (id: string) => items.findIndex((i) => i.id === id) + 1,
		chosen = choiceLabel(choice?.action),
		titleId = `improvement-${item.id}-title`;
	return (
		<article
			className={`imp-item choice-${choice?.action ?? "none"}`}
			aria-labelledby={titleId}
		>
			<header className="imp-item-head">
				<span className="imp-number" aria-hidden="true">
					{index + 1}
				</span>
				<div>
					<h3 id={titleId}>{item.title}</h3>
					<div className="chips">
						<span className={`chip ${strength.tone}`}>{strength.label}</span>
						<span className="chip" title={item.effort}>
							{shortEffort} effort
						</span>
						{item.dependencies.map((id) => (
							<span key={id} className="chip violet">
								Builds on #{number(id)}
							</span>
						))}
						{item.conflicts.map((id) => (
							<span key={id} className="chip amber">
								Alternative to #{number(id)}
							</span>
						))}
						{accepted && chosen && (
							<span className={`chip ${chosen.tone}`}>
								{chosen.icon} {chosen.label}
							</span>
						)}
					</div>
				</div>
			</header>
			<div className="imp-item-body">
				<Markdown>{item.problem}</Markdown>
				<div className="imp-why">
					<strong>Why it matters</strong>
					<Markdown>{item.consequence}</Markdown>
				</div>
				<div className="imp-compare">
					<div className="imp-before">
						<span className="imp-label">Today</span>
						<Markdown>{item.before}</Markdown>
					</div>
					<span className="imp-arrow" aria-hidden="true">
						→
					</span>
					<div className="imp-after">
						<span className="imp-label">Proposed</span>
						<Markdown>{item.after}</Markdown>
					</div>
				</div>
				<details className="imp-more">
					<summary>
						Plan, evidence and acceptance criteria
						<small>
							{plural(item.evidence.length, "source")} ·{" "}
							{plural(item.criteria.length, "criterion", "criteria")}
						</small>
					</summary>
					<div className="imp-more-grid">
						<div>
							<h4>Plan</h4>
							<Markdown>{item.plan}</Markdown>
							<h4>Done when</h4>
							<ul className="imp-checklist">
								{item.criteria.map((c) => (
									<li key={c}>{c}</li>
								))}
							</ul>
							{effortDetail.length > 0 && (
								<>
									<h4>Effort</h4>
									<p>{item.effort}</p>
								</>
							)}
						</div>
						<div>
							<h4>Evidence</h4>
							<ul className="imp-evidence">
								{item.evidence.map((e, i) => (
									<li key={`${i}-${e}`}>
										<Markdown>{e}</Markdown>
									</li>
								))}
							</ul>
							{item.risks.length > 0 && (
								<>
									<h4>Risks and tradeoffs</h4>
									<ul>
										{item.risks.map((r) => (
											<li key={r}>{r}</li>
										))}
									</ul>
								</>
							)}
							{item.nonGoals.length > 0 && (
								<>
									<h4>Not part of this</h4>
									<ul>
										{item.nonGoals.map((n) => (
											<li key={n}>{n}</li>
										))}
									</ul>
								</>
							)}
							{item.paths.length > 0 && (
								<>
									<h4>Likely files</h4>
									<ul className="imp-paths">
										{item.paths.map((p) => (
											<li key={p}>
												<code>{p}</code>
											</li>
										))}
									</ul>
								</>
							)}
							{item.perspectives.length > 0 && (
								<p className="muted imp-perspectives">
									Raised by{" "}
									{item.perspectives.map((p) => groupLabels[p] ?? p).join(", ")}
								</p>
							)}
						</div>
					</div>
				</details>
				{comments.length > 0 && <Thread comments={comments} />}
			</div>
			{editable && (
				<footer className="imp-decide">
					<fieldset disabled={disabled}>
						<legend>Your call</legend>
						<div className="imp-choices">
							{choiceOptions.map((o) => (
								<label key={o.value} className="imp-choice" data-tone={o.tone}>
									<input
										type="radio"
										name={`improvement-${item.id}`}
										value={o.value}
										checked={choice?.action === o.value}
										onChange={() => onChoose(o.value)}
									/>
									<span className="imp-emoji" aria-hidden="true">
										{o.icon}
									</span>
									{o.label}
								</label>
							))}
						</div>
						{choice?.action === "fix" && (
							<p className="imp-hint">
								Bob writes an implementation plan and starts a standard Factory
								run in its own worktree, with the usual review gates.
							</p>
						)}
						{choice?.action === "issue" && (
							<div className="imp-option-detail">
								<label>
									File to
									<select
										value={
											choice.destination
												? JSON.stringify(choice.destination)
												: ""
										}
										onChange={(e) =>
											onChange({
												destination: e.target.value
													? JSON.parse(e.target.value)
													: undefined,
											})
										}
									>
										<option value="">
											{destinations.isLoading
												? "Loading trackers…"
												: "Choose a tracker and project…"}
										</option>
										{destinations.data?.options.map((d) => (
											<option
												key={JSON.stringify(d.destination)}
												value={JSON.stringify(d.destination)}
											>
												{d.name}
											</option>
										))}
									</select>
								</label>
								{destinations.data?.options.length === 0 && (
									<p className="imp-hint">
										No issue tracker is connected. Connect Linear or Taskbot in{" "}
										<Link to="/settings/tickets">Ticket managers</Link>, then{" "}
										<button
											type="button"
											className="link"
											onClick={() => void destinations.refetch()}
										>
											refresh
										</button>
										.
									</p>
								)}
								{destinations.error && (
									<p role="alert" className="error">
										{destinations.error.message}
									</p>
								)}
								{destinations.data?.limitations.map((l) => (
									<p className="imp-hint" key={l}>
										{l}
									</p>
								))}
								<p className="imp-hint">
									The issue keeps the evidence and plan. It goes to your backlog
									and doesn’t start a run.
								</p>
							</div>
						)}
						{choice?.action === "ignore" && (
							<label className="imp-option-detail">
								Why skip it? <span className="muted">(optional)</span>
								<input
									value={choice.comment}
									placeholder="e.g. Good enough for now"
									onChange={(e) => onChange({ comment: e.target.value })}
								/>
							</label>
						)}
						{choice?.action === "follow-up" && (
							<div className="imp-option-detail">
								<div className="imp-composer">
									<textarea
										rows={2}
										aria-label={`Question about ${item.title}`}
										placeholder="What should Bob explain, narrow down or change?"
										value={question}
										onChange={(e) => onQuestion(e.target.value)}
									/>
									<Button
										variant="secondary"
										busy={busy}
										disabled={!question.trim()}
										onClick={onAsk}
									>
										Send to Bob
									</Button>
								</div>
								<p className="imp-hint">
									Bob researches this item again and revises the proposal.
								</p>
							</div>
						)}
					</fieldset>
					{(choice?.action === "follow-up" && question.trim()
						? []
						: problems
					).map((p) => (
						<p key={p} className="imp-problem">
							{p}
						</p>
					))}
				</footer>
			)}
		</article>
	);
}

function Thread({ comments }: { comments: View["comments"] }) {
	return (
		<ul className="imp-thread">
			{comments.map((c, i) => (
				<li
					key={`${c.at}-${i}`}
					className={c.actor === "local-operator" ? "mine" : undefined}
				>
					<small>
						{actorName(c.actor)} · {new Date(c.at).toLocaleString()}
					</small>
					<Markdown>{c.text}</Markdown>
				</li>
			))}
		</ul>
	);
}

function DecisionBar({
	state,
	choices,
	items,
	problems,
	pending,
	busy,
	planFeedback,
	onSave,
	onPrepare,
	onApply,
}: {
	state: View;
	choices: Record<string, ItemChoice>;
	items: Opportunity[];
	problems: number;
	pending: boolean;
	busy: boolean;
	planFeedback: boolean;
	onSave: () => void;
	onPrepare: () => void;
	onApply: () => void;
}) {
	const count = (action: Action) =>
			items.filter((i) => choices[i.id]?.action === action).length,
		fixes = count("fix"),
		issues = count("issue"),
		undecided = items.filter((i) => !choices[i.id]).length,
		dirty = JSON.stringify(choices) !== JSON.stringify(state.choices),
		ready =
			state.phase === "ready" &&
			state.manifest &&
			JSON.stringify(choices) === JSON.stringify(state.manifest.choices),
		nothing = fixes + issues === 0;
	const note = !pending
		? "Bob is still working. You can decide once this step finishes."
		: problems
			? `${plural(problems, "item")} ${problems === 1 ? "needs" : "need"} your attention above.`
			: nothing
				? "Choose Fix it or File issue for at least one improvement."
				: planFeedback
					? "Bob re-plans the fixes using the checks’ feedback and your notes."
					: ready
						? "Plans approved. Launching starts independent Factory runs."
						: undecided
							? `${plural(undecided, "undecided item")} will stay as ${undecided === 1 ? "it is" : "they are"}.`
							: "Bob plans each fix, then independent checks review the batch.";
	const launch = [
		state.manifest?.packages.length
			? `Launch ${plural(state.manifest.packages.length, "run")}`
			: "",
		issues ? `file ${plural(issues, "issue")}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<section className="imp-bar" aria-label="Your decisions">
			<div className="imp-bar-status">
				<ul className="imp-tally" aria-label="Choice summary">
					{choiceOptions.map((o) => {
						const n = count(o.value);
						return (
							n > 0 && (
								<li key={o.value} className={`chip ${o.tone}`}>
									<span className="imp-emoji" aria-hidden="true">
										{o.icon}
									</span>{" "}
									{n} {o.label}
								</li>
							)
						);
					})}
					{undecided > 0 && (
						<li className="chip imp-undecided">{undecided} undecided</li>
					)}
				</ul>
				<p className="imp-bar-note">{note}</p>
			</div>
			<div className="actions">
				{dirty && (
					<Button
						requiresConnection
						variant="ghost"
						busy={busy}
						disabled={!pending}
						onClick={onSave}
					>
						Save draft
					</Button>
				)}
				{ready ? (
					<Button
						requiresConnection
						variant="rainbow"
						busy={busy}
						disabled={!pending}
						onClick={onApply}
					>
						<span className="imp-emoji" aria-hidden="true">
							🚀
						</span>
						{launch[0]?.toUpperCase()}
						{launch.slice(1)}
					</Button>
				) : (
					<Button
						requiresConnection
						busy={busy}
						disabled={!pending || problems > 0 || nothing}
						onClick={onPrepare}
					>
						{planFeedback
							? "Revise plans →"
							: state.manifest
								? "Prepare again →"
								: "Prepare batch →"}
					</Button>
				)}
			</div>
		</section>
	);
}

function BatchSection({
	state,
	items,
	stale,
	destinations,
	running,
	busy,
	onStop,
}: {
	state: View;
	items: Opportunity[];
	stale: boolean;
	destinations?: Destinations;
	running: boolean;
	busy: boolean;
	onStop: () => void;
}) {
	const manifest = state.manifest!,
		accepted = state.acceptance,
		waves = wavesOf(manifest.packages),
		title = (id: string) => items.find((i) => i.id === id)?.title ?? id,
		issues = Object.entries(manifest.choices).filter(
			([, c]) => c.action === "issue",
		),
		skipped = Object.entries(manifest.choices).filter(
			([, c]) => c.action === "ignore",
		);
	const destinationName = (d?: IssueDestination) =>
		destinations?.options.find(
			(o) => JSON.stringify(o.destination) === JSON.stringify(d),
		)?.name ??
		(d?.provider === "taskbot"
			? `Taskbot · ${d.project}`
			: `Linear · team ${d?.teamId ?? ""}`);
	return (
		<section
			className={`imp-card imp-batch ${accepted ? "accepted" : ""}`}
			aria-labelledby="improvement-batch"
		>
			<header>
				<h3 id="improvement-batch">
					{accepted ? "Batch in progress" : "Ready to launch"}
				</h3>
				<p className="muted">
					{accepted
						? `Approved ${new Date(accepted.at).toLocaleString()}. Each fix is an independent Factory run with its own review gates.`
						: "Bob planned each fix and independent checks reviewed the batch. Nothing has started yet."}
				</p>
				{!accepted && manifest.checks.length > 0 && (
					<ul className="chips imp-checks" aria-label="Plan checks">
						{manifest.checks.map((c: any, i) => (
							<li
								key={checkNames[i] ?? i}
								className={`chip ${c.approved ? "green" : "red"}`}
							>
								{c.approved ? "✓" : "✕"} {checkNames[i] ?? `Check ${i + 1}`}
							</li>
						))}
					</ul>
				)}
			</header>
			{stale && (
				<p className="imp-notice" role="status">
					You changed your choices since this batch was prepared. Prepare it
					again before launching.
				</p>
			)}
			{waves.length > 0 && (
				<ol className="imp-waves">
					{waves.map((wave, i) => (
						<li key={wave.map((p) => p.id).join()} className="imp-wave">
							<h4>
								{i === 0
									? wave.length > 1
										? `Starts right away · ${wave.length} in parallel`
										: "Starts right away"
									: `Then · after ${wave
											.flatMap((p) => p.dependencies)
											.filter((d, j, all) => all.indexOf(d) === j)
											.map(
												(d) =>
													`“${manifest.packages.find((p) => p.id === d)?.title ?? d}”`,
											)
											.join(", ")} ${wave.length > 1 ? "are" : "is"} delivered`}
							</h4>
							<ul className="imp-packages">
								{wave.map((pkg) => (
									<PackageCard
										key={pkg.id}
										pkg={pkg}
										child={state.children[pkg.id]}
										accepted={Boolean(accepted)}
									/>
								))}
							</ul>
						</li>
					))}
				</ol>
			)}
			{issues.length > 0 && (
				<div className="imp-side-list">
					<h4>
						<span className="imp-emoji" aria-hidden="true">
							🎫
						</span>{" "}
						{accepted ? "Issues" : "Issues to file"}
					</h4>
					<ul>
						{issues.map(([id, c]) => {
							const filed = state.issues[id];
							return (
								<li key={id}>
									<span>
										{filed?.url ? (
											<External href={filed.url}>{title(id)}</External>
										) : (
											title(id)
										)}
										<small className="muted">
											{" "}
											→ {destinationName(c.destination)}
										</small>
									</span>
									{filed && (
										<span
											className={`chip ${filed.phase === "confirmed" ? "green" : filed.phase === "uncertain" ? "amber" : "blue"}`}
										>
											{
												{
													pending: "Queued",
													sending: "Filing…",
													confirmed: "Filed",
													uncertain: "Check tracker",
												}[filed.phase]
											}
										</span>
									)}
									{filed?.error && (
										<p role="alert" className="error">
											{filed.error}
										</p>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			)}
			{skipped.length > 0 && (
				<p className="muted imp-skipped">
					<span className="imp-emoji" aria-hidden="true">
						💤
					</span>{" "}
					Skipping: {skipped.map(([id]) => title(id)).join(", ")}
				</p>
			)}
			{accepted && running && (
				<div className="imp-batch-stop">
					<ConfirmButton
						label="Stop batch and its runs"
						confirm="Really stop all runs?"
						danger
						busy={busy}
						onConfirm={onStop}
					/>
					<p className="muted">
						Stopping only this parent run pauses new launches; runs that already
						started keep going.
					</p>
				</div>
			)}
		</section>
	);
}

const childStatus: Record<string, [string, string]> = {
	running: ["Working", "blue"],
	"capacity-waiting": ["Queued", "blue"],
	waiting: ["Needs you", "orange"],
	completed: ["Done", "green"],
	failed: ["Stuck", "red"],
	error: ["Stuck", "red"],
	stopped: ["Stopped", "quiet"],
};
function PackageCard({
	pkg,
	child,
	accepted,
}: {
	pkg: ImprovementPackage;
	child?: { runId: string; status?: string; url?: string };
	accepted: boolean;
}) {
	const [label, tone] = child?.status
		? (childStatus[child.status] ?? [child.status, "quiet"])
		: accepted
			? ["Waiting to start", "quiet"]
			: ["Not started", "quiet"];
	return (
		<li className="imp-package">
			<div className="imp-package-head">
				<strong>{pkg.title}</strong>
				{accepted && <span className={`chip ${tone}`}>{label}</span>}
			</div>
			<details>
				<summary>
					Plan · {plural(pkg.criteria.length, "criterion", "criteria")}
				</summary>
				<Markdown>{pkg.plan}</Markdown>
				<ul className="imp-checklist">
					{pkg.criteria.map((c) => (
						<li key={c}>{c}</li>
					))}
				</ul>
			</details>
			{child && (
				<div className="actions imp-package-links">
					<Link to={`/runs/${child.runId}`}>Open run →</Link>
					{child.url && (
						<External href={child.url}>
							PR #{child.url.split("/").at(-1)} ↗
						</External>
					)}
				</div>
			)}
		</li>
	);
}

function ConfirmButton({
	label,
	confirm,
	onConfirm,
	danger = false,
	...props
}: {
	label: ReactNode;
	confirm: ReactNode;
	onConfirm: () => void;
	danger?: boolean;
	disabled?: boolean;
	busy?: boolean;
}) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), 4000);
		return () => clearTimeout(timer);
	}, [armed]);
	return (
		<Button
			requiresConnection
			{...props}
			variant={armed ? "danger" : danger ? "secondary" : "ghost"}
			onClick={() => (armed ? onConfirm() : setArmed(true))}
		>
			{armed ? confirm : label}
		</Button>
	);
}
