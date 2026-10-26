import type { ComponentType } from "react";
import { nodeMetadata } from "../nodes/metadata.js";
import { ActionStepSettings } from "./action-step-settings.js";
import { CheckJsonField, CheckStepSettings } from "./check-step-settings.js";
import { DisplayStepSettings } from "./display-step-settings.js";
import { ForeachStepSettings } from "./foreach-step-settings.js";
import { HumanStepSettings } from "./human-step-settings.js";
import {
	TransformStepSettings,
	WaitStepSettings,
} from "./logic-step-settings.js";
import type { Recipe, Step } from "./recipe-graph.js";

export interface NodeSettingsProps {
	step: Step;
	owner: Recipe;
	recipes: Recipe[];
	readOnly: boolean;
	selection: string;
	onSelect(id: string): void;
	onChange(patch: Partial<Step>): void;
	onError(field: string, error: string): void;
}
const panels = new Map<string, ComponentType<NodeSettingsProps>>();
/** Register client-only panels here; server node definitions contain only their key. */
export function registerNodeSettings(
	type: string,
	panel: ComponentType<NodeSettingsProps>,
): void {
	if (panels.has(type))
		throw new Error(`Node settings already registered: ${type}`);
	panels.set(type, panel);
}
registerNodeSettings("display", DisplayStepSettings);

registerNodeSettings("transform", TransformStepSettings);
registerNodeSettings("wait", WaitStepSettings);
registerNodeSettings("inline", () => null);
registerNodeSettings("check", (props) => <CheckStepSettings {...props} />);
registerNodeSettings("foreach", (props) => <ForeachStepSettings {...props} />);
registerNodeSettings("human", (props) => (
	<HumanStepSettings
		{...props}
		workflowId={props.owner.id}
		previewDefinition={props.owner}
	/>
));
registerNodeSettings("action", (props) => (
	<ActionStepSettings {...props} ownerId={props.owner.id} />
));

/** Missing JSON properties must also clear the builder's existing merge-patch values. */
export function configurationPatch(step: Step, value: object): Partial<Step> {
	return {
		...Object.fromEntries(Object.keys(step).map((key) => [key, undefined])),
		...value,
		id: step.id,
		type: step.type,
	};
}

/** New nodes are editable immediately, even before a specialized panel is supplied. */
function ConfigurationSettings({
	step,
	readOnly,
	onChange,
	onError,
}: NodeSettingsProps) {
	return (
		<section className="recipe-section">
			<h3>{nodeMetadata(step.type)?.builder.label ?? step.type}</h3>
			<CheckJsonField
				label="Node configuration"
				object
				value={step}
				readOnly={readOnly}
				onError={onError}
				onChange={(value) =>
					onChange(configurationPatch(step, value as object))
				}
			/>
		</section>
	);
}
function lexicalSiblings(steps: Step[], target: Step): Step[] | undefined {
	if (steps.includes(target)) return steps;
	for (const step of steps) {
		for (const children of [
			...(step.groups ?? []),
			...(step.body ? [step.body] : []),
		]) {
			const found = lexicalSiblings(children, target);
			if (found) return found;
		}
	}
	return undefined;
}
export function NodeStepSettings(props: NodeSettingsProps) {
	const type =
		nodeMetadata(props.step.type)?.builder.settings ?? props.step.type;
	const Panel = panels.get(type) ?? ConfigurationSettings;
	return (
		<>
			<Panel {...props} />
			<section className="recipe-section">
				<h3>On failure</h3>
				<label className="recipe-check">
					<input
						type="checkbox"
						disabled={props.readOnly}
						checked={!!props.step.retry}
						onChange={(e) =>
							props.onChange({
								retry: e.target.checked ? { max: 3, backoff: 1000 } : undefined,
							})
						}
					/>
					Retry failures
				</label>
				{props.step.retry && (
					<CheckJsonField
						label="Retry policy"
						value={props.step.retry}
						readOnly={props.readOnly}
						object
						onError={props.onError}
						onChange={(retry) => props.onChange({ retry })}
					/>
				)}
				<label>
					Error route
					<select
						value={props.step.onError ?? ""}
						disabled={props.readOnly}
						onChange={(e) =>
							props.onChange({ onError: e.target.value || undefined })
						}
					>
						<option value="">Fail the run</option>
						{(
							lexicalSiblings(props.owner.steps, props.step) ??
							props.owner.steps
						).map((step) => (
							<option key={step.id} value={step.id}>
								{step.name}
							</option>
						))}
					</select>
				</label>
				<small>
					The handler can bind a read to @error to receive message and kind.
				</small>
			</section>
		</>
	);
}
