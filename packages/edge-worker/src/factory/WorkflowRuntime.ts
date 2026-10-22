import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
	type ArchitectureDecision,
	ArchitectureDecisionSchema,
	type ArchitectureProposal,
	ArchitectureReviewSchema,
	ArchitectureSchema,
	assertReviewBrief,
	openDecisions,
	reviewedArchitectureContinuation,
	snapshotProposal,
	verifyProposal,
} from "./Architecture.js";
import { evaluateCheckAsync } from "./Check.js";
import {
	DeliveryContractSchema,
	type DeliveryState,
	digest,
	externalCompletionProven,
	freezeDelivery,
	validateDeliveryContract,
} from "./Delivery.js";
import {
	acquireDelivery,
	type DeliveryCoordination,
	deliveryScopes,
	deliveryStep,
	releaseDelivery,
	resourceScopes,
	restoreDelivery,
} from "./DeliveryCoordination.js";
import {
	defaultWorkflows,
	upgradedArchitectureSteps,
	upgradedGuideStep,
	upgradeHandoffReadiness,
} from "./defaultWorkflows.js";
import { runEvidenceChecks } from "./EvidenceChecks.js";
import type { ResolvedExecutionEnvironment } from "./ExecutionEnvironment.js";
import {
	ExecutionProfileStore,
	type ExecutionSelection,
	type ExecutionSnapshot,
} from "./ExecutionProfiles.js";
import { executeCommand, FactoryTools } from "./FactoryTools.js";
import {
	aggregateForeach,
	type ForeachItemState,
	type ForeachProgress,
	type ForeachSnapshot,
	foreachPointer,
	foreachScope,
	prepareForeach,
} from "./Foreach.js";
import type { GitProviderSnapshot } from "./GitProvider.js";
import { GitSettings } from "./GitSettings.js";
import {
	assertImpactFresh,
	type ConvergenceState,
	collectImpactSnapshot,
	continuationEligible,
	decisionFor,
	historicalInventoryRead,
	type ImpactDecision,
	type ImpactSnapshot,
	impactDecisionDigest,
	impactFanout,
	recordConvergence,
	STALE_IMPACT_MESSAGE,
	validateImpact,
} from "./Impact.js";
import {
	type ImprovementAction,
	ImprovementActionSchema,
	type ImprovementState,
	type IssueDestination,
} from "./Improvement.js";
import {
	applyImprovementAction,
	runImprovement,
} from "./ImprovementRuntime.js";
import type { RoleProgress, RoleRevision } from "./Incremental.js";
import {
	attachmentDirectories,
	LaunchAssetStore,
	type LaunchAttachments,
} from "./LaunchAssets.js";
import { recordFeedbackAssessment } from "./MergeReadiness.js";
import {
	pendingMergeConfirmation,
	recordMergeConfirmation,
} from "./MergeRecovery.js";
import { conforms } from "./OutputFormats.js";
import { beginStepAttempt, finishStepAttempt } from "./Provenance.js";
import { qaDigest as importDigest } from "./Qa.js";
import {
	isExplanationRequest,
	normalizeQuestionResult,
	type QuestionChoices,
	type QuestionRecommendation,
	questionNotification,
} from "./Questions.js";
import { deliveryRevisions, runRepositories } from "./RepositoryScope.js";
import { guideHeadline } from "./ReviewBrief.js";
import { reviewRecoveryQuestions } from "./ReviewRecovery.js";
import {
	assertBoundInspectionFresh,
	bindingHistory,
	type OutputRevisionBinding,
	outputRevisionBinding,
	StaleBoundInspectionError,
	sameOutputBinding,
} from "./RevisionBinding.js";
import { withRuntimeRolePrompt } from "./RolePrompt.js";
import { currentStepView, presentationOutputKeys } from "./RunOutputRoles.js";
import { buildTitleContext } from "./RunTitleGenerator.js";
import {
	aggregateReview,
	frozenReviewContext,
	type Inventory,
	latestAggregate,
	type ReviewBaseline,
	reviewedRunRevision,
	scopeContextDigest,
	stampSpecialist,
	validateContractOutput,
} from "./SpecialistReview.js";
import { stepBindings } from "./StepBindings.js";
import {
	architectureRevisionDecision,
	CHECK_SELECTOR_IDS,
	checkArgs,
	checkStepEvidenceIssues,
	consumesImpact,
	consumesReview,
	fixerPublication,
	formatOf,
	hasCheck,
	inheritStepConfig,
	legacyToolOutput,
	readOutput,
	readStep,
	registerWorkflowConfig,
	resolveStepConfig,
	reviewEvidenceContract,
} from "./StepConfig.js";
import { recordTicketMilestone } from "./TicketTracking.js";
import {
	boundOutput,
	boundStepKey,
	boundToolOutput,
	outputForTool,
	registerOutputHistory,
	stepForRun,
} from "./ToolBindings.js";
import {
	assertForeachBody,
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
	/** Original bound input/repository snapshot, retained across native turn restart. */
	inspection?: OutputRevisionBinding;
	infrastructureFailure?: { reason: string; at: string; output?: unknown };
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
		reviewScope?: RoleProgress["reviewScope"];
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
		screenshots?: { path: string; area: string; state?: string }[];
	};
}
export interface QuestionRecheck {
	questionBatchId: string;
	questions: string[];
	at: string;
	convergence?: { key: string; snapshotDigest: string; at: string };
	convergenceConsumed?: true;
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
	iteration?: ItemFrame;
	callInputs?: Record<string, unknown>;
	/** New item/mapped-call scopes publish their own receipts, independently of inherited reads. */
	projectResults?: true;
	resultReceipts?: Record<string, { key: string; output: unknown }>;
	// Inherited by called workflows and fanout branches; calls return it to their caller.
	reviewKey?: string;
	current: string;
	visits: Record<string, number>;
	/** Exact native identities for the configured roles in this frame; never completed results. */
	agentSessions?: Record<string, Pick<AgentCheckpoint, "runner" | "sessionId">>;
	additionalVisits?: Record<string, number>;
	refreshes?: {
		source: string;
		target: string;
		active?: GraphCheckpoint["active"];
	}[];
	active?: {
		attemptId?: string;
		phase: "executing" | "result" | "waiting" | "answered";
		terminalFailure?: true;
		questionRecheck?: QuestionRecheck;
		questionDisplay?: {
			source?: {
				questions: string[];
				recommendations?: QuestionRecommendation[];
				choices?: QuestionChoices[];
			};
			questions: string[];
			recommendations?: QuestionRecommendation[];
			choices?: QuestionChoices[];
		};
		questionExplanation?: {
			source?: {
				questions: string[];
				recommendations?: QuestionRecommendation[];
				choices?: QuestionChoices[];
			};
			text: string;
			questions: string[];
			agent?: AgentCheckpoint;
		};
		agent?: AgentCheckpoint;
		children?: GraphCheckpoint[];
		foreach?: ForeachCheckpoint;
		call?: WorkflowCall;
		reviewBaseline?: ReviewBaseline;
		impactSnapshot?: ImpactSnapshot;
	};
	// Fanouts and modern calls own output frames; old calls retain their shared scope.
	outputs?: Record<string, unknown>;
}
export interface HumanDecision {
	url?: string;
	mode?: "repository" | "external" | "mixed";
	externalDigest?: string;
	repositories?: import("./RepositoryScope.js").ApprovedRepository[];
	reviewId: string;
	headSha: string;
	decision: "approve" | "reject";
	feedback?: string;
	at: string;
}
export interface ReviewGate {
	mode?: "repository" | "external" | "mixed";
	externalDigest?: string;
	repositories?: import("./RepositoryScope.js").ApprovedRepository[];
	id: string;
	headSha: string;
	url: string;
	status: "pending" | "approve" | "reject";
}
export interface RunViewState {
	settledAt?: string;
	keptOpen?: boolean;
	seenAt?: string;
}

import {
	type StepVisitBudgetUpgrade,
	stepVisitLimit,
	upgradeStockStepVisits,
} from "./StepVisitBudget.js";
import { cleanupVideoEvidence, videoAssetPaths } from "./Video.js";

