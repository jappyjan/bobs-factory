import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import {
	type DeliveryContract,
	TicketDelivery,
	type TicketState,
} from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { factoryFeedbackContext } from "../src/factory/FeedbackPolicy.js";
import type { ImpactSnapshot } from "../src/factory/Impact.js";
import { roleProgress } from "../src/factory/Incremental.js";
import { checkArgs, hasCheck } from "../src/factory/StepConfig.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { checkin } from "./fixtures/architecture.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { preCompositionWorkflows } from "./fixtures/pre-composition.js";
import { qaExecution, qaScope } from "./fixtures/qa.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const r of runtimes.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const criterion = "Save a record safely";
function fixture(
	mode: "repository" | "external" | "mixed",
	takeover = false,
	frozen = false,
	standalone: boolean | "router" | "called-external" = false,
	preparationFailure?: "missing" | "invalid" | "unreviewed",
) {
	const home = mkdtempSync(join(tmpdir(), "factory142-"));
	homes.push(home);
	const repo = join(home, "repo");
	execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("config", "user.name", "Controlled F1");
	git("config", "user.email", "f1@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "record.txt"), "before\n");
	git("add", ".");
	git("commit", "-m", "test: controlled baseline [skip ci]");
	const base = git("rev-parse", "HEAD");
	const bare = join(home, "origin.git");
	execFileSync("git", ["init", "--bare", bare], { stdio: "ignore" });
	git("remote", "add", "origin", bare);
	git("push", "origin", "main");
	git("checkout", "-b", "feature");
	if (takeover) {
		writeFileSync(join(repo, "record.txt"), "inherited\n");
		git("commit", "-am", "test: inherited work [skip ci]");
	}
	const url = "https://github.com/test/repo/pull/1";
	let exists = takeover,
		draft = true,
		merged = false,
		providerApproval = false;
	let planVersion = 0,
		reviewRejected = false,
		qualityFailed = false,
		handoffFailed = false,
		mergeReworked = false,
		ciCorrected = false;
	const calls: string[] = [];
	const commands: { step: string; executable: string; args: string[] }[] = [];
	const resource = {
		provider: "taskbot" as const,
		server: "controlled",
		instance: "https://tasks.example.test",
		project: "fixture",
		id: "1",
		url: "https://tasks.example.test/p/fixture/t/1",
	};
	const state: TicketState = {
		resource,
		fields: { title: "Controlled ticket", description: "before" },
		relationships: [],
		complete: true,
	};
	let runtime: WorkflowRuntime;
	let run: FactoryRun;
	let currentPlan: Record<string, unknown>;
	const host = Object.create(EdgeWorker.prototype) as {
		factoryRuntime: WorkflowRuntime;
		agentSessionManager: { getSession: () => undefined };
		issueTrackers: Map<string, unknown>;
		finalizeFactoryAgentOutput: (
			c: ExecutionContext,
			v: unknown,
		) => Promise<unknown>;
	};
	host.agentSessionManager = { getSession: () => undefined };
	host.issueTrackers = new Map();
	const delivery = new TicketDelivery(
		async () => ({
			capabilities: ["read", "content", "relationships"],
			limitation: "Controlled in-memory tracker; no live requests",
			read: async () => structuredClone(state),
			content: async (fields) => {
				Object.assign(state.fields, fields);
			},
			relationship: async () => {
				throw new Error("No relationship mutation authorized by this fixture");
			},
		}),
		(r) => runtime.save(r),
	);
	const tools = new FactoryTools({
		ticketDelivery: delivery,
		postComment: async () => {},
		command: async (c, exe, args) => {
			commands.push({ step: c.stepKey!, executable: exe, args });
			if (exe === "git") return git(...args);
			const request = githubRequest(args);
			const query = (request.body as { query?: string })?.query ?? "";
			if (query.includes("markPullRequestReadyForReview")) draft = false;
			if (query.includes("convertPullRequestToDraft")) draft = true;
			if (request.path.endsWith("/merge") && request.method === "PUT") {
				expect(providerApproval).toBe(true);
				merged = true;
			}
			if (request.path.includes("/pulls?"))
				return JSON.stringify(
					exists
						? [
								{
									html_url: url,
									url,
									number: 1,
									draft,
									head: { ref: "feature", sha: git("rev-parse", "HEAD") },
								},
							]
						: [],
				);
			if (request.path.endsWith("/pulls") && request.method === "POST") {
				exists = true;
				return JSON.stringify({
					html_url: url,
					number: 1,
					node_id: "PR_node",
					title: "Controlled record",
					body: "Controlled changes",
					draft: true,
					state: "open",
					head: {
						ref: "feature",
						sha: git("rev-parse", "HEAD"),
						repo: { full_name: "test/repo" },
					},
					base: { ref: "main", sha: base, repo: { full_name: "test/repo" } },
				});
			}
			const firstHandoff =
				c.step.tool === "handoff" &&
				!handoffFailed &&
				mode === "repository" &&
				request.path === "graphql" &&
				query.includes("statusCheckRollup");
			if (firstHandoff) handoffFailed = true;
			const firstMerge =
				c.step.tool === "merge" && !mergeReworked && mode === "repository";
			if (firstMerge) mergeReworked = true;
			const extra = {
				url,
				headRefOid: git("rev-parse", "HEAD"),
				baseRefOid: firstMerge ? git("rev-parse", "HEAD") : base,
				baseRefName: "main",
				isDraft: draft,
				state: merged ? "MERGED" : "OPEN",
				mergeCommit: merged ? { oid: git("rev-parse", "HEAD") } : null,
				mergedAt: merged ? new Date().toISOString() : null,
				reviewDecision: providerApproval ? "APPROVED" : "REVIEW_REQUIRED",
				mergeStateStatus: providerApproval ? "CLEAN" : "BLOCKED",
				...(firstHandoff
					? {
							statusCheckRollup: {
								contexts: {
									nodes: [
										{
											name: "controlled-check",
											status: "COMPLETED",
											conclusion: "FAILURE",
										},
									],
									pageInfo: { hasNextPage: false },
								},
							},
						}
					: {}),
				...(mergeReworked
					? {
							comments: {
								nodes: [
									{
										id: "controlled-comment",
										databaseId: 1,
										body: "Please assess the guard behavior",
										author: { login: "reviewer" },
										createdAt: "2026-10-23T00:00:00Z",
										updatedAt: "2026-10-23T00:00:00Z",
									},
								],
								pageInfo: { hasNextPage: false },
							},
						}
					: {}),
			};
			return JSON.stringify(githubApiReceipt(args, extra));
		},
	});
	const raw = async (c: ExecutionContext): Promise<unknown> => {
		const id = c.step.id;
		calls.push(c.stepKey!);
		if (id === "assess-existing")
			return {
				completed: ["inherited record change"],
				remaining: [criterion],
				risks: [],
				assets: [],
			};
		if (id === "clarify")
			return {
				questions: [],
				decisions: [],
				requirements: [criterion],
				deliveryMode: mode,
			};
		if (id === "plan") {
			if (preparationFailure === "missing")
				return { plan: "Missing contract", assets: [] };
			if (preparationFailure === "invalid")
				return {
					plan: "Invalid contract",
					assets: [],
					deliveryContract: { mode: "external" },
				};
			planVersion++;
			const contract: DeliveryContract = {
				format: "delivery-v1",
				version: planVersion,
				mode,
				authorization: { status: "authorized", reference: "originalInput" },
				executionReference: String(
					(c.currentScope!() as Record<string, unknown>)
						.deliveryExecutionReference,
				),
				targets:
					mode === "repository"
						? []
						: [
								{
									key: "ticket",
									resource,
									capabilities: ["read", "content", "relationships"],
									baseline: {
										fields: structuredClone(state.fields),
										relationships: [],
									},
									operations: [
										{
											id: `description-${planVersion}`,
											kind: "content",
											fields: {
												description:
													planVersion === 1 ? "after" : "after correction",
											},
										},
									],
									criteria: [
										{
											id: "ticket-content",
											requirementRef: "requirements/0",
											description: "Approved content is present",
											fields: {
												description:
													planVersion === 1 ? "after" : "after correction",
											},
											relationships: [],
											absentRelationships: [],
										},
									],
									preservedRelationships: [],
								},
							],
			};
			currentPlan = {
				plan: `${criterion}. Preserve inherited work and the existing PR when present. Continue feature against main. Validate the record with a real local CLI check.`,
				assets: [],
				deliveryContract: contract,
			};
			return currentPlan;
		}
		if (id === "plan-review") {
			const reject =
				preparationFailure === "unreviewed" ||
				((mode === "repository" || standalone) && !reviewRejected);
			reviewRejected = true;
			return {
				approved: !reject,
				feedback: reject ? ["Include complete validation"] : [],
				deliveryContractDigest: (c.currentScope!() as Record<string, unknown>)
					.deliveryCandidateDigest,
			};
		}
		if (id === "architecture" && !hasCheck(c.step, "specialist-evidence")) {
			const p = checkin(mode === "repository" ? "meaningful" : "routine");
			p.criteria = [
				{
					id: "AC1",
					text: criterion,
					source: "originalInput",
					status: "covered",
					reason: "Recorded behavior and CLI check",
				},
			];
			p.candidate = { ...p.candidate, ...structuredClone(currentPlan) };
			p.candidate.steps = [
				{
					id: "D1",
					title: "Save the record",
					what: criterion,
					kind: "code",
					size: "S",
					traces: [{ criterion: "AC1" }],
					files: [{ path: "record.txt", change: "edit" }],
				},
			];
			p.talk!.checks = [
				{
					say: "Keep the existing local record",
					instead: "Replacing storage would expand the accepted task",
				},
			];
			p.problem = [
				{
					repository: "fixture",
					paths: ["record.txt"],
					observation: "Existing record remains readable",
				},
			];
			p.evidence = p.problem;
			p.map = undefined;
			p.decisions = [];
			if (mode === "repository") {
				p.map = {
					areas: [{ id: "store", name: "Record" }],
					parts: [
						{
							id: "record",
							label: "Stored record",
							note: "retained locally",
							detail: "Only controlled data changes",
							file: "record.txt",
							area: "store",
							status: "changed",
						},
					],
					links: [],
				};
				p.decisions = [
					{
						id: "store",
						question: "Keep local record?",
						status: "decided",
						decidedBy: "bob",
						pick: "yes",
						options: [
							{
								id: "yes",
								name: "Retain local record",
								upside: "Keeps existing data",
								catch: "Local only",
							},
							{
								id: "no",
								name: "Replace storage",
								upside: "New backend",
								catch: "Outside scope",
							},
						],
					},
				];
			}
			if (c.run.architectureProposals?.length)
				p.changes = [
					{ text: "Retain requested corrections in the plan", from: "you" },
				];
			return p;
		}
		if (
			id === "architecture-review" &&
			!hasCheck(c.step, "specialist-evidence")
		)
			return { approved: true, feedback: [] };
		if (id === "implement") {
			writeFileSync(join(repo, "record.txt"), `saved ${planVersion}\n`);
			git("add", ".");
			git("commit", "-m", "test: implement controlled record [skip ci]");
			return {
				status: "completed",
				summary: "Saved the requested controlled record",
				checks: ["real Git commit"],
				questions: [],
			};
		}
		if (id === "assess-impact") {
			const snapshot = (c.input as { impactSnapshot: ImpactSnapshot })
				.impactSnapshot;
			const feedback = factoryFeedbackContext(c) as {
				readiness?: {
					unassessedComments?: {
						id: string;
						bodySha256: string;
						repositoryId?: string;
					}[];
				};
			};
			return {
				impactContract: "impact-v1",
				status: "completed",
				summary: "Inspected current controlled record and accepted scope",
				correctionRequired: mode === "repository" && !ciCorrected,
				readinessOnly: false,
				commentAssessments: (feedback.readiness?.unassessedComments ?? []).map(
					(x) => ({
						...x,
						disposition: "informational",
						reason: "Recorded guard already satisfies this request",
					}),
				),
				classification: "full",
				rationale: "Conservatively execute all configured reviewers",
				uncertainty: [],
				extractRequirements: true,
				specialists: snapshot.reviewers.map((x) => x.id),
				requirementIds: [],
				checks: [],
				qaCriteria: [],
				qaReuse: [],
				reuse: [],
				invalidate: [],
				targetCompatible: true,
				testAssertions: {
					inspected: true,
					weakened: false,
					evidence: "Original controlled check retained",
				},
				humanReview: c.run.humanDecisions?.some((x) => x.decision === "approve")
					? "renew"
					: "no-prior-approval",
				approvalRationale: "Require explicit current approval",
				questions: [],
			};
		}
		if (id === "extract-requirements")
			return {
				schemaVersion: 1,
				requirements: [
					{
						id: "R1",
						criterion,
						classification: "active",
						sources: [{ source: "originalInput", reference: "/originalInput" }],
					},
				],
				decisions: [],
				conflicts: [],
				sourceReceipt: {
					considered: [
						{ source: "originalInput", reference: "/originalInput" },
					],
					unavailable: [],
				},
				questions: [],
			};
		if (hasCheck(c.step, "specialist-evidence")) {
			const fail =
				id === "correctness-review" && !qualityFailed && mode === "repository";
			if (fail) qualityFailed = true;
			return {
				status: "completed",
				blockers: [],
				summary: fail
					? "Guard requires a correction"
					: "Inspected the controlled requirement",
				findings: fail
					? [
							{
								id: "guard",
								rating: 2,
								summary: "Record lacks a guard",
								evidence: "record.txt has no guard marker",
								status: "open",
								requirementIds: ["R1"],
								category: "defect",
								consequence: "A record without its guard could be replaced",
								remedy: "Retain the guard marker in the saved record",
								investigation: { state: "confirmed" },
							},
						]
					: id === "correctness-review" && qualityFailed
						? [
								{
									id: "guard",
									rating: 2,
									summary: "Record guard is retained",
									evidence: "record.txt includes the guard marker",
									status: "resolved",
									reason: "Inspected the corrected record",
									requirementIds: ["R1"],
								},
							]
						: [],
				disagreements: [],
				...(checkArgs(c.step, "specialist-evidence")?.coverage === true
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									reason: "Controlled record meets accepted behavior",
									evidence: ["Inspected record.txt"],
								},
							],
						}
					: {}),
			};
		}
		if (
			id === "code-fix" ||
			id === "visual-fix" ||
			id === "ci-fix" ||
			id === "human-fix"
		) {
			if (id === "ci-fix") {
				if (!ciCorrected)
					expect(
						(c.input as { assessedCorrection?: { source: string } })
							.assessedCorrection?.source,
					).toBe("review/assess-impact");
				ciCorrected = true;
			}
			writeFileSync(
				join(repo, "record.txt"),
				`${readFileSync(join(repo, "record.txt"), "utf8")}${id} guard\n`,
			);
			git("commit", "-am", `test: controlled ${id} [skip ci]`);
			return {
				summary: "Preserved record and corrected the reported guard",
				checks: ["real local commit"],
				questions: [],
				dispositions: [
					{
						id: "correctness-review:guard",
						status: "fixed",
						reason: "Added guard marker",
					},
				],
				addressedReviewIds: [],
				addressedCommentIds: [],
				reviewRequired: true,
			};
		}
		if (id === "visual-scope") {
			const scope = qaScope("cli");
			scope.stories[0]!.requirementRefs = ["R1"];
			return {
				...scope,
				environment: { isolation: "worktree" },
				videoContract: "video-v1",
				videoTasks: [],
				videoReason:
					"This controlled scenario changes local nonvisual data; the exact CLI result is decisive evidence.",
			};
		}
		if (id === "capture") {
			const result = execFileSync(
				process.execPath,
				[
					"-e",
					"const fs=require('node:fs');if(!fs.readFileSync('record.txt','utf8').startsWith('saved'))process.exit(1);console.log('Record is persisted')",
				],
				{ cwd: repo, encoding: "utf8" },
			).trim();
			const cap = qaExecution();
			cap.results[0]!.criteria[0]!.evidence = [
				{
					kind: "command",
					executed: true,
					action: "node read record.txt and assert saved",
					details: result,
					exitCode: 0,
				},
			];
			return { ...cap, videoContract: "video-v1", videos: [] };
		}
		if (id === "visual-review")
			return {
				status: "completed",
				blockers: [],
				qaContract: "qa-v1",
				summary: "Actual CLI output verifies the selected criterion",
				findings: [],
				acceptedScreenshots: [],
				acceptedVideos: [],
			};
		if (id === "guide")
			return {
				contract: "brief-v3",
				verdict: {
					headline: "The controlled record is saved",
					readiness: "ready",
					why: "The actual local CLI check passed",
				},
				ask: { source: "Controlled F1 task", quote: criterion },
				interpretation: [],
				requirements: [
					{
						id: "saved-record",
						text: criterion,
						origin: "ask",
						covers: ["R1"],
						status: "tested",
						how: "Read the saved record with the actual CLI",
						proof: {
							kind: "command",
							command: "node read record.txt and assert saved",
							output: "Record is persisted",
						},
						files: ["record.txt"],
					},
				],
				yourCall: [],
				beyondAsk: [],
				notVerified: [],
				hygiene: [],
				story: {
					title: "Save a record",
					summary: "The controlled record stays readable",
					stats: [],
					slides: [
						{
							kind: "beforeAfter",
							title: "Stored record",
							before: [{ label: "Existing record" }],
							after: [{ label: "Saved record" }],
						},
					],
				},
				tour: [
					{
						file: "record.txt",
						say: "Retains the saved record and guard",
						key: true,
						pins: [
							{
								match: readFileSync(join(repo, "record.txt"), "utf8").split(
									"\n",
								)[0]!,
								say: "The exact saved value",
							},
						],
					},
				],
			};
		if (id === "external-correction")
			return {
				summary:
					"Retain applied work and renew the requested external correction",
			};
		throw new Error(`Unexpected role ${id}`);
	};
	const hooks: RuntimeHooks = {
		agent: async (c) => {
			c.progress = await roleProgress(c);
			return host.finalizeFactoryAgentOutput(c, await raw(c));
		},
		script: async () => ({}),
		tool: (c) => tools.tool(c),
	};
	runtime = new WorkflowRuntime(home, hooks);
	runtimes.push(runtime);
	host.factoryRuntime = runtime;
	const wrapper = WorkflowSchema.parse({
		id: "external-correction-caller",
		name: "External correction caller",
		stepConfigVersion: "step-config-v1",
		outcomes: ["completed"],
		steps: [
			{
				id: "deliver",
				name: "Deliver",
				type: "workflow",
				workflow: "external-delivery",
				next: "end",
				branches: [
					{
						when: { path: "outcome", equals: "to-plan" },
						next: "deliver",
						entry: "plan",
					},
				],
			},
		],
	});
	const definitions = [
		...(frozen ? preCompositionWorkflows : defaultWorkflows),
		...(standalone === "called-external" ? [wrapper] : []),
	];
	if (standalone === "called-external") runtime.updateWorkflows(definitions);
	const workflow = definitions.find(
		(w) =>
			w.id ===
			(standalone === "called-external"
				? wrapper.id
				: standalone === "router"
					? "route-delivery"
					: standalone
						? "external-delivery"
						: takeover
							? "takeover"
							: "factory"),
	)!;
	run = runtime.create({
		title: `Controlled ${mode} ${takeover ? "Takeover" : "Factory"}`,
		repositoryId: "fixture",
		workspace: repo,
		input: criterion,
		workflow,
		workflowDefinitions: definitions,
		gitProvider: {
			type: "github",
			repositoryUrl: "https://github.com/test/repo",
		},
		repositories: [
			{
				id: "fixture",
				name: "fixture",
				workspace: repo,
				repositoryPath: repo,
				baseBranch: "main",
				gitProvider: {
					type: "github",
					repositoryUrl: "https://github.com/test/repo",
				},
			},
		],
		triggerOrigin: { type: "manual", workflowId: workflow.id },
		...(takeover
			? {
					takeoverSource: {
						url,
						headRefName: "feature",
						baseRefName: "main",
						headRefOid: git("rev-parse", "HEAD"),
						isDraft: true,
						state: "OPEN",
					},
				}
			: {}),
	});
	// Historical control installs the exact pre-142 accepted snapshot before any execution.
	// New-run admission intentionally replaces reserved IDs with installed definitions.
	if (frozen) {
		run.workflow = structuredClone(workflow);
		run.workflowDefinitions = structuredClone(definitions);
	}
	return {
		home,
		repo,
		git,
		tools,
		hooks,
		host,
		delivery,
		state,
		calls,
		commands,
		get runtime() {
			return runtime;
		},
		get run() {
			return run;
		},
		setRuntime(next: WorkflowRuntime) {
			runtime = next;
			host.factoryRuntime = next;
			run = next.get(run.id);
			runtimes.push(next);
		},
		rejectNextPlanReview() {
			reviewRejected = false;
		},
		approveProvider() {
			providerApproval = true;
		},
		get ciCorrected() {
			return ciCorrected;
		},
		get merged() {
			return merged;
		},
	};
}

