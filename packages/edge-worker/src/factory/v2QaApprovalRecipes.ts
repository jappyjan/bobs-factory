/** Factory policy belongs in recipe data; these graphs use only generic nodes. */
const text = { type: "string", minLength: 1 };
const list = (items: unknown, minItems = 0) => ({
	type: "array",
	items,
	minItems,
});
const object = (
	properties: Record<string, unknown>,
	required = Object.keys(properties),
) => ({
	type: "object",
	properties: JSON.parse(JSON.stringify(properties)),
	required,
	additionalProperties: false,
});
const shared = {
	requirements: "requirements",
	plan: "plan",
	pr: "pr",
	source: "@source",
	ticket: "@ticket",
};
const route = (next: string) => [
	{ when: { path: "passed", equals: true }, next },
];
const scenario = object({
	id: text,
	title: text,
	requirementRefs: list(text, 1),
	paths: list(text, 1),
	environment: text,
	preconditions: list(text),
	actions: list(text, 1),
	expected: list(text, 1),
	screenshots: list(text),
	video: object({
		needed: { type: "boolean" },
		required: { type: "boolean" },
		reason: text,
		steps: list(text),
	}),
});
const media = object({ path: text, caption: text });
const capture = object({
	scenarioId: text,
	passed: { type: "boolean" },
	observed: text,
	screenshots: list(media),
	videos: list(
		object(
			{
				path: text,
				caption: text,
				transcript: text,
				posterPath: text,
				receipt: text,
				captionsPath: { type: "string" },
			},
			["path", "caption", "transcript", "posterPath", "receipt"],
		),
	),
	limitations: list(text),
});
const fixOutput = { schema: object({ summary: text, message: text }) };

