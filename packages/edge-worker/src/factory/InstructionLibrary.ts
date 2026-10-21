import {
	architectureContinuationInstructions,
	architectureQuestionInstructions,
	briefRuntimeInstructions,
	briefVideoInstructions,
	calibratedReviewInstructions,
	ciFixRuntimeInstructions,
	feedbackPolicyInstructions,
	guideArtifactInstructions,
	guideGapFixInstructions,
	guideMapInstructions,
	implementationScopeInstructions,
	inventoryGuideInstructions,
	inventoryQaInstructions,
	reviewCompletionInstructions,
	reviewFixInstructions,
	reviewStageInstructions,
	videoPrompts,
} from "./InstructionText.js";
import { type InstructionId, resolveStepConfig } from "./StepConfig.js";

const ciAssessmentInstructions = ` Set reviewRequired=false ONLY when every newly assessed comment is informational, explicitly ignored by the user, or already accepted with unchanged requirements; otherwise true, including any rejected complaint, new requirement or unresolved disagreement. Return reviewRequired alongside the other fields. The runtime independently verifies code/base revisions before skipping review.\n${feedbackPolicyInstructions}`;

const ticketPlanInstructions =
	" Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links.";

const impactGuideInstructions =
	"\nFor impact-v1 follow-ups, preserve the complete original guide and unaffected coverage. Describe cumulative changes since prior explicit approval, independent impact rationale, fresh and reused evidence, checks and risks in a delta note. Safe minor production corrections may retain prior explicit approval after required checks; other changes require renewed acceptance. Filename and line-count restrictions do not apply to this contract. Declared future acceptance/delivery obligations remain pending at their own gates, never call them defects in the code gate.";

const deliveryInstructions = ` Delivery mode comes from accepted requirements: repository (including repository docs/config), external (ticket content/relationships), or mixed. Never infer it from an empty diff. No repository changes may authorize external edits; execution deferral remains separate. Runtime owns lifecycle status/comments and PR links. External review follows authorized application and independent verification. Missing integration access blocks execution.`;

