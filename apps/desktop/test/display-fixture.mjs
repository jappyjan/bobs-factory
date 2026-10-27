// Generic nodes-v1 human input for controlled native/release acceptance checks.
export function questionStep(id, label) {
	return {
		id,
		name: label,
		type: "display",
		document: {
			version: "view-v1",
			components: [
				{
					id: "question",
					type: "form",
					data: {
						literal: {
							fields: [{ id: "color", type: "text", label, required: true }],
						},
					},
				},
			],
		},
	};
}

// Resuming a passive Display creates a new dispatch attempt, while retaining the
// view identity, native sessions and completed progress that updates must preserve.
export function preservedCheckpoint(checkpoint) {
	const result = structuredClone(checkpoint);
	if (result?.active) delete result.active.attemptId;
	return result;
}
