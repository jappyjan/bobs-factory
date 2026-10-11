from pathlib import Path
import json,tarfile,hashlib,os,time
r=Path(__file__).parent;result=json.loads((r/'WEBKIT_ARCHIVE_RESULT.json').read_text());prefix='WebKit-'+result['revision']+'/';expected={x['path']:x for x in map(json.loads,(r/'WEBKIT_SOURCE_INVENTORY.jsonl').open())};seen=set();n=0;t0=time.monotonic();largest=0
with tarfile.open(r/result['file'],'r|gz') as f:
 for member in f:
  assert member.name.startswith(prefix.rstrip('/'));path=member.name[len(prefix):]
  if member.isdir():continue
  assert path in expected and path not in seen,(path,'missing/duplicate');seen.add(path);x=expected[path]
  if x['mode']=='120000':assert member.issym();b=member.linkname.encode();assert len(b)==x['size'];h=hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b)
  else:
   assert member.isfile() and member.size==x['size'] and member.mode==(0o755 if x['mode']=='100755' else 0o644);h=hashlib.sha1(('blob '+str(member.size)+'\0').encode());obj=f.extractfile(member)
   for b in iter(lambda:obj.read(4*1024*1024),b''):h.update(b)
  assert h.hexdigest()==x['gitBlob'],path;n+=1;largest=max(largest,x['size'])
  if n%100000==0:print('Verified archive blobs',n,'elapsed',round(time.monotonic()-t0,1),flush=True)
assert seen==set(expected)
res={'state':'acquired; independent full streamed archive verification passed','archive':result['file'],'archiveSha256':result['sha256'],'entriesVerified':n,'largestBlobBytes':largest,'allPathsModesSymlinkTargetsAndGitBlobHashesMatch':True,'elapsedSeconds':time.monotonic()-t0}
(r/'WEBKIT_ARCHIVE_INDEPENDENT_VERIFICATION.json').write_text(json.dumps(res,indent=2)+'\n');print(json.dumps(res),flush=True)
