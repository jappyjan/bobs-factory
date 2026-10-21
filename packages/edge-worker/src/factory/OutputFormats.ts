import { z } from "zod";
import {
	ArchitectureReviewSchema,
	ArchitectureSchema,
	assertReviewBrief,
} from "./Architecture.js";
import { DeliveryContractSchema, TicketTargetSchema } from "./Delivery.js";
import {
	CiFixResultSchema,
	ClarifyResultSchema,
	GeneratedGuideSchema,
	GuideSchema,
	ImplementResultSchema,
	PlanResultSchema,
	PlanReviewResultSchema,
	QaScopeSchema,
	ReviewFixResultSchema,
	ReviewStatusSchema,
	VisualScopeSchema,
} from "./FactoryResults.js";
import {
	CaptureSchema,
	filterReview,
	QaCaptureSchema,
} from "./FactoryTools.js";
import { ImpactSchema } from "./Impact.js";
import {
	ImprovementActionSchema,
	ImprovementSettingsSchema,
	IssueDestinationSchema,
	ItemChoiceSchema,
	OpportunitySchema,
	PackageSchema,
	PackagesSchema,
	PlanCheckSchema,
	ProposalOutputSchema,
	ResearchPlanSchema,
	ResearchResultSchema,
} from "./Improvement.js";
import {
	validateInlineSchema,
	validateInlineSchemaSync,
} from "./InlineSchema.js";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";
import {
	normalizeQuestionResult,
	QuestionChoicesSchema,
	QuestionFieldsSchema,
} from "./Questions.js";
import {
	GeneratedBriefSchema,
	isReviewBrief,
	ReviewBriefSchema,
} from "./ReviewBrief.js";
import { evaluateRules, evaluateRulesAsync } from "./Rules.js";
import {
	CoverageSchema,
	InventorySchema,
	SpecialistSchema,
} from "./SpecialistReview.js";
import {
	FORMAT_IDS,
	type FormatId,
	type ResolvedStepConfig,
	resolveStepConfig,
	type StepScope,
} from "./StepConfig.js";

/** Versioned schema library. Parsers are lazy to avoid coupling module initialization order. */
const parsers: Record<FormatId, (value: unknown) => unknown> = {
	"json-v1": (value) => value,
	"generated-guide-v1": (value) => GeneratedGuideSchema.parse(value),
	"generated-review-brief-v1": (value) =>
		GeneratedBriefSchema.parse(brief(value, "brief-v1")),
	"generated-review-brief-v2": (value) =>
		GeneratedBriefSchema.parse(brief(value, "brief-v2")),
	"generated-review-brief-v3": (value) =>
		GeneratedBriefSchema.parse(brief(value, "brief-v3")),
	"question-fields-v1": (value) => QuestionFieldsSchema.parse(value),
	"question-choices-v1": (value) => QuestionChoicesSchema.parse(value),
	"delivery-target-v1": (value) => TicketTargetSchema.parse(value),
	"clarify-v1": (value) => ClarifyResultSchema.parse(value),
	"plan-v1": (value) => PlanResultSchema.parse(value),
	"plan-review-v1": (value) => PlanReviewResultSchema.parse(value),
	"implement-v1": (value) => ImplementResultSchema.parse(value),
	"review-v1": (value) => review(value, false),
	"qa-review-v1": (value) => review(value, true),
	"visual-scope-v1": (value) => VisualScopeSchema.parse(value),
	"legacy-video-scope-v1": (value) => {
		z.object({ videoContract: z.literal("video-v1") }).parse(value);
		return VisualScopeSchema.parse(value);
	},
	"qa-scope-v1": (value) => QaScopeSchema.parse(value),
	"capture-v1": (value) => CaptureSchema.parse(value),
	"qa-capture-v1": (value) => QaCaptureSchema.parse(value),
	// Historical guides can contain an accepted review brief even without the newer flag.
	"guide-v1": (value) =>
		isReviewBrief(value)
			? ReviewBriefSchema.parse(value)
			: GuideSchema.parse(value),
	"review-brief-v1": (value) => brief(value, "brief-v1"),
	"review-brief-v2": (value) => brief(value, "brief-v2"),
	"review-brief-v3": (value) => brief(value, "brief-v3"),
	"ci-fix-v1": (value) => CiFixResultSchema.parse(value),
	"review-fix-v1": (value) => ReviewFixResultSchema.parse(value),
	"architecture-v1": (value) => ArchitectureSchema.parse(value),
	"architecture-brief-v1": (value) => architecture(value, "review-v1"),
	"architecture-checkin-v1": (value) => architecture(value, "checkin-v1"),
	"architecture-review-v1": (value) => ArchitectureReviewSchema.parse(value),
	"impact-v1": (value) => ImpactSchema.parse(value),
	"inventory-v1": (value) => InventorySchema.parse(value),
	"specialist-v1": (value) => SpecialistSchema.parse(value),
	"coverage-v1": (value) => CoverageSchema.parse(value),
	"delivery-contract-v1": (value) => DeliveryContractSchema.parse(value),
	"improvement-context-v1": (value) =>
		z
			.object({
				summary: z.string().trim().min(1).max(24000),
				limitations: z
					.array(z.string().trim().min(1).max(24000))
					.max(30)
					.default([]),
			})
			.passthrough()
			.parse(value),
	"improvement-research-plan-v1": (value) => ResearchPlanSchema.parse(value),
	"improvement-research-result-v1": (value) =>
		ResearchResultSchema.parse(value),
	"improvement-proposals-v1": (value) => ProposalOutputSchema.parse(value),
	"improvement-packages-v1": (value) => PackagesSchema.parse(value),
	"improvement-plan-check-v1": (value) => PlanCheckSchema.parse(value),
	"improvement-settings-v1": (value) => ImprovementSettingsSchema.parse(value),
	"improvement-issue-destination-v1": (value) =>
		IssueDestinationSchema.parse(value),
	"improvement-item-choice-v1": (value) => ItemChoiceSchema.parse(value),
	"improvement-action-v1": (value) => ImprovementActionSchema.parse(value),
	"improvement-opportunity-v1": (value) => OpportunitySchema.parse(value),
	"improvement-package-v1": (value) => PackageSchema.parse(value),
};
function review(value: unknown, qa: boolean) {
	ReviewStatusSchema.parse(value);
	const output = filterReview(value);
	if (qa) {
		z.object({ qaContract: z.literal("qa-v1") }).parse(value);
		return { ...output, qaContract: "qa-v1" as const };
	}
	delete output.qaContract;
	delete output.qaReviewStamp;
	return output;
}
function brief(value: unknown, contract: string) {
	return ReviewBriefSchema.parse(
		value && typeof value === "object" ? { ...value, contract } : value,
	);
}
function architecture(value: unknown, mode: "review-v1" | "checkin-v1") {
	const output = ArchitectureSchema.parse(value);
	assertReviewBrief(output, mode);
	return output;
}
export function outputFormatCatalog() {
	return FORMAT_IDS.map((id) => ({
		id,
		version: Number(/-v(\d+)$/.exec(id)?.[1] ?? 1),
		name: id.replace(/-v\d+$/, "").replaceAll("-", " "),
	}));
}
export function parseOutputFormat(format: string, value: unknown): unknown {
	if (!Object.hasOwn(parsers, format))
		throw new Error(`Unknown output format: ${format}`);
	return parsers[format as FormatId](value);
}

