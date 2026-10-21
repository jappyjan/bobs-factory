import { z } from "zod";
import type { CapacitySnapshot } from "../MachineCapacity.js";
import type { ExecutionProfiles } from "./ExecutionProfiles.js";
import type { FactoryOnboarding } from "./FactoryOnboarding.js";
import { getLaunchFields } from "./LaunchFields.js";
import { type StepPresentation, stepPresentation } from "./StepPresentation.js";
import type { Workflow, WorkflowStep } from "./Workflow.js";

export interface WorkflowStepSummary {
	id: string;
	name: string;
	type: WorkflowStep["type"];
	tool?: string;
	presentation: StepPresentation;
	workflow?: string;
	groups?: WorkflowStepSummary[][];
	body?: WorkflowStepSummary[];
	items?: WorkflowStep["items"];
	concurrency?: number;
	maxItems?: number;
	failure?: WorkflowStep["failure"];
}

function stepSummary(step: WorkflowStep): WorkflowStepSummary {
	return {
		id: step.id,
		name: step.name,
		type: step.type,
		presentation: stepPresentation(step),
		...(step.tool ? { tool: step.tool } : {}),
		...(step.workflow ? { workflow: step.workflow } : {}),
		...(step.type === "foreach"
			? {
					body: step.body!.map(stepSummary),
					items: step.items,
					concurrency: step.concurrency,
					maxItems: step.maxItems,
					failure: step.failure,
				}
			: {}),
		...(step.groups
			? { groups: step.groups.map((group) => group.map(stepSummary)) }
			: {}),
	};
}

/** Frozen run progress and CI activity need names and the step tree only. */
export function workflowDisplay(workflow: Workflow) {
	return {
		id: workflow.id,
		name: workflow.name,
		icon: workflow.icon,
		steps: workflow.steps.map((step) => ({
			...stepSummary(step),
			...(workflow.id === "simple"
				? {
						presentation: {
							phase: "yellow" as const,
							icon: "⚡",
							fixing: false,
						},
					}
				: {}),
		})),
	};
}

/** Display and launch metadata, without executable prompts, scripts or tool arguments. */
export function workflowSummary(workflow: Workflow) {
	return {
		...workflowDisplay(workflow),
		description: workflow.description,
		labels: workflow.labels,
		internal: workflow.internal,
		chat: workflow.chat,
		allowedTriggers: workflow.allowedTriggers,
		launchFields: getLaunchFields(workflow),
	};
}

/** The launch selector sends profile IDs; accepted definitions are resolved on the server. */
export function launchExecutionProfiles(profiles: ExecutionProfiles) {
	const choice = ({
		id,
		name,
		revision,
	}: Pick<
		ExecutionProfiles["identities"][number],
		"id" | "name" | "revision"
	>) => ({ id, name, revision });
	return {
		revision: profiles.revision,
		defaults: profiles.defaults,
		repositories: profiles.repositories,
		identities: profiles.identities.map(choice),
		tools: profiles.tools.map(choice),
	};
}

/** Capacity settings need counts, not lease tokens, process ownership or the queue. */
export function capacitySummary(snapshot: CapacitySnapshot | undefined) {
	if (!snapshot) return undefined;
	const { limit, active, stopping, queued, defaultLimit, error, conflict } =
		snapshot;
	return { limit, active, stopping, queued, defaultLimit, error, conflict };
}

const setupSummary = z.object({
	available: z.boolean(),
	required: z.boolean(),
});

/** Installation probes belong to the setup screen, not every dashboard refresh. */
export async function onboardingSummary(onboarding: FactoryOnboarding) {
	return setupSummary.parse(
		await (onboarding.summary ? onboarding.summary() : onboarding.status()),
	);
}
