import { improvementFilter } from "./ResearchPrompts.js";
import { type InstructionId, resolveStepConfig } from "./StepConfig.js";
export const implementationScopeInstructions = `Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy.`;
const ticketPlanInstructions =
	" Include the verified originating ticket reference, tracker instance/workspace/project and URL, runtime tracking ownership, coding Done-after-confirmed-merge rule, and any synchronization gaps in the self-contained plan. Roles supply summaries and blockers; the tracking service owns lifecycle comments, status and PR links.";

export const instructionLibrary: Record<InstructionId, string> = {
	"architectural-survey": improvementFilter,
	"implementation-scope": implementationScopeInstructions,
	"ticket-plan": ticketPlanInstructions,
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
		if (used.has(id)) continue;
		const text = instructionLibrary[id];
		if (!text) throw new Error(`Unknown shared instruction: ${id}`);
		used.add(id);
		appended.push(text);
	}
	return [rendered, ...appended].join("\n");
}