it.each([
	["repository", false, false],
	["external", false, false],
	["mixed", false, false],
	["repository", true, false],
	["external", false, true],
] as const)(
	"drives actual production composition: %s / takeover=%s frozen=%s with mocked tracker, forge, CI and agents",
	async (mode, takeover, frozen) => {
		const f = fixture(mode, takeover, frozen);
		let running = f.runtime.launch(f.run);
		let rejected = false,
			restarted = false;
		const decisions: string[] = [];
		for (let turns = 0; turns < 18; turns++) {
			await waitForRuntime(
				() =>
					expect(["waiting", "completed", "failed"]).toContain(f.run.status),
				{ timeout: 45000 },
			).catch((error) => {
				writeFileSync(
					`/tmp/taskbot142-timeout-${mode}-${takeover}-${frozen}.json`,
					JSON.stringify(
						{
							status: f.run.status,
							step: f.run.step,
							error: f.run.error,
							calls: f.calls,
							events: f.run.events.slice(-25),
							checkpoint: f.run.checkpoint,
						},
						null,
						2,
					),
				);
				throw error;
			});
			if (f.run.status !== "waiting") break;
			const architecture = f.run.architectureGate;
			if (architecture) {
				const p = f.run.architectureProposals!.find(
					(p) => p.id === architecture.proposalId,
				)!;
				expect(() =>
					f.runtime.decideArchitecture(f.run.id, {
						proposalId: p.id,
						version: p.version,
						digest: "stale",
						decision: "accept",
					}),
				).toThrow();
				f.runtime.decideArchitecture(f.run.id, {
					proposalId: p.id,
					version: p.version,
					digest: p.digest,
					decision: "accept",
				});
				decisions.push(p.id);
				continue;
			}
			if (f.run.reviewGate?.status === "pending") {
				const gate = structuredClone(f.run.reviewGate);
				expect(() =>
					f.runtime.decide(f.run.id, {
						reviewId: gate.id,
						headSha: "stale",
						externalDigest: gate.externalDigest,
						decision: "approve",
					}),
				).toThrow();
				if (mode === "external" && !restarted) {
					const prefix = structuredClone(f.run.history);
					await f.runtime.shutdown();
					await running;
					f.setRuntime(new WorkflowRuntime(f.home, f.hooks));
					running = f.runtime.launch(f.run);
					await waitForRuntime(() =>
						expect(f.run.status, f.run.error).toBe("waiting"),
					);
					expect(f.run.history.slice(0, prefix.length)).toEqual(prefix);
					expect(f.run.reviewGate?.id).toBe(gate.id);
					restarted = true;
				}
				const reject = mode === "mixed" && !rejected;
				rejected ||= reject;
				if (!reject) f.approveProvider();
				f.runtime.decide(f.run.id, {
					reviewId: f.run.reviewGate!.id,
					headSha: f.run.reviewGate!.headSha,
					externalDigest: f.run.reviewGate!.externalDigest,
					decision: reject ? "reject" : "approve",
					...(reject
						? {
								feedback:
									"Update the external description with the correction and preserve repository work",
							}
						: {}),
				});
				continue;
			}
			throw new Error(
				`Unexpected assistance ${f.run.step}: ${f.run.questions.join("; ")}`,
			);
		}
		await running;
		if (mode === "external" && !frozen && f.run.status === "completed") {
			const history = structuredClone(f.run.history);
			const originalReview = f.run.reviewGate!.id;
			// Controlled tracker publication failure triggers the real explicit reverification API.
			// Existing approvals and executed action receipts are untouched.
			f.run.ticketSync = {
				receipts: [],
				error: "Controlled tracker completion was unavailable",
			};
			f.runtime.reverifyExternal(f.run.id, "controlled-operator");
			await waitForRuntime(() =>
				expect(f.run.status, f.run.error).toBe("waiting"),
			);
			expect(f.run.history.slice(0, history.length)).toEqual(history);
			expect(f.run.reviewGate!.id).not.toBe(originalReview);
			expect(() =>
				f.runtime.decide(f.run.id, {
					reviewId: originalReview,
					externalDigest: f.run.reviewGate!.externalDigest,
					decision: "approve",
				}),
			).toThrow();
			f.runtime.decide(f.run.id, {
				reviewId: f.run.reviewGate!.id,
				headSha: f.run.reviewGate!.headSha,
				externalDigest: f.run.reviewGate!.externalDigest,
				decision: "approve",
			});
			await waitForRuntime(() =>
				expect(f.run.status, f.run.error).toBe("completed"),
			);
			expect(f.run.checkpoint!.calls!.external!.visits["external-verify"]).toBe(
				2,
			);
		}
		writeFileSync(
			`/tmp/taskbot142-${mode}-${takeover}-${frozen}-flow.json`,
			JSON.stringify(
				{
					status: f.run.status,
					error: f.run.error,
					calls: f.calls,
					commands: f.commands,
					history: f.run.history,
					checkpoint: f.run.checkpoint,
				},
				null,
				2,
			),
		);
		expect(
			f.run.status,
			`${f.run.error}\n${f.run.events
				.slice(-8)
				.map((e) => e.message)
				.join("\n")}`,
		).toBe("completed");
		expect(
			f.run.workflow.steps.filter((s) => s.type === "workflow"),
		).toHaveLength(frozen ? 1 : 10);
		expect(f.calls.filter((s) => s.endsWith("/clarify"))).toHaveLength(1);
		expect(
			f.run.history.filter(
				(x) => x.step === (frozen ? "pipeline/plan" : "planning"),
			),
		).not.toHaveLength(0);
		expect(f.run.workflowDefinitions).toEqual(
			frozen ? preCompositionWorkflows : defaultWorkflows,
		);
		if (mode === "external") {
			expect(f.merged).toBe(false);
			expect(restarted).toBe(true);
			expect(f.calls.some((x) => x.endsWith("/implement"))).toBe(false);
			expect(f.state.fields.description).toBe("after");
		} else {
			expect(f.merged).toBe(true);
			expect(f.run.humanDecisions?.some((x) => x.decision === "approve")).toBe(
				true,
			);
			expect(f.run.history.some((x) => x.step === "merge/merge")).toBe(true);
		}
		if (mode === "mixed") {
			expect(rejected).toBe(true);
			expect(f.state.fields.description).toBe("after correction");
			expect(f.run.checkpoint!.calls!.planning!.visits.clarify).toBe(1);
			expect(f.run.checkpoint!.calls!.planning!.visits.plan).toBe(2);
		}
		if (mode === "repository") {
			const handoff = f.run.history.findIndex(
				(h) =>
					h.step === "approval/handoff" &&
					(h.output as { fix?: boolean })?.fix === true,
			);
			const merge = f.run.history.findIndex(
				(h) =>
					h.step === "merge/merge" &&
					(h.output as { rework?: boolean })?.rework === true,
			);
			expect(handoff).toBeGreaterThan(0);
			expect(
				f.run.history.slice(handoff + 1).some((h) => h.step === "ci/ci-fix"),
			).toBe(true);
			expect(merge).toBeGreaterThan(handoff);
			expect(
				f.run.history
					.slice(merge + 1)
					.some((h) => h.step === "review/assess-impact"),
			).toBe(true);
			expect(
				f.run.humanDecisions!.filter((d) => d.decision === "approve").length,
			).toBeGreaterThan(1);
			expect(f.ciCorrected).toBe(true);
			expect(
				f.run.checkpoint!.calls!.review!.visits["assess-impact"],
			).toBeGreaterThan(1);
			expect(decisions.length).toBeGreaterThan(0);
		}
		if (takeover) {
			expect(f.run.takeoverSource).toMatchObject({
				url: "https://github.com/test/repo/pull/1",
				headRefName: "feature",
			});
			expect(f.calls[0]).toBe("assess-existing");
		}
	},
	120000,
);

