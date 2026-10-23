import { randomUUID } from "node:crypto";
import { immutableJson, UnsentDispatchError } from "bobs-factory-core";
import { digest } from "./Delivery.js";
import { releaseDelivery } from "./DeliveryCoordination.js";
import { foreachPointer, sanitizeJsonConfiguration } from "./Foreach.js";
import {
	DecideConfigurationSchema,
	decisionItems,
	ViewAnswerSchema,
	ViewAskSchema,
	ViewNotificationsSchema,
	type ViewRecord,
	type ViewSnapshot,
	viewAnswerOutput,
} from "./HumanStep.js";
import { launchBatchProjection } from "./LaunchRuns.js";
import { resolveStepConfig } from "./StepConfig.js";
import { availableViewPaths, resolveView, viewText } from "./View.js";
import { prepareViewAssetCheck, verifyViewAssets } from "./ViewAssets.js";
import {
	publicViewDecision,
	publicViewRecord,
	viewRecordDigest,
} from "./ViewPresentation.js";
import { humanViewText } from "./ViewText.js";
import { StepSchema, type WorkflowStep } from "./Workflow.js";
import type {
	ExecutionContext,
	FactoryRun,
	GraphCheckpoint,
	RuntimeHooks,
	WorkflowRuntime,
} from "./WorkflowRuntime.js";

/** Deliberately public operational projection; never raw child inputs or execution bindings. */
export function childRunsView(run: FactoryRun) {
	const waves: {
		id: string;
		label: string;
		runs: { id: string; title: string; status: string; note?: string }[];
	}[] = [];
	for (const [batchId, batch] of Object.entries(run.launchActions ?? {})) {
		const projection = launchBatchProjection(batch);
		for (const wave of [
			...new Set(projection.items.map((item) => item.wave)),
		].sort((a, b) => a - b)) {
			waves.push({
				id: `${batchId}-${wave}`,
				label: `${projection.key} · Wave ${wave + 1}`,
				runs: projection.items
					.filter((item) => item.wave === wave)
					.map((item) => ({
						id: item.runId,
						title: item.title,
						status: item.status,
						...(item.error ? { note: item.error } : {}),
						...(projection.paused
							? { note: "Dispatch paused; existing children continue" }
							: {}),
						...(projection.cancelled ? { note: "Batch stop retained" } : {}),
					})),
			});
		}
	}
	return { waves };
}

/** Read only named ordinary outputs or explicit public lexical sources, before cloning. */
export function viewScope(
	context: Pick<
		ExecutionContext,
		"run" | "step" | "outputs" | "callInputs" | "iteration"
	>,
) {
	const inputs: Record<string, unknown> = {};
	const source = context.step.view;
	const localReads =
		source && "components" in source ? source.reads : undefined;
	const reads: Record<string, { from: string; when?: unknown }> = localReads
		? Object.fromEntries(
				Object.entries(localReads).map(([key, from]) => [key, { from }]),
			)
		: resolveStepConfig(context.step).reads;
	for (const [name, binding] of Object.entries(reads)) {
		if (binding.when)
			throw new Error("View reads require unconditional explicit bindings");
		const from = binding.from;
		let value: unknown;
		if (from.startsWith("@")) {
			if (
				!/^@(callInputs(?:\/|$)|item(?:\/|$)|index$|launchInputs(?:\/|$)|childRuns$)/.test(
					from,
				)
			)
				throw new Error("Views cannot read private runtime sources");
			const sources = {
				callInputs: context.callInputs ?? {},
				item: context.iteration?.value,
				index: context.iteration?.index,
				launchInputs: context.run.launchInputs ?? {},
				childRuns: childRunsView(context.run),
			};
			value = foreachPointer(sources, `/${from.slice(1)}`);
		} else
			value = foreachPointer(
				context.outputs ?? context.run.outputs,
				`/${from}`,
			);
		if (value === undefined)
			throw new Error(`View input ${name} is unavailable`);
		inputs[name] = sanitizeJsonConfiguration(value);
	}
	return sanitizeJsonConfiguration({
		inputs,
		...(context.iteration
			? { item: context.iteration.value, index: context.iteration.index }
			: {}),
	}) as { inputs: Record<string, unknown>; item?: unknown; index?: number };
}

