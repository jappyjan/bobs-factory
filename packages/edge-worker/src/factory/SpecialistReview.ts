import {
	retainTranscriptSource,
	runtimeTranscript,
	runtimeTranscriptField,
	type TranscriptScope,
	transcriptFieldSources,
	transcriptProvenanceEpoch,
	transcriptSource,
} from "bobs-factory-mcp-tools";
import { legacyScopeSources } from "./StepConfig.js";

export { calibratedReviewInstructions } from "./InstructionText.js";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isImmutableJson } from "bobs-factory-core";
import { z } from "zod";
import type { ImpactSnapshot, ReuseRecord } from "./Impact.js";
import { assertReuse, boundaryDigest, environmentDigest } from "./Impact.js";
import { EvidenceBoundarySchema } from "./ImpactContracts.js";
import { qaDigest } from "./Qa.js";
import { QuestionFieldsSchema } from "./Questions.js";
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import { takeoverSource } from "./RunContextSources.js";
import {
	consumesImpact,
	consumesReview,
	hasCheck,
	readStep,
	reviewEvidenceContract,
} from "./StepConfig.js";
import { stepForRun } from "./ToolBindings.js";
import type { WorkflowStep } from "./Workflow.js";
import { historySnapshotRange, snapshotHistory } from "./WorkflowInput.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

const text = z.string().trim().min(1);
const id = text.regex(/^[a-zA-Z0-9_-]+$/);
const source = z.object({ source: text, reference: text });
const decision = z.object({
	id,
	acceptedBy: text,
	rationale: text,
	source,
	kind: z.enum(["scope", "skip"]),
	requirementIds: z.array(id).min(1),
});
export const InventorySchema = QuestionFieldsSchema.safeExtend({
	schemaVersion: z.literal(1),
	requirements: z
		.array(
			z.object({
				id,
				criterion: text,
				classification: z.enum(["active", "suggestion", "superseded"]),
				stage: z
					.enum(["code", "qa", "guide", "acceptance", "delivery"])
					.optional(),
				sources: z.array(source).min(1),
				changeReason: text.optional(),
				supersedes: z.array(id).default([]),
			}),
		)
		.min(1),
	decisions: z.array(decision),
	conflicts: z.array(
		z.object({ id, description: text, sources: z.array(source).min(1) }),
	),
	sourceReceipt: z.object({
		considered: z.array(source).min(1),
		unavailable: z.array(text),
	}),
	questions: z.array(text),
});
export type Inventory = z.infer<typeof InventorySchema> & {
	version: number;
	digest: string;
	sourceContextDigest?: string;
	scopeReuse?: {
		inventoryDigest: string;
		originalSourceDigest: string;
		reason: string;
		snapshotDigest: string;
	};
};
export const AssessmentSchema = z.object({
	requirementId: id,
	status: z.enum(["met", "not_met", "deliberately_skipped", "deferred"]),
	obligation: z
		.object({
			stage: z.enum(["qa", "guide", "acceptance", "delivery"]),
			action: text,
		})
		.optional(),
	evidence: z.array(text).min(1),
	reason: text,
	decisionId: id.optional(),
});
export const SpecialistSchema = z.object({
	evidenceBoundary: EvidenceBoundarySchema.optional(),
	optionalDisagreements: z.array(text).optional(),
	status: z.enum(["completed", "blocked", "failed"]).optional(),
	blockers: z.array(text).default([]),
	summary: text,
	findings: z.array(
		z.object({
			id,
			rating: z.number().int().min(1).max(3),
			summary: text,
			evidence: text,
			status: z
				.enum(["open", "resolved", "accepted-rejection"])
				.default("open"),
			requirementIds: z.array(id).default([]),
			reason: text.optional(),
			freshEvidence: text.optional(),
			category: z
				.enum([
					"defect",
					"requirement",
					"mandatory-rule",
					"investigation",
					"optional",
					"integration",
					"verification",
					"wait",
					"downstream",
				])
				.optional(),
			ruleReference: text.optional(),
			consequence: text.optional(),
			remedy: text.optional(),
			investigation: z
				.object({
					state: z.enum(["confirmed", "needs-evidence"]),
					missingEvidence: text.optional(),
					nextAction: text.optional(),
				})
				.optional(),
			duplicateOf: text.optional(),
		}),
	),
	disagreements: z.array(text).default([]),
	disputeResolutions: z
		.array(z.object({ disagreement: text, reason: text, evidence: text }))
		.default([]),
	inheritedDispositions: z
		.array(
			z.object({
				id: text,
				status: z.enum(["resolved", "accepted-rejection"]),
				reason: text,
				evidence: text,
			}),
		)
		.default([]),
});
export const CoverageSchema = SpecialistSchema.extend({
	coverage: z.array(AssessmentSchema),
});
export type ReviewBaseline = {
	schemaVersion: 1;
	impact?: { snapshot: ImpactSnapshot; reuse: ReuseRecord[] };
	round: number;
	key: string;
	inventory: Inventory;
	headSha: string;
	baseSha: string;
	repositories?: {
		repositoryId: string;
		name: string;
		headSha: string;
		baseSha: string;
	}[];
	historyLength: number;
	reviewers: { id: string; key: string; group: number; contract: string }[];
	context: unknown;
	/** New baselines retain exact runtime-owned history ranges, without copying payloads. */
	contextReferences?: ReviewContextReference[];
	/** Runtime-only source table for legacy inline/copy reconstruction; never native approval. */
	contextTranscriptSources?: {
		path: string[];
		source: TranscriptScope;
		field?: string;
	}[];
	at: string;
};
export type ReviewContextReference = {
	path: string[];
	runId: string;
	start: number;
	end: number;
	receiptIndexDigest: string;
};
export type ReviewerReceipt = Omit<
	z.infer<typeof CoverageSchema>,
	"evidenceBoundary"
