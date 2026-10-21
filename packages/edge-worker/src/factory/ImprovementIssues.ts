import type { LinearClient } from "@linear/sdk";
import { z } from "zod";
import type { ImprovementState } from "./Improvement.js";
import { mcpValue } from "./TicketTracking.js";

type Intent = ImprovementState["issues"][string];
/** Keep provider creation separate from agent tools and from implementation intake. */
export async function fileLinearImprovement(
	client: LinearClient,
	issue: Intent,
	save: () => Promise<void>,
) {
	if (issue.destination.provider !== "linear")
		throw new Error("Linear destination required");
	const destination = issue.destination;
	const hex = issue.key.slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	const raw = hex.join(""),
		id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
	const existing = await client.issues({
		filter: { id: { eq: id } },
		first: 2,
	});
	const check = async (value: (typeof existing.nodes)[number]) => {
		const team = await value.team;
		if (
			value.id !== id ||
			team?.id !== destination.teamId ||
			!value.description?.includes(`<!-- factory-improvement:${issue.key} -->`)
		)
			throw new Error(
				"Existing Linear issue does not match the accepted creation identity",
			);
		return { id: value.id, url: value.url };
	};
	if (existing.nodes.length) return check(existing.nodes[0]!);
	const team = await client.team(issue.destination.teamId);
	const states = await team.states();
	const backlog = states.nodes.find((s) => s.type === "backlog");
	if (!backlog)
		throw new Error(
			"Destination Linear team needs a backlog state before filing deferred work",
		);
	issue.phase = "sending";
	await save();
	const created = await client.createIssue({
		id,
		teamId: issue.destination.teamId,
		title: issue.title.slice(0, 250),
		description: issue.body,
		stateId: backlog.id,
		assigneeId: null,
		delegateId: null,
		useDefaultTemplate: false,
	});
	const item = await created.issue;
	if (!created.success || !item)
		throw new Error(
			"Linear issue creation has no confirmed identity; Retry reconciles its stable UUID",
		);
	return check(item);
}

export async function fileTaskbotImprovement(
	issue: Intent,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
	save: () => Promise<void>,
) {
	if (issue.destination.provider !== "taskbot")
		throw new Error("Taskbot destination required");
	const project = issue.destination.project,
		label = `factory-improvement-${issue.key}`;
	const data = mcpValue(
		await call("list_tickets", { project, label, limit: 2 }),
	);
	const rows = z
		.array(z.object({ id: z.number().int().positive() }).passthrough())
		.parse(
			Array.isArray(data) ? data : (data as { tickets?: unknown })?.tickets,
		);
	if (rows.length > 1)
		throw new Error(
			"Several issues match this creation marker; reconcile them before retrying",
		);
	const verify = async (id: number) => {
		const item = z
			.object({
				id: z.literal(id),
				body: z.string(),
				project: z.string().optional(),
			})
			.passthrough()
			.parse(mcpValue(await call("get_ticket", { project, id })));
		if (
			(item.project !== undefined && item.project !== project) ||
			!item.body.includes(`<!-- factory-improvement:${issue.key} -->`)
		)
			throw new Error(
				"Taskbot issue marker does not match the accepted creation intent",
			);
		return {
			id: String(id),
			url: `${issue.destination.provider === "taskbot" ? issue.destination.instance : ""}/p/${project}/t/${id}`,
		};
	};
	if (rows.length) return verify(rows[0]!.id);
	if (issue.phase === "uncertain" || issue.phase === "sending")
		throw new Error(
			"Previous Taskbot creation has an uncertain outcome. No matching marker is visible yet; restore or reconcile that request before another creation. Retry only rechecks the marker.",
		);
	issue.phase = "sending";
	await save();
	const created = z
		.object({ id: z.number().int().positive() })
		.passthrough()
		.parse(
			mcpValue(
				await call("create_ticket", {
					project,
					title: issue.title,
					body: issue.body,
					status: "backlog",
					labels: [label],
				}),
			),
		);
	return verify(created.id);
}
