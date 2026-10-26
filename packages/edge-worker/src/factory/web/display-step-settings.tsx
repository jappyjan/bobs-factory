import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	DisplaySourceSchema,
	displayInteractive,
	resolveDisplayDocument,
} from "../DisplayDocument";
import { availableViewPaths, type ViewScope } from "../View";
import { CheckJsonField } from "./check-step-settings";
import { DisplayDocumentView } from "./display";
import {
	HumanPreviewSession,
	humanPreviewConfiguration,
	ViewEditor,
} from "./display-editor";
import type { NodeSettingsProps } from "./node-step-settings";

export function DisplayStepSettings({
	step,
	owner,
	readOnly,
	onChange,
	onError,
}: NodeSettingsProps) {
	const value = step.document ?? { from: step.from ?? "/inputs/document" };
	const configuration = humanPreviewConfiguration(owner.id, step, owner);
	const current = useRef(configuration);
	current.current = configuration;
	const [session] = useState(
		() => new HumanPreviewSession(() => current.current),
	);
	useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
		session.getSnapshot,
	);
	useEffect(() => {
		session.configurationChanged();
	});
	useEffect(() => session.dispose, [session]);
	const state = session.presentation(configuration);
	const [sample, setSample] = useState('{"inputs":{}}');
	const preview = useMemo(() => {
		try {
			const scope: ViewScope =
				state.mode === "last-run"
					? (state.lastRun?.scope ?? { inputs: {} })
					: JSON.parse(sample);
			const paths = availableViewPaths(scope);
			try {
				return { paths, view: resolveDisplayDocument(value, scope) };
			} catch (e) {
				return {
					paths,
					error: e instanceof Error ? e.message : "Invalid display",
				};
			}
		} catch (e) {
			return {
				paths: [],
				error: e instanceof Error ? e.message : "Invalid sample data",
			};
		}
	}, [value, sample, state.mode, state.lastRun]);
	return (
		<section
			className="recipe-section human-step-settings"
			aria-label="Display settings"
		>
			<h3>Display</h3>
			<p>
				Arrange components freely. Forms, actions and item controls wait for an
				explicit answer. Content without controls continues immediately.
			</p>
			<CheckJsonField
				label="Display reads"
				object
				value={step.reads ?? {}}
				readOnly={readOnly}
				onChange={(reads) => onChange({ reads })}
				onError={onError}
			/>
			<ViewEditor
				document
				schema={DisplaySourceSchema}
				value={value}
				readOnly={readOnly}
				paths={preview.paths}
				onError={onError}
				onChange={(source) => {
					if (!source) return;
					onChange(
						"from" in source
							? { from: source.from, document: undefined }
							: { document: source, from: undefined },
					);
				}}
			/>
			<CheckJsonField
				label="Notifications"
				object
				value={step.notifications ?? { push: "private" }}
				readOnly={readOnly}
				onChange={(notifications) =>
					onChange({
						notifications: notifications as typeof step.notifications,
					})
				}
				onError={onError}
			/>
			<h3>Live preview</h3>
			<div className="dv-preview-modes">
				<button
					type="button"
					className="button secondary"
					aria-pressed={state.mode === "sample"}
					onClick={session.sample}
				>
					Sample data
				</button>
				<button
					type="button"
					className="button secondary"
					aria-pressed={state.mode === "last-run"}
					disabled={state.loading}
					onClick={() => void session.load()}
				>
					Last run
				</button>
			</div>
			<p role="status">
				{state.mode === "sample"
					? "Sample data; no run is changed."
					: state.lastRun
						? `Retained input snapshot from ${state.lastRun.provenance.runId}. ${state.definitionMatch ? "Configuration matches." : "Draft configuration differs."}`
						: "Load a retained input snapshot."}
			</p>
			{state.mode === "sample" && (
				<label className="dv-field">
					<span>Sample binding data</span>
					<textarea
						rows={8}
						value={sample}
						onChange={(e) => setSample(e.target.value)}
					/>
				</label>
			)}
			{(state.loadError || preview.error) && (
				<p role="alert" className="error">
					{state.loadError || preview.error}
				</p>
			)}
			{preview.view && (
				<DisplayDocumentView
					key={JSON.stringify(preview.view)}
					runId={
						state.mode === "last-run"
							? (state.lastRun?.provenance.runId ?? "")
							: ""
					}
					snapshot={{
						id: "preview",
						stepKey: step.id,
						title: step.name,
						kind: "display",
						view: preview.view,
						digest: "preview",
						interactive: displayInteractive(preview.view),
						createdAt: "preview",
					}}
					onSubmit={async () => {
						throw new Error(
							"Preview only. Run the recipe to record an answer.",
						);
					}}
				/>
			)}
		</section>
	);
}