> & {
	evidenceBoundary?: {
		boundary: z.infer<typeof EvidenceBoundarySchema>;
		dependencyDigest: string;
		environmentDigest: string;
		at: string;
	};
	stamp: {
		reviewer: string;
		stepKey: string;
		round: number;
		inventoryDigest: string;
		inventoryVersion: number;
		headSha: string;
		baseSha: string;
	};
};
export type AggregateReview = {
	projection?: { repositoryId: string; original: AggregateReview };
	approved: boolean;
	findings: (z.infer<typeof SpecialistSchema>["findings"][number] & {
		reviewer: string;
	})[];
	rawFindings: AggregateReview["findings"];
	coverage: z.infer<typeof AssessmentSchema>[];
	reviewers: ReviewerReceipt[];
	disagreements: string[];
	baseline: ReviewBaseline;
};
const unique = (values: string[], label: string) => {
	if (new Set(values).size !== values.length)
		throw new Error(`${label} must be unique`);
};
export function validateInventory(
	value: unknown,
	previous?: Inventory,
): Inventory {
	const inventory = InventorySchema.parse(value);
	unique(
		inventory.requirements.map((r) => r.id),
		"Requirement IDs",
	);
	unique(
		inventory.decisions.map((d) => d.id),
		"Accepted decision IDs",
	);
	unique(
		inventory.conflicts.map((c) => c.id),
		"Conflict IDs",
	);
	if (
		(inventory.conflicts.length ||
			inventory.sourceReceipt.unavailable.length) &&
		!inventory.questions.length
	)
		throw new Error(
			"Unresolved scope conflicts or unavailable sources require an outside-fanout clarification question",
		);
	const known = new Set(inventory.requirements.map((r) => r.id));
	for (const d of inventory.decisions)
		if (d.requirementIds.some((id) => !known.has(id)))
			throw new Error(
				`${d.id}: decision references unknown inventory requirements`,
			);
	for (const requirement of inventory.requirements)
		if (
			requirement.supersedes.some(
				(id) => !known.has(id) || id === requirement.id,
			)
		)
			throw new Error(
				`${requirement.id}: supersedes must reference another retained requirement`,
			);
	for (const old of previous?.requirements ?? []) {
		const current = inventory.requirements.find((r) => r.id === old.id);
		if (!current)
			throw new Error(
				`Preserve historical requirement ${old.id}; mark superseded instead of deleting it`,
			);
		if (
			(current.criterion !== old.criterion ||
				current.classification !== old.classification ||
				(current.stage ?? "code") !== (old.stage ?? "code")) &&
			!current.changeReason
		)
			throw new Error(`${old.id}: amendments require a traceable changeReason`);
	}
	for (const current of inventory.requirements) {
		const old = previous?.requirements.find(
			(r) => r.criterion === current.criterion,
		);
		if (old && old.id !== current.id)
			throw new Error(`Preserve stable ID ${old.id} for unchanged criterion`);
	}
	for (const old of previous?.decisions ?? []) {
		if (!inventory.decisions.some((d) => qaDigest(d) === qaDigest(old)))
			throw new Error(
				`Preserve accepted scope decision ${old.id}; append a new decision for changes`,
			);
	}
	const digest = qaDigest(inventory);
	return {
		...inventory,
		digest,
		version:
			previous?.digest === digest
				? previous.version
				: (previous?.version ?? 0) + 1,
	};
}
export function activeRequirements(inventory: Inventory) {
	return inventory.requirements.filter((r) => r.classification === "active");
}

/** Apply the review contract to saved prompts without rewriting accepted graphs. */
export { reviewStageInstructions } from "./InstructionText.js";

