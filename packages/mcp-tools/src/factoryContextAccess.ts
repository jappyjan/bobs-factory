import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const allowance = {
	utf8Bytes: z
		.number()
		.int()
		.min(1)
		.max(4 * 1024 * 1024),
	pages: z.number().int().min(1).max(512),
};
export const TranscriptExtensionSchema = z
	.object({
		work: z.string().min(1).max(500),
		reason: z.string().trim().min(1).max(1600),
		expectedPages: z.number().int().nonnegative(),
		expectedUtf8Bytes: z.number().int().nonnegative(),
		expectedGrants: z.number().int().nonnegative(),
	})
	.strict();
export type TranscriptExtension = z.infer<typeof TranscriptExtensionSchema>;

/** Accepted recipe configuration, never interpreted from a role's output or prose. */
export const RoleContextPolicySchema = z
	.object({
		mode: z.literal("outputs-first"),
		transcripts: z
			.object({
				purpose: z.string().trim().min(1).max(1600),
				ranges: z
					.array(
						z
							.object({
								role: z.string().min(1).max(500),
								start: z.number().int().nonnegative(),
								end: z.number().int().positive(),
							})
							.strict()
							.refine(
								(range) => range.end > range.start,
								"Use a nonempty message range",
							),
					)
					.min(1)
					.max(16),
				...allowance,
				extension: z.object(allowance).strict().optional(),
			})
			.strict()
			.optional(),
	})
	.strict();
export type RoleContextPolicy = z.infer<typeof RoleContextPolicySchema>;
export const outputsFirstContext: RoleContextPolicy = Object.freeze({
	mode: "outputs-first",
});

export interface TranscriptScope {
	runId: string;
	role: string;
	start: number;
	end: number;
}
const transcripts = new WeakMap<object, TranscriptScope>();
let provenanceEpoch = 0;
export const transcriptProvenanceEpoch = () => provenanceEpoch;
/** Only runtime adapters can attach provenance; ordinary JSON keys confer none. */
export function runtimeTranscript<T extends object>(
	value: T,
	source: TranscriptScope,
): T {
	if (JSON.stringify(transcripts.get(value)) !== JSON.stringify(source))
		provenanceEpoch++;
	transcripts.set(value, Object.freeze({ ...source }));
	return value;
}
export const transcriptSource = (value: object) => transcripts.get(value);
const transcriptFields = new WeakMap<object, Map<string, TranscriptScope>>();
export const transcriptFieldSources = (value: object) =>
	transcriptFields.get(value);
export function runtimeTranscriptField(
	value: object,
	key: string,
	scope: TranscriptScope,
): void {
	let fields = transcriptFields.get(value);
	if (!fields) {
		fields = new Map();
		transcriptFields.set(value, fields);
	}
	if (JSON.stringify(fields.get(key)) !== JSON.stringify(scope))
		provenanceEpoch++;
	fields.set(key, Object.freeze({ ...scope }));
}
export function retainTranscriptSource(source: object, copy: object): void {
	const scope = transcripts.get(source);
	if (scope) runtimeTranscript(copy, scope);
	for (const [key, scope] of transcriptFields.get(source) ?? [])
		if (Object.hasOwn(copy, key)) runtimeTranscriptField(copy, key, scope);
}
/** Resolve a declared alias while retaining inherited source provenance, including scalars. */
export function transcriptPointerValue(root: unknown, reference: string) {
	let value = root;
	let scope: TranscriptScope | undefined;
	for (const part of reference.split("/")) {
		const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
			return { value: undefined, scope };
		scope =
			transcriptFields.get(value)?.get(key) ?? transcripts.get(value) ?? scope;
		value = (value as Record<string, unknown>)[key];
	}
	if (value && typeof value === "object")
		scope = transcripts.get(value) ?? scope;
	return { value, scope };
}

export interface FactoryContextAccess {
	/** Runtime-selected root path; named user inputs are never overwritten. */
	handoffPath?: string;
	runId: string;
	work: string;
	policy: RoleContextPolicy;
	/** Runtime-owned, durable across role snapshots and MCP connections. */
	directory: string;
}
interface AccessReceipt {
	version: 1;
	runId: string;
	work: string;
	policy: string;
	utf8Bytes: number;
	pages: number;
	grants: { at: string; reason: string; utf8Bytes: number; pages: number }[];
	blocked?: { scope: TranscriptScope; reason: string };
}
const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const transcriptAccessPath = (access: FactoryContextAccess) =>
	join(
		access.directory,
		`transcript-${digest([access.runId, access.work])}.json`,
	);

