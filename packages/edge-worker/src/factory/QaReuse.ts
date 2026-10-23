import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { promisify } from "node:util";
import {
	boundaryDigest,
	decisionFor,
	environmentDigest,
	unchangedScopeProof,
} from "./Impact.js";
import { dependencyCovers } from "./Incremental.js";
import {
	type QaExecution,
	QaExecutionSchema,
	type QaScope,
	qaDigest,
} from "./Qa.js";
import { runRepositories } from "./RepositoryScope.js";
import { diagnosticReuse } from "./RunDiagnostics.js";
import { consumesImpact, hasCheck, readOutput } from "./StepConfig.js";
import { boundStepKey } from "./ToolBindings.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

type Criterion = QaExecution["results"][number]["criteria"][number];
function decision(context: ExecutionContext) {
	if (!consumesImpact(context.step)) return undefined;
	const key = context.impactKey ?? context.reviewKey;
	return key ? decisionFor(context.run, key) : undefined;
}
type QaHistory = ExecutionContext["run"]["history"];
function captureHistory(context: ExecutionContext, history: QaHistory) {
	const key =
		boundStepKey(context, "capture") ?? context.stepKey ?? context.step.id;
	return history.filter((entry) => entry.step === key);
}
function gateHistory(context: ExecutionContext, history: QaHistory) {
	const key = boundStepKey(context, "qaGate");
	return key ? history.filter((entry) => entry.step === key) : [];
}
/** Canonical reuse inputs can be compared without executing environment probes. */
export function qaReuseBindingInputs(
	context: ExecutionContext,
	history?: QaHistory,
) {
	if (
		!hasCheck(context.step, "capture-evidence") ||
		!consumesImpact(context.step)
	)
		return undefined;
	const impact = decision(context);
	if (!impact) return undefined;
	const receipts = history ?? context.run.history;
	return {
		assessment: {
			snapshot: impact.snapshot,
			qaReuse: impact.qaReuse,
			qaCriteria: impact.qaCriteria,
		},
		scope: readOutput(
			context.step,
			"scope",
			context.outputs ?? context.run.outputs,
		),
		captures: captureHistory(context, receipts).map((entry) => entry.output),
		approvals: gateHistory(context, receipts).map((entry) => entry.output),
		scopeContinuity: (context.run.impactDecisions ?? [])
			.filter((item) => item.snapshot.key === impact.snapshot.key)
			.map((item) => ({
				status: item.status,
				sourceDigest: item.snapshot.sourceDigest,
				scopeReuse: item.scopeReuse,
				uncertainty: item.uncertainty,
			})),
		environmentDigest: environmentDigest(context.run),
	};
}

