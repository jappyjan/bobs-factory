import { factoryContextView } from "bobs-factory-mcp-tools";
import { repositoryMetadata } from "./RepositoryScope.js";
import { evaluateCondition, RULE_EVALUATION_LIMITS } from "./Rules.js";
import { takeoverSource, ticketSnapshot } from "./RunContextSources.js";
import { pointerValue, resolveStepConfig } from "./StepConfig.js";
import { stepContextSources } from "./StepContextSources.js";
import type { WorkflowStep } from "./Workflow.js";
import { snapshotHistory } from "./WorkflowInput.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** Resolve named input bindings without exposing inherited object properties. */
export function stepBindings(
	context: ExecutionContext,
	history = context.run.history,
): Record<string, unknown> {
	const { run, step } = context;
	const outputs = context.outputs ?? run.outputs;
	const sources: Record<string, unknown> = {
		answers: run.answers,
		decisions: run.humanDecisions ?? [],
		architectureProposals: run.architectureProposals ?? [],
		architectureDecisions: run.architectureDecisions ?? [],
		get reviewLedger() {
			return (
				factoryContextView({ history }) as {
					contextMemory: { reviewLedger: unknown };
				}
			).contextMemory.reviewLedger;
		},
		reviewRounds: run.reviewRounds ?? [],
		repository:
			(run.repositories?.length ?? 0) > 1
				? run.repositories
				: (repositoryMetadata(run, step) ?? [
						{ id: run.repositoryId, workspace: run.workspace },
					]),
		source: takeoverSource(run),
		ticket: ticketSnapshot(run),
		history: snapshotHistory(history),
		launchInputs: run.launchInputs ?? {},
		mergeReadiness: run.mergeReadiness,
		get feedback() {
			return (
				stepContextSources(context).feedback ??
				(context.input as Record<string, unknown> | undefined)?.feedback
			);
		},
		get reviewFix() {
			return (
				stepContextSources(context).reviewFix ??
				(context.input as Record<string, unknown> | undefined)?.reviewFix
			);
		},
		qaReuse:
			context.input && typeof context.input === "object"
				? (context.input as Record<string, unknown>).qaReuse
				: undefined,
	};
	const result: Record<string, unknown> = {};
	const conditions = Object.defineProperties(
		{ ...outputs },
		Object.getOwnPropertyDescriptors(sources),
	);
	const budget = {
		remaining: RULE_EVALUATION_LIMITS.conditions,
		workRemaining: RULE_EVALUATION_LIMITS.work,
	};
	for (const [name, binding] of Object.entries(resolveStepConfig(step).reads)) {
		if (
			binding.when &&
			!evaluateCondition(binding.when, conditions, conditions, 0, budget)
		)
			continue;
		const value = binding.from.startsWith("@")
			? pointerValue(sources, binding.from.slice(1))
			: pointerValue(outputs, binding.from);
		result[name] = value === undefined ? undefined : structuredClone(value);
	}
	return result;
}

export function allRunSteps(run: FactoryRun): WorkflowStep[] {
	const flatten = (steps: WorkflowStep[]): WorkflowStep[] =>
		steps.flatMap((step) => [step, ...(step.groups ?? []).flatMap(flatten)]);
	return [
		run.recoveryWorkflow ?? run.workflow,
		...(run.workflowDefinitions ?? []),
	].flatMap((workflow) => flatten(workflow.steps));
}