// Same production-runtime/host boundary as the four retained drives; only the new preparation path runs here.
it("drives standalone external preparation, independent rejection, persisted exact human approval and final verification", async () => {
	const f = fixture("external", false, false, true);
	let running = f.runtime.launch(f.run);
	await waitForRuntime(
		() => expect(f.run.status, f.run.error).toBe("waiting"),
		{ timeout: 45000 },
	);
	expect(f.calls).toContain("clarify");
	expect(f.calls).toContain("plan");
	expect(f.calls).toContain("plan-review");
	expect(f.run.delivery?.contract.authorization.status).toBe("authorized");
	expect(f.state.fields.description).toBe("after correction");
	expect(f.calls.filter((x) => x === "plan-review")).toHaveLength(2);
	const history = structuredClone(f.run.history),
		gate = structuredClone(f.run.reviewGate!);
	expect(gate.status).toBe("pending");
	expect(f.run.humanDecisions ?? []).toHaveLength(0);
	await f.runtime.shutdown();
	await running;
	f.setRuntime(new WorkflowRuntime(f.home, f.hooks));
	running = f.runtime.launch(f.run);
	await waitForRuntime(() => expect(f.run.status, f.run.error).toBe("waiting"));
	expect(f.run.history.slice(0, history.length)).toEqual(history);
	expect(f.run.reviewGate!.id).toBe(gate.id);
	expect(() =>
		f.runtime.decide(f.run.id, {
			reviewId: gate.id,
			headSha: "stale",
			externalDigest: gate.externalDigest,
			decision: "approve",
		}),
	).toThrow();
	f.runtime.decide(f.run.id, {
		reviewId: gate.id,
		headSha: gate.headSha,
		externalDigest: gate.externalDigest,
		decision: "approve",
	});
	await running;
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.run.delivery?.finalCheck).toMatchObject({
		reviewId: gate.id,
		digest: f.run.delivery!.verification!.digest,
	});
	expect(f.run.humanDecisions).toHaveLength(1);
	// A user fork entering acceptance directly still cannot promote copied approved JSON.
	const fork = structuredClone(f.run.workflow);
	fork.id = "unreviewed-external-fork";
	fork.name = "Unreviewed external fork";
	const accept = fork.steps.find((s) => s.tool === "accept-delivery")!;
	fork.steps = [accept, ...fork.steps.filter((s) => s !== accept)];
	f.runtime.updateWorkflows([...defaultWorkflows, fork]);
	const forged = f.runtime.create({
		title: "Copied context",
		input: criterion,
		repositoryId: "fixture",
		workspace: f.repo,
		workflow: fork,
		launchInputs: {
			plan: JSON.stringify(f.run.outputs.plan),
			"plan-review": JSON.stringify(f.run.outputs["plan-review"]),
			clarify: JSON.stringify(f.run.outputs.clarify),
		},
		triggerOrigin: { type: "manual", workflowId: fork.id },
	});
	const callsBefore = f.calls.length;
	await f.runtime.launch(forged);
	expect(forged.status).toBe("failed");
	expect(forged.error).toMatch(/original executed/);
	expect(forged.delivery).toBeUndefined();
	expect(f.calls).toHaveLength(callsBefore);

	writeFileSync(
		"/tmp/taskbot142-r1-standalone-flow.json",
		JSON.stringify(
			{
				status: f.run.status,
				history: f.run.history,
				checkpoint: f.run.checkpoint,
				delivery: f.run.delivery,
				calls: f.calls,
				commands: f.commands,
			},
			null,
			2,
		),
	);
}, 60000);

