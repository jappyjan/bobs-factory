import {
	stockFactorySteps as roles,
	stockTakeoverSteps,
	stockWorkflowMetadata,
} from "./stockFactorySteps.js";

/** Actual producer paths shared by these sequential Calls; public JSON never supplies identity. */
const sources = {
	clarify: "planning/clarify",
	decisions: "planning/decisions",
	plan: "planning/plan",
	"plan-review": "planning/plan-review",
	architecture: "check-in/architecture",
	"architecture-review": "check-in/architecture-review",
	"architecture-decision": "check-in/architecture-decision",
	implement: "implementation/implement",
	"draft-pr": "implementation/draft-pr",
	"assess-impact": "review/assess-impact",
	"extract-requirements": "review/extract-requirements",
	"impact-checks": "review/impact-checks",
	"specialist-review": "review/specialist-review",
	"review-gate": "review/review-gate",
	ci: "ci/ci",
	"visual-scope": "qa/visual-scope",
	capture: "qa/capture",
	"visual-review": "qa/visual-review",
	"visual-gate": "qa/visual-gate",
	"code-fix": "review/code-fix",
	"ci-fix": "ci/ci-fix",
	"after-ci-fix-observe": "ci/after-ci-fix-observe",
	"after-ci-fix": "ci/after-ci-fix",
	"visual-fix": "qa/visual-fix",
	guide: "approval/guide",
	handoff: "approval/handoff",
	"human-review": "approval/human-review",
	"human-fix": "approval/human-fix",
	merge: "merge/merge",
	"delivery-feedback-route": "approval/delivery-feedback-route",
	"delivery-route-accept": "delivery/delivery-route-accept",
	"delivery-route": "delivery/delivery-route",
	"delivery-deferred": "delivery/delivery-deferred",
	"external-apply": "external/external-apply",
	"external-verify": "external/external-verify",
	"external-after-verify": "external/external-after-verify",
	"external-guide": "external/external-guide",
	"external-human-review": "external/external-human-review",
	"external-correction": "external/external-correction",
	"external-final": "external/external-final",
	"external-reverify": "external/external-reverify",
};
const ports = [
	"clarify",
	"decisions",
	"plan",
	"plan-review",
	"architecture",
	"architecture-review",
	"architecture-decision",
	"implement",
	"draft-pr",
	"assess-impact",
	"extract-requirements",
	"impact-checks",
	"specialist-review",
	"review-gate",
	"ci",
	"visual-scope",
	"capture",
	"visual-review",
	"visual-gate",
	"code-fix",
	"ci-fix",
	"after-ci-fix-observe",
	"after-ci-fix",
	"visual-fix",
	"guide",
	"handoff",
	"human-review",
	"human-fix",
	"merge",
	"delivery-feedback-route",
	"delivery-route-accept",
	"delivery-route",
	"delivery-deferred",
	"external-apply",
	"external-verify",
	"external-after-verify",
	"external-guide",
	"external-human-review",
	"external-correction",
	"external-final",
	"external-reverify",
];

const planningRecipe = {
	id: "clarify-plan",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "decisions",
			type: "textarea",
			label: "Decisions input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Clarify & plan",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable clarify & plan with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-architecture"],
	steps: [
		{
			...roles.clarify!,
			next: "decisions",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{ ...roles.decisions!, next: "plan", branches: [] },
		{
			...roles.plan!,
			next: "plan-review",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles["plan-review"]!,
			next: "end",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
				{
					when: {
						path: "approved",
						equals: false,
					},
					next: "plan",
				},
			],
		},
	],
};

const deliveryRecipe = {
	id: "route-delivery",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "plan-review",
			type: "textarea",
			label: "Plan review input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Route by delivery",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable route by delivery with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-external-apply", "to-architecture", "to-plan"],
	steps: [
		{
			...roles["delivery-route-accept"]!,
			next: "delivery-route",
			branches: [],
		},
		{
			...roles["delivery-route"]!,
			next: "to-architecture",
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
					next: "to-external-apply",
				},
				{
					when: {
						path: "mode",
						equals: "mixed",
					},
					next: "to-external-apply",
				},
			],
		},
		{
			...roles["delivery-deferred"]!,
			next: "to-plan",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
	],
};

const check_inRecipe = {
	id: "architecture-review",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "decisions",
			type: "textarea",
			label: "Decisions input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Check in with you",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable check in with you with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed"],
	steps: [
		{ ...roles.architecture!, next: "architecture-review", branches: [] },
		{
			...roles["architecture-review"]!,
			next: "architecture-decision",
			branches: [
				{
					when: {
						path: "approved",
						equals: false,
					},
					next: "architecture",
				},
			],
		},
		{
			...roles["architecture-decision"]!,
			next: "end",
			branches: [
				{
					when: {
						path: "decision",
						equals: "revise",
					},
					next: "architecture",
				},
			],
		},
	],
};

