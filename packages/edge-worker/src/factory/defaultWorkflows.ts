import {
	architectureContinuationInstructions,
	architectureQuestionInstructions,
	checkinInstructions,
	implementationScopeInstructions,
} from "./Architecture.js";
import { installStockChecks } from "./CheckPresets.js";
import { feedbackPolicyInstructions } from "./FeedbackPolicy.js";
import {
	briefVideoInstructions,
	DIVE_CONTRACT,
	divePrompt,
} from "./GuideAuthoring.js";
import { impactInstructions } from "./Impact.js";
import { instructionTemplate } from "./InstructionLibrary.js";
import { improvementWorkflow } from "./improvementWorkflow.js";
import {
	attachmentLaunchField,
	standardLaunchFields,
	takeoverLaunchFields,
} from "./LaunchFields.js";
import { QA_CONTRACT } from "./Qa.js";
import { reviewFixInstructions } from "./ReviewRecovery.js";
import { hasCheck, legacyStepPreset, readStep } from "./StepConfig.js";
import {
	inventoryGuideInstructions,
	inventoryQaInstructions,
	legacySpecialistSteps,
} from "./specialistSteps.js";
import { videoPrompts } from "./videoPrompts.js";
import {
	validateWorkflows,
	WorkflowSchema,
	type WorkflowStep,
} from "./Workflow.js";
import { MAX_STEP_VISITS } from "./WorkflowLimits.js";

const agent = (id: string, name: string, prompt: string, extra = {}) => ({
	id,
	name,
	type: "agent",
	prompt,
	...extra,
});
const tool = (id: string, name: string, tool: string, extra = {}) => ({
	id,
	name,
	type: "tool",
	tool,
	maxVisits: MAX_STEP_VISITS,
	...extra,
});
const back = (path: string, next: string) => [
	{ when: { path, equals: false }, next },
];

const review = `Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.`;
const fix = `Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\n${reviewFixInstructions}`;

const githubApiHelper = String.raw`sh -c "$BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND github-api \"\$@\"" bobs-factory --repo "$repoUrl" --request "$requestFile"`;

const ciAssessmentInstructions = ` Set reviewRequired=false ONLY when every newly assessed comment is informational, explicitly ignored by the user, or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.\n${feedbackPolicyInstructions}`;

