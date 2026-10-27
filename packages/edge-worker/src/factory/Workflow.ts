import { RoleContextPolicySchema } from "bobs-factory-mcp-tools";
import type {
	FileIssuesConfiguration,
	LaunchRunsConfiguration,
	SnapshotConfiguration,
} from "./ActionSteps.js";
import type { CheckConfiguration } from "./Check.js";
import { displayMayInteract } from "./DisplayDocument.js";
import { foreachPointerSchema, prepareForeach } from "./Foreach.js";

import { ProgressPolicySchema } from "./ProgressPolicy.js";

import {
	inlineSchemaIssues,
	registerWorkflowConfig,
	type StepConfigFields,
	stepConfigIssues,
} from "./StepConfig.js";

export { isComputeIntensive } from "./CapacityPolicy.js";

import type { WorkflowTrigger } from "bobs-factory-core";
import { z } from "zod";
import { resolveAgentSettings } from "./AgentSettings.js";

import { LaunchFieldSchema } from "./LaunchFields.js";

export { AgentStepSchema } from "./nodes/schema.js";

import { nodeRegistry } from "./nodes/index.js";
import { setRegisteredStepSchema } from "./nodes/registry.js";
import { type AgentStepSchema, nodeId as id } from "./nodes/schema.js";
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep extends StepConfigFields {
	notifications?: { push: "private" | "view-text" };
	id: string;
	reuse?: "unchanged-inputs";
	bind?: string[];
	revisionScope?:
		| "repository"
		| "none"
		| { paths: string[] | { from: string } };
	delivery?: "exclusive";
	resources?: string[];
	name: string;
	type: string;

	document?: import("./DisplayDocument.js").DisplayDocument;
	from?: string;

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

	prompt?: string;

	runner?: AgentStep["runner"];
	model?: string;
	reasoningEffort?: AgentStep["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentStep["serviceTier"];
	json?: boolean;

	chat?: boolean;
	computeIntensive?: boolean;

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
							message:
								"nodes-v1 Check is pure; checks is a legacy-only property",
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
export type Workflow = z.infer<typeof WorkflowSchema>;

/** Resolve authored graph paths without consulting outputs or user-supplied JSON. */
export function workflowStepAt(
	workflow: Workflow,
	definitions: Workflow[],
	path: string,
): WorkflowStep | undefined {
	const parts = path.split("/");
	let steps = workflow.steps;
	for (let index = 0; index < parts.length; index++) {
		const step = steps.find((item) => item.id === parts[index]);
		if (!step) return undefined;
		if (index === parts.length - 1) return step;
		if (step.type === "workflow") {
			const called = definitions.find((item) => item.id === step.workflow);
			if (!called) return undefined;
			steps = called.steps;
		} else if (step.groups) {
			const group = step.groups[Number(parts[++index])];
			if (!group) return undefined;
			steps = group;
		} else return undefined; // Item identities exist only in their own lexical body.
	}
	return undefined;
}

function legacyTriggers(workflow: {
	id: string;
	internal?: boolean;
}): WorkflowTrigger[] {
	return workflow.id === "simple"
		? ["manual", "ticket-assignment"]
		: workflow.internal
			? ["workflow"]
			: ["workflow", "manual", "ticket-assignment"];
}

export function supportsTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): boolean {
	return (
		(workflow.allowedTriggers ?? legacyTriggers(workflow)).includes(trigger) &&
		!(workflow.id === "simple" && trigger === "workflow")
	);
}

export function requireTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): void {
	if (!supportsTrigger(workflow, trigger))
		throw new Error(
			`Workflow "${workflow.name}" (${workflow.id}) does not allow ${trigger} launches. Enable the appropriate permission in Recipes, change the selected workflow/label, or choose an eligible saved default.`,
		);
}

