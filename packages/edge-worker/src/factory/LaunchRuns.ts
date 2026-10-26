import { createHash } from "node:crypto";
import {
	actionItems,
	type LaunchRunsConfiguration,
	LaunchRunsConfigurationSchema,
} from "./ActionSteps.js";
import { digest as evidenceDigest } from "./EvidenceDigest.js";
import { type ForeachScope, foreachPointer } from "./Foreach.js";
import { type RunRepository, runRepositories } from "./RepositoryScope.js";
import { stepForRun } from "./ToolBindings.js";

import {
	requireTrigger,
	type Workflow,
	type WorkflowStep,
} from "./Workflow.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";

export type LaunchItemStatus =
	| "queued"
	| "launched"
	| "running"
	| "waiting"
	| "merged"
	| "completed"
	| "blocked"
	| "cancelled"
	| "uncertain";
export interface LaunchRunItem {
	id: string;
	index: number;
	runId: string;
	title: string;
	prompt: string;
	plan?: string;
	repositories: RunRepository[];
	dependencies: string[];
	wave: number;
}
/** This receipt is accepted once. Progress and later child receipts never mutate it. */
export interface LaunchRunBatch {
	accepted: {
		version: 1;
		key: string;
		actionId: string;
		workflowId: string;
		workflow: Workflow;
		definitions: Workflow[];
		ancestors: string[];
		at: string;
		wait: boolean;
		items: LaunchRunItem[];
		execution: Pick<
			FactoryRun,
			| "executionSnapshot"
			| "runner"
			| "model"
			| "reasoningEffort"
			| "modelVariant"
			| "serviceTier"
		>;
	};
	digest: string;
	progress: Record<
		string,
		{
			status: LaunchItemStatus;
			creation: "pending" | "creating" | "uncertain" | "confirmed";
			/** Durable admission to ordinary execution, distinct from child persistence. */
			launchCommitted?: true;
			error?: string;
		}
	>;
	paused?: boolean;
	cancelled?: boolean;
}
export interface LaunchRunsHost {
	runtime: Pick<
		WorkflowRuntime,
		"runs" | "create" | "save" | "flush" | "launch" | "stop" | "isExecuting"
	>;
	/** Persist the parent, including accepted intent, before touching any child. */
	save(): Promise<void>;
	assertSchedulingOpen?(): void;
}
const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Follow resolved IDs through both Call recipe and launch actions, never names. */
export function assertLaunchTarget(
	targetId: string,
	definitions: Workflow[],
	ancestors: string[],
): Workflow {
	const byId = new Map(definitions.map((workflow) => [workflow.id, workflow]));
	if (byId.size !== definitions.length)
		throw new Error("Launch runs requires unique accepted recipe IDs");
	const visit = (id: string, path: string[], depth: number): Workflow => {
		if (depth > 10 || path.length >= 10)
			throw new Error("Workflow nesting exceeds 10 levels");
		const workflow = byId.get(id);
		if (!workflow) throw new Error(`Unknown launch recipe: ${id}`);
		requireTrigger(workflow, "workflow");
		if (path.includes(workflow.id))
			throw new Error(
				`Recursive workflow launch: ${[...path, workflow.id].join(" → ")}`,
			);
		const inspect = (steps: WorkflowStep[], nesting: number): void => {
			if (nesting > 10)
				throw new Error("Workflow graph nesting exceeds 10 levels");
			for (const step of steps) {
				if (step.type === "workflow")
					visit(step.workflow!, [...path, workflow.id], depth + 1);
				if (step.type === "launch-runs")
					visit(
						step.launchRuns?.workflow ?? "factory",
						[...path, workflow.id],
						depth + 1,
					);
				for (const group of step.groups ?? []) inspect(group, nesting + 1);
				if (step.body) inspect(step.body, nesting + 1);
			}
		};
		inspect(workflow.steps, 0);
		return workflow;
	};
	return visit(targetId, ancestors, 0);
}

