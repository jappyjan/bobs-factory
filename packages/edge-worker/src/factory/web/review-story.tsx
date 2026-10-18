import { type ReactNode, type TouchEvent, useRef } from "react";
import type {
	BriefProof,
	BriefStory,
	ReviewBrief,
	StorySlide,
} from "../ReviewBrief";
import { useRestorableState } from "./restoration";
import { Button } from "./ui";

const STATE = {
	done: { icon: "✓", label: "Done" },
	partly: { icon: "◐", label: "Partly" },
	open: { icon: "○", label: "Open" },
};

type Slide = { key: string; render: () => ReactNode };

/**
 * Show & tell: Bob presents the change one idea at a time, like a colleague at
 * your desk. Bob's slides come first; your decisions, limits and side effects are
 * drawn from the brief so they never drift from the evidence below.
 */
export function StoryDeck({
	brief,
	story,
	storageKey,
	readiness,
	proof,
	judge,
	onEvidence,
	onDecide,
}: {
	brief: ReviewBrief;
	story: BriefStory;
	storageKey: string;
	readiness: string;
	proof: (value: BriefProof) => ReactNode;
	judge: (index: number) => ReactNode;
	onEvidence: () => void;
	onDecide: () => void;
}) {
	const slides: Slide[] = [
		{
			key: "intro",
			render: () => (
				<>
					<p className="story-byline">
						<span aria-hidden="true">B</span> Bob · about{" "}
						{Math.max(1, Math.round((story.slides.length + 3) * 0.4))} minutes
					</p>
					<h2 className="story-title">{story.title}</h2>
					<p className="story-say">{story.summary}</p>
					{story.stats.length > 0 && <Stats stats={story.stats} />}
					<p className={`story-readiness ${brief.verdict.readiness}`}>
						{readiness}
					</p>
				</>
			),
		},
	];
	if (brief.sinceLastReview) {
		const since = brief.sinceLastReview;
		slides.push({
			key: "since",
			render: () => (
				<>
					<SlideHead title="Since your last review" say={since.summary} />
					<ul className="story-points">
						{since.changes.map((c) => (
							<li key={c.what}>
								<span aria-hidden="true">↻</span>
								<p>{c.what}</p>
							</li>
						))}
					</ul>
				</>
			),
		});
	}
	for (const [i, slide] of story.slides.entries())
		slides.push({
			key: `slide-${i}`,
			render: () => <AuthoredSlide slide={slide} proof={proof} />,
		});
	if (brief.yourCall.length)
		slides.push({
			key: "calls",
			render: () => (
				<>
					<SlideHead
						title={`I need you on ${brief.yourCall.length === 1 ? "one thing" : `${brief.yourCall.length} things`}`}
						say="These are judgment calls. I made a choice so the work could continue; tell me if it’s wrong."
					/>
					<ol className="story-calls">
						{brief.yourCall.map((c, i) => (
							<li key={c.question}>
								<strong>{c.question}</strong>
								<p>{c.context}</p>
								<p className="story-bob">
									<span>I chose:</span> {c.bobChose}
								</p>
								{judge(i)}
							</li>
						))}
					</ol>
				</>
			),
		});
	if (brief.notVerified.length)
		slides.push({
			key: "limits",
			render: () => (
				<>
					<SlideHead
						title="What I couldn’t prove"
						say="Be aware of these before you approve. Everything else is backed by the evidence below."
					/>
					<ul className="story-points">
						{brief.notVerified.map((n) => (
							<li key={n.what}>
								<span aria-hidden="true">○</span>
								<p>
									<strong>{n.what}</strong>
									<small>{n.why}</small>
								</p>
							</li>
						))}
					</ul>
				</>
			),
		});
	if (brief.beyondAsk.length || brief.noticed?.length)
		slides.push({
			key: "beyond",
			render: () => (
				<>
					<SlideHead title="Also touched along the way" />
					<ul className="story-points">
						{brief.beyondAsk.map((b) => (
							<li key={b.what}>
								<span aria-hidden="true">
									{b.attention === "look" ? "👀" : "·"}
								</span>
								<p>
									<strong>{b.what}</strong>{" "}
									{b.attention === "look" && (
										<span className="story-tag">worth a look</span>
									)}
									<small>{b.why}</small>
								</p>
							</li>
						))}
						{brief.noticed?.map((n) => (
							<li key={n}>
								<span aria-hidden="true">🔎</span>
								<p>
									<small>Already there before, left alone: {n}</small>
								</p>
							</li>
						))}
					</ul>
				</>
			),
		});
	slides.push({
		key: "end",
		render: () => (
			<>
				<SlideHead
					title="That’s it from me"
					say={`${readiness}. The evidence for every claim is below, line by line.`}
				/>
				<div className="story-end">
					<Button onClick={onDecide}>Decide</Button>
					<Button variant="secondary" onClick={onEvidence}>
						Check the evidence
					</Button>
				</div>
			</>
		),
	});

	const [stored, setIndex] = useRestorableState(
		`review/story/${storageKey}`,
		0,
	);
	const index = Math.min(stored, slides.length - 1);
	const go = (to: number) =>
		setIndex(Math.max(0, Math.min(slides.length - 1, to)));
	const touch = useRef<number | undefined>(undefined);
	const current = slides[index]!;
	return (
		<section
			className="story"
			aria-roledescription="presentation"
			aria-label="Show and tell"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move between slides
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "ArrowRight") go(index + 1);
				if (e.key === "ArrowLeft") go(index - 1);
			}}
		>
			<div className="story-bars">
				{slides.map((s, i) => (
					<button
						type="button"
						key={s.key}
						className={i <= index ? "on" : ""}
						aria-label={`Slide ${i + 1} of ${slides.length}`}
						aria-current={i === index ? "step" : undefined}
						onClick={() => go(i)}
					/>
				))}
			</div>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: taps and swipes mirror the Back/Next buttons */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the deck handles arrow keys */}
			<div
				key={current.key}
				className="story-slide"
				aria-live="polite"
				onClick={(e) => {
					if (
						(e.target as HTMLElement).closest(
							"button, a, input, textarea, summary, img, video, details, fieldset",
						)
					)
						return;
					const box = e.currentTarget.getBoundingClientRect();
					go(index + (e.clientX - box.left < box.width / 3 ? -1 : 1));
				}}
				onTouchStart={(e: TouchEvent) => {
					touch.current = e.touches[0]?.clientX;
				}}
				onTouchEnd={(e: TouchEvent) => {
					const start = touch.current;
					touch.current = undefined;
					const end = e.changedTouches[0]?.clientX;
					if (start === undefined || end === undefined) return;
					if (Math.abs(end - start) > 50) go(index + (end < start ? 1 : -1));
				}}
			>
				{current.render()}
			</div>
			<nav className="story-nav" aria-label="Slides">
				<Button
					variant="secondary"
					disabled={index === 0}
					onClick={() => go(index - 1)}
				>
					← Back
				</Button>
				<span className="muted">
					{index + 1} / {slides.length}
				</span>
				<Button
					disabled={index === slides.length - 1}
					onClick={() => go(index + 1)}
				>
					Next →
				</Button>
			</nav>
		</section>
	);
}

