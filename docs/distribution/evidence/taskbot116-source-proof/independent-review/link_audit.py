import pathlib,json,hashlib,struct,re,urllib.request,collections
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');OUT=pathlib.Path(__file__).parent
load=lambda n:json.loads((R/n).read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
# Bind every retained Buildkite catalog record to a fresh public provider response.
catalog=load('prior-research/all-four-upstream-artifacts.json');total=0
for rec in catalog:
 live=json.loads((OUT/(rec['target']+'.buildkite-provider.json')).read_text());byid={x['id']:x for x in live}
 for x in rec['artifacts']:
  row=byid[x['url'].rsplit('/',1)[-1]];assert row['path']==x['path'] and row['sha256sum']==x['sha256'] and row['state']=='finished' and 'https://buildkite.com'+row['url']==x['url'];total+=1
orders=load('actual-inherited-order/ORDER_PROVENANCE.json')
for x in orders:
 url=x['source'].rsplit('/artifacts/',1)[0]+'/artifacts.json'
 with urllib.request.urlopen(url,timeout=30) as f:j=json.load(f)
 row=next(a for a in j if a['id']==x['source'].rsplit('/',1)[-1]);assert row['sha256sum']==x['sha256'] and row['path']==x['file'];(OUT/(x['file']+'.buildkite-provider.json')).write_text(json.dumps(j,indent=2)+'\n')
# Parse all 18 retained library archives, retain all member SHA-256 identities independently.
libraries=[];members_by_archive={}
for x in load('LINK_INPUT_DOWNLOAD_MANIFEST.json'):
 if not x['file'].endswith('.a'):continue
 p=R/x['file'];items=[];names=b''
 with p.open('rb') as f:
  assert f.read(8)==b'!<arch>\n'
  while True:
   h=f.read(60)
   if not h:break
   assert len(h)==60 and h[58:]==b'`\n';name=h[:16].decode().strip();size=int(h[48:58]);b=f.read(size);assert len(b)==size
   if size%2:assert f.read(1)==b'\n'
   if name=='//':names=b;continue
   if name in ['/','/SYM64/']:continue
   if name.startswith('#1/'):
    n=int(name[3:]);name=b[:n].rstrip(b'\0').decode();b=b[n:]
   elif name.startswith('/') and name[1:].isdigit():name=names[int(name[1:]):].split(b'/\n')[0].decode()
   else:name=name.rstrip('/')
   items.append({'name':name,'size':len(b),'sha256':sha(b),'magic':b[:8].hex()})
 assert items;libraries.append({'file':x['file'],'sha256':x['actualSha256'],'members':items});members_by_archive[x['file']]={m['name'] for m in items}
print('libraries ar parsed',len(libraries),'members',sum(len(x['members']) for x in libraries),flush=True)
# All map archive members available from the declared archives. LTO synthetic objects handled separately.
app=load('GENUINE_AR_MEMBER_INVENTORIES.json');maps=[]
for target,appbase,profile in [('darwin-arm64','darwin-arm64','bun-darwin-aarch64-profile'),('darwin-x64','darwin-x64','bun-darwin-x64-profile'),('linux-arm64','linux-aarch64','bun-linux-aarch64-profile'),('linux-x64','linux-x64','bun-linux-x64-profile')]:
 text=(R/'actual-profile-configs'/profile/'bun-profile.linker-map').read_text();references=set(re.findall(r'([^\s()]+\.a)\(([^()]+)\)',text));checked=0;unverified=[]
 for path,name in references:
  if 'bun-profile.lto.' in path:continue
  if path=='libbun-profile.a':members={m['name'] for a in app if a['file']==appbase+'-libbun-profile.a.gz' for m in a['members']}
  elif path.endswith('/libbun_runtime.a'):members={m['name'] for a in app if a['file']==appbase+'-libbun-runtime.a.gz' for m in a['members']}
  elif path.startswith('cache/webkit'):
   found=[v for k,v in members_by_archive.items() if k.endswith(path)]
   assert len(found)==1;(members,)=found
  else:unverified.append({'archive':path,'member':name});continue
  assert name in members,(target,path,name);checked+=1
 maps.append({'target':target,'verifiedMapArchiveMemberReferences':checked,'unverifiedSysrootArchiveMemberReferences':len(unverified)})
 print('map refs',maps[-1],flush=True)
result={'result':'PASS','liveBuildkiteCatalogRecordsMatched':total,'live110317OrderDigestsMatched':True,'libraries':libraries,'mapArchiveMemberCorrespondence':maps,'libraryCounts':[{'file':x['file'],'memberCount':len(x['members']),'llvmBitcodeMembers':sum(m['magic'].startswith(('4243c0de','dec0170b')) for m in x['members'])} for x in libraries]};(OUT/'link.result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='libraries'}),flush=True)