export function prepareLaunchRuns(
	run: FactoryRun,
	configuration: LaunchRunsConfiguration,
	scope: ForeachScope,
	options: {
		key: string;
		actionId: string;
		currentWorkflowId?: string;
		workflowId?: string;
		ancestors?: string[];
	},
): LaunchRunBatch {
	const config = LaunchRunsConfigurationSchema.parse(configuration);
	const current =
		options.currentWorkflowId ?? options.workflowId ?? run.workflow.id;
	const ancestors = [
		...(options.ancestors ?? run.recipeParent?.ancestors ?? []),
	];
	if (!ancestors.includes(run.workflow.id)) ancestors.push(run.workflow.id);
	if (current !== run.workflow.id) ancestors.push(current);
	const definitions = structuredClone(
		run.workflowDefinitions ?? [run.workflow],
	);
	const workflow = assertLaunchTarget(config.workflow, definitions, ancestors);
	const repositories = runRepositories(run);
	const items: LaunchRunItem[] = actionItems(config, scope).map((item) => {
		const prompt = foreachPointer(item.value, config.inputMapping.prompt);
		if (typeof prompt !== "string" || !prompt.trim())
			throw new Error(`Launch item ${item.id} requires a nonempty prompt`);
		const rawPlan = config.inputMapping.plan
			? foreachPointer(item.value, config.inputMapping.plan)
			: undefined;
		const plan =
			rawPlan === undefined
				? undefined
				: typeof rawPlan === "string"
					? rawPlan
					: JSON.stringify(rawPlan);
		const ids = config.inputMapping.repositoryIds
			? foreachPointer(item.value, config.inputMapping.repositoryIds)
			: repositories.map((repository) => repository.id);
		if (
			!Array.isArray(ids) ||
			!ids.length ||
			ids.some(
				(id) =>
					typeof id !== "string" ||
					!repositories.some((repo) => repo.id === id),
			) ||
			new Set(ids).size !== ids.length
		)
			throw new Error(
				`Launch item ${item.id} must select unique repositories from the parent's accepted scope`,
			);
		const dependencies = config.dependencies
			? foreachPointer(item.value, config.dependencies)
			: [];
		if (
			!Array.isArray(dependencies) ||
			dependencies.some((id) => typeof id !== "string") ||
			new Set(dependencies).size !== dependencies.length
		)
			throw new Error(`Launch item ${item.id} needs unique dependency IDs`);
		return {
			id: item.id,
			index: item.index,
			runId: `child-${digest([run.id, options.actionId, item.id]).slice(0, 40)}`,
			title: prompt.trim().split("\n")[0]!.slice(0, 160),
			prompt,
			plan,
			repositories: structuredClone(
				repositories
					.filter((repository) => ids.includes(repository.id))
					.map((repository) => ({ ...repository, workspace: "" })),
			),
			dependencies,
			wave: 0,
		};
	});
	const byId = new Map(items.map((item) => [item.id, item]));
	const waves = new Map<string, number>();
	const wave = (id: string, path: string[]): number => {
		const item = byId.get(id);
		if (!item) throw new Error(`Unknown launch dependency: ${id}`);
		if (path.includes(id))
			throw new Error(
				`Cyclic launch dependencies: ${[...path, id].join(" → ")}`,
			);
		const known = waves.get(id);
		if (known !== undefined) return known;
		const value = item.dependencies.length
			? 1 +
				Math.max(
					...item.dependencies.map((dependency) =>
						wave(dependency, [...path, id]),
					),
				)
			: 0;
		waves.set(id, value);
		return value;
	};
	for (const item of items) item.wave = wave(item.id, []);
	const accepted: LaunchRunBatch["accepted"] = {
		version: 1,
		key: options.key,
		actionId: options.actionId,
		workflowId: current,
		workflow,
		definitions,
		ancestors,
		at: new Date().toISOString(),
		wait: config.wait,
		items,
		execution: structuredClone({
			executionSnapshot: run.executionSnapshot,
			runner: run.runner,
			model: run.model,
			reasoningEffort: run.reasoningEffort,
			modelVariant: run.modelVariant,
			serviceTier: run.serviceTier,
		}),
	};
	return {
		accepted,
		digest: digest(accepted),
		progress: Object.fromEntries(
			items.map((item) => [item.id, { status: "queued", creation: "pending" }]),
		),
	};
}

const dispatches = new WeakMap<
	LaunchRunsHost["runtime"],
	Map<string, Promise<void>>
>();
function serialized(
	host: LaunchRunsHost,
	key: string,
	operation: () => Promise<void>,
): Promise<void> {
	let active = dispatches.get(host.runtime);
	if (!active) {
		active = new Map();
		dispatches.set(host.runtime, active);
	}
	const previous = active.get(key);
	const pending = (previous ?? Promise.resolve())
		.catch(() => {})
		.then(operation);
	active.set(key, pending);
	void pending
		.finally(() => {
			if (active.get(key) === pending) active.delete(key);
		})
		.catch(() => {});
	return pending;
}

/** Only a complete node-owned provider confirmation can unlock dependent work. */
export function launchRepositoryCompletionProven(child: FactoryRun): boolean {
	const receipt = [...child.history]
		.reverse()
		.find((entry) => stepForRun(child, entry.step)?.type === "merge");
	if (
		!receipt?.guarantee ||
		receipt.guarantee.outputDigest !== evidenceDigest(receipt.output)
	)
		return false;
	const output = receipt.output as
		| {
				headChanged?: boolean;
				authorizationStale?: boolean;
				repositories?: {
					repositoryId: string;
					merged: boolean;
					sha: string;
					url: string;
				}[];
		  }
		| undefined;
	if (
		output?.headChanged ||
		output?.authorizationStale ||
		!output?.repositories?.length
	)
		return false;
	const ids = new Set<string>();
	return output.repositories.every((repository) => {
		const revision = receipt.guarantee!.revisions[repository.repositoryId];
		if (ids.has(repository.repositoryId)) return false;
		ids.add(repository.repositoryId);
		return (
			repository.merged === true &&
			!!repository.sha &&
			!!repository.url &&
			!!revision?.headSha &&
			!revision.unobservable
		);
	});
}

