import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	type Architecture,
	ArchitectureSchema,
	architectureInstructions,
	assertReviewBrief,
	checkinInstructions,
} from "../src/factory/Architecture.js";
import {
	defaultWorkflows,
	upgradedArchitectureSteps,
} from "../src/factory/defaultWorkflows.js";
import { renderInstructionTemplate } from "../src/factory/InstructionLibrary.js";
import { formatOf, hasCheck } from "../src/factory/StepConfig.js";
import {
	validateWorkflows,
	type WorkflowStep,
} from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { checkin, proposal } from "./fixtures/architecture.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const issues = (value: unknown) => {
	const parsed = ArchitectureSchema.safeParse(value);
	return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

it("requires the check-in on briefVersion=2 and only lets it check settled calls", () => {
	expect(issues(checkin())).toEqual([]);
	const missing = checkin();
	delete missing.talk;
	expect(issues(missing)).toContain(
		"The check-in needs what Bob would say to the human",
	);
	const ghost = checkin();
	ghost.talk!.checks[0]!.decision = "nowhere";
	expect(issues(ghost)).toContain("Check names an unknown decision");
	const open = checkin();
	Object.assign(open.decisions[0]!, {
		status: "open",
		pick: undefined,
		decidedBy: undefined,
		why: "Only you know how often you approve designs.",
		lean: "checkpoint",
	});
	expect(issues(open)).toContain(
		"Open decisions are questions for the human, not calls to check",
	);
	open.talk!.checks = [];
	expect(issues(open)).toEqual([]);
	open.decisions[0]!.lean = "unknown";
	expect(issues(open)).toContain("Lean must name one of the options");
	const decided = checkin();
	decided.decisions[0]!.lean = "checkpoint";
	expect(issues(decided)).toContain("Only open decisions carry Bob's lean");
	const older = proposal();
	older.talk = checkin().talk;
	expect(issues(older)).toContain("The check-in belongs to briefVersion=2");
	const wordy = checkin();
	wordy.talk!.scenes[0]!.after = Array.from({ length: 7 }, () => "Step");
	expect(issues(wordy).length).toBeGreaterThan(0);
});

it("asks check-in steps for briefVersion=2 while review-v1 steps accept both", () => {
	const v1 = ArchitectureSchema.parse(proposal());
	const v2 = ArchitectureSchema.parse(checkin());
	expect(() => assertReviewBrief(v1, "checkin-v1")).toThrow(/briefVersion=2/);
	expect(() => assertReviewBrief(v2, "checkin-v1")).not.toThrow();
	expect(() => assertReviewBrief(v1)).not.toThrow();
	expect(() => assertReviewBrief(v2)).not.toThrow();
	const stock = defaultWorkflows
		.flatMap((w) => w.steps)
		.filter((s) => hasCheck(s, "architecture-proposal"));
	expect(stock.length).toBeGreaterThan(0);
	for (const step of stock) {
		expect(formatOf(step)).toBe("architecture-checkin-v1");
		expect(renderInstructionTemplate(step, step.prompt!)).toBe(
			checkinInstructions,
		);
	}
});

/** A frozen stock run from before the check-in, with a tuned reviewer model. */
function frozenStock(): WorkflowStep[] {
	return [
		{
			id: "architecture",
			name: "Discuss architecture",
			type: "agent",
			prompt: architectureInstructions,
			architectureContract: "architecture-v1",
			architectureBrief: "review-v1",
			model: "tuned-model",
		},
		{
			id: "architecture-review",
			name: "Review architecture candidate",
			type: "agent",
			prompt:
				"Review the architecture candidate and its complete implementation plan against an older release. Require briefVersion=1.",
			architectureContract: "architecture-review-v1",
			architectureSource: "architecture",
			reasoningEffort: "high",
			branches: [
				{ when: { path: "approved", equals: false }, next: "architecture" },
			],
		},
		{
			id: "architecture-decision",
			name: "Accept architecture proposal",
			type: "tool",
			tool: "architecture-decision",
			arguments: {
				proposal: "architecture",
				review: "architecture-review",
				planOutput: "plan",
				revise: "architecture",
				approval: "meaningful",
			},
			branches: [
				{ when: { path: "decision", equals: "revise" }, next: "architecture" },
			],
			next: "implement",
		},
		{
			id: "implement",
			name: "Implement",
			type: "agent",
			prompt: "Implement",
			inputs: ["plan"],
		},
	] as WorkflowStep[];
}

