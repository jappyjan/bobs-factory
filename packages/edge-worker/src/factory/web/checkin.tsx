import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Architecture } from "../Architecture";
import type { ArchitectureFootprint } from "../ArchitectureFootprint";
import {
	but,
	cannotProve,
	checkinTalk,
	decisionFor,
	type Note,
	type Pick,
	type Since,
	type Talk,
} from "./checkin-model";

/** Your reaction to one of Bob's points: fine, or a note on what to change. */
export interface Reaction {
	ok: boolean;
	choice: number;
	text: string;
}
interface Beat {
	id: string;
	head?: string;
	/** What Bob says, read aloud and quoted in notes. */
	say: string;
	body?: ReactNode;
	/** First answer agrees; the others open a note, optionally prefilled. */
	answers?: { label: string; prefill?: string }[];
}

function Scene({ scene }: { scene: Talk["scenes"][number] }) {
	const flow = (steps: string[], kind: string) => (
		<ol className={`ci-flow ${kind}`}>
			{steps.map((step, i) => (
				<li key={i}>{step}</li>
			))}
		</ol>
	);
	return (
		<figure className="ci-scene">
			<figcaption>{scene.title}</figcaption>
			<div className="ci-ba">
				<div>
					<span className="ci-tag">Today</span>
					{flow(scene.before, "before")}
				</div>
				<div>
					<span className="ci-tag after">After</span>
					{flow(scene.after, "after")}
				</div>
			</div>
		</figure>
	);
}

/** Bob's own changes: the first two said out loud, the rest on request. */
function Smaller({ changes, first }: { changes: string[]; first: boolean }) {
	const [all, setAll] = useState(false);
	const shown = all ? changes : changes.slice(0, 2);
	return (
		<>
			{!first && <p className="ci-sub quiet">I also changed</p>}
			<ul className="ci-list">
				{shown.map((change, i) => (
					<li key={i}>{change}</li>
				))}
			</ul>
			{changes.length > 2 && (
				<button
					type="button"
					className="ci-link-button"
					aria-expanded={all}
					onClick={() => setAll(!all)}
				>
					{all ? "Fewer" : `${changes.length - 2} smaller changes`}
				</button>
			)}
		</>
	);
}