/** These formats intentionally carry the human-question fields; arbitrary JSON does not. */
const questionFormats = new Set<FormatId>([
	"question-fields-v1",
	"clarify-v1",
	"implement-v1",
	"ci-fix-v1",
	"review-fix-v1",
	"architecture-review-v1",
	"inventory-v1",
	"impact-v1",
]);
function questionResult(
	step: object,
	config: ResolvedStepConfig,
	output: unknown,
) {
	const enabled =
		(step as { askQuestions?: boolean }).askQuestions === true ||
		config.checks.some(({ check }) =>
			[
				"optional-questions",
				"architecture-candidate",
				"inventory-evidence",
				"impact-reuse",
			].includes(check),
		) ||
		(config.output &&
			"format" in config.output &&
			questionFormats.has(config.output.format));
	return enabled &&
		output &&
		typeof output === "object" &&
		("questions" in output ||
			"questionChoices" in output ||
			"questionRecommendations" in output)
		? normalizeQuestionResult(output)
		: output;
}
function conforms(format: string, value: unknown): boolean {
	try {
		parseOutputFormat(format, value);
		return true;
	} catch {
		return false;
	}
}
/** Schema and rule failures reach the same bounded correction loop as legacy output errors. */
export function parseStepOutput(
	step: object,
	value: unknown,
	scope?: StepScope,
): unknown {
	const config = resolveStepConfig(step, scope);
	let output = value;
	try {
		if (config.output) {
			if ("format" in config.output)
				output = parseOutputFormat(config.output.format, value);
			else {
				const result = validateInlineSchemaSync(config.output.schema, value);
				if (result.schemaIssues.length)
					throw new Error(
						`Invalid output schema: ${result.schemaIssues.join("; ")}`,
					);
				if (result.issues.length)
					throw new OutputValidationError(value, result.issues);
			}
		}
		const issues = evaluateRules(config.rules, output, conforms);
		if (issues.length) throw new OutputValidationError(value, issues);
		return questionResult(step, config, output);
	} catch (error) {
		throw outputValidationError(value, error);
	}
}
/** Native execution keeps inline compilation and validation off the event loop. */
export async function parseStepOutputAsync(
	step: object,
	value: unknown,
	scope?: StepScope,
	signal?: AbortSignal,
): Promise<unknown> {
	const config = resolveStepConfig(step, scope);
	try {
		signal?.throwIfAborted();
		let output = value;
		if (config.output) {
			if ("format" in config.output)
				output = parseOutputFormat(config.output.format, value);
			else {
				const result = await validateInlineSchema(
					config.output.schema,
					value,
					signal,
				);
				signal?.throwIfAborted();
				if (result.schemaIssues.length)
					throw new Error(
						`Invalid output schema: ${result.schemaIssues.join("; ")}`,
					);
				if (result.issues.length)
					throw new OutputValidationError(value, result.issues);
			}
		}
		const issues = await evaluateRulesAsync(
			config.rules,
			output,
			conforms,
			signal,
		);
		signal?.throwIfAborted();
		if (issues.length) throw new OutputValidationError(value, issues);
		return questionResult(step, config, output);
	} catch (error) {
		if (signal?.aborted) throw error;
		throw outputValidationError(value, error);
	}
}
/** Compatibility adapter for callers that explicitly ask for historical ID interpretation. */
export function validateLegacyResult(step: object, value: unknown): unknown {
	return parseStepOutput(step, value, {
		legacy: true,
		workflowId: "factory-pipeline",
	});
}
