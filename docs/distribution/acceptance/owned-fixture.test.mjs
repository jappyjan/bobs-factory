import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { managerWrapper } from "./manager-wrapper.mjs";
import { startOwnedCommand } from "./owned-command.mjs";
import { runOwnedFixture } from "./owned-fixture.mjs";
import {
	drainRegistry,
	registerGroup,
	registrySurvivors,
} from "./owned-registry.mjs";

const moduleUrl = (name) => new URL(name, import.meta.url).href;

test("exact manager wrapper preserves disabled stdout, stderr and exit 1", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-manager-wrapper-"));
	try {
		const real = join(root, "manager");
		writeFileSync(
			real,
			`#!${process.execPath}\nprocess.stdout.write('disabled\\n'); process.stderr.write('diagnostic\\n'); process.exit(1);`,
			{ mode: 0o700 },
		);
		const wrapper = join(root, "systemctl.cjs");
		writeFileSync(wrapper, managerWrapper(real));
		await assert.rejects(
			startOwnedCommand(process.execPath, [
				wrapper,
				"--user",
				"is-enabled",
				"fixture.service",
			]).done,
			(error) => {
				assert.equal(error.stdout, "disabled\n");
				// execFileSync may also forward the manager stderr; all diagnostics survive.
				assert.match(error.stderr, /diagnostic/);
				assert.equal(error.status, 1);
				return true;
			},
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	test(`exact START descendant boundary precedes ${signal}; delayed fork cannot mutate`, {
		timeout: 8000,
	}, async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-start-boundary-"));
		const marker = join(root, "entered");
		const mutation = join(root, "late-mutation");
		const real = join(root, "manager");
		writeFileSync(
			real,
			`#!${process.execPath}\nprocess.stdout.write(process.argv.includes('is-enabled') ? 'disabled' : 'started'); process.exit(process.argv.includes('is-enabled') ? 1 : 0);`,
			{ mode: 0o700 },
		);
		const wrapper = join(root, "systemctl.cjs");
		writeFileSync(wrapper, managerWrapper(real));
		const controller = new AbortController();
		const command = startOwnedCommand(
			process.execPath,
			[wrapper, "--user", "start", "fixture.service"],
			{
				signal: controller.signal,
				env: {
					...process.env,
					BOBS_FACTORY_ACCEPTANCE_MANAGER_GATE: marker,
					BOBS_FACTORY_ACCEPTANCE_LATE_MUTATION: mutation,
				},
			},
		);
		const outcome = command.done.catch((error) => error);
		try {
			const deadline = Date.now() + 3000;
			while (!existsSync(marker)) {
				assert(Date.now() < deadline, "Actual START boundary was not reached");
				await delay(20);
			}
			assert.deepEqual(JSON.parse(readFileSync(marker)), [
				"--user",
				"start",
				"fixture.service",
			]);
			controller.abort(Error(`Interrupted: ${signal}`));
			assert.match((await outcome).message, new RegExp(signal));
			assert(command.drained);
			await delay(700);
			assert(!existsSync(mutation));
		} finally {
			command.kill();
			await outcome;
			rmSync(root, { recursive: true, force: true });
		}
	});
}

for (const mode of [
	"verified-pass",
	"false-pass-active",
	"false-pass-job",
	"false-pass-manager-error",
	"false-pass-query-error",
	"false-pass-reload-job",
	"failed-exit",
	"failed-exit-manager-error",
	"SIGINT",
	"SIGTERM",
	"SIGTERM-manager-error",
	"forced-deadline",
	"missing-receipt",
	"malformed-receipt",
	"malformed-manifest",
	"manifest-symlink",
	"invalid-unit",
	"filesystem-record-changed",
	"corrupt-group-record",
]) {
	test(`child cleanup claim ${mode} requires independent native proof`, {
		timeout: 12000,
	}, async () => {
		const failedExit = mode.startsWith("failed-exit");
		const signal = mode.startsWith("SIG") ? mode.split("-")[0] : undefined;
		const evidence = mkdtempSync(join(tmpdir(), "factory-receipt-proof-"));
		const bin = join(evidence, "bin");
		mkdirSync(bin);
		const receiptPath = join(evidence, "receipt.json");
		const pointer = join(evidence, "pointer.json");
		const calls = join(evidence, "calls.jsonl");
		const state = join(evidence, "active");
		writeFileSync(state, "true");
		const unit = `factory-acceptance-external-${randomUUID()}.service`;
		const unitDirectory = join(homedir(), ".config", "systemd", "user");
		assert(!existsSync(join(unitDirectory, unit)));
		// Mock only: no native definitions or host-manager operations.
		writeFileSync(
			join(bin, "systemctl"),
			`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if (${mode.endsWith("manager-error")} && args.includes('stop') || ${mode === "false-pass-query-error"} && args.includes('show')) {
 process.stderr.write('mock manager permission denied'); process.exit(1);
}
if (${!["false-pass-active", "false-pass-job"].includes(mode)} && args.includes('stop')) fs.writeFileSync(${JSON.stringify(state)},'false');
if (${mode === "false-pass-reload-job"} && args.includes('daemon-reload')) fs.writeFileSync(${JSON.stringify(state)},'true');
process.stdout.write(JSON.parse(fs.readFileSync(${JSON.stringify(state)}))
 ? ${JSON.stringify(["false-pass-job", "false-pass-reload-job"].includes(mode) ? "ActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nJob=99\n" : "ActiveState=active\nSubState=running\nMainPID=100\nControlPID=0\nJob=0\n")}
 : 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\nControlPID=0\\nJob=0\\n');`,
			{ mode: 0o700 },
		);
		const fixture = `
const fs=require('node:fs'),path=require('node:path');
const root=process.env.BOBS_FACTORY_ACCEPTANCE_FIXTURE_ROOT;
const registry=process.env.BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY;
fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state','bytes'),'owned mutable state');
fs.writeFileSync(${JSON.stringify(pointer)},JSON.stringify({root,registry}));
fs.writeFileSync(path.join(registry,'fixture.json'),${mode === "malformed-manifest" ? JSON.stringify("{invalid") : `JSON.stringify({root,unitDirectory:${JSON.stringify(unitDirectory)},units:[{unit:${JSON.stringify(mode === "invalid-unit" ? "unowned.service" : unit)},bytes:null}]})`});
${mode === "manifest-symlink" ? "fs.renameSync(path.join(registry,'fixture.json'),path.join(root,'manifest'));fs.symlinkSync(path.join(root,'manifest'),path.join(registry,'fixture.json'));" : ""}
${mode === "filesystem-record-changed" ? "fs.writeFileSync(path.join(registry,'filesystem.json'),JSON.stringify({root}));" : ""}
${mode === "corrupt-group-record" ? "fs.writeFileSync(path.join(registry,'groups','invalid.json'),'{invalid');" : ""}
${mode === "missing-receipt" ? "" : `fs.writeFileSync(${JSON.stringify(receiptPath)},${mode === "malformed-receipt" ? JSON.stringify("{invalid") : `JSON.stringify({passed:${!failedExit && !signal && mode !== "forced-deadline"},cleanup:true,survivors:[]${failedExit ? ",error:'original work failure'" : ""}})`});`}
${failedExit ? "process.exit(7);" : signal ? `process.kill(process.pid,${JSON.stringify(signal)});` : mode === "forced-deadline" ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);" : ""}`;
		let error;
		try {
			try {
				await runOwnedFixture(process.execPath, ["-e", fixture], {
					receiptPath,
					timeout: mode === "forced-deadline" ? 500 : 3000,
					cleanupGrace: 100,
					env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
				});
			} catch (caught) {
				error = caught;
			}
			const { root, registry } = JSON.parse(readFileSync(pointer));
			const operations = existsSync(calls)
				? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse)
				: [];
			if (
				[
					"malformed-manifest",
					"manifest-symlink",
					"invalid-unit",
					"filesystem-record-changed",
				].includes(mode)
			)
				assert.deepEqual(operations, []);
			else {
				assert(
					operations.some(
						(args) => args.includes("show") && args.includes(unit),
					),
					"A cleanup:true receipt skipped native verification",
				);
				assert(
					operations.every(
						(args) =>
							args[0] === "--user" &&
							(args[1] === "daemon-reload" || args.includes(unit)),
					),
				);
			}
			const receipt = JSON.parse(readFileSync(receiptPath));
			if (
				mode.startsWith("false-pass") ||
				mode.endsWith("manager-error") ||
				[
					"missing-receipt",
					"malformed-receipt",
					"malformed-manifest",
					"manifest-symlink",
					"invalid-unit",
					"filesystem-record-changed",
					"corrupt-group-record",
				].includes(mode)
			) {
				assert(error, "Unproven native cleanup must reject a claimed PASS");
				assert.equal(receipt.passed, false);
				assert.equal(receipt.cleanup, false);
				assert.equal(receipt.registryPath, registry);
				assert.equal(error.registryPath, registry);
				assert(existsSync(join(registry, "closed")));
				assert.equal(
					readFileSync(join(root, "state", "bytes"), "utf8"),
					"owned mutable state",
				);
				if (mode.includes("error"))
					assert.match(error.cleanupError, /mock manager permission denied/);
				if (failedExit || signal) {
					assert.equal(error.status, failedExit ? 7 : signal);
					assert.equal(receipt.outerError, error.message);
					if (failedExit) assert.equal(receipt.error, "original work failure");
				}
			} else {
				assert(!existsSync(root));
				assert(!existsSync(registry));
				assert.equal(JSON.parse(readFileSync(state)), false);
				assert.equal(receipt.cleanup, true);
				assert.equal(receipt.passed, mode === "verified-pass");
				if (mode === "verified-pass") assert.equal(error, undefined);
				else {
					assert(error);
					assert.equal(receipt.outerError, error.message);
					if (mode === "forced-deadline") {
						assert.equal(error.timedOut, true);
						assert.equal(receipt.outerEscalated, true);
					} else assert.equal(error.status, mode === "failed-exit" ? 7 : mode);
					if (mode === "failed-exit")
						assert.equal(receipt.error, "original work failure");
				}
			}
		} finally {
			if (existsSync(pointer)) {
				const { root, registry } = JSON.parse(readFileSync(pointer));
				rmSync(root, { recursive: true, force: true });
				rmSync(registry, { recursive: true, force: true });
			}
			rmSync(evidence, { recursive: true, force: true });
		}
	});
}

