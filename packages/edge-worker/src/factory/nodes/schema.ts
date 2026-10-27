import { z } from "zod";
import { agentSettings } from "../AgentSettings.js";

import { stepConfigFields, VerifyReferenceSchema } from "../StepConfig.js";

import { DEFAULT_STEP_MAX_VISITS, MAX_STEP_VISITS } from "../WorkflowLimits.js";
export const nodeId = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/)
	.max(80);
const condition = z.object({ path: z.string().min(1), equals: z.unknown() });
export const stepFields = {
	id: nodeId,
	reuse: z.literal("unchanged-inputs").optional(),
	revisionScope: z
		.union([
			z.enum(["repository", "none"]),
			z
				.object({
					paths: z.union([
						z.array(z.string().min(1).max(400)).max(1000),
						z
							.object({
								from: z
									.string()
									.max(400)
									.regex(/^\/inputs(?:\/[^/]+)*$/),
							})
							.strict(),
					]),
				})
				.strict(),
		])
		.optional(),
	bind: z.array(z.string().min(1).max(400)).max(50).optional(),
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
	computeIntensive: z.never().optional(),
	prompt: z.string().min(1),
	...agentSettings,
	json: z.boolean().default(true),
	chat: z.boolean().optional(),
});
