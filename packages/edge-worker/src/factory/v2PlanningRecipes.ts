import {
	DISPLAY_COMPONENTS,
	DISPLAY_CONTRACT,
	displayContractRule,
} from "./DisplayDocument.js";

// Recipe-owned data contracts. Nodes and the dashboard do not interpret these fields.
const text = { type: "string", minLength: 1 };
const strings = { type: "array", items: text };
const list = (items: object) => ({ type: "array", items });
const object = (
	properties: Record<string, unknown>,
	required = Object.keys(properties),
) => ({
	type: "object",
	properties,
	required,
});
// The display node performs full component validation after resolution. Keep the
// embedded envelope within the bounded inline-schema budget.
const displaySchema = object({
	version: { const: "view-v1" },
	components: {
		type: "array",
		minItems: 1,
		maxItems: 40,
		items: object({
			id: text,
			type: { enum: [...DISPLAY_COMPONENTS] },
			data: { type: "object" },
		}),
	},
});
const requirementsSchema = object({
	summary: text,
	requirements: list(object({ id: text, text, source: text }, ["id", "text"])),
	decisions: list(object({ id: text, question: text, answer: text })),
	outOfScope: strings,
});
const planSchema = object({
	summary: text,
	deliveryMode: { enum: ["repository", "external", "mixed", "deferred"] },
	steps: list(object({ id: text, text, requirementRefs: strings })),
	risks: strings,
	repositories: strings,
});
const reviewSchema = object({
	approved: { type: "boolean" },
	feedback: strings,
});
const architectureSchema = object({
	meaningful: { type: "boolean" },
	accepted: { type: "boolean" },
	decisions: list(object({ id: text, text })),
});
const changeSchema = object({
	summary: text,
	repositories: list(object({ id: text, head: text })),
});
const prSchema = object({
	repositories: list(
		object({ id: text, head: text, url: text, isDraft: { type: "boolean" } }),
	),
});
const sourceReads = {
	source: "@source",
	ticket: "@ticket",
	repositories: "@repository",
};
const metadata = {
	engineVersion: "nodes-v1",
	internal: true,
	allowedTriggers: ["workflow", "manual"],
};
const launchFields = (ports: string[]) => [
	{
		name: "prompt",
		type: "textarea",
		label: "What should this recipe do?",
		required: true,
	},
	...ports.map((name) => ({
		name,
		type: "textarea",
		label: `${name} (JSON)`,
		required: true,
	})),
];

