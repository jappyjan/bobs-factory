import { createHash, randomUUID } from "node:crypto";
import {
	type DispatchControl,
	type IIssueTrackerService,
	type McpServerConfig,
	UnsentDispatchError,
	type ViewDeliveryControl,
} from "bobs-factory-core";
import { z } from "zod";
import { externalCompletionProven } from "./Delivery.js";
import { isPullRequestSource } from "./GitProviderReference.js";
import { issueSnapshot } from "./issueSnapshot.js";
import {
	type TicketReference,
	TicketReferenceSchema,
} from "./TicketReference.js";
import { outputForTool } from "./ToolBindings.js";
import { publicViewRecord } from "./ViewPresentation.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

export {
	type TicketReference,
	TicketReferenceSchema,
} from "./TicketReference.js";
export type TicketStage = "in_progress" | "in_review" | "done";
export interface TicketMilestone {
	key: string;
	body: string;
	purpose?: "documentation" | "operational";
	deliveryId?: string;
	/** Original Taskbot wire input, retained across ambiguous responses and newer displays. */
	commentAttempt?: { body: string; state: "pending" | "absent" | "confirmed" };
	stage?: TicketStage;
	stageSuperseded?: boolean;
	stageApplied?: boolean;
	pr?: string;
	merged?: boolean;
	completion?: { mode: "external" | "mixed"; digest: string; reviewId: string };
	delivered?: boolean;
	superseded?: boolean;
	error?: string;
	conflict?: boolean;
	limitation?: string;
	/** Runtime-owned public human display, never an agent-provided action. */
	viewDecision?: { batchId: string; digest: string };
}
export interface TicketSync {
	receipts: TicketMilestone[];
	lastStatus?: string;
	error?: string;
	transcript?: {
		externalLink?: string;
		sessionId?: string;
		createAttempted?: boolean;
		error?: string;
	};
}
export interface TicketSnapshot {
	comments: { body: string }[];
	attachments: { url: string }[];
	[key: string]: unknown;
}
export interface TicketAdapter {
	reconcile?(
		receipt: TicketMilestone,
	): Promise<"pending" | "delivered" | "superseded" | undefined>;
	read(purpose?: "tracking"): Promise<TicketSnapshot>;
	matchesStage?(stage: TicketStage, snapshot: TicketSnapshot): Promise<boolean>;
	stage(
		stage: TicketStage,
		snapshot: TicketSnapshot,
	): Promise<string | undefined>;
	comment(body: string, dispatch?: ViewDeliveryControl): Promise<void>;
	publish?(
		receipt: TicketMilestone,
		documentationBody: string,
		beforeWrite?: () => Promise<boolean>,
		dispatch?: ViewDeliveryControl,
	): Promise<undefined | false>;
	link(url: string): Promise<void>;
}

export function taskbotSource(
	source: string,
):
	| Omit<Extract<TicketReference, { provider: "taskbot" }>, "server">
	| undefined {
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		return;
	}
	const match = url.pathname.match(/^\/p\/([a-z0-9-]+)\/t\/([1-9]\d*)\/?$/);
	if (
		!match ||
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		return;
	const id = Number(match[2]);
	if (!Number.isSafeInteger(id)) return;
	return {
		provider: "taskbot",
		instance: url.origin,
		project: match[1]!,
		id,
		url: `${url.origin}/p/${match[1]}/t/${id}`,
	};
}

/** Only launch instructions designate origins; never scan a fetched ticket or history. */
export function originatingTicket(
	prompt: string,
	source?: string,
): string | undefined {
	if (source && !isPullRequestSource(source)) return source;
	let fenced = false;
	const candidates = new Set<string>();
	for (const line of prompt.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced || /^\s*>/.test(line)) continue;
		const match = line
			.trim()
			.match(
				/^(?:(task(?: source)?|ticket|source(?: of truth)?)\s*:\s*)?(https?:\/\/\S+)\s*$/i,
			);
		const value = match?.[2];
		if (
			value &&
			!isPullRequestSource(value) &&
			(match?.[1] ||
				taskbotSource(value) ||
				/\/p\/[^/]+\/t\//.test(value) ||
				/^https:\/\/linear\.app\/[^/]+\/issue\//.test(value))
		)
			candidates.add(value);
	}
	if (candidates.size > 1)
		throw new Error(
			"Multiple originating tickets in launch instructions. Supply one explicit ticket source before starting work.",
		);
	return [...candidates][0];
}