/** Validate the full called/nested body before dispatch, including frozen definitions. */
export function assertForeachBody(
	steps: WorkflowStep[],
	definitions: Workflow[],
	ancestors: string[],
	depth = 0,
): void {
	if (depth > 10) throw new Error("For each body nesting exceeds 10 levels");
	for (const step of steps) {
		if (step.type === "display" && displayMayInteract(step))
			throw new Error("Human checkpoints belong outside concurrent bodies");
		if (
			[
				"item",
				"index",
				"inputs",
				"__proto__",
				"constructor",
				"prototype",
			].includes(step.id)
		)
			throw new Error(`Reserved For each body step ID: ${step.id}`);
		if (step.type === "workflow") {
			const target = definitions.find((w) => w.id === step.workflow);
			if (!target) throw new Error(`Workflow unavailable: ${step.workflow}`);
			requireTrigger(target, "workflow");
			if (ancestors.includes(target.id))
				throw new Error("Recursive workflow call in For each body");
			if (ancestors.length >= 10)
				throw new Error("Workflow nesting exceeds 10 levels");
			assertForeachBody(
				target.steps,
				definitions,
				[...ancestors, target.id],
				depth + 1,
			);
		}
		for (const group of step.groups ?? [])
			assertForeachBody(group, definitions, ancestors, depth + 1);
		if (step.body)
			assertForeachBody(step.body, definitions, ancestors, depth + 1);
	}
}

