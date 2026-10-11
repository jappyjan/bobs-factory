// Native manager acceptance, restricted to ephemeral GitHub Linux runners.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { desktopExecutable } from "../../../apps/desktop/src/local-runtime.mjs";
import { withOwnedCleanup } from "./owned-cleanup.mjs";
import { startOwnedCommand } from "./owned-command.mjs";
import {
	properties,
	startLimitEvidence,
	stopOwnedUnit,
	terminal,
} from "./service-protocol.mjs";

assert.equal(
	process.env.GITHUB_ACTIONS,
	"true",
	"Never run against developer services",
);
assert.equal(process.platform, "linux");
assert.equal(
	process.env.BOBS_FACTORY_ACCEPTANCE_HANDOFF,
	"fixture-only",
	"Explicit consent is required even for fixture handoff",
);
const receiptPath = process.argv[3];
assert(
	receiptPath && !existsSync(receiptPath),
	"Reserve a new receipt; never reuse a prior PASS",
);
const receipt = {
	passed: false,
	cleanup: false,
	testedAt: new Date().toISOString(),
	harnessSha: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	protocolSha256: createHash("sha256")
		.update(readFileSync(new URL("./service-protocol.mjs", import.meta.url)))
		.digest("hex"),
	commandHarnessSha256: createHash("sha256")
		.update(readFileSync(new URL("./owned-command.mjs", import.meta.url)))
		.digest("hex"),
	cleanupHarnessSha256: createHash("sha256")
		.update(readFileSync(new URL("./owned-cleanup.mjs", import.meta.url)))
		.digest("hex"),
	harnessSha256: createHash("sha256")
		.update(readFileSync(new URL(import.meta.url)))
		.digest("hex"),
	source: JSON.parse(readFileSync(join(process.argv[2], "build.json"))).commit,
	assertions: [],
	limits: [
		"No host/user-manager reboot, login, logout or lingering",
		"No second-machine UI",
		"No real PM2 or Nix activation",
		"Opaque synthetic checkpoint preservation only; no provider/native credentials",
		"No public trust/signing acceptance",
	],
};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), {
	flag: "wx",
	mode: 0o600,
});
const root = realpathSync(
	mkdtempSync(join(tmpdir(), "factory-isolated-service-")),
);
const home = join(root, "state");
mkdirSync(home);
const executable = desktopExecutable(home, process.argv[2]);
const probe = createServer();
let port;
let prefix;
let cancellation;
let cleaning = false;
const checkCancellation = () => {
	if (!cleaning) cancellation?.throwIfAborted();
};
const units = [];
const pids = new Set();
let foreground;
let record;
const commands = new Set();
const execute = async (program, args, timeout, env) => {
	checkCancellation();
	const owned = startOwnedCommand(program, args, {
		timeout,
		env,
		signal: cleaning ? undefined : cancellation,
	});
	commands.add(owned);
	try {
		return await owned.done;
	} finally {
		if (owned.drained) commands.delete(owned);
	}
};
const manager = (...args) => execute("systemctl", ["--user", ...args], 5000);
const interrupt = process.env.BOBS_FACTORY_ACCEPTANCE_INTERRUPT;
const interruptPhase = process.env.BOBS_FACTORY_ACCEPTANCE_INTERRUPT_PHASE;
if (interrupt) {
	assert(["SIGINT", "SIGTERM"].includes(interrupt));
	assert(
		["initial-install", "manager-mutation", "healthy-managed-fixture"].includes(
			interruptPhase,
		),
	);
}
let gateOperation;
let cliEnvironment = process.env;
const lateMutation = `${receiptPath}.late-mutation`;
const command = async (...args) => {
	if (!gateOperation || args[0] !== gateOperation)
		return execute(
			executable,
			[...prefix, "service", ...args],
			30000,
			cliEnvironment,
		);
	const marker = join(root, "manager-entered");
	const pending = execute(executable, [...prefix, "service", ...args], 30000, {
		...cliEnvironment,
		BOBS_FACTORY_ACCEPTANCE_MANAGER_GATE: marker,
		BOBS_FACTORY_ACCEPTANCE_LATE_MUTATION: lateMutation,
	});
	// Attach rejection before waiting for the real descendant manager boundary.
	const outcome = pending.then(
		(output) => ({ output }),
		(error) => ({ error }),
	);
	await until(
		() => existsSync(marker),
		"CLI descendant entered manager call",
		10000,
	);
	receipt.interruptPhase = interruptPhase;
	receipt.managerBoundary = readFileSync(marker, "utf8");
	process.kill(process.pid, interrupt);
	const result = await outcome;
	if (result.error) throw result.error;
	assert.fail("Cancelled manager command unexpectedly completed");
};
const status = async () => JSON.parse(await command("status"));
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const until = async (check, label, timeout = 45000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		checkCancellation();
		const result = await check();
		if (result) return result;
		await delay(200, undefined, {
			signal: cleaning ? undefined : cancellation,
		});
	}
	throw Error(`Timed out: ${label}`);
};
const healthy = (excludedPid) =>
	until(async () => {
		const s = await status();
		if (!s.healthy || s.owner.pid === excludedPid) return false;
		pids.add(s.owner.pid);
		return s;
	}, "native worker health");
