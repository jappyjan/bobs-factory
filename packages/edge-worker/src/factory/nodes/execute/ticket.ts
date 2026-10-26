import { z } from "zod";
import { repositoryTicketIO } from "../../RepositoryTicketIO.js";
import { snapshotStatus } from "../../TicketIO.js";
import {
	repositoryTicketReference,
	statusType,
	ticketFields,
} from "../../TicketIOContracts.js";
import { TicketReferenceSchema } from "../../TicketReference.js";
import type { NodeContext } from "../NodeDefinition.js";
import type { schema } from "../ticket.js";
export async function execute(ctx: NodeContext<z.output<typeof schema>>) {
	const ref = z
		.union([TicketReferenceSchema, repositoryTicketReference])
		.parse(
			ctx.step.reference ?? ctx.reads.reference ?? ctx.run.ticketReference,
		);
	const adapter =
		ref.provider === "github" || ref.provider === "file"
			? await repositoryTicketIO(ctx, ref)
			: await ctx.engine.hooks.ticketIO?.(ctx.run, ref, ctx.signal);
	if (!adapter) throw new Error("Configured ticket manager unavailable");
	ctx.signal.throwIfAborted();
	const op = ctx.step.op;
	if (op === "read") return adapter.read();
	const snapshot = op === "create" ? undefined : await adapter.read();
	const identity = {
		id: String(snapshot?.id ?? ("id" in ref ? ref.id : ref.number)),
		url: String(snapshot?.url ?? ("url" in ref ? ref.url : "")),
	};
	const result = { ok: true, ...identity };
	const body =
		op === "comment"
			? z
					.string()
					.min(1)
					.parse(ctx.step.commentBody ?? ctx.reads.body)
			: undefined;
	const fields = ["update", "create"].includes(op)
		? ticketFields.parse(ctx.step.fields ?? ctx.reads.fields)
		: undefined;
	const status =
		op === "set-status"
			? statusType.parse(ctx.step.statusType ?? ctx.reads.statusType)
			: undefined;
	const url =
		op === "link" ? z.url().parse(ctx.step.url ?? ctx.reads.url) : undefined;
	const teamId = ctx.step.teamId;
	if (op === "create" && !fields?.title)
		throw new Error("Ticket create needs fields.title");
	const createFields = {
		...fields,
		title: fields?.title ?? "",
		...(teamId ? { teamId } : {}),
	};
	const intent = {
		ref,
		op,
		...(body ? { body } : {}),
		...(fields ? { fields } : {}),
		...(status ? { status } : {}),
		...(url ? { url } : {}),
		...(teamId ? { teamId } : {}),
	};
	return ctx.effect(
		`ticket:${op}`,
		intent,
		async (key) => {
			ctx.signal.throwIfAborted();
			if (op === "create") {
				const created = await adapter.create(createFields, key, false);
				if (!created)
					throw new Error("Ticket creation lacks a confirmed identity");
				return { ok: true, ...created };
			}
			if (op === "comment")
				await adapter.comment(`${body}\n\n<!-- factory-ticket:${key} -->`);
			if (op === "update") await adapter.update(fields!);
			if (op === "set-status") await adapter.setStatus(status!);
			if (op === "link") await adapter.link(url!);
			return result;
		},
		async (key) => {
			if (op === "create") {
				const created = await adapter.create(createFields, key, true);
				return created ? { ok: true, ...created } : undefined;
			}
			const current = await adapter.read();
			if (op === "comment") {
				const wire = `${body}\n\n<!-- factory-ticket:${key} -->`;
				const found = current.comments.filter((comment) =>
					comment.body.includes(`<!-- factory-ticket:${key} -->`),
				);
				if (found.some((comment) => comment.body !== wire))
					throw new Error("Ticket comment marker has conflicting content");
				return found.length ? result : null;
			}
			if (op === "link")
				return current.attachments.some((attachment) => attachment.url === url)
					? result
					: null;
			if (op === "set-status")
				return snapshotStatus(current) ===
					(status === "triage" && ref.provider === "taskbot"
						? "backlog"
						: status)
					? result
					: null;
			if (op === "update")
				return Object.entries(fields!).every(
					([name, value]) =>
						(name === "description" && ref.provider === "taskbot"
							? current.body
							: current[name]) === value,
				)
					? result
					: null;
			return undefined;
		},
	);
}