export interface FactoryRun {
	/** Operational item progress, separate from accepted immutable item/output receipts. */
	foreach?: Record<string, ForeachProgress>;
	/** Original accepted collections; operational status never mutates these receipts. */
	foreachIterations?: {
		key: string;
		visit: number;
		snapshot: ForeachSnapshot;
	}[];
	improvementState?: ImprovementState;
	improvementParent?: {
		runId: string;
		manifestDigest: string;
		packageId: string;
	};
	stepVisitBudget?: StepVisitBudgetUpgrade;
	workflowBlock?: WorkflowBlock;
	delivery?: DeliveryState;
	deliveryContracts?: DeliveryState[];
	recoveryWorkflow?: Workflow;
	externalReverifications?: {
		actor: string;
		at: string;
		previousCheckpoint?: GraphCheckpoint;
		previousOverlay?: Workflow;
	}[];
	deliveryRecovery?: {
		requestId: string;
		actor: string;
		at: string;
		previousWorkflow: Workflow;
		previousCheckpoint?: GraphCheckpoint;
		contractDigest: string;
	};
	impactDecisions?: ImpactDecision[];
	impactConvergence?: Record<string, ConvergenceState>;
	approvalContinuations?: {
		originalReviewId: string;
		decisionDigest: string;
		headSha: string;
		repositories?: import("./RepositoryScope.js").ApprovedRepository[];
		at: string;
	}[];
	ciSupervision?: import("./CISupervision.js").CISupervision;
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
	architectureProposals?: ArchitectureProposal[];
	architectureDecisions?: ArchitectureDecision[];
	architectureGate?: {
		proposalId: string;
		source: string;
		stepKey: string;
		planOutput: string;
	};
	reviewGate?: ReviewGate;
	humanDecisions?: HumanDecision[];
	roleRevisions?: Record<string, RoleRevision>;
	boundOutputs?: Record<string, OutputRevisionBinding>;
	mergeReadiness?: import("./MergeReadiness.js").MergeReadiness;
	/** Provider-verified takeover snapshot; ordinary output slots cannot replace it. */
	takeoverSource?: unknown;
	/** Tracker input captured by the host, independently of authored output IDs. */
	ticketSnapshot?: unknown;
	reviewRounds?: ReviewBaseline[];
	outputs: Record<string, unknown>;
	history: {
		step: string;
		output: unknown;
		/** Immutable runtime evidence, separate from pure Check results. */
		evidence?: Record<string, unknown>;
		at: string;
		call?: WorkflowCall;
		questionRecheck?: QuestionRecheck;
		iteration?: {
			frame: string;
			id: string;
			index: number;
			itemDigest: string;
		};
	}[];
	answers: { questions: string[]; answer: string; at: string }[];
	questionRequests?: { questions: string[]; text: string; at: string }[];
	questions: string[];
	questionRecommendations?: QuestionRecommendation[];
	questionChoices?: QuestionChoices[];
	questionBatchId?: string;
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
	iteration?: ItemFrame;
	callInputs?: Record<string, unknown>;
	validateRoleOutput?: (value: unknown) => unknown;
	readOnlyResearch?: boolean;
	researchAccess?: {
		repositories: { id: string; root: string; revision: string }[];
		maxCalls: number;
	};
	/** Yield passive waits at saved checkpoints when update admission closes. */
	assertSchedulingOpen?: () => void;
	/** Revalidate the complete grouped approval under the operation reservation. */
	qaEnvironmentProof?: { declarationDigest: string; valueDigest: string };
	executionApproval?: HumanDecision;
	groupedImpactValidated?: boolean;
	impactKey?: string;
	validateDelivery?: () => Promise<Record<string, unknown> | undefined>;
	/** Nested publication discovered by passive grouped readiness must also claim targets. */
	coordinateDelivery?: <T>(operation: () => Promise<T>) => Promise<T>;
	/** Runtime-owned home, never inferred from a worktree or a private runner HOME. */
	factoryHome?: string;
	attemptId?: string;
	reviewKey?: string;
	execution?: ResolvedExecutionEnvironment;
	stepKey?: string;
	reviewBaseline?: ReviewBaseline;
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
	questionRecheck?: QuestionRecheck;
	checkpointAgent?: (agent: AgentCheckpoint) => void | Promise<void>;
	/** Persist per-repository side effects before the whole step completes. */
	save?: () => void | Promise<void>;
	allowUnchangedRepository?: boolean;
	checkEvidence?: Record<string, unknown>;
}
export interface RuntimeHooks {
	improvementDestinations?(
		run: FactoryRun,
		signal: AbortSignal,
	): Promise<{
		options: { name: string; destination: IssueDestination }[];
		limitations: string[];
	}>;
	improvementIssue?(
		run: FactoryRun,
		issue: ImprovementState["issues"][string],
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
	script(context: ExecutionContext): Promise<unknown>;
	tool(context: ExecutionContext): Promise<unknown>;
	evidence?(context: ExecutionContext): Promise<Record<string, unknown>>;
	question?(run: FactoryRun): Promise<void>;
	simple?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	prepare?(run: FactoryRun, signal: AbortSignal): Promise<void>;
	finished?(run: FactoryRun): Promise<void>;
	cleanupExecution?(run: FactoryRun): void;
}

export class WorkflowRuntime {
	/** Waiting gates and update-suspended runs have no executing work. */
	hasExecutingWork(): boolean {
		return [...this.executions.keys()].some(
			(id) => this.runs.get(id)?.status !== "waiting",
		);
	}
	private assertSchedulingOpen(): void {
		if (existsSync(join(this.directory, "..", "updates", "maintenance.json")))
			throw new UpdatePausedError();
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
	}
	private controllers = new Map<string, AbortController>();
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
	private improvementWaiters = new Map<string, () => void>();
	private defaultWorkflow = "simple";
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
	) {
		this.directory = join(home, "factory");
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
			if (!loaded) this.legacyRuns.add(run.id);
			if (loaded)
				this.summaries.set(
					run.id,
					loaded.summary as Record<string, any> & {
						id: string;
						createdAt: string;
					},
				);
			run.workflow = WorkflowSchema.parse(run.workflow);
			if (run.recoveryWorkflow)
				run.recoveryWorkflow = WorkflowSchema.parse(run.recoveryWorkflow);
			for (const definition of [
				run.workflow,
				...(run.workflowDefinitions ?? []),
				...(run.recoveryWorkflow ? [run.recoveryWorkflow] : []),
			])
				registerWorkflowConfig(definition, run.workflow.id);
			const visitBudgetUpgraded = upgradeStockStepVisits(run);
			// Process-owned operations must reacquire after restart. Legacy broad
			// ownership cannot block restored passive parent/CI frames.
			if (["running", "waiting", "interrupted"].includes(run.status))
				restoreDelivery(run);

			// Persisted definitions are immutable. Legacy contract migration occurs
			// explicitly at retry/start, preserving graph positions and native IDs.

			immutableTranscript(run.events);
			// Completed receipts remain independent of mutable live outputs.
			immutableTranscript(run.history);
			if (run.reviewRounds) immutableTranscript(run.reviewRounds);
			this.runs.set(run.id, run);
			registerOutputHistory(run, () => this.historyPreviews(run));
			if (this.catalog.getBlock(run.id)) {
				run.workflowBlock = this.catalog.getBlock(run.id);
				run.status = "blocked";
			}
			if (visitBudgetUpgraded) this.save(run);
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
						(step.type === "workflow" &&
							!!run.workflowDefinitions?.some(
								(child) => child.id === step.workflow && visit(child),
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
						(s.type === "workflow" &&
							policy.definitions.some(
								(child) => child.id === s.workflow && check(child, seen),
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
			improvementParent?: FactoryRun["improvementParent"];
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
		requireTrigger(options.workflow, options.triggerOrigin.type);
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
			answers: [],
			questions: [],
			events: [],
		};
		this.runs.set(run.id, run);
		registerOutputHistory(run, () => this.historyPreviews(run));
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
		if (run.status === "waiting") run.status = "running";
		// Explicit Resume makes stopped stock work eligible without changing its
		// frozen graph. Persist the one-time allowance before any resumed role.
		if (upgradeStockStepVisits(run)) this.save(run);
		this.controllers.set(run.id, controller);
		const execution = this.execute(run, controller, task);
		this.executions.set(run.id, execution);
		void execution.then(
			() => {
				this.executions.delete(run.id);
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
				...(run.recoveryWorkflow ? [run.recoveryWorkflow] : []),
			])
				registerWorkflowConfig(definition, run.workflow.id);
			if (run.contractVersion !== 2) {
				if (run.contractVersion !== undefined && run.contractVersion !== 1)
					throw new Error(
						`Unsupported workflow contract version: ${run.contractVersion}`,
					);
				run.contractVersion = 2;
				this.log(
					run,
					"run",
					"Migrated legacy output contract to v2 at execution boundary; workflow definitions, checkpoint positions and accepted history preserved.",
				);
			}
			if (!run.mergeReadiness)
				run.mergeReadiness = legacyToolOutput(
					run,
					"merge-readiness",
				) as FactoryRun["mergeReadiness"];
			this.launchAssets.verify(run.id, run.launchAttachments);
			await this.hooks.prepare?.(run, controller.signal);
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
			if (task) await task(controller.signal);
			else if (run.workflow.improvement) {
				await runImprovement(
					{
						runtime: this,
						agent: (context) => this.hooks.agent(context),
						issue: this.hooks.improvementIssue,
						wait: (parent, signal, phase) =>
							this.waitForImprovement(parent, signal, phase),
					},
					run,
					controller.signal,
				);
			} else if (run.workflow.id === "simple") {
				if (!this.hooks.simple)
					throw new Error("Simple recovery handler unavailable");
				await this.hooks.simple(run, controller.signal);
			} else {
				run.checkpoint ??= this.recoverCheckpoint(run);
				await this.save(run);
				await this.graph(
					run,
					(run.recoveryWorkflow ?? run.workflow).steps,
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
			if (
				run.delivery &&
				run.delivery.contract.mode !== "repository" &&
				!externalCompletionProven(run)
			)
				throw new Error(
					"External delivery lacks verified acceptance and final state proof",
				);
			if (
				run.delivery?.contract.mode === "mixed" &&
				readPath(outputForTool(run, "merge"), "merged") !== true
			)
				throw new Error(
					"Mixed delivery requires all provider-confirmed repository merges",
				);
			run.status = "completed";
			if (readPath(outputForTool(run, "merge"), "merged") === true)
				this.updateViewState(run.id, { settledAt: new Date().toISOString() });
			this.log(run, "run", "Workflow complete.");
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
			try {
				this.hooks.cleanupExecution?.(run);
			} catch {
				this.log(
					run,
					"run",
					"Private auth-cache cleanup failed; retained state needs operator cleanup.",
				);
			}
			await this.save(run);
			if (
				!this.shuttingDown &&
				["completed", "failed", "stopped"].includes(run.status)
			)
				try {
					if (run.ticketReference && this.hooks.track)
						await this.track(run, {
							key: `outcome:${run.status}:${run.history.length}`,
							body:
								run.status === "completed"
									? `Workflow ${run.workflow.name} completed. Coding tickets become Done only after confirmed merge. Inspect run ${run.id} for results.`
									: `Workflow ${run.status}: ${run.error ?? "stopped by user"}. Work is preserved in run ${run.id}; restore access or answer the blocker before retrying.`,
						});
					await this.hooks.finished?.(run);
				} catch (error) {
					this.log(
						run,
						"ticket-sync",
						`Final tracking hook failed: ${String(error)}. Underlying run outcome retained.`,
					);
				}
			this.controllers.delete(run.id);
		}
	}
	async decideImprovement(
		id: string,
		value: ImprovementAction,
		actor: string,
	): Promise<void> {
		const run = this.get(id);
		const action = ImprovementActionSchema.parse(value);
		if (
			!run.workflow.improvement ||
			(run.status !== "waiting" && action.action !== "stop-batch")
		)
			throw new Error(
				"Improvement decisions require a waiting improvement run",
			);
		if (action.action === "stop-batch") {
			const state = run.improvementState,
				proposal = state?.proposals.at(-1);
			if (
				!state?.acceptance ||
				state.revision !== action.expectedRevision ||
				proposal?.digest !== action.digest ||
				proposal.version !== action.version
			)
				throw new Error("Batch changed; refresh before stopping");
			this.stop(id);
			for (const child of Object.values(run.improvementState?.children ?? {}))
				if (
					["created", "running", "waiting", "interrupted"].includes(
						this.runs.get(child.runId)?.status ?? "",
					)
				)
					this.stop(child.runId);
			await this.flush();
			return;
		}
		this.requireRunAvailable(run);
		if (
			action.action === "apply" &&
			run.improvementState?.manifest?.packages.length
		) {
			const definitions = run.workflowDefinitions ?? [],
				factory = definitions.find((w) => w.id === "factory");
			if (!factory)
				throw new Error("Accepted Factory definition is unavailable");
			this.requireAvailable(factory, definitions);
		}
		applyImprovementAction(run, action, actor);
		await this.save(run);
		this.improvementWaiters.get(id)?.();
		if (!this.isExecuting(id)) void this.launch(run);
	}
	async improvementDestinations(id: string, signal: AbortSignal) {
		return (
			this.hooks.improvementDestinations?.(this.get(id), signal) ?? {
				options: [],
				limitations: ["No configured issue destination is available"],
			}
		);
	}
	private waitForImprovement(
		run: FactoryRun,
		signal: AbortSignal,
		phase: ImprovementState["phase"],
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const finish = () => {
				unsubscribe();
				signal.removeEventListener("abort", abort);
				this.improvementWaiters.delete(run.id);
				resolve();
			};
			const abort = () => {
				unsubscribe();
				this.improvementWaiters.delete(run.id);
				reject(signal.reason ?? new Error("Stopped"));
			};
			const unsubscribe = this.subscribe((change) => {
				const ref = Object.values(run.improvementState?.children ?? {}).find(
					(c) => c.runId === change.id,
				);
				if (ref && this.runs.get(ref.runId)?.status !== ref.status) finish();
			});
			this.improvementWaiters.set(run.id, finish);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			else if (
				(phase === "discussion" &&
					run.improvementState?.phase !== "discussion") ||
				(phase === "ready" && run.improvementState?.phase !== "ready") ||
				Object.values(run.improvementState?.children ?? {}).some(
					(c) => this.runs.get(c.runId)?.status !== c.status,
				)
			)
				finish();
		});
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
			if (!run.ticketReference || !this.hooks.track) return;
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
	private async coordinate<T>(
		context: ExecutionContext,
		operation: () => Promise<T>,
		scopes?: string[],
		mutation = !scopes,
	): Promise<T> {
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
					assertSchedulingOpen: context.assertSchedulingOpen,
					scopes: targets,
					reason: mutation
						? "Repository integration/publication"
						: "Shared QA/environment resource",
				},
			);
		await admit();
		try {
			context.signal.throwIfAborted();
			const nested = context.coordinateDelivery;
			if (mutation)
				context.coordinateDelivery = async (operation) => {
					const owned = context.run.deliveryReservations?.[key];
					if (
						owned?.phase !== "active" ||
						targets().some((target) => !owned.scopes.includes(target))
					)
						// Suspend this operation and reconcile its whole scope before any
						// new publication, retaining ownership until the outer operation settles.
						await admit();
					context.signal.throwIfAborted();
					return operation();
				};
			try {
				return await operation();
			} finally {
				context.coordinateDelivery = nested;
			}
		} finally {
			releaseDelivery(context.run, "Operation settled", key);
			await this.save(context.run);
		}
	}
	async retryTracking(id: string): Promise<void> {
		await this.hooks.retryTracking?.(this.get(id));
	}

	private stepInput(
		run: FactoryRun,
		step: WorkflowStep,
		outputs: Record<string, unknown>,
		reviewBaseline?: ReviewBaseline,
		deliveryAware = !!run.delivery,
		binding?: OutputRevisionBinding,
		iteration?: ItemFrame,
	) {
		if (binding?.inputScope)
			outputs = Object.fromEntries(
				binding.inputScope.outputKeys
					.filter((key) => Object.hasOwn(outputs, key))
					.map((key) => [key, outputs[key]]),
			);
		const config = resolveStepConfig(step);
		const input = reviewBaseline
			? snapshotWorkflowInput({
					...(reviewBaseline.context as Record<string, unknown>),
					reviewBaseline,
				})
			: config.inputs
				? {
						...(run.ticketReference
							? {
									ticketReference: structuredClone(run.ticketReference),
									ticketSync: structuredClone(run.ticketSync),
								}
							: {}),
						...(deliveryAware
							? {
									delivery: structuredClone(run.delivery),
									deliveryExecutionReference: digest(
										run.executionSnapshot ?? {
											runner: run.runner,
											repositoryId: run.repositoryId,
										},
									),
									deliveryCandidateDigest: digest(
										readPath(
											readOutput(step, "plan", outputs),
											"deliveryContract",
										),
									),
								}
							: {}),
						...Object.fromEntries(
							config.inputs.map((name) => [
								name,
								Object.hasOwn(outputs, name) ? outputs[name] : undefined,
							]),
						),
						...(step.askQuestions || step.tool === "impact-checks"
							? { answers: structuredClone(run.answers) }
							: {}),
					}
				: {
						originalInput: run.input,
						...(deliveryAware
							? {
									delivery: structuredClone(run.delivery),
									deliveryExecutionReference: digest(
										run.executionSnapshot ?? {
											runner: run.runner,
											repositoryId: run.repositoryId,
										},
									),
									deliveryCandidateDigest: digest(
										readPath(
											readOutput(step, "plan", outputs),
											"deliveryContract",
										),
									),
								}
							: {}),
						...(run.ticketReference
							? {
									ticketReference: structuredClone(run.ticketReference),
									ticketSync: structuredClone(run.ticketSync),
								}
							: {}),
						launchInputs: structuredClone(run.launchInputs ?? {}),
						outputs: snapshotWorkflowInput(outputs),
						answers: structuredClone(run.answers),
						chatMessages: structuredClone(this.chatMessages(run.id)),
						history: snapshotHistory(
							run.history,
							0,
							binding?.inputScope?.historyLength ?? run.history.length,
						),
						humanDecisions: structuredClone(run.humanDecisions ?? []),
						architectureProposals: structuredClone(
							run.architectureProposals ?? [],
						),
						architectureDecisions: structuredClone(
							run.architectureDecisions ?? [],
						),
					};
		if (run.launchAttachments && Object.keys(run.launchAttachments).length) {
			Object.assign(input, {
				launchAttachments: structuredClone(run.launchAttachments),
			});
			for (const name of config.inputs ?? [])
				if (
					name !== "launchAttachments" &&
					Object.hasOwn(run.launchAttachments, name) &&
					!Object.hasOwn(outputs, name)
				)
					Object.assign(input, {
						[name]: structuredClone(run.launchAttachments[name]),
					});
		}
		if (iteration)
			Object.assign(input, {
				item: structuredClone(iteration.value),
				index: iteration.index,
			});
		return input;
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
		reviewBaseline?: ReviewBaseline,
	): Promise<Record<string, unknown>> {
		if (checkpoint.projectResults)
			this.restoreFrameReceipts(run, steps, checkpoint, prefix);
		while (checkpoint.current !== "end") {
			signal.throwIfAborted();
			this.assertSchedulingOpen();
			const step = steps.find((item) => item.id === checkpoint.current)!;
			const key = `${prefix}${step.id}`;
			const config = resolveStepConfig(step);
			const reviewConfig = consumesReview(step)
				? {
						inventory: readStep(step, "inventory")!,
						fanout: readStep(step, "fanout"),
					}
				: undefined;
			const impactConfig = hasCheck(step, "impact-reuse")
				? {
						inventory: readStep(step, "inventory")!,
						fanout: readStep(step, "fanout")!,
						maxUnchangedCycles: Number(
							checkArgs(step, "impact-reuse")?.maxUnchangedCycles ?? 3,
						),
					}
				: undefined;
			const impactSourceId = consumesImpact(step)
				? readStep(step, "impact")
				: undefined;
			if (!checkpoint.active) {
				checkpoint.visits[step.id] = (checkpoint.visits[step.id] ?? 0) + 1;
				checkpoint.active = { phase: "executing" };
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
			if (
				["delivery-route", "accept-delivery"].includes(step.tool ?? "") &&
				!parallel &&
				this.reopenInvalidDeliveryPlan(run, checkpoint, steps, prefix, outputs)
			) {
				await this.save(run);
				continue;
			}
			this.log(run, key, `Starting ${step.name} (pass ${count})`);
			const deliveryAware =
				!!run.delivery ||
				steps.some((s) =>
					["delivery-route", "accept-delivery"].includes(s.tool ?? ""),
				);
			const boundScope =
				checkpoint.refreshes?.at(-1)?.source === step.id ||
				state.phase !== "executing"
					? run.boundOutputs?.[key]
					: undefined;
			const input = this.stepInput(
				run,
				step,
				outputs,
				reviewBaseline,
				deliveryAware,
				boundScope,
				checkpoint.iteration,
			);
			this.requireRunAvailable(run);
			this.launchAssets.verify(run.id, run.launchAttachments);
			const execution = this.hooks.execution
				? await this.hooks.execution(run, step.runner ?? run.runner)
				: undefined;
			const context: ExecutionContext = {
				assertSchedulingOpen: () => this.assertSchedulingOpen(),
				factoryHome: dirname(this.directory),
				attemptId: state.attemptId,
				execution,
				reviewKey: checkpoint.reviewKey,
				iteration: checkpoint.iteration
					? immutableJson(checkpoint.iteration)
					: undefined,
				callInputs: checkpoint.callInputs
					? immutableJson(checkpoint.callInputs)
					: undefined,
				run,
				step,
				stepKey: key,
				reviewBaseline,
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
					...(deliveryAware
						? {
								delivery: structuredClone(run.delivery),
								deliveryExecutionReference: digest(
									run.executionSnapshot ?? {
										runner: run.runner,
										repositoryId: run.repositoryId,
									},
								),
								deliveryCandidateDigest: digest(
									readPath(
										readOutput(step, "plan", outputs),
										"deliveryContract",
									),
								),
							}
						: {}),
					outputs,
					answers: run.answers,
					chatMessages: this.chatMessages(run.id),
					humanDecisions: run.humanDecisions ?? [],
				}),
				capacity: this.capacityOptions(run, key, count),
				chat: reviewBaseline ? false : (step.chat ?? chat),
				chatMessages: structuredClone(this.chatMessages(run.id)),
				input,
				bindingInput: (source, previous) => {
					const sourceInput = this.stepInput(
						run,
						source,
						outputs,
						reviewBaseline,
						deliveryAware,
						previous,
						checkpoint.iteration,
					);
					const sourceContext = {
						...context,
						step: source,
						stepKey: `${prefix}${source.id}`,
						input: sourceInput,
					};
					const sourceConfig = resolveStepConfig(source);
					const bindings = stepBindings(
						sourceContext,
						bindingHistory(sourceContext, previous),
					);
					if (source.reads) Object.assign(sourceInput, bindings);
					else if (
						sourceConfig.inputs &&
						sourceConfig.reads.answers &&
						Object.hasOwn(bindings, "answers")
					)
						Object.assign(sourceInput, { answers: bindings.answers });
					const sources = checkArgs(source, "scope-inputs")?.sources;
					if (!sourceConfig.inputs && (sources || sourceConfig.explicit))
						Object.assign(sourceInput, {
							scopeSources:
								sources && typeof sources === "object"
									? Object.fromEntries(
											Object.entries(sources).map(([label, name]) => [
												label,
												bindings[String(name)],
											]),
										)
									: {},
						});
					return sourceInput;
				},
				outputs,
				signal,
				log: (message, source) =>
					this.log(run, key, execution?.redact(message) ?? message, source),
				evidenceDir: join(this.directory, "evidence", run.id),
				resumeAgent: state.agent,
				questionRecheck: state.questionRecheck,
				checkpointAgent: async (agent) => {
					state.agent = agent;
					if (agent.sessionId && agent.sessionId !== "pending") {
						checkpoint.agentSessions ??= {};
						checkpoint.agentSessions[step.id] = {
							runner: agent.runner,
							sessionId: agent.sessionId,
						};
					}
					await this.save(run);
					signal.throwIfAborted();
				},
				save: () => this.save(run),
			};
			if (step.reads) {
				const bindings = stepBindings(
					context,
					bindingHistory(context, boundScope),
				);
				Object.assign(input, bindings);
			} else if (config.inputs && config.reads.answers) {
				const bindings = stepBindings(context);
				if (Object.hasOwn(bindings, "answers"))
					Object.assign(input, { answers: bindings.answers });
			}
			if (checkpoint.iteration)
				Object.assign(input, {
					item: structuredClone(checkpoint.iteration.value),
					index: checkpoint.iteration.index,
				});
			const scopeSources = checkArgs(step, "scope-inputs")?.sources;
			const sourceValues = () => {
				if (!scopeSources || typeof scopeSources !== "object") return undefined;
				const bindings = stepBindings(context);
				return Object.fromEntries(
					Object.entries(scopeSources).map(([label, name]) => [
						label,
						bindings[String(name)],
					]),
				);
			};
			if (!config.inputs && (scopeSources || config.explicit))
				Object.assign(input, { scopeSources: sourceValues() ?? {} });
			const currentScope = context.currentScope!;
			context.currentScope = () => ({
				...(currentScope() as Record<string, unknown>),
				...(scopeSources || config.explicit
					? { scopeSources: sourceValues() ?? {} }
					: {}),
			});
			let staleSource: WorkflowStep | undefined;
			for (const binding of Object.values(config.reads)) {
				if (binding.from.startsWith("@")) continue;
				const source = steps.find(
					(candidate) => candidate.id === binding.from.split("/")[0],
				);
				if (!source || source.id === step.id) continue;
				const sourceKey = `${prefix}${source.id}`;
				const receipt = run.boundOutputs?.[sourceKey];
				if (!receipt) continue;
				const current = await outputRevisionBinding(
					{ ...context, step: source, stepKey: sourceKey },
					receipt,
				);
				if (current && !sameOutputBinding(receipt, current)) {
					if (await historicalInventoryRead(context, source, receipt, current))
						continue;
					staleSource = source;
					break;
				}
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
				const session = checkpoint.agentSessions?.[staleSource.id];
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
			const impactSource = steps.find((s) => s.id === impactSourceId);
			context.impactKey =
				impactSource && readStep(impactSource, "fanout")
					? `${prefix}${readStep(impactSource, "fanout")}`
					: checkpoint.reviewKey;
			context.coordinateDelivery = (operation) =>
				this.coordinate(context, operation);
			if (state.questionRecheck) {
				context.input = {
					...(context.input as Record<string, unknown>),
					questionRecheck: structuredClone(state.questionRecheck),
				};
				context.step = {
					...context.step,
					prompt: `${context.step.prompt ?? ""}\n\nThe operator requested a fresh check of this role's pending assistance. Read /questionRecheck and current runtime context, inspect the original blocker and verify whether it is resolved. This request supplies no answer, makes no scope decision and grants no approval. Continue only within the existing accepted scope; retain unanswered decisions and require all configured evidence and approval gates. If the blocker remains, return the concrete questions again. Preserve completed work and use the existing native conversation.`,
				};
				inheritStepConfig(step, context.step);
			}
			const assessedCorrection = this.assessedCorrection(
				run,
				steps,
				outputs,
				prefix,
				step.id,
			);
			if (assessedCorrection)
				context.input = {
					...(context.input as Record<string, unknown>),
					assessedCorrection,
				};
			context.step = withRuntimeRolePrompt(context.step, steps, {
				assessedCorrection: !!assessedCorrection,
				calibratedReview: !!reviewBaseline?.impact,
			});
			mkdirSync(context.evidenceDir, { recursive: true });
			if (
				impactSourceId &&
				step.tool === "impact-checks" &&
				state.phase === "executing"
			) {
				const source = steps.find((s) => s.id === impactSourceId)!;
				const fanout = steps.find((s) => s.id === readStep(source, "fanout")!)!;
				const decision = decisionFor(run, `${prefix}${fanout.id}`);
				if (!decision)
					throw new Error(
						"Selected checks require a completed impact decision",
					);
				if (decision.extractRequirements) {
					const snapshot = await collectImpactSnapshot(
						context,
						fanout,
						decision.snapshot.key,
						decision.snapshot,
					);
					decision.snapshot = snapshot;
				}
				try {
					await assertImpactFresh(context, decision, fanout);
				} catch (error) {
					if (
						!signal.aborted &&
						!parallel &&
						error instanceof Error &&
						error.message === STALE_IMPACT_MESSAGE &&
						this.renewStaleImpact(run, checkpoint, steps, prefix)
					) {
						await this.save(run);
						continue;
					}
					throw error;
				}
				await this.save(run);
			}
			if (hasCheck(step, "impact-reuse") && state.phase === "executing") {
				const fanout = steps.find((s) => s.id === impactConfig!.fanout)!;
				const snapshot = await collectImpactSnapshot(
					context,
					fanout,
					`${prefix}${fanout.id}`,
				);
				if (
					state.impactSnapshot &&
					state.impactSnapshot.digest !== snapshot.digest
				)
					state.agent = undefined;
				state.impactSnapshot = snapshot;
				context.input = {
					...(context.input as Record<string, unknown>),
					impactSnapshot: snapshot,
					impactEvidence:
						latestAggregate(run, snapshot.key)?.reviewers.map((r) => ({
							digest: importDigest(r),
							receipt: r,
						})) ?? [],
				};
				await this.save(run);
			}
			let output: unknown = outputs[step.id];
			if (state.phase === "executing") {
				let completionMessage: string | undefined;
				state.attemptId = beginStepAttempt(context);
				await this.save(run);
				signal.throwIfAborted();
				try {
					if (
						(step.tool === "review-gate" ||
							(step.type === "check" && hasCheck(step, "review-evidence"))) &&
						reviewConfig
					) {
						const fanoutKey = `${prefix}${reviewConfig!.fanout}`;
						const baseline = [...(run.reviewRounds ?? [])]
							.reverse()
							.find((r) => r.key === fanoutKey);
						if (!baseline)
							throw new Error("Configured review baseline is unavailable");
						const inventory = outputs[reviewConfig!.inventory] as
							| Inventory
							| undefined;
						if (
							inventory?.digest !== baseline.inventory.digest ||
							inventory?.version !== baseline.inventory.version ||
							inventory?.sourceContextDigest !==
								baseline.inventory.sourceContextDigest
						)
							throw new Error(
								"Requirement inventory changed without a new specialist round",
							);
						const revision = await reviewedRunRevision(run, baseline);
						if (revision.headSha !== baseline.headSha)
							throw new Error("Revision changed during specialist review");
						if (baseline.impact) {
							const decision = decisionFor(run, fanoutKey);
							if (!decision)
								throw new Error("Review impact decision unavailable");
							await assertImpactFresh(
								context,
								decision,
								steps.find((s) => s.id === reviewConfig!.fanout)!,
							);
						}
						output = aggregateReview(
							baseline,
							outputs[reviewConfig!.fanout!] as Record<string, unknown>[],
							latestAggregate(run, fanoutKey),
						);
						const incomplete = (
							output as import("./SpecialistReview.js").AggregateReview
						).reviewers.filter(
							(r) => r.status !== "completed" || r.blockers.length,
						);
						if (baseline.impact && incomplete.length)
							output = {
								...(output as Record<string, unknown>),
								reviewBlocked: true,
								reviewIncomplete: true,
								questions: [
									`Review could not finish: ${incomplete.map((r) => `${r.stamp.reviewer}: ${r.blockers.join("; ") || r.summary}`).join("; ")}. Provide the missing access or evidence needed to resume the selected review. Completed work is retained; this answer cannot waive review.`,
								],
							};
						const questions = reviewRecoveryQuestions(context, output, {
							headSha: revision.headSha,
							dirty: false,
						});
						if (questions.length)
							output = {
								...(output as Record<string, unknown>),
								reviewBlocked: true,
								questions,
							};
						if (step.type === "check")
							output = await this.executeCheck(context, output);
					} else if (step.type === "check") {
						output = await this.executeCheck(context);
					} else if (step.type === "foreach") {
						output = await this.executeForeach(
							context,
							checkpoint,
							workflowId,
							chat,
							reviewBaseline,
						);
					} else if (step.type === "fanout") {
						if (
							step.groups?.some((group) =>
								group.some(
									(item) =>
										item.askQuestions ||
										["human-review", "architecture-decision"].includes(
											item.tool ?? "",
										),
								),
							)
						)
							throw new Error(
								"Human checkpoints belong outside fanout branches",
							);
						if (reviewConfig && !state.reviewBaseline) {
							const inventory = outputs[reviewConfig!.inventory] as
								| Inventory
								| undefined;
							if (
								!inventory?.digest ||
								inventory.questions.length ||
								inventory.conflicts.length ||
								inventory.sourceReceipt.unavailable.length
							)
								throw new Error(
									"Requirement extraction is missing or has unresolved scope/source blockers",
								);
							if (inventory.sourceContextDigest !== scopeContextDigest(input)) {
								checkpoint.current = reviewConfig!.inventory;
								checkpoint.active = undefined;
								this.log(
									run,
									key,
									"Scope changed after extraction; extracting a fresh inventory before starting reviewers.",
								);
								finishStepAttempt(context, "blocked");
								continue;
							}
							const impact = impactSourceId ? decisionFor(run, key) : undefined;
							if (impactSourceId && !impact)
								throw new Error(
									"Configured review requires a completed impact assessment",
								);
							if (impact) await assertImpactFresh(context, impact, step);
							const repo = readOutput(step, "repository", outputs) as
								| { baseBranch?: string }
								| undefined;
							const source = readOutput(step, "source", outputs) as
								| { baseRefName?: string }
								| undefined;
							const revision = await reviewedRunRevision(
								run,
								`refs/remotes/origin/${source?.baseRefName ?? repo?.baseBranch ?? runRepositories(run)[0]!.baseBranch}`,
							);
							run.reviewRounds ??= [];
							state.reviewBaseline = immutableJson({
								schemaVersion: 1,
								round: run.reviewRounds.length + 1,
								key,
								inventory: structuredClone(inventory),
								...revision,
								historyLength: run.history.length,
								at: new Date().toISOString(),
								reviewers: (step.groups ?? []).flatMap((group, i) =>
									group.map((s) => ({
										id: s.id,
										key: `${key}/${i}/${s.id}`,
										group: i,
										contract: reviewEvidenceContract(s)!,
									})),
								),
								context: frozenReviewContext(input),
								...(impact
									? {
											impact: {
												snapshot: structuredClone(impact.snapshot),
												reuse: structuredClone(impact.reuseRecords),
											},
										}
									: {}),
							});
							run.reviewRounds.push(state.reviewBaseline);
						}
						if (state.reviewBaseline)
							checkpoint.reviewKey = state.reviewBaseline.key;
						state.children ??= (step.groups ?? []).map((group) => ({
							...this.newCheckpoint(group),
							outputs: reviewConfig ? {} : structuredClone(outputs),
						}));
						// Also fill older resumed branches, preserving reviews established within them.
						for (const child of state.children) {
							child.reviewKey ??= checkpoint.reviewKey;
							child.iteration ??= checkpoint.iteration;
							child.callInputs ??= checkpoint.callInputs;
							child.projectResults ??= checkpoint.projectResults;
						}
						await this.save(run);
						signal.throwIfAborted();
						const branchController = new AbortController();
						const cancelBranches = () => branchController.abort(signal.reason);
						signal.addEventListener("abort", cancelBranches, { once: true });
						if (signal.aborted) cancelBranches();
						let failure: unknown;
						const branchResults = await Promise.allSettled(
							(step.groups ?? []).map((group, index) => {
								const reused = state.reviewBaseline?.impact?.reuse ?? [];
								const retainedRole = (id: string) =>
									reused.some((r) => r.original.stamp.reviewer === id);
								const afterRetained = (
									target: string | undefined,
								): string | undefined => {
									const seen = new Set<string>();
									while (target && retainedRole(target)) {
										if (seen.has(target))
											throw new Error(
												"Review reuse cannot skip a cyclic role route",
											);
										seen.add(target);
										const index = group.findIndex((s) => s.id === target);
										const role = group[index]!;
										if (role.branches.length)
											throw new Error(
												"Conditional reviewer routes need full execution",
											);
										target = role.next ?? group[index + 1]?.id ?? "end";
									}
									return target;
								};
								const selected = group
									.filter((s) => !retainedRole(s.id))
									.map((s) => ({
										...s,
										next: afterRetained(s.next),
										branches: s.branches.map((b) => ({
											...b,
											next: afterRetained(b.next)!,
										})),
									}));
								for (const candidate of selected)
									inheritStepConfig(
										group.find((s) => s.id === candidate.id)!,
										candidate,
									);
								for (const role of group) {
									const retained = reused.find(
										(r) => r.original.stamp.reviewer === role.id,
									);
									if (retained)
										state.children![index]!.outputs![role.id] = structuredClone(
											retained.original,
										);
								}
								if (!selected.length)
									return Promise.resolve(state.children![index]!.outputs!);
								// Review branches have no internal correction routes; retain selected order.
								if (
									state.children![index]!.current !== "end" &&
									!selected.some(
										(s) => s.id === state.children![index]!.current,
									)
								)
									state.children![index]!.current = selected[0]!.id;
								return this.graph(
									run,
									selected,
									state.children![index]!.outputs!,
									branchController.signal,
									`${key}/${index}/`,
									state.children![index]!,
									workflowId,
									chat,
									true,
									state.reviewBaseline ?? reviewBaseline,
								).catch((error) => {
									// Suspension must wait for active siblings without cancelling
									// them. A real failure still cancels and takes precedence.
									if (!failure || !isUpdatePaused(error)) failure = error;
									if (!isUpdatePaused(error)) branchController.abort(error);
									throw error;
								});
							}),
						);
						signal.removeEventListener("abort", cancelBranches);
						if (failure) throw failure;
						if (state.reviewBaseline) {
							// All runner hooks have returned and cleaned up their temporary
							// project configuration. Reject any remaining edits before
							// accepting the round, without exempting runner directories.
							const revision = await reviewedRunRevision(
								run,
								state.reviewBaseline,
							);
							if (revision.headSha !== state.reviewBaseline.headSha)
								throw new Error("Revision changed during specialist review");
						}
						output = branchResults.map((result, index) =>
							result.status === "fulfilled"
								? reviewConfig
									? Object.fromEntries(
											(step.groups?.[index] ?? []).map((s) => [
												s.id,
												result.value[s.id],
											]),
										)
									: checkpoint.projectResults
										? this.frameResults(
												run,
												step.groups?.[index] ?? [],
												state.children![index]!,
												`${key}/${index}/`,
											)
										: result.value
								: undefined,
						);
						if (impactSourceId) {
							const decision = decisionFor(run, key)!;
							decision.pending.specialists = state
								.reviewBaseline!.reviewers.filter((r) => {
									const receipt = (output as Record<string, any>[])[r.group]?.[
										r.id
									];
									return (
										receipt?.status !== "completed" || receipt.blockers?.length
									);
								})
								.map((r) => r.id);
						}
						if (state.reviewBaseline)
							for (const reviewer of state.reviewBaseline.reviewers) {
								run.outputs[reviewer.key] = (
									output as Record<string, unknown>[]
								)[reviewer.group]![reviewer.id];
							}
					} else if (step.type === "workflow") {
						const definition = run.workflowDefinitions?.find(
							(item) => item.id === step.workflow,
						);
						if (!definition)
							throw new Error(`Workflow unavailable: ${step.workflow}`);
						requireTrigger(definition, "workflow");
						if (!state.call) {
							state.call = {
								type: "workflow",
								callerWorkflowId: workflowId,
								step: step.id,
								key,
								workflowId: definition.id,
							};
							// Call receipts outlive the capped activity buffer, including interrupted calls.
							run.workflowCalls ??= run.events
								.filter((event) => event.call)
								.map((event) => ({ call: event.call!, at: event.at }));
							run.workflowCalls.push({
								call: state.call,
								at: new Date().toISOString(),
							});
							this.log(
								run,
								key,
								`Calling ${definition.name} from ${workflowId}/${step.id}`,
								"workflow",
								state.call,
							);
						}
						state.children ??= [this.newCheckpoint(definition.steps)];
						state.children[0]!.reviewKey ??= checkpoint.reviewKey;
						state.children[0]!.iteration ??= checkpoint.iteration;
						if (
							checkpoint.projectResults ||
							step.inputMapping ||
							checkpoint.iteration
						)
							state.children[0]!.projectResults = true;
						const isolated =
							config.explicit || !!step.inputMapping || !!checkpoint.iteration;
						if (isolated && !state.children[0]!.outputs) {
							const mappings = Object.fromEntries(
								Object.entries(step.inputMapping ?? {}).map(([name, path]) => [
									name,
									structuredClone(
										foreachPointer(
											foreachScope({
												outputs,
												inputs: stepBindings(context),
												item: checkpoint.iteration?.value,
												index: checkpoint.iteration?.index,
											}),
											path,
										),
									),
								]),
							);
							state.children[0]!.outputs = {
								...snapshotWorkflowInput(outputs),
								...snapshotWorkflowInput(mappings),
							};
							state.children[0]!.callInputs = step.inputMapping
								? immutableJson(mappings)
								: checkpoint.callInputs;
						}
						await this.save(run);
						signal.throwIfAborted();
						await this.graph(
							run,
							definition.steps,
							isolated ? state.children[0]!.outputs! : outputs,
							signal,
							`${key}/`,
							state.children[0]!,
							definition.id,
							definition.chat ?? chat,
							parallel,
						);
						output = {
							workflow: definition.id,
							completed: true,
							...(step.inputMapping || checkpoint.iteration
								? {
										outputs: this.frameResults(
											run,
											definition.steps,
											state.children[0]!,
											`${key}/`,
										),
									}
								: {}),
						};
						checkpoint.reviewKey = state.children[0]!.reviewKey;
					} else {
						run.capacityLeaves ??= {};
						run.capacityLeaves[key] = {
							phase:
								step.tool === "ci" ||
								step.tool === "merge-readiness" ||
								step.tool === "handoff"
									? "waiting-ci"
									: ["human-review", "architecture-decision"].includes(
												step.tool ?? "",
											)
										? "waiting-human"
										: "executing",
						};
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
								const readiness = steps.find(
									(item) =>
										["ci", "handoff", "merge"].includes(item.tool ?? "") &&
										item.branches.some(
											(branch) =>
												branch.next === step.id &&
												branch.when.path === "fix" &&
												branch.when.equals === true,
										),
								);
								if (
									step.type === "agent" &&
									readiness &&
									!state.agent &&
									readPath(fixerPublication(step, readiness, outputs), "url")
								) {
									const preflight = {
										...readiness,
										id: step.id,
										tool: "ci-fix-readiness",
										reads: Object.fromEntries(
											Object.entries(resolveStepConfig(readiness).reads).map(
												([name, binding]) => [name, binding.from],
											),
										),
									};
									inheritStepConfig(readiness, preflight);
									const fresh = await this.hooks.tool({
										...context,
										step: preflight,
									});
									if (
										readPath(fresh, "skipFix") === true &&
										!assessedCorrection
									) {
										context.log(
											"Fresh readiness resolved the queued failure; skipping the obsolete fixer and retaining review/QA/approval gates.",
										);
										return {
											summary:
												"Queued provider failure resolved before correction",
											checks: [],
											reviewRequired: false,
											skipped: true,
										};
									}
									if (readPath(fresh, "skipFix") === true && assessedCorrection)
										context.log(
											`Provider failure cleared; ${assessedCorrection.source} still requires correction. Retaining the declared fixer and independent follow-up gates.`,
										);
									// Supply current head/base, feedback and checks, not the obsolete queued receipt.
									context.input = {
										...(context.input as Record<string, unknown>),
										outputs: structuredClone(outputs),
									};
								}
								if (
									step.type !== "agent" &&
									isComputeIntensive(step) &&
									this.hooks.capacity
								) {
									const lease = await this.hooks.capacity.acquireLease(signal, {
										...context.capacity,
										remote: step.tool?.startsWith("mcp__"),
									});
									try {
										signal.throwIfAborted();
										this.requireRunAvailable(run);
										return await lease.run(() =>
											this.hooks[step.type as "script" | "tool"](context),
										);
									} finally {
										await lease.release();
									}
								} else
									return this.hooks[step.type as "agent" | "script" | "tool"](
										context,
									);
							};
							const resources = resourceScopes(context);
							const mutation = deliveryStep(run, step);
							output =
								mutation || resources.length
									? await this.coordinate(
											context,
											execute,
											resources.length ? resources : undefined,
											mutation,
										)
									: await execute();
							await assertBoundInspectionFresh(context);
							if (reviewEvidenceContract(step)) {
								output = validateContractOutput(context, output);
								if (reviewEvidenceContract(step) === "inventory-v1")
									output = {
										...(output as Inventory),
										sourceContextDigest: scopeContextDigest(context.input),
									};
								if (hasCheck(step, "specialist-evidence")) {
									const revision = await reviewedRunRevision(
										run,
										reviewBaseline,
										// Sibling runners may still own temporary project files.
										// The fanout join checks cleanliness after every cleanup.
										{ requireClean: false },
									);
									if (
										!reviewBaseline ||
										revision.headSha !== reviewBaseline.headSha
									)
										throw new Error(
											"Reviewer changed the reviewed revision; review invalidated",
										);
									output = stampSpecialist(context, output);
								}
							}
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
								!run.capacityLeaves[key]?.request?.parked
							)
								delete run.capacityLeaves[key];
							await this.save(run);
							signal.throwIfAborted();
						}
					}
					signal.throwIfAborted();
					if (execution && output !== undefined)
						output = JSON.parse(execution.redact(JSON.stringify(output)));
					if (hasCheck(step, "impact-reuse")) {
						const fanout = steps.find((s) => s.id === impactConfig!.fanout)!;
						const fresh = await collectImpactSnapshot(
							context,
							fanout,
							state.impactSnapshot!.key,
						);
						if (fresh.digest !== state.impactSnapshot!.digest)
							throw new Error(
								"Source or delivery target changed during impact assessment",
							);
						const decision = validateImpact(output, fresh, run);
						run.impactDecisions ??= [];
						if (decision.commentAssessments.length)
							Object.assign(
								decision,
								recordFeedbackAssessment(context, {
									...decision,
									addressedCommentIds: decision.commentAssessments.map(
										(c) => c.id,
									),
								}),
							);
						const assistance = recordConvergence(
							run,
							fresh.key,
							decision,
							impactConfig!.maxUnchangedCycles,
							state.questionRecheck?.convergenceConsumed
								? undefined
								: state.questionRecheck?.convergence,
						);
						if (state.questionRecheck?.convergence)
							state.questionRecheck.convergenceConsumed = true;
						if (assistance.length) {
							decision.status = "blocked";
							decision.questions = assistance;
						}
						run.impactDecisions.push(decision);
						if (decision.status === "completed" && decision.scopeReuse) {
							const inventory = outputs[impactConfig!.inventory] as Inventory;
							outputs[impactConfig!.inventory] = {
								...structuredClone(inventory),
								sourceContextDigest: scopeContextDigest(context.input),
								scopeReuse: {
									...decision.scopeReuse,
									snapshotDigest: decision.snapshot.digest,
								},
							};
						}
						// Accepted authored evidence must not share the operational record's
						// mutable snapshot, pending reviewers or check results.
						output = structuredClone(decision);
						completionMessage = `${decision.summary} Fresh specialists: ${decision.specialists.join(", ") || "none"}. Reused evidence: ${decision.reuseRecords.map((r) => r.original.stamp.reviewer).join(", ") || "none"}. ${decision.approvalRationale}`;
					}
					if (hasCheck(step, "architecture-proposal")) {
						const architecture = ArchitectureSchema.parse(output);
						if (
							["architecture-brief-v1", "architecture-checkin-v1"].includes(
								formatOf(step) ?? "",
							)
						)
							assertReviewBrief(
								architecture,
								formatOf(step) === "architecture-checkin-v1"
									? "checkin-v1"
									: "review-v1",
							);
						run.architectureProposals ??= [];
						const proposals = run.architectureProposals;
						const proposal = await snapshotProposal(
							architecture,
							key,
							proposals.length + 1,
							context.evidenceDir,
							signal,
							[
								context.evidenceDir,
								...attachmentDirectories(run.launchAttachments),
								...runRepositories(run).flatMap((repo) => [
									repo.workspace,
									repo.repositoryPath,
								]),
								join(
									dirname(this.directory),
									basename(run.workspace),
									"attachments",
								),
							],
							runRepositories(run),
						);
						for (const previous of proposals)
							if (
								previous.source === key &&
								["proposed", "pending", "accepted", "routine"].includes(
									previous.status,
								)
							)
								previous.status = "superseded";
						proposals.push(proposal);
						output = {
							...proposal.content,
							proposalId: proposal.id,
							version: proposal.version,
							digest: proposal.digest,
							footprint: proposal.footprint,
						};
					}
					if (hasCheck(step, "architecture-candidate")) {
						const proposal = [...(run.architectureProposals ?? [])]
							.reverse()
							.find(
								(p) => p.source === `${prefix}${readStep(step, "proposal")}`,
							);
						if (!proposal || proposal.status !== "proposed")
							throw new Error("Candidate review has no current proposal");
						verifyProposal(proposal);
						output = {
							...ArchitectureReviewSchema.parse(output),
							proposalId: proposal.id,
							proposalDigest: proposal.digest,
						};
					}
					const acceptedBinding = await assertBoundInspectionFresh(context);
					outputs[step.id] = output;
					if (config.revision === "bound") {
						run.boundOutputs ??= {};
						run.boundOutputs[key] =
							acceptedBinding ??
							(await outputRevisionBinding(context, boundScope, true))!;
					}
					if (
						((config.explicit || !!checkpoint.iteration) && key !== step.id) ||
						hasCheck(step, "specialist-evidence")
					)
						run.outputs[key] = output;
					run.history.push(
						immutableJson({
							step: key,
							output,
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
							...(step.type === "check" && context.checkEvidence
								? { evidence: context.checkEvidence }
								: {}),
							at: new Date().toISOString(),
							...(state.call ? { call: state.call } : {}),
							...(state.questionRecheck
								? { questionRecheck: state.questionRecheck }
								: {}),
						}),
					);
					state.phase = "result";
					finishStepAttempt(
						context,
						readPath(output, "status") === "failed"
							? "failed"
							: readPath(output, "status") === "blocked" ||
									readPath(output, "reviewBlocked") === true ||
									readPath(output, "reviewIncomplete") === true
								? "blocked"
								: "completed",
					);
					// Logging persists a snapshot too. Publish impact completion only
					// after its decision, one-shot recheck and result receipt agree.
					if (completionMessage) this.log(run, key, completionMessage);
					await this.save(run);
					signal.throwIfAborted();
				} catch (error) {
					if (!signal.aborted && error instanceof StaleBoundInspectionError) {
						finishStepAttempt(context, "interrupted");
						this.log(run, key, error.message);
						const session = state.agent?.sessionId
							? { runner: state.agent.runner, sessionId: state.agent.sessionId }
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
						!parallel &&
						error instanceof Error &&
						error.message === STALE_IMPACT_MESSAGE &&
						this.renewStaleImpact(run, checkpoint, steps, prefix)
					) {
						await this.save(run);
						continue;
					}
					throw error;
				}
			}
			if (step.tool === "handoff" && readPath(output, "merged") === true) {
				const pending = pendingMergeConfirmation(run, output);
				if (!pending?.fromHandoff)
					throw new Error(
						"Merged handoff cannot skip unfinished workflow work",
					);
				recordMergeConfirmation(run, pending, output);
				this.log(
					run,
					key,
					"Confirmed the previously approved revision was already merged.",
				);
				await this.save(run);
				continue;
			}
			// Restored waits must use current gate logic, retaining all role evidence.
			if (
				(step.tool === "visual-gate" ||
					(step.type === "check" && hasCheck(step, "qa-gate-evidence"))) &&
				state.phase === "waiting" &&
				hasCheck(step, "qa-evidence")
			) {
				output = outputs[step.id] =
					step.type === "check"
						? await this.executeCheck(context)
						: await this.hooks.tool(context);
				// Keep the restored wait until its questions and suggestions are compared
				// below. Gate revalidation alone does not create a new question batch.
				await this.save(run);
				signal.throwIfAborted();
			}
			if (
				(step.tool === "visual-gate" ||
					(step.type === "check" && hasCheck(step, "qa-gate-evidence"))) &&
				readPath(output, "reviewBlocked") !== true &&
				Array.isArray(readPath(output, "findings")) &&
				(readPath(output, "findings") as unknown[]).length
			) {
				// Review assistance retains its saved questions for waitForAnswers to
				// compare after restart. Findings without a wait proceed to correction.
				run.status = "running";
				run.questions = [];
			}
			if (
				step.tool === "merge" &&
				run.delivery?.contract.mode === "mixed" &&
				readPath(output, "merged") === true
			) {
				output = {
					...(output as Record<string, unknown>),
					externalPending: true,
				};
				outputs[step.id] = output;
				await this.save(run);
				signal.throwIfAborted();
			}
			if (
				step.tool === "draft-pr" ||
				(step.tool === "external-final" &&
					readPath(output, "complete") === true) ||
				step.tool === "handoff" ||
				step.tool === "merge" ||
				hasCheck(step, "ticket-milestone")
			) {
				const pr = readPath(output, "url");
				const merged =
					step.tool === "merge" && readPath(output, "merged") === true;
				const externalPending =
					run.delivery?.contract.mode === "mixed" &&
					!externalCompletionProven(run);
				const handoffFix =
					step.tool === "handoff" &&
					(readPath(output, "fix") === true ||
						readPath(output, "guideRecovery") !== undefined);
				const externalComplete =
					step.tool === "external-final" && externalCompletionProven(run);
				const stage =
					externalComplete || (merged && !externalPending)
						? "done"
						: step.tool === "handoff"
							? handoffFix
								? "in_progress"
								: "in_review"
							: step.tool === "merge"
								? readPath(output, "fix") === true
									? "in_progress"
									: "in_review"
								: "in_progress";
				let body = externalComplete
					? "External ticket changes independently verified, explicitly accepted and checked again against current state. Completion proof retained in Factory."
					: merged
						? `Git provider confirmed merge: ${pr}. Run ${run.id}.`
						: step.tool === "handoff"
							? handoffFix
								? `Handoff requires corrections: ${pr}. Corrective work continues in Factory.`
								: `Ready for human review: ${pr}. Review the guide and explicitly approve this revision or request changes in Factory. ${readOutput(step, "guide", outputs) ? guideHeadline(readOutput(step, "guide", outputs)) : ""}`
							: step.tool === "draft-pr"
								? `Draft PR created or continued: ${pr}. Review and validation are underway.`
								: `${step.name}: ${String(readPath(output, "summary") ?? (checkArgs(step, "ticket-milestone")?.kind === "plan" ? "Implementation direction recorded in the accepted plan." : "Inspect the implementation receipts and checks in Factory."))}`;

				if (merged) {
					const summary = readPath(
						readOutput(step, "implementation", outputs),
						"summary",
					);
					const checks = readPath(
						readOutput(step, "implementation", outputs),
						"checks",
					);
					const risks = readPath(readOutput(step, "guide", outputs), "risks");
					body = `Delivered: ${pr}. The Git provider confirmed merge.`;
					if (typeof summary === "string") body += `\n\n${summary}`;
					if (Array.isArray(checks) && checks.length)
						body += `\n\nVerification:\n${checks
							.filter((v) => typeof v === "string")
							.map((v) => `- ${v}`)
							.join("\n")}`;
					if (Array.isArray(risks) && risks.length)
						body += `\n\nLimitations:\n${risks
							.filter((v) => typeof v === "string")
							.map((v) => `- ${v}`)
							.join("\n")}`;
				}

				const blockers = readPath(output, "blockers");
				if (handoffFix && Array.isArray(blockers))
					body += `\n\nBlockers:\n${blockers
						.map((blocker) => readPath(blocker, "message"))
						.filter((message) => typeof message === "string")
						.map((message) => `- ${message}`)
						.join("\n")}`;
				const checks = readPath(output, "checks");
				if (
					checkArgs(step, "ticket-milestone")?.kind === "implementation" &&
					Array.isArray(checks)
				)
					body += `\n\nChecks:\n${checks
						.filter((check) => typeof check === "string")
						.map((check) => `- ${check}`)
						.join("\n")}`;
				if (run.ticketReference && this.hooks.track) {
					await this.track(run, {
						key: `${key}:${count}:${readPath(output, "headSha") ?? "result"}`,
						stage,
						body,
						...(typeof pr === "string" ? { pr } : {}),
						...(merged ? { merged: true } : {}),
						...(externalComplete
							? {
									completion: {
										mode: run.delivery!.contract.mode as "external" | "mixed",
										digest: run.delivery!.verification!.digest,
										reviewId: run.delivery!.finalCheck!.reviewId,
									},
								}
							: {}),
					});
					for (const delivery of deliveryRevisions(output).slice(1))
						await this.track(run, {
							key: `${key}:${count}:${delivery.repositoryId}:${delivery.headSha}`,
							pr: delivery.url,
							body: `${delivery.name}: ${delivery.url}. ${body}`,
						});
				}
			}
			const ciAssistance = readPath(output, "ciAssistance");
			if (
				Array.isArray(ciAssistance) &&
				ciAssistance.length &&
				!(
					readPath(output, "fix") === true &&
					step.branches.some(
						(branch) =>
							branch.when.path === "fix" &&
							branch.when.equals === true &&
							branch.next !== "end",
					)
				) &&
				["ci", "merge-readiness", "handoff", "merge"].includes(step.tool ?? "")
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (ciAssistance.some((question) => typeof question !== "string"))
					throw new Error("Invalid CI assistance receipt");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						ciAssistance,
						signal,
						state,
						undefined,
						context,
					);
				checkpoint.active = undefined;
				await this.save(run);
				signal.throwIfAborted();
				continue;
			}
			if (
				readPath(output, "reviewIncomplete") === true &&
				!impactSourceId &&
				(["review-gate", "visual-gate"].includes(step.tool ?? "") ||
					(step.type === "check" && hasCheck(step, "review-assistance")))
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				const reviewer = steps.find(
					(item) => item.id === readStep(step, "review"),
				);
				if (
					!reviewer ||
					!["agent", "script"].includes(reviewer.type) ||
					this.nextStep(steps, reviewer, {}) !== step.id
				)
					throw new Error(
						"Incomplete review requires a configured reviewer → gate recovery path",
					);
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					!questions.length ||
					questions.some((question) => typeof question !== "string")
				)
					throw new Error("Incomplete review requires an assistance question");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						questions,
						signal,
						state,
						undefined,
						context,
					);
				checkpoint.current =
					step.type === "check"
						? this.nextStep(steps, step, output)
						: reviewer.id;
				const destination = steps.find(
					(item) => item.id === checkpoint.current,
				);
				let recoverySession =
					destination?.type === "agent"
						? checkpoint.agentSessions?.[destination.id]
						: undefined;
				if (!recoverySession?.sessionId && destination?.type === "agent") {
					// Older frames can retain native init events without a per-role map.
					// Recover only the chosen destination's identity, never another role's.
					for (const event of [...run.events].reverse()) {
						if (event.step !== `${prefix}${destination.id}`) continue;
						try {
							const message = JSON.parse(event.message);
							if (
								message.type === "system" &&
								message.subtype === "init" &&
								typeof message.session_id === "string" &&
								message.session_id &&
								message.session_id !== "pending"
							) {
								const runner = AgentSettingsSchema.shape.runner.safeParse(
									destination.runner ?? run.runner ?? "claude",
								);
								if (runner.success && runner.data) {
									recoverySession = {
										runner: runner.data,
										sessionId: message.session_id,
									};
									break;
								}
							}
						} catch {
							/* Non-native activity does not establish a session identity. */
						}
					}
				}
				checkpoint.active = recoverySession?.sessionId
					? { phase: "executing", agent: { ...recoverySession } }
					: undefined;
				if (checkpoint.active && destination)
					checkpoint.visits[destination.id] =
						(checkpoint.visits[destination.id] ?? 0) + 1;
				await this.save(run);
				signal.throwIfAborted();
				continue;
			}
			if (
				(step.tool === "visual-gate" ||
					(step.type === "check" && hasCheck(step, "qa-gate-evidence"))) &&
				(readPath(output, "captureBlocked") === true ||
					readPath(output, "qaBlocked") === true ||
					readPath(output, "qaRetry") === true) &&
				!(
					Array.isArray(readPath(output, "findings")) &&
					(readPath(output, "findings") as unknown[]).length
				)
			) {
				// Existing runs keep their frozen graph. Recover inside that graph rather
				// than replacing its recipe or rerunning implementation/code fixes.
				const capture = steps.find(
					(item) => item.id === readStep(step, "capture"),
				);
				const review = steps.find(
					(item) => item.id === readStep(step, "review"),
				);
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (
					!capture ||
					!["agent", "script"].includes(capture.type) ||
					capture.branches.length > 0 ||
					!review ||
					!["agent", "script"].includes(review.type) ||
					review.branches.length > 0 ||
					this.nextStep(steps, capture, {}) !== review.id ||
					this.nextStep(steps, review, {}) !== step.id
				)
					throw new Error(
						"QA or visual evidence is incomplete and this recipe has no capture → visual-review → visual-gate recovery path. Configure that path for a new run; missing evidence cannot be approved.",
					);
				if (readPath(output, "qaRetry") === true) {
					checkpoint.current =
						step.type === "check"
							? this.nextStep(steps, step, output)
							: capture.id;
					checkpoint.active = undefined;
					run.questions = [];
					run.status = "running";
					this.log(
						run,
						key,
						`Retrying invalid QA evidence: ${JSON.stringify(readPath(output, "evidenceIssues"))}`,
					);
					continue;
				}
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					!questions.length ||
					questions.some((item) => typeof item !== "string" || !item.trim())
				)
					throw new Error("QA/capture assistance requires a question");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						questions,
						signal,
						state,
						normalizeQuestionResult(output).questionRecommendations as
							| QuestionRecommendation[]
							| undefined,
						context,
					);
				checkpoint.current =
					step.type === "check"
						? this.nextStep(steps, step, output)
						: capture.id;
				checkpoint.active = undefined;
				this.log(
					run,
					key,
					"QA/capture assistance received; retrying testing and screenshot review with prior evidence retained.",
				);
				continue;
			}
			if (
				(step.tool === "review-after-fix" ||
					(step.type === "check" && hasCheck(step, "post-fix-evidence"))) &&
				Array.isArray(readPath(output, "questions")) &&
				(readPath(output, "questions") as unknown[]).length
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (!steps.some((item) => item.id === readStep(step, "fix")))
					throw new Error("CI assistance has no configured fixer");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						readPath(output, "questions") as string[],
						signal,
						state,
						undefined,
						context,
					);
				checkpoint.current =
					step.type === "check"
						? this.nextStep(steps, step, output)
						: readStep(step, "fix")!;
				checkpoint.active = undefined;
				continue;
			}
			if (
				(["review-gate", "visual-gate"].includes(step.tool ?? "") ||
					(step.type === "check" && hasCheck(step, "review-assistance"))) &&
				readPath(output, "reviewBlocked") === true
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				const fixer =
					step.type !== "check" &&
					impactSourceId &&
					readPath(output, "reviewIncomplete") === true
						? impactSourceId
						: this.nextStep(steps, step, output);
				if (
					!steps.some(
						(item) =>
							item.id === fixer && ["agent", "script"].includes(item.type),
					)
				)
					throw new Error(
						"Review assistance has no configured fixer recovery path",
					);
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						readPath(output, "questions") as string[],
						signal,
						state,
						normalizeQuestionResult(output).questionRecommendations as
							| QuestionRecommendation[]
							| undefined,
						context,
					);
				checkpoint.current = fixer;
				checkpoint.active = undefined;
				continue;
			}
			if (
				step.type === "agent" &&
				hasCheck(step, "architecture-revision") &&
				readPath(output, "architectureRevision") === true
			) {
				const decisionStep = architectureRevisionDecision(step, steps);
				const target = String(
					decisionStep ? readStep(decisionStep, "revise") : undefined,
				);
				if (
					!decisionStep ||
					!steps.some(
						(s) => s.id === target && hasCheck(s, "architecture-proposal"),
					)
				)
					throw new Error(
						"Changed architecture requires a configured proposal route",
					);
				checkpoint.current = target!;
				checkpoint.active = undefined;
				this.log(
					run,
					key,
					"Requirements changed the architecture; reviewing a new proposal before further implementation.",
				);
				await this.save(run);
				signal.throwIfAborted();
				continue;
			}
			if (
				hasCheck(step, "architecture-candidate") &&
				Array.isArray(readPath(output, "questions")) &&
				(readPath(output, "questions") as unknown[]).length
			) {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				if (state.phase !== "answered")
					await this.waitForAnswers(
						run,
						readPath(output, "questions") as string[],
						signal,
						state,
						undefined,
						context,
					);
				// Keep the accepted graph: a rejected review returns to its configured
				// candidate route with the explicit answer, never an implicit acceptance.
				checkpoint.current = this.nextStep(steps, step, output);
				checkpoint.active = undefined;
				await this.save(run);
				continue;
			}
			if (step.tool === "architecture-decision") {
				if (parallel)
					throw new Error("Human checkpoints belong outside fanout branches");
				const args = step.arguments ?? {};
				const source = `${prefix}${readStep(step, "proposal")}`;
				const proposal = [...(run.architectureProposals ?? [])]
					.reverse()
					.find((p) => p.source === source);
				const reviewed = readOutput(step, "review", outputs);
				if (
					!proposal ||
					readPath(reviewed, "approved") !== true ||
					readPath(reviewed, "proposalId") !== proposal.id ||
					readPath(reviewed, "proposalDigest") !== proposal.digest
				)
					throw new Error(
						"Architecture requires review of the exact current candidate before a decision",
					);
				verifyProposal(proposal);
				const planOutput = readStep(step, "plan")!;
				if (proposal.status === "proposed") {
					const policy = args.approval ?? "meaningful";
					if (!["meaningful", "always", "never"].includes(String(policy)))
						throw new Error("Unknown architecture approval policy");
					const continuation =
						policy === "meaningful" &&
						args.continueAccepted === true &&
						hasCheck(
							steps.find((s) => s.id === readStep(step, "review")) ?? {},
							"architecture-candidate",
						)
							? reviewedArchitectureContinuation(
									readPath(reviewed, "continuation"),
									proposal,
									run.architectureProposals ?? [],
									run.architectureDecisions ?? [],
								)
							: undefined;
					// Open decisions need a human answer whatever the policy says.
					if (
						!openDecisions(proposal.content) &&
						(continuation ||
							policy === "never" ||
							(policy === "meaningful" &&
								proposal.content.classification === "routine"))
					) {
						proposal.status = "routine";
						proposal.continuation = continuation;
						proposal.bypassReason = continuation
							? `Continues your approval of architecture version ${continuation.version}. ${continuation.reason}`
							: policy === "never"
								? "Operator configured approval=never"
								: proposal.content.rationale;
						outputs[planOutput] = structuredClone(proposal.content.candidate);
						outputs[step.id] = {
							decision: "routine",
							proposalId: proposal.id,
							digest: proposal.digest,
							reason: proposal.bypassReason,
							...(continuation ? { continuation } : {}),
						};
						if (continuation) this.log(run, key, proposal.bypassReason);
						await this.save(run);
						signal.throwIfAborted();
					} else {
						proposal.status = "pending";
						proposal.shownAt ??= new Date().toISOString();
						run.architectureGate = {
							proposalId: proposal.id,
							source,
							stepKey: key,
							planOutput: config.explicit
								? `${prefix}${planOutput}`
								: planOutput,
						};
						await this.save(run);
						signal.throwIfAborted();
					}
				}
				if (proposal.status === "pending") {
					outputs[step.id] = {
						proposal: structuredClone(proposal.content),
						proposalId: proposal.id,
						version: proposal.version,
						digest: proposal.digest,
					};
					if (state.phase !== "answered")
						await this.waitForAnswers(
							run,
							[
								`Bob has architecture proposal version ${proposal.version} ready. Open it to approve it, ask a question or ask for changes. Messages never approve it.`,
							],
							signal,
							state,
							undefined,
							context,
						);
					signal.throwIfAborted();
				}
				if (
					proposal.status === "accepted" ||
					proposal.status === "rejected" ||
					proposal.status === "superseded"
				) {
					const decision = [...(run.architectureDecisions ?? [])]
						.reverse()
						.find(
							(d) =>
								d.proposalId === proposal.id &&
								["accept", "revise", "discuss"].includes(d.decision),
						);
					if (!decision)
						throw new Error("Architecture decision receipt unavailable");
					output = outputs[step.id] = {
						...decision,
						decision: proposal.status === "accepted" ? "accept" : "revise",
					};
					if (proposal.status === "accepted")
						outputs[planOutput] = structuredClone(proposal.content.candidate);
					else {
						const target = readStep(step, "revise");
						if (
							!steps.some(
								(s) => s.id === target && hasCheck(s, "architecture-proposal"),
							)
						)
							throw new Error(
								"Architecture revision requires a configured proposal role",
							);
						checkpoint.current = target!;
						checkpoint.active = undefined;
						await this.save(run);
						signal.throwIfAborted();
						continue;
					}
				} else if (proposal.status === "routine") output = outputs[step.id];
				else
					throw new Error(
						"Architecture proposal is not authorized for implementation",
					);
			}
			if (
				step.askQuestions ||
				(hasCheck(step, "optional-questions") &&
					Array.isArray(readPath(output, "questions")))
			) {
				const questions = readPath(output, "questions");
				if (
					!Array.isArray(questions) ||
					questions.some((item) => typeof item !== "string")
				)
					throw new Error("Clarifier must return a questions array");
				if (questions.length) {
					if (parallel)
						throw new Error("Human checkpoints belong outside fanout branches");
					if (
						state.phase !== "answered" &&
						(await this.waitForAnswers(
							run,
							questions,
							signal,
							state,
							normalizeQuestionResult(output).questionRecommendations as
								| QuestionRecommendation[]
								| undefined,
							context,
						))
					)
						continue;
					if (step.tool === "impact-checks") {
						checkpoint.current = impactSourceId!;
						checkpoint.active = undefined;
						await this.save(run);
						continue;
					}
					// Answers start a new turn in the same conversation. Discard the
					// completed result so unchanged-code recovery cannot replay it.
					checkpoint.active = state.agent
						? {
								phase: "executing",
								agent: {
									runner: state.agent.runner,
									sessionId: state.agent.sessionId,
								},
							}
						: undefined;
					if (state.agent) checkpoint.visits[step.id] = count + 1;
					await this.save(run);
					signal.throwIfAborted();
					continue;
				}
			}
			if (step.tool === "human-review" && readPath(output, "rework") === true) {
				const next = this.nextStep(steps, step, output);
				if (next === step.next || next === "end")
					throw new Error(
						"Changed review scope needs an explicit rework route before human approval",
					);
				checkpoint.current = next;
				checkpoint.active = undefined;
				await this.save(run);
				signal.throwIfAborted();
				continue;
			}
			if (step.tool === "human-review") {
				const impact = context.reviewKey
					? decisionFor(run, context.reviewKey)
					: undefined;
				const continued =
					impactSourceId &&
					continuationEligible(impact, latestAggregate(run, context.reviewKey));
				if (continued) {
					try {
						await assertImpactFresh(
							context,
							impact!,
							impactFanout(context, impact!),
						);
					} catch (error) {
						if (
							!signal.aborted &&
							error instanceof Error &&
							error.message === STALE_IMPACT_MESSAGE &&
							this.renewStaleImpact(run, checkpoint, steps, prefix)
						) {
							await this.save(run);
							continue;
						}
						throw error;
					}
					const result = output as { headSha: string };
					run.approvalContinuations ??= [];
					run.approvalContinuations.push({
						originalReviewId: impact!.snapshot.approval!.reviewId,
						decisionDigest: impactDecisionDigest(impact!),
						headSha: result.headSha,
						repositories: deliveryRevisions(output),
						at: new Date().toISOString(),
					});
					this.log(
						run,
						key,
						"Prior explicit approval continues after independent impact review and required checks. The original human decision is retained.",
					);
				}
				if (state.phase !== "answered" && !continued)
					await this.waitForHuman(
						run,
						output as { headSha: string; url: string },
						signal,
						state,
					);
				output = outputs[step.id] = run.humanDecisions!.at(-1)!;
				const decision = output as HumanDecision;
				if (run.ticketReference && this.hooks.track)
					await this.track(run, {
						key: `decision:${decision.reviewId}`,
						stage: decision.decision === "reject" ? "in_progress" : "in_review",
						body:
							decision.decision === "reject"
								? `Human requested corrections: ${decision.feedback}. Corrective work resumes with the existing PR.`
								: "Human approved the revision. Waiting for provider requirements or confirmed merge; ticket remains In Review.",
					});
				if (
					!run.history.some(
						(item) =>
							item.step === key &&
							(item.output as HumanDecision)?.reviewId ===
								(output as HumanDecision).reviewId,
					)
				)
					run.history.push(
						immutableJson({ step: key, output, at: new Date().toISOString() }),
					);
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
			} else {
				const next = this.nextStep(steps, step, output);
				if (
					checkpoint.iteration &&
					next === "end" &&
					(["failed", "blocked"].includes(String(readPath(output, "status"))) ||
						readPath(output, "reviewBlocked") === true ||
						readPath(output, "reviewIncomplete") === true)
				) {
					// Failure belongs to its exact lexical destination, including inside calls/Parallel.
					// Retain the accepted receipt and native checkpoint until explicit Retry.
					state.terminalFailure = true;
					await this.save(run);
					throw new Error(
						`Item ended with ${String(readPath(output, "status") ?? "incomplete evidence")} at ${key}`,
					);
				}
				checkpoint.current = next;
				checkpoint.active = undefined;
			}
			this.log(run, key, `Finished ${step.name}`);
		}
		return outputs;
	}
	private async waitForAnswers(
		run: FactoryRun,
		questions: string[],
		signal: AbortSignal,
		state: NonNullable<GraphCheckpoint["active"]>,
		recommendations: QuestionRecommendation[] | undefined,
		context: ExecutionContext,
	): Promise<boolean> {
		const output = context.outputs?.[context.step.id];
		let choices =
			output && typeof output === "object" && "questions" in output
				? (normalizeQuestionResult(output).questionChoices as
						| QuestionChoices[]
						| undefined)
				: undefined;
		const source = structuredClone({
			questions,
			...(recommendations === undefined ? {} : { recommendations }),
			...(choices === undefined ? {} : { choices }),
		});
		// A rephrasing belongs to the decision it explained. Revalidated gates
		// may change while waiting; legacy displays without provenance cannot
		// establish that the decision is still the same.
		if (
			state.questionDisplay &&
			!isDeepStrictEqual(state.questionDisplay.source, source)
		) {
			state.questionDisplay = undefined;
			state.questionExplanation = undefined;
		}
		if (
			state.questionExplanation &&
			!isDeepStrictEqual(state.questionExplanation.source, source)
		)
			state.questionExplanation = undefined;
		questions = state.questionDisplay?.questions ?? questions;
		recommendations = state.questionDisplay
			? state.questionDisplay.recommendations
			: recommendations;
		choices = state.questionDisplay ? state.questionDisplay.choices : choices;
		const restored =
			state.phase === "waiting" &&
			isDeepStrictEqual(run.questions, questions) &&
			isDeepStrictEqual(run.questionRecommendations, recommendations) &&
			isDeepStrictEqual(run.questionChoices, choices);
		state.phase = "waiting";
		releaseDelivery(run, "Awaiting assistance");
		run.questions = questions;
		run.questionRecommendations = recommendations;
		run.questionChoices = choices;
		if (!restored || !run.questionBatchId) run.questionBatchId = randomUUID();
		run.status = "waiting";
		let notify = !restored;
		while (true) {
			signal.throwIfAborted();
			if (state.questionExplanation) {
				// This is a separate explanation turn, never an answered checkpoint or
				// another execution of the blocked fixer/capture/implementation role.
				const request = state.questionExplanation;
				run.status = "running";
				await this.save(run);
				const explained = normalizeQuestionResult(
					await this.hooks.agent({
						...context,
						step: {
							id: "question-explanation",
							name: "Explain the pending decision",
							type: "agent",
							branches: [],
							maxVisits: 1,
							askQuestions: true,
							access: {
								mode: "workspace",
								tools: [
									"mcp__factory-context__list_context",
									"mcp__factory-context__read_context",
								],
							},
							runner: context.step.runner,
							model: context.step.model,
							reasoningEffort: context.step.reasoningEffort,
							modelVariant: context.step.modelVariant,
							serviceTier: context.step.serviceTier,
							prompt:
								"Explain the pending questions using only the supplied context. The user has not answered or authorized any work. Do not implement, run checks, spend credits on tests, publish, change files or clear blockers. Use only factory-context tools. Return a questions array with one clearer question for each original question, preserving the same decisions, constraints and authorization requirements. Optional questionRecommendations must preserve existing recommendations. questionChoices must preserve option IDs, answer text, selection mode and preselected IDs; omit it to retain the original choice contract. Return no other role results.",
						},
						chat: false,
						stepKey: `${context.stepKey}/question-explanation`,
						input: {
							questions: request.questions,
							request: request.text,
							questionChoices: choices,
							recommendations,
							blocker: context.outputs?.[context.step.id],
							answers: structuredClone(run.answers),
						},
						resumeAgent: request.agent,
						checkpointAgent: async (agent) => {
							request.agent = agent;
							await this.save(run);
						},
					}),
				);
				signal.throwIfAborted();
				const clarified = explained.questions as string[];
				if (clarified.length !== questions.length)
					throw new Error(
						"An explanation must preserve every pending decision",
					);
				if (context.step.tool === "architecture-decision") {
					const proposal = run.architectureProposals?.find(
						(p) => p.id === run.architectureGate?.proposalId,
					);
					proposal?.feedback.push({
						kind: "explanation",
						text: clarified.join("\n\n"),
						at: new Date().toISOString(),
					});
				}
				if (
					explained.questionChoices !== undefined &&
					!isDeepStrictEqual(explained.questionChoices, choices)
				)
					throw new Error("An explanation must preserve the choice contract");
				questions = clarified;
				recommendations = (explained.questionRecommendations ??
					recommendations) as QuestionRecommendation[] | undefined;
				normalizeQuestionResult({
					questions,
					questionRecommendations: recommendations,
					questionChoices: choices,
				});
				notify = true;
				state.questionDisplay = { source, questions, recommendations, choices };
				state.questionExplanation = undefined;
				run.questions = questions;
				run.questionRecommendations = recommendations;
				run.questionChoices = choices;
				// Explaining architecture keeps the exact proposal pending. Reuse its
				// ticket receipt; a revised proposal gets a new batch on the next wait.
				if (context.step.tool !== "architecture-decision")
					run.questionBatchId = randomUUID();
				await this.save(run);
			}
			run.status = "waiting";
			const waiting = new Promise<void>((resolve, reject) =>
				this.pendingAnswers.set(run.id, { resolve, reject }),
			);
			void waiting.catch(() => {});
			const abort = () =>
				this.pendingAnswers.get(run.id)?.reject(new Error("Run terminated"));
			signal.addEventListener("abort", abort, { once: true });
			this.log(run, run.step ?? "clarify", questions.join("\n"));
			try {
				if (run.ticketReference && this.hooks.track) {
					const body = `Factory needs assistance:\n\n${questionNotification(questions, run.questionRecommendations, run.questionChoices)}`;
					const legacyKey = `questions:${run.step}:${run.answers.length}${state.questionDisplay ? `:explanation:${run.questionBatchId}` : ""}`;
					const batchKey = `questions:${run.step}:${run.answers.length}:${run.questionBatchId}`;
					// Reuse unchanged receipts from before all waits used batch identities.
					const receipts = run.ticketSync?.receipts ?? [];
					const legacyReceipt =
						!notify &&
						!receipts.some((receipt) => receipt.key === batchKey) &&
						receipts.some(
							(receipt) => receipt.key === legacyKey && receipt.body === body,
						);
					await this.track(run, {
						key: legacyReceipt ? legacyKey : batchKey,
						body,
					});
				}
				if (notify) await this.hooks.question?.(run);
				signal.throwIfAborted();
				await waiting;
			} finally {
				signal.removeEventListener("abort", abort);
				this.pendingAnswers.delete(run.id);
			}
			if (!state.questionExplanation)
				return (
					(state as NonNullable<GraphCheckpoint["active"]>).phase ===
					"executing"
				);
		}
	}

	private async waitForHuman(
		run: FactoryRun,
		result: {
			headSha: string;
			url: string;
			mode?: ReviewGate["mode"];
			externalDigest?: string;
		},
		signal: AbortSignal,
		state: NonNullable<GraphCheckpoint["active"]>,
	): Promise<void> {
		if (state.phase !== "waiting")
			run.reviewGate = {
				id: randomUUID(),
				headSha: result.headSha,
				mode: result.mode,
				externalDigest: result.externalDigest,
				url: result.url,
				repositories: deliveryRevisions(result),
				status: "pending",
			};
		state.phase = "waiting";
		run.status = "waiting";
		releaseDelivery(run, "Awaiting human review");
		run.questions = [];
		run.questionRecommendations = undefined;
		run.questionChoices = undefined;
		run.questionBatchId = undefined;
		const waiting = new Promise<void>((resolve, reject) =>
			this.pendingAnswers.set(run.id, { resolve, reject }),
		);
		const abort = () =>
			this.pendingAnswers.get(run.id)?.reject(new Error("Run terminated"));
		signal.addEventListener("abort", abort, { once: true });
		this.log(
			run,
			run.step ?? "human-review",
			"Ready for explicit human review. Approve this revision or request changes in the factory UI.",
		);
		try {
			if (run.ticketReference && this.hooks.track)
				await this.track(run, {
					key: `review:${run.reviewGate!.id}`,
					stage: "in_review",
					pr: result.url || undefined,
					body:
						result.mode === "external"
							? "External changes applied and independently verified. Review the guide and accept completed work or request changes. Applied work is retained after rejection."
							: `Awaiting explicit human approval for ${result.url}. Review the guide, then approve this revision or request changes in Factory.`,
				});
			signal.throwIfAborted();
			await waiting;
		} finally {
			signal.removeEventListener("abort", abort);
			this.pendingAnswers.delete(run.id);
		}
	}
	decideArchitecture(id: string, value: unknown): void {
		const decision = ArchitectureDecisionSchema.parse(value);
		const run = this.get(id),
			gate = run.architectureGate,
			pending = this.pendingAnswers.get(id);
		const proposal = run.architectureProposals?.find(
			(p) => p.id === gate?.proposalId,
		);
		if (
			run.status !== "waiting" ||
			!pending ||
			!proposal ||
			proposal.status !== "pending"
		)
			throw new Error("Run is not waiting for an architecture decision");
		if (
			decision.proposalId !== proposal.id ||
			decision.version !== proposal.version ||
			decision.digest !== proposal.digest
		)
			throw new Error(
				"Architecture proposal changed. Refresh and review again.",
			);
		verifyProposal(proposal);
		if (decision.decision === "explain") {
			proposal.feedback.push({
				kind: "explain",
				text: decision.feedback!,
				at: new Date().toISOString(),
			});
			this.answer(id, decision.feedback!, "explanation");
			return;
		}
		if (decision.decision === "accept" && openDecisions(proposal.content))
			throw new Error(
				"Answer Bob's open questions and ask for a new version before approving",
			);
		run.architectureDecisions ??= [];
		run.architectureDecisions.push({
			...decision,
			at: new Date().toISOString(),
		});
		if (decision.decision === "accept") {
			proposal.status = "accepted";
			run.outputs[gate!.planOutput] = structuredClone(
				proposal.content.candidate,
			);
		} else {
			// A human-requested version of a stock proposal is written as a check-in.
			let upgraded = false;
			for (const workflow of [
				run.workflow,
				...(run.workflowDefinitions ?? []),
			]) {
				const steps = upgradedArchitectureSteps(workflow.steps);
				if (!steps) continue;
				// The waiting graph holds this array; replace the frozen steps in place.
				workflow.steps.splice(0, workflow.steps.length, ...steps);
				upgraded = true;
			}
			if (upgraded)
				this.log(
					run,
					gate!.stepKey,
					"The next version is written as a check-in with the current stock prompt.",
				);
			proposal.status =
				decision.decision === "revise" ? "rejected" : "superseded";
			proposal.feedback.push({
				kind: decision.decision,
				text: decision.feedback!,
				at: new Date().toISOString(),
			});
			// Discussion regenerates a candidate, never grants acceptance.
			run.answers.push({
				questions: [...run.questions],
				answer: decision.feedback!,
				at: new Date().toISOString(),
			});
		}
		const answered = (frame?: GraphCheckpoint): void => {
			if (frame?.active?.phase === "waiting" && !frame.active.children?.length)
				frame.active.phase = "answered";
			frame?.active?.children?.forEach(answered);
		};
		answered(run.checkpoint);
		run.status = "running";
		run.questions = [];
		run.questionRecommendations = undefined;
		run.questionChoices = undefined;
		run.questionBatchId = undefined;
		delete run.architectureGate;
		this.log(
			run,
			gate!.stepKey,
			decision.decision === "accept"
				? `Accepted architecture version ${proposal.version}`
				: `Architecture feedback: ${decision.feedback}`,
		);
		// Persist the authorization and exact handoff before waking the graph.
		this.save(run);
		void this.flush(id).then(
			() => pending.resolve(),
			(error) => pending.reject(error),
		);
	}
	decide(id: string, decision: Omit<HumanDecision, "at">): void {
		const run = this.get(id);
		this.requireRunAvailable(run);
		const pending = this.pendingAnswers.get(id),
			gate = run.reviewGate;
		if (run.status !== "waiting" || !pending || gate?.status !== "pending")
			throw new Error("Run is not waiting for human review");
		if (
			(gate.mode !== "external" && !decision.headSha) ||
			gate.id !== decision.reviewId ||
			gate.headSha !== decision.headSha ||
			(gate.externalDigest !== undefined &&
				(gate.externalDigest !== decision.externalDigest ||
					gate.externalDigest !== run.delivery?.verification?.digest))
		)
			throw new Error(
				"The reviewed revision changed. Refresh and review again.",
			);
		if (decision.decision === "reject" && !decision.feedback?.trim())
			throw new Error("Explain what Bob should change");
		run.humanDecisions ??= [];
		run.humanDecisions.push({
			...decision,
			mode: gate.mode,
			...(gate.url ? { url: gate.url } : {}),
			externalDigest: gate.externalDigest,
			repositories: structuredClone(gate.repositories),
			at: new Date().toISOString(),
		});
		gate.status = decision.decision;
		const answered = (frame?: GraphCheckpoint): void => {
			if (frame?.active?.phase === "waiting") frame.active.phase = "answered";
			frame?.active?.children?.forEach(answered);
		};
		answered(run.checkpoint);
		const reviewStep = stepForRun(run, run.step);
		run.outputs[
			reviewStep && resolveStepConfig(reviewStep).explicit
				? run.step!
				: "human-review"
		] = run.humanDecisions.at(-1)!;
		run.status = "running";
		this.log(
			run,
			run.step ?? "human-review",
			`Human ${decision.decision}: ${decision.feedback ?? decision.headSha}`,
		);
		void this.flush(id).then(
			() => pending.resolve(),
			(error) => pending.reject(error),
		);
	}
	private questionCheckpoint(
		run: FactoryRun,
	): { frame: GraphCheckpoint; step: WorkflowStep; key: string } | undefined {
		if (
			this.shuttingDown ||
			run.status !== "waiting" ||
			!this.pendingAnswers.has(run.id) ||
			!run.questions.length ||
			!run.questionBatchId ||
			run.architectureGate ||
			run.reviewGate?.status === "pending" ||
			run.workflowBlock ||
			this.catalog.unavailable(run.workflow, run.workflowDefinitions ?? [])
				.length
		)
			return;
		const locate = (
			frame: GraphCheckpoint | undefined,
			steps: WorkflowStep[],
			prefix: string,
		):
			| { frame: GraphCheckpoint; step: WorkflowStep; key: string }
			| undefined => {
			if (!frame) return;
			const step = steps.find((s) => s.id === frame.current);
			if (!step || step.type === "fanout" || step.type === "foreach") return;
			const state = frame.active;
			if (!state) return;
			const key = `${prefix}${step.id}`;
			if (step.type === "workflow") {
				const child = run.workflowDefinitions?.find(
					(w) => w.id === step.workflow,
				);
				if (!child || state.children?.length !== 1) return;
				return locate(state.children[0], child.steps, `${key}/`);
			}
			if (
				state.phase !== "waiting" ||
				state.children?.length ||
				state.questionExplanation ||
				step.type !== "agent" ||
				hasCheck(step, "architecture-proposal") ||
				hasCheck(step, "architecture-candidate") ||
				["human-review", "architecture-decision"].includes(step.tool ?? "") ||
				key !== run.step ||
				!(step.askQuestions || hasCheck(step, "optional-questions"))
			)
				return;
			return { frame, step, key };
		};
		return locate(
			run.checkpoint,
			(run.recoveryWorkflow ?? run.workflow).steps,
			"",
		);
	}
	canRecheckQuestions(id: string): boolean {
		return !!this.questionCheckpoint(this.get(id));
	}
	async recheckQuestions(
		id: string,
		context: { step: string; questionBatchId: string; questions: string[] },
	): Promise<FactoryRun> {
		const run = this.get(id);
		this.requireRunAvailable(run);
		const found = this.questionCheckpoint(run);
		if (!found)
			throw new Error("Run is not waiting for recheckable assistance");
		if (
			!context.questionBatchId ||
			context.questionBatchId !== run.questionBatchId ||
			context.step !== run.step ||
			!isDeepStrictEqual(context.questions, run.questions)
		)
			throw new Error(
				"The question or step changed. Refresh before rechecking.",
			);
		const { frame, step, key } = found;
		const state = frame.active!;
		const pending = this.pendingAnswers.get(id)!;
		const previous =
			run.outputs[resolveStepConfig(step).explicit ? key : step.id];
		const decision = hasCheck(step, "impact-reuse")
			? [...(run.impactDecisions ?? [])]
					.reverse()
					.find(
						(item) =>
							item.snapshot.digest === readPath(previous, "snapshot.digest") &&
							item.at === readPath(previous, "at"),
					)
			: undefined;
		state.questionRecheck = {
			questionBatchId: context.questionBatchId,
			questions: [...run.questions],
			at: new Date().toISOString(),
			...(decision?.status === "blocked"
				? {
						convergence: {
							key: decision.snapshot.key,
							snapshotDigest: decision.snapshot.digest,
							at: decision.at,
						},
					}
				: {}),
		};
		const agent = state.agent ?? frame.agentSessions?.[step.id];
		// Drop only the completed turn cache. Its receipt and exact native identity
		// remain retained; an unchanged revision must still perform a fresh check.
		state.agent = agent
			? { runner: agent.runner, sessionId: agent.sessionId }
			: undefined;
		state.phase = "executing";
		delete state.attemptId;
		delete state.questionDisplay;
		delete state.questionExplanation;
		frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
		run.questions = [];
		delete run.questionRecommendations;
		delete run.questionChoices;
		delete run.questionBatchId;
		run.status = "running";
		try {
			this.log(
				run,
				key,
				"Explicit assistance recheck requested. Re-evaluating this role with saved work and conversation retained; no answer or approval was supplied.",
			);
			await this.flush(id);
			pending.resolve();
		} catch (error) {
			pending.reject(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
		return run;
	}
	answer(id: string, answer: string, kind?: "answer" | "explanation"): void {
		const run = this.get(id);
		this.requireRunAvailable(run);
		const pending = this.pendingAnswers.get(id);
		if (
			run.status !== "waiting" ||
			!pending ||
			run.reviewGate?.status === "pending"
		)
			throw new Error("Run is not waiting for an answer");
		if (!answer.trim()) throw new Error("Enter an answer");
		if (
			run.architectureGate &&
			kind !== "explanation" &&
			!(kind === undefined && isExplanationRequest(answer, run.questions))
		) {
			const proposal = run.architectureProposals!.find(
				(p) => p.id === run.architectureGate!.proposalId,
			)!;
			this.decideArchitecture(id, {
				proposalId: proposal.id,
				version: proposal.version,
				digest: proposal.digest,
				decision: "discuss",
				feedback: answer,
			});
			return;
		}

		if (
			kind === "explanation" ||
			(kind === undefined && isExplanationRequest(answer, run.questions))
		) {
			const locate = (frame?: GraphCheckpoint): GraphCheckpoint["active"] => {
				if (
					frame?.active?.phase === "waiting" &&
					!frame.active.children?.length
				)
					return frame.active;
				for (const child of frame?.active?.children ?? []) {
					const found = locate(child);
					if (found) return found;
				}
				return undefined;
			};
			const state = locate(run.checkpoint);
			if (!state) throw new Error("Pending question checkpoint unavailable");
			run.questionRequests ??= [];
			run.questionRequests.push({
				questions: [...run.questions],
				text: answer,
				at: new Date().toISOString(),
			});
			run.status = "running";
			state.questionExplanation = {
				source: structuredClone(
					state.questionDisplay?.source ?? {
						questions: run.questions,
						...(run.questionChoices === undefined
							? {}
							: { choices: run.questionChoices }),
						...(run.questionRecommendations === undefined
							? {}
							: {
									recommendations: run.questionRecommendations,
								}),
					},
				),
				text: answer,
				questions: [...run.questions],
			};
			this.log(
				run,
				run.step ?? "clarify",
				`Human explanation request: ${answer}`,
			);
			void this.flush(id).then(
				() => pending.resolve(),
				(error) => pending.reject(error),
			);
			return;
		}
		run.answers.push({
			questions: [...run.questions],
			answer,
			at: new Date().toISOString(),
		});
		const markAnswered = (frame?: GraphCheckpoint): void => {
			if (frame?.active?.phase === "waiting") frame.active.phase = "answered";
			frame?.active?.children?.forEach(markAnswered);
		};
		markAnswered(run.checkpoint);
		run.questions = [];
		run.questionRecommendations = undefined;
		run.questionChoices = undefined;
		run.questionBatchId = undefined;
		run.status = "running";
		this.log(run, run.step ?? "clarify", `Human answer: ${answer}`);
		void this.flush(id).then(
			() => pending.resolve(),
			(error) => pending.reject(error),
		);
	}
	stop(id: string): void {
		const run = this.get(id);
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
	canRefreshGuide(id: string): boolean {
		const run = this.get(id);
		if (
			this.shuttingDown ||
			run.status !== "waiting" ||
			run.reviewGate?.status !== "pending"
		)
			return false;
		try {
			this.requireRunAvailable(run);
		} catch {
			return false;
		}
		return !!this.guideRefreshTarget(run);
	}
	private guideRefreshTarget(run: FactoryRun) {
		const find = (
			frame: GraphCheckpoint | undefined,
			steps: WorkflowStep[],
			prefix = "",
		):
			| {
					frame: GraphCheckpoint;
					prefix: string;
					steps: WorkflowStep[];
					guide: WorkflowStep;
					handoff: WorkflowStep;
					review: WorkflowStep;
			  }
			| undefined => {
			if (!frame) return;
			const step = steps.find((s) => s.id === frame.current);
			const guide = step
				? steps.find(
						(s) => s.id === readStep(step, "guide") && s.type === "agent",
					)
				: undefined;
			const handoff = guide
				? steps.find((s) => s.id === guide.next && s.tool === "handoff")
				: undefined;
			if (
				step?.tool === "human-review" &&
				frame.active?.phase === "waiting" &&
				guide &&
				handoff?.next === step.id
			)
				return { frame, prefix, steps, guide, handoff, review: step };
			if (step?.type === "workflow") {
				const child = run.workflowDefinitions?.find(
					(w) => w.id === step.workflow,
				);
				if (child)
					return find(
						frame.active?.children?.[0],
						child.steps,
						`${prefix}${step.id}/`,
					);
			}
			return undefined;
		};
		return find(run.checkpoint, run.workflow.steps);
	}
	async refreshGuide(id: string, reviewId: string): Promise<FactoryRun> {
		const run = this.get(id);
		this.requireRunAvailable(run);
		if (
			this.shuttingDown ||
			run.status !== "waiting" ||
			run.reviewGate?.status !== "pending" ||
			run.reviewGate.id !== reviewId
		)
			throw new Error(
				"Only the current pending human guide can be regenerated",
			);
		const found = this.guideRefreshTarget(run);
		if (!found)
			throw new Error("This workflow has no regeneratable guide checkpoint");
		const { frame, prefix, steps, guide, handoff, review } = found;
		delete run.reviewGate;
		this.controllers.get(id)?.abort();
		await this.executions.get(id);
		frame.current = guide.id;
		delete frame.active;
		for (const step of [handoff, review]) {
			delete run.outputs[
				resolveStepConfig(step).explicit ? `${prefix}${step.id}` : step.id
			];
			if (frame.outputs) delete frame.outputs[step.id];
		}
		const index = steps.indexOf(guide);
		const upgraded = upgradedGuideStep(guide);
		if (upgraded) steps[index] = upgraded;
		run.status = "running";
		delete run.error;
		this.log(
			run,
			"guide",
			`Regenerating the full PR review guide${upgraded ? " in the current show & tell format with Dig deeper" : ""}; implementation, reviews and captures are retained.`,
		);
		await this.save(run);
		void this.launch(run);
		return run;
	}

	reverifyExternal(id: string, actor: string): FactoryRun {
		const run = this.get(id);
		if (
			this.shuttingDown ||
			this.isExecuting(id) ||
			run.status !== "completed" ||
			!run.delivery ||
			run.delivery.contract.mode === "repository" ||
			!run.ticketSync?.error
		)
			throw new Error(
				"Renewed external verification requires an idle completed run with a ticket synchronization blocker",
			);
		for (const other of this.runs.values())
			if (
				other.id !== id &&
				run.ticketReference &&
				other.ticketReference?.url === run.ticketReference.url &&
				["running", "waiting", "interrupted"].includes(other.status)
			)
				throw new Error("Another run owns this ticket");
		const definition = [
			run.recoveryWorkflow,
			run.workflow,
			...(run.workflowDefinitions ?? []),
		].find((w) => w?.steps.some((s) => s.tool === "external-verify"));
		if (!definition)
			throw new Error("Accepted workflow has no external reverification path");
		run.externalReverifications ??= [];
		run.externalReverifications.push({
			actor,
			at: new Date().toISOString(),
			previousCheckpoint: structuredClone(run.checkpoint),
			previousOverlay: structuredClone(run.recoveryWorkflow),
		});
		run.recoveryWorkflow = {
			...structuredClone(definition),
			id: "external-reverification",
			name: "Renewed external verification",
		};
		const reverify = run.recoveryWorkflow.steps.find(
			(s) => s.tool === "external-verify",
		);
		if (!reverify)
			throw new Error("External recovery has no independent verifier");
		run.checkpoint = { current: reverify.id, visits: {} };
		delete run.reviewGate;
		delete run.delivery.finalCheck;
		const final = run.recoveryWorkflow.steps.find(
			(s) => s.tool === "external-final",
		);
		if (final) run.outputs[final.id] = { drift: true, complete: false };
		for (const receipt of run.ticketSync.receipts)
			if (receipt.completion && !receipt.delivered && !receipt.superseded) {
				receipt.superseded = true;
				receipt.limitation =
					"Previous external completion retired for renewed verification and acceptance.";
			}
		delete run.ticketSync.error;
		run.status = "running";
		this.updateViewState(id, { keptOpen: true });
		this.log(
			run,
			"external-reverify",
			`Operator ${actor} requested renewed verification and acceptance. Applied changes and repository merge receipts are retained.`,
		);
		this.save(run);
		void this.launch(run);
		return run;
	}
	recoverExternal(
		id: string,
		requestId: string,
		value: unknown,
		reviewedDigest: string,
		actor: string,
	): FactoryRun {
		const run = this.get(id);
		const contract = DeliveryContractSchema.parse(value);
		if (run.deliveryRecovery?.requestId === requestId) {
			if (run.deliveryRecovery.contractDigest !== digest(contract))
				throw new Error("Recovery request ID already names another contract");
			return run;
		}
		if (
			this.shuttingDown ||
			this.isExecuting(id) ||
			run.status !== "failed" ||
			stepForRun(run, run.step)?.tool !== "draft-pr" ||
			run.deliveryRecovery
		)
			throw new Error(
				"Recovery requires an idle failed draft-pr run without a prior recovery",
			);
		if (
			!run.ticketReference ||
			contract.mode !== "external" ||
			contract.authorization.status !== "authorized" ||
			digest(contract) !== reviewedDigest
		)
			throw new Error(
				"Explicitly reviewed authorized external contract and originating ticket required",
			);
		const origin = run.ticketReference;
		if (!contract.targets.some((t) => t.resource.url === origin.url))
			throw new Error(
				"Recovery contract must include the verified originating ticket",
			);
		for (const other of this.runs.values())
			if (
				other.id !== id &&
				other.ticketReference?.url === origin.url &&
				["running", "waiting", "interrupted"].includes(other.status)
			)
				throw new Error("Another run owns this ticket");
		freezeDelivery(run, contract);
		run.deliveryRecovery = {
			requestId,
			actor,
			at: new Date().toISOString(),
			previousWorkflow: structuredClone(run.workflow),
			previousCheckpoint: structuredClone(run.checkpoint),
			contractDigest: reviewedDigest,
		};
		const stock = defaultWorkflows.find((w) => w.id === "factory-pipeline")!;
		run.recoveryWorkflow = {
			...structuredClone(stock),
			id: "external-recovery",
			name: "Audited external recovery",
		};
		const reverify = run.recoveryWorkflow.steps.find(
			(s) => s.tool === "external-verify",
		);
		if (!reverify)
			throw new Error("External recovery has no independent verifier");
		run.checkpoint = { current: reverify.id, visits: {} };
		delete run.reviewGate;
		run.status = "running";
		delete run.error;
		this.log(
			run,
			"external-recovery",
			`Operator ${actor} requested external recovery. Original definition/checkpoint and failed publication evidence retained; independently reconcile current tickets before review.`,
		);
		this.save(run);
		void this.launch(run);
		return run;
	}
	canResume(id: string): boolean {
		const run = this.get(id);
		return (
			!this.shuttingDown &&
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
				) ||
				this.snapshots.hasValue(
					run as unknown as Record<string, unknown>,
					"improvementState",
				))
		);
	}
	hasRunValue(run: FactoryRun, key: keyof FactoryRun): boolean {
		return this.snapshots.hasValue(
			run as unknown as Record<string, unknown>,
			key,
		);
	}
	private reopenInvalidDeliveryPlan(
		run: FactoryRun,
		frame: GraphCheckpoint,
		steps: WorkflowStep[],
		prefix: string,
		outputs: Record<string, unknown>,
	): boolean {
		const router = steps.find((s) => s.id === frame.current)!;
		const candidate = readOutput(router, "plan", outputs);
		try {
			validateDeliveryContract(run, readPath(candidate, "deliveryContract"));
			return false;
		} catch (error) {
			const plan = steps.find(
				(s) => s.id === readStep(router, "plan") && s.type === "agent",
			);
			const review = steps.find(
				(s) => s.id === readStep(router, "review") && s.type === "agent",
			);
			const revision = plan
				? run.roleRevisions?.[`${prefix}${plan.id}`]
				: undefined;
			// Only re-enter the accepted author -> independent review -> gate route.
			if (
				!plan ||
				!review ||
				!revision ||
				revision.dirty ||
				this.nextStep(steps, plan, candidate) !== review.id ||
				this.nextStep(steps, review, outputs[review.id]) !== frame.current
			)
				return false;
			frame.current = plan.id;
			frame.visits[plan.id] = (frame.visits[plan.id] ?? 0) + 1;
			frame.active = {
				phase: "executing",
				agent: {
					...frame.agentSessions?.[plan.id],
					runner:
						frame.agentSessions?.[plan.id]?.runner ??
						AgentSettingsSchema.shape.runner
							.unwrap()
							.parse(plan.runner ?? run.runner ?? "claude"),
					result: { output: candidate, revision },
				},
			};
			this.log(
				run,
				"run",
				`Returning invalid delivery candidate to ${prefix}${plan.id} for bounded output correction and fresh independent review: ${error instanceof Error ? error.message : String(error)}`,
			);
			return true;
		}
	}
	private assessedCorrection(
		run: FactoryRun,
		steps: WorkflowStep[],
		outputs: Record<string, unknown>,
		prefix: string,
		fixer: string,
	) {
		for (const assessor of steps) {
			if (
				!hasCheck(assessor, "impact-reuse") ||
				!readStep(assessor, "fanout") ||
				!assessor.branches.some(
					(branch) =>
						branch.when.path === "correctionRequired" &&
						branch.when.equals === true &&
						branch.next === fixer,
				)
			)
				continue;
			// A blocked assessment can route here after its assistance answer. It is
			// still an obligation, though it cannot authorize evidence reuse.
			const decision = [...(run.impactDecisions ?? [])]
				.reverse()
				.find(
					(item) =>
						item.snapshot.key === `${prefix}${readStep(assessor, "fanout")}`,
				);
			if (
				!decision?.correctionRequired ||
				readPath(outputs[assessor.id], "snapshot.digest") !==
					decision.snapshot.digest ||
				readPath(outputs[assessor.id], "at") !== decision.at ||
				this.nextStep(steps, assessor, decision) !== fixer
			)
				continue;
			return {
				source: `${prefix}${assessor.id}`,
				required: true,
				snapshotDigest: decision.snapshot.digest,
				summary: decision.summary,
				rationale: decision.rationale,
				uncertainty: [...decision.uncertainty],
				commentAssessments: structuredClone(decision.commentAssessments),
			};
		}
		return undefined;
	}
	private renewStaleImpact(
		run: FactoryRun,
		frame: GraphCheckpoint,
		steps: WorkflowStep[],
		prefix: string,
	): boolean {
		const current = steps.find((s) => s.id === frame.current);
		const source =
			current && consumesImpact(current)
				? readStep(current, "impact")
				: undefined;
		const assessor = steps.find(
			(s) => s.id === source && hasCheck(s, "impact-reuse"),
		);
		if (!assessor) return false;
		frame.current = assessor.id;
		frame.active = undefined;
		this.log(
			run,
			"run",
			`Renewing stale impact through ${prefix}${assessor.id}; completed work and evidence remain retained and required gates must pass again. Existing pass limits still apply.`,
		);
		return true;
	}
	retry(id: string): FactoryRun {
		const run = this.get(id);
		this.requireRunAvailable(run);
		if (this.shuttingDown) throw new Error("Factory is shutting down");
		if (
			this.controllers.has(id) ||
			(!["failed", "interrupted"].includes(run.status) &&
				!(run.status === "stopped" && run.architectureGate))
		)
			throw new Error("Only failed or interrupted runs can be retried");
		releaseDelivery(run, "Explicit retry must re-enter delivery coordination");
		// Retry is an explicit request for bounded additional work, never a global reset.
		const extend = (
			frame: GraphCheckpoint,
			steps: WorkflowStep[],
			prefix: string,
		) => {
			let step = steps.find((item) => item.id === frame.current);
			if (!step) return;
			if (
				run.error === STALE_IMPACT_MESSAGE &&
				this.renewStaleImpact(run, frame, steps, prefix)
			)
				step = steps.find((s) => s.id === frame.current)!;
			const key = `${prefix}${step.id}`;
			if (frame.active?.terminalFailure) {
				const native = frame.active.agent;
				frame.active = {
					phase: "executing",
					...(native?.sessionId
						? { agent: { runner: native.runner, sessionId: native.sessionId } }
						: {}),
				};
				frame.visits[step.id] = (frame.visits[step.id] ?? 0) + 1;
			}
			const agent =
				frame.active?.phase === "executing" ? frame.active.agent : undefined;
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
		if (run.checkpoint)
			extend(run.checkpoint, (run.recoveryWorkflow ?? run.workflow).steps, "");
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
		for (const controller of this.controllers.values()) controller.abort();
		await Promise.allSettled(this.executions.values());
		for (const id of this.pendingActivitySaves.keys())
			await this.save(this.get(id));
		await this.flush();
	}
	resumeAll(): void {
		for (const run of this.runs.values()) {
			if (
				!["running", "waiting"].includes(run.status) ||
				this.controllers.has(run.id)
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
		if (frame.resultReceipts) {
			for (const id of Object.keys(frame.resultReceipts))
				frame.resultReceipts[id] = immutableJson(frame.resultReceipts[id]!);
			return;
		}
		frame.resultReceipts = {};
		// Older unfinished frames have no ownership map. Only original qualified
		// receipts of steps visited in this frame can restore it; inherited live
		// output names never establish production or cause a completed role to replay.
		for (const step of steps) {
			if (!frame.visits[step.id]) continue;
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
				if (["workflow", "fanout", "foreach"].includes(step.type))
					throw new Error(
						`Child result ownership is missing at ${key}; original receipts are retained and nested results cannot be verified`,
					);
				Object.defineProperty(frame.resultReceipts, step.id, {
					value: immutableJson({ key, output: receipt.output }),
					enumerable: true,
					configurable: true,
					writable: true,
				});
			}
		}
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
	private async executeForeach(
		context: ExecutionContext,
		checkpoint: GraphCheckpoint,
		workflowId: string,
		chat: boolean,
		reviewBaseline?: ReviewBaseline,
	): Promise<unknown> {
		const { run, step, signal } = context;
		const key = context.stepKey!;
		const active = checkpoint.active!;
		assertForeachBody(
			step.body ?? [],
			run.workflowDefinitions ?? [run.workflow],
			[workflowId],
		);
		if (!active.foreach) {
			const snapshot = prepareForeach(step, {
				outputs: context.outputs!,
				inputs: stepBindings(context),
				item: checkpoint.iteration?.value,
				index: checkpoint.iteration?.index,
			});
			active.foreach = {
				snapshot: immutableJson(snapshot),
				body: structuredClone(step.body!),
				outputs: snapshotWorkflowInput(context.outputs!),
				states: snapshot.items.map(() => ({ status: "pending" })),
			};
			run.foreachIterations ??= [];
			run.foreachIterations.push(
				immutableJson({
					key,
					visit: checkpoint.visits[step.id]!,
					snapshot: active.foreach.snapshot,
				}),
			);
			active.children = snapshot.items.map((item) => ({
				...this.newCheckpoint(step.body!),
				projectResults: true,
				resultReceipts: {},
				iteration: { ...item, frame: key },
				callInputs: checkpoint.callInputs,
				reviewKey: checkpoint.reviewKey,
			}));
		}
		const loop = active.foreach;
		assertForeachBody(loop.body, run.workflowDefinitions ?? [run.workflow], [
			workflowId,
		]);
		// Rehydrate accepted configuration authority after ordinary serialized loading.
		registerWorkflowConfig(
			{
				id: workflowId,
				stepConfigVersion: "step-config-v1",
				steps: loop.body,
			},
			run.workflow.id,
		);
		loop.snapshot = immutableJson(loop.snapshot);
		if (
			!active.children ||
			active.children.length !== loop.snapshot.items.length ||
			loop.states.length !== loop.snapshot.items.length
		)
			throw new Error("For each checkpoint has inconsistent item frames");
		for (const [index, item] of loop.snapshot.items.entries()) {
			active.children[index]!.projectResults = true;
			const frame = active.children[index]!.iteration;
			if (
				!frame ||
				frame.id !== item.id ||
				frame.index !== item.index ||
				frame.frame !== key ||
				digest(frame.value) !== digest(item.value)
			)
				throw new Error(
					`For each checkpoint item ${item.id} does not match its accepted frame`,
				);
			if (loop.states[index]!.status === "completed") {
				const produced = this.frameResults(
					run,
					loop.body,
					active.children[index]!,
					`${key}/${item.id}/`,
				);
				// The snapshot store can rehydrate JSON with null prototypes; compare
				// canonical JSON authority rather than JavaScript object prototypes.
				if (digest(produced) !== digest(loop.states[index]!.result))
					throw new Error(
						`Completed item ${item.id} has no matching exact-frame result receipts; original results are retained`,
					);
			}
		}
		const progress = () => {
			run.foreach ??= {};
			run.foreach[key] = {
				key,
				visit: checkpoint.visits[step.id]!,
				concurrency: loop.snapshot.concurrency,
				maxItems: loop.snapshot.maxItems,
				failure: loop.snapshot.failure,
				items: loop.snapshot.items.map(({ id, index }, i) => ({
					id,
					index,
					status: loop.states[i]!.status,
					...(loop.states[i]!.error ? { error: loop.states[i]!.error } : {}),
				})),
				completed: loop.states.filter((s) => s.status === "completed").length,
				failed: loop.states.filter((s) => s.status === "failed").length,
				total: loop.states.length,
			};
		};
		// Running/cancelled work resumes its retained child/native checkpoint, never a new graph.
		for (const state of loop.states)
			if (state.status === "running" || state.status === "cancelled") {
				state.status = "pending";
				delete state.error;
			}
		progress();
		await this.save(run); // Full snapshot and every child identity precede dispatch.
		signal.throwIfAborted();
		const controller = new AbortController();
		const cancel = () => controller.abort(signal.reason);
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		let next = 0;
		let suspension: unknown;
		let fatal =
			loop.snapshot.failure === "all-must-succeed" &&
			loop.states.some((s) => s.status === "failed");
		const worker = async () => {
			while (!controller.signal.aborted && !fatal && !suspension) {
				const index = next++;
				if (index >= loop.states.length) return;
				const state = loop.states[index]!;
				if (state.status === "completed" || state.status === "failed") continue;
				const item = loop.snapshot.items[index]!;
				const child = active.children![index]!;
				child.outputs ??= snapshotWorkflowInput(loop.outputs);
				state.status = "running";
				progress();
				await this.save(run);
				try {
					controller.signal.throwIfAborted();
					await this.graph(
						run,
						loop.body,
						child.outputs,
						controller.signal,
						`${key}/${item.id}/`,
						child,
						workflowId,
						chat,
						true,
						reviewBaseline,
					);
					controller.signal.throwIfAborted();
					state.result = this.frameResults(
						run,
						loop.body,
						child,
						`${key}/${item.id}/`,
					);
					state.status = "completed";
				} catch (error) {
					if (isUpdatePaused(error) && !signal.aborted) {
						suspension ??= error;
						state.status = "pending";
					} else if (controller.signal.aborted) {
						state.status = "cancelled";
						state.error = signal.aborted
							? "Run cancelled; unfinished context retained"
							: "Sibling failed; unfinished context retained";
					} else {
						state.status = "failed";
						state.error =
							error instanceof Error ? error.message : String(error);
						if (loop.snapshot.failure === "all-must-succeed") {
							fatal = true;
							controller.abort(error);
						}
					}
				} finally {
					progress();
					await this.save(run);
				}
			}
		};
		try {
			// Orchestration holds no capacity lease or shared-resource reservation.
			// All workers settle their native/leaf cleanup before join or failure.
			const outcomes = await Promise.allSettled(
				Array.from(
					{ length: Math.min(loop.snapshot.concurrency, loop.states.length) },
					worker,
				),
			);
			const unexpected = outcomes.find((o) => o.status === "rejected");
			if (unexpected?.status === "rejected") throw unexpected.reason;
			if (fatal || signal.aborted)
				for (const state of loop.states)
					if (state.status === "pending") {
						state.status = "cancelled";
						state.error = fatal
							? "Not dispatched: sibling failed"
							: "Not dispatched: run cancelled";
					}
			progress();
			await this.save(run);
			signal.throwIfAborted();
			if (suspension) throw suspension;
			if (fatal) {
				const summary = aggregateForeach(loop.snapshot, loop.states).summary;
				throw new Error(
					`For each ${key} failed: ${summary.failures.map((f) => `${f.id}: ${f.error}`).join("; ")}`,
				);
			}
			return aggregateForeach(loop.snapshot, loop.states);
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	}
	/** Runtime owns checkpoint/convergence bookkeeping; the evaluator only consumes data. */
	private async executeCheck(
		context: ExecutionContext,
		preparedReview?: unknown,
	): Promise<unknown> {
		const { step, signal } = context;
		if (!step.check) throw new Error("Check configuration is missing");
		const issues = checkStepEvidenceIssues(step);
		if (issues.length) throw new Error(issues.join("; "));
		const config = resolveStepConfig(step);
		if (config.revision === "bound") {
			context.inspectionBinding = await outputRevisionBinding(
				context,
				undefined,
				true,
			);
			await assertBoundInspectionFresh(context);
		}
		const inputs = stepBindings(context, context.run.history, {
			checkJson: true,
		});
		const selectors = config.checks.filter(
			({ check, args }) =>
				(CHECK_SELECTOR_IDS as readonly string[]).includes(check) &&
				typeof args.path === "string",
		);
		if (selectors.length) await runEvidenceChecks(context, { inputs });
		const declared = new Set(config.checks.map((check) => check.check));
		const projected =
			preparedReview === undefined
				? declared.size
					? await (this.hooks.evidence?.(context) ??
							new FactoryTools({ postComment: async () => {} }).evidence(
								context,
							))
					: {}
				: { "review-evidence": preparedReview };
		const evidence = Object.fromEntries(
			Object.entries(projected).filter(([key]) => declared.has(key as never)),
		);
		for (const { check } of selectors) evidence[check] = { verified: true };

		context.checkEvidence = evidence;
		const ruleEvidence = { ...evidence };
		if (
			hasCheck(step, "review-boundary") &&
			hasCheck(step, "review-evidence")
		) {
			const aggregate = evidence[
				"review-evidence"
			] as import("./SpecialistReview.js").AggregateReview &
				Record<string, unknown>;
			ruleEvidence["review-evidence"] = {
				findings: aggregate.findings,
				rawFindings: aggregate.rawFindings,
				coverage: aggregate.coverage,
				reviewers: aggregate.reviewers.map((reviewer) => ({
					status: reviewer.status,
					blockers: reviewer.blockers,
				})),
				disagreements: aggregate.disagreements,
				reviewIncomplete: aggregate.reviewIncomplete ?? false,
				reviewBlocked: aggregate.reviewBlocked ?? false,
				questions: aggregate.questions ?? [],
			};
		}

		const output = await evaluateCheckAsync(
			step.check,
			inputs,
			ruleEvidence,
			conforms,
			signal,
		);
		if (
			hasCheck(step, "review-assistance") &&
			output.approved !== true &&
			!(Array.isArray(output.questions) && output.questions.length) &&
			context.run.history.some(
				(item) =>
					item.step === boundStepKey(context, "fix") &&
					readPath(item.output, "reviewAssessment.unchangedCode") === true,
			)
		) {
			const revision = await reviewedRunRevision(context.run, undefined, {
				requireClean: false,
			});
			const dirty = Boolean(
				(
					await executeCommand(context, "git", ["status", "--porcelain"])
				).trim(),
			);
			const questions = reviewRecoveryQuestions(context, output, {
				headSha: revision.headSha,
				dirty,
			});
			if (questions.length)
				Object.assign(output, { reviewBlocked: true, questions });
		}
		if (hasCheck(step, "post-fix-evidence")) {
			const observed = boundToolOutput(
				context,
				"observation",
				"inspect-review-readiness",
			);
			if (
				!observed ||
				importDigest(observed) !==
					importDigest(boundOutput(context, "observation"))
			)
				throw new Error(
					"Post-fix evidence requires the exact executed provider inspection in this workflow frame",
				);
			const questions: string[] = [];
			const seen = new Set<string>();
			for (const [name, kind] of [
				["revisionAssistance", "revision"],
				["failureAssistance", "failure"],
				["workAssistance", "work"],
			]) {
				const observations = output[name!];
				if (!Array.isArray(observations)) continue;
				for (const observation of observations) {
					const identity = importDigest(observation);
					if (seen.has(identity)) continue;
					seen.add(identity);
					const snapshot = readPath(
						observation,
						"readiness",
					) as import("./MergeReadiness.js").MergeReadiness;
					const headSha = String(readPath(observation, "headSha"));
					const question =
						kind === "revision"
							? `The same revision mismatch remains after the CI fixer's synchronization attempt: The provider reports ${snapshot.headSha}, while the worktree is at ${headSha}. Restore synchronization between this PR and its branch, then reply to resume. Checks for the older revision remain insufficient; your answer does not approve or waive review and CI.`
							: kind === "failure"
								? `The CI fixer made no revision change and these same checks still fail: ${snapshot.checks
										.filter((check) => check.bucket === "fail")
										.map(
											(check) => `${check.name}: ${check.link ?? check.state}`,
										)
										.join(
											"; ",
										)}. Resolve the external blocker or provide a corrective direction before retrying. The failures remain blocking.`
								: `The CI fixer made no progress on the same actionable blockers: ${snapshot.blockers
										.filter((blocker) => blocker.action === "fix")
										.map((blocker) => blocker.message)
										.join(
											"; ",
										)}. Resolve the blocker or provide a corrective direction before retrying. Review and merge safeguards remain enforced.`;
					questions.push(
						typeof readPath(observation, "repositoryName") === "string"
							? `${readPath(observation, "repositoryName")}: ${question}`
							: question,
					);
				}
			}
			if (output.needsAssistance === true) {
				if (!questions.length)
					throw new Error(
						"Post-fix assistance requires declared matching observation results",
					);
				Object.assign(output, { questions });
			}
		}

		return output;
	}

	private nextStep(
		steps: WorkflowStep[],
		step: WorkflowStep,
		output: unknown,
	): string {
		const routes = step.tool === "handoff" ? structuredClone(steps) : steps;
		if (routes !== steps) upgradeHandoffReadiness(routes);
		return routeResult(
			routes.find((s) => s.id === step.id) ?? step,
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
				if (
					step.askQuestions &&
					Array.isArray(readPath(receipt.output, "questions")) &&
					(readPath(receipt.output, "questions") as unknown[]).length
				) {
					const answered = run.answers.some(
						(answer) =>
							answer.at >= receipt.at &&
							JSON.stringify(answer.questions) ===
								JSON.stringify(readPath(receipt.output, "questions")),
					);
					if (!answered) {
						frame.active = { phase: "waiting" };
						break;
					}
					continue;
				}
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
				reviewRounds: 1,
				architectureProposals: 1,
				impactDecisions: 1,
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
			videoAssets,
			improvementParent: run.improvementParent,
			improvement: run.improvementState && {
				phase: run.improvementState.phase,
				children: run.improvementState.children,
				issueCount: Object.values(run.improvementState.issues).filter(
					(i) => i.phase === "confirmed",
				).length,
			},
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
			reviewGate: run.reviewGate,
			hasGuide: Object.getOwnPropertyDescriptor(run, "outputs")?.get
				? this.summaries.get(run.id)?.hasGuide
				: !!presentationOutputKeys(run).guide,
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
	previousReviewGuide(run: FactoryRun, guidePreview: unknown): unknown {
		const head = (guidePreview as { previousHeadSha?: string } | undefined)
			?.previousHeadSha;
		if (!head) return undefined;
		const index = this.historyPreviews(run);
		for (let position = index.length - 1; position >= 0; position--) {
			const step = index[position]!.step;
			const role = stepForRun(run, step);
			if (!role || !hasCheck(role, "requirement-coverage")) continue;
			const guide = run.history[position]?.output as
				| { reviewFiles?: { headSha?: string }; chapters?: unknown }
				| undefined;
			if (guide?.reviewFiles?.headSha === head && guide.chapters) return guide;
		}
		return undefined;
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
		const detailed = new Set([
			...Object.values(presentationOutputKeys(run)),
			// Named launch context is independent of authored graph identities.
			"source",
			"existing-work",
		]);
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