const implementationRecipe = {
	id: "implement-work",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Implement",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable implement with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-architecture"],
	steps: [
		{
			...roles.implement!,
			next: "draft-pr",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{ ...roles["draft-pr"]!, next: "end", branches: [] },
	],
};

const reviewRecipe = {
	id: "review-loop",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "decisions",
			type: "textarea",
			label: "Decisions input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "draft-pr",
			type: "textarea",
			label: "Draft pr input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "ci",
			type: "textarea",
			label: "Ci input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Review loop",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable review loop with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-ci-fix", "to-ci", "to-architecture"],
	steps: [
		{
			...roles["assess-impact"]!,
			next: "impact-checks",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
				{
					when: {
						path: "correctionRequired",
						equals: true,
					},
					next: "to-ci-fix",
				},
				{
					when: {
						path: "readinessOnly",
						equals: true,
					},
					next: "to-ci",
				},
				{
					when: {
						path: "extractRequirements",
						equals: true,
					},
					next: "extract-requirements",
				},
			],
		},
		{
			...roles["extract-requirements"]!,
			next: "impact-checks",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{ ...roles["impact-checks"]!, next: "specialist-review", branches: [] },
		{ ...roles["specialist-review"]!, next: "review-gate", branches: [] },
		{
			...roles["review-gate"]!,
			next: "end",
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
		},
		{
			...roles["code-fix"]!,
			next: "assess-impact",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
	],
};

const qaRecipe = {
	id: "qa-screenshots",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "decisions",
			type: "textarea",
			label: "Decisions input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "draft-pr",
			type: "textarea",
			label: "Draft pr input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "assess-impact",
			type: "textarea",
			label: "Assess impact input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "QA & screenshots",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable qa & screenshots with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-architecture", "to-assess-impact"],
	steps: [
		{
			...roles["visual-scope"]!,
			next: "capture",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles.capture!,
			next: "visual-review",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles["visual-review"]!,
			next: "visual-gate",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles["visual-gate"]!,
			next: "end",
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
					next: "to-assess-impact",
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
		},
		{
			...roles["visual-fix"]!,
			next: "to-assess-impact",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
	],
};

const ciRecipe = {
	id: "ci-watch-fix",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "draft-pr",
			type: "textarea",
			label: "Draft pr input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "review-gate",
			type: "textarea",
			label: "Review gate input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "assess-impact",
			type: "textarea",
			label: "Assess impact input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "CI watch & fix",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable ci watch & fix with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: [
		"completed",
		"to-assess-impact",
		"to-guide",
		"to-visual-scope",
		"to-architecture",
	],
	steps: [
		{
			...roles.ci!,
			next: "to-visual-scope",
			branches: [
				{
					when: {
						path: "impactRequired",
						equals: true,
					},
					next: "to-assess-impact",
				},
				{
					when: {
						path: "retainQa",
						equals: true,
					},
					next: "to-guide",
				},
				{
					when: {
						path: "fix",
						equals: true,
					},
					next: "ci-fix",
				},
			],
		},
		{
			...roles["ci-fix"]!,
			next: "after-ci-fix-observe",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{ ...roles["after-ci-fix-observe"]!, next: "after-ci-fix", branches: [] },
		{
			...roles["after-ci-fix"]!,
			next: "to-assess-impact",
			branches: [
				{
					when: {
						path: "needsAssistance",
						equals: true,
					},
					next: "ci-fix",
				},
			],
		},
	],
};

const approvalRecipe = {
	id: "review-approval",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "draft-pr",
			type: "textarea",
			label: "Draft pr input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "ci",
			type: "textarea",
			label: "Ci input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "visual-scope",
			type: "textarea",
			label: "Visual scope input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "capture",
			type: "textarea",
			label: "Capture input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "visual-review",
			type: "textarea",
			label: "Visual review input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "visual-gate",
			type: "textarea",
			label: "Visual gate input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "assess-impact",
			type: "textarea",
			label: "Assess impact input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Review guide & your approval",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable review guide & your approval with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: [
		"completed",
		"to-architecture",
		"to-assess-impact",
		"to-ci-fix",
		"to-external-correction",
	],
	steps: [
		{
			...roles.guide!,
			next: "handoff",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles.handoff!,
			next: "human-review",
			branches: [
				{
					when: {
						path: "impactRequired",
						equals: true,
					},
					next: "to-assess-impact",
				},
				{
					when: {
						path: "fix",
						equals: true,
					},
					next: "to-ci-fix",
				},
			],
		},
		{
			...roles["human-review"]!,
			next: "end",
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
					next: "to-assess-impact",
				},
			],
		},
		{
			...roles["delivery-feedback-route"]!,
			next: "human-fix",
			branches: [
				{
					when: {
						path: "mode",
						equals: "mixed",
					},
					next: "to-external-correction",
				},
			],
		},
		{
			...roles["human-fix"]!,
			next: "to-assess-impact",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
	],
};

