import type { z } from "zod";
import type { ReviewBaseline } from "../SpecialistReview.js";
import type { HumanViews } from "../ViewRuntime.js";
import type { WorkflowStep } from "../Workflow.js";
import type {
	ExecutionContext,
	FactoryRun,
	GraphCheckpoint,
	RuntimeHooks,
	WorkflowRuntime,
} from "../WorkflowRuntime.js";
import type { NodeMetadata } from "./metadata.js";

/** Existing graph services shared by the migrated nodes, without runtime ownership. */
export interface NodeEngine {
	graph(
		run: FactoryRun,
		steps: WorkflowStep[],
		outputs: Record<string, unknown>,
		signal: AbortSignal,
		prefix: string,
		checkpoint: GraphCheckpoint,
		workflowId: string,
		chat?: boolean,
		parallel?: boolean,
		baseline?: ReviewBaseline,
	): Promise<Record<string, unknown>>;
	newCheckpoint(steps: WorkflowStep[]): GraphCheckpoint;
	frameResults(
		run: FactoryRun,
		steps: WorkflowStep[],
		checkpoint: GraphCheckpoint,
		prefix: string,
	): Record<string, unknown>;
	historyPreviews: WorkflowRuntime["historyPreviews"];
	save(run: FactoryRun): Promise<void>;
	log(
		run: FactoryRun,
		key: string,
		message: string,
		source?: import("../WorkflowRuntime.js").RunEvent["source"],
		call?: import("../WorkflowRuntime.js").WorkflowCall,
	): void;
	hooks: RuntimeHooks;
	runs: Map<string, FactoryRun>;
	subscribe: WorkflowRuntime["subscribe"];
	reconcileLaunchBatch(
		run: FactoryRun,
		batch: import("../LaunchRuns.js").LaunchRunBatch,
		signal: AbortSignal,
	): Promise<void>;
	humanViews: HumanViews;
}
export interface EffectRecord {
	key: string;
	inputDigest: string;
	phase: "not-sent" | "sending" | "uncertain" | "confirmed";
	receipt?: unknown;
	error?: string;
}
export interface NodeContext<S extends WorkflowStep = WorkflowStep>
	extends ExecutionContext {
	step: S;
	/** Detached named reads, resolved once before dispatch. */
	reads: Record<string, unknown>;
	inputDigest: string;
	guarantee: import("../NodeGuarantees.js").NodeGuarantee;
	fresh(reference: string): Promise<boolean>;
	/** Attach provider-verified repository revisions without changing the output JSON. */
	recordRevisions(
		revisions: import("../NodeGuarantees.js").NodeRevisions,
	): void;
	stamp<T>(output: T): {
		output: T;
		inputDigest: string;
		guarantee: import("../NodeGuarantees.js").NodeGuarantee;
	};
	checkpoint(): Promise<void>;
	/** Stable for this accepted visit, including retries and process restarts. */
	effectKey(name: string): Promise<string>;
	/** Reconcile to a receipt, null (absent), or undefined (unknown). */
	effect<T>(
		name: string,
		input: unknown,
		send: (key: string) => Promise<T>,
		reconcile?: (key: string) => Promise<T | null | undefined>,
	): Promise<T>;
	/** Observe a wait without acquiring execution capacity. */
	phase<T>(
		kind: "waiting-ci" | "waiting-human",
		fn: () => Promise<T>,
	): Promise<T>;
	/** Enclosing graph mode, before per-step/review overrides to chat. */
	graphChat: boolean;
	/** Graph state/services used by existing flow and IO nodes. */
	engine: NodeEngine;
	frame: GraphCheckpoint;
	workflowId: string;
	parallel: boolean;
	/** Existing configured evidence supplied by the engine's legacy boundary. */
	preparedEvidence?: unknown;
	sourceInput?: unknown;
}
export interface NodeDefinition<
	Schema extends z.ZodType<WorkflowStep> = z.ZodType<WorkflowStep>,
> extends NodeMetadata {
	schema: Schema;
	execute(ctx: NodeContext<z.output<Schema>>): Promise<unknown> | unknown;
	summary?: (output: unknown) => string | undefined;
	/** Temporary bridge for agent/script/tool until their execution is extracted. */
	inline?: true;
}
