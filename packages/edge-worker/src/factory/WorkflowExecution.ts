import { implementationScopeInstructions } from "./Architecture.js";
import type { WorkflowStep } from "./Workflow.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

type ExecutionStep = Pick<
	WorkflowStep,
	| "id"
	| "name"
	| "type"
	| "next"
	| "branches"
	| "workflow"
	| "tool"
	| "args"
	| "arguments"
	| "architectureContract"
	| "architectureBrief"
	| "architectureSource"
> & { groups?: ExecutionStep[][] };

/** Describe only the accepted graph. Current recipes and repository code are not run policy. */
export function workflowExecutionContext(context: ExecutionContext) {
	const { run, step } = context;
	const definitions = new Map(
		(run.workflowDefinitions ?? []).map((workflow) => [workflow.id, workflow]),
	);
	definitions.set(run.workflow.id, run.workflow);
	const visited = new Set<string>();
	const missing = new Set<string>();
	const workflows: { id: string; steps: ExecutionStep[] }[] = [];
	function describe(steps: WorkflowStep[]): ExecutionStep[] {
		return steps.map((item) => {
			if (item.type === "workflow" && item.workflow) visit(item.workflow);
			return {
				id: item.id,
				name: item.name,
				type: item.type,
				next: item.next,
				branches: structuredClone(item.branches),
				workflow: item.workflow,
				tool: item.tool,
				args: structuredClone(item.args),
				arguments: structuredClone(item.arguments),
				architectureContract: item.architectureContract,
				architectureBrief: item.architectureBrief,
				architectureSource: item.architectureSource,
				...(item.groups ? { groups: item.groups.map(describe) } : {}),
			};
		});
	}
	function visit(id: string) {
		if (visited.has(id)) return;
		visited.add(id);
		const workflow = definitions.get(id);
		if (!workflow?.steps) {
			missing.add(id);
			return;
		}
		const entry = { id, steps: [] as ExecutionStep[] };
		workflows.push(entry);
		entry.steps = describe(workflow.steps);
	}
	visit(run.workflow.id);
	return {
		contract: "workflow-execution-v1",
		rootWorkflowId: run.workflow.id,
		currentStep: {
			key: context.stepKey ?? run.step ?? step.id,
			id: step.id,
			type: step.type,
		},
		workflows,
		missingWorkflowIds: [...missing],
		answers: structuredClone(run.answers ?? []),
		architectureDecisions: structuredClone(run.architectureDecisions ?? []),
		humanDecisions: structuredClone(run.humanDecisions ?? []),
		decisionAttribution: {
			unnamedOperator: "Factory operator (name not recorded)",
		},
	};
}

export const decisionAttributionInstructions = `Attribute recorded decisions using /workflowExecution/answers, /workflowExecution/architectureDecisions and /workflowExecution/humanDecisions. These are original operator submissions; cite the exact record, action, timestamp and rationale. Use a person's name only when explicitly recorded in the sources. Otherwise acceptedBy may use /workflowExecution/decisionAttribution/unnamedOperator, preserving that the name was not recorded. A missing personal name alone is not missing scope, unavailable source access, an unresolved conflict or grounds for a question, blocked review or renewed acceptance. This attribution rule also applies when a saved prompt asks for the actual accepting person. Ask about identity only when an explicit task or mandatory repository rule requires a specifically identified approver and the missing identity materially affects authorization. Never infer a person's identity from the machine owner, Git author, assignee or API-key label. Preserve historical decisions verbatim; append later evidenced attribution without rewriting them. Interpret each record's content: an answer or discussion is not architecture acceptance, and a rejection is not approval. Scope waivers still need explicit human authorization, rationale, source and exact requirement IDs; a reviewer preference or automated approved=true is not a waiver. Missing acceptance or contradictory scope still requires the existing clarification or gate.`;

export const workflowExecutionInstructions = `Read /workflowExecution through factory-context before deciding which workflow prerequisites apply. It describes this run's accepted frozen graph, current role and recorded architecture/human decisions, including nested workflows and fanout. Current repository source, documentation, default recipes and the capability reference may describe newer or different workflows; they do not add gates to this run. An agent review returning approved=true is automated review, not explicit human acceptance. An architecture acceptance prerequisite applies when the accepted graph requires it or an explicit task, user instruction or mandatory repository rule requires it; do not invent one merely because another workflow has it. Missing workflow definitions mean unknown policy, not permission to bypass a gate. Preserve genuine task restrictions, mandatory repository conventions, required checks and final human/provider delivery safeguards. Planners must ground approval prerequisites in the accepted graph or explicit requirements; plan reviewers must reject unsupported prerequisites rather than approve an impossible handoff. If a supplied plan conflicts with this context, establish the source of the prerequisite; do not claim an approval record was lost without evidence. A Bob-authored file list or unsupported file-by-file approval sentence does not itself create a user restriction. Necessary implementation and review corrections within the accepted requirements and architecture may include newly discovered paths and their necessary dependency wiring. Preserve explicit human/repository restrictions, accepted non-goals and delivery boundaries. Review findings are correction inputs, never authority to add unrelated requirements or waive those boundaries. When implementation or a correction genuinely needs a changed architecture or scope, use this accepted graph's configured proposal/review/decision route before implementing that change. A supported implementation or fixer role returns status:"blocked", architectureRevision:true, a concrete summary and questions:[] to hand back revision; retain its other required result fields and all unresolved findings. This is a request to redraft, never acceptance. Ask a question only for a specific unresolved human-dependent decision or missing access, or when the accepted graph has no applicable revision route. Never manufacture human acceptance, treat an automated review as human approval or waive a required gate.
${implementationScopeInstructions}
${decisionAttributionInstructions}`;
