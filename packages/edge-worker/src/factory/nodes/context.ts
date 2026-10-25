import { randomUUID } from "node:crypto";
import { immutableJson } from "bobs-factory-core";
import { digest } from "../Delivery.js";
import { stepBindings } from "../StepBindings.js";
import type { ExecutionContext, GraphCheckpoint } from "../WorkflowRuntime.js";
import type { NodeContext, NodeEngine } from "./NodeDefinition.js";

export function nodeContext(
	context: ExecutionContext,
	frame: GraphCheckpoint,
	workflowId: string,
	parallel: boolean,
	engine: NodeEngine,
): NodeContext {
	const reads = stepBindings(context, context.run.history, { checkJson: true });
	const inputDigest = digest(reads);
	const checkpoint = () => engine.save(context.run);
	let identityCheckpoint: Promise<void> | undefined;
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
	return Object.assign(context, {
		reads,
		inputDigest,
		stamp: <T>(output: T) => ({ output, inputDigest }),
		checkpoint,
		effectKey,
		engine,
		frame,
		workflowId,
		parallel,
		async effect<T>(
			name: string,
			input: unknown,
			send: (key: string) => Promise<T>,
			reconcile?: (key: string) => Promise<T | undefined>,
		): Promise<T> {
			const key = await effectKey(name);
			context.run.nodeEffects ??= {};
			const records = context.run.nodeEffects;
			let record = records[key];
			const acceptedDigest = digest(input);
			if (record && record.inputDigest !== acceptedDigest)
				throw new Error(
					`Effect ${name} inputs changed; reconcile the accepted intent first`,
				);
			if (record?.phase === "confirmed") return record.receipt as T;
			if (record) {
				record.phase = "uncertain";
				await checkpoint();
				context.signal.throwIfAborted();
				const receipt = await reconcile?.(key);
				if (receipt === undefined)
					throw new Error(
						`Effect ${name} is uncertain and requires reconciliation (${key})`,
					);
				record.receipt = immutableJson(receipt);
				record.phase = "confirmed";
				delete record.error;
				await checkpoint();
				return receipt;
			}
			context.signal.throwIfAborted();
			record = records[key] = {
				key,
				inputDigest: acceptedDigest,
				phase: "sending",
			};
			await checkpoint();
			try {
				context.signal.throwIfAborted();
				const receipt = await send(key);
				record.receipt = immutableJson(receipt);
				record.phase = "confirmed";
				await checkpoint();
				return receipt;
			} catch (error) {
				// If persistence failed after confirmation, retain the receipt in memory;
				// an older disk snapshot still re-enters through reconciliation.
				if (record.phase !== "confirmed") record.phase = "uncertain";
				record.error = error instanceof Error ? error.message : String(error);
				await checkpoint();
				throw error;
			}
		},
	});
}
