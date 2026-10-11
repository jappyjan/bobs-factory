import json,urllib.request,hashlib,os,time,shutil
from pathlib import Path
r=Path(__file__).parent;d=r/'official-link-inputs';d.mkdir(exist_ok=True);records=[];GiB=1024**3
for target in json.loads((r/'prior-research/all-four-upstream-artifacts.json').read_text()):
 for a in target['artifacts']:
  if not (a['path'].endswith('.a') or a['path'].endswith('.order')):continue
  dest=d/target['target']/a['path'];dest.parent.mkdir(parents=True,exist_ok=True)
  if dest.exists():assert hashlib.sha256(dest.read_bytes()).hexdigest()==a['sha256'];continue
  t=dest.with_name(dest.name+'.download-part');h=hashlib.sha256();size=0;start=time.monotonic()
  with urllib.request.urlopen(a['url'],timeout=30) as f,t.open('wb') as out:
   while True:
    b=f.read(4*1024*1024)
    if not b:break
    if shutil.disk_usage(r).free<101*GiB or time.monotonic()-start>180 or size>2*GiB:raise RuntimeError('download bound exceeded')
    size+=len(b);h.update(b);out.write(b)
  assert h.hexdigest()==a['sha256'],a;os.replace(t,dest)
  records.append(dict(a,file=str(dest.relative_to(r)),actualSize=size,actualSha256=h.hexdigest(),target=target['target'],state='acquired, catalog hash verified; candidate binding and relink UNPROVEN'))
  (r/'LINK_INPUT_DOWNLOAD_MANIFEST.json').write_text(json.dumps(records,indent=2)+'\n');print(str(dest.relative_to(r)),size,flush=True)