function childStatus(child: FactoryRun): LaunchItemStatus {
	if (child.status === "completed")
		return launchRepositoryCompletionProven(child) ? "merged" : "completed";
	if (["failed", "blocked"].includes(child.status)) return "blocked";
	if (child.status === "stopped") return "cancelled";
	return child.status === "waiting" ? "waiting" : "running";
}
function verifyIdentity(
	parent: FactoryRun,
	batch: LaunchRunBatch,
	item: LaunchRunItem,
	child: FactoryRun,
) {
	if (
		child.id !== item.runId ||
		child.recipeParent?.runId !== parent.id ||
		child.recipeParent.actionId !== batch.accepted.actionId ||
		child.recipeParent.itemId !== item.id ||
		child.workflow.id !== batch.accepted.workflow.id
	)
		throw new Error(`Child launch identity collision for ${item.id}`);
}
/** A short reconciliation turn. Waiting never holds an agent/capacity/mutation lease. */
export function tickLaunchRuns(
	run: FactoryRun,
	batch: LaunchRunBatch,
	host: LaunchRunsHost,
	signal?: AbortSignal,
): Promise<void> {
	return serialized(host, `${run.id}/${batch.accepted.actionId}`, async () => {
		if (digest(batch.accepted) !== batch.digest)
			throw new Error("Accepted launch batch integrity check failed");
		const { runtime } = host;
		const paused = () =>
			batch.paused ||
			["stopped", "failed", "blocked"].includes(run.status) ||
			signal?.aborted;
		// Reconcile every known identity first, including children created before a crash.
		for (const item of batch.accepted.items) {
			const state = batch.progress[item.id]!;
			const child = runtime.runs.get(item.runId);
			if (child) {
				verifyIdentity(run, batch, item, child);
				if (state.creation !== "confirmed") {
					try {
						await runtime.save(child);
						await runtime.flush(child.id);
						state.creation = "confirmed";
					} catch {
						state.creation = "uncertain";
						state.status = "uncertain";
						state.error =
							"Child persistence is uncertain; restore storage and reconcile the original child";
						continue;
					}
				}
				if (
					batch.cancelled &&
					!["completed", "failed", "stopped"].includes(child.status)
				)
					runtime.stop(child.id);
				state.status =
					!state.launchCommitted &&
					["running", "interrupted"].includes(child.status)
						? "launched"
						: childStatus(child);
				delete state.error;
			} else if (batch.cancelled) state.status = "cancelled";
		}
		await host.save();
		if (batch.cancelled || paused()) return;
		for (const item of [...batch.accepted.items].sort(
			(a, b) => a.wave - b.wave || a.index - b.index,
		)) {
			if (paused() || batch.cancelled) break;
			const state = batch.progress[item.id]!;
			let child = runtime.runs.get(item.runId);
			if (!child) {
				const failed = item.dependencies.find((id) =>
					["blocked", "cancelled"].includes(batch.progress[id]!.status),
				);
				if (failed) {
					state.status = "blocked";
					state.error = `Prerequisite ${failed} did not deliver; retry or resume that original child before dispatching this item`;
					continue;
				}
				if (
					!item.dependencies.every((id) => {
						const prerequisite = batch.accepted.items.find(
							(entry) => entry.id === id,
						)!;
						const original = runtime.runs.get(prerequisite.runId);
						return (
							original?.status === "completed" &&
							launchRepositoryCompletionProven(original)
						);
					})
				) {
					const incomplete = item.dependencies.find(
						(id) => batch.progress[id]!.status === "completed",
					);
					state.status = incomplete ? "blocked" : "queued";
					if (incomplete)
						state.error = `Prerequisite ${incomplete} completed without exact human-approved, provider-confirmed repository merge proof`;
					else delete state.error;
					continue;
				}
				// This deterministic local identity cannot have launched without a durable
				// child below. Absence after restart safely recreates the original intent.
				state.creation = "creating";
				state.status = "uncertain";
				await host.save();
				if (paused() || batch.cancelled) break;
				const repositories = structuredClone(item.repositories);
				const repositoryId = repositories.some(
					(repo) => repo.id === run.repositoryId,
				)
					? run.repositoryId
					: repositories[0]!.id;
				const prompt = item.plan
					? `${item.prompt}\n\n## Plan\n${item.plan}`
					: item.prompt;
				try {
					host.assertSchedulingOpen?.();
					child = runtime.create(
						{
							id: item.runId,
							repositoryId,
							repositories,
							workflow: batch.accepted.workflow,
							workflowDefinitions: batch.accepted.definitions,
							workspace: "",
							input: prompt,
							launchInputs: {
								prompt: item.prompt,
								...(item.plan === undefined ? {} : { plan: item.plan }),
							},
							...structuredClone(batch.accepted.execution),
							executionSnapshot: structuredClone(
								batch.accepted.execution.executionSnapshot,
							),
							triggerOrigin: {
								type: "manual",
								workflowId: batch.accepted.workflow.id,
								at: batch.accepted.at,
								manual: { method: "follow-up", sourceRunId: run.id },
							},
							recipeParent: {
								runId: run.id,
								actionId: batch.accepted.actionId,
								itemId: item.id,
								workflowId: batch.accepted.workflowId,
								ancestors: batch.accepted.ancestors,
							},
							setupComplete: false,
							launchRequest: {
								repositoryId,
								repositoryIds: repositories.map((repo) => repo.id),
								workflow: batch.accepted.workflow.id,
								source: undefined,
								prompt,
								inputs: {
									prompt: item.prompt,
									...(item.plan === undefined ? {} : { plan: item.plan }),
								},
								attachments: {},
							},
						},
						{
							workflow: batch.accepted.workflow,
							workflowDefinitions: batch.accepted.definitions,
							trigger: "workflow",
						},
					);
					child.title = item.title;
					delete child.titleGeneration;
					await runtime.save(child);
					await runtime.flush(child.id);
					state.creation = "confirmed";
					state.status = "launched";
					delete state.error;
					await host.save();
				} catch (error) {
					state.creation = "uncertain";
					state.status = "uncertain";
					state.error = error instanceof Error ? error.message : String(error);
					await host.save();
					continue;
				}
			}
			if (paused() || batch.cancelled) break;
			if (
				child &&
				state.creation === "confirmed" &&
				["running", "interrupted"].includes(child.status) &&
				!runtime.isExecuting(child.id)
			) {
				try {
					host.assertSchedulingOpen?.();
					if (!state.launchCommitted) {
						state.launchCommitted = true;
						try {
							await host.save();
						} catch (error) {
							delete state.launchCommitted;
							throw error;
						}
					}
					if (paused() || batch.cancelled) break;
					host.assertSchedulingOpen?.();
					void runtime.launch(child).catch(() => {});
				} catch (error) {
					state.status = "uncertain";
					state.error = error instanceof Error ? error.message : String(error);
				}
			}
		}
		await host.save();
	});
}