function configuration(step: WorkflowStep) {
	return sanitizeJsonConfiguration({
		type: step.type,
		name: step.name,
		view: step.view,
		decide: step.decide,
		notifications: step.notifications,
		reads: step.reads ?? {},
	});
}

function content(context: ExecutionContext) {
	context = { ...context, step: StepSchema.parse(context.step) };
	const config = configuration(context.step),
		scope = viewScope(context),
		view = resolveView(context.step.view!, scope);
	const decide =
		context.step.type === "decide"
			? DecideConfigurationSchema.parse(context.step.decide)
			: undefined;
	const items = decide ? decisionItems(decide, scope) : undefined;
	return {
		config,
		scope,
		view,
		items,
		actions: decide?.actions,
		askAvailable: !!decide?.ask,
	};
}
interface Located {
	frame: GraphCheckpoint;
	step: WorkflowStep;
	key: string;
	outputs: Record<string, unknown>;
}
/** Blocking humans remain outside concurrent bodies; sequential calls have one exact active leaf. */
function locate(run: FactoryRun, id: string): Located | undefined {
	const visit = (
		frame: GraphCheckpoint | undefined,
		steps: WorkflowStep[],
		prefix: string,
		outputs: Record<string, unknown>,
	): Located | undefined => {
		if (!frame) return;
		outputs = frame.outputs ?? outputs;
		const step = steps.find((step) => step.id === frame.current),
			state = frame.active;
		if (!step || !state) return;
		const key = prefix + step.id;
		if (state.viewId === id) return { frame, step, key, outputs };
		if (step.type === "workflow") {
			const definition = run.workflowDefinitions?.find(
				(w) => w.id === step.workflow,
			);
			if (definition)
				return visit(state.children?.[0], definition.steps, `${key}/`, outputs);
		}
		return undefined;
	};
	return visit(
		run.checkpoint,
		(run.recoveryWorkflow ?? run.workflow).steps,
		"",
		run.outputs,
	);
}

