/* biome-ignore-all lint/suspicious/noThenProperty: Declarative JSON branches, never callable Promise.then properties. */
/** Review policy is recipe data: no legacy review contracts or runtime adapters. */
const object = (
	properties: Record<string, unknown>,
	required = Object.keys(properties),
) =>
	JSON.parse(
		JSON.stringify({
			type: "object",
			properties,
			required,
			additionalProperties: false,
		}),
	) as {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
		additionalProperties: false;
	};
const text = { type: "string", minLength: 1 };
const strings = { type: "array", items: text };
const array = (items: unknown) => ({ type: "array", items });
const settled = ["resolved", "accepted-rejection"];
const select = (path: string) => ({ select: path });
const literal = (value: unknown) => ({ literal: value });

const specialists = [
	[
		"security-review",
		"Security and data protection",
		"Own authorization, trust boundaries, secrets, untrusted input and consequential data exposure. Avoid general style or business scope review.",
	],
	[
		"architecture-review",
		"Architecture and module boundaries",
		"Own responsibilities, dependency direction, domain/API seams and interface compatibility. Avoid speculative redesign and local style.",
	],
	[
		"integration-review",
		"Repository fit and integration",
		"Own repository conventions, established reuse, config/migration wiring and surrounding integrations. Identify concrete omitted integration sites.",
	],
	[
		"simplicity-review",
		"Simplicity and maintainability",
		"Own unnecessary abstraction, duplication, speculative extensibility and disproportionate complexity. Explain maintenance cost and a smaller sufficient alternative.",
	],
	[
		"correctness-review",
		"Correctness and verification",
		"Own behavioral failures, boundaries, state/concurrency, error handling and actual verification gaps. Discover and run proportionate local checks; inspect weakened test assertions. Missing or failed mandatory evidence is an open rating 2/3 finding. Never claim future QA has executed.",
	],
	[
		"requirements-review",
		"Business requirements and acceptance",
		"Own complete acceptance coverage. Assess EVERY supplied requirement exactly once. Missing or inconclusive evidence is not_met and needs an open rating 2/3 finding with the requirementRef. deliberately_skipped requires an explicit accepted decision with rationale and source; a reviewer/fixer preference cannot waive scope. Missing personal-name metadata alone cannot block coverage.",
	],
] as const;

const finding = object({
	id: text,
	rating: { type: "integer", minimum: 1, maximum: 3 },
	status: { enum: ["open", ...settled] },
	title: text,
	requirementRefs: strings,
	evidence: text,
	remedy: text,
	reason: { type: "string" },
	freshEvidence: { type: "string" },
	kind: { enum: ["finding", "disagreement"] },
	// Aliases are advisory. The ledger keeps each independently blocking claim.
	duplicateOf: { type: "string" },
});
const coverage = object({
	requirementId: text,
	status: { enum: ["met", "not_met", "deliberately_skipped"] },
	evidence: text,
	reason: text,
	decisionId: { type: "string" },
});
const sharedReview = `Review only the current repository content under area.paths and its relevant dependencies, against the supplied requirements and accepted plan. The impact assessor must include all shared dependencies/configuration in those paths; report an incomplete boundary as an open finding rather than claiming a pass. Do not mutate product files, commit, publish, run hidden subagents or ask a human inside parallel work. Run relevant local checks; unavailable evidence is a blocker, never an invented pass.
Use your resumed conversation to preserve prior stable finding IDs and reasoning. area.corrections contains fixer claims for independent reassessment; a fixer saying fixed is not proof. Reassess every prior open rating 2/3 finding. Keep omitted complaints open. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolution or accepted rejection requires concrete evidence and a nonblank reason. Preserve contradictory recommendations as kind:disagreement findings until evidence resolves them; do not silently remove a disagreement. Do not waive requirements. Preserve each duplicate claim and its evidence; duplicateOf alone cannot erase a blocker. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix. Return status:completed only after completing your inspection; otherwise blocked. Return coverage:[] unless you own requirements coverage. Every finding includes id, rating, status, title, requirementRefs, evidence, remedy, reason (empty for a new open finding), freshEvidence (empty unless reopening), kind, duplicateOf (empty unless an advisory alias).`;

