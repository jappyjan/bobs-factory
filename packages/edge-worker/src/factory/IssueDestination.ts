import { z } from "zod";

const identifier = z.string().trim().min(1).max(24000);
/** Tracker coordinates contain no credentials and are retained before dispatch. */
export const IssueDestinationSchema = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal("linear"),
		workspaceId: identifier,
		teamId: identifier,
		projectId: identifier.optional(),
	}),
	z.object({
		provider: z.literal("taskbot"),
		server: identifier,
		instance: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return url.protocol === "https:" && value === url.origin;
			}, "Taskbot needs a credential-free HTTPS instance origin"),
		project: z.string().regex(/^[a-z0-9-]+$/),
	}),
]);
export type IssueDestination = z.infer<typeof IssueDestinationSchema>;