/** Separate ownership from legacy assistance/review protocols. No authored output grants authority. */
export class HumanViews {
	private publications = new Set<Promise<unknown>>();
	hasExecutingWork() {
		return this.asks.size > 0;
	}
	async settle() {
		await Promise.allSettled([...this.asks.values(), ...this.publications]);
	}
	private contexts = new Map<string, ExecutionContext>();
	private waiting = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	private transitions = new Map<string, Promise<unknown>>();
	private transitionEpoch = new WeakMap<FactoryRun, number>();
	private transition<T>(
		run: FactoryRun,
		operation: () => Promise<T>,
	): Promise<T> {
		const previous = this.transitions.get(run.id) ?? Promise.resolve();
		const work = previous
			.catch(() => {})
			.then(() => {
				this.transitionEpoch.set(run, (this.transitionEpoch.get(run) ?? 0) + 1);
				return operation();
			});
		this.transitions.set(run.id, work);
		void work
			.finally(() => {
				if (this.transitions.get(run.id) === work)
					this.transitions.delete(run.id);
			})
			.catch(() => {});
		return work;
	}
	private publishCurrent(run: FactoryRun, record: ViewRecord): boolean {
		if (
			record.answer ||
			record.superseded ||
			run.status !== "waiting" ||
			run.viewDecision?.id !== record.snapshot.id ||
			!run.viewRecords?.includes(record)
		)
			return false;
		try {
			const current = this.current(run, record);
			const source = content(current.context);
			if (
				digest(source.config) !== record.configDigest ||
				digest({ view: source.view, items: source.items }) !==
					record.sourceDigest
			) {
				record.superseded = true;
				this.contexts.set(record.snapshot.id, current.context);
				delete current.found.frame.active!.viewId;
				return true;
			}
			run.viewDecision = publicViewRecord(run.id, record);
			return false;
		} catch {
			/* Historical results never recover publication authority. */
			return false;
		}
	}
	private submissions = new Map<string, Promise<unknown>>();
	private asks = new Map<string, Promise<unknown>>();
	constructor(
		private runtime: WorkflowRuntime,
		private hooks: RuntimeHooks,
	) {}
	private context(run: FactoryRun, found: Located): ExecutionContext {
		return {
			run,
			step: found.step,
			stepKey: found.key,
			outputs: found.outputs,
			callInputs: found.frame.callInputs,
			iteration: found.frame.iteration,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: "",
		};
	}
	private updateDigest(run: FactoryRun, record: ViewRecord) {
		record.snapshot.digest = viewRecordDigest(run.id, record);
	}
	private publicationQueues = new Map<string, Promise<void>>();
	private publishDecision(run: FactoryRun, record: ViewRecord): Promise<void> {
		const snapshot = publicViewRecord(run.id, record);
		const previous = this.publicationQueues.get(run.id) ?? Promise.resolve();
		const work = previous
			.catch(() => {})
			.then(() =>
				this.runtime.publishViewDecision(
					run,
					humanViewText(snapshot),
					snapshot.id,
					snapshot.digest,
				),
			);
		this.publicationQueues.set(run.id, work);
		this.publications.add(work);
		void work
			.finally(() => {
				this.publications.delete(work);
				if (this.publicationQueues.get(run.id) === work)
					this.publicationQueues.delete(run.id);
			})
			.catch(() => {});
		return work;
	}

