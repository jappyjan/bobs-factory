import pathlib,struct,hashlib,json,zipfile
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');out=pathlib.Path(__file__).parent;results=[]
for name in ['prior-research/darwin-arm64-buildkite-bun.zip','prior-research/darwin-arm64-release-bun.zip','official-runtime-and-caches/release-bun-darwin-x64.zip']:
 with zipfile.ZipFile(R/name) as z:b=z.read(next(n for n in z.namelist() if n.endswith('/bun')))
 p=32;sigoff=None
 for j in range(struct.unpack_from('<I',b,16)[0]):
  cmd,sz=struct.unpack_from('<II',b,p)
  if cmd==0x1d:sigoff,sigsize=struct.unpack_from('<II',b,p+8)
  p+=sz
 assert sigoff is not None and sigoff+sigsize==len(b);sig=b[sigoff:];magic,size,count=struct.unpack_from('>III',sig);assert magic==0xfade0cc0 and size<=sigsize;dirs=[]
 for i in range(count):
  kind,off=struct.unpack_from('>II',sig,12+8*i);m,n=struct.unpack_from('>II',sig,off);assert off+n<=size
  if m!=0xfade0c02:continue
  fields=struct.unpack_from('>9I',sig,off);m,n,ver,flags,hoff,ident,special,slots,limit=fields;hs,ht,plat,shift=struct.unpack_from('>4B',sig,off+36);assert ht==2 and hs==32 and hoff+slots*32<=n and hoff-special*32>=0 and slots==(limit+(1<<shift)-1)//(1<<shift)
  bad=sum(sig[off+hoff+i*32:off+hoff+(i+1)*32]!=hashlib.sha256(b[i*(1<<shift):min((i+1)*(1<<shift),limit)]).digest() for i in range(slots));assert bad==0 and limit==sigoff
  dirs.append({'version':hex(ver),'flags':hex(flags),'slots':slots,'specialSlots':special,'pageBytes':1<<shift,'allCodePageHashesMatch':True})
 assert dirs;results.append({'archive':name,'signatureBytes':sigsize,'codeDirectories':dirs,'certificateTrustAndSigningInvocationNotExamined':True})
print(json.dumps(results),flush=True);(out/'signature.result.json').write_text(json.dumps(results,indent=2)+'\n')
