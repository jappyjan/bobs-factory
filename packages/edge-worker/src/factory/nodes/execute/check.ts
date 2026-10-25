import { evaluateCheckAsync } from "../../Check.js";
import { runEvidenceChecks } from "../../EvidenceChecks.js";
import { executeCommand, FactoryTools } from "../../FactoryTools.js";
import { conforms } from "../../OutputFormats.js";
import {
	progressEvidence,
	recordProgressEvidence,
} from "../../ProgressBudget.js";
import { qaDigest as importDigest } from "../../Qa.js";
import { reviewRecoveryQuestions } from "../../ReviewRecovery.js";
import {
	assertBoundInspectionFresh,
	outputRevisionBinding,
} from "../../RevisionBinding.js";
import { timingOperation } from "../../RunDiagnostics.js";
import { reviewedRunRevision } from "../../SpecialistReview.js";
import { stepBindings } from "../../StepBindings.js";
import {
	CHECK_SELECTOR_IDS,
	checkStepEvidenceIssues,
	hasCheck,
	resolveStepConfig,
} from "../../StepConfig.js";
import {
	boundOutput,
	boundStepKey,
	boundToolOutput,
} from "../../ToolBindings.js";
import { readPath } from "../../Workflow.js";
import type { ExecutionContext } from "../../WorkflowRuntime.js";
import type { NodeContext, NodeEngine } from "../NodeDefinition.js";
/** Runtime owns checkpoint/convergence bookkeeping; the evaluator only consumes data. */
export async function executeCheck(
	context: ExecutionContext,
	engine: NodeEngine,
	preparedReview?: unknown,
): Promise<unknown> {
	const key = context.stepKey ?? context.step.id;
	timingOperation(context.run, key, { kind: "execution" });
	await engine.save(context.run);
	try {
		return await executeCheckBody(context, engine, preparedReview);
	} finally {
		timingOperation(context.run, key);
		await engine.save(context.run);
	}
}
async function executeCheckBody(
	context: ExecutionContext,
	engine: NodeEngine,
	preparedReview?: unknown,
): Promise<unknown> {
	const { step, signal } = context;
	if (!step.check) throw new Error("Check configuration is missing");
	const issues = checkStepEvidenceIssues(step);
	if (issues.length) throw new Error(issues.join("; "));
	const config = resolveStepConfig(step);
	if (!config.checks.length) {
		return evaluateCheckAsync(
			step.check,
			(context as NodeContext).reads ??
				stepBindings(context, context.run.history, { checkJson: true }),
			{},
			conforms,
			signal,
		);
	}
	if (config.revision === "bound") {
		context.inspectionBinding = await outputRevisionBinding(
			context,
			undefined,
			true,
		);
		await assertBoundInspectionFresh(context);
	}
	const inputs = stepBindings(context, context.run.history, {
		checkJson: true,
	});
	const selectors = config.checks.filter(
		({ check, args }) =>
			(CHECK_SELECTOR_IDS as readonly string[]).includes(check) &&
			typeof args.path === "string",
	);
	if (selectors.length) await runEvidenceChecks(context, { inputs });
	const declared = new Set(config.checks.map((check) => check.check));
	const projected =
		preparedReview === undefined
			? declared.size
				? await (engine.hooks.evidence?.(context) ??
						new FactoryTools({ postComment: async () => {} }).evidence(context))
				: {}
			: { "review-evidence": preparedReview };
	const evidence = Object.fromEntries(
		Object.entries(projected).filter(([key]) => declared.has(key as never)),
	);
	for (const { check } of selectors) evidence[check] = { verified: true };

	context.checkEvidence = evidence;
	const ruleEvidence = { ...evidence };
	if (hasCheck(step, "review-boundary") && hasCheck(step, "review-evidence")) {
		const aggregate = evidence[
			"review-evidence"
		] as import("../../SpecialistReview.js").AggregateReview &
			Record<string, unknown>;
		ruleEvidence["review-evidence"] = {
			findings: aggregate.findings,
			rawFindings: aggregate.rawFindings,
			coverage: aggregate.coverage,
			reviewers: aggregate.reviewers.map((reviewer) => ({
				status: reviewer.status,
				blockers: reviewer.blockers,
			})),
			disagreements: aggregate.disagreements,
			reviewIncomplete: aggregate.reviewIncomplete ?? false,
			reviewBlocked: aggregate.reviewBlocked ?? false,
			questions: aggregate.questions ?? [],
		};
	}

	if (context.checkEvidence && Object.keys(context.checkEvidence).length)
		recordProgressEvidence(context, progressEvidence(context.checkEvidence));
	const output = await evaluateCheckAsync(
		step.check,
		inputs,
		ruleEvidence,
		conforms,
		signal,
	);
	if (
		hasCheck(step, "review-assistance") &&
		output.approved !== true &&
		!(Array.isArray(output.questions) && output.questions.length) &&
		context.run.history.some(
			(item) =>
				item.step === boundStepKey(context, "fix") &&
				readPath(item.output, "reviewAssessment.unchangedCode") === true,
		)
	) {
		const revision = await reviewedRunRevision(context.run, undefined, {
			requireClean: false,
		});
		const dirty = Boolean(
			(await executeCommand(context, "git", ["status", "--porcelain"])).trim(),
		);
		const questions = reviewRecoveryQuestions(context, output, {
			headSha: revision.headSha,
			dirty,
		});
		if (questions.length)
			Object.assign(output, { reviewBlocked: true, questions });
	}
	if (hasCheck(step, "post-fix-evidence")) {
		const observed = boundToolOutput(
			context,
			"observation",
			"inspect-review-readiness",
		);
		if (
			!observed ||
			importDigest(observed) !==
				importDigest(boundOutput(context, "observation"))
		)
			throw new Error(
				"Post-fix evidence requires the exact executed provider inspection in this workflow frame",
			);
		const questions: string[] = [];
		const seen = new Set<string>();
		for (const [name, kind] of [
			["revisionAssistance", "revision"],
			["failureAssistance", "failure"],
			["workAssistance", "work"],
		]) {
			const observations = output[name!];
			if (!Array.isArray(observations)) continue;
			for (const observation of observations) {
				const identity = importDigest(observation);
				if (seen.has(identity)) continue;
				seen.add(identity);
				const snapshot = readPath(
					observation,
					"readiness",
				) as import("../../MergeReadiness.js").MergeReadiness;
				const headSha = String(readPath(observation, "headSha"));
				const question =
					kind === "revision"
						? `The same revision mismatch remains after the CI fixer's synchronization attempt: The provider reports ${snapshot.headSha}, while the worktree is at ${headSha}. Restore synchronization between this PR and its branch, then reply to resume. Checks for the older revision remain insufficient; your answer does not approve or waive review and CI.`
						: kind === "failure"
							? `The CI fixer made no revision change and these same checks still fail: ${snapshot.checks
									.filter((check) => check.bucket === "fail")
									.map((check) => `${check.name}: ${check.link ?? check.state}`)
									.join(
										"; ",
									)}. Resolve the external blocker or provide a corrective direction before retrying. The failures remain blocking.`
							: `The CI fixer made no progress on the same actionable blockers: ${snapshot.blockers
									.filter((blocker) => blocker.action === "fix")
									.map((blocker) => blocker.message)
									.join(
										"; ",
									)}. Resolve the blocker or provide a corrective direction before retrying. Review and merge safeguards remain enforced.`;
				questions.push(
					typeof readPath(observation, "repositoryName") === "string"
						? `${readPath(observation, "repositoryName")}: ${question}`
						: question,
				);
			}
		}
		if (output.needsAssistance === true) {
			if (!questions.length)
				throw new Error(
					"Post-fix assistance requires declared matching observation results",
				);
			Object.assign(output, { questions });
		}
	}

	return output;
}

export const execute = (ctx: NodeContext) =>
	executeCheck(ctx, ctx.engine, ctx.preparedEvidence);