export function validateSpecialist(
	value: unknown,
	baseline: ReviewBaseline,
	coverage: boolean,
	previous?: Pick<ReviewerReceipt, "findings" | "disagreements">,
): z.infer<typeof CoverageSchema> {
	const input = value as Record<string, unknown>;
	const boundary = input?.evidenceBoundary as
		| { boundary?: unknown }
		| undefined;
	const parseable = boundary?.boundary
		? { ...input, evidenceBoundary: boundary.boundary }
		: value;
	const review = coverage
		? CoverageSchema.parse(parseable)
		: { ...SpecialistSchema.parse(parseable), coverage: [] };
	unique(
		review.findings.map((f) => f.id),
		"Local finding IDs",
	);
	const requirements = new Set(
		activeRequirements(baseline.inventory).map((r) => r.id),
	);
	if (
		review.evidenceBoundary?.requirementIds.some((id) => !requirements.has(id))
	)
		throw new Error(
			"Evidence boundary references an unknown active requirement",
		);
	for (const finding of review.findings) {
		if (
			finding.category === "downstream" &&
			finding.rating > 1 &&
			finding.status === "open"
		)
			throw new Error(`${finding.id}: downstream obligations are nonblocking`);
		if (baseline.impact && finding.rating > 1 && finding.status === "open") {
			if (["optional", "wait", "downstream"].includes(finding.category ?? ""))
				throw new Error(
					`${finding.id}: optional observations, waits and downstream obligations are nonblocking`,
				);
			if (
				!finding.category ||
				(!finding.requirementIds.length && !finding.ruleReference) ||
				!finding.consequence ||
				!finding.remedy ||
				!finding.investigation
			)
				throw new Error(
					`${finding.id}: consequential findings need a requirement/rule, consequence, remedy and investigation evidence`,
				);
			if (
				finding.investigation.state === "needs-evidence" &&
				(!finding.investigation.missingEvidence ||
					!finding.investigation.nextAction)
			)
				throw new Error(
					`${finding.id}: investigation needs missing evidence and a next action`,
				);
		}
		if (finding.requirementIds.some((id) => !requirements.has(id)))
			throw new Error(`${finding.id}: unknown active requirement`);
		if (finding.status !== "open" && !finding.reason)
			throw new Error(
				`${finding.id}: settled findings require reason and evidence`,
			);
	}
	for (const disagreement of previous?.disagreements ?? []) {
		if (
			!review.disagreements.includes(disagreement) &&
			!review.disputeResolutions.some((r) => r.disagreement === disagreement)
		)
			throw new Error(
				"Prior disagreement needs an explicit evidence-backed resolution",
			);
	}
	for (const old of previous?.findings ?? []) {
		const current = review.findings.find((f) => f.id === old.id);
		if (old.status === "open" && old.rating > 1 && !current)
			throw new Error(
				`Reassess prior open finding ${old.id}; omission does not resolve it`,
			);
		if (
			old.status !== "open" &&
			current?.status === "open" &&
			!current.freshEvidence
		)
			throw new Error(
				`${old.id}: reopening a settled finding requires fresh evidence or changed requirements`,
			);
	}
	if (coverage) {
		unique(
			review.coverage.map((a) => a.requirementId),
			"Coverage requirement IDs",
		);
		if (
			review.coverage.length !== requirements.size ||
			review.coverage.some((a) => !requirements.has(a.requirementId))
		)
			throw new Error(
				"Coverage must assess every active requirement exactly once, with no unknown IDs",
			);
		for (const assessment of review.coverage) {
			if (assessment.status === "deferred") {
				const requirement = baseline.inventory.requirements.find(
					(r) => r.id === assessment.requirementId,
				);
				if (
					!assessment.obligation ||
					!requirement?.stage ||
					requirement.stage === "code" ||
					requirement.stage !== assessment.obligation.stage
				)
					throw new Error(
						`${assessment.requirementId}: only a declared downstream obligation can be deferred to its own gate`,
					);
			}
			if (
				assessment.status === "deliberately_skipped" &&
				!baseline.inventory.decisions.some(
					(d) =>
						d.id === assessment.decisionId &&
						d.kind === "skip" &&
						d.requirementIds.includes(assessment.requirementId),
				)
			)
				throw new Error(
					`${assessment.requirementId}: deliberate skip requires an explicitly accepted scope decision, person and rationale`,
				);
			if (
				assessment.status === "not_met" &&
				!review.findings.some(
					(f) =>
						f.status === "open" &&
						f.rating > 1 &&
						f.requirementIds.includes(assessment.requirementId),
				)
			)
				throw new Error(
					`${assessment.requirementId}: unmet requirements need actionable rating 2/3 findings`,
				);
		}
	}
	return review;
}
export function validateReviewConfiguration(
	steps: WorkflowStep[],
	specialistBranch = false,
	inputs: string[] = [],
): void {
	const byId = new Map(steps.map((s) => [s.id, s]));
	for (const step of steps) {
		const format = reviewEvidenceContract(step);
		if (hasCheck(step, "impact-reuse")) {
			const fanout = byId.get(readStep(step, "fanout") ?? ""),
				inventory = byId.get(readStep(step, "inventory") ?? "");
			if (step.inputs)
				throw new Error(
					`${step.id}: impact-v1 needs complete context and its own independent output contract`,
				);
			if (
				step.type !== "agent" ||
				step.json === false ||
				!step.askQuestions ||
				fanout?.type !== "fanout" ||
				!consumesReview(fanout) ||
				readStep(fanout, "inventory") !== inventory?.id ||
				!inventory ||
				reviewEvidenceContract(inventory) !== "inventory-v1"
			)
				throw new Error(
					`${step.id}: impact-v1 requires a structured independent agent, questions and configured inventory/fanout`,
				);
		}
		const impact = consumesImpact(step) ? readStep(step, "impact") : undefined;
		if (
			impact &&
			!inputs.includes(impact) &&
			(!byId.has(impact) || !hasCheck(byId.get(impact)!, "impact-reuse"))
		)
			throw new Error(`${step.id}: unknown impact source`);
		if (
			["specialist-v1", "coverage-v1"].includes(format ?? "") &&
			!specialistBranch
		)
			throw new Error(
				`${step.id}: specialist output contracts belong inside a configured review fanout`,
			);
		if (format === "inventory-v1" && step.inputs)
			throw new Error(
				`${step.id}: requirement extraction needs complete context; remove the inputs restriction`,
			);
		if (
			["inventory-v1", "specialist-v1", "coverage-v1"].includes(format ?? "") &&
			(step.type !== "agent" || step.json === false)
		)
			throw new Error(
				`${step.id}: review contracts require structured JSON agent output`,
			);
		if (format === "inventory-v1" && !step.askQuestions)
			throw new Error(
				`${step.id}: requirement extraction needs an outside-fanout question checkpoint`,
			);
		const inventoryId = consumesReview(step)
			? readStep(step, "inventory")
			: undefined;
		const reviewGraph =
			(step.type === "fanout" ||
				step.tool === "review-gate" ||
				(step.type === "check" && hasCheck(step, "review-evidence"))) &&
			inventoryId;
		if (reviewGraph) {
			const inventory = byId.get(inventoryId);
			if (!inventory || reviewEvidenceContract(inventory) !== "inventory-v1")
				throw new Error(
					`${step.id}: review.inventory must name a requirement extraction agent in this graph`,
				);
			const fanout =
				step.type === "fanout"
					? step
					: byId.get(readStep(step, "fanout") ?? "");
			if (
				fanout?.type !== "fanout" ||
				!consumesReview(fanout) ||
				readStep(fanout, "inventory") !== inventoryId
			)
				throw new Error(
					`${step.id}: review.fanout must name a configured specialist fanout with the same inventory`,
				);
			if (
				consumesImpact(fanout) &&
				readStep(fanout, "impact") &&
				step.type !== "fanout" &&
				impact !== readStep(fanout, "impact")
			)
				throw new Error(
					`${step.id}: an impact review gate must consume the same declared impact source as its fanout`,
				);
			const reviewers = (fanout.groups ?? []).flat();
			if (
				reviewers.some(
					(s) =>
						s.type !== "agent" ||
						!["specialist-v1", "coverage-v1"].includes(
							reviewEvidenceContract(s) ?? "",
						) ||
						s.askQuestions,
				)
			)
				throw new Error(
					`${step.id}: specialist branches must contain only contracted review agents without human checkpoints`,
				);
			unique(
				reviewers.map((s) => s.id),
				"Reviewer identities within a round",
			);
			if (
				reviewers.filter((s) => reviewEvidenceContract(s) === "coverage-v1")
					.length !== 1
			)
				throw new Error(
					`${step.id}: configure exactly one coverage-v1 reviewer. Replace the coverage supplier before removing it; removed roles never execute implicitly.`,
				);
		}
		for (const group of step.groups ?? [])
			validateReviewConfiguration(group, Boolean(reviewGraph), inputs);
		if (step.body)
			validateReviewConfiguration(step.body, Boolean(reviewGraph), inputs);
	}
}

