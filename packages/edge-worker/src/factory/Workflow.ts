import { passiveTools } from "./CapacityPolicy.js";
import { validateReviewConfiguration } from "./SpecialistReview.js";

export { isComputeIntensive, passiveTools } from "./CapacityPolicy.js";

import type { WorkflowTrigger } from "bobs-factory-core";
import { z } from "zod";
import { agentSettings, resolveAgentSettings } from "./AgentSettings.js";
import { BRIEF_CONTRACTS, type BriefContract } from "./GuideAuthoring.js";
import {
	ImprovementSettingsSchema,
	improvementPerspectives,
} from "./Improvement.js";
import { LaunchFieldSchema } from "./LaunchFields.js";

const id = z
	.string()
	.regex(/^[a-zA-Z0-9_-]+$/)
	.max(80);
const condition = z.object({ path: z.string().min(1), equals: z.unknown() });
const reviewSources = z.object({ inventory: id, fanout: id.optional() });
const impactSources = z.object({
	inventory: id,
	fanout: id,
	maxUnchangedCycles: z.number().int().min(2).max(20).default(3),
});
const base = {
	id,
	delivery: z.literal("exclusive").optional(),
	resources: z.array(z.string().min(1)).min(1).optional(),
	name: z.string().min(1),
	next: id.optional(),
	branches: z.array(z.object({ when: condition, next: id })).default([]),
	qaContract: z.literal("qa-v1").optional(),
	videoContract: z.literal("video-v1").optional(),
	review: reviewSources.optional(),
	impactSource: id.optional(),
	maxVisits: z.number().int().min(1).max(100).default(8),
};
export const AgentStepSchema = z.object({
	...base,
	type: z.literal("agent"),
	impactContract: z.literal("impact-v1").optional(),
	impact: impactSources.optional(),
	architectureSource: id.optional(),
	architectureContract: z
		.enum(["architecture-v1", "architecture-review-v1"])
		.optional(),
	/** New stock proposals require the reviewer-facing brief; frozen graphs retain their contract. */
	architectureBrief: z.literal("review-v1").optional(),
	reviewContract: z
		.enum(["inventory-v1", "specialist-v1", "coverage-v1"])
		.optional(),
	/** Guide steps opt into the review brief (v2 adds show & tell, v3 Dig deeper); absent keeps the chapter guide. */
	guideContract: z.enum(BRIEF_CONTRACTS).optional(),
	computeIntensive: z.never().optional(),
	prompt: z.string().min(1),
	inputs: z.array(z.string()).optional(),
	...agentSettings,
	json: z.boolean().default(true),
	askQuestions: z.boolean().default(false),
	chat: z.boolean().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;
export interface WorkflowStep {
	id: string;
	delivery?: "exclusive";
	resources?: string[];
	name: string;
	type: "agent" | "script" | "tool" | "fanout" | "workflow";
	next?: string;
	branches: { when: { path: string; equals?: unknown }; next: string }[];
	maxVisits: number;
	qaContract?: "qa-v1";
	videoContract?: "video-v1";
	review?: { inventory: string; fanout?: string };
	impactSource?: string;
	impactContract?: "impact-v1";
	impact?: { inventory: string; fanout: string; maxUnchangedCycles: number };
	architectureSource?: string;
	architectureContract?: "architecture-v1" | "architecture-review-v1";
	architectureBrief?: "review-v1";
	reviewContract?: "inventory-v1" | "specialist-v1" | "coverage-v1";
	guideContract?: BriefContract;
	prompt?: string;
	inputs?: string[];
	runner?: AgentStep["runner"];
	model?: string;
	reasoningEffort?: AgentStep["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentStep["serviceTier"];
	json?: boolean;
	askQuestions?: boolean;
	chat?: boolean;
	computeIntensive?: boolean;
	script?: string;
	tool?: string;
	args?: string[];
	arguments?: Record<string, unknown>;
	groups?: WorkflowStep[][];
	workflow?: string;
}
export const StepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
	z.discriminatedUnion("type", [
		AgentStepSchema,
		z.object({
			...base,
			type: z.literal("workflow"),
			delivery: z.never().optional(),
			resources: z.never().optional(),
			workflow: id,
			computeIntensive: z.never().optional(),
		}),
		z.object({
			...base,
			type: z.literal("script"),
			script: z.string().min(1),
			computeIntensive: z.boolean().optional(),
		}),
		z.object({
			...base,
			type: z.literal("tool"),
			tool: z.string().min(1),
			computeIntensive: z.boolean().optional(),
			args: z.array(z.string()).default([]),
			arguments: z.record(z.string(), z.unknown()).optional(),
		}),
		z.object({
			...base,
			type: z.literal("fanout"),
			delivery: z.never().optional(),
			resources: z.never().optional(),
			computeIntensive: z.never().optional(),
			groups: z.array(z.array(StepSchema).min(1)).min(1).max(8),
		}),
	]),
);
export const WorkflowSchema = z
	.object({
		id,
		name: z.string().min(1),
		icon: z.string().max(32).optional(),
		description: z.string().default(""),
		labels: z.array(z.string().min(1)).default([]),
		steps: z.array(StepSchema).max(100),
		internal: z.boolean().optional(),
		chat: z.boolean().optional(),
		allowedTriggers: z
			.array(z.enum(["workflow", "manual", "ticket-assignment"]))
			.refine(
				(values) => new Set(values).size === values.length,
				"Duplicate allowed triggers",
			)
			.optional(),
		launchFields: z.array(LaunchFieldSchema).max(20).optional(),
		improvement: ImprovementSettingsSchema.optional(),
	})
	.transform((workflow) => ({
		...workflow,
		allowedTriggers: workflow.allowedTriggers ?? legacyTriggers(workflow),
	}));
export type Workflow = z.infer<typeof WorkflowSchema>;

function legacyTriggers(workflow: {
	id: string;
	internal?: boolean;
	improvement?: unknown;
}): WorkflowTrigger[] {
	if (workflow.improvement) return ["manual"];
	return workflow.id === "simple"
		? ["manual", "ticket-assignment"]
		: workflow.internal
			? ["workflow"]
			: ["workflow", "manual", "ticket-assignment"];
}

export function supportsTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): boolean {
	return (
		(workflow.allowedTriggers ?? legacyTriggers(workflow)).includes(trigger) &&
		!(workflow.id === "simple" && trigger === "workflow") &&
		!(workflow.improvement && trigger !== "manual")
	);
}

export function requireTrigger(
	workflow: Workflow,
	trigger: WorkflowTrigger,
): void {
	if (!supportsTrigger(workflow, trigger))
		throw new Error(
			`Workflow "${workflow.name}" (${workflow.id}) does not allow ${trigger} launches. Enable the appropriate permission in Recipes, change the selected workflow/label, or choose an eligible saved default.`,
		);
}

export function validateWorkflows(value: unknown): Workflow[] {
	const workflows = z.array(WorkflowSchema).min(1).max(50).parse(value);
	const ids = new Set<string>();
	for (const workflow of workflows) {
		if (ids.has(workflow.id))
			throw new Error(`Duplicate workflow: ${workflow.id}`);
		ids.add(workflow.id);
		if (
			workflow.id === "simple" &&
			workflow.allowedTriggers.includes("workflow")
		)
			throw new Error(
				"Simple / Bob’s Factory cannot be called by another workflow; Simple cannot be forked.",
			);
		if (workflow.improvement) {
			if (workflow.allowedTriggers.some((t) => t !== "manual"))
				throw new Error(
					"Improvement workflows currently support manual launches only",
				);
			for (const role of [
				"lead",
				...improvementPerspectives.map(([id]) => `coordinate-${id}`),
				"research-worker",
				"coordinate-results",
				"synthesize",
				"package",
				"check-architecture",
				"check-security",
				"check-dependencies",
			]) {
				if (
					!workflow.steps.some(
						(s) => s.id === role && s.type === "agent" && s.json !== false,
					)
				)
					throw new Error(
						`Improvement workflow requires structured agent role ${role}`,
					);
			}
		}
		const fields = workflow.launchFields ?? [];
		if (new Set(fields.map((field) => field.name)).size !== fields.length)
			throw new Error("Duplicate launch field names");
		for (const field of fields) {
			if (
				[
					"title",
					"repositoryId",
					"workflow",
					"runner",
					"model",
					"reasoningEffort",
					"modelVariant",
					"serviceTier",
					"inputs",
					"constructor",
					"prototype",
				].includes(field.name)
			)
				throw new Error(`Reserved launch field name: ${field.name}`);
			if (
				field.type === "select" &&
				new Set(field.options.map((option) => option.value)).size !==
					field.options.length
			)
				throw new Error("Duplicate launch choice values");
			if (
				field.defaultValue &&
				field.type === "select" &&
				!field.options.some((option) => option.value === field.defaultValue)
			)
				throw new Error("Invalid launch field default choice");
		}
		if (workflow.id === "simple" && workflow.steps.length)
			throw new Error(
				"simple uses Bob’s Factory’s existing execution path and cannot be forked",
			);
		if (workflow.id !== "simple" && !workflow.steps.length)
			throw new Error(`Workflow ${workflow.id} needs steps`);
		const check = (steps: WorkflowStep[]) => {
			const names = new Set(steps.map((step) => step.id));
			if (names.size !== steps.length) throw new Error("Duplicate step IDs");
			for (const step of steps) {
				if (step.computeIntensive && passiveTools.includes(step.tool ?? ""))
					throw new Error(
						`Passive wait ${step.tool} cannot consume execution capacity`,
					);
				if (step.type === "agent" && step.runner)
					resolveAgentSettings(step.runner, step);
				for (const target of [
					step.next,
					...step.branches.map((branch) => branch.next),
				]) {
					if (target && target !== "end" && !names.has(target))
						throw new Error(`Unknown step: ${target}`);
				}
				if (
					step.architectureBrief &&
					step.architectureContract !== "architecture-v1"
				)
					throw new Error(
						"Architecture briefs require an architecture proposal role",
					);
				if (
					step.architectureContract &&
					(step.type !== "agent" || step.json === false)
				)
					throw new Error(
						"Architecture contracts require a structured agent role",
					);
				if (
					step.architectureContract === "architecture-review-v1" &&
					!steps.some(
						(s) =>
							s.id === (step.architectureSource ?? "architecture") &&
							s.architectureContract === "architecture-v1",
					)
				)
					throw new Error(
						"Architecture review requires its configured proposal role",
					);
				if (step.tool === "architecture-decision") {
					const args = step.arguments ?? {};
					const source = String(args.proposal ?? "architecture");
					const review = steps.find(
						(s) => s.id === String(args.review ?? "plan-review"),
					);
					if (
						!steps.some(
							(s) =>
								s.id === source && s.architectureContract === "architecture-v1",
						) ||
						review?.architectureContract !== "architecture-review-v1" ||
						(review.architectureSource ?? "architecture") !== source
					)
						throw new Error(
							"Architecture decision requires a proposal and its candidate reviewer in the same graph",
						);
					if (
						!steps.some(
							(s) =>
								s.id === String(args.revise ?? "architecture") &&
								s.architectureContract === "architecture-v1",
						)
					)
						throw new Error(
							"Architecture decision requires a proposal revision route",
						);
					if (
						!["meaningful", "always", "never"].includes(
							String(args.approval ?? "meaningful"),
						)
					)
						throw new Error("Unknown architecture approval policy");
				}
				if (step.id === "end") throw new Error("end is reserved");
				for (const group of step.groups ?? []) check(group);
			}
		};
		check(workflow.steps);
		validateReviewConfiguration(workflow.steps);
	}
	if (!ids.has("simple") || !ids.has("factory") || !ids.has("takeover"))
		throw new Error("Keep the simple, factory and takeover defaults");
	const byId = new Map(workflows.map((workflow) => [workflow.id, workflow]));
	const checkCalls = (
		steps: WorkflowStep[],
		ancestors: string[],
		parallel = false,
	): void => {
		for (const step of steps) {
			if (
				parallel &&
				(step.askQuestions ||
					["human-review", "architecture-decision"].includes(step.tool ?? ""))
			)
				throw new Error("Human checkpoints belong outside fanout branches");
			if (step.type === "workflow") {
				const target = byId.get(step.workflow!);
				if (!target || target.id === "simple")
					throw new Error(`Unknown or uncallable workflow: ${step.workflow}`);
				requireTrigger(target, "workflow");
				if (ancestors.includes(target.id))
					throw new Error(
						`Recursive workflow call: ${[...ancestors, target.id].join(" → ")}`,
					);
				if (ancestors.length >= 10)
					throw new Error("Workflow nesting exceeds 10 levels");
				checkCalls(target.steps, [...ancestors, target.id], parallel);
			}
			for (const group of step.groups ?? []) checkCalls(group, ancestors, true);
		}
	};
	for (const workflow of workflows) checkCalls(workflow.steps, [workflow.id]);
	return workflows;
}

export function readPath(value: unknown, path: string): unknown {
	return path
		.split(".")
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === "object" && Object.hasOwn(current, key)
					? (current as Record<string, unknown>)[key]
					: undefined,
			value,
		);
}