/** Bind HTTP Taskbot to the URL's actual instance, not a same-numbered ticket. */
export function taskbotServer(
	instance: string,
	servers: Record<string, McpServerConfig>,
): string {
	const matches = Object.entries(servers).filter(([, config]) => {
		if (!("url" in config) || !config.url) return false;
		try {
			return new URL(config.url).origin === instance;
		} catch {
			return false;
		}
	});
	if (matches.length !== 1)
		throw new Error(
			`Ticket tracking needs exactly one configured MCP HTTP/SSE transport for ${instance}; found ${matches.length}. Configure its instance URL and allowed Taskbot tools.`,
		);
	return matches[0]![0];
}

export function mcpValue(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	const result = value as {
		isError?: boolean;
		structuredContent?: unknown;
		content?: { type: string; text?: string }[];
	};
	if (result.isError)
		throw new Error(
			`Ticket MCP operation failed: ${JSON.stringify(result.content)}`,
		);
	if (result.structuredContent !== undefined)
		return mcpValue(result.structuredContent);
	if (result.content) {
		const text = result.content
			.filter((item) => item.type === "text")
			.map((item) => item.text ?? "")
			.join("\n");
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(
				`Ticket MCP returned invalid JSON: ${text.slice(0, 300)}`,
			);
		}
	}
	return value;
}
class StatusConflict extends Error {}
export function taskbotAdapter(
	ref: Extract<TicketReference, { provider: "taskbot" }>,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
	guardedCall?: (
		tool: string,
		args: Record<string, unknown>,
		dispatch: DispatchControl,
	) => Promise<unknown>,
): TicketAdapter {
	const args = { project: ref.project, id: ref.id };
	const invoke = async (
		tool: string,
		extra: Record<string, unknown> = {},
		dispatch?: DispatchControl,
	) => {
		if (dispatch && !guardedCall) throw new UnsentDispatchError("unavailable");
		const result = dispatch
			? await guardedCall!(tool, { ...args, ...extra }, dispatch)
			: await call(tool, { ...args, ...extra });
		if (tool === "get_ticket") return mcpValue(result);
		if (
			result &&
			typeof result === "object" &&
			((result as { isError?: boolean }).isError ||
				(result as { error?: unknown }).error)
		)
			throw new Error(`Taskbot ${tool} failed: ${JSON.stringify(result)}`);
		return result;
	};
	const read = async (): Promise<TicketSnapshot> => {
		const raw = await invoke("get_ticket");
		const ticket = z
			.object({
				id: z.literal(ref.id),
				status: z.enum([
					"backlog",
					"todo",
					"in_progress",
					"in_review",
					"done",
					"cancelled",
				]),
				comments: z.array(z.object({ body: z.string() }).passthrough()),
				attachments: z.array(
					z.union([
						z.object({ url: z.string() }).passthrough(),
						// Uploaded files have no external URL; their ID names a download
						// on the verified Taskbot instance and project.
						z
							.object({
								kind: z.literal("file"),
								id: z.number().int().positive(),
								url: z.null(),
							})
							.passthrough()
							.transform((file) => ({
								...file,
								url: `${ref.instance}/api/${ref.project}/files/${file.id}`,
							})),
					]),
				),
			})
			.passthrough()
			.parse(raw);
		// Taskbot's get_ticket is an unpaginated full-ticket contract. Reject a
		// partial implementation rather than silently losing provider records.
		if (
			ticket.nextOffset != null ||
			ticket.has_more === true ||
			ticket.next_cursor != null
		)
			throw new Error(
				"Taskbot get_ticket returned partial context; full-ticket transport required",
			);
		if (ticket.project != null && ticket.project !== ref.project)
			throw new Error("Taskbot returned another project");
		return { ...ticket, url: ref.url };
	};
	return {
		read,
		async stage(to, snapshot) {
			if (["done", "cancelled"].includes(String(snapshot.status)))
				return snapshot.status === to
					? undefined
					: "Terminal ticket retained; verify ownership before changing it.";
			if (snapshot.status === to) return undefined;
			try {
				await invoke("set_status", {
					from: snapshot.status,
					to,
					author: "bobs-factory",
				});
			} catch (error) {
				const current = await read();
				if (current.status === to) return undefined;
				if (
					current.status === snapshot.status &&
					!/conflict|compare.and.swap/i.test(String(error))
				)
					throw error;
				throw new StatusConflict(
					`Taskbot status update uncertain or conflicted (${snapshot.status} → ${current.status}); expected ${to}. Reassess current ticket, then retry ticket synchronization. ${String(error)}`,
				);
			}
			return undefined;
		},
		async comment(body, dispatch) {
			await invoke("comment", { author: "bobs-factory", body }, dispatch);
		},
		async link(url) {
			await invoke("add_attachment", {
				kind: "pr",
				url,
				// Taskbot add_attachment has no author field. The accompanying
				// milestone comment records bobs-factory attribution.
				title: "Factory pull request",
			});
		},
	};
}

