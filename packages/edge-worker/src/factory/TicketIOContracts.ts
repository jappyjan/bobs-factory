import { z } from "zod";
export const ticketFields = z
	.object({
		title: z.string().min(1).optional(),
		description: z.string().optional(),
		priority: z.number().int().min(0).max(4).optional(),
	})
	.strict();
export type TicketFields = z.output<typeof ticketFields>;
export const statusType = z.enum([
	"triage",
	"backlog",
	"unstarted",
	"started",
	"completed",
	"canceled",
]);
export type StatusType = z.output<typeof statusType>;
export const repositoryTicketReference = z.discriminatedUnion("provider", [
	z.object({
		provider: z.literal("github"),
		repositoryId: z.string().min(1),
		number: z.number().int().positive(),
	}),
	z.object({
		provider: z.literal("file"),
		repositoryId: z.string().min(1),
		id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	}),
]);
export type RepositoryTicketReference = z.output<
	typeof repositoryTicketReference
>;