const exec = promisify(execFile);
export async function reviewedRevision(
	workspace: string,
	base?: string,
	{ requireClean = true }: { requireClean?: boolean } = {},
) {
	const git = async (...args: string[]) =>
		(await exec("git", args, { cwd: workspace, timeout: 10000 })).stdout.trim();
	const headSha = await git("rev-parse", "HEAD");
	if (requireClean && (await git("status", "--porcelain")))
		throw new Error(
			"Specialist review requires a clean worktree; commit changes before review",
		);
	const baseSha = await git("rev-parse", base ?? "refs/remotes/origin/HEAD");
	return { headSha, baseSha };
}
/** Freeze every Git root; group fingerprints are never passed to Git as commits. */
export async function reviewedRunRevision(
	run: FactoryRun,
	baseline?: Pick<ReviewBaseline, "baseSha" | "repositories"> | string,
	options: { requireClean?: boolean } = {},
) {
	const scope = runRepositories(run);
	const source = takeoverSource(run) as { baseRefName?: string } | undefined;
	const primaryBase = source?.baseRefName ?? scope[0]!.baseBranch;
	if (scope.length === 1)
		return reviewedRevision(
			run.workspace,
			typeof baseline === "string"
				? baseline
				: (baseline?.baseSha ?? `refs/remotes/origin/${primaryBase}`),
			options,
		);
	const repositories = await Promise.all(
		scope.map(async (repository) => {
			const retained =
				typeof baseline === "object"
					? baseline.repositories?.find(
							(item) => item.repositoryId === repository.id,
						)
					: undefined;
			if (typeof baseline === "object" && !retained)
				throw new Error("Specialist baseline is missing a scoped repository");
			const base =
				retained?.baseSha ??
				(repository.id === run.repositoryId && typeof baseline === "string"
					? baseline
					: `refs/remotes/origin/${repository.baseBranch}`);
			return {
				repositoryId: repository.id,
				name: repository.name,
				...(await reviewedRevision(repository.workspace, base, options)),
			};
		}),
	);
	return {
		headSha: scopeRevision(repositories),
		baseSha: scopeRevision(
			repositories.map((repository) => ({
				...repository,
				headSha: repository.baseSha,
			})),
		),
		repositories,
	};
}
export function latestAggregate(
	run: FactoryRun,
	key?: string,
	round?: number,
): AggregateReview | undefined {
	for (let index = run.history.length - 1; index >= 0; index--) {
		const entry = run.history[index]!;
		const stored = entry.output as AggregateReview;
		const receipt = entry.evidence?.["review-evidence"] as
			| AggregateReview
			| undefined;
		const producer = stepForRun(run, entry.step);
		const expectedKey =
			producer && readStep(producer, "fanout")
				? `${entry.step.replace(/[^/]+$/, "")}${readStep(producer, "fanout")}`
				: undefined;
		let output: AggregateReview | undefined;
		if (!run.workflow)
			output = stored; // Graphless historical package callers.
		else if (
			producer?.type === "check" &&
			hasCheck(producer, "review-evidence") &&
			hasCheck(producer, "review-boundary") &&
			receipt?.approved === stored?.approved &&
			receipt?.baseline?.key === expectedKey
		)
			output = receipt;
		else if (
			producer?.type === "tool" &&
			producer.tool === "review-gate" &&
			consumesReview(producer) &&
			stored?.baseline?.key === expectedKey
		)
			output = stored;
		if (
			output?.baseline?.schemaVersion === 1 &&
			(!key || output.baseline.key === key) &&
			(round === undefined || output.baseline.round === round) &&
			Array.isArray(output.reviewers)
		)
			return output;
	}
	return undefined;
}
export function roundFor(
	context: ExecutionContext,
): ReviewBaseline | undefined {
	const key = context.stepKey ?? context.step.id;
	const rounds = context.run.reviewRounds ?? [];
	for (let index = rounds.length - 1; index >= 0; index--) {
		const round = rounds[index]!;
		if (key.startsWith(`${round.key}/`)) return round;
	}
	return undefined;
}
export function validateContractOutput(
	context: ExecutionContext,
	value: unknown,
): unknown {
	const contract = reviewEvidenceContract(context.step);
	if (
		!["inventory-v1", "specialist-v1", "coverage-v1"].includes(contract ?? "")
	)
		return value;
	if (contract === "inventory-v1")
		return validateInventory(
			value,
			(context.outputs ?? context.run.outputs)[context.step.id] as
				| Inventory
				| undefined,
		);
	z.object({ status: z.enum(["completed", "blocked", "failed"]) }).parse(value);
	const baseline = roundFor(context);
	if (!baseline)
		throw new Error("Specialist has no runtime-owned review baseline");
	const previous = priorReviewer(
		latestAggregate(context.run, baseline.key),
		context.step.id,
	);
	const reviewed = validateSpecialist(
		value,
		baseline,
		contract === "coverage-v1",
		previous,
	);
	// Authoring errors, including escaping symlinks, must reach the role's bounded
	// output-correction loop before the graph stamps a completed receipt.
	if (reviewed.evidenceBoundary)
		boundaryDigest(context.run, reviewed.evidenceBoundary);
	return reviewed;
}
/** The aggregate retains dispositions even when a later receipt omits them. */
function priorReviewer(
	aggregate: AggregateReview | undefined,
	reviewer: string,
) {
	if (!aggregate) return;
	return {
		findings: aggregate.rawFindings
			.filter((f) => f.reviewer === reviewer)
			.map((f) => ({ ...f, id: f.id.slice(reviewer.length + 1) })),
		disagreements: aggregate.disagreements
			.filter((d) => d.startsWith(`${reviewer}: `))
			.map((d) => d.slice(reviewer.length + 2)),
	};
}
export function stampSpecialist(
	context: ExecutionContext,
	value: unknown,
): ReviewerReceipt {
	const baseline = roundFor(context)!;
	const validated = validateContractOutput(context, value) as z.infer<
		typeof CoverageSchema
	>;
	const { evidenceBoundary, ...result } = validated;
	return {
		...result,
		...(evidenceBoundary
			? {
					evidenceBoundary: {
						boundary: evidenceBoundary,
						dependencyDigest: boundaryDigest(context.run, evidenceBoundary),
						environmentDigest: environmentDigest(context.run),
						at: new Date().toISOString(),
					},
				}
			: {}),
		stamp: {
			reviewer: context.step.id,
			stepKey: context.stepKey ?? context.step.id,
			round: baseline.round,
			inventoryDigest: baseline.inventory.digest,
			inventoryVersion: baseline.inventory.version,
			headSha: baseline.headSha,
			baseSha: baseline.baseSha,
		},
	};
}
export function aggregateReview(
	baseline: ReviewBaseline,
	branches: Record<string, unknown>[],
	previous?: AggregateReview,
): AggregateReview {
	if (
		qaDigest(InventorySchema.parse(baseline.inventory)) !==
		baseline.inventory.digest
	)
		throw new Error(
			"Frozen requirement inventory digest no longer matches its contents",
		);
	if (
		baseline.inventory.questions.length ||
		baseline.inventory.conflicts.length ||
		baseline.inventory.sourceReceipt.unavailable.length
	)
		throw new Error(
			"Requirement baseline has unresolved scope or source blockers",
		);
	const reviewers = baseline.reviewers.map((expected) => {
		const receipt = branches[expected.group]?.[expected.id] as
			| ReviewerReceipt
			| undefined;
		const reuse = baseline.impact?.reuse.find(
			(r) => r.original.stamp.reviewer === expected.id,
		);
		if (reuse) {
			assertReuse(reuse, baseline.impact!.snapshot);
			if (!receipt || qaDigest(receipt) !== reuse.originalDigest)
				throw new Error(
					`${expected.id}: reused receipt differs from its original`,
				);
			validateSpecialist(
				receipt,
				baseline,
				expected.contract === "coverage-v1",
				priorReviewer(previous, expected.id),
			);
			return receipt;
		}
		const stamp = receipt?.stamp;
		if (
			!stamp ||
			stamp.stepKey !== expected.key ||
			stamp.reviewer !== expected.id ||
			stamp.round !== baseline.round ||
			stamp.inventoryDigest !== baseline.inventory.digest ||
			stamp.inventoryVersion !== baseline.inventory.version ||
			stamp.headSha !== baseline.headSha ||
			stamp.baseSha !== baseline.baseSha
		)
			throw new Error(
				`${expected.id}: missing, incomplete or stale specialist receipt`,
			);
		validateSpecialist(
			receipt,
			baseline,
			expected.contract === "coverage-v1",
			priorReviewer(previous, expected.id),
		);
		return receipt!;
	});
	const rawFindings = reviewers.flatMap((r) =>
		r.findings.map((f) => ({
			...f,
			id: `${r.stamp.reviewer}:${f.id}`,
			reviewer: r.stamp.reviewer,
		})),
	);
	const retained =
		previous?.rawFindings.filter(
			(old) => !rawFindings.some((f) => f.id === old.id),
		) ?? [];
	for (const old of retained) {
		const disposition = reviewers
			.flatMap((r) => r.inheritedDispositions)
			.find((d) => d.id === old.id);
		rawFindings.push(disposition ? { ...old, ...disposition } : old);
	}
	const actionable = rawFindings.filter(
		(f) => f.rating > 1 && f.status === "open",
	);
	const findings = actionable.filter((f) => {
		if (!f.duplicateOf) return true;
		const original = actionable.find((o) => o.id === f.duplicateOf);
		// An unproven duplicate remains an independent blocker. Keep its original
		// claim in rawFindings; it must neither erase evidence nor stall aggregation.
		return (
			!original ||
			!!original.duplicateOf ||
			original.id === f.id ||
			qaDigest([
				original.requirementIds,
				original.evidence,
				original.remedy,
			]) !== qaDigest([f.requirementIds, f.evidence, f.remedy])
		);
	});
	// Unproven aliases must not tell the fixer that an actionable item is covered elsewhere.
	for (let index = 0; index < findings.length; index++) {
		const { duplicateOf: _claim, ...finding } = findings[index]!;
		findings[index] = finding;
	}
	const coverage = reviewers.find(
		(r) =>
			baseline.reviewers.find((e) => e.id === r.stamp.reviewer)?.contract ===
			"coverage-v1",
	)!.coverage;
	const disagreements = reviewers.flatMap((r) =>
		r.disagreements.map((d) => `${r.stamp.reviewer}: ${d}`),
	);
	for (const dispute of previous?.disagreements ?? [])
		if (
			!disagreements.includes(dispute) &&
			!reviewers.some((r) =>
				r.disputeResolutions.some(
					(d) =>
						d.disagreement === dispute ||
						`${r.stamp.reviewer}: ${d.disagreement}` === dispute,
				),
			)
		)
			disagreements.push(dispute);
	return {
		approved:
			reviewers.every(
				(reviewer) =>
					reviewer.status === "completed" && !reviewer.blockers.length,
			) &&
			!findings.length &&
			!disagreements.length &&
			coverage.every((a) => a.status !== "not_met"),
		findings,
		rawFindings,
		coverage,
		reviewers,
		disagreements,
		baseline,
	};
}
export function assertAggregateRevision(
	aggregate: AggregateReview | undefined,
	headSha: string,
	baseSha?: string,
): void {
	if (
		!aggregate?.approved ||
		aggregate.baseline.headSha !== headSha ||
		(baseSha && aggregate.baseline.baseSha !== baseSha)
	)
		throw new Error(
			"Specialist review is missing, unresolved or bound to a different revision/base; run a new requirement extraction and review round",
		);
	if (aggregate.projection) {
		const { original, repositoryId } = aggregate.projection;
		const revision = original.baseline.repositories?.find(
			(r) => r.repositoryId === repositoryId,
		);
		if (
			!revision ||
			revision.headSha !== headSha ||
			(baseSha && revision.baseSha !== baseSha) ||
			qaDigest(aggregate.reviewers) !== qaDigest(original.reviewers)
		)
			throw new Error(
				"Projected grouped evidence differs from the original review",
			);
		assertAggregateRevision(
			original,
			original.baseline.headSha,
			original.baseline.baseSha,
		);
		return;
	}
	const regenerated = aggregateReview(
		aggregate.baseline,
		aggregate.baseline.reviewers.reduce<Record<string, unknown>[]>(
			(branches, reviewer) => {
				branches[reviewer.group] ??= {};
				branches[reviewer.group]![reviewer.id] = aggregate.reviewers.find(
					(r) => r.stamp.reviewer === reviewer.id,
				);
				return branches;
			},
			[],
		),
		aggregate,
	);
	if (qaDigest(regenerated) !== qaDigest(aggregate))
		throw new Error("Aggregate review evidence changed after approval");
}

