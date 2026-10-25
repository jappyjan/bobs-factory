import {
	type RoleContextPolicy,
	RoleContextPolicySchema,
} from "bobs-factory-mcp-tools";
import { z } from "zod";
import {
	compileInlineSchema,
	compileInlineSchemaSync,
} from "./InlineSchema.js";
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
	"clarify-v1",
	"plan-v1",
	"plan-review-v1",
	"implement-v1",
	"review-v1",
	"qa-review-v1",
	"visual-scope-v1",
	"legacy-video-scope-v1",
	"qa-scope-v1",
	"capture-v1",
	"qa-capture-v1",
	"guide-v1",
	"generated-guide-v1",
	"generated-review-brief-v1",
	"generated-review-brief-v2",
	"generated-review-brief-v3",
	"question-fields-v1",
	"question-choices-v1",
	"delivery-target-v1",
	"review-brief-v1",
	"review-brief-v2",
	"review-brief-v3",
	"ci-fix-v1",
	"review-fix-v1",
	"architecture-v1",
	"architecture-brief-v1",
	"architecture-checkin-v1",
	"architecture-review-v1",
	"impact-v1",
	"inventory-v1",
	"specialist-v1",
	"coverage-v1",
	"delivery-contract-v1",
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
	"review-evidence",
	"review-assistance",
	"qa-gate-evidence",
	"delivery-evidence",
	"post-fix-evidence",
	"review-boundary",
	"impact-boundary",
	"capture-evidence",
	"optional-questions",
	"qa-review-evidence",
	"inventory-evidence",
	"specialist-evidence",
	"ticket-milestone",
	"scope-inputs",
	"files-exist",
	"media-valid",
	"code-refs-valid",
	"ids-resolve",
	"requirement-coverage",
	"delivery-contract",
	"qa-environment",
	"qa-evidence",
	"feedback-assessment",
	"review-dispositions",
	"architecture-proposal",
	"architecture-candidate",
	"architecture-revision",
	"impact-reuse",
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
	// Composed into stock prompts with {{instruction:<id>}} placeholders.
	"implementation-scope",
	"architecture-continuation",
	"architecture-questions-brief",
	"feedback-policy",
	"ci-assessment",
	"review-fix",
	"ticket-plan",
	"delivery",
	"delivery-clarify",
	"delivery-plan",
	"delivery-plan-review",
	"implementation-architecture-revision",
	"video-scope",
	"video-capture",
	"video-review",
	"video-gate",
	"video-brief",
	"inventory-qa",
	"inventory-guide",
	"impact-inventory",
	"impact-scope",
	"impact-capture",
	"impact-guide",
	"visual-fix",
	// Runtime slots of the role instruction.
	"architecture-questions",
	"review-completion",
	"brief-runtime",
	"incremental-review-fix",
	"incremental-visual-scope",
	"incremental-capture",
	"incremental-visual-review",
	"incremental-guide",
	"incremental-ci-fix",
	"ci-fix-runtime",
	"review-stage-inventory",
	"review-stage-specialist",
	"review-stage-coverage",
] as const;
export type InstructionId = (typeof INSTRUCTION_IDS)[number];

/** Named context sources a step can read in addition to earlier outputs. */
export const CONTEXT_SOURCES = [
	"agentSettings",
	"answers",
	"decisions",
	"architectureProposals",
	"architectureDecisions",
	"reviewLedger",
	"reviewRounds",
	"repository",
	"source",
	"ticket",
	"history",
	"transcripts",
	"launchInputs",
	"mergeReadiness",
	"feedback",
	"reviewFix",
	"qaReuse",
	"item",
	"index",
	"callInputs",
	"caller",
	"childRuns",
	"delivery",
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
	}, "Reads name an earlier step, a step/path, or a context source such as @answers");
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
	.regex(/^(\/([^~]|~[01])*)?$/, "Expected a JSON pointer selector");
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
const CONFIG_KEYS = [
	"configVersion",
	"reads",
	"output",
	"rules",
	"checks",
	"verify",
	"session",
	"revision",
	"access",
	"instructions",
] as const;

