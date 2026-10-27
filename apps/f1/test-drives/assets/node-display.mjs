// Shared deterministic human gate for maintained node-engine F1 fixtures.
export function nodeDisplay(id, question, next) {
	return {
		id,
		name: question,
		type: "display",
		next,
		document: {
			version: "view-v1",
			components: [
				{
					id: "question",
					type: "markdown",
					data: { literal: { text: question } },
				},
				{
					id: "answer",
					type: "form",
					data: {
						literal: {
							fields: [{ id: "answer", label: question, type: "text" }],
						},
					},
				},
				{
					id: "decision",
					type: "actions",
					data: {
						literal: { actions: [{ id: "continue", label: "Continue" }] },
					},
				},
			],
		},
	};
}

export function displayAnswer(run, answer) {
	const decision = run.viewDecision;
	if (!decision?.documentDigest) throw new Error("No current node Display");
	return {
		batchId: decision.id,
		digest: decision.digest,
		documentDigest: decision.documentDigest,
		accepted: true,
		action: "continue",
		values: { answer },
	};
}
