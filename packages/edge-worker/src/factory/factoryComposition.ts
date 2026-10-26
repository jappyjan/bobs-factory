/* biome-ignore-all lint/suspicious/noThenProperty: Declarative JSON branches. */
/** Recipe policy lives here; every block is an ordinary, collapsible workflow Call. */
const outcome = (value: string, next: string) => ({
	when: { path: "outcome", equals: value },
	next,
});
const call = (
	id: string,
	name: string,
	workflow: string,
	bindings: Record<string, string>,
	next: string,
	branches: ReturnType<typeof outcome>[] = [],
) => ({
	id,
	name,
	type: "workflow",
	workflow,
	bindings,
	inputFreshness: "on-read",
	// Call envelopes are data; child producers retain their own evidence stamps.
	revisionScope: "none",
	maxVisits: 16,
	next,
	branches,
});
const shared = { requirements: "requirements", plan: "plan" };
const readPr = (id: string, next: string) => ({
	id,
	name: "Read latest request",
	type: "pr",
	op: "read",
	reads: { pr: "implementation/pr" },
	next,
});
function composition(takeover: boolean) {
	return [
		...(takeover
			? [
					call(
						"intake",
						"Assess existing work",
						"v2-takeover-intake",
						{},
						"requirements",
					),
				]
			: []),
		call(
			"planning",
			"Clarify & plan",
			"v2-clarify-plan",
			{
				requirements: "requirements",
				architecture: "check-in/result",
			},
			"requirements",
		),
		...(["requirements", "plan"] as const).map((port) => ({
			id: port,
			name: `Current ${port}`,
			type: "transform",
			revisionScope: "none",
			reads: {
				planned:
					port === "requirements"
						? "planning/outputs/decisions"
						: "planning/outputs/plan",
				...(takeover ? { existing: `intake/outputs/result/${port}` } : {}),
			},
			// These transforms are producers, not copied approval/merge authority.
			transform: {
				...(port === "requirements"
					? Object.fromEntries(
							["summary", "requirements", "decisions", "outOfScope"].map(
								(key) => [
									key,
									{
										if: { path: "/inputs/planned", exists: true },
										then: { select: `/inputs/planned/${key}` },
										else: { select: `/inputs/existing/${key}` },
									},
								],
							),
						)
					: Object.fromEntries(
							["summary", "deliveryMode", "steps", "risks", "repositories"].map(
								(key) => [
									key,
									{
										if: { path: "/inputs/planned", exists: true },
										then: { select: `/inputs/planned/${key}` },
										else: { select: `/inputs/existing/${key}` },
									},
								],
							),
						)),
			},
			next: port === "requirements" ? "plan" : "delivery",
		})),
		{
			id: "delivery",
			name: "Route by delivery mode",
			type: "check",
			revisionScope: "none",
			reads: { plan: "plan" },
			check: {
				results: { mode: { select: "/inputs/plan/deliveryMode" } },
				passed: {
					path: "/results/mode",
					in: ["repository", "external", "mixed", "deferred"],
				},
			},
			branches: [
				{ when: { path: "mode", equals: "repository" }, next: "check-in" },
				{ when: { path: "mode", equals: "mixed" }, next: "check-in" },
				{ when: { path: "mode", equals: "external" }, next: "external" },
			],
			next: "deferred",
		},
		call(
			"check-in",
			"Check in with you",
			"v2-check-in",
			shared,
			"implementation",
			[outcome("revise-plan", "planning")],
		),
		call(
			"implementation",
			"Implement",
			"v2-implementation",
			{ ...shared, architecture: "check-in/result" },
			"review-pr",
			[outcome("to-architecture", "check-in")],
		),
		readPr("review-pr", "review"),
		call(
			"review",
			"Review loop",
			"v2-review-loop",
			{ ...shared, pr: "review-pr" },
			"ci-pr",
			[outcome("to-architecture", "check-in"), outcome("to-ci", "ci-pr")],
		),
		readPr("ci-pr", "ci"),
		call(
			"ci",
			"CI watch & fix",
			"v2-ci",
			{ requirements: "requirements", pr: "ci-pr", review: "review/review" },
			"qa-pr",
			[outcome("to-review", "review-pr")],
		),
		readPr("qa-pr", "qa"),
		call(
			"qa",
			"QA & screenshots",
			"v2-qa",
			{ ...shared, pr: "qa-pr" },
			"approval-pr",
			[outcome("to-review", "review-pr")],
		),
		readPr("approval-pr", "approval"),
		call(
			"approval",
			"Review guide & your approval",
			"v2-approval",
			{ ...shared, review: "review/review", qa: "qa/qa", pr: "approval-pr" },
			"authorization",
			[outcome("to-review", "review-pr"), outcome("to-ci", "ci-pr")],
		),
		{
			id: "authorization",
			name: "Select authorization receipt",
			type: "check",
			revisionScope: "none",
			reads: { approval: "approval/outputs/approval" },
			check: {
				results: {
					carried: {
						path: "/inputs/approval/authorization",
						equals: "carried",
					},
				},
			},
			branches: [
				{ when: { path: "carried", equals: true }, next: "merge-carried" },
			],
			next: "merge-explicit",
		},
		{
			id: "completion",
			name: "Ticket completion policy",
			type: "transform",
			revisionScope: "none",
			reads: { plan: "plan" },
			transform: {
				final: { not: { path: "/inputs/plan/deliveryMode", equals: "mixed" } },
			},
			next: "authorization",
		},
		...(["explicit", "carried"] as const).map((kind) =>
			call(
				`merge-${kind}`,
				"Merge approved revision",
				"v2-merge",
				{
					approval: `approval/${kind}`,
					pr: "approval/published",
					completion: "completion",
				},
				`after-merge-${kind}`,
				[outcome("to-review", "review-pr"), outcome("to-ci", "ci-pr")],
			),
		),
		...(["explicit", "carried"] as const).flatMap((kind) => [
			{
				id: `after-merge-${kind}`,
				name: "Deliver remaining external work?",
				type: "check",
				revisionScope: "none",
				reads: { plan: "plan" },
				check: {
					results: {
						mixed: { path: "/inputs/plan/deliveryMode", equals: "mixed" },
					},
				},
				branches: [
					{ when: { path: "mixed", equals: true }, next: `external-${kind}` },
				],
				next: "end",
			},
			call(
				`external-${kind}`,
				"External delivery after merge",
				"v2-external",
				{
					...shared,
					approval: `approval/${kind}`,
					merge: `merge-${kind}/merge`,
				},
				"end",
				[outcome("revise-plan", "planning")],
			),
		]),
		call("external", "External delivery", "v2-external", shared, "end", [
			outcome("revise-plan", "planning"),
		]),
		call("deferred", "Explain deferred work", "v2-deferred", shared, "end"),
	].map((step) =>
		step.id === "approval" ? { ...step, next: "completion" } : step,
	);
}
export const factoryComposition = composition(false);
export const takeoverComposition = composition(true);
