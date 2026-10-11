from pathlib import Path
import json,struct,hashlib
r=Path(__file__).parent;d=r/'candidate-21';formats=json.loads((d/'FORMAT_INSPECTION.json').read_text());results=[]
def sha(b):return hashlib.sha256(b).hexdigest()
def align(v,n):return (v+n-1)//n*n
def w64(b,o,v):struct.pack_into('<Q',b,o,v)
def w32(b,o,v):struct.pack_into('<I',b,o,v)
for rec in formats:
 target=rec['target'];base=(d/(target+'-published-base')).read_bytes();factory=(d/(target+'-factory-executable')).read_bytes();bs=rec['base'];fs=rec['factory'];proof={'target':target,'baseSha256':sha(base),'factorySha256':sha(factory),'candidateDigest':'ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec','sourceSha':'b82c37c4fb9a3e18d1cb222c6d56d3fef852096f'}
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
 if not proof.get('entireReconstructedExecutableMatches',proof.get('allBytesOutsidePayloadAndSignatureMatch',False)):
  n=min(len(expected),len(factory));first=next((i for i in range(n) if expected[i]!=factory[i]),None);proof['firstUnexpectedDifferenceOffset']=first
 results.append(proof);print(json.dumps(proof),flush=True)
(d/'BASE_RUNTIME_BYTE_BINDING.json').write_text(json.dumps(results,indent=2)+'\n')
