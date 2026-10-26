/** Data-only nodes-v1 delivery graphs. Legacy compositions remain active until D1. */
export const factoryDeliveryRecipes = [
	{
		id: "v2-ci",
		name: "CI watch & fix (nodes)",
		description:
			"Internal Factory sub-recipe; see docs/factory/factory-recipe-contract.md.",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		internal: true,
		allowedTriggers: ["workflow", "manual"],
		inputs: ["pr", "requirements", "review"],
		outcomes: ["completed", "to-review"],
		steps: [
			{
				id: "baseline",
				name: "Baseline",
				type: "pr",
				op: "read",
				reads: {
					pr: "pr",
				},
				next: "wait",
			},
			{
				id: "wait",
				name: "Wait",
				type: "wait",
				reads: {
					retry: "rerun",
				},
				body: {
					id: "status",
					name: "Status",
					type: "ci",
					op: "status",
					reads: {
						pr: "pr",
					},
				},
				interval: 10000,
				timeout: 3600000,
				until: {
					all: [
						{
							count: "/output/repositories",
							min: 1,
						},
						{
							each: "/output/repositories",
							require: {
								all: [
									{
										path: "/summary/complete",
										equals: true,
									},
									{
										path: "/headMatches",
										equals: true,
									},
								],
							},
						},
						{
							any: [
								{
									not: {
										path: "/inputs/retry",
										exists: true,
									},
								},
								{
									not: {
										path: "/output/repositories/*/checks",
										equalsPath: "/inputs/retry/repositories/*/checks",
									},
								},
							],
						},
					],
				},
				next: "wait-result",
			},
			{
				id: "wait-result",
				name: "Wait result",
				type: "check",
				reads: {
					status: "wait",
				},
				check: {
					results: {
						timedOut: {
							path: "/inputs/status/timedOut",
							equals: true,
						},
					},
				},
				next: "observe",
				branches: [
					{
						when: {
							path: "timedOut",
							equals: true,
						},
						next: "assistance",
					},
				],
			},
			{
				id: "assistance",
				name: "Assistance",
				type: "display",
				document: {
					version: "view-v1",
					components: [
						{
							id: "summary",
							type: "markdown",
							data: {
								literal: {
									text: "CI has not completed for the current head. Restore the provider/runner or synchronize the branch, then continue waiting. Failed checks remain blocking.",
								},
							},
						},
						{
							id: "actions",
							type: "actions",
							data: {
								literal: {
									actions: [
										{
											id: "continue",
											label: "Continue waiting",
										},
									],
								},
							},
						},
					],
				},
				next: "wait",
			},
			{
				id: "observe",
				name: "Observe",
				type: "pr",
				op: "read",
				reads: {
					pr: "pr",
				},
				next: "ci-state",
			},
			{
				id: "ci-state",
				name: "Ci state",
				type: "check",
				reads: {
					status: "wait",
					pr: "observe",
					before: "baseline",
				},
				check: {
					results: {
						revisionChanged: {
							not: {
								path: "/inputs/before/repositories/*/head",
								equalsPath: "/inputs/pr/repositories/*/head",
							},
						},
						green: {
							all: [
								{
									path: "/inputs/before/repositories/*/comments",
									equalsPath: "/inputs/pr/repositories/*/comments",
								},
								{
									path: "/inputs/before/repositories/*/reviewComments",
									equalsPath: "/inputs/pr/repositories/*/reviewComments",
								},
								{
									path: "/inputs/before/repositories/*/reviews",
									equalsPath: "/inputs/pr/repositories/*/reviews",
								},
								{
									each: "/inputs/status/repositories",
									require: {
										path: "/summary/failed",
										equals: 0,
									},
								},
								{
									each: "/inputs/pr/repositories",
									require: {
										all: [
											{
												not: {
													some: "/blockers",
													require: { path: "/action", equals: "fix" },
												},
											},
											{
												path: "/unresolvedThreads",
												equals: [],
											},
											{
												not: {
													path: "/reviewDecision",
													equals: "CHANGES_REQUESTED",
												},
											},
										],
									},
								},
							],
						},
						infraOnly: {
							all: [
								{
									some: "/inputs/status/repositories/*/checks/*",
									require: {
										path: "/status",
										equals: "fail",
									},
								},
								{
									each: "/inputs/status/repositories/*/checks/*",
									where: {
										path: "/status",
										equals: "fail",
									},
									require: {
										path: "/infraFailure",
										equals: true,
									},
								},
							],
						},
					},
				},
				next: "ci-fix",
				branches: [
					{
						when: { path: "revisionChanged", equals: true },
						next: "to-review",
					},
					{
						when: {
							path: "green",
							equals: true,
						},
						next: "completed",
					},
					{
						when: {
							path: "infraOnly",
							equals: true,
						},
						next: "rerun",
					},
				],
			},
			{
				id: "rerun",
				name: "Rerun",
				type: "ci",
				op: "rerun",
				reads: {
					pr: "pr",
				},
				maxVisits: 2,
				next: "wait",
			},
			{
				id: "ci-fix",
				name: "Ci fix",
				type: "agent",
				session: "resume",
				access: "workspace",
				reads: {
					ci: "wait",
					pr: "observe",
					requirements: "requirements",
					review: "review",
					source: "@source",
					ticket: "@ticket",
					assessment: "after-fix",
					answer: "assistance",
				},
				output: {
					schema: {
						type: "object",
						required: [
							"summary",
							"message",
							"reviewRequired",
							"addressedReviewIds",
							"addressedCommentIds",
						],
						properties: {
							summary: {
								type: "string",
							},
							message: {
								type: "string",
							},
							reviewRequired: {
								type: "boolean",
							},
							addressedReviewIds: {
								type: "array",
							},
							addressedCommentIds: {
								type: "array",
							},
						},
					},
				},
				prompt:
					"Diagnose failing checks and actionable PR feedback from the supplied current provider data. Make the smallest correction within requirements. Fetch and integrate the base when the branch is behind or conflicts; preserve required checks. Assess every new comment by ID, including whether it needs code review. Address each unresolved thread or post an evidence-backed response before resolving it with the configured Git provider. Never dismiss reviews, waive checks, impersonate a reviewer, merge, mark ready, commit or push. Preserve discussion and before/after evidence; include addressed thread/review/comment IDs and dispositions in summary. Add <!-- generated-by-bobs-factory --> to replies. Run relevant local checks. Return summary, message (commit subject), reviewRequired, addressedReviewIds and addressedCommentIds. Meaningful or uncertain scope/architecture changes require reviewRequired=true and a clear handback in summary.",
				maxVisits: 16,
				next: "commit",
			},
			{
				id: "commit",
				name: "Commit",
				type: "git",
				op: "commit",
				reads: {
					message: "ci-fix/message",
				},
				next: "push",
			},
			{
				id: "push",
				name: "Push",
				type: "git",
				op: "push",
				next: "change",
			},
			{
				id: "change",
				name: "Corrected change port",
				type: "transform",
				reads: { publication: "push", fix: "ci-fix" },
				transform: {
					summary: { select: "/inputs/fix/summary" },
					repositories: { select: "/inputs/publication/repositories" },
				},
				next: "after-pr",
			},
			{
				id: "after-pr",
				name: "Read corrected pull requests",
				type: "pr",
				op: "read",
				reads: {
					pr: "pr",
				},
				next: "delta-base",
			},
			{
				id: "delta-base",
				name: "Saved heads as diff bases",
				type: "transform",
				reads: { baseline: "baseline" },
				transform: {
					repositories: {
						map: "/inputs/baseline/repositories",
						template: {
							id: { select: "/id" },
							base: { select: "/head" },
						},
					},
				},
				next: "delta",
			},
			{
				id: "delta",
				name: "Delta",
				type: "git",
				op: "diff",
				reads: {
					from: "delta-base",
				},
				next: "feedback",
			},
			{
				id: "feedback",
				name: "Feedback",
				type: "agent",
				access: "read-only",
				reads: {
					before: "baseline",
					after: "after-pr",
					fix: "ci-fix",
					delta: "delta",
					review: "review",
				},
				output: {
					schema: {
						type: "object",
						required: ["reviewRequired", "reason"],
						properties: {
							reviewRequired: {
								type: "boolean",
							},
							reason: {
								type: "string",
							},
						},
					},
				},
				prompt:
					"Assess PR feedback only. Compare before/after comments, reviews and unresolved threads with the fixer dispositions. Return reviewRequired=true for new/unaddressed actionable comments, unresolved review disputes, a changed requested scope or uncertainty. Informational comments and evidence-backed metadata-only corrections may return false. Never infer reviewer approval or resolve threads. Explain the disposition by ID. Revision and diff checks are enforced separately by the graph.",
				next: "progress",
			},
			{
				id: "progress",
				name: "Progress",
				type: "converge",
				reads: {
					pr: "after-pr",
					delta: "delta",
				},
				watch: ["/inputs/pr", "/inputs/delta"],
				maxCycles: 3,
				next: "progress-check",
			},
			{
				id: "progress-check",
				name: "Progress check",
				type: "check",
				reads: {
					progress: "progress",
				},
				check: {
					results: {
						stalled: {
							path: "/inputs/progress/stalled",
							equals: true,
						},
					},
				},
				next: "after-fix",
				branches: [
					{
						when: {
							path: "stalled",
							equals: true,
						},
						next: "assistance",
					},
				],
			},
			{
				id: "after-fix",
				name: "After fix",
				type: "transform",
				reads: {
					before: "baseline",
					after: "after-pr",
					delta: "delta",
					review: "review",
					fix: "ci-fix",
					feedback: "feedback",
				},
				transform: {
					codeChanged: {
						some: "/inputs/delta/repositories",
						require: {
							path: "/stats/filesChanged",
							min: 1,
						},
					},
					revisionChanged: {
						not: {
							path: "/inputs/before/repositories/*/head",
							equalsPath: "/inputs/after/repositories/*/head",
						},
					},
					baseChanged: {
						not: {
							path: "/inputs/before/repositories/*/base",
							equalsPath: "/inputs/after/repositories/*/base",
						},
					},
					feedbackRequiresReview: {
						any: [
							{
								path: "/inputs/fix/reviewRequired",
								equals: true,
							},
							{
								path: "/inputs/feedback/reviewRequired",
								equals: true,
							},
							{
								some: "/inputs/after/repositories",
								require: {
									any: [
										{
											path: "/unresolvedThreads",
											minLength: 1,
										},
										{
											path: "/reviewDecision",
											equals: "CHANGES_REQUESTED",
										},
									],
								},
							},
						],
					},
					reviewMissing: {
						not: {
							path: "/inputs/review/approved",
							equals: true,
						},
					},
					providerBehind: {
						not: {
							path: "/inputs/after/repositories/*/head",
							equalsPath: "/inputs/delta/repositories/*/head",
						},
					},
				},
				next: "after-ci-fix",
			},
			{
				id: "after-ci-fix",
				name: "After ci fix",
				type: "check",
				reads: {
					assessment: "after-fix",
				},
				check: {
					results: {
						reviewRequired: {
							any: [
								{
									path: "/inputs/assessment/codeChanged",
									equals: true,
								},
								{
									path: "/inputs/assessment/revisionChanged",
									equals: true,
								},
								{
									path: "/inputs/assessment/baseChanged",
									equals: true,
								},
								{
									path: "/inputs/assessment/feedbackRequiresReview",
									equals: true,
								},
								{
									path: "/inputs/assessment/reviewMissing",
									equals: true,
								},
							],
						},
					},
				},
				next: "baseline",
				branches: [
					{
						when: {
							path: "reviewRequired",
							equals: true,
						},
						next: "to-review",
					},
				],
			},
		],
	},
	{
		id: "v2-merge",
		name: "Merge (nodes)",
		description:
			"Internal Factory sub-recipe; see docs/factory/factory-recipe-contract.md.",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		internal: true,
		allowedTriggers: ["workflow", "manual"],
		inputs: ["approval", "pr", "completion"],
		outcomes: ["completed", "to-review", "to-ci"],
		steps: [
			{
				id: "current-pr",
				name: "Read current pull requests",
				type: "pr",
				op: "read",
				reads: {
					pr: "pr",
				},
				next: "approval-current",
			},
			{
				id: "approval-current",
				name: "Approval current",
				type: "check",
				reads: {
					approval: "approval",
				},
				check: {
					results: {
						approved: {
							all: [
								{ fresh: "approval" },
								{ path: "/inputs/approval/action", equals: "approve" },
								{
									any: [
										{
											not: {
												path: "/inputs/approval/carriedFrom",
												exists: true,
											},
										},
										{ path: "/inputs/approval/carriedFrom", equals: null },
										{
											all: [
												{
													path: "/inputs/approval/authorization",
													equals: "carried",
												},
												{
													path: "/inputs/approval/decision/safe",
													equals: true,
												},
												{
													path: "/inputs/approval/decision/uncertainty",
													equals: [],
												},
											],
										},
									],
								},
							],
						},
					},
				},
				next: "to-review",
				branches: [
					{
						when: {
							path: "approved",
							equals: true,
						},
						next: "target-heads",
					},
				],
			},
			{
				id: "target-heads",
				name: "Select authorized request heads",
				type: "transform",
				revisionScope: "none",
				reads: { pr: "pr", approval: "approval" },
				transform: {
					requests: {
						merge: [{ select: "/inputs/pr" }, { select: "/inputs/approval" }],
					},
				},
				next: "compare-heads",
			},
			{
				id: "compare-heads",
				name: "Compare current provider heads",
				type: "transform",
				reads: {
					expected: "target-heads/requests/repositories",
					current: "current-pr/repositories",
				},
				transform: {
					repositories: {
						map: "/inputs/current",
						template: {
							id: { select: "/id" },
							head: { select: "/head" },
							expected: {
								find: {
									collection: "$/inputs/expected",
									key: "/id",
									value: "/id",
								},
							},
						},
					},
				},
				next: "merge-readiness",
			},
			{
				id: "merge-readiness",
				name: "Merge readiness",
				type: "check",
				reads: {
					pr: "current-pr",
					heads: "compare-heads",
				},
				check: {
					results: {
						reviewBlocked: {
							any: [
								{
									some: "/inputs/heads/repositories",
									require: {
										not: { path: "/head", equalsPath: "/expected/head" },
									},
								},
								{
									count: "/inputs/pr/repositories",
									max: 0,
								},
								{
									some: "/inputs/pr/repositories",
									require: {
										any: [
											{
												path: "/state",
												equals: "CLOSED",
											},
											{
												path: "/isDraft",
												equals: true,
											},
											{
												path: "/mergeability",
												equals: "conflicting",
											},
											{
												path: "/unresolvedThreads",
												minLength: 1,
											},
											{
												path: "/reviewDecision",
												equals: "CHANGES_REQUESTED",
											},
											{
												not: {
													path: "/head",
													equalsPath: "/headRefOid",
												},
											},
										],
									},
								},
							],
						},
						ciBlocked: {
							some: "/inputs/pr/repositories",
							where: { path: "/state", equals: "OPEN" },
							require: {
								all: [
									{ not: { path: "/queued", equals: true } },
									{
										any: [
											{ path: "/checksSummary/failed", min: 1 },
											{
												some: "/blockers",
												require: { path: "/action", equals: "fix" },
											},
										],
									},
								],
							},
						},
						humanBlocked: {
							some: "/inputs/pr/repositories/*/blockers/*",
							require: { path: "/action", equals: "human" },
						},
						waiting: {
							some: "/inputs/pr/repositories",
							where: { path: "/state", equals: "OPEN" },
							require: {
								all: [
									{ not: { path: "/queued", equals: true } },
									{
										any: [
											{
												not: { path: "/checksSummary/complete", equals: true },
											},
											{
												path: "/mergeStateStatus",
												in: ["BEHIND", "BLOCKED", "DIRTY", "UNKNOWN", "DRAFT"],
											},
											{
												some: "/blockers",
												require: { path: "/action", equals: "wait" },
											},
										],
									},
								],
							},
						},
					},
				},
				next: "merge",
				branches: [
					{
						when: {
							path: "reviewBlocked",
							equals: true,
						},
						next: "to-review",
					},
					{
						when: {
							path: "ciBlocked",
							equals: true,
						},
						next: "to-ci",
					},
					{
						when: { path: "humanBlocked", equals: true },
						next: "merge-assistance-details",
					},
					{
						when: { path: "waiting", equals: true },
						next: "merge-wait",
					},
				],
			},
			{
				id: "merge-wait",
				name: "Wait for provider merge readiness",
				type: "wait",
				reads: { before: "current-pr" },
				body: {
					id: "pr",
					name: "Read pull requests",
					type: "pr",
					op: "read",
					reads: { pr: "pr" },
				},
				interval: 10000,
				timeout: 3600000,
				until: {
					not: {
						path: "/output/repositories",
						equalsPath: "/inputs/before/repositories",
					},
				},
				next: "merge-wait-result",
			},
			{
				id: "merge-wait-result",
				name: "Check provider wait",
				type: "check",
				reads: { status: "merge-wait" },
				check: {
					results: {
						timedOut: { path: "/inputs/status/timedOut", equals: true },
					},
				},
				next: "current-pr",
				branches: [
					{
						when: { path: "timedOut", equals: true },
						next: "merge-assistance-details",
					},
				],
			},
			{
				id: "merge-assistance-details",
				name: "Explain provider blockers",
				type: "transform",
				reads: { pr: "current-pr" },
				transform: {
					requests: {
						map: "/inputs/pr/repositories",
						template: { label: { select: "/id" }, url: { select: "/url" } },
					},
					blockers: {
						map: "/inputs/pr/repositories/*/blockers/*",
						template: {
							label: { select: "/message" },
							detail: { select: "/action" },
						},
					},
				},
				next: "merge-assistance",
			},
			{
				id: "merge-assistance",
				name: "Resolve provider merge blockers",
				type: "display",
				reads: { details: "merge-assistance-details" },
				document: {
					version: "view-v1",
					components: [
						{
							id: "summary",
							type: "markdown",
							data: {
								literal: {
									text: "The provider still blocks merging. Resolve the required approvals or merge rules in the pull request, or restore pending checks after a timeout, then continue waiting. Existing approval is retained; continuing never waives provider requirements.",
								},
							},
						},
						{
							id: "requests",
							type: "points",
							data: {
								bindings: { items: { path: "/inputs/details/requests" } },
							},
						},
						{
							id: "blockers",
							type: "points",
							data: {
								bindings: { items: { path: "/inputs/details/blockers" } },
							},
						},
						{
							id: "actions",
							type: "actions",
							data: {
								literal: {
									actions: [{ id: "continue", label: "Continue waiting" }],
								},
							},
						},
					],
				},
				next: "merge-wait",
			},
			{
				id: "merge",
				name: "Merge",
				type: "merge",
				expectedRevision: "approval",
				bind: ["approval"],
				reads: {
					requests: "target-heads/requests",
				},
				branches: [
					{ when: { path: "headChanged", equals: true }, next: "to-review" },
					{
						when: { path: "authorizationStale", equals: true },
						next: "to-review",
					},
				],
				next: "has-ticket",
			},
			{
				id: "has-ticket",
				name: "Has ticket",
				type: "check",
				reads: {
					ticket: "@ticket",
					completion: "completion",
				},
				check: {
					results: {
						present: {
							all: [
								{ path: "/inputs/ticket", exists: true },
								{ not: { path: "/inputs/completion/final", equals: false } },
							],
						},
					},
				},
				next: "completed",
				branches: [
					{
						when: {
							path: "present",
							equals: true,
						},
						next: "complete-ticket",
					},
				],
			},
			{
				id: "complete-ticket",
				name: "Complete ticket",
				type: "ticket",
				op: "set-status",
				statusType: "completed",
				next: "comment",
			},
			{
				id: "comment",
				name: "Comment",
				type: "ticket",
				op: "comment",
				commentBody:
					"Repository delivery completed: the provider confirmed merge of the explicitly approved revision. Merge receipts remain available in the run.",
				next: "completed",
			},
		],
	},
	{
		id: "v2-external",
		name: "External ticket delivery (nodes)",
		description:
			"Internal Factory sub-recipe; see docs/factory/factory-recipe-contract.md.",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		internal: true,
		allowedTriggers: ["workflow", "manual"],
		inputs: ["requirements", "plan", "approval", "merge"],
		outcomes: ["completed", "revise-plan"],
		steps: [
			{
				id: "repository-context",
				name: "Retain repository delivery",
				type: "transform",
				reads: { approval: "approval", merge: "merge" },
				transform: {
					approval: { select: "/inputs/approval" },
					merge: { select: "/inputs/merge" },
				},
				next: "repository-current",
			},
			{
				id: "repository-current",
				name: "Check repository delivery context",
				type: "check",
				reads: { repository: "repository-context" },
				check: {
					results: {
						ready: {
							any: [
								{
									all: [
										{ path: "/inputs/repository/approval", equals: null },
										{ path: "/inputs/repository/merge", equals: null },
									],
								},
								{
									all: [
										{ fresh: "approval" },
										{ fresh: "merge" },
										{
											path: "/inputs/repository/approval/action",
											equals: "approve",
										},
										{ count: "/inputs/repository/merge/repositories", min: 1 },
										{
											each: "/inputs/repository/merge/repositories",
											require: { path: "/merged", equals: true },
										},
									],
								},
							],
						},
					},
				},
				next: "revise-plan",
				branches: [{ when: { path: "ready", equals: true }, next: "apply" }],
			},
			{
				id: "apply",
				name: "Apply",
				type: "agent",
				session: "resume",
				access: "workspace",
				reads: {
					requirements: "requirements",
					plan: "plan",
					ticket: "@ticket",
					source: "@source",
				},
				output: {
					schema: {
						type: "object",
						required: ["applied", "revisePlan", "summary", "receipts"],
						properties: {
							applied: {
								type: "boolean",
							},
							revisePlan: {
								type: "boolean",
							},
							summary: {
								type: "string",
							},
							receipts: {
								type: "array",
							},
						},
					},
				},
				prompt:
					"Apply only the external ticket content/relationship operations explicitly authorized in plan and requirements, using the configured tracker integration. Do not edit repository files, publish or merge. If targets, operations, authorization or criteria are missing/ambiguous, return applied=false, revisePlan=true without writes. Before each write fetch complete current content and relationships; reconcile already-applied intent on retry/restart, retain before/after receipts and provider limitations, and never duplicate a confirmed operation. Do not overwrite concurrent changes or remove relationships outside scope. Providers without conditional writes need before/after checks and an explicit race limitation. Ambiguous outcomes require reading/reconciliation, never blind resend. No status completion here. Return applied, revisePlan, summary, receipts (each target, intent, before, after, limitation).",
				next: "applied",
			},
			{
				id: "applied",
				name: "Applied",
				type: "check",
				reads: {
					result: "apply",
				},
				check: {
					results: {
						ok: {
							all: [
								{
									path: "/inputs/result/applied",
									equals: true,
								},
								{
									path: "/inputs/result/revisePlan",
									equals: false,
								},
							],
						},
					},
				},
				next: "revise-plan",
				branches: [
					{
						when: {
							path: "ok",
							equals: true,
						},
						next: "read-ticket",
					},
				],
			},
			{
				id: "read-ticket",
				name: "Read ticket",
				type: "ticket",
				op: "read",
				next: "verify",
			},
			{
				id: "verify",
				name: "Verify",
				type: "agent",
				access: "read-only",
				reads: {
					requirements: "requirements",
					plan: "plan",
					ticket: "read-ticket",
					apply: "apply",
					correction: "correction",
				},
				output: {
					schema: {
						type: "object",
						required: ["verified", "summary", "ticketUrl", "observations"],
						properties: {
							verified: {
								type: "boolean",
							},
							summary: {
								type: "string",
							},
							ticketUrl: {
								type: "string",
							},
							observations: {
								type: "array",
							},
						},
					},
				},
				prompt:
					"Independently verify every authorized external target and criterion against fresh complete provider reads, including ticket content and relationships. The supplied ticket read is evidence for the originating ticket only; fetch every other target through its configured integration. Do not trust an apply/correction claim as verification and do not mutate anything. Return verified=false for missing reads, mismatched identities, incomplete lists, failed criteria or uncertainty. Retain exact observed target states and before/after receipts in observations; include summary and the originating ticketUrl.",
				next: "verified",
			},
			{
				id: "verified",
				name: "Verified",
				type: "check",
				reads: {
					verification: "verify",
				},
				check: {
					results: {
						ok: {
							path: "/inputs/verification/verified",
							equals: true,
						},
					},
				},
				next: "correction",
				branches: [
					{
						when: {
							path: "ok",
							equals: true,
						},
						next: "guide",
					},
				],
			},
			{
				id: "guide",
				name: "Guide",
				type: "agent",
				access: "read-only",
				reads: {
					requirements: "requirements",
					plan: "plan",
					verification: "verify",
					repository: "repository-context",
					apply: "apply",
					correction: "correction",
				},
				output: {
					schema: {
						type: "object",
						required: ["summary"],
						properties: {
							summary: {
								type: "string",
							},
						},
					},
				},
				prompt:
					"Write a concise Markdown guide to the independently verified external work: goal, each requirement and evidence, target links, before/after changes, relationships, checks and provider race limitations. Explain that Accept confirms this exact verified state; Request changes preserves applied changes and requests correction, without rollback. Include the retained repository approval and confirmed merge when supplied, so acceptance covers both repository and external delivery. Do not claim repository work was merged without its retained receipt. Return summary.",
				next: "accept",
			},
			{
				id: "accept",
				name: "Accept",
				type: "display",
				reads: {
					guide: "guide",
					verification: "verify",
					repository: "repository-context",
					plan: "plan",
				},
				bind: ["verify", "guide", "repository-context"],
				document: {
					version: "view-v1",
					components: [
						{
							id: "summary",
							type: "markdown",
							data: {
								bindings: {
									text: { path: "/inputs/guide/summary" },
								},
							},
						},
						{
							id: "notes",
							type: "form",
							data: {
								literal: {
									fields: [
										{
											id: "notes",
											type: "textarea",
											label: "Requested changes",
										},
									],
								},
							},
						},
						{
							id: "actions",
							type: "actions",
							data: {
								literal: {
									actions: [
										{
											id: "accept",
											label: "Accept",
										},
										{
											id: "changes",
											label: "Request changes",
										},
									],
								},
							},
						},
					],
				},
				next: "accepted",
			},
			{
				id: "accepted",
				name: "Accepted",
				type: "check",
				reads: {
					approval: "accept",
				},
				check: {
					results: {
						accepted: {
							all: [
								{
									path: "/inputs/approval/action",
									equals: "accept",
								},
								{
									fresh: "accept",
								},
							],
						},
					},
				},
				next: "correction",
				branches: [
					{
						when: {
							path: "accepted",
							equals: true,
						},
						next: "final-read",
					},
				],
			},
			{
				id: "correction",
				name: "Correction",
				type: "agent",
				session: "resume",
				access: "workspace",
				reads: {
					requirements: "requirements",
					plan: "plan",
					ticket: "read-ticket",
					verification: "verify",
					feedback: "accept",
					apply: "apply",
					previous: "correction",
				},
				output: {
					schema: {
						type: "object",
						required: ["applied", "revisePlan", "summary", "receipts"],
						properties: {
							applied: {
								type: "boolean",
							},
							revisePlan: {
								type: "boolean",
							},
							summary: {
								type: "string",
							},
							receipts: {
								type: "array",
							},
						},
					},
				},
				prompt:
					"Assess failed verification or requested changes against the authorized plan. Applied changes remain; rejection never rolls them back. Preserve all feedback and operation receipts. Apply only corrections already authorized by the current plan, using fresh before/after complete ticket content and relationship reads and reconciliation of prior effects. Never edit repository files, commit, push, merge or replay a confirmed repository delivery. If the request changes scope/authorization, concerns repository work, or needs a new plan, return revisePlan=true without those writes. Do not complete the ticket. Return applied, revisePlan, summary, receipts with exact target/intent/before/after/limitations.",
				maxVisits: 16,
				next: "corrected",
			},
			{
				id: "corrected",
				name: "Corrected",
				type: "check",
				reads: {
					result: "correction",
				},
				check: {
					results: {
						ok: {
							all: [
								{
									path: "/inputs/result/applied",
									equals: true,
								},
								{
									path: "/inputs/result/revisePlan",
									equals: false,
								},
							],
						},
					},
				},
				next: "revise-plan",
				branches: [
					{
						when: {
							path: "ok",
							equals: true,
						},
						next: "read-ticket",
					},
				],
			},
			{
				id: "final-read",
				name: "Final read",
				type: "ticket",
				op: "read",
				next: "final-verify",
			},
			{
				id: "final-verify",
				name: "Final verify",
				type: "agent",
				access: "read-only",
				reads: {
					requirements: "requirements",
					plan: "plan",
					ticket: "final-read",
					verification: "verify",
					approval: "accept",
				},
				output: {
					schema: {
						type: "object",
						required: ["unchanged", "reason"],
						properties: {
							unchanged: {
								type: "boolean",
							},
							reason: {
								type: "string",
							},
						},
					},
				},
				prompt:
					"Read every external target again through the configured tracker. Compare complete content and relationships with the exact independently verified observations accepted by the human. Do not mutate. Return unchanged=true only if every target identity, criterion and observed state still matches; otherwise false with a reason. An originating ticket snapshot alone does not prove other targets unchanged.",
				next: "final-current",
			},
			{
				id: "final-current",
				name: "Final current",
				type: "check",
				reads: {
					result: "final-verify",
					before: "read-ticket",
					current: "final-read",
					repository: "repository-context",
				},
				check: {
					results: {
						repositoryFresh: {
							any: [
								{ path: "/inputs/repository/approval", equals: null },
								{ all: [{ fresh: "approval" }, { fresh: "merge" }] },
							],
						},
						current: {
							all: [
								{
									path: "/inputs/result/unchanged",
									equals: true,
								},
								{ fresh: "accept" },
								{ path: "/inputs/before", equalsPath: "/inputs/current" },
								{
									any: [
										{ path: "/inputs/repository/approval", equals: null },
										{ fresh: "approval" },
									],
								},
							],
						},
					},
				},
				next: "read-ticket",
				branches: [
					{
						when: { path: "repositoryFresh", equals: false },
						next: "revise-plan",
					},
					{
						when: {
							path: "current",
							equals: true,
						},
						next: "complete-ticket",
					},
				],
			},
			{
				id: "complete-ticket",
				name: "Complete ticket",
				type: "ticket",
				op: "set-status",
				statusType: "completed",
				next: "delivery",
			},
			{
				id: "delivery",
				name: "Delivery",
				type: "transform",
				reads: {
					verification: "verify",
				},
				transform: {
					applied: true,
					verified: true,
					ticketUrl: {
						select: "/inputs/verification/ticketUrl",
					},
				},
				next: "completed",
			},
		],
	},
	{
		id: "v2-deferred",
		name: "Deferred delivery (nodes)",
		description:
			"Internal Factory sub-recipe; see docs/factory/factory-recipe-contract.md.",
		engineVersion: "nodes-v1",
		stepConfigVersion: "step-config-v1",
		internal: true,
		allowedTriggers: ["workflow", "manual"],
		inputs: ["requirements", "plan"],
		outcomes: ["completed"],
		steps: [
			{
				id: "explain",
				name: "Explain",
				type: "display",
				reads: {
					plan: "plan",
					requirements: "requirements",
				},
				document: {
					version: "view-v1",
					components: [
						{
							id: "summary",
							type: "markdown",
							data: {
								literal: {
									text: "Execution is deferred by the plan. No repository or external changes are applied and the ticket remains open. Explicit authorization and a revised plan are required to proceed.",
								},
							},
						},
						{
							id: "plan",
							type: "markdown",
							data: {
								bindings: {
									text: { path: "/inputs/plan/summary" },
								},
							},
						},
					],
				},
				next: "comment",
			},
			{
				id: "comment",
				name: "Comment",
				type: "ticket",
				op: "comment",
				commentBody:
					"Execution remains deferred by the plan. No delivery was applied; explicit authorization and a revised plan are required before proceeding. The ticket remains open.",
				next: "completed",
			},
		],
	},
];