export const incrementalRoleInstructions: Record<string, string> = {
	"code-fix": reviewFixInstructions,
	"visual-fix": reviewFixInstructions,
	"visual-scope": `For a repeat, compare /progress/previousOutput with the revision delta. For qa-v1, retain the COMPLETE cumulative story/criterion inventory traced to accepted requirements, including inherited work. Reassess affected criteria, exclusions and unresolved disputes against the full PR. Return the COMPLETE cumulative visual area/state inventory, updating only affected areas, not merely the newest delta. If previousOutput has no captureBudget or contains combined/matrix state labels, first replace the legacy evidence plan with at most 24 concrete representative states covering the cumulative changed feature. This compaction applies even to unchanged areas: preserve requirements and risk coverage, not every historical screenshot combination. Group co-visible regions, choose 1–2 exact states per area, and document omitted redundant combinations in rationale; use existing tests for nonvisual behavior. Do not copy the old matrix into the new plan. Reuse existing images only when they exactly demonstrate a selected state and meet the usual provenance/acceptance rules. Set captureBudget=24, with a justified exception up to 48 only when essential distinct visual coverage requires it. Include per-area dependencies as exact relative repository files or directory/** groups (including all shared components/styles/assets that affect the area); do not use other glob syntax, changed=true for affected/new/uncertain areas and changed=false only for proven unaffected areas. Include nonVisualFiles for changed files demonstrated to have no visual effect. An unexplained/global dependency change invalidates every possibly affected area. If the original PR had visual changes, changed remains true even when the newest correction is nonvisual; unchanged areas can reuse prior capture evidence.`,
	capture: `For a repeat, read /progress/previousOutput and current visual-scope. In qa-v1 copy finding requirementRefs only from the referenced planned story; criterion IDs and visual-scope paths are not requirement references. Execute every criterion freshly, including earlier failed/blocked criteria; conservative fresh execution prevents reuse after code, criteria, fixtures or environment changes. Preserve findings, disputes and nonblocking observations across rounds unless new evidence resolves them. Screenshot reuse alone is never a behavioral pass. Read /answers for QA/capture assistance, including resolved access, test fixtures or tooling setup. Retry unavailable selected states using that guidance; if still blocked, return their concrete reasons in unavailable again so the visual gate waits for further assistance. An answer never waives required evidence. Reuse a previous verified screenshot path only if its area/state still exists, the previous visual gate approved it OR visual-review.acceptedScreenshots explicitly accepted its exact area/state/imageSha256, and code is unchanged or the area is explicitly unchanged with identical dependency hashes and no unexplained changed files. Preserve its metadata; include reused=true. Source provenance is verified by the runtime; compact manifest references are sufficient for this role. Directory dependencies exclude ignored build/cache output; required ignored runtime assets must be explicit file dependencies. Capture ONLY new/affected/uncertain areas/states with fresh filenames and assemble the COMPLETE screenshot inventory from reused plus fresh images. Missing dependencies, dirty revisions, unavailable evidence or evidence without an explicit prior acceptance requires fresh captures. Do not start the dev server for wholly reusable evidence; otherwise set it up once and delegate independent changed areas where possible.`,
	"visual-review": `For qa-v1 review the complete story coverage and fresh executed receipts, changed requirements and all unresolved findings/dispositions, retaining optional observations. Do not approve a failed criterion because a complaint was rejected. For a repeat with previously approved visual evidence, inspect only new/changed screenshots and new requirements, retain earlier verified results for identical reused images, and reassess every unresolved finding/dispute. Do not reopen unchanged accepted findings without new evidence. If the prior gate was not approved, preserve explicitly acceptedScreenshots with identical reused hashes and inspect only the unresolved/new evidence. Without per-image acceptance, inspect all relevant evidence again. Your result still covers the complete current inventory, never just the delta.`,
	guide: `${guideArtifactInstructions}\n${guideMapInstructions}\nAll new guides require purpose-written tldr, decision.summaryShort and per-chapter tldr, beforeShort, afterShort, risk:{level,text}, keyChecks:[{do,expect}] (1-3). Limits: overview 90, decision 160, chapter/risk 70, before/after 50, each check 60 characters. Never truncate full prose. Optional flow and required system references must be valid; preserve accepted screenshot metadata. Missing compact fields require guide-only correction, never incomplete publication. The review guide describes the COMPLETE cumulative PR, including inherited takeover work. On the first guide inspect /progress/reviewScope and the accepted requirements/plan, not just the latest role result. On repeats keep unchanged chapters and feature coverage, update affected evidence and add a separate short delta note if appropriate. Full feature scope is separate from /progress/diff. chapter.files MUST contain only files from /progress/reviewScope/files. Changes since prior human approval are separately available in /progress/approvalDelta; describe base integration and reapproval in chapter evidence/risks or revisionNote, never put base-only files in chapter.files. Empty files is allowed for an integration-context chapter. A revision summary requires an actual prior human-reviewed guide; previous agent iterations alone never qualify. Never lead the first guide with the last repair or drop unchanged features.`,
	"ci-fix": `If CI is blocked by owner/security adjudication, unavailable infrastructure or access that you cannot repair, return questions:["the specific assistance needed"] alongside your summary and checks. Do not repeat unchanged fixes or claim the check passed. Return questions:[] when corrective work is complete. Read /answers before retrying after assistance. Use the latest merge-readiness receipt, assess all newly unassessed PR comments/review requests exactly once and return addressedCommentIds and addressedReviewIds. On revision mismatch synchronize local and remote branch without discarding existing work, commit/push pending changes, and verify that the Git provider reports the same PR head. An up-to-date branch or successful Git-ref API update alone does not establish PR synchronization. If the Git provider remains out of sync after a bounded repair attempt, return specific assistance questions instead of repeating unchanged pushes or claiming completion. The pipeline redoes all reviews after changes. Never dismiss reviews, bypass rules, assume approval or resolve a review thread without addressing it or supplying evidence. Waiting for an external human approval is not a code fix.\n${feedbackPolicyInstructions}\n${guideGapFixInstructions}`,
};

