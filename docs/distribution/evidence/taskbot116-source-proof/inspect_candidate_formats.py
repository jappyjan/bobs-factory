from pathlib import Path
import struct,json,zipfile,hashlib
r=Path(__file__).parent;d=r/'candidate-21';results=[]
def sha(b):return hashlib.sha256(b).hexdigest()
def elf(b):
 assert b[:6]==b'\x7fELF\x02\x01';e=struct.unpack_from('<HHIQQQIHHHHHH',b,16);phoff=e[4];shoff=e[5];phsz=e[8];phnum=e[9];shsz=e[10];shnum=e[11];stridx=e[12];ph=[];sh=[]
 for i in range(phnum):v=struct.unpack_from('<II6Q',b,phoff+i*phsz);ph.append({'index':i,'offset':phoff+i*phsz,'type':v[0],'flags':v[1],'fileoff':v[2],'vaddr':v[3],'paddr':v[4],'filesz':v[5],'memsz':v[6],'align':v[7]})
 string=struct.unpack_from('<II4QII2Q',b,shoff+stridx*shsz);names=b[string[4]:string[4]+string[5]]
 for i in range(shnum):
  v=struct.unpack_from('<II4QII2Q',b,shoff+i*shsz);name=names[v[0]:].split(b'\0')[0].decode();sh.append({'index':i,'headerOffset':shoff+i*shsz,'name':name,'type':v[1],'flags':v[2],'addr':v[3],'fileoff':v[4],'size':v[5],'sha256':None if v[1]==8 else sha(b[v[4]:v[4]+v[5]])})
 return {'phoff':phoff,'shoff':shoff,'phentsize':phsz,'shentsize':shsz,'ph':ph,'sh':sh}
def macho(b):
 n=struct.unpack_from('<I',b,16)[0];p=32;cmds=[];sections=[]
 for i in range(n):
  cmd,sz=struct.unpack_from('<II',b,p);x={'cmd':cmd,'offset':p,'size':sz,'hex':b[p:p+sz].hex()}
  if cmd==0x19:
   seg=b[p+8:p+24].split(b'\0')[0].decode();vm,vms,fo,fs=struct.unpack_from('<4Q',b,p+24);ns=struct.unpack_from('<I',b,p+64)[0];x.update(segment=seg,vaddr=vm,vmsize=vms,fileoff=fo,filesize=fs)
   for j in range(ns):
    q=p+72+j*80;name=b[q:q+16].split(b'\0')[0].decode();ss=b[q+16:q+32].split(b'\0')[0].decode();addr,length,off=struct.unpack_from('<QQI',b,q+32);fl=struct.unpack_from('<I',b,q+64)[0];sections.append({'headerOffset':q,'segment':ss,'name':name,'addr':addr,'size':length,'fileoff':off,'flags':fl,'sha256':None if (fl&255) in (1,12,18) else sha(b[off:off+length])})
  if cmd==0x1d:x.update(dataoff=struct.unpack_from('<I',b,p+8)[0],datasize=struct.unpack_from('<I',b,p+12)[0])
  cmds.append(x);p+=sz
 return {'commands':cmds,'sections':sections}
for target in ['darwin-arm64','darwin-x64','linux-x64','linux-arm64']:
 basepath=r/'prior-research/darwin-arm64-release-bun.zip' if target=='darwin-arm64' else r/'official-runtime-and-caches'/('release-bun-'+target.replace('linux-arm64','linux-aarch64')+'.zip')
 with zipfile.ZipFile(basepath) as z:base=z.read(next(n for n in z.namelist() if n.endswith('/bun')))
 (d/(target+'-published-base')).write_bytes(base);factory=(d/(target+'-factory-executable')).read_bytes();parse=macho if target.startswith('darwin') else elf;bs=parse(base);fs=parse(factory);results.append({'target':target,'baseSha256':sha(base),'factorySha256':sha(factory),'baseSize':len(base),'factorySize':len(factory),'base':bs,'factory':fs})
 if target.startswith('darwin'):
  for a,b in zip(bs['commands'],fs['commands']):
   if a['hex']!=b['hex']:print(target,'changedcmd',hex(a['cmd']),a.get('segment'),a['offset'])
  print('BUN',next(s for s in bs['sections'] if s['segment']=='__BUN'),next(s for s in fs['sections'] if s['segment']=='__BUN'))
 else:
  print(target,'bun',next(s for s in bs['sh'] if s['name']=='.bun'),next(s for s in fs['sh'] if s['name']=='.bun'))
(d/'FORMAT_INSPECTION.json').write_text(json.dumps(results,indent=2)+'\n')
