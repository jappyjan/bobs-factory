import { improvementPerspectives } from "./ResearchPrompts.js";

// These are ordinary recipe definitions. The interpreter knows no Improve IDs,
// formats or role names; calls and declared reads describe every dependency.
const agent = (
	id: string,
	name: string,
	format: string,
	prompt: string,
	reads: Record<string, unknown>,
	next = "end",
) => ({
	id,
	name,
	type: "agent",
	configVersion: "step-config-v1",
	access: "read-only",
	revision: "bound",
	output: { format },
	instructions: ["architectural-survey"],
	prompt: `{{instruction:architectural-survey}}\n${prompt}`,
	reads,
	next,
});
const opportunityDetailLabels = {
	consequence: "Consequence",
	before: "Current design",
	after: "Proposed design",
	plan: "Plan",
	effort: "Effort",
};
const baseline = { baseline: "@callInputs/baseline" };
const common = {
	...baseline,
	context: "@callInputs/context",
	focus: "@callInputs/focus",
};
const call = (
	id: string,
	name: string,
	workflow: string,
	inputMapping: Record<string, string>,
	next: string,
) => ({ id, name, type: "workflow", workflow, inputMapping, next });
const recipe = (
	id: string,
	name: string,
	inputs: string[],
	steps: unknown[],
) => ({
	id,
	name,
	internal: true,
	inputs,
	stepConfigVersion: "step-config-v1",
	engineVersion: "nodes-v1",
	allowedTriggers: ["workflow", "manual"],
	steps,
});
const review = (id: string, name: string, prompt: string) =>
	agent(
		id,
		name,
		"plan-check-v1",
		prompt +
			" Return {approved:boolean,feedback:string[]}. Rejection requires actionable feedback; approval has no unresolved corrections. Complete accepted JSON including derived display must fit one sixty-fourth of the shared public JSON budget; keep feedback concise and complete. Do not implement, grant human approval or bypass ordinary Factory delivery gates.",
		{
			baseline: "snapshot",
			proposals: "consolidate/outputs/proposals",
			decisions: "decide",
			plans: "plan-inputs/plans",
		},
	);