it.each([
	"missing",
	"invalid",
	"unreviewed",
] as const)("refuses %s standalone preparation before tracker effects", async (failure) => {
	const f = fixture("external", false, false, true, failure);
	await f.runtime.launch(f.run);
	expect(f.run.status).toBe("failed");
	expect(f.run.delivery).toBeUndefined();
	expect(f.state.fields.description).toBe("before");
	expect(f.run.history.some((x) => x.step === "external-apply")).toBe(false);
}, 60000);

// R3/R7: actual runtime/host preparation and exact external correction, with no live providers.
it.each([
	false,
	true,
])("R3 completes external rejection through reviewed correction and renewed exact approval (called=%s)", async (called) => {
	const f = fixture(
		"external",
		false,
		false,
		called ? "called-external" : true,
	);
	const running = f.runtime.launch(f.run);
	try {
		await waitForRuntime(() =>
			expect(f.run.status, f.run.error).toBe("waiting"),
		);
		const gate = structuredClone(f.run.reviewGate!);
		const history = structuredClone(f.run.history);
		const applied = structuredClone(f.run.delivery!);
		f.rejectNextPlanReview();
		f.runtime.decide(f.run.id, {
			reviewId: gate.id,
			headSha: gate.headSha,
			externalDigest: gate.externalDigest,
			decision: "reject",
			feedback: "Please revise the approved content",
		});
		await waitForRuntime(() =>
			expect(
				(f.run.status === "waiting" && f.run.reviewGate?.id !== gate.id) ||
					["failed", "completed"].includes(f.run.status),
			).toBe(true),
		);
		expect(f.run.status, f.run.error).toBe("waiting");
		const renewed = structuredClone(f.run.reviewGate!);
		expect(renewed.id).not.toBe(gate.id);
		expect(renewed.status).toBe("pending");
		expect(f.run.history.slice(0, history.length)).toEqual(history);
		expect(
			f.calls.filter((x) => x.split("/").at(-1) === "external-correction"),
		).toHaveLength(1);
		expect(
			f.calls.filter((x) => x.split("/").at(-1) === "plan-review"),
		).toHaveLength(4);
		expect(f.run.delivery!.contract.version).toBeGreaterThan(
			applied.contract.version,
		);
		expect(f.run.humanDecisions?.[0]).toMatchObject({
			reviewId: gate.id,
			decision: "reject",
		});
		expect(() =>
			f.runtime.decide(f.run.id, {
				reviewId: gate.id,
				headSha: gate.headSha,
				externalDigest: gate.externalDigest,
				decision: "approve",
			}),
		).toThrow();
		f.runtime.decide(f.run.id, {
			reviewId: renewed.id,
			headSha: renewed.headSha,
			externalDigest: renewed.externalDigest,
			decision: "approve",
		});
		await running;
		expect(f.run.status, f.run.error).toBe("completed");
		expect(f.run.delivery?.finalCheck?.reviewId).toBe(renewed.id);
		expect(f.run.humanDecisions).toHaveLength(2);
		writeFileSync(
			`/tmp/taskbot142-r2-${called ? "called" : "standalone"}-correction.json`,
			JSON.stringify(
				{
					status: f.run.status,
					history: f.run.history,
					delivery: f.run.delivery,
					humanDecisions: f.run.humanDecisions,
					checkpoint: f.run.checkpoint,
					calls: f.calls,
					commands: f.commands,
				},
				null,
				2,
			),
		);
	} finally {
		await f.runtime.shutdown();
		await running;
	}
}, 60000);