export function reviewBaselineForContext(
	context: ExecutionContext,
): ReviewBaseline | undefined {
	if (!context.run.reviewRounds?.length) return;
	const prefix = (
		context.stepKey ??
		context.run.step ??
		context.step.id
	).replace(/[^/]+$/, "");
	for (let index = context.run.reviewRounds.length - 1; index >= 0; index--) {
		const round = context.run.reviewRounds[index]!;
		// Older persisted checkpoints have no association. Retain safeguards for
		// the current graph and its callers/callees, excluding sibling branches.
		const reviewPrefix = round.key.replace(/[^/]+$/, "");
		if (
			context.reviewKey
				? round.key === context.reviewKey
				: reviewPrefix.startsWith(prefix) || prefix.startsWith(reviewPrefix)
		)
			return round;
	}
	return undefined;
}

export function aggregateForContext(
	context: ExecutionContext,
	options: { requireComplete?: boolean } = {},
): AggregateReview | undefined {
	const baseline = reviewBaselineForContext(context);
	if (!baseline) return;
	const aggregate = latestAggregate(context.run, baseline.key);
	if (!aggregate || aggregate.baseline.round !== baseline.round) {
		// Correction paths can proceed without approval; never reuse an older round.
		if (options.requireComplete === false) return;
		throw new Error(
			"Latest configured specialist round has no complete aggregate; approval is blocked",
		);
	}
	return aggregate;
}

