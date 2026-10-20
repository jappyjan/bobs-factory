// bun apps/f1/test-drives/assets/workflow-stall-production-replay.ts <private-clone>
// The private clone contains production snapshots, referenced chunks and read-only
// provider receipts. Never commit that directory or print its source payloads.
import "../../../../packages/edge-worker/src/factory/defaultWorkflows.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonSnapshotStore } from "../../../../packages/core/src/JsonSnapshotStore.js";
import { FactoryTools } from "../../../../packages/edge-worker/src/factory/FactoryTools.js";
import { inspectGithubReadiness } from "../../../../packages/edge-worker/src/factory/GithubReadiness.js";
import {
	factoryReviewFixContext,
	recordReviewFix,
	validateReviewFix,
} from "../../../../packages/edge-worker/src/factory/ReviewRecovery.js";
import {
	aggregateForContext,
	aggregateReview,
	latestAggregate,
} from "../../../../packages/edge-worker/src/factory/SpecialistReview.js";
import {
	stepVisitLimit,
	upgradeStockStepVisits,
} from "../../../../packages/edge-worker/src/factory/StepVisitBudget.js";
import type {
	ExecutionContext,
	FactoryRun,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.js";

const home = process.argv[2];
assert(
	home,
	"Pass an isolated production-data clone; never the live factory home",
);
assert(!home.includes("/.bobs-factory"), "Refuse a live factory home");
const cases = JSON.parse(readFileSync(join(home, "replay-cases.json"), "utf8"));
const store = new JsonSnapshotStore(join(home, "factory", "run-chunks"));
const sha = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");
const load = (id: string) =>
	store.load<FactoryRun>(join(home, "factory", "runs", `${id}.json`)).value;
const manifestHashes = () =>
	Object.fromEntries(
		Object.values(cases).map((id) => [
			id,
			sha(readFileSync(join(home, "factory", "runs", `${id}.json`))),
		]),
	);
const before = manifestHashes();
const run = load(cases.incomplete);
const step = [run.workflow, ...(run.workflowDefinitions ?? [])]
	.flatMap((workflow) => workflow.steps)
	.find((candidate) => candidate.id === "code-fix");
assert(step, "The saved workflow must retain its configured correction role");
const context: ExecutionContext = {
	run,
	step,
	stepKey: run.step,
	input: {},
	signal: new AbortController().signal,
	log: () => {},
	evidenceDir: join(home, "unused-evidence"),
};
const strictError =
	/Latest configured specialist round has no complete aggregate/;
assert.throws(() => aggregateForContext(context), strictError);
const baseline = run.reviewRounds!.at(-1)!;
const expected = aggregateReview(
	baseline,
	run.outputs[baseline.key.split("/").at(-1)!] as Record<string, unknown>[],
	latestAggregate(run, baseline.key),
);
assert.equal(expected.approved, false);
const correction = factoryReviewFixContext(context);
assert.deepEqual(
	correction.findings.map((finding) => finding.id).sort(),
	expected.findings.map((finding) => finding.id).sort(),
);
assert(correction.findings.length > 0);
assert.equal(correction.review?.status, "incomplete");
assert(correction.review!.blockers.length > 0);
assert.throws(
	() => validateReviewFix(context, { dispositions: [], questions: [] }),
	/Disposition every unresolved finding/,
);
const output = {
	summary:
		"Scripted replay checks correction delivery; no source fix is claimed",
	dispositions: correction.findings.map((finding) => ({ id: finding.id })),
	questions: [],
};
validateReviewFix(context, output);
const recorded = recordReviewFix(context, output, {
	headSha: baseline.headSha,
	dirty: false,
	historyLength: run.history.length,
	at: run.updatedAt,
});
assert.equal(recorded.reviewAssessment.unchangedCode, true);
assert.throws(() => aggregateForContext(context), strictError);

const duplicateRun = load(cases.duplicate);
const duplicateBaseline = duplicateRun.reviewRounds!.at(-1)!;
const duplicate = aggregateReview(
	duplicateBaseline,
	duplicateRun.outputs[duplicateBaseline.key.split("/").at(-1)!] as Record<
		string,
		unknown
	>[],
	latestAggregate(duplicateRun, duplicateBaseline.key),
);
const claims = duplicate.rawFindings.filter((finding) => finding.duplicateOf);
assert(
	claims.length > 0,
	"Production must contain the rejected duplicate claim",
);
assert.equal(duplicate.approved, false);
for (const claim of claims) {
	assert(duplicate.findings.some((finding) => finding.id === claim.id));
	assert.equal(
		duplicate.findings.find((finding) => finding.id === claim.id)?.duplicateOf,
		undefined,
	);
}

const capture = JSON.parse(
	readFileSync(join(home, "provider-receipts.json"), "utf8"),
);
const pr = capture.records[0].response.data.repository.pullRequest;
let requestIndex = 0;
const readiness = await inspectGithubReadiness(async (exe, args) => {
	assert.equal(exe, "bobs-factory:github-api");
	const request = JSON.parse(args[0]!);
	const retained = capture.records[requestIndex++];
	assert(retained, "Unrecorded provider operation is forbidden");
	assert.equal(request.method, retained.request.method);
	assert.equal(request.path, retained.request.path);
	assert.deepEqual(request.body?.variables, retained.request.body?.variables);
	return JSON.stringify(retained.response);
}, pr.url);
assert.equal(requestIndex, capture.records.length);
const targetRun = load(cases.target);
const targetBaseline = targetRun.reviewRounds!.at(-1)!;
assert.notEqual(pr.baseRefOid, pr.baseRef.target.oid);
assert.equal(readiness.baseSha, pr.baseRef.target.oid);
assert.equal(readiness.headSha, targetBaseline.headSha);
assert.equal(readiness.baseSha, targetBaseline.baseSha);
const repository = join(home, "repository");
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
assert(lstatSync(join(repository, ".git")).isDirectory());
assert(!lstatSync(join(repository, ".git")).isSymbolicLink());
assert(!existsSync(join(repository, ".git", "objects", "info", "alternates")));
assert.equal(
	git("remote"),
	"",
	"The cloned repository must have no live remotes",
);
const target = "refs/remotes/origin/main";
// Demonstrate the exact old update-ref regression only inside the copied Git store.
git("update-ref", target, pr.baseRefOid);
assert.notEqual(git("rev-parse", target), targetBaseline.baseSha);
git("update-ref", target, readiness.baseSha);
assert.equal(git("rev-parse", target), targetBaseline.baseSha);
git("update-ref", target, readiness.baseSha);
assert.equal(git("rev-parse", target), targetBaseline.baseSha);
// Exercise the actual CI tool against the retained run and provider data. Every
// command is bound to this independent clone or the recorded read-only response.
targetRun.workspace = repository;
for (const scoped of targetRun.repositories ?? [])
	scoped.workspace = repository;
let ciRequestIndex = 0;
const tools = new FactoryTools({
	command: async (_context, executable, args) => {
		if (executable === "git") {
			assert.equal(
				args[0],
				"rev-parse",
				"Fixed CI must not fetch or regress the target ref",
			);
			return git(...args);
		}
		assert.equal(executable, "bobs-factory:github-api");
		const request = JSON.parse(args[0]!);
		const retained = capture.records[ciRequestIndex++];
		assert(retained, "Unrecorded CI provider operation is forbidden");
		assert.equal(request.method, retained.request.method);
		assert.equal(request.path, retained.request.path);
		return JSON.stringify(retained.response);
	},
});
const ci = (await tools.tool({
	...context,
	run: targetRun,
	stepKey: "pipeline/ci",
	step: {
		id: "ci",
		name: "CI",
		type: "tool",
		tool: "ci",
		impactSource: "assess-impact",
		branches: [],
		maxVisits: 200,
	},
})) as { baseSha: string };
assert.equal(ci.baseSha, targetBaseline.baseSha);
assert.equal(ciRequestIndex, capture.records.length);
assert.equal(git("rev-parse", target), targetBaseline.baseSha);
const upgradedStockSteps: number[] = [];
for (const id of Object.values(cases) as string[]) {
	const saved = load(id);
	const accepted = sha(
		JSON.stringify({
			workflow: saved.workflow,
			definitions: saved.workflowDefinitions,
			checkpoint: saved.checkpoint,
		}),
	);
	assert.equal(upgradeStockStepVisits(saved), true);
	assert.equal(saved.stepVisitBudget!.additionalVisits["pipeline/clarify"], 8);
	assert.equal(
		saved.stepVisitBudget!.additionalVisits["pipeline/review-gate"],
		100,
	);
	const clarify = saved
		.workflowDefinitions!.find(
			(workflow) => workflow.id === "factory-pipeline",
		)!
		.steps.find((candidate) => candidate.id === "clarify")!;
	assert.equal(stepVisitLimit(saved, "pipeline/clarify", clarify), 16);
	assert.equal(
		sha(
			JSON.stringify({
				workflow: saved.workflow,
				definitions: saved.workflowDefinitions,
				checkpoint: saved.checkpoint,
			}),
		),
		accepted,
	);
	const receipt = JSON.stringify(saved.stepVisitBudget);
	assert.equal(upgradeStockStepVisits(saved), false);
	assert.equal(JSON.stringify(saved.stepVisitBudget), receipt);
	upgradedStockSteps.push(
		Object.keys(saved.stepVisitBudget!.additionalVisits).length,
	);
}
assert.deepEqual(manifestHashes(), before, "Replay must not mutate saved runs");

const sourceHashes = Object.fromEntries(
	[
		"GithubReadiness.ts",
		"MergeReadiness.ts",
		"ReviewRecovery.ts",
		"SpecialistReview.ts",
		"FactoryTools.ts",
		"StepVisitBudget.ts",
		"WorkflowRuntime.ts",
	].map((file) => [
		file,
		sha(
			readFileSync(
				fileURLToPath(
					new URL(
						`../../../../packages/edge-worker/src/factory/${file}`,
						import.meta.url,
					),
				),
			),
		),
	]),
);
const result = {
	mode: "private production snapshot and recorded provider replay",
	assertions: {
		incompleteRoundCorrectionReceivesEveryConsequentialFinding: true,
		missingDispositionsRemainBlocked: true,
		incompleteRoundApprovalRemainsBlocked: true,
		unprovenDuplicateRemainsActionable: true,
		providerUsesActualTargetRef: true,
		productionCiToolDoesNotRegressTheClonedTarget: true,
		clonedGitRefAndSavedBaselineAgree: true,
		repeatedInspectionDoesNotRegressTarget: true,
		existingProductionStockBudgetsDoubleOnceWithoutGraphChanges: true,
		savedProductionSnapshotsUnchanged: true,
	},
	counts: {
		correctionFindings: correction.findings.length,
		duplicateClaimsRetained: claims.length,
		providerRequestsReplayed: requestIndex,
		upgradedStockSteps,
	},
	sourceHashes,
};
writeFileSync(
	join(home, "replay-green.json"),
	JSON.stringify(result, null, 2),
	{
		mode: 0o600,
	},
);
console.log(JSON.stringify(result, null, 2));