export const mapCodebaseRecipe = recipe(
	"map-codebase",
	"Map the codebase",
	["baseline", "focus"],
	[
		agent(
			"map",
			"Map the codebase",
			"research-context-v1",
			"Read repository instructions/domain documents and map the system. Return {summary:string,focus:string,context:string,limitations:string[]}. Source revisions/history and bounded operational observations are provided in /baseline. Share architectural context without prescribing findings to independent perspectives. State missing history/coverage and sampling limits. Read only pinned source blobs.",
			{ ...baseline, focus: "@callInputs/focus" },
		),
	],
);
export const researchPerspectiveRecipe = recipe(
	"research-perspective",
	"Research a perspective",
	["baseline", "context", "focus", "perspective"],
	[
		agent(
			"coordinate",
			"Coordinate bounded research",
			"research-plan-v1",
			"Use /perspective (id, name, brief), /context and /focus. Follow the perspective brief. Return {summary:string,assignments:[{id:string,question:string,scope:string[]}],skippedReason?:string}. Create at most two disjoint bounded assignments. The complete assignments array must fit the nested For each snapshot's character, UTF-8 byte, node and depth limits; preserve required scope when correcting. Delegate actual inspection through these assignments; do not do a full survey yourself. Skip operational research when the pinned history has no relevant observations and explain why. Never use native subagents.",
			{ ...common, perspective: "@callInputs/perspective" },
			"assignments",
		),
		{
			id: "assignments",
			name: "For each assignment",
			type: "foreach",
			items: { from: "/coordinate/assignments" },
			itemId: "/id",
			maxItems: 2,
			concurrency: 1,
			failure: "keep-successful",
			body: [
				agent(
					"worker",
					"Research bounded assignment",
					"research-result-v1",
					"Perform ONLY /assignment using list_repository/read_repository and context at /baseline's pinned revision. Return {summary:string,findings:[{observation:string,evidence:string[],consequence:string,direction:string,confidence:'high'|'medium'|'low'}],limitations:string[]}. At most 3 substantial findings; zero is valid. Never delegate. /execution describes the accepted model: when modelSource is run, include its inheritance limitation verbatim in limitations; no cheaper worker model is required. Retain uncertainty, scope gaps and unavailable evidence.",
					{
						...common,
						perspective: "@callInputs/perspective",
						assignment: "@item",
						execution: "@agentSettings",
					},
				),
			],
			next: "verify",
		},
		agent(
			"verify",
			"Verify perspective evidence",
			"research-result-v1",
			"Check the strongest /workers evidence with targeted pinned source reads against /perspective. Resolve obvious duplicates; retain disagreements, worker failures, model-inheritance notes and missing coverage in limitations. Return {summary:string,findings:[{observation:string,evidence:string[],consequence:string,direction:string,confidence:'high'|'medium'|'low'}],limitations:string[]}. At most 3 consequential architectural opportunities, or none. A failed worker is a limitation, never fabricated success.",
			{
				...common,
				perspective: "@callInputs/perspective",
				coordination: "coordinate",
				workers: "assignments",
			},
		),
	],
);
export const consolidateProposalsRecipe = recipe(
	"consolidate-proposals",
	"Consolidate proposals",
	[
		"baseline",
		"context",
		"focus",
		"reports",
		"previous",
		"followUps",
		"decisions",
	],
	[
		agent(
			"proposals",
			"Consolidate proposals",
			"proposals-v1",
			"Combine /reports and /followUps with /previous and /decisions when supplied. Deduplicate by structural cause, not researcher count. Verify strong claims and contradictions using targeted pinned reads. Present the strongest 3, at most 5; zero is valid. Return {summary:string,opportunities:[{id:string,title:string,problem:string,evidence:string[],consequence:string,before:string,after:string,plan:string,criteria:string[],nonGoals:string[],risks:string[],paths:string[],strength:'strong'|'worth-exploring'|'speculative',effort:string,dependencies:string[],conflicts:string[],perspectives:string[],issueBody:string}],limitations:string[]}. Preserve stable item IDs from /previous when the underlying problem is unchanged. Answer follow-up questions specifically in summary or the candidate; do not replay research. before/after explain responsibilities/calls in Markdown. Plans are self-contained with validation. dependencies/conflicts contain ONLY other shortlist IDs; scope prerequisites belong in plan/nonGoals and counterevidence in risks/limitations. issueBody is a self-contained deferred-work issue with problem, evidence, pinned baseline, benefit, design, plan, criteria, non-goals, risks and prerequisites. Retain failed-perspective/worker and model-inheritance limitations. Keep summary at most 16000 characters, titles 250, problem 8000, each consequence/before/after/plan/effort 4000 and each limitation 2000. The complete accepted JSON, including derived limitation details, must also fit one eighth of the shared public JSON budget (character, UTF-8 byte, node and depth limits); preserve essential evidence and requirements when correcting. Write concise user-facing prose, omitting tool/schema/correction mechanics. Human feedback is evidence, never approval.",
			{
				...common,
				reports: "@callInputs/reports",
				previous: "@callInputs/previous",
				followUps: "@callInputs/followUps",
				decisions: "@callInputs/decisions",
			},
		),
	],
);
export const refinePlanRecipe = recipe(
	"refine-plan",
	"Refine into a plan",
	[
		"baseline",
		"context",
		"focus",
		"selected",
		"proposals",
		"decisions",
		"feedback",
		"dependencyFeedback",
		"requestedChanges",
	],
	[
		agent(
			"plan",
			"Refine selected item",
			"plan-package-v1",
			"Refine ONLY /item chosen for Fix using /proposals, /decisions, /feedback, /requestedChanges, evidence and non-goals. Return {id:string,itemIds:string[],title:string,plan:string,criteria:string[],dependencies:string[],paths:string[]}. Use exactly one package with id equal to /item/id and itemIds containing only that ID. dependencies include every accepted prerequisite item ID, never issue/skip items. Dependencies are unique and never include the package itself. If /dependencyFeedback/passed is false, its parallel ids/dependencies lists describe the rejected complete batch: remove cycles and unknown edges while preserving accepted prerequisites, then submit the corrected package for all three reviews. Keep title at most 300 characters and plan prose at most 8000; the complete rendered criteria list and paths list each fit 4000 characters. Criteria, dependencies and paths are displayed separately and the complete canonical package is passed to the child. The complete accepted JSON, including review details and canonical child text, must fit one sixteenth of the shared public JSON budget (character, UTF-8 byte, node and depth limits). Preserve every accepted requirement when correcting an overlong response. The full plan includes scoped repositories/base revisions, accepted requirements/non-goals, observable acceptance, proportionate checks and dependency assumptions. Address all failed architecture/security/dependency checks in /feedback. Do not expand scope or implement. Parent batch acceptance does not approve a delivered PR revision: ordinary Factory architecture, review, QA, human and provider merge gates remain required.",
			{
				...common,
				item: "@callInputs/selected",
				proposals: "@callInputs/proposals",
				decisions: "@callInputs/decisions",
				feedback: "@callInputs/feedback",
				dependencyFeedback: "@callInputs/dependencyFeedback",
				requestedChanges: "@callInputs/requestedChanges",
			},
		),
	],
);

