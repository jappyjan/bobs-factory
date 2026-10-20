import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Architecture, ArchitectureProposal } from "../Architecture";
import type { ArchitectureFootprint } from "../ArchitectureFootprint";
import { active } from "../RunAttention";
import { CheckIn, checkinNotes, type Reaction, useListen } from "./checkin";
import {
	but,
	cannotProve,
	checkinTalk,
	feedbackMessage,
	type Pick,
	readingMinutes,
	seenVersions,
	sinceLastSeen,
} from "./checkin-model";
import { useAction, useRun } from "./client";
import { useFormState } from "./form-state";
import { Button, Markdown } from "./ui";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Proposals saved before the decisions format cannot be shown as a check-in. */
const readable = (content: any): content is Architecture =>
	Array.isArray(content?.decisions) && typeof content?.title === "string";
const open = (content: Architecture) =>
	content.decisions.filter((d) => d.status === "open").length;

/** Where the latest proposal stands, from the human's point of view. */
export function architectureState(run: any) {
	const proposals: ArchitectureProposal[] = run.architectureProposals ?? [];
	const latest = proposals.at(-1);
	const gated = run.architectureGate?.proposalId === latest?.id;
	const pending =
		run.status === "waiting" && gated && latest?.status === "pending";
	return {
		proposals,
		latest,
		pending,
		answering: !pending && gated && latest?.status === "pending",
		revising:
			!!latest &&
			["rejected", "superseded"].includes(latest.status) &&
			active(run.status),
		stopped: run.status === "stopped" && gated,
	};
}

/* ---------------------------------------------------------- Bob's notes */

function SystemMap({ map }: { map: NonNullable<Architecture["map"]> }) {
	const [selected, setSelected] = useState<string>();
	const label = new Map(map.parts.map((p) => [p.id, p.label]));
	const part = map.parts.find((p) => p.id === selected);
	return (
		<div className="ci-map">
			<div className="ci-lanes">
				{map.areas.map((area) => (
					<div key={area.id} className="ci-lane">
						<h5>{area.name}</h5>
						{map.parts
							.filter((p) => p.area === area.id)
							.map((p) => (
								<button
									key={p.id}
									type="button"
									className={`ci-part ${p.status}`}
									aria-pressed={selected === p.id}
									onClick={() =>
										setSelected(selected === p.id ? undefined : p.id)
									}
								>
									<b>{p.label}</b>
									<small>{p.note}</small>
									{map.links
										.filter((l) => l.from === p.id)
										.map((l, i) => (
											<span key={i} className="ci-link">
												→ {l.label ? `${l.label} ` : ""}
												{label.get(l.to)}
											</span>
										))}
								</button>
							))}
					</div>
				))}
			</div>
			<p className="ci-quiet">
				{part ? (
					<>
						<b>{part.label}:</b> {part.detail}{" "}
						{part.file && <code>{part.file}</code>}
					</>
				) : (
					"Green parts are new, orange ones change. Tap a part for details."
				)}
			</p>
		</div>
	);
}

function Note({
	title,
	count,
	children,
}: {
	title: string;
	count?: number;
	children: React.ReactNode;
}) {
	return (
		<details className="ci-notes-part">
			<summary>
				{title}
				{count !== undefined && <span className="ci-count">{count}</span>}
			</summary>
			{children}
		</details>
	);
}

/**
 * Everything Bob's reviewer checked, for when you want to dig: ticket items,
 * pieces of work with their files, every decision, the system map and the plan.
 */
