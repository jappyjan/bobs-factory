import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	boundedFactoryContextBytes,
	type FactoryContextAccess,
	outputsFirstContext,
	type RoleContextPolicy,
	refuseTranscriptMaterialization,
	retainTranscriptSource,
	runtimeTranscript,
	runtimeTranscriptField,
	transcriptMaterializationAllowance,
	transcriptPointerValue,
} from "bobs-factory-mcp-tools";
import { resolveStepConfig, workflowIdForStep } from "./StepConfig.js";
import { boundStepKey } from "./ToolBindings.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

function handoffName(input: unknown): string {
	const fields = input && typeof input === "object" ? input : {};
	let name = "handoff",
		suffix = 0;
	while (Object.hasOwn(fields, name)) name = `factoryHandoff${suffix++ || ""}`;
	return name;
}

/** Frozen at new-run admission. Restored runs without this receipt stay legacy. */
export function roleContextPolicy(
	context: Pick<ExecutionContext, "run" | "step">,
): RoleContextPolicy | undefined {
	if (!context.run.roleContext) return;
	const owner = workflowIdForStep(context.step);
	const recipe = [
		context.run.workflow,
		...(context.run.workflowDefinitions ?? []),
	].find((recipe) => recipe?.id === owner);
	return (
		context.step.context ?? recipe?.context ?? context.run.roleContext.policy
	);
}
export function roleContextAccess(
	context: Pick<ExecutionContext, "run" | "step" | "stepKey" | "factoryHome">,
): FactoryContextAccess | undefined {
	const policy = roleContextPolicy(context);
	if (!policy) return;
	if (!context.factoryHome)
		throw new Error(
			"Outputs-first context requires its runtime-owned Factory home",
		);
	return {
		handoffPath: `/${handoffName("input" in context ? context.input : undefined)}`,
		runId: context.run.id,
		work: context.stepKey ?? context.step.id,
		policy,
		directory: join(
			context.factoryHome,
			"factory",
			"context-cache",
			createHash("sha256").update(context.run.id).digest("hex"),
		),
	};
}
export function newRoleContext(
	run: Pick<FactoryRun, "workflow" | "createdAt">,
) {
	return {
		version: 1 as const,
		acceptedAt: run.createdAt,
		adoption: "new-run" as const,
		policy: structuredClone(run.workflow.context ?? outputsFirstContext),
	};
}

/** Native event provenance is selected here, never inferred from JSON property names. */
export function roleTranscriptSource(context: ExecutionContext): unknown {
	const grant = roleContextPolicy(context)?.transcripts;
	const root = runtimeTranscript(
		{ roles: {} as Record<string, Record<string, unknown>> },
		{ runId: context.run.id, role: "*", start: 0, end: 0 },
	);
	if (!grant || context.step.type !== "agent") return root; // No native buffer traversal for an ordinary role.
	if (!context.transcriptEntries)
		throw new Error(
			"Original native transcript source is unavailable for this diagnostic role. Restore the run's original session entries; workflow activity previews cannot replace the requested evidence.",
		);
	const access = roleContextAccess(context)!;
	const captureLimit = transcriptMaterializationAllowance(access);
	let capturedBytes = 0;
	const indexes = new Map<string, number>();
	for (const entry of context.transcriptEntries()) {
		const key = entry.metadata?.factoryStepKey;
		if (!key) continue; // Unattributed legacy entries never acquire a guessed role.
		const index = indexes.get(key) ?? 0;
		indexes.set(key, index + 1);
		if (
			!grant.ranges.some(
				(range) =>
					range.role === key && index >= range.start && index < range.end,
			)
		)
			continue;
		const value = { index, entry };
		const scope = {
			runId: context.run.id,
			role: key,
			start: index,
			end: index + 1,
		};
		const bytes = boundedFactoryContextBytes(
			value,
			captureLimit - capturedBytes,
		);
		if (bytes === undefined) refuseTranscriptMaterialization(access, scope);
		capturedBytes += bytes;
		root.roles[key] ??= {};
		root.roles[key]![String(index)] = runtimeTranscript(value, scope);
		if (
			grant.ranges.every((range) => (indexes.get(range.role) ?? 0) >= range.end)
		)
			break;
	}
	for (const range of grant.ranges)
		if ((indexes.get(range.role) ?? 0) < range.end)
			throw new Error(
				`Original native transcript range ${range.role}[${range.start},${range.end}) is unavailable or lacks role provenance. Restore the original source or configure a narrower evidenced range in a saved copy/new run; no activity-log fallback or inferred acceptance is allowed.`,
			);

	return root;
}

/** Agent presentation only: native Check/digest/receipt inputs remain unchanged. */
export function roleAgentContext(context: ExecutionContext): unknown {
	if (!roleContextPolicy(context)) return context.input;
	const input =
		context.input && typeof context.input === "object"
			? (context.input as Record<string, unknown>)
			: { input: context.input };
	const config = resolveStepConfig(context.step);
	const source = (path: string) => ({ runId: context.run.id, path });
	// A partner that has not produced yet (e.g. clarify's own scope on a first pass)
	// is not a lost record; only report reads whose producer already has output.
	const produced = (name: string) => {
		const key = boundStepKey(context, name);
		return !key || context.run.outputs?.[key] !== undefined;
	};
	const gaps = Object.entries(config.reads).flatMap(([name, binding]) =>
		!binding.when && input[name] === undefined && produced(name)
			? [
					{
						input: name,
						source: binding.from,
						reason: "Declared handoff record is missing",
						remedy: `Restore ${binding.from} or supply an explicit source-bound output/artifact through the recipe's declared input. Transcript browsing cannot establish the missing decision or acceptance.`,
					},
				]
			: [],
	);
	const name = handoffName(input);
	const handoff = {
		format: "factory-role-handoff-v1",
		runId: context.run.id,
		role: context.stepKey ?? context.step.id,
		task: {
			kind: "user-request",
			source: source("/input"),
			value: context.run.input,
		},

		steering: (context.chatMessages ?? []).map((value) => ({
			kind: "human-steering",
			source: { ...source("/chatMessages"), id: value.id },
			value,
		})),
		inputs: Object.entries(config.reads)
			.filter(([name]) => input[name] !== undefined)
			.map(([name, binding]) => ({
				name,
				source: { ...source(`/inputs/${name}`), binding: binding.from },
				value: input[name],
			})),
		repository: context.run.repositories ?? [
			{ id: context.run.repositoryId, workspace: context.run.workspace },
		],
		progress: context.progress,
		gaps,
		policy: {
			mode: "outputs-first",
			transcriptAccess: roleContextPolicy(context)?.transcripts
				? "scoped-diagnostic"
				: "restricted",
		},
	};
	const result = { ...input, [name]: handoff };
	retainTranscriptSource(input, result);
	for (const record of handoff.inputs) {
		const selected = transcriptPointerValue(input, record.name);
		if (selected.scope) runtimeTranscriptField(record, "value", selected.scope);
	}
	return result;
}
