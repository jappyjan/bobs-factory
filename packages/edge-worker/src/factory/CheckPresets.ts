import type { RuleCondition, RuleExpression } from "./Rules.js";
import { readStep } from "./StepConfig.js";
import type { WorkflowStep } from "./Workflow.js";

const equal = (path: string, equals: unknown): RuleCondition => ({
	path,
	equals,
});
const empty = (path: string): RuleCondition => ({ path, empty: true });
const exists = (path: string): RuleCondition => ({ path, exists: true });
const all = (...conditions: RuleCondition[]): RuleCondition => ({
	all: conditions,
});
const any = (...conditions: RuleCondition[]): RuleCondition => ({
	any: conditions,
});
const not = (condition: RuleCondition): RuleCondition => ({ not: condition });
const select = (path: string): RuleExpression => ({ select: path });
const review = "/evidence/review-evidence";
const qa = "/evidence/qa-gate-evidence";
const observed = "/inputs/observation";
const r = (path: string) => `${observed}/${path}`;
const same = (left: string, right: string): RuleCondition => ({
	path: left,
	equalsPath: right,
});

// These are authored stock rules, not runtime policies. Forks can rename/change them.
const substantiveFeedback = any(
	{
		some: r("feedback"),
		require: all(
			{ path: "/kind", in: ["threads", "reviews", "revision"] },
			any(not(exists("/action")), equal("/action", "fix")),
			any(not(equal("/fixReviewRequired", false)), equal("/currentFix", true)),
		),
	},
	all(
		{ some: r("feedback"), require: equal("/kind", "comments") },
		not(equal(r("fix/reviewRequired"), false)),
	),
);
const reviewRequired = any(
	substantiveFeedback,
	equal(r("fix/reviewRequired"), true),
	equal(r("reviewed"), null),
	equal(r("reviewed/dirty"), true),
	equal(r("dirty"), true),
	not(same(r("reviewed/headSha"), r("headSha"))),
	not(same(r("readiness/headSha"), r("headSha"))),
	equal(r("previousBase"), null),
	not(same(r("previousBase"), r("readiness/baseSha"))),
	not(equal(r("reviewApproved"), true)),
	equal(r("scopeChanged"), true),
);

function observationRule(condition: RuleCondition): RuleCondition {
	const relative = (value: unknown): unknown =>
		typeof value === "string"
			? value.startsWith(`${observed}/`)
				? value.slice(observed.length)
				: value
			: Array.isArray(value)
				? value.map(relative)
				: value && typeof value === "object"
					? Object.fromEntries(
							Object.entries(value).map(([key, item]) => [key, relative(item)]),
						)
					: value;
	return relative(condition) as RuleCondition;
}

