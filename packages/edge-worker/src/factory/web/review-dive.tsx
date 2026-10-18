// biome-ignore-all lint/a11y/noNoninteractiveTabindex: scrollable diffs need keyboard focus
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	BriefFlow,
	BriefProof,
	BriefRequirement,
	BriefTouch,
	BriefTourEntry,
	ReviewBrief,
} from "../ReviewBrief";
import type { ReviewFile } from "../ReviewFiles";
import { Commentable } from "./review-comments";
import {
	commonIndent,
	type DiffBlock,
	diffBlocks,
	fileKind,
	findLine,
	lineBreakdown,
	tourOwner,
} from "./review-dive-model";
import type { FeedbackTarget } from "./review-feedback";
import { type DiffLine, parsePatch } from "./review-model";

export type DiveTab = "how" | "code" | "checks" | "choices";
/** A place the reader is sent to: a tab, and optionally a line, file, check or flow. */
export type DiveFocus = {
	tab: DiveTab;
	file?: string;
	match?: string;
	path?: string;
	flow?: { id: string; steps: number[] };
	nonce: number;
};
export type PatchState =
	| { status: "pending" }
	| { status: "error"; message: string; retry: () => void }
	| { status: "ready"; patch: string | null; reason?: string | null };

type Target = (
	path: string,
	label: string,
	kind: string,
	context: string,
	section: number,
	order: number,
) => FeedbackTarget;

const STATUS: Record<BriefRequirement["status"], [string, string]> = {
	shown: ["●", "Seen working"],
	tested: ["◐", "Only tests prove it"],
	partly: ["◑", "Partly proven"],
	"not-shown": ["○", "No evidence"],
	gap: ["✕", "Not met"],
	waived: ["⏭", "Waived"],
};
const BY = { you: "You decided", ticket: "The ticket said", bob: "I decided" };
const MARK = {
	new: "New",
	changed: "Changed",
	removed: "Removed",
	risk: "Watch",
	same: "Same",
};
const KIND = { tests: "Tests", text: "Text", code: "Also" };
const LINE_LIMIT = 400;
const RELATED_LIMIT = 10;

const fileName = (path: string) => path.split("/").at(-1)!;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");
const lineKey = (file: string, line: DiffLine) =>
	`dive-line-${file}-${line.next ?? `o${line.old}`}`;

/**
 * Dig deeper: what a colleague shows when you ask "show me". Plain flows that
 * link into the code, the whole diff as one annotated tour, checks and choices.
 */
