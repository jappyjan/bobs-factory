import { z } from "zod";

import { DependencyGraphSchema } from "./DependencyGraph.js";
import { DISPLAY_RULE_ID, DisplayDocumentSchema } from "./DisplayDocument.js";

import { sanitizeJsonConfiguration } from "./Foreach.js";

import {
	validateInlineSchema,
	validateInlineSchemaSync,
} from "./InlineSchema.js";
import { IssueDestinationSchema } from "./IssueDestination.js";
import { nodeFreshnessRules } from "./NodeGuarantees.js";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";

import {
	FollowUpSchema,
	OpportunitySchema,
	PackageSchema,
	PackagesSchema,
	PlanCheckSchema,
	PlanPackageSchema,
	ProposalOutputSchema,
	ProposalsSchema,
	planReviewDetails,
	ResearchContextSchema,
	ResearchPlanSchema,
	ResearchResultSchema,
} from "./ResearchFormats.js";

import { evaluateRules, evaluateRulesAsync, type RuleIssue } from "./Rules.js";

import {
	FORMAT_IDS,
	type FormatId,
	resolveStepConfig,
	type StepScope,
} from "./StepConfig.js";
import { ViewSchema, viewDataSchemas } from "./View.js";

/** Reserve receiving-scope capacity for other outputs and repeated decision items.
 * Proposals occur twice; a batch has at most five plans and three reviews.
 * Validate derived data too, using the consumer's actual character/UTF-8 budgets.
 * Legacy data-only formats intentionally do not opt into this review contract.
 */
function reviewJson<T>(value: T, shares: number): T {
	try {
		sanitizeJsonConfiguration(Array.from({ length: shares }, () => value));
	} catch (error) {
		throw new Error(
			`Complete accepted review JSON exceeds its public receiving budget (1/${shares} share, including derived fields): ${error instanceof Error ? error.message : String(error)}. Return concise complete requirements and evidence; do not omit accepted requirements.`,
		);
	}
	return value;
}

/** Versioned schema library. Parsers are lazy to avoid coupling module initialization order. */
const parsers: Record<FormatId, (value: unknown) => unknown> = {
	"json-v1": (value) => value,
	"dependency-graph-v1": (value) => DependencyGraphSchema.parse(value),
	"research-context-v1": (value) => ResearchContextSchema.parse(value),
	"research-plan-v1": (value) => {
		const plan = ResearchPlanSchema.parse(value);
		try {
			// The next generic For each snapshots this entire collection, not
			// individual scope fields or the coordinator's summary.
			sanitizeJsonConfiguration(plan.assignments);
		} catch (error) {
			throw new OutputValidationError(value, [
				{
					path: "/assignments",
					message: `Complete assignment collection cannot fit its For each JSON snapshot: ${error instanceof Error ? error.message : String(error)}. Return concise complete assignments while preserving required scope.`,
				},
			]);
		}
		return plan;
	},
	"research-result-v1": (value) => ResearchResultSchema.parse(value),
	"proposals-v1": (value) => {
		const proposals = ProposalsSchema.parse(value);
		return reviewJson(
			{
				...proposals,
				limitationsDisplay: viewDataSchemas.points.parse({
					items: proposals.limitations.map((detail, index) => ({
						label: `Limitation ${index + 1}`,
						detail,
					})),
				}),
			},
			8,
		);
	},
	"plan-package-v1": (value) => {
		const plan = PlanPackageSchema.parse(value);
		return reviewJson(
			{
				...plan,
				reviewDetails: planReviewDetails(plan),
				reviewText: `${plan.plan}\n\nAcceptance criteria:\n${plan.criteria.map((c) => `- ${c}`).join("\n")}\n\nDependencies: ${plan.dependencies.join(", ") || "None"}\nPaths: ${plan.paths.join(", ") || "Not specified"}`,
			},
			16,
		);
	},
	"plan-check-v1": (value) => {
		const review = PlanCheckSchema.parse(value);
		return reviewJson(
			{
				...review,
				display: viewDataSchemas.markdown.parse({
					text: review.approved
						? "Approved. No unresolved corrections."
						: review.feedback.join("\n\n"),
				}),
			},
			64,
		);
	},
	"follow-up-v1": (value) => FollowUpSchema.parse(value),
	display: (value) => DisplayDocumentSchema.parse(value),
	"view-v1": (value) => ViewSchema.parse(value),
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
	"improvement-issue-destination-v1": (value) =>
		IssueDestinationSchema.parse(value),
	"improvement-opportunity-v1": (value) => OpportunitySchema.parse(value),
	"improvement-package-v1": (value) => PackageSchema.parse(value),
};
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

export function conforms(format: string, value: unknown): boolean {
	try {
		parseOutputFormat(format, value);
		return true;
	} catch {
		return false;
	}
}
function describeFailure(error: unknown): string {
	if (!(error instanceof z.ZodError))
		return error instanceof Error ? error.message : String(error);
	const lines = (issues: z.core.$ZodIssue[], prefix: PropertyKey[]): string[] =>
		issues.flatMap((issue) => {
			const path = [...prefix, ...issue.path];
			return issue.code === "invalid_union"
				? lines(
						issue.errors.reduce((best, branch) =>
							branch.length < best.length ? branch : best,
						),
						path,
					)
				: [`${path.join(".") || "/"}: ${issue.message}`];
		});
	return [...new Set(lines(error.issues, []))].slice(0, 12).join("; ");
}
/** Format rules say only that a format failed; the agent needs the validator's reasons to correct it. */
function explainFormatRules() {
	const failures: string[] = [];
	return {
		validate(format: string, value: unknown) {
			try {
				parseOutputFormat(format, value);
				return true;
			} catch (error) {
				failures.push(describeFailure(error));
				return false;
			}
		},
		explain(issues: RuleIssue[]) {
			return issues.map((issue) =>
				issue.rule === DISPLAY_RULE_ID && failures.length
					? { ...issue, message: `${issue.message}: ${failures.join("; ")}` }
					: issue,
			);
		},
	};
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
		const formats = explainFormatRules();
		const issues = formats.explain(
			evaluateRules(config.rules, output, formats.validate),
		);
		if (issues.length) throw new OutputValidationError(value, issues);
		return output;
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
	fresh?: (reference: string) => Promise<boolean>,
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
		const formats = explainFormatRules();
		const issues = formats.explain(
			await evaluateRulesAsync(
				config.rules,
				output,
				formats.validate,
				signal,
				await nodeFreshnessRules(config.rules, fresh),
			),
		);
		signal?.throwIfAborted();
		if (issues.length) throw new OutputValidationError(value, issues);
		return output;
	} catch (error) {
		if (signal?.aborted) throw error;
		throw outputValidationError(value, error);
	}
}