/** Stable, versioned, code-backed text. Templates expand only declared IDs. */
export const instructionLibrary: Record<InstructionId, string | undefined> = {
	"inventory-qa": inventoryQaInstructions,
	"inventory-guide": inventoryGuideInstructions,
	"video-gate": videoPrompts["visual-review"],
	"delivery-clarify":
		' Include deliveryMode:"repository"|"external"|"mixed". Do not ask to authorize unrelated repository implementation for external tasks.',
	"delivery-plan": ` Include deliveryContract:{format:"delivery-v1",version:1,mode:"repository"|"external"|"mixed",authorization:{status:"authorized"|"deferred",reference:"actual instruction/answer reference"},executionReference:"digest supplied in deliveryExecutionReference",targets:[{key:"stable target ID",resource:{provider:"linear",instance:"https://linear.app",workspaceId:"configured workspace",project:"immutable project or team ID",id:"immutable UUID",url:"verified URL"} OR {provider:"taskbot",server:"configured server",instance:"exact HTTPS origin",project:"project slug",id:"numeric ID as string",url:"exact URL"},capabilities:["read","content","relationships"],baseline:{fields:{title:"observed title",description:"complete observed content"},relationships:[{type:"blocks"|"related",from:"immutable ID",to:"immutable ID"}]},operations:[{id:"stable operation ID",kind:"content",fields:{description:"full desired content"}} OR {id:"stable ID",kind:"add"|"remove",relationship:{type:"blocks"|"related",from:"ID",to:"ID"}}],criteria:[{id:"stable criterion",requirementRef:"accepted requirement reference",description:"observable acceptance criterion",fields:{description:"full expected content"},relationships:[],absentRelationships:[]}],preservedRelationships:[]}]}. Repository mode uses targets:[]; external/mixed need complete targets. Fetch complete before-state and verify coordinates through configured integrations. Do not mutate. Store no credentials. Include full expected fields and preserved relationships. On correction increment version and use new operation IDs for changed intents; retain already-applied history.`,
	"delivery-plan-review":
		" Confirm delivery mode, target identities, authorization, complete baseline, allowed operations and every criterion. Return deliveryContractDigest using the supplied deliveryCandidateDigest only when approving that exact contract. Incomplete or contradictory contracts cannot be approved.",
	"implementation-architecture-revision":
		" If subsequent answers or steering materially change the accepted architecture, preserve completed work and return status=blocked, architectureRevision=true, summary explaining the changed requirement, checks, and questions=[]. The runtime returns to architecture proposal/review and requires fresh acceptance when meaningful. Never implement a materially changed architecture using acceptance of an earlier version.",
	"impact-inventory":
		"\nFor impact-v1 runs declare requirement stage:code|qa|guide|acceptance|delivery from the accepted requirement source. Code is the default; later-stage obligations remain mandatory at their named gates. Do not reclassify implementation defects as future obligations.",
	"impact-scope":
		"\nFor impact-v1 runs, retain all story definitions and declare complete per-story dependencies plus environmentFingerprint and environmentEvidence:{repositoryId,command,expectedDigest} for fixture, dependency and environment identity. The runtime executes that read-only probe; expectedDigest is the SHA-256 of its trimmed UTF-8 stdout, without JSON quoting. Use a probe that observes actual fixtures and tool versions, not a constant label. Unknown or unavailable probes require fresh execution. If external environment identity is unknown, omit its fingerprint to force execution. Behavioral reuse requires the shared independent impact assessment and exact original passed criterion provenance.",
	"impact-capture":
		"\nFor impact-v1 runs read /qaReuse. Copy only runtime-validated reusable criteria exactly with their original evidence and reuse link. Execute every other criterion. Never invent a reuse link, reset an original execution date or mark failed/blocked criteria passed.",
	"visual-fix":
		" Include independently generated visual-gate findings as well as reviewer findings. Preserve stable dispositions. Rejected complaints require concrete evidence and reviewer reassessment; rejection cannot waive a failed required criterion. After corrections the pipeline returns through code review, CI, QA scope, execution, review and gate. Failed criteria must be retested before the human guide.",
	"implementation-scope": implementationScopeInstructions,
	"architecture-continuation": architectureContinuationInstructions,
	"architecture-questions-brief": architectureQuestionInstructions,
	"feedback-policy": feedbackPolicyInstructions,
	"ci-assessment": ciAssessmentInstructions,
	"review-fix": reviewFixInstructions,
	"ticket-plan": ticketPlanInstructions,
	delivery: deliveryInstructions,
	"video-scope": videoPrompts["visual-scope"],
	"video-capture": videoPrompts.capture,
	"video-review": videoPrompts["visual-review"],
	"video-brief": briefVideoInstructions,
	"impact-guide": impactGuideInstructions,
	"architecture-questions": architectureQuestionInstructions,
	"review-completion": reviewCompletionInstructions,
	"brief-runtime": briefRuntimeInstructions,
	"incremental-review-fix": incrementalRoleInstructions["code-fix"],
	"incremental-visual-scope": incrementalRoleInstructions["visual-scope"],
	"incremental-capture": incrementalRoleInstructions.capture,
	"incremental-visual-review": incrementalRoleInstructions["visual-review"],
	"incremental-guide": incrementalRoleInstructions.guide,
	"incremental-ci-fix": incrementalRoleInstructions["ci-fix"],
	"ci-fix-runtime": ciFixRuntimeInstructions,
	"review-stage-inventory": reviewStageInstructions("inventory-v1"),
	"review-stage-specialist": reviewStageInstructions("specialist-v1"),
	"review-stage-coverage": reviewStageInstructions("coverage-v1"),
};

