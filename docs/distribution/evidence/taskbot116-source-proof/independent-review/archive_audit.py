import pathlib,subprocess,os,json,hashlib,tarfile,collections,time
r=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');sha='2e2aa2290fac856d6f451ceacb58f7f5b44dd057';t=time.monotonic();env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_TERMINAL_PROMPT='0')
def git(*a,input=None):return subprocess.check_output(['git','-c','protocol.allow=never','-C',str(r/'webkit-complete.git'),*a],input=input,env=env)
assert git('rev-parse',sha+'^{tree}').strip()==b'01e7ea36e5a23bf0206724ed83c594a2eaec95ed'
tree=git('ls-tree','-r','-z',sha);assert hashlib.sha256(tree).hexdigest()=='368c50fa17e4972719f24f9dce3b9151548aac7f14848b522bfc2dba8d913c43'
expected={};dirs={''};modes=collections.Counter()
for e in tree.rstrip(b'\0').split(b'\0'):
 meta,path=e.split(b'\t',1);mode,typ,oid=meta.decode().split();path=path.decode('utf-8');assert typ=='blob';expected[path]=(mode,oid);modes[mode]+=1
 for i in range(1,len(path.split('/'))):dirs.add('/'.join(path.split('/')[:i]))
ids=sorted({x[1] for x in expected.values()});sizes={}
for line in git('cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)',input=('\n'.join(ids)+'\n').encode()).splitlines():
 oid,typ,sz=line.decode().split();assert typ=='blob';sizes[oid]=int(sz)
assert len(sizes)==len(ids)
inventory={j['path']:(j['mode'],j['gitBlob'],j['size']) for j in map(json.loads,(r/'WEBKIT_SOURCE_INVENTORY.jsonl').open())}
assert inventory=={p:(m,o,sizes[o]) for p,(m,o) in expected.items()}
archive=r/('WebKit-'+sha+'.tar.gz');h=hashlib.sha256()
with archive.open('rb') as f:
 for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
assert archive.stat().st_size==1993738581 and h.hexdigest()=='108dd98cc15bf43debc753cfb597b5635bd936855da2bb48bf0bcacc46881f7d'
seen=set();seen_dirs=set();regular_bytes=0;symlinks=0;ordinary=0;prefix='WebKit-'+sha
with tarfile.open(archive,'r|gz') as f:
 for m in f:
  ordinary+=1;assert m.name==prefix or m.name.startswith(prefix+'/');path=m.name[len(prefix):].lstrip('/');assert '..' not in pathlib.PurePosixPath(path).parts
  if m.isdir():
   assert path in dirs and path not in seen_dirs;seen_dirs.add(path);assert m.mode==0o755;continue
  assert path in expected and path not in seen;seen.add(path);mode,oid=expected[path];size=sizes[oid]
  if mode=='120000':
   assert m.issym() and m.mode==0o777;data=m.linkname.encode();assert len(data)==size;digest=hashlib.sha1(b'blob '+str(size).encode()+b'\0'+data);symlinks+=1
  else:
   assert m.isfile() and m.mode==(0o755 if mode=='100755' else 0o644) and m.size==size
   digest=hashlib.sha1(b'blob '+str(size).encode()+b'\0');s=f.extractfile(m);n=0
   for b in iter(lambda:s.read(4*1024*1024),b''):digest.update(b);n+=len(b)
   assert n==size;regular_bytes+=n
  assert digest.hexdigest()==oid,path
  if len(seen)%100000==0:print('verified blobs',len(seen),'seconds',round(time.monotonic()-t,1),flush=True)
assert seen==set(expected) and seen_dirs==dirs
result={'result':'PASS','gitCommit':sha,'gitTree':'01e7ea36e5a23bf0206724ed83c594a2eaec95ed','gitEntries':len(expected),'distinctBlobs':len(ids),'modes':dict(modes),'directoriesIncludingRoot':len(dirs),'ordinaryArchiveEntries':ordinary,'regularBytes':regular_bytes,'symlinks':symlinks,'testEntries':sum(1 for p in expected if p.split('/')[0] in ['LayoutTests','JSTests','Tools','PerformanceTests','WebDriverTests']),'archiveBytes':archive.stat().st_size,'archiveSha256':h.hexdigest(),'sourceAndArchiveEveryGitBlobVerified':True,'seconds':round(time.monotonic()-t,3)}
print(json.dumps(result),flush=True);pathlib.Path(__file__).with_suffix('.result.json').write_text(json.dumps(result,indent=2)+'\n')
