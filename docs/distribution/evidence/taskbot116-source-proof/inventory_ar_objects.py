from pathlib import Path
import gzip,json,hashlib,time
r=Path(__file__).parent;records=[]
for p in sorted((r/'prior-research').glob('*libbun*.a.gz')):
 members=[];names=b''
 with gzip.open(p,'rb') as f:
  assert f.read(8)==b'!<arch>\n'
  while True:
   header=f.read(60)
   if not header:break
   assert len(header)==60 and header[58:]==b'`\n';name=header[:16].decode().strip();size=int(header[48:58]);b=f.read(size);assert len(b)==size
   if size%2:assert len(f.read(1))==1
   if name=='//':names=b;continue
   if name in ['/','/SYM64/']:continue
   if name.startswith('#1/'):
    n=int(name[3:]);name=b[:n].rstrip(b'\0').decode();b=b[n:]
   elif name.startswith('/') and name[1:].isdigit():name=names[int(name[1:]):].split(b'/\n')[0].decode()
   else:name=name.rstrip('/')
   members.append({'name':name,'size':len(b),'sha256':hashlib.sha256(b).hexdigest(),'magic':b[:8].hex()})
 rec={'file':p.name,'memberCount':len(members),'objectBytes':sum(x['size'] for x in members),'members':members};records.append(rec);print(p.name,len(members),'matchingnames',[x['name'] for x in members if any(y in x['name'].lower() for y in ['tinycc','tcc','sqlite','zstd','uv'])][:20],flush=True)
(r/'GENUINE_AR_MEMBER_INVENTORIES.json').write_text(json.dumps(records,indent=2)+'\n')