/** Reuse a verified binding; ambiguous provider creation is reconciled, never blindly repeated. */
export async function ensureTicketTranscript(
	run: FactoryRun,
	tracker: IIssueTrackerService,
	save: (run: FactoryRun) => void | Promise<void>,
	existingSessionId?: string,
	externalLink?: string,
): Promise<string> {
	const ref = TicketReferenceSchema.parse(run.ticketReference);
	if (ref.provider !== "native" || ref.platform !== "linear")
		throw new Error(
			"Linear transcript requires a verified native Linear ticket",
		);
	run.ticketSync ??= { receipts: [] };
	run.ticketSync.transcript ??= {};
	const binding = run.ticketSync.transcript;
	if (binding.sessionId) return binding.sessionId;
	if (existingSessionId) {
		binding.sessionId = existingSessionId;
		delete binding.error;
		await save(run);
		return existingSessionId;
	}
	if (!externalLink || !tracker.findAgentSessionForExternalLink)
		throw new Error(
			"Manual Linear transcript needs a configured HTTPS Factory origin and session reconciliation; operational delivery retained",
		);
	const link = new URL(externalLink);
	if (
		link.protocol !== "https:" ||
		link.username ||
		link.password ||
		link.pathname !== "/" ||
		link.search ||
		link.hash !== `#/runs/${encodeURIComponent(run.id)}`
	)
		throw new Error(
			"Factory transcript link must identify this run on its configured HTTPS origin",
		);
	if (binding.externalLink && binding.externalLink !== externalLink)
		throw new Error(
			"Factory transcript origin changed during pending creation; reconcile the original binding first",
		);
	binding.externalLink = externalLink;
	let creatingNow = false;
	try {
		const found = await tracker.findAgentSessionForExternalLink(
			ref.id,
			externalLink,
		);
		if (found) {
			binding.sessionId = found;
			delete binding.error;
			await save(run);
			return found;
		}
		if (binding.createAttempted)
			throw new Error(
				"Manual Linear transcript creation remains unconfirmed; retain the original identity until the provider confirms it",
			);
		binding.createAttempted = true;
		await save(run);
		creatingNow = true;
		const result = await tracker.createAgentSessionOnIssue({
			issueId: ref.id,
			externalLink,
		});
		if (!result.success) {
			binding.createAttempted = false;
			throw new Error("Linear rejected transcript session creation");
		}
		const id = result.agentSessionId ?? (await result.agentSession)?.id;
		if (!id)
			throw new Error("Linear transcript creation returned no session receipt");
		binding.sessionId = id;
		delete binding.error;
		await save(run);
		return id;
	} catch (error) {
		const type = (error as { type?: string }).type;
		if (
			creatingNow &&
			[
				"Ratelimited",
				"InvalidInput",
				"Forbidden",
				"AuthenticationError",
			].includes(type ?? "")
		)
			binding.createAttempted = false;
		binding.error = error instanceof Error ? error.message : String(error);
		await save(run);
		throw error;
	}
}

