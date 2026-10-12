"""Static bounded ELF64/Mach-O inspection; never loads or executes application bytes."""
import struct

def elf(b):
 assert b[:6]==b'\x7fELF\x02\x01';phoff=struct.unpack_from('<Q',b,32)[0];shoff=struct.unpack_from('<Q',b,40)[0];phsize,phcount,shsize,shcount,strings=struct.unpack_from('<5H',b,54);assert phsize==56 and shsize==64 and phcount<4096 and shcount<65536
 assert phoff+phsize*phcount<=len(b) and shoff+shsize*shcount<=len(b)
 ph=[]
 for i in range(phcount):
  o=phoff+i*phsize;t,f,fo,va,pa,fs,ms,al=struct.unpack_from('<II6Q',b,o);ph.append({'offset':o,'type':t,'flags':f,'fileoff':fo,'vaddr':va,'filesz':fs,'memsz':ms})
 rows=[]
 for i in range(shcount):
  o=shoff+i*shsize;name,t,fl,va,fo,sz,link,info,al,ents=struct.unpack_from('<II4QII2Q',b,o);rows.append({'index':i,'headerOffset':o,'nameOffset':name,'type':t,'flags':fl,'addr':va,'fileoff':fo,'size':sz})
 assert strings<len(rows);s=rows[strings];names=b[s['fileoff']:s['fileoff']+s['size']]
 for x in rows:
  n=x.pop('nameOffset');assert n<len(names);end=names.find(b'\0',n);assert end>=n;x['name']=names[n:end].decode()
 return {'phoff':phoff,'shoff':shoff,'ph':ph,'sh':rows}

def macho(b):
 assert struct.unpack_from('<I',b)[0]==0xfeedfacf;n,sz=struct.unpack_from('<II',b,16);assert n<4096 and 32+sz<=len(b);o=32;commands=[];sections=[]
 for _ in range(n):
  cmd,size=struct.unpack_from('<II',b,o);assert size>=8 and o+size<=32+sz;c={'cmd':cmd,'offset':o,'size':size}
  if cmd==0x19:
   assert size>=72;seg=b[o+8:o+24].split(b'\0')[0].decode();va,vs,fo,fs=struct.unpack_from('<4Q',b,o+24);maxp,initp,count,flags=struct.unpack_from('<4I',b,o+56);assert 72+80*count<=size;c.update(segment=seg,vaddr=va,vmsize=vs,fileoff=fo,filesize=fs)
   for i in range(count):
    q=o+72+i*80;name=b[q:q+16].split(b'\0')[0].decode();segment=b[q+16:q+32].split(b'\0')[0].decode();addr,l=struct.unpack_from('<QQ',b,q+32);off=struct.unpack_from('<I',b,q+48)[0];sections.append({'name':name,'segment':segment,'headerOffset':q,'addr':addr,'size':l,'fileoff':off})
  elif cmd==0x1d:
   assert size==16;off,l=struct.unpack_from('<II',b,o+8);assert off+l<=len(b);c.update(dataoff=off,datasize=l)
  commands.append(c);o+=size
 assert o==32+sz
 return {'commands':commands,'sections':sections}

# Source: retained Taskbot116 full-byte Bun1.4.2 correspondence check. This
# observes the permitted pinned compiler transformation; it never executes input.
from pathlib import Path
import hashlib,json,sys,stat

