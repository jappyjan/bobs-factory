import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const evidence = process.env.F1_EVIDENCE_DIR;
const { keys, origin } = JSON.parse(
	readFileSync(join(evidence, "notification-fixture.json")),
);
const session = "notifications-manual-0e797e70";
const cli = (...args) =>
	execFileSync("agent-browser", ["--session", session, ...args], {
		encoding: "utf8",
	});
const evaluate = (source) =>
	JSON.parse(cli("eval", "--json", source)).data.result;
const poll = (source) =>
	evaluate(
		`(async () => { for (let n=0;n<100;n++) { if (${source}) return true; await new Promise(r=>setTimeout(r,100)); } throw new Error('Timed out: '+${JSON.stringify(source)}); })()`,
	);
const click = (name) =>
	cli("find", "role", "button", "click", "--name", name, "--exact");
const label = (value) => cli("find", "label", "Device label", "fill", value);
const route = (path) => evaluate(`location.hash=${JSON.stringify(path)}`);
const check = (name, condition = true) => {
	assert(condition, name);
	checks.push(name);
	console.log("PASS " + name);
};
const checks = [];
cli("--headed", "false", "open", origin + "/#/settings/notifications");
poll(`document.querySelector('h2')?.textContent === 'Notifications'`);
check(
	"Direct route renders inline with active Settings navigation and no header entry",
	evaluate(
		`!document.querySelector('[role=dialog]') && ![...document.querySelectorAll('header button')].some(b=>b.textContent==='Notifications') && !!document.querySelector('a[href="#/settings/notifications"][aria-current=page]')`,
	),
);
cli("reload");
poll(`document.querySelector('h2')?.textContent === 'Notifications'`);
check("Reload preserves Notifications route");
// Controlled browser push API; protected Factory APIs and recording sender remain real.
evaluate(`(() => {
 window.fixture = { permission:'denied', requests:0, subscribe:0, unsubscribe:0, subscription:null, realFetch:window.fetch.bind(window) };
 Object.defineProperty(Notification,'permission',{configurable:true,get:()=>fixture.permission});
 Notification.requestPermission=()=>{fixture.requests++; fixture.userActivation=navigator.userActivation.isActive; return Promise.resolve(fixture.permission)};
 const manager = {
 getSubscription:async()=>fixture.subscription,
 subscribe:async(options)=>{fixture.subscribe++; const status=await (await fixture.realFetch('/api/push')).json(); fixture.subscription={options:{applicationServerKey:options.applicationServerKey},toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture-browser',keys:${JSON.stringify(keys)}}),unsubscribe:async()=>{fixture.unsubscribe++;fixture.subscription=null;return true}}; return fixture.subscription; }
 };
 navigator.serviceWorker.getRegistration=async()=>({active:{},pushManager:manager});
 window.dispatchEvent(new Event('online'));
})()`);
poll(`document.body.innerText.includes('Permission: denied')`);
check(
	"Denied permission visible without requesting consent",
	evaluate("fixture.requests === 0"),
);
click("Enable this device");
poll(`document.body.innerText.includes('Notifications are not allowed')`);
check(
	"Enable requests permission in direct click and displays denial",
	evaluate(
		"fixture.requests===1 && fixture.userActivation && fixture.subscribe===0",
	),
);
evaluate(
	`fixture.permission='granted'; window.dispatchEvent(new Event('online'));`,
);
label("Saved device");
click("Enable this device");
poll(`document.body.innerText.includes('This device: Enabled')`);
check(
	"Explicit enable registers saved label and consent",
	evaluate(
		`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut===false && document.body.innerText.includes('Saved device')`,
	),
);
click("Send test");
poll(
	`document.querySelector('[role=status]')?.textContent.includes('accepted') || document.body.innerText.includes('accepted by')`,
);
check("Test send uses recording sender and displays acceptance");
label("Unsent edit");
route("/settings/capacity");
poll(`document.querySelector('h2')?.textContent==='Instance capacity'`);
route("/settings/notifications");
poll(`document.querySelector('input')?.value==='This browser'`);
check(
	"Switching Settings sections discards label draft and retains saved consent",
	evaluate(
		`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut===false`,
	),
);
label("Preserved edit");
evaluate(`window.dispatchEvent(new Event('storage'));`);
poll(`document.body.innerText.includes('This device: Enabled')`);
check(
	"Ordinary refresh preserves draft",
	evaluate(`document.querySelector('input').value==='Preserved edit'`),
);
evaluate(
	`(async()=>{fixture.build=(await(await fetch('/api/version')).json()).build})()`,
);
// Delay a test response until after the original form has left.
evaluate(
	`window.fetch=(input,options)=>String(input).endsWith('/test') ? new Promise(resolve=>{fixture.finish=()=>resolve(new Response(JSON.stringify({error:'Old form error'}),{status:400,headers:{'Content-Type':'application/json','X-Factory-Build':fixture.build}}))}) : fixture.realFetch(input,options)`,
);
click("Send test");
poll("!!fixture.finish");
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
route("/settings/notifications");
poll(`document.querySelector('input')?.value==='This browser'`);
label("New form draft");
evaluate(`fixture.finish(); window.fetch=fixture.realFetch;`);
evaluate(`(async()=>{await new Promise(r=>setTimeout(r,400));return true})()`);
check(
	"Delayed old action cannot overwrite replacement draft or error",
	evaluate(
		`document.querySelector('input').value==='New form draft' && !document.body.innerText.includes('Old form error')`,
	),
);
// Create another browser device through the real API, then exercise its controls.
const longLabel = "Remote device " + "X".repeat(65);
evaluate(
	`(async()=>{const version=await(await fetch('/api/version')).json(); fixture.build=version.build; const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-remote',keys:${JSON.stringify(keys)}}; fixture.remote=await(await fetch('/api/push/devices',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Request':'1','X-Factory-Build':version.build},body:JSON.stringify({label:${JSON.stringify(longLabel)},subscription:sub})})).json(); window.dispatchEvent(new Event('online'));})()`,
);
poll(`document.body.innerText.includes(${JSON.stringify(longLabel)})`);
cli("set", "viewport", "1440", "1000");
cli("screenshot", join(evidence, "notifications-desktop.png"), "--full");
cli("set", "viewport", "390", "844");
cli("screenshot", join(evidence, "notifications-mobile.png"), "--full");
check(
	"Narrow layout has no horizontal clipping with long device label",
	evaluate(
		`document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.notifications-settings button')].every(b=>b.getBoundingClientRect().right <= innerWidth)`,
	),
);
evaluate(
	`document.querySelectorAll('.notifications-settings button')[5].focus()`,
);
cli("press", "Enter");
poll(
	`![...document.querySelectorAll('button')].some(b=>b.textContent==='Disable '+${JSON.stringify(longLabel)})`,
);
check("Remote disable removes enabled action");
evaluate(
	`[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove '+${JSON.stringify(longLabel)}).focus()`,
);
cli("press", "Enter");
poll(`!document.body.innerText.includes(${JSON.stringify(longLabel)})`);
check("Remote removal updates list");
// Cleanup while the page is unmounted, and consent must never be restored automatically.
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
evaluate(
	`(async()=>{const id=JSON.parse(localStorage.getItem('factory-push-device-v1')).id; await fetch('/api/push/devices/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','X-Factory-Request':'1','X-Factory-Build':fixture.build},body:'{"enabled":false}'});window.dispatchEvent(new Event('storage'));})()`,
);
poll(
	`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut && !fixture.subscription`,
);
check("Storage event reconciles remote disable while on Today");
route("/settings/notifications");
poll(`document.body.innerText.includes('This device: Disabled')`);
check(
	"Returning loads authoritative status without auto-enable",
	evaluate("fixture.subscribe===1"),
);
label("Re-enabled");
click("Enable this device");
poll(`document.body.innerText.includes('This device: Enabled')`);
// Failed local disable retains cleanup, then reconnect on Today retries it.
evaluate(
	`window.fetch=(input,options)=>String(input).includes('/api/push/devices/') && options?.method==='PATCH' ? Promise.reject(new Error('Fixture offline')) : fixture.realFetch(input,options)`,
);
click("Disable this device");
poll(`document.body.innerText.includes('Fixture offline')`);
check(
	"Failed local disable stops browser and preserves deferred cleanup",
	evaluate(
		`!fixture.subscription && !!JSON.parse(localStorage.getItem('factory-push-device-v1')).cleanup`,
	),
);
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
evaluate(
	`window.fetch=fixture.realFetch; window.dispatchEvent(new Event('online'));`,
);
poll(`!JSON.parse(localStorage.getItem('factory-push-device-v1')).cleanup`);
check("Reconnect on Today completes deferred cleanup");
route("/settings/notifications");
poll(`document.body.innerText.includes('This device: Disabled')`);
// Keep enable in flight across navigation, then refresh the current page only.
evaluate(
	`window.fetch=(input,options)=>String(input)==='/api/push/devices' && options?.method==='POST' ? new Promise(resolve=>{fixture.finishEnable=async()=>resolve(await fixture.realFetch(input,options))}) : fixture.realFetch(input,options)`,
);
label("Delayed enabled device");
click("Enable this device");
poll("!!fixture.finishEnable");
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
route("/settings/notifications");
poll(`document.querySelector('input')?.value==='This browser'`);
label("Replacement draft");
evaluate(`fixture.finishEnable(); window.fetch=fixture.realFetch;`);
poll(`document.body.innerText.includes('This device: Enabled')`);
check(
	"Enable finishing after navigation refreshes status without replacing new draft",
	evaluate(`document.querySelector('input').value==='Replacement draft'`),
);
poll(`document.body.innerText.includes('This device: Enabled')`);
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
evaluate(
	`fixture.permission='denied'; window.dispatchEvent(new Event('storage'));`,
);
poll(
	`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut && !fixture.subscription`,
);
check("Permission revocation reconciles on Today without automatic re-enable");
route("/settings/notifications");
poll(`document.body.innerText.includes('This device: Disabled')`);
evaluate(
	`fixture.permission='granted'; window.dispatchEvent(new Event('storage'));`,
);
click("Enable this device");
poll(`document.body.innerText.includes('This device: Enabled')`);
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
evaluate(
	`window.fetch=async(input,options)=>{const response=await fixture.realFetch(input,options);if(String(input)!=='/api/push')return response;const data=await response.json();data.publicKey='A'+data.publicKey.slice(1);return new Response(JSON.stringify(data),{status:200,headers:response.headers})}; window.dispatchEvent(new Event('storage'));`,
);
poll(
	`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut && !fixture.subscription`,
);
check("Changed server key reconciles on Today without automatic re-enable");
evaluate(`window.fetch=fixture.realFetch;`);
route("/settings/notifications");
poll(`document.body.innerText.includes('This device: Disabled')`);
click("Enable this device");
poll(`document.body.innerText.includes('This device: Enabled')`);
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
evaluate(
	`(async()=>{const id=JSON.parse(localStorage.getItem('factory-push-device-v1')).id;await fetch('/api/push/devices/'+id,{method:'DELETE',headers:{'X-Factory-Request':'1','X-Factory-Build':fixture.build}});window.dispatchEvent(new Event('storage'));})()`,
);
poll(
	`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut && !fixture.subscription`,
);
check("Remote removal reconciles on Today without automatic re-enable");
route("/settings/notifications");
poll(`document.querySelector('input')?.value==='This browser'`);
label("Private draft");
// Trigger the same access-loss boundary as a protected API 401, with controlled auth responses.
evaluate(
	`window.fetch=(input,options)=>String(input)==='/api/push' ? Promise.resolve(new Response('{}',{status:401,headers:{'X-Factory-Build':fixture.build}})) : String(input)==='/api/auth/status' ? Promise.resolve(new Response(JSON.stringify({authenticated:false,setupRequired:false,origin:location.origin}),{headers:{'Content-Type':'application/json'}})) : fixture.realFetch(input,options); window.dispatchEvent(new Event('online'));`,
);
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
check(
	"Access loss unmounts private notification form without losing opt-out bookkeeping",
	evaluate(`JSON.parse(localStorage.getItem('factory-push-device-v1')).optOut`),
);
cli("reload");
poll(`document.querySelector('input')?.value==='This browser'`);
check("Restored access does not restore private label draft");
// Unsupported browser variant.
evaluate(
	`delete window.PushManager;window.dispatchEvent(new Event('online'));`,
);
route("/");
poll(`!document.querySelector('[aria-labelledby=notifications-settings]')`);
route("/settings/notifications");
poll(`document.body.innerText.includes('Browser support: unavailable')`);
check(
	"Unsupported browser explains availability and disables enable",
	evaluate(
		`[...document.querySelectorAll('button')].find(b=>b.textContent==='Enable this device').disabled`,
	),
);
writeFileSync(
	join(evidence, "notifications-browser-results.json"),
	JSON.stringify(
		{
			checks,
			limitations: [
				"Browser push APIs and access-loss responses are controlled. No OS notification display or physical-device background delivery is proven.",
			],
		},
		null,
		2,
	),
);
console.log(JSON.stringify({ checks: checks.length, passed: true }));
