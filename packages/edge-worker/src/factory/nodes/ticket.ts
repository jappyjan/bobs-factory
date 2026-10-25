import { z } from "zod";
import {
	repositoryTicketReference,
	statusType,
	ticketFields,
} from "../TicketIOContracts.js";
import { TicketReferenceSchema } from "../TicketReference.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";
export const schema = z.object({
	...stepFields,
	type: z.literal("ticket"),
	op: z
		.enum(["read", "comment", "set-status", "update", "create", "link"])
		.default("read"),
	reference: z
		.union([TicketReferenceSchema, repositoryTicketReference])
		.optional(),
	commentBody: z.string().min(1).optional(),
	fields: ticketFields.optional(),
	statusType: statusType.optional(),
	url: z.url().optional(),
	teamId: z.string().min(1).optional(),
});
export const definition = {
	type: "ticket",
	schema,
	category: "io",
	effect: "effect",
	operationEffects: {
		read: "read-only",
		comment: "effect",
		"set-status": "effect",
		update: "effect",
		create: "effect",
		link: "effect",
	},
	builder: {
		label: "Ticket",
		icon: "🎫",
		paletteGroup: "io",
		defaults: { op: "read" },
	},
	execute: async (ctx) => (await import("./execute/ticket.js")).execute(ctx),
} satisfies NodeDefinition<typeof schema>;