const definitions = [
	{
		id: "simple",
		launchFields: [
			...standardLaunchFields.map((field) => ({
				...field,
				label: "What should Bob do?",
				placeholder: "What should Bob do?",
			})),
			attachmentLaunchField,
		],
		allowedTriggers: ["manual", "ticket-assignment"],
		icon: "⚡",
		name: "Simple / Bob’s Factory",
		description:
			"The existing Bob’s Factory run, with its original prompts, skills and runner lifecycle.",
		labels: ["workflow:simple"],
		chat: true,
		steps: [],
	},
	{
		id: "factory",
		launchFields: [...standardLaunchFields, attachmentLaunchField],
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		icon: "🏭",
		name: "Software factory",
		description:
			"Clarify and plan, then review architecture before coding and deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: ["workflow:factory", "factory"],
		steps: [
			agent(
				"clarify",
				"Clarify requirements",
				`Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. For selectable alternatives, use questionChoices with questionIndex, selection (single or multiple), options (unique id, answer, optional reason) and optional preselectedOptionIds. Do not use questionRecommendations for the same question. Custom text is always available and defaults require explicit submission. Empty questions means everything is understood. Preserve all answered decisions across rounds.`,
				{ askQuestions: true },
			),
			tool("decisions", "Record decisions", "record-decisions"),
			agent(
				"plan",
				"Write implementation plan",
				`Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. When taking over, include the existing-work and assess-existing results and PR review discussion; preserve completed work and plan only the remaining changes. Include the existing PR URL/branch and require continuing it. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. ${implementationScopeInstructions} Do not implement.`,
			),
			agent(
				"plan-review",
				"Review implementation plan",
				`Review the plan against ALL input/comments/metadata and decisions. ${implementationScopeInstructions} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["specific missing requirements or improvements"]}. Approve a practical MVP plan when complete.`,
				{ branches: back("approved", "plan") },
			),
			agent(
				"implement",
				"Implement accepted plan",
				`Implement the provided plan and use its assets. Read /answers alongside /plan for subsequent human responses, including resolution of implementation blockers. ${implementationScopeInstructions} Follow repository conventions and appropriate verification. If implementation is forbidden, deferred, or blocked by missing access or a necessary decision, preserve completed work and return {"status":"blocked","summary":"concrete blocker","checks":["commands and outcomes"],"questions":["specific question or action needed to unblock implementation"]}. The workflow waits for an answer and resumes this role; do not report deferred or unfinished work as completed. Only after completing implementation return {"status":"completed","summary":"...","checks":["commands and outcomes"],"questions":[]}. Do not create or publish a PR; the next step handles delivery.`,
				{ inputs: ["plan"], askQuestions: true },
			),
			tool("draft-pr", "Push and create draft PR", "draft-pr"),
			agent("code-review", "Review code", review),
			tool("review-gate", "Discard nitpicks / review gate", "review-gate", {
				branches: back("approved", "code-fix"),
			}),
			tool("ci", "Watch merge readiness", "ci", {
				branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
			}),
			agent(
				"visual-scope",
				"Plan QA stories and screenshots",
				`Read the accepted requirements, all recorded decisions/expectations, plan, implementation receipts, relevant history and exact cumulative base-to-head PR diff (including inherited takeover work). Plan observable QA for ALL changed behavior: UI, API, CLI and other interfaces. Declare environment:{isolation:"worktree"} only when all QA uses independent per-worktree servers, databases and fixtures. For shared clusters, databases, fixtures or browser control return environment:{isolation:"shared",resources:["stable shared resource identity"]}; use the same identity across repositories/runs using that resource. Unknown isolation requires shared protection, never assume a worktree isolates external resources. Cover happy paths and consequential failure, permission and boundary cases proportionately. Trace stories to agreed requirements; do not invent business requirements or turn subjective preferences into blocking criteria. Explain any requirement/diff area outside executable QA in exclusions. Assess navigation, feedback, readability and recovery where relevant.
Return {"qaContract":"qa-v1","changed":false,"areas":[],"captureBudget":24,"stories":[{"id":"stable-story-id","goal":"user goal","requirementRefs":["requirements/0 or decisions/0 or answers/0 (existing zero-based accepted record)"],"interface":"ui or api or cli or other","preconditions":["setup"],"fixtures":["access or data needed"],"actions":["ordered executable action"],"criteria":[{"id":"globally unique stable criterion ID","expected":"observable expected outcome"}],"evidenceInstructions":"how to execute and record evidence","screenshotTasks":[{"area":"exact selected area","state":"exact selected state at a defined point in these actions"}]}],"exclusions":[{"requirementRef":"requirement/diff area","reason":"concrete reason outside executable QA"}]}.
changed refers only to VISUAL scope. Nonvisual changes still need executable stories with real behavioral checks and may have zero screenshots. No changed executable behavior may use stories=[] only with a concrete notApplicableReason; no visual changes is insufficient. Inspect relevant existing tests before selecting them as criterion evidence.
For visuals return changed=true and areas:[{name,url,states:["single concrete representative state"],instructions,rationale,dependencies,changed}]. Normally choose 1–2 states per area and at most 24 screenshots. Group co-visible elements. Never multiply viewport/language/role combinations or comma-separated alternatives. Additional states must show distinct changed rendering risk. Up to 48 needs a concrete budgetReason. Every selected area/state must be linked to a story; API/CLI checks do not need artificial images. Dependencies are exact repository files or directory/** paths. Do not change code, execute QA or take screenshots.`,
				{ qaContract: QA_CONTRACT },
			),
			agent(
				"capture",
				"Execute QA and capture screenshots",
				`Execute EVERY planned QA story and acceptance criterion from visual-scope, including nonvisual API/CLI behavior. Read /answers for resolved access, fixtures and tooling blockers. Set up the application once when needed, use appropriate actual fixtures, and execute browser/HTTP/CLI/tests as instructed. Inspect test coverage and run the checks; source inspection or an implementation receipt alone cannot establish a pass. Compare observed outcomes with each exact expected outcome. Assess applicable navigation, feedback, readability and recovery. Do not modify product code or repair failures.
Return {"qaContract":"qa-v1","results":[{"storyId":"planned ID","outcome":"passed or failed or blocked","criteria":[{"criterionId":"planned ID","outcome":"passed or failed or blocked","expected":"exact expected outcome from scope","observed":"actual observed outcome","blockedReason":"concrete assistance needed when blocked","evidence":[{"kind":"command or test or http or browser or log","executed":true,"action":"actual command/request/actions performed","details":"exit/result/request-response/log details demonstrating this criterion","exitCode":0,"screenshotTasks":[{"area":"selected area","state":"selected state"}]}]}]}],"findings":[{"id":"stable finding ID","rating":3,"summary":"consequential requirement failure","evidence":"concrete receipt","status":"open","storyId":"planned ID","criterionId":"planned criterion ID","requirementRefs":["accepted requirement"],"reproduction":["steps"],"expected":"expected behavior","actual":"actual behavior"}],"observations":[{"id":"stable observation ID","summary":"optional UI/UX improvement","evidence":"observed details","storyId":"story ID"}],"screenshots":[{"path":"absolute real image path","caption":"what it demonstrates","area":"exact area","state":"exact state"}],"unavailable":[{"area":"selected area","reason":"concrete missing access/tooling/setup or failed behavior","cause":"access or product"}]}.
One result per story and criterion. Ratings 2/3 are consequential failures against agreed requirements; keep optional preferences in observations. Product failures are failed with actionable findings. If failed product behavior prevents a selected screenshot, report unavailable with cause:"product" linked to that failing story; missing access/tooling uses cause:"access". Missing access, fixtures or tooling is blocked with a concrete reason; never pass an unexecuted check. Story outcome must agree with criterion outcomes. Do not supply a revision claim; runtime stamps provenance. Execute criteria freshly on each visit; image reuse never establishes a behavioral pass.
Capture exactly the selected representative screenshot tasks at their defined points DURING the story flows. Keep the captureBudget (normally 24, justified maximum 48), one real PNG/JPEG per exact area/state. Do not invent states or expand combinations. Save images under the supplied evidence directory with fresh filenames for each revision; inspect actual captures for readability. Keep the complete inventory, including provenance-eligible explicitly accepted unchanged images. Never claim images or checks that do not exist. Stop only servers you started, after all testing and captures finish.`,
				{ next: "visual-review", qaContract: QA_CONTRACT },
			),
			agent(
				"visual-review",
				"Review QA and screenshots",
				`${review}
This is a QA AND SCREENSHOT review. Return qaContract:"qa-v1" alongside the review fields. Inspect accepted business requirements and expectations, cumulative diff, planned stories, complete criterion coverage, executed test receipts, failures, blocked checks, optional observations and all retained disputes. A screenshot alone cannot prove behavior, and an agent saying passed without actual executed evidence is insufficient. Missing/blocked required QA cannot be approved. Failed required behavior requires a fix and retest even when a fixer rejects a complaint. Corrections to erroneous scenarios must match accepted requirements and record a rationale.
Open the actual selected screenshots. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good image, using its exact supplied hash. Exclude images affected by unresolved findings. Missing critical SELECTED states is rating 3; do not invent larger viewport/language/role matrices. Request only minimum targeted replacements by exact area/state. Preserve explicitly accepted unchanged image receipts and optional observations without making preferences blocking. Return complete current coverage, not merely the latest delta. Do not execute QA again, change code or recapture images.`,
				{ next: "visual-gate", qaContract: QA_CONTRACT },
			),
			tool("visual-gate", "QA and screenshot gate", "visual-gate", {
				branches: back("approved", "visual-fix"),
				next: "guide",
				qaContract: QA_CONTRACT,
			}),
			agent("code-fix", "Fix review findings", fix, { next: "code-review" }),
			agent(
				"ci-fix",
				"Fix CI failures",
				`Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using the selected Git provider (GitHub: write a token-free JSON request file with method POST, path graphql and body {query,variables}, set repoUrl to the selected HTTPS repository URL and requestFile to that file, then run ${githubApiHelper} with the resolveReviewThread mutation; GitLab: glab api PUT the MR discussion with resolved=true; custom: the configured adapter). Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-bobs-factory --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready.` +
					ciAssessmentInstructions,
				{ next: "after-ci-fix" },
			),
			tool(
				"after-ci-fix",
				"Check whether code needs another review",
				"review-after-fix",
				{
					branches: [
						{ when: { path: "reviewRequired", equals: false }, next: "ci" },
					],
					next: "code-review",
				},
			),
			agent(
				"visual-fix",
				"Fix QA and visual findings",
				fix +
					" Include independently generated visual-gate findings as well as reviewer findings. Preserve stable dispositions. Rejected complaints require concrete evidence and reviewer reassessment; rejection cannot waive a failed required criterion. After corrections the pipeline returns through code review, CI, QA scope, execution, review and gate. Failed criteria must be retested before the human guide.",
				{ next: "code-review", qaContract: QA_CONTRACT },
			),
			agent("guide", "Prepare human review brief", divePrompt, {
				next: "handoff",
				qaContract: QA_CONTRACT,
				guideContract: DIVE_CONTRACT,
			}),
			tool("handoff", "Verify revision and hand off", "handoff", {
				branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				next: "human-review",
				qaContract: QA_CONTRACT,
			}),
			tool("human-review", "Human review", "human-review", {
				branches: [
					{ when: { path: "decision", equals: "reject" }, next: "human-fix" },
				],
				next: "merge",
			}),
			agent(
				"human-fix",
				"Address human feedback",
				`Address the latest human rejection/follow-up instructions in humanDecisions and human-review, preserving the accepted plan, decisions and all past review findings. Commit and push to the existing PR. Return {"summary":"what changed","checks":["commands and outcomes"]}. Do not merge, mark ready or assume approval.`,
				{ next: "code-review" },
			),
			tool("merge", "Merge approved revision", "merge", {
				branches: [
					{ when: { path: "rework", equals: true }, next: "code-review" },
					{ when: { path: "fix", equals: true }, next: "ci-fix" },
				],
				next: "end",
			}),
		],
	},
];

