// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/desktop-shell-update.mjs
// Actual protected FactoryServer/WorkflowRuntime/UpdateDrain + shared owned worker
// record and external-process shell adapter, unsigned test payloads; Node scripts stand
// in for Electron here. Native packaged Electron is validated separately.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { MachineCapacity } from "../../../../packages/edge-worker/dist/MachineCapacity.js";
import { UpdateDrain } from "../../../../packages/edge-worker/dist/updates/UpdateDrain.js";
import { acquireInstanceLock } from "../../../cli/dist/src/services/InstanceLock.js";
import {
	DesktopAppLifecycle,
	processStamp,
	read,
	save,
} from "../../../desktop/src/app-lifecycle.mjs";
import { DesktopAppSource } from "../../../desktop/src/app-source.mjs";
import * as services from "../../../desktop/src/update-services.mjs";
import { shellCheckpoint } from "../../../desktop/test/shell-checkpoint.mjs";
import {
	appRelease,
	fixtureClient,
} from "../../../desktop/test/shell-fixture.mjs";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync(join(tmpdir(), "f1-desktop-shell-")),
	home = join(root, "home"),
	install = join(root, "UI.AppImage"),
	target = "linux-arm64",
	port = 3986;
mkdirSync(home);
process.env.BOBS_FACTORY_DESKTOP_OWNER = "1";
const owned = await acquireInstanceLock(home);
const worker = services.workerOwner(home);
const { runtime, run } = await shellCheckpoint(home, root, {
	id: "shell-retained-wait",
	title: "Waiting during UI update",
	sessionId: "mock-native-retained",
});
writeFileSync(
	join(home, "config.json"),
	JSON.stringify({ repositories: [], fixture: "preserved" }),
);
const capacity = new MachineCapacity(2, join(home, "machine-capacity"));
await capacity.ready();
let resumed = 0;
const drain = new UpdateDrain(
	home,
	runtime,
	capacity,
	() => false,
	() => resumed++,
);
const server = new FactoryServer(
	runtime,
	{
		updates: new services.UpdateManager(home),
		updateDrain: drain,
		capacity,
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw Error("No worker launch");
		},
		stop: (id) => runtime.stop(id),
	},
	{ origins: [`http://localhost:${port}`] },
);
await server.start(port);
// The parent polls these receipts while scripted UI processes start and replace
// one another. Publish complete JSON through rename, as the real lifecycle does.
function script(version, fail = false) {
	return Buffer.from(
		`#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path'),home=process.env.BOBS_FACTORY_DESKTOP_HOME;const save=(file,value)=>{const temporary=file+'.tmp-'+process.pid;fs.writeFileSync(temporary,JSON.stringify(value));fs.renameSync(temporary,file);};save(path.join(home,'fixture-ui.json'),{pid:process.pid,stamp:require('node:child_process').execFileSync('/bin/ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim()});if(${fail})process.exit(7);if(process.env.BOBS_FACTORY_DESKTOP_HEALTH){const token=process.env.BOBS_FACTORY_DESKTOP_HEALTH;save(path.join(home,'desktop','updates','health-'+token+'.json'),{token,pid:process.pid,stamp:require('node:child_process').execFileSync('/bin/ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim(),install:${JSON.stringify(install)},version:${JSON.stringify(version)},commit:'${"a".repeat(40)}',target:'${target}'});}setInterval(()=>{},1000);\n`,
	);
}
const old = appRelease("stable", script("0.9.0"), target, {
		stableVersion: "0.9.0",
	}),
	good = appRelease("nightly", script("1.0.0-nightly.20261009.10"), target),
	bad = appRelease(
		"nightly",
		script("1.0.0-nightly.20261009.11", true),
		target,
		{ sequence: 11 },
	);
writeFileSync(install, readFileSync(join(old.assets, "fixture.AppImage")), {
	mode: 0o755,
});
const directory = join(home, "desktop", "updates"),
	controlled = services;
const source = new DesktopAppSource(
	directory,
	install,
	target,
	controlled,
	fixtureClient([old, good], services),
);
save(join(directory, "installation.json"), await source.enroll(old.identity));
const ui = spawn(install, [], {
	env: { ...process.env, BOBS_FACTORY_DESKTOP_HOME: home },
	stdio: "ignore",
});
await new Promise((r, j) => {
	ui.once("spawn", r);
	ui.once("error", j);
});
const life = new DesktopAppLifecycle(
	{ home, install, target, port, uiPid: ui.pid, uiStamp: processStamp(ui.pid) },
	controlled,
);
// The controlled script has no native Quit bridge. Observe the production durable
// request and make only this exact scripted UI honor it, just as main.mjs does.
const timer = setInterval(() => {
	const f = join(directory, "quit.json");
	if (existsSync(f)) {
		const q = read(f);
		const record = existsSync(join(home, "fixture-ui.json"))
			? read(join(home, "fixture-ui.json"))
			: undefined;
		if (
			q.pid !== worker.pid &&
			q.pid === record?.pid &&
			q.stamp === record.stamp &&
			processStamp(q.pid) === q.stamp
		)
			process.kill(q.pid, "SIGTERM");
	}
}, 20);
const manager = new services.UpdateManager(
		join(home, "desktop"),
		source,
		life,
		{ ...old.identity, target },
	),
	checks = [];