function SlideHead({ title, say }: { title: string; say?: string }) {
	return (
		<>
			<h3 className="story-title">{title}</h3>
			{say && <p className="story-say">{say}</p>}
		</>
	);
}

function Stats({ stats }: { stats: BriefStory["stats"] }) {
	return (
		<dl className="story-stats">
			{stats.map((s) => (
				<div key={s.label}>
					<dt>{s.label}</dt>
					<dd>{s.value}</dd>
				</div>
			))}
		</dl>
	);
}

function AuthoredSlide({
	slide,
	proof,
}: {
	slide: StorySlide;
	proof: (value: BriefProof) => ReactNode;
}) {
	const head = <SlideHead title={slide.title} say={slide.say} />;
	switch (slide.kind) {
		case "checklist":
			return (
				<>
					{head}
					<ul className="story-checklist">
						{slide.items.map((item) => (
							<li key={item.label} className={`state-${item.state}`}>
								<span role="img" aria-label={STATE[item.state].label}>
									{STATE[item.state].icon}
								</span>
								<p>
									<strong>{item.label}</strong>
									{item.detail && <small>{item.detail}</small>}
								</p>
							</li>
						))}
					</ul>
				</>
			);
		case "beforeAfter":
			return (
				<>
					{head}
					<div className="story-flow">
						<Pipeline label="Before" nodes={slide.before} />
						<Pipeline label="Now" nodes={slide.after} />
					</div>
					{slide.note && <p className="story-note">{slide.note}</p>}
				</>
			);
		case "chart": {
			const values = slide.bars.map((b) => b.value);
			const max = Math.max(...values),
				min = Math.min(...values);
			const width = (value: number) =>
				slide.scale === "log" && max > min
					? 8 + (92 * Math.log(value / min)) / Math.log(max / min)
					: Math.max(4, (100 * value) / max);
			return (
				<>
					{head}
					<ul className="story-chart">
						{slide.bars.map((bar) => (
							<li key={bar.label} className={`mark-${bar.mark ?? "neutral"}`}>
								<p>
									<span>{bar.label}</span>
									<strong>{bar.display}</strong>
								</p>
								<span className="story-track">
									<i style={{ width: `${width(bar.value)}%` }} />
								</span>
								{bar.detail && <small>{bar.detail}</small>}
							</li>
						))}
					</ul>
					{slide.stats?.length ? <Stats stats={slide.stats} /> : null}
					<p className="story-note">
						{slide.method}
						{slide.scale === "log" ? " Bars use a log scale." : ""}
					</p>
				</>
			);
		}
		case "screens":
			return (
				<>
					{head}
					{proof({ kind: "screens", shots: slide.shots })}
				</>
			);
		case "video":
			return (
				<>
					{head}
					{proof({
						kind: "video",
						taskId: slide.taskId,
						sha256: slide.sha256,
						label: slide.label,
					})}
				</>
			);
		case "points":
			return (
				<>
					{head}
					<ul className="story-points">
						{slide.items.map((item) => (
							<li key={item.title}>
								<span aria-hidden="true">{item.icon}</span>
								<p>
									<strong>{item.title}</strong>
									{item.detail && <small>{item.detail}</small>}
								</p>
							</li>
						))}
					</ul>
				</>
			);
	}
}

function Pipeline({
	label,
	nodes,
}: {
	label: string;
	nodes: Extract<StorySlide, { kind: "beforeAfter" }>["after"];
}) {
	return (
		<div className="story-pipe">
			<p className="story-pipe-label">{label}</p>
			<ol>
				{nodes.map((node, i) => (
					<li key={`${node.label}-${i}`}>
						<div className={`story-node ${node.change ?? ""}`}>
							<strong>{node.label}</strong>
							{node.detail && <small>{node.detail}</small>}
						</div>
						{node.fallout && <p className="story-fallout">{node.fallout}</p>}
					</li>
				))}
			</ol>
		</div>
	);
}
