import { z } from "zod";
import { nodeRegistry, stepFields } from "../../src/factory/nodes/index.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../../src/factory/WorkflowRuntime.js";

nodeRegistry.register({
	type: "fixture-resource",
	schema: z.object({ ...stepFields, type: z.literal("fixture-resource") }),
	category: "io",
	effect: "read-only",
	builder: { label: "Fixture resource", icon: "◇", paletteGroup: "io" },
	inline: true,
	execute: () => {
		throw new Error(
			"Inline fixture dispatches through the controlled agent boundary",
		);
	},
});
/** Controlled IO retains real resource admission, cleanup and restart behavior. */
export function resourceRuntime(
	home: string,
	hooks: RuntimeHooks & {
		tool?: RuntimeHooks["agent"];
		script?: RuntimeHooks["agent"];
	},
) {
	const { tool, script: _script, agent, ...rest } = hooks;
	const dispatch = (context: Parameters<RuntimeHooks["agent"]>[0]) =>
		(context.step.type === "fixture-resource" ||
			context.step.prompt === "Fixture resource") &&
		tool
			? tool(context)
			: agent(context);
	const runtime = new WorkflowRuntime(home, {
		...rest,
		agentExecutionBoundary: true,
		agent: async (context) => {
			if (rest.agentExecutionBoundary || context.step.type !== "agent")
				return dispatch(context);
			const lease = await rest.capacity?.acquireLease(
				context.signal,
				context.capacity,
			);
			let release: (() => Promise<void>) | undefined;
			try {
				release = await context.reserveExecution?.();
				return lease
					? await lease.run(() => dispatch(context))
					: await dispatch(context);
			} finally {
				await release?.();
				await lease?.release();
			}
		},
	});

	return runtime;
}
