from pathlib import Path
import struct,json,zipfile,hashlib,subprocess
r=Path(__file__).parent;d=r/'official-runtime-and-caches';out=r/'runtime-correspondence';out.mkdir(exist_ok=True);results=[]
def sha(b):return hashlib.sha256(b).hexdigest()
def macho(b):
 magic,cpu,sub,typ,ncmd,sizecmd,flags,res=struct.unpack_from('<8I',b);assert magic==0xfeedfacf;sections=[];commands=[];pos=32
 for i in range(ncmd):
  cmd,sz=struct.unpack_from('<II',b,pos);rec={'cmd':hex(cmd),'offset':pos,'size':sz,'sha256':sha(b[pos:pos+sz])}
  if cmd==0x19:
   seg=b[pos+8:pos+24].split(b'\0')[0].decode();vm,vms,off,n=struct.unpack_from('<QQQQ',b,pos+24);ns=struct.unpack_from('<I',b,pos+64)[0];rec.update(segment=seg,fileoff=off,filesize=n,vmsize=vms)
   for j in range(ns):
    q=pos+72+j*80;name=b[q:q+16].split(b'\0')[0].decode();sn=b[q+16:q+32].split(b'\0')[0].decode();addr,length,offset=struct.unpack_from('<QQI',b,q+32);sf=struct.unpack_from('<I',b,q+64)[0];zero=(sf&255) in (1,12,18);sections.append({'segment':sn,'name':name,'address':addr,'size':length,'offset':offset,'flags':sf,'zeroFill':zero,'sha256':None if zero else sha(b[offset:offset+length])})
  elif cmd==0x1d:
   off,n=struct.unpack_from('<II',b,pos+8);rec.update(dataoff=off,datasize=n,signatureSha256=sha(b[off:off+n]))
  commands.append(rec);pos+=sz
 return {'commands':commands,'sections':sections,'ncmds':ncmd,'sizeofcmds':sizecmd}
for target in ['linux-aarch64','linux-x64','darwin-x64']:
 pair=[];binary=[]
 for kind in ['buildkite','release']:
  z=d/f'{kind}-bun-{target}.zip'
  with zipfile.ZipFile(z) as f:
   names=[n for n in f.namelist() if n.endswith('/bun')];assert len(names)==1;b=f.read(names[0]);features=[n for n in f.namelist() if n.endswith('features.json')]
   for n in features:(out/f'{kind}-{target}-features.json').write_bytes(f.read(n))
  rec={'kind':kind,'archive':z.name,'archiveSha256':sha(z.read_bytes()),'archiveSize':z.stat().st_size,'executableSha256':sha(b),'executableSize':len(b),'featuresFiles':features};binary.append(b)
  if target.startswith('darwin'):
   q=out/f'{kind}-{target}-bun';q.write_bytes(b);rec.update(macho(b));c=subprocess.run(['codesign','-dvvv',str(q)],capture_output=True,text=True);(out/f'{kind}-{target}-codesign.txt').write_text(c.stdout+c.stderr)
  pair.append(rec)
 res={'target':target,'inputs':pair,'executableBytesEqual':binary[0]==binary[1],'archiveBytesEqual':pair[0]['archiveSha256']==pair[1]['archiveSha256']}
 if target.startswith('darwin'):
  res['allSectionsEqual']=pair[0]['sections']==pair[1]['sections'];res['commandDifferences']=[{'buildkite':a,'release':b} for a,b in zip(pair[0]['commands'],pair[1]['commands']) if a!=b];res['extraReleaseCommands']=pair[1]['commands'][len(pair[0]['commands']):]
  a,b=map(bytearray,binary);masks=[]
  for x,rec in zip([a,b],pair):
   mask=[(16,8)]
   for c in rec['commands']:
    if c.get('segment')=='__LINKEDIT':mask.extend([(c['offset']+32,8),(c['offset']+48,8)])
    if c['cmd']=='0x1d':mask.append((c['offset'],c['size']))
   for off,n in mask:x[off:off+n]=bytes(n)
   masks.append(mask)
  sig=next(c for c in pair[1]['commands'] if c['cmd']=='0x1d');prefix=min(len(a),sig['dataoff']);res['normalizedCommonPrefix']={'length':prefix,'masks':masks,'buildkiteSha256':sha(a[:prefix]),'releaseSha256':sha(b[:prefix]),'equal':a[:prefix]==b[:prefix],'signatureDataOffset':sig['dataoff'],'buildkiteTailToSignaturePaddingBytes':sig['dataoff']-len(a),'releasePaddingAllZero':all(x==0 for x in b[len(a):sig['dataoff']])}
 results.append(res);print(target,'executableEqual',res['executableBytesEqual'],'allSectionsEqual',res.get('allSectionsEqual'),'normalizedPrefix',res.get('normalizedCommonPrefix'),flush=True)
(out/'ALL_TARGET_RUNTIME_COMPARISON.json').write_text(json.dumps(results,indent=2)+'\n')
