import { randomUUID } from "node:crypto";
import { immutableJson } from "bobs-factory-core";
import { digest } from "../Delivery.js";
import { EffectReconciliationError } from "../ExecutionErrors.js";
import {
	freshNodeOutput,
	type NodeRevisions,
	nodeRevisionObserver,
	prepareNodeGuarantee,
} from "../NodeGuarantees.js";
import { timingOperation } from "../RunDiagnostics.js";
import { stepBindings } from "../StepBindings.js";
import type { ExecutionContext, GraphCheckpoint } from "../WorkflowRuntime.js";
import type { NodeContext, NodeEngine } from "./NodeDefinition.js";

export async function nodeContext(
	context: ExecutionContext,
	frame: GraphCheckpoint,
	workflowId: string,
	parallel: boolean,
	engine: NodeEngine,
	graphChat = false,
	consumedReads?: Record<string, unknown>,
): Promise<NodeContext> {
	const reads =
		consumedReads ??
		stepBindings(context, context.run.history, { checkJson: true });
	const inputDigest = digest(reads);
	const active = frame.active;
	if (!active) throw new Error("Node context requires an active visit");
	const observe = nodeRevisionObserver(context);
	const guarantee = active.nodeStamp
		? structuredClone(active.nodeStamp.guarantee)
		: await prepareNodeGuarantee(context, observe);
	if (!active.nodeStamp) {
		active.nodeStamp = { inputDigest, guarantee: structuredClone(guarantee) };
		await engine.save(context.run);
	}
	const checkpoint = () => engine.save(context.run);
	let identityCheckpoint: Promise<void> | undefined;
	let phaseActive = false;
	const effectKey = async (name: string) => {
		if (!name) throw new Error("Effect name is required");
		const active = frame.active;
		if (!active) throw new Error("Effect requires an active node visit");
		if (!active.actionId) {
			active.actionId = randomUUID();
			identityCheckpoint = checkpoint();
		}
		// Concurrent callers must also wait for the first identity commit.
		await identityCheckpoint;
		return digest([context.run.id, active.actionId, name]);
	};
	const services = Object.assign(context, {
		reads,
		inputDigest,
		guarantee,
		fresh: (reference: string) => freshNodeOutput(context, reference, observe),
		recordRevisions: (revisions: NodeRevisions) => {
			if (context.step.revisionScope === "none") return;
			if (typeof context.step.revisionScope === "object") {
				// A provider HEAD alone cannot replace this node's scoped observation.
				revisions = Object.fromEntries(
					Object.entries(revisions).filter(
						([, value]) =>
							value.scopedDigest !== undefined || value.unobservable,
					),
				);
			}
			Object.assign(services.guarantee.revisions, structuredClone(revisions));
			services.guarantee.observedRepositories = [
				...new Set([
					...(services.guarantee.observedRepositories ?? []),
					...Object.keys(revisions),
				]),
			];
		},
		stamp: <T>(output: T) => ({
			output,
			inputDigest: frame.active?.nodeStamp?.inputDigest ?? inputDigest,
			guarantee: { ...services.guarantee, outputDigest: digest(output) },
		}),
		checkpoint,
		effectKey,
		engine,
		frame,
		workflowId,
		parallel,
		graphChat,
		async phase<T>(
			kind: "waiting-ci" | "waiting-human",
			fn: () => Promise<T>,
		): Promise<T> {
			const { run, stepKey: key = context.step.id } = context;
			const leaf = run.capacityLeaves?.[key];
			if (
				phaseActive ||
				leaf?.request ||
				(leaf && !["waiting-ci", "waiting-human"].includes(leaf.phase))
			)
				throw new Error(
					"Wait phases must run outside execution capacity or another phase",
				);
			context.signal.throwIfAborted();
			phaseActive = true;
			run.capacityLeaves ??= {};
			run.capacityLeaves[key] = { phase: kind };
			timingOperation(run, key, {
				kind: kind === "waiting-ci" ? "provider-ci" : "human",
			});
			try {
				await checkpoint();
				context.signal.throwIfAborted();
				return await fn();
			} finally {
				phaseActive = false;
				delete run.capacityLeaves[key];
				timingOperation(run, key);
				await checkpoint();
			}
		},
		async effect<T>(
			name: string,
			input: unknown,
			send: (key: string) => Promise<T>,
			reconcile?: (key: string) => Promise<T | null | undefined>,
		): Promise<T> {
			const key = await effectKey(name);
			try {
				context.run.nodeEffects ??= {};
				const records = context.run.nodeEffects;
				let record = records[key];
				const acceptedDigest = digest(input);
				if (record && record.inputDigest !== acceptedDigest)
					throw new Error(
						`Effect ${name} inputs changed; reconcile the accepted intent first`,
					);
				if (record?.phase === "confirmed") return record.receipt as T;
				if (record && record.phase !== "not-sent") {
					record.phase = "uncertain";
					await checkpoint();
					context.signal.throwIfAborted();
					const receipt = await reconcile?.(key);
					if (receipt === undefined)
						throw new Error(
							`Effect ${name} is uncertain and requires reconciliation (${key})`,
						);
					if (receipt !== null) {
						record.receipt = immutableJson(receipt);
						record.phase = "confirmed";
						delete record.error;
						await checkpoint();
						return receipt;
					}
					// Provider proved absence; reuse the same provider idempotency key.
				}
				context.signal.throwIfAborted();
				record = records[key] = {
					key,
					inputDigest: acceptedDigest,
					phase: "sending",
				};
				let invoked = false;
				try {
					await checkpoint();
					context.signal.throwIfAborted();
					invoked = true;
					const receipt = await send(key);
					record.receipt = immutableJson(receipt);
					record.phase = "confirmed";
					await checkpoint();
					return receipt;
				} catch (error) {
					// If persistence failed after confirmation, retain the receipt in memory;
					// an older disk snapshot still re-enters through reconciliation.
					if (record.phase !== "confirmed")
						record.phase = invoked ? "uncertain" : "not-sent";
					record.error = error instanceof Error ? error.message : String(error);
					await checkpoint();
					throw error;
				}
			} catch (error) {
				const record = context.run.nodeEffects?.[key];
				if (record && ["sending", "uncertain"].includes(record.phase))
					throw new EffectReconciliationError(
						error instanceof Error ? error.message : String(error),
						{ cause: error },
					);
				throw error;
			}
		},
	});
	return services;
}
