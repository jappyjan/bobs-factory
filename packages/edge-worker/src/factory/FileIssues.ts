import { immutableJson } from "bobs-factory-core";
import { z } from "zod";
import {
	actionItems,
	FileIssueBodySchema,
	type FileIssuesConfiguration,
	FileIssuesConfigurationSchema,
	FileIssueTitleSchema,
} from "./ActionSteps.js";
import { digest } from "./EvidenceDigest.js";
import {
	type ForeachScope,
	foreachPointer,
	sanitizeJsonConfiguration,
} from "./Foreach.js";
import {
	type IssueDestination,
	IssueDestinationSchema,
} from "./IssueDestination.js";

export interface FileIssueAccepted {
	itemId: string;
	key: string;
	marker: string;
	title: string;
	body: string;
	labels: string[];
	priority?: number;
	destination: IssueDestination;
}
export interface FileIssueIntent extends FileIssueAccepted {
	phase: "pending" | "sending" | "uncertain" | "confirmed";
	id?: string;
	url?: string;
	/** Original confirmed provider evidence, separate from operational errors. */
	receipt?: { id: string; url: string };
	error?: string;
}
export interface FileIssueBatch {
	actionId: string;
	inputDigest: string;
	accepted: FileIssueAccepted[];
	items: FileIssueIntent[];
}
export interface FileIssuesOutput {
	tickets: Record<string, { id: string; url: string }>;
	summary: { total: number; confirmed: number; uncertain: number };
}
/** Snapshot all mappings before any provider call; caller persists this batch before dispatch. */
export function prepareFileIssues(
	runId: string,
	actionId: string,
	value: FileIssuesConfiguration,
	scope: ForeachScope,
	destination: IssueDestination,
): FileIssueBatch {
	const config = FileIssuesConfigurationSchema.parse(value);
	const target = IssueDestinationSchema.parse(
		sanitizeJsonConfiguration(destination),
	);
	const accepted = actionItems(config, scope).map((item): FileIssueAccepted => {
		const title = FileIssueTitleSchema.parse(
			foreachPointer(item.value, config.fields.title),
		);
		const body = FileIssueBodySchema.parse(
			foreachPointer(item.value, config.fields.body),
		);
		const labels = config.fields.labels
			? z
					.array(z.string().trim().min(1).max(100))
					.max(50)
					.parse(foreachPointer(item.value, config.fields.labels))
			: [];
		if (labels.some((label) => /^factory-file-issue-[a-f0-9]{64}$/.test(label)))
			throw new Error(
				"Issue labels cannot supply reserved Factory creation identities",
			);
		const key = digest([runId, actionId, item.id, "file-issue"]);
		const marker = `<!-- factory-file-issue:${key} -->`;
		return {
			itemId: item.id,
			key,
			marker,
			title,
			body: `${body}\n\n${marker}`,
			labels: [...new Set(labels)],
			destination: structuredClone(target),
		};
	});
	return {
		actionId,
		inputDigest: digest(accepted),
		accepted: immutableJson(accepted),
		items: accepted.map((item) => ({
			...structuredClone(item),
			phase: "pending",
		})),
	};
}
const dispatches = new WeakMap<FileIssueBatch, Promise<FileIssuesOutput>>();
/** One shared-object dispatch; provider markers/UUIDs reconcile process restart uncertainty. */
export function fileIssueBatch(
	batch: FileIssueBatch,
	send: (
		issue: FileIssueIntent,
		signal: AbortSignal,
	) => Promise<{ id: string; url: string }>,
	save: () => Promise<void>,
	signal: AbortSignal,
): Promise<FileIssuesOutput> {
	const active = dispatches.get(batch);
	if (active) return active;
	const operation = dispatchBatch(batch, send, save, signal);
	dispatches.set(batch, operation);
	void operation.finally(() => dispatches.delete(batch)).catch(() => {});
	return operation;
}
async function dispatchBatch(
	batch: FileIssueBatch,
	send: (
		issue: FileIssueIntent,
		signal: AbortSignal,
	) => Promise<{ id: string; url: string }>,
	save: () => Promise<void>,
	signal: AbortSignal,
): Promise<FileIssuesOutput> {
	if (
		digest(batch.accepted) !== batch.inputDigest ||
		batch.items.length !== batch.accepted.length
	)
		throw new Error("Accepted File issues intent integrity check failed");
	for (const [index, issue] of batch.items.entries()) {
		const original = batch.accepted[index]!;
		for (const name of [
			"itemId",
			"key",
			"marker",
			"title",
			"body",
			"labels",
			"destination",
		] as const)
			if (digest(issue[name]) !== digest(original[name]))
				throw new Error(
					"Accepted File issues mapping changed; retain original intents before retrying",
				);
	}
	await save();
	signal.throwIfAborted();
	const failures: string[] = [];
	for (const issue of batch.items) {
		signal.throwIfAborted();
		if (issue.phase === "confirmed") {
			if (
				!issue.receipt ||
				issue.id !== issue.receipt.id ||
				issue.url !== issue.receipt.url
			)
				throw new Error(
					"Confirmed File issues receipt is missing or changed; reconcile the original provider identity",
				);
			continue;
		}
		if (issue.phase === "sending") issue.phase = "uncertain";
		await save();
		signal.throwIfAborted();
		try {
			const result = z
				.object({ id: z.string().min(1), url: z.string().url() })
				.parse(await send(issue, signal));
			issue.id = result.id;
			issue.url = result.url;
			issue.receipt = immutableJson(result);
			issue.phase = "confirmed";
			delete issue.error;
			await save();
		} catch (error) {
			if ((issue as FileIssueIntent).phase === "sending")
				issue.phase = "uncertain";
			issue.error = error instanceof Error ? error.message : String(error);
			await save();
			if (signal.aborted) signal.throwIfAborted();
			failures.push(`${issue.itemId}: ${issue.error}`);
		}
	}
	if (failures.length)
		throw new Error(
			`File issues retains incomplete intents: ${failures.join("; ")}`,
		);
	return immutableJson({
		tickets: Object.fromEntries(
			batch.items.map((item) => [item.itemId, item.receipt!]),
		),
		summary: {
			total: batch.items.length,
			confirmed: batch.items.filter((item) => item.phase === "confirmed")
				.length,
			uncertain: batch.items.filter((item) => item.phase === "uncertain")
				.length,
		},
	});
}
