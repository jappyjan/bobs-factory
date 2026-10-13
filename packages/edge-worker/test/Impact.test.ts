import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createFactoryContextServer } from "../../mcp-tools/src/factoryContext.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	assertImpactFresh,
	collectImpactSnapshot,
	continuationEligible,
	effectiveApproval,
	feedbackDigest,
	type ImpactAssessment,
	type ImpactSnapshot,
	impactDecisionDigest,
	recordConvergence,
	unchangedScopeProof,
	validateImpact,
} from "../src/factory/Impact.js";
import {
	QaExecutionSchema,
	type QaScope,
	qaDigest,
} from "../src/factory/Qa.js";
import {
	qaReuseContext,
	stampQaCriteria,
	verifyQaEnvironment,
} from "../src/factory/QaReuse.js";
import { repositoryRun } from "../src/factory/RepositoryScope.js";
import {
	type AggregateReview,
	aggregateReview,
	assertAggregateRevision,
	validateInventory,
	validateSpecialist,
} from "../src/factory/SpecialistReview.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const require = createRequire(import.meta.url);
async function measureContext(
	input: unknown,
	measurements: { calls: number; characters: number },
) {
	const from = dirname(require.resolve("bobs-factory-mcp-tools"));
	const { Client } = await import(
		require.resolve("@modelcontextprotocol/sdk/client/index.js", {
			paths: [from],
		})
	);
	const { InMemoryTransport } = await import(
		require.resolve("@modelcontextprotocol/sdk/inMemory.js", { paths: [from] })
	);
	const server = createFactoryContextServer(input);
	const client = new Client({ name: "impact-fixture", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		for (const name of ["list_context", "read_context"]) {
			let offset = 0;
			for (;;) {
				const result = await client.callTool({
					name,
					arguments: {
						path: "",
						offset,
						limit: name === "list_context" ? 50 : 16000,
					},
				});
				if (result.isError) throw new Error(JSON.stringify(result));
				measurements.calls++;
				measurements.characters += JSON.stringify(result).length;
				const next = result.structuredContent?.nextOffset;
				if (next === null) break;
				offset = next;
			}
		}
	} finally {
		await client.close();
		await server.close();
	}
}
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
function repository(layout = "js") {
	const root = mkdtempSync(join(tmpdir(), "impact-fixture-"));
	homes.push(root);
	git(root, "init", "-b", "trunk");
	git(root, "config", "user.email", "fixture@example.invalid");
	git(root, "config", "user.name", "Fixture");
	git(root, "config", "commit.gpgsign", "false");
	mkdirSync(join(root, layout === "js" ? "src" : "service"));
	writeFileSync(
		join(root, authPath(layout)),
		layout === "js"
			? "module.exports = caller => caller === 'trusted';\n"
			: "def allowed(caller):\n    return caller == 'trusted'\n",
	);
	writeFileSync(join(root, "teardown"), "remove owned resources\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "baseline");
	git(root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
	git(root, "checkout", "-b", "feature");
	writeFileSync(join(root, "teardown"), "remove only owned resources\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "feature");
	return root;
}
const authPath = (layout: string) =>
	layout === "js" ? "src/auth.js" : "service/access.py";
const agent = (id: string, extra = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Inspect actual requirements and diff",
	...extra,
});
const tool = (id: string, name = id, extra = {}) => ({
	id,
	name: id,
	type: "tool",
	tool: name,
	...extra,
});
function definition(impact: boolean) {
	return validateWorkflows([
		...defaultWorkflows,
		{
			id: "fixture",
			name: "Fixture",
			steps: [
				...(impact
					? [
							agent("assessor", {
								impactContract: "impact-v1",
								impact: {
									inventory: "scope",
									fanout: "experts",
									maxUnchangedCycles: 3,
								},
								askQuestions: true,
								next: "selected-checks",
								branches: [
									{
										when: { path: "extractRequirements", equals: true },
										next: "scope",
									},
								],
							}),
						]
					: []),
				agent("scope", {
					reviewContract: "inventory-v1",
					askQuestions: true,
					next: impact ? "selected-checks" : "experts",
				}),
				...(impact
					? [
							tool("selected-checks", "impact-checks", {
								impactSource: "assessor",
								next: "experts",
							}),
						]
					: []),
				{
					id: "experts",
					name: "Experts",
					type: "fanout",
					review: { inventory: "scope" },
					...(impact ? { impactSource: "assessor" } : {}),
					groups: [
						[agent("security", { reviewContract: "specialist-v1" })],
						[agent("integration", { reviewContract: "specialist-v1" })],
						[agent("architecture", { reviewContract: "specialist-v1" })],
						[agent("maintenance", { reviewContract: "specialist-v1" })],
						[agent("quality", { reviewContract: "specialist-v1" })],
						[agent("business", { reviewContract: "coverage-v1" })],
					],
				},
				tool("gate", "review-gate", {
					review: { inventory: "scope", fanout: "experts" },
					...(impact ? { impactSource: "assessor" } : {}),
				}),
				tool("choose", "choose", {
					branches: [{ when: { path: "fix", equals: true }, next: "repair" }],
					next: "end",
				}),
				agent("repair", { next: impact ? "assessor" : "scope" }),
			],
		},
	]).at(-1)!;
}
function assessment(
	snapshot: ImpactSnapshot,
	reuse: ImpactAssessment["reuse"] = [],
): ImpactAssessment {
	const initial = !snapshot.reviewRound;
	return {
		impactContract: "impact-v1",
		status: "completed",
		correctionRequired: false,
		readinessOnly: false,
		commentAssessments: [],
		summary: initial
			? "Full initial evidence"
			: "Verify teardown correction; retain unrelated authorization review",
		classification: initial ? "full" : "affected",
		rationale: "Inspected teardown behavior and its callers independently",
		uncertainty: [],
		extractRequirements: initial,
		specialists: snapshot.reviewers
			.map((r) => r.id)
			.filter((id) => !reuse.some((r) => r.reviewer === id)),
		requirementIds: [],
		checks: [
			{
				id: "teardown-file",
				repositoryId: snapshot.repositories[0]!.repositoryId,
				command: "test -s teardown",
				reason: "Confirm correction fixture exists",
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
			evidence: "No assertions were removed or weakened",
		},
		humanReview: snapshot.approval ? "renew" : "no-prior-approval",
		approvalRationale: "First acceptance needs explicit approval",
		questions: [],
	};
}
async function drive(
	impact: boolean,
	layout = "js",
	options: {
		fail?: boolean;
		nested?: boolean;
		feedback?: boolean;
		comment?: string;
		operationalAnswer?: boolean;
		blocked?: boolean;
	} = {},
) {
	const root = repository(layout);
	const definitionValue = definition(impact);
	let injectedAnswer = false;
	if (options.operationalAnswer)
		definitionValue.steps
			.find((s) => s.id === "choose")!
			.branches.unshift({
				when: { path: "assess", equals: true },
				next: "assessor",
			});
	if (options.feedback) {
		definitionValue.steps.find((s) => s.id === "choose")!.next = "provider-ci";
		definitionValue.steps
			.find((s) => s.id === "assessor")!
			.branches.unshift({
				when: { path: "readinessOnly", equals: true },
				next: "provider-ci",
			});
		definitionValue.steps.push({
			id: "provider-ci",
			name: "Check custom forge",
			type: "tool",
			tool: "ci",
			impactSource: "assessor",
			branches: [
				{ when: { path: "impactRequired", equals: true }, next: "assessor" },
			],
			maxVisits: 8,
			next: "end",
		});
	}
	const calls: string[] = [];
	const contextMeasurements = { calls: 0, characters: 0 };
	const custom = {
		type: "custom" as const,
		repositoryUrl: "https://forge.example/team/project",
		command: "fixture-provider",
		args: [],
	};
	const factoryTools = new FactoryTools({
		postComment: async () => {},
		...(options.feedback
			? {
					command: async (
						ctx: ExecutionContext,
						exe: string,
						args: string[],
					) => {
						if (exe === "git") return git(ctx.run.workspace, ...args);
						if (exe === "/bin/sh")
							return execFileSync(exe, args, {
								cwd: ctx.run.workspace,
								encoding: "utf8",
							});
						if (exe !== "fixture-provider")
							throw new Error(`Unexpected fixture command ${exe}`);
						const request = JSON.parse(readFileSync(args.at(-1)!, "utf8"));
						if (args[0] !== "readiness")
							throw new Error(`Unexpected provider operation ${args[0]}`);
						return JSON.stringify({
							url: request.input.url,
							headSha: git(root, "rev-parse", "HEAD"),
							baseSha: git(root, "rev-parse", "refs/remotes/origin/trunk"),
							state: "OPEN",
							isDraft: true,
							approved: false,
							reviewReady: true,
							fix: false,
							blockers: [
								{
									kind: "draft",
									action: "human",
									message: "Human approval still required",
								},
							],
							checks: [
								{ name: "fixture-check", state: "success", bucket: "pass" },
							],
							comments: [
								{
									id: "notice",
									body: options.comment ?? "Thanks for the update",
									user: { login: "reviewer" },
								},
							],
							threads: [],
							reviews: [],
							queued: false,
							mergeMethod: "merge",
						});
					},
				}
			: {}),
	});
	const home = mkdtempSync(join(tmpdir(), "impact-runtime-"));
	homes.push(home);
	const hooks = {
		agent: async (context) => {
			calls.push(context.step.id);
			// Real paginated context tools with a controlled simulated-agent access pattern.
			await measureContext(context.input, contextMeasurements);
			if (context.step.impactContract) {
				const input = context.input as {
					impactSnapshot: ImpactSnapshot;
					impactEvidence: { digest: string; receipt: any }[];
				};
				const unchanged = input.impactSnapshot.repositories.every(
					(r) => !r.diff,
				);
				const prior = input.impactEvidence.filter(
					(r) =>
						(unchanged ||
							!["quality", "business"].includes(r.receipt.stamp.reviewer)) &&
						r.receipt.status === "completed" &&
						r.receipt.evidenceBoundary,
				);
				const result = assessment(
					input.impactSnapshot,
					prior.map((r) => ({
						reviewer: r.receipt.stamp.reviewer,
						receiptDigest: r.digest,
						boundary: r.receipt.evidenceBoundary.boundary,
						reason:
							"Teardown has no path into authorization, inspected callers and dependencies",
					})),
				);
				if (
					(options.operationalAnswer || options.blocked) &&
					context.run.answers.length &&
					unchanged
				) {
					const inventory = (context.run.outputs.gate as AggregateReview)
						.baseline.inventory;
					result.classification = "none";
					result.scopeReuse = {
						inventoryDigest: inventory.digest,
						originalSourceDigest: inventory.sourceContextDigest!,
						reason:
							"The operational answer restores fixture access and explicitly preserves accepted requirements; all scope sources were independently reassessed",
					};
				}
				const comments = (
					context.run.outputs.ci as
						| { unassessedComments?: { id: string; bodySha256: string }[] }
						| undefined
				)?.unassessedComments;
				if (options.feedback && comments?.length && unchanged)
					Object.assign(result, {
						classification: "none",
						checks: [],
						readinessOnly: true,
						commentAssessments: comments.map((c) => ({
							id: c.id,
							bodySha256: c.bodySha256,
							disposition: "informational",
							reason:
								"A thanks message requests no correction or requirement change",
						})),
					});
				return result;
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
			if (
				context.step.id === "business" &&
				context.reviewBaseline?.round === 2 &&
				options.blocked &&
				!context.run.answers.length
			)
				return {
					status: "blocked",
					blockers: ["Fixture access is unavailable"],
					summary: "Cannot complete acceptance review without the fixture",
					findings: [],
					disagreements: [],
					coverage: [
						{
							requirementId: "R1",
							status: "met",
							reason: "Code appears complete but fixture inspection is blocked",
							evidence: [
								"Implementation receipt; independent verification not completed",
							],
						},
					],
				};
			if (
				context.step.id === "business" &&
				context.reviewBaseline?.round === 2 &&
				options.fail
			) {
				await waitFor(() =>
					expect(
						context.run.history.some(
							(h) =>
								h.step.endsWith("/quality") &&
								(h.output as any).stamp?.round === 2,
						),
					).toBe(true),
				);
				throw new Error("Fixture reviewer unavailable");
			}
			if (context.step.id === "repair") {
				writeFileSync(
					join(root, "teardown"),
					"remove only owned resources; tolerate absence\n",
				);
				git(root, "add", ".");
				git(root, "commit", "-m", "teardown correction");
				return { summary: "Handled absent resources", checks: [] };
			}
			const security = !["quality", "business"].includes(context.step.id);
			if (security)
				execFileSync(
					layout === "js" ? process.execPath : "python3",
					layout === "js"
						? [
								"-e",
								"const allowed = require('./src/auth.js'); if (allowed('unknown') || !allowed('trusted')) process.exit(1)",
							]
						: [
								"-c",
								"import sys; sys.path.insert(0, 'service'); from access import allowed; assert allowed('trusted') and not allowed('unknown')",
							],
					{ cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
				);
			return {
				status: "completed",
				blockers: [],
				summary: "Inspected consequential boundaries",
				findings: [],
				disagreements: [],
				...(impact
					? {
							evidenceBoundary: {
								requirementIds: ["R1"],
								areas: [security ? "authorization" : "teardown"],
								dependencies: [security ? authPath(layout) : "teardown"],
								independence:
									"Inspected callers and shared configuration; these modules are independent",
							},
						}
					: {}),
				...(context.step.reviewContract === "coverage-v1"
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									reason: "Teardown is limited to owned resources",
									evidence: ["teardown inspected; fixture verification passed"],
								},
							],
						}
					: {}),
			};
		},
		script: async () => ({}),
		question: options.blocked
			? async (run: FactoryRun) => {
					expect(run.status).toBe("waiting");
					expect((run.outputs.gate as AggregateReview).approved).toBe(false);
					runtime.answer(
						run.id,
						"Fixture access is restored. Accepted requirements are unchanged.",
					);
				}
			: undefined,
		tool: async (context) => {
			if (context.step.tool !== "choose") return factoryTools.tool(context);
			const repaired = context.run.history.some((h) =>
				h.step.endsWith("repair"),
			);
			if (repaired && options.operationalAnswer && !injectedAnswer) {
				injectedAnswer = true;
				context.run.answers.push({
					questions: ["Restore the fixture access"],
					answer:
						"Fixture access is restored. Accepted requirements are unchanged.",
					at: new Date().toISOString(),
				});
				return { assess: true, fix: false };
			}
			return { fix: !repaired };
		},
	};
	const runtime = new WorkflowRuntime(home, hooks);
	runtimes.push(runtime);
	const parent = options.nested
		? validateWorkflows([
				...defaultWorkflows,
				definitionValue,
				{
					id: "nested-fixture",
					name: "Nested fixture",
					steps: [
						{
							id: "invoke",
							name: "Invoke",
							type: "workflow",
							workflow: definitionValue.id,
						},
					],
				},
			]).at(-1)!
		: definitionValue;
	runtime.updateWorkflows([
		...defaultWorkflows,
		definitionValue,
		...(options.nested ? [parent] : []),
	]);
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: parent.id,
			at: new Date().toISOString(),
		},
		title: "Teardown",
		repositoryId: "fixture-repo",
		workspace: root,
		input: "Remove only owned resources",
		workflow: parent,
		repositories: [
			{
				id: "fixture-repo",
				name: "Fixture",
				workspace: root,
				repositoryPath: root,
				baseBranch: "trunk",
			},
		],
	});
	if (options.feedback) {
		run.gitProvider = custom;
		run.outputs["draft-pr"] = {
			url: "https://forge.example/team/project/pulls/1",
			headSha: git(root, "rev-parse", "HEAD"),
		};
	}
	await runtime.launch(run);
	if (!options.fail) {
		expect(run.error).toBeUndefined();
		expect(run.status).toBe("completed");
	}
	return {
		run,
		root,
		home,
		hooks,
		runtime,
		calls,
		contextMeasurements,
		definition: definitionValue,
		factoryTools,
	};
}
it.each([
	"js",
	"python",
])("measures actual old and selected correction scheduling for %s layout", async (layout) => {
	const before = await drive(false, layout);
	const after = await drive(true, layout);
	const specialists = [
		"security",
		"integration",
		"architecture",
		"maintenance",
		"quality",
		"business",
	];
	expect(before.calls.filter((id) => specialists.includes(id))).toHaveLength(
		12,
	);
	expect(after.calls.filter((id) => specialists.includes(id))).toHaveLength(8);
	expect(before.calls.filter((id) => id === "scope")).toHaveLength(2);
	expect(after.calls.filter((id) => id === "scope")).toHaveLength(1);
	expect(after.calls.filter((id) => id === "security")).toHaveLength(1);
	const aggregate = after.run.outputs.gate as AggregateReview;
	expect(aggregate.approved).toBe(true);
	const original = (
		after.run.history.find(
			(h) =>
				(h.output as AggregateReview)?.baseline?.round === 1 &&
				(h.output as AggregateReview).approved,
		)?.output as AggregateReview
	).reviewers.find((r) => r.stamp.reviewer === "security")!;
	expect(
		aggregate.reviewers.find((r) => r.stamp.reviewer === "security"),
	).toEqual(original);
	expect(aggregate.baseline.impact!.reuse[0]!.originalDigest).toBe(
		qaDigest(original),
	);
	assertAggregateRevision(
		aggregate,
		aggregate.baseline.headSha,
		aggregate.baseline.baseSha,
	);
	process.stdout.write(
		`${JSON.stringify({
			layout,
			before: {
				specialistInvocations: 12,
				extractionInvocations: 2,
				workflowVisits: before.run.history.length,
				actualContextRetrieval: before.contextMeasurements,
			},
			after: {
				specialistInvocations: 8,
				extractionInvocations: 1,
				workflowVisits: after.run.history.length,
				actualContextRetrieval: after.contextMeasurements,
			},
		})}\n`,
	);
});
it("rejects stale source, weakened tests, blocked receipts, unknown reviewers and absent approvals", async () => {
	const fixture = await drive(true);
	const impact = fixture.run.impactDecisions!.at(-1)!;
	const fanout = fixture.definition.steps.find((s) => s.id === "experts")!;
	const context = {
		run: fixture.run,
		step: fanout,
		input: impact.snapshot,
		outputs: fixture.run.outputs,
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
		currentScope: () =>
			(fixture.run.outputs.gate as AggregateReview).baseline.context,
	} satisfies ExecutionContext;
	const snapshot = await collectImpactSnapshot(
		context,
		fanout,
		"experts",
		impact.snapshot,
	);
	expect(() =>
		validateImpact(
			{ ...assessment(snapshot), specialists: ["unknown"] },
			snapshot,
			fixture.run,
		),
	).toThrow("configured specialists");
	expect(() =>
		validateImpact(
			{
				...impact,
				testAssertions: { ...impact.testAssertions, weakened: true },
			},
			impact.snapshot,
			fixture.run,
		),
	).toThrow("full relevant review");
	expect(() =>
		validateImpact(
			{ ...impact, humanReview: "continue-after-checks" },
			impact.snapshot,
			fixture.run,
		),
	).toThrow("prior explicit approval");
	const blocked = structuredClone(impact.reuseRecords[0]!.original);
	blocked.status = "blocked";
	const previous = fixture.run.history.findLast(
		(h) =>
			(h.output as AggregateReview)?.baseline?.round === 1 &&
			(h.output as AggregateReview)?.reviewers,
	)?.output as AggregateReview;
	expect(previous).toBeDefined();
	writeFileSync(join(fixture.root, "src/auth.js"), "allow unknown callers\n");
	git(fixture.root, "add", ".");
	git(fixture.root, "commit", "-m", "security regression");
	await expect(assertImpactFresh(context, impact, fanout)).rejects.toThrow(
		"stale",
	);
	expect(
		continuationEligible(impact, fixture.run.outputs.gate as AggregateReview),
	).toBe(false);
});
it("bounds unchanged cycles across dates, receipt identities and unrelated target churn", async () => {
	const { run } = await drive(true);
	const decision = structuredClone(run.impactDecisions!.at(-1)!);
	run.impactConvergence = {};
	expect(recordConvergence(run, "experts", decision, 3)).toEqual([]);
	decision.at = "new date";
	decision.snapshot.repositories[0]!.targetSha = "other target";
	decision.reuseRecords[0]!.original.stamp.round += 1;
	expect(recordConvergence(run, "experts", decision, 3)).toEqual([]);
	const previousTree = decision.snapshot.repositories[0]!.treeSha;
	decision.snapshot.repositories[0]!.treeSha = "alternating-tree";
	expect(recordConvergence(run, "experts", decision, 3)).toEqual([]);
	decision.snapshot.repositories[0]!.treeSha = previousTree;
	decision.snapshot.repositories[0]!.headSha = "empty-commit-new-sha";
	expect(recordConvergence(run, "experts", decision, 3)[0]).toContain(
		"returned 3 times",
	);
	expect(run.humanDecisions).toBeUndefined();
});
it("preserves grouped original execution stamps while validating repository projections", async () => {
	const { run } = await drive(true);
	const original = run.outputs.gate as AggregateReview;
	const grouped = structuredClone(original);
	grouped.baseline.repositories = [
		{
			repositoryId: "fixture-repo",
			name: "Fixture",
			headSha: grouped.baseline.headSha,
			baseSha: grouped.baseline.baseSha,
		},
		{
			repositoryId: "second",
			name: "Second",
			headSha: "second-head",
			baseSha: "second-target",
		},
	];
	grouped.baseline.headSha = "group-head";
	grouped.baseline.baseSha = "group-base";
	// Receipt original stamps still belong to their actual execution (the fixture head).
	const projected = repositoryRun(
		{
			...run,
			history: [{ step: "gate", output: grouped, at: "now" }],
			reviewRounds: [grouped.baseline],
		},
		{ ...run.repositories![0]!, id: "second" },
	);
	const receipt = projected.history[0]!.output as AggregateReview;
	expect(receipt.reviewers).toEqual(grouped.reviewers);
	expect(receipt.projection?.original).toBe(grouped);
});
it("recovers selected work in a nested graph without replaying completed agents or assessment", async () => {
	const options = { fail: true, nested: true };
	const fixture = await drive(true, "js", options);
	expect(fixture.run.status).toBe("failed");
	expect(fixture.run.error).toContain("Fixture reviewer unavailable");
	const oldRound = structuredClone(fixture.run.reviewRounds!.at(-1));
	options.fail = false;
	await fixture.runtime.shutdown();
	const restored = new WorkflowRuntime(fixture.home, fixture.hooks);
	runtimes.push(restored);
	restored.retry(fixture.run.id);
	await waitFor(
		() =>
			expect(
				restored.get(fixture.run.id).status,
				restored.get(fixture.run.id).error,
			).toBe("completed"),
		{ timeout: 10000 },
	);
	const run = restored.get(fixture.run.id);
	expect(run.reviewRounds!.at(-1)).toEqual(oldRound);
	expect(fixture.calls.filter((id) => id === "assessor")).toHaveLength(2);
	expect(fixture.calls.filter((id) => id === "scope")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "security")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "quality")).toHaveLength(2);
	expect(run.checkpoint?.reviewKey).toBe("invoke/experts");
	expect(run.impactDecisions!.at(-1)!.pending.specialists).toEqual([]);
});
it("inspects a non-mutating combined tree and invalidates overlap or conflicts instead of target-only regressions", async () => {
	const fixture = await drive(true);
	const branchHead = git(fixture.root, "rev-parse", "HEAD");
	const key = "experts";
	const fanout = fixture.definition.steps.find((s) => s.id === key)!;
	const context = {
		run: fixture.run,
		step: fanout,
		reviewKey: key,
		input: (fixture.run.outputs.gate as AggregateReview).baseline.context,
		currentScope: () =>
			(fixture.run.outputs.gate as AggregateReview).baseline.context,
		outputs: fixture.run.outputs,
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
	} satisfies ExecutionContext;
	git(fixture.root, "checkout", "trunk");
	writeFileSync(join(fixture.root, "unrelated"), "target-only change\n");
	git(fixture.root, "add", ".");
	git(fixture.root, "commit", "-m", "unrelated target advancement");
	git(fixture.root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
	git(fixture.root, "checkout", "feature");
	const benign = await collectImpactSnapshot(context, fanout, key);
	expect(benign.repositories[0]!.headSha).toBe(branchHead);
	expect(benign.repositories[0]!.diff).toBe("");
	expect(benign.repositories[0]!.targetFiles).toEqual(["unrelated"]);
	expect(benign.repositories[0]!.combinedDiff).toContain("target-only change");
	expect(benign.repositories[0]!.uncertainty).toEqual([]);
	expect(git(fixture.root, "rev-parse", "HEAD")).toBe(branchHead);
	const previous = fixture.run.outputs.gate as AggregateReview;
	const reuse = previous.reviewers.map((r) => ({
		reviewer: r.stamp.reviewer,
		receiptDigest: qaDigest(r),
		boundary: r.evidenceBoundary!.boundary,
		reason: "Unrelated target file does not overlap inspected boundaries",
	}));
	const selected = {
		...assessment(benign, reuse),
		classification: "none",
		checks: [],
	};
	expect(
		validateImpact(selected, benign, fixture.run).reuseRecords,
	).toHaveLength(6);
	git(fixture.root, "checkout", "trunk");
	writeFileSync(
		join(fixture.root, "src/auth.js"),
		"module.exports = () => true;\n",
	);
	git(fixture.root, "add", ".");
	git(fixture.root, "commit", "-m", "target security boundary change");
	git(fixture.root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
	git(fixture.root, "checkout", "feature");
	const overlap = await collectImpactSnapshot(context, fanout, key);
	expect(() => validateImpact(selected, overlap, fixture.run)).toThrow(
		"integrate and validate",
	);
	git(fixture.root, "checkout", "trunk");
	writeFileSync(
		join(fixture.root, "teardown"),
		"remove all resources regardless of owner\n",
	);
	git(fixture.root, "add", ".");
	git(fixture.root, "commit", "-m", "conflicting target");
	git(fixture.root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
	git(fixture.root, "checkout", "feature");
	const conflict = await collectImpactSnapshot(context, fanout, key);
	expect(conflict.repositories[0]!.uncertainty.length).toBeGreaterThan(0);
	expect(() =>
		validateImpact(assessment(conflict), conflict, fixture.run),
	).toThrow("combined-tree");
	expect(git(fixture.root, "rev-parse", "HEAD")).toBe(branchHead);
	expect(git(fixture.root, "status", "--porcelain")).toBe("");
});
it("keeps optional disagreements nonblocking, consolidates demonstrated duplicates and tracks downstream QA separately", async () => {
	const { run } = await drive(true);
	const baseline = structuredClone(
		(run.outputs.gate as AggregateReview).baseline,
	);
	baseline.impact!.reuse = [];
	const finding = {
		id: "ownership",
		rating: 3,
		status: "open",
		summary: "Removes unowned data",
		evidence: "teardown:3 deletes the caller's sibling resource",
		category: "defect",
		consequence: "Unowned data is lost",
		remedy: "Check resource ownership before deleting",
		requirementIds: ["R1"],
		investigation: { state: "confirmed" },
	};
	const parsed = validateSpecialist(
		{
			status: "completed",
			summary: "Inspected",
			findings: [finding],
			optionalDisagreements: ["Prefer a smaller helper"],
		},
		baseline,
		false,
	);
	const branches: Record<string, unknown>[] = baseline.reviewers.map((r) => ({
		[r.id]: {
			...parsed,
			findings:
				r.id === "security"
					? [finding]
					: r.id === "quality"
						? [{ ...finding, duplicateOf: "security:ownership" }]
						: [],
			coverage:
				r.contract === "coverage-v1"
					? [
							{
								requirementId: "R1",
								status: "met",
								evidence: ["Ownership check is in scope"],
								reason: "Covered",
							},
						]
					: [],
			stamp: {
				reviewer: r.id,
				stepKey: r.key,
				round: baseline.round,
				inventoryDigest: baseline.inventory.digest,
				inventoryVersion: baseline.inventory.version,
				headSha: baseline.headSha,
				baseSha: baseline.baseSha,
			},
		},
	}));
	const duplicate = aggregateReview(baseline, branches);
	expect(duplicate.findings).toHaveLength(1);
	expect(duplicate.rawFindings).toHaveLength(2);
	expect(duplicate.approved).toBe(false);
	expect(() =>
		validateSpecialist(
			{ ...parsed, findings: [{ ...finding, category: "optional" }] },
			baseline,
			false,
		),
	).toThrow("nonblocking");
	baseline.inventory.requirements[0]!.stage = "qa";
	expect(
		validateSpecialist(
			{
				status: "completed",
				summary: "Code complete; executable QA is next",
				findings: [],
				coverage: [
					{
						requirementId: "R1",
						status: "deferred",
						evidence: ["Implementation inspected"],
						reason: "QA executes in the next stage",
						obligation: { stage: "qa", action: "Run the ownership scenario" },
					},
				],
			},
			baseline,
			true,
		).coverage[0]!.status,
	).toBe("deferred");
	baseline.inventory.requirements[0]!.stage = "code";
	expect(() =>
		validateSpecialist(
			{
				status: "completed",
				summary: "Avoid review",
				findings: [],
				coverage: [
					{
						requirementId: "R1",
						status: "deferred",
						evidence: ["No check"],
						reason: "Defer defect",
						obligation: { stage: "qa", action: "Later" },
					},
				],
			},
			baseline,
			true,
		),
	).toThrow("declared downstream obligation");
});
it("preserves original behavioral execution and rejects changed definitions, fixtures and failed QA reuse", async () => {
	const fixture = await drive(true);
	const run = fixture.run;
	const current = run.impactDecisions!.at(-1)!;
	const initial = run.impactDecisions![0]!;
	const scope: QaScope = {
		qaContract: "qa-v1",
		areas: [],
		environment: { isolation: "worktree" },
		environmentFingerprint: "fixture-v1",
		environmentEvidence: {
			repositoryId: "fixture-repo",
			command: "printf fixture-v1",
			expectedDigest: qaDigest("fixture-v1"),
		},
		stories: [
			{
				id: "guard",
				goal: "Reject unknown callers",
				requirementRefs: ["R1"],
				interface: "cli",
				preconditions: [],
				fixtures: ["Guard fixture"],
				actions: ["Run the guard check"],
				criteria: [
					{ id: "deny-unknown", expected: "Unknown callers are rejected" },
				],
				evidenceInstructions: "Node assertion",
				screenshotTasks: [],
				dependencies: ["src/auth.js"],
				independence: "Teardown and guard share no inputs or configuration",
			},
		],
		exclusions: [],
	};
	run.outputs["visual-scope"] = scope;
	const context = {
		run,
		reviewKey: "experts",
		step: fixture.definition.steps.find((s) => s.id === "scope")!,
		outputs: run.outputs,
		input: {},
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
	} satisfies ExecutionContext;
	run.impactDecisions = [initial];
	await verifyQaEnvironment(context);
	const execution = QaExecutionSchema.parse({
		qaContract: "qa-v1",
		results: [
			{
				storyId: "guard",
				outcome: "passed",
				criteria: [
					{
						criterionId: "deny-unknown",
						expected: "Unknown callers are rejected",
						outcome: "passed",
						observed: "Node assertion passed",
						evidence: [
							{
								kind: "test",
								executed: true,
								action: "node guard-check",
								details: "Exit code 0",
								exitCode: 0,
							},
						],
					},
				],
			},
		],
		findings: [],
		observations: [],
		testedRevision: {
			headSha: initial.snapshot.repositories[0]!.headSha,
			dirty: false,
			scopeHash: qaDigest(scope),
		},
	});
	execFileSync(
		process.execPath,
		["-e", "if(require('./src/auth.js')('unknown')) process.exit(1)"],
		{ cwd: fixture.root },
	);
	stampQaCriteria(context, execution);
	const original = execution.results[0]!.criteria[0]!;
	run.history.push(
		{ step: "capture", output: execution, at: "original date" },
		{
			step: "visual-gate",
			output: { approved: true, headSha: original.origin!.headSha },
			at: "approved date",
		},
	);
	run.impactDecisions = [initial, current];
	current.qaReuse = [
		{
			criterionId: original.criterionId,
			originalDigest: qaDigest(original),
			reason:
				"Only unrelated teardown changed; guard definitions, fixtures and sources are identical",
		},
	];
	const retained = qaReuseContext(context).criteria[0]!.criterion;
	expect(retained.origin).toEqual(original.origin);
	const composed = structuredClone(execution);
	composed.results[0]!.criteria[0] = retained;
	stampQaCriteria(context, composed);
	expect(current.pending.qaCriteria).toEqual([]);
	scope.environmentFingerprint = "fixture-v2";
	expect(() => qaReuseContext(context)).toThrow("unchanged definitions");
	scope.environmentFingerprint = "fixture-v1";
	scope.stories[0]!.criteria[0]!.expected = "Allow everyone";
	expect(() => qaReuseContext(context)).toThrow("unchanged definitions");
	scope.stories[0]!.criteria[0]!.expected = "Unknown callers are rejected";
	original.outcome = "failed";
	current.qaReuse[0]!.originalDigest = qaDigest(original);
	expect(() => qaReuseContext(context)).toThrow("passed original evidence");
});
it("assesses informational comments once without a fixer or full review through a custom forge adapter", async () => {
	const options = { feedback: true, comment: "Thanks for the update" };
	const fixture = await drive(true, "js", options);
	expect(fixture.calls.filter((id) => id === "assessor")).toHaveLength(3);
	expect(fixture.calls.filter((id) => id === "repair")).toHaveLength(1);
	expect(
		fixture.calls.filter((id) =>
			[
				"security",
				"integration",
				"architecture",
				"maintenance",
				"quality",
				"business",
			].includes(id),
		),
	).toHaveLength(8);
	const decision = fixture.run.impactDecisions!.at(-1)!;
	expect(decision.readinessOnly).toBe(true);
	expect(decision.commentAssessments[0]).toMatchObject({
		id: "notice",
		disposition: "informational",
	});
	expect(fixture.run.outputs["provider-ci"]).toMatchObject({
		unassessedComments: [],
		fix: false,
	});
	const ci = fixture.definition.steps.find((s) => s.id === "provider-ci")!;
	const context = {
		run: fixture.run,
		step: ci,
		stepKey: ci.id,
		reviewKey: "experts",
		impactKey: "experts",
		outputs: fixture.run.outputs,
		currentScope: () =>
			(fixture.run.outputs.gate as AggregateReview).baseline.context,
		input: {},
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
	} satisfies ExecutionContext;
	options.comment = "Thanks for the updated explanation";
	const edited = (await fixture.factoryTools.tool(context)) as {
		impactRequired: boolean;
		unassessedComments: { bodySha256: string }[];
	};
	expect(edited.impactRequired).toBe(true);
	expect(edited.unassessedComments[0]!.bodySha256).not.toBe(
		decision.commentAssessments[0]!.bodySha256,
	);
	expect(() =>
		validateImpact(
			{
				...decision,
				readinessOnly: false,
				commentAssessments: [
					{ ...decision.commentAssessments[0], disposition: "consequential" },
				],
				correctionRequired: false,
			},
			decision.snapshot,
			fixture.run,
		),
	).toThrow("corrective work");
});
it("continues explicit approval for a safe cumulative production correction only after required checks pass", async () => {
	const fixture = await drive(true);
	const run = fixture.run;
	const priorHead = run.reviewRounds![0]!.headSha;
	const currentHead = run.reviewRounds!.at(-1)!.headSha;
	const url = "https://forge.example/team/project/pulls/1";
	run.outputs["draft-pr"] = { url, headSha: currentHead };
	const original = {
		reviewId: "explicit-review",
		headSha: priorHead,
		url,
		decision: "approve" as const,
		at: new Date().toISOString(),
	};
	run.humanDecisions = [original];
	const context = {
		run,
		step: {
			id: "merge",
			name: "Merge",
			type: "tool" as const,
			tool: "merge",
			impactSource: "assessor",
			branches: [],
			maxVisits: 8,
		},
		reviewKey: "experts",
		impactKey: "experts",
		outputs: run.outputs,
		input: (run.outputs.gate as AggregateReview).baseline.context,
		currentScope: () => (run.outputs.gate as AggregateReview).baseline.context,
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
	} satisfies ExecutionContext;
	const snapshot = await collectImpactSnapshot(
		context,
		fixture.definition.steps.find((s) => s.id === "experts")!,
		"experts",
	);
	expect(snapshot.repositories[0]!.approvalDiff).toContain("tolerate absence");
	const aggregate = run.outputs.gate as AggregateReview;
	const reuse = aggregate.reviewers.map((r) => ({
		reviewer: r.stamp.reviewer,
		receiptDigest: qaDigest(r),
		boundary: r.evidenceBoundary!.boundary,
		reason:
			"The cumulative teardown correction was independently inspected and unrelated boundaries are unchanged",
	}));
	const value = {
		...assessment(snapshot, reuse),
		classification: "none",
		humanReview: "continue-after-checks",
		approvalRationale:
			"The complete cumulative correction only handles an absent owned resource; behavior and safeguards remain intact",
	};
	const result = validateImpact(value, snapshot, run);
	expect(continuationEligible(result, aggregate)).toBe(false);
	run.impactDecisions!.push(result);
	const checkStep = { ...context.step, id: "checks", tool: "impact-checks" };
	await fixture.factoryTools.tool({ ...context, step: checkStep });
	expect(continuationEligible(result, aggregate)).toBe(true);
	run.approvalContinuations = [
		{
			originalReviewId: original.reviewId,
			decisionDigest: impactDecisionDigest(result),
			headSha: currentHead,
			at: new Date().toISOString(),
		},
	];
	expect((await effectiveApproval(context))!.headSha).toBe(currentHead);
	expect(run.humanDecisions).toEqual([original]);
	result.checkResults[0]!.exitCode = 1;
	expect(continuationEligible(result, aggregate)).toBe(false);
	expect((await effectiveApproval(context))!.headSha).toBe(priorHead);
	result.checkResults[0]!.exitCode = 0;
	run.approvalContinuations[0]!.decisionDigest = "stale-decision";
	expect((await effectiveApproval(context))!.headSha).toBe(priorHead);
	expect(() =>
		validateImpact(
			{
				...value,
				uncertainty: ["Unknown effect on ownership"],
				classification: "full",
				specialists: snapshot.reviewers.map((r) => r.id),
				reuse: [],
			},
			snapshot,
			run,
		),
	).toThrow("renewed approval");
	run.humanDecisions.push({
		...original,
		reviewId: "rejected",
		decision: "reject",
		feedback: "Change ownership behavior",
		at: new Date().toISOString(),
	});
	expect((await effectiveApproval(context))!.decision).toBe("reject");
});
it("selects and checks grouped repositories with different layouts, targets and provider bindings", async () => {
	const group = mkdtempSync(join(tmpdir(), "impact-grouped-"));
	homes.push(group);
	const first = repository("js"),
		second = repository("python");
	const api = join(group, "api"),
		worker = join(group, "worker");
	renameSync(first, api);
	renameSync(second, worker);
	git(worker, "branch", "-m", "trunk", "stable");
	git(
		worker,
		"update-ref",
		"refs/remotes/origin/stable",
		"refs/remotes/origin/trunk",
	);
	const scope = [
		{
			id: "api",
			name: "API",
			workspace: api,
			repositoryPath: api,
			baseBranch: "trunk",
			providerSnapshot: {
				type: "custom" as const,
				repositoryUrl: "https://forge.example/team/api",
				command: "fixture-forge",
				args: [],
			},
		},
		{
			id: "worker",
			name: "Worker",
			workspace: worker,
			repositoryPath: worker,
			baseBranch: "stable",
			providerSnapshot: {
				type: "gitlab" as const,
				repositoryUrl: "https://gitlab.example/team/worker",
			},
		},
	];
	const workflow = definition(true);
	const home = mkdtempSync(join(tmpdir(), "impact-grouped-state-"));
	homes.push(home);
	const calls: string[] = [];
	const checks: string[] = [];
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (ctx, exe, args) => {
			checks.push(ctx.run.workspace);
			return execFileSync(exe, args, {
				cwd: ctx.run.workspace,
				encoding: "utf8",
			});
		},
	});
	const runtime = new WorkflowRuntime(home, {
		agent: async (context) => {
			calls.push(context.step.id);
			if (context.step.impactContract) {
				const input = context.input as {
					impactSnapshot: ImpactSnapshot;
					impactEvidence: { digest: string; receipt: any }[];
				};
				const reuse = input.impactEvidence
					.filter(
						(r) => !["quality", "business"].includes(r.receipt.stamp.reviewer),
					)
					.map((r) => ({
						reviewer: r.receipt.stamp.reviewer,
						receiptDigest: r.digest,
						boundary: r.receipt.evidenceBoundary.boundary,
						reason:
							"Teardown in API does not affect either authorization module",
					}));
				return {
					...assessment(input.impactSnapshot, reuse),
					checks: input.impactSnapshot.repositories.map((r) => ({
						id: `${r.repositoryId}-check`,
						repositoryId: r.repositoryId,
						command: "test -s teardown",
						reason: "Check each repository's cleanup fixture",
					})),
				};
			}
			if (context.step.id === "scope")
				return {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion: "Remove only owned resources in the selected scope",
							classification: "active",
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
			if (context.step.id === "repair") {
				writeFileSync(
					join(api, "teardown"),
					"remove only owned resources; tolerate absence\n",
				);
				git(api, "add", ".");
				git(api, "commit", "-m", "grouped correction");
				return { summary: "Corrected API teardown" };
			}
			const unrelated = !["quality", "business"].includes(context.step.id);
			return {
				status: "completed",
				summary: "Inspected both repository boundaries",
				blockers: [],
				findings: [],
				disagreements: [],
				evidenceBoundary: {
					requirementIds: ["R1"],
					areas: [unrelated ? "authorization" : "cleanup"],
					dependencies: unrelated
						? ["api/src/auth.js", "worker/service/access.py"]
						: ["api/teardown", "worker/teardown"],
					independence: "No shared source or fixture crosses these boundaries",
				},
				...(context.step.reviewContract === "coverage-v1"
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									evidence: ["Both cleanup fixtures verified"],
									reason: "Owned scope is preserved",
								},
							],
						}
					: {}),
			};
		},
		script: async () => ({}),
		tool: async (context) =>
			context.step.tool === "choose"
				? { fix: !context.run.history.some((h) => h.step.endsWith("repair")) }
				: tools.tool(context),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		title: "Grouped correction",
		repositoryId: "api",
		repositories: scope,
		workspace: group,
		input: "Preserve ownership across both repositories",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(calls.filter((id) => id === "security")).toHaveLength(1);
	expect(checks).toEqual([api, worker, api, worker]);
	const aggregate = run.outputs.gate as AggregateReview;
	expect(aggregate.baseline.repositories).toHaveLength(2);
	assertAggregateRevision(
		aggregate,
		aggregate.baseline.headSha,
		aggregate.baseline.baseSha,
	);
	for (const repository of scope) {
		const projected = repositoryRun(run, repository);
		const review = projected.outputs.gate as AggregateReview;
		expect(review.reviewers).toEqual(aggregate.reviewers);
		assertAggregateRevision(
			review,
			git(repository.workspace, "rev-parse", "HEAD"),
			git(
				repository.workspace,
				"rev-parse",
				`refs/remotes/origin/${repository.baseBranch}`,
			),
		);
	}
	const snapshot = run.impactDecisions!.at(-1)!.snapshot;
	expect(snapshot.repositories.map((r) => r.repositoryId)).toEqual([
		"api",
		"worker",
	]);
	expect(snapshot.repositories[1]!.headSha).toBe(
		run.reviewRounds![0]!.repositories![1]!.headSha,
	);
	const approved = {
		reviewId: "grouped-explicit",
		headSha: aggregate.baseline.headSha,
		decision: "approve" as const,
		at: new Date().toISOString(),
		repositories: scope.map((r, i) => ({
			repositoryId: r.id,
			name: r.name,
			url: `https://forge.example/team/${r.id}/pulls/1`,
			headSha: snapshot.repositories[i]!.headSha,
		})),
	};
	const candidate = structuredClone(run.impactDecisions!.at(-1)!);
	candidate.snapshot.approval = approved;
	candidate.snapshot.repositories.forEach((r, i) => {
		r.url = approved.repositories[i]!.url;
	});
	candidate.humanReview = "continue-after-checks";
	expect(continuationEligible(candidate, aggregate)).toBe(true);
	candidate.snapshot.repositories[1]!.url =
		"https://forge.example/team/worker/pulls/2";
	expect(continuationEligible(candidate, aggregate)).toBe(false);
});
it("reuses an unchanged requirement inventory after independently assessed operational answers", async () => {
	const fixture = await drive(true, "js", { operationalAnswer: true });
	const original = fixture.run.history.find((h) => h.step === "scope")!
		.output as { digest: string; version: number; sourceContextDigest: string };
	const inventory = fixture.run.outputs.scope as typeof original & {
		scopeReuse: { originalSourceDigest: string };
	};
	const latest = fixture.run.impactDecisions!.at(-1)!;
	expect(fixture.calls.filter((id) => id === "scope")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "assessor")).toHaveLength(3);
	expect(inventory.digest).toBe(original.digest);
	expect(inventory.version).toBe(original.version);
	expect(inventory.scopeReuse.originalSourceDigest).toBe(
		original.sourceContextDigest,
	);
	expect(inventory.sourceContextDigest).toBe(latest.snapshot.sourceDigest);
	expect(original.sourceContextDigest).not.toBe(inventory.sourceContextDigest);
	expect(
		unchangedScopeProof(
			fixture.run,
			"experts",
			original.sourceContextDigest,
			inventory.sourceContextDigest,
			inventory.digest,
		),
	).toBe(true);
	expect(
		unchangedScopeProof(
			fixture.run,
			"experts",
			"unrelated-original",
			inventory.sourceContextDigest,
			inventory.digest,
		),
	).toBe(false);
	expect(() =>
		validateImpact(
			{
				...latest,
				scopeReuse: { ...latest.scopeReuse, inventoryDigest: "wrong" },
			},
			latest.snapshot,
			fixture.run,
		),
	).toThrow("exact prior source");
});
it("waits for a blocked specialist and resumes only outstanding review after assistance", async () => {
	const fixture = await drive(true, "js", { blocked: true });
	expect(fixture.run.answers).toHaveLength(1);
	expect(
		fixture.run.history.some(
			(h) => h.step === "gate" && (h.output as any).reviewIncomplete === true,
		),
	).toBe(true);
	expect(fixture.calls.filter((id) => id === "scope")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "repair")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "security")).toHaveLength(1);
	expect(fixture.calls.filter((id) => id === "business")).toHaveLength(3);
	expect((fixture.run.outputs.gate as AggregateReview).approved).toBe(true);
});
it("fingerprints custom requirement sources and ignores discussion timestamps and our own replies", async () => {
	const fixture = await drive(true);
	const run = fixture.run;
	const old = (run.outputs.gate as AggregateReview).baseline.inventory;
	const inventory = validateInventory(
		{
			...old,
			requirements: old.requirements.map((r) => ({
				...r,
				sources: [
					...r.sources,
					{ source: "context", reference: "/outputs/blueprint" },
				],
			})),
		},
		old,
	);
	run.outputs.scope = inventory;
	run.outputs.blueprint = { criterion: "Preserve ownership" };
	const fanout = fixture.definition.steps.find((s) => s.id === "experts")!;
	const scope = () => ({
		...((run.outputs.gate as AggregateReview).baseline.context as Record<
			string,
			unknown
		>),
		outputs: run.outputs,
	});
	const context = {
		run,
		step: fanout,
		input: scope(),
		currentScope: scope,
		outputs: run.outputs,
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: fixture.root,
	} satisfies ExecutionContext;
	const before = await collectImpactSnapshot(context, fanout, "experts");
	run.outputs.blueprint = { criterion: "Remove all resources" };
	const changed = await collectImpactSnapshot(context, fanout, "experts");
	expect(changed.sourceDigest).not.toBe(before.sourceDigest);
	run.outputs.ci = {
		comments: [
			{
				id: "1",
				body: "Thanks",
				updated_at: "first date",
				user: { login: "reviewer" },
			},
		],
		reviews: [],
		threads: [],
	};
	const original = feedbackDigest(run);
	(run.outputs.ci as any).comments[0].updated_at = "second date";
	(run.outputs.ci as any).comments.push({
		id: "ours",
		body: "Assessed. <!-- generated-by-bobs-factory -->",
	});
	expect(feedbackDigest(run)).toBe(original);
	(run.outputs.ci as any).comments[0].body = "Change ownership behavior";
	expect(feedbackDigest(run)).not.toBe(original);
});
