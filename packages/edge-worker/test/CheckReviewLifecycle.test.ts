import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installStockChecks } from "../src/factory/CheckPresets.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { roleProgress } from "../src/factory/Incremental.js";
import { recordReviewFix } from "../src/factory/ReviewRecovery.js";
import {
	type AggregateReview,
	assertAggregateRevision,
	latestAggregate,
} from "../src/factory/SpecialistReview.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const directories: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function repository() {
	const workspace = mkdtempSync(join(tmpdir(), "check-review-repo-"));
	const state = mkdtempSync(join(tmpdir(), "check-review-state-"));
	directories.push(workspace, state);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	writeFileSync(
		join(workspace, "feature.ts"),
		"export const feature = true;\n",
	);
	git("add", ".");
	git("commit", "-m", "fixture");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	return { workspace, state, git };
}

function runtime(state: string, hooks: Partial<RuntimeHooks> = {}) {
	const instance = new WorkflowRuntime(state, {
		agent: async () => {
			throw new Error("Unexpected agent");
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async () => {
			throw new Error("Unexpected action");
		},
		...hooks,
	});
	runtimes.push(instance);
	return instance;
}

const openFinding = {
	id: "protected-validation",
	rating: 3,
	status: "open",
	summary: "Protected validation needs access",
	evidence: "Protected readback cannot run without credentials",
};
const settledFindings = [
	{
		id: "style",
		rating: 1,
		status: "open",
		summary: "Optional naming preference",
		evidence: "No consequence",
	},
	{
		id: "fixed",
		rating: 2,
		status: "resolved",
		summary: "Earlier defect fixed",
		evidence: "Independent readback passed",
		reason: "Verified fixed",
	},
	{
		id: "accepted",
		rating: 3,
		status: "accepted-rejection",
		summary: "Earlier complaint rejected",
		evidence: "The accepted contract excludes this behavior",
		reason: "Reviewer accepted contrary evidence",
	},
];

type Change = "none" | "head" | "dirty" | "instructions";
function lifecycle(change: Change = "none", onlySettled = false) {
	const repo = repository();
	let fixes = 0;
	const resumes: unknown[] = [];
	const ledgers: unknown[] = [];
	const question = vi.fn();
	const session = {
		runner: "codex" as const,
		sessionId: "original-repair-native-session",
	};
	const hooks: Partial<RuntimeHooks> = {
		question,
		agent: async (context) => {
			if (context.step.id === "inspect-current") {
				const revision = (await roleProgress(context)).currentRevision!;
				context.run.roleRevisions ??= {};
				context.run.roleRevisions[context.stepKey!] = revision;
				const settled =
					onlySettled ||
					context.run.answers.some(
						(answer) => answer.answer === "Access restored",
					) ||
					(change !== "none" && fixes >= 2);
				return {
					status: "completed",
					blockers: [],
					summary: "Independently inspected",
					findings: [
						...settledFindings,
						{
							...openFinding,
							...(settled
								? {
										status: "resolved",
										reason: "Access restored; protected validation passed",
									}
								: {}),
						},
					],
				};
			}
			if (context.step.id !== "repair") throw new Error("Unexpected role");
			fixes++;
			resumes.push(context.resumeAgent);
			ledgers.push((context.input as { ledger?: unknown }).ledger);
			if (fixes === 1) {
				await context.checkpointAgent?.(session);
				context.log(
					JSON.stringify({
						type: "system",
						subtype: "init",
						session_id: session.sessionId,
					}),
					"agent",
				);
			}
			const output = recordReviewFix(
				context,
				{
					summary: "Protected validation requires access",
					dispositions: [
						{
							id: openFinding.id,
							status: "rejected",
							reason: "External access is required",
						},
					],
				},
				(await roleProgress(context)).currentRevision,
			);
			if (fixes === 1 && change === "head")
				repo.git("commit", "--allow-empty", "-m", "new reviewed revision");
			if (fixes === 1 && change === "dirty")
				writeFileSync(
					join(repo.workspace, "feature.ts"),
					"export const feature = false;\n",
				);
			if (fixes === 1 && change === "instructions")
				context.run.answers.push({
					questions: ["New direction"],
					answer: "Use the newly prepared environment",
					at: "2026-10-21T12:00:00.000Z",
				});
			return output;
		},
	};
	const local = [
		StepSchema.parse({
			id: "inspect-current",
			name: "Inspect",
			type: "agent",
			prompt: "Inspect current findings",
			output: { format: "review-v1" },
		}),
		StepSchema.parse({
			id: "inspect-findings",
			name: "Check findings",
			type: "tool",
			tool: "review-gate",
			reads: {
				review: "inspect-current",
				fix: "repair",
				ledger: "@reviewLedger",
			},
			branches: [{ when: { path: "approved", equals: false }, next: "repair" }],
			next: "end",
		}),
		StepSchema.parse({
			id: "repair",
			name: "Repair",
			type: "agent",
			prompt: "Address findings",
			reads: {
				review: "inspect-current",
				reviewGate: "inspect-findings",
				ledger: "@reviewLedger",
			},
			next: "inspect-current",
		}),
	];
	installStockChecks(local);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "review-child",
			name: "Review child",
			internal: true,
			stepConfigVersion: "step-config-v1",
			steps: local,
		},
		{
			id: "review-parent",
			name: "Review parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "enclosed",
					name: "Enclosed",
					type: "workflow",
					workflow: "review-child",
				},
			],
		},
	]);
	const first = runtime(repo.state, hooks);
	first.updateWorkflows(definitions);
	const run = first.create({
		workflow: definitions.at(-1)!,
		title: "Review lifecycle",
		input: "Validate protected behavior",
		repositoryId: "fixture",
		workspace: repo.workspace,
		triggerOrigin: {
			type: "manual",
			workflowId: "review-parent",
			at: "2026-10-21T12:00:00.000Z",
		},
	});
	return {
		...repo,
		first,
		run,
		hooks,
		session,
		question,
		resumes,
		ledgers,
		fixes: () => fixes,
	};
}

