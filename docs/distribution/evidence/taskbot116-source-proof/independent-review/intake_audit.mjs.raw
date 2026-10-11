import {inspectArchive,ARCHIVE_LIMITS} from '/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs/pinned-intake-check/bounded-archive.mjs';
import {writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const copied=readFileSync('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs/pinned-intake-check/bounded-archive.mjs');
const pinned=execFileSync('git',['show','97acf7ba6e00c81a480cd2f8d01c519ea2cf5f05:scripts/lib/bounded-archive.mjs'],{cwd:'/Users/jappy/code/jappy/bobs-factory'});if(!copied.equals(pinned))throw new Error('pinned source mismatch');
const start=Date.now();const result=inspectArchive('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs/WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057.tar.gz',{prefix:'WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057/'});
const out={result:'PASS',pinnedSourceByteEqual:true,limits:ARCHIVE_LIMITS,entries:result.entries.length,expandedBytes:result.expandedBytes,elapsedMs:Date.now()-start};writeFileSync(new URL('intake.result.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
