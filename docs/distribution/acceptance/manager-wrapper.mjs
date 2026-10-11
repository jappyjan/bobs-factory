// Render the exact gated manager wrapper used by native acceptance.
export const managerWrapper = (real) => `#!${process.execPath}
const {execFileSync,spawn}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const args=process.argv.slice(2), gate=process.env.BOBS_FACTORY_ACCEPTANCE_MANAGER_GATE;
const real=${JSON.stringify(real)};
if(gate && (args.includes('daemon-reload') || args.includes('start'))) {
  if(args.includes('start')) execFileSync(real,[...args,'--no-block']);
  const script="setTimeout(()=>{require('node:fs').writeFileSync(process.argv[1],'escaped');require('node:child_process').execFileSync(process.argv[2],JSON.parse(process.argv[3]));},500);";
  spawn(process.execPath,['-e',script,process.env.BOBS_FACTORY_ACCEPTANCE_LATE_MUTATION,real,JSON.stringify(args)],{stdio:'ignore'});
  writeFileSync(gate,JSON.stringify(args));
  setInterval(()=>{},1000);
} else {
  try { process.stdout.write(execFileSync(real,args,{encoding:'utf8'})); }
  catch(e) { process.stdout.write(String(e.stdout ?? '')); process.stderr.write(String(e.stderr ?? '')); process.exit(Number.isInteger(e.status) ? e.status : 1); }
}
`;