it("parks unchanged findings through the configured renamed Check and preserves frozen state and native records across restart", async () => {
	const fixture = lifecycle();
	const execution = fixture.first.launch(fixture.run);
	await waitForRuntime(
		() => expect(fixture.run.status, fixture.run.error).toBe("waiting"),
		{ timeout: 10000 },
	);
	expect(fixture.fixes()).toBe(1);
	expect(fixture.run.step).toBe("enclosed/inspect-findings");
	expect(fixture.run.outputs["enclosed/inspect-findings"]).toMatchObject({
		approved: false,
		reviewBlocked: true,
		findings: [openFinding],
	});
	expect(fixture.run.questions).toEqual([
		expect.stringContaining("same findings after an unchanged fix attempt"),
	]);
	expect(fixture.run.outputs["enclosed/repair"]).toMatchObject({
		reviewAssessment: { unchangedCode: true },
	});
	const accepted = JSON.stringify(fixture.run.workflowDefinitions);
	const history = structuredClone(fixture.run.history);
	const events = fixture.run.events.filter((event) => event.source === "agent");
	const batch = fixture.run.questionBatchId;
	expect(
		fixture.run.checkpoint!.active!.children![0]!.agentSessions!.repair,
	).toEqual(fixture.session);
	await fixture.first.shutdown();
	await execution;
	const restored = runtime(fixture.state, fixture.hooks);
	const run = restored.get(fixture.run.id);
	const resumed = restored.launch(run);
	await waitForRuntime(() =>
		expect(restored.pendingAnswers.has(run.id)).toBe(true),
	);
	expect(run.questionBatchId).toBe(batch);
	expect(run.history).toEqual(history);
	expect(run.events.filter((event) => event.source === "agent")).toEqual(
		events,
	);
	expect(run.checkpoint!.active!.children![0]!.agentSessions!.repair).toEqual(
		fixture.session,
	);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
	restored.answer(run.id, "Access restored");
	await resumed;
	expect(run.status, run.error).toBe("completed");
	expect(fixture.fixes()).toBe(2);
	// A completed fixer starts a new invocation, matching the historical gate;
	// its original native identity and records remain retained, never rewritten.
	expect(fixture.resumes).toEqual([undefined, undefined]);
	expect(run.checkpoint!.active).toBeUndefined();
	expect(run.outputs["enclosed/inspect-findings"]).toMatchObject({
		approved: true,
		findings: [],
	});
	expect(run.humanDecisions ?? []).toEqual([]);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
	expect(fixture.ledgers[0]).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: "accepted" }),
			expect.objectContaining({ id: "fixed" }),
		]),
	);
});

