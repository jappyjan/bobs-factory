import { factoryContextInstructions } from "bobs-factory-mcp-tools";
import { ciFixRuntimeInstructions } from "./CISupervision.js";
import { incrementalInstructions, roleInstructions } from "./Incremental.js";
import {
	instructionSlot,
	renderInstructionTemplate,
} from "./InstructionLibrary.js";
import { inheritStepConfig } from "./StepConfig.js";
import type { WorkflowStep } from "./Workflow.js";
import { workflowTriggerInstructions } from "./Workflow.js";
import { workflowExecutionInstructions } from "./WorkflowExecution.js";

/** Run-specific text surrounding the role prompt. */
export interface RolePromptParts {
	repositoryScope: string;
	gitProvider: string;
	customProviderInstructions: string;
	ticket: string;
	questions: string;
}

/**
 * Runtime additions to the accepted role prompt. Returns the same step object
 * when nothing applies, so callers keep the definition's identity.
 */
export function withRuntimeRolePrompt(
	step: WorkflowStep,
	steps: WorkflowStep[],
	options: { assessedCorrection: boolean; calibratedReview: boolean },
): WorkflowStep {
	let result = step;
	if (
		step.type === "agent" &&
		(options.assessedCorrection ||
			!!instructionSlot(step, "ci") ||
			steps.some(
				(item) =>
					item.tool === "ci" &&
					item.branches.some(
						(branch) => branch.next === step.id && branch.when.path === "fix",
					),
			))
	)
		result = {
			...result,
			prompt: `${result.prompt ?? ""}\n\n${ciFixRuntimeInstructions}`,
		};
	if (instructionSlot(step, "review-stage"))
		result = {
			...result,
			prompt: `${result.prompt}\n${instructionSlot(step, "review-stage", options.calibratedReview)}`,
		};
	inheritStepConfig(step, result);
	return result;
}

/** System instruction for one Factory agent role. */
export function factoryRoleInstruction(
	step: WorkflowStep,
	parts: RolePromptParts,
): string {
	return `You are executing one software-factory step: ${step.name}. Execute ONLY this role. Other pipeline steps handle planning, review, publishing and handoff. Do not execute a full-development/verify-and-ship workflow unless explicitly requested by this role. Do not merge or mark a PR ready.\n${renderInstructionTemplate(step, step.prompt ?? "")}\n${parts.repositoryScope}\nGit provider: ${parts.gitProvider}. Use the selected provider for review, discussion resolution and CI tooling; do not assume GitHub or use gh for another provider. Runtime publication and merge retain the accepted provider. ${parts.customProviderInstructions}\nOriginating ticket: ${parts.ticket}. The runtime tracking service owns ticket status, PR links and publication: native Linear operational communication goes to its transcript; durable developer documentation and delivery summaries remain issue comments; Taskbot keeps milestone comments. Supply meaningful summaries and blockers; do not duplicate these mutations or mark coding tickets Done before confirmed merge. Retain ticket synchronization gaps as limitations.\n${parts.questions}\n${instructionSlot(step, "architecture")}\n${workflowTriggerInstructions}\n${workflowExecutionInstructions}\n${incrementalInstructions}\n${roleInstructions(step)}\n${instructionSlot(step, "completion")}\n${step.json === false ? "" : "Your final response MUST be a single JSON object matching the requested shape, with no prose outside it."}`;
}

/** First user turn sent to the native runner for one Factory agent role. */
export function factoryNativePrompt(
	step: WorkflowStep,
	options: {
		outputCorrection: boolean;
		captureCorrection: boolean;
		resumed: boolean;
		evidenceDir: string;
	},
): string {
	return `${options.outputCorrection && !options.captureCorrection ? "Your previous output failed validation. Read /outputCorrection from the NEW factory-context connection: it contains the rejected candidate, precise issues, and revision. Correct those issues and return the COMPLETE result for this role. Preserve accepted evidence and completed work; correct only this role output and, for capture, invalid states. Do not replay other pipeline roles. This is an output correction, not a process restart.\n\n" : options.captureCorrection ? "Your completed capture failed screenshot-reuse validation. Read /captureCorrection through the new factory-context tools: rejectedOutput contains your complete saved inventory, and screenshots lists every rejected state. Replace those images with fresh filenames; preserve the other valid captures and return the COMPLETE corrected inventory. Do not repeat completed setup or unrelated captures. The old factory-context connection is gone.\n\n" : options.resumed ? "Continue this role from your existing conversation and worktree. Read the latest answers through the new factory-context connection and inspect current files and past tool results before repeating actions. The old factory-context connection is gone; use the new factory-context tools below.\n\n" : ""}${factoryContextInstructions}\n${instructionSlot(step, "architecture")}\n\nEvidence directory: ${options.evidenceDir}`;
}
