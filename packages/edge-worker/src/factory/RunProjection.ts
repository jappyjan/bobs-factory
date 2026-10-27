import { activityPreview } from "./ActivityPage.js";
import { workflowDisplay } from "./ConfigProjection.js";
import { launchBatchProjection } from "./LaunchRuns.js";

import { diagnosticSummary } from "./RunDiagnostics.js";
import { currentStepView, requestUrls } from "./RunOutputRoles.js";
import type { Workflow, WorkflowStep } from "./Workflow.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

/** Accepted definitions the run can actually call, not the whole saved catalog. */
function reachableDefinitions(run: FactoryRun): Workflow[] | undefined {
	const definitions = run.workflowDefinitions;
	if (!definitions) return undefined;
	const reached = new Set<string>();
	const visit = (steps: WorkflowStep[]) => {
		for (const step of steps) {
			const target =
				step.type === "launch-runs"
					? (step.launchRuns?.workflow ?? "factory")
					: step.workflow;
			if (target && !reached.has(target)) {
				reached.add(target);
				const child = definitions.find((w) => w.id === target);
				if (child) visit(child.steps);
			}
			for (const group of step.groups ?? []) visit(group);
			if (step.body) visit(step.body);
		}
	};
	visit(run.workflow.steps);
	return definitions.filter((w) => reached.has(w.id));
}

const focusFields = [
	"id",
	"title",
	"titleGeneration",
	"repositoryId",
	"status",
	"createdAt",
	"updatedAt",
	"step",
	"runner",
	"workflowBlock",
	"triggerOrigin",
	"capacityLeaves",
	"foreach",
	"deliveryCoordination",
	"viewDecision",
	"viewDisplays",
	"iterationLimit",
] as const satisfies readonly (keyof FactoryRun)[];

export function ticketSyncSummary(run: FactoryRun) {
	return (
		run.ticketSync && {
			error: run.ticketSync.error,
			receipts: run.ticketSync.receipts.map(
				({ delivered, superseded, conflict }) => ({
					delivered,
					superseded,
					...(conflict === undefined ? {} : { conflict }),
				}),
			),
		}
	);
}

/** Today needs the current decision, not the run's execution and review history. */
export function focusRun(run: FactoryRun, outputs: Record<string, unknown>) {
	return {
		...Object.fromEntries(focusFields.map((key) => [key, run[key]])),
		diagnostics: diagnosticSummary(run),
		convergence: run.progressBudget && {
			policy: run.progressBudget.policy,
			window: run.progressBudget.window,
			blocked: run.progressBudget.blocked,
			recent: run.progressBudget.recent.slice(-6),
			grantCount: run.progressBudget.grantCount,
			grants: run.progressBudget.grants.slice(-8),
		},
		workflow: workflowDisplay(run.workflow),
		currentStep: currentStepView(run),
		requestUrls: requestUrls(run),
		recipeParent: run.recipeParent,
		launchActions: Object.fromEntries(
			Object.entries(run.launchActions ?? {}).map(([id, batch]) => [
				id,
				launchBatchProjection(batch),
			]),
		),
		workflowDefinitions: reachableDefinitions(run)?.map(workflowDisplay),
		error: run.error?.slice(0, 4000),

		ticketSync: ticketSyncSummary(run),

		outputs,
	};
}

/** The overview keeps exact review identities without retaining evidence bodies. */
export function dashboardRun(
	run: FactoryRun,
	outputs: Record<string, unknown>,
) {
	return {
		...focusRun(run, outputs),
		workspace: run.workspace,
		input: run.input,
		runner: run.runner,
		model: run.model,
		reasoningEffort: run.reasoningEffort,
		modelVariant: run.modelVariant,
		serviceTier: run.serviceTier,
		workflowCalls: run.workflowCalls,
		ticketReference: run.ticketReference,

		executionSnapshot: run.executionSnapshot,
		executionDiagnostics: run.executionDiagnostics,
		outputs,
	};
}

/** Raw entries have their own endpoint; previews must not copy arbitrary metadata. */
export function entryPreviews(entries: unknown[]) {
	const start = Math.max(0, entries.length - 12);
	return entries.slice(start).map((value, offset) => ({
		...activityPreview(value, 4000),
		activityIndex: start + offset,
	}));
}

/** Mutation callers refresh their views separately; never serialize saved payloads. */
export function runActionResult(run: FactoryRun) {
	return { accepted: true, id: run.id, title: run.title, status: run.status };
}