const clarifyPlan = {
	...metadata,
	id: "v2-clarify-plan",
	name: "Clarify & plan (nodes)",
	description:
		"Clarify the request, retain accepted decisions and independently review a self-contained plan.",
	inputs: ["requirements", "architecture"],
	outcomes: ["completed"],
	launchFields: launchFields(["requirements", "architecture"]).map((field) => ({
		...field,
		required: field.name === "prompt",
	})),
	steps: [
		{
			id: "clarify",
			name: "Clarify",
			type: "agent",
			session: "resume",
			access: "read-only",
			reads: {
				...sourceReads,
				answer: "questions",
				previous: "decisions",
				priorRequirements: "requirements",
				revision: "architecture",
			},
			output: {
				schema: {
					...requirementsSchema,
					properties: {
						...requirementsSchema.properties,
						status: { enum: ["ready", "needs-input"] },
						display: displaySchema,
					},
					required: [...requirementsSchema.required, "status"],
					anyOf: [
						{ properties: { status: { const: "ready" } } },
						{ properties: { display: {} }, required: ["display"] },
					],
				},
			},
			prompt: `Read the launch request, ALL ticket comments, metadata, assets, previous answers and decisions. For replanning, retain priorRequirements and reconcile revision.planChanges and revision.approval feedback with the accepted scope; an unaccepted proposal alone cannot authorize new requirements. Ask only questions that materially affect implementation. Never assume an answer or implement anything. Preserve complete requirements, exclusions and accepted decisions across rounds, with stable IDs and actual sources. If work is backlog/planning only or implementation is forbidden, scope answers alone do not authorize execution: clarify whether to proceed now or retain the restriction. Preserve an explicit continuing deferral for the plan's deliveryMode.
Return status=needs-input with a display document when an answer is needed; otherwise status=ready. The display uses version=view-v1 and freely arranged generic components with data.literal (markdown, form, actions, etc.). Forms support text, textarea, choice/select with options [{id,label,reason?}], required fields and recommendation:{answer,reason}. Recommendations need evidence; defaults never submit themselves. Include a submit action. Read answer.values and answer.comments on resumption, record the accepted answer in decisions [{id,question,answer}], and retain all earlier decisions. Return summary, requirements [{id,text,source?}], decisions and outOfScope even while asking. Delivery is repository (including repository docs/config), external (ticket content/relationships), mixed, or deferred; never infer it from an empty diff or ask to authorize unrelated repository work for an external task. Runtime tracking owns lifecycle and PR links.

${DISPLAY_CONTRACT}`,
			rules: [displayContractRule()],
			next: "needs-input",
		},
		{
			id: "needs-input",
			name: "Needs answers?",
			type: "check",
			reads: { result: "clarify" },
			check: {
				results: {
					needed: { path: "/inputs/result/status", equals: "needs-input" },
				},
			},
			branches: [{ when: { path: "needed", equals: true }, next: "questions" }],
			next: "decisions",
		},
		{
			id: "questions",
			name: "Clarify with you",
			type: "display",
			reads: { clarify: "clarify" },
			from: "/inputs/clarify/display",
			next: "clarify",
		},
		{
			id: "decisions",
			name: "Record accepted answers",
			type: "transform",
			reads: { clarified: "clarify" },
			transform: {
				summary: { select: "/inputs/clarified/summary" },
				requirements: { select: "/inputs/clarified/requirements" },
				decisions: { select: "/inputs/clarified/decisions" },
				outOfScope: { select: "/inputs/clarified/outOfScope" },
			},
			output: { schema: requirementsSchema },
			next: "plan",
		},
		{
			id: "plan",
			name: "Plan",
			type: "agent",
			access: "read-only",
			session: "resume",
			reads: {
				...sourceReads,
				requirements: "decisions",
				feedback: "plan-review",
				revision: "architecture",
			},
			instructions: ["implementation-scope", "ticket-plan"],
			output: { schema: planSchema },
			prompt: `Write a lean, COMPLETE self-contained implementation plan from ALL request/comments/metadata, assets, clarified requirements, accepted decisions and reviewer feedback. When supplied, reconcile revision.planChanges and revision.approval feedback with those requirements; preserve settled decisions and do not treat the proposal itself as authorization. Preserve completed work and an existing PR/branch when present; plan only the remaining changes. The implementer must be able to work from this result alone. Return summary, deliveryMode (repository|external|mixed|deferred), steps [{id,text,requirementRefs}], risks and repositories (configured IDs). Each step's text includes observable behavior, necessary file/dependency estimates, assets, acceptance criteria and proportionate validation. Preserve every requirement including external/hardware/independent checks; state what remains unproved. Include repository/base branch and delivery targets, explicit non-goals and execution restrictions. External/mixed work needs verified target identities, complete before-state, authorized operations, preserved relationships and measurable expected after-state; do not apply external edits. Missing authorization remains deferred. Do not infer authority from an empty diff. Do not implement.`,
			next: "plan-review",
		},
		{
			id: "plan-review",
			name: "Review plan",
			type: "agent",
			access: "read-only",
			reads: { ...sourceReads, requirements: "decisions", plan: "plan" },
			instructions: ["implementation-scope"],
			output: { schema: reviewSchema },
			prompt: `Review the complete plan against ALL request/comments/metadata and accepted decisions. Trace every requirement and exclusion, inspect repository conventions, delivery mode/targets, execution authorization, complete external baselines/operations/criteria when relevant, assets and validation. Reject hidden extras or invented approval gates for routine dependency edits within the accepted requirements and architecture. Approve a practical MVP when complete. Return approved and specific feedback; do not implement or invent human acceptance.`,
			next: "plan-approved",
		},
		{
			id: "plan-approved",
			name: "Plan approved?",
			type: "check",
			reads: { review: "plan-review" },
			check: {
				results: {
					approved: { path: "/inputs/review/approved", equals: true },
				},
			},
			branches: [{ when: { path: "approved", equals: true }, next: "output" }],
			next: "plan",
		},
		{
			id: "output",
			name: "Requirements and plan",
			type: "transform",
			reads: { requirements: "decisions", plan: "plan" },
			transform: {
				requirements: { select: "/inputs/requirements" },
				plan: { select: "/inputs/plan" },
			},
			output: {
				schema: object({ requirements: requirementsSchema, plan: planSchema }),
			},
			next: "end",
		},
	],
};

