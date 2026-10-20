import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Architecture, ArchitectureProposal } from "../Architecture";
import type { ArchitectureFootprint } from "../ArchitectureFootprint";
import { active } from "../RunAttention";
import { useAction, useRun } from "./client";
import { useFormState } from "./form-state";
import { Button, Markdown } from "./ui";

type Decision = Architecture["decisions"][number];
type Option = Decision["options"][number];
type MapPart = NonNullable<Architecture["map"]>["parts"][number] & {
	preview?: boolean;
};
type MapLink = NonNullable<Architecture["map"]>["links"][number] & {
	preview?: boolean;
};
/** An answer the human picked on the page, sent with "Ask for changes". */
interface Pick {
	decision: string;
	option: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Proposals saved before the decisions format cannot be shown as a brief. */
const readable = (content: any): content is Architecture =>
	Array.isArray(content?.decisions) && typeof content?.title === "string";
const open = (content: Architecture) =>
	content.decisions.filter((d) => d.status === "open").length;

const fallbackStatus = (status: string) =>
	status === "proposed"
		? ["working", "Bob is checking the proposal"]
		: ["quiet", "Replaced by a newer version"];
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

/* ------------------------------------------------------------------ map */

const W = 172,
	H = 62,
	GAP_X = 52,
	GAP_Y = 22,
	PAD = 8;
function layout(
	map: NonNullable<Architecture["map"]>,
	showAll: boolean,
	preview?: Option["preview"],
) {
	const hidden = new Set(preview?.hide ?? []);
	const parts: MapPart[] = [
		...map.parts.filter(
			(p) => !hidden.has(p.id) && (showAll || p.status !== "unchanged"),
		),
		...(preview?.parts ?? []).map((p) => ({ ...p, preview: true })),
	];
	const areas = map.areas.filter((a) => parts.some((p) => p.area === a.id));
	const position = new Map<string, { x: number; y: number }>();
	let rows = 1;
	areas.forEach((area, column) => {
		const inArea = parts.filter((p) => p.area === area.id);
		rows = Math.max(rows, inArea.length);
		for (const [row, part] of inArea.entries())
			position.set(part.id, {
				x: PAD + column * (W + GAP_X),
				y: PAD + 22 + row * (H + GAP_Y),
			});
	});
	const links: MapLink[] = [
		...map.links,
		...(preview?.links ?? []).map((l) => ({ ...l, preview: true })),
	].filter((l) => position.has(l.from) && position.has(l.to));
	return {
		parts,
		areas,
		links,
		position,
		width: PAD * 2 + areas.length * W + (areas.length - 1) * GAP_X,
		height: PAD * 2 + 22 + rows * H + (rows - 1) * GAP_Y,
	};
}
function ArchitectureMap({
	map,
	preview,
	showAll,
	selected,
	onSelect,
}: {
	map: NonNullable<Architecture["map"]>;
	preview?: Option["preview"];
	showAll: boolean;
	selected?: string;
	onSelect: (id?: string) => void;
}) {
	const view = layout(map, showAll, preview);
	const key = (id: string) => (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onSelect(selected === id ? undefined : id);
		}
	};
	const labels: React.ReactNode[] = [];
	return (
		<div className="arch-map-scroll">
			<svg
				className="arch-map"
				viewBox={`0 0 ${view.width} ${view.height}`}
				style={{ minWidth: Math.min(view.width, 560) }}
				aria-labelledby="arch-map-title"
			>
				<title id="arch-map-title">What changes</title>
				<defs>
					<marker
						id="arch-arrow"
						viewBox="0 0 10 10"
						refX="9"
						refY="5"
						markerWidth="7"
						markerHeight="7"
						orient="auto"
					>
						<path d="M0 0L10 5L0 10z" className="arch-arrow" />
					</marker>
				</defs>
				{view.areas.map((area, column) => (
					<text
						key={area.id}
						className="arch-area"
						x={PAD + column * (W + GAP_X) + 2}
						y={PAD + 10}
					>
						{area.name}
					</text>
				))}
				{view.links.map((link, i) => {
					const a = view.position.get(link.from)!,
						b = view.position.get(link.to)!;
					let d: string, lx: number, ly: number;
					if (a.x === b.x) {
						const up = b.y < a.y,
							x = a.x + W / 2,
							y1 = up ? a.y : a.y + H,
							y2 = up ? b.y + H + 6 : b.y - 6;
						d = `M${x} ${y1}L${x} ${y2}`;
						lx = x;
						ly = (y1 + y2) / 2;
					} else {
						const forward = b.x > a.x,
							x1 = forward ? a.x + W : a.x,
							y1 = a.y + H / 2,
							x2 = forward ? b.x - 6 : b.x + W + 6,
							y2 = b.y + H / 2,
							m = (x1 + x2) / 2;
						d = `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
						lx = m;
						ly = (y1 + y2) / 2;
					}
					if (link.label) {
						const width = link.label.length * 6.4 + 14;
						labels.push(
							<g key={`label-${i}`} className="arch-link-label">
								<rect
									x={lx - width / 2}
									y={ly - 10}
									width={width}
									height={20}
									rx={10}
								/>
								<text x={lx} y={ly + 4} textAnchor="middle">
									{link.label}
								</text>
							</g>,
						);
					}
					return (
						<path
							key={`${link.from}-${link.to}-${i}`}
							d={d}
							className={`arch-link${link.preview ? " preview" : ""}`}
							markerEnd="url(#arch-arrow)"
						/>
					);
				})}
				{view.parts.map((part) => {
					const p = view.position.get(part.id)!;
					return (
						// biome-ignore lint/a11y/useSemanticElements: SVG has no native button.
						<g
							key={part.id}
							role="button"
							tabIndex={0}
							aria-pressed={selected === part.id}
							aria-label={`${part.label}: ${part.note}`}
							className={`arch-node ${part.preview ? "preview" : part.status}${selected === part.id ? " selected" : ""}`}
							onClick={() =>
								onSelect(selected === part.id ? undefined : part.id)
							}
							onKeyDown={key(part.id)}
						>
							<rect x={p.x} y={p.y} width={W} height={H} rx={15} />
							<text className="arch-node-label" x={p.x + 14} y={p.y + 26}>
								{part.label}
							</text>
							<text className="arch-node-note" x={p.x + 14} y={p.y + 45}>
								{part.note}
							</text>
						</g>
					);
				})}
				{labels}
			</svg>
		</div>
	);
}

/* ---------------------------------------------------------------- brief */

interface BriefProps {
	content: Architecture;
	footprint?: ArchitectureFootprint;
	previous?: Architecture;
	/** Answers the human has picked but not sent yet. */
	picks?: Pick[];
	onPick?: (pick: Pick) => void;
	focusQuestion?: React.RefObject<HTMLDivElement | null>;
}
function Choice({
	decision,
	picks,
	onPick,
	onPreview,
	previewing,
}: {
	decision: Decision;
	picks: Pick[];
	onPick?: (pick: Pick) => void;
	onPreview?: (option?: Option) => void;
	previewing?: Option;
}) {
	const [expanded, setExpanded] = useState(false);
	const picked = picks.find((p) => p.decision === decision.id)?.option;
	const previewLink = (option: Option) =>
		option.preview &&
		onPreview && (
			<button
				type="button"
				className="arch-link-button"
				onClick={(e) => {
					e.stopPropagation();
					onPreview(previewing === option ? undefined : option);
				}}
			>
				{previewing === option ? "Back to Bob’s pick" : "Show on the map"}
			</button>
		);
	if (decision.status === "open")
		return (
			<div className="arch-card arch-open">
				<div className="arch-tag">Bob needs your answer</div>
				<h3>{decision.question}</h3>
				{decision.why && <p className="arch-sub">{decision.why}</p>}
				<div className="arch-options">
					{decision.options.map((option) => (
						<div
							key={option.id}
							className={`arch-option${picked === option.id ? " on" : ""}`}
						>
							<button
								type="button"
								className="arch-option-pick"
								disabled={!onPick}
								aria-pressed={picked === option.id}
								onClick={() =>
									onPick?.({ decision: decision.id, option: option.id })
								}
							>
								<span className="arch-option-name">{option.name}</span>
								<span>👍 {option.upside}</span>
								<span>⚠️ {option.catch}</span>
							</button>
							<div className="arch-option-foot">
								{picked === option.id && (
									<span>✓ Your answer. Send it with “Ask for changes”.</span>
								)}
								{previewLink(option)}
							</div>
						</div>
					))}
				</div>
			</div>
		);
	const chosen = decision.options.find((o) => o.id === decision.pick)!;
	const others = decision.options.filter((o) => o !== chosen);
	return (
		<div className="arch-card arch-settled">
			<div className="arch-settled-row">
				<span
					className={`arch-check${decision.decidedBy === "you" ? " you" : ""}`}
				>
					✓
				</span>
				<div>
					<div className="arch-muted">{decision.question}</div>
					<div className="arch-answer">
						{decision.decidedBy === "you" ? "Your answer" : "Bob’s pick"}:{" "}
						{chosen.name}
					</div>
					<div className="arch-sub">{chosen.upside}</div>
				</div>
				<button
					type="button"
					className="arch-link-button"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "Hide" : `Other options (${others.length})`}
				</button>
			</div>
			{expanded && (
				<ul className="arch-others">
					{others.map((option) => (
						<li key={option.id}>
							<b>{option.name}</b>
							<span>👍 {option.upside}</span>
							<span>⚠️ {option.catch}</span>
							<div className="arch-option-foot">
								{previewLink(option)}
								{onPick &&
									(picked === option.id ? (
										<span>✓ Added to your message</span>
									) : (
										<button
											type="button"
											className="arch-link-button"
											onClick={() =>
												onPick({ decision: decision.id, option: option.id })
											}
										>
											Choose this instead
										</button>
									))}
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
function isNew(text: string, before?: string[]) {
	return before !== undefined && !before.includes(text);
}
const NewMark = ({ show }: { show: boolean }) =>
	show ? <span className="arch-new">new</span> : null;

function Findings({
	items,
	previous,
}: {
	items: Architecture["evidence"];
	previous?: Architecture["evidence"];
}) {
	return (
		<ul className="arch-card arch-list fits">
			{items.map((item, i) => (
				<li key={i}>
					<span className="arch-dot">•</span>
					<span>
						{item.observation}
						<NewMark
							show={isNew(
								item.observation,
								previous?.map((item) => item.observation),
							)}
						/>
						<small>
							{item.repository} · {item.paths.join(", ")}
						</small>
					</span>
				</li>
			))}
		</ul>
	);
}

/** In-page links must not replace the application's hash route. */
function DeliverableLink({
	step,
	label,
}: {
	step: Architecture["candidate"]["steps"][number];
	label: string;
}) {
	return (
		<button
			type="button"
			className="arch-link-button arch-deliverable-link"
			onClick={() => {
				const target = document.getElementById(`arch-${step.id}`);
				target?.scrollIntoView({ block: "start" });
				target?.focus({ preventScroll: true });
			}}
		>
			{label}
		</button>
	);
}

function Footprint({ content }: { content?: ArchitectureFootprint }) {
	return (
		<section className="arch-chunk">
			<h2>Planned footprint</h2>
			{content ? (
				<div className="arch-card arch-footprint">
					<p>
						<b>{plural(content.files.length, "listed path")}</b> ·{" "}
						{Object.entries(content.changes)
							.filter(([, count]) => count)
							.map(([change, count]) => `${count} ${change}`)
							.join(" · ")}
					</p>
					<p>
						{Object.entries(content.kinds)
							.filter(([, count]) => count)
							.map(([kind, count]) => `${count} ${kind}`)
							.join(" · ")}
					</p>
					<small>
						Computed from declared paths and checked against the planning
						worktrees when this version was saved. File kinds and owning areas
						are inferred from paths and existing package manifests.
					</small>
					<ul className="arch-areas">
						{content.areas.map((area) => (
							<li key={area.name}>
								<code>{area.name}</code>
								<b>{area.files}</b>
							</li>
						))}
					</ul>
					{content.warnings.length > 0 ? (
						<ul className="arch-footprint-warnings">
							{content.warnings.map((warning, i) => (
								<li key={i}>
									<b>{warning.message}</b>
									<small>{warning.paths.join(" · ")}</small>
								</li>
							))}
						</ul>
					) : (
						<p className="muted">
							No path, configuration or map consistency flags.
						</p>
					)}
				</div>
			) : (
				<p className="arch-card muted">
					This saved proposal has no runtime footprint checks.
				</p>
			)}
		</section>
	);
}

export function ArchitectureBrief({
	content,
	footprint,
	previous,
	picks = [],
	onPick,
	focusQuestion,
}: BriefProps) {
	const [selected, setSelected] = useState<string>();
	const [showAll, setShowAll] = useState(false);
	const [preview, setPreview] = useState<Option>();
	const map = content.map;
	const part =
		map?.parts.find((p) => p.id === selected) ??
		preview?.preview?.parts.find((p) => p.id === selected);
	const settled = content.decisions.length - open(content);
	const previousSteps = previous?.candidate.steps?.map((s) => s.title);
	return (
		<div className="arch-brief">
			<section className="arch-chunk">
				<h2>{content.problem ? "Today" : "Repository findings"}</h2>
				<Findings
					items={content.problem ?? content.evidence}
					previous={previous?.problem ?? previous?.evidence}
				/>
			</section>
			<Footprint content={footprint} />
			{content.changes.length > 0 && (
				<section className="arch-chunk">
					<h2>What’s new in this version</h2>
					<ul className="arch-card arch-changes">
						{content.changes.map((change, i) => (
							<li key={i}>
								<span className={`arch-icon ${change.from}`}>
									{change.from === "you" ? "✓" : "+"}
								</span>
								<span>
									{change.text}
									<small>
										{change.from === "you"
											? "You asked for this"
											: "Bob added this"}
									</small>
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
			{map && (
				<section className="arch-chunk">
					<h2>The change at a glance</h2>
					<div className="arch-card">
						{preview && (
							<p className="arch-preview-note">
								Showing the other option: <b>{preview.name}</b>
								<button
									type="button"
									className="arch-link-button"
									onClick={() => setPreview(undefined)}
								>
									Back to Bob’s pick
								</button>
							</p>
						)}
						<ArchitectureMap
							map={map}
							preview={preview?.preview}
							showAll={showAll}
							selected={selected}
							onSelect={setSelected}
						/>
						{part && (
							<p className="arch-part-detail">
								<b>{part.label}</b> <span>{part.detail}</span>
								{part.file && <code>{part.file}</code>}
							</p>
						)}
						<div className="arch-map-tools">
							<span className="arch-swatch new">new</span>
							<span className="arch-swatch changed">changed</span>
							<span>Tap a box for details.</span>
							{map.parts.some((p) => p.status === "unchanged") && (
								<button
									type="button"
									className="arch-link-button"
									onClick={() => setShowAll(!showAll)}
								>
									{showAll ? "Hide" : "Show"} parts that stay the same
								</button>
							)}
						</div>
					</div>
				</section>
			)}
			{content.decisions.length > 0 && (
				<section className="arch-chunk">
					<h2>Choices</h2>
					<p className="arch-lead">
						{open(content)
							? `Bob made ${plural(settled, "choice")}. ${open(content)} ${open(content) === 1 ? "is" : "are"} up to you.`
							: `All ${plural(content.decisions.length, "choice")} are made.`}
					</p>
					<div className="arch-choices">
						{content.decisions.map((decision) => (
							<div
								key={decision.id}
								ref={
									decision.status === "open" &&
									decision ===
										content.decisions.find((d) => d.status === "open")
										? focusQuestion
										: undefined
								}
							>
								<Choice
									decision={decision}
									picks={picks}
									onPick={onPick}
									previewing={preview}
									onPreview={
										map
											? (option) => {
													setPreview(option);
													setSelected(undefined);
												}
											: undefined
									}
								/>
							</div>
						))}
					</div>
				</section>
			)}
			{content.problem && (
				<section className="arch-chunk">
					<h2>Why this fits</h2>
					<Findings items={content.evidence} previous={previous?.evidence} />
				</section>
			)}
			{content.criteria && (
				<section className="arch-chunk">
					<h2>Ticket coverage</h2>
					<div className="arch-card arch-coverage">
						<table>
							<thead>
								<tr>
									<th>Requested outcome</th>
									<th>Planned coverage</th>
									<th>Deliverables</th>
								</tr>
							</thead>
							<tbody>
								{content.criteria.map((criterion) => (
									<tr key={criterion.id}>
										<td>
											<b>{criterion.id}</b> {criterion.text}
											<small>
												{criterion.url ? (
													<a
														href={criterion.url}
														target="_blank"
														rel="noreferrer"
													>
														{criterion.source}
													</a>
												) : (
													criterion.source
												)}
											</small>
										</td>
										<td>
											<span
												className={`arch-coverage-status ${criterion.status}`}
											>
												{criterion.status}
											</span>
											<p>{criterion.reason}</p>
										</td>
										<td>
											{content.candidate.steps
												.filter((step) =>
													step.traces?.some(
														(trace) =>
															"criterion" in trace &&
															trace.criterion === criterion.id,
													),
												)
												.map((step) => (
													<DeliverableLink
														key={step.id}
														step={step}
														label={`${step.id}: ${step.title}`}
													/>
												))}
											{criterion.status === "deferred" && "Deferred"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}
			{content.risks.length > 0 && (
				<section className="arch-chunk">
					<h2>Watch out for</h2>
					<ul className="arch-card arch-list risks">
						{content.risks.map((risk, i) => (
							<li key={i}>
								<span className="arch-dot">!</span>
								<span>
									{risk}
									<NewMark show={isNew(risk, previous?.risks)} />
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
			<section className="arch-chunk">
				<h2>What Bob will build</h2>
				<p className="arch-lead">
					{plural(content.candidate.steps.length, "deliverable")}. Sizes are
					relative estimates.
				</p>
				<div className="arch-card">
					<ol className="arch-steps">
						{content.candidate.steps.map((step, i) => (
							<li key={i} id={`arch-${step.id ?? i}`} tabIndex={-1}>
								<span>
									<b>
										{step.id && `${step.id} · `}
										{step.title}
									</b>
									<NewMark show={isNew(step.title, previousSteps)} />
									{step.what && <p>{step.what}</p>}
									{step.kind && (
										<small>
											{step.kind} · size {step.size}
										</small>
									)}
									{step.traces && (
										<small>
											{step.traces
												.map((trace) =>
													"criterion" in trace
														? trace.criterion
														: `Bob added: ${trace.added}`,
												)
												.join(" · ")}
										</small>
									)}
									<ul className="arch-files">
										{step.files.map((file, index) => (
											<li key={index}>
												{typeof file === "string" ? (
													<code>{file}</code>
												) : (
													<>
														<span className="arch-file-operation">
															{file.change}
														</span>
														<code>
															{file.repository && `${file.repository}: `}
															{file.path}
														</code>
													</>
												)}
											</li>
										))}
									</ul>
								</span>
							</li>
						))}
					</ol>
					<details className="arch-full-plan">
						<summary>Full plan for Bob</summary>
						<Markdown>{content.candidate.plan}</Markdown>
						{content.candidate.assets.length > 0 && (
							<ul>
								{content.candidate.assets.map((asset, i) => (
									<li key={i}>
										{asset.purpose}: <code>{asset.path}</code>
									</li>
								))}
							</ul>
						)}
					</details>
				</div>
			</section>
			{content.criteria && (
				<section className="arch-chunk">
					<h2>Work Bob added</h2>
					{content.candidate.steps.some((s) =>
						s.traces?.some((t) => "added" in t),
					) ? (
						<ul className="arch-card arch-list">
							{content.candidate.steps.flatMap(
								(step) =>
									step.traces?.flatMap((trace, i) =>
										"added" in trace ? (
											<li key={`${step.id}-${i}`}>
												<span>
													<DeliverableLink step={step} label={step.title} />
													<small>{trace.added}</small>
												</span>
											</li>
										) : (
											[]
										),
									) ?? [],
							)}
						</ul>
					) : (
						<p className="arch-card">No additional work is declared.</p>
					)}
				</section>
			)}
			{content.nonGoals && (
				<section className="arch-chunk">
					<h2>Not doing</h2>
					<ul className="arch-card arch-checks">
						{content.nonGoals.map((item, i) => (
							<li key={i}>{item}</li>
						))}
					</ul>
				</section>
			)}
			{content.acceptance && (
				<section className="arch-chunk">
					<h2>How we’ll know it works</h2>
					<ol className="arch-card arch-checks">
						{content.acceptance.map((item, i) => (
							<li key={i}>{item}</li>
						))}
					</ol>
				</section>
			)}
		</div>
	);
}

/** Read-only brief for the artifact inspector. */
export function ArchitectureContent({ content }: { content: any }) {
	const footprint: ArchitectureFootprint | undefined = content?.footprint;
	if (!readable(content))
		return <p className="muted">This proposal uses an older format.</p>;
	return (
		<>
			<h2>{content.title}</h2>
			<p>{content.summary}</p>
			<ArchitectureBrief content={content} footprint={footprint} />
		</>
	);
}

/* ----------------------------------------------------------------- chat */

interface Message {
	who: "bob" | "you" | "system";
	text: string;
	at?: string;
	note?: string;
	chip?: string;
}
function conversation(run: any, proposals: ArchitectureProposal[]): Message[] {
	const messages: Message[] = [];
	for (const p of proposals) {
		const content = p.content;
		if (!readable(content)) continue;
		const answers = open(content);
		messages.push({
			who: "bob",
			at: p.at,
			text:
				p.status === "routine"
					? `This looked routine, so I went ahead without asking. ${p.bypassReason ?? ""}`
					: p.version === 1
						? `Here’s my plan. ${answers ? `I need ${plural(answers, "answer")} from you.` : "Approve it when you’re happy with it."}`
						: `Version ${p.version} is ready. ${content.changes.length ? `I made ${plural(content.changes.length, "change")}.` : ""}`,
		});
		for (const f of p.feedback) {
			if (f.kind === "explanation")
				messages.push({ who: "bob", text: f.text, at: f.at });
			else {
				const [chip, ...rest] = f.text.startsWith("Answers:\n")
					? f.text.split("\n\n")
					: [undefined, f.text];
				messages.push({
					who: "you",
					text: rest.join("\n\n"),
					chip: chip
						?.replace(/^Answers:\n/, "")
						.split("\n")
						.map((line) => line.split(" → ").at(-1))
						.join(" · "),
					at: f.at,
					note:
						f.kind === "explain"
							? "asked a question"
							: f.kind === "revise"
								? "asked for changes"
								: "sent a message",
				});
			}
		}
		if (p.status === "accepted") {
			const accepted = (run.architectureDecisions ?? []).find(
				(d: any) => d.proposalId === p.id && d.decision === "accept",
			);
			messages.push({
				who: "system",
				text: `You approved version ${p.version}`,
				at: accepted?.at,
			});
		}
	}
	return messages;
}
const time = (at?: string) =>
	at
		? new Date(at).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			})
		: "";

function Chat({
	run,
	proposals,
	working,
}: {
	run: any;
	proposals: ArchitectureProposal[];
	working?: string;
}) {
	const messages = conversation(run, proposals);
	const end = useRef<HTMLDivElement>(null);
	const count = messages.length + (working ? 1 : 0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages only.
	useEffect(() => {
		end.current?.scrollIntoView({ block: "nearest" });
	}, [count]);
	return (
		<div className="arch-thread" aria-live="polite">
			{messages.map((m, i) =>
				m.who === "system" ? (
					<p key={i} className="arch-msg system">
						{m.text} · {time(m.at)}
					</p>
				) : (
					<div key={i} className={`arch-msg ${m.who}`}>
						<div className="arch-who">
							{m.who === "bob" ? "🤖 Bob" : "You"} · {time(m.at)}
							{m.note && ` · ${m.note}`}
						</div>
						<div className="arch-bubble">
							{m.chip && <span className="arch-chip">{m.chip}</span>}
							{m.text}
						</div>
					</div>
				),
			)}
			{working && (
				<div className="arch-msg bob">
					<div className="arch-who">🤖 Bob</div>
					<div className="arch-bubble arch-working">
						<span className="spinner" />
						{working}
					</div>
				</div>
			)}
			<div ref={end} />
		</div>
	);
}

/* ----------------------------------------------------------------- page */

export function ArchitecturePage() {
	const { id } = useParams();
	const query = useRun(id, "architecture");
	const run = query.data;
	const heading = useRef<HTMLHeadingElement>(null);
	const question = useRef<HTMLDivElement>(null);
	const hasRun = Boolean(run);
	useEffect(() => {
		if (hasRun) heading.current?.focus({ preventScroll: true });
	}, [hasRun]);
	const state = run ? architectureState(run) : undefined;
	const latest = state?.latest;
	const context = `${run?.id}/${latest?.id}/${latest?.digest}/${latest?.status}/${run?.status}`;
	const [draft, setDraft] = useFormState(context, "");
	const [picks, setPicks] = useFormState<Pick[]>(context, []);
	const [error, setError] = useFormState<string | undefined>(
		context,
		undefined,
	);
	const [viewing, setViewing] = useState<number>();
	const [tab, setTab] = useState<"proposal" | "chat">("proposal");
	const action = useAction(`architecture:${run?.id}`, context);
	const cache = useQueryClient();
	if (query.isLoading || run?.pendingContext)
		return <p role="status">Loading the proposal…</p>;
	if (!run || !state || !latest)
		return (
			<>
				<h1>No architecture proposal</h1>
				<Link className="back-link" to={id ? `/runs/${id}` : "/"}>
					← Back to the run
				</Link>
			</>
		);
	const { proposals, pending, answering, revising, stopped } = state;
	const shown = proposals.find((p) => p.version === viewing) ?? latest;
	const shownIndex = proposals.indexOf(shown);
	const content = shown.content;
	if (!readable(content))
		return (
			<>
				<h1 ref={heading} tabIndex={-1}>
					{run.title}
				</h1>
				<p>This proposal uses an older format. Ask Bob for a new version.</p>
			</>
		);
	const isLatest = shown === latest;
	const openCount = open(latest.content);
	const answeredAll =
		openCount > 0 &&
		latest.content.decisions
			.filter((d) => d.status === "open")
			.every((d) => picks.some((p) => p.decision === d.id));
	const pick = (next: Pick) =>
		setPicks((current) => [
			...current.filter((p) => p.decision !== next.decision),
			next,
		]);
	const answerText = () => {
		const lines = picks.map((p) => {
			const decision = latest.content.decisions.find(
				(d) => d.id === p.decision,
			);
			const option = decision?.options.find((o) => o.id === p.option);
			return `${decision?.question} → ${option?.name}`;
		});
		return [lines.length ? `Answers:\n${lines.join("\n")}` : "", draft.trim()]
			.filter(Boolean)
			.join("\n\n");
	};
	const submit = async (decision: "accept" | "revise" | "explain") => {
		if (decision === "accept" && !isLatest) return;
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
						: { feedback: decision === "revise" ? answerText() : draft }),
				},
			});
			setDraft("");
			setPicks([]);
			setError(undefined);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			void cache.invalidateQueries({ queryKey: ["run", run.id] });
		}
	};
	const hasDraft = draft.trim().length > 0 || picks.length > 0;
	const status =
		latest.status === "accepted"
			? ["review", "✓ Approved"]
			: latest.status === "routine"
				? ["quiet", "No approval needed"]
				: revising
					? ["working", `Bob is writing version ${latest.version + 1}`]
					: pending || answering
						? [
								"question",
								openCount ? "Waiting for you" : "Ready for your approval",
							]
						: fallbackStatus(latest.status);
	const blocker = !pending
		? revising
			? `Wait for version ${latest.version + 1}.`
			: answering
				? "Bob is answering your question."
				: undefined
		: openCount && !answeredAll
			? `Answer Bob’s ${openCount === 1 ? "question" : "questions"} first.`
			: hasDraft
				? "Send your message first."
				: undefined;
	const goToQuestion = () => {
		setTab("proposal");
		setViewing(undefined);
		requestAnimationFrame(() =>
			question.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
		);
	};
	return (
		<div className={`arch-page tab-${tab}`}>
			<nav className="review-links" aria-label="Proposal navigation">
				<Link to={`/runs/${run.id}`} state={{ focusRunId: run.id }}>
					← Back to the run
				</Link>
			</nav>
			<div className="arch-tabs" role="tablist">
				{(["proposal", "chat"] as const).map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						aria-selected={tab === t}
						onClick={() => setTab(t)}
					>
						{t === "proposal" ? "Proposal" : "Chat"}
					</button>
				))}
			</div>
			<div className="arch-layout">
				<main className="arch-main" aria-label="Architecture proposal">
					{revising && (
						<p className="arch-banner working" role="status">
							<span className="spinner" />
							<span>
								<b>Bob is writing version {latest.version + 1}</b> from your
								message. You can approve once it’s ready.
							</span>
						</p>
					)}
					{latest.status === "accepted" && isLatest && (
						<p className="arch-banner done">
							✓ <b>You approved version {latest.version}.</b> This page is
							read-only now.
						</p>
					)}
					{latest.status === "routine" && (
						<p className="arch-banner quiet">
							{latest.continuation
								? "Independent review confirmed this revision stays within your approved architecture."
								: "Bob treated this as routine, so no approval was needed."}{" "}
							{latest.bypassReason}
						</p>
					)}
					{!isLatest && (
						<p className="arch-banner quiet">
							You’re looking at version {shown.version}. It was replaced by a
							newer version.{" "}
							<button
								type="button"
								className="arch-link-button"
								onClick={() => setViewing(undefined)}
							>
								Back to version {latest.version}
							</button>
						</p>
					)}
					<div className={revising ? "arch-faded" : undefined}>
						<header className="arch-chunk">
							<div className="arch-meta">
								<span className={`chip ${status[0]}`}>{status[1]}</span>
								<span>Architecture proposal · version {shown.version}</span>
								{proposals.length > 1 && (
									<span className="arch-versions">
										{proposals.map((p) => (
											<button
												key={p.id}
												type="button"
												aria-pressed={p === shown}
												onClick={() =>
													setViewing(p === latest ? undefined : p.version)
												}
											>
												v{p.version}
											</button>
										))}
									</span>
								)}
							</div>
							<h1 ref={heading} tabIndex={-1} className="arch-title">
								{content.title}
							</h1>
							<p className="arch-summary">{content.summary}</p>
							{isLatest && pending && openCount > 0 && (
								<div className="arch-ask">
									<span>
										✋ <b>Bob needs {plural(openCount, "answer")} from you</b>{" "}
										before you can approve.
									</span>
									<button type="button" onClick={goToQuestion}>
										Go to question
									</button>
								</div>
							)}
						</header>
						<ArchitectureBrief
							key={shown.id}
							content={content}
							footprint={shown.footprint}
							previous={
								shownIndex > 0 && readable(proposals[shownIndex - 1]!.content)
									? proposals[shownIndex - 1]!.content
									: undefined
							}
							picks={isLatest ? picks : []}
							onPick={isLatest && pending ? pick : undefined}
							focusQuestion={question}
						/>
					</div>
				</main>
				<div className="arch-rail">
					<aside className="arch-side" aria-label="Chat with Bob">
						<h2>Chat with Bob</h2>
						<Chat
							run={run}
							proposals={proposals}
							working={
								revising
									? `Writing version ${latest.version + 1}…`
									: answering
										? "Answering your question…"
										: undefined
							}
						/>
						{pending ? (
							<div className="arch-composer">
								{picks.length > 0 && (
									<div className="arch-picks">
										{picks.map((p) => {
											const decision = latest.content.decisions.find(
												(d) => d.id === p.decision,
											);
											return (
												<button
													key={p.decision}
													type="button"
													className="arch-chip"
													title="Remove"
													onClick={() => setPicks(picks.filter((x) => x !== p))}
												>
													{
														decision?.options.find((o) => o.id === p.option)
															?.name
													}{" "}
													✕
												</button>
											);
										})}
									</div>
								)}
								<textarea
									aria-label="Message to Bob"
									placeholder="Write to Bob…"
									value={draft}
									rows={3}
									onChange={(e) => setDraft(e.target.value)}
								/>
								<div className="arch-composer-buttons">
									<Button
										requiresConnection
										variant="secondary"
										disabled={action.isPending || !draft.trim()}
										onClick={() => void submit("explain")}
									>
										Ask a question
									</Button>
									<Button
										requiresConnection
										variant="secondary"
										disabled={action.isPending || !hasDraft}
										onClick={() => void submit("revise")}
									>
										Ask for changes
									</Button>
								</div>
								<p className="arch-hint">
									A question keeps this version. Changes make a new one.
								</p>
							</div>
						) : (
							<p className="arch-hint arch-composer">
								{latest.status === "accepted"
									? "The approved plan can’t change anymore."
									: latest.status === "routine"
										? "Nothing to approve here."
										: "You can write again when Bob is done."}
							</p>
						)}
					</aside>
					<div className="arch-approve">
						{latest.status === "accepted" ? (
							<p className="arch-done">
								<b>✓ Approved</b>
								Bob is building version {latest.version}. You’ll review the PR
								at the end.
							</p>
						) : stopped ? (
							<Button
								requiresConnection
								disabled={action.isPending}
								onClick={() =>
									void action
										.mutateAsync({ path: `/api/runs/${run.id}/retry` })
										.catch((e) => setError(String(e)))
								}
							>
								Resume the discussion
							</Button>
						) : latest.status !== "routine" ? (
							<>
								{blocker ? (
									<p className="arch-blocker">
										{openCount && !answeredAll && pending ? (
											<button type="button" onClick={goToQuestion}>
												{blocker}
											</button>
										) : (
											blocker
										)}
									</p>
								) : (
									<p className="arch-hint">
										Bob builds exactly this plan. You’ll still review the PR.
									</p>
								)}
								<Button
									requiresConnection
									className="arch-approve-button"
									disabled={
										!isLatest || !pending || !!blocker || action.isPending
									}
									onClick={() => void submit("accept")}
								>
									Approve version {latest.version}
								</Button>
							</>
						) : null}
						{error && (
							<p className="error" role="alert">
								{error}
							</p>
						)}
					</div>
				</div>
			</div>
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
					? `Architecture continues your approval of version ${latest.continuation.version}.`
					: "Architecture check: routine, no approval needed."}{" "}
				<Link to={to}>See what Bob checked</Link>
			</p>
		);
	const openCount = open(latest.content);
	const [chip, label] =
		latest.status === "accepted"
			? ["review", "✓ Approved"]
			: revising
				? ["working", `Bob is writing version ${latest.version + 1}`]
				: pending || answering
					? ["question", "Waiting for you"]
					: fallbackStatus(latest.status);
	return (
		<section className="arch-entry" aria-label="Architecture proposal">
			<div className="arch-meta">
				<span className={`chip ${chip}`}>{label}</span>
				<span>Architecture proposal · version {latest.version}</span>
			</div>
			<h2>{latest.content.title}</h2>
			<p>{latest.content.summary}</p>
			{pending && openCount > 0 && (
				<p className="arch-entry-ask">
					✋ Bob needs {plural(openCount, "answer")} from you.
				</p>
			)}
			<Link className={`button ${pending ? "primary" : "secondary"}`} to={to}>
				{pending ? "Open proposal" : "View proposal"}
			</Link>
		</section>
	);
}
