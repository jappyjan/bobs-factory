export { reviewFixInstructions } from "./InstructionText.js";

import { createHash } from "node:crypto";
import { qaDigest } from "./EvidenceDigest.js";
import { feedbackInstructionFingerprint } from "./FeedbackPolicy.js";
import type { RoleRevision } from "./Incremental.js";
import {
	aggregateForContext,
	latestAggregate,
	type ReviewBaseline,
	type ReviewerReceipt,
	reviewBaselineForContext,
} from "./SpecialistReview.js";
import { readStep } from "./StepConfig.js";
import { boundOutput, boundStepKey } from "./ToolBindings.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

interface Finding {
	id: string;
	rating: number;
	status: string;
	summary: string;
	evidence: string;
}
interface FixAssessment {
	fingerprint: string;
	headSha?: string;
	unchangedCode: boolean;
	instructionsSha256: string;
}

function openFindings(value: unknown): Finding[] {
	const findings = (value as { findings?: Finding[] } | undefined)?.findings;
	return Array.isArray(findings)
		? findings.filter(
				(finding) => finding.rating > 1 && finding.status === "open",
			)
		: [];
}
function findingFingerprint(findings: Finding[]): string {
	// Stable IDs survive wording, timestamps and new probes of the same blocker.
	return createHash("sha256")
		.update(
			JSON.stringify(findings.map(({ id, rating }) => [id, rating]).sort()),
		)
		.digest("hex");
}

