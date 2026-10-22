import {
	architectureContinuationInstructions,
	architectureQuestionInstructions,
	checkinInstructions,
	implementationScopeInstructions,
} from "./Architecture.js";
import {
	briefVideoInstructions,
	DIVE_CONTRACT,
	divePrompt,
} from "./GuideAuthoring.js";
import { hasCheck, readStep } from "./StepConfig.js";
import type { Workflow, WorkflowStep } from "./Workflow.js";

const impactGuideInstructions =
	"\nFor impact-v1 follow-ups, preserve the complete original guide and unaffected coverage. Describe cumulative changes since prior explicit approval, independent impact rationale, fresh and reused evidence, checks and risks in a delta note. Safe minor production corrections may retain prior explicit approval after required checks; other changes require renewed acceptance. Filename and line-count restrictions do not apply to this contract. Declared future acceptance/delivery obligations remain pending at their own gates, never call them defects in the code gate.";
/** Openings of every stock guide prompt release; anything else is a custom guide. */
const stockGuideOpenings = [
	"Write the human review brief for the WHOLE PR",
	"Write a complete, guided human review of the WHOLE PR",
	"Write a Rocky-inspired review recap",
];
/**
 * Regenerating a pending guide adopts the current stock show & tell brief with Dig deeper.
 * Custom guide prompts and per-role agent settings stay as the run accepted them.
 */
export function upgradedGuideStep(
	step: WorkflowStep,
): WorkflowStep | undefined {
	if (step.configVersion === "step-config-v1") return;
	if (
		step.type !== "agent" ||
		!step.prompt ||
		!hasCheck(step, "requirement-coverage")
	)
		return;
	if (!stockGuideOpenings.some((opening) => step.prompt!.startsWith(opening)))
		return;
	// Keep the run's accepted contracts: video and impact follow-up instructions.
	const prompt =
		divePrompt +
		(step.videoContract ? briefVideoInstructions : "") +
		(step.prompt.includes(impactGuideInstructions.trim())
			? impactGuideInstructions
			: "");
	if (step.guideContract === DIVE_CONTRACT && step.prompt === prompt) return;
	return { ...step, prompt, guideContract: DIVE_CONTRACT };
}

/** Openings of every stock review-v1 proposer and reviewer prompt release. */
const stockProposalOpening =
	"Inspect the selected repositories, actual module boundaries and conventions";
const stockProposalReviewOpening =
	"Review the architecture candidate and its complete implementation plan";
const checkinReviewPrompt = `Review the check-in and its complete implementation plan against ALL requirements, comments, answers, decisions and inherited Takeover work. Require briefVersion=2 and a check-in a product owner can read in about two minutes: understood restates the human's goal in their terms; plan states the approach; scenes show what people or devices experience before and after as short observable steps; notice names every group that will notice, including upgrades, required configuration and anything that stops working; checks list only calls that need human judgment with the honest alternative; size and split are truthful. Reject jargon, file paths or class names in the check-in, benefit statements in place of behavior, consequences missing from notice, and calls that only the human can judge hidden in decisions. Also require concrete current-state findings, observable deliverables with anticipated files/operations/size estimates and criterion traces, every original acceptance criterion with honest covered/partial/deferred status and plain reason, justified Bob-added work, explicit non-goals, measurable acceptance checks and open decisions with Bob's lean. ${implementationScopeInstructions} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. ${architectureContinuationInstructions} Only when the COMPLETE candidate remains within that latest human acceptance, with no open decisions or unresolved uncertainty, include continuation:{proposalId:"exact accepted proposal ID",version:1,digest:"exact accepted digest",reason:"concrete evidence that cumulative changes preserve the accepted requirements, decisions, boundaries, limits, exclusions and delivery targets"}. This is an independent continuity assessment, never a new human acceptance. Omit continuation for initial proposals, material changes, explicit reapproval requirements, rejection or uncertainty. Compare the check-in to the full plan: reject hidden deliverables, omitted known conditional work or criteria, vague options, limits whose values or measurement selection rules appear only in the full plan, unsupported coverage claims, unnecessary packages or frontend work, and process status masquerading as technical risk. Inspect runtime footprint warnings, including invalid paths, operation mismatches and unchanged map parts listed for work; require correction or a concrete explanation of intentional cross-area/config changes. Assess repository evidence, decisions and options, map, readability and routine classification. Reject proposals that hide a real choice or leave a decision open that the repository already settles. Do not implement. ${architectureQuestionInstructions} Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["concrete required changes"]}.`;
/**
 * Asking for a new version of a pending stock review-v1 proposal adopts the
 * current check-in prompt and reviewer. Custom prompts and agent settings stay
 * as the run accepted them.
 */
export function upgradedArchitectureSteps(
	steps: WorkflowStep[],
): WorkflowStep[] | undefined {
	const proposer = steps.find(
		(s) =>
			s.type === "agent" &&
			s.architectureContract === "architecture-v1" &&
			s.architectureBrief === "review-v1" &&
			s.prompt?.startsWith(stockProposalOpening),
	);
	if (!proposer) return;
	const reviewer = steps.find(
		(s) =>
			s.architectureContract === "architecture-review-v1" &&
			(s.architectureSource ?? "architecture") === proposer.id &&
			s.prompt?.startsWith(stockProposalReviewOpening),
	);
	if (!reviewer) return;
	return steps.map((s) =>
		s === proposer
			? {
					...s,
					prompt: checkinInstructions,
					architectureBrief: "checkin-v1" as const,
				}
			: s === reviewer
				? { ...s, prompt: checkinReviewPrompt }
				: s,
	);
}

/** Extend only the stock handoff route to reuse its already-authorized CI fixer. */
export function upgradeHandoffReadiness(steps: WorkflowStep[]): boolean {
	const handoff = steps.find((step) => step.tool === "handoff");
	const ci = steps.find((step) => step.tool === "ci");
	const fix =
		ci?.branches.find(
			(branch) => branch.when.path === "fix" && branch.when.equals === true,
		)?.next ?? readStep(handoff ?? {}, "fix");
	if (
		!handoff ||
		handoff.branches?.length ||
		(handoff.next && !["end", "human-review"].includes(handoff.next)) ||
		!fix ||
		!steps.some((step) => step.id === fix) ||
		!ci?.branches.some(
			(branch) =>
				branch.next === fix &&
				branch.when.path === "fix" &&
				branch.when.equals === true,
		)
	)
		return false;
	handoff.branches = [{ when: { path: "fix", equals: true }, next: fix }];
	return true;
}