const pipeline = definitions[1]!;
for (const step of pipeline.steps) {
	if (
		![
			"visual-scope",
			"capture",
			"visual-review",
			"visual-gate",
			"guide",
			"handoff",
		].includes(step.id)
	)
		continue;
	Object.assign(step, { videoContract: "video-v1" });
	if ("prompt" in step) {
		step.prompt +=
			"guideContract" in step
				? briefVideoInstructions
				: (videoPrompts[step.id] ?? "");
	}
}

const planStep = pipeline.steps.find((step) => step.id === "plan")!;
if (!("prompt" in planStep)) throw new Error("Stock planner unavailable");
const ticketPlanInstructions =
	" Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links.";
planStep.prompt += ticketPlanInstructions;
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

// Kept for conservative saved-recipe detection and legacy runtime regression fixtures.
export const legacyReviewSteps = structuredClone(pipeline.steps);
function installSpecialists(steps: Record<string, any>[]) {
	const index = steps.findIndex((s) => s.id === "code-review");
	steps.splice(index, 1, ...structuredClone(legacySpecialistSteps));
	for (const step of steps) {
		if (step.next === "code-review") step.next = "extract-requirements";
		for (const branch of step.branches ?? [])
			if (branch.next === "code-review") branch.next = "extract-requirements";
		if (step.id === "review-gate") {
			step.name = "Aggregate specialist findings and coverage";
			step.review = {
				inventory: "extract-requirements",
				fanout: "specialist-review",
			};
		}
		if (step.tool === "human-review")
			step.branches = [
				...(step.branches ?? []),
				{
					when: { path: "rework", equals: true },
					next: "extract-requirements",
				},
			];
		if (
			step.id === "visual-scope" &&
			!step.prompt.includes(inventoryQaInstructions)
		)
			step.prompt += inventoryQaInstructions;
		if (
			step.id === "guide" &&
			!step.guideContract &&
			!step.prompt.includes(inventoryGuideInstructions)
		)
			step.prompt += inventoryGuideInstructions;
	}
}
installSpecialists(pipeline.steps);
const stockPlanReview = pipeline.steps.find((s) => s.id === "plan-review")!;
if (!("prompt" in stockPlanReview))
	throw new Error("Stock plan reviewer unavailable");
