import {
	type RoleContextPolicy,
	RoleContextPolicySchema,
} from "bobs-factory-mcp-tools";
import { z } from "zod";
import {
	compileInlineSchema,
	compileInlineSchemaSync,
} from "./InlineSchema.js";
import { nodeMetadata } from "./nodes/metadata.js";
import {
	type Rule,
	type RuleCondition,
	RuleConditionSchema,
	RuleDataSchema,
	RulesSchema,
} from "./Rules.js";

/**
 * Configurable agent step settings (step-config-v1).
 *
 * Every special agent behavior is configuration on the generic step:
 * reads, output, rules, checks, revision, access and instructions. Runtime and
 * tool code read only the resolved configuration from `resolveStepConfig`;
 * nothing selects behavior by a step's ID. Steps saved before this release
 * carry legacy contract flags instead; `resolveStepConfig` normalizes them
 * deterministically in memory. Persisted definitions are never rewritten.
 */

/** Stable output format IDs. Implementations live in OutputFormats.ts. */
export const FORMAT_IDS = [
	"json-v1",
	"dependency-graph-v1",
	"research-context-v1",
	"research-plan-v1",
	"research-result-v1",
	"proposals-v1",
	"plan-package-v1",
	"plan-check-v1",
	"follow-up-v1",
	"view-v1",
	"display",
	"improvement-issue-destination-v1",
	"improvement-opportunity-v1",
	"improvement-package-v1",
	"improvement-context-v1",
	"improvement-research-plan-v1",
	"improvement-research-result-v1",
	"improvement-proposals-v1",
	"improvement-packages-v1",
	"improvement-plan-check-v1",
] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