const checkIn = {
	...metadata,
	id: "v2-check-in",
	name: "Check in with you (nodes)",
	description:
		"Skip routine work, or independently review and ask you to accept a proposal bound to the current plan.",
	inputs: ["requirements", "plan"],
	outcomes: ["completed", "revise-plan"],
	launchFields: launchFields(["requirements", "plan"]),
	steps: [
		// A local receipt makes ordinary standalone JSON input bindable without claiming caller provenance.
		{
			id: "plan-input",
			name: "Current plan",
			type: "transform",
			reads: { plan: "plan" },
			transform: { value: { select: "/inputs/plan" } },
			output: { schema: object({ value: planSchema }) },
			next: "feedback",
		},
		// Freeze feedback before drafting: a new response must not invalidate its own proposal's reads.
		{
			id: "feedback",
			name: "Previous feedback",
			type: "transform",
			reads: {
				answer: "acceptance",
				review: "architecture-review",
				gate: "accepted",
			},
			transform: {
				answer: { select: "/inputs/answer" },
				review: { select: "/inputs/review" },
				gate: { select: "/inputs/gate" },
			},
			next: "architecture",
		},
		{
			id: "architecture",
			name: "Architecture",
			type: "agent",
			session: "resume",
			access: "read-only",
			reads: {
				...sourceReads,
				requirements: "requirements",
				plan: "plan-input/value",
				feedback: "feedback",
			},
			instructions: ["implementation-scope"],
			output: {
				schema: {
					...object(
						{
							meaningful: { type: "boolean" },
							rationale: text,
							display: displaySchema,
							decisions: list(object({ id: text, text })),
							planChanges: planSchema,
						},
						["meaningful", "rationale", "decisions"],
					),
					anyOf: [
						{ properties: { meaningful: { const: false } } },
						{ properties: { display: {} }, required: ["display"] },
						{ properties: { planChanges: {} }, required: ["planChanges"] },
					],
				},
			},
			prompt: `Before building, check the plan with the human like a colleague asking for two minutes before starting. Inspect actual module boundaries, conventions and callers, all requirements/comments/answers/decisions and the complete plan. Propose the smallest adequate design. Do not implement or invent human acceptance. Return meaningful=false with a concrete rationale for routine unsplit work using established patterns; meaningful responsibilities, boundaries, interfaces, operating/security limits or trade-offs need a check-in.
Once feedback.answer exists, a fresh human acceptance is required even if the revised work is routine: always include a display for renewed acceptance (unless returning planChanges). For meaningful work return display as a version=view-v1 document with freely arranged generic components (data.literal, unique IDs). Write about two minutes of first-person everyday prose (about 350 words), leading with the human's goal and what done looks like. Show observable before/after scenes, who notices (including upgrades/configuration/breakage), the least certain human judgment calls with honest alternatives, size and a useful split if any. Use markdown, beforeAfter, points, sections, tables or other generic components as useful; technical notes may be collapsed. No paths/classes/jargon in the human overview. Preserve every acceptance criterion, honest covered/partial/deferred scope, non-goals, measurable checks and concrete risks; do not claim future physical or independent tests passed. Ground technical notes in inspected repository evidence; no invented files, hidden deliverables, unnecessary UI/packages or arbitrary measured limits.
Include itemCards for judgment points with comment:true and required:false so per-point comments are optional; use no item actions when only comments are needed. Include exactly one actions component with actions [{id:"accept",label:"Accept"},{id:"request-changes",label:"Request changes"}] and a form textarea id=feedback for general feedback. There are no fixed sections or preset. Keep settled choices, exclusions and existing work. Return decisions [{id,text}] as complete design decisions. Read feedback.answer.values, feedback.answer.comments and independent feedback.review on repeats; explain plainly what changed in response to each note. An earlier acceptance cannot authorize materially changed requirements, interfaces, limits or delivery targets. If the plan itself must change, return planChanges as the complete proposed plan (same port schema), explaining why; this returns revise-plan for independent replanning, never silently changes scope.

${DISPLAY_CONTRACT}`,
			rules: [displayContractRule()],
			next: "meaningful",
		},
		{
			id: "meaningful",
			name: "Meaningful?",
			type: "check",
			reads: { proposal: "architecture", feedback: "feedback" },
			check: {
				results: {
					needsAcceptance: {
						any: [
							{ path: "/inputs/proposal/meaningful", equals: true },
							{ path: "/inputs/feedback/answer/action", exists: true },
						],
					},
					revisePlan: { path: "/inputs/proposal/planChanges", exists: true },
				},
			},
			branches: [
				{ when: { path: "revisePlan", equals: true }, next: "result" },
				{
					when: { path: "needsAcceptance", equals: true },
					next: "architecture-review",
				},
			],
			next: "result",
		},
		{
			id: "architecture-review",
			name: "Review architecture",
			type: "agent",
			access: "read-only",
			reads: {
				...sourceReads,
				requirements: "requirements",
				plan: "plan-input/value",
				proposal: "architecture",
			},
			instructions: ["implementation-scope"],
			output: { schema: reviewSchema },
			prompt: `Independently check the whole proposal against the plan, requirements, exclusions, repository evidence and all comments/decisions. Require an honest short human-readable goal, approach, observable before/after, consequences, size and human judgment calls with alternatives. Reject hidden work/conditional changes, missing criteria, unsupported coverage, arbitrary measurements or process status posing as risk. Choices settled by evidence are not new human blockers; meaningful open choices cannot be hidden. Confirm the display has Accept (accept) and Request changes (request-changes), optional per-point itemCards comments with required:false and a feedback textarea; the arrangement is the author's choice. Do not implement or accept for the human. Return approved and concrete feedback.`,
			next: "architecture-approved",
		},
		{
			id: "architecture-approved",
			name: "Proposal approved?",
			type: "check",
			reads: { review: "architecture-review" },
			check: {
				results: {
					approved: { path: "/inputs/review/approved", equals: true },
				},
			},
			branches: [
				{ when: { path: "approved", equals: true }, next: "acceptance" },
			],
			next: "plan-input",
		},
		{
			id: "acceptance",
			name: "Check in with you",
			type: "display",
			reads: { architecture: "architecture", plan: "plan-input/value" },
			from: "/inputs/architecture/display",
			bind: ["plan-input", "architecture"],
			next: "accepted",
		},
		{
			id: "accepted",
			name: "Accepted current proposal?",
			type: "check",
			reads: { answer: "acceptance" },
			check: {
				results: {
					accepted: {
						all: [
							{ path: "/inputs/answer/action", equals: "accept" },
							{ fresh: "acceptance" },
						],
					},
				},
			},
			branches: [{ when: { path: "accepted", equals: true }, next: "result" }],
			next: "plan-input",
		},
		{
			id: "result",
			name: "Architecture result",
			type: "transform",
			reads: {
				proposal: "architecture",
				approval: "acceptance",
				gate: "accepted",
			},
			transform: {
				meaningful: { select: "/inputs/proposal/meaningful" },
				accepted: {
					all: [
						{ path: "/inputs/gate/accepted", equals: true },
						{ not: { path: "/inputs/proposal/planChanges", exists: true } },
					],
				},
				decisions: { select: "/inputs/proposal/decisions" },
				approval: { select: "/inputs/approval" },
				planChanges: { select: "/inputs/proposal/planChanges" },
			},
			next: "output",
		},
		{
			id: "output",
			name: "Architecture port",
			type: "transform",
			reads: { result: "result" },
			transform: { architecture: { select: "/inputs/result" } },
			output: { schema: object({ architecture: architectureSchema }) },
			next: "outcome",
		},
		{
			id: "outcome",
			name: "Plan revision needed?",
			type: "check",
			reads: { proposal: "architecture" },
			check: {
				results: {
					revisePlan: { path: "/inputs/proposal/planChanges", exists: true },
				},
			},
			branches: [
				{ when: { path: "revisePlan", equals: true }, next: "revise-plan" },
			],
			next: "end",
		},
	],
};

