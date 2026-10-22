import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DecideConfigurationSchema, decisionItems } from "../HumanStep";
import {
	availableViewPaths,
	type ResolvedView,
	resolveView,
	VIEW_JSON_SCHEMA,
	type ViewScope,
	ViewSourceSchema,
} from "../View";
import { CheckJsonField } from "./check-step-settings";
import { api } from "./client";
import { HumanStepDecision } from "./declarative-view";
import type { Step } from "./recipe-graph";

const exampleScope: ViewScope = {
	inputs: {
		research: {
			summary: {
				text: "Review these findings and choose what should happen next.",
			},
			items: [
				{
					id: "cache",
					title: "Reuse validated cache entries",
					body: "Avoid repeating work when accepted inputs are unchanged.",
					impact: "Faster repeat runs",
				},
				{
					id: "labels",
					title: "Clarify progress labels",
					body: "Make waiting and active execution easy to distinguish.",
					impact: "Clearer run status",
				},
			],
		},
	},
};

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : "Invalid configuration";
export function viewConfigurationProblem(step: Step): string | undefined {
	const source = ViewSourceSchema.safeParse(step.view);
	if (!source.success)
		return source.error.issues
			.map((issue) => `${issue.path.join("/")}: ${issue.message}`)
			.join("; ");
	if (step.type === "decide") {
		const decide = DecideConfigurationSchema.safeParse(step.decide);
		if (!decide.success)
			return decide.error.issues
				.map((issue) => `${issue.path.join("/")}: ${issue.message}`)
				.join("; ");
	}
	return undefined;
}

type PreviewProvenance = {
	kind: "sample" | "last-run";
	runId?: string;
	stepKey?: string;
	at?: string;
	workflowId: string;
	definitionMatch: boolean;
};
type LastRunPreview = {
	scope: ViewScope;
	provenance: PreviewProvenance;
	paths: string[];
	view: ResolvedView;
};

/** An invalid JSON draft never replaces the last schema-valid definition. */
function ViewEditor({
	value,
	readOnly,
	paths,
	onChange,
	onError,
}: {
	value: Step["view"];
	readOnly: boolean;
	paths: string[];
	onChange: (view: Step["view"]) => void;
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
			const parsed = ViewSourceSchema.parse(JSON.parse(next));
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
				<span>View JSON</span>
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
					Components: markdown, checklist, beforeAfter, chart, screenshots,
					video, table, code, steps, points, itemCards, choices, runList,
					decisionBar.
				</p>
				<p>
					For a child-run list, declare {`reads: {"children":"@childRuns"}`} and
					bind runList data to /inputs/children. Actions in decisionBar are
					labels; human authority comes from the accepted step’s controls.
				</p>
				<pre>
					<code>{JSON.stringify(VIEW_JSON_SCHEMA, null, 2)}</code>
				</pre>
			</details>
		</div>
	);
}

