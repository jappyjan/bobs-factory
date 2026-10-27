import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";

import { GITHUB_API_COMMAND } from "../src/factory/GithubApi.js";
import {
	inspectPullRequest,
	ticketIdentifier,
} from "../src/factory/Takeover.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { githubRequest } from "./fixtures/github-api.js";

const pr = {
	url: "https://github.com/owner/repo/pull/3",
	number: 3,
	title: "Existing PR",
	body: "Work in progress",
	headRefName: "feature/existing",
	headRefOid: "sha",
	baseRefName: "main",
	state: "OPEN",
	isDraft: false,
	isCrossRepository: false,
};
const apiPr = {
	html_url: pr.url,
	number: pr.number,
	node_id: "PR_node",
	title: pr.title,
	body: pr.body,
	draft: false,
	state: "open",
	merged: false,
	head: {
		ref: pr.headRefName,
		sha: pr.headRefOid,
		repo: { full_name: "owner/repo" },
	},
	base: { ref: pr.baseRefName, repo: { full_name: "owner/repo" } },
};
it("captures all issue/review discussion pages and rejects another repository or fork PR", async () => {
	const command = vi.fn(async (exe: string, args: string[]) => {
		if (exe === "git") return "git@github.com:owner/repo.git";
		expect(exe).toBe(GITHUB_API_COMMAND);
		const request = githubRequest(args);
		if (request.path === "repos/owner/repo/pulls/3")
			return JSON.stringify(apiPr);
		return JSON.stringify(
			request.path.endsWith("page=1")
				? Array.from({ length: 100 }, (_, id) => ({ id, body: "first page" }))
				: [{ id: 100, body: "second page" }],
		);
	});
	const snapshot = await inspectPullRequest(command, pr.url);
	expect(snapshot.comments).toHaveLength(101);
	expect(snapshot.comments.at(-1)).toMatchObject({ body: "second page" });
	expect(snapshot.reviews).toHaveLength(101);
	expect(snapshot.reviewComments).toHaveLength(101);
	await expect(
		inspectPullRequest(command, "https://github.com/another/repo/pull/3"),
	).rejects.toThrow("selected repository");
	await expect(
		inspectPullRequest(
			async (exe) =>
				exe === "git"
					? "git@github.com:owner/repo.git"
					: JSON.stringify({
							...apiPr,
							head: { ...apiPr.head, repo: { full_name: "fork/repo" } },
						}),
			pr.url,
		),
	).rejects.toThrow();
	expect(command.mock.calls.some(([exe]) => exe === "gh")).toBe(false);
	expect(ticketIdentifier("TEAM-4")).toBe("TEAM-4");
	expect(
		ticketIdentifier("https://linear.app/workspace/issue/TEAM-4/existing"),
	).toBe("TEAM-4");
	expect(() => ticketIdentifier("https://example.com/TEAM-4")).toThrow();
});
function _context(tool: string): ExecutionContext {
	return {
		run: {
			id: "run",
			title: "Continue work",
			repositoryId: "repo",
			repositories: [
				{
					id: "repo",
					name: "Selected",
					repositoryPath: "/tmp",
					workspace: "/tmp",
					baseBranch: "main",
					githubUrl: "https://github.com/owner/repo",
				},
			],
			workflow: defaultWorkflows.find((w) => w.id === "takeover")!,
			status: "running",
			workspace: "/tmp",
			input: "Continue",
			createdAt: "",
			updatedAt: "",
			takeoverSource: { ...pr, isDraft: true },
			outputs: {
				source: { ...pr, isDraft: true },
				repository: { baseBranch: "main" },
			},
			history: [],
			answers: [],
			questions: [],
			events: [],
		},
		step: {
			id: tool,
			name: tool,
			type: "tool",
			tool,
			branches: [],
			maxVisits: 8,
		},
		input: {},
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: "/tmp/evidence",
	};
}
