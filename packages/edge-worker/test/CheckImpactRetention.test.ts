import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installStockChecks } from "../src/factory/CheckPresets.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	assertImpactFresh,
	collectImpactSnapshot,
	historicalInventoryRead,
	type ImpactAssessment,
	type ImpactSnapshot,
	STALE_IMPACT_MESSAGE,
} from "../src/factory/Impact.js";
import { qaDigest } from "../src/factory/Qa.js";
import { outputRevisionBinding } from "../src/factory/RevisionBinding.js";
import {
	type AggregateReview,
	assertAggregateRevision,
	latestAggregate,
} from "../src/factory/SpecialistReview.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
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

const reviewerIds = [
	"security",
	"integration",
	"architecture",
	"maintenance",
	"quality",
	"business",
];

function definition(boundInventory = false) {
	// This custom inventory extracts accepted requirements. The sidecar regression
	// does not give it source-inspection authority; independent impact still binds
	// every actual repository revision. The authority variant opts in explicitly.
	const steps = [
		StepSchema.parse({
			id: "assessor",
			name: "Independent impact",
			type: "agent",
			configVersion: "step-config-v1",
			prompt: "Inspect actual inputs, diff, dependencies and original receipts",
			reads: { inventory: "scope", fanout: "experts", feedback: "@feedback" },
			output: { format: "impact-v1" },
			checks: [{ check: "impact-reuse", maxUnchangedCycles: 3 }],
			access: "read-only",
			askQuestions: true,
			next: "selected-checks",
			branches: [
				{ when: { path: "extractRequirements", equals: true }, next: "scope" },
			],
		}),
		StepSchema.parse({
			id: "scope",
			name: "Requirements",
			type: "agent",
			configVersion: "step-config-v1",
			prompt: "Extract the accepted ownership requirement",
			output: { format: "inventory-v1" },
			checks: ["inventory-evidence"],
			...(boundInventory ? { revision: "bound" } : {}),
			askQuestions: true,
			access: "read-only",
			next: "selected-checks",
		}),
		StepSchema.parse({
			id: "selected-checks",
			name: "Verify selected checks",
			type: "tool",
			configVersion: "step-config-v1",
			tool: "impact-checks",
			reads: { impact: "assessor", inventory: "scope" },
			checks: ["impact-boundary"],
			next: "experts",
		}),
		StepSchema.parse({
			id: "experts",
			name: "Independent reviewers",
			type: "fanout",
			configVersion: "step-config-v1",
			reads: { inventory: "scope", impact: "assessor" },
			checks: ["review-boundary", "impact-boundary"],
			groups: reviewerIds.map((id) => [
				{
					id,
					name: id,
					type: "agent",
					configVersion: "step-config-v1",
					prompt: "Inspect actual ownership boundaries",
					output: {
						format: id === "business" ? "coverage-v1" : "specialist-v1",
					},
					checks: [
						{
							check: "specialist-evidence",
							...(id === "business" ? { coverage: true } : {}),
						},
					],
					revision: "bound",
					access: "read-only",
				},
			]),
		}),
		StepSchema.parse({
			id: "gate",
			name: "Check original review receipts",
			type: "tool",
			configVersion: "step-config-v1",
			tool: "review-gate",
			reads: { inventory: "scope", fanout: "experts", impact: "assessor" },
			checks: ["review-boundary", "impact-boundary"],
		}),
		StepSchema.parse({
			id: "choose",
			name: "First correction",
			type: "check",
			configVersion: "step-config-v1",
			reads: { history: "@history" },
			check: {
				results: {
					fix: {
						count: "/inputs/history",
						where: { path: "/step", equals: "repair" },
						max: 0,
					},
				},
			},
			branches: [{ when: { path: "fix", equals: true }, next: "repair" }],
			next: "end",
		}),
		StepSchema.parse({
			id: "repair",
			name: "Repair teardown",
			type: "agent",
			configVersion: "step-config-v1",
			prompt: "Handle absent owned resources without changing authorization",
			next: "assessor",
		}),
	];
	installStockChecks(steps);
	return validateWorkflows([
		...defaultWorkflows,
		{
			id: "retained-check-impact",
			name: "Retained Check impact",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]).at(-1)!;
}

function assessment(
	snapshot: ImpactSnapshot,
	reuse: ImpactAssessment["reuse"],
): ImpactAssessment {
	return {
		impactContract: "impact-v1",
		status: "completed",
		summary: "Independently inspect teardown and unaffected authorization",
		correctionRequired: false,
		readinessOnly: false,
		commentAssessments: [],
		classification: snapshot.reviewRound ? "affected" : "full",
		rationale:
			"Actual authorization callers and dependencies do not use teardown",
		uncertainty: [],
		extractRequirements: !snapshot.reviewRound,
		specialists: snapshot.reviewers
			.map((reviewer) => reviewer.id)
			.filter((id) => !reuse.some((record) => record.reviewer === id)),
		requirementIds: [],
		checks: [
			{
				id: "teardown-file",
				repositoryId: "fixture",
				command: "test -s teardown",
				reason: "Verify the teardown fixture remains present",
			},
		],
		qaCriteria: [],
		qaReuse: [],
		reuse,
		invalidate: [],
		targetCompatible: true,
		testAssertions: {
			inspected: true,
			weakened: false,
			evidence: "No test assertions were removed or weakened",
		},
		humanReview: "no-prior-approval",
		approvalRationale: "No approval exists",
		questions: [],
	};
}

function setup(
	boundInventory = false,
	inspectHistoricalRead?: (context: ExecutionContext) => Promise<void>,
) {
	const workspace = mkdtempSync(join(tmpdir(), "check-impact-repo-"));
	const state = mkdtempSync(join(tmpdir(), "check-impact-state-"));
	directories.push(workspace, state);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: workspace,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "authorization"), "only trusted callers\n");
	writeFileSync(join(workspace, "teardown"), "remove owned resources\n");
	git("add", ".");
	git("commit", "-m", "baseline");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("checkout", "-b", "feature");
	writeFileSync(join(workspace, "teardown"), "remove only owned resources\n");
	git("commit", "-am", "ownership feature");
	const calls: string[] = [];
	let consumption: ExecutionContext | undefined;
	const factoryTools = new FactoryTools({ postComment: async () => {} });
	const hooks: RuntimeHooks = {
		agent: async (context) => {
			calls.push(context.step.id);
			if (context.step.id === "assessor") {
				if (boundInventory && context.run.answers.length)
					await inspectHistoricalRead?.(context);
				const input = context.input as {
					impactSnapshot: ImpactSnapshot;
					impactEvidence: {
						digest: string;
						receipt: AggregateReview["reviewers"][number];
					}[];
				};
				const unchanged = input.impactSnapshot.repositories.every(
					(repository) => !repository.diff,
				);
				const reusable = input.impactEvidence.filter(
					({ receipt }) =>
						receipt.status === "completed" &&
						receipt.evidenceBoundary &&
						((unchanged &&
							(!boundInventory || context.run.answers.length > 0)) ||
							!["quality", "business"].includes(receipt.stamp.reviewer)),
				);
				const value = assessment(
					input.impactSnapshot,
					reusable.map(({ digest, receipt }) => ({
						reviewer: receipt.stamp.reviewer,
						receiptDigest: digest,
						boundary: receipt.evidenceBoundary!.boundary,
						reason:
							"Inspected unchanged dependencies and independent ownership boundary",
					})),
				);
				if (
					input.impactSnapshot.reviewRound &&
					unchanged &&
					(context.run.answers.length || boundInventory)
				) {
					const inventory = latestAggregate(context.run, "experts")!.baseline
						.inventory;
					value.classification = "none";
					value.scopeReuse = {
						inventoryDigest: inventory.digest,
						originalSourceDigest: inventory.sourceContextDigest!,
						reason:
							"Inspected the operational answer; restored fixture access preserves the accepted ownership requirement",
					};
				}
				return value;
			}
			if (context.step.id === "scope")
				return {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion: "Remove only owned resources",
							classification: "active",
							sources: [{ source: "originalInput", reference: "/criterion" }],
						},
					],
					decisions: [],
					conflicts: [],
					sourceReceipt: {
						considered: [{ source: "originalInput", reference: "/criterion" }],
						unavailable: [],
					},
					questions: [],
				};
			if (context.step.id === "repair") {
				if (!boundInventory) {
					writeFileSync(
						join(workspace, "teardown"),
						"remove only owned resources; tolerate absence\n",
					);
					git("commit", "-am", "handle absent resources");
				}
				return {
					summary: boundInventory
						? "No source change; independent fixture validation still needs access"
						: "Handled absence without changing authorization",
					checks: [],
				};
			}
			const blocked =
				context.step.id === "business" &&
				context.reviewBaseline?.round === 2 &&
				!context.run.answers.length;
			return {
				status: blocked ? "blocked" : "completed",
				blockers: blocked ? ["Fixture access is unavailable"] : [],
				summary: blocked
					? "Acceptance inspection requires fixture access"
					: "Inspected consequential boundaries",
				findings: [],
				disagreements: [],
				...(!blocked
					? {
							evidenceBoundary: {
								requirementIds: ["R1"],
								areas: [
									["quality", "business"].includes(context.step.id)
										? "teardown"
										: "authorization",
								],
								dependencies: [
									["quality", "business"].includes(context.step.id)
										? "teardown"
										: "authorization",
								],
								independence:
									"Inspected actual callers and independent dependencies",
							},
						}
					: {}),
				...(context.step.id === "business"
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									reason: blocked
										? "Implementation appears complete; independent fixture inspection is blocked"
										: "Teardown removes only owned resources",
									evidence: [
										blocked
											? "No independent acceptance verification was possible"
											: "Inspected teardown and verified fixture behavior",
									],
								},
							],
						}
					: {}),
			};
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async (context) => {
			if (context.run.answers.length) consumption = context;
			const output = await factoryTools.tool(context);
			if (boundInventory && context.run.answers.length)
				await inspectHistoricalRead?.(context);
			return output;
		},
	};
	const createRuntime = () => {
		const instance = new WorkflowRuntime(state, hooks);
		runtimes.push(instance);
		return instance;
	};
	const runtime = createRuntime();
	const workflow = definition(boundInventory);
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const run = runtime.create({
		workflow,
		title: "Teardown ownership",
		input: "Remove only owned resources",
		repositoryId: "fixture",
		workspace,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-22T00:00:00.000Z",
		},
	});
	return {
		runtime,
		run,
		createRuntime,
		calls,
		git,
		workspace,
		consumption: () => consumption,
	};
}