def sha(b):return hashlib.sha256(b).hexdigest()
def align(v,n):return (v+n-1)//n*n
def w64(b,o,v):struct.pack_into('<Q',b,o,v)
def w32(b,o,v):struct.pack_into('<I',b,o,v)
def bind(target,base_path,factory_path):
 for p in [base_path,factory_path]:
  st=p.lstat();assert stat.S_ISREG(st.st_mode) and st.st_nlink==1 and 0<st.st_size<512*1024**2
 base=base_path.read_bytes();factory=factory_path.read_bytes()
 parse=elf if target.startswith('linux') else macho
 bs=parse(base);fs=parse(factory);proof={'target':target,'baseSha256':sha(base),'factorySha256':sha(factory)}
 if target.startswith('linux'):
  bun=next(s for s in bs['sh'] if s['name']=='.bun');fbun=next(s for s in fs['sh'] if s['name']=='.bun');loads=[p for p in bs['ph'] if p['type']==1];rw=next(p for p in loads if p['flags']&2 and p['vaddr']<=bun['addr']<p['vaddr']+p['memsz']);page=65536 if target=='linux-arm64' else 4096;nv=align(max(p['vaddr']+p['memsz'] for p in loads),page);no=rw['fileoff']+nv-rw['vaddr'];length=struct.unpack_from('<Q',factory,no)[0];payload=factory[no+8:no+8+length];assert no==fbun['fileoff'] and nv==fbun['addr'] and length+8==fbun['size'];asz=align(length+8,page);start=rw['fileoff']+rw['filesz'];dst=no+asz;delta=dst-start
  expected=bytearray(base[:start]+bytes(no-start)+struct.pack('<Q',length)+payload+bytes(asz-8-length)+base[start:]);w64(expected,40,bs['shoff']+delta);w64(expected,bun['fileoff'],nv)
  for s in bs['sh']:
   off=s['headerOffset']+delta
   if s['index']==bun['index']:w64(expected,off+16,nv);w64(expected,off+24,no);w64(expected,off+32,length+8)
   elif s['type']!=8 and start<=s['fileoff']<len(base):w64(expected,off+24,s['fileoff']+delta)
  w64(expected,rw['offset']+32,nv-rw['vaddr']+asz);w64(expected,rw['offset']+40,nv-rw['vaddr']+asz)
  # Source normalize_interpreter is observed separately: only permit its documented PT_INTERP rewrite when needed.
  interp=next((p for p in bs['ph'] if p['type']==3),None);interpreter=base[interp['fileoff']:interp['fileoff']+interp['filesz']] if interp else None
  proof.update(payloadOffset=no,payloadLength=length,payloadSha256=sha(payload),runtimePrefixBytes=start,relocatedTailBytes=len(base)-start,tailShiftBytes=delta,interpreter=interpreter.decode('ascii','replace') if interpreter else None,expectedExecutableSha256=sha(expected),entireReconstructedExecutableMatches=bytes(expected)==factory,allowedTransformSource='src/exe_format/elf.rs:211-429; complete deterministic data injection, pointer/ELF header relocation and PT_LOAD growth')
 else:
  bunseg=next(c for c in bs['commands'] if c.get('segment')=='__BUN');bun=next(s for s in bs['sections'] if s['segment']=='__BUN');fbun=next(s for s in fs['sections'] if s['segment']=='__BUN');sc=next(c for c in bs['commands'] if c['cmd']==0x1d);fsc=next(c for c in fs['commands'] if c['cmd']==0x1d);le=next(c for c in bs['commands'] if c.get('segment')=='__LINKEDIT');fo=bun['fileoff'];length=struct.unpack_from('<Q',factory,fo)[0];assert fbun['size']==length+8;payload=factory[fo+8:fo+8+length];asz=align(length+8,16384);delta=asz-bunseg['filesize'];expected=bytearray(base[:fo]+struct.pack('<Q',length)+payload+bytes(asz-length-8)+base[fo+bunseg['filesize']:]);bp=bunseg['offset'];w64(expected,bp+32,asz);w64(expected,bp+48,asz);w32(expected,bp+56,3);w32(expected,bp+60,3);q=bun['headerOffset'];w64(expected,q+40,length+8);w32(expected,q+52,14);w32(expected,q+56,0);w32(expected,q+60,0);w32(expected,q+64,0x10000000);w32(expected,q+68,0);w32(expected,q+72,0);w32(expected,q+76,0)
  lp=le['offset'];w64(expected,lp+24,le['vaddr']+delta);w64(expected,lp+40,le['fileoff']+delta);sigsize=sc['datasize']
  if target=='darwin-arm64':
   sigsize=fsc['datasize'];newsize=le['filesize']-sc['datasize']+sigsize;w64(expected,lp+48,newsize);w64(expected,lp+32,align(newsize,4096))
  for c in bs['commands']:
   cmd=c['cmd'];p=c['offset'];offsets=[]
   if cmd==2:offsets=[8,16]
   elif cmd==0xb:offsets=[32,40,48,56,64,72]
   elif cmd in [0x80000034,0x80000033,0x1d,0x26,0x29,0x2b,0x2e]:offsets=[8]
   elif cmd in [0x22,0x80000022]:offsets=[8,16,24,32,40]
   for off in offsets:
    value=struct.unpack_from('<I',expected,p+off)[0]
    if value>=align(fo,4096):w32(expected,p+off,value+delta)
   if cmd==0x1d:w32(expected,p+12,sigsize)
  sigoff=sc['dataoff']+delta;assert sigoff==fsc['dataoff'];prefixequal=expected[:sigoff]==factory[:sigoff];proof.update(payloadOffset=fo,payloadLength=length,payloadSha256=sha(payload),bunGrowthBytes=delta,signatureOffset=sigoff,expectedPrefixSha256=sha(expected[:sigoff]),actualPrefixSha256=sha(factory[:sigoff]),allBytesOutsidePayloadAndSignatureMatch=prefixequal,allowedTransformSource='src/exe_format/macho.rs:91-345,353-484; exact BUN growth/section metadata and LINKEDIT offsets; ARM64 build_and_sign:518-525')
  if target=='darwin-x64':proof.update(entireReconstructedExecutableMatches=bytes(expected)==factory,expectedExecutableSha256=sha(expected),originalSignatureBytesPreserved=base[sc['dataoff']:]==factory[sigoff:])
  else:
   sig=factory[sigoff:];magic,sz,count=struct.unpack_from('>III',sig);typ,off=struct.unpack_from('>II',sig,12);cmagic,csize,ver,flags,hoff,ident,special,slots,limit=struct.unpack_from('>9I',sig,off);hsize,htype,platform,pageshift=struct.unpack_from('>4B',sig,off+36);assert count==1 and special==0 and pageshift==12 and hsize==32 and htype==2 and limit==sigoff
   pagehashes=all(sig[off+hoff+32*i:off+hoff+32*(i+1)]==hashlib.sha256(factory[i*4096:min((i+1)*4096,sigoff)]).digest() for i in range(slots));proof.update(signatureSize=len(sig),signatureIdentifier=sig[off+ident:].split(b'\0')[0].decode(),signatureFlags=hex(flags),signaturePages=slots,allAdHocSignatureCodePageHashesMatch=pagehashes,signatureStructureBytes=sz,signatureTrailingBytes=len(sig)-sz,signatureSizeMatchesSourceFormula=sz==12+8+88+6+slots*32 and len(sig)==sz)
   text=next(c for c in fs['commands'] if c.get('segment')=='__TEXT');metadata=bytearray(88);struct.pack_into('>9I',metadata,0,0xfade0c02,len(sig)-20,0x20400,0x20002,94,88,0,slots,sigoff);struct.pack_into('>4B',metadata,36,32,2,0,12);struct.pack_into('>3Q',metadata,64,0,align(text['filesize'],4096),1);assert sig[20:108]==metadata and sig[:20]==struct.pack('>5I',0xfade0cc0,len(sig),1,0,20) and sig[108:114]==b'a.out\0';proof.update(allSignatureMetadataBytesMatchPinnedSignerFields=True,completeSignatureAccountedForByVerifiedMetadataAndPageHashes=True)

 assert proof.get('entireReconstructedExecutableMatches',proof.get('allBytesOutsidePayloadAndSignatureMatch',False)), 'Uncovered Bun runtime bytes; update accepted source baseline'
 if target=='darwin-arm64':assert proof['completeSignatureAccountedForByVerifiedMetadataAndPageHashes'] and proof['allAdHocSignatureCodePageHashesMatch']
 return proof
if __name__=='__main__':
 assert len(sys.argv)==4
 print(json.dumps(bind(sys.argv[1],Path(sys.argv[2]),Path(sys.argv[3]))))
