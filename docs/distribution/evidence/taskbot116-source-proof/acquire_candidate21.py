from pathlib import Path
import subprocess,hashlib,json,zipfile,os,tarfile
r=Path(__file__).parent;d=r/'candidate-21';d.mkdir(exist_ok=True);records=[]
for target,aid in [('darwin-arm64',11682123495),('darwin-x64',11682007647),('linux-x64',11682662326),('linux-arm64',11681708067)]:
 metadata=subprocess.check_output(['gh','api',f'repos/jappyjan/bobs-factory/actions/artifacts/{aid}'],timeout=30);m=json.loads(metadata);assert m['workflow_run']['head_sha']=='b82c37c4fb9a3e18d1cb222c6d56d3fef852096f';assert m['workflow_run']['id']==38086228778;(d/f'{target}-github-artifact.json').write_bytes(metadata)
 q=d/f'{target}-github-artifact.zip';t=q.with_suffix('.zip.download-part')
 with t.open('wb') as f:subprocess.run(['gh','api',f'repos/jappyjan/bobs-factory/actions/artifacts/{aid}/zip'],stdout=f,check=True,timeout=180)
 h=hashlib.sha256(t.read_bytes()).hexdigest();assert m['digest']=='sha256:'+h;os.replace(t,q)
 dest=d/target;dest.mkdir(exist_ok=True)
 with zipfile.ZipFile(q) as z:
  for entry in z.infolist():
   p=Path(entry.filename);assert not p.is_absolute() and '..' not in p.parts;assert entry.file_size<200*1024*1024
  z.extractall(dest)
 rec={'target':target,'artifactId':aid,'source':f'https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/{aid}','containerSize':q.stat().st_size,'containerSha256':h,'sourceSha':m['workflow_run']['head_sha']};records.append(rec);(d/'DOWNLOAD_PROVENANCE.json').write_text(json.dumps(records,indent=2)+'\n');print(target,q.stat().st_size,h,flush=True)
