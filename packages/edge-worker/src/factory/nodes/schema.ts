import { z } from "zod";
import { agentSettings } from "../AgentSettings.js";
import { BRIEF_CONTRACTS } from "../GuideAuthoring.js";
import { stepConfigFields, VerifyReferenceSchema } from "../StepConfig.js";
import { ViewSourceSchema } from "../View.js";
import { DEFAULT_STEP_MAX_VISITS, MAX_STEP_VISITS } from "../WorkflowLimits.js";
export const nodeId = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/)
	.max(80);
const condition = z.object({ path: z.string().min(1), equals: z.unknown() });
const reviewSources = z.object({
	inventory: nodeId,
	fanout: nodeId.optional(),
});
const impactSources = z.object({
	inventory: nodeId,
	fanout: nodeId,
	maxUnchangedCycles: z.number().int().min(2).max(20).default(3),
});
export const stepFields = {
	id: nodeId,
	reuse: z.literal("unchanged-inputs").optional(),
	bind: z.array(z.string().min(1).max(400)).max(50).optional(),
	view: ViewSourceSchema.optional(),
	...stepConfigFields,
	delivery: z.literal("exclusive").optional(),
	resources: z.array(z.string().min(1)).min(1).optional(),
	name: z.string().min(1),
	next: nodeId.optional(),
	retry: z
		.object({
			max: z.number().int().min(0).max(100),
			backoff: z.number().int().min(0).max(86_400_000),
		})
		.strict()
		.optional(),
	onError: nodeId.optional(),
	branches: z
		.array(
			z.object({ when: condition, next: nodeId, entry: nodeId.optional() }),
		)
		.default([]),
	qaContract: z.literal("qa-v1").optional(),
	videoContract: z.literal("video-v1").optional(),
	review: reviewSources.optional(),
	impactSource: nodeId.optional(),
	maxVisits: z
		.number()
		.int()
		.min(1)
		.max(MAX_STEP_VISITS)
		.default(DEFAULT_STEP_MAX_VISITS),
};
export const AgentStepSchema = z.object({
	...stepFields,
	type: z.literal("agent"),
	session: z.enum(["fresh", "resume"]).optional(),
	verify: z.array(VerifyReferenceSchema).max(20).optional(),
	impactContract: z.literal("impact-v1").optional(),
	impact: impactSources.optional(),
	architectureSource: nodeId.optional(),
	architectureContract: z
		.enum(["architecture-v1", "architecture-review-v1"])
		.optional(),
	/** New stock proposals require the check-in; frozen graphs retain their contract. */
	architectureBrief: z.enum(["review-v1", "checkin-v1"]).optional(),
	reviewContract: z
		.enum(["inventory-v1", "specialist-v1", "coverage-v1"])
		.optional(),
	/** Guide steps opt into the review brief (v2 adds show & tell, v3 Dig deeper); absent keeps the chapter guide. */
	guideContract: z.enum(BRIEF_CONTRACTS).optional(),
	computeIntensive: z.never().optional(),
	prompt: z.string().min(1),
	inputs: z.array(z.string()).optional(),
	...agentSettings,
	json: z.boolean().default(true),
	askQuestions: z.boolean().default(false),
	chat: z.boolean().optional(),
});