it("R7 safely prepares and routes a standalone delivery block without promoting copied context", async () => {
	const f = fixture("external", false, false, "router");
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.calls.filter((x) => x === "clarify")).toHaveLength(1);
	expect(f.calls.filter((x) => x === "plan-review")).toHaveLength(2);
	expect(f.run.delivery?.contract.authorization.status).toBe("authorized");
	expect(f.run.checkpoint?.outcome).toBe("to-external-apply");
	expect(f.state.fields.description).toBe("before");
	const fork = structuredClone(f.run.workflow);
	fork.id = "router-unreviewed";
	const accept = fork.steps.find((s) => s.tool === "accept-delivery")!;
	fork.steps = [accept, ...fork.steps.filter((s) => s !== accept)];
	f.runtime.updateWorkflows([...defaultWorkflows, fork]);
	const forged = f.runtime.create({
		title: "Copied router context",
		input: criterion,
		repositoryId: "fixture",
		workspace: f.repo,
		workflow: fork,
		launchInputs: Object.fromEntries(
			["plan", "plan-review", "clarify"].map((name) => [
				name,
				JSON.stringify(f.run.outputs[name]),
			]),
		),
		triggerOrigin: { type: "manual", workflowId: fork.id },
	});
	await f.runtime.launch(forged);
	expect(forged.status).toBe("failed");
	expect(forged.error).toMatch(/original executed/);
	expect(forged.delivery).toBeUndefined();
	// The same router consumes the original qualified Call ports without repeating preparation.
	const composed = WorkflowSchema.parse({
		id: "prepared-router-parent",
		name: "Prepared router",
		stepConfigVersion: "step-config-v1",
		outcomes: ["completed"],
		steps: [
			{
				id: "planning",
				name: "Planning",
				type: "workflow",
				workflow: "clarify-plan",
				next: "delivery",
			},
			{
				id: "delivery",
				name: "Delivery",
				type: "workflow",
				workflow: "route-delivery",
				bindings: {
					clarify: "planning/clarify",
					plan: "planning/plan",
					"plan-review": "planning/plan-review",
				},
				next: "end",
			},
		],
	});
	f.runtime.updateWorkflows([...defaultWorkflows, composed]);
	const called = f.runtime.create({
		title: "Composed router",
		input: criterion,
		repositoryId: "fixture",
		workspace: f.repo,
		workflow: composed,
		triggerOrigin: { type: "manual", workflowId: composed.id },
	});
	await f.runtime.launch(called);
	expect(called.status, called.error).toBe("completed");
	expect(
		called.history
			.filter((x) => x.step.endsWith("/clarify"))
			.map((x) => x.step),
	).toEqual(["planning/clarify"]);
	expect(called.outputs["delivery"]).toMatchObject({
		outcome: "to-external-apply",
	});
	expect(called.delivery?.receipts).toEqual([]);
	// A graph declaring actual delivery work still cannot finish at a routing outcome.
	const guarded = structuredClone(f.run.workflow);
	guarded.id = "router-with-delivery-obligation";
	guarded.steps.push({
		id: "pending-delivery",
		name: "Pending delivery",
		type: "workflow",
		workflow: "external-delivery",
		next: "end",
		branches: [],
		maxVisits: 8,
	});
	f.runtime.updateWorkflows([...defaultWorkflows, guarded]);
	const unfinished = f.runtime.create({
		title: "Declared delivery obligation",
		input: criterion,
		repositoryId: "fixture",
		workspace: f.repo,
		workflow: guarded,
		triggerOrigin: { type: "manual", workflowId: guarded.id },
	});
	await f.runtime.launch(unfinished);
	expect(unfinished.status).toBe("failed");
	expect(unfinished.error).toMatch(/lacks verified acceptance/);
	expect(f.state.fields.description).toBe("before");
	writeFileSync(
		"/tmp/taskbot142-r2-standalone-router.json",
		JSON.stringify(
			{
				status: f.run.status,
				history: f.run.history,
				delivery: f.run.delivery,
				checkpoint: f.run.checkpoint,
				calls: f.calls,
				forged: {
					status: forged.status,
					error: forged.error,
					history: forged.history,
				},
				called: {
					status: called.status,
					history: called.history,
					delivery: called.delivery,
					checkpoint: called.checkpoint,
				},
				unfinished: {
					status: unfinished.status,
					error: unfinished.error,
					history: unfinished.history,
				},
			},
			null,
			2,
		),
	);
}, 60000);

it.each([
	"missing",
	"unreviewed",
] as const)("R7 refuses %s standalone routing preparation before effects", async (failure) => {
	const f = fixture("external", false, false, "router", failure);
	await f.runtime.launch(f.run);
	expect(f.run.status).toBe("failed");
	expect(f.run.delivery).toBeUndefined();
	expect(f.state.fields.description).toBe("before");
	expect(f.run.history.some((x) => x.step === "external-apply")).toBe(false);
}, 60000);