const open = {
	all: [
		{ path: "/finding/status", equals: "open" },
		{ path: "/finding/rating", min: 2 },
	],
};
// Suppress only a proven alias of a separate actionable original; keep raw claims in the ledger.
const actionableFinding = {
	all: [
		open,
		{
			not: {
				all: [
					{ text: { path: "/finding/duplicateOf", test: "nonblank" } },
					{
						lookup: {
							collection: "$/inputs/ledger",
							key: "/id",
							value: "/finding/duplicateOf",
						},
						require: {
							all: [
								{ path: "/match/finding/status", equals: "open" },
								{ path: "/match/finding/rating", min: 2 },
								{ path: "/match/finding/duplicateOf", equals: "" },
								{ not: { path: "/match/id", equalsPath: "/item/id" } },
								...["requirementRefs", "evidence", "remedy"].map((field) => ({
									path: `/match/finding/${field}`,
									equalsPath: `/item/finding/${field}`,
								})),
							],
						},
					},
				],
			},
		},
	],
};
const defaultCoverage = {
	map: "/inputs/requirements/requirements",
	template: { requirementId: select("/id"), status: "not_met" },
};

export const v2ReviewRecipe = {
	id: "v2-review-loop",
	name: "Review loop (nodes)",
	engineVersion: "nodes-v1",
	internal: true,
	allowedTriggers: ["workflow", "manual"],
	inputs: ["requirements", "plan", "pr"],
	outcomes: ["completed", "to-architecture", "to-ci"],
	description:
		"Independent scoped specialist reviews, a retained finding ledger, and explicit correction and human-assistance loops.",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "Review request",
			required: true,
		},
		...(["requirements", "plan", "pr"] as const).map((name) => ({
			name,
			type: "textarea",
			label: `${name} port (JSON)`,
			required: true,
		})),
	],
	steps: [
		{
			id: "review-inputs",
			name: "Retain accepted review inputs",
			type: "transform",
			reads: { requirements: "requirements", plan: "plan", pr: "pr" },
			transform: {
				requirements: select("/inputs/requirements"),
				plan: select("/inputs/plan"),
				pr: select("/inputs/pr"),
			},
		},
		{
			id: "head",
			name: "Observe current revision",
			type: "git",
			op: "rev-parse",
			next: "assess-impact",
			maxVisits: 200,
		},
		{
			id: "assess-impact",
			name: "Assess affected review areas",
			type: "agent",
			reuse: "unchanged-inputs",
			access: "read-only",
			maxVisits: 200,
			reads: {
				requirements: "review-inputs/requirements",
				plan: "review-inputs/plan",
				pr: "review-inputs/pr",
				head: "head",
				source: "@source",
				ticket: "@ticket",
				fix: "code-fix",
				previousReview: "actionable",
				assistance: "assistance",
			},
			prompt: `Independently inspect the actual cumulative repository diff, accepted requirements/plan and new source/ticket/human steering. Fixer summaries never authorize reuse. Inspect dependencies, combined target changes, migrations, security boundaries, tests and weakened assertions; never infer safety from filenames, line count or unchanged HEAD alone. Return architectureRevision:true for changed accepted scope/design or incomplete/conflicting source requirements; route back to planning rather than silently changing this requirement inventory. readinessOnly:true is allowed only when no code review is needed and only provider readiness/CI remains; never use it to bypass unresolved findings or an unfinished correction.
For EACH configured reviewer return {paths:[Git pathspecs],corrections:[{id,status,reason,evidence}]}. First review covers all relevant code. Include every dependency/shared configuration the reviewer relies on. Unknown dependencies require the whole repository pathspec [":/"]. Keep identical paths and corrections for unaffected reviewers across commits, so the engine can independently reuse their scoped receipts; never claim a new review ran. Transfer only relevant fixer dispositions from fix.dispositions; these are claims for independent review, never authoritative settlement. Empty corrections stay []. Do not add timestamps, HEADs or narrative fields to reviewer entries. Missing source access, contradictions or design changes need architectureRevision and a concrete summary. Do not mutate files or run corrective agents. Configured reviewers: ${specialists.map(([id]) => id).join(", ")}.`,
			output: {
				schema: object({
					summary: text,
					architectureRevision: { type: "boolean" },
					readinessOnly: { type: "boolean" },
					reviewers: object(
						Object.fromEntries(
							specialists.map(([id]) => [
								id,
								object({
									paths: strings,
									corrections: array(
										object({
											id: text,
											status: text,
											reason: text,
											evidence: text,
										}),
									),
								}),
							]),
						),
					),
				}),
			},
			next: "specialist-review",
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "review",
				},
				{ when: { path: "readinessOnly", equals: true }, next: "readiness" },
			],
		},
		{
			id: "readiness",
			name: "Check readiness-only handoff",
			type: "check",
			maxVisits: 200,
			reads: { previous: "actionable", approved: "approved/approved" },
			check: {
				results: {
					allowed: {
						any: [
							{ path: "/inputs/previous", exists: false },
							{
								all: [
									{ path: "/inputs/approved", equals: true },
									{ path: "/inputs/previous/findings", empty: true },
									{
										count: "/inputs/previous/coverage",
										where: { path: "/status", equals: "not_met" },
										max: 0,
									},
								],
							},
						],
					},
				},
			},
			branches: [{ when: { path: "allowed", equals: true }, next: "review" }],
			next: "specialist-review",
		},
		{
			id: "specialist-review",
			name: "Parallel specialist review",
			type: "fanout",
			maxVisits: 200,
			groups: specialists.map(([id, name, brief]) => [
				{
					id,
					name,
					type: "agent",
					session: "resume",
					access: "read-only",
					reuse: "unchanged-inputs",
					maxVisits: 200,
					reads: {
						requirements: "review-inputs/requirements",
						plan: "review-inputs/plan",
						area: `assess-impact/reviewers/${id}`,
					},
					revisionScope: { paths: { from: "/inputs/area/paths" } },
					prompt: `${brief}\n${sharedReview}\nUse globally stable finding IDs prefixed ${id}: and reviewer:${id}.`,
					output: {
						schema: object({
							reviewer: { enum: [id] },
							status: { enum: ["completed", "blocked"] },
							summary: text,
							findings: array({
								...finding,
								properties: {
									...finding.properties,
									id: { type: "string", pattern: `^${id}:[a-zA-Z0-9_-]+$` },
								},
							}),
							coverage: array(coverage),
						}),
					},
					verify: [
						{
							check: "ids-resolve",
							path: "/findings/*/requirementRefs/*",
							source: "requirements",
							ids: "/requirements/*/id",
						},
						{
							check: "ids-resolve",
							path: "/coverage/*/requirementId",
							source: "requirements",
							ids: "/requirements/*/id",
						},
					],
					rules: [
						{
							message: "Finding IDs must be unique",
							require: { path: "/findings", unique: true, by: "/id" },
						},
						{
							message: "Settled findings need evidence and a reason",
							require: {
								each: "/findings",
								where: { path: "/status", in: settled },
								require: { text: { path: "/reason", test: "nonblank" } },
							},
						},
						...(id === "requirements-review"
							? [
									{
										message: "Coverage has one row per requirement",
										require: {
											path: "/coverage",
											unique: true,
											by: "/requirementId",
										},
									},
								]
							: []),
					],
				},
			]),
			next: "collect",
		},
		{
			id: "collect",
			name: "Tag findings and look up prior dispositions",
			type: "transform",
			maxVisits: 200,
			reads: { reviewers: "specialist-review", prior: "aggregate/ledger" },
			transform: {
				findings: {
					map: "/inputs/reviewers/*/*/findings/*",
					template: {
						id: select("/id"),
						reviewer: select("^/reviewer"),
						finding: select(""),
						previous: {
							if: { path: "$/inputs/prior", exists: true },
							then: {
								find: {
									collection: "$/inputs/prior",
									key: "/id",
									value: "/id",
								},
							},
							else: null,
						},
					},
				},
			},
			next: "aggregate",
		},
		{
			id: "aggregate",
			name: "Retain finding ledger and settled dispositions",
			type: "transform",
			maxVisits: 200,
			reads: { current: "collect/findings", prior: "aggregate/ledger" },
			transform: {
				ledger: {
					map: ["/inputs/current", "/inputs/prior"],
					missingAsEmpty: true,
					distinctBy: "/id",
					template: {
						id: select("/id"),
						reviewer: select("/reviewer"),
						finding: {
							if: {
								all: [
									{ path: "/previous/finding/status", in: settled },
									{ path: "/finding/status", equals: "open" },
									{
										not: {
											text: {
												path: "/finding/freshEvidence",
												test: "nonblank",
											},
										},
									},
								],
							},
							then: select("/previous/finding"),
							else: select("/finding"),
						},
					},
				},
			},
			next: "coverage",
		},
		{
			id: "coverage",
			name: "Complete requirement coverage",
			type: "transform",
			maxVisits: 200,
			reads: {
				requirements: "review-inputs/requirements",
				rows: "specialist-review/5/requirements-review/coverage",
			},
			transform: {
				rows: {
					map: "/inputs/requirements/requirements",
					template: {
						requirementId: select("/id"),
						assessment: {
							find: {
								collection: "$/inputs/rows",
								key: "/requirementId",
								value: "/id",
							},
						},
					},
				},
			},
			next: "actionable",
		},
		{
			id: "actionable",
			name: "Open consequential findings and coverage gaps",
			type: "transform",
			maxVisits: 200,
			reads: {
				ledger: "aggregate/ledger",
				coverage: "coverage/rows",
				requirements: "review-inputs/requirements",
			},
			transform: {
				findings: {
					map: "/inputs/ledger",
					where: actionableFinding,
					template: {
						id: select("/id"),
						displayId: select("@key"),
						reviewer: select("/reviewer"),
						rating: select("/finding/rating"),
						status: select("/finding/status"),
						title: select("/finding/title"),
						requirementRefs: select("/finding/requirementRefs"),
						evidence: select("/finding/evidence"),
					},
				},
				coverage: {
					map: "/inputs/coverage",
					template: {
						requirementId: select("/requirementId"),
						status: {
							if: {
								any: [
									{ path: "/assessment/status", equals: "met" },
									{
										all: [
											{
												path: "/assessment/status",
												equals: "deliberately_skipped",
											},
											{
												lookup: {
													collection: "$/inputs/requirements/decisions",
													key: "/id",
													value: "/assessment/decisionId",
												},
												require: {
													all: [
														{ path: "/match/kind", equals: "skip" },
														{
															text: { path: "/match/answer", test: "nonblank" },
														},
														{
															text: { path: "/match/source", test: "nonblank" },
														},
														{
															path: "/item/requirementId",
															within: "/match/requirementRefs",
														},
													],
												},
											},
										],
									},
								],
							},
							then: select("/assessment/status"),
							else: "not_met",
						},
					},
				},
			},
			next: "approved",
		},
		{
			id: "approved",
			name: "Check independent review approval",
			type: "check",
			maxVisits: 200,
			reads: { review: "actionable", reviewers: "specialist-review" },
			check: {
				results: {
					approved: {
						all: [
							{ path: "/inputs/review/findings", empty: true },
							{
								count: "/inputs/review/coverage",
								where: { path: "/status", equals: "not_met" },
								max: 0,
							},
							{
								count: "/inputs/reviewers/*/*",
								min: specialists.length,
								max: specialists.length,
							},
							{
								each: "/inputs/reviewers/*/*",
								require: { path: "/status", equals: "completed" },
							},
							...specialists.map(([id], index) => ({
								fresh: `specialist-review/${index}/${id}`,
							})),
						],
					},
				},
			},
			branches: [{ when: { path: "approved", equals: true }, next: "review" }],
			next: "convergence",
		},
		{
			id: "convergence",
			name: "Detect stalled corrections",
			type: "converge",
			maxVisits: 200,
			reads: { head: "head", findings: "actionable/findings" },
			watch: ["/inputs/head/repositories/*/head", "/inputs/findings/*/id"],
			maxCycles: 2,
			branches: [
				{ when: { path: "stalled", equals: true }, next: "assistance" },
			],
			next: "code-fix",
		},
		{
			id: "assistance",
			name: "Help the stalled review proceed",
			type: "display",
			maxVisits: 200,
			reads: { review: "actionable", reviewers: "specialist-review" },
			document: {
				version: "view-v1",
				components: [
					{
						id: "why",
						type: "markdown",
						data: {
							literal: {
								text: "Review still rejects the same findings after an unchanged fix attempt. Provide the missing access, deployment, evidence or corrective direction before retrying. Continuing resumes the existing fixer; findings and required validation remain blocking. Choose architecture when the accepted design must change, or CI when provider readiness is the remaining work.",
							},
						},
					},
					{
						id: "findings",
						type: "itemCards",
						data: {
							bindings: {
								items: {
									from: "/inputs/review/findings",
									map: { id: "/displayId", title: "/title", body: "/evidence" },
								},
								comment: { literal: false },
							},
						},
					},
					{
						id: "direction",
						type: "form",
						data: {
							literal: {
								fields: [
									{
										id: "notes",
										type: "textarea",
										label: "Missing evidence, access or corrective direction",
										required: true,
									},
								],
							},
						},
					},
					{
						id: "next",
						type: "actions",
						data: {
							literal: {
								actions: [
									{ id: "continue", label: "Continue fixing" },
									{ id: "architecture", label: "Revise architecture" },
									{ id: "ci", label: "Check CI readiness" },
								],
							},
						},
					},
				],
			},
			branches: [
				{ when: { path: "action", equals: "architecture" }, next: "review" },
				{ when: { path: "action", equals: "ci" }, next: "review" },
			],
			next: "code-fix",
		},
		{
			id: "code-fix",
			name: "Fix consequential review findings",
			type: "agent",
			session: "resume",
			access: "push",
			maxVisits: 200,
			reads: {
				requirements: "review-inputs/requirements",
				plan: "review-inputs/plan",
				review: "actionable",
				ledger: "aggregate/ledger",
				reviewers: "specialist-review",
				assistance: "assistance",
				answer: "fix-assistance",
				pr: "review-inputs/pr",
			},
			prompt: `Fix every unresolved consequential finding and not_met coverage item within the accepted plan. Read assistance and answer for accepted human direction, the retained ledger and conflicting recommendations; inspect actual code and check evidence. Disposition every open finding with concrete reason/evidence, including inherited complaints. Do not treat your own disposition as independent review approval, waive scope or weaken tests. Make the smallest sufficient correction, run proportionate checks, and preserve unrelated/inherited work. Return architectureRevision:true when a fix needs a meaningful design or scope change; do not implement that change before check-in. If access/evidence/direction is missing return needs-input with a valid view-v1 display document; the graph owns the human wait. Otherwise return completed. Do not commit, push, create a PR or merge: explicit graph nodes publish the correction. Include message (ending [skip ci]), title and body for the existing draft PR, and dispositions:[{id,status,reason,evidence}].`,
			output: {
				schema: object(
					{
						status: { enum: ["completed", "needs-input"] },
						architectureRevision: { type: "boolean" },
						summary: text,
						message: text,
						title: text,
						body: { type: "string" },
						dispositions: array(
							object({ id: text, status: text, reason: text, evidence: text }),
						),
						display: { type: "object" },
					},
					[
						"status",
						"architectureRevision",
						"summary",
						"message",
						"title",
						"body",
						"dispositions",
					],
				),
			},
			verify: [
				{
					check: "ids-resolve",
					path: "/dispositions/*/id",
					source: "ledger",
					ids: "/*/id",
				},
			],
			rules: [
				{
					message: "Disposition IDs must be unique",
					require: { path: "/dispositions", unique: true, by: "/id" },
				},
			],
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "review",
				},
				{
					when: { path: "status", equals: "needs-input" },
					next: "fix-assistance",
				},
			],
			next: "commit",
		},
		{
			id: "fix-assistance",
			name: "Provide correction input",
			type: "display",
			reads: { author: "code-fix" },
			from: "/inputs/author/display",
			next: "code-fix",
			maxVisits: 200,
		},
		{
			id: "commit",
			name: "Commit correction",
			type: "git",
			op: "commit",
			hooks: false,
			reads: { message: "code-fix/message" },
			next: "push",
			maxVisits: 200,
		},
		{
			id: "push",
			name: "Push correction",
			type: "git",
			op: "push",
			next: "publish-correction",
			maxVisits: 200,
		},
		{
			id: "publish-correction",
			name: "Ensure corrected draft PR",
			type: "pr",
			op: "ensure",
			reads: { title: "code-fix/title", body: "code-fix/body" },
			next: "head",
			maxVisits: 200,
		},
		{
			id: "review",
			name: "Review output port",
			type: "transform",
			reads: {
				approved: "approved/approved",
				review: "actionable",
				impact: "assess-impact",
				readiness: "readiness/allowed",
				fix: "code-fix",
				assistance: "assistance",
				requirements: "review-inputs/requirements",
				ledger: "aggregate/ledger",
				pr: "review-inputs/pr",
				publication: "publish-correction",
				change: "push",
			},
			transform: {
				approved: { path: "/inputs/approved", equals: true },
				findings: {
					if: { path: "/inputs/review/findings", exists: true },
					then: select("/inputs/review/findings"),
					else: literal([]),
				},
				coverage: {
					if: { path: "/inputs/review/coverage", exists: true },
					then: select("/inputs/review/coverage"),
					else: defaultCoverage,
				},
				pr: {
					if: { path: "/inputs/publication", exists: true },
					then: select("/inputs/publication"),
					else: select("/inputs/pr"),
				},
				change: select("/inputs/change"),
				ledger: {
					if: { path: "/inputs/ledger", exists: true },
					then: select("/inputs/ledger"),
					else: literal([]),
				},
				outcome: {
					if: {
						any: [
							{ path: "/inputs/impact/architectureRevision", equals: true },
							{ path: "/inputs/fix/architectureRevision", equals: true },
							{ path: "/inputs/assistance/action", equals: "architecture" },
						],
					},
					then: "to-architecture",
					else: {
						if: {
							any: [
								{
									all: [
										{ path: "/inputs/impact/readinessOnly", equals: true },
										{ path: "/inputs/readiness", equals: true },
									],
								},
								{ path: "/inputs/assistance/action", equals: "ci" },
							],
						},
						then: "to-ci",
						else: "completed",
					},
				},
			},
			branches: [
				{
					when: { path: "outcome", equals: "to-architecture" },
					next: "to-architecture",
				},
				{ when: { path: "outcome", equals: "to-ci" }, next: "to-ci" },
			],
			next: "end",
		},
	],
};
