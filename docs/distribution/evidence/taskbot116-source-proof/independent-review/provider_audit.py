import pathlib,json,subprocess,hashlib,zipfile,urllib.request
R=pathlib.Path('/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/source-inputs');OUT=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def api(endpoint):return json.loads(subprocess.check_output(['gh','api',endpoint],timeout=30))
results=[]
for repo,tag,subdir,names in [('oven-sh/bun','bun-v1.4.2','official-runtime-and-caches',['bun-darwin-x64.zip','bun-linux-x64.zip','bun-linux-aarch64.zip']),('oven-sh/WebKit','autobuild-2e2aa2290fac856d6f451ceacb58f7f5b44dd057','official-runtime-and-caches',['bun-webkit-linux-amd64-lto.tar.gz','bun-webkit-linux-arm64-lto.tar.gz','bun-webkit-macos-amd64-lto.tar.gz','bun-webkit-macos-arm64-lto.tar.gz'])]:
 j=api(f'repos/{repo}/releases/tags/{tag}');(OUT/(tag+'.provider.json')).write_text(json.dumps(j,indent=2)+'\n');assert not j['draft'];assets={a['name']:a for a in j['assets']}
 if repo=='oven-sh/bun':names=names+['bun-darwin-aarch64.zip']
 for n in names:
  p=R/'prior-research/darwin-arm64-release-bun.zip' if n=='bun-darwin-aarch64.zip' else R/subdir/(('release-'+n) if repo=='oven-sh/bun' else n)
  # Published mac ARM filename is architecture-spelled aarch64 upstream.
  if n not in assets and n=='bun-darwin-aarch64.zip':n='bun-darwin-aarch64.zip'
  a=assets[n];b=p.read_bytes();assert len(b)==a['size'] and a['digest']=='sha256:'+sha(b)
  results.append({'repo':repo,'tag':tag,'asset':n,'id':a['id'],'sha256':sha(b),'size':len(b),'liveProviderDigestMatches':True})
run=api('repos/jappyjan/bobs-factory/actions/runs/38086228778');assert run['head_sha']=='b82c37c4fb9a3e18d1cb222c6d56d3fef852096f' and run['conclusion']=='success' and run['run_attempt']==1;(OUT/'candidate-run.provider.json').write_text(json.dumps(run,indent=2)+'\n')
ref=api('repos/oven-sh/bun/git/ref/tags/bun-v1.4.2');obj=ref['object']
if obj['type']=='tag':obj=api('repos/oven-sh/bun/git/tags/'+obj['sha'])['object']
assert obj['type']=='commit' and obj['sha']=='744846f844374847c902b5e7fd59b4342a51ef99'
# Independent current public Buildkite artifact catalogs, same upstream jobs as retained proof.
retained=json.loads((R/'prior-research/all-four-upstream-artifacts.json').read_text());bk=[]
for rec in retained:
 url=f"https://buildkite.com/organizations/bun/pipelines/bun/builds/110323/jobs/{rec['job']}/artifacts.json"
 request=urllib.request.Request(url,headers={'User-Agent':'Taskbot116-independent-source-review'})
 with urllib.request.urlopen(request,timeout=30) as response:data=json.load(response)
 (OUT/(rec['target']+'.buildkite-provider.json')).write_text(json.dumps(data,indent=2)+'\n')
 bk.append({'target':rec['target'],'url':url,'returnedType':type(data).__name__,'returnedKeys':list(data) if isinstance(data,dict) else None})
result={'result':'PASS','publishedRuntimeAndCacheAssets':results,'nativeRunSourceAndAttemptMatch':True,'officialBunTagCommitMatch':True,'buildkiteCatalogResponses':bk};(OUT/'provider.result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
