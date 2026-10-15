import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const evidence = process.env.F1_EVIDENCE_DIR;
const fixture = JSON.parse(
	readFileSync(join(evidence, "fixture.json"), "utf8"),
);
const session = "factory-git-settings";
const cli = (...args) =>
	execFileSync("agent-browser", ["--session", session, ...args], {
		encoding: "utf8",
	});
const evaluate = (source) =>
	JSON.parse(cli("eval", "--json", source)).data.result;
const poll = (source) =>
	evaluate(
		`(async()=>{for(let n=0;n<100;n++){if(${source}) return true;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+${JSON.stringify(source)});})()`,
	);
const click = (name) =>
	cli("find", "role", "button", "click", "--name", name, "--exact");
const fill = (value) =>
	cli("find", "label", "Host SSH agent socket", "fill", value);
const checks = [];
const check = (name, condition = true) => {
	assert(condition, name);
	checks.push(name);
	console.log(`PASS ${name}`);
	writeFileSync(
		join(evidence, "browser-checks.json"),
		JSON.stringify(checks, null, 2),
	);
};
cli("--headed", "false", "open", "http://localhost:3649/#/settings/identities");
cli("reload");
poll(`document.querySelector('#host-git-identity-heading')`);
check(
	"Identity settings contain the host identity without a separate Git page",
	evaluate(
		`!!document.querySelector('a[href="#/settings/identities"][aria-current=page]') && !document.querySelector('a[href="#/settings/git"]')`,
	),
);
click("Test host SSH agent");
poll(`document.body.innerText.includes('SSH agent has no accessible keys')`);
check("Inherited empty agent reports a useful test failure");
fill(`${fixture.home}/missing.sock`);
poll(`!document.body.innerText.includes('SSH agent has no accessible keys')`);
click("Test host SSH agent");
poll(`document.body.innerText.includes('SSH agent socket is unavailable')`);
click("Save host Git agent");
poll(
	`document.querySelector('[role=alert]')?.textContent.includes('SSH agent socket is unavailable')`,
);
check(
	"Invalid socket cannot replace saved settings",
	evaluate(
		`(async()=>!(await(await fetch('/api/config')).json()).gitSettings.socket)()`,
	),
);
fill(fixture.socket);
click("Test host SSH agent");
poll(
	`document.body.innerText.includes('Connected to SSH agent: 1 key available')`,
);
check(
	"Selected agent test finds the fixture signing key without saving",
	evaluate(
		`(async()=>!(await(await fetch('/api/config')).json()).gitSettings.socket)()`,
	),
);
click("Save host Git agent");
poll(`document.body.innerText.includes('(saved in Factory)')`);
check(
	"Save applies immediately",
	evaluate(
		`(async()=>(await(await fetch('/api/config')).json()).gitSettings.socket===${JSON.stringify(fixture.socket)})()`,
	),
);
cli("reload");
poll(
	`document.querySelector('#host-git-identity-heading') && document.querySelector('input')?.value===${JSON.stringify(fixture.socket)}`,
);
check("Saved socket survives reload");
cli("set", "viewport", "1440", "1000");
cli("screenshot", join(evidence, "git-settings-desktop.png"));
cli("set", "viewport", "390", "844");
check(
	"Identity settings fit a narrow viewport",
	evaluate(`document.documentElement.scrollWidth <= innerWidth`),
);
cli("screenshot", "--full", join(evidence, "git-settings-mobile.png"));
cli("set", "viewport", "1440", "1000");
fill(`${fixture.home}/unsaved.sock`);
evaluate(`location.hash='/settings/capacity'`);
poll(`document.querySelector('#machine-capacity')`);
evaluate(`location.hash='/settings/identities'`);
poll(
	`document.querySelector('#host-git-identity-heading') && document.querySelector('input')?.value===${JSON.stringify(fixture.socket)}`,
);
check("Navigation discards unsaved socket edits");
evaluate(`location.hash=${JSON.stringify(`/runs/${fixture.runId}`)}`);
poll(
	`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Retry step'))`,
);
cli("find", "role", "button", "click", "--name", "Retry step");
poll(
	`(await(await fetch('/api/runs/${fixture.runId}?view=dashboard')).json()).status==='completed'`,
);
check(
	"Retained failed run completes after UI retry without restarting Factory",
);
const commit = execFileSync(
	"git",
	["-C", fixture.workspace, "cat-file", "commit", "HEAD"],
	{ encoding: "utf8" },
);
check(
	"Recovered run writes a signed commit",
	commit.includes("gpgsig -----BEGIN SSH SIGNATURE-----"),
);
const signers = join(evidence, "allowed-signers");
writeFileSync(
	signers,
	`f1@example.invalid ${readFileSync(join(fixture.home, "signing-key.pub"), "utf8").trim()}\n`,
);
execFileSync(
	"git",
	[
		"-C",
		fixture.workspace,
		"-c",
		`gpg.ssh.allowedSignersFile=${signers}`,
		"verify-commit",
		"HEAD",
	],
	{ stdio: "pipe" },
);
check("Recovered commit signature verifies against the fixture key");
evaluate(`location.hash='/settings/identities'`);
poll(`document.querySelector('#host-git-identity-heading')`);
fill(" "); // Trimmed empty selection restores inheritance.
click("Save host Git agent");
poll(`document.body.innerText.includes('(inherited by Factory)')`);
click("Test host SSH agent");
poll(`document.body.innerText.includes('SSH agent has no accessible keys')`);
check("Clearing saved socket restores inherited agent");
click("Add identity profile");
cli("select", 'label:has-text("Signing policy") select', "ssh");
check(
	"Explicit profile leaves agent testing disabled until a socket is selected",
	evaluate(
		`[...document.querySelectorAll('button')].find(b=>b.textContent==='Test signing SSH agent').disabled`,
	),
);
cli("find", "label", "Signing SSH agent socket", "fill", fixture.socket);
click("Test signing SSH agent");
poll(
	`document.querySelector('[aria-label="Signing SSH agent"]').innerText.includes('Connected to SSH agent: 1 key available')`,
);
check(
	"Explicit signing profile reuses the selector and test without changing host identity",
	evaluate(
		`(async()=>!(await(await fetch('/api/config')).json()).gitSettings.socket)()`,
	),
);
click("Add repository account");
cli("find", "label", "Use an explicit SSH key or agent for Git", "check");
cli("find", "label", "Git account 1 SSH agent socket", "fill", fixture.socket);
click("Test git account 1 SSH agent");
poll(
	`document.querySelector('[aria-label="Git account 1 SSH agent"]').innerText.includes('Connected to SSH agent: 1 key available')`,
);
check("Repository SSH binding shares the same selector and test");
evaluate(`location.hash='/settings/capacity'`);
poll(`document.querySelector('#machine-capacity')`);
evaluate(`location.hash='/settings/identities'`);
poll(`document.querySelector('#host-git-identity-heading')`);
check(
	"Unsent profile edits are discarded without changing the host agent",
	evaluate(`!document.querySelector('[aria-label="Signing SSH agent"]')`),
);

console.log(cli("snapshot", "-i"));
writeFileSync(
	join(evidence, "browser-checks.json"),
	JSON.stringify(checks, null, 2),
);
