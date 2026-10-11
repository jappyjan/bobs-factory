import pathlib,struct,hashlib,json,zipfile,tarfile,subprocess,math
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');D=R/'candidate-21';OUT=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
align=lambda n,p:(n+p-1)//p*p
u32=lambda b,p:struct.unpack_from('<I',b,p)[0]
u64=lambda b,p:struct.unpack_from('<Q',b,p)[0]
def put(b,p,v,width=8):struct.pack_into('<Q' if width==8 else '<I',b,p,v)
def parse(b):
 if b[:4]==b'\x7fELF':
  assert b[4:6]==b'\x02\x01';phoff=u64(b,32);shoff=u64(b,40);psz,snum,ssz,nsect,sidx=struct.unpack_from('<5H',b,54);assert psz==56 and ssz==64
  ph=[{'pos':phoff+i*56,'vals':list(struct.unpack_from('<II6Q',b,phoff+i*56))} for i in range(snum)]
  sh=[{'pos':shoff+i*64,'vals':list(struct.unpack_from('<II4QII2Q',b,shoff+i*64))} for i in range(nsect)]
  st=sh[sidx]['vals'];names=b[st[4]:st[4]+st[5]]
  for s in sh:s['name']=names[s['vals'][0]:].split(b'\0')[0].decode()
  return {'ph':ph,'sh':sh,'shoff':shoff}
 assert u32(b,0)==0xfeedfacf;cmds=[];pos=32;sections=[]
 for i in range(u32(b,16)):
  cmd,sz=struct.unpack_from('<II',b,pos);assert sz>=8 and pos+sz<=32+u32(b,20);c={'pos':pos,'cmd':cmd,'size':sz}
  if cmd==0x19:
   c['segment']=b[pos+8:pos+24].split(b'\0')[0].decode();c.update(zip(['vm','vms','fo','fs'],struct.unpack_from('<4Q',b,pos+24)))
   ns=u32(b,pos+64);assert 72+80*ns<=sz
   for j in range(ns):
    q=pos+72+80*j;sections.append({'pos':q,'name':b[q:q+16].split(b'\0')[0].decode(),'segment':b[q+16:q+32].split(b'\0')[0].decode(),'addr':u64(b,q+32),'size':u64(b,q+40),'fo':u32(b,q+48)})
  cmds.append(c);pos+=sz
 assert pos==32+u32(b,20)
 return {'cmds':cmds,'sections':sections}