export function scopeContextDigest(input: unknown): string {
	const context = input as Record<string, unknown>;
	return qaDigest({
		originalInput: context.originalInput,
		answers: context.answers,
		chatMessages: context.chatMessages,
		humanDecisions: Array.isArray(context.humanDecisions)
			? context.humanDecisions.filter(
					(d) =>
						!(
							d &&
							typeof d === "object" &&
							"decision" in d &&
							d.decision === "approve"
						),
				)
			: context.humanDecisions,
		accepted: context.scopeSources ?? legacyScopeSources(input),
	});
}

/** Keep prior evidence, but avoid recursively copying old immutable source snapshots. */
const frozenContexts = new WeakMap<object, { value: unknown; epoch: number }>();
const frozenContextTranscripts = new WeakMap<
	object,
	NonNullable<ReviewBaseline["contextTranscriptSources"]>
>();
function contextTranscriptRecords(
	value: object,
): NonNullable<ReviewBaseline["contextTranscriptSources"]> {
	const cached = frozenContextTranscripts.get(value);
	if (cached) return cached;
	const sources: NonNullable<ReviewBaseline["contextTranscriptSources"]> = [];
	const scope = transcriptSource(value);
	if (scope) sources.push({ path: [], source: scope });
	for (const [field, source] of transcriptFieldSources(value) ?? [])
		if (Object.hasOwn(value, field)) sources.push({ path: [], field, source });
	for (const [key, child] of Object.entries(value))
		if (child && typeof child === "object")
			for (const source of contextTranscriptRecords(child))
				sources.push({ ...source, path: [key, ...source.path] });
	return sources;
}
function withoutNestedBaselineContext(value: object) {
	const result = Object.fromEntries(
		Object.entries(value).filter(([field]) => field !== "context"),
	);
	retainTranscriptSource(value, result);
	return result;
}
export function frozenReviewContext(
	input: unknown,
	captureHistory?: (value: object, path: string[]) => unknown[] | undefined,
): unknown {
	const compact = (value: unknown, path: string[] = []): unknown => {
		if (!value || typeof value !== "object") return value;
		const reference = captureHistory?.(value, path);
		if (reference) return reference;
		// Published receipts never change. Cache only their context projection;
		// mutable envelopes and native history ranges are always captured anew.
		const cached = frozenContexts.get(value);
		if (isImmutableJson(value) && cached?.epoch === transcriptProvenanceEpoch())
			return cached.value;
		const result = Array.isArray(value)
			? value.map((item, index) => compact(item, [...path, String(index)]))
			: Object.fromEntries(
					Object.entries(value)
						.filter(([key]) => key !== "reviewBaseline")
						.map(([key, item]) => [
							key,
							key === "baseline" && item && typeof item === "object"
								? withoutNestedBaselineContext(item)
								: compact(item, [...path, key]),
						]),
				);
		retainTranscriptSource(value, result);
		if (transcriptProvenanceEpoch() > 0)
			frozenContextTranscripts.set(result, contextTranscriptRecords(result));
		if (isImmutableJson(value))
			frozenContexts.set(value, {
				value: result,
				epoch: transcriptProvenanceEpoch(),
			});
		return result;
	};
	return compact(input);
}

