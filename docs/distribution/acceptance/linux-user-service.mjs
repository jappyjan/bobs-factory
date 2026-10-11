// Native manager acceptance, restricted to ephemeral GitHub Linux runners.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
import { join } from "node:path";
import { desktopExecutable } from "../../../apps/desktop/src/local-runtime.mjs";

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
await new Promise((resolve, reject) => {
	probe.once("error", reject);
	probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const prefix = ["--home", home, "--port", String(port), "--no-open"];
const units = [];
const pids = new Set();
let foreground;
let record;
const manager = (...args) =>
	execFileSync("systemctl", ["--user", ...args], {
		encoding: "utf8",
		timeout: 20000,
	});
const command = (...args) =>
	execFileSync(executable, [...prefix, "service", ...args], {
		encoding: "utf8",
		timeout: 30000,
		stdio: ["ignore", "pipe", "pipe"],
	});
const status = () => JSON.parse(command("status"));
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
		const result = check();
		if (result) return result;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw Error(`Timed out: ${label}`);
};
const healthy = (excludedPid) =>
	until(() => {
		const s = status();
		if (!s.healthy || s.owner.pid === excludedPid) return false;
		pids.add(s.owner.pid);
		return s;
	}, "native worker health");
const observed = (name) => receipt.assertions.push(name);
const expectRefusal = (...args) => {
	try {
		command(...args);
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
const before = Object.fromEntries(
	retained.map((name) => [name, hash(join(home, name))]),
);
const unitDirectory = join(homedir(), ".config", "systemd", "user");
mkdirSync(unitDirectory, { recursive: true });
const externalId = `factory-acceptance-external-${randomUUID()}.service`;
const externalDefinition = join(unitDirectory, externalId);
// Fixture paths come from mkdtemp and contain no quoting-sensitive characters.
writeFileSync(
	externalDefinition,
	`[Unit]\nDescription=Disposable external owner fixture\n[Service]\nExecStart=${executable} ${prefix.join(" ")} local\nRestart=on-failure\nRestartSec=1\n[Install]\nWantedBy=default.target\n`,
	{ flag: "wx", mode: 0o600 },
);
units.push(externalId);
try {
	manager("show", "default.target", "--property=ActiveState");
	const managedId = `de.bobs-factory.${createHash("sha256").update(home).digest("hex").slice(0, 16)}.service`;
	const nixDefinition = join(unitDirectory, managedId);
	writeFileSync(
		nixDefinition,
		"[Service]\nExecStart=/nix/store/fixture-only/bobs-factory\n",
		{ flag: "wx", mode: 0o600 },
	);
	units.push(managedId);
	const nixHash = hash(nixDefinition);
	expectRefusal("install", "--executable", executable, "--mode", "local");
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
	await until(() => status().owner, "manual owner lock");
	expectRefusal("install", "--executable", executable, "--mode", "local");
	assert(!existsSync(join(home, "runtime", "service.json")));
	foreground.kill("SIGTERM");
	await until(
		() => !alive(foreground.pid) && !status().owner,
		"manual graceful handoff",
	);
	observed(
		"Manual process blocks adoption; explicit fixture stop releases ownership",
	);
	manager("daemon-reload");
	manager("enable", "--now", externalId);
	const externalOwner = await until(
		() => status().owner,
		"external unit owner",
	);
	pids.add(externalOwner.pid);
	const externalHash = hash(externalDefinition);
	expectRefusal("install", "--executable", executable, "--mode", "local");
	manager("disable", "--now", externalId);
	await until(
		() => !alive(externalOwner.pid) && !status().owner,
		"external owner disabled before replacement",
	);
	assert.equal(hash(externalDefinition), externalHash);
	observed(
		"Actual external user service disabled and stopped before replacement; definition retained",
	);
	command("install", "--executable", executable, "--mode", "local");
	record = status();
	units.push(`${record.id}.service`, `${record.id}.updates.service`);
	assert.equal(record.startup, false);
	assert.equal(record.desired, "stopped");
	const updaterDefinition = record.definition.replace(
		/\.service$/,
		".updates.service",
	);
	const workerBytes = readFileSync(record.definition, "utf8");
	const updaterBytes = readFileSync(updaterDefinition, "utf8");
	unlinkSync(updaterDefinition);
	command("install", "--executable", executable, "--mode", "local");
	assert.equal(readFileSync(updaterDefinition, "utf8"), updaterBytes);
	unlinkSync(updaterDefinition);
	writeFileSync(record.definition, "External definition; do not adopt\n");
	expectRefusal("install", "--executable", executable, "--mode", "local");
	assert.equal(
		readFileSync(record.definition, "utf8"),
		"External definition; do not adopt\n",
	);
	writeFileSync(record.definition, workerBytes);
	command("install", "--executable", executable, "--mode", "local");
	observed(
		"Interrupted stopped setup restores only missing owned definition; modified definition is refused",
	);
	command("enable");
	assert.equal(manager("is-enabled", `${record.id}.service`).trim(), "enabled");
	command("disable");
	assert.match(status().startupActual, /disabled/);
	assert.equal(status().owner, null);
	command("start");
	const first = await healthy();
	assert.equal(first.owner.dashboardPort, port);
	manager("reset-failed", `${record.id}.service`);
	const killedAt = Date.now();
	process.kill(first.owner.pid, "SIGKILL");
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
		process.kill(current.owner.pid, "SIGKILL");
		const previousPid = current.owner.pid;
		current = await until(() => {
			if (
				/Result=start-limit-hit/.test(
					manager("show", `${record.id}.service`, "--property=Result"),
				)
			)
				return { exhausted: true };
			const s = status();
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
	command("stop");
	manager("reset-failed", `${record.id}.service`);
	command("restart");
	await healthy();
	command("maintenance");
	expectRefusal("start");
	assert.equal(status().desired, "maintenance");
	manager("start", `${record.id}.service`);
	await until(
		() =>
			/ActiveState=inactive/.test(
				manager("show", `${record.id}.service`, "--property=ActiveState"),
			),
		"manager launch suppressed in maintenance",
	);
	assert.equal(status().owner, null);
	command("resume");
	await healthy();
	command("enable");
	command("disable");
	assert.equal(status().owner, null);
	assert.equal(status().startup, false);
	assert.match(status().startupActual, /disabled/);
	observed(
		"Enable/disable probes actual enrollment; disable drains worker; maintenance resists direct manager start",
	);
	const removed = JSON.parse(command("remove"));
	assert.equal(readFileSync(removed.retainedDefinition, "utf8"), workerBytes);
	assert.equal(status().installed, false);
	for (const name of retained)
		assert.equal(hash(join(home, name)), before[name]);
	assert.equal(hash(externalDefinition), externalHash);
	receipt.retainedHashes = before;
	receipt.externalDefinitionHash = externalHash;
	observed(
		"Removal retains owned/external definitions, PM2/Nix fixture records and synthetic checkpoint/waiting gate bytes",
	);
	receipt.passed = true;
} catch (error) {
	receipt.error = error.message;
} finally {
	// Bound every manager call. Kill only the exact fixture units if graceful stop fails.
	let cleanupError;
	foreground?.kill("SIGTERM");
	for (const unit of new Set(units)) {
		try {
			manager("disable", "--now", unit);
		} catch {
			try {
				manager("kill", "--kill-whom=all", "--signal=SIGKILL", unit);
				manager("stop", unit);
			} catch (error) {
				if (
					!/LoadState=not-found/.test(
						manager("show", unit, "--property=LoadState"),
					)
				)
					cleanupError = error.message;
			}
		}
		const path = join(unitDirectory, unit);
		if (existsSync(path)) unlinkSync(path);
	}
	try {
		manager("daemon-reload");
		await until(
			() => [...pids].every((pid) => !alive(pid)),
			"fixture processes exit",
			15000,
		);
		// Check descendants by fixture paths as well as every observed manager PID.
		const processes = execFileSync("ps", ["-eo", "pid=,args="], {
			encoding: "utf8",
			timeout: 10000,
		});
		assert(
			!processes.split("\n").some((line) => line.includes(root)),
			"Unobserved fixture descendant survived",
		);
		assert(!cleanupError, cleanupError);
		receipt.cleanup = true;
		receipt.survivors = [];
		receipt.retainedBackupNames = readdirSync(join(home, "runtime")).filter(
			(name) => name.includes(".removed-"),
		);
		rmSync(root, { recursive: true, force: true });
	} catch (error) {
		receipt.cleanupError = error.message;
		receipt.passed = false;
	}
	writeFileSync(`${receiptPath}.tmp`, JSON.stringify(receipt, null, 2), {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(`${receiptPath}.tmp`, receiptPath);
	console.log(JSON.stringify(receipt));
}
assert(
	receipt.passed && receipt.cleanup,
	"Acceptance or owned cleanup failed; receipt is nonpassing",
);
