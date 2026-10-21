/** Fixed server budgets; recipe authors cannot increase them. */
export const INLINE_SCHEMA_LIMITS = {
	schemaBytes: 64 * 1024,
	dataBytes: 256 * 1024,
	schemaNodes: 512,
	dataNodes: 20_000,
	depth: 40,
	patternLength: 512,
	// VM time includes cold Ajv setup and OS scheduling, not only schema CPU.
	// Leave headroom within the independent parent wall/RSS/stream limits.
	executionMs: 1_000,
	wallMs: 2_000,
	workers: 2,
	queued: 16,
	childRssBytes: 256 * 1024 * 1024,
	responseBytes: 24 * 1024,
} as const;
export type InlineSchemaIssue = { path: string; message: string };
export type InlineSchemaResult = {
	schemaIssues: string[];
	issues: InlineSchemaIssue[];
	resourceFailure?: boolean;
};
export type InlineSchemaJob = {
	schema: Record<string, unknown>;
	value?: unknown;
	validate: boolean;
};
