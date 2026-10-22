import { z } from "zod";
import { viewDataSchemas } from "./View.js";

const text = z.string().trim().min(1).max(24000);
const id = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/)
	.max(80)
	.refine(
		(v) => !["__proto__", "constructor", "prototype"].includes(v),
		"Reserved identifier",
	);
export const OpportunitySchema = z.object({
	id,
	title: text,
	problem: text,
	evidence: z.array(text).min(1).max(20),
	consequence: text,
	before: text,
	after: text,
	plan: text,
	criteria: z.array(text).min(1).max(20),
	nonGoals: z.array(text).max(20).default([]),
	risks: z.array(text).max(20).default([]),
	paths: z.array(text).max(40).default([]),
	strength: z.enum(["strong", "worth-exploring", "speculative"]),
	effort: text,
	dependencies: z.array(id).max(10).default([]),
	conflicts: z.array(id).max(10).default([]),
	perspectives: z.array(z.string()).max(8).default([]),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
// Library output intended for human review uses the same field bounds as the
// receiving generic components. Legacy data-only formats retain their schemas.
const card = viewDataSchemas.itemCards.shape.items.element;
const detail = card.shape.details.unwrap().element.shape.value;
const ReviewOpportunitySchema = OpportunitySchema.extend({
	title: text.pipe(card.shape.title),
	problem: text.pipe(card.shape.body.unwrap()),
	consequence: text.pipe(detail),
	before: text.pipe(detail),
	after: text.pipe(detail),
	plan: text.pipe(detail),
	effort: text.pipe(detail),
});
export const ProposalsSchema = z
	.object({
		summary: text.pipe(viewDataSchemas.markdown.shape.text),
		opportunities: z
			.array(ReviewOpportunitySchema.extend({ issueBody: text }))
			.max(5),
		limitations: z
			.array(
				text.pipe(
					viewDataSchemas.points.shape.items.element.shape.detail.unwrap(),
				),
			)
			.max(30)
			.default([]),
	})
	.superRefine((value, ctx) => {
		try {
			validateOpportunities(value.opportunities);
		} catch (error) {
			ctx.addIssue({ code: "custom", message: String(error) });
		}
	});
export const ProposalOutputSchema = z.object({
	summary: text,
	opportunities: z.array(OpportunitySchema).max(5),
	limitations: z.array(text).max(30).default([]),
});
export const ResearchPlanSchema = z
	.object({
		summary: text,
		assignments: z
			.array(z.object({ id, question: text, scope: z.array(text).max(30) }))
			.max(2),
		skippedReason: text.optional(),
	})
	.refine(
		(v) =>
			new Set(v.assignments.map((a) => a.id)).size === v.assignments.length,
		"Duplicate research assignment IDs",
	);
export const ResearchResultSchema = z.object({
	summary: text,
	findings: z
		.array(
			z.object({
				observation: text,
				evidence: z.array(text).min(1).max(10),
				consequence: text,
				direction: text,
				confidence: z.enum(["high", "medium", "low"]),
			}),
		)
		.max(3),
	limitations: z.array(text).max(20).default([]),
});
export const PackageSchema = z.object({
	id,
	itemIds: z.array(id).min(1).max(5),
	title: text,
	plan: text,
	criteria: z.array(text).min(1).max(30),
	dependencies: z.array(id).max(10).default([]),
	paths: z.array(text).max(40).default([]),
});
export function planReviewDetails(plan: z.infer<typeof PackageSchema>) {
	return [
		{
			label: "Acceptance criteria",
			value: plan.criteria.map((c) => `- ${c}`).join("\n"),
		},
		{ label: "Dependencies", value: plan.dependencies.join(", ") || "None" },
		{ label: "Paths", value: plan.paths.join(", ") || "Not specified" },
	];
}
export const PlanPackageSchema = PackageSchema.extend({
	title: text.pipe(card.shape.title),
	plan: text.pipe(card.shape.body.unwrap()),
}).superRefine((plan, ctx) => {
	for (const [index, field] of [
		"criteria",
		"dependencies",
		"paths",
	].entries()) {
		const result = detail.safeParse(planReviewDetails(plan)[index]!.value);
		if (!result.success)
			for (const issue of result.error.issues)
				ctx.addIssue({
					code: "custom",
					path: [field],
					message: `Displayed ${field}: ${issue.message}`,
				});
	}
});
export const PackagesSchema = z.object({
	packages: z.array(PackageSchema).max(10),
});
export const PlanCheckSchema = z
	.object({ approved: z.boolean(), feedback: z.array(text).max(20) })
	.refine(
		(v) => (v.approved ? v.feedback.length === 0 : v.feedback.length > 0),
		"Rejected plans need actionable feedback; approved plans have no unresolved corrections",
	);

export const ResearchContextSchema = z.object({
	summary: text,
	focus: z.string().max(24000),
	context: text,
	limitations: z.array(text).max(30),
});

export const FollowUpSchema = z.object({
	itemId: id,
	answer: text,
	evidence: z.array(text).max(20),
	limitations: z.array(text).max(30),
});

export function validateOpportunities(items: Opportunity[]) {
	const ids = new Set(items.map((i) => i.id));
	if (ids.size !== items.length) throw new Error("Duplicate opportunity IDs");
	for (const item of items)
		for (const dependency of [...item.dependencies, ...item.conflicts])
			if (!ids.has(dependency) || dependency === item.id)
				throw new Error(
					"Unknown or self-referencing opportunity dependency/alternative",
				);
	validateDag(items.map((i) => ({ id: i.id, dependencies: i.dependencies })));
}
export function validateDag(items: { id: string; dependencies: string[] }[]) {
	const map = new Map(items.map((i) => [i.id, i]));
	if (map.size !== items.length) throw new Error("Duplicate package IDs");
	const done = new Set<string>(),
		active = new Set<string>();
	const visit = (id: string) => {
		if (active.has(id)) throw new Error("Dependency cycle");
		if (done.has(id)) return;
		const item = map.get(id);
		if (!item) throw new Error(`Unknown dependency: ${id}`);
		active.add(id);
		item.dependencies.forEach(visit);
		active.delete(id);
		done.add(id);
	};
	for (const item of items) visit(item.id);
}
