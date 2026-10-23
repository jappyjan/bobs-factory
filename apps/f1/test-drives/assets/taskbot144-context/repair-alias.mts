// Run from the selected checkout packages/core with its source-path tsconfig.
const [checkout, outputDirectory] = process.argv.slice(2);
if (!checkout || !outputDirectory) throw new Error("Expected absolute checkout and output directory");
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const { immutableJson } = await import(`${checkout}/packages/core/dist/index.js`);
const { stepBindings } = await import(`${checkout}/packages/edge-worker/src/factory/StepBindings.ts`);
const { captureReviewContext, originalReviewContext } = await import(`${checkout}/packages/edge-worker/src/factory/SpecialistReview.ts`);
const { historySnapshotRange, snapshotHistory } = await import(`${checkout}/packages/edge-worker/src/factory/WorkflowInput.ts`);
const { StepSchema } = await import(`${checkout}/packages/edge-worker/src/factory/Workflow.ts`);
const result=[];
for(const count of [12,48]){
 const history=Array.from({length:count},(_,i)=>immutableJson({step:`outer/renamed/review-${i}`,at:`t-${i}`,output:{findings:[{id:`F${i}`,evidence:`original-${i}:`+"source evidence ".repeat(1000)}]}}));
 const index=history.map(({step,at})=>({step,at}));
 const run={id:"independent-custom-alias",history,outputs:{},answers:[],workspace:"/tmp/unused",repositoryId:"synthetic"};
 const step=StepSchema.parse({id:"renamed-custom-review",name:"Custom review",type:"fanout",groups:[[{id:"perspective",name:"Perspective",type:"agent",prompt:"Read current evidence"}]],reads:{priorProof:"@history"}});
 const context={run,step,stepKey:"outer/renamed-custom-review",outputs:{},input:{}};
 const before=performance.now();
 const bindings=stepBindings(context as any);
 const bindingMs=performance.now()-before;
 const raw=snapshotHistory(history);
 const builtin=captureReviewContext({history:raw},run,index);
 const alias=captureReviewContext({history:raw,...bindings},run,index);
 const original=originalReviewContext(alias,run,index) as any;
 if((bindings.priorProof as any)[0].output.findings[0].evidence!==history[0].output.findings[0].evidence)throw new Error("Read changed");
 (bindings.priorProof as any)[0].output.findings[0].evidence="detached mutation";
 if(history[0].output.findings[0].evidence==="detached mutation")throw new Error("Read not detached");
 result.push({count,bindingMs,historyBytes:Buffer.byteLength(JSON.stringify(history)),builtinBaselineBytes:Buffer.byteLength(JSON.stringify(builtin)),customAliasBaselineBytes:Buffer.byteLength(JSON.stringify(alias)),builtinPaths:builtin.contextReferences.map(r=>r.path),customAliasPaths:alias.contextReferences.map(r=>r.path),builtInRangeKnown:!!historySnapshotRange(raw),aliasRangeKnown:!!historySnapshotRange(bindings.priorProof as object),detachedMutationPreserved:true,hydratedAliasLength:original.priorProof.length});
}
writeFileSync(`${outputDirectory}/custom-alias-result.json`,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));

