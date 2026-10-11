import json,os,subprocess,hashlib,tarfile,gzip,time,shutil
from pathlib import Path
r=Path(__file__).parent;repo=r/'webkit-complete.git';sha='2e2aa2290fac856d6f451ceacb58f7f5b44dd057';prefix='WebKit-'+sha+'/';env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_TERMINAL_PROMPT='0');GiB=1024**3
entries=[json.loads(x) for x in (r/'WEBKIT_SOURCE_INVENTORY.jsonl').open()];dirs=set()
for x in entries:
 for i in range(1,len(x['path'].split('/'))):dirs.add('/'.join(x['path'].split('/')[:i]))
archive=r/('WebKit-'+sha+'.tar.gz');tmp=archive.with_suffix('.gz.archive-part');assert not archive.exists();headers=0;expanded=0;t=time.monotonic()
p=subprocess.Popen(['git','-c','protocol.allow=never','-C',str(repo),'cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env=env)
def blob(x):
 p.stdin.write((x['gitBlob']+'\n').encode());p.stdin.flush();meta=p.stdout.readline().decode().split();assert meta==[x['gitBlob'],'blob',str(x['size'])];b=p.stdout.read(x['size']);assert p.stdout.read(1)==b'\n';assert len(b)==x['size'];assert hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest()==x['gitBlob'];return b
def header(ti):
 global headers
 try:b=ti.tobuf(tarfile.USTAR_FORMAT,encoding='utf-8')
 except ValueError:b=ti.tobuf(tarfile.PAX_FORMAT,encoding='utf-8')
 headers+=1+int(len(b)>512);assert headers<=500000;return b
try:
 with tmp.open('wb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,compresslevel=6,mtime=0) as gz:
  for d in ['']+sorted(dirs):
   ti=tarfile.TarInfo(prefix+d+('/' if d else ''));ti.type=tarfile.DIRTYPE;ti.mode=0o755;gz.write(header(ti))
  for i,x in enumerate(entries):
   b=blob(x);ti=tarfile.TarInfo(prefix+x['path']);ti.mode=0o755 if x['mode']=='100755' else 0o644
   if x['mode']=='120000':ti.type=tarfile.SYMTYPE;ti.linkname=b.decode('utf8');ti.mode=0o777;gz.write(header(ti))
   else:ti.size=len(b);expanded+=len(b);assert expanded<=16*GiB;gz.write(header(ti));gz.write(b);gz.write(bytes((-len(b))%512))
   if i%10000==0:
    total=sum(f.stat().st_size for f in r.rglob('*') if f.is_file());free=shutil.disk_usage(r).free
    assert total<=32*GiB and free>=100*GiB and time.monotonic()-t<1800
    print(json.dumps({'archivedEntries':i,'headers':headers,'expandedRegularBytes':expanded,'archiveBytes':raw.tell(),'ownedBytes':total,'freeBytes':free,'elapsedSeconds':round(time.monotonic()-t,1)}),flush=True)
  gz.write(bytes(1024))
 p.stdin.close();assert p.wait(timeout=10)==0;os.replace(tmp,archive)
 h=hashlib.sha256()
 with archive.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 result={'file':archive.name,'sha256':h.hexdigest(),'size':archive.stat().st_size,'revision':sha,'tree':'01e7ea36e5a23bf0206724ed83c594a2eaec95ed','source':'https://github.com/oven-sh/WebKit/commit/'+sha,'headers':headers,'regularFileBytes':expanded,'gitEntries':len(entries),'directories':len(dirs)+1,'symlinks':35,'entireTreeIncluded':True,'blobSha1VerifiedOnWrite':True,'elapsedSeconds':time.monotonic()-t,'state':'acquired; full source preservation archive; release intake/licensing receipt UNPROVEN'}
 (r/'WEBKIT_ARCHIVE_RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
finally:
 if p.poll() is None:p.terminate();p.wait()
