export const requirements = {
	summary: "Let administrators confirm a new reader before it joins.",
	requirements: [
		{
			id: "R1",
			text: "An administrator confirms the reader code.",
			source: "request",
		},
	],
	decisions: [
		{ id: "D1", question: "Who confirms?", answer: "An administrator" },
	],
	outOfScope: ["Replacing existing readers"],
};
export const plan = {
	summary: "Confirm new readers before registration",
	deliveryMode: "repository",
	steps: [
		{
			id: "P1",
			text: "Add the pending-reader flow using established patterns; test confirmation and rejection.",
			requirementRefs: ["R1"],
		},
	],
	risks: ["Readers stay pending until an administrator confirms."],
	repositories: ["fixture"],
};
const component = (id: string, type: string, data: object) => ({
	id,
	type,
	data: { literal: data },
});
export const questionDocument = {
	version: "view-v1",
	components: [
		component("intro", "markdown", {
			text: "Who should confirm a new reader?",
		}),
		component("answers", "form", {
			fields: [
				{ id: "owner", type: "text", label: "Who confirms?", required: true },
			],
		}),
		component("submit", "actions", {
			actions: [{ id: "continue", label: "Continue" }],
		}),
	],
};
export function architectureDocument(revised = false) {
	return {
		version: "view-v1",
		components: [
			component("goal", "markdown", {
				text: "## Before I start\nYou want administrators to choose which readers can join, so an unexpected device cannot register itself. Done means every new reader waits for a confirmed code.",
			}),
			component("scene", "beforeAfter", {
				before: "A new reader connects and joins automatically.",
				after: revised
					? "The reader shows a code. An administrator confirms it; the code expires after five minutes."
					: "The reader shows a code. An administrator confirms it before the reader joins.",
			}),
			component("approach", "markdown", {
				text: "I'd keep the existing reader list and add a pending state. Administrators will see waiting readers and can confirm or reject them. Existing readers keep working. This is one small flow, with tests for confirmation and rejection.",
			}),
			component("calls", "itemCards", {
				required: false,
				comment: true,
				items: [
					{
						id: "expiry",
						title: "How long a code stays valid",
						body: revised
							? "I went with five minutes, following your note. The alternative is to let it stay valid until someone dismisses it."
							: "I went with no automatic expiry to keep setup simple. A short expiry would mean restarting setup if an administrator is busy.",
					},
				],
			}),
			component("feedback", "form", {
				fields: [
					{ id: "feedback", label: "Anything to change?", type: "textarea" },
				],
			}),
			component("decision", "actions", {
				summary: "Accept this direction or ask me to revise it.",
				actions: [
					{ id: "accept", label: "Accept" },
					{ id: "request-changes", label: "Request changes" },
				],
			}),
		],
	};
}
export const proposal = (revised = false) => ({
	meaningful: true,
	rationale: "Changes reader registration responsibilities.",
	display: architectureDocument(revised),
	decisions: [
		{
			id: "expiry",
			text: revised ? "Expire after five minutes" : "No automatic expiry",
		},
	],
});