/** Retained definitions for conservative saved-recipe recognition and compatibility. */
export const conservativeWorkflows: Workflow[] = [
	{
		id: "simple",
		name: "Simple / Bob’s Factory",
		icon: "⚡",
		description:
			"The existing Bob’s Factory run, with its original prompts, skills and runner lifecycle.",
		labels: ["workflow:simple"],
		steps: [],
		chat: true,
		allowedTriggers: ["manual", "ticket-assignment"],
		launchFields: [
			{
				name: "prompt",
				label: "What should Bob do?",
				type: "textarea",
				required: true,
				placeholder: "What should Bob do?",
				options: [],
			},
			{
				name: "attachments",
				label: "Attachments",
				type: "files",
				required: false,
				description: "Attach reference material for this workflow.",
				options: [],
			},
		],
	},
	{
		id: "factory",
		name: "Software factory",
		icon: "🏭",
		description:
			"Clarify and plan, then review architecture before coding and deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: ["workflow:factory", "factory"],
		steps: [
			{
				id: "pipeline",
				name: "Factory pipeline",
				branches: [],
				maxVisits: 16,
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		launchFields: [
			{
				name: "prompt",
				label: "What should Bob build?",
				type: "textarea",
				required: true,
				placeholder: "What should Bob build?",
				options: [],
			},
			{
				name: "attachments",
				label: "Attachments",
				type: "files",
				required: false,
				description: "Attach reference material for this workflow.",
				options: [],
			},
		],
	},
	{
		id: "takeover",
		name: "Take over existing work",
		icon: "🤝",
		description:
			"Inspect an existing PR or ticket, clarify remaining work, then continue through the shared factory pipeline. Existing PRs stay draft for human review.",
		labels: ["workflow:takeover", "takeover"],
		steps: [
			{
				id: "existing-work",
				name: "Inspect existing work and discussion",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "inspect-existing",
				args: [],
			},
			{
				id: "assess-existing",
				name: "Assess completed and remaining work",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Inspect the existing worktree, diff, ticket/PR discussion and review feedback. Do not discard or rewrite completed work. Return {"completed":["..."],"remaining":["..."],"risks":["..."],"assets":["..."]}. Identify unresolved feedback and questions to carry into clarification/planning. Do not implement or modify code.',
				json: true,
				askQuestions: false,
			},
			{
				id: "pipeline",
				name: "Continue factory pipeline",
				branches: [],
				maxVisits: 16,
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		launchFields: [
			{
				name: "source",
				label: "Pull/merge request URL or ticket ID",
				type: "text",
				required: true,
				placeholder: "Pull/merge request URL or ATT-123",
				description:
					"Continue the work described by this source. Existing PRs become draft during factory review.",
				options: [],
			},
			{
				name: "prompt",
				label: "Additional instructions",
				type: "textarea",
				required: false,
				placeholder: "Anything to add beyond the existing ticket or PR?",
				options: [],
			},
			{
				name: "attachments",
				label: "Attachments",
				type: "files",
				required: false,
				description: "Attach reference material for this workflow.",
				options: [],
			},
		],
	},
	{
		id: "factory-pipeline",
		name: "Shared factory pipeline",
		icon: "🏭",
		description:
			"Clarify and plan, then review architecture before coding and deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: [],
		steps: [
			{
				id: "clarify",
				name: "Clarify requirements",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. For selectable alternatives, use questionChoices with questionIndex, selection (single or multiple), options (unique id, answer, optional reason) and optional preselectedOptionIds. Do not use questionRecommendations for the same question. Custom text is always available and defaults require explicit submission. Empty questions means everything is understood. Preserve all answered decisions across rounds. Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution. Include deliveryMode:"repository"|"external"|"mixed". Do not ask to authorize unrelated repository implementation for external tasks.',
				json: true,
				askQuestions: true,
			},
			{
				id: "decisions",
				name: "Record decisions",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "record-decisions",
				args: [],
			},
			{
				id: "plan",
				name: "Write implementation plan",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. When taking over, include the existing-work and assess-existing results and PR review discussion; preserve completed work and plan only the remaining changes. Include the existing PR URL/branch and require continuing it. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Do not implement. Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links. Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution. Include deliveryContract:{format:"delivery-v1",version:1,mode:"repository"|"external"|"mixed",authorization:{status:"authorized"|"deferred",reference:"actual instruction/answer reference"},executionReference:"digest supplied in deliveryExecutionReference",targets:[{key:"stable target ID",resource:{provider:"linear",instance:"https://linear.app",workspaceId:"configured workspace",project:"immutable project or team ID",id:"immutable UUID",url:"verified URL"} OR {provider:"taskbot",server:"configured server",instance:"exact HTTPS origin",project:"project slug",id:"numeric ID as string",url:"exact URL"},capabilities:["read","content","relationships"],baseline:{fields:{title:"observed title",description:"complete observed content"},relationships:[{type:"blocks"|"related",from:"immutable ID",to:"immutable ID"}]},operations:[{id:"stable operation ID",kind:"content",fields:{description:"full desired content"}} OR {id:"stable ID",kind:"add"|"remove",relationship:{type:"blocks"|"related",from:"ID",to:"ID"}}],criteria:[{id:"stable criterion",requirementRef:"accepted requirement reference",description:"observable acceptance criterion",fields:{description:"full expected content"},relationships:[],absentRelationships:[]}],preservedRelationships:[]}]}. Repository mode uses targets:[]; external/mixed need complete targets. Fetch complete before-state and verify coordinates through configured integrations. Do not mutate. Store no credentials. Include full expected fields and preserved relationships. On correction increment version and use new operation IDs for changed intents; retain already-applied history.',
				json: true,
				askQuestions: false,
			},
			{
				id: "plan-review",
				name: "Review implementation plan",
				next: "delivery-route",
				branches: [
					{
						when: {
							path: "approved",
							equals: false,
						},
						next: "plan",
					},
				],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Review the plan against ALL input/comments/metadata and decisions. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["specific missing requirements or improvements"]}. Approve a practical MVP plan when complete. Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution. Confirm delivery mode, target identities, authorization, complete baseline, allowed operations and every criterion. Return deliveryContractDigest using the supplied deliveryCandidateDigest only when approving that exact contract. Incomplete or contradictory contracts cannot be approved.',
				json: true,
				askQuestions: false,
			},
			{
				id: "architecture",
				name: "Prepare the check-in",
				branches: [],
				maxVisits: 16,
				type: "agent",
				architectureContract: "architecture-v1",
				architectureBrief: "checkin-v1",
				prompt:
					'Before Bob builds anything, he checks his plan with the human, the way a good colleague walks over and says "got two minutes before I start?". Your output is that check-in, plus the complete plan and evidence the automated reviewer verifies.\n\nInspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover\'s completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance.\n\nTreat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy.\n\nFor a follow-up proposal, compare the COMPLETE current candidate cumulatively with the latest explicitly human-accepted architecture in architectureProposals and architectureDecisions, not just the preceding generated version. Retain settled decisions and exclusions. The original design\'s complexity does not itself require another approval. Necessary caller/test wiring, file discoveries and implementation details within the accepted requirements and boundaries do not create a new human decision. Do not turn Bob-authored file manifests into user restrictions. Material changes to requirements, responsibilities, interfaces, security/operating limits, delivery targets, explicit human/repository restrictions or non-goals, and unresolved human-dependent choices still need their applicable authorization. Explain the actual change and its evidence; uncertainty must remain visible.\n\nWHY THE HUMAN IS ASKED\nAn independent reviewer already checks that every requirement is traced, files are real and the plan is consistent. The human is asked only for what a human can catch while it is still cheap to change course: you misunderstood what they want; a call you made does not fit their product, customers or team; the consequences for people are unacceptable; or the work is the wrong size. Write the check-in for exactly that.\n\nTHE CHECK-IN (talk) - spoken, first person, everyday words, about two minutes to read in total (at most 350 words across all talk fields). No file paths, class names, endpoints or jargon a product owner would not use; say what people experience. Concrete numbers where they matter ("every 30 seconds", "up to 128 waiting devices").\n- understood (max 360): "You want ... so that ...", then what done looks like to them. This is the first thing the human confirms, so restate their goal in their terms, not your solution.\n- plan (max 480): "I\'d ..." in two to four sentences: the approach, not the task list.\n- scenes: 1-3 whiteboard sketches of what a person or device experiences, before and after, as short steps (max 90 characters each; before 1-5 steps, after 1-6). Pick the moments the change is really about, e.g. title "A new reader joins": before ["Reader connects", "It is registered automatically"], after ["Reader shows a code that changes every 30 seconds", "An administrator types or scans the code", "Only then is the reader registered"].\n- notice: up to 5 groups of people, devices, integrations or operators that will notice once this ships, and how (who max 40, what max 200). Include upgrades, configuration they must set and anything that stops working. [] only when nobody outside the code notices.\n- checks: up to 3 calls you made that need human judgment (product, customers, cost, habits), the least certain first. say (max 260): "I went with ... because ..."; instead (max 220): the other way and what it would mean for people. Link decision when the call is one of decisions. Do not list calls the repository or the human\'s answers already settle; those stay in decisions. Open decisions are questions, never checks.\n- size (max 240): how big this is in human terms: how many separate things change, which parts of the product, rough effort. split (max 240, optional): a sensible way to split it into smaller deliveries if one exists, and what each would deliver first.\n\nWHAT THE REVIEWER CHECKS (Bob\'s notes; the human opens these only to dig)\n- title (max 80): what will be true afterwards. summary (max 320): current gap, proposed change, scope boundary.\n- problem: 1-3 findings about how things behave today, tied to inspected files. No invented defects.\n- decisions: every real choice with 2-4 concrete options. Decide it yourself (decidedBy=bob) when repository evidence or requirements settle it; mark it open only for human-dependent habits, scope or cost, give why, and set lean to the option you would take. Open decisions block approval; never hide a real choice or leave open one the repository settles.\n- criteria: EVERY original acceptance criterion, including independent/external/hardware checks this PR cannot complete; preserve meaning and source. Without explicit criteria, derive clearly sourced requirements. Coverage is what this plan will deliver, not completed evidence; partial means useful preparation with an explicit remaining part; deferred has no deliverable. The human sees partial and deferred items as "what this will not fully prove", so make their reason plain.\n- nonGoals: specific exclusions. acceptance: 3-6 measurable checks; never claim future physical tests or independent review have passed. risks: up to 6 concrete product/technical consequences with what limits each; workflow or ticket status is not a risk. Do not defer mandatory baseline security if the request makes it a prerequisite.\n- map: the system view for engineers: 1-4 areas, at most 10 parts (label max 24, note max 32), links with 1-2 word labels. unchanged parts give context only and cannot also be listed for file changes. Add option previews when an alternative changes the map.\n- evidence: why this design fits the existing architecture, tied to inspected paths.\n- candidate: the COMPLETE self-contained implementation plan; the implementer receives only the accepted plan and assets. Each step: what gets built and observable behavior, kind, relative size, traces ({"criterion":"AC1"} for requested work or {"added":"concrete necessity and why it was not requested"} for Bob-added work; never hide extras behind unrelated criteria) and every anticipated file change with exact repo-relative path and new/edit/delete, including tests, docs, configuration and known conditional edits with their triggers. Inspect callers and test wiring before estimating. Do not invent files or add UI/screenshots for a backend-only task without an explicit reason. Name the number and subject of documents. For limits chosen through measurement, state the selection rule and starting constraints; never invent measured values.\n\nNEW VERSIONS\nList every change to the plan since the previous version in changes (max 200 each; from=you when the human asked for it, bob when you added it) and set decidedBy=you for human-settled decisions. The human reads changes first on a new version, so say plainly what you did with each of their notes. Describe what changed in the plan, never approval or authorization status, reviewer process or what was not changed; the runtime tracks those. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization.\n\nLIMITS\nproblem observations and nonGoals 320; criterion text 1200; criterion reason, deliverable what and acceptance checks 480; added-work reason 320; deliverable title and decision question 120; IDs and option name 60; option upside/catch 160; decision why, map detail and risks 240; evidence at most 6.\n\nReturn ONLY architecture-v1 with briefVersion=2:\n{"architectureContract":"architecture-v1","briefVersion":2,"classification":"meaningful or routine","rationale":"concrete classification reason","title":"...","summary":"...","talk":{"understood":"You want ...","plan":"I\'d ...","scenes":[{"title":"...","before":["..."],"after":["..."]}],"notice":[{"who":"...","what":"..."}],"checks":[{"decision":"optional decision id","say":"I went with ...","instead":"..."}],"size":"...","split":"optional"},"problem":[{"repository":"selected repo","paths":["inspected existing file"],"observation":"..."}],"decisions":[{"id":"storage","question":"plain question","why":"required when open","status":"decided or open","pick":"option id, only when decided","decidedBy":"bob or you, only when decided","lean":"option id, only when open","options":[{"id":"a","name":"concrete option","upside":"...","catch":"...","preview":{"parts":[],"links":[],"hide":[]}}]}],"criteria":[{"id":"AC1","text":"complete original criterion text","source":"ticket identifier and criterion number, or user requirement","url":"optional actual source HTTP URL","status":"covered or partial or deferred","reason":"..."}],"nonGoals":["..."],"acceptance":["..."],"changes":[{"text":"...","from":"you or bob"}],"risks":["..."],"map":{"areas":[{"id":"area","name":"Area name"}],"parts":[{"id":"part","label":"...","note":"...","detail":"plain sentence","file":"optional repo-relative path","area":"area","status":"new or changed or unchanged or outside"}],"links":[{"from":"part","to":"part","label":"optional"}]},"evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"..."}],"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating every accepted requirement/decision, repository/base/delivery targets, inherited Takeover PR/work and validation expectations","steps":[{"id":"D1","title":"...","what":"...","kind":"code or test or docs or config","size":"S or M or L","traces":[{"criterion":"AC1"}],"files":[{"path":"complete repo-relative file path","change":"new or edit or delete","repository":"selected repo id; required for grouped repositories"}]}],"assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}\n\nMeaningful proposals need a map and at least one decision. Routine outputs may omit map and decisions but still need the check-in and scope fields. Never return footprint/counts or approval fields; the runtime computes footprint from listed files and actual repository boundaries. Independent child delivery is separate future work, not executable scheduling here.',
				json: true,
				askQuestions: false,
			},
			{
				id: "architecture-review",
				name: "Review the check-in",
				branches: [
					{
						when: {
							path: "approved",
							equals: false,
						},
						next: "architecture",
					},
				],
				maxVisits: 16,
				type: "agent",
				architectureSource: "architecture",
				architectureContract: "architecture-review-v1",
				prompt:
					'Review the check-in and its complete implementation plan against ALL requirements, comments, answers, decisions and inherited Takeover work. Require briefVersion=2 and a check-in a product owner can read in about two minutes: understood restates the human\'s goal in their terms; plan states the approach; scenes show what people or devices experience before and after as short observable steps; notice names every group that will notice, including upgrades, required configuration and anything that stops working; checks list only calls that need human judgment with the honest alternative; size and split are truthful. Reject jargon, file paths or class names in the check-in, benefit statements in place of behavior, consequences missing from notice, and calls that only the human can judge hidden in decisions. Also require concrete current-state findings, observable deliverables with anticipated files/operations/size estimates and criterion traces, every original acceptance criterion with honest covered/partial/deferred status and plain reason, justified Bob-added work, explicit non-goals, measurable acceptance checks and open decisions with Bob\'s lean. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. For a follow-up proposal, compare the COMPLETE current candidate cumulatively with the latest explicitly human-accepted architecture in architectureProposals and architectureDecisions, not just the preceding generated version. Retain settled decisions and exclusions. The original design\'s complexity does not itself require another approval. Necessary caller/test wiring, file discoveries and implementation details within the accepted requirements and boundaries do not create a new human decision. Do not turn Bob-authored file manifests into user restrictions. Material changes to requirements, responsibilities, interfaces, security/operating limits, delivery targets, explicit human/repository restrictions or non-goals, and unresolved human-dependent choices still need their applicable authorization. Explain the actual change and its evidence; uncertainty must remain visible. Only when the COMPLETE candidate remains within that latest human acceptance, with no open decisions or unresolved uncertainty, include continuation:{proposalId:"exact accepted proposal ID",version:1,digest:"exact accepted digest",reason:"concrete evidence that cumulative changes preserve the accepted requirements, decisions, boundaries, limits, exclusions and delivery targets"}. This is an independent continuity assessment, never a new human acceptance. Omit continuation for initial proposals, material changes, explicit reapproval requirements, rejection or uncertainty. Compare the check-in to the full plan: reject hidden deliverables, omitted known conditional work or criteria, vague options, limits whose values or measurement selection rules appear only in the full plan, unsupported coverage claims, unnecessary packages or frontend work, and process status masquerading as technical risk. Inspect runtime footprint warnings, including invalid paths, operation mismatches and unchanged map parts listed for work; require correction or a concrete explanation of intentional cross-area/config changes. Assess repository evidence, decisions and options, map, readability and routine classification. Reject proposals that hide a real choice or leave a decision open that the repository already settles. Do not implement. When a genuine product, privacy or architecture choice requires human input that the accepted answers and repository do not settle, return approved:false and questions:["the concrete unresolved choice and its consequences"], with feedback describing any candidate changes needed. The runtime asks these questions before another drafting pass, then follows the accepted rejection route to revise and independently review the candidate using the saved answer. Do not repeat unchanged drafting to obtain an answer or invent a policy. Questions and answers never accept an architecture proposal; exact-candidate review and any required human architecture acceptance still follow. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["concrete required changes"]}.',
				json: true,
				askQuestions: false,
			},
			{
				id: "architecture-decision",
				name: "Check in with you",
				next: "implement",
				branches: [
					{
						when: {
							path: "decision",
							equals: "revise",
						},
						next: "architecture",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "architecture-decision",
				args: [],
				arguments: {
					proposal: "architecture",
					review: "architecture-review",
					planOutput: "plan",
					revise: "architecture",
					approval: "meaningful",
					continueAccepted: true,
				},
			},
			{
				id: "implement",
				name: "Implement accepted plan",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Implement the provided plan and use its assets. Read /answers alongside /plan for subsequent human responses, including resolution of implementation blockers. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Follow repository conventions and appropriate verification. If implementation is forbidden, deferred, or blocked by missing access or a necessary decision, preserve completed work and return {"status":"blocked","summary":"concrete blocker","checks":["commands and outcomes"],"questions":["specific question or action needed to unblock implementation"]}. The workflow waits for an answer and resumes this role; do not report deferred or unfinished work as completed. Only after completing implementation return {"status":"completed","summary":"...","checks":["commands and outcomes"],"questions":[]}. Do not create or publish a PR; the next step handles delivery. If subsequent answers or steering materially change the accepted architecture, preserve completed work and return status=blocked, architectureRevision=true, summary explaining the changed requirement, checks, and questions=[]. The runtime returns to architecture proposal/review and requires fresh acceptance when meaningful. Never implement a materially changed architecture using acceptance of an earlier version.',
				inputs: ["plan"],
				json: true,
				askQuestions: true,
			},
			{
				id: "draft-pr",
				name: "Push and create draft PR",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "draft-pr",
				args: [],
			},
			{
				id: "extract-requirements",
				name: "Extract requirements",
				branches: [],
				maxVisits: 16,
				type: "agent",
				reviewContract: "inventory-v1",
				prompt:
					'Extract scope independently of the implementation. Read complete originalInput (parse embedded JSON), ticket/acceptance criteria, ALL paginated comments, attachments/assets, clarification answers and accepted decisions/plan, later chat/human steering, takeover/PR discussions and past review rounds/dispositions through factory-context. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for historical claims and reasoning, following original outputPath records when scope or disagreement evidence is needed. Follow nextOffset to null. Missing source access requires a concrete questions entry; never omit unavailable scope. Read previous inventories, retain every historical ID and decision, and record amendments/supersessions with changeReason. Suggestions are not accepted scope. Contradictions stay in conflicts and questions until explicitly resolved outside fanout. Scope decisions require explicit human acceptance, rationale and source, not a reviewer preference. Follow the runtime decision-attribution rule: use a recorded name when available, otherwise identify the Factory operator with the name not recorded; do not ask for a name merely to complete attribution. Use kind:"skip" only for an explicit scope waiver, and list the precise requirementIds it authorizes skipping; other accepted scope decisions use kind:"scope". List considered sources and unavailable sources in sourceReceipt. Semantic extraction completeness needs source inspection; structural validation alone cannot prove it.\nReturn {"schemaVersion":1,"requirements":[{"id":"R1","criterion":"testable accepted outcome","classification":"active or suggestion or superseded","sources":[{"source":"originalInput or context record or source URL","reference":"JSON Pointer/comment/attachment identifier"}],"changeReason":"required for an amendment","supersedes":[]}],"decisions":[{"id":"D1","acceptedBy":"recorded person or Factory operator (name not recorded)","kind":"scope or skip","requirementIds":["R1"],"rationale":"accepted scope rationale","source":{"source":"source","reference":"record identifier"}}],"conflicts":[{"id":"C1","description":"unresolved scope question","sources":[{"source":"source","reference":"record"}]}],"sourceReceipt":{"considered":[{"source":"source","reference":"record"}],"unavailable":[]},"questions":[]}. Runtime owns inventory version/digest. Do not change product files.',
				json: true,
				askQuestions: true,
			},
			{
				id: "specialist-review",
				name: "Parallel specialist review",
				branches: [],
				review: {
					inventory: "extract-requirements",
				},
				maxVisits: 16,
				type: "fanout",
				groups: [
					[
						{
							id: "security-review",
							name: "Security and data protection",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "specialist-v1",
							prompt:
								'Own authorization, trust boundaries, secrets, untrusted input and consequential data exposure. Avoid general style or business scope review.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
					[
						{
							id: "architecture-review",
							name: "Architecture and module boundaries",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "specialist-v1",
							prompt:
								'Own responsibilities, dependency direction, domain/API seams and interface compatibility. Avoid speculative redesign and local style.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
					[
						{
							id: "integration-review",
							name: "Repository fit and integration",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "specialist-v1",
							prompt:
								'Own repository conventions, established reuse, config/migration wiring and surrounding integrations. Identify concrete omitted integration sites.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
					[
						{
							id: "simplicity-review",
							name: "Simplicity and maintainability",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "specialist-v1",
							prompt:
								'Own unnecessary abstraction, duplication, speculative extensibility and disproportionate complexity. Explain maintenance cost and a smaller sufficient alternative.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
					[
						{
							id: "correctness-review",
							name: "Correctness and verification",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "specialist-v1",
							prompt:
								'Own behavioral failures, boundaries, state/concurrency, error handling and actual verification gaps. Ground complaints in reproduction or code evidence.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
					[
						{
							id: "requirements-review",
							name: "Business requirements and acceptance",
							branches: [],
							maxVisits: 16,
							type: "agent",
							reviewContract: "coverage-v1",
							prompt:
								'Own complete acceptance coverage. Assess EVERY active requirement exactly once; preserve superseded/suggestion records as context. Return coverage:[{requirementId,status:\'met or not_met or deliberately_skipped\',evidence:[\'concrete evidence at frozen revision\'],reason:\'why\',decisionId:\'accepted decision for deliberate skip\'}] alongside review fields. Missing or inconclusive evidence is not_met, with an actionable open rating 2/3 finding referencing the ID. A skip needs an explicitly accepted decision, recorded person or unnamed Factory operator, rationale and source. Missing personal-name metadata alone cannot block coverage. Do not let reviewer/fixer preference waive scope.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
							json: true,
							askQuestions: false,
						},
					],
				],
			},
			{
				id: "review-gate",
				name: "Aggregate specialist findings and coverage",
				branches: [
					{
						when: {
							path: "approved",
							equals: false,
						},
						next: "code-fix",
					},
				],
				review: {
					inventory: "extract-requirements",
					fanout: "specialist-review",
				},
				maxVisits: 200,
				type: "tool",
				tool: "review-gate",
				args: [],
			},
			{
				id: "ci",
				name: "Watch merge readiness",
				branches: [
					{
						when: {
							path: "fix",
							equals: true,
						},
						next: "ci-fix",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "ci",
				args: [],
			},
			{
				id: "visual-scope",
				name: "Plan QA stories and screenshots",
				branches: [],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 16,
				type: "agent",
				prompt:
					'Read the accepted requirements, all recorded decisions/expectations, plan, implementation receipts, relevant history and exact cumulative base-to-head PR diff (including inherited takeover work). Plan observable QA for ALL changed behavior: UI, API, CLI and other interfaces. Declare environment:{isolation:"worktree"} only when all QA uses independent per-worktree servers, databases and fixtures. For shared clusters, databases, fixtures or browser control return environment:{isolation:"shared",resources:["stable shared resource identity"]}; use the same identity across repositories/runs using that resource. Unknown isolation requires shared protection, never assume a worktree isolates external resources. Cover happy paths and consequential failure, permission and boundary cases proportionately. Trace stories to agreed requirements; do not invent business requirements or turn subjective preferences into blocking criteria. Explain any requirement/diff area outside executable QA in exclusions. Assess navigation, feedback, readability and recovery where relevant.\nReturn {"qaContract":"qa-v1","changed":false,"areas":[],"captureBudget":24,"stories":[{"id":"stable-story-id","goal":"user goal","requirementRefs":["requirements/0 or decisions/0 or answers/0 (existing zero-based accepted record)"],"interface":"ui or api or cli or other","preconditions":["setup"],"fixtures":["access or data needed"],"actions":["ordered executable action"],"criteria":[{"id":"globally unique stable criterion ID","expected":"observable expected outcome"}],"evidenceInstructions":"how to execute and record evidence","screenshotTasks":[{"area":"exact selected area","state":"exact selected state at a defined point in these actions"}]}],"exclusions":[{"requirementRef":"requirement/diff area","reason":"concrete reason outside executable QA"}]}.\nchanged refers only to VISUAL scope. Nonvisual changes still need executable stories with real behavioral checks and may have zero screenshots. No changed executable behavior may use stories=[] only with a concrete notApplicableReason; no visual changes is insufficient. Inspect relevant existing tests before selecting them as criterion evidence.\nFor visuals return changed=true and areas:[{name,url,states:["single concrete representative state"],instructions,rationale,dependencies,changed}]. Normally choose 1–2 states per area and at most 24 screenshots. Group co-visible elements. Never multiply viewport/language/role combinations or comma-separated alternatives. Additional states must show distinct changed rendering risk. Up to 48 needs a concrete budgetReason. Every selected area/state must be linked to a story; API/CLI checks do not need artificial images. Dependencies are exact repository files or directory/** paths. Do not change code, execute QA or take screenshots.\nFor video-v1 return videoContract:"video-v1", videoTasks:[{id,title,storyIds,criterionIds,rationale,steps,dependencies,environment,targetSeconds,required,changed}] and videoReason when none are selected. Select up to three useful authentic demonstrations independently of visual changed: normally one 30–90 second main changed flow, optionally distinct flows. Do not require recordings for backend-only work or pad a shorter real flow. Link existing QA story/criterion IDs, exact source files/directory/** dependencies (including shared assets), fixture/environment assumptions and executable steps. required=true only when accepted requirements explicitly require that recording. Backend-only or unavailable recording needs a concrete reason; never substitute slideshows. On repeats retain the complete tasks; changed=false only for proven unaffected sources, scenarios and fixtures. For specialist review runs, use the frozen review-gate.baseline.inventory active stable IDs as requirementRefs. Every active ID needs a relevant executable story or a justified exclusion, including accepted skips. QA exclusion does not waive scope. Earlier business coverage cannot override failed/blocked required QA.',
				json: true,
				askQuestions: false,
			},
			{
				id: "capture",
				name: "Execute QA and capture screenshots",
				next: "visual-review",
				branches: [],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 16,
				type: "agent",
				prompt:
					'Execute EVERY planned QA story and acceptance criterion from visual-scope, including nonvisual API/CLI behavior. Read /answers for resolved access, fixtures and tooling blockers. Set up the application once when needed, use appropriate actual fixtures, and execute browser/HTTP/CLI/tests as instructed. Inspect test coverage and run the checks; source inspection or an implementation receipt alone cannot establish a pass. Compare observed outcomes with each exact expected outcome. Assess applicable navigation, feedback, readability and recovery. Do not modify product code or repair failures.\nReturn {"qaContract":"qa-v1","results":[{"storyId":"planned ID","outcome":"passed or failed or blocked","criteria":[{"criterionId":"planned ID","outcome":"passed or failed or blocked","expected":"exact expected outcome from scope","observed":"actual observed outcome","blockedReason":"concrete assistance needed when blocked","evidence":[{"kind":"command or test or http or browser or log","executed":true,"action":"actual command/request/actions performed","details":"exit/result/request-response/log details demonstrating this criterion","exitCode":0,"screenshotTasks":[{"area":"selected area","state":"selected state"}]}]}]}],"findings":[{"id":"stable finding ID","rating":3,"summary":"consequential requirement failure","evidence":"concrete receipt","status":"open","storyId":"planned ID","criterionId":"planned criterion ID","requirementRefs":["accepted requirement"],"reproduction":["steps"],"expected":"expected behavior","actual":"actual behavior"}],"observations":[{"id":"stable observation ID","summary":"optional UI/UX improvement","evidence":"observed details","storyId":"story ID"}],"screenshots":[{"path":"absolute real image path","caption":"what it demonstrates","area":"exact area","state":"exact state"}],"unavailable":[{"area":"selected area","reason":"concrete missing access/tooling/setup or failed behavior","cause":"access or product"}]}.\nOne result per story and criterion. Ratings 2/3 are consequential failures against agreed requirements; keep optional preferences in observations. Product failures are failed with actionable findings. If failed product behavior prevents a selected screenshot, report unavailable with cause:"product" linked to that failing story; missing access/tooling uses cause:"access". Missing access, fixtures or tooling is blocked with a concrete reason; never pass an unexecuted check. Story outcome must agree with criterion outcomes. Do not supply a revision claim; runtime stamps provenance. Execute criteria freshly on each visit; image reuse never establishes a behavioral pass.\nCapture exactly the selected representative screenshot tasks at their defined points DURING the story flows. Keep the captureBudget (normally 24, justified maximum 48), one real PNG/JPEG per exact area/state. Do not invent states or expand combinations. Save images under the supplied evidence directory with fresh filenames for each revision; inspect actual captures for readability. Keep the complete inventory, including provenance-eligible explicitly accepted unchanged images. Never claim images or checks that do not exist. Stop only servers you started, after all testing and captures finish.\nFor video-v1 return videoContract:"video-v1", videos:[{taskId,path,caption,recorder,receipt:{executed:true,action,details},storyIds,criterionIds,viewport:{width,height},transcript,environment,posterPath,captionsPath?,reused?}], videoUnavailable:[{taskId,reason,cause:"tooling"|"export"|"product"}]. Cover each selected task once. Record REAL interactions on the existing server with seeded non-sensitive data and readable pacing. Check command -v agent-browser, ffmpeg and ffprobe; inspect agent-browser record --help. Launch a fresh owned headless session: agent-browser --headed false --session <unique-run-session> open <url>. Start recording to a fresh video-temp-<unique>.webm inside the evidence directory, execute planned interactions, stop recording, then export a fresh finalized clip. Prefer MP4/H.264 yuv420p with fast start: ffmpeg -i <recording> -c:v libx264 -pix_fmt yuv420p -movflags +faststart <fresh>.mp4. Installed Playwright fallback must launch headless:true, create a context with recordVideo and matching readable viewport, await context.close() before video.saveAs(). Never open desktop windows or attach to an existing browser. Do not silently install global recording tools. Stop only owned sessions/servers. Generate a real poster frame (ffmpeg -i <clip> -frames:v 1 <poster>.png), inspect it, and supply a concise transcript of actual visible steps/outcomes; audio requires timed WebVTT captions. Limits: three clips, 120 seconds and 50 MiB per clip, 512 MiB evidence per run. Normal target 30–90 seconds. Do not fabricate metadata: runtime probes, decodes and hashes media. Remove failed temporary exports owned by this attempt; preserve finalized referenced evidence. Missing tools/export failures are explicit limitations, not product passes. Product failure needs failed behavioral QA and an actionable finding. Required missing recordings remain blocked. Reuse only previous explicitly playback-accepted bytes with unchanged task/scenarios, source dependencies, fixtures/environment and clean verified revision; retain original provenance and include reused=true. Supply fresh recordings for changed/uncertain flows. Execute behavioral criteria freshly even when video is reusable.',
				json: true,
				askQuestions: false,
			},
			{
				id: "visual-review",
				name: "Review QA and screenshots",
				next: "visual-gate",
				branches: [],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 16,
				type: "agent",
				prompt:
					'Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.\nThis is a QA AND SCREENSHOT review. Return qaContract:"qa-v1" alongside the review fields. Inspect accepted business requirements and expectations, cumulative diff, planned stories, complete criterion coverage, executed test receipts, failures, blocked checks, optional observations and all retained disputes. A screenshot alone cannot prove behavior, and an agent saying passed without actual executed evidence is insufficient. Missing/blocked required QA cannot be approved. Failed required behavior requires a fix and retest even when a fixer rejects a complaint. Corrections to erroneous scenarios must match accepted requirements and record a rationale.\nOpen the actual selected screenshots. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good image, using its exact supplied hash. Exclude images affected by unresolved findings. Missing critical SELECTED states is rating 3; do not invent larger viewport/language/role matrices. Request only minimum targeted replacements by exact area/state. Preserve explicitly accepted unchanged image receipts and optional observations without making preferences blocking. Return complete current coverage, not merely the latest delta. Do not execute QA again, change code or recapture images.\nFor video-v1 inspect ACTUAL playback and demonstrated steps for each supplied clip, using an available headless player/tool. A poster or metadata alone is insufficient. Return acceptedVideos:[{taskId,sha256,inspectedPlayback:true}] only for individually inspected acceptable clips, using exact runtime hashes. Preserve exact receipts for eligible unchanged reused clips. If playback cannot be inspected, disclose the limitation and omit its acceptance receipt. Review videoUnavailable without manufacturing acceptance: optional missing tools/export remain disclosed limitations, required recordings stay blocked, product failures require fixes. Videos supplement representative screenshots and fresh behavioral QA. Do not waive human approval.',
				json: true,
				askQuestions: false,
			},
			{
				id: "visual-gate",
				name: "QA and screenshot gate",
				next: "guide",
				branches: [
					{
						when: {
							path: "approved",
							equals: false,
						},
						next: "visual-fix",
					},
				],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 200,
				type: "tool",
				tool: "visual-gate",
				args: [],
			},
			{
				id: "code-fix",
				name: "Fix review findings",
				next: "extract-requirements",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\nRead /reviewFix/findings for ALL unresolved consequential findings, even when customized recipe inputs hide the gate. If /reviewFix/review is incomplete, its retained findings are correction inputs, never completed review or approval. Repair concrete findings and preserve the declared independent reassessment; report missing access or evidence in questions. When no usable findings exist, identify the configured review work that must run again instead of claiming review passed. Return a fixed or evidence-backed rejected disposition for each finding you can address. If the correction needs a materially changed architecture or a genuine scope revision, preserve work and use the existing configured proposal route: return status:"blocked", architectureRevision:true, a concrete summary, dispositions only for findings already addressed, and questions:[]. The runtime redrafts and independently reviews the proposal before any required exact-candidate acceptance. This handback leaves unresolved findings open and never authorizes implementation or delivery. Do not ask the human to schedule proposal drafting. If no applicable route exists, report that specific limitation. If missing deployment, access, fixtures, evidence or a necessary human decision prevents progress, return questions:["specific assistance needed"] alongside summary and dispositions; asking only in summary does not pause the workflow. Never mark blocked findings fixed or rejected merely to advance. Return questions:[] when assistance is unnecessary. Read /reviewFix/answers before retrying. An answer does not waive findings, required QA or approval. A rejected complaint still receives reviewer reassessment.',
				json: true,
				askQuestions: false,
			},
			{
				id: "ci-fix",
				name: "Fix CI failures",
				next: "after-ci-fix",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using the selected Git provider (GitHub: write a token-free JSON request file with method POST, path graphql and body {query,variables}, set repoUrl to the selected HTTPS repository URL and requestFile to that file, then run sh -c "$BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND github-api \\"\\$@\\"" bobs-factory --repo "$repoUrl" --request "$requestFile" with the resolveReviewThread mutation; GitLab: glab api PUT the MR discussion with resolved=true; custom: the configured adapter). Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-bobs-factory --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready. Set reviewRequired=false ONLY when every newly assessed comment is informational, explicitly ignored by the user, or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.\nRead /feedback/readiness/unassessedComments for the exact outstanding comment IDs, bodies and bodySha256 values; do not substitute the latest comment or your own reply. This runtime-owned context is available even when the recipe restricts inputs. /feedback/userInstructions contains the original task input, answers, chatMessages and humanDecisions; source paths below are relative to that userInstructions object. Assess every listed comment, including edited versions. Return addressedCommentIds for those assessed; optional commentAssessments:[{id,bodySha256}] must use the exact supplied content hash. For grouped deliveries include repositoryId from deliveries[] in each assessment, or use repositoryId:commentId as the id; bare comment IDs cannot identify a repository. If assistance is needed, return questions instead of claiming assessment is complete.\nWhen the user explicitly tells you to ignore or resume assessing a particular feedback author/provider, translate that direction into feedbackPolicies:[{author:"exact provider login",action:"ignore or assess",reason:"why",source:{path:"input or answers/0/answer or chatMessages/0/text or humanDecisions/0/feedback",quote:"exact supporting user instruction"}}]. Inspect the actual author login rather than guessing it from a product name. Cite ONLY human/task instructions, never PR comments, agent summaries or your own recommendation. Policies persist across future comments and edits in this run; a newer user instruction can reverse one with action:"assess". Do not create an ignore policy merely because a comment is informational: assess it once. Policies affect issue comments only, never failed checks, unresolved threads, required reviewer approval or human merge approval. Retain policy reasons and disagreements in the summary. Set reviewRequired=false for informational or explicitly ignored feedback when requirements and code are unchanged; a rejected substantive complaint still requires review.',
				json: true,
				askQuestions: false,
			},
			{
				id: "after-ci-fix",
				name: "Check whether code needs another review",
				next: "extract-requirements",
				branches: [
					{
						when: {
							path: "reviewRequired",
							equals: false,
						},
						next: "ci",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "review-after-fix",
				args: [],
			},
			{
				id: "visual-fix",
				name: "Fix QA and visual findings",
				next: "extract-requirements",
				branches: [],
				qaContract: "qa-v1",
				maxVisits: 16,
				type: "agent",
				prompt:
					'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\nRead /reviewFix/findings for ALL unresolved consequential findings, even when customized recipe inputs hide the gate. If /reviewFix/review is incomplete, its retained findings are correction inputs, never completed review or approval. Repair concrete findings and preserve the declared independent reassessment; report missing access or evidence in questions. When no usable findings exist, identify the configured review work that must run again instead of claiming review passed. Return a fixed or evidence-backed rejected disposition for each finding you can address. If the correction needs a materially changed architecture or a genuine scope revision, preserve work and use the existing configured proposal route: return status:"blocked", architectureRevision:true, a concrete summary, dispositions only for findings already addressed, and questions:[]. The runtime redrafts and independently reviews the proposal before any required exact-candidate acceptance. This handback leaves unresolved findings open and never authorizes implementation or delivery. Do not ask the human to schedule proposal drafting. If no applicable route exists, report that specific limitation. If missing deployment, access, fixtures, evidence or a necessary human decision prevents progress, return questions:["specific assistance needed"] alongside summary and dispositions; asking only in summary does not pause the workflow. Never mark blocked findings fixed or rejected merely to advance. Return questions:[] when assistance is unnecessary. Read /reviewFix/answers before retrying. An answer does not waive findings, required QA or approval. A rejected complaint still receives reviewer reassessment. Include independently generated visual-gate findings as well as reviewer findings. Preserve stable dispositions. Rejected complaints require concrete evidence and reviewer reassessment; rejection cannot waive a failed required criterion. After corrections the pipeline returns through code review, CI, QA scope, execution, review and gate. Failed criteria must be retested before the human guide.',
				json: true,
				askQuestions: false,
			},
			{
				id: "guide",
				name: "Prepare human review brief",
				next: "handoff",
				branches: [],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 16,
				type: "agent",
				guideContract: "brief-v3",
				prompt:
					'Write the human review brief for the WHOLE PR at the current revision, including inherited takeover work and every accepted iteration. The reader decides one thing: does this PR deliver what was asked? Answer in this order: was the right thing built (the ask and every interpretation of it), does it work (one decisive, human-checkable proof per requirement), what only a human can judge, and what else changed or remains unproven.\nFirst read through factory-context: the original input/ticket and all comments, clarification decisions and answers, the frozen requirement inventory and review-gate coverage, the accepted plan, /progress/reviewScope (every whole-PR file), executed QA stories with observed values, and the accepted capture inventory. Inspect the actual base-to-head diff yourself.\nReturn {"verdict":{"headline":"what now works, said the way a user would say it (<=160 chars)","readiness":"ready|ready-with-caveats|not-ready","why":"one sentence (<=260)"},"ask":{"source":"e.g. Linear ATT-764","url":"ticket URL when known","quote":"the original request verbatim, trimmed to its substance"},"interpretation":[{"topic":"short","chosen":"what was built","alternatives":["what the ask could also have meant"],"decidedBy":"you|ticket|bob","note":"optional, e.g. You delegated this choice."}],"requirements":[{"id":"kebab-id","text":"observable outcome (<=180)","origin":"ask|your-answer|bob","covers":["frozen inventory requirement IDs"],"status":"shown|tested|partly|not-shown|gap|waived","proof":PROOF,"more":[PROOF],"caveat":"optional limit specific to this line","files":["exact changed files that implement it"]}],"yourCall":[{"question":"...?","context":"the facts a person needs","bobChose":"what was built and why","proof":PROOF}],"beyondAsk":[{"what":"...","why":"...","attention":"none|low|look","files":["..."]}],"notVerified":[{"what":"...","why":"..."}],"noticed":["pre-existing problem seen but not changed"],"hygiene":[{"text":"satisfied process criterion, e.g. No generated code committed","covers":["inventory IDs"]}]}. Add "system" only as described below.\nPROOF is exactly one of:\n{"kind":"screens","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}],"note":"optional"}: focus crops the image, in percent, to the pixels that prove the claim (open the image to choose it). Prefer pairs varying only the condition under test (English vs German, setting A vs B, before vs after).\n{"kind":"video","taskId":"...","sha256":"...","label":"..."}: from the accepted video inventory.\n{"kind":"table","method":"how it was observed","columns":["Given","Observed"],"rows":[{"cells":["...","..."],"mark":"good|bad|neutral"}]}: quote actual observed values (rendered text, HTTP status, payload fields) from QA receipts. Use it as a decision table for business rules, marking where a rule does nothing as bad.\n{"kind":"code","file":"repository-relative path","excerpt":"at most 25 lines of the real diff, +/- prefixed","note":"why this proves it"}\n{"kind":"test","file":"...","excerpt":"test names or the key assertion","result":"what passed"}\n{"kind":"command","command":"...","output":"trimmed real output","note":"optional"}\n{"kind":"steps","steps":[{"label":"...","detail":"...","change":"new|changed|manual"}]}: only when the requirement IS a linear sequence.\n{"kind":"flowRef","flow":"flow-id","steps":[1,2],"note":"..."}: points at steps of a system flow.\nRules:\n- Status describes the proof honestly: shown = a human-visible observation at this revision proves it; tested = only automated tests prove it; partly = some cases proven and the caveat names what is not; not-shown = no evidence; gap = not met; waived = deliberately skipped by an accepted decision. A passed label, an implementation receipt or source reading alone is not proof.\n- Every proof is judgeable in about 30 seconds without opening a file. Observed values beat descriptions. Never invent values; take them from executed receipts.\n- Screenshots appear only as proof of one claim or one decision, each with a label and a focus crop. No galleries, no decorative images, no repeats.\n- interpretation lists every place the ask had to become a concrete decision: added or narrowed scope, UX choices, defaults, migration behavior. decidedBy is bob whenever no human answer or ticket text made the call, including delegated choices; these are where results quietly diverge from requests.\n- yourCall holds only what a person must judge: taste, trade-offs, consequences for users, security or compatibility decisions, wording. Ask each as a question and say what Bob chose. Use 0-4 items; an empty list is right for mechanical changes. Never ask the reviewer to redo QA.\n- Group the inventory into 1-12 lines a person would check separately. Every active inventory requirement appears in requirements[].covers, or in hygiene[].covers for process criteria (generated files, branch continuity, changelog policy, tracker state). Every file in /progress/reviewScope/files appears in a requirement line or a beyondAsk item.\n- beyondAsk lists behavior and code no requirement asked for: refactors, shared code affecting other features, dependency, configuration and migration changes, behavior changes for existing users. Read the diff for changed defaults, removed fallbacks, widened permissions and new public endpoints. Use attention look when it can affect users or other code paths.\n- notVerified states up to 4 product-relevant evidence limits (real services replaced by fixtures, untested environments or devices). noticed lists pre-existing problems you saw but did not change.\n- Pipeline process (CI retries, PR selection, tracker synchronization, earlier rounds, reviewer tooling) is not review content; put anything a person must know into one hygiene line. The runtime shows PR, revision, CI and diff statistics.\n- No local absolute paths, commit SHAs, QA story or criterion IDs, receipt filenames or exit codes in prose. Repository-relative paths belong in files and proof file fields only.\n- Length follows the change: a few-file fix fits on one screen. Do not pad.\n- readiness is not-ready when any line is a gap or required QA failed or is blocked; ready-with-caveats when a yourCall item or a partly line needs attention; otherwise ready.\nAdd "system":{"summary":"2-3 plain sentences on how the pieces work together, for a product owner","flows":[FLOW],"touches":[TOUCH],"interfaces":[]} ONLY when the change alters how components interact, what data is stored, or where the trust boundary sits. FLOW is {"id":"kebab-id","title":"plain name of what happens, e.g. Saving your format","trigger":"plain: what starts it","implements":["requirement ids"],"participants":[{"id":"kebab-id","icon":"one emoji","label":"plain short name (<=40), e.g. Account page, Server, Database","detail":"real component or module"}],"steps":[{"from":"participant id","to":"participant id","label":"one plain sentence of what happens (<=140)","detail":"the real endpoint, event, query or call","change":"new|changed","dashed":true,"outcome":"good|bad","code":{"file":"exact changed file","match":"text copied verbatim from one added or removed line of that file\'s diff"}}],"before":[steps for the same trigger before this PR, only when an existing flow changed],"beforeNote":"plain: what went wrong or worked differently before (<=240)","note":"optional"}. TOUCH is {"mark":"new|changed|removed|risk|same","what":"plain (<=80)","say":"what it means for people or other systems (<=200)","tech":"optional real endpoint, field or setting"}.\nFlows are sequence diagrams read top to bottom: one per real trigger, 2-5 participants, at most 8 steps, usually 1-3 flows including the main user action. Unmarked steps already worked this way; dashed marks steps outside the product\'s control; outcome bad marks where something is refused or went wrong. Give the steps a reviewer would want to see in code a code link. touches lists 2-8 places the change reaches the rest of the system: endpoints, stored data, dependencies, configuration, and behavior changes for existing users, marked risk. Leave interfaces empty. Never draw box-and-arrow maps.\nAfter a human review, add "sinceLastReview":{"previousHeadSha":"the reviewed revision","summary":"...","changes":[{"what":"what changed in response","files":["..."]}]} and keep the whole brief current. Do not modify product code, recapture screenshots, rerun implementation or merge.\nThen add "story": the show & tell a colleague gives in person, in about three minutes, without showing code. The reviewer sees it first; the brief fields above stay the checkable evidence behind it.\n"story":{"title":"what you did, first person (<=110), e.g. I hardened the WAGO integration for production.","summary":"the short version in one or two plain sentences (<=320)","stats":[{"value":"e.g. 6 / 7","label":"e.g. things you asked for, done"}],"slides":[SLIDE]}\nSLIDE is exactly one of:\n{"kind":"checklist","title":"...","say":"...","items":[{"state":"done|partly|open","label":"one thing that was asked (<=70)","detail":"where it landed (<=140)"}]}: the ask split into the separate things the person wanted, each with where it landed. Usually the first slide.\n{"kind":"beforeAfter","title":"...","say":"...","before":[NODE],"after":[NODE],"note":"optional"}: the core behavior change as two short step-by-step pipelines of what happens. NODE is {"label":"<=40","detail":"optional <=60","change":"new|changed (after only)","fallout":"optional <=60: what happens when this step says no"}. Name steps by what they do, never by class or function names. Use before:[{"label":"Nothing"}] for brand-new behavior.\n{"kind":"chart","title":"...","say":"...","method":"how it was measured (<=200)","scale":"linear|log","bars":[{"label":"<=60","value":positive number,"display":"printed value, e.g. 7,200 or 3.3 s","detail":"optional <=60","mark":"good|bad|neutral"}],"stats":[STAT]}: measured numbers from executed receipts only, such as load, timings, sizes or counts. Use log when values span more than 100x.\n{"kind":"screens","title":"...","say":"...","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}]}: one or two accepted screenshots that show the result.\n{"kind":"video","title":"...","say":"...","taskId":"...","sha256":"...","label":"..."}: an accepted video, only when motion or sequence is the point.\n{"kind":"points","title":"...","say":"...","items":[{"icon":"one emoji","title":"<=70","detail":"optional <=160"}]}: a few notable things that fit no other slide.\nStory rules:\n- Speak as Bob to the reviewer, first person, the way you would explain it at their desk: short sentences, everyday words, one idea per slide. title is the point of the slide (<=90); say is what you would add out loud (<=240). No code, file paths, class or function names, IDs or jargon a product owner would not use; when the reviewer must know a technical term, say what it means.\n- 2-6 slides in this order: what was asked and where each part landed, what changed (core behavior first), how we know it works, then anything else worth seeing. A small fix can be one beforeAfter slide and one proof slide.\n- Never repeat yourCall, notVerified or beyondAsk in slides: the reader presents them as their own slides after yours and ends with the decision. Because they appear in the show & tell, write them in the same plain voice: say what changes for people and what is at stake, not internal mechanics.\n- Be concrete: put the actual limits, counts and timings that changed into slide details (e.g. "at most 8 KB", "26 ms"), not "checks vary".\n- Every story screenshot sets focus to the pixels that matter (open the image to choose it), so it stays readable on a phone; prefer a pair that differs only in the condition shown.\n- A chart compares 2-8 different stages, conditions or cases measured the same way, so the bars differ meaningfully. Never chart a total against itself or offered against confirmed; headline totals belong in stats.\n- Translate technical terms into what a person experiences: "names longer than 128 characters or containing / or #" rather than "identifiers over 128 code units or containing MQTT wildcards"; "a generic error that does not say which version failed" rather than "revision 0 and an empty hash".\n- Every number, screenshot and claim comes from the evidence above; the story may simplify wording, never facts. stats holds 0-3 headline numbers a person remembers.\nThen add "tour": the code walkthrough under "Dig deeper", like a colleague scrolling through the diff with you. "tour":[{"file":"exact changed file","say":"one plain sentence: what this file now does or what changed in it (<=200)","key":true,"flag":"optional short reason to look (<=40), e.g. Changes sign-out everywhere","pins":[{"match":"text copied verbatim from one added or removed line of this file\'s diff","say":"plain note shown under that line (<=200)","flag":true}],"related":["tests, translations and small wiring that only serve this file"],"same":["files with the same mechanical change"]}]\nTour rules:\n- Order entries the way you would show them: the core rule or data first, then server, then screens, then wiring. key marks the 3-8 files that carry the change; they start open.\n- Every file in /progress/reviewScope/files appears exactly once in the tour: as file, in related or in same. Put each test under the file it tests and group repeated mechanical edits with same.\n- pins point at the 0-3 lines per file a reviewer must not miss: guards, defaults, removed behavior, security decisions. match is unique text from a single + or - line of the actual diff. flag what changes behavior for existing users or belongs to a yourCall or beyondAsk item worth a look.\n- Write say in the story\'s plain voice: what it does for people, no class or function names unless the reviewer must know them.\nWrite the evidence plainly too, as Dig deeper shows it:\n- requirements[].text is the outcome in plain words, and requirements[].how says in one plain sentence how it was checked (<=160), e.g. "Clicked through the German account page and compared the preview".\n- Every table proof row adds "plain":{"tried":"what was done (<=140)","saw":"what happened, keeping the key values (<=200)"}; cells keep the exact recorded values.\n- interpretation chosen and alternatives use words a product owner would use; note says why when it is not obvious. Keep at most 10 interpretation entries (the most consequential) and every hygiene text within 200 characters.\nFor video-v1 a requirement may use a video proof {"kind":"video","taskId","sha256","label"} from the current accepted video inventory, when motion or sequence is the point. Watching a clip never approves anything; keep explicit current-revision approval.',
				json: true,
				askQuestions: false,
			},
			{
				id: "handoff",
				name: "Verify revision and hand off",
				next: "human-review",
				branches: [
					{
						when: {
							path: "fix",
							equals: true,
						},
						next: "ci-fix",
					},
				],
				qaContract: "qa-v1",
				videoContract: "video-v1",
				maxVisits: 200,
				type: "tool",
				tool: "handoff",
				args: [],
			},
			{
				id: "human-review",
				name: "Human review",
				next: "merge",
				branches: [
					{
						when: {
							path: "decision",
							equals: "reject",
						},
						next: "delivery-feedback-route",
					},
					{
						when: {
							path: "rework",
							equals: true,
						},
						next: "extract-requirements",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "human-review",
				args: [],
			},
			{
				id: "human-fix",
				name: "Address human feedback",
				next: "extract-requirements",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					'Address the latest human rejection/follow-up instructions in humanDecisions and human-review, preserving the accepted plan, decisions and all past review findings. Commit and push to the existing PR. Return {"summary":"what changed","checks":["commands and outcomes"]}. Do not merge, mark ready or assume approval.',
				json: true,
				askQuestions: false,
			},
			{
				id: "merge",
				name: "Merge approved revision",
				next: "end",
				branches: [
					{
						when: {
							path: "rework",
							equals: true,
						},
						next: "extract-requirements",
					},
					{
						when: {
							path: "fix",
							equals: true,
						},
						next: "ci-fix",
					},
					{
						when: {
							path: "externalPending",
							equals: true,
						},
						next: "external-final",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "merge",
				args: [],
			},
			{
				id: "delivery-feedback-route",
				name: "Route requested delivery corrections",
				next: "human-fix",
				branches: [
					{
						when: {
							path: "mode",
							equals: "mixed",
						},
						next: "external-correction",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "delivery-mode",
				args: [],
			},
			{
				id: "delivery-route",
				name: "Validate accepted delivery contract",
				next: "architecture",
				branches: [
					{
						when: {
							path: "deferred",
							equals: true,
						},
						next: "delivery-deferred",
					},
					{
						when: {
							path: "mode",
							equals: "external",
						},
						next: "external-apply",
					},
					{
						when: {
							path: "mode",
							equals: "mixed",
						},
						next: "external-apply",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "delivery-route",
				args: [],
			},
			{
				id: "delivery-deferred",
				name: "Resolve execution deferral",
				next: "plan",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					"The accepted delivery contract defers execution. Do not mutate tickets or files. Ask whether the named external/repository task should remain deferred or may proceed. Return questions while the deferral remains. Read answers; only explicit authorization may return questions:[], then the planner and plan reviewer renew the contract. Never infer execution permission from scope answers.",
				json: true,
				askQuestions: true,
			},
			{
				id: "external-apply",
				name: "Apply authorized ticket changes",
				next: "external-verify",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "external-apply",
				args: [],
			},
			{
				id: "external-verify",
				name: "Independently verify ticket state",
				next: "external-after-verify",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "external-verify",
				args: [],
			},
			{
				id: "external-after-verify",
				name: "Route verified deliverables",
				next: "external-guide",
				branches: [
					{
						when: {
							path: "repositoryComplete",
							equals: true,
						},
						next: "external-guide",
					},
					{
						when: {
							path: "mode",
							equals: "mixed",
						},
						next: "architecture",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "delivery-mode",
				args: [],
			},
			{
				id: "external-guide",
				name: "Prepare external review",
				next: "external-human-review",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "external-guide",
				args: [],
			},
			{
				id: "external-human-review",
				name: "Accept completed external work",
				next: "external-final",
				branches: [
					{
						when: {
							path: "decision",
							equals: "reject",
						},
						next: "external-correction",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "human-review",
				args: [],
			},
			{
				id: "external-correction",
				name: "Plan requested ticket corrections",
				next: "plan",
				branches: [],
				maxVisits: 16,
				type: "agent",
				prompt:
					"Read humanDecisions, the accepted delivery contract, operation receipts and verified state. Applied changes remain; rejection does not roll them back. Preserve feedback and before/after history. Do not mutate tickets or repository files, commit or push. Before repository merge, summarize both ticket and repository feedback for the revised plan; preserve existing repository work and let implementation apply the reviewed corrections. After repository merge, corrections on this path concern external deliverables only. Confirmed repository merges remain retained. Repository changes requested after merge need a separate follow-up, never replay publication or merge. Summarize the requested corrections for a revised plan and independent plan review.",
				json: true,
				askQuestions: false,
			},
			{
				id: "external-final",
				name: "Check accepted external state",
				next: "end",
				branches: [
					{
						when: {
							path: "drift",
							equals: true,
						},
						next: "external-reverify",
					},
				],
				maxVisits: 200,
				type: "tool",
				tool: "external-final",
				args: [],
			},
			{
				id: "external-reverify",
				name: "Verify changed external state",
				next: "external-guide",
				branches: [],
				maxVisits: 200,
				type: "tool",
				tool: "external-verify",
				args: [],
			},
		],
		internal: true,
		allowedTriggers: ["workflow"],
		launchFields: [
			{
				name: "prompt",
				label: "What should Bob build?",
				type: "textarea",
				required: true,
				placeholder: "What should Bob build?",
				options: [],
			},
			{
				name: "attachments",
				label: "Attachments",
				type: "files",
				required: false,
				description: "Attach reference material for this workflow.",
				options: [],
			},
		],
	},
];

type LegacyReviewStep = Omit<WorkflowStep, "branches" | "maxVisits"> &
	Partial<Pick<WorkflowStep, "branches" | "maxVisits">>;

/** Original review roles before specialist and impact opt-ins. */
export const legacyReviewSteps: LegacyReviewStep[] = [
	{
		id: "clarify",
		name: "Clarify requirements",
		type: "agent",
		prompt:
			'Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. For selectable alternatives, use questionChoices with questionIndex, selection (single or multiple), options (unique id, answer, optional reason) and optional preselectedOptionIds. Do not use questionRecommendations for the same question. Custom text is always available and defaults require explicit submission. Empty questions means everything is understood. Preserve all answered decisions across rounds.',
		askQuestions: true,
	},
	{
		id: "decisions",
		name: "Record decisions",
		type: "tool",
		tool: "record-decisions",
		maxVisits: 200,
	},
	{
		id: "plan",
		name: "Write implementation plan",
		type: "agent",
		prompt:
			'Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. When taking over, include the existing-work and assess-existing results and PR review discussion; preserve completed work and plan only the remaining changes. Include the existing PR URL/branch and require continuing it. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Do not implement. Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links.',
	},
	{
		id: "plan-review",
		name: "Review implementation plan",
		type: "agent",
		prompt:
			'Review the plan against ALL input/comments/metadata and decisions. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["specific missing requirements or improvements"]}. Approve a practical MVP plan when complete.',
		branches: [
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "plan",
			},
		],
	},
	{
		id: "implement",
		name: "Implement accepted plan",
		type: "agent",
		prompt:
			'Implement the provided plan and use its assets. Read /answers alongside /plan for subsequent human responses, including resolution of implementation blockers. Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy. Follow repository conventions and appropriate verification. If implementation is forbidden, deferred, or blocked by missing access or a necessary decision, preserve completed work and return {"status":"blocked","summary":"concrete blocker","checks":["commands and outcomes"],"questions":["specific question or action needed to unblock implementation"]}. The workflow waits for an answer and resumes this role; do not report deferred or unfinished work as completed. Only after completing implementation return {"status":"completed","summary":"...","checks":["commands and outcomes"],"questions":[]}. Do not create or publish a PR; the next step handles delivery.',
		inputs: ["plan"],
		askQuestions: true,
	},
	{
		id: "draft-pr",
		name: "Push and create draft PR",
		type: "tool",
		tool: "draft-pr",
		maxVisits: 200,
	},
	{
		id: "code-review",
		name: "Review code",
		type: "agent",
		prompt:
			'Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.',
	},
	{
		id: "review-gate",
		name: "Discard nitpicks / review gate",
		type: "tool",
		tool: "review-gate",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "code-fix",
			},
		],
	},
	{
		id: "ci",
		name: "Watch merge readiness",
		type: "tool",
		tool: "ci",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "fix",
					equals: true,
				},
				next: "ci-fix",
			},
		],
	},
	{
		id: "visual-scope",
		name: "Plan QA stories and screenshots",
		type: "agent",
		prompt:
			'Read the accepted requirements, all recorded decisions/expectations, plan, implementation receipts, relevant history and exact cumulative base-to-head PR diff (including inherited takeover work). Plan observable QA for ALL changed behavior: UI, API, CLI and other interfaces. Declare environment:{isolation:"worktree"} only when all QA uses independent per-worktree servers, databases and fixtures. For shared clusters, databases, fixtures or browser control return environment:{isolation:"shared",resources:["stable shared resource identity"]}; use the same identity across repositories/runs using that resource. Unknown isolation requires shared protection, never assume a worktree isolates external resources. Cover happy paths and consequential failure, permission and boundary cases proportionately. Trace stories to agreed requirements; do not invent business requirements or turn subjective preferences into blocking criteria. Explain any requirement/diff area outside executable QA in exclusions. Assess navigation, feedback, readability and recovery where relevant.\nReturn {"qaContract":"qa-v1","changed":false,"areas":[],"captureBudget":24,"stories":[{"id":"stable-story-id","goal":"user goal","requirementRefs":["requirements/0 or decisions/0 or answers/0 (existing zero-based accepted record)"],"interface":"ui or api or cli or other","preconditions":["setup"],"fixtures":["access or data needed"],"actions":["ordered executable action"],"criteria":[{"id":"globally unique stable criterion ID","expected":"observable expected outcome"}],"evidenceInstructions":"how to execute and record evidence","screenshotTasks":[{"area":"exact selected area","state":"exact selected state at a defined point in these actions"}]}],"exclusions":[{"requirementRef":"requirement/diff area","reason":"concrete reason outside executable QA"}]}.\nchanged refers only to VISUAL scope. Nonvisual changes still need executable stories with real behavioral checks and may have zero screenshots. No changed executable behavior may use stories=[] only with a concrete notApplicableReason; no visual changes is insufficient. Inspect relevant existing tests before selecting them as criterion evidence.\nFor visuals return changed=true and areas:[{name,url,states:["single concrete representative state"],instructions,rationale,dependencies,changed}]. Normally choose 1–2 states per area and at most 24 screenshots. Group co-visible elements. Never multiply viewport/language/role combinations or comma-separated alternatives. Additional states must show distinct changed rendering risk. Up to 48 needs a concrete budgetReason. Every selected area/state must be linked to a story; API/CLI checks do not need artificial images. Dependencies are exact repository files or directory/** paths. Do not change code, execute QA or take screenshots.\nFor video-v1 return videoContract:"video-v1", videoTasks:[{id,title,storyIds,criterionIds,rationale,steps,dependencies,environment,targetSeconds,required,changed}] and videoReason when none are selected. Select up to three useful authentic demonstrations independently of visual changed: normally one 30–90 second main changed flow, optionally distinct flows. Do not require recordings for backend-only work or pad a shorter real flow. Link existing QA story/criterion IDs, exact source files/directory/** dependencies (including shared assets), fixture/environment assumptions and executable steps. required=true only when accepted requirements explicitly require that recording. Backend-only or unavailable recording needs a concrete reason; never substitute slideshows. On repeats retain the complete tasks; changed=false only for proven unaffected sources, scenarios and fixtures.',
		qaContract: "qa-v1",
		videoContract: "video-v1",
	},
	{
		id: "capture",
		name: "Execute QA and capture screenshots",
		type: "agent",
		prompt:
			'Execute EVERY planned QA story and acceptance criterion from visual-scope, including nonvisual API/CLI behavior. Read /answers for resolved access, fixtures and tooling blockers. Set up the application once when needed, use appropriate actual fixtures, and execute browser/HTTP/CLI/tests as instructed. Inspect test coverage and run the checks; source inspection or an implementation receipt alone cannot establish a pass. Compare observed outcomes with each exact expected outcome. Assess applicable navigation, feedback, readability and recovery. Do not modify product code or repair failures.\nReturn {"qaContract":"qa-v1","results":[{"storyId":"planned ID","outcome":"passed or failed or blocked","criteria":[{"criterionId":"planned ID","outcome":"passed or failed or blocked","expected":"exact expected outcome from scope","observed":"actual observed outcome","blockedReason":"concrete assistance needed when blocked","evidence":[{"kind":"command or test or http or browser or log","executed":true,"action":"actual command/request/actions performed","details":"exit/result/request-response/log details demonstrating this criterion","exitCode":0,"screenshotTasks":[{"area":"selected area","state":"selected state"}]}]}]}],"findings":[{"id":"stable finding ID","rating":3,"summary":"consequential requirement failure","evidence":"concrete receipt","status":"open","storyId":"planned ID","criterionId":"planned criterion ID","requirementRefs":["accepted requirement"],"reproduction":["steps"],"expected":"expected behavior","actual":"actual behavior"}],"observations":[{"id":"stable observation ID","summary":"optional UI/UX improvement","evidence":"observed details","storyId":"story ID"}],"screenshots":[{"path":"absolute real image path","caption":"what it demonstrates","area":"exact area","state":"exact state"}],"unavailable":[{"area":"selected area","reason":"concrete missing access/tooling/setup or failed behavior","cause":"access or product"}]}.\nOne result per story and criterion. Ratings 2/3 are consequential failures against agreed requirements; keep optional preferences in observations. Product failures are failed with actionable findings. If failed product behavior prevents a selected screenshot, report unavailable with cause:"product" linked to that failing story; missing access/tooling uses cause:"access". Missing access, fixtures or tooling is blocked with a concrete reason; never pass an unexecuted check. Story outcome must agree with criterion outcomes. Do not supply a revision claim; runtime stamps provenance. Execute criteria freshly on each visit; image reuse never establishes a behavioral pass.\nCapture exactly the selected representative screenshot tasks at their defined points DURING the story flows. Keep the captureBudget (normally 24, justified maximum 48), one real PNG/JPEG per exact area/state. Do not invent states or expand combinations. Save images under the supplied evidence directory with fresh filenames for each revision; inspect actual captures for readability. Keep the complete inventory, including provenance-eligible explicitly accepted unchanged images. Never claim images or checks that do not exist. Stop only servers you started, after all testing and captures finish.\nFor video-v1 return videoContract:"video-v1", videos:[{taskId,path,caption,recorder,receipt:{executed:true,action,details},storyIds,criterionIds,viewport:{width,height},transcript,environment,posterPath,captionsPath?,reused?}], videoUnavailable:[{taskId,reason,cause:"tooling"|"export"|"product"}]. Cover each selected task once. Record REAL interactions on the existing server with seeded non-sensitive data and readable pacing. Check command -v agent-browser, ffmpeg and ffprobe; inspect agent-browser record --help. Launch a fresh owned headless session: agent-browser --headed false --session <unique-run-session> open <url>. Start recording to a fresh video-temp-<unique>.webm inside the evidence directory, execute planned interactions, stop recording, then export a fresh finalized clip. Prefer MP4/H.264 yuv420p with fast start: ffmpeg -i <recording> -c:v libx264 -pix_fmt yuv420p -movflags +faststart <fresh>.mp4. Installed Playwright fallback must launch headless:true, create a context with recordVideo and matching readable viewport, await context.close() before video.saveAs(). Never open desktop windows or attach to an existing browser. Do not silently install global recording tools. Stop only owned sessions/servers. Generate a real poster frame (ffmpeg -i <clip> -frames:v 1 <poster>.png), inspect it, and supply a concise transcript of actual visible steps/outcomes; audio requires timed WebVTT captions. Limits: three clips, 120 seconds and 50 MiB per clip, 512 MiB evidence per run. Normal target 30–90 seconds. Do not fabricate metadata: runtime probes, decodes and hashes media. Remove failed temporary exports owned by this attempt; preserve finalized referenced evidence. Missing tools/export failures are explicit limitations, not product passes. Product failure needs failed behavioral QA and an actionable finding. Required missing recordings remain blocked. Reuse only previous explicitly playback-accepted bytes with unchanged task/scenarios, source dependencies, fixtures/environment and clean verified revision; retain original provenance and include reused=true. Supply fresh recordings for changed/uncertain flows. Execute behavioral criteria freshly even when video is reusable.',
		next: "visual-review",
		qaContract: "qa-v1",
		videoContract: "video-v1",
	},
	{
		id: "visual-review",
		name: "Review QA and screenshots",
		type: "agent",
		prompt:
			'Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.\nThis is a QA AND SCREENSHOT review. Return qaContract:"qa-v1" alongside the review fields. Inspect accepted business requirements and expectations, cumulative diff, planned stories, complete criterion coverage, executed test receipts, failures, blocked checks, optional observations and all retained disputes. A screenshot alone cannot prove behavior, and an agent saying passed without actual executed evidence is insufficient. Missing/blocked required QA cannot be approved. Failed required behavior requires a fix and retest even when a fixer rejects a complaint. Corrections to erroneous scenarios must match accepted requirements and record a rationale.\nOpen the actual selected screenshots. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good image, using its exact supplied hash. Exclude images affected by unresolved findings. Missing critical SELECTED states is rating 3; do not invent larger viewport/language/role matrices. Request only minimum targeted replacements by exact area/state. Preserve explicitly accepted unchanged image receipts and optional observations without making preferences blocking. Return complete current coverage, not merely the latest delta. Do not execute QA again, change code or recapture images.\nFor video-v1 inspect ACTUAL playback and demonstrated steps for each supplied clip, using an available headless player/tool. A poster or metadata alone is insufficient. Return acceptedVideos:[{taskId,sha256,inspectedPlayback:true}] only for individually inspected acceptable clips, using exact runtime hashes. Preserve exact receipts for eligible unchanged reused clips. If playback cannot be inspected, disclose the limitation and omit its acceptance receipt. Review videoUnavailable without manufacturing acceptance: optional missing tools/export remain disclosed limitations, required recordings stay blocked, product failures require fixes. Videos supplement representative screenshots and fresh behavioral QA. Do not waive human approval.',
		next: "visual-gate",
		qaContract: "qa-v1",
		videoContract: "video-v1",
	},
	{
		id: "visual-gate",
		name: "QA and screenshot gate",
		type: "tool",
		tool: "visual-gate",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "visual-fix",
			},
		],
		next: "guide",
		qaContract: "qa-v1",
		videoContract: "video-v1",
	},
	{
		id: "code-fix",
		name: "Fix review findings",
		type: "agent",
		prompt:
			'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\nRead /reviewFix/findings for ALL unresolved consequential findings, even when customized recipe inputs hide the gate. If /reviewFix/review is incomplete, its retained findings are correction inputs, never completed review or approval. Repair concrete findings and preserve the declared independent reassessment; report missing access or evidence in questions. When no usable findings exist, identify the configured review work that must run again instead of claiming review passed. Return a fixed or evidence-backed rejected disposition for each finding you can address. If the correction needs a materially changed architecture or a genuine scope revision, preserve work and use the existing configured proposal route: return status:"blocked", architectureRevision:true, a concrete summary, dispositions only for findings already addressed, and questions:[]. The runtime redrafts and independently reviews the proposal before any required exact-candidate acceptance. This handback leaves unresolved findings open and never authorizes implementation or delivery. Do not ask the human to schedule proposal drafting. If no applicable route exists, report that specific limitation. If missing deployment, access, fixtures, evidence or a necessary human decision prevents progress, return questions:["specific assistance needed"] alongside summary and dispositions; asking only in summary does not pause the workflow. Never mark blocked findings fixed or rejected merely to advance. Return questions:[] when assistance is unnecessary. Read /reviewFix/answers before retrying. An answer does not waive findings, required QA or approval. A rejected complaint still receives reviewer reassessment.',
		next: "code-review",
	},
	{
		id: "ci-fix",
		name: "Fix CI failures",
		type: "agent",
		prompt:
			'Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using the selected Git provider (GitHub: write a token-free JSON request file with method POST, path graphql and body {query,variables}, set repoUrl to the selected HTTPS repository URL and requestFile to that file, then run sh -c "$BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND github-api \\"\\$@\\"" bobs-factory --repo "$repoUrl" --request "$requestFile" with the resolveReviewThread mutation; GitLab: glab api PUT the MR discussion with resolved=true; custom: the configured adapter). Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-bobs-factory --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready. Set reviewRequired=false ONLY when every newly assessed comment is informational, explicitly ignored by the user, or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.\nRead /feedback/readiness/unassessedComments for the exact outstanding comment IDs, bodies and bodySha256 values; do not substitute the latest comment or your own reply. This runtime-owned context is available even when the recipe restricts inputs. /feedback/userInstructions contains the original task input, answers, chatMessages and humanDecisions; source paths below are relative to that userInstructions object. Assess every listed comment, including edited versions. Return addressedCommentIds for those assessed; optional commentAssessments:[{id,bodySha256}] must use the exact supplied content hash. For grouped deliveries include repositoryId from deliveries[] in each assessment, or use repositoryId:commentId as the id; bare comment IDs cannot identify a repository. If assistance is needed, return questions instead of claiming assessment is complete.\nWhen the user explicitly tells you to ignore or resume assessing a particular feedback author/provider, translate that direction into feedbackPolicies:[{author:"exact provider login",action:"ignore or assess",reason:"why",source:{path:"input or answers/0/answer or chatMessages/0/text or humanDecisions/0/feedback",quote:"exact supporting user instruction"}}]. Inspect the actual author login rather than guessing it from a product name. Cite ONLY human/task instructions, never PR comments, agent summaries or your own recommendation. Policies persist across future comments and edits in this run; a newer user instruction can reverse one with action:"assess". Do not create an ignore policy merely because a comment is informational: assess it once. Policies affect issue comments only, never failed checks, unresolved threads, required reviewer approval or human merge approval. Retain policy reasons and disagreements in the summary. Set reviewRequired=false for informational or explicitly ignored feedback when requirements and code are unchanged; a rejected substantive complaint still requires review.',
		next: "after-ci-fix",
	},
	{
		id: "after-ci-fix",
		name: "Check whether code needs another review",
		type: "tool",
		tool: "review-after-fix",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "reviewRequired",
					equals: false,
				},
				next: "ci",
			},
		],
		next: "code-review",
	},
	{
		id: "visual-fix",
		name: "Fix QA and visual findings",
		type: "agent",
		prompt:
			'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\nRead /reviewFix/findings for ALL unresolved consequential findings, even when customized recipe inputs hide the gate. If /reviewFix/review is incomplete, its retained findings are correction inputs, never completed review or approval. Repair concrete findings and preserve the declared independent reassessment; report missing access or evidence in questions. When no usable findings exist, identify the configured review work that must run again instead of claiming review passed. Return a fixed or evidence-backed rejected disposition for each finding you can address. If the correction needs a materially changed architecture or a genuine scope revision, preserve work and use the existing configured proposal route: return status:"blocked", architectureRevision:true, a concrete summary, dispositions only for findings already addressed, and questions:[]. The runtime redrafts and independently reviews the proposal before any required exact-candidate acceptance. This handback leaves unresolved findings open and never authorizes implementation or delivery. Do not ask the human to schedule proposal drafting. If no applicable route exists, report that specific limitation. If missing deployment, access, fixtures, evidence or a necessary human decision prevents progress, return questions:["specific assistance needed"] alongside summary and dispositions; asking only in summary does not pause the workflow. Never mark blocked findings fixed or rejected merely to advance. Return questions:[] when assistance is unnecessary. Read /reviewFix/answers before retrying. An answer does not waive findings, required QA or approval. A rejected complaint still receives reviewer reassessment. Include independently generated visual-gate findings as well as reviewer findings. Preserve stable dispositions. Rejected complaints require concrete evidence and reviewer reassessment; rejection cannot waive a failed required criterion. After corrections the pipeline returns through code review, CI, QA scope, execution, review and gate. Failed criteria must be retested before the human guide.',
		next: "code-review",
		qaContract: "qa-v1",
	},
	{
		id: "guide",
		name: "Prepare human review brief",
		type: "agent",
		prompt:
			'Write the human review brief for the WHOLE PR at the current revision, including inherited takeover work and every accepted iteration. The reader decides one thing: does this PR deliver what was asked? Answer in this order: was the right thing built (the ask and every interpretation of it), does it work (one decisive, human-checkable proof per requirement), what only a human can judge, and what else changed or remains unproven.\nFirst read through factory-context: the original input/ticket and all comments, clarification decisions and answers, the frozen requirement inventory and review-gate coverage, the accepted plan, /progress/reviewScope (every whole-PR file), executed QA stories with observed values, and the accepted capture inventory. Inspect the actual base-to-head diff yourself.\nReturn {"verdict":{"headline":"what now works, said the way a user would say it (<=160 chars)","readiness":"ready|ready-with-caveats|not-ready","why":"one sentence (<=260)"},"ask":{"source":"e.g. Linear ATT-764","url":"ticket URL when known","quote":"the original request verbatim, trimmed to its substance"},"interpretation":[{"topic":"short","chosen":"what was built","alternatives":["what the ask could also have meant"],"decidedBy":"you|ticket|bob","note":"optional, e.g. You delegated this choice."}],"requirements":[{"id":"kebab-id","text":"observable outcome (<=180)","origin":"ask|your-answer|bob","covers":["frozen inventory requirement IDs"],"status":"shown|tested|partly|not-shown|gap|waived","proof":PROOF,"more":[PROOF],"caveat":"optional limit specific to this line","files":["exact changed files that implement it"]}],"yourCall":[{"question":"...?","context":"the facts a person needs","bobChose":"what was built and why","proof":PROOF}],"beyondAsk":[{"what":"...","why":"...","attention":"none|low|look","files":["..."]}],"notVerified":[{"what":"...","why":"..."}],"noticed":["pre-existing problem seen but not changed"],"hygiene":[{"text":"satisfied process criterion, e.g. No generated code committed","covers":["inventory IDs"]}]}. Add "system" only as described below.\nPROOF is exactly one of:\n{"kind":"screens","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}],"note":"optional"}: focus crops the image, in percent, to the pixels that prove the claim (open the image to choose it). Prefer pairs varying only the condition under test (English vs German, setting A vs B, before vs after).\n{"kind":"video","taskId":"...","sha256":"...","label":"..."}: from the accepted video inventory.\n{"kind":"table","method":"how it was observed","columns":["Given","Observed"],"rows":[{"cells":["...","..."],"mark":"good|bad|neutral"}]}: quote actual observed values (rendered text, HTTP status, payload fields) from QA receipts. Use it as a decision table for business rules, marking where a rule does nothing as bad.\n{"kind":"code","file":"repository-relative path","excerpt":"at most 25 lines of the real diff, +/- prefixed","note":"why this proves it"}\n{"kind":"test","file":"...","excerpt":"test names or the key assertion","result":"what passed"}\n{"kind":"command","command":"...","output":"trimmed real output","note":"optional"}\n{"kind":"steps","steps":[{"label":"...","detail":"...","change":"new|changed|manual"}]}: only when the requirement IS a linear sequence.\n{"kind":"flowRef","flow":"flow-id","steps":[1,2],"note":"..."}: points at steps of a system flow.\nRules:\n- Status describes the proof honestly: shown = a human-visible observation at this revision proves it; tested = only automated tests prove it; partly = some cases proven and the caveat names what is not; not-shown = no evidence; gap = not met; waived = deliberately skipped by an accepted decision. A passed label, an implementation receipt or source reading alone is not proof.\n- Every proof is judgeable in about 30 seconds without opening a file. Observed values beat descriptions. Never invent values; take them from executed receipts.\n- Screenshots appear only as proof of one claim or one decision, each with a label and a focus crop. No galleries, no decorative images, no repeats.\n- interpretation lists every place the ask had to become a concrete decision: added or narrowed scope, UX choices, defaults, migration behavior. decidedBy is bob whenever no human answer or ticket text made the call, including delegated choices; these are where results quietly diverge from requests.\n- yourCall holds only what a person must judge: taste, trade-offs, consequences for users, security or compatibility decisions, wording. Ask each as a question and say what Bob chose. Use 0-4 items; an empty list is right for mechanical changes. Never ask the reviewer to redo QA.\n- Group the inventory into 1-12 lines a person would check separately. Every active inventory requirement appears in requirements[].covers, or in hygiene[].covers for process criteria (generated files, branch continuity, changelog policy, tracker state). Every file in /progress/reviewScope/files appears in a requirement line or a beyondAsk item.\n- beyondAsk lists behavior and code no requirement asked for: refactors, shared code affecting other features, dependency, configuration and migration changes, behavior changes for existing users. Read the diff for changed defaults, removed fallbacks, widened permissions and new public endpoints. Use attention look when it can affect users or other code paths.\n- notVerified states up to 4 product-relevant evidence limits (real services replaced by fixtures, untested environments or devices). noticed lists pre-existing problems you saw but did not change.\n- Pipeline process (CI retries, PR selection, tracker synchronization, earlier rounds, reviewer tooling) is not review content; put anything a person must know into one hygiene line. The runtime shows PR, revision, CI and diff statistics.\n- No local absolute paths, commit SHAs, QA story or criterion IDs, receipt filenames or exit codes in prose. Repository-relative paths belong in files and proof file fields only.\n- Length follows the change: a few-file fix fits on one screen. Do not pad.\n- readiness is not-ready when any line is a gap or required QA failed or is blocked; ready-with-caveats when a yourCall item or a partly line needs attention; otherwise ready.\nAdd "system":{"summary":"2-3 plain sentences on how the pieces work together, for a product owner","flows":[FLOW],"touches":[TOUCH],"interfaces":[]} ONLY when the change alters how components interact, what data is stored, or where the trust boundary sits. FLOW is {"id":"kebab-id","title":"plain name of what happens, e.g. Saving your format","trigger":"plain: what starts it","implements":["requirement ids"],"participants":[{"id":"kebab-id","icon":"one emoji","label":"plain short name (<=40), e.g. Account page, Server, Database","detail":"real component or module"}],"steps":[{"from":"participant id","to":"participant id","label":"one plain sentence of what happens (<=140)","detail":"the real endpoint, event, query or call","change":"new|changed","dashed":true,"outcome":"good|bad","code":{"file":"exact changed file","match":"text copied verbatim from one added or removed line of that file\'s diff"}}],"before":[steps for the same trigger before this PR, only when an existing flow changed],"beforeNote":"plain: what went wrong or worked differently before (<=240)","note":"optional"}. TOUCH is {"mark":"new|changed|removed|risk|same","what":"plain (<=80)","say":"what it means for people or other systems (<=200)","tech":"optional real endpoint, field or setting"}.\nFlows are sequence diagrams read top to bottom: one per real trigger, 2-5 participants, at most 8 steps, usually 1-3 flows including the main user action. Unmarked steps already worked this way; dashed marks steps outside the product\'s control; outcome bad marks where something is refused or went wrong. Give the steps a reviewer would want to see in code a code link. touches lists 2-8 places the change reaches the rest of the system: endpoints, stored data, dependencies, configuration, and behavior changes for existing users, marked risk. Leave interfaces empty. Never draw box-and-arrow maps.\nAfter a human review, add "sinceLastReview":{"previousHeadSha":"the reviewed revision","summary":"...","changes":[{"what":"what changed in response","files":["..."]}]} and keep the whole brief current. Do not modify product code, recapture screenshots, rerun implementation or merge.\nThen add "story": the show & tell a colleague gives in person, in about three minutes, without showing code. The reviewer sees it first; the brief fields above stay the checkable evidence behind it.\n"story":{"title":"what you did, first person (<=110), e.g. I hardened the WAGO integration for production.","summary":"the short version in one or two plain sentences (<=320)","stats":[{"value":"e.g. 6 / 7","label":"e.g. things you asked for, done"}],"slides":[SLIDE]}\nSLIDE is exactly one of:\n{"kind":"checklist","title":"...","say":"...","items":[{"state":"done|partly|open","label":"one thing that was asked (<=70)","detail":"where it landed (<=140)"}]}: the ask split into the separate things the person wanted, each with where it landed. Usually the first slide.\n{"kind":"beforeAfter","title":"...","say":"...","before":[NODE],"after":[NODE],"note":"optional"}: the core behavior change as two short step-by-step pipelines of what happens. NODE is {"label":"<=40","detail":"optional <=60","change":"new|changed (after only)","fallout":"optional <=60: what happens when this step says no"}. Name steps by what they do, never by class or function names. Use before:[{"label":"Nothing"}] for brand-new behavior.\n{"kind":"chart","title":"...","say":"...","method":"how it was measured (<=200)","scale":"linear|log","bars":[{"label":"<=60","value":positive number,"display":"printed value, e.g. 7,200 or 3.3 s","detail":"optional <=60","mark":"good|bad|neutral"}],"stats":[STAT]}: measured numbers from executed receipts only, such as load, timings, sizes or counts. Use log when values span more than 100x.\n{"kind":"screens","title":"...","say":"...","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}]}: one or two accepted screenshots that show the result.\n{"kind":"video","title":"...","say":"...","taskId":"...","sha256":"...","label":"..."}: an accepted video, only when motion or sequence is the point.\n{"kind":"points","title":"...","say":"...","items":[{"icon":"one emoji","title":"<=70","detail":"optional <=160"}]}: a few notable things that fit no other slide.\nStory rules:\n- Speak as Bob to the reviewer, first person, the way you would explain it at their desk: short sentences, everyday words, one idea per slide. title is the point of the slide (<=90); say is what you would add out loud (<=240). No code, file paths, class or function names, IDs or jargon a product owner would not use; when the reviewer must know a technical term, say what it means.\n- 2-6 slides in this order: what was asked and where each part landed, what changed (core behavior first), how we know it works, then anything else worth seeing. A small fix can be one beforeAfter slide and one proof slide.\n- Never repeat yourCall, notVerified or beyondAsk in slides: the reader presents them as their own slides after yours and ends with the decision. Because they appear in the show & tell, write them in the same plain voice: say what changes for people and what is at stake, not internal mechanics.\n- Be concrete: put the actual limits, counts and timings that changed into slide details (e.g. "at most 8 KB", "26 ms"), not "checks vary".\n- Every story screenshot sets focus to the pixels that matter (open the image to choose it), so it stays readable on a phone; prefer a pair that differs only in the condition shown.\n- A chart compares 2-8 different stages, conditions or cases measured the same way, so the bars differ meaningfully. Never chart a total against itself or offered against confirmed; headline totals belong in stats.\n- Translate technical terms into what a person experiences: "names longer than 128 characters or containing / or #" rather than "identifiers over 128 code units or containing MQTT wildcards"; "a generic error that does not say which version failed" rather than "revision 0 and an empty hash".\n- Every number, screenshot and claim comes from the evidence above; the story may simplify wording, never facts. stats holds 0-3 headline numbers a person remembers.\nThen add "tour": the code walkthrough under "Dig deeper", like a colleague scrolling through the diff with you. "tour":[{"file":"exact changed file","say":"one plain sentence: what this file now does or what changed in it (<=200)","key":true,"flag":"optional short reason to look (<=40), e.g. Changes sign-out everywhere","pins":[{"match":"text copied verbatim from one added or removed line of this file\'s diff","say":"plain note shown under that line (<=200)","flag":true}],"related":["tests, translations and small wiring that only serve this file"],"same":["files with the same mechanical change"]}]\nTour rules:\n- Order entries the way you would show them: the core rule or data first, then server, then screens, then wiring. key marks the 3-8 files that carry the change; they start open.\n- Every file in /progress/reviewScope/files appears exactly once in the tour: as file, in related or in same. Put each test under the file it tests and group repeated mechanical edits with same.\n- pins point at the 0-3 lines per file a reviewer must not miss: guards, defaults, removed behavior, security decisions. match is unique text from a single + or - line of the actual diff. flag what changes behavior for existing users or belongs to a yourCall or beyondAsk item worth a look.\n- Write say in the story\'s plain voice: what it does for people, no class or function names unless the reviewer must know them.\nWrite the evidence plainly too, as Dig deeper shows it:\n- requirements[].text is the outcome in plain words, and requirements[].how says in one plain sentence how it was checked (<=160), e.g. "Clicked through the German account page and compared the preview".\n- Every table proof row adds "plain":{"tried":"what was done (<=140)","saw":"what happened, keeping the key values (<=200)"}; cells keep the exact recorded values.\n- interpretation chosen and alternatives use words a product owner would use; note says why when it is not obvious. Keep at most 10 interpretation entries (the most consequential) and every hygiene text within 200 characters.\nFor video-v1 a requirement may use a video proof {"kind":"video","taskId","sha256","label"} from the current accepted video inventory, when motion or sequence is the point. Watching a clip never approves anything; keep explicit current-revision approval.',
		next: "handoff",
		qaContract: "qa-v1",
		guideContract: "brief-v3",
		videoContract: "video-v1",
	},
	{
		id: "handoff",
		name: "Verify revision and hand off",
		type: "tool",
		tool: "handoff",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "fix",
					equals: true,
				},
				next: "ci-fix",
			},
		],
		next: "human-review",
		qaContract: "qa-v1",
		videoContract: "video-v1",
	},
	{
		id: "human-review",
		name: "Human review",
		type: "tool",
		tool: "human-review",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "decision",
					equals: "reject",
				},
				next: "human-fix",
			},
		],
		next: "merge",
	},
	{
		id: "human-fix",
		name: "Address human feedback",
		type: "agent",
		prompt:
			'Address the latest human rejection/follow-up instructions in humanDecisions and human-review, preserving the accepted plan, decisions and all past review findings. Commit and push to the existing PR. Return {"summary":"what changed","checks":["commands and outcomes"]}. Do not merge, mark ready or assume approval.',
		next: "code-review",
	},
	{
		id: "merge",
		name: "Merge approved revision",
		type: "tool",
		tool: "merge",
		maxVisits: 200,
		branches: [
			{
				when: {
					path: "rework",
					equals: true,
				},
				next: "code-review",
			},
			{
				when: {
					path: "fix",
					equals: true,
				},
				next: "ci-fix",
			},
		],
		next: "end",
	},
];