it.each([
	"head",
	"dirty",
	"instructions",
] as const)("does not falsely request unchanged-cycle assistance after changed %s", async (change) => {
	const fixture = lifecycle(change);
	await fixture.first.launch(fixture.run);
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(fixture.fixes()).toBe(2);
	expect(fixture.question).not.toHaveBeenCalled();
	expect(
		fixture.run.history
			.filter((entry) => entry.step === "enclosed/inspect-findings")
			.every(
				(entry) => !(entry.output as { reviewBlocked?: boolean }).reviewBlocked,
			),
	).toBe(true);
	expect(fixture.run.outputs["enclosed/inspect-findings"]).toMatchObject({
		approved: true,
		findings: [],
	});
});

it("keeps settled ledger findings closed and discards nitpicks without launching a fixer", async () => {
	const fixture = lifecycle("none", true);
	await fixture.first.launch(fixture.run);
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(fixture.fixes()).toBe(0);
	expect(fixture.question).not.toHaveBeenCalled();
	expect(fixture.run.outputs["enclosed/inspect-findings"]).toMatchObject({
		approved: true,
		findings: [],
	});
	expect(
		(fixture.run.outputs["enclosed/inspect-current"] as { findings: unknown[] })
			.findings,
	).toEqual(expect.arrayContaining(settledFindings));
});

async function producedAggregate() {
	const repo = repository();
	const source = { source: "originalInput", reference: "/acceptance/0" };
	const local = [
		StepSchema.parse({
			id: "requirements",
			name: "Requirements",
			type: "agent",
			prompt: "Extract requirements",
			askQuestions: true,
			checks: ["inventory-evidence"],
			output: { format: "inventory-v1" },
		}),
		StepSchema.parse({
			id: "independent",
			name: "Independent review",
			type: "fanout",
			reads: { inventory: "requirements" },
			checks: ["review-boundary"],
			groups: [
				[
					{
						id: "coverage",
						name: "Coverage",
						type: "agent",
						prompt: "Review coverage",
						checks: [{ check: "specialist-evidence", coverage: true }],
						output: { format: "coverage-v1" },
					},
				],
			],
		}),
		StepSchema.parse({
			id: "receipt-check",
			name: "Receipt Check",
			type: "tool",
			tool: "review-gate",
			reads: { inventory: "requirements", fanout: "independent" },
			checks: ["review-boundary"],
			next: "end",
		}),
	];
	installStockChecks(local);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "receipt-child",
			name: "Receipt child",
			internal: true,
			stepConfigVersion: "step-config-v1",
			steps: local,
		},
		{
			id: "receipt-parent",
			name: "Receipt parent",
			stepConfigVersion: "step-config-v1",
			steps: [
				{
					id: "enclosed",
					name: "Enclosed",
					type: "workflow",
					workflow: "receipt-child",
					next: "end",
				},
				{
					id: "sibling",
					name: "Sibling",
					type: "workflow",
					workflow: "receipt-child",
					next: "end",
				},
				{
					id: "ordinary",
					name: "Ordinary data",
					type: "agent",
					prompt: "Data",
					next: "end",
				},
			],
		},
	]);
	const instance = runtime(repo.state, {
		agent: async (context) =>
			context.step.id === "requirements"
				? {
						schemaVersion: 1,
						requirements: [
							{
								id: "R1",
								criterion: "Maintain feature behavior",
								classification: "active",
								sources: [source],
							},
						],
						decisions: [],
						conflicts: [],
						sourceReceipt: { considered: [source], unavailable: [] },
						questions: [],
					}
				: {
						status: "completed",
						blockers: [],
						summary: "Independently reviewed",
						findings: [],
						coverage: [
							{
								requirementId: "R1",
								status: "met",
								evidence: ["feature.ts:1 retains the required behavior"],
								reason: "Verified in source",
							},
						],
					},
	});
	instance.updateWorkflows(definitions);
	const run = instance.create({
		workflow: definitions.at(-1)!,
		title: "Receipt authority",
		input: "Maintain feature behavior",
		repositoryId: "fixture",
		workspace: repo.workspace,
		triggerOrigin: {
			type: "manual",
			workflowId: "receipt-parent",
			at: "2026-10-21T12:00:00.000Z",
		},
	});
	await instance.launch(run);
	expect(run.status, run.error).toBe("completed");
	const entry = run.history.find(
		(entry) => entry.step === "enclosed/receipt-check",
	)!;
	const receipt = entry.evidence!["review-evidence"] as AggregateReview;
	return { ...repo, run, entry, receipt, history: [...run.history] };
}

