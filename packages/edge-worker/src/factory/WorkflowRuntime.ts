import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type {
	RunTitleJob,
	WorkflowTrigger,
	WorkflowTriggerOrigin,
} from "bobs-factory-core";
import {
	immutableJson,
	immutableTranscript,
	JsonSnapshotStore,
	reserveOwnedStorageWorkspace,
} from "bobs-factory-core";
import {
	extendTranscriptAccess,
	type RoleContextPolicy,
	retainTranscriptSource,
	type TranscriptExtension,
} from "bobs-factory-mcp-tools";
import type {
	CapacityOptions,
	CapacityRequest,
	ExecutionCapacity,
} from "../MachineCapacity.js";
import {
	isUpdatePaused,
	UpdatePausedError,
} from "../updates/UpdatePausedError.js";
import { activityMarkers } from "./ActivityPage.js";
import {
	type AgentSettings,
	AgentSettingsSchema,
	resolveAgentSettings,
	resolveNativePreferences,
} from "./AgentSettings.js";
import {
	acquireDelivery,
	type DeliveryCoordination,
	deliveryScopes,
	deliveryStep,
	releaseDelivery,
	resourceScopes,
	restoreDelivery,
} from "./DeliveryCoordination.js";
import { digest } from "./EvidenceDigest.js";

import type { ResolvedExecutionEnvironment } from "./ExecutionEnvironment.js";
import {
	EffectReconciliationError,
	NonConvergenceError,
	WorkflowUnavailableError,
} from "./ExecutionErrors.js";
import {
	ExecutionProfileStore,
	type ExecutionSelection,
	type ExecutionSnapshot,
} from "./ExecutionProfiles.js";
import type { FileIssueBatch, FileIssueIntent } from "./FileIssues.js";
import type {
	ForeachItemState,
	ForeachProgress,
	ForeachSnapshot,
} from "./Foreach.js";
import type { GitProviderSnapshot } from "./GitProvider.js";
import { GitSettings } from "./GitSettings.js";
import type { ViewRecord, ViewSnapshot } from "./HumanStep.js";

import type { RoleProgress, RoleRevision } from "./Incremental.js";
import type { IssueDestination } from "./IssueDestination.js";
import { LaunchAssetStore, type LaunchAttachments } from "./LaunchAssets.js";
import {
	type LaunchRunBatch,
	launchBatchProjection,
	launchBatchSettled,
	stopLaunchRuns,
	tickLaunchRuns,
} from "./LaunchRuns.js";

import { reusableNodeOutput, scopedNodeRevisions } from "./NodeGuarantees.js";
import { nodeContext, nodeWaitPhase } from "./nodes/context.js";
import { NODE_REROUTE } from "./nodes/control.js";
import { nodeRegistry } from "./nodes/index.js";
import { nodeEffect } from "./nodes/metadata.js";
import type { NodeEngine } from "./nodes/NodeDefinition.js";
import {
	beginProgressAttempt,
	continueProgress,
	initializeProgressBudget,
	type ProgressBudget,
	recordProgressFailure,
} from "./ProgressBudget.js";
import { beginStepAttempt, finishStepAttempt } from "./Provenance.js";

import type {
	SnapshotInputProvenance,
	SnapshotReceipt,
} from "./RepositorySnapshot.js";

import {
	assertBoundInspectionFresh,
	bindingHistory,
	type OutputRevisionBinding,
	outputRevisionBinding,
	StaleBoundInspectionError,
	sameOutputBinding,
} from "./RevisionBinding.js";
import { newRoleContext, roleContextAccess } from "./RoleContext.js";

import {
	diagnosticSummary,
	RunAccounting,
	type RunTimingUpdate,
	runDiagnostics,
	timingOperation,
} from "./RunDiagnostics.js";
import { currentStepView } from "./RunOutputRoles.js";
import { buildTitleContext } from "./RunTitleGenerator.js";

import { stepBindings } from "./StepBindings.js";
import {
	accessMode,
	isNodeEngineStep,
	registerWorkflowConfig,
	resolveStepConfig,
} from "./StepConfig.js";

import { recordTicketMilestone } from "./TicketTracking.js";
import { producerKey, producerValue, stepForRun } from "./ToolBindings.js";
import { HumanViews } from "./ViewRuntime.js";
import {
	isComputeIntensive,
	readPath,
	requireTrigger,
	routeResult,
	type Workflow,
	WorkflowSchema,
	type WorkflowStep,
} from "./Workflow.js";
import { type WorkflowBlock, WorkflowCatalog } from "./WorkflowCatalog.js";
import { snapshotHistory, snapshotWorkflowInput } from "./WorkflowInput.js";

export type RunStatus =
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "stopped"
	| "interrupted"
	| "blocked";
export interface RunEvent {
	call?: WorkflowCall;
	sequence?: number;
	source?: "agent" | "workflow";
	at: string;
	step: string;
	message: string;
}
export interface WorkflowCall {
	type: "workflow";
	callerWorkflowId: string;
	step: string;
	key: string;
	workflowId: string;
}
export interface AgentCheckpoint {
	/** A lost native conversation restarts with the retained output as context. */
	resumeFallback?: { output?: unknown };
	/** Effective model retained with its actual native conversation. */
	model?: string;
	toolProfile?: "context-only";
	/** Original bound input/repository snapshot, retained across native turn restart. */
	inspection?: OutputRevisionBinding;
	infrastructureFailure?: {
		reason: string;
		at: string;
		output?: unknown;
		retryGeneration?: number;
	};
	/** Persisted per-role budget for resuming a silent provider turn. */
	idleRetries?: number;
	runner: NonNullable<WorkflowStep["runner"]>;
	/** Absent when required infrastructure fails before a native session exists. */
	sessionId?: string;
	result?: {
		output: unknown;
		revision: RoleRevision;
		finalizing?: boolean;
		binding?: OutputRevisionBinding;
	};
	rejected?: {
		output: unknown;
		issues: {
			path: string;
			message: string;
			expected?: unknown;
			actual?: unknown;
		}[];
		revision?: RoleRevision;
		attempts: number;
		/** Reserved before launch; a proven pre-turn startup failure returns it. */
		reserved?: boolean;
		exhausted?: boolean;
		retryGeneration?: number;
	};
}

export interface ItemFrame {
	id: string;
	index: number;
	value: unknown;
	frame: string;
}
export interface ForeachCheckpoint {
	snapshot: ForeachSnapshot;
	body: WorkflowStep[];
	outputs: Record<string, unknown>;
	states: ForeachItemState[];
}
export interface GraphCheckpoint {
	/** Definition-local structural identity; excludes generated Call and item frames. */
	progressPath?: string;
	/** Private hashes of accepted lexical inputs, without copying their values. */
	progressInputs?: Record<string, string>;
	progressItem?: string;
	/** Calls with declared outcomes retain one lexical frame across correction routes. */
	calls?: Record<string, GraphCheckpoint>;
	/** Completed Parallel scopes remain the owners of their qualified producers. */
	branches?: Record<string, GraphCheckpoint[]>;
	/** The exact accepted review context inherited by this lexical frame. */

	/** A producer refresh executes in its original frame and returns without following its route. */
	producerRefresh?: {
		source: string;
		current: string;
		active?: GraphCheckpoint["active"];
		outcome?: string;
	};
	entry?: string;
	outcome?: string;
	iteration?: ItemFrame;
	callInputs?: Record<string, unknown>;
	/** Runtime-owned origin receipts; never part of public mapped JSON inputs. */
	snapshotInputs?: Record<string, SnapshotInputProvenance>;
	/** New item/mapped-call scopes publish their own receipts, independently of inherited reads. */
	projectResults?: true;
	resultReceipts?: Record<string, { key: string; output: unknown }>;
	// Inherited by called workflows and fanout branches; calls return it to their caller.

	current: string;
	visits: Record<string, number>;
	/** Exact native identities for the configured roles in this frame; never completed results. */
	agentSessions?: Record<
		string,
		Pick<AgentCheckpoint, "runner" | "sessionId" | "model">
	>;
	additionalVisits?: Record<string, number>;
	refreshes?: {
		source: string;
		target: string;
		active?: GraphCheckpoint["active"];
	}[];
	error?: { message: string; kind: string };
	active?: {
		retries?: number;
		retryAt?: number;
		/** Automatic retries retain one semantic progress attempt for the accepted visit. */
		retryProgressObservation?: string;
		wait?: {
			deadline: number;
			nextPollAt: number;
			polls: number;
			errors?: number;
			output?: unknown;
			matched?: boolean;
		};
		nodeStamp?: {
			inputDigest: string;
			guarantee: import("./NodeGuarantees.js").NodeGuarantee;
		};
		viewId?: string;
		actionId?: string;
		attemptId?: string;
		phase: "executing" | "result" | "waiting" | "answered";
		terminalFailure?: true;

		agent?: AgentCheckpoint;
		children?: GraphCheckpoint[];
		foreach?: ForeachCheckpoint;
		call?: WorkflowCall;
		refreshProducer?: string;
	};
	// Fanouts and modern calls own output frames; old calls retain their shared scope.
	outputs?: Record<string, unknown>;
}

export interface RunViewState {
	settledAt?: string;
	keptOpen?: boolean;
	seenAt?: string;
}

import {
	type StepVisitBudgetUpgrade,
	stepVisitLimit,
} from "./StepVisitBudget.js";
import { cleanupVideoEvidence, videoAssetPaths } from "./Video.js";

export interface FactoryRun {
	providerChecks?: import("./ProviderCheckReceipts.js").ProviderCheckState;
	verifiedMedia?: import("./VerifiedMedia.js").VerifiedMedia[];
	/** Structural step paths include call sites, branch indices and foreach item IDs, never visits. */
	agentNodeSessions?: Record<
		string,
		{
			agent?: Pick<AgentCheckpoint, "runner" | "sessionId" | "model">;
			output?: unknown;
		}
	>;
	diagnostics?: import("./RunDiagnostics.js").RunDiagnostics;
	/** Operational item progress, separate from accepted immutable item/output receipts. */
	foreach?: Record<string, ForeachProgress>;
	/** Original accepted collections; operational status never mutates these receipts. */
	foreachIterations?: {
		key: string;
		visit: number;
		snapshot: ForeachSnapshot;
	}[];
	repositorySnapshots?: Record<string, SnapshotReceipt>;
	issueActions?: Record<string, FileIssueBatch>;
	launchActions?: Record<string, LaunchRunBatch>;
	launchOutcomePublication?: { key: string; phase: "pending" | "confirmed" };
	recipeParent?: {
		runId: string;
		actionId: string;
		itemId: string;
		workflowId: string;
		ancestors: string[];
	};
	stepVisitBudget?: StepVisitBudgetUpgrade;
	workflowBlock?: WorkflowBlock;

	progressBudget?: ProgressBudget;
	roleContext?: {
		version: 1;
		acceptedAt: string;
		adoption: "new-run";
		policy: RoleContextPolicy;
	};

	stepAttempts?: import("./Provenance.js").StepAttempt[];
	deliveryCoordination?: DeliveryCoordination;
	deliveryReservations?: Record<string, DeliveryCoordination>;
	repositories?: import("./RepositoryScope.js").RunRepository[];
	/** Durable per-repository receipts, including partial publication and merges. */
	repositoryOutputs?: Record<string, Record<string, unknown>>;
	/** Accepted forge coordinates/adapter, retained across retry and configuration changes. */
	gitProvider?: GitProviderSnapshot;
	executionSnapshot?: ExecutionSnapshot;
	executionDiagnostics?: {
		accounts: ResolvedExecutionEnvironment["accounts"];
		git?: ResolvedExecutionEnvironment["git"];
		mcp: string[];
		runner: string;
		binary: string;
		version: string;
		tracking: string;
	};
	ticketReference?: import("./TicketTracking.js").TicketReference;
	ticketSync?: import("./TicketTracking.js").TicketSync;
	triggerOrigin?: WorkflowTriggerOrigin;
	workflowCalls?: { call: WorkflowCall; at: string }[];
	id: string;
	title: string;
	titleGeneration?: RunTitleJob;
	repositoryId: string;
	workflow: Workflow;
	workflowDefinitions?: Workflow[];
	contractVersion?: number;
	source?: string;
	status: RunStatus;
	createdAt: string;
	updatedAt: string;
	workspace: string;
	input: string;
	launchInputs?: Record<string, string>;
	launchAttachments?: LaunchAttachments;
	runner?: string;
	model?: string;
	reasoningEffort?: AgentSettings["reasoningEffort"];
	modelVariant?: string;
	serviceTier?: AgentSettings["serviceTier"];
	issueId?: string;
	workspaceId?: string;
	step?: string;
	checkpoint?: GraphCheckpoint;
	capacityLeaves?: Record<
		string,
		{
			phase:
				| "queued"
				| "executing"
				| "stopping"
				| "waiting-ci"
				| "waiting-human";
			request?: CapacityRequest;
		}
	>;
	simplePrompt?: string;
	simpleExecution?: {
		userPrompt: string;
		systemPrompt?: string;
		runner: NonNullable<WorkflowStep["runner"]>;
		agent?: AgentCheckpoint;
	};
	launchRequest?: import("./LaunchFields.js").ResolvedLaunchRequest;
	setupComplete?: boolean;
	sessionSnapshot?: import("bobs-factory-core").SerializedCyrusAgentSession;

	/** Presentation ownership only; never native approval authority. */

	viewDecision?: ViewSnapshot;
	viewDisplays?: ViewSnapshot[];
	viewRecords?: ViewRecord[];

	roleRevisions?: Record<string, RoleRevision>;
	boundOutputs?: Record<string, OutputRevisionBinding>;

	/** Provider-verified takeover snapshot; ordinary output slots cannot replace it. */
	takeoverSource?: unknown;
	/** Tracker input captured by the host, independently of authored output IDs. */
	ticketSnapshot?: unknown;

	nodeEffects?: Record<
		string,
		import("./nodes/NodeDefinition.js").EffectRecord
	>;
	outputs: Record<string, unknown>;
	history: {
		step: string;
		output: unknown;
		inputDigest?: string;
		guarantee?: import("./NodeGuarantees.js").NodeGuarantee;
		/** Immutable runtime evidence, separate from pure Check results. */
		evidence?: Record<string, unknown>;
		at: string;
		call?: WorkflowCall;

		iteration?: {
			frame: string;
			id: string;
			index: number;
			itemDigest: string;
		};
	}[];

