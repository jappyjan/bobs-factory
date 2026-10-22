import type { LinearClient } from "@linear/sdk";
import { z } from "zod";
import type { FileIssueIntent } from "./FileIssues.js";
import { mcpValue } from "./TicketTracking.js";

type Intent = FileIssueIntent;
const markerFor = (issue: Intent) => issue.marker;
const unassigned = (value: Record<string, unknown>) =>
	[
		"assignee",
		"assigneeId",
		"assignee_id",
		"assignedTo",
		"assigned_to",
		"delegate",
		"delegateId",
		"delegate_id",
	].every((field) => value[field] == null || value[field] === "");

/** Keep provider creation separate from agent tools and from implementation intake. */
export async function fileLinearIssue(
	client: LinearClient,
	issue: Intent,
	save: () => Promise<void>,
	signal?: AbortSignal,
) {
	if (issue.destination.provider !== "linear")
		throw new Error("Linear destination required");
	const destination = issue.destination;
	z.string()
		.regex(/^[a-f0-9]{64}$/)
		.parse(issue.key);
	const hex = issue.key.slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	const raw = hex.join("");
	const id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
	signal?.throwIfAborted();
	const existing = await client.issues({
		filter: { id: { eq: id } },
		first: 2,
	});
	if (existing.nodes.length > 1)
		throw new Error("Several Linear issues match the stable creation identity");
	const check = async (value: (typeof existing.nodes)[number]) => {
		const team = await value.team;
		if (
			value.id !== id ||
			team?.id !== destination.teamId ||
			!value.description?.includes(markerFor(issue))
		)
			throw new Error(
				"Existing Linear issue does not match the accepted creation identity",
			);
		{
			const [state, assignee, delegate, project] = await Promise.all([
				value.state,
				value.assignee,
				value.delegate,
				value.project,
			]);
			if (
				state?.type !== "backlog" ||
				assignee != null ||
				delegate != null ||
				(destination.projectId && project?.id !== destination.projectId)
			)
				throw new Error(
					"Linear deferred issue is not confirmed backlog-only, unassigned and in its accepted project; reconcile the original issue before retrying",
				);
			if (issue.labels?.length) {
				const labels = await value.labels({ first: 100 });
				if (
					issue.labels.some(
						(name) => !labels.nodes.some((label) => label.name === name),
					)
				)
					throw new Error("Linear issue does not confirm all accepted labels");
			}
		}
		{
			const url = new URL(value.url);
			if (
				url.protocol !== "https:" ||
				url.hostname !== "linear.app" ||
				url.username ||
				url.password
			)
				throw new Error("Linear returned an unsafe issue URL");
		}
		return { id: value.id, url: value.url };
	};
	if (existing.nodes.length) return check(existing.nodes[0]!);
	const team = await client.team(destination.teamId);
	const states = await team.states();
	const backlog = states.nodes.find((state) => state.type === "backlog");
	if (!backlog)
		throw new Error(
			"Destination Linear team needs a backlog state before filing deferred work",
		);
	const labelIds: string[] = [];
	if (issue.labels?.length) {
		const found = new Map<string, Set<string>>();
		let after: string | undefined;
		const cursors = new Set<string>();
		do {
			signal?.throwIfAborted();
			const labels = await client.issueLabels({
				filter: { name: { in: issue.labels } },
				first: 100,
				after,
			});
			for (const label of labels.nodes) {
				const owner = await label.team;
				if (owner && owner.id !== destination.teamId) continue;
				const ids = found.get(label.name) ?? new Set<string>();
				ids.add(label.id);
				found.set(label.name, ids);
			}
			after = labels.pageInfo.hasNextPage
				? labels.pageInfo.endCursor
				: undefined;
			if (after && (cursors.has(after) || cursors.size >= 100))
				throw new Error(
					"Linear label discovery is incomplete; no issue was created",
				);
			if (after) cursors.add(after);
		} while (after);
		for (const name of issue.labels) {
			const ids = found.get(name);
			if (ids?.size !== 1)
				throw new Error(
					`Linear label ${JSON.stringify(name)} is unavailable or ambiguous in the accepted team`,
				);
			labelIds.push([...ids][0]!);
		}
	}
	signal?.throwIfAborted();
	issue.phase = "sending";
	await save();
	signal?.throwIfAborted();
	const created = await client.createIssue({
		id,
		teamId: destination.teamId,
		title: issue.title.slice(0, 250),
		description: issue.body,
		stateId: backlog.id,
		assigneeId: null,
		delegateId: null,
		useDefaultTemplate: false,
		...(destination.projectId ? { projectId: destination.projectId } : {}),
		...(labelIds.length ? { labelIds } : {}),
	});
	const item = await created.issue;
	if (!created.success || !item)
		throw new Error(
			"Linear issue creation has no confirmed identity; Retry reconciles its stable UUID",
		);
	return check(item);
}

export async function fileTaskbotIssue(
	issue: Intent,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
	save: () => Promise<void>,
	signal?: AbortSignal,
) {
	if (issue.destination.provider !== "taskbot")
		throw new Error("Taskbot destination required");
	const project = issue.destination.project;
	const label = `factory-file-issue-${issue.key}`;
	signal?.throwIfAborted();
	const data = mcpValue(
		await call("list_tickets", { project, label, limit: 2 }),
	);
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const page = data as Record<string, unknown>;
		if (
			page.nextOffset != null ||
			page.next_cursor != null ||
			page.has_more === true
		)
			throw new Error(
				"Taskbot creation-marker lookup is incomplete; reconcile it before creating or confirming an issue",
			);
	}
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
			!item.body.includes(markerFor(issue))
		)
			throw new Error(
				"Taskbot issue marker does not match the accepted creation intent",
			);
		if (item.status !== "backlog" || !unassigned(item))
			throw new Error(
				"Taskbot deferred issue is not confirmed backlog-only and unassigned; reconcile the original issue before retrying",
			);
		if (issue.labels?.length) {
			const labels = z.array(z.string()).parse(item.labels);
			if (issue.labels.some((name) => !labels.includes(name)))
				throw new Error("Taskbot issue does not confirm all accepted labels");
		}
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
	signal?.throwIfAborted();
	issue.phase = "sending";
	await save();
	signal?.throwIfAborted();
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
					labels: [...new Set([...(issue.labels ?? []), label])],
				}),
			),
		);
	return verify(created.id);
}
