import { z } from "zod";
import {
	type ForeachScope,
	foreachFields,
	foreachPointerSchema,
	prepareForeach,
	sanitizeJsonConfiguration,
} from "./Foreach.js";
import { IssueDestinationSchema } from "./IssueDestination.js";

const list = {
	items: foreachFields.items,
	itemId: foreachPointerSchema.default("/id"),
	maxItems: z.number().int().min(1).max(1000).default(100),
};
export function sanitizeActionConfiguration(
	value: unknown,
	context: z.RefinementCtx,
): unknown {
	try {
		return sanitizeJsonConfiguration(value);
	} catch (error) {
		context.addIssue({
			code: "custom",
			message:
				error instanceof Error
					? error.message
					: "Action configuration must be safe JSON data",
		});
		return z.NEVER;
	}
}
export const SnapshotConfigurationSchema = z.preprocess(
	sanitizeActionConfiguration,
	z.object({
		history: z
			.object({
				lookbackDays: z.number().int().min(1).max(365).default(30),
				maxRuns: z.number().int().min(1).max(1000).default(100),
			})
			.optional(),
	}),
);
export const FileIssuesConfigurationSchema = z.preprocess(
	sanitizeActionConfiguration,
	z.object({
		...list,
		destination: IssueDestinationSchema.optional(),
		fields: z
			.object({
				title: foreachPointerSchema,
				body: foreachPointerSchema,
				labels: foreachPointerSchema.optional(),
			})
			.strict(),
	}),
);
export const LaunchRunsConfigurationSchema = z.preprocess(
	sanitizeActionConfiguration,
	z.object({
		...list,
		workflow: z
			.string()
			.regex(/^[a-zA-Z0-9_-]+$/)
			.max(80)
			.default("factory"),
		inputMapping: z
			.object({
				prompt: foreachPointerSchema,
				plan: foreachPointerSchema.optional(),
				repositoryIds: foreachPointerSchema.optional(),
			})
			.strict(),
		dependencies: foreachPointerSchema.optional(),
		wait: z.boolean().default(true),
	}),
);
export type SnapshotConfiguration = z.infer<typeof SnapshotConfigurationSchema>;
export type FileIssuesConfiguration = z.infer<
	typeof FileIssuesConfigurationSchema
>;
export type LaunchRunsConfiguration = z.infer<
	typeof LaunchRunsConfigurationSchema
>;
/** Same bounded hook-free JSON, stable item IDs and lexical scope as For each. */
export function actionItems(
	config: {
		items: { from: string } | { values: unknown[] };
		itemId?: string;
		maxItems?: number;
	},
	scope: ForeachScope,
) {
	return prepareForeach(
		{ ...config, concurrency: 1, failure: "all-must-succeed" },
		scope,
	).items;
}
