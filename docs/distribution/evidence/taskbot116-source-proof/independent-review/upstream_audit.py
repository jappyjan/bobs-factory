import ast,pathlib,json,struct,hashlib,gzip,collections,zipfile,subprocess
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');OUT=pathlib.Path(__file__).parent
# Use this review's raw parsers only, with no artifact/network audit side effects.
module=ast.parse((OUT/'binding_audit.py').read_text());keep=[]
for node in module.body:
 if isinstance(node,(ast.Import,ast.FunctionDef)):keep.append(node)
 elif isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['sha','align','u32','u64'] for t in node.targets):keep.append(node)
exec(compile(ast.Module(body=keep,type_ignores=[]),'own-parser','exec'))
def readzip(p):
 with zipfile.ZipFile(p) as z:return z.read(next(n for n in z.namelist() if n.endswith('/bun')))
results=[]
for target in ['darwin-arm64','darwin-x64','linux-x64','linux-arm64']:
 if target=='darwin-arm64':p=R/'prior-research/darwin-arm64-buildkite-bun.zip';q=R/'prior-research/darwin-arm64-release-bun.zip'
 else:
  name=target.replace('linux-arm64','linux-aarch64');p=R/'official-runtime-and-caches'/('buildkite-bun-'+name+'.zip');q=R/'official-runtime-and-caches'/('release-bun-'+name+'.zip')
 a=readzip(p);b=readzip(q)
 if target.startswith('linux'):
  assert p.read_bytes()==q.read_bytes() and a==b;result={'target':target,'zipAndExecutableBytesEqual':True}
 else:
  ap=parse(a);bp=parse(b);ases=ap['sections'];bses=bp['sections'];assert ases==bses
  for s in ases:
   flags=u32(a,s['pos']+64)
   if flags&255 not in [1,12,18]:assert a[s['fo']:s['fo']+s['size']]==b[s['fo']:s['fo']+s['size']]
  ac=[c for c in ap['cmds'] if c['cmd']==0x1d];bc=next(c for c in bp['cmds'] if c['cmd']==0x1d);sigoff=u32(b,bc['pos']+8);sigsize=u32(b,bc['pos']+12);assert sigoff+sigsize==len(b)
  aa=bytearray(a);bb=bytearray(b);masks=[]
  if target=='darwin-arm64':
   assert len(ac)==1 and u32(a,ac[0]['pos']+8)==sigoff;asize=u32(a,ac[0]['pos']+12);assert sigoff+asize==len(a);assert len(a)-len(b)==asize-sigsize
   for data,ps in [(aa,ap),(bb,bp)]:
    le=next(c for c in ps['cmds'] if c.get('segment')=='__LINKEDIT');mask=[(le['pos']+32,8),(le['pos']+48,8),(next(c for c in ps['cmds'] if c['cmd']==0x1d)['pos']+12,4)];masks.append(mask)
    for off,n in mask:data[off:off+n]=bytes(n)
   assert aa[:sigoff]==bb[:sigoff];length=sigoff
  else:
   assert not ac and len(bp['cmds'])==len(ap['cmds'])+1 and bc==bp['cmds'][-1] and sigoff==align(len(a),16);assert all(x==0 for x in b[len(a):sigoff])
   for data,ps in [(aa,ap),(bb,bp)]:
    le=next(c for c in ps['cmds'] if c.get('segment')=='__LINKEDIT');mask=[(16,8),(le['pos']+32,8),(le['pos']+48,8),(bc['pos'],16)];masks.append(mask)
    for off,n in mask:data[off:off+n]=bytes(n)
   assert aa==bb[:len(a)];length=len(a)
  result={'target':target,'allFileBackedSectionsEqual':True,'allBytesBeforeSignatureAccounted':True,'prefixBytes':length,'allowedMasks':masks,'normalizedPrefixSha256':sha(aa[:length]),'publishedSignatureBytes':sigsize,'signingInvocationObserved':False}
  if target=='darwin-x64':
   f=(R/'candidate-21/darwin-x64-factory-executable').read_bytes();fp=parse(f);fsc=next(c for c in fp['cmds'] if c['cmd']==0x1d);so=u32(f,fsc['pos']+8);sig=f[so:];magic,sz,count=struct.unpack_from('>III',sig);assert magic==0xfade0cc0;bad=0;total=0
   for j in range(count):
    typ,off=struct.unpack_from('>II',sig,12+j*8)
    if struct.unpack_from('>I',sig,off)[0]!=0xfade0c02:continue
    hoff=struct.unpack_from('>I',sig,off+16)[0];slots=struct.unpack_from('>I',sig,off+28)[0];limit=struct.unpack_from('>I',sig,off+32)[0];hs,ht,platform,ps=struct.unpack_from('>4B',sig,off+36);assert ht==2 and hs==32
    for i in range(slots):
     actual=hashlib.sha256(f[i*(1<<ps):min((i+1)*(1<<ps),limit)]).digest();bad+=actual!=sig[off+hoff+32*i:off+hoff+32*(i+1)];total+=1
   assert bad>0;result['candidateRetainedSignatureInvalidCodePageHashes']={'bad':bad,'total':total}
 print(json.dumps(result),flush=True);results.append(result)
(OUT/'upstream.result.json').write_text(json.dumps(results,indent=2)+'\n')
# Actual header accounting, including PAX extension headers and compressed SHA separately verified.
count=0;types=collections.Counter();sizeTotal=0;name='WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057.tar.gz'
with gzip.open(R/name,'rb') as f:
 while True:
  h=f.read(512);assert len(h)==512
  if h==bytes(512):
   while (b:=f.read(4*1024*1024)):assert not any(b)
   break
  count+=1;types[chr(h[156] or 48)]+=1;size=int(h[124:136].rstrip(b'\0 ').strip() or b'0',8);remaining=align(size,512);sizeTotal+=remaining
  while remaining:
   b=f.read(min(remaining,4*1024*1024));assert b;remaining-=len(b)
assert count==489846 and types['x']==802
headers={'result':'PASS','headers':count,'typeCounts':dict(types),'paddedMemberBytes':sizeTotal};print(json.dumps(headers),flush=True);(OUT/'headers.result.json').write_text(json.dumps(headers,indent=2)+'\n')