const mergeRecipe = {
	id: "merge-work",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "draft-pr",
			type: "textarea",
			label: "Draft pr input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "handoff",
			type: "textarea",
			label: "Handoff input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "ci",
			type: "textarea",
			label: "Ci input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "review-gate",
			type: "textarea",
			label: "Review gate input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "assess-impact",
			type: "textarea",
			label: "Assess impact input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "Merge",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable merge with declared inputs and original delivery safeguards.",
	inputs: ports,
	outcomes: ["completed", "to-assess-impact", "to-ci-fix", "to-external-final"],
	steps: [
		{
			...roles.merge!,
			next: "end",
			branches: [
				{
					when: {
						path: "rework",
						equals: true,
					},
					next: "to-assess-impact",
				},
				{
					when: {
						path: "fix",
						equals: true,
					},
					next: "to-ci-fix",
				},
				{
					when: {
						path: "externalPending",
						equals: true,
					},
					next: "to-external-final",
				},
			],
		},
	],
};

const externalRecipe = {
	id: "external-delivery",
	launchFields: [
		{
			name: "prompt",
			type: "textarea",
			label: "What should this recipe do?",
			required: true,
		},
		{
			name: "plan",
			type: "textarea",
			label: "Plan input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "plan-review",
			type: "textarea",
			label: "Plan review input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "clarify",
			type: "textarea",
			label: "Clarify input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
		{
			name: "guide",
			type: "textarea",
			label: "Guide input (JSON or text)",
			description:
				"Optional standalone input. Data does not grant executed evidence or approval authority.",
		},
	],
	name: "External ticket delivery",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["workflow", "manual", "ticket-assignment"],
	description:
		"Reusable external ticket delivery. Without an accepted contract, clarify, plan and independently review before accepting and applying it.",
	inputs: ports,
	outcomes: ["completed", "to-architecture", "to-plan"],
	steps: [
		{
			id: "prepare-delivery",
			name: "Use accepted delivery or prepare it",
			type: "check",
			reads: { delivery: "@delivery" },
			check: {
				results: {
					accepted: { path: "/delivery/contractDigest", exists: true },
				},
			},
			next: "clarify",
			branches: [
				{ when: { path: "accepted", equals: true }, next: "external-apply" },
			],
		},
		{
			...roles.clarify!,
			next: "decisions",
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "to-architecture",
				},
			],
		},
		{ ...roles.decisions!, next: "plan", branches: [] },
		{
			...roles.plan!,
			next: "plan-review",
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "to-architecture",
				},
			],
		},
		{
			...roles["plan-review"]!,
			next: "delivery-route-accept",
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "to-architecture",
				},
				{ when: { path: "approved", equals: false }, next: "plan" },
			],
		},
		{
			...roles["delivery-route-accept"]!,
			next: "delivery-route",
			branches: [],
		},
		{
			...roles["delivery-route"]!,
			next: "to-architecture",
			branches: [
				{ when: { path: "deferred", equals: true }, next: "delivery-deferred" },
				{ when: { path: "mode", equals: "external" }, next: "external-apply" },
				{ when: { path: "mode", equals: "mixed" }, next: "external-apply" },
			],
		},
		{
			...roles["delivery-deferred"]!,
			next: "plan",
			branches: [
				{
					when: { path: "architectureRevision", equals: true },
					next: "to-architecture",
				},
			],
		},
		{ ...roles["external-apply"]!, next: "external-verify", branches: [] },
		{
			...roles["external-verify"]!,
			next: "external-after-verify",
			branches: [],
		},
		{
			...roles["external-after-verify"]!,
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
					next: "to-architecture",
				},
			],
		},
		{
			...roles["external-guide"]!,
			reads: { ...roles["external-guide"]!.reads, result: "external-guide" },
			next: "external-human-review",
			branches: [],
		},
		{
			...roles["external-human-review"]!,
			reads: {
				...roles["external-human-review"]!.reads,
				guide: "external-guide",
			},
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
		},
		{
			...roles["external-correction"]!,
			next: "to-plan",
			branches: [
				{
					when: {
						path: "architectureRevision",
						equals: true,
					},
					next: "to-architecture",
				},
			],
		},
		{
			...roles["external-final"]!,
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
		},
		{ ...roles["external-reverify"]!, next: "external-guide", branches: [] },
	],
};