export function nativeAdapter(
	ref: Extract<TicketReference, { provider: "native" }>,
	tracker: IIssueTrackerService,
	options?: { getTranscriptSession: () => Promise<string> },
): TicketAdapter {
	const selectedState = async (
		stage: TicketStage,
		snapshot: TicketSnapshot,
	) => {
		const team = snapshot.team as { id?: string } | undefined;
		if (!team?.id)
			throw new Error("Originating ticket has no team for status resolution");
		const states = [];
		let after: string | undefined;
		const seen = new Set<string>();
		do {
			const page = await tracker.fetchWorkflowStates(team.id, {
				first: 100,
				...(after ? { after } : {}),
			});
			states.push(...page.nodes);
			if (!page.pageInfo?.hasNextPage) break;
			after = page.pageInfo.endCursor ?? undefined;
			if (!after || seen.has(after))
				throw new Error("Ticket state pagination did not advance");
			seen.add(after);
		} while (after);
		const selected = states.find((s) =>
			stage === "done"
				? s.type === "completed"
				: s.type === "started" &&
					(stage === "in_review"
						? /review/i.test(s.name)
						: !/review/i.test(s.name)),
		);
		return selected;
	};
	return {
		async read(purpose) {
			const read = async () => {
				const issue = await tracker.fetchIssue(ref.id);
				const snapshot = (await issueSnapshot(
					issue,
					purpose === "tracking" ? [] : await tracker.getIssueLabels(issue.id),
					tracker,
					purpose,
				)) as TicketSnapshot;
				if (purpose === "tracking") return snapshot;
				const state = await issue.state;
				return {
					...snapshot,
					state: state
						? { id: state.id, name: state.name, type: state.type }
						: undefined,
				};
			};
			return purpose === "tracking" && tracker.withBackgroundRequests
				? tracker.withBackgroundRequests(read)
				: read();
		},
		async matchesStage(stage, snapshot) {
			const selected = await selectedState(stage, snapshot);
			return (
				!!selected &&
				(snapshot.state as { id?: string } | undefined)?.id === selected.id
			);
		},
		async stage(stage, snapshot) {
			const state = snapshot.state as
				| { id?: string; name?: string; type?: string }
				| undefined;
			if (["completed", "canceled"].includes(state?.type ?? ""))
				return stage === "done" && state?.type === "completed"
					? undefined
					: "Terminal ticket retained; verify ownership before changing it.";
			const selected = await selectedState(stage, snapshot);
			if (!selected)
				return `Tracker has no ${stage} state; retained nonterminal status. Lifecycle stage is recorded in this comment.`;
			if (state?.id !== selected.id) {
				try {
					await tracker.updateIssue(ref.id, { stateId: selected.id });
				} catch (error) {
					const current = await (await tracker.fetchIssue(ref.id)).state;
					if (current?.id !== selected.id) throw error;
				}
			}
			return undefined;
		},
		async comment(body, dispatch) {
			if (dispatch && ref.platform !== "cli")
				throw new UnsentDispatchError("unavailable");
			await tracker.createComment(
				ref.id,
				{ body },
				...(dispatch ? [{ view: dispatch }] : []),
			);
		},
		...(ref.platform === "linear"
			? {
					reconcile: (receipt: TicketMilestone) =>
						receipt.deliveryId && tracker.reconcileAgentActivityDelivery
							? tracker.reconcileAgentActivityDelivery(receipt.deliveryId)
							: Promise.resolve(undefined),
					async publish(
						receipt: TicketMilestone,
						documentationBody: string,
						beforeWrite?: () => Promise<boolean>,
						dispatch?: ViewDeliveryControl,
					) {
						if (receipt.purpose === "documentation" && !receipt.merged) {
							if (dispatch) throw new UnsentDispatchError("unavailable");
							if (beforeWrite && !(await beforeWrite())) return false;
							await tracker.createComment(ref.id, { body: documentationBody });
							return;
						}
						if (!options)
							throw new Error(
								"Linear transcript binding unavailable; operational delivery retained without an issue comment",
							);
						const sessionId = await options.getTranscriptSession();
						if (!sessionId)
							throw new Error("Verified Linear transcript session unavailable");
						// Transcript discovery/creation can await a remote provider. Recheck
						// current display authority after it, immediately before the write.
						if (beforeWrite && !(await beforeWrite())) return false;
						const result = await tracker.createAgentActivity(
							{
								id: receipt.deliveryId,
								agentSessionId: sessionId,
								content: {
									type: receipt.key.startsWith("outcome:failed:")
										? "error"
										: receipt.merged ||
												/^outcome:(completed|stopped):/.test(receipt.key)
											? "response"
											: /^(questions|review):/.test(receipt.key)
												? "elicitation"
												: "thought",
									body: receipt.merged ? documentationBody : receipt.body,
								},
							},
							...(dispatch ? [{ view: dispatch }] : []),
						);
						if (!result.success)
							throw new Error("Linear transcript delivery was rejected");
						return undefined;
					},
				}
			: {}),
		async link(url) {
			if (!tracker.linkPullRequest)
				throw new Error(
					"Tracker does not support PR links; restore a supported tracker adapter",
				);
			await tracker.linkPullRequest(ref.id, url, "Factory pull request");
		},
	};
}

