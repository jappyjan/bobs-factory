import { z } from "zod";
import { actionItems, sanitizeActionConfiguration } from "./ActionSteps.js";
import { agentSettings } from "./AgentSettings.js";
import {
	foreachPointer,
	foreachPointerSchema,
	sanitizeJsonConfiguration,
} from "./Foreach.js";
import {
	bindingValue,
	type ResolvedView,
	type ViewBinding,
	ViewBindingSchema,
	viewDataSchemas,
	viewIdSchema,
} from "./View.js";

export const ViewNotificationsSchema = z
	.object({ push: z.enum(["private", "view-text"]) })
	.strict();
export type ViewNotifications = z.infer<typeof ViewNotificationsSchema>;

const key = z
	.string()
	.regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
	.refine((s) => !["constructor", "prototype", "__proto__"].includes(s));
export const DecideConfigurationSchema = z.preprocess(
	sanitizeActionConfiguration,
	z
		.object({
			items: ViewBindingSchema,
			itemId: foreachPointerSchema.default("/id"),
			title: foreachPointerSchema.default("/title"),
			body: foreachPointerSchema.optional(),
			details: z
				.array(
					z
						.object({
							label: z.string().min(1).max(120),
							path: foreachPointerSchema,
						})
						.strict(),
				)
				.max(20)
				.default([]),
			actions: z
				.array(
					z
						.object({
							id: key,
							label: z.string().min(1).max(80),
							comment: z.boolean().optional(),
							followUp: z.boolean().optional(),
						})
						.strict(),
				)
				.min(1)
				.max(12),
			ask: z
				.object({ prompt: z.string().min(1).max(12000), ...agentSettings })
				.strict()
				.optional(),
		})
		.strict()
		.superRefine((value, ctx) => {
			if (new Set(value.actions.map((a) => a.id)).size !== value.actions.length)
				ctx.addIssue({
					code: "custom",
					message: "Decision actions must have unique IDs",
				});
		}),
);
export type DecideConfiguration = z.infer<typeof DecideConfigurationSchema>;
export interface ViewItem {
	id: string;
	title: string;
	body?: string;
	details: { label: string; value: string }[];
}
export interface ViewThread {
	id: string;
	question: string;
	answer?: string;
	status: "pending" | "answered" | "failed";
	error?: string;
	at: string;
	agent?: import("./WorkflowRuntime.js").AgentCheckpoint;
	/** Retained internal native-step identity; absent on original saved threads. */
	executionKey?: string;
}
export interface ViewSnapshot {
	id: string;
	stepKey: string;
	kind: "decide" | "approve" | "show" | "display";
	documentDigest?: string;
	bound?: string[];
	interactive?: boolean;
	title: string;
	digest: string;
	view: ResolvedView;
	items?: ViewItem[];
	actions?: DecideConfiguration["actions"];
	askAvailable?: boolean;
	notifications?: ViewNotifications;
	threads?: Record<string, ViewThread[]>;
	answer?: unknown;
	createdAt: string;
}
export interface ViewRecord {
	snapshot: ViewSnapshot;
	configDigest: string;
	definitionDigest?: string;
	sourceDigest: string;
	superseded?: boolean;
	items?: { id: string; value: unknown }[];
	scope?: { inputs: Record<string, unknown>; item?: unknown; index?: number };
	answer?: { request: ViewAnswer; output: Record<string, unknown>; at: string };
	notified?: boolean;
	/** Exact public display captured in the durable ticket intent (or hook attempt). */
	publicationDigest?: string;
}
const itemKey = viewIdSchema;
const selection = z
	.object({
		itemId: itemKey,
		action: viewIdSchema,
		comment: z.string().max(12000).optional(),
	})
	.strict();
export const ViewAnswerSchema = z.preprocess(
	sanitizeActionConfiguration,
	z
		.object({
			batchId: z.string().uuid(),
			digest: z.string().min(20).max(128),
			accepted: z.literal(true),
			action: viewIdSchema.optional(),
			documentDigest: z
				.string()
				.regex(/^[a-f0-9]{64}$/)
				.optional(),
			values: z
				.record(viewIdSchema, z.union([z.string().max(12000), z.boolean()]))
				.optional(),
			choices: z.array(selection).max(100).optional(),
			fields: z
				.record(viewIdSchema, z.union([z.string().max(12000), z.boolean()]))
				.optional(),
			approved: z.boolean().optional(),
			feedback: z.string().max(24000).optional(),
		})
		.strict(),
);
export type ViewAnswer = z.infer<typeof ViewAnswerSchema>;
export const ViewAskSchema = z.preprocess(
	sanitizeActionConfiguration,
	z
		.object({
			batchId: z.string().uuid(),
			digest: z.string().min(20).max(128),
			itemId: itemKey,
			question: z.string().trim().min(1).max(12000),
			requestId: z.string().uuid(),
		})
		.strict(),
);