	events: RunEvent[];
	activitySteps?: { at: string; step: string }[];
	iterationLimit?: { step: string; visits: number; limit: number };
	error?: string;
}
export interface ChatMessage {
	id: string;
	text: string;
	at: string;
	step: string;
}
export interface ExecutionContext {
	error?: { message: string; kind: string };
	/** Resolve freshness in this node’s lexical frame. */
	fresh?: (reference: string) => Promise<boolean>;
	/** Stable accepted definition identity, independent of Call/frame/attempt IDs. */
	progressOperation?: string;
	progressObservation?: string;
	/** Runtime-owned accepted input hashes; never sourced from role claims. */
	progressInputs?: Record<string, string>;
	/** Host-owned original session entries, unavailable to ordinary outputs-first roles. */
	transcriptEntries?: () => readonly import("bobs-factory-core").CyrusAgentSessionEntry[];
	progressItem?: string;
	beginProgressAttempt?: (reason?: string) => Promise<void>;
	iteration?: ItemFrame;
	callInputs?: Record<string, unknown>;
	/** Private persisted Call input origins, independently checked by pinned access. */
	snapshotInputs?: Record<string, SnapshotInputProvenance>;
	validateRoleOutput?: (value: unknown) => unknown;
	/** Artifact binding issued at role start; later edits make the worktree dirty without invalidating it. */
	resultArtifactBinding?: import("bobs-factory-mcp-tools").FactoryArtifactBinding;
	readOnlyResearch?: boolean;
	/** Trusted human-thread execution profile, never selected by authored output. */
	contextAssistance?: true;
	researchAccess?: {
		repositories: { id: string; root: string; revision: string }[];
		maxCalls: number;
	};
	/** Yield passive waits at saved checkpoints when update admission closes. */
	assertSchedulingOpen?: () => void;
	/** Revalidate the complete grouped approval under the operation reservation. */

	/** Resolve impact inputs in their retained owning frame, never the consumer's aliases. */

	/** Nested publication discovered by passive grouped readiness must also claim targets. */
	coordinateDelivery?: <T>(operation: () => Promise<T>) => Promise<T>;
	/** Capable hooks call after capacity admission, and release after runner cleanup. */
	reserveExecution?: () => Promise<() => Promise<void>>;
	/** Runtime-owned home, never inferred from a worktree or a private runner HOME. */
	factoryHome?: string;
	checkpointDiagnostics?: () => void;
	attemptId?: string;

	execution?: ResolvedExecutionEnvironment;
	stepKey?: string;

	historyIndex?: () => { step: string; at: string }[];
	currentScope?: () => unknown;
	capacity?: CapacityOptions;
	chat?: boolean;
	chatMessages?: ChatMessage[];
	progress?: RoleProgress;
	run: FactoryRun;
	step: WorkflowStep;
	input: unknown;
	bindingInput?: (
		step: WorkflowStep,
		previous?: OutputRevisionBinding,
	) => unknown;
	inspectionBinding?: OutputRevisionBinding;
	inspectionSources?: Record<string, unknown>;
	outputs?: Record<string, unknown>;
	signal: AbortSignal;
	log: (message: string, source?: RunEvent["source"]) => void;
	evidenceDir: string;
	resumeAgent?: AgentCheckpoint;
	previousAgentOutput?: unknown;
	resumeFallback?: { output?: unknown };

	checkpointAgent?: (agent: AgentCheckpoint) => void | Promise<void>;
	/** Persist per-repository side effects before the whole step completes. */
	save?: () => void | Promise<void>;
	allowUnchangedRepository?: boolean;
}
export interface RuntimeHooks {
	ioGitProvider?(
		context: ExecutionContext,
	): Promise<import("./GitProvider.js").GitProvider>;
	ticketIO?(
		run: FactoryRun,
		reference: import("./TicketTracking.js").TicketReference,
		signal: AbortSignal,
	): Promise<import("./TicketIO.js").TicketIOAdapter>;
	transcriptEntries?(
		runId: string,
	): readonly import("bobs-factory-core").CyrusAgentSessionEntry[];
	/** The agent hook honors reserveExecution at each actual turn, including retries. */
	agentExecutionBoundary?: true;
	issueDestinations?(
		run: FactoryRun,
		signal: AbortSignal,
	): Promise<{
		options: { name: string; destination: IssueDestination }[];
		limitations: string[];
	}>;
	fileIssue?(
		run: FactoryRun,
		issue: FileIssueIntent,
		signal: AbortSignal,
	): Promise<{ id: string; url: string }>;
	availabilityChanged?(id: string, enabled: boolean): void;
	execution?(
		run: FactoryRun,
		runner?: string,
	): Promise<ResolvedExecutionEnvironment | undefined>;
	capacity?: ExecutionCapacity;
	track?(
		run: FactoryRun,
		milestone: import("./TicketTracking.js").TicketMilestone,
	): Promise<void>;
	retryTracking?(run: FactoryRun): Promise<void>;
	titleDefaults?(
		runner?: RunTitleJob["settings"]["runner"],
	): RunTitleJob["settings"];
	stopTitle?(id: string): void;
	agent(context: ExecutionContext): Promise<unknown>;

	viewDecision?(run: FactoryRun, text: string): Promise<void>;
	simple?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	prepare?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	finished?(run: FactoryRun): Promise<void>;
	cleanupExecution?(run: FactoryRun): void;
}

export class WorkflowRuntime {
	private accounting: RunAccounting;
	readDiagnostics(id: string, offset = 0, limit = 20) {
		return runDiagnostics(this.get(id), offset, limit, this.accounting.now());
	}
	private diagnosticTimer?: ReturnType<typeof setInterval>;
	private diagnosticPath(id: string): string {
		return join(
			this.directory,
			"diagnostics",
			`${encodeURIComponent(id)}.json`,
		);
	}
	private checkpointDiagnostics(run: FactoryRun): void {
		this.accounting.observe(
			run,
			this.controllers.has(run.id) && !this.shuttingDown,
		);
		mkdirSync(join(this.directory, "diagnostics"), { recursive: true });
		this.atomicWrite(this.diagnosticPath(run.id), run.diagnostics);
	}
	private startDiagnostics(): void {
		if (this.diagnosticTimer) return;
		this.diagnosticTimer = setInterval(() => {
			for (const id of this.controllers.keys()) {
				const run = this.runs.get(id);
				if (run) {
					try {
						this.checkpointDiagnostics(run);
						if (this.diagnosticListeners.size) {
							const update = {
								id: run.id,
								diagnostics: diagnosticSummary(run, this.accounting.now()),
							};
							for (const listener of this.diagnosticListeners) listener(update);
						}
					} catch {
						/* Diagnostics never grant or block execution authority. */
					}
				}
			}
		}, 5000);
		this.diagnosticTimer.unref();
	}
	/** Waiting gates and update-suspended runs have no executing work. */
	hasExecutingWork(): boolean {
		return (
			this.humanViews.hasExecutingWork() ||
			[...this.executions.keys()].some(
				(id) => this.runs.get(id)?.status !== "waiting",
			)
		);
	}
	private assertSchedulingOpen(): void {
		if (existsSync(join(this.directory, "..", "updates", "maintenance.json")))
			throw new UpdatePausedError();
	}
	private diagnosticListeners = new Set<(update: RunTimingUpdate) => void>();
	/** Timing-only updates must not trigger run serialization or parent reconciliation. */
	subscribeDiagnostics(
		listener: (update: RunTimingUpdate) => void,
	): () => void {
		this.diagnosticListeners.add(listener);
		return () => {
			this.diagnosticListeners.delete(listener);
		};
	}
	readonly runs = new Map<string, FactoryRun>();
	private listeners = new Set<
		(change: { id?: string; config?: boolean }) => void
	>();
	subscribe(
		listener: (change: { id?: string; config?: boolean }) => void,
	): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private changed(change: { id?: string; config?: boolean }): void {
		for (const listener of this.listeners) listener(change);
		if (change.id && !this.shuttingDown)
			for (const parent of this.runs.values())
				if (parent.id !== change.id)
					for (const batch of Object.values(parent.launchActions ?? {}))
						if (batch.accepted.items.some((item) => item.runId === change.id))
							void this.reconcileLaunchBatch(parent, batch).catch(() => {});
	}
	private terminalPublications = new Map<string, Promise<void>>();
	private launchReconciliations = new Map<string, Promise<void>>();
	private launchReconciliationDirty = new Set<string>();
	private controllers = new Map<string, AbortController>();
	readonly humanViews: HumanViews;
	private pendingAnswers = new Map<
		string,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	private workflows: Workflow[];
	readonly catalog: WorkflowCatalog;
	private executions = new Map<string, Promise<void>>();
	private updateSuspensions = new Set<string>();
	private pendingActivitySaves = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private shuttingDown = false;
	private defaultWorkflow = "simple";
	private oldEngineRuns = new Set<string>();
	private titleSettings: AgentSettings = {};
	private viewStates: Record<string, RunViewState> = {};
	private chats = new Map<string, ChatMessage[]>();
	readonly directory: string;
	readonly launchAssets: LaunchAssetStore;
	private snapshots: JsonSnapshotStore;
	private pendingSaves = new Map<string, Promise<void>>();
	private activitySaves = new Map<string, Promise<void>>();
	private capturedActivity = new Set<string>();
	private dirtyActivity = new Set<string>();
	private legacyRuns = new Set<string>();
	private summaries = new Map<
		string,
		Record<string, any> & { id: string; createdAt: string }
	>();
	get executionProfiles(): ExecutionProfileStore {
		return new ExecutionProfileStore(this.directory);
	}
	get gitSettings(): GitSettings {
		return new GitSettings(dirname(this.directory));
	}
	updateGitSettings(value: unknown) {
		const saved = this.gitSettings.save(value);
		this.changed({ config: true });
		return saved;
	}
	updateExecutionProfiles(value: unknown, revision: number) {
		const saved = this.executionProfiles.save(value, revision);
		this.changed({ config: true });
		return saved;
	}

	constructor(
		home: string,
		private hooks: RuntimeHooks,
		diagnosticClock?: ConstructorParameters<typeof RunAccounting>[0],
	) {
		this.accounting = new RunAccounting(diagnosticClock);
		this.directory = join(home, "factory");
		this.humanViews = new HumanViews(this, hooks);
		this.launchAssets = new LaunchAssetStore(this.directory);
		this.snapshots = new JsonSnapshotStore(join(this.directory, "run-chunks"));
		mkdirSync(join(this.directory, "runs"), { recursive: true });
		const settings = join(this.directory, "settings.json");
		if (existsSync(settings))
			this.titleSettings = AgentSettingsSchema.parse(
				JSON.parse(readFileSync(settings, "utf8")).titleGeneration ?? {},
			);
		const views = join(this.directory, "views.json");
		if (existsSync(views))
			this.viewStates = JSON.parse(readFileSync(views, "utf8"));
		this.catalog = new WorkflowCatalog(this.directory);
		this.workflows = this.catalog.list();
		this.defaultWorkflow = this.catalog.defaultWorkflow();
		for (const filename of readdirSync(join(this.directory, "runs"))) {
			if (!filename.endsWith(".json")) continue;
			const path = join(this.directory, "runs", filename);
			const stored = JSON.parse(readFileSync(path, "utf8"));
			const loaded =
				stored.format === "bobs-factory-json-snapshot-1"
					? this.snapshots.load<FactoryRun>(path)
					: undefined;
			const run: FactoryRun = loaded?.value ?? stored;
			const diagnosticPath = this.diagnosticPath(run.id);
			if (existsSync(diagnosticPath)) {
				try {
					const data = JSON.parse(readFileSync(diagnosticPath, "utf8"));
					if (data.version === 1) run.diagnostics = data;
				} catch {
					/* Retain snapshot/legacy unknowns if the optional sidecar is unreadable. */
				}
			}
			this.accounting.restore(run);
			if (!loaded) this.legacyRuns.add(run.id);
			if (loaded)
				this.summaries.set(
					run.id,
					loaded.summary as Record<string, any> & {
						id: string;
						createdAt: string;
					},
				);
			// Graphless Simple conversations intentionally remain resumable.
			const oldEngine =
				run.workflow.steps.length > 0 &&
				run.workflow.engineVersion !== "nodes-v1";
			if (!oldEngine) {
				WorkflowSchema.parse(run.workflow);
				for (const definition of [
					run.workflow,
					...(run.workflowDefinitions ?? []),
				])
					registerWorkflowConfig(definition, run.workflow.id);
			}
			if (oldEngine) this.oldEngineRuns.add(run.id);

			// Process-owned operations must reacquire after restart. Legacy broad
			// ownership cannot block restored passive parent/CI frames.
			if (["running", "waiting", "interrupted"].includes(run.status))
				restoreDelivery(run);

			// Accepted definitions and native IDs remain immutable across restart.

			immutableTranscript(run.events);
			// Completed receipts remain independent of mutable live outputs.
			immutableTranscript(run.history);

			this.runs.set(run.id, run);
			if (!oldEngine && this.catalog.getBlock(run.id)) {
				run.workflowBlock = this.catalog.getBlock(run.id);
				run.status = "blocked";
			}
			if (
				oldEngine &&
				!["completed", "failed", "stopped"].includes(run.status)
			) {
				run.status = "stopped";
				run.error = "Created by an older recipe engine; restart it";
				this.save(run);
			}
		}
		this.launchAssets.cleanupRuns(new Set(this.runs.keys()));
		cleanupVideoEvidence(
			join(this.directory, "evidence"),
			this.runs.values(),
			Date.now(),
			(run) => this.summaries.get(run.id)?.videoAssets,
		);
	}

