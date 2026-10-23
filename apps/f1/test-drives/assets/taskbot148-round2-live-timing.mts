// Local synthetic runtime/API/Working-row proof; no model/provider/tracker effects.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import { acquireDelivery } from "../../../../packages/edge-worker/src/factory/DeliveryCoordination.ts";
import { FactoryServer } from "../../../../packages/edge-worker/src/factory/FactoryServer.ts";
if (process.env.F1_AGENT_MODE !== "mock") throw new Error("Mock mode required");
const output = process.env.F1_UI_RESULT;
if (!output || relative(resolve(tmpdir()), resolve(output)).startsWith("..")) throw new Error("Result must stay in own private TMPDIR");
const home = mkdtempSync(join(tmpdir(), "task148-round2-ui-"));
const workflow = WorkflowSchema.parse({ id: "live-timing", name: "Timing heartbeat fixture", steps: [{ id: "qa", name: "QA resource", type: "agent", prompt: "Mock only", access: { mode: "read-only" }, resources: ["docker"], next: "end" }] });
const runtime = new WorkflowRuntime(home, { agentExecutionBoundary: true, agent: async context => {
 context.capacity!.onChange!({ phase: "executing", parked: false, identity: "mock" } as any);
 const release = await context.reserveExecution!();
 try { throw new Error("Synthetic resource owner must keep role blocked"); } finally { await release(); context.capacity!.onChange!(undefined); }
}, script: async () => { throw new Error("No script"); }, tool: async () => { throw new Error("No provider"); } });
runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
const create = (title: string) => runtime.create({ title, repositoryId: "fixture", workflow, workspace: home, input: "Synthetic heartbeat fixture", triggerOrigin: { type: "manual", workflowId: workflow.id, at: new Date().toISOString() } });
const owner = create("Synthetic Docker owner");
await acquireDelivery(owner, () => runtime.runs.values(), new AbortController().signal, () => runtime.save(owner), () => {}, { key: "owner:resources", scopes: ['["resource","docker"]'] });
const run = create("Synthetic unchanged Docker wait — live timing");
runtime.updateTitle(owner.id, { ...owner.titleGeneration!, state: "completed" }, "Synthetic Docker owner");
runtime.updateTitle(run.id, { ...run.titleGeneration!, state: "completed" }, "Synthetic unchanged Docker wait — live timing");
void runtime.launch(run);
await new Promise<void>((done, reject) => { const timeout = setTimeout(() => { off(); reject(new Error("Resource wait setup timeout")); }, 5000); const off = runtime.subscribe(() => { if (run.diagnostics?.active.qa?.kind === "qa-resource") { clearTimeout(timeout); off(); done(); } }); });
await runtime.flush();
let changes = 0;
const observations: unknown[] = [];
const offChange = runtime.subscribe(change => { if (change.id === run.id) changes++; });
const offTiming = runtime.subscribeDiagnostics(update => { if (update.id === run.id) { observations.push({ at: Date.now(), changes, diagnostics: update.diagnostics }); if (observations.length > 64) observations.shift(); } });
const server = new FactoryServer(runtime, { repositories: () => [{ id: "fixture", name: "Synthetic fixture" }], sessions: () => [], entries: () => [], stop: id => runtime.stop(id), start: async () => { throw new Error("No launch"); } }, { origins: ["http://127.0.0.1:38948", "http://localhost:38948"] });
await server.start(38948);
const receipt = () => ({ pid: process.pid, mode: "mock", home, port: 38948, runId: run.id, blockerId: owner.id, changes, observations, diagnostics: runtime.readDiagnostics(run.id), providerCalls: 0, modelCalls: 0 });
const persist = () => writeFileSync(output, JSON.stringify(receipt(), null, 2));
persist(); console.log(JSON.stringify({ pid: process.pid, url: "http://localhost:38948", runId: run.id }));
let closing = false;
async function close() { if (closing) return; closing = true; offChange(); offTiming(); persist(); await runtime.shutdown(); await server.stop(); rmSync(home, { recursive: true, force: true }); process.exit(0); }
process.on("SIGTERM", () => void close()); process.on("SIGINT", () => void close());