const oldPlanReview = {
	...structuredClone(stockPlanReview),
	branches: back("approved", "plan"),
};
const implementationStep = pipeline.steps.find((s) => s.id === "implement")!;
if (!("prompt" in implementationStep))
	throw new Error("Stock implementer unavailable");
implementationStep.prompt +=
	" If subsequent answers or steering materially change the accepted architecture, preserve completed work and return status=blocked, architectureRevision=true, summary explaining the changed requirement, checks, and questions=[]. The runtime returns to architecture proposal/review and requires fresh acceptance when meaningful. Never implement a materially changed architecture using acceptance of an earlier version.";
/** Openings of every stock review-v1 proposer and reviewer prompt release. */
const stockProposalOpening =
	"Inspect the selected repositories, actual module boundaries and conventions";
const stockProposalReviewOpening =
	"Review the architecture candidate and its complete implementation plan";
const checkinReviewPrompt = `Review the check-in and its complete implementation plan against ALL requirements, comments, answers, decisions and inherited Takeover work. Require briefVersion=2 and a check-in a product owner can read in about two minutes: understood restates the human's goal in their terms; plan states the approach; scenes show what people or devices experience before and after as short observable steps; notice names every group that will notice, including upgrades, required configuration and anything that stops working; checks list only calls that need human judgment with the honest alternative; size and split are truthful. Reject jargon, file paths or class names in the check-in, benefit statements in place of behavior, consequences missing from notice, and calls that only the human can judge hidden in decisions. Also require concrete current-state findings, observable deliverables with anticipated files/operations/size estimates and criterion traces, every original acceptance criterion with honest covered/partial/deferred status and plain reason, justified Bob-added work, explicit non-goals, measurable acceptance checks and open decisions with Bob's lean. ${implementationScopeInstructions} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. ${architectureContinuationInstructions} Only when the COMPLETE candidate remains within that latest human acceptance, with no open decisions or unresolved uncertainty, include continuation:{proposalId:"exact accepted proposal ID",version:1,digest:"exact accepted digest",reason:"concrete evidence that cumulative changes preserve the accepted requirements, decisions, boundaries, limits, exclusions and delivery targets"}. This is an independent continuity assessment, never a new human acceptance. Omit continuation for initial proposals, material changes, explicit reapproval requirements, rejection or uncertainty. Compare the check-in to the full plan: reject hidden deliverables, omitted known conditional work or criteria, vague options, limits whose values or measurement selection rules appear only in the full plan, unsupported coverage claims, unnecessary packages or frontend work, and process status masquerading as technical risk. Inspect runtime footprint warnings, including invalid paths, operation mismatches and unchanged map parts listed for work; require correction or a concrete explanation of intentional cross-area/config changes. Assess repository evidence, decisions and options, map, readability and routine classification. Reject proposals that hide a real choice or leave a decision open that the repository already settles. Do not implement. ${architectureQuestionInstructions} Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["concrete required changes"]}.`;
const architectureSteps = [
	agent("architecture", "Prepare the check-in", checkinInstructions, {
		architectureContract: "architecture-v1",
		architectureBrief: "checkin-v1",
	}),
	{
		...oldPlanReview,
		id: "architecture-review",
		name: "Review the check-in",
		prompt: checkinReviewPrompt,
		architectureContract: "architecture-review-v1",
		architectureSource: "architecture",
		// Independent review may retain a prior human decision for implementation-only revisions.
		branches: back("approved", "architecture"),
	},
	tool("architecture-decision", "Check in with you", "architecture-decision", {
		arguments: {
			proposal: "architecture",
			review: "architecture-review",
			planOutput: "plan",
			revise: "architecture",
			approval: "meaningful",
			continueAccepted: true,
		},
		next: "implement",
		branches: [
			{ when: { path: "decision", equals: "revise" }, next: "architecture" },
		],
	}),
];
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
pipeline.steps.splice(
	pipeline.steps.findIndex((s) => s.id === "implement"),
	0,
	...architectureSteps,
);