/** The legacy flags and aliases normalization understands. */
interface LegacyStep extends StepConfigFields {
	id: string;
	type: string;
	branches?: { when: { path: string; equals?: unknown }; next: string }[];
	tool?: string;
	json?: boolean;
	inputs?: string[];
	arguments?: Record<string, unknown>;
	review?: { inventory: string; fanout?: string };
	impact?: { inventory: string; fanout: string; maxUnchangedCycles: number };
	impactSource?: string;
	architectureSource?: string;
	qaContract?: "qa-v1";
	videoContract?: "video-v1";
	guideContract?: string;
	architectureContract?: "architecture-v1" | "architecture-review-v1";
	architectureBrief?: "review-v1" | "checkin-v1";
	reviewContract?: "inventory-v1" | "specialist-v1" | "coverage-v1";
	impactContract?: "impact-v1";
	delivery?: "exclusive";
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
	/** Explicitly configured, or normalized from legacy flags/historical IDs. */
	explicit: boolean;
	reads: Record<string, ResolvedRead>;
	/** Restricted context: the named reads are the agent's only outputs. */
	inputs?: string[];
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
/** Where a step runs; legacy result validation depended on it. */
export interface StepScope {
	legacy?: boolean;
	engineVersion?: "nodes-v1";
	workflowId?: string;
	rootWorkflowId?: string;
	/** Historical graphs interpreted architecture handback only within their local decision graph. */
	architectureRevision?: boolean;
}

const LEGACY_FLAGS = [
	"qaContract",
	"videoContract",
	"guideContract",
	"architectureContract",
	"architectureBrief",
	"reviewContract",
	"impactContract",
] as const;
export function hasLegacyFlags(step: object): boolean {
	return LEGACY_FLAGS.some(
		(key) => (step as Record<string, unknown>)[key] !== undefined,
	);
}

export function isExplicitStep(step: object): boolean {
	return (
		(step as { type?: string }).type === "foreach" ||
		Object.hasOwn(step, "inputMapping") ||
		CONFIG_KEYS.some((key) => Object.hasOwn(step, key))
	);
}

/** Stock rule presets. Messages match the historical validators exactly. */
export const stockRules = {
	implementCompletion: {
		id: "completion",
		message:
			"Blocked implementation requires a question to resolve the blocker; completed implementation must have no questions",
		require: {
			any: [
				{
					all: [
						{ path: "/status", equals: "blocked" },
						{
							any: [
								{ path: "/questions", empty: false },
								{ path: "/architectureRevision", equals: true },
							],
						},
					],
				},
				{
					all: [
						{ path: "/status", notEquals: "blocked" },
						{ path: "/questions", empty: true },
						{ path: "/architectureRevision", notEquals: true },
					],
				},
			],
		},
	},
	architectureHandback: {
		id: "architecture-handback",
		message:
			"Architecture revision requires status=blocked and questions=[]; the configured proposal route owns review and any required acceptance",
		when: { path: "/architectureRevision", equals: true },
		require: {
			all: [
				{ path: "/status", equals: "blocked" },
				{ path: "/questions", exists: true },
				{ path: "/questions", maxLength: 0 },
			],
		},
	},
	reviewRecoveryReason: {
		id: "recovery-reason",
		message: "Blocked or failed review requires a concrete recovery reason",
		when: { path: "/status", notEquals: "completed" },
		require: {
			any: [
				{ path: "/blockers", empty: false },
				{ path: "/summary", empty: false },
			],
		},
	},
	reviewCompletedClean: {
		id: "completed-without-blockers",
		message: "Completed review cannot retain missing-input/tooling blockers",
		when: { path: "/status", equals: "completed" },
		require: { path: "/blockers", empty: true },
	},
	videoContract: {
		id: "video-contract",
		path: "/videoContract",
		message: 'Invalid input: expected "video-v1"',
		require: { path: "/videoContract", equals: "video-v1" },
	},
} satisfies Record<string, Rule>;

const BRIEF_FORMATS: Record<string, FormatId> = {
	"brief-v1": "review-brief-v1",
	"brief-v2": "review-brief-v2",
	"brief-v3": "review-brief-v3",
};
const fixers = new Set(["ci-fix", "code-fix", "visual-fix"]);

/**
 * Historical result validation applied to Factory roles by step ID, but only
 * inside the bundled factory/takeover runs or the shared factory pipeline,
 * and for any role carrying a contract flag. Review fixers were always parsed.
 */
function legacyFormat(
	step: LegacyStep,
	scope: StepScope,
): { output?: StepOutput; rules: Rule[] } {
	if (step.type !== "agent") return { rules: [] };
	if (step.impactContract)
		return { output: { format: "impact-v1" }, rules: [] };
	if (step.architectureContract === "architecture-v1")
		return {
			output: {
				format:
					step.architectureBrief === "checkin-v1"
						? "architecture-checkin-v1"
						: step.architectureBrief === "review-v1"
							? "architecture-brief-v1"
							: "architecture-v1",
			},
			rules: [],
		};
	if (step.architectureContract === "architecture-review-v1")
		return { output: { format: "architecture-review-v1" }, rules: [] };
	if (step.reviewContract)
		return { output: { format: step.reviewContract }, rules: [] };
	const qa = step.qaContract === "qa-v1";
	const inScope =
		qa ||
		["factory", "takeover"].includes(scope.rootWorkflowId ?? "") ||
		scope.workflowId === "factory-pipeline";
	if (!inScope && !fixers.has(step.id)) return { rules: [] };
	const video = step.videoContract ? [stockRules.videoContract] : [];
	switch (step.id) {
		case "clarify":
			return { output: { format: "clarify-v1" }, rules: [] };
		case "plan":
			return { output: { format: "plan-v1" }, rules: [] };
		case "plan-review":
			return { output: { format: "plan-review-v1" }, rules: [] };
		case "implement":
			return {
				output: { format: "implement-v1" },
				rules: [stockRules.implementCompletion],
			};
		case "code-review":
			return {
				output: { format: "review-v1" },
				rules: [
					stockRules.reviewRecoveryReason,
					stockRules.reviewCompletedClean,
				],
			};
		case "visual-review":
			return {
				output: { format: qa ? "qa-review-v1" : "review-v1" },
				rules: [
					stockRules.reviewRecoveryReason,
					stockRules.reviewCompletedClean,
				],
			};
		case "visual-scope":
			return {
				output: {
					format: qa
						? "qa-scope-v1"
						: step.videoContract
							? "legacy-video-scope-v1"
							: "visual-scope-v1",
				},
				rules: qa ? video : [],
			};
		case "capture":
			return {
				output: { format: qa ? "qa-capture-v1" : "capture-v1" },
				rules: video,
			};
		case "guide":
			return {
				output: {
					format: BRIEF_FORMATS[step.guideContract ?? ""] ?? "guide-v1",
				},
				rules: [],
			};
		case "ci-fix":
			return {
				output: { format: "ci-fix-v1" },
				rules: [stockRules.architectureHandback],
			};
		case "code-fix":
		case "visual-fix":
			return {
				output: { format: "review-fix-v1" },
				rules: [stockRules.architectureHandback],
			};
		default:
			return { output: { format: "json-v1" }, rules: [] };
	}
}

const incremental: Record<string, InstructionId> = {
	"code-fix": "incremental-review-fix",
	"visual-fix": "incremental-review-fix",
	"visual-scope": "incremental-visual-scope",
	capture: "incremental-capture",
	"visual-review": "incremental-visual-review",
	guide: "incremental-guide",
	"ci-fix": "incremental-ci-fix",
};

/** Deterministic normalization of a step saved before step-config-v1. */
export function legacyStepPreset(
	step: LegacyStep,
	scope: StepScope = {},
): ResolvedStepConfig {
	const reads: Record<string, ResolvedRead> = {};
	const checks: ResolvedCheck[] = [];
	const instructions: InstructionId[] = [];
	const id = step.id;
	const qa = step.qaContract === "qa-v1";
	const video = step.videoContract === "video-v1";
	const { output, rules } = legacyFormat(step, scope);
	let revision: "bound" | undefined;
	if (step.type === "agent") {
		if (scope.architectureRevision)
			checks.push({ check: "architecture-revision", args: {} });
		if (id === "plan" || id === "implement")
			checks.push({
				check: "ticket-milestone",
				args: { kind: id === "plan" ? "plan" : "implementation" },
			});
		for (const name of step.inputs ?? []) reads[name] = { from: name };
		if (step.architectureContract === "architecture-review-v1") {
			reads.proposal = { from: step.architectureSource ?? "architecture" };
			instructions.push("architecture-questions");
			checks.push({ check: "architecture-candidate", args: {} });
		}
		if (step.architectureContract === "architecture-v1")
			checks.push({ check: "architecture-proposal", args: {} });
		if (step.impactContract) {
			if (step.impact) {
				reads.inventory = { from: step.impact.inventory };
				reads.fanout = { from: step.impact.fanout };
			}
			reads.ci = { from: "ci" };
			reads.feedback = { from: "@feedback" };
			checks.push({
				check: "impact-reuse",
				args: { maxUnchangedCycles: step.impact?.maxUnchangedCycles ?? 3 },
			});
		}
		if (step.reviewContract) {
			checks.push({
				check:
					step.reviewContract === "inventory-v1"
						? "inventory-evidence"
						: "specialist-evidence",
				args: step.reviewContract === "coverage-v1" ? { coverage: true } : {},
			});
			revision = "bound";
			instructions.push(
				`review-stage-${step.reviewContract.slice(0, -3)}` as InstructionId,
			);
		}
		if (id === "guide" && step.guideContract)
			instructions.push("brief-runtime");
		else if (incremental[id]) instructions.push(incremental[id]);
		if (
			["code-review", "visual-review"].includes(id) ||
			["specialist-v1", "coverage-v1"].includes(step.reviewContract ?? "")
		)
			instructions.push("review-completion");
		if (id === "ci-fix") {
			instructions.push("ci-fix-runtime");
			checks.push({ check: "optional-questions", args: {} });
			reads.ci = { from: "ci" };
			reads.feedback = { from: "@feedback" };
			reads.mergeReadiness = { from: "@mergeReadiness" };
			checks.push({ check: "feedback-assessment", args: {} });
		}
		if (id === "code-fix" || id === "visual-fix") {
			reads.reviewFix = { from: "@reviewFix" };
			checks.push({ check: "optional-questions", args: {} });
			checks.push({ check: "review-dispositions", args: {} });
		}
		if (id === "visual-fix") reads.qaGate = { from: "visual-gate" };
		if (id === "code-fix" || id === "visual-fix") {
			reads.review = {
				from: id === "code-fix" ? "code-review" : "visual-review",
			};
			reads.reviewGate = {
				from: id === "code-fix" ? "review-gate" : "visual-gate",
			};
		}
		if (id === "plan") checks.push({ check: "delivery-contract", args: {} });
		if (id === "visual-scope" && qa)
			checks.push({ check: "ids-resolve", args: { adapter: "qa-scope" } });
		if (id === "visual-review" && qa) {
			checks.push({ check: "qa-review-evidence", args: {} });
			revision = "bound";
			reads.capture = { from: "capture" };
			reads.scope = { from: "visual-scope" };
		}
		if (id === "capture") {
			checks.push({ check: "capture-evidence", args: {} });
			reads.qaReuse = { from: "@qaReuse" };
			reads.qaReview = { from: "visual-review" };
			reads.scope = { from: "visual-scope" };
			reads.qaGate = { from: "visual-gate" };
			if (qa) reads.answers = { from: "@answers" };
			else
				reads.answers = {
					from: "@answers",
					when: {
						any: [
							{ path: "/visual-gate/captureBlocked", equals: true },
							{ path: "/visual-gate/qaBlocked", equals: true },
						],
					},
				};
			checks.push({ check: "qa-environment", args: {} });
			checks.push({
				check: "media-valid",
				args: { adapter: "capture", ...(video ? { video: true } : {}) },
			});
		}
		if (id === "guide") {
			reads.ci = { from: "ci" };
			reads.capture = { from: "capture" };
			reads.qaReview = { from: "visual-review" };
			reads.scope = { from: "visual-scope" };
			reads.mergeReadiness = { from: "@mergeReadiness" };
			checks.push({ check: "requirement-coverage", args: {} });
			checks.push({ check: "code-refs-valid", args: { adapter: "guide" } });
			checks.push({
				check: "media-valid",
				args: { adapter: "guide", ...(video ? { video: true } : {}) },
			});
		}
		if (id === "visual-scope" && !step.inputs)
			reads.mergeReadiness = { from: "@mergeReadiness" };
	} else {
		legacyToolReads(step, reads, checks);
	}
	// QA requirement validation historically read these receipts even with an
	// explicitly restricted agent input list. They remain named evidence inputs.
	if (qa) {
		reads.scopeClarify = { from: "clarify" };
		reads.scopeDecisions = { from: "decisions" };
	}
	if (step.review) {
		reads.inventory = { from: step.review.inventory };
		if (step.review.fanout) reads.fanout = { from: step.review.fanout };
		checks.push({ check: "review-boundary", args: {} });
	}
	if (step.impactSource) {
		reads.impact = { from: step.impactSource };
		checks.push({ check: "impact-boundary", args: {} });
	}
	if (
		step.type === "agent" &&
		["ci-fix", "code-fix", "visual-fix", "human-fix"].includes(id)
	)
		reads.publication = { from: "draft-pr" };
	if (!step.inputs) {
		Object.assign(reads, {
			scopeClarify: { from: "clarify" },
			scopeDecisions: { from: "decisions" },
			scopePlan: { from: "plan" },
			scopeExistingWork: { from: "existing-work" },
			scopeAssessment: { from: "assess-existing" },
			scopeSource: { from: "@source" },
			scopeTicket: { from: "@ticket" },
		});
		checks.push({
			check: "scope-inputs",
			args: {
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		});
	}
	const exclusive =
		step.delivery === "exclusive" ||
		(step.type === "agent" &&
			["ci-fix", "code-fix", "visual-fix", "human-fix"].includes(id));
	return {
		explicit: false,
		reads,
		...(step.inputs ? { inputs: [...step.inputs] } : {}),
		...(output ? { output } : {}),
		rules,
		checks,
		...(revision ? { revision } : {}),
		access: { mode: exclusive ? "push" : "workspace" },
		instructions,
	};
}

/** Historical partner lookups of bundled tools, now expressed as reads. */
function legacyToolReads(
	step: LegacyStep,
	reads: Record<string, ResolvedRead>,
	checks: ResolvedCheck[],
) {
	const qa = step.qaContract === "qa-v1";
	const video = step.videoContract === "video-v1";
	if (
		[
			"handoff",
			"merge",
			"human-review",
			"ci",
			"merge-readiness",
			"review-after-fix",
			"ci-fix-readiness",
			"draft-pr",
			"external-guide",
			"record-decisions",
		].includes(step.tool ?? "")
	) {
		for (const [name, from] of Object.entries({
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			review: "code-review",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
		}))
			reads[name] = { from };
	}
	if (step.id === "external-human-review")
		reads.external = { from: "@decisions" };
	const qaChecks = () => {
		if (qa) checks.push({ check: "qa-evidence", args: {} });
		if (video)
			checks.push({
				check: "media-valid",
				args: { adapter: "qa-gate", video: true },
			});
	};
	switch (step.tool) {
		case "review-gate":
			reads.review = { from: "code-review" };
			reads.fix = { from: "code-fix" };
			break;
		case "visual-gate":
			reads.qaReview = { from: "visual-review" };
			reads.scope = { from: "visual-scope" };
			reads.capture = { from: "capture" };
			reads.review = { from: "visual-review" };
			reads.fix = { from: "visual-fix" };
			qaChecks();
			break;
		case "handoff":
			reads.guide = { from: "guide" };
			reads.ci = { from: "ci" };
			reads.scope = { from: "visual-scope" };
			reads.capture = { from: "capture" };
			reads.qaReview = { from: "visual-review" };
			reads.qaGate = { from: "visual-gate" };
			reads.implementation = { from: "implement" };
			qaChecks();
			break;
		case "merge":
		case "human-review":
			reads.guide = { from: "guide" };
			reads.ci = { from: "ci" };
			reads.implementation = { from: "implement" };
			reads.scope = { from: "visual-scope" };
			reads.qaGate = { from: "visual-gate" };
			break;
		case "ci":
		case "merge-readiness":
		case "review-after-fix":
		case "ci-fix-readiness":
			reads.ci = { from: "ci" };
			reads.guide = { from: "guide" };
			reads.scope = { from: "visual-scope" };
			reads.qaGate = { from: "visual-gate" };
			reads.fix = { from: "ci-fix" };
			break;
		case "draft-pr":
		case "external-guide":
		case "record-decisions":
			reads.clarify = { from: "clarify" };
			reads.plan = { from: "plan" };
			reads.implementation = { from: "implement" };
			reads.guide = { from: "guide" };
			break;
		case "external-final":
		case "external-verify":
		case "external-apply":
		case "delivery-route":
		case "delivery-mode":
			reads.review = { from: "plan-review" };
			reads.clarify = { from: "clarify" };
			reads.planReview = { from: "plan-review" };
			reads.plan = { from: "plan" };
			break;
		case "architecture-decision": {
			const args = step.arguments ?? {};
			reads.proposal = { from: String(args.proposal ?? "architecture") };
			reads.review = { from: String(args.review ?? "plan-review") };
			reads.plan = { from: String(args.planOutput ?? "plan") };
			reads.revise = { from: String(args.revise ?? "architecture") };
			break;
		}
		default:
			break;
	}
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

function explicitConfig(step: LegacyStep): ResolvedStepConfig {
	const reads: Record<string, ResolvedRead> = {};
	// Thin aliases: legacy binding fields name the same partners.
	for (const name of step.inputs ?? []) reads[name] = { from: name };
	if (step.review) {
		reads.inventory = { from: step.review.inventory };
		if (step.review.fanout) reads.fanout = { from: step.review.fanout };
	}
	if (step.impact) {
		reads.inventory = { from: step.impact.inventory };
		reads.fanout = { from: step.impact.fanout };
	}
	if (step.impactSource) reads.impact = { from: step.impactSource };
	if (step.architectureSource)
		reads.proposal = { from: step.architectureSource };
	for (const [name, binding] of Object.entries(step.reads ?? {}))
		reads[name] = normalizeRead(binding);
	const access =
		typeof step.access === "string"
			? { mode: step.access }
			: step.access
				? { ...step.access }
				: {
						mode:
							step.delivery === "exclusive"
								? ("push" as const)
								: ("workspace" as const),
					};
	return {
		explicit: true,
		reads,
		...(step.inputs ? { inputs: [...step.inputs] } : {}),
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
	const visit = (steps: object[], modern = false) => {
		const architectureRevision = steps.some(
			(step) => (step as LegacyStep).tool === "architecture-decision",
		);
		for (const step of steps) {
			registeredScopes.set(step, {
				workflowId: workflow.id,
				rootWorkflowId,
				legacy:
					!workflow.engineVersion &&
					!modern &&
					!workflow.stepConfigVersion &&
					!isExplicitStep(step),
				engineVersion: workflow.engineVersion,
				architectureRevision,
			});
			for (const group of (step as { groups?: object[][] }).groups ?? [])
				visit(group, modern);
			const body = (step as { body?: object[] }).body;
			if (body) visit(body, true);
		}
	};
	visit(workflow.steps);
}
/** Editable projection: materialize every old setting together before any single setting changes. */
export function materializeWorkflowConfig<
	T extends {
		id: string;
		engineVersion?: "nodes-v1";
		stepConfigVersion?: string;
		steps: object[];
	},
>(workflow: T): T {
	registerWorkflowConfig(workflow);
	if (workflow.engineVersion) return structuredClone(workflow);
	const copy = structuredClone(workflow);
	const visit = (originals: object[], copies: object[]) => {
		for (const [index, original] of originals.entries()) {
			const step = copies[index]! as LegacyStep & {
				groups?: object[][];
				body?: object[];
			};
			const config = resolveStepConfig(original);
			Object.assign(step, {
				configVersion: STEP_CONFIG_VERSION,
				reads: Object.fromEntries(
					Object.entries(config.reads).map(([name, read]) => [
						name,
						read.when ? { ...read } : read.from,
					]),
				),
			});
			// Human views share declared reads, but never acquire agent tool/rule authority
			// merely because Recipes projects an editable definition.
			if (!["decide", "approve", "show"].includes(step.type ?? "")) {
				Object.assign(step, {
					rules: structuredClone(config.rules),
					checks: config.checks.map(({ check, args }) =>
						Object.keys(args).length ? { check, ...args } : check,
					),
					access: config.access,
					instructions: [...config.instructions],
				});
				if (config.output) step.output = structuredClone(config.output);
				if (config.revision) step.revision = config.revision;
			}
			for (const [groupIndex, group] of (
				(original as { groups?: object[][] }).groups ?? []
			).entries())
				visit(group, step.groups![groupIndex]!);
			const body = (original as { body?: object[] }).body;
			if (body) visit(body, step.body!);
		}
	};
	visit(workflow.steps, copy.steps);
	copy.stepConfigVersion = STEP_CONFIG_VERSION;
	return copy;
}
/** Accepted definition owning a runtime copy; equal configuration is not ownership. */
export function stepConfigOwner(step: object): object {
	return inheritedConfigOwners.get(step) ?? step;
}
/** Carry accepted configuration ownership and legacy interpretation to runtime copies. */
export function inheritStepConfig(source: object, target: object): void {
	inheritedConfigOwners.set(target, stepConfigOwner(source));
	const scope = registeredScopes.get(source);
	if (scope) registeredScopes.set(target, scope);
}
/** Default is modern. Only an explicitly registered old definition enables ID normalization. */
export function resolveStepConfig(
	step: object,
	scope: StepScope = {},
): ResolvedStepConfig {
	const effective = { ...registeredScopes.get(step), ...scope };
	return (effective.legacy ?? hasLegacyFlags(step)) && !isExplicitStep(step)
		? legacyStepPreset(step as LegacyStep, effective)
		: explicitConfig(step as LegacyStep);
}

export function formatOf(step: object, scope?: StepScope): string | undefined {
	const output = resolveStepConfig(step, scope).output;
	return output && "format" in output ? output.format : undefined;
}
export function hasCheck(step: object, check: CheckId): boolean {
	return resolveStepConfig(step).checks.some((c) => c.check === check);
}
export function checkArgs(
	step: object,
	check: CheckId,
): Record<string, unknown> | undefined {
	return resolveStepConfig(step).checks.find((c) => c.check === check)?.args;
}
/** Evidence protocols are independent of selecting the same pure output schema. */
export function reviewEvidenceContract(
	step: object,
): "inventory-v1" | "specialist-v1" | "coverage-v1" | undefined {
	if (hasCheck(step, "inventory-evidence")) return "inventory-v1";
	const args = checkArgs(step, "specialist-evidence");
	return args
		? args.coverage === true
			? "coverage-v1"
			: "specialist-v1"
		: undefined;
}

/** A named read alone never activates independent review baselines or fanout rules. */
export function consumesReview(step: object): boolean {
	return hasCheck(step, "review-boundary");
}

/** A named read alone never activates impact evidence or rerouting. */
export function consumesImpact(step: object): boolean {
	return hasCheck(step, "impact-boundary");
}

export function hasInstruction(step: object, id: InstructionId): boolean {
	return resolveStepConfig(step).instructions.includes(id);
}

/** An opt-in handback uses its declared decision in the same lexical graph. */
export function architectureRevisionDecision<
	T extends { id: string; tool?: string },
>(step: object, siblings: T[]): T | undefined {
	if (!hasCheck(step, "architecture-revision")) return undefined;
	const decisions = siblings.filter(
		(sibling) => sibling.tool === "architecture-decision",
	);
	const selected = readStep(step, "architectureDecision");
	return selected
		? decisions.find((decision) => decision.id === selected)
		: decisions.length === 1 || !resolveStepConfig(step).explicit
			? decisions[0]
			: undefined;
}
/** The step ID a named read binds to (undefined for context sources). */
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
export function fixerPublication(
	step: object,
	readiness: object,
	outputs: Record<string, unknown>,
): unknown {
	return (
		readOutput(step, "publication", outputs) ??
		(!resolveStepConfig(step).explicit
			? readOutput(readiness, "draftPr", outputs)
			: undefined)
	);
}
/** "step/a/b" → outputs.step.a.b */
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
export function checkStepEvidenceIssues(step: LegacyStep): string[] {
	if (step.type !== "check") return [];
	const issues: string[] = [];
	const config = resolveStepConfig(step);
	const protocols = new Set<CheckId>([
		"review-evidence",
		"review-assistance",
		"qa-gate-evidence",
		"delivery-evidence",
		"post-fix-evidence",
		"review-boundary",
		"impact-boundary",
		"scope-inputs",
		"qa-evidence",
	]);
	for (const { check, args } of config.checks) {
		if ((CHECK_SELECTOR_IDS as readonly string[]).includes(check)) {
			if (typeof args.path !== "string") {
				if (
					!(
						check === "media-valid" &&
						args.adapter === "qa-gate" &&
						hasCheck(step, "qa-gate-evidence")
					)
				)
					issues.push(
						`${step.id}: ${check} on Check requires an explicit path selector`,
					);
				continue;
			}
			if (
				args.path.length > 400 ||
				!/^\/(?:[^/]*(?:\/[^/]*)*)?$/.test(args.path)
			)
				issues.push(
					`${step.id}: ${check} path must be a JSON Pointer of at most 400 characters`,
				);
			if (
				check === "media-valid" &&
				args.kind !== undefined &&
				!["image", "video"].includes(String(args.kind))
			)
				issues.push(`${step.id}: media-valid kind must be image or video`);
			if (
				check === "ids-resolve" &&
				(typeof args.source !== "string" ||
					!config.reads[args.source] ||
					typeof args.ids !== "string" ||
					args.ids.length > 400 ||
					!args.ids.startsWith("/"))
			)
				issues.push(
					`${step.id}: ids-resolve requires a named source read and ids JSON Pointer`,
				);
		} else if (!protocols.has(check) || typeof args.path === "string")
			issues.push(
				`${step.id}: ${check} is not an executable Check evidence protocol; use its agent or action step`,
			);
	}
	for (const [marker, source] of [
		["review-assistance", "review-evidence"],
		["review-boundary", "review-evidence"],
		["qa-evidence", "qa-gate-evidence"],
	] as const)
		if (hasCheck(step, marker) && !hasCheck(step, source))
			issues.push(`${step.id}: ${marker} on Check requires ${source}`);
	if (step.rules?.length)
		issues.push(
			`${step.id}: Check predicates belong in check.results or check.passed; rules validate agent outputs`,
		);
	return issues;
}

/** Save-time validation of one step's configuration and references. */
export function stepConfigIssues(
	step: LegacyStep & { prompt?: string },
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
	for (const name of step.inputs ?? [])
		if (step.reads && !step.reads[name] && !ids.has(name))
			issues.push(`${step.id}: input "${name}" has no read binding`);
	if (step.output && "schema" in step.output)
		for (const issue of inlineSchemaIssues(step.output.schema))
			issues.push(`${step.id}: output schema ${issue}`);
	if (step.output && step.type !== "agent")
		issues.push(`${step.id}: output formats apply to agent steps`);
	if (step.output && step.json === false)
		issues.push(`${step.id}: output formats require JSON output`);
	if (consumesReview(step)) {
		if (!readStep(step, "inventory"))
			issues.push(`${step.id}: review-boundary requires reads.inventory`);
		if (
			step.type !== "fanout" &&
			step.tool !== "review-gate" &&
			!(step.type === "check" && hasCheck(step, "review-evidence"))
		)
			issues.push(
				`${step.id}: review-boundary requires a review fanout or review-gate action`,
			);
		if (
			(step.tool === "review-gate" || step.type === "check") &&
			!readStep(step, "fanout")
		)
			issues.push(
				`${step.id}: review-boundary requires reads.fanout on a review-gate action`,
			);
	}
	if (hasCheck(step, "impact-boundary") && !readStep(step, "impact"))
		issues.push(`${step.id}: impact-boundary requires reads.impact`);
	const reuseVersion = checkArgs(step, "impact-reuse")?.reuseVersion;
	if (reuseVersion !== undefined && reuseVersion !== "composed-v1")
		issues.push(
			`${step.id}: unsupported impact reuseVersion ${String(reuseVersion)}`,
		);
	if (hasCheck(step, "capture-evidence") && !readStep(step, "scope"))
		issues.push(`${step.id}: capture-evidence requires reads.scope`);
	if (hasCheck(step, "architecture-revision")) {
		const handback = step.branches?.some(
			(branch: { when: { path: string; equals?: unknown }; next: string }) =>
				branch.when.path === "architectureRevision" &&
				branch.when.equals === true &&
				inherited.includes(branch.next),
		);
		const decision = architectureRevisionDecision(step, siblings);
		const target = decision && readStep(decision, "revise");
		if (
			!handback &&
			(step.type !== "agent" ||
				!decision ||
				!siblings.some(
					(sibling) =>
						sibling.id === target && hasCheck(sibling, "architecture-proposal"),
				))
		)
			issues.push(
				`${step.id}: architecture-revision requires a local architecture decision with its proposal revision route; use reads.architectureDecision to select among multiple decisions`,
			);
	}
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
		const output =
			step.output && "format" in step.output ? step.output.format : undefined;
		const guide = output === "guide-v1" || output?.startsWith("review-brief-v");
		const validAdapter =
			check.check === "media-valid"
				? (check.args.adapter === "capture" &&
						hasCheck(step, "capture-evidence") &&
						["capture-v1", "qa-capture-v1"].includes(output ?? "")) ||
					(check.args.adapter === "guide" &&
						guide &&
						hasCheck(step, "requirement-coverage")) ||
					(check.args.adapter === "qa-gate" &&
						((step.type === "tool" &&
							["visual-gate", "handoff"].includes(step.tool ?? "")) ||
							(step.type === "check" && hasCheck(step, "qa-gate-evidence"))))
				: check.check === "code-refs-valid"
					? check.args.adapter === "guide" &&
						guide &&
						hasCheck(step, "requirement-coverage")
					: check.check === "ids-resolve"
						? check.args.adapter === "qa-scope" && output === "qa-scope-v1"
						: false;
		if (!validAdapter)
			issues.push(
				`${step.id}: ${check.check} requires a path selector or a compatible explicit stock adapter`,
			);
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
	if (accessOf(step) === "read-only" && step.type !== "agent")
		issues.push(`${step.id}: read-only access applies to agent steps`);
	return issues;
}
function accessOf(step: LegacyStep) {
	return typeof step.access === "string" ? step.access : step.access?.mode;
}
export const readOnlyTools = [
	"mcp__factory-context__list_context",
	"mcp__factory-context__read_context",
	"mcp__factory-context__list_repository",
	"mcp__factory-context__read_repository",
];

/** Legacy digest adapter, only for accepted unversioned context records. */
export function legacyScopeSources(input: unknown): Record<string, unknown> {
	const outputs =
		(input as { outputs?: Record<string, unknown> })?.outputs ?? {};
	return Object.fromEntries(
		[
			"clarify",
			"decisions",
			"plan",
			"existing-work",
			"assess-existing",
			"source",
			"ticket",
		].map((key) => [key, outputs[key]]),
	);
}

type LegacyOutputRun = {
	workflow?: {
		id: string;
		engineVersion?: string;
		stepConfigVersion?: string;
		steps: object[];
	};
	workflowDefinitions?: {
		id: string;
		engineVersion?: string;
		stepConfigVersion?: string;
		steps: object[];
	}[];
	outputs: Record<string, unknown>;
};

/** Only accepted graphs made entirely of historical step shapes shared leaf outputs. */
export function usesLegacyOutputAliases(run: LegacyOutputRun): boolean {
	if (!run.workflow) return false;
	const definitions = new Map(
		(run.workflowDefinitions ?? [run.workflow]).map((workflow) => [
			workflow.id,
			workflow,
		]),
	);
	const seen = new Set<string>();
	const old = (workflow: NonNullable<typeof run.workflow>): boolean => {
		if (
			workflow.engineVersion ||
			workflow.stepConfigVersion ||
			!Array.isArray(workflow.steps)
		)
			return false;
		if (seen.has(workflow.id)) return true;
		seen.add(workflow.id);
		const steps = (values: object[]): boolean =>
			values.every((step) => {
				if (isExplicitStep(step)) return false;
				const value = step as {
					type?: string;
					body?: object[];
					inputMapping?: unknown;
					workflow?: string;
					groups?: object[][];
				};
				if (value.type === "workflow" && value.workflow) {
					const child = definitions.get(value.workflow);
					if (!child || !old(child)) return false;
				}
				return (
					value.type !== "foreach" &&
					!value.inputMapping &&
					(value.groups ?? []).every(steps)
				);
			});
		return steps(workflow.steps);
	};
	return old(run.workflow);
}

/** Historical receipt aliases are available only to wholly unversioned accepted graphs. */
export function legacyToolOutputKey(
	run: LegacyOutputRun,
	tool: string,
): string | undefined {
	if (!usesLegacyOutputAliases(run)) return;
	const aliases: Record<string, string> = {
		merge: "merge",
		"draft-pr": "draft-pr",
		ci: "ci",
		handoff: "handoff",
		"merge-readiness": "merge-readiness",
		"human-review": "human-review",
		takeover: "source",
		"repository-context": "repository",
		"ticket-context": "ticket",
		"external-final": "external-final",
		"external-verify": "external-verify",
	};
	const alias = aliases[tool];
	return alias && Object.hasOwn(run.outputs, alias) ? alias : undefined;
}

/** Read historical receipts only after the key adapter has accepted the old graph. */
export function legacyToolOutput(
	run: Parameters<typeof legacyToolOutputKey>[0],
	tool: string,
): unknown {
	const key = legacyToolOutputKey(run, tool);
	return key ? run.outputs[key] : undefined;
}