export function instructionToken(id: InstructionId): string {
	return `{{instruction:${id}}}`;
}

/** Authoring helper: convert existing shared text to visible template slots. */
export function instructionTemplate(prompt: string): {
	prompt: string;
	instructions: InstructionId[];
} {
	const instructions: InstructionId[] = [];
	// Replace longest snippets first, preserving nested fragments inside them.
	for (const [id, text] of Object.entries(instructionLibrary).sort(
		(a, b) => b[1]!.length - a[1]!.length,
	)) {
		if (!text || !prompt.includes(text)) continue;
		prompt = prompt.split(text).join(instructionToken(id as InstructionId));
		instructions.push(id as InstructionId);
	}
	return { prompt, instructions };
}

export function renderInstructionTemplate(
	step: object,
	prompt: string,
): string {
	const declared = resolveStepConfig(step).instructions;
	const used = new Set<InstructionId>();
	const rendered = prompt.replace(
		/\{\{instruction:([a-z0-9-]+)\}\}/g,
		(_token, id: InstructionId) => {
			if (!declared.includes(id) || !instructionLibrary[id])
				throw new Error(`Unknown or undeclared shared instruction: ${id}`);
			used.add(id);
			return instructionLibrary[id]!;
		},
	);
	const appended: string[] = [];
	for (const id of declared) {
		if (used.has(id) || runtimeInstruction(id)) continue;
		const text = instructionLibrary[id];
		if (!text) throw new Error(`Unknown shared instruction: ${id}`);
		used.add(id);
		appended.push(text);
	}
	return [rendered, ...appended].join("\n");
}

function runtimeInstruction(id: InstructionId): boolean {
	return (
		id === "architecture-questions" ||
		id === "review-completion" ||
		id === "ci-fix-runtime" ||
		id === "brief-runtime" ||
		id.startsWith("incremental-") ||
		id.startsWith("review-stage-")
	);
}

export type InstructionSlot =
	| "architecture"
	| "role"
	| "completion"
	| "ci"
	| "review-stage";
export function instructionSlot(
	step: object,
	slot: InstructionSlot,
	calibrated = false,
): string {
	const ids = resolveStepConfig(step).instructions;
	const selected = ids.filter((id) =>
		slot === "architecture"
			? id === "architecture-questions"
			: slot === "completion"
				? id === "review-completion"
				: slot === "ci"
					? id === "ci-fix-runtime"
					: slot === "review-stage"
						? id.startsWith("review-stage-")
						: id === "brief-runtime" || id.startsWith("incremental-"),
	);
	const text = selected.map((id) => instructionLibrary[id] ?? "").join("\n");
	return slot === "review-stage" && text && calibrated
		? `${text}\n${calibratedReviewInstructions}`
		: text;
}