for (const mode of ["cooperative", "forced", "cleanup-error"]) {
	test(`outer timeout ${mode} accounts for real nested detached groups and a delayed fork`, {
		timeout: 8000,
	}, async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-outer-timeout-"));
		const receiptPath = join(root, "receipt.json");
		const marker = join(root, "late-mutation");
		const script = `
import {writeFileSync,readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {startOwnedCommand} from ${JSON.stringify(moduleUrl("./owned-command.mjs"))};
import {withOwnedCleanup} from ${JSON.stringify(moduleUrl("./owned-cleanup.mjs"))};
const receipt={passed:false,cleanup:false};
const innerScript=${JSON.stringify(`const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'escaped'),1300)`)}],{stdio:'ignore'}); console.log('entered'); setInterval(()=>{},1000);`)};
let inner;
process.on('SIGTERM',()=>{const visible=JSON.parse(readFileSync(${JSON.stringify(receiptPath)})); writeFileSync(${JSON.stringify(`${receiptPath}.visible`)},JSON.stringify(visible));});
await withOwnedCleanup({receipt,
 work: async(signal)=>{
  inner=startOwnedCommand(process.execPath,['-e',innerScript],{signal:${mode === "cooperative" ? "signal" : "undefined"},timeout:60000});
  inner.done.catch(()=>{});
  await new Promise(resolve=>inner.child.stdout.once('data',resolve));
  writeFileSync(${JSON.stringify(`${receiptPath}.manager-boundary`)},'ready');
  await delay(60000,undefined,{signal:${mode === "forced" ? "undefined" : "signal"}});
 },
 cleanup: async()=>{
  ${mode === "cleanup-error" ? "throw Error('intentional cleanup failure');" : "inner.kill(); await inner.done.catch(()=>{}); receipt.cleanup=inner.drained; receipt.survivors=[];"}
 },
 persist: ()=>writeFileSync(${JSON.stringify(receiptPath)},JSON.stringify(receipt))
});`;
		let error;
		try {
			await runOwnedFixture(
				process.execPath,
				["--input-type=module", "-e", script],
				{
					receiptPath,
					timeout: 3000,
					timeoutAfterBoundary: 100,
					cleanupGrace: mode === "forced" ? 200 : 1000,
				},
			);
			assert.fail("Outer timeout must never pass");
		} catch (caught) {
			error = caught;
		}
		try {
			assert.equal(error.timedOut, true);
			assert.match(error.message, /Command timed out/);
			const visible = JSON.parse(readFileSync(`${receiptPath}.visible`));
			assert.equal(visible.passed, false);
			assert.equal(visible.cleanup, false);
			assert.equal(visible.outerTimedOut, true);
			const receipt = JSON.parse(readFileSync(receiptPath));
			assert.equal(receipt.passed, false);
			assert.equal(receipt.outerTimedOut, true);
			assert.match(receipt.outerError, /Command timed out/);
			if (mode === "cleanup-error") {
				assert.equal(receipt.cleanup, false);
				assert.equal(receipt.cleanupError, "intentional cleanup failure");
				assert.equal(receipt.registryPath, error.registryPath);
				assert(existsSync(error.registryPath));
			} else assert.equal(receipt.cleanup, true);
			if (mode === "forced") assert.equal(receipt.outerEscalated, true);
			else assert.equal(receipt.interrupted, "SIGTERM");
			await delay(1500);
			assert(
				!existsSync(marker),
				"Nested reparented fork mutated after outer return",
			);
		} finally {
			if (error?.registryPath)
				rmSync(error.registryPath, { recursive: true, force: true });

			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("closed registry handshake refuses target execution", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-closed-registry-"));
	const marker = join(root, "must-not-run");
	writeFileSync(join(root, "closed"), "closed");
	const owned = startOwnedCommand(
		process.execPath,
		["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`],
		{ registry: root },
	);
	try {
		await assert.rejects(owned.done, /registry is closed/);
		assert(owned.drained);
		assert(!existsSync(marker));
	} finally {
		owned.kill();
		rmSync(root, { recursive: true, force: true });
	}
});