const observed = (name) => receipt.assertions.push(name);
const expectRefusal = async (...args) => {
	try {
		await command(...args);
		assert.fail("Expected ownership refusal");
	} catch (error) {
		assert(error.status, "Expected CLI failure, not a harness assertion");
		assert.match(
			String(error.stderr),
			/Existing worker ownership|Existing external service definition|changed externally|maintenance/,
		);
	}
};
const hash = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");
// These are owner records, not live PM2/Nix installations or real conversations.
const retained = [
	"pm2-ecosystem.json",
	"external-service.nix",
	"synthetic-native-checkpoint.json",
	"waiting-gate.json",
];
const unitDirectory = join(homedir(), ".config", "systemd", "user");
const externalId = `factory-acceptance-external-${randomUUID()}.service`;
const externalDefinition = join(unitDirectory, externalId);
const managedId = `de.bobs-factory.${createHash("sha256").update(home).digest("hex").slice(0, 16)}.service`;
const updaterId = managedId.replace(/\.service$/, ".updates.service");
// Register before ANY installation can write either definition or submit a job.
units.push(externalId, managedId, updaterId);
const definitions = new Map();
const writeOwnedDefinition = (path, bytes, options) => {
	definitions.set(basename(path), bytes);
	writeFileSync(path, bytes, options);
};
const verifyDefinition = (unit) => {
	assert(units.includes(unit));
	const path = join(unitDirectory, unit);
	if (!existsSync(path)) return false;
	assert(
		!lstatSync(path).isSymbolicLink(),
		"Fixture definition became a symlink",
	);
	assert.equal(
		readFileSync(path, "utf8"),
		definitions.get(unit),
		"Fixture definition ownership changed",
	);
	return true;
};
let before;
const capture = async (label) => {
	const files = [];
	for (const unit of new Set(units)) {
		for (const [kind, program, args] of [
			["properties", "systemctl", ["--user", "show", unit]],
			[
				"journal",
				"journalctl",
				[
					"--user",
					"-u",
					unit,
					"--no-pager",
					"-n",
					"160",
					"-o",
					"short-precise",
				],
			],
		]) {
			const name = `${basename(receiptPath)}-${label}-${unit}.${kind}.raw`;
			try {
				const bytes = await execute(
					program,
					args,
					receipt.interrupted ? 200 : 5000,
				);
				writeFileSync(join(dirname(receiptPath), name), bytes, {
					flag: "wx",
					mode: 0o600,
				});
				files.push(name);
			} catch (error) {
				receipt.diagnosticErrors ??= [];
				receipt.diagnosticErrors.push(`${name}: ${error.message}`);
			}
		}
	}
	// Include cgroup and parent IDs to diagnose descendants blocking native restart.
	const name = `${basename(receiptPath)}-${label}-processes.raw`;
	try {
		const processes = await execute(
			"ps",
			["-eo", "pid=,ppid=,cgroup=,args="],
			receipt.interrupted ? 200 : 5000,
		);
		writeFileSync(
			join(dirname(receiptPath), name),
			processes
				.split("\n")
				.filter(
					(line) =>
						line.includes(root) || units.some((unit) => line.includes(unit)),
				)
				.join("\n"),
			{ flag: "wx", mode: 0o600 },
		);
		files.push(name);
	} catch (error) {
		receipt.diagnosticErrors ??= [];
		receipt.diagnosticErrors.push(error.message);
	}
	receipt.diagnostics ??= [];
	receipt.diagnostics.push(...files);
};
const crash = async () => {
	// Resolve the process in the exact fixture unit, never signal a stale owner PID.
	assert(record && units.includes(`${record.id}.service`));
	assert.equal(
		readFileSync(record.definition, "utf8"),
		receipt.workerDefinition,
	);
	await manager(
		"kill",
		"--kill-whom=main",
		"--signal=SIGKILL",
		`${record.id}.service`,
	);
};
await withOwnedCleanup({
	receipt,
	work: async (signal) => {
		cancellation = signal;
		await new Promise((resolve, reject) => {
			probe.once("error", reject);
			probe.listen(0, "127.0.0.1", resolve);
		});
		port = probe.address().port;
		await new Promise((resolve) => probe.close(resolve));
		prefix = ["--home", home, "--port", String(port), "--no-open"];
		writeFileSync(
			join(home, retained[0]),
			JSON.stringify({
				apps: [{ name: "fixture-only", script: executable, autorestart: true }],
			}),
		);
		writeFileSync(
			join(home, retained[1]),
			'{ systemd.user.services.factory = { Service.ExecStart = "/nix/store/fixture/bobs-factory"; }; }\n',
		);
		writeFileSync(
			join(home, retained[2]),
			JSON.stringify({
				runner: "codex",
				sessionId: "synthetic-retained-session",
				completed: true,
			}),
		);
		writeFileSync(
			join(home, retained[3]),
			JSON.stringify({
				status: "waiting",
				decision: null,
				immutableReceipt: "fixture",
			}),
		);
		before = Object.fromEntries(
			retained.map((name) => [name, hash(join(home, name))]),
		);
		mkdirSync(unitDirectory, { recursive: true });
		// Fixture paths come from mkdtemp and contain no quoting-sensitive characters.
		writeOwnedDefinition(
			externalDefinition,
			`[Unit]\nDescription=Disposable external owner fixture\n[Service]\nExecStart=${executable} ${prefix.join(" ")} local\nRestart=on-failure\nRestartSec=1\n[Install]\nWantedBy=default.target\n`,
			{ flag: "wx", mode: 0o600 },
		);
		await manager("show", "default.target", "--property=ActiveState");
		const nixDefinition = join(unitDirectory, managedId);
		writeOwnedDefinition(
			nixDefinition,
			"[Service]\nExecStart=/nix/store/fixture-only/bobs-factory\n",
			{ flag: "wx", mode: 0o600 },
		);
		const nixHash = hash(nixDefinition);
		await expectRefusal(
			"install",
			"--executable",
			executable,
			"--mode",
			"local",
		);
		assert.equal(hash(nixDefinition), nixHash);
		assert(!existsSync(join(home, "runtime", "service.json")));
		// This file is created by this test, not a mutable Nix-owned deployment.
		unlinkSync(nixDefinition);
		observed(
			"Dormant external Nix-style target definition refuses adoption and retains bytes; fixture-only removal explicitly consented",
		);
		// A manual owner must exit before the manager can acquire the same home.
		foreground = startOwnedCommand(executable, [...prefix, "local"], {
			signal,
			timeout: 60000,
		});
		foreground.done.catch(() => {});
		pids.add(foreground.child.pid);
		await until(async () => (await status()).owner, "manual owner lock");
		await expectRefusal(
			"install",
			"--executable",
			executable,
			"--mode",
			"local",
		);
		assert(!existsSync(join(home, "runtime", "service.json")));
		foreground.child.kill("SIGTERM");
		await until(
			async () => !alive(foreground.child.pid) && !(await status()).owner,
			"manual graceful handoff",
		);
		observed(
			"Manual process blocks adoption; explicit fixture stop releases ownership",
		);
		await manager("daemon-reload");
		await manager("enable", "--now", externalId);
		const externalOwner = await until(
			async () => (await status()).owner,
			"external unit owner",
		);
		pids.add(externalOwner.pid);
		const externalHash = hash(externalDefinition);
		await expectRefusal(
			"install",
			"--executable",
			executable,
			"--mode",
			"local",
		);
		await manager("disable", "--now", externalId);
		await until(
			async () => !alive(externalOwner.pid) && !(await status()).owner,
			"external owner disabled before replacement",
		);
		assert.equal(hash(externalDefinition), externalHash);
		observed(
			"Actual external user service disabled and stopped before replacement; definition retained",
		);
		// This renderer is the exact Linux definition contract of frozen source b82.
		// Prepare byte ownership before initial install, including interrupted setup.
		const quote = (v) =>
			`"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;
		if (
			interruptPhase === "initial-install" ||
			interruptPhase === "manager-mutation"
		) {
			const bin = join(root, "bin");
			mkdirSync(bin);
			const systemctl = (await execute("which", ["systemctl"], 5000)).trim();
			// Gate the real execFileSync descendant. The delayed manager command would
			// mutate after parent exit unless the owned group is drained. start --no-block
			// also submits an actual manager job before cancellation/reconciliation.
			writeFileSync(
				join(bin, "systemctl"),
				`#!${process.execPath}
const {execFileSync,spawn}=require('node:child_process');
const {writeFileSync}=require('node:fs');
const args=process.argv.slice(2), gate=process.env.BOBS_FACTORY_ACCEPTANCE_MANAGER_GATE;
const real=${JSON.stringify(systemctl)};
if(gate && (args.includes('daemon-reload') || args.includes('start'))) {
  if(args.includes('start')) execFileSync(real,[...args,'--no-block']);
  const script="setTimeout(()=>{require('node:fs').writeFileSync(process.argv[1],'escaped');require('node:child_process').execFileSync(process.argv[2],JSON.parse(process.argv[3]));},500);";
  spawn(process.execPath,['-e',script,process.env.BOBS_FACTORY_ACCEPTANCE_LATE_MUTATION,real,JSON.stringify(args)],{stdio:'ignore'});
  writeFileSync(gate,JSON.stringify(args));
  setInterval(()=>{},1000);
} else {
  try { process.stdout.write(execFileSync(real,args,{encoding:'utf8'})); }
  catch(e) { process.stderr.write(String(e.stderr)); process.exit(e.status || 1); }
}
`,
				{ mode: 0o700 },
			);
			cliEnvironment = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
		}
		for (const [unit, updater] of [
			[managedId, false],
			[updaterId, true],
		]) {
			const id = unit.slice(0, -8);
			const args = [
				executable,
				"--home",
				home,
				"--port",
				String(port),
				"--no-open",
				"service",
				updater ? "updates-run" : "run",
			];
			definitions.set(
				unit,
				`[Unit]\nDescription=Bob's Factory (${id})\nStartLimitIntervalSec=120\nStartLimitBurst=3\n\n[Service]\nType=simple\nWorkingDirectory=${home.replaceAll("%", "%%")}\nExecStart=${args.map(quote).join(" ")}\nEnvironment=${quote(`BOBS_FACTORY_SERVICE_ID=${id}`)}\nEnvironment=${quote(`PATH=${cliEnvironment.PATH}`)}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=infinity\nSendSIGKILL=no\nKillMode=mixed\n\n[Install]\nWantedBy=default.target\n`,
			);
		}
		if (interruptPhase === "initial-install") gateOperation = "install";
		await command("install", "--executable", executable, "--mode", "local");
		record = await status();
		assert.equal(`${record.id}.service`, managedId);
		verifyDefinition(managedId);
		verifyDefinition(updaterId);
		assert.equal(record.startup, false);
		assert.equal(record.desired, "stopped");
		const updaterDefinition = record.definition.replace(
			/\.service$/,
			".updates.service",
		);
		const workerBytes = readFileSync(record.definition, "utf8");
		const updaterBytes = readFileSync(updaterDefinition, "utf8");
		receipt.workerDefinition = workerBytes;
		unlinkSync(updaterDefinition);
		await command("install", "--executable", executable, "--mode", "local");
		assert.equal(readFileSync(updaterDefinition, "utf8"), updaterBytes);
		unlinkSync(updaterDefinition);
		writeOwnedDefinition(
			record.definition,
			"External definition; do not adopt\n",
		);
		await expectRefusal(
			"install",
			"--executable",
			executable,
			"--mode",
			"local",
		);
		assert.equal(
			readFileSync(record.definition, "utf8"),
			"External definition; do not adopt\n",
		);
		writeOwnedDefinition(record.definition, workerBytes);
		await command("install", "--executable", executable, "--mode", "local");
		observed(
			"Interrupted stopped setup restores only missing owned definition; modified definition is refused",
		);
		await command("enable");
		assert.equal(
			(await manager("is-enabled", `${record.id}.service`)).trim(),
			"enabled",
		);
		await command("disable");
		assert.match((await status()).startupActual, /disabled/);
		assert.equal((await status()).owner, null);
		if (interruptPhase === "manager-mutation") gateOperation = "start";
		await command("start");
		const first = await healthy();
		if (interrupt) {
			receipt.interruptPhase = "healthy-managed-fixture";
			process.kill(process.pid, interrupt);
			await delay(1000, undefined, { signal });
			assert.fail("Interrupt must unwind acceptance before further mutations");
		}
		assert.equal(first.owner.dashboardPort, port);
		await manager("reset-failed", `${record.id}.service`);
		const crashSince = `@${(Date.now() / 1000).toFixed(3)}`;
		const killedAt = Date.now();
		await capture("before-first-crash");
		await crash();
		const recovered = await healthy(first.owner.pid);
		assert.notEqual(first.owner.pid, recovered.owner.pid);
		assert(
			Date.now() - killedAt >= 9000,
			"RestartSec backoff must actually delay recovery",
		);
		receipt.crashBackoffMs = Date.now() - killedAt;
		let current = recovered;
		let exhausted = false;
		for (let attempt = 0; attempt < 3 && !exhausted; attempt++) {
			await capture(`before-burst-crash-${attempt}`);
			await crash();
			const previousPid = current.owner.pid;
			current = await until(async () => {
				const unit = `${record.id}.service`;
				const p = properties(
					await manager(
						"show",
						unit,
						"--property=ActiveState,SubState,MainPID,ControlPID,Job,Result,NRestarts,StartLimitIntervalUSec,StartLimitBurst,RestartUSec",
					),
				);
				if (terminal(p)) {
					const journal = await execute(
						"journalctl",
						[
							"--user",
							"-u",
							unit,
							"--since",
							crashSince,
							"--no-pager",
							"--quiet",
							"-o",
							"json",
						],
						5000,
					);
					if (startLimitEvidence(unit, p, journal)) {
						receipt.exhaustion = { unit, properties: p, journal };
						return { exhausted: true };
					}
				}
				const s = await status();
				if (!s.healthy || s.owner.pid === previousPid) return false;
				pids.add(s.owner.pid);
				return s;
			}, "native crash restart or burst exhaustion");
			exhausted = Boolean(current.exhausted);
		}
		assert(exhausted, "Repeated crashes must exhaust native start limit");
		// Observe beyond RestartSec without extending the original restart wait.
		const stableStarted = Date.now();
		const stableUntil = stableStarted + 10500;
		while (Date.now() < stableUntil) {
			await delay(200, undefined, { signal });
			const p = properties(
				await manager(
					"show",
					`${record.id}.service`,
					"--property=ActiveState,SubState,MainPID,ControlPID,Job,NRestarts",
				),
			);
			assert(terminal(p), "Exhausted unit queued or resumed a restart");
			assert.equal(p.NRestarts, receipt.exhaustion.properties.NRestarts);
		}
		receipt.exhaustion.stableMs = Date.now() - stableStarted;
		observed(
			"Actual crash recovery delays at least 9s; repeated crashes exhaust StartLimitBurst",
		);
		await command("stop");
		await manager("reset-failed", `${record.id}.service`);
		await command("restart");
		await healthy();
		await command("maintenance");
		await expectRefusal("start");
		assert.equal((await status()).desired, "maintenance");
		await manager("start", `${record.id}.service`);
		await until(
			async () =>
				/ActiveState=inactive/.test(
					await manager(
						"show",
						`${record.id}.service`,
						"--property=ActiveState",
					),
				),
			"manager launch suppressed in maintenance",
		);
		assert.equal((await status()).owner, null);
		await command("resume");
		await healthy();
		await command("enable");
		await command("disable");
		assert.equal((await status()).owner, null);
		assert.equal((await status()).startup, false);
		assert.match((await status()).startupActual, /disabled/);
		observed(
			"Enable/disable probes actual enrollment; disable drains worker; maintenance resists direct manager start",
		);
		const removed = JSON.parse(await command("remove"));
		assert.equal(readFileSync(removed.retainedDefinition, "utf8"), workerBytes);
		assert.equal((await status()).installed, false);
		for (const name of retained)
			assert.equal(hash(join(home, name)), before[name]);
		assert.equal(hash(externalDefinition), externalHash);
		receipt.retainedHashes = before;
		receipt.externalDefinitionHash = externalHash;
		observed(
			"Removal retains owned/external definitions, PM2/Nix fixture records and synthetic checkpoint/waiting gate bytes",
		);
		receipt.passed = true;
	},
	cleanup: async () => {
		cleaning = true;
		await capture("before-teardown");
		if (probe.listening) await new Promise((resolve) => probe.close(resolve));
		const cleanupErrors = [];
		foreground?.kill();
		if (foreground) await foreground.done.catch(() => {});
		if (foreground && !foreground.drained)
			cleanupErrors.push("Manual fixture group did not drain");
		for (const owned of commands) owned.kill();
		await Promise.allSettled([...commands].map((owned) => owned.done));
		if ([...commands].some((owned) => !owned.drained))
			cleanupErrors.push(
				"Command group did not drain before manager reconciliation",
			);
		for (const unit of new Set(units)) {
			try {
				await stopOwnedUnit({
					unit,
					manager,
					verifyDefinition: () => verifyDefinition(unit),
					until,
				});
				if (verifyDefinition(unit)) unlinkSync(join(unitDirectory, unit));
			} catch (error) {
				cleanupErrors.push(`${unit}: ${error.message}`);
			}
		}
		try {
			await manager("daemon-reload");
			await until(
				() => [...pids].every((pid) => !alive(pid)),
				"fixture processes exit",
				15000,
			);
			// Check descendants by fixture paths as well as every observed manager PID.
			const processes = await execute(
				"ps",
				["-eo", "pid=,ppid=,cgroup=,args="],
				500,
			);
			receipt.survivors = processes
				.split("\n")
				.filter(
					(line) =>
						line.includes(root) || units.some((unit) => line.includes(unit)),
				);
			assert.equal(
				receipt.survivors.length,
				0,
				"Unobserved fixture descendant survived",
			);
			for (const unit of new Set(units)) {
				const finalProperties = await manager(
					"show",
					unit,
					"--property=ActiveState,SubState,MainPID,ControlPID,Job",
				);
				assert(
					terminal(properties(finalProperties)),
					"Unit still has a process or manager job",
				);
			}
			// remove retains definitions outside the state home. Record then remove
			// only backups belonging to these exact ephemeral fixture identities.
			receipt.retainedDefinitionBackups = [];
			for (const name of readdirSync(unitDirectory)) {
				if (!units.some((unit) => name.startsWith(`${unit}.removed-`)))
					continue;
				const path = join(unitDirectory, name);
				assert(
					!lstatSync(path).isSymbolicLink(),
					"Retained definition became a symlink",
				);
				assert.equal(
					readFileSync(path, "utf8"),
					definitions.get(name.slice(0, name.indexOf(".removed-"))),
				);
				receipt.retainedDefinitionBackups.push({ name, sha256: hash(path) });
				unlinkSync(path);
			}
			if (
				interruptPhase === "initial-install" ||
				interruptPhase === "manager-mutation"
			) {
				await delay(650);
				receipt.lateMutation = existsSync(lateMutation);
				assert.equal(
					receipt.lateMutation,
					false,
					"CLI descendant mutated after cleanup began",
				);
			}
			assert.equal(cleanupErrors.length, 0, cleanupErrors.join("; "));
			receipt.survivors = [];
			receipt.retainedBackupNames = (
				existsSync(join(home, "runtime"))
					? readdirSync(join(home, "runtime"))
					: []
			).filter((name) => name.includes(".removed-"));
			rmSync(root, { recursive: true, force: true });
			receipt.cleanup = true;
		} catch (error) {
			receipt.cleanupError = error.message;
			receipt.passed = false;
		}
	},
	persist: () => {
		writeFileSync(`${receiptPath}.tmp`, JSON.stringify(receipt, null, 2), {
			flag: "wx",
			mode: 0o600,
		});
		renameSync(`${receiptPath}.tmp`, receiptPath);
		console.log(JSON.stringify(receipt));
	},
});
if (!receipt.interrupted)
	assert(
		receipt.passed && receipt.cleanup,
		"Acceptance or owned cleanup failed; receipt is nonpassing",
	);