	private current(run: FactoryRun, record: ViewRecord) {
		const found = locate(run, record.snapshot.id);
		if (
			!found ||
			!["decide", "approve"].includes(found.step.type) ||
			found.key !== record.snapshot.stepKey
		)
			throw new Error("The decision frame changed. Refresh this run.");
		return {
			found,
			context: {
				...(this.contexts.get(record.snapshot.id) ?? this.context(run, found)),
				step: found.step,
				stepKey: found.key,
				outputs: found.outputs,
				callInputs: found.frame.callInputs,
				iteration: found.frame.iteration,
			},
		};
	}
	/** Final local authority check after provider preparation, never during a remote wait. */
	async validatePublication(
		run: FactoryRun,
		version: { batchId: string; digest: string },
	): Promise<boolean> {
		return (await this.publication(run, version, () => true)) !== undefined;
	}
	async dispatchPublication<T>(
		run: FactoryRun,
		version: { batchId: string; digest: string },
		write: () => T,
	): Promise<{ value: T }> {
		if (
			this.runtime.runs.get(run.id) !== run ||
			["blocked", "interrupted"].includes(run.status)
		)
			throw new UnsentDispatchError("unavailable");
		const dispatched = await this.publication(run, version, write);
		if (
			!dispatched &&
			(this.runtime.runs.get(run.id) !== run ||
				["blocked", "interrupted"].includes(run.status))
		)
			throw new UnsentDispatchError("unavailable");
		if (!dispatched) throw new UnsentDispatchError("superseded");
		return dispatched;
	}
	private async publication<T>(
		run: FactoryRun,
		version: { batchId: string; digest: string },
		write: () => T,
		retries = 2,
	): Promise<{ value: T } | undefined> {
		const owned = () => {
			const record = run.viewRecords?.find(
				(r) => r.snapshot.id === version.batchId,
			);
			if (
				this.runtime.runs.get(run.id) !== run ||
				!record ||
				record.answer ||
				record.superseded ||
				run.status !== "waiting" ||
				run.viewDecision?.id !== version.batchId ||
				run.viewDecision.digest !== version.digest ||
				publicViewRecord(run.id, record).digest !== version.digest
			)
				return;
			try {
				return { record, current: this.current(run, record) };
			} catch {
				/* A retained snapshot cannot own a different active frame. */
			}
			return undefined;
		};
		const renew = async (owner: NonNullable<ReturnType<typeof owned>>) => {
			owner.record.superseded = true;
			this.contexts.set(owner.record.snapshot.id, owner.current.context);
			delete owner.current.found.frame.active!.viewId;
			await this.runtime.save(run);
			this.waiting.get(owner.record.snapshot.id)?.resolve();
		};
		const inspect = () => {
			const owner = owned();
			if (!owner) return undefined;
			try {
				const source = content(owner.current.context);
				if (
					digest(source.config) === owner.record.configDigest &&
					digest({ view: source.view, items: source.items }) ===
						owner.record.sourceDigest
				)
					return { owner, source };
			} catch {
				/* Invalid current bindings/config cannot authorize the saved display. */
			}
			return { owner, source: undefined };
		};
		const prepared = await this.transition(run, async () => {
			const current = inspect();
			if (current && !current.source) await renew(current.owner);
			return (
				current?.source && {
					source: current.source,
					epoch: this.transitionEpoch.get(run)!,
				}
			);
		});
		if (!prepared) return undefined;
		// Bounded local file/revision checks do not hold the human transition queue.
		let validAssets = () => false;
		try {
			validAssets = await prepareViewAssetCheck(
				this.runtime.directory,
				run,
				prepared.source.view,
			);
		} catch {
			/* Missing or changed protected files cannot authorize a write. */
		}
		const handoff = await this.transition(run, async () => {
			const verified = inspect();
			if (!verified) return undefined;
			if (!verified.source || !validAssets()) {
				await renew(verified.owner);
				return undefined;
			}
			if (this.transitionEpoch.get(run) !== prepared.epoch + 1)
				return { retry: true as const };
			// No await between the authoritative comparison and the actual local write.
			// The promise is returned inside an envelope: remote work holds no transition.
			return { value: write() };
		});
		if (handoff && "retry" in handoff) {
			// A competing transition may have waited on durable storage after byte
			// or repository-revision verification. Repeat those checks outside the
			// lock; unsettled local authority defers without retiring or dispatching.
			if (!retries) throw new UnsentDispatchError("unavailable");
			return this.publication(run, version, write, retries - 1);
		}
		return handoff;
	}
	async execute(
		context: ExecutionContext,
		frame: GraphCheckpoint,
	): Promise<unknown> {
		const { run, step, signal } = context,
			state = frame.active!;
		let record = state.viewId
			? run.viewRecords?.find((record) => record.snapshot.id === state.viewId)
			: undefined;
		if (!record) {
			const source = content(context);
			await verifyViewAssets(this.runtime.directory, run, source.view);
			const id = randomUUID();
			const snapshot: ViewSnapshot = {
				id,
				stepKey: context.stepKey!,
				kind: step.type as ViewSnapshot["kind"],
				title: step.name,
				digest: digest({
					protocol: "human-view-v1",
					id,
					runId: run.id,
					key: context.stepKey,
					visit: frame.visits[step.id],
					config: source.config,
					view: source.view,
					items: source.items,
				}),
				view: immutableJson(source.view),
				...(step.notifications
					? { notifications: immutableJson(step.notifications) }
					: {}),
				...(source.items
					? {
							items: source.items.map(({ value: _value, ...item }) => item),
							actions: source.actions,
							askAvailable: source.askAvailable,
							threads: {},
						}
					: {}),
				createdAt: new Date().toISOString(),
			};
			record = {
				snapshot,
				configDigest: digest(source.config),
				definitionDigest: digest(source.config),
				sourceDigest: digest({ view: source.view, items: source.items }),
				items: source.items?.map(({ id, value }) => ({ id, value })),
				scope: immutableJson(source.scope),
			};
			state.viewId = id;
			run.viewRecords ??= [];
			if (run.viewRecords.length >= 100)
				throw new Error("A run supports at most 100 displayed view snapshots");
			this.updateDigest(run, record);
			run.viewRecords.push(record);
			await this.runtime.save(run);
		}
		if (step.type === "show") {
			run.viewDisplays ??= [];
			if (!run.viewDisplays.some((s) => s.id === record.snapshot.id))
				run.viewDisplays.push(publicViewRecord(run.id, record));
			await this.runtime.save(run);
			if (!record.notified) {
				record.notified = true;
				await this.runtime.save(run);
				const publication = this.runtime
					.publishViewDecision(
						run,
						viewText(record.snapshot.view),
						record.snapshot.id,
					)
					.catch(() =>
						context.log(
							"Show text fallback could not be published; retained display remains available.",
						),
					);
				this.publications.add(publication);
				void publication.finally(() => this.publications.delete(publication));
			}
			return { shown: true, viewId: record.snapshot.id };
		}
		if (record.answer) return record.answer.output;
		this.updateDigest(run, record);
		this.contexts.set(record.snapshot.id, context);
		run.viewDecision = publicViewRecord(run.id, record);
		releaseDelivery(run, "Awaiting view decision");
		run.status = "waiting";
		const waiting = new Promise<void>((resolve, reject) =>
			this.waiting.set(record!.snapshot.id, { resolve, reject }),
		);
		void waiting.catch(() => {});
		const abort = () =>
			this.waiting
				.get(record!.snapshot.id)
				?.reject(new Error("Run terminated"));
		signal.addEventListener("abort", abort, { once: true });
		try {
			await this.runtime.save(run);
			await this.publishDecision(run, record);
			// Resume unfinished item threads through their own native checkpoint.
			for (const [itemId, threads] of Object.entries(
				record.snapshot.threads ?? {},
			))
				for (const thread of threads)
					if (thread.status === "pending")
						void this.runAsk(context, record, itemId, thread.id).catch(
							() => {},
						);
			signal.throwIfAborted();
			if (!record.answer) await waiting;
			signal.throwIfAborted();
			if (record.superseded)
				return this.execute(
					this.contexts.get(record.snapshot.id) ?? context,
					frame,
				);
			if (!record.answer) throw new Error("Decision was not accepted");
			run.viewDecision = publicViewRecord(run.id, record);
			run.status = "running";
			return (record as ViewRecord).answer!.output;
		} finally {
			signal.removeEventListener("abort", abort);
			this.waiting.delete(record.snapshot.id);
			this.contexts.delete(record.snapshot.id);
		}
	}
	text(record: ViewRecord): string {
		return humanViewText(record.snapshot);
	}
	displayText(
		run: FactoryRun,
		nativeText?: (limit: number) => string | undefined,
	) {
		const records = run.viewRecords ?? [];
		const current = records.find((r) => r.snapshot.id === run.viewDecision?.id);
		const history = records.filter((r) => r.snapshot.kind === "show").reverse();
		const historyNotice =
			"\n[Earlier Show displays omitted. Open the dashboard for retained history.]";
		const limit = history.length ? 100000 - historyNotice.length - 2 : 100000;
		// Only an unanswered, current generic decision owns the live protocol.
		// Retained Shows (or an answered generic decision) cannot mask a native wait.
		const pending = current && !current.answer && !current.superseded;
		const leading = pending
			? humanViewText(publicViewRecord(run.id, current), { maxLength: limit })
			: (nativeText?.(limit) ??
				(current
					? humanViewText(publicViewRecord(run.id, current), {
							maxLength: limit,
						})
					: undefined));
		const chunks = leading ? [leading] : [];
		let remaining = 100000 - chunks.join("\n\n").length;
		for (const record of history) {
			const notice =
				"\n[Earlier Show displays omitted. Open the dashboard for retained history.]";
			if (remaining < 1600 + notice.length) {
				if (chunks.length && remaining >= notice.length + 2)
					chunks.push(notice);
				break;
			}
			const text = humanViewText(record.snapshot, {
				maxLength: remaining - notice.length - 2,
			});
			chunks.push(text);
			remaining -= text.length + 2;
		}
		return chunks.join("\n\n");
	}

