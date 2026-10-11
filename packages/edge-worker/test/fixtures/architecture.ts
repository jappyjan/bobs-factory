import type { Architecture } from "../../src/factory/Architecture.js";
export function proposal(
	classification: Architecture["classification"] = "meaningful",
): Architecture {
	return {
		architectureContract: "architecture-v1",
		classification,
		rationale:
			"Keep the runtime checkpoint as the owner of the approval boundary.",
		title: "Approve designs before Bob builds them",
		summary:
			"Bob pauses after planning so you can approve the design. Merging still needs a separate PR review.",
		changes: [],
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
					title: "Save the approval with the run",
					files: ["src/factory/WorkflowRuntime.ts"],
				},
			],
			assets: [],
		},
	};
}