/** Persist first; newer status intent does not discard pending documentation or links. */
export function recordTicketMilestone(
	run: FactoryRun,
	milestone: TicketMilestone,
): void {
	if (!run.ticketReference || run.workflow.id === "simple") return;
	if (milestone.stage === "done") {
		if (
			run.delivery?.contract.mode === "external" ||
			run.delivery?.contract.mode === "mixed"
		) {
			if (
				!externalCompletionProven(run) ||
				!milestone.completion ||
				milestone.completion.digest !== run.delivery.verification?.digest ||
				(run.delivery.contract.mode === "mixed" &&
					(outputForTool(run, "merge") as { merged?: boolean } | undefined)
						?.merged !== true)
			)
				throw new Error(
					"Done requires the accepted external completion proof and all mixed repository merges",
				);
		} else if (!milestone.merged)
			throw new Error("Done requires a confirmed merge receipt");
	}
	run.ticketSync ??= { receipts: [] };
	if (run.ticketSync.receipts.some((receipt) => receipt.key === milestone.key))
		return;
	if (milestone.stage)
		for (const receipt of run.ticketSync.receipts)
			if (!receipt.delivered && receipt.stage && !receipt.merged)
				receipt.stageSuperseded = true;
	run.ticketSync.receipts.push({ ...milestone });
}