// Install only in newly accepted stock definitions; saved run snapshots are never rewritten.
const deliveryInstructions = ` Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution.`;
for (const step of pipeline.steps) {
	if (["clarify", "plan", "plan-review"].includes(step.id) && "prompt" in step)
		step.prompt += deliveryInstructions;
	if (step.id === "clarify" && "prompt" in step)
		step.prompt +=
			' Include deliveryMode:"repository"|"external"|"mixed". Do not ask to authorize unrelated repository implementation for external tasks.';
	if (step.id === "plan" && "prompt" in step)
		step.prompt += ` Include deliveryContract:{format:"delivery-v1",version:1,mode:"repository"|"external"|"mixed",authorization:{status:"authorized"|"deferred",reference:"actual instruction/answer reference"},executionReference:"digest supplied in deliveryExecutionReference",targets:[{key:"stable target ID",resource:{provider:"linear",instance:"https://linear.app",workspaceId:"configured workspace",project:"immutable project or team ID",id:"immutable UUID",url:"verified URL"} OR {provider:"taskbot",server:"configured server",instance:"exact HTTPS origin",project:"project slug",id:"numeric ID as string",url:"exact URL"},capabilities:["read","content","relationships"],baseline:{fields:{title:"observed title",description:"complete observed content"},relationships:[{type:"blocks"|"related",from:"immutable ID",to:"immutable ID"}]},operations:[{id:"stable operation ID",kind:"content",fields:{description:"full desired content"}} OR {id:"stable ID",kind:"add"|"remove",relationship:{type:"blocks"|"related",from:"ID",to:"ID"}}],criteria:[{id:"stable criterion",requirementRef:"accepted requirement reference",description:"observable acceptance criterion",fields:{description:"full expected content"},relationships:[],absentRelationships:[]}],preservedRelationships:[]}]}. Repository mode uses targets:[]; external/mixed need complete targets. Fetch complete before-state and verify coordinates through configured integrations. Do not mutate. Store no credentials. Include full expected fields and preserved relationships. On correction increment version and use new operation IDs for changed intents; retain already-applied history.`;
	if (step.id === "plan-review" && "prompt" in step)
		step.prompt +=
			" Confirm delivery mode, target identities, authorization, complete baseline, allowed operations and every criterion. Return deliveryContractDigest using the supplied deliveryCandidateDigest only when approving that exact contract. Incomplete or contradictory contracts cannot be approved.";

	if (step.id === "merge")
		Object.assign(step, {
			branches: [
				...("branches" in step ? (step.branches as any[]) : []),
				{
					when: { path: "externalPending", equals: true },
					next: "external-final",
				},
			],
		});
}
// Mixed feedback renews the external contract before repository work resumes.
const initialHumanReview = pipeline.steps.find((s) => s.id === "human-review")!;
for (const branch of (initialHumanReview as Record<string, any>).branches)
	if (branch.when.path === "decision" && branch.when.equals === "reject")
		branch.next = "delivery-feedback-route";