/** The reference table is authored by the runtime, outside role-provided JSON. */
export function captureReviewContext(
	input: unknown,
	run: Pick<FactoryRun, "id" | "history">,
	index: { step: string; at: string }[],
) {
	const contextReferences: ReviewContextReference[] = [];
	const context = frozenReviewContext(input, (value, path) => {
		const range = historySnapshotRange(value);
		if (!range || range.source !== run.history) return undefined;
		contextReferences.push({
			path,
			runId: run.id,
			start: range.start,
			end: range.end,
			receiptIndexDigest: qaDigest(index.slice(range.start, range.end)),
		});
		return [];
	});
	const contextTranscriptSources =
		context && typeof context === "object"
			? (frozenContextTranscripts.get(context) ?? [])
			: [];
	return {
		context,
		contextReferences,
		...(contextTranscriptSources.length ? { contextTranscriptSources } : {}),
	};
}

/** Resolve the original cutoff, never a newest output slot or an equal JSON value. */
export function originalReviewContext(
	baseline: Pick<
		ReviewBaseline,
		"context" | "contextReferences" | "contextTranscriptSources"
	>,
	run: Pick<FactoryRun, "id" | "history">,
	index: { step: string; at: string }[],
): unknown {
	let result = baseline.context;
	for (const reference of baseline.contextReferences ?? []) {
		if (
			reference.runId !== run.id ||
			!Number.isSafeInteger(reference.start) ||
			!Number.isSafeInteger(reference.end) ||
			reference.start < 0 ||
			reference.end < reference.start ||
			reference.end > run.history.length ||
			qaDigest(index.slice(reference.start, reference.end)) !==
				reference.receiptIndexDigest
		)
			throw new Error(
				"Original review context receipt range is missing or changed",
			);
		const replace = (value: unknown, depth: number): unknown => {
			if (depth === reference.path.length)
				return snapshotHistory(run.history, reference.start, reference.end);
			const key = reference.path[depth]!;
			if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
				throw new Error("Original review context path is missing");
			const copy = Array.isArray(value) ? value.slice() : { ...value };
			Object.defineProperty(copy, key, {
				value: replace((value as Record<string, unknown>)[key], depth + 1),
				enumerable: true,
				configurable: true,
				writable: true,
			});
			return copy;
		};
		result = replace(result, 0);
	}
	for (const entry of baseline.contextTranscriptSources ?? []) {
		if (entry.source.runId !== run.id)
			throw new Error("Foreign transcript source in original review context");
		let value = result;
		for (const key of entry.path) {
			if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
				throw new Error("Original transcript source path is missing");
			value = (value as Record<string, unknown>)[key];
		}
		if (!value || typeof value !== "object")
			throw new Error("Original transcript source is missing");
		if (entry.field !== undefined)
			runtimeTranscriptField(value, entry.field, entry.source);
		else runtimeTranscript(value, entry.source);
	}
	return result;
}
