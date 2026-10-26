import type { FactoryRun } from "./WorkflowRuntime.js";
export function takeoverSource(run: FactoryRun): unknown {
	return run.takeoverSource;
}
export function ticketSnapshot(run: FactoryRun): unknown {
	return run.ticketSnapshot;
}
