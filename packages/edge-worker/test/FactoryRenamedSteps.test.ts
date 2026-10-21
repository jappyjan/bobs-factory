import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { digest } from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { captureEvidence, FactoryTools } from "../src/factory/FactoryTools.js";
import type { ImpactSnapshot } from "../src/factory/Impact.js";
import { roleProgress } from "../src/factory/Incremental.js";
import * as readiness from "../src/factory/MergeReadiness.js";
import { parseStepOutput } from "../src/factory/OutputFormats.js";
import { qaDigest } from "../src/factory/Qa.js";
import { formatOf, readOutput } from "../src/factory/StepConfig.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { checkin } from "./fixtures/architecture.js";
import { deliveryFixture } from "./fixtures/grouped-delivery.js";
import { qaExecution, qaScope } from "./fixtures/qa.js";
import { renamedFactory } from "./fixtures/renamed-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function guide() {
	return {
		contract: "brief-v3",
		verdict: {
			headline: "The record can be saved",
			readiness: "ready",
			why: "Save and readback passed.",
		},
		ask: { source: "Fixture request", quote: "Save a record" },
		interpretation: [],
		story: {
			title: "Records stay saved",
			summary: "A saved record can be read back.",
			stats: [],
			slides: [
				{
					kind: "points",
					title: "Save",
					items: [
						{
							icon: "✓",
							title: "Saved record",
							detail: "Readback returned the saved value.",
						},
					],
				},
			],
		},
		tour: [{ file: "shared.txt", say: "The record is saved." }],
		requirements: [
			{
				id: "save",
				text: "Save a record",
				origin: "ask",
				covers: ["R1"],
				status: "tested",
				proof: {
					kind: "command",
					command: "save and readback",
					output: "Record 42 returned",
				},
				files: ["shared.txt"],
			},
		],
		yourCall: [],
		beyondAsk: [],
		notVerified: [],
		hygiene: [],
	};
}

