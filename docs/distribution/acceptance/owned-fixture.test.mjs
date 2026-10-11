import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
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

for (const mode of ["unexpected-death", "manager-failure", "unproven-exit"]) {
	test(`native cleanup after ${mode} retains evidence until verified`, {
		timeout: 8000,
	}, async () => {
		const root = mkdtempSync(
			join(tmpdir(), "factory-isolated-service-review-"),
		);
		const bin = join(root, "bin");
		mkdirSync(bin);
		const state = join(root, "mock-unit-state.json");
		const calls = join(root, "manager-calls.jsonl");
		const receiptPath = join(root, "receipt.json");
		const registryPath = join(root, "registry-path");
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
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
writeFileSync(${JSON.stringify(registryPath)}, process.env.BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY);
writeFileSync(join(process.env.BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY,'fixture.json'), ${JSON.stringify(JSON.stringify(manifest))});
writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({passed:false,cleanup:false${mode === "manager-failure" ? ",cleanupError:'fixture cleanup interrupted'" : ""}}));
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
			assert(
				operations.some((args) => args.includes("show") && args.includes(unit)),
				"Unexpected fixture exit skipped exact-unit reconciliation",
			);
			assert(
				operations.some((args) => args.includes("stop") && args.includes(unit)),
			);
			assert(
				operations.every(
					(args) =>
						args[0] === "--user" &&
						(args[1] === "daemon-reload" || args.includes(unit)),
				),
				"Only exact registered mock units may be operated on",
			);
			const receipt = JSON.parse(readFileSync(receiptPath));
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
			if (mode === "manager-failure") {
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
					manifest,
				);
				assert(existsSync(join(error.registryPath, "closed")));
			} else {
				assert.equal(JSON.parse(readFileSync(state)).active, false);
				assert.equal(receipt.cleanup, true);
				assert.equal(error?.registryPath, undefined);
				assert(!existsSync(readFileSync(registryPath, "utf8")));
			}
		} finally {
			// Only private test evidence is removed; the mock never writes native definitions.
			if (error?.registryPath)
				rmSync(error.registryPath, { recursive: true, force: true });
			rmSync(root, { recursive: true, force: true });
		}
	});
}
