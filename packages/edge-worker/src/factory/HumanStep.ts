import { z } from "zod";
import { sanitizeActionConfiguration } from "./ActionSteps.js";

import { type ResolvedView, viewIdSchema } from "./View.js";

export const ViewNotificationsSchema = z
	.object({ push: z.enum(["private", "view-text"]) })
	.strict();
export type ViewNotifications = z.infer<typeof ViewNotificationsSchema>;

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
	kind: "display";
	documentDigest?: string;
	bound?: string[];
	interactive?: boolean;
	title: string;
	digest: string;
	view: ResolvedView;
	items?: ViewItem[];

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
