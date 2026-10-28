import { CLIIssueTrackerService } from "bobs-factory-core";
import { expect, it } from "vitest";
import { issueSnapshot } from "../src/factory/issueSnapshot.js";

it("snapshots every page of local ticket comments through the tracker API", async () => {
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	tracker.fetchIssueAttachments = async () => [
		{ title: "Reference image", url: "https://example.com/reference.png" },
	];
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Existing work",
	});
	const bodies = Array.from(
		{ length: 103 },
		(_, index) => `Discussion ${index}`,
	);
	for (const body of bodies) await tracker.createComment(issue.id, { body });
	const result = (await issueSnapshot(issue, [], tracker)) as {
		comments: { body: string }[];
		attachments: { title: string; url: string }[];
	};
	expect(result.attachments).toEqual([
		{ title: "Reference image", url: "https://example.com/reference.png" },
	]);
	expect(result.comments.map((comment) => comment.body)).toEqual(bodies);
	await expect(
		tracker.fetchComments(issue.id, { after: "unknown", first: 100 }),
	).rejects.toThrow("Unknown comment cursor");
});

it("resolves each distinct comment author once, not once per comment", async () => {
	let lookups = 0;
	const users: Record<string, { id: string; name: string }> = {
		a: { id: "a", name: "Ada" },
		b: { id: "b", name: "Bob" },
	};
	const comments = Array.from({ length: 60 }, (_, index) => {
		const userId = index % 2 ? "a" : "b";
		return {
			id: `c${index}`,
			body: `Comment ${index}`,
			createdAt: new Date(0),
			updatedAt: new Date(0),
			userId,
			get user() {
				lookups++;
				return Promise.resolve(users[userId]);
			},
		};
	});
	const issue = {
		id: "issue",
		state: Promise.resolve(undefined),
		team: Promise.resolve(undefined),
	};
	const tracker = {
		fetchComments: async () => ({ nodes: comments }),
		fetchIssueAttachments: async () => [],
	};
	const result = (await issueSnapshot(
		issue as never,
		[],
		tracker as never,
	)) as { comments: { author?: { name: string } }[] };
	expect(lookups).toBe(2);
	expect(result.comments).toHaveLength(60);
	expect(result.comments[0]?.author).toEqual({ id: "b", name: "Bob" });
	expect(result.comments[1]?.author).toEqual({ id: "a", name: "Ada" });
});