it("retains authenticated Check receipts through blocked-review assistance, durable reassessment and only the outstanding reviewer", async () => {
	const fixture = setup();
	const execution = fixture.runtime.launch(fixture.run);
	await waitForRuntime(
		() => expect(fixture.run.status, fixture.run.error).toBe("waiting"),
		{ timeout: 15000 },
	);
	expect(fixture.run.step).toBe("gate");
	expect(fixture.run.outputs.gate).toMatchObject({
		passed: false,
		approved: false,
		reviewIncomplete: true,
	});
	expect(fixture.run.questions).toEqual([expect.stringContaining("business")]);
	const original = latestAggregate(fixture.run, "experts")!;
	expect(original.baseline.round).toBe(2);
	const completed = original.reviewers.filter(
		(reviewer) => reviewer.status === "completed",
	);
	expect(completed).toHaveLength(5);
	expect(
		original.reviewers.find(
			(reviewer) => reviewer.stamp.reviewer === "business",
		)?.status,
	).toBe("blocked");
	const originalBytes = JSON.stringify(original);
	const history = structuredClone(fixture.run.history);
	const accepted = JSON.stringify(fixture.run.workflowDefinitions);
	await fixture.runtime.shutdown();
	await execution;
	const restored = fixture.createRuntime();
	const run = restored.get(fixture.run.id);
	expect(run.history).toEqual(history);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
	expect(JSON.stringify(latestAggregate(run, "experts"))).toBe(originalBytes);
	const resumed = restored.launch(run);
	await waitForRuntime(() =>
		expect(restored.pendingAnswers.has(run.id)).toBe(true),
	);
	restored.answer(
		run.id,
		"Fixture access is restored. Accepted requirements are unchanged.",
	);
	await resumed;
	expect(run.status, run.error).toBe("completed");
	for (const [role, count] of [
		["scope", 1],
		["repair", 1],
		["security", 1],
		["business", 3],
	] as const)
		expect(
			fixture.calls.filter((called) => called === role),
			role,
		).toHaveLength(count);
	expect(run.answers).toHaveLength(1);
	expect(run.humanDecisions ?? []).toEqual([]);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
	const final = latestAggregate(run, "experts")!;
	expect(final.approved).toBe(true);
	expect(final.baseline.round).toBe(3);
	expect(
		final.reviewers.filter(
			(reviewer) => reviewer.stamp.reviewer !== "business",
		),
	).toEqual(completed);
	assertAggregateRevision(
		final,
		fixture.git("rev-parse", "HEAD"),
		fixture.git("rev-parse", "refs/remotes/origin/main"),
	);
	const retained = run.history.find(
		(entry) =>
			(entry.evidence?.["review-evidence"] as AggregateReview | undefined)
				?.baseline.round === 2,
	)!;
	expect(JSON.stringify(retained.evidence!["review-evidence"])).toBe(
		originalBytes,
	);
	expect((retained.output as AggregateReview).baseline).toBeUndefined();
	const decision = run.impactDecisions!.at(-1)!;
	expect(decision.snapshot.reviewRound).toBe(2);
	expect(decision.pending.specialists).toEqual([]);
	expect(
		decision.reuseRecords.map((record) => record.originalDigest).sort(),
	).toEqual(completed.map(qaDigest).sort());
	const context = fixture.consumption()!;
	const fanout = run.workflow.steps.find((step) => step.id === "experts")!;
	const snapshot = await collectImpactSnapshot(
		context,
		fanout,
		"experts",
		decision.snapshot,
	);
	expect(snapshot.reviewRound).toBe(2);
	expect(snapshot.inventoryDigest).toBe(original.baseline.inventory.digest);
	await assertImpactFresh(context, decision, fanout);

	// Reconstruct through the same production boundary after the newer round exists:
	// only the authenticated producer/frame and exact retained round may supply it.
	const pristine = structuredClone(run.history);
	for (const invalid of [
		"missing",
		"other-frame",
		"round",
		"ordinary-producer",
	] as const) {
		run.history = structuredClone(pristine);
		const entry = run.history.find(
			(item) =>
				(item.evidence?.["review-evidence"] as AggregateReview | undefined)
					?.baseline.round === 2,
		)!;
		const receipt = entry.evidence!["review-evidence"] as AggregateReview;
		if (invalid === "missing") delete entry.evidence;
		if (invalid === "other-frame") receipt.baseline.key = "elsewhere/experts";
		if (invalid === "round") receipt.baseline.round = 20;
		if (invalid === "ordinary-producer") entry.step = "choose";
		expect(
			(
				await collectImpactSnapshot(
					context,
					fanout,
					"experts",
					decision.snapshot,
				)
			).reviewRound,
			invalid,
		).toBeUndefined();
		await expect(
			assertImpactFresh(context, decision, fanout),
			invalid,
		).rejects.toThrow(STALE_IMPACT_MESSAGE);
	}
	run.history = pristine;
	await assertImpactFresh(context, decision, fanout);
	run.answers.push({
		questions: ["Changed scope"],
		answer: "Remove every resource, including resources owned by others.",
		at: "2026-10-22T01:00:00.000Z",
	});
	await expect(assertImpactFresh(context, decision, fanout)).rejects.toThrow(
		STALE_IMPACT_MESSAGE,
	);
	run.answers.pop();
	fixture.git("commit", "--allow-empty", "-m", "different actual revision");
	await expect(assertImpactFresh(context, decision, fanout)).rejects.toThrow(
		STALE_IMPACT_MESSAGE,
	);
}, 180000);

