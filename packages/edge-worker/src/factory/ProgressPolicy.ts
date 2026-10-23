import { z } from "zod";

/** Root acceptance owns one policy for its complete composed execution. */
export const ProgressPolicySchema = z
	.object({
		maxUnchangedAttempts: z.number().int().min(2).max(100).default(8),
		continueAttempts: z.number().int().min(1).max(20).default(2),
	})
	.strict();
export type ProgressPolicy = z.infer<typeof ProgressPolicySchema>;