export function BobsNotes({
	content,
	footprint,
	drafts = 0,
}: {
	content: Architecture;
	footprint?: ArchitectureFootprint;
	drafts?: number;
}) {
	const steps = content.candidate.steps;
	const files =
		footprint?.files.length ??
		new Set(
			steps.flatMap((s) =>
				s.files.map((f) => (typeof f === "string" ? f : f.path)),
			),
		).size;
	const criteria = content.criteria ?? [];
	const partly = cannotProve(content).length;
	return (
		<section className="ci-notes" aria-label="Bob’s notes">
			<h2>Bob’s notes</h2>
			<p className="ci-quiet">
				{drafts > 0 &&
					`Bob’s reviewer sent this back ${plural(drafts, "time")} before you saw it. `}
				{criteria.length > 0 &&
					`${plural(criteria.length, "ticket item")}${partly ? ` (${partly} only partly)` : ""}, `}
				{plural(steps.length, "piece")} of work, {plural(files, "file")}.
			</p>
			{content.problem && (
				<Note title="What happens today" count={content.problem.length}>
					<ul className="ci-plain">
						{content.problem.map((p, i) => (
							<li key={i}>
								{p.observation}
								<small>
									{p.repository} · {p.paths.join(", ")}
								</small>
							</li>
						))}
					</ul>
				</Note>
			)}
			{criteria.length > 0 && (
				<Note title="Ticket items" count={criteria.length}>
					<ul className="ci-plain">
						{criteria.map((c) => (
							<li key={c.id} className={`ci-criterion ${c.status}`}>
								<b>{c.id}</b> {c.text}
								<small>
									{c.status === "covered"
										? "Covered"
										: c.status === "partial"
											? "Partly"
											: "Later"}
									: {c.reason} ·{" "}
									{c.url ? (
										<a href={c.url} target="_blank" rel="noreferrer">
											{c.source}
										</a>
									) : (
										c.source
									)}
								</small>
							</li>
						))}
					</ul>
				</Note>
			)}
			<Note title="Pieces of work" count={steps.length}>
				<ol className="ci-work">
					{steps.map((step, i) => (
						<li key={i}>
							<details>
								<summary>
									<b>
										{step.id && `${step.id} · `}
										{step.title}
									</b>
									<small>
										{step.size && `${step.size} · `}
										{plural(step.files.length, "file")}
									</small>
								</summary>
								{step.what && <p>{step.what}</p>}
								{step.traces && (
									<p className="ci-quiet">
										{step.traces
											.map((t) =>
												"criterion" in t
													? t.criterion
													: `Bob added: ${t.added}`,
											)
											.join(" · ")}
									</p>
								)}
								<ul className="ci-files">
									{step.files.map((file, j) =>
										typeof file === "string" ? (
											<li key={j}>
												<code>{file}</code>
											</li>
										) : (
											<li key={j}>
												<span className={`ci-op ${file.change}`}>
													{file.change}
												</span>
												<code>
													{file.repository && `${file.repository}: `}
													{file.path}
												</code>
											</li>
										),
									)}
								</ul>
							</details>
						</li>
					))}
				</ol>
			</Note>
			{content.decisions.length > 0 && (
				<Note title="Every decision" count={content.decisions.length}>
					<ul className="ci-plain">
						{content.decisions.map((d) => {
							const pick = d.options.find((o) => o.id === d.pick);
							return (
								<li key={d.id}>
									<b>{d.question}</b>{" "}
									{pick
										? `${d.decidedBy === "you" ? "You chose" : "Bob chose"} ${pick.name}.`
										: "Open."}
									<small>
										{d.options
											.map((o) => `${o.name}: ${o.upside} ${but(o.catch)}`)
											.join(" · ")}
									</small>
								</li>
							);
						})}
					</ul>
				</Note>
			)}
			{content.map && (
				<Note title="System map" count={content.map.parts.length}>
					<SystemMap map={content.map} />
				</Note>
			)}
			{content.risks.length > 0 && (
				<Note title="Risks" count={content.risks.length}>
					<ul className="ci-plain">
						{content.risks.map((r, i) => (
							<li key={i}>{r}</li>
						))}
					</ul>
				</Note>
			)}
			{!!content.acceptance?.length && (
				<Note title="How we’ll know it works" count={content.acceptance.length}>
					<ol className="ci-plain">
						{content.acceptance.map((a, i) => (
							<li key={i}>{a}</li>
						))}
					</ol>
				</Note>
			)}
			<Note title="Why this fits the code" count={content.evidence.length}>
				<ul className="ci-plain">
					{content.evidence.map((e, i) => (
						<li key={i}>
							{e.observation}
							<small>
								{e.repository} · {e.paths.join(", ")}
							</small>
						</li>
					))}
				</ul>
			</Note>
			{footprint && (
				<Note title="Footprint checks" count={footprint.warnings.length}>
					<p className="ci-quiet">
						{Object.entries(footprint.changes)
							.filter(([, n]) => n)
							.map(([change, n]) => `${n} ${change}`)
							.join(" · ")}{" "}
						— {footprint.areas.map((a) => `${a.name} (${a.files})`).join(", ")}
					</p>
					{footprint.warnings.length ? (
						<ul className="ci-plain">
							{footprint.warnings.map((w, i) => (
								<li key={i}>
									{w.message}
									<small>{w.paths.join(" · ")}</small>
								</li>
							))}
						</ul>
					) : (
						<p className="ci-quiet">No path or map consistency flags.</p>
					)}
				</Note>
			)}
			<Note title="Full plan for Bob">
				<Markdown>{content.candidate.plan}</Markdown>
				{content.candidate.assets.length > 0 && (
					<ul className="ci-files">
						{content.candidate.assets.map((asset, i) => (
							<li key={i}>
								{asset.purpose}: <code>{asset.path}</code>
							</li>
						))}
					</ul>
				)}
			</Note>
		</section>
	);
}