/** Persist stop intent first; already-created and uncertain original children reconcile too. */
export async function stopLaunchRuns(
	run: FactoryRun,
	batch: LaunchRunBatch,
	host: LaunchRunsHost,
): Promise<void> {
	batch.cancelled = true;
	batch.paused = true;
	await host.save();
	await tickLaunchRuns(run, batch, host);
	await host.runtime.flush();
}

export function launchBatchSettled(batch: LaunchRunBatch): boolean {
	return batch.accepted.items.every((item) =>
		["merged", "completed", "blocked", "cancelled"].includes(
			batch.progress[item.id]!.status,
		),
	);
}
/** Public projection deliberately excludes inputs, paths, execution bindings and graphs. */
export function launchBatchProjection(batch: LaunchRunBatch) {
	return {
		key: batch.accepted.key,
		actionId: batch.accepted.actionId,
		workflowId: batch.accepted.workflowId,
		targetWorkflowId: batch.accepted.workflow.id,
		wait: batch.accepted.wait,
		paused: batch.paused === true,
		cancelled: batch.cancelled === true,
		items: batch.accepted.items.map((item) => ({
			id: item.id,
			index: item.index,
			title: item.title,
			runId: item.runId,
			url: `/runs/${encodeURIComponent(item.runId)}`,
			wave: item.wave,
			dependencies: [...item.dependencies],
			...batch.progress[item.id]!,
		})),
	};
}
/** Returned data is a new receipt, never a reference to mutable operational progress. */
export function launchOutput(batch: LaunchRunBatch) {
	return {
		children: Object.fromEntries(
			batch.accepted.items.map((item) => [
				item.id,
				{
					runId: item.runId,
					url: `/runs/${encodeURIComponent(item.runId)}`,
					wave: item.wave,
					dependencies: [...item.dependencies],
					...(batch.accepted.wait
						? {
								status: batch.progress[item.id]!.status,
								...(batch.progress[item.id]!.error
									? { error: batch.progress[item.id]!.error }
									: {}),
							}
						: {}),
				},
			]),
		),
		wait: batch.accepted.wait,
	};
}