export const v2QaRecipe = {
	id: "v2-qa",
	name: "QA & screenshots (nodes)",
	internal: true,
	engineVersion: "nodes-v1",
	allowedTriggers: ["workflow", "manual"],
	inputs: ["requirements", "plan", "pr"],
	outcomes: ["completed", "to-review"],
	steps: [
		{
			id: "visit",
			name: "Remember prior publication",
			type: "transform",
			revisionScope: "none",
			reads: { publication: "push" },
			transform: { publication: { select: "/inputs/publication" } },
			next: "visual-scope",
		},
		{
			id: "visual-scope",
			name: "Choose observable scenarios",
			type: "agent",
			reads: shared,
			reuse: "unchanged-inputs",
			access: "read-only",
			output: {
				schema: object({
					needed: { type: "boolean" },
					reason: text,
					scenarios: list(scenario),
				}),
			},
			rules: [
				{
					message: "Scenario IDs must be stable and unique",
					require: { path: "/scenarios", unique: true, by: "/id" },
				},
				{
					id: "needed-scenarios",
					message: "Needed QA requires scenarios",
					when: { path: "/needed", equals: true },
					require: { path: "/scenarios", minLength: 1 },
				},
				{
					id: "skip-scenarios",
					message: "Skipped QA has no scenarios",
					when: { path: "/needed", equals: false },
					require: { path: "/scenarios", maxLength: 0 },
				},
			],
			prompt: `Inspect the accepted requirements, plan and cumulative base-to-head diff in every selected repository, including inherited work. Decide whether this change needs observable QA with screenshots or authentic video. No UI/observable demonstration needed may return needed=false with a concrete reason; ordinary code checks remain the review/CI gates' responsibility. Otherwise choose stable scenario IDs, requirementRefs, concrete preconditions, fixture/environment identity, executable actions and exact expected outcomes. Cover important happy paths, failures, permission boundaries and recovery proportionately; never invent business requirements. Choose only representative screenshots, normally 1-2 per area and at most 24 total, with no artificial viewport/language matrix. Select at most three useful real video flows independently of screenshot need, normally 30-90 seconds, required only when accepted requirements demand a recording. Explain omitted video. Each scenario must carry ALL its relevant accepted requirements and fixtures in its actions/expected/environment, and paths covering all source dependencies, shared configuration/assets and fixtures across repositories. Use [":(glob)**"] when independence is uncertain. Stable scenarios with unchanged inputs and dependency contents may reuse capture; external/shared mutable environments must include their actual version/fingerprint in environment, otherwise do not claim independence. Do not execute QA, change code or capture media.`,
			next: "needed",
		},
		{
			id: "needed",
			name: "Is demonstration needed?",
			type: "check",
			reads: { scope: "visual-scope" },
			check: {
				results: { needed: { path: "/inputs/scope/needed", equals: true } },
			},
			branches: route("captures"),
			next: "skipped",
		},
		{
			id: "skipped",
			name: "No demonstration needed",
			type: "transform",
			transform: {
				needed: false,
				passed: true,
				scenarios: { literal: [] },
				evidence: { literal: [] },
			},
			next: "publication",
		},
		{
			id: "captures",
			name: "Capture each scenario",
			type: "foreach",
			reads: { scenarios: "visual-scope/scenarios" },
			items: { from: "/inputs/scenarios" },
			itemId: "/id",
			concurrency: 1,
			body: [
				{
					id: "capture",
					name: "Execute and capture",
					type: "agent",
					reads: { scenario: "@item" },
					reuse: "unchanged-inputs",
					revisionScope: { paths: { from: "/inputs/scenario/paths" } },
					access: "workspace",
					output: { schema: capture },
					verify: [
						{
							check: "media-valid",
							path: "/screenshots/*/path",
							kind: "image",
						},
						{ check: "media-valid", path: "/videos/*", kind: "video" },
						{
							check: "media-valid",
							path: "/videos/*/posterPath",
							kind: "image",
						},
						{ check: "files-exist", path: "/screenshots/*/path" },
						{ check: "files-exist", path: "/videos/*/path" },
					],
					prompt: `Execute the supplied scenario's actual actions with appropriate non-sensitive fixtures; compare every expected outcome to an observed result. Capture the selected screenshots during the real flow, inspect readability, and save fresh files under the supplied evidence directory. Do not modify product code, repair failures, invent evidence or treat source inspection as execution. Report failed/blocked behavior honestly with passed=false, observed reproduction and limitations. Capture only requested representative states. Video is ordinary capture work, with no flag: when scenario.video.needed, record REAL interactions on an owned headless browser/session with the existing server. Check available recorder, ffmpeg and ffprobe; never attach to someone else's browser or silently install global tools. Finalize the recording before export (close a Playwright recording context before saveAs). Prefer MP4/H.264 yuv420p faststart. Maximum three clips, 120 seconds/50 MiB each and 512 MiB per run; do not pad short authentic flows. Generate and inspect a real poster, supply the actual execution receipt and transcript; audio needs timed captions. Never substitute a slideshow. Missing required recording blocks passed; optional unavailable tooling/export is an explicit limitation. A product failure always fails behavioral QA. Stop only owned sessions/servers. Return the exact scenarioId and all observed results/media; runtime verifies media bytes.`,
				},
			],
			next: "visual-review",
		},
		{
			id: "visual-review",
			name: "Review demonstrated behavior",
			type: "agent",
			access: "read-only",
			reads: { ...shared, scope: "visual-scope", captures: "captures/results" },
			output: {
				schema: object({
					passed: { type: "boolean" },
					scenarioIds: list(text, 1),
					summary: text,
					findings: list(text),
				}),
			},
			verify: [
				{
					check: "ids-resolve",
					path: "/scenarioIds/*",
					source: "scope",
					ids: "/scenarios/*/id",
				},
			],
			rules: [
				{
					message: "Review every scenario exactly once",
					require: { path: "/scenarioIds", unique: true },
				},
			],
			prompt: `Independently inspect the entire planned scope, captures, exact expected/observed outcomes and actual screenshots. Inspect actual video playback, not just posters/metadata. Account for every scenario exactly once in scenarioIds, including retained unchanged captures. Missing executed evidence, failed/blocked required behavior, absent selected screenshots or required recordings cannot pass. Optional tooling limitations remain visible. Screenshots alone do not prove behavior. Do not invent larger capture matrices or turn subjective preferences into blockers. Preserve unresolved consequential findings and assess fixer rejections against concrete evidence. Return actionable findings and passed=true only when the full scope is proven. Do not execute QA again, recapture or change code.`,
			next: "visual-gate",
		},
		{
			id: "visual-gate",
			name: "Did every scenario pass?",
			type: "check",
			reads: {
				review: "visual-review",
				captures: "captures/results",
				scope: "visual-scope",
			},
			check: {
				results: {
					accepted: {
						all: [
							{ path: "/inputs/review/passed", equals: true },
							{ path: "/inputs/review/findings", empty: true },
							{
								each: "/inputs/scope/scenarios",
								require: {
									any: [
										{ path: "/video/required", equals: false },
										{
											lookup: {
												collection: "$/inputs/captures/*/capture",
												key: "/scenarioId",
												value: "/id",
											},
											require: { path: "/videos", minLength: 1 },
										},
									],
								},
							},
							{
								compare: {
									left: { length: "/inputs/review/scenarioIds" },
									op: "eq",
									right: { length: "/inputs/scope/scenarios" },
								},
							},
							{
								each: "/inputs/captures/*/capture",
								require: { path: "/passed", equals: true },
							},
						],
					},
				},
			},
			branches: route("accepted"),
			next: "visual-fix",
		},
		{
			id: "visual-fix",
			name: "Fix demonstrated failures",
			type: "agent",
			session: "resume",
			access: "workspace",
			reads: {
				...shared,
				scope: "visual-scope",
				captures: "captures/results",
				review: "visual-review",
			},
			output: fixOutput,
			prompt:
				"Fix every consequential failed scenario against accepted requirements. Retain stable finding/scenario IDs, and explain any rejected complaint with concrete evidence. Run relevant local checks. Do not expand scope, merge, publish or mark ready; leave changes for the commit/push nodes. Return summary and a concise commit message ending [skip ci].",
			next: "commit",
		},
		{
			id: "commit",
			name: "Commit corrections",
			type: "git",
			op: "commit",
			reads: { message: "visual-fix/message" },
			next: "push",
		},
		{
			id: "push",
			name: "Publish corrections",
			type: "git",
			op: "push",
			next: "captures",
		},
		{
			id: "accepted",
			name: "Collect accepted evidence",
			type: "transform",
			reads: { scope: "visual-scope", captures: "captures/results" },
			transform: {
				needed: true,
				passed: true,
				scenarios: { select: "/inputs/scope/scenarios" },
				screenshots: {
					map: "/inputs/captures/*/capture/screenshots/*",
					template: {
						scenarioId: { select: "^/capture/scenarioId" },
						kind: "screenshot",
						path: { select: "/path" },
					},
				},
				videos: {
					map: "/inputs/captures/*/capture/videos/*",
					template: {
						scenarioId: { select: "^/capture/scenarioId" },
						kind: "video",
						path: { select: "/path" },
					},
				},
			},
			next: "publication",
		},
		{
			id: "publication",
			name: "Observe publication this visit",
			type: "transform",
			revisionScope: "none",
			reads: { publication: "push" },
			transform: { publication: { select: "/inputs/publication" } },
			next: "qa",
		},
		{
			id: "qa",
			name: "QA port",
			type: "transform",
			revisionScope: { paths: [":(glob)**"] },
			reads: {
				skipped: {
					from: "skipped",
					when: { path: "/needed/passed", equals: false },
				},
				accepted: {
					from: "accepted",
					when: { path: "/needed/passed", equals: true },
				},
				before: "visit/publication",
				after: "publication/publication",
			},
			transform: {
				needed: { path: "/inputs/accepted/needed", equals: true },
				passed: true,
				scenarios: {
					map: ["/inputs/skipped/scenarios", "/inputs/accepted/scenarios"],
					missingAsEmpty: true,
					template: { id: { select: "/id" }, title: { select: "/title" } },
				},
				evidence: {
					map: ["/inputs/accepted/screenshots", "/inputs/accepted/videos"],
					missingAsEmpty: true,
					template: {
						scenarioId: { select: "/scenarioId" },
						kind: { select: "/kind" },
						path: { select: "/path" },
					},
				},
				corrected: {
					not: { path: "/inputs/before", equalsPath: "/inputs/after" },
				},
			},
			branches: [
				{ when: { path: "corrected", equals: true }, next: "to-review" },
			],
			next: "completed",
		},
	],
};

