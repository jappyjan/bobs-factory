import { execFile } from "node:child_process";
import { relative } from "node:path";
import { promisify } from "node:util";
import { factoryRuntimeIdentity } from "bobs-factory-core";
import { z } from "zod";
import { dependencyCovers, dependencyHashes } from "./Incremental.js";
import { qaDigest } from "./Qa.js";
import { deliveryRevisions, runRepositories } from "./RepositoryScope.js";
import type { AggregateReview, ReviewerReceipt } from "./SpecialistReview.js";
import { latestAggregate, scopeContextDigest } from "./SpecialistReview.js";
import type { WorkflowStep } from "./Workflow.js";
import type {
	ExecutionContext,
	FactoryRun,
	HumanDecision,
} from "./WorkflowRuntime.js";

const text = z.string().trim().min(1);
export const IMPACT_CONTRACT = "impact-v1" as const;
export { EvidenceBoundarySchema } from "./ImpactContracts.js";

import {
	type EvidenceBoundary,
	EvidenceBoundarySchema,
} from "./ImpactContracts.js";
export const ImpactSchema = z.object({
	impactContract: z.literal(IMPACT_CONTRACT),
	status: z.enum(["completed", "blocked", "failed"]),
	summary: text,
	correctionRequired: z.boolean().default(false),
	readinessOnly: z.boolean().default(false),
	commentAssessments: z
		.array(
			z.object({
				id: text,
				bodySha256: text,
				disposition: z.enum([
					"informational",
					"consequential",
					"accepted-unchanged",
				]),
				reason: text,
			}),
		)
		.default([]),
	classification: z.enum(["none", "affected", "full"]),
	rationale: text,
	uncertainty: z.array(text),
	extractRequirements: z.boolean(),
	scopeReuse: z
		.object({ inventoryDigest: text, originalSourceDigest: text, reason: text })
		.optional(),
	specialists: z.array(text),
	requirementIds: z.array(text),
	checks: z.array(
		z.object({
			id: text,
			repositoryId: text,
			command: text,
			reason: text,
			environment: z
				.discriminatedUnion("isolation", [
					z.object({ isolation: z.literal("worktree") }),
					z.object({
						isolation: z.literal("shared"),
						resources: z.array(text).min(1),
					}),
				])
				.optional(),
		}),
	),
	qaCriteria: z.array(text),
	qaReuse: z
		.array(z.object({ criterionId: text, originalDigest: text, reason: text }))
		.default([]),
	reuse: z.array(
		z.object({
			reviewer: text,
			receiptDigest: text,
			reason: text,
			boundary: EvidenceBoundarySchema,
		}),
	),
	invalidate: z.array(z.object({ receiptDigest: text, reason: text })),
	targetCompatible: z.boolean(),
	testAssertions: z.object({
		inspected: z.boolean(),
		weakened: z.boolean(),
		evidence: text,
	}),
	humanReview: z.enum(["no-prior-approval", "continue-after-checks", "renew"]),
	approvalRationale: text,
	questions: z.array(text),
});
export type ImpactAssessment = z.infer<typeof ImpactSchema>;
export interface ImpactRepository {
	repositoryId: string;
	workspace: string;
	url?: string;
	taskBase: string;
	reviewHead?: string;
	reviewBase?: string;
	headSha: string;
	treeSha: string;
	targetSha: string;
	targetIncluded: boolean;
	combinedTree?: string;
	files: string[];
	targetFiles: string[];
	targetDiff: string;
	combinedDiff?: string;
	diff: string;
	approvalDiff?: string;
	uncertainty: string[];
}
export interface ImpactSnapshot {
	schemaVersion: 1;
	key: string;
	trigger: string;
	sourceDigest: string;
	environmentDigest: string;
	findingsDigest: string;
	progressFindingsDigest: string;
	feedbackDigest: string;
	inventoryDigest?: string;
	reviewSourceDigest?: string;
	contractDigest?: string;
	deliveryMode?: "repository" | "external" | "mixed";
	externalDigest?: string;
	reviewRound?: number;
	reviewers: {
		id: string;
		name: string;
		contract: string;
		promptDigest: string;
	}[];
	repositories: ImpactRepository[];
	approval?: HumanDecision;
	digest: string;
}
export interface ReuseRecord {
	schemaVersion: 1;
	snapshotDigest: string;
	originalDigest: string;
	original: ReviewerReceipt;
	boundary: EvidenceBoundary;
	dependencyDigest: string;
	environmentDigest: string;
	reason: string;
}
export interface ImpactDecision extends ImpactAssessment {
	snapshot: ImpactSnapshot;
	reuseRecords: ReuseRecord[];
	pending: { specialists: string[]; checks: string[]; qaCriteria: string[] };
	checkResults: { id: string; exitCode: number; evidence: string }[];
	at: string;
}
const exec = promisify(execFile);
function inputScope(context: ExecutionContext) {
	return (
		context.currentScope?.() ?? {
			...(context.input as Record<string, unknown>),
			answers: context.run.answers,
			humanDecisions: context.run.humanDecisions ?? [],
		}
	);
}
export function environmentDigest(run: FactoryRun) {
	// Accepted execution/tool bindings, QA fixture/resource declarations and OS/runtime.
	// Unknown external state is never evidence for reuse (QA additionally supplies its fingerprint).
	return qaDigest({
		runtime: factoryRuntimeIdentity,
		execution: run.executionSnapshot,
		provider: run.gitProvider,
		repositories: runRepositories(run).map((r) => [
			r.id,
			r.providerSnapshot,
			r.gitProvider,
		]),
		runner: run.runner,
		model: run.model,
		reasoningEffort: run.reasoningEffort,
		modelVariant: run.modelVariant,
		serviceTier: run.serviceTier,
		platform: process.platform,
		architecture: process.arch,
		node: process.version,
	});
}
export async function collectImpactSnapshot(
	context: ExecutionContext,
	fanout: WorkflowStep,
	key: string,
	retained?: ImpactSnapshot,
): Promise<ImpactSnapshot> {
	const { run } = context;
	const previous = retained
		? [...run.history]
				.reverse()
				.map((h) => h.output as AggregateReview)
				.find(
					(a) =>
						a?.baseline?.key === key &&
						a.baseline.round === retained.reviewRound &&
						Array.isArray(a.reviewers),
				)
		: latestAggregate(run, key);
	const first = run.impactDecisions?.find(
		(d) => d.snapshot.key === key,
	)?.snapshot;
	const approval = retained
		? retained.approval
		: run.humanDecisions?.at(-1)?.decision === "approve"
			? run.humanDecisions.at(-1)
			: undefined;
	const repositories: ImpactRepository[] = [];
	for (const repo of runRepositories(run)) {
		const git = async (...args: string[]) =>
			(
				await exec("git", args, {
					cwd: repo.workspace,
					timeout: 15000,
					maxBuffer: 8 * 1024 * 1024,
				})
			).stdout.trim();
		const headSha = await git("rev-parse", "HEAD");
		const treeSha = await git("rev-parse", "HEAD^{tree}");
		if (await git("status", "--porcelain"))
			throw new Error(
				"Impact assessment requires committed work in every repository",
			);
		const old = previous?.baseline.repositories?.find(
			(r) => r.repositoryId === repo.id,
		);
		const reviewHead =
			old?.headSha ??
			(runRepositories(run).length === 1
				? previous?.baseline.headSha
				: undefined);
		const reviewBase =
			old?.baseSha ??
			(runRepositories(run).length === 1
				? previous?.baseline.baseSha
				: undefined);
		const targetSha = await git(
			"rev-parse",
			`refs/remotes/origin/${repo.baseBranch}`,
		);
		let targetIncluded = true;
		try {
			await git("merge-base", "--is-ancestor", targetSha, headSha);
		} catch {
			targetIncluded = false;
		}
		const taskBase =
			first?.repositories.find((r) => r.repositoryId === repo.id)?.taskBase ??
			reviewBase ??
			(await git("merge-base", headSha, targetSha));
		const uncertainty: string[] = [];
		let diff = "",
			files: string[] = [],
			targetFiles: string[] = [],
			targetDiff = "",
			combinedDiff: string | undefined,
			combinedTree: string | undefined,
			approvalDiff: string | undefined;
		try {
			diff = await git(
				"diff",
				"--no-ext-diff",
				"--no-textconv",
				reviewHead ?? taskBase,
				headSha,
				"--",
			);
			files = (
				await git(
					"diff",
					"--name-only",
					"-z",
					reviewHead ?? taskBase,
					headSha,
					"--",
				)
			)
				.split("\0")
				.filter(Boolean);
			targetDiff = await git(
				"diff",
				"--no-ext-diff",
				"--no-textconv",
				reviewBase ?? taskBase,
				targetSha,
				"--",
			);
			targetFiles = (
				await git(
					"diff",
					"--name-only",
					"-z",
					reviewBase ?? taskBase,
					targetSha,
					"--",
				)
			)
				.split("\0")
				.filter(Boolean);
			combinedTree = (
				await git("merge-tree", "--write-tree", headSha, targetSha)
			).split("\n")[0];
			combinedDiff = await git(
				"diff",
				"--no-ext-diff",
				"--no-textconv",
				headSha,
				combinedTree!,
				"--",
			);
			if (!/^[a-f0-9]{40,64}$/.test(combinedTree ?? ""))
				throw new Error("Invalid combined tree");
			if (approval) {
				const acceptedHead =
					approval.repositories?.find((r) => r.repositoryId === repo.id)
						?.headSha ??
					(runRepositories(run).length === 1 ? approval.headSha : undefined);
				if (!acceptedHead)
					throw new Error("Approval does not cover every repository");
				approvalDiff = await git(
					"diff",
					"--no-ext-diff",
					"--no-textconv",
					acceptedHead,
					headSha,
					"--",
				);
			}
		} catch (error) {
			uncertainty.push(
				`Diff or combined merge tree unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const url =
			deliveryRevisions(run.outputs["draft-pr"]).find(
				(d) => d.repositoryId === repo.id,
			)?.url ??
			(runRepositories(run).length === 1
				? (run.outputs["draft-pr"] as { url?: string } | undefined)?.url
				: undefined);
		repositories.push({
			repositoryId: repo.id,
			workspace: repo.workspace,
			url,
			taskBase,
			reviewHead,
			reviewBase,
			headSha,
			treeSha,
			targetSha,
			targetIncluded,
			combinedTree,
			files,
			targetFiles,
			targetDiff,
			combinedDiff,
			diff,
			approvalDiff,
			uncertainty,
		});
	}
	const value = {
		schemaVersion: 1 as const,
		contractDigest: run.delivery?.contractDigest,
		deliveryMode: run.delivery?.contract.mode,
		externalDigest: run.delivery?.verification?.digest,
		key,
		trigger:
			[...run.history].reverse().find((h) => !h.step.startsWith(`${key}/`))
				?.step ?? "initial",
		sourceDigest: impactSourceDigest(context, fanout),
		environmentDigest: environmentDigest(run),
		feedbackDigest: feedbackDigest(run),
		findingsDigest: qaDigest({
			findings: previous?.rawFindings,
			disagreements: previous?.disagreements,
		}),
		progressFindingsDigest: qaDigest({
			findings: previous?.rawFindings.map((f) => [
				f.id,
				f.status,
				f.rating,
				f.category,
				f.requirementIds,
				f.ruleReference,
			]),
			disagreements: previous?.disagreements,
		}),
		inventoryDigest:
			(
				(context.outputs ?? run.outputs)[fanout.review?.inventory ?? ""] as
					| { digest?: string }
					| undefined
			)?.digest ?? previous?.baseline.inventory.digest,
		reviewRound: previous?.baseline.round,
		reviewSourceDigest:
			previous?.baseline.impact?.snapshot.sourceDigest ??
			previous?.baseline.inventory.sourceContextDigest,
		reviewers: (fanout.groups ?? []).flat().map((s) => ({
			id: s.id,
			name: s.name,
			contract: s.reviewContract!,
			promptDigest: qaDigest({
				prompt: s.prompt,
				runner: s.runner,
				model: s.model,
			}),
		})),
		repositories,
		approval,
	};
	return { ...value, digest: qaDigest(value) };
}
export function boundaryDigest(run: FactoryRun, boundary: EvidenceBoundary) {
	return qaDigest(
		dependencyHashes(
			run.workspace,
			boundary.dependencies,
			runRepositories(run),
		),
	);
}
function changedPaths(snapshot: ImpactSnapshot, run: FactoryRun) {
	return snapshot.repositories.flatMap((r) =>
		[...r.files, ...r.targetFiles].map((f) => {
			const prefix = relative(run.workspace, r.workspace);
			return prefix ? `${prefix}/${f}` : f;
		}),
	);
}
export function validateImpact(
	value: unknown,
	snapshot: ImpactSnapshot,
	run: FactoryRun,
): ImpactDecision {
	const result = ImpactSchema.parse(value);
	const previous = latestAggregate(run, snapshot.key);
	const known = new Set(snapshot.reviewers.map((r) => r.id));
	if (
		new Set(result.specialists).size !== result.specialists.length ||
		result.specialists.some((id) => !known.has(id))
	)
		throw new Error("Select only unique configured specialists");
	if (
		result.checks.some(
			(c) =>
				!snapshot.repositories.some((r) => r.repositoryId === c.repositoryId),
		)
	)
		throw new Error("Selected check references an unknown repository");
	if (new Set(result.checks.map((c) => c.id)).size !== result.checks.length)
		throw new Error("Check IDs must be unique");
	if (
		snapshot.repositories.some((r) => r.uncertainty.length) &&
		!result.correctionRequired &&
		result.status === "completed"
	)
		throw new Error(
			"Unavailable combined-tree evidence needs integration or blocked investigation before consuming review",
		);
	if ((result.status !== "completed") !== Boolean(result.questions.length))
		throw new Error(
			"Incomplete impact assessment requires assistance questions",
		);
	const inventory = previous?.baseline.inventory;
	const targetOverlap = snapshot.repositories
		.filter((r) => !r.targetIncluded)
		.some((r) =>
			r.targetFiles.some((file) => {
				const prefix = relative(run.workspace, r.workspace);
				const path = prefix ? `${prefix}/${file}` : file;
				return previous?.reviewers.some((receipt) =>
					receipt.evidenceBoundary?.boundary.dependencies.some((d) =>
						dependencyCovers(path, d),
					),
				);
			}),
		);
	if (
		targetOverlap &&
		result.status === "completed" &&
		!result.correctionRequired
	)
		throw new Error(
			"Target advancement overlaps reviewed interfaces; integrate and validate the combined tree before continuing",
		);
	if (
		result.requirementIds.some(
			(id) =>
				!inventory?.requirements.some(
					(r) => r.id === id && r.classification === "active",
				),
		)
	)
		throw new Error("Impact references an unknown requirement");
	const uncertain =
		result.uncertainty.length ||
		snapshot.repositories.some((r) => r.uncertainty.length) ||
		!result.testAssertions.inspected ||
		result.testAssertions.weakened;
	const scopeChanged =
		!previous ||
		(previous.baseline.impact?.snapshot.sourceDigest ??
			previous.baseline.inventory.sourceContextDigest) !==
			snapshot.sourceDigest;
	const scopeProven = Boolean(
		result.scopeReuse &&
			previous &&
			result.scopeReuse.inventoryDigest === inventory?.digest &&
			result.scopeReuse.originalSourceDigest ===
				inventory?.sourceContextDigest &&
			!result.extractRequirements &&
			!result.uncertainty.length,
	);
	if (result.scopeReuse && !scopeProven)
		throw new Error(
			"Inventory reuse needs the exact prior source context and inventory plus an independent unchanged-scope assessment",
		);
	if (scopeChanged && !scopeProven && !result.extractRequirements)
		throw new Error(
			"Changed or missing scope provenance requires requirement extraction",
		);
	if (
		(uncertain || !previous || (scopeChanged && !scopeProven)) &&
		(result.classification !== "full" ||
			result.reuse.length ||
			result.specialists.length !== known.size ||
			result.humanReview === "continue-after-checks")
	)
		throw new Error(
			"Unknown scope, weakened assertions or uncertainty requires full relevant review and renewed approval",
		);
	if (
		result.classification === "full" &&
		result.specialists.length !== known.size
	)
		throw new Error("Full review must execute every configured specialist");
	if (
		result.humanReview === "continue-after-checks" &&
		(!snapshot.approval ||
			previous?.disagreements.length ||
			previous?.findings.length ||
			!result.targetCompatible)
	)
		throw new Error(
			"Approval continuation needs prior explicit approval and resolved consequential review",
		);
	if (
		result.humanReview === "continue-after-checks" &&
		!approvalScopeMatches(snapshot)
	)
		throw new Error(
			"Prior explicit approval does not cover the current delivery URLs and repository scope",
		);
	if (
		!snapshot.approval &&
		result.humanReview !== "no-prior-approval" &&
		!(result.humanReview === "renew" && run.humanDecisions?.length)
	)
		throw new Error("Impact cannot invent human approval");
	if (uncertain && result.qaReuse.length)
		throw new Error("Uncertain changes cannot reuse behavioral QA");
	const reuseRecords: ReuseRecord[] = [];
	for (const reuse of result.reuse) {
		if (
			!known.has(reuse.reviewer) ||
			result.specialists.includes(reuse.reviewer) ||
			reuseRecords.some((r) => r.original.stamp.reviewer === reuse.reviewer)
		)
			throw new Error(
				"A configured reviewer needs exactly one fresh or reused receipt",
			);
		const original = previous?.reviewers.find(
			(r) => r.stamp.reviewer === reuse.reviewer,
		);
		const provenance = original?.evidenceBoundary;
		if (
			!original ||
			qaDigest(original) !== reuse.receiptDigest ||
			original.status !== "completed" ||
			original.blockers.length ||
			original.findings.some((f) => f.status === "open" && f.rating > 1) ||
			original.disagreements.length ||
			!provenance
		)
			throw new Error(
				"Reuse requires a completed, resolved original receipt with dependency provenance",
			);
		if (
			provenance.environmentDigest !== snapshot.environmentDigest ||
			qaDigest(provenance.boundary) !== qaDigest(reuse.boundary) ||
			provenance.dependencyDigest !== boundaryDigest(run, reuse.boundary)
		)
			throw new Error("Evidence dependencies or environment changed");
		if (
			changedPaths(snapshot, run).some((f) =>
				reuse.boundary.dependencies.some((d) => dependencyCovers(f, d)),
			)
		)
			throw new Error("Affected source evidence must execute again");
		if (
			original.stamp.inventoryDigest !== snapshot.inventoryDigest ||
			!result.targetCompatible
		)
			throw new Error(
				"Changed inventory or incompatible target invalidates retained coverage",
			);
		reuseRecords.push({
			schemaVersion: 1,
			snapshotDigest: snapshot.digest,
			originalDigest: reuse.receiptDigest,
			original: structuredClone(original),
			boundary: reuse.boundary,
			dependencyDigest: provenance.dependencyDigest,
			environmentDigest: snapshot.environmentDigest,
			reason: reuse.reason,
		});
	}
	if (
		result.status === "completed" &&
		result.specialists.length + reuseRecords.length !== known.size
	)
		throw new Error(
			"Every configured reviewer must execute or have independently validated reuse",
		);
	if (
		result.readinessOnly &&
		snapshot.repositories.some((r) => r.reviewBase !== r.targetSha)
	)
		throw new Error(
			"Changed target needs compatible aggregate evidence before readiness-only routing",
		);
	if (
		result.readinessOnly &&
		(result.classification !== "none" ||
			result.correctionRequired ||
			result.specialists.length ||
			result.qaCriteria.length ||
			result.checks.length)
	)
		throw new Error(
			"Readiness-only routing requires no changed work or pending verification",
		);
	if (
		result.commentAssessments.some((c) => c.disposition === "consequential") &&
		!result.correctionRequired
	)
		throw new Error("Consequential feedback requires corrective work");
	if (
		result.classification === "none" &&
		snapshot.repositories.some((r) => r.diff)
	)
		throw new Error("Source corrections require affected or full work");
	return {
		...result,
		snapshot,
		reuseRecords,
		pending: {
			specialists: [...result.specialists],
			checks: result.checks.map((c) => c.id),
			qaCriteria: [...result.qaCriteria],
		},
		checkResults: [],
		at: new Date().toISOString(),
	};
}
export function decisionFor(run: FactoryRun, key: string) {
	const latest = [...(run.impactDecisions ?? [])]
		.reverse()
		.find((d) => d.snapshot.key === key);
	return latest?.status === "completed" ? latest : undefined;
}
export async function assertImpactFresh(
	context: ExecutionContext,
	decision: ImpactDecision,
	fanout: WorkflowStep,
) {
	const current = await collectImpactSnapshot(
		context,
		fanout,
		decision.snapshot.key,
		decision.snapshot,
	);
	// Trigger/history is not relevant state; receipt dates and new IDs never advance evidence.
	if (
		qaDigest({ ...current, trigger: undefined, digest: undefined }) !==
		qaDigest({ ...decision.snapshot, trigger: undefined, digest: undefined })
	)
		throw new Error(
			"Impact decision is stale; assess changed scope, source, findings, environment or target before consuming it",
		);
	for (const record of decision.reuseRecords)
		assertReuse(record, decision.snapshot, context.run);
}
export function assertReuse(
	record: ReuseRecord,
	snapshot: ImpactSnapshot,
	run?: FactoryRun,
) {
	if (
		record.schemaVersion !== 1 ||
		record.snapshotDigest !== snapshot.digest ||
		qaDigest(record.original) !== record.originalDigest ||
		record.original.status !== "completed" ||
		record.original.blockers.length ||
		record.original.stamp.inventoryDigest !== snapshot.inventoryDigest ||
		record.environmentDigest !== snapshot.environmentDigest ||
		(run && boundaryDigest(run, record.boundary) !== record.dependencyDigest)
	)
		throw new Error("Retained review evidence is stale or incomplete");
}
export function continuationEligible(
	decision: ImpactDecision | undefined,
	aggregate: AggregateReview | undefined,
) {
	return Boolean(
		decision?.status === "completed" &&
			decision.humanReview === "continue-after-checks" &&
			decision.snapshot.approval?.decision === "approve" &&
			approvalScopeMatches(decision.snapshot) &&
			aggregate?.approved &&
			!aggregate.findings.length &&
			!aggregate.disagreements.length &&
			!decision.pending.specialists.length &&
			!decision.pending.checks.length &&
			!decision.pending.qaCriteria.length &&
			decision.checkResults.every((r) => r.exitCode === 0),
	);
}
export interface ConvergenceState {
	fingerprint: string;
	repeats: number;
	recent?: string[];
}
export function recordConvergence(
	run: FactoryRun,
	key: string,
	decision: ImpactDecision,
	limit: number,
) {
	if (decision.readinessOnly && !decision.correctionRequired) return []; // Informational assessments and waits are not correction cycles.
	run.impactConvergence ??= {};
	const fingerprint = qaDigest({
		repositories: decision.snapshot.repositories.map((r) => [
			r.repositoryId,
			r.treeSha,
		]),
		source: decision.snapshot.sourceDigest,
		environment: decision.snapshot.environmentDigest,
		findings: decision.snapshot.progressFindingsDigest,
		work: {
			specialists: decision.specialists,
			checks: decision.checks.map((c) => [c.id, c.repositoryId, c.command]),
			qa: decision.qaCriteria,
		},
		valid: decision.reuseRecords
			.map((r) =>
				qaDigest({
					coverage: r.original.coverage.map((c) => [c.requirementId, c.status]),
					findings: r.original.findings.map((f) => [
						f.id,
						f.rating,
						f.status,
						f.category,
						f.requirementIds,
					]),
					dependencies: r.dependencyDigest,
					environment: r.environmentDigest,
				}),
			)
			.sort(),
	});
	const prior = run.impactConvergence[key];
	const recent = [
		...(prior?.recent ?? (prior ? [prior.fingerprint] : [])),
		fingerprint,
	].slice(-limit * 4);
	const repeats = recent.filter((value) => value === fingerprint).length;
	run.impactConvergence[key] = { fingerprint, repeats, recent };
	return repeats >= limit
		? [
				`How should we resolve the repeated review blocker? The same correction state has returned ${repeats} times without substantive progress. ${
					latestAggregate(run, key)
						?.findings.map((f) => f.summary)
						.slice(0, 3)
						.join("; ") ||
					"No new source or valid evidence resolves the outstanding validation or target coordination."
				} Provide a specific investigation or coordination action. Required review, checks and approval remain in place; an answer cannot waive them.`,
			]
		: [];
}
export const impactInstructions = `Independently assess /impactSnapshot, actual repository diffs (including cumulative changes since prior explicit approval), prior original receipts and unresolved findings. Fixer summaries never authorize reuse. Discover commands and conventions in ALL selected repositories; never infer safety from filenames, line count or unchanged head alone. Inspect whether test changes weaken assertions or coverage. Assess combined merge trees and target-only changes separately from task regressions. Unknown dependencies, conflicts, migrations, security boundaries, changed scope or unavailable evidence require broader inspection and relevant validation. Select only configured reviewer IDs from the snapshot. First review executes all roles. Reuse only completed resolved receipts with runtime dependency provenance; supply their exact receipt digest, boundary and a concrete independence reason. Unaffected areas retain original evidence, never claim a new review executed. Track future QA/guide/human/provider obligations at their own gates. Optional cleanup remains visible and nonblocking. Prior explicit approval can continue for an evidenced safe minor correction, including production code, only after all required evidence passes; uncertain or meaningful changes and human rejection require renewed approval. Assess the cumulative delta. Return impact-v1 with status, summary, correctionRequired:boolean, readinessOnly:boolean, commentAssessments:[{id,bodySha256,disposition:"informational|consequential|accepted-unchanged",reason}], classification:"none|affected|full", rationale, uncertainty:[], extractRequirements:boolean, scopeReuse:{inventoryDigest,originalSourceDigest,reason} only when independently inspecting new feedback proves accepted requirements unchanged, specialists:[configured IDs], requirementIds:[], checks:[{id,repositoryId,command,reason,environment:{isolation:"worktree"} or {isolation:"shared",resources:[stable identities]}}], qaCriteria:[criterion IDs], qaReuse:[{criterionId,originalDigest,reason}], reuse:[{reviewer,receiptDigest,reason,boundary:{requirementIds,areas,dependencies,independence}}], invalidate:[{receiptDigest,reason}], targetCompatible:boolean, testAssertions:{inspected,weakened,evidence}, humanReview:"no-prior-approval|continue-after-checks|renew", approvalRationale and questions:[]. Missing inputs require blocked and a specific question. Do not mutate files or run corrective agents. Every original configured role needs fresh execution or explicit valid reuse. Missing legacy provenance requires fresh review.`;

/** Resolve from accepted definitions, including called workflows and renamed roles. */
export function impactFanout(
	context: ExecutionContext,
	decision: ImpactDecision,
) {
	const collect = (steps: WorkflowStep[]): WorkflowStep[] =>
		steps.flatMap((s) => [s, ...(s.groups ?? []).flatMap(collect)]);
	const candidates = [
		context.run.workflow,
		...(context.run.workflowDefinitions ?? []),
	].flatMap((w) => collect(w.steps));
	const fanout = candidates.find(
		(s) =>
			s.type === "fanout" &&
			s.id === decision.snapshot.key.split("/").at(-1) &&
			qaDigest(
				(s.groups ?? []).flat().map((r) => ({
					id: r.id,
					name: r.name,
					contract: r.reviewContract!,
					promptDigest: qaDigest({
						prompt: r.prompt,
						runner: r.runner,
						model: r.model,
					}),
				})),
			) === qaDigest(decision.snapshot.reviewers),
	);
	if (!fanout)
		throw new Error("Accepted impact reviewer configuration is unavailable");
	return fanout;
}
export async function assertCurrentImpact(context: ExecutionContext) {
	if (!context.step.impactSource) return;
	const key =
		context.impactKey ??
		context.reviewKey ??
		[...(context.run.reviewRounds ?? [])].reverse()[0]?.key;
	const decision = key ? decisionFor(context.run, key) : undefined;
	if (!decision)
		throw new Error("Current delivery needs an independent impact assessment");
	await assertImpactFresh(context, decision, impactFanout(context, decision));
	return decision;
}
/** Tests/checks are trusted workflow work; receipt writes precede the next scheduling boundary. */
export async function selectedChecks(
	context: ExecutionContext,
	execute: (context: ExecutionContext, command: string) => Promise<string>,
) {
	const prefix = (context.stepKey ?? context.step.id).replace(/[^/]+$/, "");
	const candidates = context.run.impactDecisions ?? [];
	const decision = context.impactKey
		? decisionFor(context.run, context.impactKey)
		: [...candidates]
				.reverse()
				.find(
					(d) => d.status === "completed" && d.snapshot.key.startsWith(prefix),
				);
	if (!decision)
		throw new Error("Checks have no persisted independent assessment");
	for (const check of decision.checks) {
		if (
			decision.checkResults.some((r) => r.id === check.id && r.exitCode === 0)
		)
			continue;
		const repo = runRepositories(context.run).find(
			(r) => r.id === check.repositoryId,
		)!;
		try {
			const evidence = await execute(
				{ ...context, run: { ...context.run, workspace: repo.workspace } },
				check.command,
			);
			decision.checkResults = decision.checkResults.filter(
				(r) => r.id !== check.id,
			);
			decision.checkResults.push({
				id: check.id,
				exitCode: 0,
				evidence: evidence || "Completed with exit code 0",
			});
			decision.pending.checks = decision.pending.checks.filter(
				(id) => id !== check.id,
			);
		} catch (error) {
			decision.checkResults = decision.checkResults.filter(
				(r) => r.id !== check.id,
			);
			decision.checkResults.push({
				id: check.id,
				exitCode: 1,
				evidence: error instanceof Error ? error.message : String(error),
			});
			await context.save?.();
			return {
				questions: [
					`The required check ${check.command} failed in ${repo.name}. ${decision.checkResults.at(-1)!.evidence.slice(0, 800)} Provide the missing access or corrective direction. This check must pass before review or approval can continue.`,
				],
			};
		}
		await context.save?.();
	}
	return { questions: [], checks: decision.checkResults };
}

export async function effectiveApproval(context: ExecutionContext) {
	const original = context.run.humanDecisions?.at(-1);
	const continued = context.run.approvalContinuations?.at(-1);
	if (!context.step.impactSource || !continued) return original;
	const impact = await assertCurrentImpact(context);
	const aggregate = impact
		? latestAggregate(context.run, impact.snapshot.key)
		: undefined;
	if (
		!impact ||
		original?.decision !== "approve" ||
		original.reviewId !== continued.originalReviewId ||
		impactDecisionDigest(impact) !== continued.decisionDigest ||
		!continuationEligible(impact, aggregate)
	)
		return original;
	return {
		...original,
		headSha: continued.headSha,
		repositories: continued.repositories,
	};
}

export function feedbackDigest(run: FactoryRun) {
	const receipt = (run.outputs["merge-readiness"] ?? run.outputs.ci) as
		| { comments?: unknown[]; threads?: unknown[]; reviews?: unknown[] }
		| undefined;
	const records = (values: unknown[] = []): unknown[] =>
		values
			.map((value) => {
				const v = value as {
					id?: unknown;
					body?: string;
					state?: unknown;
					isResolved?: unknown;
					isOutdated?: unknown;
					user?: { login?: string };
					author?: { login?: string };
					comments?: { nodes?: unknown[] } | unknown[];
				};
				const comments = Array.isArray(v.comments)
					? v.comments
					: v.comments?.nodes;
				return {
					id: v.id,
					body: v.body,
					author: v.author?.login ?? v.user?.login,
					state: v.state,
					resolved: v.isResolved,
					outdated: v.isOutdated,
					comments: comments ? records(comments) : undefined,
				};
			})
			.sort((a, b) => qaDigest(a).localeCompare(qaDigest(b)));
	return qaDigest({
		comments: records(
			(receipt?.comments ?? []).filter(
				(value) =>
					!/<!-- generated-by-(?:cyrus|bobs-factory) -->/.test(
						(value as { body?: string }).body ?? "",
					),
			),
		),
		threads: records(receipt?.threads),
		reviews: records(receipt?.reviews),
	});
}

/** Continuation binds the outcome and completed work, not only the assessed Git refs. */
export function impactDecisionDigest(decision: ImpactDecision) {
	return qaDigest({
		assessment: ImpactSchema.parse(decision),
		snapshot: decision.snapshot.digest,
		reuse: decision.reuseRecords.map((r) => r.originalDigest),
		pending: decision.pending,
		checks: decision.checkResults,
	});
}

function approvalScopeMatches(snapshot: ImpactSnapshot) {
	const approval = snapshot.approval;
	if (
		!approval ||
		snapshot.deliveryMode === "external" ||
		(snapshot.deliveryMode === "mixed" &&
			(approval.mode !== "mixed" ||
				!approval.externalDigest ||
				approval.externalDigest !== snapshot.externalDigest))
	)
		return false;
	const published = snapshot.repositories.filter((r) => r.url);
	if (!published.length) return false;
	if (snapshot.repositories.length === 1)
		return approval.url === published[0]!.url;
	return published.every((r) =>
		approval.repositories?.some(
			(a) => a.repositoryId === r.repositoryId && a.url === r.url,
		),
	);
}

/** Follow explicit immutable assessments; never infer scope continuity from identical heads. */
export function unchangedScopeProof(
	run: FactoryRun,
	key: string,
	original: string,
	current: string,
	inventoryDigest: string,
) {
	const seen = new Set<string>();
	while (current !== original) {
		if (seen.has(current)) return false;
		seen.add(current);
		const proof = [...(run.impactDecisions ?? [])]
			.reverse()
			.find(
				(d) =>
					d.status === "completed" &&
					d.snapshot.key === key &&
					d.snapshot.sourceDigest === current &&
					d.scopeReuse?.inventoryDigest === inventoryDigest &&
					!d.uncertainty.length,
			);
		if (!proof?.scopeReuse) return false;
		current = proof.scopeReuse.originalSourceDigest;
	}
	return true;
}

/** Declared requirement sources bind custom named planning outputs without treating fixer summaries as authority. */
function impactSourceDigest(context: ExecutionContext, fanout: WorkflowStep) {
	const scope = inputScope(context) as Record<string, unknown>;
	const legacy = scopeContextDigest(scope);
	const inventory = (context.outputs ?? context.run.outputs)[
		fanout.review?.inventory ?? ""
	] as import("./SpecialistReview.js").Inventory | undefined;
	const conventional = new Set([
		"clarify",
		"decisions",
		"plan",
		"existing-work",
		"assess-existing",
		"source",
		"ticket",
	]);
	const pointers = [
		...new Set(
			(inventory?.requirements ?? [])
				.flatMap((r) => r.sources)
				.map((s) => s.reference)
				.filter(
					(p) =>
						p.startsWith("/outputs/") &&
						!conventional.has(p.split("/")[2]!) &&
						p.split("/")[2] !== fanout.review?.inventory,
				),
		),
	].sort();
	if (!pointers.length) return legacy;
	const declared = pointers.map((path) => {
		let value: unknown = scope;
		for (const key of path
			.slice(1)
			.split("/")
			.map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~")))
			value =
				value && typeof value === "object" && Object.hasOwn(value, key)
					? (value as Record<string, unknown>)[key]
					: undefined;
		return [path, value ?? { unavailable: true }];
	});
	return qaDigest({ legacy, declared });
}
