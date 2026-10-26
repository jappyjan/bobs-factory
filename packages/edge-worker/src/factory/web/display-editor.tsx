const describeError = (error: unknown) =>
	error instanceof Error ? error.message : "Invalid configuration";

import { useEffect, useId, useRef, useState } from "react";
import { DISPLAY_JSON_SCHEMA } from "../DisplayDocument";
import type { ViewSource } from "../View";

import {
	type ResolvedView,
	VIEW_JSON_SCHEMA,
	type ViewScope,
	ViewSourceSchema,
} from "../View";

import { api } from "./client";

import type { Step } from "./recipe-graph";

type PreviewProvenance = {
	kind: "sample" | "last-run";
	runId?: string;
	stepKey?: string;
	at?: string;
	workflowId: string;
	definitionMatch: boolean;
};
export type LastRunPreview = {
	scope: ViewScope;
	provenance: PreviewProvenance;
	paths: string[];
	view: ResolvedView;
};

/** Scope ownership is narrower than definition equality: an edited view may
 * still preview the accepted inputs, but another recipe/read mapping may not. */
export function humanPreviewConfiguration(
	workflowId: string | undefined,
	step: Step,
	definition?: unknown,
) {
	return {
		workflowId,
		owner: JSON.stringify({ workflowId, stepId: step.id, reads: step.reads }),
		signature: JSON.stringify({ workflowId, step, definition }),
		body: JSON.stringify({
			workflowId,
			stepId: step.id,
			type: step.type,
			name: step.name,
			view: step.document ?? { from: step.from! },

			reads: step.reads,
			notifications: step.notifications,
			...(step.type === "display" ? { bind: step.bind } : {}),
			lastRun: true,
		}),
	};
}

type PreviewConfiguration = ReturnType<typeof humanPreviewConfiguration>;
type PreviewState = {
	mode: "sample" | "last-run";
	loaded?: {
		value: LastRunPreview;
		owner: string;
		signature: string;
	};
	loading?: string;
	error?: { signature: string; message: string };
};
type PreviewLoader = (
	body: string,
	signal: AbortSignal,
) => Promise<LastRunPreview>;

/** Owns requests independently of fetch cancellation, including transports that
 * settle after abort. The current render's configuration is checked at commit. */
export class HumanPreviewSession {
	private state: PreviewState = { mode: "sample" };
	private listeners = new Set<() => void>();
	private request?: {
		configuration: PreviewConfiguration;
		controller: AbortController;
	};
	constructor(
		private readonly current: () => PreviewConfiguration,
		private readonly loader: PreviewLoader = (body, signal) =>
			api<LastRunPreview>("/api/recipes/view-preview", {
				method: "POST",
				body,
				signal,
			}),
	) {}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private replace(state: PreviewState) {
		this.state = state;
		for (const listener of this.listeners) listener();
	}
	private cancel() {
		this.request?.controller.abort();
		this.request = undefined;
	}
	dispose = () => this.cancel();
	configurationChanged() {
		const configuration = this.current();
		if (
			this.request &&
			this.request.configuration.signature !== configuration.signature
		)
			this.cancel();
		const loaded =
			this.state.loaded?.owner === configuration.owner
				? this.state.loaded
				: undefined;
		const loading = this.request?.configuration.signature;
		const error =
			this.state.error?.signature === configuration.signature
				? this.state.error
				: undefined;
		if (
			loaded !== this.state.loaded ||
			loading !== this.state.loading ||
			error !== this.state.error
		)
			this.replace({ ...this.state, loaded, loading, error });
	}
	presentation(configuration = this.current()) {
		const loaded =
			this.state.loaded?.owner === configuration.owner
				? this.state.loaded
				: undefined;
		return {
			mode: this.state.mode,
			lastRun: loaded?.value,
			definitionMatch:
				!!loaded?.value.provenance.definitionMatch &&
				loaded.signature === configuration.signature,
			loading: this.state.loading === configuration.signature,
			loadError:
				this.state.error?.signature === configuration.signature
					? this.state.error.message
					: "",
		};
	}
	sample = () => {
		this.cancel();
		this.replace({
			...this.state,
			mode: "sample",
			loading: undefined,
			error: undefined,
		});
	};
	lastRun = async () => {
		if (this.presentation().lastRun) {
			this.replace({ ...this.state, mode: "last-run" });
			return;
		}
		await this.load();
	};
	load = async () => {
		const configuration = this.current();
		if (!configuration.workflowId) return;
		this.cancel();
		const request = { configuration, controller: new AbortController() };
		this.request = request;
		this.replace({
			...this.state,
			mode: "last-run",
			loading: configuration.signature,
			error: undefined,
		});
		const ownsResult = () =>
			this.request === request &&
			!request.controller.signal.aborted &&
			this.current().signature === configuration.signature;
		try {
			const value = await this.loader(
				configuration.body,
				request.controller.signal,
			);
			if (!ownsResult()) return;
			if (
				value.provenance.kind !== "last-run" ||
				value.provenance.workflowId !== configuration.workflowId
			)
				throw new Error("Preview response belongs to another recipe.");
			this.replace({
				...this.state,
				loaded: {
					value,
					owner: configuration.owner,
					signature: configuration.signature,
				},
			});
		} catch (cause) {
			if (ownsResult())
				this.replace({
					...this.state,
					error: {
						signature: configuration.signature,
						message: describeError(cause),
					},
				});
		} finally {
			if (ownsResult()) {
				this.request = undefined;
				this.replace({ ...this.state, loading: undefined });
			}
		}
	};
}