export function HumanStepSettings({
	step,
	readOnly,
	onChange,
	onError,
	previewScope,
	previewProvenance,
	workflowId,
}: {
	step: Step;
	readOnly: boolean;
	onChange: (patch: Partial<Step>) => void;
	onError: (field: string, error: string) => void;
	previewScope?: ViewScope;
	previewProvenance?: string;
	workflowId?: string;
}) {
	const [sampleText, setSampleText] = useState(() =>
		JSON.stringify(previewScope ?? exampleScope, null, 2),
	);
	const [mode, setMode] = useState<"sample" | "last-run">("sample");
	const [lastRun, setLastRun] = useState<LastRunPreview>();
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState("");
	const request = useRef<AbortController | undefined>(undefined);
	const id = useId();
	const configProblem = viewConfigurationProblem(step);
	const readsSignature = JSON.stringify(step.reads ?? {});
	useEffect(() => {
		onError("View configuration", configProblem ?? "");
		return () => onError("View configuration", "");
	}, [configProblem, onError]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A different step or declared-read mapping invalidates and cancels the previous run-data preview.
	useEffect(() => {
		request.current?.abort();
		setLastRun(undefined);
		setLoadError("");
		setLoading(false);
		return () => request.current?.abort();
	}, [step.id, readsSignature]);
	const scopeResult = useMemo((): { scope?: ViewScope; error?: string } => {
		if (mode === "last-run")
			return lastRun
				? { scope: lastRun.scope }
				: { error: "Load a matching run to preview its declared inputs." };
		try {
			const scope = JSON.parse(sampleText) as ViewScope;
			availableViewPaths(scope);
			return { scope };
		} catch (cause) {
			return { error: describeError(cause) };
		}
	}, [sampleText, lastRun, mode]);
	const preview = useMemo(() => {
		if (!scopeResult.scope || configProblem)
			return { error: configProblem ?? scopeResult.error };
		try {
			const view = resolveView(
				ViewSourceSchema.parse(step.view),
				scopeResult.scope,
			);
			const decide =
				step.type === "decide"
					? DecideConfigurationSchema.parse(step.decide)
					: undefined;
			const items = decide
				? decisionItems(decide, scopeResult.scope).map(
						({ value: _value, ...item }) => item,
					)
				: undefined;
			return {
				view,
				items,
				actions: decide?.actions,
				askAvailable: !!decide?.ask,
			};
		} catch (cause) {
			return { error: describeError(cause) };
		}
	}, [scopeResult, configProblem, step.view, step.type, step.decide]);
	let paths: string[] = [];
	try {
		if (scopeResult.scope) paths = availableViewPaths(scopeResult.scope);
	} catch {
		/* Error is displayed with the preview. */
	}
	const load = async () => {
		if (!workflowId || loading) return;
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setLoading(true);
		setLoadError("");
		try {
			const result = await api<LastRunPreview>("/api/recipes/view-preview", {
				method: "POST",
				signal: controller.signal,
				body: JSON.stringify({
					workflowId,
					stepId: step.id,
					view: step.view,
					decide: step.decide,
					reads: step.reads,
					lastRun: true,
				}),
			});
			if (!controller.signal.aborted) {
				setLastRun(result);
				setMode("last-run");
			}
		} catch (cause) {
			if (!controller.signal.aborted) setLoadError(describeError(cause));
		} finally {
			if (!controller.signal.aborted) setLoading(false);
		}
	};
	const provenance =
		mode === "last-run" && lastRun
			? `Last run ${lastRun.provenance.runId ?? ""}${lastRun.provenance.at ? ` · ${lastRun.provenance.at}` : ""}${lastRun.provenance.definitionMatch ? " · accepted definition matches" : " · retained accepted input snapshot; draft configuration differs"}`
			: (previewProvenance ?? "Sample data edited below. No run is changed.");
	return (
		<section
			className="recipe-section human-step-settings"
			aria-label="Human view configuration"
		>
			<h3>
				{step.type === "decide"
					? "Decide per item"
					: step.type === "approve"
						? "Approve displayed content"
						: "Show an update"}
			</h3>
			<p className="recipe-note">
				{step.type === "show"
					? "Show renders a retained update and continues immediately without a human wait."
					: step.type === "approve"
						? "Approve and Request changes bind the exact server-rendered content, assets and accepted configuration. A changed version requires a fresh answer."
						: "Define item bindings and allowed actions. Output includes choices, itemsByAction, followUps and hasFollowUps for ordinary recipe routes. Ask uses a dedicated follow-up and retains source research."}
			</p>
			<CheckJsonField
				label="View reads"
				object
				value={step.reads ?? {}}
				readOnly={readOnly}
				onChange={(reads) => onChange({ reads })}
				onError={onError}
			/>
			<ViewEditor
				value={step.view}
				readOnly={readOnly}
				paths={paths}
				onChange={(view) => onChange({ view })}
				onError={onError}
			/>
			{step.type === "decide" && (
				<>
					<CheckJsonField
						label="Item actions and bindings"
						value={step.decide ?? {}}
						object
						readOnly={readOnly}
						rows={12}
						onChange={(decide) => onChange({ decide })}
						onError={onError}
						validate={(value) => {
							const result = DecideConfigurationSchema.safeParse(value);
							return result.success ? undefined : result.error.message;
						}}
					/>
					<p className="recipe-note">
						items uses {`{"path":"/inputs/research/items"}`} or{" "}
						{`{"literal":[…]}`}. itemId, title, body and detail paths are
						relative to each item. Each action has an id, label, optional
						comment and followUp. Optional ask.prompt configures a dedicated
						follow-up agent; its model inherits the run unless explicitly set.
					</p>
				</>
			)}
			{configProblem && (
				<p className="error" role="alert">
					{configProblem}
				</p>
			)}
			<div className="dv-preview-heading">
				<h3>Live preview</h3>
				<fieldset className="dv-preview-modes">
					<legend className="sr-only">Preview data source</legend>
					<button
						className={`button ${mode === "sample" ? "" : "secondary"}`}
						type="button"
						onClick={() => setMode("sample")}
						aria-pressed={mode === "sample"}
					>
						Sample data
					</button>
					<button
						className={`button ${mode === "last-run" ? "" : "secondary"}`}
						type="button"
						onClick={() => {
							setMode("last-run");
							if (!lastRun) void load();
						}}
						aria-pressed={mode === "last-run"}
						disabled={!workflowId || loading}
					>
						{loading ? "Loading…" : "Last run"}
					</button>
					{mode === "last-run" && lastRun && (
						<button
							className="button secondary"
							type="button"
							onClick={() => void load()}
							disabled={loading}
						>
							Refresh data
						</button>
					)}
				</fieldset>
			</div>
			<p className="recipe-note" role="status">
				{provenance}
			</p>
			{mode === "sample" && (
				<label className="dv-field" htmlFor={`${id}-sample`}>
					<span>Sample binding data</span>
					<textarea
						id={`${id}-sample`}
						className="recipe-prompt"
						rows={8}
						value={sampleText}
						onChange={(event) => setSampleText(event.target.value)}
						spellCheck={false}
						aria-invalid={!!scopeResult.error}
					/>
					<small>
						JSON object with inputs and optional item/index. Preview data is
						local to this editor.
					</small>
				</label>
			)}
			{loadError && (
				<p className="error" role="alert">
					{loadError}
				</p>
			)}
			{scopeResult.error || preview.error ? (
				<p className="error" role="alert">
					Preview unavailable: {scopeResult.error ?? preview.error}
				</p>
			) : (
				preview.view && (
					<div className="dv-live-preview">
						<HumanStepDecision
							key={`${step.id}:${JSON.stringify(preview.view)}:${JSON.stringify(preview.items)}`}
							runId={
								mode === "last-run" ? (lastRun?.provenance.runId ?? "") : ""
							}
							snapshot={{
								id: "preview",
								stepKey: step.id,
								kind:
									step.type === "decide"
										? "decide"
										: step.type === "approve"
											? "approve"
											: "show",
								title: step.name,
								digest: "preview-only",
								view: preview.view,
								items: preview.items,
								actions: preview.actions,
								askAvailable: preview.askAvailable,
								createdAt: "preview",
							}}
							onSubmit={async () => {
								throw new Error(
									"Preview only. Run the recipe to retain a human decision.",
								);
							}}
							onAsk={async () => {
								throw new Error(
									"Preview only. Follow-up agents run in an accepted recipe run.",
								);
							}}
						/>
					</div>
				)
			)}
		</section>
	);
}
