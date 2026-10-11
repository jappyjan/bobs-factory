from pathlib import Path
import urllib.request,hashlib,json,zipfile,os,time,shutil
r=Path(__file__).parent;d=r/'actual-profile-configs';d.mkdir(exist_ok=True);rec=[]
for target in json.loads((r/'prior-research/all-four-upstream-artifacts.json').read_text()):
 for a in target['artifacts']:
  if not a['path'].endswith('-profile.zip'):continue
  q=d/a['path'];t=q.with_suffix('.zip.download-part');h=hashlib.sha256();n=0;t0=time.monotonic()
  with urllib.request.urlopen(a['url'],timeout=30) as f,t.open('wb') as out:
   while True:
    b=f.read(4*1024*1024)
    if not b:break
    assert n<1024**3 and time.monotonic()-t0<180 and shutil.disk_usage(r).free>100*1024**3;out.write(b);h.update(b);n+=len(b)
  assert h.hexdigest()==a['sha256'];os.replace(t,q);inventory=[];extracted=[]
  with zipfile.ZipFile(q) as z:
   for m in z.infolist():
    inventory.append({'path':m.filename,'size':m.file_size})
    if m.filename.endswith(('.json','.order','.map','.linker-map','.rsp','.response')):
     assert m.file_size<=100*1024*1024;b=z.read(m);p=d/a['path'].replace('.zip','')/Path(m.filename).name;p.parent.mkdir(exist_ok=True);p.write_bytes(b);extracted.append({'file':str(p.relative_to(r)),'size':len(b),'sha256':hashlib.sha256(b).hexdigest(),'archivePath':m.filename})
  rec.append(dict(a,actualSize=n,actualSha256=h.hexdigest(),target=target['target'],extracted=extracted,inventory=inventory));(r/'PROFILE_CONFIG_DOWNLOAD_MANIFEST.json').write_text(json.dumps(rec,indent=2)+'\n');print(a['path'],n,[(x['archivePath'],x['size']) for x in extracted],flush=True)
