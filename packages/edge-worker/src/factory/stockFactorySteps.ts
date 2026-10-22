import { nativeViewPreset } from "./ViewPresets.js";
import type { Workflow, WorkflowStep } from "./Workflow.js";

/** Configured stock roles. Composed recipes supply their own connections and ports. */
export const stockFactorySteps: Record<string, WorkflowStep> = {
	clarify: {
		id: "clarify",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "clarify-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: ["delivery", "delivery-clarify"],
		name: "Clarify requirements",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Read the input, all comments, metadata, assets and previous answers. Determine whether you fully understand the requirements. Ask only questions that materially affect implementation. If the input says backlog only, planning only, or do not implement yet, and no later user instruction explicitly authorizes implementation, ask whether to proceed with implementation now or retain that restriction before returning empty questions. Do not infer authorization from answers about feature scope. Do not assume answers or implement anything. Return {"questions":["..."],"questionRecommendations":[{"questionIndex":0,"answer":"recommended answer","reason":"evidence-based explanation"}],"decisions":[{"question":"...","answer":"...","reason":"..."}],"requirements":["..."]}. For selectable alternatives, use questionChoices with questionIndex, selection (single or multiple), options (unique id, answer, optional reason) and optional preselectedOptionIds. Do not use questionRecommendations for the same question. Custom text is always available and defaults require explicit submission. Empty questions means everything is understood. Preserve all answered decisions across rounds.{{instruction:delivery}}{{instruction:delivery-clarify}}',
		json: true,
		askQuestions: true,
		view: nativeViewPreset("ask"),
	},
	decisions: {
		id: "decisions",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			clarify: "clarify",
			plan: "plan",
			implementation: "implement",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Record decisions",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "record-decisions",
		args: [],
	},
	plan: {
		id: "plan",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "plan-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "ticket-milestone",
				kind: "plan",
			},
			"delivery-contract",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [
			"delivery-plan",
			"implementation-scope",
			"delivery",
			"ticket-plan",
		],
		name: "Write implementation plan",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Write a lean, complete implementation plan from the original input, ALL comments/metadata, clarified requirements/decision records, and any plan-review feedback. When taking over, include the existing-work and assess-existing results and PR review discussion; preserve completed work and plan only the remaining changes. Include the existing PR URL/branch and require continuing it. Return {"plan":"detailed self-contained Markdown implementation plan with acceptance criteria and validation","assets":[{"path":"absolute downloaded asset path or URL","purpose":"..."}]}. Include everything the implementer needs: it will receive ONLY this result, never the ticket. Include repository scope, base branch and delivery expectations. {{instruction:implementation-scope}} Do not implement.{{instruction:ticket-plan}}{{instruction:delivery}}{{instruction:delivery-plan}}',
		json: true,
		askQuestions: false,
	},
	"plan-review": {
		id: "plan-review",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "plan-review-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: ["implementation-scope", "delivery", "delivery-plan-review"],
		name: "Review implementation plan",
		next: "delivery-route-accept",
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
			'Review the plan against ALL input/comments/metadata and decisions. {{instruction:implementation-scope}} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["specific missing requirements or improvements"]}. Approve a practical MVP plan when complete.{{instruction:delivery}}{{instruction:delivery-plan-review}}',
		json: true,
		askQuestions: false,
	},
	architecture: {
		id: "architecture",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "architecture-checkin-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			"architecture-proposal",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: ["implementation-scope", "architecture-continuation"],
		name: "Prepare the check-in",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Before Bob builds anything, he checks his plan with the human, the way a good colleague walks over and says "got two minutes before I start?". Your output is that check-in, plus the complete plan and evidence the automated reviewer verifies.\n\nInspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover\'s completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance.\n\n{{instruction:implementation-scope}}\n\n{{instruction:architecture-continuation}}\n\nWHY THE HUMAN IS ASKED\nAn independent reviewer already checks that every requirement is traced, files are real and the plan is consistent. The human is asked only for what a human can catch while it is still cheap to change course: you misunderstood what they want; a call you made does not fit their product, customers or team; the consequences for people are unacceptable; or the work is the wrong size. Write the check-in for exactly that.\n\nTHE CHECK-IN (talk) - spoken, first person, everyday words, about two minutes to read in total (at most 350 words across all talk fields). No file paths, class names, endpoints or jargon a product owner would not use; say what people experience. Concrete numbers where they matter ("every 30 seconds", "up to 128 waiting devices").\n- understood (max 360): "You want ... so that ...", then what done looks like to them. This is the first thing the human confirms, so restate their goal in their terms, not your solution.\n- plan (max 480): "I\'d ..." in two to four sentences: the approach, not the task list.\n- scenes: 1-3 whiteboard sketches of what a person or device experiences, before and after, as short steps (max 90 characters each; before 1-5 steps, after 1-6). Pick the moments the change is really about, e.g. title "A new reader joins": before ["Reader connects", "It is registered automatically"], after ["Reader shows a code that changes every 30 seconds", "An administrator types or scans the code", "Only then is the reader registered"].\n- notice: up to 5 groups of people, devices, integrations or operators that will notice once this ships, and how (who max 40, what max 200). Include upgrades, configuration they must set and anything that stops working. [] only when nobody outside the code notices.\n- checks: up to 3 calls you made that need human judgment (product, customers, cost, habits), the least certain first. say (max 260): "I went with ... because ..."; instead (max 220): the other way and what it would mean for people. Link decision when the call is one of decisions. Do not list calls the repository or the human\'s answers already settle; those stay in decisions. Open decisions are questions, never checks.\n- size (max 240): how big this is in human terms: how many separate things change, which parts of the product, rough effort. split (max 240, optional): a sensible way to split it into smaller deliveries if one exists, and what each would deliver first.\n\nWHAT THE REVIEWER CHECKS (Bob\'s notes; the human opens these only to dig)\n- title (max 80): what will be true afterwards. summary (max 320): current gap, proposed change, scope boundary.\n- problem: 1-3 findings about how things behave today, tied to inspected files. No invented defects.\n- decisions: every real choice with 2-4 concrete options. Decide it yourself (decidedBy=bob) when repository evidence or requirements settle it; mark it open only for human-dependent habits, scope or cost, give why, and set lean to the option you would take. Open decisions block approval; never hide a real choice or leave open one the repository settles.\n- criteria: EVERY original acceptance criterion, including independent/external/hardware checks this PR cannot complete; preserve meaning and source. Without explicit criteria, derive clearly sourced requirements. Coverage is what this plan will deliver, not completed evidence; partial means useful preparation with an explicit remaining part; deferred has no deliverable. The human sees partial and deferred items as "what this will not fully prove", so make their reason plain.\n- nonGoals: specific exclusions. acceptance: 3-6 measurable checks; never claim future physical tests or independent review have passed. risks: up to 6 concrete product/technical consequences with what limits each; workflow or ticket status is not a risk. Do not defer mandatory baseline security if the request makes it a prerequisite.\n- map: the system view for engineers: 1-4 areas, at most 10 parts (label max 24, note max 32), links with 1-2 word labels. unchanged parts give context only and cannot also be listed for file changes. Add option previews when an alternative changes the map.\n- evidence: why this design fits the existing architecture, tied to inspected paths.\n- candidate: the COMPLETE self-contained implementation plan; the implementer receives only the accepted plan and assets. Each step: what gets built and observable behavior, kind, relative size, traces ({"criterion":"AC1"} for requested work or {"added":"concrete necessity and why it was not requested"} for Bob-added work; never hide extras behind unrelated criteria) and every anticipated file change with exact repo-relative path and new/edit/delete, including tests, docs, configuration and known conditional edits with their triggers. Inspect callers and test wiring before estimating. Do not invent files or add UI/screenshots for a backend-only task without an explicit reason. Name the number and subject of documents. For limits chosen through measurement, state the selection rule and starting constraints; never invent measured values.\n\nNEW VERSIONS\nList every change to the plan since the previous version in changes (max 200 each; from=you when the human asked for it, bob when you added it) and set decidedBy=you for human-settled decisions. The human reads changes first on a new version, so say plainly what you did with each of their notes. Describe what changed in the plan, never approval or authorization status, reviewer process or what was not changed; the runtime tracks those. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization.\n\nLIMITS\nproblem observations and nonGoals 320; criterion text 1200; criterion reason, deliverable what and acceptance checks 480; added-work reason 320; deliverable title and decision question 120; IDs and option name 60; option upside/catch 160; decision why, map detail and risks 240; evidence at most 6.\n\nReturn ONLY architecture-v1 with briefVersion=2:\n{"architectureContract":"architecture-v1","briefVersion":2,"classification":"meaningful or routine","rationale":"concrete classification reason","title":"...","summary":"...","talk":{"understood":"You want ...","plan":"I\'d ...","scenes":[{"title":"...","before":["..."],"after":["..."]}],"notice":[{"who":"...","what":"..."}],"checks":[{"decision":"optional decision id","say":"I went with ...","instead":"..."}],"size":"...","split":"optional"},"problem":[{"repository":"selected repo","paths":["inspected existing file"],"observation":"..."}],"decisions":[{"id":"storage","question":"plain question","why":"required when open","status":"decided or open","pick":"option id, only when decided","decidedBy":"bob or you, only when decided","lean":"option id, only when open","options":[{"id":"a","name":"concrete option","upside":"...","catch":"...","preview":{"parts":[],"links":[],"hide":[]}}]}],"criteria":[{"id":"AC1","text":"complete original criterion text","source":"ticket identifier and criterion number, or user requirement","url":"optional actual source HTTP URL","status":"covered or partial or deferred","reason":"..."}],"nonGoals":["..."],"acceptance":["..."],"changes":[{"text":"...","from":"you or bob"}],"risks":["..."],"map":{"areas":[{"id":"area","name":"Area name"}],"parts":[{"id":"part","label":"...","note":"...","detail":"plain sentence","file":"optional repo-relative path","area":"area","status":"new or changed or unchanged or outside"}],"links":[{"from":"part","to":"part","label":"optional"}]},"evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"..."}],"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating every accepted requirement/decision, repository/base/delivery targets, inherited Takeover PR/work and validation expectations","steps":[{"id":"D1","title":"...","what":"...","kind":"code or test or docs or config","size":"S or M or L","traces":[{"criterion":"AC1"}],"files":[{"path":"complete repo-relative file path","change":"new or edit or delete","repository":"selected repo id; required for grouped repositories"}]}],"assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}\n\nMeaningful proposals need a map and at least one decision. Routine outputs may omit map and decisions but still need the check-in and scope fields. Never return footprint/counts or approval fields; the runtime computes footprint from listed files and actual repository boundaries. Independent child delivery is separate future work, not executable scheduling here.',
		json: true,
		askQuestions: false,
	},
	"architecture-review": {
		id: "architecture-review",
		configVersion: "step-config-v1",
		reads: {
			proposal: "architecture",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "architecture-review-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			"architecture-candidate",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [
			"architecture-questions",
			"implementation-scope",
			"architecture-continuation",
			"architecture-questions-brief",
		],
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
		prompt:
			'Review the check-in and its complete implementation plan against ALL requirements, comments, answers, decisions and inherited Takeover work. Require briefVersion=2 and a check-in a product owner can read in about two minutes: understood restates the human\'s goal in their terms; plan states the approach; scenes show what people or devices experience before and after as short observable steps; notice names every group that will notice, including upgrades, required configuration and anything that stops working; checks list only calls that need human judgment with the honest alternative; size and split are truthful. Reject jargon, file paths or class names in the check-in, benefit statements in place of behavior, consequences missing from notice, and calls that only the human can judge hidden in decisions. Also require concrete current-state findings, observable deliverables with anticipated files/operations/size estimates and criterion traces, every original acceptance criterion with honest covered/partial/deferred status and plain reason, justified Bob-added work, explicit non-goals, measurable acceptance checks and open decisions with Bob\'s lean. {{instruction:implementation-scope}} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. {{instruction:architecture-continuation}} Only when the COMPLETE candidate remains within that latest human acceptance, with no open decisions or unresolved uncertainty, include continuation:{proposalId:"exact accepted proposal ID",version:1,digest:"exact accepted digest",reason:"concrete evidence that cumulative changes preserve the accepted requirements, decisions, boundaries, limits, exclusions and delivery targets"}. This is an independent continuity assessment, never a new human acceptance. Omit continuation for initial proposals, material changes, explicit reapproval requirements, rejection or uncertainty. Compare the check-in to the full plan: reject hidden deliverables, omitted known conditional work or criteria, vague options, limits whose values or measurement selection rules appear only in the full plan, unsupported coverage claims, unnecessary packages or frontend work, and process status masquerading as technical risk. Inspect runtime footprint warnings, including invalid paths, operation mismatches and unchanged map parts listed for work; require correction or a concrete explanation of intentional cross-area/config changes. Assess repository evidence, decisions and options, map, readability and routine classification. Reject proposals that hide a real choice or leave a decision open that the repository already settles. Do not implement. {{instruction:architecture-questions-brief}} Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["concrete required changes"]}.',
		json: true,
		askQuestions: false,
	},
	"architecture-decision": {
		id: "architecture-decision",
		configVersion: "step-config-v1",
		reads: {
			proposal: "architecture",
			review: "architecture-review",
			plan: "plan",
			revise: "architecture",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
		view: nativeViewPreset("approve"),
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
	implement: {
		id: "implement",
		configVersion: "step-config-v1",
		reads: {
			plan: "plan",
		},
		output: {
			format: "implement-v1",
		},
		rules: [
			{
				id: "completion",
				message:
					"Blocked implementation requires a question to resolve the blocker; completed implementation must have no questions",
				require: {
					any: [
						{
							all: [
								{
									path: "/status",
									equals: "blocked",
								},
								{
									any: [
										{
											path: "/questions",
											empty: false,
										},
										{
											path: "/architectureRevision",
											equals: true,
										},
									],
								},
							],
						},
						{
							all: [
								{
									path: "/status",
									notEquals: "blocked",
								},
								{
									path: "/questions",
									empty: true,
								},
								{
									path: "/architectureRevision",
									notEquals: true,
								},
							],
						},
					],
				},
			},
		],
		checks: [
			"architecture-revision",
			{
				check: "ticket-milestone",
				kind: "implementation",
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [
			"implementation-scope",
			"implementation-architecture-revision",
		],
		name: "Implement accepted plan",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Implement the provided plan and use its assets. Read /answers alongside /plan for subsequent human responses, including resolution of implementation blockers. {{instruction:implementation-scope}} Follow repository conventions and appropriate verification. If implementation is forbidden, deferred, or blocked by missing access or a necessary decision, preserve completed work and return {"status":"blocked","summary":"concrete blocker","checks":["commands and outcomes"],"questions":["specific question or action needed to unblock implementation"]}. The workflow waits for an answer and resumes this role; do not report deferred or unfinished work as completed. Only after completing implementation return {"status":"completed","summary":"...","checks":["commands and outcomes"],"questions":[]}. Do not create or publish a PR; the next step handles delivery.{{instruction:implementation-architecture-revision}}',
		inputs: ["plan"],
		json: true,
		askQuestions: true,
		view: nativeViewPreset("ask"),
	},
	"draft-pr": {
		id: "draft-pr",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			clarify: "clarify",
			plan: "plan",
			implementation: "implement",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Push and create draft PR",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "draft-pr",
		args: [],
	},
	"assess-impact": {
		id: "assess-impact",
		configVersion: "step-config-v1",
		reads: {
			inventory: "extract-requirements",
			fanout: "specialist-review",
			ci: "ci",
			feedback: "@feedback",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "impact-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "impact-reuse",
				maxUnchangedCycles: 3,
			},
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Assess changed work and retained evidence",
		next: "impact-checks",
		branches: [
			{
				when: {
					path: "correctionRequired",
					equals: true,
				},
				next: "ci-fix",
			},
			{
				when: {
					path: "readinessOnly",
					equals: true,
				},
				next: "ci",
			},
			{
				when: {
					path: "extractRequirements",
					equals: true,
				},
				next: "extract-requirements",
			},
		],
		maxVisits: 200,
		type: "agent",
		prompt:
			'Independently assess /impactSnapshot, actual repository diffs (including cumulative changes since prior explicit approval), prior original receipts and unresolved findings. Fixer summaries never authorize reuse. Discover commands and conventions in ALL selected repositories; never infer safety from filenames, line count or unchanged head alone. Inspect whether test changes weaken assertions or coverage. Assess combined merge trees and target-only changes separately from task regressions. Unknown dependencies, conflicts, migrations, security boundaries, changed scope or unavailable evidence require broader inspection and relevant validation. Select only configured reviewer IDs from the snapshot. First review executes all roles. Reuse only completed resolved receipts with runtime dependency provenance; supply their exact receipt digest, boundary and a concrete independence reason. Unaffected areas retain original evidence, never claim a new review executed. Track future QA/guide/human/provider obligations at their own gates. Optional cleanup remains visible and nonblocking. Prior explicit approval can continue for an evidenced safe minor correction, including production code, only after all required evidence passes; uncertain or meaningful changes and human rejection require renewed approval. Assess the cumulative delta. Return impact-v1 with status, summary, correctionRequired:boolean, readinessOnly:boolean, commentAssessments:[{id,repositoryId (required for grouped deliveries unless id is repositoryId:commentId),bodySha256,disposition:"informational|consequential|accepted-unchanged",reason}], classification:"none|affected|full", rationale, uncertainty:[], extractRequirements:boolean, scopeReuse:{inventoryDigest,originalSourceDigest,reason} only when independently inspecting new feedback proves accepted requirements unchanged, specialists:[configured IDs], requirementIds:[], checks:[{id,repositoryId,command,reason,environment:{isolation:"worktree"} or {isolation:"shared",resources:[stable identities]}}], qaCriteria:[criterion IDs], qaReuse:[{criterionId,originalDigest,reason}], reuse:[{reviewer,receiptDigest,reason,boundary:{requirementIds,areas,dependencies,independence}}], invalidate:[{receiptDigest,reason}], targetCompatible:boolean, testAssertions:{inspected,weakened,evidence}, humanReview:"no-prior-approval|continue-after-checks|renew", approvalRationale and questions:[]. Missing inputs require blocked and a specific question. commentAssessments may identify ONLY supplied PR feedback from /feedback/readiness/unassessedComments, using its exact IDs and bodySha256 values. Originating ticket comments, assignment notices and chat messages are task inputs, never PR comment assessments. Return commentAssessments:[] when no PR feedback is supplied. Do not mutate files or run corrective agents. Every original configured role needs fresh execution or explicit valid reuse. Missing legacy provenance requires fresh review.',
		json: true,
		askQuestions: true,
		view: nativeViewPreset("ask"),
	},
	"extract-requirements": {
		id: "extract-requirements",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "inventory-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			"inventory-evidence",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		revision: "bound",
		access: {
			mode: "workspace",
		},
		instructions: ["review-stage-inventory", "impact-inventory"],
		name: "Extract requirements",
		next: "impact-checks",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Extract scope independently of the implementation. Read complete originalInput (parse embedded JSON), ticket/acceptance criteria, ALL paginated comments, attachments/assets, clarification answers and accepted decisions/plan, later chat/human steering, takeover/PR discussions and past review rounds/dispositions through factory-context. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for historical claims and reasoning, following original outputPath records when scope or disagreement evidence is needed. Follow nextOffset to null. Missing source access requires a concrete questions entry; never omit unavailable scope. Read previous inventories, retain every historical ID and decision, and record amendments/supersessions with changeReason. Suggestions are not accepted scope. Contradictions stay in conflicts and questions until explicitly resolved outside fanout. Scope decisions require explicit human acceptance, rationale and source, not a reviewer preference. Follow the runtime decision-attribution rule: use a recorded name when available, otherwise identify the Factory operator with the name not recorded; do not ask for a name merely to complete attribution. Use kind:"skip" only for an explicit scope waiver, and list the precise requirementIds it authorizes skipping; other accepted scope decisions use kind:"scope". List considered sources and unavailable sources in sourceReceipt. Semantic extraction completeness needs source inspection; structural validation alone cannot prove it.\nReturn {"schemaVersion":1,"requirements":[{"id":"R1","criterion":"testable accepted outcome","classification":"active or suggestion or superseded","sources":[{"source":"originalInput or context record or source URL","reference":"JSON Pointer/comment/attachment identifier"}],"changeReason":"required for an amendment","supersedes":[]}],"decisions":[{"id":"D1","acceptedBy":"recorded person or Factory operator (name not recorded)","kind":"scope or skip","requirementIds":["R1"],"rationale":"accepted scope rationale","source":{"source":"source","reference":"record identifier"}}],"conflicts":[{"id":"C1","description":"unresolved scope question","sources":[{"source":"source","reference":"record"}]}],"sourceReceipt":{"considered":[{"source":"source","reference":"record"}],"unavailable":[]},"questions":[]}. Runtime owns inventory version/digest. Do not change product files.{{instruction:impact-inventory}}',
		json: true,
		askQuestions: true,
		view: nativeViewPreset("ask"),
	},
	"impact-checks": {
		id: "impact-checks",
		configVersion: "step-config-v1",
		reads: {
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Run independently selected checks",
		next: "specialist-review",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "impact-checks",
		args: [],
	},
	"specialist-review": {
		id: "specialist-review",
		configVersion: "step-config-v1",
		reads: {
			inventory: "extract-requirements",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"review-boundary",
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Parallel specialist review",
		branches: [],
		maxVisits: 16,
		type: "fanout",
		groups: [
			[
				{
					id: "security-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "specialist-v1",
					},
					rules: [],
					checks: [
						"specialist-evidence",
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-specialist", "review-completion"],
					name: "Security and data protection",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own authorization, trust boundaries, secrets, untrusted input and consequential data exposure. Avoid general style or business scope review.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
			[
				{
					id: "architecture-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "specialist-v1",
					},
					rules: [],
					checks: [
						"specialist-evidence",
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-specialist", "review-completion"],
					name: "Architecture and module boundaries",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own responsibilities, dependency direction, domain/API seams and interface compatibility. Avoid speculative redesign and local style.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
			[
				{
					id: "integration-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "specialist-v1",
					},
					rules: [],
					checks: [
						"specialist-evidence",
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-specialist", "review-completion"],
					name: "Repository fit and integration",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own repository conventions, established reuse, config/migration wiring and surrounding integrations. Identify concrete omitted integration sites.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
			[
				{
					id: "simplicity-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "specialist-v1",
					},
					rules: [],
					checks: [
						"specialist-evidence",
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-specialist", "review-completion"],
					name: "Simplicity and maintainability",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own unnecessary abstraction, duplication, speculative extensibility and disproportionate complexity. Explain maintenance cost and a smaller sufficient alternative.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
			[
				{
					id: "correctness-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "specialist-v1",
					},
					rules: [],
					checks: [
						"specialist-evidence",
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-specialist", "review-completion"],
					name: "Correctness and verification",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own behavioral failures, boundaries, state/concurrency, error handling and actual verification gaps. Ground complaints in reproduction or code evidence.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
			[
				{
					id: "requirements-review",
					configVersion: "step-config-v1",
					reads: {
						scopeSource: "@source",
						scopeTicket: "@ticket",
					},
					output: {
						format: "coverage-v1",
					},
					rules: [],
					checks: [
						{
							check: "specialist-evidence",
							coverage: true,
						},
						{
							check: "scope-inputs",
							sources: {
								clarify: "scopeClarify",
								decisions: "scopeDecisions",
								plan: "scopePlan",
								"existing-work": "scopeExistingWork",
								"assess-existing": "scopeAssessment",
								source: "scopeSource",
								ticket: "scopeTicket",
							},
						},
					],
					revision: "bound",
					access: {
						mode: "workspace",
					},
					instructions: ["review-stage-coverage", "review-completion"],
					name: "Business requirements and acceptance",
					branches: [],
					maxVisits: 16,
					type: "agent",
					prompt:
						'Own complete acceptance coverage. Assess EVERY active requirement exactly once; preserve superseded/suggestion records as context. Return coverage:[{requirementId,status:\'met or not_met or deliberately_skipped\',evidence:[\'concrete evidence at frozen revision\'],reason:\'why\',decisionId:\'accepted decision for deliberate skip\'}] alongside review fields. Missing or inconclusive evidence is not_met, with an actionable open rating 2/3 finding referencing the ID. A skip needs an explicitly accepted decision, recorded person or unnamed Factory operator, rationale and source. Missing personal-name metadata alone cannot block coverage. Do not let reviewer/fixer preference waive scope.\nRead /reviewBaseline first. Review ONLY the frozen clean head/base and requirement inventory in that baseline. All reviewers receive the same immutable context and history cutoff. Read /contextMemory/reviewLedger and /contextMemory/reviewRounds when present; these preserve previous findings, fixer dispositions and review reasoning. Use original outputPath records for relevant disagreement or evidence details, rather than rereading every old review output. Without compact memory, read complete previous review rounds and fixer dispositions. Preserve stable local finding IDs. Reassess every prior open rating 2/3 finding. Settled findings may reopen only with freshEvidence describing new evidence or changed requirements. Resolved or accepted-rejection needs concrete evidence and reason. A fixer saying fixed is not proof. Preserve contradictory recommendations in disagreements until evidence resolves them. Removing a prior disagreement requires disputeResolutions:[{disagreement,reason,evidence}]. To reassess an inherited finding from a removed reviewer, use inheritedDispositions:[{id:"reviewer:local-id",status:"resolved or accepted-rejection",reason,evidence}]. Unmentioned inherited complaints remain open. Do not change product files, commit, publish, run hidden harness subagents or ask a question inside fanout. Report missing evidence instead of inventing a pass. Ratings: 1 nonblocking observation, 2 consequential should-fix, 3 must-fix.\nReturn {"summary":"concrete result","findings":[{"id":"stable-local-id","rating":2,"summary":"concrete failure","evidence":"file:line or actual check receipt","status":"open or resolved or accepted-rejection","requirementIds":["stable inventory ID"],"reason":"required for settled dispositions","freshEvidence":"required for reopening settled findings"}],"disagreements":["unresolved conflicting recommendation and evidence"]}. Runtime owns reviewer/revision/round stamps. Do not claim later QA executed; distinguish current code/local checks from future QA.',
					json: true,
					askQuestions: false,
				},
			],
		],
	},
	"review-gate": {
		id: "review-gate",
		configVersion: "step-config-v1",
		reads: {
			fix: "code-fix",
			inventory: "extract-requirements",
			fanout: "specialist-review",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			"review-boundary",
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
			"review-evidence",
			"review-assistance",
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Check review findings",
		branches: [
			{
				when: {
					path: "reviewIncomplete",
					equals: true,
				},
				next: "assess-impact",
			},
			{
				when: {
					path: "reviewBlocked",
					equals: true,
				},
				next: "code-fix",
			},
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "code-fix",
			},
		],
		maxVisits: 200,
		type: "check",
		check: {
			results: {
				approved: {
					all: [
						{
							count: "/evidence/review-evidence/findings",
							where: {
								all: [
									{
										path: "/status",
										equals: "open",
									},
									{
										path: "/rating",
										min: 2,
									},
								],
							},
							max: 0,
						},
						{
							path: "/evidence/review-evidence/disagreements",
							empty: true,
						},
						{
							any: [
								{
									all: [
										{
											path: "/evidence/review-evidence/reviewers",
											exists: true,
										},
										{
											each: "/evidence/review-evidence/reviewers",
											require: {
												all: [
													{
														path: "/status",
														equals: "completed",
													},
													{
														path: "/blockers",
														empty: true,
													},
												],
											},
										},
										{
											count: "/evidence/review-evidence/coverage",
											where: {
												path: "/status",
												equals: "not_met",
											},
											max: 0,
										},
									],
								},
								{
									all: [
										{
											not: {
												path: "/evidence/review-evidence/reviewers",
												exists: true,
											},
										},
										{
											path: "/evidence/review-evidence/status",
											equals: "completed",
										},
										{
											path: "/evidence/review-evidence/blockers",
											empty: true,
										},
									],
								},
							],
						},
					],
				},
				findings: {
					aggregate: "filter",
					path: "/evidence/review-evidence/findings",
					where: {
						all: [
							{
								path: "/status",
								equals: "open",
							},
							{
								path: "/rating",
								min: 2,
							},
						],
					},
				},
				reviewIncomplete: {
					path: "/evidence/review-evidence/reviewIncomplete",
					equals: true,
				},
				reviewBlocked: {
					path: "/evidence/review-evidence/reviewBlocked",
					equals: true,
				},
				questions: {
					select: "/evidence/review-evidence/questions",
				},
				rawFindings: {
					select: "/evidence/review-evidence/rawFindings",
				},
				coverage: {
					select: "/evidence/review-evidence/coverage",
				},
				reviewers: {
					select: "/evidence/review-evidence/reviewers",
				},
				disagreements: {
					select: "/evidence/review-evidence/disagreements",
				},
			},
			passed: {
				path: "/results/approved",
				equals: true,
			},
		},
	},
	ci: {
		id: "ci",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			fix: "ci-fix",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Watch merge readiness",
		branches: [
			{
				when: {
					path: "impactRequired",
					equals: true,
				},
				next: "assess-impact",
			},
			{
				when: {
					path: "retainQa",
					equals: true,
				},
				next: "guide",
			},
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
	"visual-scope": {
		id: "visual-scope",
		configVersion: "step-config-v1",
		reads: {
			mergeReadiness: "@mergeReadiness",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "qa-scope-v1",
		},
		rules: [
			{
				id: "video-contract",
				message: 'Invalid input: expected "video-v1"',
				path: "/videoContract",
				require: {
					path: "/videoContract",
					equals: "video-v1",
				},
			},
		],
		checks: [
			"architecture-revision",
			{
				check: "ids-resolve",
				adapter: "qa-scope",
			},
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [
			"incremental-visual-scope",
			"video-scope",
			"impact-scope",
			"inventory-qa",
		],
		name: "Plan QA stories and screenshots",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Read the accepted requirements, all recorded decisions/expectations, plan, implementation receipts, relevant history and exact cumulative base-to-head PR diff (including inherited takeover work). Plan observable QA for ALL changed behavior: UI, API, CLI and other interfaces. Declare environment:{isolation:"worktree"} only when all QA uses independent per-worktree servers, databases and fixtures. For shared clusters, databases, fixtures or browser control return environment:{isolation:"shared",resources:["stable shared resource identity"]}; use the same identity across repositories/runs using that resource. Unknown isolation requires shared protection, never assume a worktree isolates external resources. Cover happy paths and consequential failure, permission and boundary cases proportionately. Trace stories to agreed requirements; do not invent business requirements or turn subjective preferences into blocking criteria. Explain any requirement/diff area outside executable QA in exclusions. Assess navigation, feedback, readability and recovery where relevant.\nReturn {"qaContract":"qa-v1","changed":false,"areas":[],"captureBudget":24,"stories":[{"id":"stable-story-id","goal":"user goal","requirementRefs":["requirements/0 or decisions/0 or answers/0 (existing zero-based accepted record)"],"interface":"ui or api or cli or other","preconditions":["setup"],"fixtures":["access or data needed"],"actions":["ordered executable action"],"criteria":[{"id":"globally unique stable criterion ID","expected":"observable expected outcome"}],"evidenceInstructions":"how to execute and record evidence","screenshotTasks":[{"area":"exact selected area","state":"exact selected state at a defined point in these actions"}]}],"exclusions":[{"requirementRef":"requirement/diff area","reason":"concrete reason outside executable QA"}]}.\nchanged refers only to VISUAL scope. Nonvisual changes still need executable stories with real behavioral checks and may have zero screenshots. No changed executable behavior may use stories=[] only with a concrete notApplicableReason; no visual changes is insufficient. Inspect relevant existing tests before selecting them as criterion evidence.\nFor visuals return changed=true and areas:[{name,url,states:["single concrete representative state"],instructions,rationale,dependencies,changed}]. Normally choose 1–2 states per area and at most 24 screenshots. Group co-visible elements. Never multiply viewport/language/role combinations or comma-separated alternatives. Additional states must show distinct changed rendering risk. Up to 48 needs a concrete budgetReason. Every selected area/state must be linked to a story; API/CLI checks do not need artificial images. Dependencies are exact repository files or directory/** paths. Do not change code, execute QA or take screenshots.{{instruction:video-scope}}{{instruction:inventory-qa}}{{instruction:impact-scope}}',
		json: true,
		askQuestions: false,
	},
	capture: {
		id: "capture",
		configVersion: "step-config-v1",
		reads: {
			qaReuse: "@qaReuse",
			qaReview: "visual-review",
			scope: "visual-scope",
			qaGate: "visual-gate",
			answers: "@answers",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "qa-capture-v1",
		},
		rules: [
			{
				id: "video-contract",
				message: 'Invalid input: expected "video-v1"',
				path: "/videoContract",
				require: {
					path: "/videoContract",
					equals: "video-v1",
				},
			},
		],
		checks: [
			"architecture-revision",
			"capture-evidence",
			"qa-environment",
			{
				check: "media-valid",
				adapter: "capture",
				video: true,
			},
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: ["incremental-capture", "video-capture", "impact-capture"],
		name: "Execute QA and capture screenshots",
		next: "visual-review",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Execute EVERY planned QA story and acceptance criterion from visual-scope, including nonvisual API/CLI behavior. Read /answers for resolved access, fixtures and tooling blockers. Set up the application once when needed, use appropriate actual fixtures, and execute browser/HTTP/CLI/tests as instructed. Inspect test coverage and run the checks; source inspection or an implementation receipt alone cannot establish a pass. Compare observed outcomes with each exact expected outcome. Assess applicable navigation, feedback, readability and recovery. Do not modify product code or repair failures.\nReturn {"qaContract":"qa-v1","results":[{"storyId":"planned ID","outcome":"passed or failed or blocked","criteria":[{"criterionId":"planned ID","outcome":"passed or failed or blocked","expected":"exact expected outcome from scope","observed":"actual observed outcome","blockedReason":"concrete assistance needed when blocked","evidence":[{"kind":"command or test or http or browser or log","executed":true,"action":"actual command/request/actions performed","details":"exit/result/request-response/log details demonstrating this criterion","exitCode":0,"screenshotTasks":[{"area":"selected area","state":"selected state"}]}]}]}],"findings":[{"id":"stable finding ID","rating":3,"summary":"consequential requirement failure","evidence":"concrete receipt","status":"open","storyId":"planned ID","criterionId":"planned criterion ID","requirementRefs":["accepted requirement"],"reproduction":["steps"],"expected":"expected behavior","actual":"actual behavior"}],"observations":[{"id":"stable observation ID","summary":"optional UI/UX improvement","evidence":"observed details","storyId":"story ID"}],"screenshots":[{"path":"absolute real image path","caption":"what it demonstrates","area":"exact area","state":"exact state"}],"unavailable":[{"area":"selected area","reason":"concrete missing access/tooling/setup or failed behavior","cause":"access or product"}]}.\nOne result per story and criterion. Ratings 2/3 are consequential failures against agreed requirements; keep optional preferences in observations. Product failures are failed with actionable findings. If failed product behavior prevents a selected screenshot, report unavailable with cause:"product" linked to that failing story; missing access/tooling uses cause:"access". Missing access, fixtures or tooling is blocked with a concrete reason; never pass an unexecuted check. Story outcome must agree with criterion outcomes. Do not supply a revision claim; runtime stamps provenance. Execute criteria freshly on each visit; image reuse never establishes a behavioral pass.\nCapture exactly the selected representative screenshot tasks at their defined points DURING the story flows. Keep the captureBudget (normally 24, justified maximum 48), one real PNG/JPEG per exact area/state. Do not invent states or expand combinations. Save images under the supplied evidence directory with fresh filenames for each revision; inspect actual captures for readability. Keep the complete inventory, including provenance-eligible explicitly accepted unchanged images. Never claim images or checks that do not exist. Stop only servers you started, after all testing and captures finish.{{instruction:video-capture}}{{instruction:impact-capture}}',
		json: true,
		askQuestions: false,
	},
	"visual-review": {
		id: "visual-review",
		configVersion: "step-config-v1",
		reads: {
			capture: "capture",
			scope: "visual-scope",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "qa-review-v1",
		},
		rules: [
			{
				id: "recovery-reason",
				message: "Blocked or failed review requires a concrete recovery reason",
				when: {
					path: "/status",
					notEquals: "completed",
				},
				require: {
					any: [
						{
							path: "/blockers",
							empty: false,
						},
						{
							path: "/summary",
							empty: false,
						},
					],
				},
			},
			{
				id: "completed-without-blockers",
				message:
					"Completed review cannot retain missing-input/tooling blockers",
				when: {
					path: "/status",
					equals: "completed",
				},
				require: {
					path: "/blockers",
					empty: true,
				},
			},
		],
		checks: [
			"architecture-revision",
			"qa-review-evidence",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		revision: "bound",
		access: {
			mode: "workspace",
		},
		instructions: [
			"incremental-visual-review",
			"review-completion",
			"video-gate",
		],
		name: "Review QA and screenshots",
		next: "visual-gate",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Review the current diff against the accepted plan. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct historical review findings and fixer responses when available; original rounds remain accessible through source references. Read old output details only when relevant evidence is needed. Use stable finding IDs; do not reopen resolved findings without fresh evidence. A fixer may reject a complaint with evidence; assess that evidence and either accept or reject the rejection with reasoning. Return {"findings":[{"id":"stable-id","rating":2,"summary":"...","evidence":"file:line and concrete failure","status":"open"}],"summary":"..."}. Ratings: 1 nitpick, 2 should fix, 3 must fix. Include unresolved rating 2/3 findings from earlier rounds. Return no findings only when all consequential complaints are resolved or their rejections accepted. Do not modify code.\nThis is a QA AND SCREENSHOT review. Return qaContract:"qa-v1" alongside the review fields. Inspect accepted business requirements and expectations, cumulative diff, planned stories, complete criterion coverage, executed test receipts, failures, blocked checks, optional observations and all retained disputes. A screenshot alone cannot prove behavior, and an agent saying passed without actual executed evidence is insufficient. Missing/blocked required QA cannot be approved. Failed required behavior requires a fix and retest even when a fixer rejects a complaint. Corrections to erroneous scenarios must match accepted requirements and record a rationale.\nOpen the actual selected screenshots. Return acceptedScreenshots:[{area,state,imageSha256}] for every individually inspected good image, using its exact supplied hash. Exclude images affected by unresolved findings. Missing critical SELECTED states is rating 3; do not invent larger viewport/language/role matrices. Request only minimum targeted replacements by exact area/state. Preserve explicitly accepted unchanged image receipts and optional observations without making preferences blocking. Return complete current coverage, not merely the latest delta. Do not execute QA again, change code or recapture images.{{instruction:video-gate}}',
		json: true,
		askQuestions: false,
	},
	"visual-gate": {
		id: "visual-gate",
		configVersion: "step-config-v1",
		reads: {
			qaReview: "visual-review",
			scope: "visual-scope",
			capture: "capture",
			review: "visual-review",
			fix: "visual-fix",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			impact: "assess-impact",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			"qa-evidence",
			{
				check: "media-valid",
				adapter: "qa-gate",
				video: true,
			},
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
			"review-evidence",
			"review-assistance",
			"qa-gate-evidence",
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Check QA and screenshots",
		next: "guide",
		branches: [
			{
				when: {
					path: "qaRetry",
					equals: true,
				},
				next: "capture",
			},
			{
				when: {
					path: "qaBlocked",
					equals: true,
				},
				next: "capture",
			},
			{
				when: {
					path: "captureBlocked",
					equals: true,
				},
				next: "capture",
			},
			{
				when: {
					path: "reviewIncomplete",
					equals: true,
				},
				next: "assess-impact",
			},
			{
				when: {
					path: "reviewBlocked",
					equals: true,
				},
				next: "visual-fix",
			},
			{
				when: {
					path: "approved",
					equals: false,
				},
				next: "visual-fix",
			},
		],
		maxVisits: 200,
		type: "check",
		check: {
			results: {
				approved: {
					all: [
						{
							path: "/evidence/qa-gate-evidence",
							exists: true,
						},
						{
							path: "/evidence/review-evidence/incomplete",
							equals: false,
						},
						{
							path: "/evidence/qa-gate-evidence/findings",
							empty: true,
						},
						{
							path: "/evidence/qa-gate-evidence/evidenceErrors",
							empty: true,
						},
						{
							path: "/evidence/qa-gate-evidence/evidenceBlocked",
							empty: true,
						},
					],
				},
				findings: {
					select: "/evidence/qa-gate-evidence/findings",
				},
				reviewIncomplete: {
					all: [
						{
							path: "/evidence/review-evidence/incomplete",
							equals: true,
						},
						{
							path: "/evidence/qa-gate-evidence/findings",
							empty: true,
						},
					],
				},
				reviewBlocked: {
					path: "/evidence/review-evidence/reviewBlocked",
					equals: true,
				},
				questions: {
					select: "/evidence/review-evidence/questions",
				},
				qaContract: {
					select: "/evidence/qa-gate-evidence/qaContract",
				},
				observations: {
					select: "/evidence/qa-gate-evidence/observations",
				},
				headSha: {
					select: "/evidence/qa-gate-evidence/headSha",
				},
				scopeHash: {
					select: "/evidence/qa-gate-evidence/scopeHash",
				},
				captureHash: {
					select: "/evidence/qa-gate-evidence/captureHash",
				},
				reviewHash: {
					select: "/evidence/qa-gate-evidence/reviewHash",
				},
				evidenceIssues: {
					select: "/evidence/qa-gate-evidence/evidenceIssues",
				},
				qaRetry: {
					select: "/evidence/qa-gate-evidence/qaRetry",
				},
				qaBlocked: {
					select: "/evidence/qa-gate-evidence/qaBlocked",
				},
				captureBlocked: {
					select: "/evidence/qa-gate-evidence/captureBlocked",
				},
			},
			passed: {
				path: "/results/approved",
				equals: true,
			},
		},
	},
	"code-fix": {
		id: "code-fix",
		configVersion: "step-config-v1",
		reads: {
			reviewFix: "@reviewFix",
			reviewGate: "review-gate",
			publication: "draft-pr",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "review-fix-v1",
		},
		rules: [
			{
				id: "architecture-handback",
				message:
					"Architecture revision requires status=blocked and questions=[]; the configured proposal route owns review and any required acceptance",
				when: {
					path: "/architectureRevision",
					equals: true,
				},
				require: {
					all: [
						{
							path: "/status",
							equals: "blocked",
						},
						{
							path: "/questions",
							exists: true,
						},
						{
							path: "/questions",
							maxLength: 0,
						},
					],
				},
			},
		],
		checks: [
			"architecture-revision",
			"optional-questions",
			"review-dispositions",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "push",
		},
		instructions: ["incremental-review-fix", "review-fix"],
		name: "Fix review findings",
		next: "assess-impact",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\n{{instruction:review-fix}}',
		json: true,
		askQuestions: false,
	},
	"ci-fix": {
		id: "ci-fix",
		configVersion: "step-config-v1",
		reads: {
			ci: "ci",
			feedback: "@feedback",
			mergeReadiness: "@mergeReadiness",
			publication: "draft-pr",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "ci-fix-v1",
		},
		rules: [
			{
				id: "architecture-handback",
				message:
					"Architecture revision requires status=blocked and questions=[]; the configured proposal route owns review and any required acceptance",
				when: {
					path: "/architectureRevision",
					equals: true,
				},
				require: {
					all: [
						{
							path: "/status",
							equals: "blocked",
						},
						{
							path: "/questions",
							exists: true,
						},
						{
							path: "/questions",
							maxLength: 0,
						},
					],
				},
			},
		],
		checks: [
			"architecture-revision",
			"optional-questions",
			"feedback-assessment",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "push",
		},
		instructions: ["incremental-ci-fix", "ci-fix-runtime", "ci-assessment"],
		name: "Fix CI failures",
		next: "after-ci-fix-observe",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Diagnose and fix CI failures, merge conflicts, stale branches and actionable PR review comments in the supplied merge-readiness receipt and full history. Fetch the base before resolving conflicts. For each supplied unresolved review thread, address it or post an evidence-backed response before resolving it using the selected Git provider (GitHub: write a token-free JSON request file with method POST, path graphql and body {query,variables}, set repoUrl to the selected HTTPS repository URL and requestFile to that file, then run sh -c "$BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND github-api \\"\\$@\\"" bobs-factory --repo "$repoUrl" --request "$requestFile" with the resolveReviewThread mutation; GitLab: glab api PUT the MR discussion with resolved=true; custom: the configured adapter). Do not dismiss reviews or bypass rules. Required reviewer approvals must wait for the reviewer; do not impersonate one. Assess every supplied new PR comment. Act on requested corrections or document why a comment is informational. Record its ID in addressedCommentIds after assessment, and include disposition/reason in the summary. Add <!-- generated-by-bobs-factory --> to any PR reply you write. Retain all discussion and report addressed comment/thread IDs. Run relevant checks, commit and push to the same draft PR. Return {"summary":"...","checks":["..."],"addressedReviewIds":["review IDs"],"addressedCommentIds":["comment IDs"]}. Do not merge or mark ready.{{instruction:ci-assessment}}',
		json: true,
		askQuestions: false,
	},
	"after-ci-fix-observe": {
		id: "after-ci-fix-observe",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			fix: "ci-fix",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Inspect current review and provider evidence",
		next: "after-ci-fix",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "inspect-review-readiness",
		args: [],
	},
	"after-ci-fix": {
		id: "after-ci-fix",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			fix: "ci-fix",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			observation: "after-ci-fix-observe",
			observations: "after-ci-fix-observe/observations",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
			"post-fix-evidence",
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Check whether code needs another review",
		next: "assess-impact",
		branches: [
			{
				when: {
					path: "needsAssistance",
					equals: true,
				},
				next: "ci-fix",
			},
		],
		maxVisits: 200,
		type: "check",
		check: {
			results: {
				reviewRequired: {
					some: "/inputs/observations",
					require: {
						any: [
							{
								any: [
									{
										some: "/feedback",
										require: {
											all: [
												{
													path: "/kind",
													in: ["threads", "reviews", "revision"],
												},
												{
													any: [
														{
															not: {
																path: "/action",
																exists: true,
															},
														},
														{
															path: "/action",
															equals: "fix",
														},
													],
												},
												{
													any: [
														{
															not: {
																path: "/fixReviewRequired",
																equals: false,
															},
														},
														{
															path: "/currentFix",
															equals: true,
														},
													],
												},
											],
										},
									},
									{
										all: [
											{
												some: "/feedback",
												require: {
													path: "/kind",
													equals: "comments",
												},
											},
											{
												not: {
													path: "/fix/reviewRequired",
													equals: false,
												},
											},
										],
									},
								],
							},
							{
								path: "/fix/reviewRequired",
								equals: true,
							},
							{
								path: "/reviewed",
								equals: null,
							},
							{
								path: "/reviewed/dirty",
								equals: true,
							},
							{
								path: "/dirty",
								equals: true,
							},
							{
								not: {
									path: "/reviewed/headSha",
									equalsPath: "/headSha",
								},
							},
							{
								not: {
									path: "/readiness/headSha",
									equalsPath: "/headSha",
								},
							},
							{
								path: "/previousBase",
								equals: null,
							},
							{
								not: {
									path: "/previousBase",
									equalsPath: "/readiness/baseSha",
								},
							},
							{
								not: {
									path: "/reviewApproved",
									equals: true,
								},
							},
							{
								path: "/scopeChanged",
								equals: true,
							},
						],
					},
				},
				headSha: {
					select: "/inputs/observation/headSha",
				},
				baseSha: {
					select: "/inputs/observation/readiness/baseSha",
				},
				baseChanged: {
					some: "/inputs/observations",
					require: {
						not: {
							path: "/previousBase",
							equalsPath: "/readiness/baseSha",
						},
					},
				},
				unchangedRevision: {
					some: "/inputs/observations",
					require: {
						all: [
							{
								path: "/dirty",
								equals: false,
							},
							{
								not: {
									path: "/readiness/headSha",
									equalsPath: "/headSha",
								},
							},
							{
								path: "/previous/worktreeHeadSha",
								equalsPath: "/headSha",
							},
							{
								path: "/previous/headSha",
								equalsPath: "/readiness/headSha",
							},
							{
								path: "/previous/baseSha",
								equalsPath: "/readiness/baseSha",
							},
						],
					},
				},
				unchangedFailures: {
					some: "/inputs/observations",
					require: {
						all: [
							{
								not: {
									any: [
										{
											any: [
												{
													some: "/feedback",
													require: {
														all: [
															{
																path: "/kind",
																in: ["threads", "reviews", "revision"],
															},
															{
																any: [
																	{
																		not: {
																			path: "/action",
																			exists: true,
																		},
																	},
																	{
																		path: "/action",
																		equals: "fix",
																	},
																],
															},
															{
																any: [
																	{
																		not: {
																			path: "/fixReviewRequired",
																			equals: false,
																		},
																	},
																	{
																		path: "/currentFix",
																		equals: true,
																	},
																],
															},
														],
													},
												},
												{
													all: [
														{
															some: "/feedback",
															require: {
																path: "/kind",
																equals: "comments",
															},
														},
														{
															not: {
																path: "/fix/reviewRequired",
																equals: false,
															},
														},
													],
												},
											],
										},
										{
											path: "/fix/reviewRequired",
											equals: true,
										},
										{
											path: "/reviewed",
											equals: null,
										},
										{
											path: "/reviewed/dirty",
											equals: true,
										},
										{
											path: "/dirty",
											equals: true,
										},
										{
											not: {
												path: "/reviewed/headSha",
												equalsPath: "/headSha",
											},
										},
										{
											not: {
												path: "/readiness/headSha",
												equalsPath: "/headSha",
											},
										},
										{
											path: "/previousBase",
											equals: null,
										},
										{
											not: {
												path: "/previousBase",
												equalsPath: "/readiness/baseSha",
											},
										},
										{
											not: {
												path: "/reviewApproved",
												equals: true,
											},
										},
										{
											path: "/scopeChanged",
											equals: true,
										},
									],
								},
							},
							{
								path: "/previous/headSha",
								equalsPath: "/headSha",
							},
							{
								not: {
									path: "/failures",
									empty: true,
								},
							},
							{
								path: "/previousFailures",
								equalsPath: "/failures",
							},
						],
					},
				},
				unchangedWork: {
					some: "/inputs/observations",
					require: {
						all: [
							{
								path: "/dirty",
								equals: false,
							},
							{
								path: "/previous/headSha",
								equalsPath: "/headSha",
							},
							{
								path: "/previous/baseSha",
								equalsPath: "/readiness/baseSha",
							},
							{
								not: {
									path: "/fingerprint",
									equals: null,
								},
							},
							{
								path: "/fingerprint",
								equalsPath: "/previousFingerprint",
							},
							{
								any: [
									{
										not: {
											any: [
												{
													any: [
														{
															some: "/feedback",
															require: {
																all: [
																	{
																		path: "/kind",
																		in: ["threads", "reviews", "revision"],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/action",
																					exists: true,
																				},
																			},
																			{
																				path: "/action",
																				equals: "fix",
																			},
																		],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/fixReviewRequired",
																					equals: false,
																				},
																			},
																			{
																				path: "/currentFix",
																				equals: true,
																			},
																		],
																	},
																],
															},
														},
														{
															all: [
																{
																	some: "/feedback",
																	require: {
																		path: "/kind",
																		equals: "comments",
																	},
																},
																{
																	not: {
																		path: "/fix/reviewRequired",
																		equals: false,
																	},
																},
															],
														},
													],
												},
												{
													path: "/fix/reviewRequired",
													equals: true,
												},
												{
													path: "/reviewed",
													equals: null,
												},
												{
													path: "/reviewed/dirty",
													equals: true,
												},
												{
													path: "/dirty",
													equals: true,
												},
												{
													not: {
														path: "/reviewed/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													not: {
														path: "/readiness/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													path: "/previousBase",
													equals: null,
												},
												{
													not: {
														path: "/previousBase",
														equalsPath: "/readiness/baseSha",
													},
												},
												{
													not: {
														path: "/reviewApproved",
														equals: true,
													},
												},
												{
													path: "/scopeChanged",
													equals: true,
												},
											],
										},
									},
									{
										path: "/repeated",
										equals: true,
									},
								],
							},
						],
					},
				},
				revisionAssistance: {
					aggregate: "filter",
					path: "/inputs/observations",
					where: {
						all: [
							{
								path: "/dirty",
								equals: false,
							},
							{
								not: {
									path: "/readiness/headSha",
									equalsPath: "/headSha",
								},
							},
							{
								path: "/previous/worktreeHeadSha",
								equalsPath: "/headSha",
							},
							{
								path: "/previous/headSha",
								equalsPath: "/readiness/headSha",
							},
							{
								path: "/previous/baseSha",
								equalsPath: "/readiness/baseSha",
							},
						],
					},
				},
				failureAssistance: {
					aggregate: "filter",
					path: "/inputs/observations",
					where: {
						all: [
							{
								not: {
									any: [
										{
											any: [
												{
													some: "/feedback",
													require: {
														all: [
															{
																path: "/kind",
																in: ["threads", "reviews", "revision"],
															},
															{
																any: [
																	{
																		not: {
																			path: "/action",
																			exists: true,
																		},
																	},
																	{
																		path: "/action",
																		equals: "fix",
																	},
																],
															},
															{
																any: [
																	{
																		not: {
																			path: "/fixReviewRequired",
																			equals: false,
																		},
																	},
																	{
																		path: "/currentFix",
																		equals: true,
																	},
																],
															},
														],
													},
												},
												{
													all: [
														{
															some: "/feedback",
															require: {
																path: "/kind",
																equals: "comments",
															},
														},
														{
															not: {
																path: "/fix/reviewRequired",
																equals: false,
															},
														},
													],
												},
											],
										},
										{
											path: "/fix/reviewRequired",
											equals: true,
										},
										{
											path: "/reviewed",
											equals: null,
										},
										{
											path: "/reviewed/dirty",
											equals: true,
										},
										{
											path: "/dirty",
											equals: true,
										},
										{
											not: {
												path: "/reviewed/headSha",
												equalsPath: "/headSha",
											},
										},
										{
											not: {
												path: "/readiness/headSha",
												equalsPath: "/headSha",
											},
										},
										{
											path: "/previousBase",
											equals: null,
										},
										{
											not: {
												path: "/previousBase",
												equalsPath: "/readiness/baseSha",
											},
										},
										{
											not: {
												path: "/reviewApproved",
												equals: true,
											},
										},
										{
											path: "/scopeChanged",
											equals: true,
										},
									],
								},
							},
							{
								path: "/previous/headSha",
								equalsPath: "/headSha",
							},
							{
								not: {
									path: "/failures",
									empty: true,
								},
							},
							{
								path: "/previousFailures",
								equalsPath: "/failures",
							},
						],
					},
				},
				workAssistance: {
					aggregate: "filter",
					path: "/inputs/observations",
					where: {
						all: [
							{
								path: "/dirty",
								equals: false,
							},
							{
								path: "/previous/headSha",
								equalsPath: "/headSha",
							},
							{
								path: "/previous/baseSha",
								equalsPath: "/readiness/baseSha",
							},
							{
								not: {
									path: "/fingerprint",
									equals: null,
								},
							},
							{
								path: "/fingerprint",
								equalsPath: "/previousFingerprint",
							},
							{
								any: [
									{
										not: {
											any: [
												{
													any: [
														{
															some: "/feedback",
															require: {
																all: [
																	{
																		path: "/kind",
																		in: ["threads", "reviews", "revision"],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/action",
																					exists: true,
																				},
																			},
																			{
																				path: "/action",
																				equals: "fix",
																			},
																		],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/fixReviewRequired",
																					equals: false,
																				},
																			},
																			{
																				path: "/currentFix",
																				equals: true,
																			},
																		],
																	},
																],
															},
														},
														{
															all: [
																{
																	some: "/feedback",
																	require: {
																		path: "/kind",
																		equals: "comments",
																	},
																},
																{
																	not: {
																		path: "/fix/reviewRequired",
																		equals: false,
																	},
																},
															],
														},
													],
												},
												{
													path: "/fix/reviewRequired",
													equals: true,
												},
												{
													path: "/reviewed",
													equals: null,
												},
												{
													path: "/reviewed/dirty",
													equals: true,
												},
												{
													path: "/dirty",
													equals: true,
												},
												{
													not: {
														path: "/reviewed/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													not: {
														path: "/readiness/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													path: "/previousBase",
													equals: null,
												},
												{
													not: {
														path: "/previousBase",
														equalsPath: "/readiness/baseSha",
													},
												},
												{
													not: {
														path: "/reviewApproved",
														equals: true,
													},
												},
												{
													path: "/scopeChanged",
													equals: true,
												},
											],
										},
									},
									{
										path: "/repeated",
										equals: true,
									},
								],
							},
						],
					},
				},
				needsAssistance: {
					some: "/inputs/observations",
					require: {
						any: [
							{
								all: [
									{
										path: "/dirty",
										equals: false,
									},
									{
										not: {
											path: "/readiness/headSha",
											equalsPath: "/headSha",
										},
									},
									{
										path: "/previous/worktreeHeadSha",
										equalsPath: "/headSha",
									},
									{
										path: "/previous/headSha",
										equalsPath: "/readiness/headSha",
									},
									{
										path: "/previous/baseSha",
										equalsPath: "/readiness/baseSha",
									},
								],
							},
							{
								all: [
									{
										not: {
											any: [
												{
													any: [
														{
															some: "/feedback",
															require: {
																all: [
																	{
																		path: "/kind",
																		in: ["threads", "reviews", "revision"],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/action",
																					exists: true,
																				},
																			},
																			{
																				path: "/action",
																				equals: "fix",
																			},
																		],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/fixReviewRequired",
																					equals: false,
																				},
																			},
																			{
																				path: "/currentFix",
																				equals: true,
																			},
																		],
																	},
																],
															},
														},
														{
															all: [
																{
																	some: "/feedback",
																	require: {
																		path: "/kind",
																		equals: "comments",
																	},
																},
																{
																	not: {
																		path: "/fix/reviewRequired",
																		equals: false,
																	},
																},
															],
														},
													],
												},
												{
													path: "/fix/reviewRequired",
													equals: true,
												},
												{
													path: "/reviewed",
													equals: null,
												},
												{
													path: "/reviewed/dirty",
													equals: true,
												},
												{
													path: "/dirty",
													equals: true,
												},
												{
													not: {
														path: "/reviewed/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													not: {
														path: "/readiness/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													path: "/previousBase",
													equals: null,
												},
												{
													not: {
														path: "/previousBase",
														equalsPath: "/readiness/baseSha",
													},
												},
												{
													not: {
														path: "/reviewApproved",
														equals: true,
													},
												},
												{
													path: "/scopeChanged",
													equals: true,
												},
											],
										},
									},
									{
										path: "/previous/headSha",
										equalsPath: "/headSha",
									},
									{
										not: {
											path: "/failures",
											empty: true,
										},
									},
									{
										path: "/previousFailures",
										equalsPath: "/failures",
									},
								],
							},
							{
								all: [
									{
										path: "/dirty",
										equals: false,
									},
									{
										path: "/previous/headSha",
										equalsPath: "/headSha",
									},
									{
										path: "/previous/baseSha",
										equalsPath: "/readiness/baseSha",
									},
									{
										not: {
											path: "/fingerprint",
											equals: null,
										},
									},
									{
										path: "/fingerprint",
										equalsPath: "/previousFingerprint",
									},
									{
										any: [
											{
												not: {
													any: [
														{
															any: [
																{
																	some: "/feedback",
																	require: {
																		all: [
																			{
																				path: "/kind",
																				in: ["threads", "reviews", "revision"],
																			},
																			{
																				any: [
																					{
																						not: {
																							path: "/action",
																							exists: true,
																						},
																					},
																					{
																						path: "/action",
																						equals: "fix",
																					},
																				],
																			},
																			{
																				any: [
																					{
																						not: {
																							path: "/fixReviewRequired",
																							equals: false,
																						},
																					},
																					{
																						path: "/currentFix",
																						equals: true,
																					},
																				],
																			},
																		],
																	},
																},
																{
																	all: [
																		{
																			some: "/feedback",
																			require: {
																				path: "/kind",
																				equals: "comments",
																			},
																		},
																		{
																			not: {
																				path: "/fix/reviewRequired",
																				equals: false,
																			},
																		},
																	],
																},
															],
														},
														{
															path: "/fix/reviewRequired",
															equals: true,
														},
														{
															path: "/reviewed",
															equals: null,
														},
														{
															path: "/reviewed/dirty",
															equals: true,
														},
														{
															path: "/dirty",
															equals: true,
														},
														{
															not: {
																path: "/reviewed/headSha",
																equalsPath: "/headSha",
															},
														},
														{
															not: {
																path: "/readiness/headSha",
																equalsPath: "/headSha",
															},
														},
														{
															path: "/previousBase",
															equals: null,
														},
														{
															not: {
																path: "/previousBase",
																equalsPath: "/readiness/baseSha",
															},
														},
														{
															not: {
																path: "/reviewApproved",
																equals: true,
															},
														},
														{
															path: "/scopeChanged",
															equals: true,
														},
													],
												},
											},
											{
												path: "/repeated",
												equals: true,
											},
										],
									},
								],
							},
						],
					},
				},
				assistanceObservations: {
					aggregate: "filter",
					path: "/inputs/observations",
					where: {
						any: [
							{
								all: [
									{
										path: "/dirty",
										equals: false,
									},
									{
										not: {
											path: "/readiness/headSha",
											equalsPath: "/headSha",
										},
									},
									{
										path: "/previous/worktreeHeadSha",
										equalsPath: "/headSha",
									},
									{
										path: "/previous/headSha",
										equalsPath: "/readiness/headSha",
									},
									{
										path: "/previous/baseSha",
										equalsPath: "/readiness/baseSha",
									},
								],
							},
							{
								all: [
									{
										not: {
											any: [
												{
													any: [
														{
															some: "/feedback",
															require: {
																all: [
																	{
																		path: "/kind",
																		in: ["threads", "reviews", "revision"],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/action",
																					exists: true,
																				},
																			},
																			{
																				path: "/action",
																				equals: "fix",
																			},
																		],
																	},
																	{
																		any: [
																			{
																				not: {
																					path: "/fixReviewRequired",
																					equals: false,
																				},
																			},
																			{
																				path: "/currentFix",
																				equals: true,
																			},
																		],
																	},
																],
															},
														},
														{
															all: [
																{
																	some: "/feedback",
																	require: {
																		path: "/kind",
																		equals: "comments",
																	},
																},
																{
																	not: {
																		path: "/fix/reviewRequired",
																		equals: false,
																	},
																},
															],
														},
													],
												},
												{
													path: "/fix/reviewRequired",
													equals: true,
												},
												{
													path: "/reviewed",
													equals: null,
												},
												{
													path: "/reviewed/dirty",
													equals: true,
												},
												{
													path: "/dirty",
													equals: true,
												},
												{
													not: {
														path: "/reviewed/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													not: {
														path: "/readiness/headSha",
														equalsPath: "/headSha",
													},
												},
												{
													path: "/previousBase",
													equals: null,
												},
												{
													not: {
														path: "/previousBase",
														equalsPath: "/readiness/baseSha",
													},
												},
												{
													not: {
														path: "/reviewApproved",
														equals: true,
													},
												},
												{
													path: "/scopeChanged",
													equals: true,
												},
											],
										},
									},
									{
										path: "/previous/headSha",
										equalsPath: "/headSha",
									},
									{
										not: {
											path: "/failures",
											empty: true,
										},
									},
									{
										path: "/previousFailures",
										equalsPath: "/failures",
									},
								],
							},
							{
								all: [
									{
										path: "/dirty",
										equals: false,
									},
									{
										path: "/previous/headSha",
										equalsPath: "/headSha",
									},
									{
										path: "/previous/baseSha",
										equalsPath: "/readiness/baseSha",
									},
									{
										not: {
											path: "/fingerprint",
											equals: null,
										},
									},
									{
										path: "/fingerprint",
										equalsPath: "/previousFingerprint",
									},
									{
										any: [
											{
												not: {
													any: [
														{
															any: [
																{
																	some: "/feedback",
																	require: {
																		all: [
																			{
																				path: "/kind",
																				in: ["threads", "reviews", "revision"],
																			},
																			{
																				any: [
																					{
																						not: {
																							path: "/action",
																							exists: true,
																						},
																					},
																					{
																						path: "/action",
																						equals: "fix",
																					},
																				],
																			},
																			{
																				any: [
																					{
																						not: {
																							path: "/fixReviewRequired",
																							equals: false,
																						},
																					},
																					{
																						path: "/currentFix",
																						equals: true,
																					},
																				],
																			},
																		],
																	},
																},
																{
																	all: [
																		{
																			some: "/feedback",
																			require: {
																				path: "/kind",
																				equals: "comments",
																			},
																		},
																		{
																			not: {
																				path: "/fix/reviewRequired",
																				equals: false,
																			},
																		},
																	],
																},
															],
														},
														{
															path: "/fix/reviewRequired",
															equals: true,
														},
														{
															path: "/reviewed",
															equals: null,
														},
														{
															path: "/reviewed/dirty",
															equals: true,
														},
														{
															path: "/dirty",
															equals: true,
														},
														{
															not: {
																path: "/reviewed/headSha",
																equalsPath: "/headSha",
															},
														},
														{
															not: {
																path: "/readiness/headSha",
																equalsPath: "/headSha",
															},
														},
														{
															path: "/previousBase",
															equals: null,
														},
														{
															not: {
																path: "/previousBase",
																equalsPath: "/readiness/baseSha",
															},
														},
														{
															not: {
																path: "/reviewApproved",
																equals: true,
															},
														},
														{
															path: "/scopeChanged",
															equals: true,
														},
													],
												},
											},
											{
												path: "/repeated",
												equals: true,
											},
										],
									},
								],
							},
						],
					},
				},
			},
			passed: {
				not: {
					path: "/results/reviewRequired",
					equals: true,
				},
			},
		},
	},
	"visual-fix": {
		id: "visual-fix",
		configVersion: "step-config-v1",
		reads: {
			reviewFix: "@reviewFix",
			qaGate: "visual-gate",
			review: "visual-review",
			reviewGate: "visual-gate",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			publication: "draft-pr",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "review-fix-v1",
		},
		rules: [
			{
				id: "architecture-handback",
				message:
					"Architecture revision requires status=blocked and questions=[]; the configured proposal route owns review and any required acceptance",
				when: {
					path: "/architectureRevision",
					equals: true,
				},
				require: {
					all: [
						{
							path: "/status",
							equals: "blocked",
						},
						{
							path: "/questions",
							exists: true,
						},
						{
							path: "/questions",
							maxLength: 0,
						},
					],
				},
			},
		],
		checks: [
			"architecture-revision",
			"optional-questions",
			"review-dispositions",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "push",
		},
		instructions: ["incremental-review-fix", "review-fix", "visual-fix"],
		name: "Fix QA and visual findings",
		next: "assess-impact",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Fix all open rating 2/3 findings. Use /contextMemory/reviewLedger and /contextMemory/reviewRounds for ALL distinct past findings and fixer dispositions when available, reading original source references only when needed; avoid alternating fixes or reopening settled issues without evidence. You may reject a complaint with concrete evidence. Return {"dispositions":[{"id":"finding-id","status":"fixed or rejected","reason":"..."}],"summary":"...","questions":[]}. Run relevant checks, commit and push changes to the same draft PR. Do not merge or mark the PR ready.\n{{instruction:review-fix}}{{instruction:visual-fix}}',
		json: true,
		askQuestions: false,
	},
	guide: {
		id: "guide",
		configVersion: "step-config-v1",
		reads: {
			ci: "ci",
			capture: "capture",
			qaReview: "visual-review",
			scope: "visual-scope",
			mergeReadiness: "@mergeReadiness",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "review-brief-v3",
		},
		rules: [],
		checks: [
			"architecture-revision",
			"requirement-coverage",
			{
				check: "code-refs-valid",
				adapter: "guide",
			},
			{
				check: "media-valid",
				adapter: "guide",
				video: true,
			},
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: ["brief-runtime", "impact-guide", "video-brief"],
		name: "Prepare human review brief",
		next: "handoff",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Write the human review brief for the WHOLE PR at the current revision, including inherited takeover work and every accepted iteration. The reader decides one thing: does this PR deliver what was asked? Answer in this order: was the right thing built (the ask and every interpretation of it), does it work (one decisive, human-checkable proof per requirement), what only a human can judge, and what else changed or remains unproven.\nFirst read through factory-context: the original input/ticket and all comments, clarification decisions and answers, the frozen requirement inventory and review-gate coverage, the accepted plan, /progress/reviewScope (every whole-PR file), executed QA stories with observed values, and the accepted capture inventory. Inspect the actual base-to-head diff yourself.\nReturn {"verdict":{"headline":"what now works, said the way a user would say it (<=160 chars)","readiness":"ready|ready-with-caveats|not-ready","why":"one sentence (<=260)"},"ask":{"source":"e.g. Linear ATT-764","url":"ticket URL when known","quote":"the original request verbatim, trimmed to its substance"},"interpretation":[{"topic":"short","chosen":"what was built","alternatives":["what the ask could also have meant"],"decidedBy":"you|ticket|bob","note":"optional, e.g. You delegated this choice."}],"requirements":[{"id":"kebab-id","text":"observable outcome (<=180)","origin":"ask|your-answer|bob","covers":["frozen inventory requirement IDs"],"status":"shown|tested|partly|not-shown|gap|waived","proof":PROOF,"more":[PROOF],"caveat":"optional limit specific to this line","files":["exact changed files that implement it"]}],"yourCall":[{"question":"...?","context":"the facts a person needs","bobChose":"what was built and why","proof":PROOF}],"beyondAsk":[{"what":"...","why":"...","attention":"none|low|look","files":["..."]}],"notVerified":[{"what":"...","why":"..."}],"noticed":["pre-existing problem seen but not changed"],"hygiene":[{"text":"satisfied process criterion, e.g. No generated code committed","covers":["inventory IDs"]}]}. Add "system" only as described below.\nPROOF is exactly one of:\n{"kind":"screens","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}],"note":"optional"}: focus crops the image, in percent, to the pixels that prove the claim (open the image to choose it). Prefer pairs varying only the condition under test (English vs German, setting A vs B, before vs after).\n{"kind":"video","taskId":"...","sha256":"...","label":"..."}: from the accepted video inventory.\n{"kind":"table","method":"how it was observed","columns":["Given","Observed"],"rows":[{"cells":["...","..."],"mark":"good|bad|neutral"}]}: quote actual observed values (rendered text, HTTP status, payload fields) from QA receipts. Use it as a decision table for business rules, marking where a rule does nothing as bad.\n{"kind":"code","file":"repository-relative path","excerpt":"at most 25 lines of the real diff, +/- prefixed","note":"why this proves it"}\n{"kind":"test","file":"...","excerpt":"test names or the key assertion","result":"what passed"}\n{"kind":"command","command":"...","output":"trimmed real output","note":"optional"}\n{"kind":"steps","steps":[{"label":"...","detail":"...","change":"new|changed|manual"}]}: only when the requirement IS a linear sequence.\n{"kind":"flowRef","flow":"flow-id","steps":[1,2],"note":"..."}: points at steps of a system flow.\nRules:\n- Status describes the proof honestly: shown = a human-visible observation at this revision proves it; tested = only automated tests prove it; partly = some cases proven and the caveat names what is not; not-shown = no evidence; gap = not met; waived = deliberately skipped by an accepted decision. A passed label, an implementation receipt or source reading alone is not proof.\n- Every proof is judgeable in about 30 seconds without opening a file. Observed values beat descriptions. Never invent values; take them from executed receipts.\n- Screenshots appear only as proof of one claim or one decision, each with a label and a focus crop. No galleries, no decorative images, no repeats.\n- interpretation lists every place the ask had to become a concrete decision: added or narrowed scope, UX choices, defaults, migration behavior. decidedBy is bob whenever no human answer or ticket text made the call, including delegated choices; these are where results quietly diverge from requests.\n- yourCall holds only what a person must judge: taste, trade-offs, consequences for users, security or compatibility decisions, wording. Ask each as a question and say what Bob chose. Use 0-4 items; an empty list is right for mechanical changes. Never ask the reviewer to redo QA.\n- Group the inventory into 1-12 lines a person would check separately. Every active inventory requirement appears in requirements[].covers, or in hygiene[].covers for process criteria (generated files, branch continuity, changelog policy, tracker state). Every file in /progress/reviewScope/files appears in a requirement line or a beyondAsk item.\n- beyondAsk lists behavior and code no requirement asked for: refactors, shared code affecting other features, dependency, configuration and migration changes, behavior changes for existing users. Read the diff for changed defaults, removed fallbacks, widened permissions and new public endpoints. Use attention look when it can affect users or other code paths.\n- notVerified states up to 4 product-relevant evidence limits (real services replaced by fixtures, untested environments or devices). noticed lists pre-existing problems you saw but did not change.\n- Pipeline process (CI retries, PR selection, tracker synchronization, earlier rounds, reviewer tooling) is not review content; put anything a person must know into one hygiene line. The runtime shows PR, revision, CI and diff statistics.\n- No local absolute paths, commit SHAs, QA story or criterion IDs, receipt filenames or exit codes in prose. Repository-relative paths belong in files and proof file fields only.\n- Length follows the change: a few-file fix fits on one screen. Do not pad.\n- readiness is not-ready when any line is a gap or required QA failed or is blocked; ready-with-caveats when a yourCall item or a partly line needs attention; otherwise ready.\nAdd "system":{"summary":"2-3 plain sentences on how the pieces work together, for a product owner","flows":[FLOW],"touches":[TOUCH],"interfaces":[]} ONLY when the change alters how components interact, what data is stored, or where the trust boundary sits. FLOW is {"id":"kebab-id","title":"plain name of what happens, e.g. Saving your format","trigger":"plain: what starts it","implements":["requirement ids"],"participants":[{"id":"kebab-id","icon":"one emoji","label":"plain short name (<=40), e.g. Account page, Server, Database","detail":"real component or module"}],"steps":[{"from":"participant id","to":"participant id","label":"one plain sentence of what happens (<=140)","detail":"the real endpoint, event, query or call","change":"new|changed","dashed":true,"outcome":"good|bad","code":{"file":"exact changed file","match":"text copied verbatim from one added or removed line of that file\'s diff"}}],"before":[steps for the same trigger before this PR, only when an existing flow changed],"beforeNote":"plain: what went wrong or worked differently before (<=240)","note":"optional"}. TOUCH is {"mark":"new|changed|removed|risk|same","what":"plain (<=80)","say":"what it means for people or other systems (<=200)","tech":"optional real endpoint, field or setting"}.\nFlows are sequence diagrams read top to bottom: one per real trigger, 2-5 participants, at most 8 steps, usually 1-3 flows including the main user action. Unmarked steps already worked this way; dashed marks steps outside the product\'s control; outcome bad marks where something is refused or went wrong. Give the steps a reviewer would want to see in code a code link. touches lists 2-8 places the change reaches the rest of the system: endpoints, stored data, dependencies, configuration, and behavior changes for existing users, marked risk. Leave interfaces empty. Never draw box-and-arrow maps.\nAfter a human review, add "sinceLastReview":{"previousHeadSha":"the reviewed revision","summary":"...","changes":[{"what":"what changed in response","files":["..."]}]} and keep the whole brief current. Do not modify product code, recapture screenshots, rerun implementation or merge.\nThen add "story": the show & tell a colleague gives in person, in about three minutes, without showing code. The reviewer sees it first; the brief fields above stay the checkable evidence behind it.\n"story":{"title":"what you did, first person (<=110), e.g. I hardened the WAGO integration for production.","summary":"the short version in one or two plain sentences (<=320)","stats":[{"value":"e.g. 6 / 7","label":"e.g. things you asked for, done"}],"slides":[SLIDE]}\nSLIDE is exactly one of:\n{"kind":"checklist","title":"...","say":"...","items":[{"state":"done|partly|open","label":"one thing that was asked (<=70)","detail":"where it landed (<=140)"}]}: the ask split into the separate things the person wanted, each with where it landed. Usually the first slide.\n{"kind":"beforeAfter","title":"...","say":"...","before":[NODE],"after":[NODE],"note":"optional"}: the core behavior change as two short step-by-step pipelines of what happens. NODE is {"label":"<=40","detail":"optional <=60","change":"new|changed (after only)","fallout":"optional <=60: what happens when this step says no"}. Name steps by what they do, never by class or function names. Use before:[{"label":"Nothing"}] for brand-new behavior.\n{"kind":"chart","title":"...","say":"...","method":"how it was measured (<=200)","scale":"linear|log","bars":[{"label":"<=60","value":positive number,"display":"printed value, e.g. 7,200 or 3.3 s","detail":"optional <=60","mark":"good|bad|neutral"}],"stats":[STAT]}: measured numbers from executed receipts only, such as load, timings, sizes or counts. Use log when values span more than 100x.\n{"kind":"screens","title":"...","say":"...","shots":[{"area":"exact capture area","state":"exact capture state","label":"what to look at","focus":{"x":0,"y":0,"w":100,"h":100}}]}: one or two accepted screenshots that show the result.\n{"kind":"video","title":"...","say":"...","taskId":"...","sha256":"...","label":"..."}: an accepted video, only when motion or sequence is the point.\n{"kind":"points","title":"...","say":"...","items":[{"icon":"one emoji","title":"<=70","detail":"optional <=160"}]}: a few notable things that fit no other slide.\nStory rules:\n- Speak as Bob to the reviewer, first person, the way you would explain it at their desk: short sentences, everyday words, one idea per slide. title is the point of the slide (<=90); say is what you would add out loud (<=240). No code, file paths, class or function names, IDs or jargon a product owner would not use; when the reviewer must know a technical term, say what it means.\n- 2-6 slides in this order: what was asked and where each part landed, what changed (core behavior first), how we know it works, then anything else worth seeing. A small fix can be one beforeAfter slide and one proof slide.\n- Never repeat yourCall, notVerified or beyondAsk in slides: the reader presents them as their own slides after yours and ends with the decision. Because they appear in the show & tell, write them in the same plain voice: say what changes for people and what is at stake, not internal mechanics.\n- Be concrete: put the actual limits, counts and timings that changed into slide details (e.g. "at most 8 KB", "26 ms"), not "checks vary".\n- Every story screenshot sets focus to the pixels that matter (open the image to choose it), so it stays readable on a phone; prefer a pair that differs only in the condition shown.\n- A chart compares 2-8 different stages, conditions or cases measured the same way, so the bars differ meaningfully. Never chart a total against itself or offered against confirmed; headline totals belong in stats.\n- Translate technical terms into what a person experiences: "names longer than 128 characters or containing / or #" rather than "identifiers over 128 code units or containing MQTT wildcards"; "a generic error that does not say which version failed" rather than "revision 0 and an empty hash".\n- Every number, screenshot and claim comes from the evidence above; the story may simplify wording, never facts. stats holds 0-3 headline numbers a person remembers.\nThen add "tour": the code walkthrough under "Dig deeper", like a colleague scrolling through the diff with you. "tour":[{"file":"exact changed file","say":"one plain sentence: what this file now does or what changed in it (<=200)","key":true,"flag":"optional short reason to look (<=40), e.g. Changes sign-out everywhere","pins":[{"match":"text copied verbatim from one added or removed line of this file\'s diff","say":"plain note shown under that line (<=200)","flag":true}],"related":["tests, translations and small wiring that only serve this file"],"same":["files with the same mechanical change"]}]\nTour rules:\n- Order entries the way you would show them: the core rule or data first, then server, then screens, then wiring. key marks the 3-8 files that carry the change; they start open.\n- Every file in /progress/reviewScope/files appears exactly once in the tour: as file, in related or in same. Put each test under the file it tests and group repeated mechanical edits with same.\n- pins point at the 0-3 lines per file a reviewer must not miss: guards, defaults, removed behavior, security decisions. match is unique text from a single + or - line of the actual diff. flag what changes behavior for existing users or belongs to a yourCall or beyondAsk item worth a look.\n- Write say in the story\'s plain voice: what it does for people, no class or function names unless the reviewer must know them.\nWrite the evidence plainly too, as Dig deeper shows it:\n- requirements[].text is the outcome in plain words, and requirements[].how says in one plain sentence how it was checked (<=160), e.g. "Clicked through the German account page and compared the preview".\n- Every table proof row adds "plain":{"tried":"what was done (<=140)","saw":"what happened, keeping the key values (<=200)"}; cells keep the exact recorded values.\n- interpretation chosen and alternatives use words a product owner would use; note says why when it is not obvious. Keep at most 10 interpretation entries (the most consequential) and every hygiene text within 200 characters.{{instruction:video-brief}}{{instruction:impact-guide}}',
		json: true,
		askQuestions: false,
	},
	handoff: {
		id: "handoff",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			implementation: "implement",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			impact: "assess-impact",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"qa-evidence",
			{
				check: "media-valid",
				adapter: "qa-gate",
				video: true,
			},
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Verify revision and hand off",
		next: "human-review",
		branches: [
			{
				when: {
					path: "impactRequired",
					equals: true,
				},
				next: "assess-impact",
			},
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
		tool: "handoff",
		args: [],
	},
	"human-review": {
		id: "human-review",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			implementation: "implement",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
				next: "assess-impact",
			},
		],
		maxVisits: 200,
		type: "tool",
		tool: "human-review",
		view: nativeViewPreset("review"),
		args: [],
	},
	"human-fix": {
		id: "human-fix",
		configVersion: "step-config-v1",
		reads: {
			publication: "draft-pr",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "json-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "push",
		},
		instructions: [],
		name: "Address human feedback",
		next: "assess-impact",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Address the latest human rejection/follow-up instructions in humanDecisions and human-review, preserving the accepted plan, decisions and all past review findings. Commit and push to the existing PR. Return {"summary":"what changed","checks":["commands and outcomes"]}. Do not merge, mark ready or assume approval.',
		json: true,
		askQuestions: false,
	},
	merge: {
		id: "merge",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			implementation: "implement",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Merge approved revision",
		next: "end",
		branches: [
			{
				when: {
					path: "rework",
					equals: true,
				},
				next: "assess-impact",
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
	"delivery-feedback-route": {
		id: "delivery-feedback-route",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
			"delivery-evidence",
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
		type: "check",
		check: {
			results: {
				mode: {
					select: "/evidence/delivery-evidence/mode",
				},
				repositoryComplete: {
					path: "/evidence/delivery-evidence/repositoryComplete",
					equals: true,
				},
			},
			passed: {
				path: "/evidence/delivery-evidence/mode",
				exists: true,
			},
		},
	},
	"delivery-route-accept": {
		id: "delivery-route-accept",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Accept reviewed delivery contract",
		next: "delivery-route",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "accept-delivery",
		args: [],
	},
	"delivery-route": {
		id: "delivery-route",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			accepted: "delivery-route-accept",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
		type: "check",
		check: {
			results: {
				deferred: {
					path: "/inputs/accepted/deferred",
					equals: true,
				},
				mode: {
					select: "/inputs/accepted/mode",
				},
			},
			passed: {
				path: "/results/deferred",
				equals: false,
			},
		},
	},
	"delivery-deferred": {
		id: "delivery-deferred",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "json-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Resolve execution deferral",
		next: "plan",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			"The accepted delivery contract defers execution. Do not mutate tickets or files. Ask whether the named external/repository task should remain deferred or may proceed. Return questions while the deferral remains. Read answers; only explicit authorization may return questions:[], then the planner and plan reviewer renew the contract. Never infer execution permission from scope answers.",
		json: true,
		askQuestions: true,
		view: nativeViewPreset("ask"),
	},
	"external-apply": {
		id: "external-apply",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Apply authorized ticket changes",
		next: "external-verify",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "external-apply",
		args: [],
	},
	"external-verify": {
		id: "external-verify",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Independently verify ticket state",
		next: "external-after-verify",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "external-verify",
		args: [],
	},
	"external-after-verify": {
		id: "external-after-verify",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
			"delivery-evidence",
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
		type: "check",
		check: {
			results: {
				mode: {
					select: "/evidence/delivery-evidence/mode",
				},
				repositoryComplete: {
					path: "/evidence/delivery-evidence/repositoryComplete",
					equals: true,
				},
			},
			passed: {
				path: "/evidence/delivery-evidence/mode",
				exists: true,
			},
		},
	},
	"external-guide": {
		id: "external-guide",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			clarify: "clarify",
			plan: "plan",
			implementation: "implement",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Prepare external review",
		next: "external-human-review",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "external-guide",
		args: [],
	},
	"external-human-review": {
		id: "external-human-review",
		configVersion: "step-config-v1",
		reads: {
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
			qaReview: "visual-review",
			capture: "capture",
			scope: "visual-scope",
			qaGate: "visual-gate",
			external: "@decisions",
			implementation: "implement",
			impact: "assess-impact",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			"impact-boundary",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
		view: nativeViewPreset("external-review"),
		args: [],
		arguments: {
			externalReview: true,
		},
	},
	"external-correction": {
		id: "external-correction",
		configVersion: "step-config-v1",
		reads: {
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "json-v1",
		},
		rules: [],
		checks: [
			"architecture-revision",
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
	"external-final": {
		id: "external-final",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
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
	"external-reverify": {
		id: "external-reverify",
		configVersion: "step-config-v1",
		reads: {
			review: "plan-review",
			clarify: "clarify",
			planReview: "plan-review",
			plan: "plan",
			scopeClarify: "clarify",
			scopeDecisions: "decisions",
			scopePlan: "plan",
			scopeSource: "@source",
			scopeTicket: "@ticket",
			draftPr: "draft-pr",
			ci: "ci",
			guide: "guide",
			reviewGate: "review-gate",
			handoff: "handoff",
			merge: "merge",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Verify changed external state",
		next: "external-guide",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "external-verify",
		args: [],
	},
};

/** Takeover inspection roles, before entering the shared factory work. */
export const stockTakeoverSteps: Record<string, WorkflowStep> = {
	"existing-work": {
		id: "existing-work",
		configVersion: "step-config-v1",
		reads: {
			scopeExistingWork: "existing-work",
			scopeAssessment: "assess-existing",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Inspect existing work and discussion",
		branches: [],
		maxVisits: 200,
		type: "tool",
		tool: "inspect-existing",
		args: [],
	},
	"assess-existing": {
		id: "assess-existing",
		configVersion: "step-config-v1",
		reads: {
			scopeExistingWork: "existing-work",
			scopeAssessment: "assess-existing",
			scopeSource: "@source",
			scopeTicket: "@ticket",
		},
		output: {
			format: "json-v1",
		},
		rules: [],
		checks: [
			{
				check: "scope-inputs",
				sources: {
					clarify: "scopeClarify",
					decisions: "scopeDecisions",
					plan: "scopePlan",
					"existing-work": "scopeExistingWork",
					"assess-existing": "scopeAssessment",
					source: "scopeSource",
					ticket: "scopeTicket",
				},
			},
		],
		access: {
			mode: "workspace",
		},
		instructions: [],
		name: "Assess completed and remaining work",
		branches: [],
		maxVisits: 16,
		type: "agent",
		prompt:
			'Inspect the existing worktree, diff, ticket/PR discussion and review feedback. Do not discard or rewrite completed work. Return {"completed":["..."],"remaining":["..."],"risks":["..."],"assets":["..."]}. Identify unresolved feedback and questions to carry into clarification/planning. Do not implement or modify code.',
		json: true,
		askQuestions: false,
	},
};

/** Launch metadata without graph definitions. */
export const stockWorkflowMetadata: Record<string, Omit<Workflow, "steps">> = {
	simple: {
		id: "simple",
		stepConfigVersion: "step-config-v1",
		name: "Simple / Bob’s Factory",
		icon: "⚡",
		description:
			"The existing Bob’s Factory run, with its original prompts, skills and runner lifecycle.",
		labels: ["workflow:simple"],
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
	factory: {
		id: "factory",
		stepConfigVersion: "step-config-v1",
		name: "Software factory",
		icon: "🏭",
		description:
			"Clarify and plan, then review architecture before coding and deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: ["workflow:factory", "factory"],
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
	takeover: {
		id: "takeover",
		stepConfigVersion: "step-config-v1",
		name: "Take over existing work",
		icon: "🤝",
		description:
			"Inspect an existing PR or ticket, clarify remaining work, then continue through the shared factory pipeline. Existing PRs stay draft for human review.",
		labels: ["workflow:takeover", "takeover"],
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
	"factory-pipeline": {
		id: "factory-pipeline",
		stepConfigVersion: "step-config-v1",
		name: "Shared factory pipeline",
		icon: "🏭",
		description:
			"Clarify and plan, then review architecture before coding and deliver repository, external ticket or mixed work with independent evidence and explicit human acceptance.",
		labels: [],
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
};
