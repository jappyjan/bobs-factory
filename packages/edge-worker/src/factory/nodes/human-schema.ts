import { z } from "zod";
import { ViewNotificationsSchema } from "../HumanStep.js";
import { stepFields } from "./schema.js";
export const humanBase = {
	notifications: ViewNotificationsSchema.optional(),
	...stepFields,
	context: z.never().optional(),
	output: z.never().optional(),
	rules: z.never().optional(),
	checks: z.never().optional(),
	revision: z.never().optional(),
	access: z.never().optional(),
	instructions: z.never().optional(),
	qaContract: z.never().optional(),
	videoContract: z.never().optional(),
	review: z.never().optional(),
	impactSource: z.never().optional(),
};
