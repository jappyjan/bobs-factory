import { immutableJson } from "bobs-factory-core";
import { isUpdatePaused } from "../../../updates/UpdatePausedError.js";
import { digest } from "../../EvidenceDigest.js";
import { aggregateForeach, prepareForeach } from "../../Foreach.js";
import { acceptedProgressValue } from "../../ProgressBudget.js";
import { stepBindings } from "../../StepBindings.js";
import { isNodeEngineStep, registerWorkflowConfig } from "../../StepConfig.js";
import { assertForeachBody } from "../../Workflow.js";
import { snapshotWorkflowInput } from "../../WorkflowInput.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const context = ctx;
	const { engine, frame: checkpoint, workflowId, graphChat: chat } = ctx;

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
		const acceptedItems =
			step.items && "values" in step.items
				? step.items.values
				: step.items && "from" in step.items
					? acceptedProgressValue(
							context,
							step.items.from,
							snapshot.items.map((item) => item.value),
						)
					: undefined;
		active.children = snapshot.items.map((item) => ({
			...engine.newCheckpoint(step.body!),
			projectResults: true,
			resultReceipts: {},
			progressPath: `${context.progressOperation}/item`,
			iteration: { ...item, frame: key },
			callInputs: checkpoint.callInputs,
			progressInputs: checkpoint.progressInputs,
			transcriptEntries: engine.hooks.transcriptEntries
				? () => engine.hooks.transcriptEntries!(run.id)
				: undefined,
			progressItem:
				Array.isArray(acceptedItems) &&
				digest(acceptedItems[item.index]) === digest(item.value)
					? digest(item.value)
					: undefined,
			snapshotInputs: checkpoint.snapshotInputs,
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
			engineVersion: isNodeEngineStep(step) ? "nodes-v1" : undefined,
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
		active.children[index]!.snapshotInputs ??= checkpoint.snapshotInputs;
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
			const produced = engine.frameResults(
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
	await engine.save(run); // Full snapshot and every child identity precede dispatch.
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
			await engine.save(run);
			try {
				controller.signal.throwIfAborted();
				await engine.graph(
					run,
					loop.body,
					child.outputs,
					controller.signal,
					`${key}/${item.id}/`,
					child,
					workflowId,
					chat,
					true,
				);
				controller.signal.throwIfAborted();
				state.result = engine.frameResults(
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
					state.error = error instanceof Error ? error.message : String(error);
					if (loop.snapshot.failure === "all-must-succeed") {
						fatal = true;
						controller.abort(error);
					}
				}
			} finally {
				progress();
				await engine.save(run);
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
		await engine.save(run);
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