	snapshot(run: FactoryRun) {
		return publicViewDecision(run);
	}
	async answer(id: string, input: unknown): Promise<unknown> {
		const request = ViewAnswerSchema.parse(input),
			run = this.runtime.get(id);
		const record = run.viewRecords?.find(
			(record) => record.snapshot.id === request.batchId,
		);
		if (!record) throw new Error("Unknown decision batch");
		const existing = this.submissions.get(request.batchId);
		if (existing) {
			await existing;
			return this.answer(id, request);
		}
		const work = this.transition(run, async () => {
			if (record.answer) {
				if (digest(record.answer.request) !== digest(request))
					throw new Error(
						"This decision was already answered; accepted choices cannot be overwritten",
					);
				return record.answer.output;
			}
			if (record.superseded)
				throw new Error(
					"This decision batch was superseded. Refresh and review again.",
				);
			if (run.status !== "waiting" || run.viewDecision?.id !== request.batchId)
				throw new Error("Run is not waiting for this decision");
			const { context } = this.current(run, record),
				source = content(context);
			if (
				digest(source.config) !== record.configDigest ||
				digest({ view: source.view, items: source.items }) !==
					record.sourceDigest
			) {
				record.superseded = true;
				const refreshed = this.current(run, record);
				this.contexts.set(record.snapshot.id, refreshed.context);
				delete refreshed.found.frame.active!.viewId;
				await this.runtime.save(run);
				this.waiting.get(record.snapshot.id)?.resolve();
				throw new Error(
					"Displayed content changed. Refresh and review the new decision batch.",
				);
			}
			this.updateDigest(run, record);
			run.viewDecision = publicViewRecord(run.id, record);
			await this.runtime.save(run);
			if (request.digest !== record.snapshot.digest)
				throw new Error(
					"Displayed decision or Ask thread changed. Refresh and review again.",
				);
			await verifyViewAssets(this.runtime.directory, run, source.view);
			const after = content(this.current(run, record).context);
			if (
				run.status !== "waiting" ||
				record.answer ||
				record.superseded ||
				run.viewDecision?.id !== request.batchId ||
				request.digest !== record.snapshot.digest ||
				digest(after.config) !== record.configDigest ||
				digest({ view: after.view, items: after.items }) !== record.sourceDigest
			)
				throw new Error(
					"Displayed decision changed during validation. Refresh and review again.",
				);
			if (this.asksFor(record).some((thread) => thread.status === "pending"))
				throw new Error(
					"Wait for the pending Ask reply before submitting decisions",
				);
			const output = viewAnswerOutput(record, request);
			record.answer = immutableJson({
				request,
				output,
				at: new Date().toISOString(),
			});
			run.viewDecision = publicViewRecord(run.id, record);
			await this.runtime.save(run);
			this.waiting.get(record.snapshot.id)?.resolve();
			return record.answer.output;
		});
		this.submissions.set(request.batchId, work);
		try {
			return await work;
		} finally {
			if (this.submissions.get(request.batchId) === work)
				this.submissions.delete(request.batchId);
		}
	}
	private asksFor(record: ViewRecord) {
		return Object.values(record.snapshot.threads ?? {}).flat();
	}
	async ask(id: string, input: unknown) {
		const request = ViewAskSchema.parse(input),
			run = this.runtime.get(id);
		return this.transition(run, async () => {
			const record = run.viewRecords?.find(
				(record) => record.snapshot.id === request.batchId,
			);
			if (
				!record ||
				record.answer ||
				record.superseded ||
				run.status !== "waiting" ||
				run.viewDecision?.id !== request.batchId
			)
				throw new Error("Run is not waiting for this item decision");
			if (this.submissions.has(request.batchId))
				throw new Error("A decision submission is in progress");
			const originalThread = record.snapshot.threads?.[request.itemId]?.find(
				(thread) => thread.id === request.requestId,
			);
			if (originalThread) {
				if (originalThread.question !== request.question)
					throw new Error("Ask request ID already belongs to another question");
				return publicViewRecord(run.id, record);
			}
			const { context } = this.current(run, record),
				source = content(context);
			this.updateDigest(run, record);
			run.viewDecision = publicViewRecord(run.id, record);
			if (
				!context.step.decide?.ask ||
				request.digest !== record.snapshot.digest ||
				digest({ view: source.view, items: source.items }) !==
					record.sourceDigest ||
				digest(source.config) !== record.configDigest
			)
				throw new Error("Ask is unavailable or the displayed decision changed");
			if (!record.items?.some((item) => item.id === request.itemId))
				throw new Error("Unknown decision item");
			record.snapshot.threads ??= {};
			const threads = record.snapshot.threads;
			threads[request.itemId] ??= [];
			const entries = threads[request.itemId]!;
			const previous = entries.find(
				(thread) => thread.id === request.requestId,
			);
			if (previous) {
				if (previous.question !== request.question)
					throw new Error("Ask request ID already belongs to another question");
				return publicViewRecord(run.id, record);
			}
			if (entries.length >= 20 || this.asksFor(record).length >= 100)
				throw new Error("Ask thread limit reached");
			entries.push({
				id: request.requestId,
				...(run.viewRecords?.some((previous) =>
					Object.values(previous.snapshot.threads ?? {})
						.flat()
						.some((thread) => thread.id === request.requestId),
				)
					? {
							executionKey: `${record.snapshot.stepKey}/ask/${record.snapshot.id}/${request.itemId}/${request.requestId}`,
						}
					: {}),
				question: request.question,
				status: "pending",
				at: new Date().toISOString(),
			});
			this.updateDigest(run, record);
			run.viewDecision = publicViewRecord(run.id, record);
			await this.runtime.save(run);
			void this.publishDecision(run, record).catch(() => {});
			void this.runAsk(
				context,
				record,
				request.itemId,
				request.requestId,
			).catch(() => {});
			return publicViewRecord(run.id, record);
		});
	}
	private async runAsk(
		context: ExecutionContext,
		record: ViewRecord,
		itemId: string,
		requestId: string,
	) {
		const askKey = JSON.stringify([
			context.run.id,
			record.snapshot.id,
			itemId,
			requestId,
		]);
		if (this.asks.has(askKey)) return this.asks.get(askKey);
		const thread = record.snapshot.threads![itemId]!.find(
			(thread) => thread.id === requestId,
		)!;
		const work = (async () => {
			let result: { answer: string } | { error: string };
			try {
				const settings = context.step.decide!.ask!;
				const output = await this.hooks.agent({
					...context,
					contextAssistance: true,
					input: {
						item: record.items!.find((item) => item.id === itemId)!.value,
						question: thread.question,
						thread: record.snapshot.threads![itemId]!.map(
							({ question, answer }) => ({ question, answer }),
						),
						displayedView: record.snapshot.view,
					},
					step: {
						id: "view-follow-up",
						name: "Answer item follow-up",
						type: "agent",
						branches: [],
						maxVisits: 1,
						json: false,
						askQuestions: false,
						...settings,
						access: {
							mode: "workspace",
							tools: [
								"mcp__factory-context__list_context",
								"mcp__factory-context__read_context",
							],
						},
					},
					stepKey:
						thread.executionKey ??
						`${record.snapshot.stepKey}/ask/${requestId}`,
					resumeAgent: thread.agent as ExecutionContext["resumeAgent"],
					checkpointAgent: async (agent) =>
						this.transition(context.run, async () => {
							context.signal.throwIfAborted();
							if (
								!context.run.viewRecords?.includes(record) ||
								record.answer ||
								thread.status !== "pending"
							)
								return;
							thread.agent = agent;
							await this.runtime.save(context.run);
						}),
				});
				context.signal.throwIfAborted();
				const safeOutput = sanitizeJsonConfiguration(output);
				const text =
					typeof safeOutput === "string"
						? safeOutput
						: (safeOutput as { text?: unknown })?.text;
				if (typeof text !== "string" || !text.trim() || text.length > 24000)
					throw new Error(
						"Ask requires a text answer of at most 24000 characters",
					);
				result = { answer: text };
			} catch (error) {
				if (context.signal.aborted) return;
				const message = error instanceof Error ? error.message : "Ask failed";
				// Private persisted diagnostic. Public projections classify the failure
				// rather than exposing arbitrary provider/config/session messages.
				result = { error: message };
			}
			await this.transition(context.run, async () => {
				if (
					context.signal.aborted ||
					!context.run.viewRecords?.includes(record) ||
					record.answer ||
					thread.status !== "pending"
				)
					return;
				if ("answer" in result) {
					thread.answer = result.answer;
					thread.status = "answered";
				} else {
					thread.error = result.error;
					thread.status = "failed";
				}
				this.updateDigest(context.run, record);
				const renew = this.publishCurrent(context.run, record);
				await this.runtime.save(context.run);
				if (!renew)
					void this.publishDecision(context.run, record).catch(() => {});
				if (renew) this.waiting.get(record.snapshot.id)?.resolve();
			});
		})();
		this.asks.set(askKey, work);
		try {
			return await work;
		} finally {
			this.asks.delete(askKey);
		}
	}
	async preview(input: {
		workflowId: string;
		stepId: string;
		view: unknown;
		type?: "decide" | "approve" | "show";
		name?: string;
		decide?: unknown;
		reads?: unknown;
		notifications?: unknown;
		runId?: string;
		lastRun?: boolean;
		sampleScope?: unknown;
	}) {
		const config = {
			type: input.decide ? "decide" : "show",
			view: input.view,
			decide: input.decide,
			reads: input.reads ?? {},
			notifications:
				input.notifications === undefined
					? undefined
					: ViewNotificationsSchema.parse(input.notifications),
		};
		let scope = input.sampleScope ?? { inputs: {} },
			provenance: Record<string, unknown> = {
				kind: "sample",
				workflowId: input.workflowId,
				definitionMatch: false,
			};
		if (input.lastRun || input.runId) {
			const run = [...this.runtime.runs.values()]
				.filter(
					(run) =>
						(!input.runId || run.id === input.runId) &&
						run.workflow.id === input.workflowId,
				)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
			const record = run?.viewRecords
				?.slice()
				.reverse()
				.find(
					(record) =>
						record.snapshot.stepKey === input.stepId ||
						record.snapshot.stepKey.endsWith(`/${input.stepId}`),
				);
			if (!run || !record?.scope)
				throw new Error(
					"No accepted view input snapshot exists for this recipe step. Use sample data or run the step first.",
				);
			scope = record.scope;
			provenance = {
				kind: "last-run",
				runId: run.id,
				workflowId: input.workflowId,
				stepKey: record.snapshot.stepKey,
				at: record.snapshot.createdAt,
				definitionMatch:
					record.definitionDigest ===
					digest(
						sanitizeJsonConfiguration({
							type: input.type ?? record.snapshot.kind,
							name: input.name ?? record.snapshot.title,
							view: config.view,
							decide: config.decide,
							reads: config.reads,
							notifications: config.notifications,
						}),
					),
			};
		}
		const safe = sanitizeJsonConfiguration(scope) as {
			inputs: Record<string, unknown>;
			item?: unknown;
			index?: number;
		};
		return {
			scope: safe,
			provenance,
			paths: availableViewPaths(safe),
			view: resolveView(input.view as never, safe),
		};
	}
}