export function validateWorkflows(
	value: unknown,
	compileSchema: typeof inlineSchemaIssues = inlineSchemaIssues,
): Workflow[] {
	const workflows = z.array(WorkflowSchema).min(1).max(200).parse(value);
	const ids = new Set<string>();
	for (const workflow of workflows) {
		registerWorkflowConfig(workflow);
		if (ids.has(workflow.id))
			throw new Error(`Duplicate workflow: ${workflow.id}`);
		ids.add(workflow.id);
		if (
			workflow.id === "simple" &&
			workflow.allowedTriggers.includes("workflow")
		)
			throw new Error(
				"Simple / Bob’s Factory cannot be called by another workflow; Simple cannot be forked.",
			);
		const fields = workflow.launchFields ?? [];
		if (new Set(fields.map((field) => field.name)).size !== fields.length)
			throw new Error("Duplicate launch field names");
		for (const field of fields) {
			if (
				[
					"title",
					"repositoryId",
					"workflow",
					"runner",
					"model",
					"reasoningEffort",
					"modelVariant",
					"serviceTier",
					"inputs",
					"constructor",
					"prototype",
				].includes(field.name)
			)
				throw new Error(`Reserved launch field name: ${field.name}`);
			if (
				field.type === "select" &&
				new Set(field.options.map((option) => option.value)).size !==
					field.options.length
			)
				throw new Error("Duplicate launch choice values");
			if (
				field.defaultValue &&
				field.type === "select" &&
				!field.options.some((option) => option.value === field.defaultValue)
			)
				throw new Error("Invalid launch field default choice");
		}
		if (workflow.id === "simple" && workflow.steps.length)
			throw new Error(
				"simple uses Bob’s Factory’s existing execution path and cannot be forked",
			);
		if (workflow.id !== "simple" && !workflow.steps.length)
			throw new Error(`Workflow ${workflow.id} needs steps`);
		const check = (
			steps: WorkflowStep[],
			inherited: string[] = [],
			depth = 0,
		) => {
			if (depth > 10)
				throw new Error("Workflow graph nesting exceeds 10 levels");
			const names = new Set(steps.map((step) => step.id));
			const outcomes = new Set(workflow.outcomes ?? []);
			if (
				outcomes.size !== (workflow.outcomes?.length ?? 0) ||
				[...outcomes].some((outcome) => outcome === "end" || names.has(outcome))
			)
				throw new Error(
					"Workflow outcomes must be unique and distinct from steps and end",
				);
			if (names.size !== steps.length) throw new Error("Duplicate step IDs");
			for (const step of steps) {
				const configIssues = stepConfigIssues(
					step,
					steps,
					inherited,
					compileSchema,
				);
				if (configIssues.length) throw new Error(configIssues.join("; "));
				if (step.type === "agent" && step.runner)
					resolveAgentSettings(step.runner, step);
				for (const branch of step.branches) {
					if (!branch.entry) continue;
					const call = steps.find((item) => item.id === branch.next);
					const target = workflows.find((item) => item.id === call?.workflow);
					if (
						call?.type !== "workflow" ||
						!target?.outcomes?.length ||
						!target.steps.some((item) => item.id === branch.entry)
					)
						throw new Error(
							"A route entry requires a declared outcome Call and a real callee step",
						);
				}
				if (step.bindings) {
					const target = workflows.find((item) => item.id === step.workflow);
					for (const [name, source] of Object.entries(step.bindings)) {
						if (!target?.inputs?.includes(name))
							throw new Error(`Call input port is not declared: ${name}`);
						if (source.startsWith("@bindings/")) {
							if (!workflow.inputs?.includes(source.slice("@bindings/".length)))
								throw new Error(`Unknown forwarded Call input: ${source}`);
						} else if (
							!workflowStepAt({ ...workflow, steps }, workflows, source)
						)
							throw new Error(`Unknown Call producer: ${source}`);
					}
				}
				for (const target of [
					step.next,
					step.onError,
					...step.branches.map((branch) => branch.next),
				]) {
					if (
						target &&
						target !== "end" &&
						!names.has(target) &&
						!outcomes.has(target)
					)
						throw new Error(`Unknown step: ${target}`);
				}
				if (step.id === "end") throw new Error("end is reserved");
				for (const group of step.groups ?? [])
					check(group, [...inherited, ...steps.map((s) => s.id)], depth + 1);
				if (step.type === "foreach") {
					if (step.items && "values" in step.items)
						prepareForeach(step, { outputs: {} });
					check(
						step.body!,
						[...inherited, ...steps.map((s) => s.id)],
						depth + 1,
					);
				}
			}
		};
		check(workflow.steps, [
			...(workflow.inputs ?? []),
			...(workflow.outcomes ?? []),
		]);
	}
	if (!ids.has("simple") || !ids.has("factory") || !ids.has("takeover"))
		throw new Error("Keep the simple, factory and takeover defaults");
	const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
	const checkCalls = (
		steps: WorkflowStep[],
		ancestors: string[],
		parallel = false,
		iteration = false,
		depth = 0,
	): void => {
		if (depth > 10) throw new Error("Workflow graph nesting exceeds 10 levels");
		for (const step of steps) {
			if (step.type === "display") {
				if (parallel && displayMayInteract(step))
					throw new Error("Human checkpoints belong outside concurrent bodies");
				for (const binding of Object.values(step.reads ?? {})) {
					const from = typeof binding === "string" ? binding : binding.from;
					if (typeof binding !== "string" && binding.when)
						throw new Error(
							"View reads require unconditional explicit bindings",
						);
					foreachPointerSchema.parse(
						`/${from.startsWith("@") ? from.slice(1) : from}`,
					);
					if (
						from.startsWith("@") &&
						!/^@(callInputs(?:\/|$)|item(?:\/|$)|index$|launchInputs(?:\/|$)|childRuns$)/.test(
							from,
						)
					)
						throw new Error(
							"Views can read only declared outputs or public lexical inputs",
						);
				}
			}
			if (
				iteration &&
				[
					"item",
					"index",
					"inputs",
					"__proto__",
					"constructor",
					"prototype",
				].includes(step.id)
			)
				throw new Error(`Reserved For each body step ID: ${step.id}`);

			if (step.type === "workflow" || step.type === "launch-runs") {
				const targetId =
					step.type === "launch-runs"
						? (step.launchRuns?.workflow ?? "factory")
						: step.workflow!;
				const target = byId.get(targetId);
				if (!target || target.id === "simple")
					throw new Error(`Unknown or uncallable workflow: ${targetId}`);
				requireTrigger(target, "workflow");
				if (ancestors.includes(target.id))
					throw new Error(
						`Recursive workflow call: ${[...ancestors, target.id].join(" → ")}`,
					);
				if (ancestors.length >= 10)
					throw new Error("Workflow nesting exceeds 10 levels");
				checkCalls(
					target.steps,
					[...ancestors, target.id],
					step.type === "launch-runs" ? false : parallel,
					step.type === "launch-runs" ? false : iteration,
					depth + 1,
				);
			}
			for (const group of step.groups ?? [])
				checkCalls(group, ancestors, true, iteration, depth + 1);
			if (step.body) checkCalls(step.body, ancestors, true, true, depth + 1);
		}
	};
	for (const workflow of workflows) checkCalls(workflow.steps, [workflow.id]);
	for (const workflow of workflows) {
		const visit = (steps: WorkflowStep[]) => {
			for (const step of steps) {
				if (step.body) assertForeachBody(step.body, workflows, [workflow.id]);
				for (const group of step.groups ?? []) visit(group);
			}
		};
		visit(workflow.steps);
	}
	return workflows;
}

/** Shared by native graph execution and the production Check simulator. */
export function routeResult(
	step: Pick<WorkflowStep, "branches" | "next">,
	output: unknown,
	fallback = "end",
): string {
	return (
		step.branches.find(
			(branch) =>
				JSON.stringify(readPath(output, branch.when.path)) ===
				JSON.stringify(branch.when.equals),
		)?.next ??
		step.next ??
		fallback
	);
}