function beats(
	content: Architecture,
	talk: ReturnType<typeof checkinTalk>,
	picks: readonly Pick[],
	onPick?: (pick: Pick) => void,
	since?: Since,
): Beat[] {
	const list: Beat[] = [];
	if (since && (since.asked.length || since.changed.length))
		list.push({
			id: "since",
			head: "Since you last looked",
			say: since.asked.length
				? "Here’s what I did with your notes."
				: `Here’s what changed since version ${since.version}.`,
			body: (
				<>
					{since.asked.length > 0 && (
						<ul className="ci-list">
							{since.asked.map((text, i) => (
								<li key={i}>
									<span className="ci-who">You asked</span>
									{text}
								</li>
							))}
						</ul>
					)}
					{since.changed.length > 0 && (
						<Smaller changes={since.changed} first={!since.asked.length} />
					)}
				</>
			),
		});
	list.push({
		id: "understood",
		head: "What I think you want",
		say: talk.understood,
		answers: [{ label: "That’s it" }, { label: "Not quite…" }],
	});
	if (talk.plan || talk.scenes.length)
		list.push({
			id: "plan",
			head: "How I’d do it",
			say: talk.plan,
			body: talk.scenes.map((scene, i) => <Scene key={i} scene={scene} />),
			answers: [{ label: "Makes sense" }, { label: "Hmm…" }],
		});
	if (talk.notice.length)
		list.push({
			id: "notice",
			head: "Who will notice",
			say: "Once this ships, these people see a difference.",
			body: (
				<ul className="ci-list">
					{talk.notice.map((n, i) => (
						<li key={i}>
							<span className="ci-who">{n.who}</span>
							{n.what}
						</li>
					))}
				</ul>
			),
			answers: [{ label: "Fine" }, { label: "Wait…" }],
		});
	const open = content.decisions.filter((d) => d.status === "open");
	if (open.length)
		list.push({
			id: "open",
			head:
				open.length === 1
					? "I need you to decide one thing"
					: `I need you to decide ${open.length} things`,
			say: "I can’t settle this from the code.",
			body: open.map((d) => {
				const picked = picks.find((p) => p.decision === d.id)?.option;
				return (
					<fieldset key={d.id} className="ci-decide">
						<legend>{d.question}</legend>
						{d.why && <p className="ci-quiet">{d.why}</p>}
						{d.options.map((o) => (
							<label key={o.id} className="ci-option">
								<input
									type="radio"
									name={`ci-${d.id}`}
									checked={picked === o.id}
									disabled={!onPick}
									onChange={() => onPick?.({ decision: d.id, option: o.id })}
								/>
								<span>
									<b>{o.name}</b>
									{d.lean === o.id && <i className="ci-lean"> I’d pick this</i>}
									<small>
										{o.upside} {but(o.catch)}
									</small>
								</span>
							</label>
						))}
					</fieldset>
				);
			}),
		});
	talk.checks.forEach((check, i) => {
		const decision = decisionFor(content, check.decision);
		list.push({
			id: `check-${i}`,
			head:
				i === 0
					? talk.checks.length === 1
						? "A call I’d like you to check"
						: `${talk.checks.length} calls I’d like you to check`
					: undefined,
			say: check.say,
			body: (
				<p className="ci-instead">
					<span>The other way</span>
					{check.instead}
				</p>
			),
			answers: [
				{ label: "Agree" },
				{
					label: "I’d go the other way",
					prefill: `Please go the other way${decision ? ` on “${decision.question}”` : ""}.`,
				},
				{ label: "Hmm…" },
			],
		});
	});
	list.push({
		id: "size",
		head: "How big it is",
		say: talk.size,
		body: talk.split && (
			<p className="ci-instead">
				<span>Or smaller</span>
				{talk.split}
			</p>
		),
		answers: talk.split
			? [
					{ label: "One go is fine" },
					{ label: "Split it", prefill: "Please split it as you suggested." },
					{ label: "Hmm…" },
				]
			: [{ label: "Fine" }, { label: "Hmm…" }],
	});
	const partly = cannotProve(content);
	if (content.nonGoals?.length || partly.length)
		list.push({
			id: "limits",
			head: partly.length
				? "What I won’t do, and can’t fully prove"
				: "What I won’t do",
			say: "",
			body: (
				<>
					{!!content.nonGoals?.length && (
						<ul className="ci-nogo">
							{content.nonGoals.map((item, i) => (
								<li key={i}>{item}</li>
							))}
						</ul>
					)}
					{partly.length > 0 && (
						<>
							<p className="ci-sub">Can’t fully prove yet</p>
							<ul className="ci-list">
								{partly.map((c) => (
									<li key={c.id}>
										<span className="ci-who">{c.text}</span>
										{c.reason}
									</li>
								))}
							</ul>
						</>
					)}
				</>
			),
			answers: [{ label: "Fine" }, { label: "Hmm…" }],
		});
	return list;
}

/** Notes the human wrote, in the order Bob raised the points. */
export function checkinNotes(
	content: Architecture,
	footprint: ArchitectureFootprint | undefined,
	reactions: Record<string, Reaction>,
): Note[] {
	const talk = checkinTalk(content, footprint);
	return beats(content, talk, [])
		.filter((b) => reactions[b.id] && !reactions[b.id]!.ok)
		.map((b) => ({
			about: b.head ?? "A call I’d like you to check",
			quote: b.say || b.head || "",
			text: reactions[b.id]!.text,
		}));
}

/**
 * Bob's check-in: the points a colleague raises at your desk before building,
 * each with a quick reaction. Reactions that flag a point become notes.
 */