async function drive(renamed: boolean) {
	const home = mkdtempSync(join(tmpdir(), "renamed-factory-"));
	homes.push(home);
	const forge = deliveryFixture(home),
		repository = forge.repositories[0]!;
	const fork = renamedFactory(defaultWorkflows);
	const definitions = renamed
		? fork.definitions
		: structuredClone(defaultWorkflows);
	const workflow = definitions.find(
		(workflow) => workflow.id === (renamed ? "renamed-factory" : "factory"),
	)!;
	const visits: string[] = [];
	const tools = new FactoryTools({
		postComment: async () => {},
		command: forge.command,
	});
	const contract = {
		format: "delivery-v1",
		version: 1,
		mode: "repository",
		authorization: { status: "authorized", reference: "Original request" },
		executionReference: "set-from-accepted-run",
		targets: [],
	};
	const runtime = new WorkflowRuntime(join(home, "state"), {
		agent: async (context: ExecutionContext) => {
			visits.push(
				fork.original(context.stepKey ?? context.run.step ?? context.step.id),
			);
			const format = formatOf(context.step);
			let output: unknown;
			switch (format) {
				case "clarify-v1":
					output = {
						questions: [],
						decisions: [],
						requirements: ["Save a record"],
						deliveryMode: "repository",
					};
					break;
				case "plan-v1":
					contract.executionReference = digest(
						context.run.executionSnapshot ?? {
							runner: context.run.runner,
							repositoryId: context.run.repositoryId,
						},
					);
					output = {
						plan: "Save a record",
						assets: [],
						deliveryContract: contract,
					};
					break;
				case "plan-review-v1":
					output = {
						approved: true,
						feedback: [],
						deliveryContractDigest: digest(contract),
					};
					break;
				case "architecture-checkin-v1": {
					const proposal = checkin("routine");
					proposal.problem = [
						{
							repository: repository.id,
							paths: ["shared.txt"],
							observation: "The record needs saving.",
						},
					];
					proposal.evidence = [
						{
							repository: repository.id,
							paths: ["shared.txt"],
							observation: "Existing record format.",
						},
					];
					proposal.candidate.steps[0]!.files = [
						{ path: "shared.txt", change: "edit" },
					];
					proposal.candidate.plan = "Save a record";
					proposal.map = undefined;
					proposal.decisions = [];
					proposal.talk!.checks = [];
					output = proposal;
					break;
				}
				case "architecture-review-v1":
					output = { approved: true, feedback: [] };
					break;
				case "implement-v1":
					output = {
						status: "completed",
						summary: "Saved a record",
						checks: ["Save and readback"],
						questions: [],
					};
					break;
				case "impact-v1": {
					const snapshot = (context.input as { impactSnapshot: ImpactSnapshot })
						.impactSnapshot;
					output = {
						impactContract: "impact-v1",
						status: "completed",
						summary: "Review the complete implementation",
						classification: "full",
						rationale: "New record behavior needs all specialists",
						uncertainty: [],
						extractRequirements: true,
						specialists: snapshot.reviewers.map((reviewer) => reviewer.id),
						requirementIds: [],
						checks: [],
						qaCriteria: [],
						reuse: [],
						invalidate: [],
						targetCompatible: true,
						testAssertions: {
							inspected: true,
							weakened: false,
							evidence: "No assertions weakened",
						},
						humanReview: "no-prior-approval",
						approvalRationale: "Await explicit human approval",
						questions: [],
					};
					break;
				}
				case "inventory-v1":
					output = {
						schemaVersion: 1,
						requirements: [
							{
								id: "R1",
								criterion: "Save a record",
								classification: "active",
								stage: "code",
								sources: [{ source: "originalInput", reference: "/" }],
							},
						],
						decisions: [],
						conflicts: [],
						sourceReceipt: {
							considered: [{ source: "originalInput", reference: "/" }],
							unavailable: [],
						},
						questions: [],
					};
					break;
				case "specialist-v1":
				case "coverage-v1":
					output = {
						status: "completed",
						blockers: [],
						summary: "Record behavior inspected",
						findings: [],
						disagreements: [],
						...(format === "coverage-v1"
							? {
									coverage: [
										{
											requirementId: "R1",
											status: "met",
											reason: "Save and readback passed",
											evidence: ["Record 42 returned"],
										},
									],
								}
							: {}),
					};
					break;
				case "qa-scope-v1":
					output = {
						...qaScope(),
						stories: qaScope().stories.map((story) => ({
							...story,
							requirementRefs: ["R1"],
						})),
						videoContract: "video-v1",
						videoTasks: [],
						videoReason: "A readback check demonstrates this nonvisual change.",
					};
					break;
				case "qa-capture-v1":
					context.progress = await roleProgress(context);
					output = captureEvidence(context, {
						...qaExecution(),
						videoContract: "video-v1",
						videos: [],
						videoUnavailable: [],
					});
					break;
				case "qa-review-v1": {
					const scope = readOutput(
							context.step,
							"scope",
							context.outputs ?? context.run.outputs,
						),
						capture = readOutput(
							context.step,
							"capture",
							context.outputs ?? context.run.outputs,
						);
					const progress = await roleProgress(context);
					output = {
						status: "completed",
						blockers: [],
						findings: [],
						summary: "QA readback inspected",
						qaContract: "qa-v1",
						acceptedScreenshots: [],
						acceptedVideos: [],
						qaReviewStamp: {
							headSha: progress.currentRevision!.headSha,
							dirty: false,
							captureHash: qaDigest(capture),
							scopeHash: qaDigest(scope),
						},
					};
					break;
				}
				case "review-brief-v3":
					output = guide();
					break;
				default:
					throw new Error(`Unexpected scripted format ${format}`);
			}
			const parsed = parseStepOutput(context.step, output);
			const progress = await roleProgress(context);
			if (progress.currentRevision) {
				context.run.roleRevisions ??= {};
				context.run.roleRevisions[
					context.stepKey ?? context.run.step ?? context.step.id
				] = progress.currentRevision;
			}
			return parsed;
		},
		script: async () => ({}),
		tool: async (context) => {
			visits.push(
				fork.original(context.stepKey ?? context.run.step ?? context.step.id),
			);
			return tools.tool(context);
		},
	});
	runtimes.push(runtime);
	runtime.updateWorkflows(definitions);
	const run = runtime.create({
		title: "Save a record",
		repositoryId: repository.id,
		repositories: [repository],
		workspace: repository.workspace,
		workflow,
		workflowDefinitions: definitions,
		input: "Save a record",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.outputs.repository = { ...repository };
	const launched = runtime.launch(run);
	await waitForRuntime(
		() => {
			expect(
				["waiting", "completed", "failed"],
				`${run.step}: ${run.error}; visits=${visits.join(",")}; last=${JSON.stringify(run.events.slice(-2))}`,
			).toContain(run.status);
		},
		{ timeout: 60000 },
	);
	expect(
		run.status,
		`${run.step}: ${run.error}; visits=${visits.join(",")}`,
	).toBe("waiting");
	expect(run.reviewGate?.status).toBe("pending");
	runtime.decide(run.id, {
		reviewId: run.reviewGate!.id,
		headSha: run.reviewGate!.headSha,
		decision: "approve",
	});
	await launched;
	expect(run.status, run.error).toBe("completed");
	expect(forge.publications).toEqual([repository.id]);
	expect(forge.merges).toEqual([repository.id]);
	return {
		visits,
		tools: forge.commands
			.filter((command) => command.executable !== "git")
			.map((command) => JSON.parse(command.args[0]!).method),
	};
}

it("runs a Factory fork with every step renamed through the same checked graph, QA, approval and confirmed merge", async () => {
	const polling = vi.spyOn(readiness, "waitForNextPoll").mockResolvedValue();
	try {
		const stock = await drive(false),
			fork = await drive(true);
		const entry = defaultWorkflows
			.find((workflow) => workflow.id === "factory")!
			.steps.find((step) => step.type === "workflow")!;
		const fanout = defaultWorkflows
			.find((workflow) => workflow.id === entry.workflow)!
			.steps.find((step) => step.type === "fanout")!;
		// Each group is one independent specialist. Keep serial groups ordered if
		// the stock graph ever grows additional steps within a group.
		expect(fanout.groups!.every((group) => group.length === 1)).toBe(true);
		const siblings = new Set(
			fanout.groups!.map(
				(group, index) => `${entry.id}/${fanout.id}/${index}/${group[0]!.id}`,
			),
		);
		const canonicalVisits = (visits: string[]) => {
			const ordered: string[] = [];
			for (let index = 0; index < visits.length; ) {
				if (!siblings.has(visits[index]!)) {
					ordered.push(visits[index++]!);
					continue;
				}
				const start = index;
				while (index < visits.length && siblings.has(visits[index]!)) index++;
				ordered.push(...visits.slice(start, index).sort());
			}
			return ordered;
		};
		for (const run of [stock, fork])
			expect(run.visits.filter((key) => siblings.has(key)).sort()).toEqual(
				[...siblings].sort(),
			);
		expect({ ...fork, visits: canonicalVisits(fork.visits) }).toEqual({
			...stock,
			visits: canonicalVisits(stock.visits),
		});
		expect(stock.visits).toContain("pipeline/capture");
		expect(stock.visits).toContain("pipeline/handoff");
		expect(stock.visits.at(-1)).toBe("pipeline/merge");
	} finally {
		polling.mockRestore();
	}
}, 120000);
