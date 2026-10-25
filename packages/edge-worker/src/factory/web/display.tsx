import { type ReactNode, useId, useState } from "react";
import {
	displayComponents,
	ResolvedDisplayDocumentSchema,
} from "../DisplayDocument";
import type { ViewSnapshot } from "../HumanStep";
import { ResolvedViewSchema, type ViewComponent } from "../View";
import { useAction } from "./client";
import {
	AskThread,
	DeclarativeView,
	type HumanStepAnswer,
	type HumanStepAsk,
	ViewMarkdown,
} from "./declarative-view";
import { useReadingPosition } from "./reading-position";
import { DiffBody } from "./review-files";

type Selection = { action: string; comment?: string };
type Props = {
	snapshot: ViewSnapshot;
	runId: string;
	disabled?: boolean;
	onSubmit: (answer: HumanStepAnswer) => Promise<unknown>;
	onAsk?: (request: HumanStepAsk) => Promise<unknown>;
};

export function DisplayPanel({
	snapshot,
	runId,
	disabled,
}: Omit<Props, "onSubmit" | "onAsk">) {
	const mutation = useAction(
		`display/${runId}/${snapshot.id}`,
		snapshot.digest,
	);
	return (
		<DisplayDocumentView
			key={snapshot.id}
			snapshot={snapshot}
			runId={runId}
			disabled={disabled || mutation.isBlocked}
			onSubmit={(body) =>
				mutation.mutateAsync({
					path: `/api/runs/${encodeURIComponent(runId)}/view-answer`,
					body,
				})
			}
			onAsk={(body) =>
				mutation.mutateAsync({
					path: `/api/runs/${encodeURIComponent(runId)}/view-ask`,
					body,
				})
			}
		/>
	);
}