try {
	const saved = readFileSync(join(home, "factory", "runs", `${run.id}.json`));
	const receipt = drain.receipt();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	const lease = await capacity.acquireLease(undefined, {
		identity: "shell-active-work",
	});
	// Reconciliation keeps admission closed while existing work drains. Release
	// the held lease independently instead of awaiting the update it blocks.
	const updating = manager.reconcile();
	updating.catch(() => {}); // Preserve rejection for the awaited result below.
	try {
		const deadline = Date.now() + 5000;
		while (!drain.active() && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(drain.active(), true, "Update must freeze admission");
		assert.equal((await drain.inspect()).idle, false);
		assert.equal(manager.status().transaction.phase, "draining");
		assert.equal(services.workerOwner(home).pid, worker.pid);
		assert.equal(processStamp(ui.pid), life.uiStamp);
		assert.equal(existsSync(join(directory, "quit.json")), false);
		checks.push("active lease defers app switch without signaling UI/worker");
	} finally {
		await lease.release();
		await updating;
	}
	assert.equal(manager.status().transaction.phase, "succeeded");
	assert.equal(services.workerOwner(home).nonce, worker.nonce);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	assert.deepEqual(drain.receipt(), receipt);
	assert.equal(resumed, 1);
	checks.push(
		"unsigned app activation retains exact worker PID/nonce and waiting checkpoints/definitions/outputs/config",
	);
	const newUi = read(join(home, "fixture-ui.json"));
	life.uiPid = newUi.pid;
	life.uiStamp = newUi.stamp;
	source.client = fixtureClient([old, bad], services);
	await manager.check();
	await manager.stage();
	// Model an external helper interrupted after actual replacement, before launch.
	const state = read(manager.file),
		id = "interrupted-shell-fixture";
	state.transaction = {
		id,
		candidate: state.pending.candidate,
		staged: state.pending.staged,
		previous: state.installed,
		revision: state.revision,
		phase: "activating",
		switchStarted: true,
		startedAt: new Date().toISOString(),
	};
	save(manager.file, state);
	await life.acquireMaintenance(id);
	assert.equal(await life.isIdle(), true);
	state.transaction.snapshot = await life.snapshot(id);
	save(manager.file, state);
	await life.stop();
	await life.activate(state.pending.staged);
	save(join(directory, "operation.lock"), {
		pid: 999999,
		start: "stale-test-owner",
	});
	await manager.recover("operation owner stopped");
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(services.workerOwner(home).nonce, worker.nonce);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	checks.push(
		"interrupted complete-app switch recovers prior UI from candidate-bound integrity receipt without worker resurrection",
	);
	const recoveredUi = read(join(home, "fixture-ui.json"));
	life.uiPid = recoveredUi.pid;
	life.uiStamp = recoveredUi.stamp;
	manager.requestInstall(
		services.candidateKey(manager.status().pending.candidate),
		manager.status().revision,
		true,
	);
	source.client = fixtureClient([old, bad], services);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(services.workerOwner(home).pid, worker.pid);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	assert.equal(manager.status().badCandidates.length, 1);
	checks.push(
		"failed shell exits before rollback; worker and checkpoint bytes remain untouched; bad candidate suppressed",
	);
	await manager.tick();
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(manager.status().settings.channel, "nightly");
	checks.push(
		"repeat tick never retries bad candidate; local shell settings independent from backend settings",
	);
	console.log(
		JSON.stringify(
			{
				status: "passed",
				scope:
					"mocked F1; actual protected API/drain/leases/ownership + scripted UI processes; no native Electron/OS signing/provider claim",
				checks,
				workerPidUnchanged: true,
				preservedStateSha256: receipt.preservedStateSha256,
			},
			null,
			2,
		),
	);
} finally {
	clearInterval(timer);
	for (const p of [
		ui.pid,
		existsSync(join(home, "fixture-ui.json"))
			? read(join(home, "fixture-ui.json")).pid
			: undefined,
	])
		if (p)
			try {
				process.kill(p, "SIGTERM");
			} catch {}
	await server.stop();
	await runtime.shutdown();
	await capacity.shutdown();
	owned();
	for (const f of [old, good, bad]) f.cleanup();
	rmSync(root, { recursive: true, force: true });
}