const approvalReads = { ...shared, review: "review", qa: "qa" };
const allRepositories = (path: string, where: unknown) => ({
	each: path,
	require: where,
});
export const v2ApprovalRecipe = {
	id: "v2-approval",
	name: "Review guide & approval (nodes)",
	internal: true,
	engineVersion: "nodes-v1",
	allowedTriggers: ["workflow", "manual"],
	inputs: ["requirements", "plan", "review", "qa", "pr"],
	outcomes: ["completed", "to-review", "to-ci"],
	steps: [
		{
			id: "prior",
			name: "Retain the previous approval",
			type: "transform",
			reads: { approval: "explicit", accepted: "approved/approved" },
			revisionScope: "none",
			transform: {
				approval: { select: "/inputs/approval" },
				eligible: { path: "/inputs/accepted", equals: true },
			},
			next: "push",
		},
		{
			id: "push",
			name: "Publish reviewed revision",
			type: "git",
			op: "push",
			next: "published",
		},
		{
			id: "published",
			name: "Read published request",
			type: "pr",
			op: "read",
			revisionScope: { paths: [":(glob)**"] },
			reads: { pr: "pr" },
			next: "status",
		},
		{
			id: "status",
			name: "Inspect clean worktrees",
			type: "git",
			op: "status",
			next: "checks",
		},
		{
			id: "checks",
			name: "Inspect provider checks",
			type: "ci",
			op: "status",
			reads: { pr: "published" },
			next: "handoff",
		},
		{
			id: "handoff",
			name: "Check review and QA",
			type: "check",
			reads: { review: "review", qa: "qa", status: "status" },
			check: {
				results: {
					ready: {
						all: [
							{ path: "/inputs/review/approved", equals: true },
							{ path: "/inputs/qa/passed", equals: true },
							allRepositories("/inputs/status/repositories", {
								path: "/dirty",
								equals: false,
							}),
						],
					},
				},
			},
			branches: route("ci-gate"),
			next: "to-review",
		},
		{
			id: "ci-gate",
			name: "Check published revision and CI",
			type: "check",
			reads: { checks: "checks", pr: "published" },
			check: {
				results: {
					ready: {
						all: [
							allRepositories("/inputs/checks/repositories", {
								all: [
									{ path: "/headMatches", equals: true },
									{ path: "/summary/complete", equals: true },
									{ path: "/summary/failed", equals: 0 },
								],
							}),
							allRepositories("/inputs/pr/repositories", {
								all: [
									{ path: "/state", equals: "OPEN" },
									{ path: "/mergeability", equals: "mergeable" },
									{ path: "/blockers", empty: true },
									{ path: "/unresolvedThreads", empty: true },
								],
							}),
						],
					},
				},
			},
			branches: route("has-prior"),
			next: "to-ci",
		},
		{
			id: "has-prior",
			name: "Was this already approved?",
			type: "check",
			reads: { prior: "prior/approval", eligible: "prior/eligible" },
			check: {
				results: {
					approved: {
						all: [
							{ path: "/inputs/prior/action", equals: "approve" },
							{ path: "/inputs/eligible", equals: true },
						],
					},
				},
			},
			branches: route("impact"),
			next: "guide",
		},
		{
			id: "impact",
			name: "Assess cumulative correction",
			type: "agent",
			access: "read-only",
			reads: {
				...approvalReads,
				prior: "prior/approval",
				current: "published",
				checks: "checks",
			},
			output: {
				schema: object({
					safe: { type: "boolean" },
					summary: text,
					evidence: list(text, 1),
					uncertainty: list(text),
				}),
			},
			prompt: `Independently inspect the CUMULATIVE diff from prior.approvedRepositories (the original human-approved heads, even if prior itself was carried) to the current published revision in every repository. Judge whether all corrections together are minor and safe, including small production-code fixes when evidence establishes safety. A fixer summary, small line count or filenames alone never authorize carry-forward. Reassess accepted requirements, behavioral changes, tests/assertion strength, dependencies, configuration, migrations, security/trust boundaries and provider feedback. Verify current review, QA and required checks cover the full correction. Meaningful behavior/scope changes, human rejection, weakened assertions, unknown dependencies, missing original heads or any uncertainty require safe=false and renewed human approval. Never invent or renew evidence. Return a concrete decision with inspected diff/check evidence and uncertainty; do not mutate code or waive checks.`,
			next: "carry-gate",
		},
		{
			id: "carry-gate",
			name: "Can the original approval continue?",
			type: "check",
			reads: { impact: "impact" },
			check: {
				results: {
					safe: {
						all: [
							{ path: "/inputs/impact/safe", equals: true },
							{ path: "/inputs/impact/uncertainty", empty: true },
							{ fresh: "impact" },
							{ fresh: "published" },
							{ fresh: "checks" },
						],
					},
				},
			},
			branches: route("carried"),
			next: "guide",
		},
		{
			id: "carried",
			name: "Carry the original decision",
			type: "transform",
			reads: {
				prior: "prior/approval",
				decision: "impact",
				current: "published",
			},
			bind: ["impact", "published", "checks"],
			transform: {
				authorization: "carried",
				action: "approve",
				values: { select: "/inputs/prior/values" },
				comments: { select: "/inputs/prior/comments" },
				items: { select: "/inputs/prior/items" },
				itemsByAction: { select: "/inputs/prior/itemsByAction" },
				followUps: { select: "/inputs/prior/followUps" },
				documentDigest: { select: "/inputs/prior/documentDigest" },
				bound: { select: "/inputs/prior/bound" },
				carriedFrom: { select: "/inputs/prior" },
				decision: { select: "/inputs/decision" },
				approvedRepositories: { select: "/inputs/prior/approvedRepositories" },
				repositories: {
					map: "/inputs/current/repositories",
					template: {
						id: { select: "/id" },
						head: { select: "/head" },
						url: { select: "/url" },
						isDraft: false,
					},
				},
			},
			next: "approval-value",
		},
		{
			id: "guide",
			name: "Prepare the show & tell",
			type: "agent",
			access: "read-only",
			reads: {
				...approvalReads,
				current: "published",
				prior: "prior/approval",
				impact: "impact",
				media: "@media",
			},
			output: { format: "display" },
			rules: [
				{
					message: "Include explicit Approve and Request changes controls",
					require: {
						some: "/components",
						require: {
							all: [
								{ path: "/type", equals: "actions" },
								{
									path: "/data/literal/actions/*/id",
									minLength: 2,
									maxLength: 2,
									unique: true,
								},
								{
									each: "/data/literal/actions",
									require: { path: "/id", in: ["approve", "request-changes"] },
								},
							],
						},
					},
				},
				{
					message: "Allow comments on the review items",
					require: {
						some: "/components",
						require: {
							all: [
								{ path: "/type", equals: "itemCards" },
								{ path: "/data/literal/comment", equals: true },
							],
						},
					},
				},
			],
			verify: [{ check: "code-refs-valid", path: "/components/*" }],
			prompt: `Write a display document for the WHOLE PR at the current revision, including inherited work and every accepted iteration. The reviewer decides: does this deliver what was asked? Read the source/ticket, requirements and decisions, accepted plan, complete diff, review coverage and QA evidence yourself. Return output format display (view-v1) using only generic components, freely arranged with literal data: markdown, beforeAfter, checklist, points, table, chart, screenshots, video, codeTour, itemCards and sections as useful. No preset or legacy brief schema.\nPreserve brief-v3's show & tell: speak as Bob in short everyday first-person sentences, one idea per component, proportional to the change. Start with what was asked and where EACH requirement landed, then what changed (core behavior first), decisive human-checkable proof with actual observed values, what only a person can judge (with the honest alternative), what else changed, and what remains unverified. Distinguish shown working, tests only, partial, waived and gaps; never imply an unexecuted check passed. Use 2-6 concise components for a normal change; a small fix may need just before/after plus proof. Numbers come only from executed receipts; never chart a total against itself. Match qa.evidence paths to the supplied media inventory. Screenshots use its index and sha256; video uses its id as taskId, sha256 and transcript. Screenshots/video must reference accepted run inventory IDs/hashes, never local paths or remote URLs. Inspect actual images and make the changed detail readable on a phone; clips need actual accepted playback and transcript fallback. Disclose optional recording/tooling limitations.\nPut technical details in a collapsed Dig deeper section: a codeTour of the actual cumulative diff, core behavior first, tests beside their subject, every changed file accounted for, grouping mechanical wiring. Use real unified hunks and 0-3 pinned notes per important file at valid changed lines. Explain guards, defaults, trust boundaries, changed behavior for existing users and consequential choices. Include plain check receipts and interpretation/choice alternatives. Use itemCards with comment:true, required:false and no item actions for judgments/requirement comments; enable codeTour comment:true. Never turn process history into product prose or dump internal IDs/SHAs/absolute paths into the story.\nWhen prior approval exists, LEAD with a short Since you approved delta: the human's requests first, then ALL changes since prior.approvedRepositories and why renewed approval is needed. Keep the whole guide current below it. End with an actions component containing exactly {id:"approve",label:"Approve"} and {id:"request-changes",label:"Request changes"}. Do not change code, recapture, merge or claim approval.`,
			next: "ready",
		},
		{
			id: "ready",
			name: "Mark the published request ready",
			type: "pr",
			op: "ready",
			reads: { pr: "published" },
			next: "approval-display",
		},
		{
			id: "approval-display",
			name: "Review guide and decide",
			type: "display",
			reads: { guide: "guide", pr: "published" },
			from: "/inputs/guide",
			bind: ["guide", "published"],
			next: "approved",
		},
		{
			id: "approved",
			name: "Require a fresh explicit approval",
			type: "check",
			reads: { answer: "approval-display" },
			check: {
				results: {
					approved: {
						all: [
							{ path: "/inputs/answer/action", equals: "approve" },
							{ fresh: "approval-display" },
						],
					},
				},
			},
			branches: route("explicit"),
			next: "human-fix",
		},
		{
			id: "explicit",
			name: "Record the approved revision",
			type: "transform",
			reads: { answer: "approval-display", pr: "published" },
			bind: ["approval-display"],
			transform: {
				authorization: "explicit",
				carriedFrom: null,
				decision: null,
				action: { select: "/inputs/answer/action" },
				values: { select: "/inputs/answer/values" },
				comments: { select: "/inputs/answer/comments" },
				items: { select: "/inputs/answer/items" },
				itemsByAction: { select: "/inputs/answer/itemsByAction" },
				followUps: { select: "/inputs/answer/followUps" },
				documentDigest: { select: "/inputs/answer/documentDigest" },
				bound: { select: "/inputs/answer/bound" },
				approvedRepositories: {
					map: "/inputs/pr/repositories",
					template: {
						id: { select: "/id" },
						head: { select: "/head" },
						url: { select: "/url" },
						isDraft: false,
					},
				},
				repositories: {
					map: "/inputs/pr/repositories",
					template: {
						id: { select: "/id" },
						head: { select: "/head" },
						url: { select: "/url" },
						isDraft: false,
					},
				},
			},
			next: "approval-value",
		},
		{
			id: "approval-value",
			name: "Select this visit's decision",
			type: "transform",
			revisionScope: "none",
			reads: {
				explicit: {
					from: "explicit",
					when: { path: "/carry-gate/safe", notEquals: true },
				},
				carried: {
					from: "carried",
					when: { path: "/carry-gate/safe", equals: true },
				},
			},
			transform: {
				value: {
					merge: [
						{ select: "/inputs/explicit" },
						{ select: "/inputs/carried" },
					],
				},
			},
			next: "approval",
		},
		{
			id: "approval",
			name: "Approval port",
			type: "transform",
			revisionScope: { paths: [":(glob)**"] },
			bind: ["published", "checks"],
			reads: { result: "approval-value/value" },
			transform: {
				authorization: { select: "/inputs/result/authorization" },
				action: { select: "/inputs/result/action" },
				values: { select: "/inputs/result/values" },
				comments: { select: "/inputs/result/comments" },
				items: { select: "/inputs/result/items" },
				itemsByAction: { select: "/inputs/result/itemsByAction" },
				followUps: { select: "/inputs/result/followUps" },
				documentDigest: { select: "/inputs/result/documentDigest" },
				bound: { select: "/inputs/result/bound" },
				approvedRepositories: { select: "/inputs/result/approvedRepositories" },
				repositories: { select: "/inputs/result/repositories" },
				carriedFrom: { select: "/inputs/result/carriedFrom" },
				decision: { select: "/inputs/result/decision" },
			},
			next: "completed",
		},
		{
			id: "human-fix",
			name: "Address the human's feedback",
			type: "agent",
			session: "resume",
			access: "workspace",
			reads: {
				...approvalReads,
				feedback: "approval-display",
				guide: "guide",
				gate: "approved",
			},
			output: fixOutput,
			prompt:
				"Read the complete human feedback, item/code-note comments and accepted requirements. Fix all requested consequential changes and run relevant local checks. If an approval was stale, inspect and address the intervening change; do not treat that answer as current consent. Explain dispositions and uncertainties. Do not merge, publish or mark ready. Return summary and a commit message ending [skip ci]; separate nodes publish and send the change through review/CI again.",
			next: "fix-commit",
		},
		{
			id: "fix-commit",
			name: "Commit requested corrections",
			type: "git",
			op: "commit",
			reads: { message: "human-fix/message" },
			next: "fix-push",
		},
		{
			id: "fix-push",
			name: "Publish requested corrections",
			type: "git",
			op: "push",
			next: "to-review",
		},
	],
};

export const v2QaApprovalRecipes = [v2QaRecipe, v2ApprovalRecipe];
