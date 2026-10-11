import pathlib,json,hashlib,tarfile,gzip,zipfile,struct,subprocess,ast,collections
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');OUT=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def filehash(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
def load(n):return json.loads((R/n).read_text())
def verify(p,x,h='sha256',size='size'):assert filehash(p)==x[h] and p.stat().st_size==x[size],str(p)
results={}
critical=load('RESEARCH_EVIDENCE_INDEX.json')['criticalEvidence']
for x in critical:verify(R/x['file'],x)
results['frozenEvidenceFiles']=len(critical)
for x in load('PRESERVATION_MANIFEST.json')['files']:verify(R/'prior-research'/x['file'],x)
results['preservedFilesVerified']=len(load('PRESERVATION_MANIFEST.json')['files'])
idx=(R/'candidate-21/artifact-index.json').read_bytes();assert idx==subprocess.check_output(['git','show','97acf7ba6e00c81a480cd2f8d01c519ea2cf5f05:docs/distribution/evidence/taskbot116-source-b82/artifact-index.json'],cwd='/Users/jappy/code/jappy/bobs-factory')
results['artifactIndexMatchesImmutable97']=True
for x in load('official-pinned-sources/SOURCE_DOWNLOAD_MANIFEST.json'):verify(R/'official-pinned-sources'/x['file'],x)
with tarfile.open(R/'official-pinned-sources/bun-source.tar.gz','r:gz') as t:
 prefix='bun-744846f844374847c902b5e7fd59b4342a51ef99/'
 for x in load('pinned-bun-research/DOWNLOADS.json'):
  b=t.extractfile(prefix+x['path']).read();assert sha(b)==x['sha256'] and b==(R/'pinned-bun-research'/x['path'].replace('/','__')).read_bytes()
 assert t.extractfile(prefix+'src/standalone_graph/StandaloneModuleGraph.rs').read()==(R/'prior-research/bun-build/src__standalone_graph__StandaloneModuleGraph.rs').read_bytes()
 results['pinnedBunSourceFilesBoundToArchive']=18
 # Exact-pin vendor/dependency index for remaining completeness review, no legal acceptance.
 results['bunSourceDependencyFiles']=[m.name[len(prefix):] for m in t.getmembers() if m.isfile() and (m.name.endswith('Cargo.lock') or m.name.endswith('tinycc.patch') or m.name.endswith('scripts/build/config.ts') or m.name.endswith('.gitmodules'))]
objs=load('prior-research/RESEARCH_DOWNLOAD_MANIFEST.json')['objects'];oldinv=load('GENUINE_AR_MEMBER_INVENTORIES.json');outinv=[];catalog=load('prior-research/all-four-upstream-artifacts.json');cat={x['sha256']:x for rec in catalog for x in rec['artifacts']}
for x in objs:
 p=R/'prior-research'/x['file'];verify(p,x);assert x['sha256'] in cat and x['source']==cat[x['sha256']]['url'];members=[];names=b''
 with gzip.open(p,'rb') as f:
  assert f.read(8)==b'!<arch>\n'
  while True:
   h=f.read(60)
   if not h:break
   assert len(h)==60 and h[58:]==b'`\n';sz=int(h[48:58]);b=f.read(sz);assert len(b)==sz
   if sz%2:assert f.read(1)==b'\n'
   name=h[:16].decode().strip()
   if name=='//':names=b;continue
   if name in ['/','/SYM64/']:continue
   if name.startswith('#1/'):
    n=int(name[3:]);name=b[:n].rstrip(b'\0').decode();b=b[n:]
   elif name.startswith('/') and name[1:].isdigit():name=names[int(name[1:]):].split(b'/\n')[0].decode()
   else:name=name.rstrip('/')
   members.append({'name':name,'size':len(b),'sha256':sha(b),'magic':b[:8].hex()})
 record=next(v for v in oldinv if v['file']==x['file']);assert members==record['members']
 bitcode=sum(m['magic'].startswith(('4243c0de','dec0170b')) for m in members);tcc=[m['name'] for m in members if 'tcc' in m['name']]
 outinv.append({'file':x['file'],'members':len(members),'LLVMBitcodeMembers':bitcode,'tinyccMembers':len(tcc),'sha256':x['sha256']});print('ar verified',outinv[-1],flush=True)
