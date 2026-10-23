// Run from the selected checkout packages/core with its source-path tsconfig.
const [checkout, outputDirectory] = process.argv.slice(2);
if (!checkout || !outputDirectory) throw new Error("Expected absolute checkout and output directory");
import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
const { JsonSnapshotStore,immutableJson,immutableTranscript } = await import(`${checkout}/packages/core/dist/index.js`);
const { prepareFactoryContextAsync } = await import(`${checkout}/packages/mcp-tools/src/factoryContext.ts`);
const { FactoryContextSnapshot } = await import(`${checkout}/packages/mcp-tools/src/factoryContextSnapshot.ts`);
const { snapshotHistory } = await import(`${checkout}/packages/edge-worker/src/factory/WorkflowInput.ts`);
const rows=[];
const home=mkdtempSync(join(process.env.TMPDIR!,"restored-cache-"));
try{
 for(const count of [12,48]){
  const history=Array.from({length:count},(_,i)=>immutableJson({step:`outer/call/parallel/${i}/review`,at:`t-${i}`,output:{notes:`r${i}:`+"original evidence ".repeat(1000),findings:[{id:`F${i}`,status:"open",evidence:"original"}]}}));
  const store=new JsonSnapshotStore(join(home,`chunks-${count}`));
  const path=join(home,`saved-${count}.json`);
  await store.write(path,{id:"synthetic-cache",history},{},[],[],{history:1});
  const saved=store.load<{id:string;history:typeof history}>(path).value;
  immutableTranscript(saved.history);
  for(const [kind,entries] of [["fresh",history],["restored",saved.history]] as const){
   const cacheDirectory=join(home,`cache-${count}-${kind}`);
   const modes=[];
   for(const phase of ["cold","warm"]){
    const stringify=JSON.stringify, node=FactoryContextSnapshot.prototype.node;
    let stringifyCalls=0,serializedStringCharacters=0,nodeCalls=0;
    JSON.stringify=function(value,...args){stringifyCalls++;if(typeof value==="string")serializedStringCharacters+=value.length;return stringify(value,...args as any)} as typeof JSON.stringify;
    FactoryContextSnapshot.prototype.node=function(...args){nodeCalls++;return node.apply(this,args)};
    const start=performance.now();
    let prepared;
    try{prepared=await prepareFactoryContextAsync({history:snapshotHistory(entries),plan:{answer:"small current input"}},undefined,undefined,{cacheDirectory});}
    finally{JSON.stringify=stringify;FactoryContextSnapshot.prototype.node=node;}
    modes.push({phase,ms:performance.now()-start,stringifyCalls,serializedStringCharacters,nodeCalls});
    prepared!.cleanup();
   }
   rows.push({count,kind,historyBytes:Buffer.byteLength(JSON.stringify(history)),modes});
  }
 }
 writeFileSync(`${outputDirectory}/restored-cache-result.json`,JSON.stringify(rows,null,2)+"\n");
 console.log(JSON.stringify(rows,null,2));
}finally{rmSync(home,{recursive:true,force:true});}