export const workflowTriggerInstructions =
	"Current workflow launch behavior (capability reference): Stock Improve codebase is manual-only, accepts optional focus without a task prompt, and coordinates eight architectural research perspectives with bounded cheaper research workers. Configure its Cheaper research worker model in Recipes before first launch. Research uses pinned tracked repository blobs and dated, repository-matched Bob run histories when applicable. Each proposal item supports Fix, File issue, Ignore or Ask follow-up. Prepare selected actions then explicitly Apply choices to authorize the exact manifest. File issue creates backlog-only unassigned Linear or Taskbot work, never a Factory run. Only Fix creates independent normal Factory runs with isolated worktrees, retained execution profiles and ordinary delivery gates. Ready independent runs execute concurrently; dependants await exact approved, provider-confirmed prerequisite delivery. Durable action identities reconcile retries and restart. Parent stop pauses dispatch; Stop batch and active runs stops children too. General independent child-workflow steps remain planned. The manual launcher selects its project in the heading and shows declared workflow inputs and attachment chips inside a chat-style prompt composer whose bottom controls choose the recipe, agent, reasoning and run settings. New stock Factory, Takeover and Simple definitions declare an optional files attachment field. Custom workflows accept uploads only when they declare files fields. Uploads accept any file type with limits of 10 files, 25 MiB each and 100 MiB total; the guarded binary API stages private immutable assets outside worktrees, claims them once for a run and exposes launchAttachments manifests with canonical readable paths through role/tool/script context and Simple instructions. Drafts expire after 24 hours; claimed files remain available across retries and restarts while persisted runs reference them. Relevant plan assets enter architecture approval snapshots. Existing saved/frozen workflow definitions remain unchanged. Machine selection is deferred to BOBS-84. All production entry points use one runtime. Settings → Ticket managers configures Linear OAuth, signed webhook intake and project workspace routing, plus Taskbot MCP connections. Each manager can be enabled or disabled live. Disabled managers pause ticket intake and runtime tracking while preserving existing work, credentials and pending publication; provider retries govern missed incoming events. Standalone work remains available. Existing project Taskbot MCP transports and tool permissions remain binding. Factory roles receive runtime-owned /workflowExecution context describing the accepted frozen graph and recorded decisions. Current recipes and repository code do not add gates to saved runs; automated plan-review approval remains distinct from human acceptance, and actual required gates and task restrictions remain binding. QA criterion provenance is saved during capture finalization before review hashes are generated; gates validate it without rewriting original evidence. Chapter reading progress binds every repository revision and validates saved scope before restoration; secondary repository changes reset uncertain progress even when the primary revision and guide are unchanged. Normal browser navigation cancels protected requests and ignores their late failures so reviewed chapter progress survives reload; genuine connection or access loss still clears private state. Grouped delivery feedback fingerprints every repository receipt, and comment assessments bind repository identity to provider comment IDs. New stock Factory and Takeover runs review a versioned architecture proposal after drafting the plan. Meaningful choices require explicit acceptance of the exact proposal, candidate plan and snapshotted assets before implementation. Routine work records a bypass reason. Discussion and explanation never authorize implementation; feedback regenerates a freshly reviewed version. Recipes edits execution preferences for the bundled proposal role; fork Factory or Takeover to change proposal prompts or approval policy for new launches. Frozen active runs and customized legacy planning paths remain unchanged. Independent child delivery remains separate planned work. Background ticket synchronization retains external completion proof during rereads, invalidates it on drift or failed reads and never closes a ticket without fresh state checks. Completed external or mixed runs whose ticket synchronization loses state proof offer authenticated Reverify ticket changes. This audited action retains applied work and merges, retires stale completion receipts, resumes only independent verification and requires renewed explicit acceptance; tracking-only retry never executes it automatically. New stock Factory delivery-v1 contracts classify repository, external or mixed delivery during clarification and plan review, separately from execution authorization. External ticket content/relationship work uses configured Linear/Taskbot integrations, persisted before-state/intents, safe retry reconciliation, independent complete-state verification, snapshot-bound human acceptance and a final state check. External work bypasses publication, code-diff fanout, CI and merge; repository safeguards remain. Mixed work requires external proof and every confirmed repository merge. Lifecycle status/comments and PR links remain runtime-owned and excluded from external fingerprints. Done synchronization rechecks external evidence; tracking-only retries do not replay task work. Saved definitions remain frozen; authenticated reviewed recovery of an idle failed draft-pr run verifies already-applied external work before a new human gate and preserves original history/checkpoint/conversations. Every workflow accepts the same retained repository scope. Repositories with identical nonempty routing-label sets appear as one project in the manual composer; shared labels route issues to all matching repositories. Manual launches may pass repositoryIds alongside the primary repositoryId. A grouped workspace contains one worktree per repo. Factory and Takeover publish and review one PR/MR per changed repository, preserve per-repo delivery receipts through retries, bind human approval to every exact URL/head, and complete only after all delivered revisions are confirmed merged. Unchanged repos remain context. Custom scripts/exec run once in the shared workspace with FACTORY_REPOSITORIES and tool input repositories exposing the scope. Factory publication, takeover, CI readiness, handoff and SHA-guarded merge use the repository Git provider. GitHub and GitLab (including explicit self-managed hosts) are built in; other hosts use repositories[].gitProvider custom executable adapters. Public hosts and existing githubUrl/gitlabUrl fields auto-detect. Unknown hosts require explicit provider selection. Runs retain accepted provider coordinates/adapter on retry and recovery. GitHub delivery uses the built-in REST/GraphQL client; the GitHub CLI is optional. Local first launch opens guided project/installed-agent selection without enrollment or login. Direct HTTP loopback dashboard and API access requires an actual loopback socket peer, exact loopback authority and same-origin browser context; forwarding headers never grant access. Remote HTTPS origins retain separate origin-bound browser sessions established with API keys. Connect GitHub in protected Project setup to save a private token for API delivery and managed Git authentication; explicit execution profiles retain their accepted repository-scoped credential bindings. For token-free API requests from agent commands, save a JSON request containing method, path and optional body, then run bobs-factory github-api --repo <selected GitHub repository URL> --request <request file>. Native Git/SSH/forge credential stores remain host-owned. Human approval and provider-confirmed merge still gate completion. Handoff routes unresolved guide requirements and delivery gaps through the configured fixer, rebuilds the guide and rechecks readiness. Repeated unresolved gaps at an unchanged revision wait for specific assistance; an answer does not waive scope or approve delivery. Runtime coordinates finalization of overlapping repository/base scopes after publication while implementation remains parallel; assistance and human waits release admission. Runtime supervises queued CI and bounded retries of concretely identified infrastructure failures without holding an agent; unknown failures still require diagnosis. Review results explicitly declare completed, blocked or failed: an empty findings list alone cannot approve. Scoped context tools expose applied limits and pagination; large role outputs can submit validated revision-bound artifacts. Run provenance identifies actual runtime/workflow/contract/instruction receipts and preserves unknown historical identity. Newly authored technical/mixed review guides require whole-PR scope classification, 3–6 system-map lanes and chapter part links; only evidenced purely visual scope is exempt. Saved older guides remain readable. New stock review guides use brief-v3: a colleague-style show & tell story (checklist, before/after, measured chart, screenshot, video and point slides, then the brief's decisions, limits and side effects), followed by Dig deeper tabs: plain-language flows linked to code lines, a code tour of the whole diff in reading order with notes pinned to lines, tests under the files they test and reformatting collapsed, plain checks with the recorded values on demand, and the choices made. Regenerating a pending stock guide adopts the current brief-v3 prompt while keeping its agent settings; custom guide prompts stay unchanged; brief-v1 and brief-v2 guides stay readable. New stock Factory/Takeover runs support video-v1: select up to three authentic headless demonstrations when useful, validate media and revision provenance including linked QA story definitions, inspect playback, then embed accepted clips lazily with transcripts in guides and inspector. Optional recording failures remain limitations; explicit required recordings stay blocked. Legacy/frozen runs and custom recipes opt in only explicitly. Videos supplement screenshots and fresh QA; human approval remains required. Media is loopback-only and bounded (120 seconds/50 MiB per clip; 512 MiB per run), with startup cleanup of current and historical capture assets for terminal runs after 30 days and abandoned temporary files after 24 hours. Browser installation and help controls are hidden in the native desktop app using its existing window.factoryDesktop bridge. The review reader keeps item commenting throughout and collects feedback, additional feedback and page-level PR/diff actions on Decide, reached through the sticky feedback count. Direct HTTP localhost dashboard access requires a validated loopback socket peer, loopback Host and same-origin browser context, without key setup or login. Remote HTTPS addresses require origin-bound browser sessions established with API keys. Empty remote stores require first-key creation in localhost Settings. Local users and signed-in remote users can add, remove and rotate keys; secrets are shown once. Rotation/removal revokes issuing sessions, including the current session. Keys do not authenticate direct Bearer API requests. Legacy passkey state migrates to an empty key store and revokes old sessions. Provider webhooks and OAuth use their separate listener. Explicitly stopped runs with saved progress offer individual Resume; bringing them back only restores visibility, and disabled workflows must be re-enabled before any continuation. New stock Factory and Takeover runs extract a versioned requirement inventory before six independently configurable specialist reviewers run through fanout. Coverage-required fanout needs exactly one coverage-v1 supplier; replace it explicitly before removing it. Reviewers share a runtime-frozen clean revision and context baseline; incomplete or stale results cannot approve. Called workflows retain their review association in parent guides, QA, subsequent fanout branches and approval steps across restart; QA uses configured aggregate provenance even when gates are renamed. Settled findings require fresh evidence to reopen across intervening omissions. Recipes edits affect new launches; accepted runs and customized legacy reviewers keep their frozen contracts. New stock Factory/Takeover repository runs use impact-v1: one configurable independent assessment selects affected configured specialists, discovered checks and QA criteria, records explicit original-evidence reuse and tracks downstream obligations at their own gates. Initial acceptance retains complete configured coverage. Source, scope, dependency, fixture, environment, findings or target drift invalidates reuse. Review receipts keep original execution stamps. Relevant target overlap or unavailable combined-tree evidence requires integration or investigation; unrelated target advancement can preserve proven independent evidence. Optional findings and optional disagreements stay nonblocking; consequential findings need evidence, a requirement or mandatory rule, consequence and remedy. Configured unchanged-cycle limits default to three and enter assistance without approving or merging. Frozen/custom workflows retain conservative behavior unless explicitly opted in. Executable QA and screenshots remain required. A prior explicit approval can continue for independently assessed safe minor cumulative corrections, including production code, only after all required checks and evidence pass. Meaningful or uncertain changes, rejection, failed checks and consequential disputes require renewed approval. Continuation retains the original human decision and separately binds the current exact repository delivery revisions; fresh provider readiness and SHA-guarded confirmed merge remain required. Refinement questions support questionChoices with single or multiple selection, optional preselected option IDs and a separate custom-text alternative in both web and terminal interfaces. Defaults never submit answers; blank custom answers cannot fall back to defaults. Changed choice contracts invalidate stale batches. Legacy refinement questions can include generated questionRecommendations with zero-based questionIndex, answer and evidence-based reason. The dashboard selects suggestions by default and provides a separate blank Custom answer field. Recommendations require explicit Send answers submission or a ticket reply; they never automatically authorize work. Legacy questions without metadata use blank text fields. Changed questions or recommendations notify the originating ticket once per batch; unchanged restored waits retain notification deduplication. Factory manual launches accept an originating Linear or Taskbot ticket URL as the prompt or explicit ticket source. The runtime fetches complete ticket context, retains verified tracker identity through roles and follow-ups, and owns publication and PR links. Native Linear routine progress, tool failures and role outcomes use transcript thoughts. Necessary lifecycle and input activities retain native types and automatic threaded comments under the accepted publication exception. Confirmed delivery documentation uses one native completion response; durable decisions remain explicit issue comments. Factory role results are presented only after parsing, artifact resolution and validation; raw messages and rejected outputs remain local. Decision comments contain accepted answers and rationale without serialized clarification history. Successful tool chatter and unchanged check states are suppressed; actionable failures remain readable. Legacy queued content is presented before sending and uncertain writes reconcile original content first. Status and PR links do not depend on comment publication. Taskbot retains milestone comments. Missing manual Linear transcript configuration leaves delivery visibly pending. Coding tickets stay nonterminal during work, In Review awaiting human/provider action, and Done only after provider-confirmed merge. Ticket synchronization failures remain visible in run activity and ticketSync receipts; retry only tracking through POST /api/runs/:id/ticket-sync after restoring access or reassessing conflicts. Simple retains its native tracking lifecycle. Factory supports opt-in Web Push through Settings → Notifications for new questions, review revisions, human-only blockers, failures needing help and successful completions. Enable and test each browser device explicitly; remote disable never auto-enables. Rephrasing a pending decision does not create a new question notification. VAPID subscriptions and consumed transition receipts survive restart. Only fresh transitions are attempted, with TTL zero and no replay after enablement, outage or recovery; provider acceptance does not prove display. Notification text is minimal; clicks refresh protected run/review state before actions. Configure the push contact in Settings → Notifications; saved contact updates apply immediately without changing keys or device consent. BOBS_FACTORY_FACTORY_PUSH_SUBJECT remains an optional first-start bootstrap; saved push state takes precedence. For the trusted HTTPS proxy, configure the exact BOBS_FACTORY_FACTORY_ORIGIN; physical-device background delivery remains unverified. Workflow selection is separate from repository routing. Execution identity and tool profiles are independent choices in Settings and the manual composer/API. Settings has separate pages for local access and remote API keys, execution defaults, identity profiles, tool profiles, Notifications, instance capacity and run titles; Recipes manages workflows and launch permissions. Unsent browser choices and Settings edits belong to the current form and clear on navigation, relevant configuration changes, reloads and updates; explicitly saved settings and accepted run snapshots persist. Each choice resolves manual override, repository default, factory default, then Legacy. Explicit profiles require declared tool sources and authentication bindings for every workflow provider and the title agent; Claude/Codex native-login Share binds an existing configuration root and account email with Share tools. Other combinations require API credentials. Capability checks inspect the actual runner executable; binary installations use prepared Claude/Codex launchers and the configured Cursor SDK/Node paths, including in private environments. Unsupported tool versions, native settings including Codex notification commands, or missing bindings reject before setup. Existing runs, nested roles, Simple, title jobs, follow-ups and recovery retain accepted snapshots. Use credential references only, never literal secrets. Native subscription login remains available in Legacy and eligible explicit Claude/Codex Share profiles; isolated native cache migration is unsupported. Stock workflow labels are workflow:factory (or factory), workflow:takeover (or takeover), and workflow:simple; operators can customize labels in Recipes. New launches select an explicit manual UI/API workflow choice, then [workflow=<id>] in the original triggering comment, then the issue description, then the first matching workflow in configured label order, then the single saved default. Escaped brackets are supported. Quoted text and code examples are ignored; repeated identical selectors are valid, but malformed or conflicting selectors in the winning source reject without fallback. Higher-priority sources override lower-source conflicts. New mention-created sessions on an active issue reject temporarily pending #36; reply to the existing session for steering or answers. Explicitly settled finished runs release ticket ownership, including historical stopped sessions; resumed execution and background work still retain ownership. The selected workflow must allow ticket-assignment for assignments or @mentions, manual for new UI/API or follow-up launches, and workflow for nested calls. A disallowed selection is rejected without fallback; enable its permission in Recipes, change the selection/label, or choose an eligible default. Existing runs retain their accepted definitions; replies and resume do not select a new workflow. Use these supported launch methods when starting work. When the task requests changes to this product, evaluate the proposed behavior against the task's requirements and accepted decisions, within your assigned role. Missing current capabilities are implementation work, not a conflict with these instructions; update the capability reference alongside an implemented behavior change. Explicit task restrictions such as planning-only or deferred implementation still apply.";

export const capacityInstructions =
	"Instance capacity bounds scheduled agent executions and intensive workflow steps. Each Factory home has its own pool, with four slots by default. Eligible workflow jobs from older runs receive priority within workflow admission positions; interactive jobs keep their positions and background titles retain occasional turns. Newer jobs fill spare slots, running work is never interrupted, and recovery preserves run age and exchanged admission positions. Tool calls and commands within an admitted agent share its slot; temporary F1 instances with separate homes have independent pools. Do not launch harness subagents or independent background heavy work inside a managed agent turn. Schedule heavy children as nested workflow steps or fanout branches so each receives capacity. Ask questions in your final response and finish the turn; native AskUserQuestion is disabled because its callback cannot safely suspend all parallel execution. Parent orchestration, human waits, and passive CI waits consume no slots.";