results['genuineArInventories']=outinv
link=load('LINK_INPUT_DOWNLOAD_MANIFEST.json')
for x in link:
 verify(R/x['file'],x,'actualSha256','actualSize');assert x['sha256']==x['actualSha256'] and x['sha256'] in cat and x['url']==cat[x['sha256']]['url']
results['upstreamLinkDownloadsVerified']=len(link)
runtime=load('RUNTIME_CACHE_DOWNLOAD_MANIFEST.json')
for x in runtime:verify(R/'official-runtime-and-caches'/x['file'],x,'actualSha256','actualSize')
cacheinv=load('WEBKIT_CACHE_INVENTORIES.json');allmatched=[]
for c in cacheinv:
 inv=[];matched=[]
 with tarfile.open(R/'official-runtime-and-caches'/c['archive'],'r|gz') as f:
  for m in f:
   # Research inventory only records regular files. Recompute their bytes.
   if not m.isfile():
    inv.append({'path':m.name,'size':m.size,'type':m.type.decode()});continue
   h=hashlib.sha256();stream=f.extractfile(m)
   for b in iter(lambda:stream.read(4*1024*1024),b''):h.update(b)
   inv.append({'path':m.name,'size':m.size,'type':m.type.decode()})
   if m.name.endswith('.a'):
    matches=[x['file'] for x in link if x['actualSha256']==h.hexdigest()]
    if matches:matched+=matches
   if m.name.endswith('compile_commands.json'):
    q=R/'actual-cache-configs'/(c['archive'].replace('.tar.gz','-compile_commands.json'));assert filehash(q)==h.hexdigest();assert len(json.loads(q.read_text()))==707
 assert inv==c['inventory'];assert len(inv)==c['members'];allmatched+=matched;print('cache verified',c['archive'],'files',len(inv),'linkedLibs',len(matched),flush=True)
assert len(allmatched)==18 and len(set(allmatched))==18;results['all18LibrariesByteEqualInOfficialCaches']=True
profiles=load('PROFILE_CONFIG_DOWNLOAD_MANIFEST.json')
for p in profiles:
 zipfile_path=R/'actual-profile-configs'/p['path'];verify(zipfile_path,p,'actualSha256','actualSize');assert p['sha256']==p['actualSha256'] and p['sha256'] in cat
 with zipfile.ZipFile(zipfile_path) as z:
  for x in p['extracted']:
   b=z.read(x['archivePath']);assert len(b)==x['size'] and sha(b)==x['sha256'] and b==(R/x['file']).read_bytes()
  assert [{'path':i.filename,'size':i.file_size} for i in z.infolist()]==p['inventory']
  feature=json.loads(z.read(next(n for n in z.namelist() if n.endswith('features.json'))));assert feature['revision']=='744846f844374847c902b5e7fd59b4342a51ef99' and feature['version']=='1.4.2' and feature['is_canary']==False
 results.setdefault('profileFilesVerified',[]).append(p['target'])
for order in load('actual-inherited-order/ORDER_PROVENANCE.json'):
 p=R/'actual-inherited-order'/order['file'];verify(p,order);target='bun-darwin-aarch64-profile' if 'darwin' in order['file'] else 'bun-linux-x64-profile';assert p.read_bytes()==(R/'actual-profile-configs'/target/'linker.order').read_bytes();assert filehash(p)!=filehash(R/'official-link-inputs'/target.removeprefix('bun-').replace('-profile','-trace-order')/order['file'])
results['inherited110317OrdersConfirmedDistinctFrom110323']=True
# Check exact pinned WebKit Git commit/tree against provider metadata, without fetching source.
commit=json.loads(subprocess.check_output(['gh','api','repos/oven-sh/WebKit/git/commits/2e2aa2290fac856d6f451ceacb58f7f5b44dd057'],timeout=30));assert commit['sha']=='2e2aa2290fac856d6f451ceacb58f7f5b44dd057' and commit['tree']['sha']=='01e7ea36e5a23bf0206724ed83c594a2eaec95ed';(OUT/'webkit.provider.json').write_text(json.dumps(commit,indent=2)+'\n');results['officialGitCommitTreeLiveMatch']=True
results['result']='PASS';(OUT/'materials.result.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results),flush=True)
