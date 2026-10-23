import type { Architecture, ArchitectureProposal } from "../Architecture.js";
import type { ArchitectureFootprint } from "../ArchitectureFootprint.js";

export type Talk = NonNullable<Architecture["talk"]>;
type Decision = Architecture["decisions"][number];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "But Adds cost" reads as "But adds cost"; acronyms stay as written. */
export const but = (text: string) =>
	`But ${/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text}`;

/**
 * What Bob says at your desk. Check-ins (briefVersion=2) carry it; older
 * proposals are retold from their summary, Bob's own calls and their size.
 */
export function checkinTalk(
	content: Architecture,
	footprint?: ArchitectureFootprint,
): Talk & { retold?: boolean } {
	if (content.talk) return content.talk;
	const files =
		footprint?.files.length ??
		new Set(
			content.candidate.steps.flatMap((s) =>
				s.files.map((f) => (typeof f === "string" ? f : f.path)),
			),
		).size;
	return {
		retold: true,
		understood: content.summary,
		plan: "",
		scenes: [],
		notice: [],
		checks: content.decisions
			.filter((d) => d.status === "decided" && d.decidedBy !== "you")
			.slice(0, 3)
			.map((d) => {
				const pick = d.options.find((o) => o.id === d.pick)!;
				return {
					decision: d.id,
					say: `${d.question} I went with ${pick.name}: ${pick.upside}`,
					instead: d.options
						.filter((o) => o !== pick)
						.map((o) => `${o.name}: ${o.upside} ${but(o.catch)}`)
						.join(" "),
				};
			}),
		size: `${plural(content.candidate.steps.length, "piece")} of work touching ${plural(files, "file")}${footprint?.areas.length ? ` in ${plural(footprint.areas.length, "part")} of the code` : ""}.`,
	};
}

/** Ticket items this plan only prepares or leaves for later. */
export function cannotProve(content: Architecture) {
	return (content.criteria ?? []).filter((c) => c.status !== "covered");
}

/** Spoken reading time for the check-in, in whole minutes. */
export function readingMinutes(talk: Talk, content: Architecture): number {
	const words = [
		talk.understood,
		talk.plan,
		...talk.scenes.flatMap((s) => [s.title, ...s.before, ...s.after]),
		...talk.notice.map((n) => `${n.who} ${n.what}`),
		...talk.checks.map((c) => `${c.say} ${c.instead}`),
		talk.size,
		talk.split ?? "",
		...(content.nonGoals ?? []),
	]
		.join(" ")
		.split(/\s+/).length;
	return Math.max(1, Math.round(words / 180));
}

/**
 * Versions the human actually saw. Bob's reviewer may send drafts back many
 * times; those never reached the human and are counted, not listed. Runs from
 * before shownAt infer it from feedback, decisions and answers given while a
 * version was the latest.
 */
export function seenVersions(
	proposals: readonly ArchitectureProposal[],
	answers: readonly { at: string }[] = [],
) {
	const seen = proposals.filter((p, i) => {
		if (p.shownAt || p.feedback.length || i === proposals.length - 1)
			return true;
		if (["accepted", "rejected", "routine"].includes(p.status)) return true;
		const next = proposals[i + 1]?.at;
		return answers.some((a) => a.at > p.at && (!next || a.at < next));
	});
	return { seen, drafts: proposals.length - seen.length };
}

/**
 * What changed since the last version the human saw: every change Bob made in
 * between, including drafts his reviewer sent back, with the human's requests first.
 */
export function sinceLastSeen(
	proposals: readonly ArchitectureProposal[],
	seen: readonly ArchitectureProposal[],
	current: ArchitectureProposal,
): Since | undefined {
	const last = seen.filter((p) => p.version < current.version).at(-1);
	if (!last) return;
	const changes = proposals
		.filter((p) => p.version > last.version && p.version <= current.version)
		.flatMap((p) => (readableChanges(p.content) ? p.content.changes : []));
	const unique = changes.filter(
		(c, i) => changes.findIndex((x) => x.text === c.text) === i,
	);
	return {
		version: last.version,
		asked: unique.filter((c) => c.from === "you").map((c) => c.text),
		changed: unique.filter((c) => c.from !== "you").map((c) => c.text),
	};
}
export interface Since {
	version: number;
	asked: string[];
	changed: string[];
}
const readableChanges = (content: any): content is Architecture =>
	Array.isArray(content?.changes);

export interface Note {
	/** Heading of the point the note is about. */
	about: string;
	/** What Bob said there, quoted so the note stands on its own. */
	quote: string;
	text: string;
}
export interface Pick {
	decision: string;
	option: string;
}

/** One message to Bob: answers to open questions, then notes on his points. */
export function feedbackMessage(
	content: Architecture,
	picks: readonly Pick[],
	notes: readonly Note[],
	extra: string,
): string {
	const answers = picks.map((p) => {
		const decision = content.decisions.find((d) => d.id === p.decision);
		const option = decision?.options.find((o) => o.id === p.option);
		return `${decision?.question} → ${option?.name}`;
	});
	return [
		answers.length ? `Answers:\n${answers.join("\n")}` : "",
		...notes
			.filter((n) => n.text.trim())
			.map((n) => `About “${n.about}” (${clip(n.quote)}):\n${n.text.trim()}`),
		extra.trim(),
	]
		.filter(Boolean)
		.join("\n\n");
}
const clip = (text: string) =>
	text.length > 140 ? `“${text.slice(0, 138).trimEnd()}…”` : `“${text}”`;

export function decisionFor(
	content: Architecture,
	id?: string,
): Decision | undefined {
	return id ? content.decisions.find((d) => d.id === id) : undefined;
}