/** Convert only newly authored stock graphs. Accepted/saved definitions stay untouched. */
export function installStockChecks(steps: WorkflowStep[]): void {
	for (const step of [...steps]) {
		for (const group of step.groups ?? []) installStockChecks(group);
		const oldTool = step.tool;
		if (
			![
				"review-gate",
				"visual-gate",
				"delivery-mode",
				"delivery-route",
				"review-after-fix",
			].includes(oldTool ?? "")
		)
			continue;
		if (oldTool === "delivery-route") {
			const accepted: WorkflowStep = {
				...structuredClone(step),
				id: `${step.id}-accept`,
				name: "Accept reviewed delivery contract",
				tool: "accept-delivery",
				branches: [],
				next: step.id,
			};
			for (const other of steps) {
				if (other === step) continue;
				if (other.next === step.id) other.next = accepted.id;
				for (const branch of other.branches)
					if (branch.next === step.id) branch.next = accepted.id;
			}
			steps.splice(steps.indexOf(step), 0, accepted);
			step.reads = { ...step.reads, accepted: accepted.id };
			step.check = {
				results: {
					deferred: equal("/inputs/accepted/deferred", true),
					mode: select("/inputs/accepted/mode"),
				},
				passed: { path: "/results/deferred", equals: false },
			};
		} else if (oldTool === "delivery-mode") {
			step.checks = [...(step.checks ?? []), "delivery-evidence"];
			step.check = {
				results: {
					mode: select("/evidence/delivery-evidence/mode"),
					repositoryComplete: equal(
						"/evidence/delivery-evidence/repositoryComplete",
						true,
					),
				},
				passed: exists("/evidence/delivery-evidence/mode"),
			};
		} else if (oldTool === "review-after-fix") {
			const observedStep: WorkflowStep = {
				...structuredClone(step),
				id: `${step.id}-observe`,
				name: "Inspect current review and provider evidence",
				tool: "inspect-review-readiness",
				branches: [],
				next: step.id,
			};
			for (const other of steps) {
				if (other === step) continue;
				if (other.next === step.id) other.next = observedStep.id;
				for (const branch of other.branches)
					if (branch.next === step.id) branch.next = observedStep.id;
			}
			steps.splice(steps.indexOf(step), 0, observedStep);
			step.reads = {
				...step.reads,
				observation: observedStep.id,
				observations: `${observedStep.id}/observations`,
			};
			step.checks = [...(step.checks ?? []), "post-fix-evidence"];
			step.check = {
				results: {
					reviewRequired,
					headSha: select(r("headSha")),
					baseSha: select(r("readiness/baseSha")),
					baseChanged: not(same(r("previousBase"), r("readiness/baseSha"))),
					unchangedRevision: all(
						equal(r("dirty"), false),
						not(same(r("readiness/headSha"), r("headSha"))),
						same(r("previous/worktreeHeadSha"), r("headSha")),
						same(r("previous/headSha"), r("readiness/headSha")),
						same(r("previous/baseSha"), r("readiness/baseSha")),
					),
					unchangedFailures: all(
						not(reviewRequired),
						same(r("previous/headSha"), r("headSha")),
						not(empty(r("failures"))),
						same(r("previousFailures"), r("failures")),
					),
					unchangedWork: all(
						equal(r("dirty"), false),
						same(r("previous/headSha"), r("headSha")),
						same(r("previous/baseSha"), r("readiness/baseSha")),
						not(equal(r("fingerprint"), null)),
						same(r("fingerprint"), r("previousFingerprint")),
						any(not(reviewRequired), equal(r("repeated"), true)),
					),
				},
				passed: not(equal("/results/reviewRequired", true)),
			};
			const { unchangedRevision, unchangedFailures, unchangedWork } =
				step.check.results;
			for (const [name, condition] of Object.entries({
				revisionAssistance: unchangedRevision,
				failureAssistance: unchangedFailures,
				workAssistance: unchangedWork,
			}))
				step.check.results[name] = {
					aggregate: "filter",
					path: "/inputs/observations",
					where: observationRule(condition as RuleCondition),
				};
			const assistanceRule = any(
				unchangedRevision as RuleCondition,
				unchangedFailures as RuleCondition,
				unchangedWork as RuleCondition,
			);
			for (const name of [
				"reviewRequired",
				"baseChanged",
				"unchangedRevision",
				"unchangedFailures",
				"unchangedWork",
			])
				step.check.results[name] = {
					some: "/inputs/observations",
					require: observationRule(step.check.results[name] as RuleCondition),
				};
			step.check.results.needsAssistance = {
				some: "/inputs/observations",
				require: observationRule(assistanceRule),
			};
			step.check.results.assistanceObservations = {
				aggregate: "filter",
				path: "/inputs/observations",
				where: observationRule(assistanceRule),
			};

			const fixer = readStep(step, "fix");
			if (fixer)
				step.branches.unshift({
					when: { path: "needsAssistance", equals: true },
					next: fixer,
				});
		} else {
			const visual = oldTool === "visual-gate";
			step.checks = [
				...(step.checks ?? []),
				"review-evidence",
				"review-assistance",
				...(visual ? ["qa-gate-evidence" as const] : []),
			];
			const approved = visual
				? all(
						exists(qa),
						equal(`${review}/incomplete`, false),
						empty(`${qa}/findings`),
						empty(`${qa}/evidenceErrors`),
						empty(`${qa}/evidenceBlocked`),
					)
				: all(
						{
							count: `${review}/findings`,
							where: all(equal("/status", "open"), { path: "/rating", min: 2 }),
							max: 0,
						},
						empty(`${review}/disagreements`),
						any(
							all(
								exists(`${review}/reviewers`),
								{
									each: `${review}/reviewers`,
									require: all(
										equal("/status", "completed"),
										empty("/blockers"),
									),
								},
								{
									count: `${review}/coverage`,
									where: equal("/status", "not_met"),
									max: 0,
								},
							),
							all(
								not(exists(`${review}/reviewers`)),
								equal(`${review}/status`, "completed"),
								empty(`${review}/blockers`),
							),
						),
					);
			const results: Record<string, RuleExpression> = {
				approved,
				findings: visual
					? select(`${qa}/findings`)
					: {
							aggregate: "filter",
							path: `${review}/findings`,
							where: all(equal("/status", "open"), { path: "/rating", min: 2 }),
						},
				reviewIncomplete: visual
					? all(equal(`${review}/incomplete`, true), empty(`${qa}/findings`))
					: equal(`${review}/reviewIncomplete`, true),
				reviewBlocked: equal(`${review}/reviewBlocked`, true),
				questions: select(`${review}/questions`),
			};
			for (const key of visual
				? [
						"qaContract",
						"observations",
						"headSha",
						"scopeHash",
						"captureHash",
						"reviewHash",
						"evidenceIssues",
						"qaRetry",
						"qaBlocked",
						"captureBlocked",
					]
				: ["rawFindings", "coverage", "reviewers", "disagreements"])
				results[key] = select(`${visual ? qa : review}/${key}`);
			step.check = { results, passed: equal("/results/approved", true) };
			const fix = step.branches.find(
				(b) => b.when.path === "approved" && b.when.equals === false,
			)?.next;
			const source = readStep(step, "review");
			const capture = readStep(step, "capture");
			const impact = readStep(step, "impact");
			const incompleteTarget = impact ?? source;
			const recovery: WorkflowStep["branches"] = [];
			// Match legacy checkpoint ordering: a direct reviewer retry precedes QA;
			// impact-aware QA retries capture before reassessing an incomplete review.
			if (incompleteTarget && (!visual || !impact))
				recovery.push({
					when: { path: "reviewIncomplete", equals: true },
					next: incompleteTarget,
				});
			if (capture && visual)
				recovery.push(
					...["qaRetry", "qaBlocked", "captureBlocked"].map((path) => ({
						when: { path, equals: true },
						next: capture,
					})),
				);
			if (incompleteTarget && visual && impact)
				recovery.push({
					when: { path: "reviewIncomplete", equals: true },
					next: incompleteTarget,
				});
			if (fix)
				recovery.push({
					when: { path: "reviewBlocked", equals: true },
					next: fix,
				});
			step.branches.unshift(...recovery);
		}

		step.type = "check";
		// Author independent JSON nodes, as a saved recipe would (no shared JS aliases).
		step.check = JSON.parse(JSON.stringify(step.check));
		delete step.tool;
		delete step.args;
		delete step.arguments;
		delete step.computeIntensive;
		step.name =
			oldTool === "review-gate"
				? "Check review findings"
				: oldTool === "visual-gate"
					? "Check QA and screenshots"
					: step.name;
	}
}