export function decisionItems(
	config: DecideConfiguration,
	scope: { inputs?: Record<string, unknown>; item?: unknown; index?: number },
) {
	const values = bindingValue(config.items as ViewBinding, scope);
	const items = actionItems(
		{
			items: { values: values as unknown[] },
			itemId: config.itemId,
			maxItems: 100,
		},
		{ outputs: {}, inputs: {} },
	);
	const text = (value: unknown, label: string): string => {
		if (typeof value !== "string" || !value.trim() || value.length > 24000)
			throw new Error(
				`${label} must be nonempty text of at most 24000 characters`,
			);
		return value;
	};
	const projected = items.map((item) => ({
		id: item.id,
		value: item.value,
		title: text(foreachPointer(item.value, config.title), "Item title"),
		...(config.body
			? { body: text(foreachPointer(item.value, config.body), "Item body") }
			: {}),
		details: config.details.map((detail) => ({
			label: detail.label,
			value: text(
				foreachPointer(item.value, detail.path),
				`Detail ${detail.label}`,
			),
		})),
	}));
	viewDataSchemas.itemCards.parse({
		items: projected.map(({ value: _value, ...item }) => item),
	});
	return projected;
}

/** Only accepted recipe action IDs and displayed form fields can be submitted. */
export function viewAnswerOutput(
	record: ViewRecord,
	request: ViewAnswer,
): Record<string, unknown> {
	const snapshot = record.snapshot;
	if (
		request.action !== undefined ||
		request.values !== undefined ||
		request.documentDigest !== undefined
	)
		throw new Error("Display answer fields require a display node");
	const fields: Record<string, string | boolean> = {};
	const configured = snapshot.view.components.flatMap((component) =>
		component.type === "choices" ? component.data.fields : [],
	);
	if (new Set(configured.map((field) => field.id)).size !== configured.length)
		throw new Error("View form field IDs must be unique across components");
	for (const supplied of Object.keys(request.fields ?? {}))
		if (!configured.some((f) => f.id === supplied))
			throw new Error(`Unknown form field: ${supplied}`);
	for (const field of configured) {
		const value = request.fields?.[field.id] ?? field.value;
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
				field.type === "select" &&
				value !== undefined &&
				value !== "" &&
				!field.options.some((o) => o.id === value)
			)
				throw new Error(`Invalid choice: ${field.id}`);
		}
		if (value !== undefined) fields[field.id] = value;
	}
	if (snapshot.kind === "approve") {
		if (typeof request.approved !== "boolean" || request.choices)
			throw new Error("Choose Approve or Request changes explicitly");
		if (!request.approved && !request.feedback?.trim())
			throw new Error("Explain the requested changes");
		return {
			approved: request.approved,
			feedback: request.feedback ?? "",
			fields,
			batchId: snapshot.id,
			digest: snapshot.digest,
		};
	}
	if (
		snapshot.kind !== "decide" ||
		request.approved !== undefined ||
		request.feedback !== undefined
	)
		throw new Error("This step requires per-item choices");
	const choices = request.choices ?? [];
	if (
		choices.length !== snapshot.items?.length ||
		new Set(choices.map((c) => c.itemId)).size !== choices.length
	)
		throw new Error("Choose one action for every displayed item");
	const itemsByAction: Record<string, unknown[]> = Object.fromEntries(
		(snapshot.actions ?? []).map((a) => [a.id, []]),
	);
	const followUps: unknown[] = [];
	for (const choice of choices) {
		const item = record.items?.find((item) => item.id === choice.itemId),
			action = snapshot.actions?.find((action) => action.id === choice.action);
		if (!item || !action) throw new Error("Unknown decision item or action");
		if (choice.comment && !action.comment)
			throw new Error(`Comments are not enabled for ${action.label}`);
		itemsByAction[action.id]!.push(item.value);
		if (action.followUp)
			followUps.push({
				itemId: item.id,
				item: item.value,
				action: action.id,
				comment: choice.comment ?? "",
				thread: (snapshot.threads?.[item.id] ?? []).map(
					({ id, question, answer, status, at }) => ({
						id,
						question,
						answer,
						status,
						at,
					}),
				),
			});
	}
	return sanitizeJsonConfiguration({
		choices,
		itemsByAction,
		followUps,
		hasFollowUps: followUps.length > 0,
		fields,
		batchId: snapshot.id,
		digest: snapshot.digest,
	}) as Record<string, unknown>;
}
