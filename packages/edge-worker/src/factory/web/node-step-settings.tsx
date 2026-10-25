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

registerNodeSettings("transform", TransformStepSettings);
registerNodeSettings("wait", WaitStepSettings);
