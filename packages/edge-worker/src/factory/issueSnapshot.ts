import type { Comment, IIssueTrackerService, Issue } from "bobs-factory-core";

/** Snapshot every comment page so later roles don't depend on a live ticket read. */
export async function issueSnapshot(
	issue: Issue,
	labels: string[],
	tracker?: IIssueTrackerService,
	purpose?: "tracking",
): Promise<unknown> {
	const comments: unknown[] = [];
	// Each lazy `comment.user` is a separate Linear request on a paced queue, so
	// resolve each distinct author once instead of once per comment.
	const authors = new Map<string, Promise<Awaited<Comment["user"]>>>();
	const cursors = new Set<string>();
	let after: string | undefined;
	do {
		const options = {
			first: 100,
			...(after ? { after } : {}),
		};
		const page = tracker
			? await tracker.fetchComments(issue.id, options)
			: await issue.comments(options);
		for (const comment of page.nodes) {
			let user: Awaited<Comment["user"]>;
			if (purpose !== "tracking") {
				const id = comment.userId;
				if (!id) user = await comment.user;
				else {
					if (!authors.has(id)) authors.set(id, Promise.resolve(comment.user));
					user = await authors.get(id);
				}
			}
			comments.push({
				id: comment.id,
				body: comment.body,
				createdAt: comment.createdAt,
				updatedAt: comment.updatedAt,
				author: user ? { id: user.id, name: user.name } : undefined,
			});
		}
		if (!page.pageInfo?.hasNextPage) break;
		const cursor = page.pageInfo.endCursor;
		if (!cursor || cursors.has(cursor))
			throw new Error("Ticket comment pagination did not advance");
		cursors.add(cursor);
		after = cursor;
	} while (after);
	const [state, assignee, team, project, parent] = await Promise.all([
		issue.state,
		purpose === "tracking" ? undefined : issue.assignee,
		issue.team,
		purpose === "tracking" ? undefined : issue.project,
		purpose === "tracking" ? undefined : issue.parent,
	]);
	const attachments = tracker
		? await tracker.fetchIssueAttachments(issue.id)
		: [];
	if (!tracker) {
		let after: string | undefined;
		const cursors = new Set<string>();
		do {
			const page = await issue.attachments({
				first: 100,
				...(after ? { after } : {}),
			});
			attachments.push(
				...page.nodes.map((item) => ({ title: item.title, url: item.url })),
			);
			if (!page.pageInfo?.hasNextPage) break;
			const cursor = page.pageInfo.endCursor;
			if (!cursor || cursors.has(cursor))
				throw new Error("Ticket attachment pagination did not advance");
			cursors.add(cursor);
			after = cursor;
		} while (after);
	}
	return {
		attachments,
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description,
		url: issue.url,
		priority: issue.priority,
		createdAt: issue.createdAt,
		updatedAt: issue.updatedAt,
		labels,
		state: state
			? {
					...(purpose === "tracking" ? { id: state.id } : {}),
					name: state.name,
					type: state.type,
				}
			: undefined,
		assignee: assignee ? { id: assignee.id, name: assignee.name } : undefined,
		team: team ? { id: team.id, name: team.name, key: team.key } : undefined,
		project: project ? { id: project.id, name: project.name } : undefined,
		parent: parent
			? { id: parent.id, identifier: parent.identifier, title: parent.title }
			: undefined,
		comments,
	};
}