const implementation = {
	...metadata,
	id: "v2-implementation",
	name: "Implement (nodes)",
	description:
		"Implement the accepted plan, commit and push, and ensure a draft PR with durable generic IO nodes.",
	inputs: ["requirements", "plan", "architecture"],
	outcomes: ["completed", "to-architecture"],
	launchFields: launchFields(["requirements", "plan", "architecture"]),
	steps: [
		{
			id: "implement",
			name: "Implement",
			type: "agent",
			session: "resume",
			access: "push",
			reads: {
				requirements: "requirements",
				plan: "plan",
				architecture: "architecture",
				repositories: "@repository",
				answer: "questions",
				emptyAnswer: "empty-answer",
			},
			instructions: ["implementation-scope"],
			output: {
				schema: {
					...object(
						{
							status: { enum: ["completed", "needs-input", "blocked"] },
							title: { ...text, maxLength: 100 },
							summary: text,
							checks: strings,
							architectureRevision: { type: "boolean" },
							display: displaySchema,
						},
						["status", "summary", "checks", "architectureRevision"],
					),
					anyOf: [
						{
							properties: {
								status: { const: "completed" },
								architectureRevision: { const: false },
								title: {},
							},
							required: ["title"],
						},
						{
							properties: { status: { const: "needs-input" }, display: {} },
							required: ["display"],
						},
						{ properties: { architectureRevision: { const: true } } },
					],
				},
			},
			prompt: `Implement the complete provided plan and its assets; read answer for subsequent human responses and blockers. Follow repository conventions and proportionate verification. Preserve explicit restrictions and completed work. If execution is deferred/forbidden or missing access/a necessary decision blocks work, return status=needs-input with a display document (generic form fields/actions, version=view-v1) asking for the concrete assistance; never report unfinished work completed. Resume with the submitted answer. If steering materially changes the accepted architecture, preserve work and return status=blocked, architectureRevision=true and the concrete reason; do not implement the changed architecture under earlier acceptance. Otherwise complete the requirements and return status=completed, architectureRevision=false, a concise PR title (at most 100 characters), summary and checks (commands/outcomes and discovered paths/purposes). Leave changes in the worktree. The following Git/PR nodes own commit, push and PR publication; do not publish or merge yourself.

${DISPLAY_CONTRACT}`,
			rules: [displayContractRule()],
			next: "implementation-result",
		},
		{
			id: "implementation-result",
			name: "Implementation result",
			type: "check",
			reads: { result: "implement" },
			check: {
				results: {
					revision: {
						path: "/inputs/result/architectureRevision",
						equals: true,
					},
					needsInput: { path: "/inputs/result/status", equals: "needs-input" },
				},
			},
			branches: [
				{ when: { path: "revision", equals: true }, next: "revision-output" },
				{ when: { path: "needsInput", equals: true }, next: "questions" },
			],
			next: "metadata",
		},
		{
			id: "questions",
			name: "Implementation assistance",
			type: "display",
			reads: { result: "implement" },
			from: "/inputs/result/display",
			next: "implement",
		},
		{
			id: "revision-output",
			name: "Architecture revision needed",
			type: "transform",
			reads: { result: "implement" },
			transform: {
				summary: { select: "/inputs/result/summary" },
				architectureRevision: true,
			},
			next: "to-architecture",
		},
		{
			id: "metadata",
			name: "Publication text",
			type: "transform",
			reads: { plan: "plan", result: "implement" },
			transform: {
				message: { select: "/inputs/plan/summary" },
				title: { select: "/inputs/result/title" },
				body: { select: "/inputs/plan/summary" },
			},
			next: "commit",
		},
		{
			id: "commit",
			name: "Commit",
			type: "git",
			op: "commit",
			hooks: false,
			reads: { message: "metadata/message" },
			next: "implementation-diff",
		},
		{
			id: "implementation-diff",
			name: "Observe commits ahead of base",
			type: "git",
			op: "diff",
			mergeBase: true,
			next: "has-implementation",
		},
		{
			id: "has-implementation",
			name: "Require an implementation before publication",
			type: "check",
			reads: { diff: "implementation-diff" },
			check: {
				results: {
					implemented: {
						some: "/inputs/diff/repositories",
						require: {
							compare: { left: { path: "/commitsAhead" }, op: "gt", right: 0 },
						},
					},
				},
			},
			branches: [{ when: { path: "implemented", equals: true }, next: "push" }],
			next: "empty-answer",
		},
		{
			id: "empty-answer",
			name: "Implementation needs assistance",
			type: "display",
			document: {
				version: "view-v1",
				components: [
					{
						id: "reason",
						type: "markdown",
						data: {
							literal: {
								text: "No implementation commits are ahead of the base. Provide direction before continuing; unfinished work cannot be published.",
							},
						},
					},
					{
						id: "notes",
						type: "form",
						data: {
							literal: {
								fields: [
									{
										id: "notes",
										type: "textarea",
										label: "Direction or missing access",
									},
								],
							},
						},
					},
					{
						id: "actions",
						type: "actions",
						data: {
							literal: {
								actions: [{ id: "continue", label: "Continue implementation" }],
							},
						},
					},
				],
			},
			next: "implement",
		},
		{ id: "push", name: "Push", type: "git", op: "push", next: "pr" },
		{
			id: "pr",
			name: "Ensure draft PR",
			type: "pr",
			op: "ensure",
			reads: { title: "metadata/title", body: "metadata/body" },
			next: "change",
		},
		{
			id: "change",
			name: "Published change",
			type: "transform",
			reads: { result: "implement", push: "push" },
			transform: {
				summary: { select: "/inputs/result/summary" },
				repositories: {
					map: "/inputs/push/repositories",
					template: { id: { select: "/id" }, head: { select: "/head" } },
				},
			},
			next: "output",
		},
		{
			id: "output",
			name: "Change and PR",
			type: "transform",
			reads: { change: "change", pr: "pr" },
			transform: {
				change: { select: "/inputs/change" },
				pr: { select: "/inputs/pr" },
			},
			output: { schema: object({ change: changeSchema, pr: prSchema }) },
			next: "end",
		},
	],
};

// Materialize data-only recipes without shared object identities in inline schemas.
const recipes = [clarifyPlan, checkIn, implementation];
export const v2PlanningRecipes: typeof recipes = JSON.parse(
	JSON.stringify(recipes),
);
