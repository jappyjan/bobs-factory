import { z } from "zod";

export const TicketReferenceSchema = z
	.discriminatedUnion("provider", [
		z.object({
			provider: z.literal("native"),
			platform: z.string().min(1),
			workspaceId: z.string().min(1),
			id: z.string().min(1),
			url: z.string().url(),
		}),
		z.object({
			provider: z.literal("taskbot"),
			server: z.string().min(1),
			instance: z.string().url(),
			project: z.string().regex(/^[a-z0-9-]+$/),
			id: z.number().int().positive(),
			url: z.string().url(),
		}),
	])
	.superRefine((ref, context) => {
		if (
			ref.provider === "taskbot" &&
			ref.url !== `${ref.instance}/p/${ref.project}/t/${ref.id}`
		)
			context.addIssue({
				code: "custom",
				message:
					"Taskbot reference URL must match its verified instance, project and ID",
			});
	});
export type TicketReference = z.infer<typeof TicketReferenceSchema>;