export function readPath(value: unknown, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === "object" && Object.hasOwn(current, key)
					? (current as Record<string, unknown>)[key]
					: undefined,
			value,
		);
}

export const workflowTriggerInstructions = `Factory recipes use engineVersion=nodes-v1 and only registered generic nodes. Factory and Takeover compose planning, implementation, independent review, CI, QA, Display approval, Merge and external delivery as ordinary recipes; Improve composes research, Snapshot, For each, Display, File issues and Launch runs. Simple retains its graphless native conversation path. Recipes own prompts, names, correction routes and policy. No step ID or tool name grants authority. Old graphs and local forks remain read-only; restart from the current bundled recipe. Native conversations and historical receipts are never migrated.

Agent nodes consume declared reads, validate output schemas/rules and selector verify checks, and optionally resume their own native session. Human questions are agent data routed by Check into Display, then read by a resumed agent. Display composes inert documents with forms/actions/item discussions and binds exact content and producer receipts before explicit submission. Check and Transform are pure data operations. Converge detects repeated unchanged observations without granting work or consent. Calls, Parallel and For each retain lexical scopes and original producer provenance. File issues creates backlog-only unassigned tickets; Launch runs uses durable independent child identities and dependency waves. Git, PR, CI, Ticket and Merge use configured integrations and durable effect reconciliation. Exec enforces its configured filesystem boundary.

Every completed node retains output JSON, inputDigest and a guarantee. Reuse requires unchanged inputs, revisions and recursively fresh bindings. revisionScope is repository, explicit Git paths or none; unknown repository observations fail freshness conservatively. Human waits freeze their own repository state and bound evidence. fresh() observes local state only; Merge passes the approved receipt's exact head to the provider to reject remote changes. Copied JSON and agent assertions cannot become approval or provider evidence. Durable effects retain sending/uncertain/confirmed state; unknown outcomes require reconciliation, never blind resend. Runtime capacity, shared resources, visit/progress budgets, cancellation and update draining remain independent.

New launches select an explicit manual choice, then [workflow=<id>] in the triggering comment, then description, matching configured labels, then the saved default. Quoted examples are ignored. Conflicting or malformed selectors in the winning source reject without fallback. The workflow must allow the originating trigger (manual, ticket-assignment or workflow). Existing replies and resumes retain accepted definitions. Repository and model routing remain separate. Execution identity/tool profiles retain accepted credentials, native stores and per-run snapshots.

Outputs-first context is the admission default. Read named task inputs, source-bound structured results and original relevant findings. Follow bounded context references and pagination; summaries, missing evidence and denied transcript reads never grant approval. Diagnostic transcript access needs the accepted exact role/message scope, purpose and cumulative byte/page limits. Explicit retry transcript extensions cannot widen scope or permissions. Timing diagnostics and usage observations do not grant work. See docs/factory/node-catalog.md, capabilities.md and factory-recipe-contract.md for current nodes and composition ports. Treat explicit planning-only restrictions, mandatory repository rules and human authorization boundaries as binding. Missing current product capabilities requested by the task are implementation work; update the capability reference with changed behavior.`;

export const capacityInstructions =
	"Instance capacity bounds scheduled agent executions and intensive workflow steps. Each Factory home has its own pool, with four slots by default. Eligible workflow jobs from older runs receive priority within workflow admission positions; interactive jobs keep their positions and background titles retain occasional turns. Newer jobs fill spare slots, running work is never interrupted, and recovery preserves run age and exchanged admission positions. Tool calls and commands within an admitted agent share its slot; temporary F1 instances with separate homes have independent pools. One supervised test command may own the bounded concurrent processes needed to test startup races, restart, isolation or cleanup. Keep that workload within its admitted turn: await every child, retain admission until it settles, clean up owned children on failure or cancellation, and preserve unrelated services. This is one concurrency test, not permission to start independent heavy jobs. Run independent checks sequentially within the role, or use already configured nested workflow steps or fanout branches so independent jobs receive capacity. Do not launch harness subagents, detach heavy work or invent an unavailable scheduling tool. A required concurrent test can use its supervised command; lack of a scheduling tool is not grounds to waive the evidence or ask a human to schedule it. Ask genuine assistance questions in your final response and finish the turn; native AskUserQuestion is disabled because its callback cannot safely suspend all parallel execution. Parent orchestration, human waits, and passive CI waits consume no slots.";