/** Read-only check-in for the artifact inspector. */
export function ArchitectureContent({ content }: { content: any }) {
	const footprint: ArchitectureFootprint | undefined = content?.footprint;
	if (!readable(content))
		return <p className="muted">This proposal uses an older format.</p>;
	return (
		<div className="ci-page ci-inspector">
			<h2>{content.title}</h2>
			<CheckIn content={content} footprint={footprint} />
			<BobsNotes content={content} footprint={footprint} />
		</div>
	);
}

/* ----------------------------------------------------------------- page */

const time = (at?: string) =>
	at
		? new Date(at).toLocaleString([], {
				weekday: "short",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "";

export function ArchitecturePage() {
	const { id } = useParams();
	const query = useRun(id, "architecture");
	const run = query.data;
	const heading = useRef<HTMLHeadingElement>(null);
	const thread = useRef<HTMLDivElement>(null);
	const hasRun = Boolean(run);
	useEffect(() => {
		if (hasRun) heading.current?.focus({ preventScroll: true });
	}, [hasRun]);
	const state = run ? architectureState(run) : undefined;
	const latest = state?.latest;
	const context = `${run?.id}/${latest?.id}/${latest?.digest}/${latest?.status}/${run?.status}`;
	const [draft, setDraft] = useFormState(context, "");
	const [picks, setPicks] = useFormState<Pick[]>(context, []);
	const [reactions, setReactions] = useFormState<Record<string, Reaction>>(
		context,
		{},
	);
	const [error, setError] = useFormState<string | undefined>(
		context,
		undefined,
	);
	const [viewing, setViewing] = useState<number>();
	const action = useAction(`architecture:${run?.id}`, context);
	const cache = useQueryClient();
	const listen = useListen(thread);
	if (query.isLoading || run?.pendingContext)
		return <p role="status">Loading Bob’s check-in…</p>;
	if (!run || !state || !latest)
		return (
			<>
				<h1>Bob hasn’t checked in yet</h1>
				<Link className="back-link" to={id ? `/runs/${id}` : "/"}>
					← Back to the run
				</Link>
			</>
		);
	const { proposals, pending, answering, revising, stopped } = state;
	const { seen, drafts } = seenVersions(proposals, run.answers ?? []);
	const shown = proposals.find((p) => p.version === viewing) ?? latest;
	const content = shown.content;
	if (!readable(content))
		return (
			<>
				<h1 ref={heading} tabIndex={-1}>
					{run.title}
				</h1>
				<p>This plan uses an older format. Ask Bob for a new version.</p>
			</>
		);
	const isLatest = shown === latest;
	const interactive = isLatest && pending;
	const since = sinceLastSeen(proposals, seen, shown);
	const talk = checkinTalk(content, shown.footprint);
	const openCount = open(latest.content);
	const answeredAll = latest.content.decisions
		.filter((d) => d.status === "open")
		.every((d) => picks.some((p) => p.decision === d.id));
	const notes = interactive
		? checkinNotes(latest.content, latest.footprint, reactions)
		: [];
	const emptyNote = notes.find((n) => !n.text.trim());
	const sending = notes.length > 0 || draft.trim().length > 0 || openCount > 0;
	const submit = async (decision: "accept" | "revise" | "explain") => {
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/architecture-decision`,
				body: {
					proposalId: latest.id,
					version: latest.version,
					digest: latest.digest,
					decision,
					...(decision === "accept"
						? {}
						: {
								feedback:
									decision === "revise"
										? feedbackMessage(latest.content, picks, notes, draft)
										: draft,
							}),
				},
			});
			setDraft("");
			setPicks([]);
			setReactions({});
			setError(undefined);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			void cache.invalidateQueries({ queryKey: ["run", run.id] });
		}
	};
	const blocker = !interactive
		? undefined
		: openCount && !answeredAll
			? `Pick an answer to Bob’s ${openCount === 1 ? "question" : "questions"} first.`
			: emptyNote
				? `Add a few words to your note on “${emptyNote.about}”.`
				: undefined;
	const primary = openCount
		? "Send my answers"
		: notes.length
			? `Send ${plural(notes.length, "note")} to Bob`
			: draft.trim()
				? "Send to Bob"
				: "👍 Go ahead, build it";
	const qa = shown.feedback.filter(
		(f) => f.kind === "explain" || f.kind === "explanation",
	);
	const headline =
		shown.status === "accepted"
			? "Bob checked his plan with you"
			: shown.status === "routine"
				? "Bob didn’t need to check in"
				: "Bob wants to check his plan before building";
	return (
		<div className="ci-page">
			<nav className="review-links" aria-label="Check-in navigation">
				<Link to={`/runs/${run.id}`} state={{ focusRunId: run.id }}>
					← Back to the run
				</Link>
			</nav>
			<header className="ci-head">
				<span className="ci-avatar" aria-hidden="true">
					B
				</span>
				<div>
					<h1 ref={heading} tabIndex={-1}>
						{headline}
					</h1>
					<p>
						{content.title} · about{" "}
						{plural(readingMinutes(talk, content), "minute")}
					</p>
				</div>
				{listen.supported && (
					<button type="button" className="ci-listen" onClick={listen.toggle}>
						{listen.speaking ? "■ Stop" : "▶ Listen"}
					</button>
				)}
			</header>
			<p className="ci-version">
				Version {shown.version}
				{drafts > 0 &&
					` · ${plural(drafts, "earlier draft")} stayed with Bob’s reviewer`}
				{seen.length > 1 && (
					<span className="ci-versions">
						{seen.map((p) => (
							<button
								key={p.id}
								type="button"
								aria-pressed={p === shown}
								onClick={() => setViewing(p === latest ? undefined : p.version)}
							>
								v{p.version}
							</button>
						))}
					</span>
				)}
			</p>
			{revising && (
				<p className="ci-banner working" role="status">
					<span className="spinner" /> Bob is updating his plan with your notes.
					He’ll check in again when it’s ready.
				</p>
			)}
			{!isLatest && (
				<p className="ci-banner">
					You’re looking at version {shown.version}, which Bob has replaced.{" "}
					<button
						type="button"
						className="ci-link-button"
						onClick={() => setViewing(undefined)}
					>
						Back to version {latest.version}
					</button>
				</p>
			)}
			{shown.status === "routine" && (
				<p className="ci-banner">
					{shown.continuation
						? "His reviewer confirmed this stays within the plan you already approved."
						: "Bob treated this as routine, so he went ahead."}{" "}
					{shown.bypassReason}
				</p>
			)}
			<div
				ref={thread}
				className={`ci-thread${revising ? " ci-faded" : ""}`}
				aria-live="polite"
			>
				<CheckIn
					key={shown.id}
					content={content}
					footprint={shown.footprint}
					since={since}
					reactions={interactive ? reactions : undefined}
					onReact={
						interactive
							? (beat, reaction) =>
									setReactions((current) => {
										const next = { ...current };
										if (reaction) next[beat] = reaction;
										else delete next[beat];
										return next;
									})
							: undefined
					}
					picks={isLatest ? picks : []}
					onPick={
						interactive
							? (next) =>
									setPicks((current) => [
										...current.filter((p) => p.decision !== next.decision),
										next,
									])
							: undefined
					}
					speaking={listen.speaking}
				/>
				{qa.map((f, i) =>
					f.kind === "explain" ? (
						<div key={i} className="ci-you">
							<p>{f.text}</p>
							<small>You asked · {time(f.at)}</small>
						</div>
					) : (
						<div key={i} className="ci-beat">
							<div className="ci-bubble">
								<p className="ci-say">{f.text}</p>
							</div>
						</div>
					),
				)}
				{answering && isLatest && (
					<div className="ci-beat">
						<div className="ci-bubble ci-typing">
							<span className="spinner" /> Bob is answering your question…
						</div>
					</div>
				)}
			</div>
			{isLatest && shown.status === "accepted" ? (
				<p className="ci-done">
					✓ You said go ahead on version {shown.version}
					{(() => {
						const at = (run.architectureDecisions ?? []).find(
							(d: any) => d.proposalId === shown.id && d.decision === "accept",
						)?.at;
						return at ? ` · ${time(at)}` : "";
					})()}.
					{active(run.status)
						? " Bob is building it; you’ll still review the PR."
						: ""}
				</p>
			) : interactive ? (
				<section className="ci-close" aria-label="Your answer">
					<div className="ci-beat">
						<div className="ci-bubble">
							<p className="ci-say">
								That’s it. Anything else, or shall I start?
							</p>
						</div>
					</div>
					<div className="ci-composer">
						<textarea
							aria-label="Anything else for Bob"
							placeholder="Anything else? (optional)"
							rows={2}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
						/>
						<div className="ci-actions">
							<Button
								requiresConnection
								variant="secondary"
								disabled={action.isPending || !draft.trim()}
								onClick={() => void submit("explain")}
							>
								Just a question
							</Button>
							<Button
								requiresConnection
								className={sending ? "ci-send" : "ci-go"}
								disabled={action.isPending || !!blocker}
								onClick={() => void submit(sending ? "revise" : "accept")}
							>
								{primary}
							</Button>
						</div>
						<p className="ci-fine">
							{blocker ??
								(sending
									? "Bob writes a new version with this and checks in again. A question keeps this version."
									: "Bob builds exactly this plan. You still review the PR before anything merges.")}
						</p>
					</div>
				</section>
			) : stopped && isLatest ? (
				<Button
					requiresConnection
					disabled={action.isPending}
					onClick={() =>
						void action
							.mutateAsync({ path: `/api/runs/${run.id}/retry` })
							.catch((e) => setError(String(e)))
					}
				>
					Resume the check-in
				</Button>
			) : null}
			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}
			<BobsNotes
				content={content}
				footprint={shown.footprint}
				drafts={isLatest ? drafts : 0}
			/>
		</div>
	);
}

/* ---------------------------------------------------------------- entry */

/** Compact card on the run page and in the Today queue. */
export function ArchitectureEntry({ run }: { run: any }) {
	const { latest, pending, answering, revising } = architectureState(run);
	if (!latest || !readable(latest.content)) return null;
	const to = `/runs/${run.id}/architecture`;
	if (latest.status === "routine")
		return (
			<p className="arch-entry quiet">
				{latest.continuation
					? `Bob’s plan continues your go-ahead on version ${latest.continuation.version}.`
					: "Bob’s plan was routine, so he didn’t need to check in."}{" "}
				<Link to={to}>See what he planned</Link>
			</p>
		);
	// Run lists carry a summary: title, summary, what Bob thinks you want and decision states.
	const understood = latest.content.talk?.understood ?? latest.content.summary;
	const openCount = open(latest.content);
	const [chip, label] =
		latest.status === "accepted"
			? ["review", "✓ You said go ahead"]
			: revising
				? ["working", "Bob is updating his plan"]
				: pending || answering
					? ["question", "Bob wants to check in"]
					: latest.status === "proposed"
						? ["working", "Bob is preparing his check-in"]
						: ["quiet", "Replaced by a newer version"];
	return (
		<section className="arch-entry" aria-label="Bob’s check-in">
			<div className="arch-meta">
				<span className={`chip ${chip}`}>{label}</span>
				<span>Before building</span>
			</div>
			<h2>{latest.content.title}</h2>
			<p>{understood}</p>
			{pending && openCount > 0 && (
				<p className="arch-entry-ask">
					✋ Bob needs {plural(openCount, "answer")} from you.
				</p>
			)}
			<Link className={`button ${pending ? "primary" : "secondary"}`} to={to}>
				{pending ? "Talk it through" : "See the check-in"}
			</Link>
		</section>
	);
}