/** Durable outbox. Errors are visible but do not replay development or merge. */
export class TicketTracking {
	private queues = new Map<string, Promise<void>>();
	private stopped = false;
	private updateMaintenance = false;
	isBusy(): boolean {
		return this.queues.size > 0;
	}
	setUpdateMaintenance(active: boolean): void {
		this.updateMaintenance = active;
		if (active) {
			for (const timer of this.retries.values()) clearTimeout(timer);
			this.retries.clear();
		}
	}
	private retries = new Map<string, ReturnType<typeof setTimeout>>();
	private viewState(run: FactoryRun, receipt: TicketMilestone) {
		if (!receipt.viewDecision) {
			// Old saved waits used a batch-only outbox key. Associate only an
			// exact runtime-owned human batch; Show and other receipts retain
			// their existing behavior. Never relabel its original body/digest.
			const legacy = run.viewRecords?.find(
				(record) =>
					record.snapshot.kind !== "show" &&
					!(
						record.snapshot.kind === "display" && !record.snapshot.interactive
					) &&
					receipt.key === `view:${record.snapshot.id}`,
			);
			if (!legacy) return "current";
			const prefix = `${legacy.snapshot.kind}\nDecision batch: ${legacy.snapshot.id}\nDisplayed digest: `;
			const originalDigest = receipt.body.startsWith(prefix)
				? receipt.body.slice(prefix.length).split("\n", 1)[0]
				: undefined;
			if (!originalDigest || !/^[a-f0-9]{64}$/.test(originalDigest)) {
				receipt.superseded = true;
				receipt.limitation =
					"This legacy display has no verifiable current digest; use the renewed dashboard decision.";
				delete receipt.error;
				return "superseded";
			}
			receipt.viewDecision = {
				batchId: legacy.snapshot.id,
				digest: originalDigest,
			};
		}
		const version = receipt.viewDecision;
		const record = run.viewRecords?.find(
			(record) => record.snapshot.id === version.batchId,
		);
		if (
			!record ||
			record.answer ||
			record.superseded ||
			["completed", "failed", "stopped"].includes(run.status) ||
			publicViewRecord(run.id, record).digest !== version.digest ||
			(run.viewDecision &&
				(run.viewDecision.id !== version.batchId ||
					run.viewDecision.digest !== version.digest))
		) {
			receipt.superseded = true;
			receipt.limitation =
				"A newer decision display or accepted answer replaced this unsent version.";
			delete receipt.error;
			return "superseded";
		}
		return run.status === "waiting" && run.viewDecision
			? "current"
			: "deferred";
	}
	private async validateViewPublication(
		run: FactoryRun,
		receipt: TicketMilestone,
	) {
		if (this.viewState(run, receipt) !== "current") return false;
		if (!receipt.viewDecision) return true;
		if (!this.checkView)
			throw new Error(
				"Current decision delivery requires runtime display validation",
			);
		if (await this.checkView(run, receipt.viewDecision))
			return this.viewState(run, receipt) === "current";
		receipt.superseded = true;
		receipt.limitation =
			"The active decision or its displayed content changed before delivery; use the renewed decision.";
		delete receipt.error;
		return false;
	}
	stop(): void {
		this.stopped = true;
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
	}
	constructor(
		private adapter: (run: FactoryRun) => Promise<TicketAdapter>,
		private save: (run: FactoryRun) => void | Promise<void>,
		private log: (run: FactoryRun, message: string) => void,
		private checkExternal?: (run: FactoryRun) => Promise<boolean>,
		private checkView?: (
			run: FactoryRun,
			version: NonNullable<TicketMilestone["viewDecision"]>,
		) => Promise<boolean>,
		private dispatchView?: <T>(
			run: FactoryRun,
			version: NonNullable<TicketMilestone["viewDecision"]>,
			write: () => T,
		) => Promise<{ value: T }>,
	) {}
	async record(run: FactoryRun, milestone: TicketMilestone): Promise<void> {
		if (!run.ticketReference || run.workflow.id === "simple") return;
		recordTicketMilestone(run, milestone);
		const persisted = Promise.resolve(this.save(run));
		await this.flush(run, false, persisted);
	}
	async flush(
		run: FactoryRun,
		reassess = false,
		persisted: Promise<void> = Promise.resolve(),
	): Promise<void> {
		if (!run.ticketReference || !run.ticketSync || this.updateMaintenance)
			return;
		const ref = TicketReferenceSchema.parse(run.ticketReference);
		const ticketKey =
			ref.provider === "taskbot"
				? `${ref.instance}/${ref.project}/${ref.id}`
				: `${ref.workspaceId}/${ref.id}`;
		const previous = this.queues.get(ticketKey) ?? Promise.resolve();
		const work = previous
			.catch(() => {})
			.then(async () => {
				await persisted;
				const sync = run.ticketSync!;
				for (const receipt of sync.receipts) {
					// Finish the current receipt naturally, then park even flushes
					// accepted before the freeze. Their intent is already durable.
					if (this.updateMaintenance) break;
					if (
						!receipt.delivered &&
						(receipt.viewDecision ||
							run.viewRecords?.some(
								(record) =>
									record.snapshot.kind !== "show" &&
									!(
										record.snapshot.kind === "display" &&
										!record.snapshot.interactive
									) &&
									receipt.key === `view:${record.snapshot.id}`,
							)) &&
						receipt.deliveryId &&
						ref.provider === "taskbot" &&
						receipt.commentAttempt?.state !== "absent"
					) {
						// A newer display cannot establish that an earlier mutation was
						// unsent. Resolve its original marker/input before viewState can
						// retire it, including crash gaps and pre-field saved receipts.
						try {
							const marker = `<!-- factory:${run.id}:${createHash("sha256").update(receipt.key).digest("hex").slice(0, 20)} -->`;
							const original =
								receipt.commentAttempt?.body ?? `${receipt.body}\n\n${marker}`;
							const snapshot = await (await this.adapter(run)).read("tracking");
							const found = snapshot.comments.filter((comment) =>
								comment.body.includes(marker),
							);
							if (found.some((comment) => comment.body !== original))
								throw new StatusConflict(
									"Original decision delivery marker has different content; retain its identity for reconciliation.",
								);
							receipt.commentAttempt = {
								body: original,
								state: found.length ? "confirmed" : "absent",
							};
							if (found.length) {
								receipt.delivered = true;
								delete receipt.superseded;
								delete receipt.error;
								delete receipt.conflict;
							}
							sync.error = sync.receipts.find(
								(r) => !r.delivered && !r.superseded && r.error,
							)?.error;
							await this.save(run);
						} catch (error) {
							delete receipt.superseded;
							receipt.conflict = error instanceof StatusConflict;
							receipt.error =
								error instanceof Error
									? error.message
									: "Original Taskbot delivery requires reconciliation";
							sync.error = receipt.error;
							await this.save(run);
							break;
						}
					}
					if (
						!receipt.delivered &&
						receipt.viewDecision &&
						receipt.deliveryId &&
						ref.provider === "native" &&
						ref.platform === "linear"
					) {
						try {
							const state = await (await this.adapter(run)).reconcile?.(
								receipt,
							);
							if (state === "delivered") {
								receipt.delivered = true;
								delete receipt.superseded;
								delete receipt.error;
							} else if (state === "superseded") receipt.superseded = true;
							await this.save(run);
						} catch (error) {
							receipt.error =
								error instanceof Error
									? error.message
									: "Prior Linear delivery requires reconciliation";
							sync.error = receipt.error;
							await this.save(run);
							break;
						}
					}
					if (
						receipt.delivered ||
						receipt.superseded ||
						(receipt.conflict && !reassess)
					)
						continue;
					if (this.viewState(run, receipt) !== "current") {
						sync.error = sync.receipts.find(
							(r) => !r.delivered && !r.superseded && r.error,
						)?.error;
						await this.save(run);
						continue;
					}
					try {
						if (receipt.stage === "done" && receipt.completion) {
							if (
								!externalCompletionProven(run) ||
								receipt.completion.digest !==
									run.delivery?.verification?.digest ||
								!this.checkExternal ||
								!(await this.checkExternal(run))
							)
								throw new StatusConflict(
									"Accepted external state changed or could not be verified. Renew independent verification and human acceptance before closing the ticket.",
								);
						}
						const adapter = await this.adapter(run);
						let snapshot = await adapter.read("tracking");
						if (this.viewState(run, receipt) !== "current") continue;
						const statusOf = (snapshot: TicketSnapshot) =>
							String(
								snapshot.status ??
									(snapshot.state as { name?: string } | undefined)?.name ??
									"",
							);
						const merged = sync.receipts.some((r) => r.merged && !r.superseded);
						const applyStage =
							receipt.stage &&
							!receipt.stageSuperseded &&
							(!merged || receipt.merged || receipt.completion);
						const terminal =
							["done", "cancelled"].includes(String(snapshot.status)) ||
							["completed", "canceled"].includes(
								String((snapshot.state as { type?: string } | undefined)?.type),
							);
						if (
							terminal &&
							!receipt.merged &&
							!receipt.completion &&
							!reassess
						) {
							// Late progress from an older attempt is obsolete once the
							// ticket is closed. Persist that decision to keep restarts quiet.
							// Confirmed merges still deliver their evidence and PR link.
							receipt.superseded = true;
							receipt.limitation =
								"Terminal ticket retained; stale progress omitted.";
							delete receipt.error;
							delete receipt.conflict;
							continue;
						}
						if (
							applyStage &&
							!reassess &&
							sync.lastStatus &&
							sync.lastStatus !== statusOf(snapshot) &&
							!terminal &&
							snapshot.status !== receipt.stage &&
							!(await adapter.matchesStage?.(receipt.stage!, snapshot))
						)
							throw new StatusConflict(
								`Ticket status changed outside this run (${sync.lastStatus} → ${statusOf(snapshot)}). Reassess ownership and intent before retrying ticket synchronization.`,
							);
						if (
							receipt.pr &&
							!snapshot.attachments.some(
								(a) => canonicalPr(a.url) === canonicalPr(receipt.pr!),
							)
						) {
							await adapter.link(receipt.pr);
							snapshot = await adapter.read("tracking");
						}

						if (applyStage && !receipt.stageApplied) {
							receipt.limitation = await adapter.stage(
								receipt.stage!,
								snapshot,
							);
							receipt.stageApplied = true;
						}
						sync.lastStatus = statusOf(await adapter.read("tracking"));
						await this.save(run);
						const marker = `<!-- factory:${run.id}:${createHash("sha256").update(receipt.key).digest("hex").slice(0, 20)} -->`;
						const alreadyDocumented =
							receipt.purpose === "documentation" &&
							snapshot.comments.some(
								(comment) =>
									comment.body
										.replace(/\n\n<!-- factory:[^\n]+ -->$/, "")
										.trim() === receipt.body.trim(),
							);
						if (
							!alreadyDocumented &&
							!snapshot.comments.some((c) => c.body.includes(marker))
						) {
							receipt.deliveryId ??= randomUUID();
							await this.save(run);
							if (!(await this.validateViewPublication(run, receipt))) continue;
							const body = `${receipt.body}${receipt.limitation ? `\n\nTracking limitation: ${receipt.limitation}` : ""}\n\n${marker}`;
							if (receipt.viewDecision && ref.provider === "taskbot") {
								if (
									receipt.commentAttempt &&
									receipt.commentAttempt.body !== body
								)
									throw new StatusConflict(
										"Original decision delivery input cannot change under its delivery ID.",
									);
								receipt.commentAttempt = { body, state: "pending" };
								// Persist a conservative crash-gap intent before provider preparation.
								// The final mutation guard still decides whether to dispatch.
								await this.save(run);
							}
							const dispatch: ViewDeliveryControl | undefined =
								receipt.viewDecision
									? {
											identity: {
												version: 1,
												runId: run.id,
												receiptKey: receipt.key,
												...receipt.viewDecision,
												deliveryId: receipt.deliveryId,
											},
											run: async (write) => {
												if (!this.dispatchView)
													throw new UnsentDispatchError("unavailable");
												return this.dispatchView(
													run,
													receipt.viewDecision!,
													() => {
														if (this.viewState(run, receipt) !== "current")
															throw new UnsentDispatchError("superseded");
														return write();
													},
												);
											},
										}
									: undefined;
							if (adapter.publish) {
								if (
									(await adapter.publish(
										receipt,
										body,
										() => this.validateViewPublication(run, receipt),
										dispatch,
									)) === false
								)
									continue;
							} else await adapter.comment(body, dispatch);
						}
						receipt.delivered = true;
						if (receipt.commentAttempt)
							receipt.commentAttempt.state = "confirmed";
						delete receipt.error;
						delete receipt.conflict;
					} catch (error) {
						if (
							error instanceof UnsentDispatchError &&
							error.reason === "superseded"
						) {
							receipt.superseded = true;
							receipt.limitation = error.message;
							if (receipt.commentAttempt)
								receipt.commentAttempt.state = "absent";
							delete receipt.error;
							continue;
						}
						receipt.error =
							error instanceof Error ? error.message : String(error);
						receipt.conflict = error instanceof StatusConflict;
						if (sync.error !== receipt.error)
							this.log(
								run,
								`Ticket synchronization pending (${receipt.key}): ${receipt.error}. Retry ticket synchronization after restoring access or reassessing the conflict; completed work is retained.`,
							);
						break;
					} finally {
						sync.error = sync.receipts.find(
							(r) => !r.delivered && !r.superseded && r.error,
						)?.error;
						await this.save(run);
					}
				}
			});
		this.queues.set(ticketKey, work);
		try {
			await work;
		} finally {
			if (this.queues.get(ticketKey) === work) this.queues.delete(ticketKey);
		}
		const pending = run.ticketSync.receipts.find(
			(r) => !r.delivered && !r.superseded && r.error,
		);
		if (
			pending &&
			!this.stopped &&
			!this.updateMaintenance &&
			!pending.conflict &&
			!this.retries.has(run.id)
		) {
			const timer = setTimeout(() => {
				this.retries.delete(run.id);
				void this.flush(run);
			}, 30000);
			timer.unref();
			this.retries.set(run.id, timer);
		}
	}
}
export function canonicalPr(url: string): string {
	return url.replace(/\/$/, "").toLowerCase();
}