const planReview = pipeline.steps.find((s) => s.id === "plan-review")!;
Object.assign(planReview, { next: "delivery-route" });
(pipeline.steps as Record<string, any>[]).push(
	tool(
		"delivery-feedback-route",
		"Route requested delivery corrections",
		"delivery-mode",
		{
			branches: [
				{
					when: { path: "mode", equals: "mixed" },
					next: "external-correction",
				},
			],
			next: "human-fix",
		},
	),
	tool(
		"delivery-route",
		"Validate accepted delivery contract",
		"delivery-route",
		{
			branches: [
				{ when: { path: "deferred", equals: true }, next: "delivery-deferred" },
				{ when: { path: "mode", equals: "external" }, next: "external-apply" },
				{ when: { path: "mode", equals: "mixed" }, next: "external-apply" },
			],
			next: "architecture",
		},
	),
	agent(
		"delivery-deferred",
		"Resolve execution deferral",
		"The accepted delivery contract defers execution. Do not mutate tickets or files. Ask whether the named external/repository task should remain deferred or may proceed. Return questions while the deferral remains. Read answers; only explicit authorization may return questions:[], then the planner and plan reviewer renew the contract. Never infer execution permission from scope answers.",
		{ askQuestions: true, next: "plan" },
	),
	tool("external-apply", "Apply authorized ticket changes", "external-apply", {
		next: "external-verify",
	}),
	tool(
		"external-verify",
		"Independently verify ticket state",
		"external-verify",
		{ next: "external-after-verify" },
	),
	tool(
		"external-after-verify",
		"Route verified deliverables",
		"delivery-mode",
		{
			branches: [
				{
					when: { path: "repositoryComplete", equals: true },
					next: "external-guide",
				},
				{ when: { path: "mode", equals: "mixed" }, next: "architecture" },
			],
			next: "external-guide",
		},
	),
	tool("external-guide", "Prepare external review", "external-guide", {
		next: "external-human-review",
	}),
	tool(
		"external-human-review",
		"Accept completed external work",
		"human-review",
		{
			branches: [
				{
					when: { path: "decision", equals: "reject" },
					next: "external-correction",
				},
			],
			next: "external-final",
		},
	),
	agent(
		"external-correction",
		"Plan requested ticket corrections",
		"Read humanDecisions, the accepted delivery contract, operation receipts and verified state. Applied changes remain; rejection does not roll them back. Preserve feedback and before/after history. Do not mutate tickets or repository files, commit or push. Before repository merge, summarize both ticket and repository feedback for the revised plan; preserve existing repository work and let implementation apply the reviewed corrections. After repository merge, corrections on this path concern external deliverables only. Confirmed repository merges remain retained. Repository changes requested after merge need a separate follow-up, never replay publication or merge. Summarize the requested corrections for a revised plan and independent plan review.",
		{ next: "plan" },
	),
	tool("external-final", "Check accepted external state", "external-final", {
		branches: [
			{ when: { path: "drift", equals: true }, next: "external-reverify" },
		],
		next: "end",
	}),
	tool(
		"external-reverify",
		"Verify changed external state",
		"external-verify",
		{ next: "external-guide" },
	),
);
// Only newly created stock definitions opt in. Accepted run snapshots are never rewritten.
function installImpact(steps: Record<string, any>[]) {
	const fanout = steps.find((s) => s.type === "fanout" && s.review);
	if (!fanout) return;
	const inventory = steps.find((s) => s.id === fanout.review.inventory)!;
	const assessId = "assess-impact";
	const checksId = "impact-checks";
	const index = steps.findIndex((s) => s.id === inventory.id);
	steps.splice(
		index,
		0,
		agent(
			assessId,
			"Assess changed work and retained evidence",
			impactInstructions,
			{
				impactContract: "impact-v1",
				impact: {
					inventory: inventory.id,
					fanout: fanout.id,
					maxUnchangedCycles: 3,
				},
				askQuestions: true,
				maxVisits: MAX_STEP_VISITS,
				branches: [
					{
						when: { path: "correctionRequired", equals: true },
						next: "ci-fix",
					},
					{ when: { path: "readinessOnly", equals: true }, next: "ci" },
					{
						when: { path: "extractRequirements", equals: true },
						next: inventory.id,
					},
				],
				next: checksId,
			},
		),
	);
	steps.splice(
		steps.findIndex((s) => s.id === fanout.id),
		0,
		tool(checksId, "Run independently selected checks", "impact-checks", {
			impactSource: assessId,
			next: fanout.id,
		}),
	);
	inventory.next = checksId;
	inventory.prompt +=
		"\nFor impact-v1 runs declare requirement stage:code|qa|guide|acceptance|delivery from the accepted requirement source. Code is the default; later-stage obligations remain mandatory at their named gates. Do not reclassify implementation defects as future obligations.";
	fanout.impactSource = assessId;
	// Every corrective route shares one assessment; initial and scope-changed work extracts fully.
	for (const step of steps) {
		if (
			![assessId, inventory.id].includes(step.id) &&
			step.next === inventory.id
		)
			step.next = assessId;
		if (step.id !== assessId)
			for (const branch of step.branches ?? [])
				if (branch.next === inventory.id) branch.next = assessId;
		if (
			[
				"ci",
				"handoff",
				"human-review",
				"merge",
				"review-after-fix",
				"review-gate",
				"visual-gate",
			].includes(step.tool)
		)
			step.impactSource = assessId;
		if (step.tool === "review-after-fix") {
			step.branches = [];
			step.next = assessId;
		}
		if (step.tool === "handoff")
			step.branches.unshift({
				when: { path: "impactRequired", equals: true },
				next: assessId,
			});
		if (step.tool === "ci")
			step.branches.unshift(
				{ when: { path: "impactRequired", equals: true }, next: assessId },
				{ when: { path: "retainQa", equals: true }, next: "guide" },
			);
		if (step.id === "visual-scope")
			step.prompt +=
				"\nFor impact-v1 runs, retain all story definitions and declare complete per-story dependencies plus environmentFingerprint and environmentEvidence:{repositoryId,command,expectedDigest} for fixture, dependency and environment identity. The runtime executes that read-only probe; expectedDigest is the SHA-256 of its trimmed UTF-8 stdout, without JSON quoting. Use a probe that observes actual fixtures and tool versions, not a constant label. Unknown or unavailable probes require fresh execution. If external environment identity is unknown, omit its fingerprint to force execution. Behavioral reuse requires the shared independent impact assessment and exact original passed criterion provenance.";
		if (step.id === "capture")
			step.prompt +=
				"\nFor impact-v1 runs read /qaReuse. Copy only runtime-validated reusable criteria exactly with their original evidence and reuse link. Execute every other criterion. Never invent a reuse link, reset an original execution date or mark failed/blocked criteria passed.";
		if (step.id === "guide") step.prompt += impactGuideInstructions;
	}
}
export const conservativeWorkflows = validateWorkflows([
	definitions[0],
	{
		...pipeline,
		steps: [
			{
				id: "pipeline",
				name: "Factory pipeline",
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		id: "takeover",
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		icon: "🤝",
		launchFields: [...takeoverLaunchFields, attachmentLaunchField],
		name: "Take over existing work",
		description:
			"Inspect an existing PR or ticket, clarify remaining work, then continue through the shared factory pipeline. Existing PRs stay draft for human review.",
		labels: ["workflow:takeover", "takeover"],
		steps: [
			tool(
				"existing-work",
				"Inspect existing work and discussion",
				"inspect-existing",
			),
			agent(
				"assess-existing",
				"Assess completed and remaining work",
				`Inspect the existing worktree, diff, ticket/PR discussion and review feedback. Do not discard or rewrite completed work. Return {"completed":["..."],"remaining":["..."],"risks":["..."],"assets":["..."]}. Identify unresolved feedback and questions to carry into clarification/planning. Do not implement or modify code.`,
			),
			{
				id: "pipeline",
				name: "Continue factory pipeline",
				type: "workflow",
				workflow: "factory-pipeline",
			},
		],
	},
	{
		...pipeline,
		id: "factory-pipeline",
		name: "Shared factory pipeline",
		internal: true,
		allowedTriggers: ["workflow"],
		labels: [],
	},
]);

// New launches opt in; saved/custom graphs upgrade through conservative definitions.
const impactDefaults = structuredClone(conservativeWorkflows);
installImpact(impactDefaults.find((w) => w.id === "factory-pipeline")!.steps);
/** Author stock configurations once; accepted historical definitions stay untouched. */
function configuredStock(value: unknown) {
	const workflow = WorkflowSchema.parse(value);
	const result = structuredClone(workflow);
	result.stepConfigVersion = "step-config-v1";
	const walk = (steps: WorkflowStep[]) => {
		const ids = new Set(steps.map((step) => step.id));
		const architectureRevision = steps.some(
			(step) => step.tool === "architecture-decision",
		);
		for (const step of steps) {
			const preset = legacyStepPreset(step, {
				workflowId: workflow.id,
				rootWorkflowId: workflow.id,
				architectureRevision,
			});
			const template = instructionTemplate(step.prompt ?? "");
			Object.assign(step, {
				configVersion: "step-config-v1",
				reads: Object.fromEntries(
					Object.entries(preset.reads).map(([name, read]) => [
						name,
						read.when ? read : read.from,
					]),
				),
				rules: preset.rules,
				checks: preset.checks.map(({ check, args }) =>
					Object.keys(args).length ? { check, ...args } : check,
				),
				access: preset.access,
				instructions: [
					...new Set([...preset.instructions, ...template.instructions]),
				],
				...(preset.output ? { output: preset.output } : {}),
				...(preset.revision ? { revision: preset.revision } : {}),
				...(step.prompt !== undefined ? { prompt: template.prompt } : {}),
			});
			if (step.type === "agent" && !step.output)
				step.output = { format: "json-v1" };
			if (step.type === "agent" && preset.access.mode === "push")
				step.reads!.publication = "draft-pr";
			if (step.type === "tool") {
				Object.assign(step.reads!, {
					draftPr: "draft-pr",
					ci: "ci",
					guide: "guide",
					reviewGate: "review-gate",
					handoff: "handoff",
					merge: "merge",
				});
				if (
					["ci", "review-after-fix", "merge-readiness"].includes(
						step.tool ?? "",
					)
				)
					step.reads!.review ??= "code-review";
				if (step.tool === "delivery-route")
					Object.assign(step.reads!, {
						plan: "plan",
						planReview: "plan-review",
						review: "plan-review",
						clarify: "clarify",
					});
				if (step.id === "external-human-review")
					step.arguments = { ...step.arguments, externalReview: true };
			}
			for (const [name, binding] of Object.entries(step.reads ?? {})) {
				const from = typeof binding === "string" ? binding : binding.from;
				if (!from.startsWith("@") && !ids.has(from.split("/")[0]!))
					delete step.reads![name];
			}
			// Binding aliases remain available for old frozen definitions only.
			for (const key of [
				"qaContract",
				"videoContract",
				"guideContract",
				"architectureContract",
				"architectureBrief",
				"reviewContract",
				"impactContract",
				"impactSource",
				"architectureSource",
				"review",
				"impact",
				"delivery",
			] as const)
				delete step[key];
			for (const group of step.groups ?? []) walk(group);
		}
	};
	walk(result.steps);
	installStockChecks(result.steps);
	return result;
}
export const defaultWorkflows = validateWorkflows([
	...impactDefaults.map(configuredStock),
	configuredStock(improvementWorkflow),
]);

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