	chatMessages(id: string): ChatMessage[] {
		let messages = this.chats.get(id);
		if (!messages) {
			const path = join(
				this.directory,
				"chats",
				`${encodeURIComponent(id)}.json`,
			);
			messages = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
			this.chats.set(id, messages!);
		}
		return messages!;
	}
	recordChatMessage(
		id: string,
		text: string,
		step: string,
		messageId: string = randomUUID(),
	): ChatMessage {
		const message = {
			id: messageId,
			text,
			step,
			at: new Date().toISOString(),
		};
		const messages = this.chatMessages(id);
		messages.push(message);
		mkdirSync(join(this.directory, "chats"), { recursive: true });
		this.atomicWrite(
			join(this.directory, "chats", `${encodeURIComponent(id)}.json`),
			messages,
		);
		this.changed({ id });
		return message;
	}
	/** Authoritative run status: true/false once the run is known, else undefined. */
	runFinished(id: string): boolean | undefined {
		const run = this.runs.get(id);
		if (!run) return undefined;
		return (
			!this.isExecuting(id) &&
			!["running", "waiting", "blocked", "interrupted"].includes(run.status)
		);
	}
	isExecuting(id: string): boolean {
		return this.controllers.has(id);
	}
	continueSimple(id: string, prompt: string): void {
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		const run = this.get(id);
		if (
			run.workflow.id !== "simple" ||
			run.status !== "completed" ||
			this.isExecuting(id)
		)
			throw new Error(
				"Only a finished Bob’s Factory session can continue here",
			);
		if (run.simpleExecution) {
			if (!run.simpleExecution.agent)
				throw new Error("Session conversation unavailable");
		}
		this.requireRunAvailable(run);
		run.simplePrompt = prompt;
		run.status = "running";
		run.error = undefined;
		this.updateViewState(id, { keptOpen: true });
		this.save(run);
		void this.launch(run);
	}
	viewState(id: string): RunViewState {
		return this.viewStates[id] ?? {};
	}
	updateViewState(id: string, state: RunViewState): RunViewState {
		this.viewStates[id] = state;
		this.atomicWrite(join(this.directory, "views.json"), this.viewStates);
		this.changed({ id });
		return state;
	}
	listWorkflows(): Workflow[] {
		return structuredClone(this.workflows);
	}
	getDefaultWorkflow(): string {
		return this.defaultWorkflow;
	}
	updateWorkflows(
		value: unknown,
		defaultWorkflow = this.defaultWorkflow,
	): Workflow[] {
		this.workflows = this.catalog.save(value, defaultWorkflow);
		this.defaultWorkflow = this.catalog.defaultWorkflow();
		this.changed({ config: true });
		return this.listWorkflows();
	}
	updatePreferences(id: string, value: unknown): void {
		this.catalog.savePreferences(id, value);
		this.workflows = this.catalog.list();
		this.changed({ config: true });
	}
	forkWorkflow(id: string, name?: string): Workflow {
		const fork = this.catalog.fork(id, name);
		this.workflows = this.catalog.list();
		this.changed({ config: true });
		return fork;
	}
	requireAvailable(
		workflow: Workflow,
		definitions = this.listWorkflows(),
		id?: string,
	): void {
		this.catalog.requireAvailable(workflow, definitions, id);
	}
	requireRunAvailable(run: FactoryRun): void {
		if (this.oldEngineRuns.has(run.id))
			throw new Error("Created by an older recipe engine; restart it");
		this.requireAvailable(run.workflow, run.workflowDefinitions ?? [], run.id);
	}
	availabilityImpact(id: string): string[] {
		return [...this.runs.values()]
			.filter(
				(run) =>
					!["completed", "stopped"].includes(run.status) &&
					this.dependsOn(run, id),
			)
			.map((run) => run.id);
	}
	private dependsOn(run: FactoryRun, id: string): boolean {
		const seen = new Set<string>();
		const visit = (w: Workflow): boolean => {
			if (seen.has(w.id)) return false;
			seen.add(w.id);
			if (w.id === id) return true;
			const walk = (steps: WorkflowStep[]): boolean =>
				steps.some(
					(step) =>
						(["workflow", "launch-runs"].includes(step.type) &&
							!!run.workflowDefinitions?.some(
								(child) =>
									child.id ===
										(step.type === "launch-runs"
											? (step.launchRuns?.workflow ?? "factory")
											: step.workflow) && visit(child),
							)) ||
						(step.groups ?? []).some(walk) ||
						(step.body ? walk(step.body) : false),
				);
			return walk(w.steps);
		};
		const policy = this.catalog.policyGraph(
			run.workflow,
			run.workflowDefinitions ?? [],
		);
		// Availability identities are checked separately from accepted graph data.
		const check = (w: Workflow, seen = new Set<string>()): boolean => {
			if (seen.has(w.id)) return false;
			seen.add(w.id);
			if (w.id === id) return true;
			const walk = (steps: WorkflowStep[]): boolean =>
				steps.some(
					(s) =>
						(["workflow", "launch-runs"].includes(s.type) &&
							policy.definitions.some(
								(child) =>
									child.id ===
										(s.type === "launch-runs"
											? (s.launchRuns?.workflow ?? "factory")
											: s.workflow) && check(child, seen),
							)) ||
						(s.groups ?? []).some(walk) ||
						(s.body ? walk(s.body) : false),
				);
			return walk(w.steps);
		};
		return policy.root === run.workflow
			? visit(run.workflow)
			: check(policy.root);
	}
	setWorkflowEnabled(id: string, enabled: boolean): void {
		// Persist policy and per-run resume requirements before requesting stops.
		this.catalog.setEnabled(id, enabled);
		if (!enabled)
			for (const run of this.runs.values())
				if (this.dependsOn(run, id)) this.hooks.stopTitle?.(run.id);
		if (!enabled)
			for (const run of this.runs.values()) {
				if (
					["completed", "stopped"].includes(run.status) ||
					!this.dependsOn(run, id)
				)
					continue;
				this.blockRun(run, [id]);
			}
		this.hooks.availabilityChanged?.(id, enabled);
		this.changed({ config: true });
	}
	private blockRun(run: FactoryRun, ids: string[]): void {
		this.catalog.block(run.id, {
			workflowIds: ids,
			at: new Date().toISOString(),
			priorStatus: run.status,
			reason: `Workflow disabled: ${ids.join(", ")}. Saved progress retained. Enable it, then Resume this run individually.`,
		});
		run.workflowBlock = this.catalog.getBlock(run.id);
		run.status = "blocked";
		this.save(run);
		this.hooks.stopTitle?.(run.id);
		this.controllers.get(run.id)?.abort(new Error(run.workflowBlock!.reason));
	}
	resume(id: string): FactoryRun {
		const run = this.get(id);
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		if (run.workflowBlock && this.isExecuting(id))
			throw new Error(
				"Resume requires blocked work whose executor has finished stopping",
			);
		if (this.oldEngineRuns.has(id))
			throw new Error("Created by an older recipe engine; restart it");
		this.requireAvailable(run.workflow, run.workflowDefinitions ?? []);
		if (run.workflowBlock) {
			const prior = run.workflowBlock.priorStatus;
			this.catalog.clearBlock(id);
			delete run.workflowBlock;
			delete run.error;
			run.status = prior === "waiting" ? "waiting" : "running";
			this.save(run);
		} else {
			if (!this.canResume(id))
				throw new Error("Only stopped runs with saved progress can be resumed");
			releaseDelivery(
				run,
				"Explicit resume must re-enter delivery coordination",
			);
			run.status = "running";
			delete run.error;
			this.updateViewState(id, { keptOpen: true });
			this.log(run, "run", "Resume requested; continuing from saved progress.");
		}
		void this.launch(run);
		return run;
	}
	importWorkflows(value: unknown): void {
		const previous = this.catalog.read();
		this.catalog.import(value);
		this.workflows = this.catalog.list();
		this.defaultWorkflow = this.catalog.defaultWorkflow();
		for (const [id, enabled] of Object.entries(this.catalog.read().enabled))
			if (!enabled && previous.enabled[id] !== false)
				this.setWorkflowEnabled(id, false);
		this.changed({ config: true });
	}
	getTitleSettings(): AgentSettings {
		return structuredClone(this.titleSettings);
	}
	resolveTitleSettings(): RunTitleJob["settings"] {
		const defaults = this.hooks.titleDefaults?.() ?? {
			runner: "claude" as const,
		};
		const runner = this.titleSettings.runner ?? defaults.runner;
		return {
			runner,
			model:
				this.titleSettings.model ?? this.hooks.titleDefaults?.(runner).model,
			...resolveAgentSettings(runner, this.titleSettings),
		};
	}
	createTitleJob(context: string): RunTitleJob {
		try {
			return {
				state: "pending",
				settings: this.resolveTitleSettings(),
				context,
			};
		} catch (error) {
			// Changing the inherited provider can invalidate saved native controls.
			// Naming configuration must never prevent the primary task from starting.
			return {
				state: "failed",
				settings: {
					runner:
						this.titleSettings.runner ??
						this.hooks.titleDefaults?.().runner ??
						"claude",
				},
				context,
				error: (error instanceof Error
					? error.message
					: "Invalid title agent settings"
				).slice(0, 240),
			};
		}
	}
	updateTitleSettings(value: unknown): AgentSettings {
		const settings = AgentSettingsSchema.strict().parse(value);
		resolveAgentSettings(
			settings.runner ?? this.hooks.titleDefaults?.().runner ?? "claude",
			settings,
		);
		this.atomicWrite(join(this.directory, "settings.json"), {
			titleGeneration: settings,
		});
		this.titleSettings = settings;
		this.changed({ config: true });
		return this.getTitleSettings();
	}
	updateTitle(id: string, job: RunTitleJob, title?: string): void {
		const run = this.get(id);
		run.titleGeneration = structuredClone(job);
		if (title) run.title = title;
		if (run.sessionSnapshot) {
			run.sessionSnapshot.displayTitle = run.title;
			run.sessionSnapshot.titleGeneration = structuredClone(job);
		}
		this.save(run);
	}

	selectWorkflow(
		labels: string[],
		trigger: WorkflowTrigger,
		explicit?: string,
	): Workflow {
		return this.selectLaunch(labels, trigger, explicit).workflow;
	}
	selectLaunch(
		labels: string[],
		trigger: WorkflowTrigger,
		explicit?: string,
	): {
		workflow: Workflow;
		workflowDefinitions: Workflow[];
		nativePreferences?: AgentSettings;
		selectionMethod: NonNullable<WorkflowTriggerOrigin["selectionMethod"]>;
	} {
		const selected = explicit
			? this.workflows.find((workflow) => workflow.id === explicit)
			: this.workflows.find((workflow) =>
					workflow.labels.some((label) => labels.includes(label)),
				);
		if (explicit && !selected) throw new Error(`Unknown workflow: ${explicit}`);
		const workflow =
			selected ??
			this.workflows.find((workflow) => workflow.id === this.defaultWorkflow)!;
		requireTrigger(workflow, trigger);
		this.requireAvailable(workflow);
		return {
			workflow: structuredClone(workflow),
			workflowDefinitions: this.listWorkflows(),
			nativePreferences:
				workflow.id === "simple" ? this.catalog.simplePreferences() : undefined,
			selectionMethod: explicit ? "explicit" : selected ? "label" : "default",
		};
	}
	create(
		options: {
			launchRequest?: FactoryRun["launchRequest"];
			setupComplete?: boolean;
			recipeParent?: FactoryRun["recipeParent"];
			repositories?: import("./RepositoryScope.js").RunRepository[];
			executionSnapshot?: ExecutionSnapshot;
			executionSelection?: ExecutionSelection;
			triggerOrigin: WorkflowTriggerOrigin;
			workflowDefinitions?: Workflow[];
			id?: string;
			title?: string;
			repositoryId: string;
			workflow: Workflow;
			workspace: string;
			input: string;
			launchInputs?: Record<string, string>;
			launchAttachments?: LaunchAttachments;
			source?: string;
			issueId?: string;
			workspaceId?: string;
			runner?: string;
			model?: string;
			reasoningEffort?: AgentSettings["reasoningEffort"];
			modelVariant?: string;
			serviceTier?: AgentSettings["serviceTier"];
		},
		acceptedLaunch?: {
			/** Internal child admission only; callers cannot supply this through launch inputs. */
			trigger?: WorkflowTrigger;
			workflow: Workflow;
			workflowDefinitions: Workflow[];
			nativePreferences?: AgentSettings;
		},
	): FactoryRun {
		// Only internal admission passes this already-accepted receipt. Public launch
		// inputs cannot supply graphs or assert ownership of reserved identities.
		if (acceptedLaunch)
			options = {
				...options,
				workflow: structuredClone(acceptedLaunch.workflow),
				workflowDefinitions: structuredClone(
					acceptedLaunch.workflowDefinitions,
				),
			};
		if (
			!options.triggerOrigin ||
			!["manual", "ticket-assignment"].includes(options.triggerOrigin.type)
		)
			throw new Error(
				"A new run requires a manual or ticket-assignment origin",
			);
		if (options.triggerOrigin.workflowId !== options.workflow.id)
			throw new Error("Launch origin does not match the selected workflow");
		// Reserved identities always resolve from the installed catalog, including
		// dependencies supplied in a cached admission receipt.
		const canonical = this.workflows.find((w) => w.id === options.workflow.id);
		if (
			!acceptedLaunch &&
			canonical &&
			this.catalog.metadata(canonical.id).ownership === "bundled"
		) {
			options = {
				...options,
				workflow: structuredClone(canonical),
				workflowDefinitions: this.listWorkflows(),
			};
		} else if (!acceptedLaunch && options.workflowDefinitions) {
			options = {
				...options,
				workflowDefinitions: options.workflowDefinitions.map(
					(w) =>
						this.workflows.find(
							(current) =>
								current.id === w.id &&
								this.catalog.metadata(current.id).ownership === "bundled",
						) ?? w,
				),
			};
		}
		requireTrigger(
			options.workflow,
			acceptedLaunch?.trigger ?? options.triggerOrigin.type,
		);
		this.requireAvailable(
			options.workflow,
			options.workflowDefinitions ?? this.listWorkflows(),
		);
		if (options.workflow.id === "simple")
			options = {
				...options,
				...resolveNativePreferences(
					acceptedLaunch?.nativePreferences ?? this.catalog.simplePreferences(),
					AgentSettingsSchema.parse(options),
				),
			};
		const id = options.id ?? randomUUID();
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid run ID");
		if (this.runs.has(id)) throw new Error(`Run already exists: ${id}`);
		const now = new Date().toISOString();
		const run: FactoryRun = {
			...structuredClone(options),
			workflowDefinitions: structuredClone(
				options.workflowDefinitions ?? this.listWorkflows(),
			),
			contractVersion: 2,
			executionSnapshot: Object.hasOwn(options, "executionSnapshot")
				? options.executionSnapshot
				: this.executionProfiles.select(
						options.repositoryId,
						options.executionSelection,
					),
			id,
			title: id,
			titleGeneration: {
				...this.createTitleJob(
					buildTitleContext({
						workflow: options.workflow.name,
						instructions: options.input,
						source: options.source,
						inputs: options.launchInputs,
					}),
				),
				repositoryId: options.repositoryId,
			},
			status: "running",
			createdAt: now,
			updatedAt: now,
			outputs: {},
			history: [],

			events: [],
		};
		run.roleContext = newRoleContext(run);
		initializeProgressBudget(run);
		this.runs.set(run.id, run);
		this.save(run);
		return run;
	}
	get(id: string): FactoryRun {
		const run = this.runs.get(id);
		if (!run) throw new Error("Run not found");
		return run;
	}
	log(
		run: FactoryRun,
		step: string,
		message: string,
		source: RunEvent["source"] = "workflow",
		call?: WorkflowCall,
	): void {
		const at = new Date().toISOString();
		run.activitySteps ??= activityMarkers({
			createdAt: run.createdAt,
			events: run.events,
			history: this.historyPreviews(run),
		});
		if (
			!["run", "prepare"].includes(step) &&
			run.activitySteps.at(-1)?.step !== step
		)
			run.activitySteps.push({ at, step });
		run.events.push(
			immutableJson({
				call,
				source,
				sequence: (run.events.at(-1)?.sequence ?? run.events.length - 1) + 1,
				at,
				step,
				message: message.slice(-20000),
			}),
		);
		if (run.events.length > 1500)
			run.events.splice(0, run.events.length - 1500);
		if (source === "agent") this.scheduleSave(run);
		else this.save(run);
	}
	launch(
		run: FactoryRun,
		task?: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		this.requireRunAvailable(run);
		if (this.controllers.has(run.id))
			throw new Error("Run is already executing");
		const controller = new AbortController();
		for (const batch of Object.values(run.launchActions ?? {}))
			if (!batch.cancelled) batch.paused = false;
		if (run.status === "waiting") run.status = "running";
		// Explicit Resume makes stopped stock work eligible without changing its
		// frozen graph. Persist the one-time allowance before any resumed role.

		this.controllers.set(run.id, controller);
		const execution = this.execute(run, controller, task);
		this.executions.set(run.id, execution);
		void execution.then(
			() => {
				this.executions.delete(run.id);
				// The final child may settle while this executor saves its graph-end state.
				// Reconcile after controller teardown so that wakeup cannot be lost.
				for (const batch of Object.values(run.launchActions ?? {}))
					void this.reconcileLaunchBatch(run, batch).catch(() => {});
				// Cancellation can release maintenance while a paused execution is
				// still persisting its final checkpoint. Resume after that save,
				// even if the release's resumeAll saw the old controller.
				if (
					this.updateSuspensions.delete(run.id) &&
					!this.shuttingDown &&
					run.status === "running" &&
					!existsSync(join(this.directory, "..", "updates", "maintenance.json"))
				)
					void this.launch(run);
			},
			() => this.executions.delete(run.id),
		);
		return execution;
	}
	private async execute(
		run: FactoryRun,
		controller: AbortController,
		task?: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		this.startDiagnostics();
		timingOperation(run, "run", { kind: "recovery" });
		this.checkpointDiagnostics(run);
		try {
			if (run.workspace)
				await reserveOwnedStorageWorkspace(
					dirname(this.directory),
					run.workspace,
					run.id,
					"Workflow launch or continuation",
				);
			await this.flush(run.id);
			controller.signal.throwIfAborted();
			this.assertSchedulingOpen();
			this.requireRunAvailable(run);
			for (const definition of [
				run.workflow,
				...(run.workflowDefinitions ?? []),
			])
				registerWorkflowConfig(definition, run.workflow.id);
			initializeProgressBudget(run, true);
			this.launchAssets.verify(run.id, run.launchAttachments);
			await this.hooks.prepare?.(run, controller.signal);
			timingOperation(run, "run");
			if (run.workspace)
				await reserveOwnedStorageWorkspace(
					dirname(this.directory),
					run.workspace,
					run.id,
					"Prepared workflow execution",
				);
			controller.signal.throwIfAborted();
			this.requireRunAvailable(run);
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key: "started",
					stage: "in_progress",
					body: `Factory work started: ${run.workflow.name}. ${String(readPath(run.outputs, "ticket.title") ?? run.title)}. Follow progress in Factory.`,
				});
			// A resumed detached action may already have reached graph end. Reconcile its
			// original batch explicitly; no further child event is guaranteed to wake it.
			for (const batch of Object.values(run.launchActions ?? {}))
				await this.reconcileLaunchBatch(run, batch, controller.signal);
			if (task) await task(controller.signal);
			else if (run.workflow.id === "simple") {
				if (!this.hooks.simple)
					throw new Error("Simple recovery handler unavailable");
				await this.hooks.simple(run, controller.signal);
			} else {
				run.checkpoint ??= this.recoverCheckpoint(run);
				await this.save(run);
				await this.graph(
					run,
					run.workflow.steps,
					run.outputs,
					controller.signal,
					"",
					run.checkpoint,
					run.workflow.id,
					run.workflow.chat ?? false,
				);
			}
			controller.signal.throwIfAborted();
			this.requireRunAvailable(run);
			run.status = this.launchOutcomeStatus(run);
			if (run.status === "failed")
				run.error =
					"Child batch retains blocked or cancelled outcomes. Inspect the original children; Retry reconciles their retained identities and dependencies.";

