import { RoleContextPolicySchema } from "bobs-factory-mcp-tools";
import type {
	FileIssuesConfiguration,
	LaunchRunsConfiguration,
	SnapshotConfiguration,
} from "./ActionSteps.js";
import { passiveTools } from "./CapacityPolicy.js";
import type { CheckConfiguration } from "./Check.js";
import { foreachPointerSchema, prepareForeach } from "./Foreach.js";
import type { DecideConfiguration, ViewNotifications } from "./HumanStep.js";
import { ProgressPolicySchema } from "./ProgressPolicy.js";
import { validateReviewConfiguration } from "./SpecialistReview.js";
import {
	hasCheck,
	readStep,
	registerWorkflowConfig,
	type StepConfigFields,
	stepConfigIssues,
} from "./StepConfig.js";
import type { ViewSource } from "./View.js";

export { isComputeIntensive, passiveTools } from "./CapacityPolicy.js";

import type { WorkflowTrigger } from "bobs-factory-core";
import { z } from "zod";
import { resolveAgentSettings } from "./AgentSettings.js";
import type { BriefContract } from "./GuideAuthoring.js";
import { LaunchFieldSchema } from "./LaunchFields.js";

export { AgentStepSchema } from "./nodes/schema.js";

import { nodeRegistry } from "./nodes/index.js";
import { setRegisteredStepSchema } from "./nodes/registry.js";
import { type AgentStepSchema, nodeId as id } from "./nodes/schema.js";
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep extends StepConfigFields {
	id: string;
	delivery?: "exclusive";
	resources?: string[];
	name: string;
	type: string;
	view?: ViewSource;
	document?: import("./DisplayDocument.js").DisplayDocument;
	from?: string;
	bind?: string[];
	decide?: DecideConfiguration;
	notifications?: ViewNotifications;
	snapshot?: SnapshotConfiguration;
	fileIssues?: FileIssuesConfiguration;
	launchRuns?: LaunchRunsConfiguration;
	check?: CheckConfiguration;
	next?: string;
	retry?: { max: number; backoff: number };
	onError?: string;
	transform?: import("./Rules.js").TransformTemplate;
	interval?: number;
	timeout?: number;
	maxErrors?: number;
	until?: import("./Rules.js").RuleCondition;
	branches: {
		when: { path: string; equals?: unknown };
		next: string;
		entry?: string;
	}[];
	maxVisits: number;
	qaContract?: "qa-v1";
	videoContract?: "video-v1";
	review?: { inventory: string; fanout?: string };
	impactSource?: string;
	impactContract?: "impact-v1";
	impact?: { inventory: string; fanout: string; maxUnchangedCycles: number };
	architectureSource?: string;
	architectureContract?: "architecture-v1" | "architecture-review-v1";
	architectureBrief?: "review-v1" | "checkin-v1";
	reviewContract?: "inventory-v1" | "specialist-v1" | "coverage-v1";
	guideContract?: BriefContract;
	prompt?: string;
	inputs?: string[];
	runner?: AgentStep["runner"];
	model?: string;
	reasoningEffort?: AgentStep["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentStep["serviceTier"];
	json?: boolean;
	askQuestions?: boolean;
	chat?: boolean;
	computeIntensive?: boolean;
	script?: string;
	tool?: string;
	args?: string[];
	arguments?: Record<string, unknown>;
	groups?: WorkflowStep[][];
	workflow?: string;
	inputMapping?: Record<string, string>;
	bindings?: Record<string, string>;
	inputFreshness?: "eager" | "on-read";
	items?: { from: string } | { values: unknown[] };
	body?: WorkflowStep[];
	itemId?: string;
	concurrency?: number;
	maxItems?: number;
	failure?: "all-must-succeed" | "keep-successful";
}
/** Reject executable step surfaces before Zod reads even the type discriminator. */
function ownStepData(value: unknown, context: z.RefinementCtx): unknown {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== null &&
			Object.getPrototypeOf(value) !== Object.prototype)
	) {
		context.addIssue({
			code: "custom",
			message: "Workflow steps must be plain data objects",
		});
		return z.NEVER;
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(descriptors)) {
		const descriptor = typeof key === "string" ? descriptors[key] : undefined;
		if (
			typeof key !== "string" ||
			!descriptor ||
			!("value" in descriptor) ||
			!descriptor.enumerable
		) {
			context.addIssue({
				code: "custom",
				message:
					"Workflow steps must use enumerable own data properties without accessors or symbols",
			});
			return z.NEVER;
		}
		// Keep values untouched: each existing field schema owns its configuration,
		// and ordinary optional undefined fields must retain their default behavior.
		result[key] = descriptor.value;
	}
	return result;
}
export const StepSchema: z.ZodType<WorkflowStep> = z.preprocess(
	ownStepData,
	z.unknown().transform((value, context) => nodeRegistry.parse(value, context)),
);
setRegisteredStepSchema(StepSchema);
/** New engine definitions reject legacy agent authority before defaults/unknown-key stripping. */
function newAgentConfiguration(
	value: unknown,
	context: z.RefinementCtx,
): unknown {
	if (!value || typeof value !== "object") return value;
	const root = Object.getOwnPropertyDescriptors(value);
	if (root.engineVersion?.value !== "nodes-v1") return value;
	const forbidden = [
		"qaContract",
		"videoContract",
		"impactContract",
		"impact",
		"architectureSource",
		"architectureContract",
		"architectureBrief",
		"reviewContract",
		"guideContract",
		"review",
		"impactSource",
		"inputs",
		"askQuestions",
		"view",
		"checks",
	];
	const visit = (items: unknown, path: (string | number)[]) => {
		if (!Array.isArray(items)) return;
		for (const [index, item] of items.entries()) {
			// Let ownStepData reject accessors/executable objects before reading fields.
			const safe = ownStepData(item, context);
			if (safe === z.NEVER) continue;
			const step = safe as Record<string, unknown>;
			if (step.type === "agent") {
				for (const key of forbidden)
					if (Object.hasOwn(step, key) && step[key] !== undefined)
						context.addIssue({
							code: "custom",
							path: [...path, index, key],
							message: `New agent nodes do not support ${key}; use reads, output, rules and verify, and a separate display node for human input.`,
						});
			}
			visit(step.body, [...path, index, "body"]);
			if (Array.isArray(step.groups))
				for (const [group, steps] of step.groups.entries())
					visit(steps, [...path, index, "groups", group]);
		}
	};
	visit(root.steps?.value, ["steps"]);
	return value;
}
export const WorkflowSchema = z.preprocess(
	newAgentConfiguration,
	z
		.object({
			id,
			engineVersion: z.literal("nodes-v1").optional(),
			convergence: ProgressPolicySchema.optional(),
			context: z.lazy(() => RoleContextPolicySchema).optional(),
			stepConfigVersion: z.literal("step-config-v1").optional(),
			/** Explicit input ports and terminal outcomes for reusable recipes. */
			inputs: z.array(id).max(100).optional(),
			outcomes: z.array(id).max(30).optional(),
			name: z.string().min(1),
			icon: z.string().max(32).optional(),
			description: z.string().default(""),
			labels: z.array(z.string().min(1)).default([]),
			steps: z.array(StepSchema).max(100),
			internal: z.boolean().optional(),
			chat: z.boolean().optional(),
			allowedTriggers: z
				.array(z.enum(["workflow", "manual", "ticket-assignment"]))
				.refine(
					(values) => new Set(values).size === values.length,
					"Duplicate allowed triggers",
				)
				.optional(),
			launchFields: z
				.array(z.lazy(() => LaunchFieldSchema))
				.max(20)
				.optional(),
		})
		.superRefine((workflow, context) => {
			const visit = (steps: WorkflowStep[], path: (string | number)[]) => {
				for (const [index, step] of steps.entries()) {
					const at = [...path, index];
					if (
						step.onError &&
						!steps.some((destination) => destination.id === step.onError)
					)
						context.addIssue({
							code: "custom",
							path: [...at, "onError"],
							message: "onError must name a step in the same graph",
						});
					if (
						workflow.engineVersion === "nodes-v1" &&
						step.type === "check" &&
						step.checks !== undefined
					)
						context.addIssue({
							code: "custom",
							path: [...at, "checks"],
							message: "nodes-v1 Check is pure; checks is a legacy-only property",
						});
					for (const [group, children] of (step.groups ?? []).entries())
						visit(children, [...at, "groups", group]);
					if (step.body) visit(step.body, [...at, "body"]);
				}
			};
			visit(workflow.steps, ["steps"]);
		})
		.transform((workflow) => {
			const result = {
				...workflow,
				allowedTriggers: workflow.allowedTriggers ?? legacyTriggers(workflow),
			};
			if (result.engineVersion) {
				const visit = (steps: WorkflowStep[]) => {
					for (const step of steps) {
						if (step.type === "agent") {
							delete step.askQuestions;
							step.session ??= "fresh";
						}
						for (const group of step.groups ?? []) visit(group);
						if (step.body) visit(step.body);
					}
				};
				visit(result.steps);
			}
			registerWorkflowConfig(result);
			return result;
		}),
);
