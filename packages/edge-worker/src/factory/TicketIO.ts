import type { IIssueTrackerService } from "bobs-factory-core";
import type { StatusType, TicketFields } from "./TicketIOContracts.js";
import {
	mcpValue,
	nativeAdapter,
	type TicketReference,
	type TicketSnapshot,
	taskbotAdapter,
} from "./TicketTracking.js";
export interface TicketIdentity {
	id: string;
	url: string;
}
export interface TicketIOAdapter {
	read(): Promise<TicketSnapshot>;
	comment(body: string): Promise<void>;
	setStatus(type: StatusType): Promise<void>;
	update(fields: TicketFields): Promise<void>;
	link(url: string): Promise<void>;
	/** A reconciliation call must never create when its original outcome is unknown. */
	create(
		fields: TicketFields & { title: string; teamId?: string },
		key: string,
		reconcile: boolean,
	): Promise<TicketIdentity | undefined>;
}
const taskbotStatuses: Record<StatusType, string> = {
	triage: "backlog",
	backlog: "backlog",
	unstarted: "todo",
	started: "in_progress",
	completed: "done",
	canceled: "cancelled",
};
export function snapshotStatus(snapshot: TicketSnapshot): string | undefined {
	return (
		(snapshot.state as { type?: string } | undefined)?.type ??
		Object.entries(taskbotStatuses).find(
			([type, value]) => type !== "triage" && snapshot.status === value,
		)?.[0]
	);
}
/** Reuse complete native snapshots/comment/link transports, without lifecycle policy. */
export function nativeTicketIO(
	ref: Extract<TicketReference, { provider: "native" }>,
	tracker: IIssueTrackerService,
	create?: TicketIOAdapter["create"],
): TicketIOAdapter {
	const adapter = nativeAdapter(ref, tracker);
	return {
		read: () => adapter.read(),
		comment: (body) => adapter.comment(body),
		link: (url) => adapter.link(url),
		update: async (fields) => {
			await tracker.updateIssue(ref.id, fields);
		},
		async setStatus(type) {
			const snapshot = await adapter.read();
			if (snapshotStatus(snapshot) === type) return;
			const team = snapshot.team as { id?: string } | undefined;
			if (!team?.id)
				throw new Error("Ticket team required for status type resolution");
			let after: string | undefined;
			const cursors = new Set<string>();
			do {
				const page = await tracker.fetchWorkflowStates(team.id, {
					first: 100,
					...(after ? { after } : {}),
				});
				const selected = page.nodes.find((state) => state.type === type);
				if (selected) {
					await tracker.updateIssue(ref.id, { stateId: selected.id });
					return;
				}
				if (!page.pageInfo?.hasNextPage) break;
				after = page.pageInfo.endCursor ?? undefined;
				if (!after || cursors.has(after))
					throw new Error("Ticket state pagination did not advance");
				cursors.add(after);
			} while (after);
			throw new Error(`Tracker has no status of type ${type}`);
		},
		async create(fields, key, reconcile) {
			if (create) return create(fields, key, reconcile);
			// File/native adapters may expose creation beyond the shared read/update contract.
			const creator = tracker as IIssueTrackerService & {
				createIssue?: (input: {
					teamId: string;
					title: string;
					description?: string;
				}) => Promise<TicketIdentity>;
			};
			if (reconcile) return undefined;
			if (!creator.createIssue)
				throw new Error("Configured tracker does not support ticket creation");
			const teamId =
				fields.teamId ??
				((await adapter.read()).team as { id?: string } | string | undefined);
			const team = typeof teamId === "string" ? teamId : teamId?.id;
			if (!team) throw new Error("Ticket create needs teamId");
			return creator.createIssue({
				...fields,
				teamId: team,
				description: `${fields.description ?? ""}\n\n<!-- factory-ticket:${key} -->`,
			});
		},
	};
}
export function taskbotTicketIO(
	ref: Extract<TicketReference, { provider: "taskbot" }>,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
	create: TicketIOAdapter["create"],
): TicketIOAdapter {
	const adapter = taskbotAdapter(ref, call);
	const invoke = async (tool: string, extra: Record<string, unknown>) => {
		const value = mcpValue(
			await call(tool, { project: ref.project, id: ref.id, ...extra }),
		);
		if (
			value &&
			typeof value === "object" &&
			(value as { error?: unknown }).error
		)
			throw new Error(`Taskbot ${tool} failed`);
		return value;
	};
	return {
		read: () => adapter.read(),
		comment: (body) => adapter.comment(body),
		link: (url) => adapter.link(url),
		create,
		async update(fields) {
			await invoke("update_ticket", {
				...(fields.title !== undefined ? { title: fields.title } : {}),
				...(fields.description !== undefined
					? { body: fields.description }
					: {}),
				...(fields.priority !== undefined ? { priority: fields.priority } : {}),
			});
		},
		async setStatus(type) {
			const snapshot = await adapter.read();
			const to = taskbotStatuses[type];
			if (snapshot.status !== to)
				await invoke("set_status", {
					from: snapshot.status,
					to,
					author: "bobs-factory",
				});
		},
	};
}
