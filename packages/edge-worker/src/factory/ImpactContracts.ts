import { z } from "zod";

const text = z.string().trim().min(1);
export const EvidenceBoundarySchema = z.object({
	requirementIds: z.array(text),
	areas: z.array(text).min(1),
	dependencies: z.array(text).min(1),
	// Inspection of callers, shared dependencies, configuration and test strength.
	independence: text,
});
export type EvidenceBoundary = z.infer<typeof EvidenceBoundarySchema>;
