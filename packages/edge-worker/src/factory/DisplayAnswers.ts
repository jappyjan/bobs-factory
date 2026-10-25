import { displayComponents } from "./DisplayDocument.js";
import type { ViewAnswer, ViewRecord } from "./HumanStep.js";

/** Only controls in the accepted document authorize values or actions. */
export function displayAnswerOutput(
	record: ViewRecord,
	request?: ViewAnswer,
): Record<string, unknown> {
	const snapshot = record.snapshot;
	const components = displayComponents(snapshot.view);
	if (
		request?.documentDigest !== undefined &&
		request.documentDigest !== snapshot.documentDigest
	)
		throw new Error("Displayed document changed. Refresh and answer again.");
	if (request?.approved !== undefined || request?.feedback !== undefined)
		throw new Error("Use display actions and values");
	const fields = components.flatMap((c) =>
		c.type === "form" ? c.data.fields : [],
	);
	const values: Record<string, string | boolean> = {};
	const supplied = request?.values ?? request?.fields ?? {};
	for (const id of Object.keys(supplied))
		if (!fields.some((f) => f.id === id))
			throw new Error(`Unknown form field: ${id}`);
	for (const field of fields) {
		// Explicit empty custom answers are retained, never replaced by a default.
		const value = Object.hasOwn(supplied, field.id)
			? supplied[field.id]
			: field.value;
		if (field.type === "checkbox") {
			if (value !== undefined && typeof value !== "boolean")
				throw new Error(`Invalid checkbox: ${field.id}`);
			if (field.required && value !== true)
				throw new Error(`Confirm ${field.label}`);
		} else {
			if (value !== undefined && typeof value !== "string")
				throw new Error(`Invalid field: ${field.id}`);
			if (field.required && (typeof value !== "string" || !value.trim()))
				throw new Error(`Complete ${field.label}`);
			if (
				(field.type === "select" ||
					(field.type === "choice" && !field.custom)) &&
				value !== undefined &&
				value !== "" &&
				!field.options.some((o) => o.id === value)
			)
				throw new Error(`Invalid choice: ${field.id}`);
		}
		if (value !== undefined) values[field.id] = value;
	}
	const actions = components.flatMap((c) =>
		c.type === "actions" ? c.data.actions : [],
	);
	if (actions.length && !actions.some((a) => a.id === request?.action))
		throw new Error("Choose a document action explicitly");
	if (!actions.length && request?.action !== undefined)
		throw new Error("Unknown document action");
	const choices = request?.choices ?? [];
	if (new Set(choices.map((c) => c.itemId)).size !== choices.length)
		throw new Error("Duplicate item answer");
	const items: Record<string, { action: string; comment: string }> = {};
	const comments: Record<string, string> = {};
	const itemsByAction: Record<string, unknown[]> = {};
	const followUps: unknown[] = [];
	for (const component of components) {
		if (component.type === "itemCards") {
			for (const action of component.data.actions ?? [])
				itemsByAction[action.id] ??= [];
			for (const item of component.data.items) {
				const choice = choices.find((c) => c.itemId === item.id);
				if (component.data.actions?.length && !choice)
					throw new Error(`Choose an action for ${item.title}`);
				if (!choice) continue;
				const action = component.data.actions?.find(
					(a) => a.id === choice.action,
				);
				if (!action && !(component.data.comment && choice.action === "comment"))
					throw new Error(`Unknown item action: ${choice.action}`);
				if (choice.comment && !component.data.comment && !action?.comment)
					throw new Error(`Comments unavailable for ${item.id}`);
				items[item.id] = {
					action: choice.action,
					comment: choice.comment ?? "",
				};
				if (choice.comment !== undefined) comments[item.id] = choice.comment;
				if (action) {
					itemsByAction[action.id] ??= [];
					itemsByAction[action.id]!.push(
						item.value === undefined ? item : item.value,
					);
				}
				if (action?.followUp)
					followUps.push({
						itemId: item.id,
						item: item.value === undefined ? item : item.value,
						action: choice.action,
						comment: choice.comment ?? "",
						thread: (snapshot.threads?.[item.id] ?? []).map(
							({ id, question, answer, status, at }) => ({
								id,
								question,
								...(answer === undefined ? {} : { answer }),
								status,
								at,
							}),
						),
					});
			}
		} else if (component.type === "codeTour" && component.data.comment) {
			for (const note of component.data.files.flatMap((f) => f.notes)) {
				const choice = choices.find((c) => c.itemId === note.id);
				if (!choice) continue;
				if (choice.action !== "comment")
					throw new Error("Code note answers use the comment action");
				items[note.id] = { action: "comment", comment: choice.comment ?? "" };
				comments[note.id] = choice.comment ?? "";
			}
		}
	}
	for (const choice of choices)
		if (!Object.hasOwn(items, choice.itemId))
			throw new Error(`Unknown item: ${choice.itemId}`);
	return {
		action: request?.action ?? null,
		values,
		items,
		itemsByAction,
		followUps,
		comments,
		documentDigest: snapshot.documentDigest!,
		bound: snapshot.bound ?? [],
	};
}