function transaction<T>(
	access: FactoryContextAccess,
	operation: (receipt: AccessReceipt) => T,
): T {
	const path = transcriptAccessPath(access);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const lock = `${path}.lock`;
	try {
		mkdirSync(lock, { mode: 0o700 });
	} catch {
		throw new Error(
			"Transcript accounting is busy; retry this same scoped read. No allowance was reset.",
		);
	}
	try {
		const receipt: AccessReceipt = existsSync(path)
			? JSON.parse(readFileSync(path, "utf8"))
			: {
					version: 1,
					runId: access.runId,
					work: access.work,
					policy: digest(access.policy),
					utf8Bytes: 0,
					pages: 0,
					grants: [],
				};
		if (
			receipt.version !== 1 ||
			receipt.runId !== access.runId ||
			receipt.work !== access.work ||
			receipt.policy !== digest(access.policy) ||
			!Number.isSafeInteger(receipt.pages) ||
			receipt.pages < 0 ||
			!Number.isSafeInteger(receipt.utf8Bytes) ||
			receipt.utf8Bytes < 0 ||
			!Array.isArray(receipt.grants)
		)
			throw new Error(
				"Transcript accounting identity changed or is invalid; restore this work's original access receipt. Use a saved recipe copy and new run to adopt different context policy.",
			);
		const result = operation(receipt);
		const temporary = `${path}.${randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify(receipt), {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
		return result;
	} finally {
		rmSync(lock, { recursive: true });
	}
}

export function requireTranscriptScope(
	access: FactoryContextAccess | undefined,
	scope: TranscriptScope,
): void {
	const grant = access?.policy.transcripts;
	if (
		!access ||
		!grant ||
		access.runId !== scope.runId ||
		!grant.ranges.some(
			(range) =>
				range.role === scope.role &&
				scope.start >= range.start &&
				scope.end <= range.end &&
				scope.end > scope.start,
		)
	)
		throw new Error(
			"Predecessor transcript access is restricted. Use explicit handoff outputs, decisions and original evidence. For targeted recovery, configure a diagnostic purpose and exact current-run role/message range in a saved recipe copy/new run; free-form requests cannot grant access.",
		);
}

/** The same recorded allowance also bounds raw source capture before detachment. */
export function transcriptMaterializationAllowance(
	access: FactoryContextAccess,
): number {
	return transaction(
		access,
		(receipt) =>
			access.policy.transcripts!.utf8Bytes +
			receipt.grants.reduce((sum, grant) => sum + grant.utf8Bytes, 0),
	);
}
export function refuseTranscriptMaterialization(
	access: FactoryContextAccess,
	scope: TranscriptScope,
): never {
	requireTranscriptScope(access, scope);
	const expected = transaction(access, (receipt) => {
		receipt.blocked = { scope, reason: "transcript-capture-allowance" };
		return {
			pages: receipt.pages,
			utf8Bytes: receipt.utf8Bytes,
			grants: receipt.grants.length,
		};
	});
	throw new Error(
		`Original transcript range exceeds its authorized UTF-8 capture allowance for ${access.work}; no oversized source was detached or handed off. Select a narrower original role/message range or ${access.policy.transcripts?.extension ? "request the configured bounded transcriptExtension through operate-authorized retry_run" : "adopt a bounded diagnostic policy in a saved copy/new run"}. Preserve this source gap; expectedPages=${expected.pages}, expectedUtf8Bytes=${expected.utf8Bytes}, expectedGrants=${expected.grants}. No evidence or delivery is approved.`,
	);
}

/** Reserve exact delivered UTF-8 payload bytes before materializing/returning a page. */
export function chargeTranscriptPage(
	access: FactoryContextAccess,
	scope: TranscriptScope,
	utf8Bytes: number,
): void {
	requireTranscriptScope(access, scope);
	const refusal = transaction(access, (receipt) => {
		const grant = access.policy.transcripts!;
		const bytes =
			grant.utf8Bytes +
			receipt.grants.reduce((sum, item) => sum + item.utf8Bytes, 0);
		const pages =
			grant.pages + receipt.grants.reduce((sum, item) => sum + item.pages, 0);
		if (receipt.pages + 1 > pages || receipt.utf8Bytes + utf8Bytes > bytes) {
			receipt.blocked = { scope, reason: "cumulative-transcript-allowance" };
			return `Transcript allowance exhausted for ${access.work}: ${receipt.pages}/${pages} pages, ${receipt.utf8Bytes}/${bytes} UTF-8 bytes. No partial page was returned. ${grant.extension ? "An operate-authorized retry_run may request transcriptExtension with this work, reason and expectedPages/expectedUtf8Bytes/expectedGrants" : "No extension is configured; adopt a bounded diagnostic policy in a saved copy/new run"}. Expected counters: ${receipt.pages}, ${receipt.utf8Bytes}, ${receipt.grants.length}. This does not approve evidence or delivery.`;
		}
		receipt.pages++;
		receipt.utf8Bytes += utf8Bytes;
		return undefined;
	});
	if (refusal) throw new Error(refusal);
}

/** Existing operate authorization owns this call; a context MCP client cannot extend itself. */
export function extendTranscriptAccess(
	access: FactoryContextAccess,
	request: TranscriptExtension,
) {
	const extension = access.policy.transcripts?.extension;
	if (!extension || request.work !== access.work)
		throw new Error(
			"No bounded transcript extension is configured for this work",
		);
	return transaction(access, (receipt) => {
		if (
			!receipt.blocked ||
			receipt.pages !== request.expectedPages ||
			receipt.utf8Bytes !== request.expectedUtf8Bytes ||
			receipt.grants.length !== request.expectedGrants
		)
			throw new Error(
				"Transcript allowance changed or is not blocked; inspect its exact refusal before extending",
			);
		requireTranscriptScope(access, receipt.blocked.scope);
		if (receipt.grants.length >= 32)
			throw new Error(
				"Transcript extension record limit reached; create a separately scoped diagnostic run",
			);
		const grant = {
			at: new Date().toISOString(),
			reason: request.reason,
			...extension,
		};
		receipt.grants.push(grant);
		delete receipt.blocked;
		return grant;
	});
}
