import os,subprocess,time,signal,resource,json,shutil
from pathlib import Path
root=Path(__file__).parent; repo=root/'webkit-complete.git'; sha='2e2aa2290fac856d6f451ceacb58f7f5b44dd057';GiB=1024**3
assert not repo.exists(), 'new owned destination must be absent'
subprocess.run(['git','init','--bare',str(repo)],check=True,stdout=subprocess.DEVNULL)
def limits():resource.setrlimit(resource.RLIMIT_FSIZE,(24*GiB,24*GiB))
env=dict(os.environ,GIT_NO_LAZY_FETCH='1',GIT_TERMINAL_PROMPT='0')
cmd=['git','-c','pack.threads=2','-c','gc.auto=0','-C',str(repo),'fetch','--depth=1','--no-tags','--no-auto-maintenance','--progress','https://github.com/oven-sh/WebKit.git',sha]
t=time.monotonic();reason=None
with (root/'webkit-full-fetch.log').open('wb') as log:
 p=subprocess.Popen(cmd,stdout=log,stderr=log,env=env,start_new_session=True,preexec_fn=limits)
 while p.poll() is None:
  total=0;largest=0
  for base,dirs,files in os.walk(root):
   for name in files:
    try:n=os.stat(os.path.join(base,name)).st_size;total+=n;largest=max(largest,n)
    except FileNotFoundError:pass
  elapsed=time.monotonic()-t;free=shutil.disk_usage(root).free
  print(json.dumps({'pid':p.pid,'elapsedSeconds':round(elapsed,1),'ownedBytes':total,'largestFileBytes':largest,'freeBytes':free}),flush=True)
  if elapsed>1800:reason='30 minute fetch deadline'
  elif total>32*GiB:reason='32 GiB total owned retrieval limit'
  elif largest>24*GiB:reason='24 GiB per-pack limit'
  elif free<100*GiB:reason='100 GiB free-space floor'
  if reason:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
   break
  time.sleep(5)
 result={'command':cmd,'revision':sha,'source':'https://github.com/oven-sh/WebKit.git','exitCode':p.returncode,'elapsedSeconds':time.monotonic()-t,'stopReason':reason,'limits':{'totalGiB':32,'packGiB':24,'minutes':30,'minimumFreeGiB':100}}
 (root/'WEBKIT_FETCH_RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