/** An invalid JSON draft never replaces the last schema-valid definition. */
export function ViewEditor({
	value,
	readOnly,
	paths,
	onChange,
	onError,
	schema = ViewSourceSchema,
	document = false,
}: {
	schema?: { parse(value: unknown): NonNullable<ViewSource> };
	document?: boolean;
	value: ViewSource;
	readOnly: boolean;
	paths: string[];
	onChange: (view: ViewSource) => void;
	onError: (field: string, error: string) => void;
}) {
	const serialized = JSON.stringify(value, null, 2) ?? "{}";
	const [text, setText] = useState(serialized);
	const [error, setError] = useState("");
	const [path, setPath] = useState("");
	const emitted = useRef(serialized);
	const editor = useRef<HTMLTextAreaElement>(null);
	const id = useId();
	useEffect(() => {
		if (serialized === emitted.current) return;
		emitted.current = serialized;
		setText(serialized);
		setError("");
	}, [serialized]);
	useEffect(() => {
		onError("View JSON", error);
		return () => onError("View JSON", "");
	}, [error, onError]);
	const update = (next: string) => {
		setText(next);
		try {
			const parsed = schema.parse(JSON.parse(next));
			emitted.current = JSON.stringify(parsed, null, 2);
			setError("");
			onChange(parsed);
		} catch (cause) {
			setError(describeError(cause));
		}
	};
	return (
		<div className="dv-view-editor">
			<label className="dv-field" htmlFor={`${id}-editor`}>
				<span>{document ? "Display document JSON" : "View JSON"}</span>
				<textarea
					id={`${id}-editor`}
					ref={editor}
					className="recipe-prompt"
					value={text}
					onChange={(event) => update(event.target.value)}
					readOnly={readOnly}
					rows={13}
					spellCheck={false}
					aria-invalid={!!error}
					aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
				/>
			</label>
			<p id={`${id}-help`} className="recipe-note">
				Use a view-v1 component list. Each data binding is either a literal
				object or a JSON Pointer. To display an agent’s view output, use{" "}
				{`{"from":"/inputs/summary/view"}`}.
			</p>
			{error && (
				<p id={`${id}-error`} role="alert" className="error">
					{error}
				</p>
			)}
			<div className="dv-path-picker">
				<label className="dv-field" htmlFor={`${id}-path`}>
					<span>Available data paths</span>
					<input
						id={`${id}-path`}
						list={`${id}-paths`}
						value={path}
						onChange={(event) => setPath(event.target.value)}
						placeholder="Start typing /inputs…"
						disabled={readOnly}
						autoComplete="off"
					/>
				</label>
				<datalist id={`${id}-paths`}>
					{paths.map((pointer) => (
						<option key={pointer} value={pointer} />
					))}
				</datalist>
				<button
					type="button"
					className="button secondary"
					disabled={readOnly || !paths.includes(path)}
					onClick={() => {
						const element = editor.current;
						if (!element) return;
						const start = element.selectionStart,
							end = element.selectionEnd;
						const quoted = JSON.stringify(path);
						update(text.slice(0, start) + quoted + text.slice(end));
						element.focus();
						requestAnimationFrame(() =>
							element.setSelectionRange(
								start + quoted.length,
								start + quoted.length,
							),
						);
					}}
				>
					Insert pointer at cursor
				</button>
			</div>
			<p className="recipe-note">
				Select a quoted path value in the editor, then insert its replacement.
				Only named reads (/inputs), the current For each item (/item), and its
				index (/index) are visible. Private run state is never a binding root.
			</p>
			<details className="dv-schema">
				<summary>Component schema and examples</summary>
				<p>
					{document
						? "Components: markdown, points, checklist, table, chart, beforeAfter, steps, code, screenshots, video, itemCards, form, actions, runList, section, codeTour."
						: "Components: markdown, checklist, beforeAfter, chart, screenshots, video, table, code, steps, points, itemCards, choices, runList, decisionBar."}
				</p>
				<p>
					For a child-run list, declare {`reads: {"children":"@childRuns"}`} and
					bind runList data to /inputs/children. Actions in decisionBar are
					labels; human authority comes from the accepted step’s controls.
				</p>
				<pre>
					<code>
						{JSON.stringify(
							document ? DISPLAY_JSON_SCHEMA : VIEW_JSON_SCHEMA,
							null,
							2,
						)}
					</code>
				</pre>
			</details>
		</div>
	);
}