export function CheckIn({
	content,
	footprint,
	since,
	reactions,
	onReact,
	picks = [],
	onPick,
	speaking,
	section,
}: {
	content: Architecture;
	footprint?: ArchitectureFootprint;
	since?: Since;
	reactions?: Record<string, Reaction>;
	onReact?: (beat: string, reaction?: Reaction) => void;
	picks?: readonly Pick[];
	onPick?: (pick: Pick) => void;
	/** The point being read aloud. */
	speaking?: string;
	/** A declarative component chooses one existing point; no screen-name dispatch. */
	section?: string;
}) {
	const talk = checkinTalk(content, footprint);
	return (
		<>
			{beats(content, talk, picks, onPick, since)
				.filter((beat) => !section || beat.id === section)
				.map((beat) => {
					const reaction = reactions?.[beat.id];
					return (
						<section
							key={beat.id}
							className={`ci-beat${speaking === beat.id ? " speaking" : ""}`}
							data-beat={beat.id}
							aria-label={beat.head}
						>
							{beat.head && <h3>{beat.head}</h3>}
							<div className="ci-bubble">
								{beat.say && <p className="ci-say">{beat.say}</p>}
								{beat.body}
							</div>
							{onReact && beat.answers && (
								<>
									<div className="ci-react">
										{beat.answers.map((answer, i) => (
											<button
												key={answer.label}
												type="button"
												aria-pressed={reaction?.choice === i}
												className={i === 0 ? "ok" : "flag"}
												onClick={() =>
													onReact(
														beat.id,
														reaction?.choice === i
															? undefined
															: {
																	ok: i === 0,
																	choice: i,
																	text:
																		i === 0
																			? ""
																			: reaction &&
																					!reaction.ok &&
																					reaction.text
																				? reaction.text
																				: (answer.prefill ?? ""),
																},
													)
												}
											>
												{i === 0 && "👍 "}
												{answer.label}
											</button>
										))}
									</div>
									{reaction && !reaction.ok && (
										<NoteField
											value={reaction.text}
											onChange={(text) =>
												onReact(beat.id, { ...reaction, text })
											}
										/>
									)}
								</>
							)}
							{!onReact && reaction && !reaction.ok && reaction.text && (
								<p className="ci-your-note">{reaction.text}</p>
							)}
						</section>
					);
				})}
		</>
	);
}

function NoteField({
	value,
	onChange,
}: {
	value: string;
	onChange: (text: string) => void;
}) {
	const field = useRef<HTMLTextAreaElement>(null);
	// Focus the note once, when it opens.
	useEffect(() => field.current?.focus({ preventScroll: true }), []);
	return (
		<textarea
			ref={field}
			className="ci-note"
			aria-label="Your note to Bob"
			placeholder="Tell Bob what you’d change…"
			rows={2}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		/>
	);
}

/** Reads the check-in aloud, one point at a time, like Bob at your desk. */
export function useListen(root: React.RefObject<HTMLElement | null>) {
	const [speaking, setSpeaking] = useState<string>();
	const supported =
		typeof window !== "undefined" && "speechSynthesis" in window;
	useEffect(() => () => window.speechSynthesis?.cancel(), []);
	const toggle = () => {
		const synth = window.speechSynthesis;
		if (speaking) {
			synth.cancel();
			setSpeaking(undefined);
			return;
		}
		const sections = [
			...(root.current?.querySelectorAll<HTMLElement>("[data-beat]") ?? []),
		];
		sections.forEach((section, i) => {
			const text = [
				section.querySelector("h3")?.textContent,
				...[
					...section.querySelectorAll(
						".ci-say, figcaption, li, .ci-instead, legend",
					),
				].map((x) => x.textContent),
			]
				.filter(Boolean)
				.join(". ");
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.onstart = () => {
				setSpeaking(section.dataset.beat);
				section.scrollIntoView({ behavior: "smooth", block: "center" });
			};
			if (i === sections.length - 1)
				utterance.onend = () => setSpeaking(undefined);
			synth.speak(utterance);
		});
	};
	return { supported, speaking, toggle };
}