/** Behavioral reuse is independent of screenshot acceptance and never restamps execution. */
export function qaReuseContext(context: ExecutionContext) {
	const impact = decision(context);
	const scope = readOutput(
		context.step,
		"scope",
		context.outputs ?? context.run.outputs,
	) as QaScope | undefined;
	if (!impact || !scope)
		return { criteria: [] as { storyId: string; criterion: Criterion }[] };
	const criteria: { storyId: string; criterion: Criterion }[] = [];
	for (const selected of impact.qaReuse) {
		if (impact.qaCriteria.includes(selected.criterionId))
			throw new Error("A QA criterion cannot execute and reuse simultaneously");
		const story = scope.stories.find((s) =>
			s.criteria.some((c) => c.id === selected.criterionId),
		);
		if (
			!story?.dependencies?.length ||
			!story.independence ||
			!scope.environmentFingerprint ||
			!scope.environmentEvidence ||
			context.qaEnvironmentProof?.declarationDigest !==
				qaDigest(scope.environmentEvidence)
		)
			throw new Error(
				"Behavioral reuse needs source dependencies, independence and fixture/environment identity",
			);
		const boundary = {
			requirementIds: story.requirementRefs,
			areas: [story.id],
			dependencies: story.dependencies,
			independence: story.independence,
		};
		const depDigest = boundaryDigest(context.run, boundary);
		const paths = impact.snapshot.repositories.flatMap((r) =>
			[...r.files, ...r.targetFiles].map((f) => {
				const prefix = relative(context.run.workspace, r.workspace);
				return prefix ? `${prefix}/${f}` : f;
			}),
		);
		if (
			paths.some((f) => story.dependencies!.some((d) => dependencyCovers(f, d)))
		)
			throw new Error("Affected behavior needs fresh execution");
		const prior = captureHistory(context, context.run.history)
			.reverse()
			.map((h) => QaExecutionSchema.safeParse(h.output))
			.filter((p) => p.success)
			.map((p) => p.data!)
			.flatMap((e) => e.results)
			.find(
				(r) =>
					r.storyId === story.id &&
					r.criteria.some(
						(c) =>
							c.criterionId === selected.criterionId &&
							qaDigest(c) === selected.originalDigest,
					),
			);
		const original = prior?.criteria.find(
			(c) =>
				c.criterionId === selected.criterionId &&
				qaDigest(c) === selected.originalDigest,
		);
		if (
			!original?.origin ||
			original.outcome !== "passed" ||
			!original.evidence.length ||
			original.origin.storyDigest !== qaDigest(story) ||
			!unchangedScopeProof(
				context.run,
				impact.snapshot.key,
				original.origin.sourceDigest,
				impact.snapshot.sourceDigest,
				impact.snapshot.inventoryDigest ?? "",
			) ||
			original.origin.environmentFingerprint !== scope.environmentFingerprint ||
			original.origin.environmentProofDigest !==
				context.qaEnvironmentProof?.valueDigest ||
			original.origin.environmentDigest !== environmentDigest(context.run) ||
			original.origin.dependencyDigest !== depDigest
		)
			throw new Error(
				"Behavioral reuse needs passed original evidence with unchanged definitions, sources, fixtures and environment",
			);
		// A previous failed/blocked gate cannot authorize reuse of its apparently passed pieces.
		const approved = gateHistory(context, context.run.history).some(
			(h) =>
				(h.output as { approved?: boolean; headSha?: string }).approved ===
					true &&
				(h.output as { headSha?: string }).headSha === original.origin!.headSha,
		);
		if (!approved)
			throw new Error("Behavioral reuse needs prior independent QA acceptance");
		criteria.push({
			storyId: story.id,
			criterion: {
				...structuredClone(original),
				reuse: {
					originalDigest: selected.originalDigest,
					snapshotDigest: impact.snapshot.digest,
					reason: selected.reason,
				},
			},
		});
	}
	return { criteria };
}
export function stampQaCriteria(
	context: ExecutionContext,
	execution: QaExecution,
	validating = false,
) {
	const impact = decision(context);
	if (!impact) return execution;
	const scope = readOutput(
		context.step,
		"scope",
		context.outputs ?? context.run.outputs,
	) as QaScope;
	const reusable = qaReuseContext(context).criteria;
	for (const result of execution.results) {
		const story = scope.stories.find((s) => s.id === result.storyId);
		if (!story) continue; // Existing QA coverage validation rejects unknown stories.
		for (const criterion of result.criteria) {
			const retained = reusable.find(
				(c) =>
					c.storyId === story.id &&
					c.criterion.criterionId === criterion.criterionId,
			);
			if (criterion.reuse) {
				if (!retained || qaDigest(retained.criterion) !== qaDigest(criterion))
					throw new Error(
						"Reused behavioral result differs from the accepted original evidence",
					);
				diagnosticReuse(
					context.run,
					context.stepKey ?? context.step.id,
					criterion.reuse.originalDigest,
					criterion.criterionId,
				);
			} else {
				if (validating) {
					if (
						criterion.origin &&
						(criterion.origin.storyDigest !== qaDigest(story) ||
							criterion.origin.dependencyDigest !==
								boundaryDigest(context.run, {
									requirementIds: story.requirementRefs,
									areas: [story.id],
									dependencies: story.dependencies!,
									independence: story.independence!,
								}) ||
							criterion.origin.environmentProofDigest !==
								context.qaEnvironmentProof?.valueDigest)
					)
						throw new Error(
							"QA criterion sources or environment changed after execution",
						);
					continue;
				}
				delete criterion.origin; // Never trust runner stamps.
				if (
					story.dependencies &&
					story.independence &&
					scope.environmentFingerprint &&
					scope.environmentEvidence &&
					context.qaEnvironmentProof?.declarationDigest ===
						qaDigest(scope.environmentEvidence)
				)
					criterion.origin = {
						headSha:
							impact.snapshot.repositories.length === 1
								? impact.snapshot.repositories[0]!.headSha
								: execution.testedRevision!.headSha,
						storyDigest: qaDigest(story),
						dependencyDigest: boundaryDigest(context.run, {
							requirementIds: story.requirementRefs,
							areas: [story.id],
							dependencies: story.dependencies,
							independence: story.independence,
						}),
						environmentDigest: environmentDigest(context.run),
						environmentFingerprint: scope.environmentFingerprint,
						environmentProofDigest: context.qaEnvironmentProof!.valueDigest,
						sourceDigest: impact.snapshot.sourceDigest,
						at: new Date().toISOString(),
					};
			}
		}
	}
	impact.pending.qaCriteria = scope.stories
		.flatMap((s) => s.criteria)
		.filter(
			(c) =>
				!execution.results.some((r) =>
					r.criteria.some(
						(result) =>
							result.criterionId === c.id &&
							result.outcome === "passed" &&
							result.evidence.length,
					),
				),
		)
		.map((c) => c.id);
	return execution;
}

/** Probe current fixture/tool/environment state; declarations alone cannot authorize reuse. */
export async function verifyQaEnvironment(context: ExecutionContext) {
	const scope = readOutput(
		context.step,
		"scope",
		context.outputs ?? context.run.outputs,
	) as QaScope | undefined;
	delete context.qaEnvironmentProof;
	if (!scope?.environmentEvidence) return;
	const probe = scope.environmentEvidence;
	const repository = runRepositories(context.run).find(
		(r) => r.id === probe.repositoryId,
	);
	if (!repository)
		throw new Error("QA environment probe references an unknown repository");
	const { stdout } = await promisify(execFile)(
		"/bin/sh",
		["-c", probe.command],
		{
			cwd: repository.workspace,
			timeout: 15000,
			signal: context.signal,
			maxBuffer: 1024 * 1024,
		},
	);
	const output = stdout.trim();
	const outputDigest = createHash("sha256").update(output).digest("hex");
	// Keep saved JSON-string digests and criterion provenance valid for frozen scopes.
	const valueDigest = qaDigest(output);
	if (
		outputDigest !== probe.expectedDigest &&
		valueDigest !== probe.expectedDigest
	)
		throw new Error(
			"QA fixtures or environment changed; refresh scope and execute affected criteria",
		);
	context.qaEnvironmentProof = {
		declarationDigest: qaDigest(probe),
		valueDigest,
	};
}