def graph(payload):
 trailer=b'\n---- Bun! ----\n';assert payload[-16:]==trailer;footer=payload[-48:-16];count,mo,ms,ep,ao,az,flags=struct.unpack('<Q6I',footer);assert count==len(payload)-48 and ms%52==0 and ep<ms//52 and mo+ms<=count and ao+az<=count
 for p in range(mo,mo+ms,52):
  for off in range(0,48,8):
   a,n=struct.unpack_from('<II',payload,p+off);assert a+n<=count
 return {'length':len(payload),'sha256':sha(payload),'modules':ms//52,'byteCount':count,'flags':hex(flags)}
# Canonical identity and immutable index: integrity before base comparison.
record=json.loads((D/'candidate.json').read_text());candidate=record['candidate'];canonical=json.dumps(candidate,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode();assert sha(canonical)==record['digest']=='ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec'
assert candidate['commit']=='b82c37c4fb9a3e18d1cb222c6d56d3fef852096f'
index=json.loads((D/'artifact-index.json').read_text());assert index['candidate']==candidate and index['candidateDigest']==record['digest'];results=[]
for target in candidate['targets']:
 bidx=index['targets'][target]['binary'];aid=bidx['artifact']['id'];container=(D/(target+'-github-artifact.zip')).read_bytes();assert 'sha256:'+sha(container)==bidx['artifact']['digest'] and len(container)==bidx['artifact']['sizeInBytes']
 metadata=json.loads(subprocess.check_output(['gh','api',f'repos/jappyjan/bobs-factory/actions/artifacts/{aid}'],timeout=30));assert metadata['digest']==bidx['artifact']['digest'] and metadata['workflow_run']['id']==38086228778 and metadata['workflow_run']['head_sha']==candidate['commit'];(OUT/(target+'.provider.json')).write_text(json.dumps(metadata,indent=2)+'\n')
 arc=bidx['archive'];arcpath=D/target/arc['file'];archive=arcpath.read_bytes();assert sha(archive)==arc['sha256'] and len(archive)==arc['size']
 with zipfile.ZipFile(D/(target+'-github-artifact.zip')) as z:
  names=[n for n in z.namelist() if n.endswith('/'+arc['file']) or n==arc['file']];assert len(names)==1 and z.read(names[0])==archive
 actual=[];factory=None;build=None
 with tarfile.open(arcpath,'r:gz') as tf:
  for m in tf:
   assert m.isdir() or m.isfile();x={'path':m.name,'size':m.size,'type':'directory' if m.isdir() else 'file'}
   if m.isfile():
    data=tf.extractfile(m).read();x['sha256']=sha(data)
    if m.name.endswith('/bobs-factory'):factory=data
    if m.name.endswith('/build.json'):build=json.loads(data)
   actual.append(x)
 assert actual==bidx['verifiedArchiveInventory'] and factory==(D/(target+'-factory-executable')).read_bytes();assert build==bidx['identity'] and build==json.loads((D/(target+'-build.json')).read_text())
 assert build['candidateDigest']==record['digest'] and build['commit']==candidate['commit'] and build['workflowSha']==candidate['workflowSha'] and build['target']==target and build['version']==candidate['version'] and build['dirty']==False and build['executable']['sha256']==sha(factory)
 assert json.loads((D/target/(arc['file'].replace('.tar.gz','.manifest.json'))).read_text())=={k:v for k,v in arc.items() if k not in ['actualSize','actualSha256','verified']}
 basezip=R/'prior-research/darwin-arm64-release-bun.zip' if target=='darwin-arm64' else R/'official-runtime-and-caches'/('release-bun-'+target.replace('linux-arm64','linux-aarch64')+'.zip')
 with zipfile.ZipFile(basezip) as z:base=z.read(next(n for n in z.namelist() if n.endswith('/bun')))
 assert base==(D/(target+'-published-base')).read_bytes();a=parse(base);f=parse(factory)
 if target.startswith('linux'):
  bun=next(s for s in a['sh'] if s['name']=='.bun');bv=bun['vals'];rw=[p for p in a['ph'] if p['vals'][0]==1 and p['vals'][1]&2 and p['vals'][3]<=bv[3]<p['vals'][3]+p['vals'][6]];assert len(rw)==1;rw=rw[0];rv=rw['vals'];page=65536 if u32(base,16)&0xffff0000==0xb70000 else 4096
  assert struct.unpack_from('<H',base,18)[0]==(183 if target=='linux-arm64' else 62)
  end=max(p['vals'][3]+p['vals'][6] for p in a['ph'] if p['vals'][0]==1);newva=align(end,page);fo=rv[2]+newva-rv[3];length=u64(factory,fo);assert 0<length<50*1024**2 and fo+8+length<len(factory)
  payload=factory[fo+8:fo+8+length];gp=graph(payload);allocated=align(8+length,page);oldend=rv[2]+rv[5];delta=fo+allocated-oldend;assert oldend<=a['shoff'] and a['shoff']+len(a['sh'])*64<=len(base)
  expected=bytearray(base[:oldend])+bytearray(fo-oldend)+struct.pack('<Q',length)+payload+bytearray(allocated-length-8)+base[oldend:]
  put(expected,40,a['shoff']+delta);put(expected,bv[4],newva)
  for s in a['sh']:
   p=s['pos']+delta;sv=s['vals']
   if s is bun:put(expected,p+16,newva);put(expected,p+24,fo);put(expected,p+32,8+length)
   elif sv[1]!=8 and oldend<=sv[4]<len(base):put(expected,p+24,sv[4]+delta)
  put(expected,rw['pos']+32,newva-rv[3]+allocated);put(expected,rw['pos']+40,newva-rv[3]+allocated)
  interp=next(p for p in a['ph'] if p['vals'][0]==3)['vals'];assert base[interp[2]:interp[2]+interp[5]]==(b'/lib/ld-linux-aarch64.so.1\0' if target=='linux-arm64' else b'/lib64/ld-linux-x86-64.so.2\0')
 else:
  bunseg=next(c for c in a['cmds'] if c.get('segment')=='__BUN');bun=next(s for s in a['sections'] if s['segment']=='__BUN');assert bun['name']=='__bun' and bunseg['fo']==bun['fo'];fo=bun['fo'];length=u64(factory,fo);assert 0<length<50*1024**2 and fo+8+length<len(factory);payload=factory[fo+8:fo+8+length];gp=graph(payload);allocated=align(length+8,16384);delta=allocated-bunseg['fs'];assert delta>=0
  expected=bytearray(base[:fo])+struct.pack('<Q',length)+payload+bytearray(allocated-length-8)+base[fo+bunseg['fs']:]
  bp=bunseg['pos'];put(expected,bp+32,allocated);put(expected,bp+48,allocated);put(expected,bp+56,3,4);put(expected,bp+60,3,4)
  q=bun['pos'];put(expected,q+40,length+8)
  for off,val in [(52,14),(56,0),(60,0),(64,0x10000000),(68,0),(72,0),(76,0)]:put(expected,q+off,val,4)
  le=next(c for c in a['cmds'] if c.get('segment')=='__LINKEDIT');sigcmd=next(c for c in a['cmds'] if c['cmd']==0x1d);sigoff=u32(base,sigcmd['pos']+8)+delta;oldsz=u32(base,sigcmd['pos']+12);slots=math.ceil(sigoff/4096);sigsz=114+slots*32 if target=='darwin-arm64' else oldsz
  put(expected,le['pos']+24,le['vm']+delta);put(expected,le['pos']+40,le['fo']+delta)
  if target=='darwin-arm64':put(expected,le['pos']+48,le['fs']-oldsz+sigsz);put(expected,le['pos']+32,align(le['fs']-oldsz+sigsz,4096))
  offsets={2:[8,16],0xb:[32,40,48,56,64,72],0x80000034:[8],0x80000033:[8],0x1d:[8],0x26:[8],0x29:[8],0x2b:[8],0x2e:[8],0x22:[8,16,24,32,40],0x80000022:[8,16,24,32,40]}
  for c in a['cmds']:
   for off in offsets.get(c['cmd'],[]):
    val=u32(expected,c['pos']+off)
    if val:
     assert align(fo,4096)<=val<=le['fo']+le['fs'];put(expected,c['pos']+off,val+delta,4)
   if c is sigcmd:put(expected,c['pos']+12,sigsz,4)
  if target=='darwin-arm64':
   # Build every metadata byte and page digest from expected bytes, no candidate signature fields used.
   text=next(c for c in a['cmds'] if c.get('segment')=='__TEXT');header=bytearray(88);struct.pack_into('>9I',header,0,0xfade0c02,sigsz-20,0x20400,0x20002,94,88,0,slots,sigoff);struct.pack_into('>4B',header,36,32,2,0,12);struct.pack_into('>3Q',header,64,align(text['fo'],4096),align(text['fs'],4096),1)
   expected=expected[:sigoff]+struct.pack('>5I',0xfade0cc0,sigsz,1,0,20)+header+b'a.out\0'+b''.join(hashlib.sha256(expected[i:min(i+4096,sigoff)]).digest() for i in range(0,sigoff,4096))
   assert len(expected)==sigoff+sigsz
 assert bytes(expected)==factory,(target,'full-byte comparison failed')
 proof={'target':target,'result':'PASS','baseSha256':sha(base),'factorySha256':sha(factory),'wholeReconstructedSha256':sha(expected),'entireExecutableMatchesIncludingSignature':True,'factoryBytes':len(factory),'payloadOffset':fo,'graph':gp}
 if target=='darwin-arm64':proof.update(signatureOffset=sigoff,signatureSize=sigsz,signaturePageHashes=slots,signatureReconstructedWithoutCandidateMetadata=True)
 if target=='darwin-x64':proof.update(originalSignaturePreserved=True,signatureValidityNotEstablished=True)
 print(json.dumps(proof),flush=True);results.append(proof)
(OUT/'binding.result.json').write_text(json.dumps(results,indent=2)+'\n')