			this.log(
				run,
				"run",
				run.status === "waiting"
					? "Recipe steps complete; child batches remain tracked."
					: run.status === "failed"
						? run.error!
						: "Workflow complete.",
			);
		} catch (error) {
			if (run.workflowBlock) {
				run.status = "blocked";
				return;
			}
			if (isUpdatePaused(error) && !controller.signal.aborted) {
				this.updateSuspensions.add(run.id);
				this.log(run, "run", error.message);
				return;
			}
			if (this.shuttingDown && run.status !== "stopped") {
				this.log(
					run,
					"run",
					"Paused for shutdown; will resume automatically on startup.",
				);
				return;
			}
			run.status = controller.signal.aborted ? "stopped" : "failed";
			run.error = error instanceof Error ? error.message : String(error);
			controller.abort(); // Cancel sibling fanout branches on failure.
			this.log(run, "run", run.error);
		} finally {
			if (!this.shuttingDown || run.status === "stopped")
				releaseDelivery(run, `Run ${run.status}`);
			this.pendingAnswers.delete(run.id);
			if (run.diagnostics) run.diagnostics.operations = {};
			try {
				this.hooks.cleanupExecution?.(run);
			} catch {
				this.log(
					run,
					"run",
					"Private auth-cache cleanup failed; retained state needs operator cleanup.",
				);
			}
			try {
				await this.save(run);
				await this.publishTerminalOutcome(run);
			} finally {
				this.controllers.delete(run.id);
				this.checkpointDiagnostics(run);
			}
		}
	}
	private publishTerminalOutcome(run: FactoryRun): Promise<void> {
		const pending = this.terminalPublications.get(run.id);
		if (pending) return pending;
		const publication = this.publishTerminalOutcomeOnce(run);
		this.terminalPublications.set(run.id, publication);
		void publication.then(
			() => this.terminalPublications.delete(run.id),
			() => this.terminalPublications.delete(run.id),
		);
		return publication;
	}
	private async publishTerminalOutcomeOnce(run: FactoryRun): Promise<void> {
		if (
			this.shuttingDown ||
			!["completed", "failed", "stopped"].includes(run.status)
		)
			return;
		const key = `outcome:${run.status}:${run.history.length}`;
		if (
			run.launchActions &&
			run.launchOutcomePublication?.key === key &&
			run.launchOutcomePublication.phase === "confirmed"
		)
			return;
		try {
			if (run.launchActions) {
				run.launchOutcomePublication = { key, phase: "pending" };
				await this.save(run);
			}
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key,
					body:
						run.status === "completed"
							? `Workflow ${run.workflow.name} completed. Coding tickets become Done only after confirmed merge. Inspect run ${run.id} for results.`
							: `Workflow ${run.status}: ${run.error ?? "stopped by user"}. Work is preserved in run ${run.id}; restore access or answer the blocker before retrying.`,
				});
			await this.hooks.finished?.(run);
			if (run.launchActions) {
				run.launchOutcomePublication = { key, phase: "confirmed" };
				await this.save(run);
			}
		} catch (error) {
			this.log(
				run,
				"ticket-sync",
				`Final tracking hook failed: ${String(error)}. Underlying run outcome retained.`,
			);
		}
	}
	capacityOptions(run: FactoryRun, key: string, visit = 1): CapacityOptions {
		return {
			identity: `${this.directory}:run:${run.id}:${key}:${visit}`,
			workflowRun: {
				identity: `${this.directory}:run:${run.id}`,
				createdAt: run.createdAt,
			},
			recoverable: true,
			preserveOnShutdown: () => !run.workflowBlock && run.status !== "stopped",
			onChange: (request) => {
				this.accounting.capacityChanged(run, key, request);
				run.capacityLeaves ??= {};
				const previous = run.capacityLeaves[key]?.phase;
				if (request && request.phase !== previous)
					this.log(
						run,
						key,
						request.phase === "queued"
							? "Waiting for instance capacity."
							: request.phase === "stopping"
								? "Stopping execution; capacity remains reserved until it settles."
								: "Instance capacity admitted execution.",
					);
				if (request)
					run.capacityLeaves[key] = { phase: request.phase, request };
				else delete run.capacityLeaves[key];
				this.save(run);
			},
		};
	}
	/** Commit publication intent locally; provider delivery must not hold workflow progress. */
	async track(
		run: FactoryRun,
		milestone: import("./TicketTracking.js").TicketMilestone,
	): Promise<void> {
		try {
			if (
				(run.workflow.engineVersion === "nodes-v1" &&
					!milestone.viewDecision) ||
				!run.ticketReference ||
				!this.hooks.track
			)
				return;
			recordTicketMilestone(run, milestone);
			await this.save(run);
			// The outbox owns retries and deduplication. External tracking never
			// holds a graph step, execution capacity, or repository reservation.
			void Promise.resolve(this.hooks.track(run, milestone)).catch((error) =>
				this.log(
					run,
					"ticket-sync",
					`Ticket tracking failed: ${String(error)}`,
				),
			);
		} catch (error) {
			this.log(run, "ticket-sync", `Ticket tracking failed: ${String(error)}`);
		}
	}
	private async reserveExecution(
		context: ExecutionContext,
		scopes?: string[],
		mutation = !scopes,
	): Promise<() => Promise<void>> {
		const key = `${context.stepKey ?? context.step.id}:${mutation ? "mutation" : "resources"}`;
		const targets = () =>
			[
				...new Set([
					...(mutation ? deliveryScopes(context.run) : []),
					...(scopes ?? []),
				]),
			].sort();
		const admit = () =>
			acquireDelivery(
				context.run,
				() => this.runs.values(),
				context.signal,
				() => this.save(context.run),
				context.log,
				{
					key,
					ownerExecuting: (run) => this.isExecuting(run.id),
					preserveQueued: () =>
						this.shuttingDown &&
						!context.run.workflowBlock &&
						context.run.status !== "stopped",
					assertSchedulingOpen: context.assertSchedulingOpen,
					scopes: targets,
					reason: mutation
						? context.step.type === "agent"
							? "Push-capable agent: no proven boundary inside its execution"
							: "Repository integration/publication"
						: "Shared QA/environment resource",
					priority: resolveStepConfig(context.step).access.priority,
				},
			);
		await admit();
		let owned = context.run.deliveryReservations?.[key];
		const nested = context.coordinateDelivery;
		try {
			context.signal.throwIfAborted();
			if (mutation)
				context.coordinateDelivery = async (operation) => {
					if (
						owned?.phase !== "active" ||
						targets().some((target) => !owned?.scopes.includes(target))
					) {
						// Suspend this operation and reconcile its whole scope before any
						// new publication, retaining ownership until the outer operation settles.
						try {
							await admit();
						} finally {
							owned = context.run.deliveryReservations?.[key];
						}
					}
					context.signal.throwIfAborted();
					return operation();
				};
		} catch (error) {
			if (context.run.deliveryReservations?.[key] === owned)
				releaseDelivery(context.run, "Admission cancelled", key);
			await this.save(context.run);
			throw error;
		}
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			context.coordinateDelivery = nested;
			if (context.run.deliveryReservations?.[key] === owned)
				releaseDelivery(context.run, "Operation settled after cleanup", key);
			await this.save(context.run);
		};
	}
	private async coordinate<T>(
		context: ExecutionContext,
		operation: () => Promise<T>,
		scopes?: string[],
		mutation = !scopes,
	): Promise<T> {
		const release = await this.reserveExecution(context, scopes, mutation);
		try {
			return await operation();
		} finally {
			await release();
		}
	}
	async retryTracking(id: string): Promise<void> {
		await this.hooks.retryTracking?.(this.get(id));
	}

	private stepInput(
		run: FactoryRun,
		outputs: Record<string, unknown>,
		binding?: OutputRevisionBinding,
		iteration?: ItemFrame,
	) {
		if (binding?.inputScope)
			outputs = Object.fromEntries(
				binding.inputScope.outputKeys
					.filter((key) => Object.hasOwn(outputs, key))
					.map((key) => [key, outputs[key]]),
			);
		const input = {
			originalInput: run.input,
			launchInputs: structuredClone(run.launchInputs ?? {}),
			outputs: snapshotWorkflowInput(outputs),
			chatMessages: structuredClone(this.chatMessages(run.id)),
			history: snapshotHistory(
				run.history,
				0,
				binding?.inputScope?.historyLength ?? run.history.length,
			),
		};

		if (run.launchAttachments && Object.keys(run.launchAttachments).length) {
			Object.assign(input, {
				launchAttachments: structuredClone(run.launchAttachments),
			});
		}
		if (iteration)
			Object.assign(input, {
				item: structuredClone(iteration.value),
				index: iteration.index,
			});
		return input;
	}
	/** Resolve only retained runtime-owned lexical frames, never an output-shaped checkpoint. */
	private producerFrame(run: FactoryRun, key: string) {
		const find = (
			frame: GraphCheckpoint,
			steps: WorkflowStep[],
			workflow: Workflow,
			prefix: string,
			remaining: string[],
			inherited: Record<string, unknown>,
			chat: boolean,
			parallel: boolean,
		):
			| {
					frame: GraphCheckpoint;
					steps: WorkflowStep[];
					workflow: Workflow;
					prefix: string;
					step: WorkflowStep;
					outputs: Record<string, unknown>;
					chat: boolean;
					parallel: boolean;
			  }
			| undefined => {
			const [id, ...tail] = remaining;
			const step = steps.find((item) => item.id === id);
			if (!step) return;
			const outputs = frame.outputs ?? inherited;
			if (!tail.length)
				return {
					frame,
					steps,
					workflow,
					prefix,
					step,
					outputs,
					chat,
					parallel,
				};
			const active = frame.current === step.id ? frame.active : undefined;
			if (step.type === "workflow") {
				const called = run.workflowDefinitions?.find(
					(item) => item.id === step.workflow,
				);
				const child = active?.children?.[0] ?? frame.calls?.[step.id];
				if (called && child)
					return find(
						child,
						called.steps,
						called,
						`${prefix}${id}/`,
						tail,
						outputs,
						called.chat ?? chat,
						parallel,
					);
			} else if (step.type === "fanout") {
				const index = Number(tail[0]);
				const child = (active?.children ?? frame.branches?.[step.id])?.[index],
					group = step.groups?.[index];
				if (child && group)
					return find(
						child,
						group,
						workflow,
						`${prefix}${id}/${index}/`,
						tail.slice(1),
						outputs,
						chat,
						true,
					);
			} else if (step.type === "foreach") {
				const child = active?.children?.find(
					(item) => item.iteration?.id === tail[0],
				);
				if (child && active?.foreach)
					return find(
						child,
						active.foreach.body,
						workflow,
						`${prefix}${id}/${tail[0]}/`,
						tail.slice(1),
						active.foreach.outputs,
						chat,
						true,
					);
			}
			return undefined;
		};
		const workflow = run.workflow;
		const found =
			run.checkpoint &&
			find(
				run.checkpoint,
				workflow.steps,
				workflow,
				"",
				key.split("/"),
				run.outputs,
				workflow.chat ?? false,
				false,
			);
		if (!found)
			throw new Error(`Bound producer has no retained owning frame: ${key}`);
		if (found.frame.projectResults)
			this.restoreFrameReceipts(run, found.steps, found.frame, found.prefix);
		return found;
	}

	private importedProducerContext(
		consumer: ExecutionContext,
		key: string,
	): ExecutionContext {
		const owner = this.producerFrame(consumer.run, key);
		const outputs = { ...owner.outputs };
		this.hydrateProducerInputs(consumer.run, owner.prefix, owner.step, outputs);
		const context: ExecutionContext = {
			...consumer,
			step: owner.step,
			stepKey: key,
			outputs,
			iteration: owner.frame.iteration,
			callInputs: owner.frame.callInputs,
			snapshotInputs: owner.frame.snapshotInputs,

			bindingInput: (source, previous) =>
				this.producerInput(
					context,
					owner.frame,
					owner.prefix,
					source,
					previous,
				),
		};
		context.input = context.bindingInput!(
			owner.step,
			consumer.run.boundOutputs?.[key],
		);
		context.currentScope = () => ({
			originalInput: consumer.run.input,
			outputs,
		});
		return context;
	}
	/** Compare and execute with the same current lexical ports, including container frames. */
	private hydrateProducerInputs(
		run: FactoryRun,
		prefix: string,
		step: WorkflowStep,
		outputs: Record<string, unknown>,
	) {
		const caller = stepForRun(run, prefix.replace(/\/$/, ""));
		const names = new Set(Object.keys(caller?.bindings ?? {}));
		for (const binding of Object.values(resolveStepConfig(step).reads)) {
			if (!binding.from.startsWith("@")) names.add(binding.from.split("/")[0]!);
		}
		for (const name of names) {
			const source = producerKey(run, prefix, name);
			if (source === `${prefix}${name}`) continue;
			const value = producerValue(run, source);
			if (value === undefined) delete outputs[name];
			else outputs[name] = snapshotWorkflowInput(value);
		}
	}
	private producerRefreshes = new Map<string, Promise<void>>();
	private async refreshImportedProducer(
		consumer: ExecutionContext,
		key: string,
	) {
		const ownerKey = `${consumer.run.id}:${key.replace(/[^/]+$/, "")}`;
		const previous = this.producerRefreshes.get(ownerKey);
		const refreshing = (previous ?? Promise.resolve()).then(() =>
			this.refreshProducerInFrame(consumer, key),
		);
		this.producerRefreshes.set(ownerKey, refreshing);
		try {
			await refreshing;
		} finally {
			if (this.producerRefreshes.get(ownerKey) === refreshing)
				this.producerRefreshes.delete(ownerKey);
		}
	}

	private async refreshProducerInFrame(
		consumer: ExecutionContext,
		key: string,
	) {
		const { run, signal } = consumer;
		const owner = this.producerFrame(run, key),
			frame = owner.frame;
		if (!frame.producerRefresh) {
			const context = this.importedProducerContext(consumer, key),
				receipt = run.boundOutputs?.[key];
			if (
				!receipt ||
				sameOutputBinding(
					receipt,
					await outputRevisionBinding(context, receipt),
				)
			)
				return;
			frame.producerRefresh = {
				source: owner.step.id,
				current: frame.current,
				active: frame.active,
				outcome: frame.outcome,
			};
			frame.current = owner.step.id;
			const session =
				isNodeEngineStep(owner.step) && owner.step.session !== "resume"
					? undefined
					: frame.agentSessions?.[owner.step.id];
			if (session)
				frame.visits[owner.step.id] = (frame.visits[owner.step.id] ?? 0) + 1;
			frame.active = session
				? { phase: "executing", agent: { ...session } }
				: undefined;
			await this.save(run);
		} else if (frame.producerRefresh.source !== owner.step.id)
			throw new Error("Another producer refresh owns this frame");
		await this.graph(
			run,
			owner.steps,
			owner.outputs,
			signal,
			owner.prefix,
			frame,
			owner.workflow.id,
			owner.chat,
			owner.parallel,
		);
	}

	private producerInput(
		context: ExecutionContext,
		frame: GraphCheckpoint,
		prefix: string,
		source: WorkflowStep,
		previous?: OutputRevisionBinding,
	) {
		const { run } = context;
		const outputs = context.outputs ?? run.outputs;

		const sourceInput = this.stepInput(run, outputs, previous, frame.iteration);
		const sourceContext = {
			...context,
			step: source,
			stepKey: `${prefix}${source.id}`,
			input: sourceInput,
		};
		const bindings = stepBindings(
			sourceContext,
			bindingHistory(sourceContext, previous),
		);
		if (source.reads) {
			Object.assign(sourceInput, bindings);
			retainTranscriptSource(bindings, sourceInput);
		}
		return sourceInput;
	}

	private nodeEngine(): NodeEngine {
		return {
			graph: this.graph.bind(this),
			newCheckpoint: this.newCheckpoint.bind(this),
			frameResults: this.frameResults.bind(this),
			historyPreviews: this.historyPreviews.bind(this),
			save: this.save.bind(this),
			log: this.log.bind(this),
			hooks: this.hooks,
			runs: this.runs,
			subscribe: this.subscribe.bind(this),
			reconcileLaunchBatch: this.reconcileLaunchBatch.bind(this),
			humanViews: this.humanViews,
		};
	}
	private async graph(
		run: FactoryRun,
		steps: WorkflowStep[],
		outputs: Record<string, unknown>,
		signal: AbortSignal,
		prefix: string,
		checkpoint: GraphCheckpoint,
		workflowId: string,
		chat = false,
		parallel = false,
	): Promise<Record<string, unknown>> {
		const definition = [run.workflow, ...(run.workflowDefinitions ?? [])].find(
			(item) => item.id === workflowId,
		);
		const outcomes = definition?.outcomes ?? [];
		if (!prefix && definition?.inputs) {
			for (const name of definition.inputs) {
				if (
					Object.hasOwn(outputs, name) ||
					!Object.hasOwn(run.launchInputs ?? {}, name)
				)
					continue;
				const value = run.launchInputs![name];
				if (typeof value !== "string") continue;
				try {
					outputs[name] = JSON.parse(value);
				} catch {
					outputs[name] = value;
				}
			}
		}
		if (!prefix && run.progressBudget && definition?.inputs) {
			checkpoint.progressInputs = Object.fromEntries(
				definition.inputs.flatMap((name) => {
					const raw = run.launchInputs?.[name];
					if (typeof raw !== "string") return [];
					let value: unknown = raw;
					try {
						value = JSON.parse(raw);
					} catch {
						/* Accepted text input. */
					}
					return [[name, digest(value)]];
				}),
			);
		}
		if (checkpoint.projectResults)
			this.restoreFrameReceipts(run, steps, checkpoint, prefix);
		while (checkpoint.current !== "end") {
			signal.throwIfAborted();
			this.assertSchedulingOpen();
			const step = steps.find((item) => item.id === checkpoint.current)!;
			const key = `${prefix}${step.id}`;
			const config = resolveStepConfig(step);
			this.hydrateProducerInputs(run, prefix, step, outputs);
			if (!checkpoint.active) {
				checkpoint.visits[step.id] = (checkpoint.visits[step.id] ?? 0) + 1;
				const retainedSession =
					run.progressBudget?.sessions[key] ??
					checkpoint.agentSessions?.[step.id];
				const session =
					step.type === "agent" && step.session
						? step.session === "resume"
							? ((isNodeEngineStep(step)
									? run.agentNodeSessions?.[key]?.agent
									: undefined) ?? checkpoint.agentSessions?.[step.id])
							: undefined
						: retainedSession;

				checkpoint.active = {
					phase: "executing",
					...(session ? { agent: { ...session } } : {}),
				};
				await this.save(run);
				signal.throwIfAborted();
			}
			const state = checkpoint.active;
			const count = checkpoint.visits[step.id]!;
			const limit = stepVisitLimit(
				run,
				key,
				step,
				checkpoint.additionalVisits?.[step.id],
			);
			if (count > limit) {
				run.step = key;
				run.iterationLimit = { step: key, visits: count, limit };
				throw new Error(
					`Iteration limit reached at ${key} (${limit} passes). Continue grants 4 additional passes for this step; all completed work is retained.`,
				);
			}
			run.step = key;
			this.log(run, key, `Starting ${step.name} (pass ${count})`);
			const boundScope =
				checkpoint.producerRefresh?.source === step.id ||
				checkpoint.refreshes?.at(-1)?.source === step.id ||
				state.phase !== "executing"
					? run.boundOutputs?.[key]
					: undefined;
			const input = this.stepInput(
				run,
				outputs,
				boundScope,
				checkpoint.iteration,
			);
			this.requireRunAvailable(run);
			this.launchAssets.verify(run.id, run.launchAttachments);
			const execution = this.hooks.execution
				? await this.hooks.execution(run, step.runner ?? run.runner)
				: undefined;
			const context: ExecutionContext = {
				progressInputs: checkpoint.progressInputs,
				error: checkpoint.error,
				transcriptEntries: this.hooks.transcriptEntries
					? () => this.hooks.transcriptEntries!(run.id)
					: undefined,
				progressItem: checkpoint.progressItem,
				progressOperation: `${checkpoint.progressPath ?? workflowId}/${step.id}${checkpoint.iteration ? `/${checkpoint.iteration.id}` : ""}`,
				assertSchedulingOpen: () => this.assertSchedulingOpen(),
				factoryHome: dirname(this.directory),
				attemptId: state.attemptId,
				checkpointDiagnostics: () => this.checkpointDiagnostics(run),
				execution,

				iteration: checkpoint.iteration
					? immutableJson(checkpoint.iteration)
					: undefined,
				callInputs: checkpoint.callInputs
					? immutableJson(checkpoint.callInputs)
					: undefined,
				snapshotInputs: checkpoint.snapshotInputs
					? immutableJson(checkpoint.snapshotInputs)
					: undefined,
				run,
				step,
				stepKey: key,
				historyIndex: () => this.historyPreviews(run),
				currentScope: () => ({
					originalInput: run.input,
					...(checkpoint.iteration
						? {
								item: structuredClone(checkpoint.iteration.value),
								index: checkpoint.iteration.index,
							}
						: {}),
					launchAttachments: run.launchAttachments,
					outputs,
					chatMessages: this.chatMessages(run.id),
				}),
				capacity: this.capacityOptions(run, key, count),
				chat: step.chat ?? chat,
				chatMessages: structuredClone(this.chatMessages(run.id)),
				input,
				bindingInput: (source, previous) =>
					this.producerInput(context, checkpoint, prefix, source, previous),
				outputs,
				signal,
				log: (message, source) =>
					this.log(run, key, execution?.redact(message) ?? message, source),
				evidenceDir: join(this.directory, "evidence", run.id),
				resumeAgent: state.agent,
				previousAgentOutput:
					run.agentNodeSessions?.[key]?.output ?? outputs[step.id],
				resumeFallback:
					state.agent?.resumeFallback ??
					(isNodeEngineStep(step) &&
					step.session === "resume" &&
					!state.agent?.sessionId &&
					(run.agentNodeSessions?.[key] || checkpoint.visits[step.id]! > 1)
						? {
								output:
									run.agentNodeSessions?.[key]?.output ?? outputs[step.id],
							}
						: undefined),
				checkpointAgent: async (agent) => {
					state.agent = agent;
					if (agent.sessionId && agent.sessionId !== "pending") {
						checkpoint.agentSessions ??= {};
						if (run.progressBudget)
							run.progressBudget.sessions[key] = {
								runner: agent.runner,
								sessionId: agent.sessionId,
								idleRetries: agent.idleRetries,
							};
						if (isNodeEngineStep(step)) {
							run.agentNodeSessions ??= {};
							run.agentNodeSessions[key] = {
								...run.agentNodeSessions[key],
								agent: {
									runner: agent.runner,
									sessionId: agent.sessionId,
									model: agent.model,
								},
							};
						}
						checkpoint.agentSessions[step.id] = {
							...(agent.model ? { model: agent.model } : {}),
							runner: agent.runner,
							sessionId: agent.sessionId,
						};
					}
					await this.save(run);
					signal.throwIfAborted();
				},
				save: () => this.save(run),
			};
			context.progressObservation = state.retryProgressObservation;
			context.beginProgressAttempt = async (reason) => {
				if (state.retryProgressObservation) {
					delete state.retryProgressObservation;
					return;
				}
				await beginProgressAttempt(context, reason);
			};
			let consumedReads: Record<string, unknown> | undefined;
			if (step.reads) {
				const bindings = stepBindings(
					context,
					bindingHistory(context, boundScope),
				);
				consumedReads = bindings;
				Object.assign(input, bindings);
				retainTranscriptSource(bindings, input);
			}
			if (checkpoint.iteration)
				Object.assign(input, {
					item: structuredClone(checkpoint.iteration.value),
					index: checkpoint.iteration.index,
				});
			if (state.refreshProducer) {
				await this.refreshImportedProducer(context, state.refreshProducer);
				delete state.refreshProducer;
				await this.save(run);
				continue;
			}
			let staleSource: WorkflowStep | undefined;
			let importedSource: string | undefined;
			const sourceKeys = new Set([
				...Object.values(config.reads)
					.filter((binding) => !binding.from.startsWith("@"))
					.map((binding) =>
						producerKey(run, prefix, binding.from.split("/")[0]!),
					),
				...Object.keys(
					step.inputFreshness === "on-read" ? {} : (step.bindings ?? {}),
				).map((name) => producerKey(run, `${key}/`, name)),
			]);
			for (const sourceKey of sourceKeys) {
				const source = stepForRun(run, sourceKey);
				const receipt = run.boundOutputs?.[sourceKey];
				if (!source || !receipt || sourceKey === key) continue;
				const local = sourceKey === `${prefix}${source.id}`;
				const sourceContext = local
					? { ...context, step: source, stepKey: sourceKey }
					: this.importedProducerContext(context, sourceKey);
				const current = await outputRevisionBinding(sourceContext, receipt);
				if (!current || sameOutputBinding(receipt, current)) continue;
				if (local) staleSource = source;
				else importedSource = sourceKey;
				break;
			}
			if (importedSource) {
				state.refreshProducer = importedSource;
				await this.save(run);
				continue;
			}
			if (staleSource) {
				this.log(
					run,
					key,
					`Bound input ${staleSource.name} is stale; rerunning its configured producer before consuming it.`,
				);
				checkpoint.refreshes ??= [];
				checkpoint.refreshes.push({
					source: staleSource.id,
					target: step.id,
					active: state,
				});
				checkpoint.current = staleSource.id;
				const session =
					isNodeEngineStep(staleSource) && staleSource.session !== "resume"
						? undefined
						: checkpoint.agentSessions?.[staleSource.id];
				if (session)
					checkpoint.visits[staleSource.id] =
						(checkpoint.visits[staleSource.id] ?? 0) + 1;
				checkpoint.active = session
					? { phase: "executing", agent: { ...session } }
					: undefined;
				await this.save(run);
				continue;
			}
			if (
				config.revision === "bound" &&
				state.phase !== "executing" &&
				run.boundOutputs?.[key]
			) {
				const currentBinding = await outputRevisionBinding(
					context,
					run.boundOutputs[key],
				);
				if (!sameOutputBinding(run.boundOutputs[key], currentBinding)) {
					this.log(
						run,
						key,
						"Bound output is stale after repository or input change; rerunning the configured step.",
					);
					checkpoint.active = undefined;
					await this.save(run);
					continue;
				}
			}
			context.coordinateDelivery = (operation) =>
				this.coordinate(context, operation);
			mkdirSync(context.evidenceDir, { recursive: true });
			let output: unknown = outputs[step.id];
			const advance = (next: string) => {
				const route = step.branches.find(
					(branch) =>
						JSON.stringify(readPath(output, branch.when.path)) ===
						JSON.stringify(branch.when.equals),
				);
				if (route?.entry) checkpoint.entry = route.entry;
				if (outcomes.includes(next)) {
					checkpoint.outcome = next;
					checkpoint.current = "end";
					if (checkpoint.projectResults)
						checkpoint.resultReceipts![step.id] = immutableJson({
							key,
							output: snapshotWorkflowInput(output),
						});
				} else checkpoint.current = next;
			};
			if (state.phase === "executing") {
				let completionMessage: string | undefined;
				if (state.retryAt !== undefined) {
					await nodeWaitPhase(context, () => this.save(run))("waiting-ci", () =>
						sleep(Math.max(0, state.retryAt! - Date.now()), undefined, {
							signal,
						}),
					);
				}
				delete state.retryAt;
				state.attemptId = beginStepAttempt(context);
				await this.save(run);
				signal.throwIfAborted();
				try {
					const nodeCtx = await nodeContext(
						context,
						checkpoint,
						workflowId,
						parallel,
						this.nodeEngine(),
						chat,
						step.type === "agent" ? consumedReads : undefined,
					);
					nodeCtx.sourceInput = input;

					const reused = reusableNodeOutput(
						nodeCtx,
						nodeCtx.inputDigest,
						nodeCtx.guarantee,
					);
					const reuseHit = !!reused && (await nodeCtx.fresh(step.id));
					if (!reuseHit && step.type === "check")
						await context.beginProgressAttempt?.();

					if (reuseHit) {
						nodeCtx.guarantee.state = structuredClone(reused!.guarantee?.state);
						output = structuredClone(reused!.output);
						completionMessage = "reused (inputs unchanged)";
					} else if (!nodeRegistry.get(step.type).inline) {
						output = await nodeRegistry.execute(nodeCtx);
						if (output === NODE_REROUTE) continue;
						const summary = nodeRegistry.get(step.type).summary?.(output);
						if (summary) completionMessage = summary;
					} else {
						run.capacityLeaves ??= {};
						run.capacityLeaves[key] = { phase: "executing" };
						timingOperation(run, key, {
							kind:
								run.capacityLeaves[key].phase === "waiting-ci"
									? "provider-ci"
									: run.capacityLeaves[key].phase === "waiting-human"
										? "human"
										: step.type === "agent" && this.hooks.agentExecutionBoundary
											? "unknown"
											: "execution",
							role: step.type === "agent",
						});
						await this.save(run);
						signal.throwIfAborted();
						try {
							const execute = async () => {
								this.requireRunAvailable(run);
								signal.throwIfAborted();
								if (config.revision === "bound") {
									context.inspectionBinding =
										state.agent?.inspection ??
										(await outputRevisionBinding(context, boundScope, true));
									await assertBoundInspectionFresh(context);
								}
								if (step.type !== "agent" || !this.hooks.agentExecutionBoundary)
									await context.beginProgressAttempt?.();
								return this.hooks.agent(context);
							};
							const resources = resourceScopes(context);
							const mutation = deliveryStep(run, step);
							const reserved = () =>
								this.coordinate(
									context,
									execute,
									resources.length ? resources : undefined,
									mutation,
								);
							if (step.type === "agent" && this.hooks.agentExecutionBoundary) {
								if (mutation || resources.length)
									context.reserveExecution = async () => {
										const release = await this.reserveExecution(
											context,
											resourceScopes(context).length
												? resourceScopes(context)
												: undefined,
											mutation,
										);
										try {
											this.requireRunAvailable(run);
											context.signal.throwIfAborted();
											await assertBoundInspectionFresh(context);
											return release;
										} catch (error) {
											await release();
											throw error;
										}
									};
								output = await execute();
							} else {
								const admitted =
									mutation || resources.length ? reserved : execute;
								if (
									step.type !== "agent" &&
									isComputeIntensive(step) &&
									this.hooks.capacity
								) {
									const lease = await this.hooks.capacity.acquireLease(signal, {
										...context.capacity,
									});
									try {
										signal.throwIfAborted();
										this.requireRunAvailable(run);
										output = await lease.run(admitted);
									} finally {
										await lease.release();
									}
								} else output = await admitted();
							}
							await assertBoundInspectionFresh(context);
						} catch (error) {
							if (
								!execution ||
								isUpdatePaused(error) ||
								error instanceof StaleBoundInspectionError
							)
								throw error;
							throw new Error(
								execution.redact(
									error instanceof Error ? error.message : String(error),
								),
							);
						} finally {
							if (
								(!this.shuttingDown || run.status === "stopped") &&
								!run.capacityLeaves[key]?.request?.parked &&
								run.capacityLeaves[key]?.phase !== "stopping"
							)
								delete run.capacityLeaves[key];
							timingOperation(run, key);
							await this.save(run);
							signal.throwIfAborted();
						}
					}
					signal.throwIfAborted();
					if (execution && output !== undefined)
						output = JSON.parse(execution.redact(JSON.stringify(output)));
					if (
						!reuseHit &&
						((step.type === "agent" && accessMode(step) !== "read-only") ||
							// Snapshot records its captured commit, rather than the live checkout.
							(step.type !== "snapshot" && nodeEffect(step) === "effect"))
					)
						nodeCtx.recordRevisions(await scopedNodeRevisions(context));
					const acceptedBinding = await assertBoundInspectionFresh(context);
					outputs[step.id] = output;
					if (step.type === "agent" && isNodeEngineStep(step)) {
						run.agentNodeSessions ??= {};
						run.agentNodeSessions[key] = {
							...run.agentNodeSessions[key],
							output,
						};
					}
					if (config.revision === "bound") {
						run.boundOutputs ??= {};
						run.boundOutputs[key] =
							acceptedBinding ??
							(await outputRevisionBinding(context, boundScope, true))!;
					}
					if (key !== step.id) run.outputs[key] = output;
					run.history.push(
						immutableJson({
							step: key,
							...nodeCtx.stamp(output),
							...(checkpoint.iteration
								? {
										iteration: {
											frame: checkpoint.iteration.frame,
											id: checkpoint.iteration.id,
											index: checkpoint.iteration.index,
											itemDigest: digest(checkpoint.iteration.value),
										},
									}
								: {}),

							at: new Date().toISOString(),
							...(state.call ? { call: state.call } : {}),
						}),
					);
					delete checkpoint.error;
					delete state.retryProgressObservation;
					state.phase = "result";
					finishStepAttempt(
						context,
						readPath(output, "status") === "failed"
							? "failed"
							: readPath(output, "status") === "blocked"
								? "blocked"
								: "completed",
					);
					if (completionMessage) this.log(run, key, completionMessage);
					await this.save(run);
					signal.throwIfAborted();
				} catch (error) {
					if (
						error instanceof NonConvergenceError ||
						error instanceof WorkflowUnavailableError
					) {
						finishStepAttempt(context, "interrupted");
						throw error;
					}
					if (
						!context.progressObservation &&
						!run.progressBudget?.blocked &&
						!signal.aborted &&
						!isUpdatePaused(error)
					)
						await context.beginProgressAttempt?.("preflight-failure");
					recordProgressFailure(
						context,
						state.agent?.infrastructureFailure
							? "infrastructure"
							: state.agent?.rejected
								? "output-validation"
								: signal.aborted
									? "interrupted"
									: "execution",
						error instanceof Error ? error.message : String(error),
					);
					if (!signal.aborted && error instanceof StaleBoundInspectionError) {
						finishStepAttempt(context, "interrupted");
						this.log(run, key, error.message);
						const session = state.agent?.sessionId
							? {
									runner: state.agent.runner,
									sessionId: state.agent.sessionId,
									...(isNodeEngineStep(step)
										? { model: state.agent.model }
										: {}),
								}
							: undefined;
						if (session)
							checkpoint.visits[step.id] =
								(checkpoint.visits[step.id] ?? 0) + 1;
						checkpoint.active = session
							? { phase: "executing", agent: session }
							: undefined;
						await this.save(run);
						continue;
					}
					finishStepAttempt(
						context,
						signal.aborted || isUpdatePaused(error)
							? "interrupted"
							: state.agent?.infrastructureFailure
								? "blocked"
								: "failed",
					);

					if (
						!signal.aborted &&
						!isUpdatePaused(error) &&
						state.phase === "executing"
					) {
						if (step.retry && (state.retries ?? 0) < step.retry.max) {
							state.retryProgressObservation = context.progressObservation;
							state.retries = (state.retries ?? 0) + 1;
							state.retryAt = Date.now() + step.retry.backoff;
							this.log(
								run,
								key,
								`Retry ${state.retries}/${step.retry.max}: ${error instanceof Error ? error.message : String(error)}`,
							);
							await this.save(run);
							continue;
						}
						if (step.onError && !(error instanceof EffectReconciliationError)) {
							checkpoint.error = {
								message: error instanceof Error ? error.message : String(error),
								kind:
									error &&
									typeof error === "object" &&
									"kind" in error &&
									typeof error.kind === "string"
										? error.kind
										: error instanceof Error
											? error.name
											: "Error",
							};
							checkpoint.current = step.onError;
							checkpoint.active = undefined;
							this.log(
								run,
								key,
								`Error routed to ${step.onError}: ${checkpoint.error.message}`,
							);
							await this.save(run);
							continue;
						}
					}
					throw error;
				}
			}
			if (checkpoint.projectResults)
				Object.defineProperty(checkpoint.resultReceipts!, step.id, {
					value: immutableJson({ key, output: snapshotWorkflowInput(output) }),
					enumerable: true,
					configurable: true,
					writable: true,
				});
			const refreshing = checkpoint.refreshes?.at(-1);
			if (refreshing?.source === step.id) {
				checkpoint.refreshes!.pop();
				checkpoint.current = refreshing.target;
				checkpoint.active = refreshing.active;
			} else if (checkpoint.producerRefresh?.source === step.id) {
				const saved = checkpoint.producerRefresh;
				checkpoint.current = saved.current;
				checkpoint.active = saved.active;
				checkpoint.outcome = saved.outcome;
				delete checkpoint.producerRefresh;
				await this.save(run);
				return outputs;
			} else {
				const next = this.nextStep(steps, step, output);
				if (
					checkpoint.iteration &&
					next === "end" &&
					["failed", "blocked"].includes(String(readPath(output, "status")))
				) {
					// Failure belongs to its exact lexical destination, including inside calls/Parallel.
					// Retain the accepted receipt and native checkpoint until explicit Retry.
					state.terminalFailure = true;
					await this.save(run);
					throw new Error(
						`Item ended with ${String(readPath(output, "status") ?? "incomplete evidence")} at ${key}`,
					);
				}
				advance(next);
				checkpoint.active = undefined;
			}
			this.log(run, key, `Finished ${step.name}`);
		}
		return outputs;
	}
	async publishViewDecision(
		run: FactoryRun,
		text: string,
		batchId: string,
		displayDigest?: string,
	) {
		if (displayDigest) {
			const record = run.viewRecords?.find(
				(record) => record.snapshot.id === batchId,
			);
			const current = () =>
				record &&
				!record.answer &&
				!record.superseded &&
				run.status === "waiting" &&
				run.viewDecision?.id === batchId &&
				run.viewDecision.digest === displayDigest &&
				record.snapshot.digest === displayDigest;
			if (!current() || !record || record.publicationDigest === displayDigest)
				return;
			// Original no-discussion waits were already published with their unchanged
			// digest. Old waits with Ask need their first current-discussion intent.
			const legacyIntent = run.ticketSync?.receipts.some(
				(receipt) =>
					receipt.key === `view:${batchId}` &&
					!receipt.superseded &&
					receipt.body.startsWith(
						`${record.snapshot.kind}\nDecision batch: ${batchId}\nDisplayed digest: ${displayDigest}\n`,
					),
			);
			const legacyPublished =
				(!(run.ticketReference && this.hooks.track) || legacyIntent) &&
				record.notified &&
				!record.publicationDigest &&
				!Object.values(record.snapshot.threads ?? {}).some(
					(threads) => threads.length,
				);
			record.publicationDigest = displayDigest;
			record.notified = true;
			if (legacyPublished) {
				await this.save(run);
				return;
			}
			if (run.ticketReference && this.hooks.track) {
				// track records the intent before its first save, atomically with the
				// publication claim. Its outbox owns provider retries and deduplication.
				await this.track(run, {
					key: `view:${batchId}:${displayDigest}`,
					body: text,
					viewDecision: { batchId, digest: displayDigest },
				});
			} else {
				await this.save(run);
				await this.hooks.viewDecision?.(run, text);
			}
			return;
		}
		if (run.ticketReference && this.hooks.track)
			await this.track(run, { key: `view:${batchId}`, body: text });
		else await this.hooks.viewDecision?.(run, text);
	}
	async answerView(id: string, input: unknown) {
		this.requireRunAvailable(this.get(id));
		return this.humanViews.answer(id, input);
	}
	async askView(id: string, input: unknown) {
		this.requireRunAvailable(this.get(id));
		return this.humanViews.ask(id, input);
	}
	async replyView(id: string, text: string) {
		if (!text.startsWith("/view-answer "))
			throw new Error(
				"This decision requires the explicit /view-answer JSON command with its current batch and displayed digest, or the Factory dashboard.",
			);
		return this.answerView(id, JSON.parse(text.slice(13)));
	}
	stop(id: string): void {
		const run = this.get(id);
		for (const batch of Object.values(run.launchActions ?? {}))
			batch.paused = true;
		this.hooks.stopTitle?.(id);
		if (!["running", "waiting", "failed", "interrupted"].includes(run.status))
			return;
		run.status = "stopped";
		this.controllers.get(id)?.abort();
		this.log(run, "run", "Terminated by user");
		if (run.ticketReference && this.hooks.track)
			void this.track(run, {
				key: `outcome:stopped:${run.history.length}`,
				body: `Workflow stopped by user. Run ${run.id} retains its work and remains open; resume or start a follow-up when ready.`,
			});
	}
	/** The same graph capability drives the API action and its presentation. */
	canResume(id: string): boolean {
		const run = this.get(id);
		return (
			!this.shuttingDown &&
			!this.oldEngineRuns.has(id) &&
			run.status === "stopped" &&
			!this.catalog.unavailable(run.workflow, run.workflowDefinitions ?? [])
				.length &&
			!this.controllers.has(id) &&
			(this.snapshots.hasValue(
				run as unknown as Record<string, unknown>,
				"checkpoint",
			) ||
				this.snapshots.hasValue(
					run as unknown as Record<string, unknown>,
					"simpleExecution",
				))
		);
	}
	hasRunValue(run: FactoryRun, key: keyof FactoryRun): boolean {
		return this.snapshots.hasValue(
			run as unknown as Record<string, unknown>,
			key,
		);
	}
	retry(id: string, transcriptExtension?: TranscriptExtension): FactoryRun {
		const run = this.get(id);
		this.requireRunAvailable(run);
		if (this.shuttingDown) throw new Error("Factory is shutting down");

		if (transcriptExtension) {
			const step = stepForRun(run, transcriptExtension.work);
			if (!step || step.type !== "agent")
				throw new Error(
					"Transcript extension requires the original configured agent role",
				);
			const access = roleContextAccess({
				run,
				step,
				stepKey: transcriptExtension.work,
				factoryHome: dirname(this.directory),
			});
			if (!access)
				throw new Error(
					"This accepted run has no outputs-first transcript policy",
				);
			const grant = extendTranscriptAccess(access, transcriptExtension);
			this.log(
				run,
				"run",
				`Bounded transcript extension for ${access.work}: ${grant.pages} pages/${grant.utf8Bytes} UTF-8 bytes; reason: ${grant.reason}. Original range, native permissions and all acceptance/delivery gates retained.`,
			);
		}
		releaseDelivery(run, "Explicit retry must re-enter delivery coordination");
		const convergenceGrant = run.progressBudget?.blocked;
		const progressGrant = continueProgress(run);
		if (convergenceGrant && progressGrant)
			this.log(
				run,
				"run",
				`Continue authorized ${progressGrant.observations ?? progressGrant.attempts} additional ${progressGrant.observations ? "observation slots" : "convergence attempts"} for ${convergenceGrant.operation} at ${convergenceGrant.identity}; quality gates and original receipts retained.`,
			);
		// Retry is an explicit request for bounded additional work, never a global reset.
		const extend = (
			frame: GraphCheckpoint,
			steps: WorkflowStep[],
			prefix: string,
		) => {
			const step = steps.find((item) => item.id === frame.current);
			if (!step) return;

			if (!step) return;
			const key = `${prefix}${step.id}`;
			if (frame.active?.terminalFailure) {
				const native = frame.active.agent;
				frame.active = {
					actionId: frame.active.actionId,
					phase: "executing",
					...(native?.sessionId
						? { agent: { runner: native.runner, sessionId: native.sessionId } }
						: {}),
				};
				frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
			}
			const agent =
				frame.active?.phase === "executing" ? frame.active.agent : undefined;
			if (agent?.infrastructureFailure) {
				agent.infrastructureFailure.retryGeneration =
					(agent.infrastructureFailure.retryGeneration ?? 0) + 1;
				this.log(
					run,
					"run",
					`Infrastructure repair retry generation ${agent.infrastructureFailure.retryGeneration} for ${key}; mandatory tools must verify readiness before native work, and schema budget is unchanged.`,
				);
			}
			if (
				step.type === "agent" &&
				agent?.rejected &&
				agent.infrastructureFailure &&
				!agent.rejected.exhausted
			)
				agent.rejected.retryGeneration =
					(agent.rejected.retryGeneration ?? 0) + 1;
			if (step.type === "agent" && agent?.rejected?.exhausted) {
				// Explicit Retry authorizes a fresh bounded budget for this role.
				// Keep the candidate, issues, revision and native conversation.
				agent.rejected = {
					...agent.rejected,
					attempts: 0,
					retryGeneration: (agent.rejected.retryGeneration ?? 0) + 1,
					reserved: false,
					exhausted: false,
				};
				this.log(
					run,
					"run",
					`Retry authorized another bounded output-correction cycle for ${key}; rejected output, issues and completed work retained.`,
				);
			}
			if (
				frame.active?.phase === "executing" &&
				this.isUnstartedCodexAgent(run, frame.active.agent, key)
			) {
				delete frame.active.agent;
				this.log(
					run,
					"run",
					`Removed invalid Codex startup checkpoint for ${key}; retry starts this role with saved context, work and evidence retained.`,
				);
			}
			const limit = stepVisitLimit(
				run,
				key,
				step,
				frame.additionalVisits?.[step.id],
			);
			if ((frame.visits[step.id] ?? 0) > limit) {
				frame.additionalVisits ??= {};
				frame.additionalVisits[step.id] =
					(frame.additionalVisits[step.id] ?? 0) + 4;
				this.log(
					run,
					"run",
					`Continue authorized 4 additional passes for ${prefix}${step.id} (limit ${limit + 4}); history retained.`,
				);
			}
			if (step.type === "workflow") {
				const child = run.workflowDefinitions?.find(
					(item) => item.id === step.workflow,
				);
				if (child && frame.active?.children?.[0])
					extend(frame.active.children[0], child.steps, `${prefix}${step.id}/`);
			} else if (step.type === "foreach" && frame.active?.foreach) {
				const loop = frame.active.foreach;
				loop.states.forEach((state, index) => {
					if (state.status !== "completed") {
						state.status = "pending";
						delete state.error;
						const child = frame.active!.children?.[index];
						if (child)
							extend(
								child,
								loop.body,
								`${prefix}${step.id}/${loop.snapshot.items[index]!.id}/`,
							);
					}
				});
			} else if (step.type === "fanout") {
				step.groups?.forEach((group, index) => {
					const child = frame.active?.children?.[index];
					if (child) extend(child, group, `${prefix}${step.id}/${index}/`);
				});
			}
		};
		if (run.checkpoint) extend(run.checkpoint, run.workflow.steps, "");
		delete run.iterationLimit;
		run.status = "running";
		delete run.error;
		this.log(run, "run", "Retry requested; continuing from saved progress.");
		void this.launch(run);
		return run;
	}
	private isUnstartedCodexAgent(
		run: FactoryRun,
		agent: AgentCheckpoint | undefined,
		key: string,
	): boolean {
		if (
			!agent?.sessionId ||
			agent.runner !== "codex" ||
			agent.result ||
			agent.rejected
		)
			return false;
		const parse = (text: string) => {
			try {
				return JSON.parse(text);
			} catch {
				return undefined;
			}
		};
		const failure = parse(
			run.error?.replace(/^Agent(?: step)? failed: /, "") ?? "",
		);
		const missing = `thread/resume failed: no rollout found for thread id ${agent.sessionId}`;
		const isStartupTimeout = (error: unknown) =>
			typeof error === "string" &&
			/^initialize timed out after \d+ms$/.test(error);
		if (
			failure?.type !== "result" ||
			failure.is_error !== true ||
			failure.session_id !== agent.sessionId ||
			!Array.isArray(failure.errors) ||
			!failure.errors.includes(missing)
		)
			return false;
		// Older runners emitted synthetic init IDs even when initialize failed.
		// Require that exact startup receipt as well as the missing-rollout error;
		// never discard an established conversation or a saved output/correction.
		let startupFailed = false;
		const completedAt =
			[...run.history].reverse().find((receipt) => receipt.step === key)?.at ??
			run.createdAt;
		for (const event of run.events) {
			if (
				event.step !== key ||
				event.source !== "agent" ||
				event.at < completedAt
			)
				continue;
			const message = parse(event.message);
			// Truncated activity cannot establish that the conversation never ran.
			if (!message) return false;
			if (message?.session_id !== agent.sessionId) continue;
			if (message.type === "system" && message.subtype === "init") continue;
			if (
				message.type !== "result" ||
				message.is_error !== true ||
				!Array.isArray(message.errors) ||
				!message.errors.length ||
				!message.errors.every(
					(error: unknown) => isStartupTimeout(error) || error === missing,
				)
			)
				return false;
			if (message.errors.some(isStartupTimeout)) startupFailed = true;
		}
		return startupFailed;
	}
	isShuttingDown(): boolean {
		return this.shuttingDown;
	}
	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		if (this.diagnosticTimer) clearInterval(this.diagnosticTimer);
		this.diagnosticTimer = undefined;
		for (const controller of this.controllers.values()) controller.abort();
		await Promise.allSettled(this.launchReconciliations.values());
		await Promise.allSettled(this.executions.values());
		await this.humanViews.settle();
		await Promise.allSettled(this.terminalPublications.values());
		for (const id of this.pendingActivitySaves.keys())
			await this.save(this.get(id));
		await this.flush();
	}
	resumeAll(): void {
		for (const run of this.runs.values()) {
			for (const batch of Object.values(run.launchActions ?? {}))
				void this.reconcileLaunchBatch(run, batch).catch(() => {});
			if (
				run.launchActions &&
				["completed", "failed", "stopped"].includes(run.status)
			)
				void this.publishTerminalOutcome(run).catch(() => {});
			if (
				!["running", "waiting"].includes(run.status) ||
				this.controllers.has(run.id)
			)
				continue;
			const owner = run.recipeParent && this.runs.get(run.recipeParent.runId);
			const ownerBatch = owner?.launchActions?.[run.recipeParent!.actionId];
			const childAdmission = ownerBatch?.progress[run.recipeParent!.itemId];
			// A persisted child can precede dispatch admission. Only its original parent
			// commits that admission; restart must not start paused pending work.
			if (
				ownerBatch?.cancelled ||
				(owner &&
					ownerBatch &&
					!ownerBatch.paused &&
					!["stopped", "failed", "blocked"].includes(owner.status) &&
					this.launchReconciliations.has(
						`${owner.id}:${ownerBatch.accepted.actionId}`,
					)) ||
				(owner && childAdmission && !childAdmission.launchCommitted)
			)
				continue;
			const disabled = this.catalog.unavailable(
				run.workflow,
				run.workflowDefinitions ?? [],
			);
			if (disabled.length || this.catalog.getBlock(run.id)) {
				this.blockRun(run, disabled);
				continue;
			}
			delete run.error;
			this.log(run, "run", "Recovering after restart from saved progress.");
			void this.launch(run);
		}
	}
	private newCheckpoint(steps: WorkflowStep[]): GraphCheckpoint {
		return { current: steps[0]?.id ?? "end", visits: {} };
	}
	private restoreFrameReceipts(
		run: FactoryRun,
		steps: WorkflowStep[],
		frame: GraphCheckpoint,
		prefix: string,
	): void {
		const restoring = !frame.resultReceipts;
		const receipts = Object.fromEntries(
			Object.entries(frame.resultReceipts ?? {}).map(([id, receipt]) => [
				id,
				immutableJson(receipt),
			]),
		);
		// Older unfinished frames have no ownership map. Only original qualified
		// receipts of steps visited in this frame can restore it; inherited live
		// output names never establish production or cause a completed role to replay.
		for (const step of steps) {
			if (!frame.visits[step.id] || Object.hasOwn(receipts, step.id)) continue;
			const key = `${prefix}${step.id}`;
			const receipt = [...run.history].reverse().find((entry) => {
				if (entry.step !== key) return false;
				if (!frame.iteration) return !entry.iteration;
				return (
					entry.iteration?.frame === frame.iteration.frame &&
					entry.iteration.id === frame.iteration.id &&
					entry.iteration.index === frame.iteration.index &&
					entry.iteration.itemDigest === digest(frame.iteration.value)
				);
			});
			if (receipt) {
				if (["workflow", "fanout", "foreach"].includes(step.type)) {
					// An active step still publishes ownership through normal completion.
					// A finished container cannot be reconstructed from its wrapper alone,
					// even when an earlier failed restoration persisted a partial map.
					if (!restoring && frame.current === step.id && frame.active) continue;
					throw new Error(
						`Child result ownership is missing at ${key}; original receipts are retained and nested results cannot be verified`,
					);
				}
				if (!restoring) continue;
				Object.defineProperty(receipts, step.id, {
					value: immutableJson({ key, output: receipt.output }),
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		}
		// Publish only a completely validated restoration; failure retains the old map.
		frame.resultReceipts = receipts;
	}
	private frameResults(
		run: FactoryRun,
		steps: WorkflowStep[],
		frame: GraphCheckpoint,
		prefix: string,
	): Record<string, unknown> {
		this.restoreFrameReceipts(run, steps, frame, prefix);
		return Object.fromEntries(
			steps.flatMap((step) => {
				if (!Object.hasOwn(frame.resultReceipts!, step.id)) return [];
				const receipt = frame.resultReceipts![step.id]!;
				if (receipt.key !== `${prefix}${step.id}`)
					throw new Error(
						`Child output receipt belongs to another frame: ${step.id}`,
					);
				return [[step.id, snapshotWorkflowInput(receipt.output)]];
			}),
		);
	}
	private launchOutcomeStatus(run: FactoryRun): FactoryRun["status"] {
		const batches = Object.values(run.launchActions ?? {});
		if (batches.some((batch) => !launchBatchSettled(batch))) return "waiting";
		return batches.some((batch) =>
			Object.values(batch.progress).some((item) =>
				["blocked", "cancelled"].includes(item.status),
			),
		)
			? "failed"
			: "completed";
	}
	private reconcileLaunchBatch(
		run: FactoryRun,
		batch: LaunchRunBatch,
		signal?: AbortSignal,
	): Promise<void> {
		const identity = `${run.id}:${batch.accepted.actionId}`;
		const pending = this.launchReconciliations.get(identity);
		if (pending) {
			this.launchReconciliationDirty.add(identity);
			return pending;
		}
		if (this.shuttingDown) return Promise.resolve();
		const observingOnly = () =>
			batch.paused || ["stopped", "failed", "blocked"].includes(run.status);
		// Pausing blocks admission, not observation of the original durable children.
		// tickLaunchRuns reconciles known identities before its own dispatch guard.
		const work = (async () => {
			try {
				await tickLaunchRuns(
					run,
					batch,
					{
						runtime: this,
						save: () => this.save(run),
						assertSchedulingOpen: () => {
							if (this.shuttingDown)
								throw new Error("Factory is shutting down");
							this.assertSchedulingOpen();
							this.requireRunAvailable(run);
						},
					},
					signal,
				);
				const uncertain = Object.entries(batch.progress).filter(
					([, item]) => item.status === "uncertain" && item.error,
				);
				if (uncertain.length && !observingOnly())
					throw new Error(
						`Child admission needs reconciliation. Retry retains original identities: ${uncertain.map(([id, item]) => `${id}: ${item.error}`).join("; ")}`,
					);
				if (
					!this.isExecuting(run.id) &&
					run.status === "waiting" &&
					run.checkpoint?.current === "end" &&
					Object.values(run.launchActions ?? {}).every(launchBatchSettled)
				) {
					run.status = this.launchOutcomeStatus(run);
					if (run.status === "failed")
						run.error =
							"Child batch retains blocked or cancelled outcomes. Inspect the original children; Retry reconciles their retained identities and dependencies.";
					this.log(
						run,
						"run",
						run.status === "failed"
							? run.error!
							: "Recipe and tracked child batches complete.",
					);
					await this.save(run);
					await this.publishTerminalOutcome(run);
				}
			} catch (error) {
				if (!signal?.aborted && !this.shuttingDown && !observingOnly()) {
					run.error =
						error instanceof Error
							? error.message
							: "Child batch reconciliation failed";
					if (
						!this.isExecuting(run.id) &&
						!["stopped", "blocked"].includes(run.status)
					)
						run.status = "failed";
					await this.save(run);
					await this.publishTerminalOutcome(run);
				}
				throw error;
			} finally {
				this.launchReconciliations.delete(identity);
				if (
					this.launchReconciliationDirty.delete(identity) &&
					!this.shuttingDown
				)
					queueMicrotask(() => {
						void this.reconcileLaunchBatch(run, batch).catch(() => {});
					});
			}
		})();
		this.launchReconciliations.set(identity, work);
		return work;
	}
	async stopBatch(id: string, actionId?: string): Promise<void> {
		const run = this.get(id);
		const batches = Object.entries(run.launchActions ?? {})
			.filter(([key]) => !actionId || key === actionId)
			.map(([, batch]) => batch);
		if (!batches.length) throw new Error("No matching child batch exists");
		for (const batch of batches) {
			batch.cancelled = true;
			batch.paused = true;
		}
		await this.save(run); // Cancellation intent precedes stopping parent or any child.
		this.stop(id);
		for (const batch of batches)
			await stopLaunchRuns(run, batch, {
				runtime: this,
				save: () => this.save(run),
			});
	}

	private nextStep(
		steps: WorkflowStep[],
		step: WorkflowStep,
		output: unknown,
	): string {
		return routeResult(
			step,
			output,
			steps[steps.indexOf(step) + 1]?.id ?? "end",
		);
	}
	// Upgrade active runs written before checkpoints existed using their completed receipts.
	private recoverCheckpoint(run: FactoryRun): GraphCheckpoint {
		const receipts = run.history.map((item, index) => ({ ...item, index }));
		const consumed = new Set<number>();
		const recover = (
			steps: WorkflowStep[],
			outputs: Record<string, unknown>,
			prefix: string,
		): GraphCheckpoint => {
			const frame = this.newCheckpoint(steps);
			while (frame.current !== "end") {
				const step = steps.find((item) => item.id === frame.current)!;
				const key = prefix + step.id;
				const receipt = receipts.find(
					(item) => !consumed.has(item.index) && item.step === key,
				);
				if (!receipt) {
					frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
					frame.active = { phase: "executing" };
					if (step.type === "agent" && run.step === key) {
						const runner =
							step.runner ??
							run.runner ??
							(run.sessionSnapshot?.codexSessionId
								? "codex"
								: run.sessionSnapshot?.geminiSessionId
									? "gemini"
									: run.sessionSnapshot?.cursorSessionId
										? "cursor"
										: run.sessionSnapshot?.opencodeSessionId
											? "opencode"
											: "claude");
						const event = [...run.events]
							.reverse()
							.find(
								(item) => item.step === key && item.message.startsWith("{"),
							);
						let sessionId: string | undefined;
						try {
							sessionId = event && JSON.parse(event.message).session_id;
						} catch {
							/* Truncated legacy event; use the saved session instead. */
						}
						sessionId ??=
							run.sessionSnapshot?.[
								`${runner as NonNullable<WorkflowStep["runner"]>}SessionId`
							];
						if (sessionId && sessionId !== "pending")
							frame.active.agent = {
								runner: runner as NonNullable<WorkflowStep["runner"]>,
								sessionId,
							};
					}
					if (step.type === "workflow") {
						const definition = run.workflowDefinitions?.find(
							(item) => item.id === step.workflow,
						);
						if (definition)
							frame.active.children = [
								recover(definition.steps, outputs, `${key}/`),
							];
					} else if (step.type === "fanout") {
						frame.active.children = step.groups?.map((group, index) => {
							const branchOutputs = structuredClone(outputs);
							return {
								...recover(group, branchOutputs, `${key}/${index}/`),
								outputs: branchOutputs,
							};
						});
					}
					break;
				}
				consumed.add(receipt.index);
				// A completed wrapper also consumed all receipts of that invocation.
				for (const child of receipts)
					if (child.index < receipt.index && child.step.startsWith(`${key}/`))
						consumed.add(child.index);
				frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
				outputs[step.id] = receipt.output;
				frame.current = this.nextStep(steps, step, receipt.output);
			}
			return frame;
		};
		return recover(run.workflow.steps, run.outputs, "");
	}
	/** Batch routine native messages; checkpoints continue to use save directly. */
	scheduleSave(run: FactoryRun): void {
		this.dirtyActivity.add(run.id);
		if (this.pendingActivitySaves.has(run.id) || this.activitySaves.has(run.id))
			return;
		const timer = setTimeout(() => {
			this.pendingActivitySaves.delete(run.id);
			void this.saveActivity(run).catch(() => {});
		}, 250);
		timer.unref();
		this.pendingActivitySaves.set(run.id, timer);
	}
	private saveActivity(run: FactoryRun): Promise<void> {
		this.dirtyActivity.add(run.id);
		const active = this.activitySaves.get(run.id);
		if (active) return active;
		const save = (async () => {
			// One batch has one durability boundary. Later messages are scheduled
			// after it settles, so readers need not wait for a stream to become idle.
			await this.pendingSaves.get(run.id)?.catch(() => {});
			this.dirtyActivity.delete(run.id);
			this.capturedActivity.add(run.id);
			await this.save(run);
		})();
		this.activitySaves.set(run.id, save);
		const settled = () => {
			this.activitySaves.delete(run.id);
			this.capturedActivity.delete(run.id);
			// A message can arrive after the batch finishes but before this promise
			// reaction. It still needs a timer after the old writer releases ownership.
			if (this.dirtyActivity.has(run.id)) this.scheduleSave(run);
		};
		void save.then(settled, settled);
		return save;
	}
	save(run: FactoryRun): Promise<void> {
		this.checkpointDiagnostics(run);
		const pending = this.pendingActivitySaves.get(run.id);
		if (pending) {
			clearTimeout(pending);
			this.pendingActivitySaves.delete(run.id);
		}
		this.dirtyActivity.delete(run.id);
		run.updatedAt = new Date().toISOString();
		const summary = this.runSummary(run);
		const save = this.snapshots.write(
			join(this.directory, "runs", `${run.id}.json`),
			run as unknown as Record<string, unknown>,
			summary,
			["outputs", "repositoryOutputs"],
			[],
			{
				events: 1,
				history: 1,
			},
		);
		this.pendingSaves.set(run.id, save);
		// Background activity saves have an observer; durability barriers still
		// receive and propagate the original rejection.
		void save.then(
			() => {
				this.legacyRuns.delete(run.id);
				this.summaries.set(run.id, summary);
				this.changed({ id: run.id });
			},
			() => {},
		);
		return save;
	}
	async flush(id?: string): Promise<void> {
		if (id) {
			if (!this.dirtyActivity.has(id)) {
				await this.pendingSaves.get(id);
				return;
			}
			const run = this.runs.get(id);
			if (!run) return;
			const active = this.activitySaves.get(id);
			const alreadyCaptured = this.capturedActivity.has(id);
			if (active) {
				await active;
				// A batch still waiting to capture at invocation includes the entire
				// call-time input. Messages accepted afterward belong to later reads.
				if (!alreadyCaptured) return;
			}
			if (this.dirtyActivity.has(id)) {
				const timer = this.pendingActivitySaves.get(id);
				if (timer) clearTimeout(timer);
				this.pendingActivitySaves.delete(id);
				await this.saveActivity(run);
			} else await this.pendingSaves.get(id);
			return;
		}
		do {
			for (const runId of this.dirtyActivity) {
				const timer = this.pendingActivitySaves.get(runId);
				if (timer) clearTimeout(timer);
				this.pendingActivitySaves.delete(runId);
				const run = this.runs.get(runId);
				if (run) void this.saveActivity(run).catch(() => {});
			}
			await Promise.all(this.activitySaves.values());
			await Promise.all(this.pendingSaves.values());
		} while (this.dirtyActivity.size || this.activitySaves.size);
		await this.snapshots.flush();
	}

	private runSummary(
		run: FactoryRun,
	): Record<string, any> & { id: string; createdAt: string } {
		const cached = this.summaries.get(run.id);
		const coldHistory = !!Object.getOwnPropertyDescriptor(run, "history")?.get;
		const coldOutputs = !!Object.getOwnPropertyDescriptor(run, "outputs")?.get;
		const videoAssets =
			cached && cached.videoAssets === undefined && (coldHistory || coldOutputs)
				? undefined
				: [
						...new Set([
							...(cached?.videoAssets ?? []),
							...(coldOutputs
								? []
								: Object.values(run.outputs).flatMap(videoAssetPaths)),
							...(coldHistory
								? []
								: run.history
										.slice(cached?.history.length ?? 0)
										.flatMap((entry) => videoAssetPaths(entry.output))),
						]),
					];
		return {
			id: run.id,
			diagnostics: diagnosticSummary(run, this.accounting.now()),
			videoAssets,
			recipeParent: run.recipeParent,
			launchActions: Object.fromEntries(
				Object.entries(run.launchActions ?? {}).map(([id, batch]) => [
					id,
					launchBatchProjection(batch),
				]),
			),
			title: run.title,
			status: capacityRunStatus(run),
			capacityLeaves: run.capacityLeaves,
			foreach: run.foreach,
			deliveryCoordination: run.deliveryCoordination,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
			repositoryId: run.repositoryId,
			step: run.step,
			currentStep: currentStepView(run),
			workflow: run.workflow.id,
			workflowBlock: run.workflowBlock,
			triggerOrigin: run.triggerOrigin,
			error: run.error,
			ticketSync: run.ticketSync && {
				error: run.ticketSync.error,
				receipts: run.ticketSync.receipts.map(({ delivered, superseded }) => ({
					delivered,
					superseded,
				})),
			},
			viewDecision: run.viewDecision
				? {
						id: run.viewDecision.id,
						kind: run.viewDecision.kind,
						title: run.viewDecision.title,
						...(run.viewDecision.answer ? { answer: true } : {}),
					}
				: undefined,
			history: this.historyPreviews(run),
		};
	}
	/** Cached receipt metadata lets views skip the retained, often large, outputs. */
	historyPreviews(
		run: FactoryRun,
	): { step: string; at: string; call?: WorkflowCall }[] {
		const cached = this.summaries.get(run.id)?.history as
			| { step: string; at: string; call?: WorkflowCall }[]
			| undefined;
		if (Object.getOwnPropertyDescriptor(run, "history")?.get && cached)
			return cached;
		const history = run.history;
		const retained = cached && cached.length <= history.length ? cached : [];
		if (retained.length === history.length) return retained;
		return [
			...retained,
			...history
				.slice(retained.length)
				.map(({ step, at, call }) => ({ step, at, call })),
		];
	}
	async prepareDashboard(run: FactoryRun): Promise<void> {
		// Completed legacy runs may never execute another step. Give their first
		// dashboard read committed preview metadata, keeping the original bytes
		// in the store's legacy backup rather than returning whole artifacts.
		if (this.legacyRuns.has(run.id)) {
			const pending = this.pendingSaves.get(run.id);
			if (pending) await pending.catch(() => {});
			if (this.legacyRuns.has(run.id)) await this.save(run);
		}
		await this.flush(run.id);
	}
	outputPreviews(
		run: FactoryRun,
		keys = Object.keys(run.outputs),
		options: { compact?: boolean } = {},
	): Record<string, unknown> {
		const detailed = new Set(["source"]);
		return Object.fromEntries(
			keys
				.filter((key) => Object.hasOwn(run.outputs, key))
				.map((key) => [
					key,
					this.snapshots.preview(
						run.outputs,
						key,
						detailed.has(key) ? {} : options,
					),
				]),
		);
	}
	listRuns(): (Record<string, any> & { id: string; createdAt: string })[] {
		return [...this.runs.values()].map((run) => ({
			...(this.summaries.get(run.id) ?? this.runSummary(run)),
			status: capacityRunStatus(run),
			diagnostics: diagnosticSummary(run, this.accounting.now()),
			workflowBlock: run.workflowBlock,
		}));
	}

	private atomicWrite(path: string, data: unknown): void {
		const temporary = `${path}.tmp`;
		writeFileSync(temporary, JSON.stringify(data, null, 2));
		renameSync(temporary, path);
	}
}

/** Durable run status remains compatible; API derives queueing from all active leaves. */
export function capacityRunStatus(run: FactoryRun): string {
	const leaves = Object.values(run.capacityLeaves ?? {});
	return run.status === "running" &&
		leaves.length &&
		leaves.every((leaf) => leaf.phase === "queued")
		? "capacity-waiting"
		: run.status;
}