export function DigDeeper({
	brief,
	files,
	filesError,
	usePatch,
	proof,
	judge,
	target,
	focus,
	onFocus,
	checksFooter,
}: {
	brief: ReviewBrief;
	files?: ReviewFile[];
	filesError?: ReactNode;
	usePatch: (file: ReviewFile) => PatchState;
	proof: (value: BriefProof) => ReactNode;
	judge: (path: string, labels: [string, string]) => ReactNode;
	target: Target;
	focus?: DiveFocus;
	onFocus: (focus: Omit<DiveFocus, "nonce">) => void;
	checksFooter?: ReactNode;
}) {
	const system = brief.system;
	const tabs: [DiveTab, string][] = [
		...(system ? [["how", "How it works"] as [DiveTab, string]] : []),
		["code", "The code"],
		["checks", "Checks"],
		["choices", "Choices"],
	];
	const [chosen, setTab] = useState<DiveTab>(tabs[0]![0]);
	const tab = tabs.some(([id]) => id === chosen) ? chosen : tabs[0]![0];
	const tour = brief.tour ?? [];
	const [open, setOpen] = useState(
		() => new Set(tour.filter((e) => e.key).map((e) => e.file)),
	);
	const [openCheck, setOpenCheck] = useState<string>();
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per jump request
	useEffect(() => {
		if (!focus) return;
		setTab(focus.tab);
		if (focus.file) {
			const owner = tourOwner(tour, focus.file)?.file ?? focus.file;
			setOpen((current) => new Set(current).add(owner));
		}
		const check = /^\/requirements\/(\d+)/.exec(focus.path ?? "");
		if (check) setOpenCheck(brief.requirements[Number(check[1])]?.id);
		// Wait for the tab and any opened file or patch to render before scrolling.
		let tries = 0;
		const scroll = () => {
			const file = focus.file && files?.find((f) => f.path === focus.file);
			const element =
				(focus.path &&
					document.querySelector<HTMLElement>(
						`#brief-dive [data-comment-path="${CSS.escape(focus.path)}"]`,
					)) ||
				(focus.match &&
					file &&
					document.querySelector<HTMLElement>(
						`[data-dive-match="${CSS.escape(`${file.path}\n${focus.match}`)}"]`,
					)) ||
				(focus.flow &&
					document.getElementById(`brief-flow-${focus.flow.id}`)) ||
				(focus.file &&
					document.getElementById(
						`dive-file-${tourOwner(tour, focus.file)?.file ?? focus.file}`,
					));
			if (element)
				element.scrollIntoView({ behavior: "smooth", block: "center" });
			else if (tries++ < 20) setTimeout(scroll, 100);
		};
		requestAnimationFrame(scroll);
	}, [focus]);
	// Sticky tabs sit below the app header, whose height changes with the layout.
	const [top, setTop] = useState(0);
	useEffect(() => {
		const header = document.querySelector<HTMLElement>(".site-header");
		if (!header) return;
		const observer = new ResizeObserver(() => setTop(header.offsetHeight));
		observer.observe(header);
		return () => observer.disconnect();
	}, []);
	const flagged = tour.filter(
		(e) => e.flag || e.pins?.some((p) => p.flag),
	).length;
	return (
		<section
			id="brief-dive"
			className="dive"
			aria-labelledby="dive-title"
			style={{ "--dive-top": `${top}px` } as CSSProperties}
		>
			<header>
				<h2 id="dive-title">Dig deeper</h2>
				<p className="muted">
					Everything behind the story, one question at a time.
				</p>
			</header>
			<nav className="dive-tabs" aria-label="Dig deeper">
				{tabs.map(([id, label]) => (
					<button
						type="button"
						key={id}
						aria-pressed={tab === id}
						onClick={() => {
							setTab(id);
							document
								.getElementById("brief-dive")
								?.scrollIntoView({ behavior: "smooth", block: "start" });
						}}
					>
						{label}
						{id === "code" && flagged > 0 && (
							<span className="dive-count" title={`${flagged} worth a look`}>
								{flagged}
							</span>
						)}
					</button>
				))}
			</nav>
			{tab === "how" && system && (
				<HowItWorks
					system={system}
					highlight={focus?.flow}
					onCode={(file, match) => onFocus({ tab: "code", file, match })}
				/>
			)}
			{tab === "code" && (
				<TheCode
					tour={tour}
					files={files}
					error={filesError}
					usePatch={usePatch}
					open={open}
					setOpen={setOpen}
					target={focus?.tab === "code" ? focus : undefined}
				/>
			)}
			{tab === "checks" && (
				<Checks
					brief={brief}
					open={openCheck}
					setOpen={setOpenCheck}
					proof={proof}
					judge={judge}
					target={target}
					onFile={(file) => onFocus({ tab: "code", file })}
					footer={checksFooter}
				/>
			)}
			{tab === "choices" && <Choices brief={brief} target={target} />}
		</section>
	);
}

/* ── How it works ── */

