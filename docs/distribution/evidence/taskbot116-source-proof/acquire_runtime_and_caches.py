from pathlib import Path
import json,urllib.request,hashlib,os,time,shutil
r=Path(__file__).parent;d=r/'official-runtime-and-caches';d.mkdir(exist_ok=True);records=[];jobs=json.loads((r/'prior-research/all-four-upstream-artifacts.json').read_text());bun=json.loads((r/'prior-research/bun-release-api.json').read_text());wk=json.loads((r/'prior-research/webkit-release-api.json').read_text());wanted=['bun-darwin-x64.zip','bun-linux-x64.zip','bun-linux-aarch64.zip'];todo=[]
for j in jobs:
 for a in j['artifacts']:
  if a['path'] in wanted:todo.append(dict(a,file='buildkite-'+a['path'],source=a['url']))
for a in bun['assets']:
 if a['name'] in wanted:todo.append({'file':'release-'+a['name'],'source':a['browser_download_url'],'sha256':a['digest'].split(':')[1],'expectedSize':a['size']})
for a in wk['assets']:
 if a['name'] in ['bun-webkit-linux-amd64-lto.tar.gz','bun-webkit-linux-arm64-lto.tar.gz','bun-webkit-macos-amd64-lto.tar.gz','bun-webkit-macos-arm64-lto.tar.gz']:todo.append({'file':a['name'],'source':a['browser_download_url'],'sha256':a['digest'].split(':')[1],'expectedSize':a['size']})
for a in todo:
 q=d/a['file'];t=q.with_name(q.name+'.download-part');h=hashlib.sha256();n=0;start=time.monotonic()
 with urllib.request.urlopen(a['source'],timeout=30) as f,t.open('wb') as out:
  while True:
   b=f.read(4*1024*1024)
   if not b:break
   assert shutil.disk_usage(r).free>101*1024**3 and n<2*1024**3 and time.monotonic()-start<180
   out.write(b);h.update(b);n+=len(b)
 assert h.hexdigest()==a['sha256'];assert 'expectedSize' not in a or n==a['expectedSize'];os.replace(t,q);records.append(dict(a,actualSha256=h.hexdigest(),actualSize=n));(r/'RUNTIME_CACHE_DOWNLOAD_MANIFEST.json').write_text(json.dumps(records,indent=2)+'\n');print(a['file'],n,flush=True)
