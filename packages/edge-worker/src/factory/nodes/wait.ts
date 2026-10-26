import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import {
	EffectReconciliationError,
	NonConvergenceError,
	WorkflowUnavailableError,
} from "../ExecutionErrors.js";
import {
	evaluateRulesAsync,
	RuleConditionSchema,
	RuleDataSchema,
} from "../Rules.js";
import { nodeContext } from "./context.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { nodeRegistry, registeredStepSchema } from "./registry.js";
import { stepFields } from "./schema.js";

export const schema = z.object({
	...stepFields,
	type: z.literal("wait"),
	// Normalize the single-step shorthand to the existing traversable body shape.
	body: z
		.preprocess(
			(value) => (Array.isArray(value) ? value : [value]),
			z.array(registeredStepSchema).length(1),
		)
		.superRefine((steps, ctx) => {
			if (steps.length !== 1) return;
			const body = steps[0]!;
			const node = nodeRegistry.get(body.type);
			if (
				node.category !== "io" ||
				!["read-only", "pure"].includes(nodeRegistry.effectFor(body)) ||
				node.inline
			)
				ctx.addIssue({
					code: "custom",
					message: "Wait body must be a registered read-only IO node",
				});
			if (body.next || body.branches.length || body.onError || body.retry)
				ctx.addIssue({
					code: "custom",
					message:
						"Wait body is one operation; put routes and retry/onError on Wait",
				});
		}),
	interval: z.number().int().min(1).max(86_400_000),
	maxErrors: z.number().int().min(1).max(10000).optional(),
	timeout: z.number().int().min(1).max(604_800_000),
	until: RuleDataSchema.pipe(RuleConditionSchema),
	checks: z.never().optional(),
	revision: z.never().optional(),
});

export const definition = {
	type: "wait",
	schema,
	category: "flow",
	effect: "flow",
	builder: {
		label: "Wait",
		icon: "◷",
		paletteGroup: "flow",
		settings: "wait",
		hint: "Poll one read-only IO node without reserving machine capacity",
		defaults: {
			interval: 10000,
			timeout: 600000,
			until: { path: "/output/ready", equals: true },
		},
	},
	async execute(ctx) {
		const active = ctx.frame.active;
		if (!active) throw new Error("Wait requires an active node visit");
		if (!active.wait) {
			active.wait = {
				deadline: Date.now() + ctx.step.timeout,
				nextPollAt: Date.now(),
				polls: 0,
			};
			await ctx.checkpoint();
			ctx.log("Waiting for the configured condition");
		}
		const state = active.wait;
		const body = ctx.step.body[0]!;
		// Recheck capabilities at execution, including frozen/restored definitions.
		const node = nodeRegistry.get(body.type);
		if (
			node.category !== "io" ||
			!["read-only", "pure"].includes(nodeRegistry.effectFor(body)) ||
			node.inline
		)
			throw new Error("Wait body must be a registered read-only IO node");
		return ctx.phase("waiting-ci", async () => {
			while (!state.matched && Date.now() < state.deadline) {
				ctx.signal.throwIfAborted();
				const delay = Math.min(state.nextPollAt, state.deadline) - Date.now();
				if (delay > 0) await sleep(delay, undefined, { signal: ctx.signal });
				if (Date.now() >= state.deadline) break;
				state.polls++;
				await ctx.checkpoint();
				const deadline = AbortSignal.timeout(
					Math.max(1, state.deadline - Date.now()),
				);
				const signal = AbortSignal.any([ctx.signal, deadline]);
				const bodyContext = await nodeContext(
					{
						...ctx,
						step: body,
						stepKey: `${ctx.stepKey ?? ctx.step.id}/${body.id}`,
						signal,
						log: () => {},
					},
					ctx.frame,
					ctx.workflowId,
					ctx.parallel,
					ctx.engine,
					ctx.graphChat,
				);
				let polled = false;
				try {
					// No graph dispatch: polls never append output/history receipts.
					state.output = await new Promise<unknown>((resolve, reject) => {
						const cancel = () => reject(signal.reason);
						signal.addEventListener("abort", cancel, { once: true });
						Promise.resolve()
							.then(() => {
								signal.throwIfAborted();
								return nodeRegistry.execute(bodyContext);
							})
							.then(resolve, reject)
							.finally(() => signal.removeEventListener("abort", cancel));
						if (signal.aborted) cancel();
					});
					polled = true;
				} catch (error) {
					ctx.signal.throwIfAborted();
					if (
						error instanceof NonConvergenceError ||
						error instanceof WorkflowUnavailableError ||
						error instanceof EffectReconciliationError
					)
						throw error;
					if (!deadline.aborted) {
						state.errors = (state.errors ?? 0) + 1;
						ctx.log(
							`Poll ${state.polls} failed: ${error instanceof Error ? error.message : String(error)}`,
						);
						await ctx.checkpoint();
						if (
							ctx.step.maxErrors !== undefined &&
							state.errors >= ctx.step.maxErrors
						)
							throw error;
					}
				}
				if (polled) {
					try {
						ctx.signal.throwIfAborted();
						const issues = await evaluateRulesAsync(
							[{ message: "waiting", require: ctx.step.until }],
							{ inputs: ctx.reads, output: state.output, polls: state.polls },
							undefined,
							signal,
						);
						state.matched = issues.length === 0 && Date.now() < state.deadline;
					} catch (error) {
						ctx.signal.throwIfAborted();
						if (!deadline.aborted) throw error;
					}
				}
				state.nextPollAt = Date.now() + ctx.step.interval;
				await ctx.checkpoint();
			}
			// An object body keeps its fields; scalars/arrays are retained under output.
			const last =
				state.output &&
				typeof state.output === "object" &&
				!Array.isArray(state.output)
					? state.output
					: { output: state.output ?? null };
			return { ...last, timedOut: !state.matched, polls: state.polls };
		});
	},
	summary: (output) =>
		(output as { timedOut: boolean }).timedOut
			? "Wait timed out"
			: "Wait condition passed",
} satisfies NodeDefinition<typeof schema>;
