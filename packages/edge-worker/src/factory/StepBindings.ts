import {
	factoryContextView,
	runtimeTranscriptField,
	transcriptFieldSources,
	transcriptPointerValue,
	transcriptSource,
} from "bobs-factory-mcp-tools";
import { repositoryMetadata } from "./RepositoryScope.js";
import { roleTranscriptSource } from "./RoleContext.js";
import { evaluateCondition, RULE_EVALUATION_LIMITS } from "./Rules.js";
import { takeoverSource, ticketSnapshot } from "./RunContextSources.js";
import { isNodeEngineStep, resolveStepConfig } from "./StepConfig.js";

import { stepForRun } from "./ToolBindings.js";
import { acceptedMedia } from "./VerifiedMedia.js";
import { childRunsView } from "./ViewRuntime.js";
import type { WorkflowStep } from "./Workflow.js";
import { detachedWorkflowRead, snapshotHistory } from "./WorkflowInput.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** Host ticket timestamps have the same JSON representation before/after restart. */
function checkTicket(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const ticket = value as Record<string, unknown>;
	const result = { ...ticket };
	for (const key of ["createdAt", "updatedAt"]) {
		if (ticket[key] instanceof Date)
			result[key] = Date.prototype.toISOString.call(ticket[key]);
	}
	if (Array.isArray(ticket.comments)) {
		if (ticket.comments.length > RULE_EVALUATION_LIMITS.collection)
			throw new Error("Check ticket comments exceed the collection limit");
		result.comments = ticket.comments.map((comment) => {
			if (!comment || typeof comment !== "object" || Array.isArray(comment))
				return comment;
			const record = { ...comment } as Record<string, unknown>;
			for (const key of ["createdAt", "updatedAt"])
				if (record[key] instanceof Date)
					record[key] = Date.prototype.toISOString.call(record[key]);
			return record;
		});
	}
	return result;
}

/** Resolve named input bindings without exposing inherited object properties. */
export function stepBindings(
	context: ExecutionContext,
	history = context.run.history,
	options?: { checkJson?: boolean },
): Record<string, unknown> {
	const { run, step } = context;
	const outputs = context.outputs ?? run.outputs;
	const sources: Record<string, unknown> = {
		get caller() {
			let prefix = (context.stepKey ?? run.step ?? step.id).replace(
				/[^/]+$/,
				"",
			);
			while (prefix) {
				const key = prefix.replace(/\/$/, "");
				const call = stepForRun(run, key);
				if (call?.type === "workflow")
					return {
						stepKey: key,
						workflowId: call.workflow,
						bindings: call.bindings ?? {},
					};
				prefix = key.replace(/[^/]+$/, "");
			}
			return {};
		},
		agentSettings: {
			runner: step.runner ?? run.runner,
			model:
				step.model ??
				(!step.runner || step.runner === run.runner ? run.model : undefined),
			modelSource: step.model
				? "step"
				: !step.runner || step.runner === run.runner
					? "run"
					: "provider-default",
			limitations: step.model
				? []
				: [
						!step.runner || step.runner === run.runner
							? "No step model is configured; this agent inherits the accepted run model."
							: "No step model is configured for this provider; its accepted provider default is used.",
					],
		},
		get transcripts() {
			return roleTranscriptSource(context);
		},
		callInputs: context.callInputs ?? {},
		error: context.error,

		get childRuns() {
			return childRunsView(run);
		},
		item: context.iteration?.value,
		index: context.iteration?.index,

		get reviewLedger() {
			return (
				factoryContextView({ history }) as {
					contextMemory: { reviewLedger: unknown };
				}
			).contextMemory.reviewLedger;
		},

		repository:
			(run.repositories?.length ?? 0) > 1
				? run.repositories
				: (repositoryMetadata(run, step) ?? [
						{ id: run.repositoryId, workspace: run.workspace },
					]),
		source: isNodeEngineStep(step)
			? {
					prompt: run.input,
					fields: run.launchInputs ?? {},
					source: run.source,
					...(run.takeoverSource ? { request: run.takeoverSource } : {}),
				}
			: takeoverSource(run),
		get ticket() {
			const value = ticketSnapshot(run);
			return options?.checkJson && step.type === "check"
				? checkTicket(value)
				: value;
		},
		history: snapshotHistory(history),
		launchInputs: run.launchInputs ?? {},

		get media() {
			return acceptedMedia(run);
		},
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
		const { value, scope } = binding.from.startsWith("@")
			? transcriptPointerValue(sources, binding.from.slice(1))
			: transcriptPointerValue(outputs, binding.from);
		if (scope) runtimeTranscriptField(result, name, scope);
		result[name] =
			value === undefined ? undefined : detachedWorkflowRead(value);
	}
	return result;
}

/** Native binding/requirement aliases retain the same private scalar provenance. */
export function mappedStepBindings(
	bindings: Record<string, unknown>,
	mapping: object,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [label, name] of Object.entries(mapping)) {
		const key = String(name),
			value = bindings[key];
		result[label] = value;
		const scope =
			transcriptFieldSources(bindings)?.get(key) ??
			(value && typeof value === "object"
				? transcriptSource(value)
				: undefined);
		if (scope) runtimeTranscriptField(result, label, scope);
	}
	return result;
}

export function allRunSteps(run: FactoryRun): WorkflowStep[] {
	const flatten = (steps: WorkflowStep[]): WorkflowStep[] =>
		steps.flatMap((step) => [
			step,
			...(step.groups ?? []).flatMap(flatten),
			...flatten(step.body ?? []),
		]);
	return [run.workflow, ...(run.workflowDefinitions ?? [])].flatMap(
		(workflow) => flatten(workflow.steps),
	);
}
