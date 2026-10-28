// Frozen copy of the update state schema as shipped by the v2 supervisor
// (origin/main @ the #176 c/4 branch point). It is a non-strict z.object, so a v2
// supervisor that reads and rewrites state.json silently strips any key it does
// not know. Do not edit: tests use it to prove the current writer's output
// survives that round trip without key loss.
import { z } from "zod";

export const UpdateSettingsSchema = z
	.object({
		channel: z.enum(["stable", "nightly"]).default("stable"),
		overrides: z
			.object({
				stable: z.enum(["manual", "idle-auto"]).optional(),
				nightly: z.enum(["manual", "idle-auto"]).optional(),
			})
			.default({}),
		paused: z.boolean().default(false),
		pin: z
			.string()
			.regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
			.optional(),
	})
	.strict();
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
const CandidateSchema = z.object({
	version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
	commit: z.string().regex(/^[a-f0-9]{40}$/),
	channel: z.enum(["stable", "nightly"]),
	target: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
	manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
	publishedAt: z.string().datetime(),
});
export type UpdateCandidate = z.infer<typeof CandidateSchema>;
const InstalledSchema = z.object({
	version: z.string(),
	commit: z.string().nullable(),
	target: z.string().nullable(),
});
export type InstalledUpdate = z.infer<typeof InstalledSchema>;
const StagedSchema = z.object({
	candidate: CandidateSchema,
	executable: z.string(),
	previousExecutable: z.string(),
});
export type StagedUpdate = z.infer<typeof StagedSchema>;
const OutcomeSchema = z.enum(["succeeded", "rolled-back", "cancelled"]);
const TransactionSchema = z
	.object({
		id: z.string(),
		candidate: CandidateSchema,
		staged: StagedSchema,
		previous: InstalledSchema,
		snapshot: z.string().optional(),
		revision: z.number().int(),
		phase: z.enum([
			"draining",
			"preflight",
			"snapshot",
			"stopping",
			"activating",
			"starting",
			"health",
			"rollback",
			"recovery-required",
			"succeeded",
			"rolled-back",
			"cancelled",
		]),
		switchStarted: z.boolean().default(false),
		startedAt: z.string(),
		error: z.string().optional(),
		release: z
			.object({
				transactionId: z.string(),
				outcome: OutcomeSchema,
				status: z.enum(["pending", "acknowledged"]),
			})
			.optional(),
	})
	.superRefine((transaction, ctx) => {
		if (
			transaction.release &&
			transaction.release.transactionId !== transaction.id
		)
			ctx.addIssue({
				code: "custom",
				message: "Maintenance release must belong to its transaction",
			});
	});
export const UpdateTransactionSchema = TransactionSchema;
export type UpdateTransaction = z.infer<typeof TransactionSchema>;
const StateSchema = z.object({
	schemaVersion: z.literal(1),
	revision: z.number().int().nonnegative(),
	settings: UpdateSettingsSchema,
	installed: InstalledSchema,
	pending: z
		.object({
			candidate: CandidateSchema,
			since: z.string(),
			staged: StagedSchema.optional(),
			consentRevision: z.number().optional(),
		})
		.optional(),
	transaction: TransactionSchema.optional(),
	// Retain the last successful rollback even while a newer attempt drains/fails.
	rollbackSnapshot: z
		.object({ transactionId: z.string(), path: z.string() })
		.optional(),
	badCandidates: z.array(z.string()),
	nextCheckAt: z.number(),
	failures: z.number().int(),
	lastCheckedAt: z.string().optional(),
	error: z.string().optional(),
	blocked: z
		.object({
			code: z.literal("worker-ownership"),
			reason: z.string(),
			remedy: z.string(),
		})
		.optional(),
});
export const FrozenV2StateSchema = StateSchema;
