import type { Workflow } from "../../src/factory/Workflow.js";
import data from "./legacy-workflows-a4990127.json" with { type: "json" };
/** Frozen historical JSON remains readable without importing removed executors. */
export const preCompositionWorkflows = data.default as unknown as Workflow[];
