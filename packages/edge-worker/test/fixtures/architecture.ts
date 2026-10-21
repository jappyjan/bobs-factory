import type { Architecture } from "../../src/factory/Architecture.js";
export function proposal(
	classification: Architecture["classification"] = "meaningful",
): Architecture {
	return {
		architectureContract: "architecture-v1",
		briefVersion: 1,
		classification,
		rationale:
			"Keep the runtime checkpoint as the owner of the approval boundary.",
		title: "Approve designs before Bob builds them",
		summary:
			"Bob pauses after planning so you can approve the design. Merging still needs a separate PR review.",
		changes: [],
		problem: [
			{
				repository: "bobs-factory",
				paths: ["src/factory/WorkflowRuntime.ts"],
				observation:
					"Designs currently proceed to implementation without an exact-version approval checkpoint.",
			},
		],
		criteria: [
			{
				id: "AC1",
				text: "Require exact-version architecture acceptance before implementation.",
				source: "User request",
				status: "covered",
				reason:
					"The saved checkpoint blocks implementation until this exact proposal is accepted.",
			},
		],
		nonGoals: ["Replace the separate PR merge review."],
		acceptance: [
			"A pending design survives restart and implementation starts exactly once after acceptance of its current version.",
		],
		decisions: [
			{
				id: "boundary",
				question: "Where should the approval live?",
				status: "decided",
				pick: "checkpoint",
				decidedBy: "bob",
				options: [
					{
						id: "checkpoint",
						name: "Next to the run checkpoint",
						upside: "Survives restarts with the rest of the run.",
						catch: "Adds one more saved field.",
					},
					{
						id: "pr",
						name: "Reuse PR approval",
						upside: "No new approval step.",
						catch: "You would approve a design only after it is built.",
						preview: {
							parts: [
								{
									id: "pr-review",
									label: "PR review",
									note: "approves the design late",
									detail:
										"The design is approved together with the finished PR.",
									area: "human",
									status: "outside",
								},
							],
							links: [{ from: "proposal", to: "pr-review" }],
							hide: ["decision"],
						},
					},
				],
			},
		],
		map: {
			areas: [
				{ id: "runtime", name: "Runtime" },
				{ id: "human", name: "You" },
			],
			parts: [
				{
					id: "proposal",
					label: "Proposal",
					note: "saved with the run",
					detail: "Bob's design, saved as an exact version.",
					file: "src/factory/WorkflowRuntime.ts",
					area: "runtime",
					status: "new",
				},
				{
					id: "decision",
					label: "Your approval",
					note: "exact version",
					detail: "You approve one exact version of the design.",
					area: "human",
					status: "new",
				},
			],
			links: [{ from: "proposal", to: "decision", label: "version" }],
		},
		evidence: [
			{
				repository: "bobs-factory",
				paths: ["src/factory/WorkflowRuntime.ts"],
				observation: "Checkpoints already save every step of a run.",
			},
		],
		risks: ["A restart could repeat a step."],
		candidate: {
			plan: "Preserve existing PR https://github.com/JappyJan/bobs-factory/pull/90 and branch existing. Implement the approved runtime boundary. Validate restart and rejection.",
			steps: [
				{
					id: "D1",
					title: "Save the approval with the run",
					what: "Pause before implementation and retain the exact proposal and approval across restarts.",
					kind: "code",
					size: "M",
					traces: [{ criterion: "AC1" }],
					files: [{ path: "src/factory/WorkflowRuntime.ts", change: "edit" }],
				},
			],
			assets: [],
		},
	};
}

/** The same design as a check-in (briefVersion=2). */
export function checkin(
	classification: Architecture["classification"] = "meaningful",
): Architecture {
	const value = proposal(classification);
	value.briefVersion = 2;
	value.talk = {
		understood:
			"You want to approve a design before Bob builds it, so a wrong direction costs minutes instead of a day.",
		plan: "I’d pause the run after planning and save the exact design with it. Bob only starts building once you approve that version.",
		scenes: [
			{
				title: "Bob finishes a plan",
				before: ["Bob writes the plan", "Bob starts building straight away"],
				after: [
					"Bob writes the plan",
					"Bob checks it with you",
					"Bob builds once you say go",
				],
			},
		],
		notice: [{ who: "You", what: "Each design waits for your go-ahead." }],
		checks: [
			{
				decision: "boundary",
				say: "I kept the approval next to the run, so it survives restarts.",
				instead:
					"Reusing PR approval needs no new step, but you would only see the design once it is built.",
			},
		],
		size: "Small: one change to how runs pause.",
	};
	return value;
}