it("upgrades only stock review-v1 proposer/reviewer pairs and keeps agent settings", () => {
	const upgraded = upgradedArchitectureSteps(frozenStock())!;
	expect(upgraded[0]).toMatchObject({
		prompt: checkinInstructions,
		architectureBrief: "checkin-v1",
		model: "tuned-model",
	});
	expect(upgraded[1]!.prompt).toMatch(/^Review the check-in/);
	expect(upgraded[1]!.reasoningEffort).toBe("high");
	expect(upgraded.slice(2)).toEqual(frozenStock().slice(2));
	expect(upgradedArchitectureSteps(upgraded)).toBeUndefined();
	const custom = frozenStock();
	custom[0]!.prompt = "Design it my way";
	expect(upgradedArchitectureSteps(custom)).toBeUndefined();
	const customReviewer = frozenStock();
	customReviewer[1]!.prompt = "Review my way";
	expect(upgradedArchitectureSteps(customReviewer)).toBeUndefined();
});

it("records when a version is shown and writes the human-requested version as a check-in", async () => {
	const home = mkdtempSync(join(tmpdir(), "checkin-runtime-"));
	homes.push(home);
	const authored: Architecture[] = [];
	const briefs: (string | undefined)[] = [];
	let reviews = 0;
	const runtime = new WorkflowRuntime(home, {
		agent: async (c) => {
			if (c.step.architectureContract === "architecture-v1") {
				briefs.push(c.step.architectureBrief);
				const value =
					c.step.architectureBrief === "checkin-v1" ? checkin() : proposal();
				if (authored.length)
					value.changes = [{ text: "Written as a check-in", from: "bob" }];
				authored.push(value);
				return value;
			}
			if (c.step.architectureContract === "architecture-review-v1")
				// Bob's reviewer sends the first draft back once.
				return reviews++ === 0
					? { approved: false, feedback: ["Name the restart limit"] }
					: { approved: true, feedback: [] };
			return {
				status: "completed",
				summary: "done",
				checks: [],
				questions: [],
			};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{ id: "frozen", name: "Frozen", steps: frozenStock() },
	]).at(-1)!;
	const run = runtime.create({
		title: "Check-in upgrade",
		repositoryId: "repo",
		workspace: home,
		workflow,
		input: "Ticket",
		triggerOrigin: {
			type: "manual",
			workflowId: "frozen",
			at: new Date().toISOString(),
		},
	});
	void runtime.launch(run);
	await waitFor(() => expect(run.status).toBe("waiting"));
	const [draft, shown] = run.architectureProposals!;
	expect(draft!.status).toBe("superseded");
	expect(draft!.shownAt).toBeUndefined();
	expect(shown!.shownAt).toEqual(expect.any(String));
	runtime.decideArchitecture(run.id, {
		proposalId: shown!.id,
		version: shown!.version,
		digest: shown!.digest,
		decision: "revise",
		feedback: "Please explain the restart limit",
	});
	await waitFor(() => expect(run.architectureProposals).toHaveLength(3));
	await waitFor(() => expect(run.status).toBe("waiting"));
	expect(briefs).toEqual(["review-v1", "review-v1", "checkin-v1"]);
	expect(run.architectureProposals!.at(-1)!.content.briefVersion).toBe(2);
	const step = run.workflow.steps.find((s) => s.id === "architecture")!;
	expect(step).toMatchObject({
		architectureBrief: "checkin-v1",
		model: "tuned-model",
	});
	await runtime.shutdown();
});
