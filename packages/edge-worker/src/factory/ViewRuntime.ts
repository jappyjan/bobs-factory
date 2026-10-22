import { randomUUID } from "node:crypto";
import { immutableJson } from "bobs-factory-core";
import { digest } from "./Delivery.js";
import { releaseDelivery } from "./DeliveryCoordination.js";
import { foreachPointer, sanitizeJsonConfiguration } from "./Foreach.js";
import {
	DecideConfigurationSchema,
	decisionItems,
	ViewAnswerSchema,
	ViewAskSchema,
	type ViewRecord,
	type ViewSnapshot,
	viewAnswerOutput,
} from "./HumanStep.js";
import { launchBatchProjection } from "./LaunchRuns.js";
import { resolveStepConfig } from "./StepConfig.js";
import {
	availableViewPaths,
	resolveView,
	viewPlainText,
	viewText,
} from "./View.js";
import { verifyViewAssets } from "./ViewAssets.js";
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
	for (const [name, binding] of Object.entries(
		resolveStepConfig(context.step).reads,
	)) {
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
		reads: step.reads ?? {},
	});
}
function publicSnapshot(record: ViewRecord): ViewSnapshot {
	const snapshot = record.snapshot;
	return {
		...structuredClone(snapshot),
		threads: Object.fromEntries(
			Object.entries(snapshot.threads ?? {}).map(([id, threads]) => [
				id,
				threads.map(({ agent: _agent, ...thread }) => thread),
			]),
		),
		...(record.answer ? { answer: structuredClone(record.answer.output) } : {}),
	};
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
		const {
			digest: _digest,
			answer: _answer,
			threads,
			...display
		} = record.snapshot;
		record.snapshot.digest = digest({
			protocol: "human-view-v1",
			runId: run.id,
			config: record.configDigest,
			source: record.sourceDigest,
			display,
			threads: Object.fromEntries(
				Object.entries(threads ?? {}).map(([id, threads]) => [
					id,
					threads.map(({ agent: _agent, ...thread }) => thread),
				]),
			),
		});
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
				definitionDigest: digest({
					view: step.view,
					decide: step.decide,
					reads: step.reads ?? {},
				}),
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
				run.viewDisplays.push(publicSnapshot(record));
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
		this.contexts.set(record.snapshot.id, context);
		run.viewDecision = publicSnapshot(record);
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
			if (!record.notified) {
				record.notified = true;
				await this.runtime.save(run);
				await this.runtime.publishViewDecision(
					run,
					this.text(record),
					record.snapshot.id,
				);
			}
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
			run.viewDecision = publicSnapshot(record);
			run.status = "running";
			return (record as ViewRecord).answer!.output;
		} finally {
			signal.removeEventListener("abort", abort);
			this.waiting.delete(record.snapshot.id);
			this.contexts.delete(record.snapshot.id);
		}
	}
	text(record: ViewRecord): string {
		const snapshot = record.snapshot;
		const lines = [
			viewPlainText(`${snapshot.kind}: ${snapshot.title}`),
			viewText(snapshot.view),
		];
		for (const item of snapshot.items ?? [])
			lines.push(
				...[
					`${item.id}: ${item.title}`,
					item.body ?? "",
					...item.details.map((d) => `${d.label}: ${d.value}`),
				].map(viewPlainText),
			);
		if (snapshot.actions)
			lines.push(
				viewPlainText(
					`Actions: ${snapshot.actions.map((a) => `${a.id} (${a.label})`).join(", ")}`,
				),
			);
		lines.push(
			`Decision batch: ${snapshot.id}`,
			`Displayed digest: ${snapshot.digest}`,
			snapshot.kind === "approve"
				? 'Reply with /view-answer {"batchId":"' +
						snapshot.id +
						'","digest":"' +
						snapshot.digest +
						'","accepted":true,"approved":true} or approved:false with feedback.'
				: 'Reply with /view-answer {"batchId":"' +
						snapshot.id +
						'","digest":"' +
						snapshot.digest +
						'","accepted":true,"choices":[{"itemId":"…","action":"…"}]} after reviewing every item.',
		);
		// Ordinary item text cannot create markup, terminal controls or active ticket links.
		return lines.join("\n").slice(0, 100000);
	}
	displayText(run: FactoryRun) {
		return (run.viewRecords ?? [])
			.filter(
				(record) =>
					record.snapshot.kind === "show" ||
					record.snapshot.id === run.viewDecision?.id,
			)
			.map((record) => this.text(record))
			.join("\n\n")
			.slice(0, 100000);
	}
	snapshot(run: FactoryRun) {
		return run.viewDecision;
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
		const work = (async () => {
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
			run.viewDecision = publicSnapshot(record);
			await this.runtime.save(run);
			this.waiting.get(record.snapshot.id)?.resolve();
			return record.answer.output;
		})();
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
			run = this.runtime.get(id),
			record = run.viewRecords?.find(
				(record) => record.snapshot.id === request.batchId,
			);
		if (
			!record ||
			record.answer ||
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
			return publicSnapshot(record);
		}
		const { context } = this.current(run, record),
			source = content(context);
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
		const previous = entries.find((thread) => thread.id === request.requestId);
		if (previous) {
			if (previous.question !== request.question)
				throw new Error("Ask request ID already belongs to another question");
			return publicSnapshot(record);
		}
		if (entries.length >= 20 || this.asksFor(record).length >= 100)
			throw new Error("Ask thread limit reached");
		entries.push({
			id: request.requestId,
			question: request.question,
			status: "pending",
			at: new Date().toISOString(),
		});
		this.updateDigest(run, record);
		run.viewDecision = publicSnapshot(record);
		await this.runtime.save(run);
		void this.runAsk(context, record, request.itemId, request.requestId).catch(
			() => {},
		);
		return publicSnapshot(record);
	}
	private async runAsk(
		context: ExecutionContext,
		record: ViewRecord,
		itemId: string,
		requestId: string,
	) {
		if (this.asks.has(requestId)) return this.asks.get(requestId);
		const thread = record.snapshot.threads![itemId]!.find(
			(thread) => thread.id === requestId,
		)!;
		const work = (async () => {
			try {
				const settings = context.step.decide!.ask!;
				const output = await this.hooks.agent({
					...context,
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
					stepKey: `${record.snapshot.stepKey}/ask/${requestId}`,
					resumeAgent: thread.agent as ExecutionContext["resumeAgent"],
					checkpointAgent: async (agent) => {
						thread.agent = agent;
						await this.runtime.save(context.run);
					},
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
				thread.answer = text;
				thread.status = "answered";
			} catch (error) {
				if (context.signal.aborted) return;
				thread.status = "failed";
				thread.error = error instanceof Error ? error.message : "Ask failed";
			}
			this.updateDigest(context.run, record);
			context.run.viewDecision = publicSnapshot(record);
			await this.runtime.save(context.run);
		})();
		this.asks.set(requestId, work);
		try {
			return await work;
		} finally {
			this.asks.delete(requestId);
		}
	}
	async preview(input: {
		workflowId: string;
		stepId: string;
		view: unknown;
		decide?: unknown;
		reads?: unknown;
		runId?: string;
		lastRun?: boolean;
		sampleScope?: unknown;
	}) {
		const config = {
			type: input.decide ? "decide" : "show",
			view: input.view,
			decide: input.decide,
			reads: input.reads ?? {},
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
							view: config.view,
							decide: config.decide,
							reads: config.reads,
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
