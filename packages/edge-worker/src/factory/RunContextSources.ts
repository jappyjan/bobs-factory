import { legacyToolOutput } from "./StepConfig.js";
import { outputForTool } from "./ToolBindings.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

/** Verified host/provider context cannot be replaced by an ordinary output named source. */
export function takeoverSource(run: FactoryRun): unknown {
	if (Object.hasOwn(run, "takeoverSource"))
		return run.takeoverSource ?? legacyToolOutput(run, "takeover");
	const inspected = outputForTool(run, "inspect-existing") as
		| { pr?: unknown }
		| undefined;
	return inspected?.pr ?? legacyToolOutput(run, "takeover");
}

/** The originating ticket is host context; a data-producing step cannot replace it. */
export function ticketSnapshot(run: FactoryRun): unknown {
	return run.ticketSnapshot ?? legacyToolOutput(run, "ticket-context");
}
