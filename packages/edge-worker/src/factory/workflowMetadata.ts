import type { Workflow } from "./Workflow.js";

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
};
