import os,subprocess,json,hashlib,time
from pathlib import Path
r=Path(__file__).parent;repo=r/'webkit-complete.git';sha='2e2aa2290fac856d6f451ceacb58f7f5b44dd057';env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_TERMINAL_PROMPT='0')
def git(*a,input=None):return subprocess.check_output(['git','-c','protocol.allow=never','-C',str(repo),*a],input=input,env=env)
tree=git('rev-parse',sha+'^{tree}').decode().strip();assert tree=='01e7ea36e5a23bf0206724ed83c594a2eaec95ed'
b=git('ls-tree','-r','-z',sha);(r/'WEBKIT_EXACT_TREE.nul').write_bytes(b);entries=[];dirs=set()
for e in b.rstrip(b'\0').split(b'\0'):
 meta,path=e.split(b'\t',1);mode,typ,oid=meta.split();entries.append((mode.decode(),typ.decode(),oid.decode(),path.decode('utf8','surrogateescape')))
 for i in range(1,len(path.split(b'/'))):dirs.add(b'/'.join(path.split(b'/')[:i]))
ids=sorted(set(x[2] for x in entries));batch=git('cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)',input=('\n'.join(ids)+'\n').encode());(r/'WEBKIT_LOCAL_OBJECT_SIZES.txt').write_bytes(batch);sizes={}
for line in batch.decode().splitlines():
 oid,typ,size=line.split();assert typ=='blob',(oid,typ);sizes[oid]=int(size)
from collections import Counter
modes=dict(Counter(x[0] for x in entries));bytesTotal=sum(sizes[x[2]] for x in entries)
with (r/'WEBKIT_SOURCE_INVENTORY.jsonl').open('w') as f:
 for mode,typ,oid,path in entries:f.write(json.dumps({'path':path,'mode':mode,'gitBlob':oid,'size':sizes[oid]},ensure_ascii=True)+'\n')
result={'state':'acquired; every referenced blob present locally, no network/lazy fetch used','revision':sha,'tree':tree,'entries':len(entries),'distinctBlobs':len(ids),'directories':len(dirs),'modes':modes,'expandedBlobBytes':bytesTotal,'treeInventorySha256':hashlib.sha256(b).hexdigest(),'sourceInventorySha256':hashlib.sha256((r/'WEBKIT_SOURCE_INVENTORY.jsonl').read_bytes()).hexdigest(),'provenance':'https://github.com/oven-sh/WebKit/commit/'+sha,'intakeLimits':{'expandedBytes':16*1024**3,'headers':500000},'lowerBoundHeadersWithDirectories':len(entries)+len(dirs)+1}
(r/'WEBKIT_SOURCE_VERIFICATION.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