it("retains the original specialist receipt and authenticates its exact declared Check/frame", async () => {
	const fixture = await producedAggregate();
	const bytes = JSON.stringify(fixture.receipt);
	const aggregate = latestAggregate(fixture.run, "enclosed/independent");
	expect(aggregate).toBe(fixture.receipt);
	expect(
		(fixture.entry.output as { baseline?: unknown }).baseline,
	).toBeUndefined();
	assertAggregateRevision(
		aggregate,
		fixture.git("rev-parse", "HEAD"),
		fixture.git("rev-parse", "refs/remotes/origin/main"),
	);
	expect(JSON.stringify(fixture.receipt)).toBe(bytes);
	const copied = {
		step: "ordinary",
		at: fixture.entry.at,
		output: structuredClone(fixture.receipt),
		evidence: { "review-evidence": structuredClone(fixture.receipt) },
	};
	fixture.run.history.push(copied);
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBe(
		fixture.receipt,
	);
	fixture.run.history = [copied];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
	fixture.run.history = [{ ...copied, step: "unknown-producer" }];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
	fixture.run.history = [{ ...fixture.entry, step: "sibling/receipt-check" }];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
	expect(latestAggregate(fixture.run, "sibling/independent")).toBeUndefined();
});

it("rejects missing sidecars, copied raw outputs, mismatched results and altered aggregate evidence", async () => {
	const fixture = await producedAggregate();
	fixture.run.history = [
		{
			...fixture.entry,
			output: structuredClone(fixture.receipt),
			evidence: undefined,
		},
	];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
	fixture.run.history = [
		{
			...fixture.entry,
			output: { ...(fixture.entry.output as object), approved: false },
		},
	];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
	const changed = structuredClone(fixture.receipt);
	changed.coverage[0]!.reason = "Changed after approval";
	fixture.run.history = [
		{ ...fixture.entry, evidence: { "review-evidence": changed } },
	];
	expect(() =>
		assertAggregateRevision(
			latestAggregate(fixture.run, "enclosed/independent"),
			fixture.git("rev-parse", "HEAD"),
		),
	).toThrow("Aggregate review evidence changed after approval");
	expect(
		fixture.history.find((entry) => entry.step === fixture.entry.step)!
			.evidence!["review-evidence"],
	).toBe(fixture.receipt);
});

it("loads exact raw receipts from explicitly configured #136 legacy gate actions", async () => {
	const fixture = await producedAggregate();
	const definitions = structuredClone(fixture.run.workflowDefinitions!);
	const child = definitions.find(
		(workflow) => workflow.id === "receipt-child",
	)!;
	const index = child.steps.findIndex((step) => step.id === "receipt-check");
	const { check: _check, ...configuration } = child.steps[index]!;
	child.steps[index] = StepSchema.parse({
		...configuration,
		type: "tool",
		tool: "review-gate",
		checks: ["review-boundary"],
	});
	fixture.run.workflowDefinitions = validateWorkflows(definitions);
	fixture.run.history = [
		{ step: fixture.entry.step, output: fixture.receipt, at: fixture.entry.at },
	];
	expect(child.stepConfigVersion).toBe("step-config-v1");
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBe(
		fixture.receipt,
	);
	assertAggregateRevision(
		latestAggregate(fixture.run, "enclosed/independent"),
		fixture.git("rev-parse", "HEAD"),
	);
	fixture.run.history = [
		{ ...fixture.run.history[0]!, step: "sibling/receipt-check" },
	];
	expect(latestAggregate(fixture.run, "enclosed/independent")).toBeUndefined();
});