/** Corrections can use retained receipts without turning an unfinished round into approval. */
function codeReviewForFix(context: ExecutionContext): {
	findings: Finding[];
	baseline?: ReviewBaseline;
	review?: {
		key?: string;
		round?: number;
		headSha?: string;
		baseSha?: string;
		status: "incomplete";
		blockers: string[];
	};
} {
	const aggregate = aggregateForContext(context, { requireComplete: false });
	if (aggregate)
		return {
			findings: openFindings(aggregate),
			baseline: aggregate.baseline,
		};
	const baseline = reviewBaselineForContext(context);
	if (!baseline) {
		const gate = boundOutput(context, "reviewGate") as
			| { baseline?: ReviewBaseline }
			| undefined;
		if (!context.run.reviewRounds?.length && !gate?.baseline)
			return { findings: openFindings(gate) };
		return {
			findings: [],
			review: {
				key: context.reviewKey,
				status: "incomplete",
				blockers: [
					"No specialist baseline is associated with this correction step. Restore its review checkpoint or rerun the configured specialist review; another workflow frame's findings cannot establish this review.",
				],
			},
		};
	}
	const previous = latestAggregate(context.run, baseline.key);
	const findings = new Map(
		(previous?.rawFindings ?? previous?.findings ?? []).map((finding) => [
			finding.id,
			{ ...finding },
		]),
	);
	const blockers = [
		`Specialist round ${baseline.round} has no complete aggregate. Run its configured review gate after correction; required independent review remains pending.`,
	];
	const matches = (
		value: unknown,
		expected: ReviewBaseline["reviewers"][number],
	): value is ReviewerReceipt => {
		const receipt = value as ReviewerReceipt | undefined;
		const stamp = receipt?.stamp;
		if (!receipt || !stamp || !Array.isArray(receipt.findings)) return false;
		if (
			stamp.reviewer === expected.id &&
			stamp.stepKey === expected.key &&
			stamp.round === baseline.round &&
			stamp.inventoryDigest === baseline.inventory.digest &&
			stamp.inventoryVersion === baseline.inventory.version &&
			stamp.headSha === baseline.headSha &&
			stamp.baseSha === baseline.baseSha
		)
			return true;
		return Boolean(
			baseline.impact?.reuse.some(
				(reuse) =>
					reuse.original.stamp.reviewer === expected.id &&
					qaDigest(receipt) === reuse.originalDigest,
			),
		);
	};
	const expectedByKey = new Map(
		baseline.reviewers.map((reviewer) => [reviewer.key, reviewer]),
	);
	const receipts = new Map<string, ReviewerReceipt>();
	const history = context.historyIndex?.() ?? context.run.history;
	for (let index = history.length - 1; index >= 0; index--) {
		const expected = expectedByKey.get(history[index]!.step);
		if (!expected || receipts.has(expected.id)) continue;
		const output = context.run.history[index]!.output;
		if (matches(output, expected)) receipts.set(expected.id, output);
	}
	const fanout = (context.outputs ?? context.run.outputs)[
		baseline.key.split("/").at(-1)!
	] as Record<string, unknown>[] | undefined;
	const currentIds = new Set<string>();
	const dispositions: ReviewerReceipt["inheritedDispositions"] = [];
	for (const expected of baseline.reviewers) {
		const candidate = fanout?.[expected.group]?.[expected.id];
		const receipt =
			receipts.get(expected.id) ??
			(matches(candidate, expected) ? candidate : undefined);
		if (!receipt) {
			blockers.push(
				`${expected.id}: missing, incomplete or stale specialist receipt for round ${baseline.round}; rerun this configured reviewer.`,
			);
			continue;
		}
		if (receipt.status !== "completed" || receipt.blockers?.length)
			blockers.push(
				`${expected.id}: ${receipt.blockers?.join("; ") || receipt.summary || "review has not completed"}`,
			);
		for (const finding of receipt.findings) {
			currentIds.add(`${expected.id}:${finding.id}`);
			findings.set(`${expected.id}:${finding.id}`, {
				...finding,
				id: `${expected.id}:${finding.id}`,
				reviewer: expected.id,
			});
		}
		dispositions.push(...(receipt.inheritedDispositions ?? []));
	}
	for (const disposition of dispositions) {
		const retained = findings.get(disposition.id);
		if (retained && !currentIds.has(disposition.id))
			findings.set(disposition.id, { ...retained, ...disposition });
	}
	return {
		baseline,
		findings: openFindings({ findings: [...findings.values()] }).map(
			(finding) => {
				const { duplicateOf: _claim, ...retained } = finding as Finding & {
					duplicateOf?: string;
				};
				return retained;
			},
		),
		review: {
			key: baseline.key,
			round: baseline.round,
			headSha: baseline.headSha,
			baseSha: baseline.baseSha,
			status: "incomplete",
			blockers,
		},
	};
}
export function factoryReviewFixContext(context: ExecutionContext) {
	const { baseline: _baseline, ...review } = readStep(context.step, "qaGate")
		? {
				findings: openFindings(boundOutput(context, "qaGate")),
				baseline: undefined,
			}
		: codeReviewForFix(context);
	return {
		...review,
		answers: context.run.answers ?? [],
	};
}
/** Missing dispositions are corrected inside the role rather than replaying review. */
export function validateReviewFix(
	context: ExecutionContext,
	output: unknown,
): void {
	const value = output as {
		dispositions: { id: string }[];
		questions?: string[];
		status?: string;
		architectureRevision?: boolean;
	};
	if (
		value.architectureRevision === true &&
		value.status === "blocked" &&
		Array.isArray(value.questions) &&
		value.questions.length === 0
	)
		return;
	const missing = factoryReviewFixContext(context).findings.filter(
		(finding) => !value.dispositions.some((item) => item.id === finding.id),
	);
	if (missing.length && !value.questions?.length)
		throw new Error(
			`Disposition every unresolved finding or return questions for assistance. Missing finding IDs: ${missing.map((finding) => finding.id).join(", ")}`,
		);
}
/** Persist runtime-owned before/after provenance, independent of agent claims. */
export function recordReviewFix(
	context: ExecutionContext,
	output: unknown,
	completed?: RoleRevision,
) {
	const source = boundStepKey(context, "review");
	const baseline = readStep(context.step, "qaGate")
		? undefined
		: codeReviewForFix(context).baseline;
	const started = baseline
		? { headSha: baseline.headSha, dirty: false }
		: source
			? context.run.roleRevisions?.[source]
			: undefined;
	return {
		...(output as Record<string, unknown>),
		reviewAssessment: {
			fingerprint: findingFingerprint(
				factoryReviewFixContext(context).findings,
			),
			headSha: completed?.headSha,
			unchangedCode: Boolean(
				started &&
					completed &&
					!started.dirty &&
					!completed.dirty &&
					started.headSha === completed.headSha,
			),
			instructionsSha256: feedbackInstructionFingerprint(context),
		} satisfies FixAssessment,
	};
}
/** A rejected unchanged attempt needs new direction, not another automatic cycle. */
export function reviewRecoveryQuestions(
	context: ExecutionContext,
	gate: unknown,
	revision: { headSha: string; dirty: boolean },
): string[] {
	const findings = openFindings(gate);
	if (!findings.length || revision.dirty) return [];
	const fixer = boundStepKey(context, "fix");
	const previous = [...context.run.history]
		.reverse()
		.find((item) => item.step === fixer);
	const assessed = (
		previous?.output as { reviewAssessment?: FixAssessment } | undefined
	)?.reviewAssessment;
	if (
		!assessed?.unchangedCode ||
		assessed.headSha !== revision.headSha ||
		assessed.fingerprint !== findingFingerprint(findings) ||
		assessed.instructionsSha256 !== feedbackInstructionFingerprint(context)
	)
		return [];
	return [
		`Review still rejects the same findings after an unchanged fix attempt:\n\n${findings.map((finding) => `${finding.id}: ${finding.summary}\n${finding.evidence}`).join("\n\n")}\n\nProvide the missing access, deployment, evidence or corrective direction before retrying. Your answer resumes the existing fixer; these findings and required validation remain blocking.`,
	];
}