/** The display node has one screen, chosen only by node type. */
export function DisplayDocumentView(props: Props) {
	const parsed = ResolvedDisplayDocumentSchema.safeParse(props.snapshot.view);
	if (!parsed.success)
		return (
			<p role="alert" className="error">
				Invalid display document: {parsed.error.message}
			</p>
		);
	return (
		<DisplayForm
			{...props}
			snapshot={{ ...props.snapshot, view: parsed.data }}
		/>
	);
}
function DisplayForm({
	snapshot,
	runId,
	disabled = false,
	onSubmit,
	onAsk,
}: Props) {
	const list = displayComponents(snapshot.view);
	const answer = snapshot.answer as
		| {
				values?: Record<string, string | boolean>;
				items?: Record<string, Selection>;
		  }
		| undefined;
	const [values, setValues] = useState<Record<string, string | boolean>>(
		answer?.values ?? {},
	);
	const [items, setItems] = useState<Record<string, Selection>>(
		answer?.items ?? {},
	);
	const [custom, setCustom] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(
			list.flatMap((c) =>
				c.type === "form"
					? c.data.fields
							.filter((f) => f.type === "choice" && f.custom)
							.map((f) => [
								f.id,
								f.type === "choice" &&
									Object.hasOwn(answer?.values ?? {}, f.id) &&
									!f.options.some((o) => o.id === answer?.values?.[f.id]),
							])
					: [],
			),
		),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const formId = useId();
	useReadingPosition(runId ? `display/${runId}/${snapshot.id}` : undefined);
	const locked = disabled || busy || !!snapshot.answer;
	const pendingAsk = Object.values(snapshot.threads ?? {})
		.flat()
		.some((t) => t.status === "pending");
	const setItem = (id: string, patch: Partial<Selection>) =>
		setItems((previous) => ({
			...previous,
			[id]: {
				...previous[id],
				action: previous[id]?.action ?? "comment",
				...patch,
			},
		}));
	const comment = (id: string) => (
		<label className="dv-field">
			<span>Comment</span>
			<textarea
				value={items[id]?.comment ?? ""}
				maxLength={12000}
				disabled={locked}
				onChange={(e) => setItem(id, { comment: e.target.value })}
			/>
		</label>
	);
	const render = (component: ViewComponent): ReactNode => {
		switch (component.type) {
			case "section": {
				const children = ResolvedViewSchema.parse({
					version: "view-v1",
					components: component.data.components,
				}).components;
				return (
					<details
						className="dv-component display-section"
						key={component.id}
						open={!component.data.collapsed}
					>
						<summary>{component.title ?? "Section"}</summary>
						<div className="declarative-view">{children.map(render)}</div>
					</details>
				);
			}
			case "actions":
				return null;
			case "form":
				return (
					<section key={component.id} className="dv-component">
						{component.title && <h3>{component.title}</h3>}
						{component.data.fields.map((field) => {
							if (field.type !== "choice")
								return (
									<DeclarativeView
										key={field.id}
										view={{
											version: "view-v1",
											components: [{ ...component, data: { fields: [field] } }],
										}}
										fields={values}
										onFieldChange={(id, value) =>
											setValues((v) => ({ ...v, [id]: value }))
										}
										disabled={locked}
									/>
								);
							const value = values[field.id] ?? field.value ?? "";
							return (
								<fieldset
									key={field.id}
									className="display-choice"
									disabled={locked}
								>
									<legend>
										{field.label}
										{field.required ? " (required)" : ""}
									</legend>
									{field.recommendation && (
										<p>
											Recommendation: {field.recommendation.answer} —{" "}
											{field.recommendation.reason}
										</p>
									)}
									{field.options.map((option) => (
										<label key={option.id} className="dv-checkbox">
											<input
												type="radio"
												name={`${formId}-${field.id}`}
												checked={!custom[field.id] && value === option.id}
												onChange={() => {
													setCustom((c) => ({ ...c, [field.id]: false }));
													setValues((v) => ({ ...v, [field.id]: option.id }));
												}}
											/>
											<span>
												{option.label}
												{option.reason && <small> — {option.reason}</small>}
											</span>
										</label>
									))}
									{field.custom && (
										<>
											<label className="dv-checkbox">
												<input
													type="radio"
													name={`${formId}-${field.id}`}
													checked={!!custom[field.id]}
													onChange={() => {
														setCustom((c) => ({ ...c, [field.id]: true }));
														setValues((v) => ({ ...v, [field.id]: "" }));
													}}
												/>
												<span>Custom answer</span>
											</label>
											{custom[field.id] && (
												<label className="dv-field">
													<span>Your answer</span>
													<textarea
														value={String(value)}
														required={field.required}
														onChange={(e) =>
															setValues((v) => ({
																...v,
																[field.id]: e.target.value,
															}))
														}
														maxLength={4000}
													/>
												</label>
											)}
										</>
									)}
								</fieldset>
							);
						})}
					</section>
				);
			case "itemCards":
				return (
					<section key={component.id} className="dv-component">
						{component.title && <h3>{component.title}</h3>}
						<div className="dv-items">
							{component.data.items.map((item) => (
								<article className="dv-item-card" key={item.id}>
									<h4>{item.title}</h4>
									{item.body && <ViewMarkdown text={item.body} />}
									{item.details?.map((d) => (
										<p key={d.label}>
											<strong>{d.label}: </strong>
											{d.value}
										</p>
									))}
									{!!component.data.actions?.length && (
										<fieldset disabled={locked}>
											<legend>Action for {item.title}</legend>
											{component.data.actions.map((action) => (
												<label className="dv-checkbox" key={action.id}>
													<input
														type="radio"
														name={`${formId}-item-${item.id}`}
														checked={items[item.id]?.action === action.id}
														onChange={() =>
															setItem(item.id, {
																action: action.id,
																...(!component.data.comment && !action.comment
																	? { comment: undefined }
																	: {}),
															})
														}
													/>
													<span>{action.label}</span>
												</label>
											))}
										</fieldset>
									)}
									{(component.data.comment ||
										component.data.actions?.some(
											(a) => a.id === items[item.id]?.action && a.comment,
										)) &&
										comment(item.id)}
									{component.data.ask && (
										<AskThread
											runId={runId}
											snapshot={snapshot}
											itemId={item.id}
											disabled={locked}
											onAsk={onAsk}
										/>
									)}
								</article>
							))}
						</div>
					</section>
				);
			case "codeTour":
				return (
					<section
						key={component.id}
						className="dv-component display-code-tour"
					>
						{component.title && <h3>{component.title}</h3>}
						{component.data.files.map((file) => (
							<section key={file.id}>
								<h4>{file.path}</h4>
								<DiffBody
									patch={file.hunks.join("\n")}
									split={false}
									notes={file.notes}
									renderNote={component.data.comment ? comment : undefined}
								/>
							</section>
						))}
					</section>
				);
			default:
				return (
					<DeclarativeView
						key={component.id}
						view={{ version: "view-v1", components: [component] }}
						runId={runId}
						disabled={locked}
					/>
				);
		}
	};
	const bar = list.find((c) => c.type === "actions");
	const send = async (action?: string) => {
		if (locked || pendingAsk) return;
		setBusy(true);
		setError("");
		try {
			await onSubmit({
				batchId: snapshot.id,
				digest: snapshot.digest,
				documentDigest: snapshot.documentDigest,
				accepted: true,
				...(action === undefined ? {} : { action }),
				values,
				choices: Object.entries(items).map(([itemId, value]) => ({
					itemId,
					...value,
				})),
			});
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Could not submit display answers",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<form
			className="human-step-panel display-document"
			aria-label={snapshot.title}
			onSubmit={(e) => {
				e.preventDefault();
				void send();
			}}
		>
			<h2>{snapshot.title}</h2>
			<div className="declarative-view">
				{snapshot.view.components.map(render)}
			</div>
			{snapshot.interactive !== false && (
				<div className="dv-decision-bar display-action-bar">
					{bar?.type === "actions" && bar.data.summary && (
						<p>{bar.data.summary}</p>
					)}
					{error && (
						<p role="alert" className="error">
							{error}
						</p>
					)}
					{pendingAsk && (
						<p role="status">Wait for the item answer before submitting.</p>
					)}
					{!!snapshot.answer && <p role="status">Answer recorded</p>}
					{bar?.type === "actions" ? (
						bar.data.actions.map((action) => (
							<button
								className="button primary"
								key={action.id}
								type="submit"
								disabled={locked || pendingAsk}
								onClick={(e) => {
									e.preventDefault();
									const form = e.currentTarget.form;
									if (form?.reportValidity()) void send(action.id);
								}}
							>
								{action.label}
							</button>
						))
					) : (
						<button
							className="button primary"
							type="submit"
							disabled={locked || pendingAsk}
						>
							Submit
						</button>
					)}
				</div>
			)}
		</form>
	);
}
