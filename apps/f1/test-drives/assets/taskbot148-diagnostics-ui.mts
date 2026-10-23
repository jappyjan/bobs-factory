// Synthetic UI fixture only: production runtime/API/web shell; mocked roles and controlled clock.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import { acquireDelivery } from "../../../../packages/edge-worker/src/factory/DeliveryCoordination.ts";
import { FactoryServer } from "../../../../packages/edge-worker/src/factory/FactoryServer.ts";
if (process.env.F1_AGENT_MODE !== "mock") throw new Error("Use F1_AGENT_MODE=mock for the synthetic UI fixture");
const home = mkdtempSync(join(tmpdir(), "task148-ui-"));
let wall = Date.now()-180000, mono = 0, visits = 0;
const workflow = WorkflowSchema.parse({ id: "diagnostic-ui", name: "Diagnostic fixture", steps: [
 { id: "inspect", name: "Scripted inspection", type: "agent", prompt: "Synthetic role", access: { mode: "read-only" }, branches: [{ when: { path: "repeat", equals: true }, next: "inspect" }], next: "check" },
 { id: "check", name: "Structured Check", type: "check", check: { results: { reached: { path: "/inputs", exists: true } } }, next: "qa" },
 { id: "qa", name: "Shared QA", type: "agent", prompt: "Synthetic QA", access: { mode: "read-only" }, resources: ["docker"], next: "end" },
] });
const runtime = new WorkflowRuntime(home, {
 agent: async context => { if(context.step.id !== "inspect") throw new Error("Shared resource must stay blocked"); visits++; for(let i=0;i<6;i++){wall+=5000;mono+=5000;await context.save?.();} return { repeat: visits < 2 }; },
 tool: async () => { throw new Error("No provider effects"); }, script: async () => { throw new Error("No scripts"); },
}, { wall:()=>wall,mono:()=>mono });
runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
const create = (title:string)=>runtime.create({title,repositoryId:"fixture",workflow,workspace:home,input:"Synthetic fixture; no live work or model calls",triggerOrigin:{type:"manual",workflowId:workflow.id,at:new Date(wall).toISOString()}});
const blocker = create("Synthetic Docker owner");
runtime.updateTitle(blocker.id, {...blocker.titleGeneration!,state:"completed"},"Synthetic Docker owner");
await acquireDelivery(blocker,()=>runtime.runs.values(),new AbortController().signal,()=>runtime.save(blocker),()=>{}, {key:"owner:resources",scopes:['["resource","docker"]']});
const run=create("Synthetic: ten-day run waiting for Docker");
run.createdAt=new Date(wall-10*86400000).toISOString();
runtime.updateTitle(run.id, {...run.titleGeneration!,state:"completed"},"Synthetic: ten-day run waiting for Docker");
void runtime.launch(run);
await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error("UI fixture timeout")),5000);const off=runtime.subscribe(()=>{if(Object.values(run.diagnostics?.active??{}).some(v=>v.kind==="qa-resource")){clearTimeout(timer);off();done();}});});
for(let i=0;i<24;i++){wall+=5000;mono+=5000;await runtime.save(run);}
const server=new FactoryServer(runtime,{repositories:()=>[{id:"fixture",name:"Synthetic fixture"}],sessions:()=>[],entries:()=>[],stop:id=>runtime.stop(id),start:async()=>{throw new Error("UI fixture cannot launch")}}, {origins:["http://127.0.0.1:38848","http://localhost:38848"]});
await server.start(38848);
const address=server.app.server.address() as {port:number};
writeFileSync(join(tmpdir(),"task148-ui.json"),JSON.stringify({home,port:address.port,runId:run.id,blockerId:blocker.id,url:`http://127.0.0.1:${address.port}/runs/${run.id}`,visits,diagnostics:runtime.readDiagnostics(run.id)},null,2));
console.log(JSON.stringify({port:address.port,runId:run.id,visits}));
async function close(){await runtime.shutdown();await server.stop();process.exit(0);}
process.on("SIGTERM",()=>void close());process.on("SIGINT",()=>void close());
