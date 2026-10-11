// Native manager acceptance, restricted to ephemeral GitHub Linux runners.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
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
const execute = (program, args, timeout) =>
	new Promise((resolve, reject) => {
		checkCancellation();
		const child = execFile(
			program,
			args,
			{
				encoding: "utf8",
				timeout,
				killSignal: "SIGKILL",
			},
			(error, stdout, stderr) => {
				commands.delete(child);
				if (error) {
					error.stdout = stdout;
					error.stderr = stderr;
					error.status = error.code;
					reject(error);
				} else resolve(stdout);
			},
		);
		commands.add(child);
		const abort = () => child.kill("SIGKILL");
		if (!cleaning) {
			cancellation?.addEventListener("abort", abort, { once: true });
			child.once("exit", () =>
				cancellation?.removeEventListener("abort", abort),
			);
		}
	});
const manager = (...args) =>
	execute("systemctl", ["--user", ...args], cleaning ? 500 : 5000);
const command = (...args) =>
	execute(executable, [...prefix, "service", ...args], 30000);
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
		writeFileSync(
			externalDefinition,
			`[Unit]\nDescription=Disposable external owner fixture\n[Service]\nExecStart=${executable} ${prefix.join(" ")} local\nRestart=on-failure\nRestartSec=1\n[Install]\nWantedBy=default.target\n`,
			{ flag: "wx", mode: 0o600 },
		);
		units.push(externalId);
		await manager("show", "default.target", "--property=ActiveState");
		const managedId = `de.bobs-factory.${createHash("sha256").update(home).digest("hex").slice(0, 16)}.service`;
		const nixDefinition = join(unitDirectory, managedId);
		writeFileSync(
			nixDefinition,
			"[Service]\nExecStart=/nix/store/fixture-only/bobs-factory\n",
			{ flag: "wx", mode: 0o600 },
		);
		units.push(managedId);
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
		foreground = spawn(executable, [...prefix, "local"], { stdio: "ignore" });
		pids.add(foreground.pid);
		await until(async () => (await status()).owner, "manual owner lock");
		await expectRefusal(
			"install",
			"--executable",
			executable,
			"--mode",
			"local",
		);
		assert(!existsSync(join(home, "runtime", "service.json")));
		foreground.kill("SIGTERM");
		await until(
			async () => !alive(foreground.pid) && !(await status()).owner,
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
		await command("install", "--executable", executable, "--mode", "local");
		record = await status();
		units.push(`${record.id}.service`, `${record.id}.updates.service`);
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
		writeFileSync(record.definition, "External definition; do not adopt\n");
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
		writeFileSync(record.definition, workerBytes);
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
		await command("start");
		const first = await healthy();
		const interrupt = process.env.BOBS_FACTORY_ACCEPTANCE_INTERRUPT;
		if (interrupt) {
			assert(["SIGINT", "SIGTERM"].includes(interrupt));
			receipt.interruptPhase = "healthy-managed-fixture";
			process.kill(process.pid, interrupt);
			await delay(1000, undefined, { signal });
			assert.fail("Interrupt must unwind acceptance before further mutations");
		}
		assert.equal(first.owner.dashboardPort, port);
		await manager("reset-failed", `${record.id}.service`);
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
				if (
					/Result=start-limit-hit/.test(
						await manager("show", `${record.id}.service`, "--property=Result"),
					)
				)
					return { exhausted: true };
				const s = await status();
				if (!s.healthy || s.owner.pid === previousPid) return false;
				pids.add(s.owner.pid);
				return s;
			}, "native crash restart or burst exhaustion");
			exhausted = Boolean(current.exhausted);
		}
		assert(exhausted, "Repeated crashes must exhaust native start limit");
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
		// Bound every manager call. Kill only the exact fixture units if graceful stop fails.
		let cleanupError;
		// ChildProcess.kill refuses an exited/reaped child rather than using a retained PID.
		foreground?.kill(receipt.interrupted ? "SIGKILL" : "SIGTERM");
		if (foreground && !receipt.interrupted) {
			try {
				await until(
					async () =>
						foreground.exitCode !== null || foreground.signalCode !== null,
					"manual fixture graceful exit",
					receipt.interrupted ? 200 : 2000,
				);
			} catch {
				foreground.kill("SIGKILL");
			}
		}
		for (const child of commands) child.kill("SIGKILL");
		for (const unit of new Set(units)) {
			try {
				if (receipt.interrupted)
					await manager("kill", "--kill-whom=all", "--signal=SIGKILL", unit);
				await manager("disable", unit);
				await manager("stop", "--no-block", unit);
				await until(
					async () =>
						/ActiveState=(inactive|failed)/.test(
							await manager("show", unit, "--property=ActiveState"),
						),
					"fixture unit stopped",
					receipt.interrupted ? 200 : 2000,
				);
			} catch {
				try {
					await manager("kill", "--kill-whom=all", "--signal=SIGKILL", unit);
					await manager("stop", "--no-block", unit);
				} catch (error) {
					if (
						!/LoadState=not-found/.test(
							await manager("show", unit, "--property=LoadState"),
						)
					)
						cleanupError = error.message;
				}
			}
			const path = join(unitDirectory, unit);
			if (existsSync(path)) unlinkSync(path);
		}
		try {
			await manager("daemon-reload");
			await until(
				() => [...pids].every((pid) => !alive(pid)),
				"fixture processes exit",
				receipt.interrupted ? 1000 : 15000,
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
				const properties = await manager(
					"show",
					unit,
					"--property=ActiveState,MainPID",
				);
				assert.match(properties, /^MainPID=0$/m);
				assert.match(properties, /^ActiveState=(inactive|failed)$/m);
			}
			// remove retains definitions outside the state home. Record then remove
			// only backups belonging to these exact ephemeral fixture identities.
			receipt.retainedDefinitionBackups = [];
			for (const name of readdirSync(unitDirectory)) {
				if (!units.some((unit) => name.startsWith(`${unit}.removed-`)))
					continue;
				const path = join(unitDirectory, name);
				receipt.retainedDefinitionBackups.push({ name, sha256: hash(path) });
				unlinkSync(path);
			}
			assert(!cleanupError, cleanupError);
			receipt.cleanup = true;
			receipt.survivors = [];
			receipt.retainedBackupNames = (
				existsSync(join(home, "runtime"))
					? readdirSync(join(home, "runtime"))
					: []
			).filter((name) => name.includes(".removed-"));
			rmSync(root, { recursive: true, force: true });
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