it("keeps historical inventory authority scoped to actual independent reassessment and fresh exact-frame proof without rebinding its original inspection", async () => {
	const inspected: string[] = [];
	let originalBindingBytes: string;
	let consumerRead: Parameters<typeof historicalInventoryRead> | undefined;
	const fixture = setup(true, async (context) => {
		const { run } = context;
		const source = run.workflow.steps.find((step) => step.id === "scope")!;
		const original = run.boundOutputs!.scope!;
		expect(JSON.stringify(original)).toBe(originalBindingBytes);
		const current = (await outputRevisionBinding(
			{ ...context, step: source, stepKey: "scope" },
			original,
		))!;
		expect(current.repositories).toEqual(original.repositories);
		expect(current.inputDigest).not.toBe(original.inputDigest);
		const allowed = await historicalInventoryRead(
			context,
			source,
			original,
			current,
		);
		expect(allowed, `${context.step.id}: actual historical read`).toBe(true);
		inspected.push(context.step.id);

		const ordinary = StepSchema.parse({
			id: "ordinary-reader",
			name: "Ordinary reader",
			type: "agent",
			configVersion: "step-config-v1",
			prompt: "Read the named inventory",
			reads: { inventory: "scope", fanout: "experts", impact: "assessor" },
		});
		expect(
			await historicalInventoryRead(
				{ ...context, step: ordinary },
				source,
				original,
				current,
			),
		).toBe(false);
		expect(
			await historicalInventoryRead(
				{ ...context, stepKey: `unrelated/${context.step.id}` },
				source,
				original,
				current,
			),
		).toBe(false);
		const inventory = run.outputs.scope;
		for (const field of ["criterion", "sourceReceipt"] as const) {
			try {
				run.outputs.scope = structuredClone(inventory);
				const altered = run.outputs
					.scope as AggregateReview["baseline"]["inventory"];
				if (field === "criterion")
					altered.requirements[0]!.criterion =
						"Remove resources belonging to other owners";
				else
					altered.sourceReceipt.considered.push({
						source: "originalInput",
						reference: "/unaccepted-source",
					});
				// Keep the original digest: comparing only that claimed field is insufficient.
				expect(qaDigest(run.outputs.scope)).not.toBe(qaDigest(inventory));
				expect(
					await historicalInventoryRead(context, source, original, current),
					field,
				).toBe(false);
			} finally {
				run.outputs.scope = inventory;
			}
		}
		const workflow = run.workflow;
		try {
			run.workflow = structuredClone(workflow);
			run.workflow.steps.find((step) => step.id === "experts")!.reads!.impact =
				"unrelated-assessor";
			expect(
				await historicalInventoryRead(context, source, original, current),
			).toBe(false);
		} finally {
			run.workflow = workflow;
		}

		const file = join(fixture.workspace, "teardown");
		const content = readFileSync(file, "utf8");
		try {
			writeFileSync(file, `${content}unreviewed working change\n`);
			const dirty = (await outputRevisionBinding(
				{ ...context, step: source, stepKey: "scope" },
				original,
			))!;
			expect(dirty.repositories).not.toEqual(original.repositories);
			expect(
				await historicalInventoryRead(context, source, original, dirty),
			).toBe(false);
		} finally {
			writeFileSync(file, content);
		}

		// An assessor may read the historical inventory to investigate a new answer.
		// Consumers need an already accepted, current proof for that exact answer.
		if (context.step.id === "selected-checks") {
			consumerRead = [context, source, original, current];
			for (const invalid of [
				"missing",
				"original-source",
				"snapshot",
				"source-context",
			] as const) {
				try {
					run.outputs.scope = structuredClone(inventory);
					const derivative = run.outputs
						.scope as AggregateReview["baseline"]["inventory"];
					if (invalid === "missing") delete derivative.scopeReuse;
					if (invalid === "original-source")
						derivative.scopeReuse!.originalSourceDigest =
							"other original source";
					if (invalid === "snapshot")
						derivative.scopeReuse!.snapshotDigest = "other assessment snapshot";
					if (invalid === "source-context")
						derivative.sourceContextDigest = "other current source";
					expect(
						await historicalInventoryRead(context, source, original, current),
						invalid,
					).toBe(false);
				} finally {
					run.outputs.scope = inventory;
				}
			}
			const decisions = run.impactDecisions!;
			for (const invalid of [
				"missing",
				"altered",
				"stale",
				"other-frame",
				"original-source",
				"round",
			] as const) {
				try {
					run.impactDecisions = structuredClone(decisions);
					const decision = run.impactDecisions.at(-1)!;
					if (invalid === "missing") run.impactDecisions = [];
					if (invalid === "altered")
						decision.scopeReuse!.inventoryDigest = "altered inventory proof";
					if (invalid === "stale")
						decision.snapshot.environmentDigest = "stale execution environment";
					if (invalid === "other-frame")
						decision.snapshot.key = "unrelated/experts";
					if (invalid === "original-source")
						decision.scopeReuse!.originalSourceDigest =
							"unaccepted original source";
					if (invalid === "round") decision.snapshot.reviewRound = 200;
					expect(
						await historicalInventoryRead(context, source, original, current),
						invalid,
					).toBe(false);
				} finally {
					run.impactDecisions = decisions;
				}
			}
			try {
				run.answers.push({
					questions: ["New scope"],
					answer: "Delete resources owned by others too",
					at: "2026-10-22T02:00:00.000Z",
				});
				expect(
					await historicalInventoryRead(context, source, original, current),
				).toBe(false);
			} finally {
				run.answers.pop();
			}
			const target = fixture.git("rev-parse", "refs/remotes/origin/main");
			try {
				const advanced = fixture.git(
					"commit-tree",
					"HEAD^{tree}",
					"-p",
					target,
					"-m",
					"target advanced independently",
				);
				fixture.git("update-ref", "refs/remotes/origin/main", advanced);
				expect(
					await historicalInventoryRead(context, source, original, current),
				).toBe(false);
			} finally {
				fixture.git("update-ref", "refs/remotes/origin/main", target);
			}
			expect(
				await historicalInventoryRead(context, source, original, current),
				`${context.step.id}: read restored after rejected mutations`,
			).toBe(true);
		}
		expect(JSON.stringify(run.boundOutputs!.scope)).toBe(originalBindingBytes);
	});
	const execution = fixture.runtime.launch(fixture.run);
	await waitForRuntime(
		() => expect(fixture.run.status, fixture.run.error).toBe("waiting"),
		{ timeout: 15000 },
	);
	expect(fixture.run.step).toBe("gate");
	const originalBinding = fixture.run.boundOutputs!.scope!;
	originalBindingBytes = JSON.stringify(originalBinding);
	const originalInventory = fixture.run.history.find(
		(entry) => entry.step === "scope",
	)!.output;
	const originalInventoryBytes = JSON.stringify(originalInventory);
	const accepted = JSON.stringify(fixture.run.workflowDefinitions);
	await fixture.runtime.shutdown();
	await execution;
	const restored = fixture.createRuntime();
	const run = restored.get(fixture.run.id);
	expect(JSON.stringify(run.boundOutputs!.scope)).toBe(originalBindingBytes);
	const resumed = restored.launch(run);
	await waitForRuntime(() =>
		expect(restored.pendingAnswers.has(run.id)).toBe(true),
	);
	restored.answer(
		run.id,
		"Fixture access is restored. Accepted requirements are unchanged.",
	);
	await resumed;
	expect(run.status, run.error).toBe("completed");
	expect(inspected).toEqual(["assessor", "selected-checks"]);
	expect(fixture.calls.filter((id) => id === "scope")).toHaveLength(1);
	expect(JSON.stringify(run.boundOutputs!.scope)).toBe(originalBindingBytes);
	expect(
		JSON.stringify(run.history.find((entry) => entry.step === "scope")!.output),
	).toBe(originalInventoryBytes);
	expect(JSON.stringify(run.workflowDefinitions)).toBe(accepted);
	expect(latestAggregate(run, "experts")?.approved).toBe(true);
	expect(latestAggregate(run, "experts")?.baseline.round).toBe(3);
	// Newer aggregate publication cannot replace the exact round authorizing
	// this already accepted read; no bound receipt or original inventory is relabeled.
	expect(consumerRead).toBeDefined();
	expect(await historicalInventoryRead(...consumerRead!)).toBe(true);
	expect(JSON.stringify(run.boundOutputs!.scope)).toBe(originalBindingBytes);
	expect(
		JSON.stringify(run.history.find((entry) => entry.step === "scope")!.output),
	).toBe(originalInventoryBytes);
}, 180000);
