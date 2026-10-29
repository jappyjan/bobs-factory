import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { issueSnapshot } from "../src/factory/issueSnapshot.js";
import { transformOutput } from "../src/factory/nodes/transform.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const intake = defaultWorkflows.find((w) => w.id === "v2-takeover-intake")!;
const stepOf = (id: string) => intake.steps.find((s) => s.id === id)!;

// A ticket whose old PR was closed and branch deleted: no PR step runs. The
// tracker returns Date timestamps and comments with and without a userId.
async function ticketFromTracker() {
	const at = new Date("2026-10-28T23:14:08.956Z");
	const authors: Record<string, { id: string; name: string }> = {
		u1: { id: "u1", name: "Jan Jaap" },
	};
	const comments = [
		{ id: "c1", body: "Restart", userId: "u1" },
		{ id: "c2", body: "Workflow failed" },
	].map((comment) => ({
		...comment,
		createdAt: at,
		updatedAt: at,
		get user() {
			return Promise.resolve(
				"userId" in comment && comment.userId
					? authors[comment.userId]
					: undefined,
			);
		},
	}));
	const issue = {
		id: "issue-1",
		identifier: "ATT-1146",
		title: "Prepare repository",
		createdAt: at,
		updatedAt: at,
		state: Promise.resolve({ name: "Todo", type: "unstarted" }),
		assignee: Promise.resolve(undefined),
		team: Promise.resolve({ id: "t", name: "Attraccess", key: "ATT" }),
		project: Promise.resolve(undefined),
		parent: Promise.resolve(undefined),
	};
	const tracker = {
		fetchComments: async () => ({ nodes: comments }),
		fetchIssueAttachments: async () => [],
	};
	return issueSnapshot(issue as never, ["attraccess"], tracker as never);
}

it("assembles existing work for a ticket takeover with no PR", async () => {
	const ticket = await ticketFromTracker();
	// Plain JSON, exactly as a restarted run would reload it.
	expect(ticket).toEqual(JSON.parse(JSON.stringify(ticket)));
	const outputs: Record<string, unknown> = {
		ticket,
		diff: {
			repositories: [{ id: "repo", commitsAhead: 0, files: [], changes: [] }],
		},
		status: {
			repositories: [{ id: "repo", branch: "att-1146", dirty: false }],
		},
	};
	const run = {
		workflow: intake,
		workflowDefinitions: defaultWorkflows,
		outputs,
		history: [],
		ticketSnapshot: ticket,
		input: "Restart ATT-1146",
		source: "https://linear.app/attraccess/issue/ATT-1146/x",
		launchInputs: { source: "ATT-1146", prompt: "Restart ATT-1146" },
	} as unknown as FactoryRun;
	const bindings = (id: string) =>
		stepBindings({
			run,
			step: stepOf(id),
			stepKey: `intake/${id}`,
			outputs,
		} as never);

	const existing = (await transformOutput(
		stepOf("existing-work").transform as never,
		bindings("existing-work"),
	)) as { pr?: unknown; ticket: { comments: unknown[] } };
	expect(existing.pr ?? null).toBeNull();
	expect(existing.ticket.comments).toHaveLength(2);

	outputs["existing-work"] = existing;
	expect(bindings("assess-existing").existingWork).toEqual(existing);
});