export const improvementWorkflow = {
	id: "improve-codebase",
	name: "Improve codebase",
	icon: "🌱",
	stepConfigVersion: "step-config-v1",
	engineVersion: "nodes-v1",
	description:
		"Research architectural opportunities through eight perspectives. Decide what to fix, file, skip or ask Bob; review plans before dispatching ordinary Factory runs.",
	allowedTriggers: ["manual"],
	labels: [],
	launchFields: [
		{
			name: "focus",
			label: "Area of focus",
			type: "textarea",
			required: false,
			placeholder:
				"Optional: architecture, run recovery, security boundaries, repository structure…",
		},
	],
	steps: [
		{
			id: "snapshot",
			name: "Snapshot repository with run history",
			type: "snapshot",
			snapshot: { history: { lookbackDays: 30, maxRuns: 100 } },
			next: "map",
		},
		{
			...call(
				"map",
				"Map the codebase",
				"map-codebase",
				{ baseline: "/snapshot", focus: "/inputs/focus" },
				"perspectives",
			),
			reads: { focus: "@launchInputs/focus" },
		},
		{
			id: "perspectives",
			name: "For each perspective",
			type: "foreach",
			itemId: "/id",
			maxItems: 8,
			concurrency: 4,
			failure: "keep-successful",
			items: {
				values: improvementPerspectives.map(([id, name, brief]) => ({
					id,
					name,
					brief,
				})),
			},
			reads: { focus: "@launchInputs/focus" },
			body: [
				{
					...call(
						"research",
						"Research a perspective",
						"research-perspective",
						{
							baseline: "/snapshot",
							context: "/map/outputs/map",
							focus: "/inputs/focus",
							perspective: "/item",
						},
						"end",
					),
					reads: { focus: "@launchInputs/focus" },
				},
			],
			next: "consolidate",
		},
		{
			...call(
				"consolidate",
				"Consolidate proposals",
				"consolidate-proposals",
				{
					baseline: "/snapshot",
					context: "/map/outputs/map",
					focus: "/inputs/focus",
					reports: "/perspectives",
					previous: "/inputs/previous",
					followUps: "/inputs/followUps",
					decisions: "/inputs/decisions",
				},
				"decision-details",
			),
			reads: {
				focus: "@launchInputs/focus",
				previous: "consolidate/outputs/proposals",
				followUps: "follow-ups",
				decisions: "decide",
			},
		},
		{
			id: "decision-details",
			name: "Label opportunity details",
			type: "transform",
			reads: { proposals: "consolidate/outputs/proposals" },
			transform: Object.fromEntries(
				Object.entries(opportunityDetailLabels).map(([key, label]) => [
					key,
					{
						map: "/inputs/proposals/opportunities",
						template: {
							id: { select: "/id" },
							label,
							value: { select: `/${key}` },
						},
					},
				]),
			),
			next: "decision-items",
		},
		{
			id: "decision-items",
			name: "Arrange opportunities",
			type: "transform",
			reads: {
				proposals: "consolidate/outputs/proposals",
				details: "decision-details",
			},
			transform: {
				items: {
					map: "/inputs/proposals/opportunities",
					template: {
						id: { select: "/id" },
						title: { select: "/title" },
						body: { select: "/problem" },
						value: { select: "" },
						details: {
							map: Object.keys(opportunityDetailLabels).map(
								(key) => `$/inputs/details/${key}`,
							),
							where: { path: "/id", equalsPath: "^/id" },
							template: {
								label: { select: "/label" },
								value: { select: "/value" },
							},
						},
					},
				},
			},
			next: "decide",
		},
		{
			id: "decide",
			name: "Decide per item",
			type: "display",
			reads: {
				proposals: "consolidate/outputs/proposals",
				cards: "decision-items/items",
			},
			document: {
				version: "view-v1",
				components: [
					{
						id: "summary",
						type: "markdown",
						data: { bindings: { text: { path: "/inputs/proposals/summary" } } },
					},
					{
						id: "limitations",
						title: "Limitations",
						type: "points",
						data: { path: "/inputs/proposals/limitationsDisplay" },
					},
					{
						id: "opportunities",
						type: "itemCards",
						data: {
							bindings: {
								items: { path: "/inputs/cards" },
								actions: {
									literal: [
										{ id: "fix", label: "Fix", comment: true },
										{ id: "issue", label: "File issue", comment: true },
										{ id: "skip", label: "Skip", comment: true },
										{
											id: "ask",
											label: "Ask Bob",
											comment: true,
											followUp: true,
										},
									],
								},
							},
						},
					},
					{
						id: "continue",
						type: "actions",
						data: {
							literal: { actions: [{ id: "continue", label: "Continue" }] },
						},
					},
				],
			},
			next: "follow-up-check",
		},
		{
			id: "follow-up-check",
			name: "Check for follow-ups",
			type: "check",
			reads: { answers: "decide/followUps" },
			check: {
				results: { requested: { path: "/inputs/answers", minLength: 1 } },
			},
			branches: [
				{ when: { path: "passed", equals: true }, next: "follow-ups" },
			],
			next: "selection-check",
		},
		{
			id: "follow-ups",
			name: "Answer selected follow-ups",
			type: "foreach",
			items: { from: "/decide/followUps" },
			itemId: "/itemId",
			maxItems: 5,
			concurrency: 4,
			failure: "keep-successful",
			body: [
				agent(
					"answer",
					"Answer targeted follow-up",
					"follow-up-v1",
					"Answer ONLY /question/comment for its /question/item (stable /question/itemId). Use existing proposal/evidence/context first; make only targeted pinned source reads needed to answer the question. Return {itemId:string,answer:string,evidence:string[],limitations:string[]}. Do not remap the repository, coordinate researchers or repeat any completed perspective. Do not implement, file or launch anything. Keep the same item ID and state uncertainty explicitly.",
					{
						baseline: "snapshot",
						context: "map/outputs/map",
						proposals: "consolidate/outputs/proposals",
						question: "@item",
					},
				),
			],
			next: "consolidate",
		},
		{
			id: "selection-check",
			name: "Check selected prerequisites and alternatives",
			type: "check",
			reads: { selected: "decide/itemsByAction/fix" },
			check: {
				results: {
					valid: {
						each: "/inputs/selected",
						require: {
							all: [
								{ path: "/dependencies", within: "$/inputs/selected/*/id" },
								{ path: "/conflicts", disjoint: "$/inputs/selected/*/id" },
							],
						},
					},
				},
			},
			branches: [{ when: { path: "passed", equals: false }, next: "decide" }],
			next: "plans",
		},
		{
			id: "plans",
			name: "For each Fix item: Refine into a plan",
			type: "foreach",
			items: { from: "/decide/itemsByAction/fix" },
			itemId: "/id",
			maxItems: 5,
			concurrency: 4,
			failure: "all-must-succeed",
			body: [
				{
					...call(
						"refine",
						"Refine into a plan",
						"refine-plan",
						{
							baseline: "/snapshot",
							context: "/map/outputs/map",
							selected: "/item",
							proposals: "/consolidate/outputs/proposals",
							decisions: "/decide",
							feedback: "/inputs/feedback",
							dependencyFeedback: "/inputs/dependencyFeedback",
							requestedChanges: "/inputs/requestedChanges",
						},
						"end",
					),
					reads: {
						feedback: "plan-check",
						dependencyFeedback: "plan-dependencies",
						requestedChanges: "approve/values",
					},
				},
			],
			next: "plan-inputs",
		},
		{
			id: "plan-inputs",
			name: "Check exact selected plan coverage",
			type: "check",
			reads: { plans: "plans", selected: "decide/itemsByAction/fix" },
			check: {
				results: {
					// Carry complete packages from this owned read scope without
					// canonicalizing prose that ID/prerequisite predicates do not use.
					plans: {
						aggregate: "filter",
						path: "/inputs/plans/results/*/refine/outputs/plan",
					},
					exactCoverage: {
						all: [
							{
								path: "/inputs/plans/results/*/refine/outputs/plan/id",
								unique: true,
								within: "/inputs/selected/*/id",
							},
							{
								compare: {
									left: {
										length: "/inputs/plans/results/*/refine/outputs/plan/id",
									},
									op: "eq",
									right: { length: "/inputs/selected" },
								},
							},
							{
								each: "/inputs/plans/results/*/refine/outputs/plan",
								require: {
									all: [
										{ path: "/itemIds", minLength: 1, maxLength: 1 },
										{ path: "/itemIds/0", equalsPath: "/id" },
										{ path: "/dependencies", within: "$/inputs/selected/*/id" },
										{
											lookup: {
												collection: "$/inputs/selected",
												key: "/id",
												value: "/id",
											},
											require: {
												path: "/match/dependencies",
												within: "/item/dependencies",
											},
										},
									],
								},
							},
						],
					},
				},
			},
			branches: [{ when: { path: "passed", equals: false }, next: "plans" }],
			next: "plan-dependencies",
		},
		{
			id: "plan-dependencies",
			name: "Check complete plan dependency graph",
			type: "check",
			reads: { plans: "plan-inputs/plans" },
			check: {
				results: {
					ids: { select: "/inputs/plans/*/id" },
					dependencies: { select: "/inputs/plans/*/dependencies" },
				},
				passed: { conforms: "dependency-graph-v1", path: "/results" },
			},
			branches: [{ when: { path: "passed", equals: false }, next: "plans" }],
			next: "checks",
		},
		{
			id: "checks",
			name: "Plan checks in parallel",
			type: "fanout",
			groups: [
				[
					review(
						"architecture",
						"Architecture review",
						"Review /plans against /proposals, chosen actions and evidence for consequential architectural value, justified scope and compatible interfaces. Be practical: no perfection gate or style objections. Do not invent requirements.",
					),
				],
				[
					review(
						"security",
						"Security review",
						"Review /plans for consequential trust-boundary, migration, reliability and operational risks against the actual proposal. Require proportionate mitigations, not hypothetical unrelated hardening.",
					),
				],
				[
					review(
						"dependencies",
						"Dependency and validation review",
						"Review /plans for missing prerequisites, conflicting shared edits/interfaces and observable acceptance/validation. Independent work should run in parallel; order genuinely coupled work. Do not turn tiny details into blockers.",
					),
				],
			],
			next: "plan-check",
		},
		{
			id: "plan-check",
			name: "Check: all plans approved?",
			type: "check",
			reads: {
				checks: "checks",
				plans: "plan-inputs/plans",
				decisions: "decide",
			},
			check: {
				results: {
					architecture: {
						path: "/inputs/checks/0/architecture/approved",
						equals: true,
					},
					security: {
						path: "/inputs/checks/1/security/approved",
						equals: true,
					},
					dependencies: {
						path: "/inputs/checks/2/dependencies/approved",
						equals: true,
					},
					feedback: { select: "/inputs/checks" },
					plans: { aggregate: "filter", path: "/inputs/plans" },
				},
			},
			branches: [{ when: { path: "passed", equals: false }, next: "plans" }],
			next: "approve",
		},
		{
			id: "approve",
			name: "Approve batch",
			type: "display",
			bind: ["plan-check", "checks", "plan-dependencies", "decide"],
			reads: {
				plans: "plan-check/plans",
				checks: "checks",
				dependencyGraph: "plan-dependencies",
			},
			document: {
				version: "view-v1",
				components: [
					{
						id: "instruction",
						type: "markdown",
						data: {
							literal: {
								text: "Review these exact plans and independent checks. Approval authorizes only this batch. Each child retains ordinary Factory human review and provider-confirmed merge gates.",
							},
						},
					},
					{
						id: "plans",
						title: "Exact plans",
						type: "itemCards",
						data: {
							bindings: {
								items: {
									from: "/inputs/plans",
									map: {
										id: "/id",
										title: "/title",
										body: "/plan",
										details: "/reviewDetails",
									},
								},
							},
						},
					},
					{
						id: "dependency-graph",
						title: "Complete dependency graph check",
						type: "markdown",
						data: {
							bindings: {
								text: { path: "/inputs/dependencyGraph", format: "json" },
							},
						},
					},
					{
						id: "feedback",
						type: "form",
						data: {
							literal: {
								fields: [
									{
										id: "feedback",
										type: "textarea",
										label:
											"Requested changes (required when requesting changes)",
									},
								],
							},
						},
					},
					{
						id: "approval-actions",
						type: "actions",
						data: {
							literal: {
								actions: [
									{ id: "approve", label: "Approve" },
									{ id: "changes", label: "Request changes" },
								],
							},
						},
					},
					...(["architecture", "security", "dependencies"] as const).map(
						(name, index) => ({
							id: name,
							title: `${name} check`,
							type: "markdown",
							data: { path: `/inputs/checks/${index}/${name}/display` },
						}),
					),
				],
			},
			next: "approval-check",
		},
		{
			id: "approval-check",
			name: "Check batch decision",
			type: "check",
			reads: { answer: "approve" },
			check: {
				results: {
					approved: {
						all: [
							{ path: "/inputs/answer/action", equals: "approve" },
							{ fresh: "approve" },
						],
					},
					current: { fresh: "approve" },
					changes: {
						text: { path: "/inputs/answer/values/feedback", test: "nonblank" },
					},
				},
				passed: { path: "/results/approved", equals: true },
			},
			branches: [
				{ when: { path: "current", equals: false }, next: "snapshot" },
				{ when: { path: "approved", equals: true }, next: "dispatch" },
				{ when: { path: "changes", equals: true }, next: "decide" },
			],
			next: "approve",
		},
		{
			id: "dispatch",
			name: "File issues and launch runs in parallel",
			type: "fanout",
			groups: [
				[
					{
						id: "issues",
						name: "File deferred issues",
						type: "file-issues",
						fileIssues: {
							items: { from: "/decide/itemsByAction/issue" },
							itemId: "/id",
							maxItems: 5,
							fields: { title: "/title", body: "/issueBody" },
						},
						next: "end",
					},
				],
				[
					{
						id: "launch",
						name: "Launch Factory runs in dependency order",
						type: "launch-runs",
						launchRuns: {
							items: { from: "/plan-check/plans" },
							itemId: "/id",
							maxItems: 5,
							workflow: "factory",
							inputMapping: { prompt: "/title", plan: "/reviewText" },
							dependencies: "/dependencies",
							wait: true,
						},
						next: "end",
					},
				],
			],
			next: "end",
		},
	],
};
export const improvementRecipes = [
	improvementWorkflow,
	mapCodebaseRecipe,
	researchPerspectiveRecipe,
	consolidateProposalsRecipe,
	refinePlanRecipe,
];