/** Code-backed evidence checks. Implementations live in EvidenceChecks.ts. */
export const CHECK_IDS = [
	"files-exist",
	"media-valid",
	"code-refs-valid",
	"ids-resolve",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export const CHECK_SELECTOR_IDS = [
	"files-exist",
	"media-valid",
	"code-refs-valid",
	"ids-resolve",
] as const;

/** Shared instruction snippets. Texts live in InstructionLibrary.ts. */
export const INSTRUCTION_IDS = [
	"architectural-survey",
	"implementation-scope",
	"ticket-plan",
] as const;
export type InstructionId = (typeof INSTRUCTION_IDS)[number];

/** Named context sources a step can read in addition to earlier outputs. */
export const CONTEXT_SOURCES = [
	"agentSettings",
	"reviewLedger",
	"repository",
	"source",
	"ticket",
	"history",
	"transcripts",
	"launchInputs",
	"media",
	"item",
	"index",
	"callInputs",
	"error",
	"caller",
	"childRuns",
] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

const stepId = /^[a-zA-Z0-9_-]+$/;
const readName = z
	.string()
	.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
	.max(60);
/** "<step>", "<step>/<pointer>", "@<source>" or "@<source>/<pointer>". */
const readReference = z
	.string()
	.max(400)
	.refine((value) => {
		const [head, ...rest] = value.split("/");
		if (!head) return false;
		if (head.startsWith("@"))
			return (CONTEXT_SOURCES as readonly string[]).includes(head.slice(1));
		return (
			stepId.test(head) &&
			head.length <= 80 &&
			rest.every((part) => part.length <= 200)
		);
	}, "Reads name an earlier step, a step/path, or a context source such as @source");
export const ReadBindingSchema = z.union([
	readReference,
	z
		.object({
			from: readReference,
			when: RuleDataSchema.pipe(RuleConditionSchema).optional(),
		})
		.strict(),
]);
export type ReadBinding = z.infer<typeof ReadBindingSchema>;
export const ReadsSchema = z
	.record(readName, ReadBindingSchema)
	.refine((value) => Object.keys(value).length <= 30, "At most 30 reads");

const MAX_SCHEMA_BYTES = 64 * 1024;
export const OutputSchema = z
	.unknown()
	.superRefine((value, context) => {
		if (
			value &&
			typeof value === "object" &&
			"format" in value &&
			!(FORMAT_IDS as readonly unknown[]).includes(value.format)
		)
			context.addIssue({
				code: "custom",
				message: `Unknown output format: ${String(value.format)}`,
			});
	})
	.pipe(
		z.union([
			z.object({ format: z.enum(FORMAT_IDS) }).strict(),
			z
				.object({
					schema: z
						.record(z.string(), z.unknown())
						.refine(
							(value) => JSON.stringify(value).length <= MAX_SCHEMA_BYTES,
							"Inline JSON Schemas are limited to 64 KiB",
						),
				})
				.strict(),
		]),
	);
export type StepOutput = z.infer<typeof OutputSchema>;

export const CheckReferenceSchema = z
	.unknown()
	.superRefine((value, context) => {
		const id =
			typeof value === "string"
				? value
				: value && typeof value === "object" && "check" in value
					? value.check
					: undefined;
		if (id !== undefined && !(CHECK_IDS as readonly unknown[]).includes(id))
			context.addIssue({
				code: "custom",
				message: `Unknown evidence check: ${String(id)}`,
			});
	})
	.pipe(
		z.union([
			z.enum(CHECK_IDS),
			z
				.object({ check: z.enum(CHECK_IDS) })
				.catchall(z.unknown())
				.refine(
					(value) => JSON.stringify(value).length <= 4096,
					"Check arguments are limited to 4 KiB",
				),
		]),
	);
export type CheckReference = z.infer<typeof CheckReferenceSchema>;

/** Agent verification only selects generic evidence; no runtime contract adapters. */
const selector = z
	.string()
	.max(400)
	.regex(
		/^\/([^~]|~[01])*$/,
		"Expected a JSON pointer selector beginning with /",
	);
const verifyFields = {
	path: selector,
	repositoryId: z.string().min(1).optional(),
};
export const VerifyReferenceSchema = z.discriminatedUnion("check", [
	z.object({ check: z.literal("files-exist"), ...verifyFields }).strict(),
	z
		.object({
			check: z.literal("media-valid"),
			path: selector,
			kind: z.enum(["image", "video"]).optional(),
		})
		.strict(),
	z.object({ check: z.literal("code-refs-valid"), ...verifyFields }).strict(),
	z
		.object({
			check: z.literal("ids-resolve"),
			path: selector,
			source: z.string().min(1).max(400),
			ids: selector,
		})
		.strict(),
]);
export type VerifyReference = z.infer<typeof VerifyReferenceSchema>;

export const ACCESS_MODES = ["read-only", "workspace", "push"] as const;
export const AccessSchema = z.union([
	z.enum(ACCESS_MODES),
	z
		.object({
			mode: z.enum(ACCESS_MODES),
			tools: z.array(z.string().min(1).max(200)).max(100).optional(),
			/** Trusted recipe intent; aging still bounds overtaking. */
			priority: z.enum(["normal", "completion"]).optional(),
			/** Local work followed by an explicit publication action in the graph. */
			publication: z.literal("action").optional(),
		})
		.strict()
		.refine(
			(value) => value.publication !== "action" || value.mode === "workspace",
			"Action publication requires workspace access",
		),
]);
export type StepAccess = z.infer<typeof AccessSchema>;

/** Zod fields shared by every step type; spread into the step schemas. */
export const STEP_CONFIG_VERSION = "step-config-v1" as const;
export const stepConfigFields = {
	context: z.lazy(() => RoleContextPolicySchema).optional(),
	configVersion: z.literal(STEP_CONFIG_VERSION).optional(),
	reads: ReadsSchema.optional(),
	output: OutputSchema.optional(),
	rules: RulesSchema.optional(),
	checks: z.array(CheckReferenceSchema).max(20).optional(),
	revision: z.literal("bound").optional(),
	access: AccessSchema.optional(),
	instructions: z
		.array(
			z.enum(INSTRUCTION_IDS, {
				error: (issue) => `Unknown shared instruction: ${String(issue.input)}`,
			}),
		)
		.max(30)
		.optional(),
};
export interface StepConfigFields {
	context?: RoleContextPolicy;
	configVersion?: typeof STEP_CONFIG_VERSION;
	reads?: Record<string, ReadBinding>;
	output?: StepOutput;
	rules?: Rule[];
	checks?: CheckReference[];
	verify?: VerifyReference[];
	session?: "fresh" | "resume";
	revision?: "bound";
	access?: StepAccess;
	instructions?: InstructionId[];
}
interface ConfiguredStep extends StepConfigFields {
	id: string;
	type: string;
	json?: boolean;
}

export interface ResolvedCheck {
	check: CheckId;
	args: Record<string, unknown>;
}
export interface ResolvedRead {
	from: string;
	when?: RuleCondition;
}
export interface ResolvedStepConfig {
	/** Whether this step has an explicit configuration. */
	explicit: boolean;
	reads: Record<string, ResolvedRead>;
	output?: StepOutput;
	rules: Rule[];
	checks: ResolvedCheck[];
	revision?: "bound";
	access: {
		mode: (typeof ACCESS_MODES)[number];
		tools?: string[];
		priority?: "normal" | "completion";
		publication?: "action";
	};
	instructions: InstructionId[];
}
/** Where a step runs; used for ownership and node behavior. */
export interface StepScope {
	engineVersion?: "nodes-v1";
	workflowId?: string;
	rootWorkflowId?: string;
}

function normalizeRead(binding: ReadBinding): ResolvedRead {
	return typeof binding === "string"
		? { from: binding }
		: { from: binding.from, ...(binding.when ? { when: binding.when } : {}) };
}
function normalizeCheck(reference: CheckReference): ResolvedCheck {
	if (typeof reference === "string") return { check: reference, args: {} };
	const { check, ...args } = reference;
	return { check, args };
}

function explicitConfig(step: ConfiguredStep): ResolvedStepConfig {
	const reads: Record<string, ResolvedRead> = {};
	for (const [name, binding] of Object.entries(step.reads ?? {}))
		reads[name] = normalizeRead(binding);
	const access =
		typeof step.access === "string"
			? { mode: step.access }
			: step.access
				? { ...step.access }
				: { mode: "workspace" as const };
	return {
		explicit: true,
		reads,

		...(step.output ? { output: step.output } : {}),
		rules: step.rules ?? [],
		checks: [...(step.checks ?? []), ...(step.verify ?? [])].map(
			normalizeCheck,
		),
		...(step.revision ? { revision: step.revision } : {}),
		access,
		instructions: step.instructions ?? [],
	};
}

const registeredScopes = new WeakMap<object, StepScope>();
export const workflowIdForStep = (step: object) =>
	registeredScopes.get(step)?.workflowId;
export const isNodeEngineStep = (step: object): boolean =>
	registeredScopes.get(step)?.engineVersion === "nodes-v1";
const inheritedConfigOwners = new WeakMap<object, object>();
/** Register an immutable accepted graph without adding fields or changing its digest. */
export function registerWorkflowConfig(
	workflow: {
		id: string;
		engineVersion?: "nodes-v1";
		stepConfigVersion?: string;
		steps: object[];
	},
	rootWorkflowId = workflow.id,
): void {
	const visit = (steps: object[]) => {
		for (const step of steps) {
			registeredScopes.set(step, {
				workflowId: workflow.id,
				rootWorkflowId,

				engineVersion: workflow.engineVersion,
			});
			for (const group of (step as { groups?: object[][] }).groups ?? [])
				visit(group);
			const body = (step as { body?: object[] }).body;
			if (body) visit(body);
		}
	};
	visit(workflow.steps);
}
/** Editable projection of an accepted graph. */
export function materializeWorkflowConfig<
	T extends {
		id: string;
		engineVersion?: "nodes-v1";
		stepConfigVersion?: string;
		steps: object[];
	},
>(workflow: T): T {
	return structuredClone(workflow);
}

/** Accepted definition owning a runtime copy; equal configuration is not ownership. */
export function stepConfigOwner(step: object): object {
	return inheritedConfigOwners.get(step) ?? step;
}
/** Carry accepted configuration ownership to runtime copies. */
export function inheritStepConfig(source: object, target: object): void {
	inheritedConfigOwners.set(target, stepConfigOwner(source));
	const scope = registeredScopes.get(source);
	if (scope) registeredScopes.set(target, scope);
}
/** Resolve only explicitly configured generic capabilities. */
export function resolveStepConfig(
	step: object,
	_scope: StepScope = {},
): ResolvedStepConfig {
	return explicitConfig(step as ConfiguredStep);
}

export function formatOf(step: object, scope?: StepScope): string | undefined {
	const output = resolveStepConfig(step, scope).output;
	return output && "format" in output ? output.format : undefined;
}
export function hasInstruction(step: object, id: InstructionId): boolean {
	return resolveStepConfig(step).instructions.includes(id);
}

/** Resolve an authored local producer reference. */
export function readStep(step: object, name: string): string | undefined {
	const from = resolveStepConfig(step).reads[name]?.from;
	if (!from || from.startsWith("@")) return undefined;
	return from.split("/")[0];
}
/** Resolve a named read against graph outputs (step reads only). */
export function readOutput(
	step: object,
	name: string,
	outputs: Record<string, unknown>,
): unknown {
	const binding = resolveStepConfig(step).reads[name];
	if (!binding || binding.from.startsWith("@")) return undefined;
	return pointerValue(outputs, binding.from);
}

/** Old queued fixers inherited publication from their declaring readiness route. */
export function pointerValue(root: unknown, reference: string): unknown {
	return reference
		.split("/")
		.map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"))
		.reduce<unknown>(
			(value, key) =>
				value && typeof value === "object" && Object.hasOwn(value, key)
					? (value as Record<string, unknown>)[key]
					: undefined,
			root,
		);
}
export function readsSource(step: object, source: ContextSource): boolean {
	return Object.values(resolveStepConfig(step).reads).some(
		(read) => read.from === `@${source}` || read.from.startsWith(`@${source}/`),
	);
}
export function accessMode(step: object): ResolvedStepConfig["access"]["mode"] {
	return resolveStepConfig(step).access.mode;
}

/** Validate inline schemas in an isolated, resource-limited validator. */
export const inlineSchemaIssues = compileInlineSchemaSync;
export const inlineSchemaIssuesAsync = compileInlineSchema;

/** Only protocols implemented by Check may be declared on that node. */
export function checkStepEvidenceIssues(_step: object): string[] {
	return [];
}
export function stepConfigIssues(
	step: ConfiguredStep & { prompt?: string },
	siblings: { id: string }[],
	inherited: string[] = [],
): string[] {
	const issues: string[] = checkStepEvidenceIssues(step);
	const ids = new Set([...siblings.map((s) => s.id), ...inherited]);
	for (const [name, binding] of Object.entries(step.reads ?? {})) {
		const from = normalizeRead(binding).from;
		const head = from.split("/")[0]!;
		if (!head.startsWith("@") && !ids.has(head))
			issues.push(`${step.id}: read "${name}" names unknown step ${head}`);
	}
	if (step.output && "schema" in step.output)
		for (const issue of inlineSchemaIssues(step.output.schema))
			issues.push(`${step.id}: output schema ${issue}`);
	if (step.output && !["agent", "transform"].includes(step.type ?? ""))
		issues.push(`${step.id}: output formats apply to agent steps`);
	if (step.output && step.json === false)
		issues.push(`${step.id}: output formats require JSON output`);
	const conditions: unknown[] = [...(step.rules ?? [])];
	while (conditions.length) {
		const condition = conditions.pop();
		if (condition && typeof condition === "object") {
			for (const [key, value] of Object.entries(condition)) {
				if (
					key === "conforms" &&
					!(FORMAT_IDS as readonly unknown[]).includes(value)
				)
					issues.push(`${step.id}: unknown rule format ${String(value)}`);
				else if (value && typeof value === "object")
					conditions.push(...(Array.isArray(value) ? value : [value]));
			}
		}
	}
	for (const check of [...(step.checks ?? []), ...(step.verify ?? [])].map(
		normalizeCheck,
	)) {
		if (
			![
				"files-exist",
				"media-valid",
				"code-refs-valid",
				"ids-resolve",
			].includes(check.check)
		)
			continue;
		if (typeof check.args.path === "string") {
			if (
				check.check === "media-valid" &&
				check.args.kind !== undefined &&
				!["image", "video"].includes(String(check.args.kind))
			)
				issues.push(`${step.id}: media-valid kind must be image or video`);
			if (!/^\/(?:[^/]*(?:\/[^/]*)*)?$/.test(check.args.path))
				issues.push(`${step.id}: ${check.check} path must be a JSON Pointer`);
			if (
				check.check === "ids-resolve" &&
				(typeof check.args.source !== "string" ||
					typeof check.args.ids !== "string" ||
					!String(check.args.ids).startsWith("/") ||
					!resolveStepConfig(step).reads[String(check.args.source)])
			)
				issues.push(
					`${step.id}: ids-resolve requires a named source read and ids JSON Pointer`,
				);
			continue;
		}
		issues.push(`${step.id}: ${check.check} requires a path selector`);
	}
	const declared = new Set(step.instructions ?? []);
	for (const match of (step.prompt ?? "").matchAll(
		/\{\{instruction:([^}]*)\}\}/g,
	)) {
		const id = match[1]!;
		if (!(INSTRUCTION_IDS as readonly string[]).includes(id))
			issues.push(`${step.id}: unknown shared instruction ${id}`);
		else if (!declared.has(id as InstructionId))
			issues.push(
				`${step.id}: shared instruction ${id} must be listed in instructions`,
			);
	}
	const access = step.access;
	if (
		access &&
		typeof access === "object" &&
		access.mode === "read-only" &&
		access.tools?.some((tool) => !readOnlyTools.includes(tool))
	)
		issues.push(
			`${step.id}: read-only access permits only ${readOnlyTools.join(", ")}`,
		);
	if (
		accessOf(step) === "read-only" &&
		step.type !== "agent" &&
		nodeMetadata(step.type)?.accessEffects?.["read-only"] !== "read-only"
	)
		issues.push(`${step.id}: read-only access applies to agent steps`);
	return issues;
}
function accessOf(step: ConfiguredStep) {
	return typeof step.access === "string" ? step.access : step.access?.mode;
}
export const readOnlyTools = [
	"mcp__factory-context__list_context",
	"mcp__factory-context__read_context",
	"mcp__factory-context__list_repository",
	"mcp__factory-context__read_repository",
];
