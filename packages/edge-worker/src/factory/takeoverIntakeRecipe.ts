/* biome-ignore-all lint/suspicious/noThenProperty: Declarative JSON branches. */
// Recipe-owned data and prompts; the nodes know nothing about Takeover.
const text = { type: "string" };
const strings = { type: "array", items: text };
const object = (
	properties: Record<string, unknown>,
	required = Object.keys(properties),
) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const list = (properties: Record<string, unknown>, required?: string[]) => ({
	type: "array",
	items: object(properties, required),
});
// Expand shared schema fragments into plain JSON without shared object identities.
export const takeoverAssessmentSchema = JSON.parse(
	JSON.stringify(
		object({
			requirements: object({
				summary: text,
				requirements: list({ id: text, text, source: text }, ["id", "text"]),
				decisions: list({ id: text, question: text, answer: text }),
				outOfScope: strings,
			}),
			plan: object({
				summary: text,
				deliveryMode: { enum: ["repository", "external", "mixed", "deferred"] },
				steps: list({ id: text, text, requirementRefs: strings }),
				risks: strings,
				repositories: strings,
			}),
			completed: strings,
			remaining: strings,
			risks: strings,
			assets: strings,
		}),
	),
);

export const takeoverIntakeRecipe = {
	id: "v2-takeover-intake",
	name: "Takeover intake",
	internal: true,
	engineVersion: "nodes-v1",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual"],
	inputs: ["pr", "ticket"],
	outcomes: ["completed"],
	launchFields: [
		{
			name: "source",
			label: "Pull/merge request URL or ticket ID",
			type: "text",
			required: true,
		},
		{ name: "prompt", label: "Additional instructions", type: "textarea" },
	],
	steps: [
		{
			id: "targets",
			name: "Resolve declared sources",
			type: "transform",
			reads: {
				source: "@source",
				pr: "@callInputs/pr",
				ticket: "@callInputs/ticket",
				originatingTicket: "@ticket",
			},
			transform: {
				pr: {
					if: { path: "/inputs/pr", exists: true },
					then: { select: "/inputs/pr" },
					else: { select: "/inputs/source/request" },
				},
				hasTicket: {
					any: [
						{ path: "/inputs/ticket", exists: true },
						{ path: "/inputs/originatingTicket", exists: true },
					],
				},
				hasPr: {
					any: [
						{ path: "/inputs/pr", exists: true },
						{ path: "/inputs/source/request", exists: true },
					],
				},
			},
			next: "ticket-check",
		},
		{
			id: "ticket-check",
			name: "Check for a ticket",
			type: "check",
			reads: { targets: "targets" },
			check: {
				results: {
					available: { path: "/inputs/targets/hasTicket", equals: true },
				},
			},
			branches: [{ when: { path: "passed", equals: true }, next: "ticket" }],
			next: "pr-check",
		},
		{
			id: "ticket",
			name: "Read existing ticket and discussion",
			type: "ticket",
			op: "read",
			reads: { reference: "@callInputs/ticket" },
			next: "pr-check",
		},
		{
			id: "pr-check",
			name: "Check for an associated request",
			type: "check",
			reads: { targets: "targets" },
			check: {
				results: { available: { path: "/inputs/targets/hasPr", equals: true } },
			},
			branches: [{ when: { path: "passed", equals: true }, next: "pr" }],
			next: "diff",
		},
		{
			id: "pr",
			name: "Read existing request and feedback",
			type: "pr",
			op: "read",
			reads: { pr: "targets/pr" },
			next: "diff",
		},
		{
			id: "diff",
			name: "Compare existing work against the base",
			type: "git",
			op: "diff",
			mergeBase: true,
			reads: { from: "pr" },
			next: "status",
		},
		{
			id: "status",
			name: "Inspect working tree",
			type: "git",
			op: "status",
			next: "existing-work",
		},
		{
			id: "existing-work",
			name: "Assemble existing work",
			type: "transform",
			reads: {
				pr: "pr",
				ticket: "ticket",
				diff: "diff",
				status: "status",
				source: "@source",
				originalTicket: "@ticket",
				fields: "@launchInputs",
			},
			transform: {
				pr: { select: "/inputs/pr" },
				ticket: { select: "/inputs/ticket" },
				diff: { select: "/inputs/diff" },
				status: { select: "/inputs/status" },
				source: { select: "/inputs/source" },
				originalTicket: { select: "/inputs/originalTicket" },
				fields: { select: "/inputs/fields" },
			},
			next: "assess-existing",
		},
		{
			id: "assess-existing",
			name: "Assess completed and remaining work",
			type: "agent",
			access: "read-only",
			reads: { existingWork: "existing-work", repositories: "@repository" },
			output: { schema: takeoverAssessmentSchema },
			prompt:
				"Inspect /existingWork, the existing worktree, base-to-head diff, ticket/PR discussion and review feedback. Do not discard or rewrite completed work. When /existingWork has no pr and the diff has no changed files, there is no existing branch or request: nothing is completed, so plan the full outcome from the base branch. Do not implement or modify code. Return requirements and plan matching the supplied schema, plus completed, remaining, risks and assets arrays. Preserve the original request, ALL comments/metadata, decisions, acceptance criteria, non-goals and assets. Identify unresolved feedback and questions explicitly in requirements and plan risks; never invent a human decision. Requirements describe the full intended outcome with stable IDs; plan steps describe ONLY remaining work and reference those requirement IDs. Preserve completed work and continue the existing PR URL/branch rather than opening a replacement. Include repository scope and base branch from the observed data, delivery expectations, self-contained validation and unresolved review discussion in the plan. Use repository IDs from /repositories. Distinguish repository, external, mixed and deferred delivery without authorizing external effects. State unavailable history and coverage honestly. Read source files and Git history as needed to understand the existing changes; this assessment replaces clarification/planning but never grants implementation, publication, human approval or merge authority.",
			next: "result",
		},
		{
			id: "result",
			name: "Publish requirements and remaining plan",
			type: "transform",
			reads: { assessment: "assess-existing" },
			transform: {
				requirements: { select: "/inputs/assessment/requirements" },
				plan: { select: "/inputs/assessment/plan" },
			},
			next: "end",
		},
	],
};