/** Factory and Takeover execute these Calls; the canvas shows the same graph. */
const composition = [
	{
		id: "planning",
		name: "Clarify & plan",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "clarify-plan",
		bindings: sources,
		maxVisits: 100,
		next: "delivery",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
		],
	},
	{
		id: "delivery",
		name: "Route by delivery",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "route-delivery",
		bindings: sources,
		maxVisits: 100,
		next: "check-in",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-plan",
				},
				next: "planning",
				entry: "plan",
			},
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
			{
				when: {
					path: "outcome",
					equals: "to-external-apply",
				},
				next: "external",
				entry: "external-apply",
			},
		],
	},
	{
		id: "check-in",
		name: "Check in with you",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "architecture-review",
		bindings: sources,
		maxVisits: 100,
		next: "implementation",
		branches: [],
	},
	{
		id: "implementation",
		name: "Implement",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "implement-work",
		bindings: sources,
		maxVisits: 100,
		next: "review",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
		],
	},
	{
		id: "review",
		name: "Review loop",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "review-loop",
		bindings: sources,
		maxVisits: 100,
		next: "ci",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
			{
				when: {
					path: "outcome",
					equals: "to-ci",
				},
				next: "ci",
				entry: "ci",
			},
			{
				when: {
					path: "outcome",
					equals: "to-ci-fix",
				},
				next: "ci",
				entry: "ci-fix",
			},
		],
	},
	{
		id: "qa",
		name: "QA & screenshots",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "qa-screenshots",
		bindings: sources,
		maxVisits: 100,
		next: "approval",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
			{
				when: {
					path: "outcome",
					equals: "to-assess-impact",
				},
				next: "review",
				entry: "assess-impact",
			},
		],
	},
	{
		id: "ci",
		name: "CI watch & fix",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "ci-watch-fix",
		bindings: sources,
		maxVisits: 100,
		next: "qa",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
			{
				when: {
					path: "outcome",
					equals: "to-assess-impact",
				},
				next: "review",
				entry: "assess-impact",
			},
			{
				when: {
					path: "outcome",
					equals: "to-visual-scope",
				},
				next: "qa",
				entry: "visual-scope",
			},
			{
				when: {
					path: "outcome",
					equals: "to-guide",
				},
				next: "approval",
				entry: "guide",
			},
		],
	},
	{
		id: "approval",
		name: "Review guide & your approval",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "review-approval",
		bindings: sources,
		maxVisits: 100,
		next: "merge",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
			{
				when: {
					path: "outcome",
					equals: "to-assess-impact",
				},
				next: "review",
				entry: "assess-impact",
			},
			{
				when: {
					path: "outcome",
					equals: "to-ci-fix",
				},
				next: "ci",
				entry: "ci-fix",
			},
			{
				when: {
					path: "outcome",
					equals: "to-external-correction",
				},
				next: "external",
				entry: "external-correction",
			},
		],
	},
	{
		id: "merge",
		name: "Merge",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "merge-work",
		bindings: sources,
		maxVisits: 100,
		next: "end",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-assess-impact",
				},
				next: "review",
				entry: "assess-impact",
			},
			{
				when: {
					path: "outcome",
					equals: "to-ci-fix",
				},
				next: "ci",
				entry: "ci-fix",
			},
			{
				when: {
					path: "outcome",
					equals: "to-external-final",
				},
				next: "external",
				entry: "external-final",
			},
		],
	},
	{
		id: "external",
		name: "External ticket delivery",
		type: "workflow",
		configVersion: "step-config-v1",
		workflow: "external-delivery",
		bindings: sources,
		maxVisits: 100,
		next: "end",
		branches: [
			{
				when: {
					path: "outcome",
					equals: "to-plan",
				},
				next: "planning",
				entry: "plan",
			},
			{
				when: {
					path: "outcome",
					equals: "to-architecture",
				},
				next: "check-in",
				entry: "architecture",
			},
		],
	},
];

export const factoryRecipes = [
	{ ...stockWorkflowMetadata.factory, steps: composition },
	{
		...stockWorkflowMetadata.takeover,
		steps: [
			stockTakeoverSteps["existing-work"]!,
			stockTakeoverSteps["assess-existing"]!,
			...composition,
		],
	},
	{
		...stockWorkflowMetadata["factory-pipeline"],
		allowedTriggers: ["workflow", "manual", "ticket-assignment"],
		steps: composition,
	},
	planningRecipe,
	deliveryRecipe,
	check_inRecipe,
	implementationRecipe,
	reviewRecipe,
	qaRecipe,
	ciRecipe,
	approvalRecipe,
	mergeRecipe,
	externalRecipe,
];