/** Reconciliation needs provider evidence and a proven association, never status alone. */
export function classifyTicketRepair(input: {
	associated: boolean;
	deferred?: boolean;
	runStatus?: FactoryRun["status"];
	step?: string;
	pr?: { state: string; mergedAt?: string | null };
}): { stage?: TicketStage; reason: string } {
	if (!input.associated)
		return {
			reason: "No proven run/PR association; retain current ticket status.",
		};
	if (input.pr?.state === "MERGED" && input.pr.mergedAt)
		return {
			stage: "done",
			reason: "The Git provider confirms the associated coding PR merged.",
		};
	if (input.pr?.state === "CLOSED")
		return {
			reason:
				"Associated PR closed without merge; remaining work requires reassessment.",
		};
	if (input.deferred)
		return {
			reason:
				"Work is explicitly deferred and has no confirmed merge; retain backlog.",
		};
	if (
		input.pr?.state === "OPEN" &&
		/(?:human-review|merge)$/.test(input.step ?? "")
	)
		return {
			stage: "in_review",
			reason: "Waiting for human/provider action; merge is not confirmed.",
		};
	if (
		["running", "waiting", "failed", "interrupted"].includes(
			input.runStatus ?? "",
		)
	)
		return {
			stage: "in_progress",
			reason: "Active, corrective or blocked work is nonterminal.",
		};
	return {
		reason: "No verified coding completion or active work; retain open status.",
	};
}
