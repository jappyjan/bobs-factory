import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ViewSnapshot } from "../HumanStep";
import {
	type ResolvedView,
	ResolvedViewSchema,
	viewText,
	viewUrlSchema,
} from "../View";
import { useAction } from "./client";
import { videoUrl } from "./media";

export type ViewFields = Record<string, string | boolean>;
type Component = ResolvedView["components"][number];

/** Markdown has no remote images, raw HTML, relative navigation or executable URLs. */
export function viewLink(value: string | undefined) {
	const parsed = viewUrlSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export function ViewMarkdown({ text }: { text: string }) {
	return (
		<div className="dv-markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				skipHtml
				urlTransform={(url) => viewLink(url) ?? ""}
				components={{
					a: ({ href, children }) =>
						viewLink(href) ? (
							<a
								href={viewLink(href)}
								target="_blank"
								rel="noreferrer noopener"
							>
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ alt }) => (
						<span className="dv-media-placeholder">
							{alt ? `Image: ${alt}` : "Image omitted"}
						</span>
					),
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

function DetailFields({
	fields,
}: {
	fields?: { label: string; value: string }[];
}) {
	if (!fields?.length) return null;
	return (
		<details className="dv-details">
			<summary>
				Details <span className="muted">({fields.length})</span>
			</summary>
			<dl>
				{fields.map((field, index) => (
					<div key={index}>
						<dt>{field.label}</dt>
						<dd>{field.value}</dd>
					</div>
				))}
			</dl>
		</details>
	);
}

function ViewComponent({
	component,
	runId,
	fields,
	onFieldChange,
	disabled,
}: {
	component: Component;
	runId?: string;
	fields: ViewFields;
	onFieldChange?: (id: string, value: string | boolean) => void;
	disabled: boolean;
}) {
	const formId = useId();
	switch (component.type) {
		case "questions":
			return (
				<pre className="dv-rich-fallback">
					{viewText({ version: "view-v1", components: [component] })}
				</pre>
			);
		case "checkin-section":
		case "review-guide":
			return <pre className="dv-rich-fallback">{component.data.text}</pre>;
		case "markdown":
			return <ViewMarkdown text={component.data.text} />;
		case "checklist":
			return (
				<ul className="dv-checklist">
					{component.data.items.map((item, index) => (
						<li key={index} data-state={item.state}>
							<span className="dv-state" role="img" aria-label={item.state}>
								{item.state === "done"
									? "✓"
									: item.state === "partly"
										? "◐"
										: "○"}
							</span>
							<div>
								<strong>{item.label}</strong>
								{item.detail && <p>{item.detail}</p>}
							</div>
						</li>
					))}
				</ul>
			);
		case "beforeAfter":
			return (
				<>
					<div className="dv-before-after">
						<section>
							<h4>Before</h4>
							<ViewMarkdown text={component.data.before} />
						</section>
						<section>
							<h4>After</h4>
							<ViewMarkdown text={component.data.after} />
						</section>
					</div>
					{component.data.note && (
						<p className="muted">{component.data.note}</p>
					)}
				</>
			);
		case "chart": {
			const data = component.data;
			const max = Math.max(
				1,
				...data.series.map((series) => Math.abs(series.value)),
			);
			return (
				<figure className="dv-chart">
					<figcaption>
						{data.kind === "line" ? "Trend" : "Comparison"}
						{data.unit ? ` · ${data.unit}` : ""}
					</figcaption>
					<ol>
						{data.series.map((series, index) => (
							<li key={index}>
								<span>{series.label}</span>
								<span className="dv-chart-track" aria-hidden="true">
									<span
										style={{
											width: `${(Math.abs(series.value) / max) * 100}%`,
										}}
									/>
								</span>
								<strong>
									{series.value}
									{data.unit ? ` ${data.unit}` : ""}
								</strong>
							</li>
						))}
					</ol>
					{data.kind === "line" && (
						<svg
							viewBox="0 0 300 85"
							role="img"
							aria-label={`Trend: ${data.series.map((series) => `${series.label} ${series.value}`).join(", ")}`}
						>
							<polyline
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								points={data.series
									.map(
										(series, index) =>
											`${10 + (index / Math.max(1, data.series.length - 1)) * 280},${42 - (series.value / max) * 32}`,
									)
									.join(" ")}
							/>
						</svg>
					)}
				</figure>
			);
		}
		case "screenshots":
			return (
				<div className="dv-screenshots">
					{component.data.items.map((shot, index) => (
						<figure key={index}>
							{runId ? (
								<a
									href={`/api/runs/${encodeURIComponent(runId)}/view-screenshots/${shot.index}?v=${encodeURIComponent(shot.sha256)}`}
									target="_blank"
									rel="noreferrer noopener"
									aria-label={`Open screenshot: ${shot.alt}`}
								>
									<img
										src={`/api/runs/${encodeURIComponent(runId)}/view-screenshots/${shot.index}?v=${encodeURIComponent(shot.sha256)}`}
										alt={shot.alt}
										loading="lazy"
										decoding="async"
									/>
								</a>
							) : (
								<p className="dv-media-placeholder">Screenshot: {shot.alt}</p>
							)}
							<figcaption>{shot.caption ?? shot.alt}</figcaption>
						</figure>
					))}
				</div>
			);
		case "video":
			return (
				<figure className="dv-video">
					<figcaption>{component.data.label}</figcaption>
					{runId ? (
						// biome-ignore lint/a11y/useMediaCaption: Every view video requires the adjacent complete text transcript; a view cannot assert that the protected inventory has a captions file.
						<video
							controls
							playsInline
							preload="none"
							aria-label={component.data.label}
							src={videoUrl(runId, component.data)}
						>
							Read the recording transcript below.
						</video>
					) : (
						<p className="dv-media-placeholder">Video available in the run.</p>
					)}
					<details>
						<summary>Recording transcript</summary>
						<p className="dv-prewrap">{component.data.transcript}</p>
					</details>
				</figure>
			);
		case "table":
			return (
				<div className="dv-table">
					<table>
						<caption className="sr-only">
							{component.title ?? "Data table"}
						</caption>
						<thead>
							<tr>
								{component.data.columns.map((column, index) => (
									<th scope="col" key={index}>
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{component.data.rows.map((row, index) => (
								<tr key={index}>
									{row.map((cell, column) => (
										<td
											key={column}
											data-label={component.data.columns[column]}
										>
											{cell === null ? "—" : String(cell)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "code":
			return (
				<figure className="dv-code">
					<figcaption>
						<code>{component.data.file}</code>
						{component.data.startLine && `:${component.data.startLine}`}
						{component.data.endLine && `–${component.data.endLine}`}
						{component.data.language && (
							<span className="chip">{component.data.language}</span>
						)}
					</figcaption>
					{component.data.excerpt ? (
						<pre>
							<code>{component.data.excerpt}</code>
						</pre>
					) : (
						<p className="muted">Code reference in this run’s repository.</p>
					)}
				</figure>
			);
		case "steps":
			return (
				<ol className="dv-steps">
					{component.data.items.map((item, index) => (
						<li key={index} data-status={item.status ?? "pending"}>
							<span className="dv-step-number" aria-hidden="true">
								{index + 1}
							</span>
							<div>
								<strong>{item.label}</strong>
								{item.status && <span className="chip">{item.status}</span>}
								{item.detail && <p>{item.detail}</p>}
							</div>
						</li>
					))}
				</ol>
			);
		case "points":
			return (
				<ul className="dv-points">
					{component.data.items.map((item, index) => (
						<li key={index}>
							<strong>
								{item.url && viewLink(item.url) ? (
									<a
										href={viewLink(item.url)}
										target="_blank"
										rel="noreferrer noopener"
									>
										{item.label} ↗
									</a>
								) : (
									item.label
								)}
							</strong>
							{item.detail && <p>{item.detail}</p>}
						</li>
					))}
				</ul>
			);
		case "itemCards":
			return (
				<div className="dv-items">
					{component.data.items.map((item) => (
						<article className="dv-item-card" key={item.id}>
							<h4>{item.title}</h4>
							{item.body && <ViewMarkdown text={item.body} />}
							<DetailFields fields={item.details} />
						</article>
					))}
				</div>
			);
		case "choices":
			return (
				<div className="dv-form-fields">
					{component.data.fields.map((field) => {
						const id = `${formId}-${component.id}-${field.id}`;
						const value = fields[field.id] ?? field.value;
						return (
							<label
								className={
									field.type === "checkbox" ? "dv-checkbox" : "dv-field"
								}
								key={field.id}
								htmlFor={id}
							>
								{field.type === "checkbox" ? (
									<>
										<input
											id={id}
											name={field.id}
											type="checkbox"
											checked={value === true}
											required={field.required}
											disabled={disabled || !onFieldChange}
											onChange={(event) =>
												onFieldChange?.(field.id, event.target.checked)
											}
										/>
										<span>
											{field.label}
											{field.required ? " (required)" : ""}
										</span>
									</>
								) : (
									<>
										<span>
											{field.label}
											{field.required ? " (required)" : ""}
										</span>
										{field.type === "textarea" ? (
											<textarea
												id={id}
												name={field.id}
												value={typeof value === "string" ? value : ""}
												required={field.required}
												disabled={disabled || !onFieldChange}
												onChange={(event) =>
													onFieldChange?.(field.id, event.target.value)
												}
											/>
										) : field.type === "select" ? (
											<select
												id={id}
												name={field.id}
												value={typeof value === "string" ? value : ""}
												required={field.required}
												disabled={disabled || !onFieldChange}
												onChange={(event) =>
													onFieldChange?.(field.id, event.target.value)
												}
											>
												<option value="">Choose…</option>
												{field.options?.map((option) => (
													<option key={option.id} value={option.id}>
														{option.label}
													</option>
												))}
											</select>
										) : (
											<input
												id={id}
												name={field.id}
												value={typeof value === "string" ? value : ""}
												required={field.required}
												disabled={disabled || !onFieldChange}
												onChange={(event) =>
													onFieldChange?.(field.id, event.target.value)
												}
											/>
										)}
									</>
								)}
							</label>
						);
					})}
				</div>
			);
		case "runList":
			return (
				<div className="dv-run-list">
					{component.data.waves.map((wave, waveIndex) => (
						<section
							className="dv-run-wave"
							key={wave.id}
							aria-label={wave.label ?? `Wave ${waveIndex + 1}`}
						>
							<h4>
								<span className="dv-step-number">{waveIndex + 1}</span>
								{wave.label ?? `Wave ${waveIndex + 1}`}
							</h4>
							<ol>
								{wave.runs.map((run) => (
									<li key={run.id} data-status={run.status}>
										<div>
											<strong>
												<a href={`/#/runs/${encodeURIComponent(run.id)}`}>
													{run.title}
												</a>
											</strong>
											<span className="chip dv-run-status">{run.status}</span>
										</div>
										{run.note && <p>{run.note}</p>}
									</li>
								))}
							</ol>
						</section>
					))}
				</div>
			);
		case "decisionBar":
			return (
				<aside
					className="dv-decision-bar dv-view-decision"
					aria-label="Decision summary"
				>
					{component.data.summary && <p>{component.data.summary}</p>}
					<ul aria-label="Available recipe actions">
						{component.data.actions.map((action) => (
							<li className="chip" key={action.id}>
								{action.label}
							</li>
						))}
					</ul>
				</aside>
			);
	}
}

/** Revalidate at the rendering boundary, including API/agent-supplied resolved data. */
export function DeclarativeView({
	view,
	renderComponent,
	runId,
	fields = {},
	onFieldChange,
	disabled = false,
}: {
	view: ResolvedView;
	renderComponent?: (component: Component) => ReactNode | undefined;
	runId?: string;
	fields?: ViewFields;
	onFieldChange?: (id: string, value: string | boolean) => void;
	disabled?: boolean;
}) {
	let checked: ResolvedView;
	try {
		checked = ResolvedViewSchema.parse(view);
	} catch (error) {
		return (
			<p className="error" role="alert">
				This view cannot be displayed:{" "}
				{error instanceof Error ? error.message : "Invalid view"}
			</p>
		);
	}
	return (
		<div className="declarative-view">
			{checked.components.map((component) => (
				<section
					key={component.id}
					className={`dv-component dv-${component.type}`}
					aria-label={component.title ?? component.type}
				>
					{component.title && <h3>{component.title}</h3>}
					{renderComponent?.(component) ?? (
						<ViewComponent
							component={component}
							runId={runId}
							fields={fields}
							onFieldChange={onFieldChange}
							disabled={disabled}
						/>
					)}
				</section>
			))}
		</div>
	);
}

export type HumanStepSnapshot = ViewSnapshot;
export type HumanStepAnswer = {
	batchId: string;
	digest: string;
	accepted: true;
	choices?: { itemId: string; action: string; comment?: string }[];
	fields?: ViewFields;
	approved?: boolean;
	feedback?: string;
};
export type HumanStepAsk = {
	batchId: string;
	digest: string;
	itemId: string;
	question: string;
	requestId: string;
};

export function HumanStepPanel({
	runId,
	snapshot,
	onSubmit,
	onAsk,
	disabled = false,
}: {
	runId: string;
	snapshot: HumanStepSnapshot;
	onSubmit?: (answer: HumanStepAnswer) => Promise<unknown>;
	onAsk?: (request: HumanStepAsk) => Promise<unknown>;
	disabled?: boolean;
}) {
	const mutation = useAction(`view/${runId}/${snapshot.id}`, snapshot.digest);
	return (
		<HumanStepDecision
			key={snapshot.id}
			runId={runId}
			snapshot={snapshot}
			blocked={disabled || mutation.isBlocked}
			onSubmit={
				onSubmit ??
				((body) =>
					mutation.mutateAsync({
						path: `/api/runs/${encodeURIComponent(runId)}/view-answer`,
						body,
					}))
			}
			onAsk={
				onAsk ??
				((body) =>
					mutation.mutateAsync({
						path: `/api/runs/${encodeURIComponent(runId)}/view-ask`,
						body,
					}))
			}
		/>
	);
}

/** Presentational screen also used by builder and focused renderer verification. */
export function HumanStepDecision({
	runId,
	snapshot,
	onSubmit,
	onAsk,
	blocked = false,
}: {
	runId: string;
	snapshot: HumanStepSnapshot;
	onSubmit: (answer: HumanStepAnswer) => Promise<unknown>;
	onAsk?: (request: HumanStepAsk) => Promise<unknown>;
	blocked?: boolean;
}) {
	const view = ResolvedViewSchema.safeParse(snapshot.view);
	if (!view.success)
		return (
			<p className="error" role="alert">
				This decision cannot be displayed: {view.error.message}
			</p>
		);
	return (
		<HumanStepDecisionForm
			key={`${snapshot.id}:${snapshot.answer !== undefined}`}
			runId={runId}
			snapshot={{ ...snapshot, view: view.data }}
			onSubmit={onSubmit}
			onAsk={onAsk}
			blocked={blocked}
		/>
	);
}

function HumanStepDecisionForm({
	runId,
	snapshot,
	onSubmit,
	onAsk,
	blocked,
}: {
	runId: string;
	snapshot: HumanStepSnapshot;
	onSubmit: (answer: HumanStepAnswer) => Promise<unknown>;
	onAsk?: (request: HumanStepAsk) => Promise<unknown>;
	blocked: boolean;
}) {
	const answer =
		snapshot.answer && typeof snapshot.answer === "object"
			? (snapshot.answer as Partial<HumanStepAnswer>)
			: undefined;
	const [choices, setChoices] = useState<
		Record<string, { action: string; comments: Record<string, string> }>
	>(() =>
		Object.fromEntries(
			(answer?.choices ?? []).map((choice) => [
				choice.itemId,
				{
					action: choice.action,
					comments: { [choice.action]: choice.comment ?? "" },
				},
			]),
		),
	);
	const [fields, setFields] = useState<ViewFields>(() => ({
		...Object.fromEntries(
			snapshot.view.components.flatMap((component) =>
				component.type === "choices"
					? component.data.fields.map((field) => [
							field.id,
							field.value ?? (field.type === "checkbox" ? false : ""),
						])
					: [],
			),
		),
		...answer?.fields,
	}));
	const [feedback, setFeedback] = useState(answer?.feedback ?? "");
	const [acceptedDigest, setAcceptedDigest] = useState<string>();
	const accepted = acceptedDigest === snapshot.digest;
	const [busy, setBusy] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState("");
	const errorRef = useRef<HTMLParagraphElement>(null);
	const formId = useId();
	const decided = snapshot.answer !== undefined || submitted;
	const locked = decided || busy || blocked;
	const items = snapshot.items ?? [];
	const selected = items.filter((item) => choices[item.id]?.action).length;
	const submit = async (approved?: boolean) => {
		if (locked || snapshot.kind === "show") return;
		if (!accepted) {
			setError(
				"Confirm that you reviewed the displayed content before submitting.",
			);
			return;
		}
		if (snapshot.kind === "decide" && selected !== items.length) {
			setError("Choose an action for every item.");
			return;
		}
		if (approved === false && !feedback.trim()) {
			setError("Describe the changes you are requesting.");
			return;
		}
		setError("");
		setBusy(true);
		try {
			await onSubmit({
				batchId: snapshot.id,
				digest: snapshot.digest,
				accepted: true,
				fields,
				...(snapshot.kind === "approve"
					? { approved, feedback }
					: {
							choices: items.map((item) => {
								const choice = choices[item.id]!;
								const comment = choice.comments[choice.action];
								return {
									itemId: item.id,
									action: choice.action,
									...(comment ? { comment } : {}),
								};
							}),
						}),
			});
			setSubmitted(true);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The answer could not be saved. Refresh and try again.",
			);
			requestAnimationFrame(() => errorRef.current?.focus());
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="human-step-panel" aria-labelledby={`${formId}-title`}>
			<header className="dv-human-heading">
				<span className="dv-eyebrow">
					{snapshot.kind === "decide"
						? "Your decisions"
						: snapshot.kind === "approve"
							? "Your approval"
							: "Run update"}
				</span>
				<h2 id={`${formId}-title`}>{snapshot.title}</h2>
				{snapshot.kind !== "show" && (
					<p className="muted">
						{decided
							? "Your answer is retained for this exact content."
							: "Review the content below. Your answer applies to this displayed version."}
					</p>
				)}
			</header>
			<form
				onSubmit={(event: FormEvent<HTMLFormElement>) => {
					event.preventDefault();
					void submit(snapshot.kind === "approve" ? true : undefined);
				}}
			>
				<DeclarativeView
					view={snapshot.view}
					runId={runId}
					fields={fields}
					onFieldChange={
						snapshot.kind === "show"
							? undefined
							: (id, value) =>
									setFields((previous) => ({ ...previous, [id]: value }))
					}
					disabled={locked}
				/>
				{snapshot.kind === "decide" && (
					<div className="dv-items">
						{items.map((item, index) => {
							const choice = choices[item.id];
							return (
								<article className="dv-item-card" key={item.id}>
									<div className="dv-item-heading">
										<span className="dv-step-number" aria-hidden="true">
											{index + 1}
										</span>
										<h3>{item.title}</h3>
										{choice?.action && (
											<span className="chip">
												{
													snapshot.actions?.find(
														(action) => action.id === choice.action,
													)?.label
												}
											</span>
										)}
									</div>
									{item.body && <ViewMarkdown text={item.body} />}
									<DetailFields fields={item.details} />
									<fieldset disabled={locked}>
										<legend>Action for {item.title}</legend>
										<div className="dv-item-actions">
											{snapshot.actions?.map((action) => (
												<label
													key={action.id}
													className={`dv-action-option ${choice?.action === action.id ? "selected" : ""}`}
												>
													<input
														type="radio"
														name={`${formId}-${item.id}`}
														value={action.id}
														checked={choice?.action === action.id}
														onChange={() =>
															setChoices((previous) => ({
																...previous,
																[item.id]: {
																	action: action.id,
																	comments: previous[item.id]?.comments ?? {},
																},
															}))
														}
														required
													/>
													<span>{action.label}</span>
													{action.followUp && (
														<span className="dv-action-note">Follow-up</span>
													)}
												</label>
											))}
										</div>
										{choice?.action &&
											snapshot.actions?.find(
												(action) => action.id === choice.action,
											)?.comment && (
												<label className="dv-field">
													<span>
														Comment for{" "}
														{
															snapshot.actions.find(
																(action) => action.id === choice.action,
															)?.label
														}{" "}
														(optional)
													</span>
													<textarea
														value={choice.comments[choice.action] ?? ""}
														onChange={(event) =>
															setChoices((previous) => ({
																...previous,
																[item.id]: {
																	...previous[item.id]!,
																	comments: {
																		...previous[item.id]!.comments,
																		[choice.action]: event.target.value,
																	},
																},
															}))
														}
														maxLength={8000}
													/>
												</label>
											)}
									</fieldset>
									{(snapshot.askAvailable ||
										snapshot.threads?.[item.id]?.length) && (
										<AskThread
											runId={runId}
											snapshot={snapshot}
											itemId={item.id}
											disabled={locked || !snapshot.askAvailable}
											onAsk={onAsk}
										/>
									)}
								</article>
							);
						})}
					</div>
				)}
				{snapshot.kind === "approve" && (
					<label className="dv-field dv-approval-feedback">
						<span>Feedback / requested changes</span>
						<textarea
							value={feedback}
							onChange={(event) => setFeedback(event.target.value)}
							disabled={locked}
							maxLength={16000}
							placeholder="Describe the changes you need, or add an approval note."
						/>
					</label>
				)}
				{error && (
					<p className="error" role="alert" tabIndex={-1} ref={errorRef}>
						{error}
					</p>
				)}
				{snapshot.kind !== "show" && (
					<div className="dv-decision-bar">
						{decided ? (
							<p role="status">
								{snapshot.kind === "approve" && answer
									? answer.approved
										? "Approved. "
										: "Changes requested. "
									: "Decision saved. "}
								This content is read-only.
							</p>
						) : (
							<>
								<label className="dv-checkbox">
									<input
										type="checkbox"
										checked={accepted}
										onChange={(event) =>
											setAcceptedDigest(
												event.target.checked ? snapshot.digest : undefined,
											)
										}
										disabled={locked}
									/>
									<span>I reviewed this displayed content.</span>
								</label>
								<div className="dv-decision-actions">
									{snapshot.kind === "decide" ? (
										<>
											<span className="muted" role="status">
												{selected} of {items.length} decided
											</span>
											<button
												className="button"
												type="submit"
												disabled={
													locked || !accepted || selected !== items.length
												}
											>
												{busy ? "Saving…" : "Save decisions"}
											</button>
										</>
									) : (
										<>
											<button
												className="button secondary"
												type="button"
												onClick={() => void submit(false)}
												disabled={locked || !accepted || !feedback.trim()}
											>
												Request changes
											</button>
											<button
												className="button"
												type="submit"
												disabled={locked || !accepted}
											>
												{busy ? "Saving…" : "Approve"}
											</button>
										</>
									)}
								</div>
							</>
						)}
					</div>
				)}
			</form>
		</section>
	);
}

function AskThread({
	snapshot,
	itemId,
	disabled,
	onAsk,
}: {
	runId: string;
	snapshot: HumanStepSnapshot;
	itemId: string;
	disabled: boolean;
	onAsk?: (request: HumanStepAsk) => Promise<unknown>;
}) {
	const [question, setQuestion] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const request = useRef<{ question: string; id: string } | undefined>(
		undefined,
	);
	const send = async () => {
		if (busy || disabled || !question.trim() || !onAsk) return;
		if (request.current?.question !== question)
			request.current = { question, id: crypto.randomUUID() };
		setBusy(true);
		setError("");
		try {
			await onAsk({
				batchId: snapshot.id,
				digest: snapshot.digest,
				itemId,
				question,
				requestId: request.current.id,
			});
			setQuestion("");
			request.current = undefined;
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not send the question.",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<details className="dv-ask">
			<summary>
				Ask about this item
				{snapshot.threads?.[itemId]?.length
					? ` (${snapshot.threads[itemId]!.length})`
					: ""}
			</summary>
			<p className="muted">
				A dedicated follow-up answers here. Your source research and selected
				action stay intact.
			</p>
			<ol className="dv-thread" aria-label="Item questions">
				{snapshot.threads?.[itemId]?.map((thread) => (
					<li key={thread.id}>
						<p>
							<strong>You asked</strong> {thread.question}
						</p>
						{thread.answer ? (
							<ViewMarkdown text={thread.answer} />
						) : (
							<p role="status">
								{thread.status === "failed"
									? "The follow-up could not finish."
									: "Follow-up is working…"}
							</p>
						)}
					</li>
				))}
			</ol>
			{!disabled && (
				<>
					<label className="dv-field">
						<span>Question about this item</span>
						<textarea
							value={question}
							onChange={(event) => setQuestion(event.target.value)}
							maxLength={8000}
							disabled={busy}
						/>
					</label>
					<button
						type="button"
						className="button secondary"
						onClick={() => void send()}
						disabled={busy || !question.trim() || !onAsk}
					>
						{busy ? "Sending…" : "Ask"}
					</button>
				</>
			)}
			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}
		</details>
	);
}
