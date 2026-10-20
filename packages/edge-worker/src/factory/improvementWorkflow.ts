import { improvementFilter, improvementPerspectives } from "./Improvement.js";

const role = (id: string, name: string, prompt: string) => ({
	id,
	name,
	type: "agent",
	prompt: `${improvementFilter}\n${prompt}`,
	next: "end",
});
export const improvementWorkflow = {
	id: "improve-codebase",
	name: "Improve codebase",
	icon: "🌱",
	description:
		"Research the biggest architectural, structural and reliability improvements in parallel. Choose Fix, File issue, Ignore or Ask follow-up for each proposal.",
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
	improvement: {},
	steps: [
		role(
			"lead",
			"Prepare shared research context",
			"Read the repository instructions/domain documents and map the system. Return {summary:string,focus:string,context:string,limitations:string[]}. Source revisions/history and operational observations are provided. Share architectural context without prescribing findings to the independent perspectives.",
		),
		...improvementPerspectives.map(([id, name, brief]) =>
			role(
				`coordinate-${id}`,
				`${name}: coordinator`,
				`${brief} You are a coordinator: return {summary:string,assignments:[{id:string,question:string,scope:string[]}],skippedReason?:string}. Create at most two disjoint bounded assignments for cheaper research workers. Delegate actual inspection through these assignments; do not do a full survey yourself. Skip operations if no relevant operational observations exist. Do not use native subagents.`,
			),
		),
		role(
			"research-worker",
			"Cheaper research worker",
			"Perform ONLY the bounded assignment in /assignment using list_repository/read_repository and context. Follow the same source revision. Return {summary:string,findings:[{observation:string,evidence:string[],consequence:string,direction:string,confidence:'high'|'medium'|'low'}],limitations:string[]}. At most 3 substantial findings; zero is valid. Never delegate.",
		),
		role(
			"coordinate-results",
			"Verify perspective evidence",
			"Check the strongest worker evidence with targeted pinned source reads. Resolve obvious duplicates; retain disagreements and missing coverage. Return {summary:string,findings:[{observation:string,evidence:string[],consequence:string,direction:string,confidence:'high'|'medium'|'low'}],limitations:string[]}. At most 3 consequential architectural opportunities, or none.",
		),
		role(
			"synthesize",
			"Consolidate improvement proposals",
			"Combine all perspective reports and feedback. Deduplicate by structural cause, not researcher count. Verify strong claims and resolve contradictions with targeted reads. Present strongest 3, at most 5; zero is valid. Return {summary:string,opportunities:[{id:string,title:string,problem:string,evidence:string[],consequence:string,before:string,after:string,plan:string,criteria:string[],nonGoals:string[],risks:string[],paths:string[],strength:'strong'|'worth-exploring'|'speculative',effort:string,dependencies:string[],conflicts:string[],perspectives:string[]}],limitations:string[]}. Preserve item IDs across revisions when the problem is the same. before/after should explain responsibilities/calls visually in Markdown when helpful. Plans must be self-contained with validation. dependencies and conflicts contain ONLY other opportunity IDs in the returned shortlist, never prerequisite prose or contradictory evidence. Put scope prerequisites in plan/nonGoals and uncertainty/counterevidence in risks or limitations. Write concise user-facing prose; omit JSON, schema, tool and output-correction mechanics. Resolve all references within the returned shortlist. Feedback/follow-ups require specific answers in the summary or candidate, not implicit approval.",
		),
		role(
			"package",
			"Refine an approved improvement",
			"Refine only /item chosen for Fix using its evidence, accepted decisions and non-goals. Return {packages:[{id:string,itemIds:string[],title:string,plan:string,criteria:string[],dependencies:string[],paths:string[]}]}. Use one package named with the item ID; dependencies refer to prerequisite item IDs. Full plan includes repository scope/base, observable acceptance and proportionate checks. Do not expand scope or implement.",
		),
		role(
			"check-architecture",
			"Check architectural value and scope",
			"Review /manifest against the proposal, chosen actions and evidence for consequential architectural value, justified scope and compatible interfaces. Return {approved:boolean,feedback:string[]}. Be practical: no perfection gate or style objections. Do not invent requirements.",
		),
		role(
			"check-security",
			"Check security and operational impact",
			"Review /manifest for consequential trust-boundary, migration, reliability and operational risks against the actual proposal. Return {approved:boolean,feedback:string[]}. Require proportionate mitigations, not hypothetical hardening unrelated to the work.",
		),
		role(
			"check-dependencies",
			"Check dependencies and validation",
			"Review /manifest for missing prerequisites, conflicting shared edits/interfaces and observable acceptance/validation. Return {approved:boolean,feedback:string[]}. Independent work should run in parallel; order genuinely coupled work. Do not turn tiny details into blockers.",
		),
	],
};