function HowItWorks({
	system,
	highlight,
	onCode,
}: {
	system: NonNullable<ReviewBrief["system"]>;
	highlight?: DiveFocus["flow"];
	onCode: (file: string, match: string) => void;
}) {
	// Older briefs carry fact tables; read them as touch cards.
	const touches: BriefTouch[] = system.touches?.length
		? system.touches
		: system.interfaces.flatMap((table) =>
				table.rows.map((row) => ({
					mark: row.mark ?? "same",
					what: row.cells[0]!,
					say: row.cells.slice(1).join(" · "),
					tech: table.title,
				})),
			);
	return (
		<div className="dive-pane">
			<p className="dive-lead">{system.summary}</p>
			<p className="dive-legend muted">
				Read top to bottom. <span className="dive-badge new">new</span>{" "}
				<span className="dive-badge changed">changed</span> mark what this PR
				adds; unmarked steps already worked this way.
			</p>
			{system.flows.map((flow) => (
				<FlowCard
					key={flow.id}
					flow={flow}
					highlight={highlight?.id === flow.id ? highlight.steps : []}
					onCode={onCode}
				/>
			))}
			{touches.length > 0 && (
				<>
					<h3 className="dive-h">Where it touches the rest of the system</h3>
					<ul className="dive-touches">
						{touches.map((t) => (
							<li
								key={`${t.what}-${t.tech ?? ""}`}
								className={`mark-${t.mark}`}
							>
								<span className={`dive-mark ${t.mark}`}>{MARK[t.mark]}</span>
								<strong>{t.what}</strong>
								<p>{t.say}</p>
								{t.tech && <code>{t.tech}</code>}
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}

function FlowCard({
	flow,
	highlight,
	onCode,
}: {
	flow: BriefFlow;
	highlight: number[];
	onCode: (file: string, match: string) => void;
}) {
	const [mode, setMode] = useState<"now" | "before">("now");
	const [walk, setWalk] = useState<number>();
	const steps = mode === "before" && flow.before ? flow.before : flow.steps;
	const lanes = flow.participants.length;
	const column = (id: string) =>
		Math.max(
			0,
			flow.participants.findIndex((p) => p.id === id),
		);
	const show = (next: "now" | "before") => {
		setMode(next);
		setWalk(undefined);
	};
	return (
		<section
			id={`brief-flow-${flow.id}`}
			className="dive-flow"
			style={{ "--lanes": lanes } as CSSProperties}
			aria-labelledby={`dive-flow-${flow.id}`}
		>
			<header>
				<div>
					<h3 id={`dive-flow-${flow.id}`}>{flow.title}</h3>
					<p className="muted">When: {flow.trigger}</p>
				</div>
				<div className="dive-flow-tools">
					{flow.before && (
						<fieldset className="dive-seg" aria-label="Show this flow">
							<button
								type="button"
								aria-pressed={mode === "before"}
								onClick={() => show("before")}
							>
								Before
							</button>
							<button
								type="button"
								aria-pressed={mode === "now"}
								onClick={() => show("now")}
							>
								Now
							</button>
						</fieldset>
					)}
					<button
						type="button"
						className="dive-chip"
						onClick={() => setWalk(walk === undefined ? 0 : undefined)}
					>
						{walk === undefined ? "▶ Step through" : "Show all"}
					</button>
				</div>
			</header>
			{mode === "before" && flow.beforeNote && (
				<p className="dive-before">{flow.beforeNote}</p>
			)}
			<div className="dive-actors" aria-hidden="true">
				{flow.participants.map((p) => (
					<div
						key={p.id}
						className={`dive-actor ${p.external ? "external" : ""}`}
						title={p.detail}
					>
						{p.icon && <span>{p.icon}</span>}
						<strong>{p.label}</strong>
					</div>
				))}
			</div>
			<ol
				className="dive-steps"
				aria-label={`${flow.title}, ${mode === "before" ? "before this PR" : "now"}`}
			>
				{steps.map((step, i) => {
					const from = column(step.from),
						to = column(step.to),
						low = Math.min(from, to),
						half = 50 / lanes;
					const state =
						walk === undefined
							? highlight.includes(i + 1) && mode === "now"
								? "current"
								: ""
							: i === walk
								? "current"
								: i < walk
									? "past"
									: "future";
					return (
						// biome-ignore lint/a11y/useKeyWithClickEvents: Back/Next buttons step through with the keyboard
						<li
							key={`${mode}-${i}`}
							className={`dive-step ${state} ${step.change ?? ""} ${step.outcome ?? ""} ${step.dashed ? "dashed" : ""}`}
							onClick={() => walk !== undefined && setWalk(i)}
						>
							<div className="dive-arrow-row" aria-hidden="true">
								{flow.participants.map((p, j) => (
									<span
										key={p.id}
										className="dive-lifeline"
										style={{ left: `${(j * 100) / lanes + half}%` }}
									/>
								))}
								<span
									className={`dive-arrow ${from === to ? "self" : to < from ? "left" : "right"}`}
									style={
										from === to
											? { left: `${(from * 100) / lanes + half}%` }
											: {
													left: `${(low * 100) / lanes + half}%`,
													width: `${(Math.abs(to - from) * 100) / lanes}%`,
												}
									}
								>
									<b>{i + 1}</b>
								</span>
							</div>
							<div className="dive-step-text">
								<p>
									<span className="sr-only">
										{flow.participants[from]?.label} to{" "}
										{flow.participants[to]?.label}:{" "}
									</span>
									{step.change && (
										<span className={`dive-badge ${step.change}`}>
											{step.change}
										</span>
									)}
									{step.outcome === "bad" && <span aria-hidden="true">✕ </span>}
									{step.label}
								</p>
								{(step.detail || step.code) && (
									<p className="dive-tech">
										{step.detail && <code>{step.detail}</code>}
										{step.code && (
											<button
												type="button"
												className="dive-link"
												onClick={(e) => {
													e.stopPropagation();
													onCode(step.code!.file, step.code!.match);
												}}
											>
												Show code →
											</button>
										)}
									</p>
								)}
							</div>
						</li>
					);
				})}
			</ol>
			{flow.note && mode === "now" && (
				<p className="dive-note muted">{flow.note}</p>
			)}
			{walk !== undefined && (
				<nav className="dive-walk" aria-label="Step through">
					<button
						type="button"
						className="button secondary"
						disabled={walk === 0}
						onClick={() => setWalk(walk - 1)}
					>
						← Back
					</button>
					<span className="muted">
						Step {walk + 1} of {steps.length}
					</span>
					<button
						type="button"
						className="button primary"
						onClick={() =>
							setWalk(walk + 1 < steps.length ? walk + 1 : undefined)
						}
					>
						{walk + 1 < steps.length ? "Next →" : "Done"}
					</button>
				</nav>
			)}
		</section>
	);
}

/* ── The code ── */

function TheCode({
	tour,
	files,
	error,
	usePatch,
	open,
	setOpen,
	target,
}: {
	tour: BriefTourEntry[];
	files?: ReviewFile[];
	error?: ReactNode;
	usePatch: (file: ReviewFile) => PatchState;
	open: Set<string>;
	setOpen: (next: Set<string>) => void;
	target?: DiveFocus;
}) {
	if (!files) return <div className="dive-pane">{error}</div>;
	const byPath = new Map(files.map((f) => [f.path, f]));
	const placed = new Set(
		tour.flatMap((e) => [e.file, ...(e.related ?? []), ...(e.same ?? [])]),
	);
	// A file the tour missed still appears, so the diff is always complete.
	const rest = files.filter((f) => !placed.has(f.path));
	const entries: BriefTourEntry[] = [
		...tour.filter((e) => byPath.has(e.file)),
		...rest.map((f) => ({ file: f.path, say: "" })),
	];
	const totals = lineBreakdown(files);
	const added = totals.code + totals.tests + totals.text;
	const parts = [
		["code", "Code", totals.code],
		["tests", "Tests", totals.tests],
		["text", "Text & data", totals.text],
	] as const;
	const toggle = (file: string) => {
		const next = new Set(open);
		if (!next.delete(file)) next.add(file);
		setOpen(next);
	};
	return (
		<div className="dive-pane">
			<p className="dive-lead">
				{files.length} {files.length === 1 ? "file" : "files"}, {added} lines
				added.{" "}
				{totals.code === 0 && added > 0
					? "None of them are code: only tests, text and data."
					: totals.code < added && (
							<>
								<strong>{totals.code}</strong> of them are code; the rest are
								tests, text and data.
							</>
						)}
			</p>
			{added > 0 && (
				<>
					<div
						className="dive-split"
						role="img"
						aria-label="Added lines by kind"
					>
						{parts.map(([kind, label, n]) =>
							n ? (
								<span
									key={kind}
									className={kind}
									style={{ flexGrow: n }}
									title={`${label}: ${n}`}
								/>
							) : null,
						)}
					</div>
					<ul className="dive-split-legend">
						{parts.map(([kind, label, n]) => (
							<li key={kind}>
								<i className={kind} /> {label} <strong>{n}</strong>
							</li>
						))}
					</ul>
				</>
			)}
			<p className="dive-legend muted">
				In the order I’d show you. ★ files carry the change and start open;
				tests sit under the file they test; reformatting is folded away.
			</p>
			<div className="dive-tools">
				<button
					type="button"
					className="dive-chip"
					onClick={() => setOpen(new Set(entries.map((e) => e.file)))}
				>
					Open all
				</button>
				<button
					type="button"
					className="dive-chip"
					onClick={() => setOpen(new Set())}
				>
					Close all
				</button>
			</div>
			{entries.map((entry) => (
				<TourFile
					key={entry.file}
					entry={entry}
					byPath={byPath}
					open={open.has(entry.file)}
					onToggle={() => toggle(entry.file)}
					usePatch={usePatch}
					target={target}
				/>
			))}
		</div>
	);
}

function Path({ path }: { path: string }) {
	const dir = dirName(path);
	return (
		<span className="dive-path">
			{dir && (
				<small>
					<span dir="ltr">{dir}/</span>
				</small>
			)}
			<strong>{fileName(path)}</strong>
		</span>
	);
}

function Counts({ file }: { file: ReviewFile }) {
	return (
		<span className="dive-counts">
			<span className="add">+{file.additions ?? "?"}</span>{" "}
			<span className="del">−{file.deletions ?? "?"}</span>
		</span>
	);
}

function TourFile({
	entry,
	byPath,
	open,
	onToggle,
	usePatch,
	target,
}: {
	entry: BriefTourEntry;
	byPath: Map<string, ReviewFile>;
	open: boolean;
	onToggle: () => void;
	usePatch: (file: ReviewFile) => PatchState;
	target?: DiveFocus;
}) {
	const file = byPath.get(entry.file)!;
	const related = (entry.related ?? []).filter((p) => byPath.has(p));
	const same = (entry.same ?? []).filter((p) => byPath.has(p));
	const tests = related.filter((p) => fileKind(p) === "tests");
	const testLines = tests.reduce(
		(n, p) => n + (byPath.get(p)?.additions ?? 0),
		0,
	);
	const flagged =
		entry.flag ?? (entry.pins?.some((p) => p.flag) && "Worth a look");
	const [allRelated, setAllRelated] = useState(false);
	const others = [...related.filter((p) => fileKind(p) !== "tests"), ...tests];
	const listed =
		allRelated || others.length <= RELATED_LIMIT
			? others
			: others.slice(0, RELATED_LIMIT - 2);
	return (
		<article
			id={`dive-file-${entry.file}`}
			className={`dive-file ${entry.key ? "key" : ""}`}
		>
			<button
				type="button"
				className="dive-file-head"
				aria-expanded={open}
				onClick={onToggle}
			>
				<span className="dive-chev" aria-hidden="true">
					{open ? "▾" : "▸"}
				</span>
				{entry.key && (
					<span
						className="dive-star"
						role="img"
						aria-label="Carries the change"
					>
						★
					</span>
				)}
				<Path path={entry.file} />
				{file.status === "A" && <span className="dive-badge new">new</span>}
				{file.status === "D" && (
					<span className="dive-badge gone">deleted</span>
				)}
				{file.status === "R" && (
					<span className="dive-badge changed">moved</span>
				)}
				<Counts file={file} />
			</button>
			{(entry.say || flagged) && (
				<p className="dive-file-say">
					{flagged && <span className="dive-flag">👀 {flagged}</span>}
					{entry.say}
				</p>
			)}
			{open ? (
				<>
					<Diff
						file={file}
						pins={entry.pins ?? []}
						usePatch={usePatch}
						target={target}
					/>
					{same.length > 0 && (
						<div className="dive-same">
							<p className="muted">
								Same change in {same.length} more{" "}
								{same.length === 1 ? "file" : "files"}:
							</p>
							{same.map((p) => (
								<Related
									key={p}
									file={byPath.get(p)!}
									usePatch={usePatch}
									target={target}
								/>
							))}
						</div>
					)}
					{listed.map((p) => (
						<Related
							key={p}
							file={byPath.get(p)!}
							usePatch={usePatch}
							target={target}
						/>
					))}
					{listed.length < others.length && (
						<button
							type="button"
							className="dive-chip dive-more"
							onClick={() => setAllRelated(true)}
						>
							Show all {others.length} related files
						</button>
					)}
				</>
			) : related.length || same.length ? (
				<p className="dive-file-extra muted">
					{[
						same.length &&
							`+${same.length} ${same.length === 1 ? "file" : "files"} with the same change`,
						tests.length && `${testLines} lines of tests`,
						related.length - tests.length &&
							`${related.length - tests.length} related ${related.length - tests.length === 1 ? "file" : "files"}`,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
			) : null}
		</article>
	);
}

function Related({
	file,
	usePatch,
	target,
}: {
	file: ReviewFile;
	usePatch: (file: ReviewFile) => PatchState;
	target?: DiveFocus;
}) {
	const [open, setOpen] = useState(target?.file === file.path);
	useEffect(() => {
		if (target?.file === file.path) setOpen(true);
	}, [target, file.path]);
	return (
		<div className="dive-related" id={`dive-file-${file.path}`}>
			<button
				type="button"
				className="dive-related-head"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				<span className={`dive-kind ${fileKind(file.path)}`}>
					{KIND[fileKind(file.path)]}
				</span>
				<Path path={file.path} />
				<Counts file={file} />
			</button>
			{open && (
				<Diff file={file} pins={[]} usePatch={usePatch} target={target} />
			)}
		</div>
	);
}

function Diff({
	file,
	pins,
	usePatch,
	target,
}: {
	file: ReviewFile;
	pins: NonNullable<BriefTourEntry["pins"]>;
	usePatch: (file: ReviewFile) => PatchState;
	target?: DiveFocus;
}) {
	const state = usePatch(file);
	const [limit, setLimit] = useState(LINE_LIMIT);
	const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
	const patch = state.status === "ready" ? state.patch : null;
	const lines = useMemo(() => (patch ? parsePatch(patch) : []), [patch]);
	const blocks = useMemo(() => diffBlocks(lines), [lines]);
	// Each pin sits under one line; pins that match nothing are listed above the diff.
	const pinned = useMemo(() => {
		const map = new Map<DiffLine, (typeof pins)[number]>();
		const loose: typeof pins = [];
		for (const pin of pins) {
			const line = findLine(lines, pin.match);
			if (line && !map.has(line)) map.set(line, pin);
			else loose.push(pin);
		}
		return { map, loose };
	}, [lines, pins]);
	const targetLine =
		target?.file === file.path && target.match
			? findLine(lines, target.match)
			: undefined;
	if (state.status === "pending")
		return (
			<p className="dive-diff-status" role="status">
				Loading this file’s diff…
			</p>
		);
	if (state.status === "error")
		return (
			<div className="dive-diff-status" role="alert">
				<p>Could not load this diff: {state.message}</p>
				<button type="button" className="dive-chip" onClick={state.retry}>
					Retry
				</button>
			</div>
		);
	if (!patch)
		return (
			<p className="dive-diff-status" role="status">
				{state.reason ??
					"No text changes. This file has metadata changes only."}
			</p>
		);
	// Long diffs stop at a limit, but always reach Bob's notes and the line jumped to.
	const reach = Math.max(
		limit,
		...[...pinned.map.keys(), ...(targetLine ? [targetLine] : [])].map(
			(line) => lines.indexOf(line) + 10,
		),
	);
	let shown = 0;
	let indent = 0;
	const render = (line: DiffLine) => {
		const pin = pinned.map.get(line);
		const hit = line === targetLine;
		return (
			<div key={lineKey(file.path, line)}>
				<div
					className={`dive-line ${line.kind} ${hit ? "hit" : ""}`}
					data-dive-match={
						hit && target?.match ? `${file.path}\n${target.match}` : undefined
					}
				>
					<span className="dive-num">
						{line.kind === "remove" ? "" : line.next}
					</span>
					<span className="dive-sign" aria-hidden="true">
						{line.kind === "add" ? "+" : line.kind === "remove" ? "−" : ""}
					</span>
					<code>
						{line.kind === "add" && <span className="sr-only">Added: </span>}
						{line.kind === "remove" && (
							<span className="sr-only">Removed: </span>
						)}
						{line.text.slice(indent) || " "}
					</code>
				</div>
				{pin && <Pin say={pin.say} flag={pin.flag} />}
			</div>
		);
	};
	const out: ReactNode[] = [];
	for (const [i, block] of blocks.entries()) {
		if (shown >= reach) break;
		if (block.kind === "hunk") {
			indent = commonIndent(hunkLines(blocks, i));
			if (i > 0)
				out.push(
					<div key={`gap-${i}`} className="dive-gap" aria-hidden="true">
						⋯
					</div>,
				);
			continue;
		}
		if (block.kind === "line") {
			out.push(render(block.line));
			shown++;
			continue;
		}
		if (unfolded.has(i) || block.lines.some((l) => l === targetLine)) {
			out.push(
				<div key={`reformat-${i}`} className="dive-unfolded">
					{block.lines.map(render)}
				</div>,
			);
			shown += block.lines.length;
		} else
			out.push(
				<button
					type="button"
					key={`reformat-${i}`}
					className="dive-reformat"
					onClick={() => setUnfolded(new Set(unfolded).add(i))}
				>
					↔ {block.count} {block.count === 1 ? "line" : "lines"} only
					reformatted, nothing changed · show
				</button>,
			);
	}
	const total = lines.filter((l) => l.kind !== "hunk").length;
	return (
		<>
			{pinned.loose.map((pin) => (
				<Pin key={pin.match} say={pin.say} flag={pin.flag} />
			))}
			<section
				className="dive-diff"
				tabIndex={0}
				aria-label={`Diff of ${file.path}`}
			>
				{out}
			</section>
			{total > shown && shown >= reach && (
				<button
					type="button"
					className="dive-chip dive-more"
					onClick={() => setLimit(Infinity)}
				>
					Show the remaining lines
				</button>
			)}
		</>
	);
}

function hunkLines(blocks: DiffBlock[], start: number) {
	const lines: DiffLine[] = [];
	for (let i = start + 1; i < blocks.length; i++) {
		const block = blocks[i]!;
		if (block.kind === "hunk") break;
		if (block.kind === "line") lines.push(block.line);
		else lines.push(...block.lines);
	}
	return lines;
}

function Pin({ say, flag }: { say: string; flag?: boolean }) {
	return (
		<div className={`dive-pin ${flag ? "flag" : ""}`}>
			<span aria-hidden="true">B</span>
			<p>
				<span className="sr-only">Bob’s note: </span>
				{flag && <span aria-hidden="true">👀 </span>}
				{say}
			</p>
		</div>
	);
}

/* ── Checks ── */

function Checks({
	brief,
	open,
	setOpen,
	proof,
	judge,
	target,
	onFile,
	footer,
}: {
	brief: ReviewBrief;
	open?: string;
	setOpen: (id?: string) => void;
	proof: (value: BriefProof) => ReactNode;
	judge: (path: string, labels: [string, string]) => ReactNode;
	target: Target;
	onFile: (file: string) => void;
	footer?: ReactNode;
}) {
	const count = (status: BriefRequirement["status"]) =>
		brief.requirements.filter((r) => r.status === status).length;
	const total = brief.requirements.length;
	const summary = [
		count("shown") &&
			`${count("shown")} of ${total} ${count("shown") === 1 ? "was" : "were"} seen working in the running app`,
		count("tested") && `${count("tested")} only by automated tests`,
		count("partly") && `${count("partly")} partly`,
		count("not-shown") && `${count("not-shown")} without evidence`,
		count("gap") && `${count("gap")} not met`,
		count("waived") && `${count("waived")} waived`,
	].filter(Boolean);
	const assessments = brief.requirementCoverage?.assessments ?? [];
	const owners = (files: string[]) => [
		...new Set(
			files.map((file) => tourOwner(brief.tour ?? [], file)?.file ?? file),
		),
	];
	return (
		<div className="dive-pane">
			<p className="dive-lead">
				{summary.join("; ")}
				{summary.length ? "." : ""}
			</p>
			<ol className="dive-checks">
				{brief.requirements.map((r, i) => {
					const path = `/requirements/${i}`;
					const isOpen = open === r.id;
					const notes = assessments.filter((a) =>
						r.covers?.includes(a.requirementId),
					);
					const files = owners(r.files);
					return (
						<li
							key={r.id}
							id={`brief-line-${r.id}`}
							className={`dive-check status-${r.status}`}
						>
							<Commentable
								target={target(
									path,
									r.text,
									"Requirement",
									`${r.text} (${STATUS[r.status][1]})`,
									2,
									i,
								)}
							>
								<button
									type="button"
									className="dive-check-head"
									aria-expanded={isOpen}
									onClick={() => setOpen(isOpen ? undefined : r.id)}
								>
									<span
										className={`brief-status status-${r.status}`}
										role="img"
										aria-label={STATUS[r.status][1]}
									>
										{STATUS[r.status][0]}
									</span>
									<span>
										<strong>{r.text}</strong>
										<small>
											{STATUS[r.status][1]}
											{r.how ? ` · ${r.how}` : ""}
										</small>
									</span>
									<span className="dive-chev" aria-hidden="true">
										{isOpen ? "▾" : "▸"}
									</span>
								</button>
							</Commentable>
							{isOpen && (
								<div className="dive-check-body">
									<CheckProof proof={r.proof} render={proof} />
									{r.more?.map((value, j) => (
										<CheckProof key={j} proof={value} render={proof} />
									))}
									{r.caveat && <p className="brief-caveat">⚠ {r.caveat}</p>}
									{notes.map((a) => (
										<p key={a.requirementId} className="brief-review-note">
											<strong>Reviewer: {a.status.replaceAll("_", " ")}</strong>{" "}
											{a.reason}
										</p>
									))}
									<div className="dive-check-foot">
										<span className="dive-files">
											{files.map((file) => (
												<button
													type="button"
													key={file}
													className="dive-link"
													onClick={() => onFile(file)}
												>
													{fileName(file)}
												</button>
											))}
										</span>
										{judge(path, ["Met", "Not met"])}
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ol>
			{brief.notVerified.length > 0 && (
				<>
					<h3 className="dive-h">Couldn’t prove</h3>
					<ul className="dive-unproven">
						{brief.notVerified.map((n) => (
							<li key={n.what}>
								<strong>{n.what}</strong>
								<small>{n.why}</small>
							</li>
						))}
					</ul>
				</>
			)}
			{footer}
		</div>
	);
}

/** Plain rows first; the exact recorded values stay one tap away. */
function CheckProof({
	proof,
	render,
}: {
	proof: BriefProof;
	render: (value: BriefProof) => ReactNode;
}) {
	if (proof.kind !== "table" || !proof.rows.some((row) => row.plain))
		return <>{render(proof)}</>;
	return (
		<div className="dive-proof">
			<ul className="dive-tried">
				{proof.rows.map((row, i) => (
					<li key={i} className={row.mark ?? ""}>
						<span aria-hidden="true">
							{row.mark === "bad" ? "✕" : row.mark === "good" ? "✓" : "·"}
						</span>
						<div>
							<p>{row.plain?.tried ?? row.cells[0]}</p>
							<small>
								→ {row.plain?.saw ?? row.cells.slice(1).join(" · ")}
							</small>
						</div>
					</li>
				))}
			</ul>
			<details className="dive-raw">
				<summary>Exact recorded values</summary>
				{render(proof)}
			</details>
		</div>
	);
}

/* ── Choices ── */

function Choices({ brief, target }: { brief: ReviewBrief; target: Target }) {
	const mine = brief.interpretation.filter((d) => d.decidedBy === "bob").length;
	const yours = brief.interpretation.length - mine;
	return (
		<div className="dive-pane">
			<figure className="dive-ask">
				<blockquote>{brief.ask.quote}</blockquote>
				<figcaption>
					What you asked for ·{" "}
					{brief.ask.url ? (
						<a href={brief.ask.url} target="_blank" rel="noreferrer">
							{brief.ask.source} ↗
						</a>
					) : (
						brief.ask.source
					)}
				</figcaption>
			</figure>
			{brief.interpretation.length > 0 ? (
				<>
					<p className="dive-lead">
						{mine
							? `The ask left room for interpretation. ${yours ? `${yours} ${yours === 1 ? "call was" : "calls were"} settled by you or the ticket; ` : ""}I made ${mine === 1 ? "one" : `the other ${mine}`}.`
							: "Every interpretation was settled by you or the ticket."}
					</p>
					<ul className="dive-choices">
						{brief.interpretation.map((d, i) => (
							<li key={d.topic} className={`by-${d.decidedBy}`}>
								<Commentable
									target={target(
										`/interpretation/${i}`,
										d.topic,
										"Interpretation",
										`${d.topic}: ${d.chosen}`,
										1,
										i,
									)}
								>
									<span className="dive-by">
										{BY[d.decidedBy]} · {d.topic}
									</span>
									<strong>{d.chosen}</strong>
									{d.alternatives?.length ? (
										<p className="dive-not">
											<span>not:</span>
											{d.alternatives.map((a) => (
												<s key={a}>{a}</s>
											))}
										</p>
									) : null}
									{d.note && <small>{d.note}</small>}
								</Commentable>
							</li>
						))}
					</ul>
				</>
			) : (
				<p className="dive-lead">The ask needed no interpretation.</p>
			)}
		</div>
	);
}