test("changed leader identity refuses unowned signaling and reports survivors", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-identity-regression-"));
	const owned = startOwnedCommand(
		process.execPath,
		["-e", "console.log('ready'); setInterval(()=>{},1000)"],
		{ registry: root },
	);
	const outcome = owned.done.catch(() => {});
	try {
		await new Promise((resolve) => owned.child.stdout.once("data", resolve));
		const identity = registerGroup(null, owned.child.pid);
		writeFileSync(
			join(root, "groups", `${identity.pid}.json`),
			JSON.stringify({ ...identity, birth: "different" }),
		);
		await assert.rejects(drainRegistry(root), /identity changed/);
		assert(registrySurvivors(root).length > 0);
		// The refused group is still our test's exact live direct child.
		assert.doesNotThrow(() => execFileSync("ps", ["-p", String(identity.pid)]));
	} finally {
		owned.kill();
		await outcome;
		rmSync(root, { recursive: true, force: true });
	}
});

for (const mode of [
	"unexpected-death",
	"manager-failure",
	"unproven-exit",
	"root-symlink",
	"root-replaced",
	"untrusted-manifest",
	"filesystem-permission",
	"receipt-symlink",
]) {
	test(`native cleanup after ${mode} retains evidence until verified`, {
		timeout: 8000,
	}, async () => {
		const root = mkdtempSync(
			join(tmpdir(), "factory-service-review-evidence-"),
		);
		const bin = join(root, "bin");
		mkdirSync(bin);
		const state = join(root, "mock-unit-state.json");
		const calls = join(root, "manager-calls.jsonl");
		const receiptPath = join(root, "receipt.json");
		const registryPath = join(root, "registry-path");
		const fixturePointer = join(root, "fixture-root");
		const foreign = mkdtempSync(
			join(tmpdir(), "factory-isolated-service-unowned-"),
		);
		writeFileSync(join(foreign, "credentials"), "unowned bytes must survive");
		const unit = `factory-acceptance-external-${randomUUID()}.service`;
		const unitDirectory = join(homedir(), ".config", "systemd", "user");
		// There is no real unit/definition. Every manager operation hits this mock,
		// and only the directly spawned fixture signals itself.
		assert(!existsSync(join(unitDirectory, unit)));
		writeFileSync(state, JSON.stringify({ active: true }));
		writeFileSync(
			join(bin, "systemctl"),
			`#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (${mode === "manager-failure"} && args.includes('stop')) {
 process.stderr.write('mock manager permission denied'); process.exit(1);
}
if(args.includes('stop')||args.includes('kill')) fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({active:false}));
process.stdout.write(JSON.parse(fs.readFileSync(${JSON.stringify(state)})).active
 ? 'ActiveState=active\\nSubState=running\\nMainPID=100\\nControlPID=0\\nJob=0\\n'
 : 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\nControlPID=0\\nJob=0\\n');`,
			{ mode: 0o700 },
		);
		const manifest = {
			root,
			unitDirectory,
			units: [{ unit, bytes: "unused mock definition" }],
		};
		const fixture = `
import {writeFileSync,mkdirSync,mkdtempSync,symlinkSync,renameSync,chmodSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.env.BOBS_FACTORY_ACCEPTANCE_FIXTURE_ROOT ?? mkdtempSync(join(tmpdir(),'factory-isolated-service-review-'));
writeFileSync(${JSON.stringify(fixturePointer)},root);
mkdirSync(join(root,'state'));
writeFileSync(join(root,'state','fixture-bytes'),'owned mutable state');
symlinkSync(${JSON.stringify(foreign)},join(root,'foreign-link'));
symlinkSync(${JSON.stringify(join(foreign, "absent"))},join(root,'dangling-link'));
${["root-symlink", "root-replaced"].includes(mode) ? `renameSync(root,root+'.original'); ${mode === "root-symlink" ? `symlinkSync(${JSON.stringify(foreign)},root);` : `mkdirSync(root); writeFileSync(join(root,'replacement'),'unowned replacement');`}` : ""}
${mode === "filesystem-permission" ? `chmodSync(join(root,'state'),0o500);` : ""}
const manifest={...${JSON.stringify(manifest)},root:${mode === "untrusted-manifest" ? JSON.stringify(foreign) : "root"}};
writeFileSync(${JSON.stringify(registryPath)}, process.env.BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY);
writeFileSync(join(process.env.BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY,'fixture.json'),JSON.stringify(manifest));
writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({passed:false,cleanup:false${mode === "manager-failure" ? ",cleanupError:'fixture cleanup interrupted'" : ""}}));
${mode === "receipt-symlink" ? `writeFileSync(join(root,'retained-receipt'),JSON.stringify({passed:false,cleanup:false})); unlinkSync(${JSON.stringify(receiptPath)}); symlinkSync(join(root,'retained-receipt'),${JSON.stringify(receiptPath)});` : ""}
${mode === "unproven-exit" ? "process.exit(0);" : "process.kill(process.pid,'SIGKILL');"}`;
		let error;
		try {
			try {
				await runOwnedFixture(
					process.execPath,
					["--input-type=module", "-e", fixture],
					{
						receiptPath,
						timeout: 3000,
						env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
					},
				);
			} catch (caught) {
				error = caught;
			}
			const operations = existsSync(calls)
				? readFileSync(calls, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line))
				: [];
			if (mode === "untrusted-manifest") assert.deepEqual(operations, []);
			else {
				assert(
					operations.some(
						(args) => args.includes("show") && args.includes(unit),
					),
					"Unexpected fixture exit skipped exact-unit reconciliation",
				);
				assert(
					operations.some(
						(args) => args.includes("stop") && args.includes(unit),
					),
				);
				assert(
					operations.every(
						(args) =>
							args[0] === "--user" &&
							(args[1] === "daemon-reload" || args.includes(unit)),
					),
					"Only exact registered mock units may be operated on",
				);
			}
			const receipt = JSON.parse(readFileSync(receiptPath));
			const fixtureRoot = readFileSync(fixturePointer, "utf8");
			assert.equal(
				readFileSync(join(foreign, "credentials"), "utf8"),
				"unowned bytes must survive",
			);
			assert.equal(receipt.passed, false);
			if (mode === "unproven-exit") {
				assert.equal(error, undefined);
				assert.equal(receipt.cleanup, true);
			} else {
				assert.equal(error.status, "SIGKILL");
				assert.match(error.message, /exited SIGKILL/);
				assert.equal(Boolean(error.timedOut), false);
				assert.equal(receipt.outerError, error.message);
			}
			if (
				[
					"manager-failure",
					"root-symlink",
					"root-replaced",
					"untrusted-manifest",
					"filesystem-permission",
					"receipt-symlink",
				].includes(mode)
			) {
				assert(existsSync(fixtureRoot), "Unproven directory must be retained");
				assert.equal(receipt.cleanup, false);
				assert.equal(receipt.registryPath, error.registryPath);
				assert(existsSync(join(error.registryPath, "closed")));
				if (mode !== "manager-failure") {
					assert.match(
						error.cleanupError,
						mode === "filesystem-permission"
							? /EACCES|EPERM|ENOTEMPTY/
							: /Fixture (directory|root)/,
					);
					assert(existsSync(join(error.registryPath, "filesystem.json")));
					if (mode === "filesystem-permission")
						assert.equal(
							readFileSync(join(fixtureRoot, "state", "fixture-bytes"), "utf8"),
							"owned mutable state",
						);
					if (mode === "receipt-symlink")
						assert.equal(
							JSON.parse(readFileSync(join(fixtureRoot, "retained-receipt")))
								.passed,
							false,
						);
				} else {
					assert.equal(JSON.parse(readFileSync(state)).active, true);
					assert.equal(receipt.cleanup, false);
					assert.equal(receipt.cleanupError, "fixture cleanup interrupted");
					assert.match(error.cleanupError, /mock manager permission denied/);
					assert(
						receipt.outerCleanupErrors.some((message) =>
							message.includes("mock manager permission denied"),
						),
					);
					assert.equal(receipt.registryPath, error.registryPath);
					assert.equal(readFileSync(registryPath, "utf8"), error.registryPath);
					assert.deepEqual(
						JSON.parse(readFileSync(join(error.registryPath, "fixture.json"))),
						{ ...manifest, root: fixtureRoot },
					);
					assert(existsSync(join(error.registryPath, "closed")));
				}
			} else {
				assert(
					!existsSync(fixtureRoot),
					"Cleanup proof requires owned home/state removal",
				);
				assert.equal(JSON.parse(readFileSync(state)).active, false);
				assert.equal(receipt.cleanup, true);
				assert.equal(error?.registryPath, undefined);
				assert(!existsSync(readFileSync(registryPath, "utf8")));
			}
		} finally {
			// Only private test evidence is removed; the mock never writes native definitions.
			if (error?.registryPath)
				rmSync(error.registryPath, { recursive: true, force: true });
			if (existsSync(fixturePointer)) {
				const fixtureRoot = readFileSync(fixturePointer, "utf8");
				if (
					mode === "filesystem-permission" &&
					existsSync(join(fixtureRoot, "state"))
				)
					chmodSync(join(fixtureRoot, "state"), 0o700);
				rmSync(fixtureRoot, { recursive: true, force: true });
				rmSync(`${fixtureRoot}.original`, { recursive: true, force: true });
			}
			rmSync(root, { recursive: true, force: true });
			rmSync(foreign, { recursive: true, force: true });
		}
	});
}
