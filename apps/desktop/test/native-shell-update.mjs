// Linux-only actual packaged AppImage + native Factory worker. Controlled unsigned
// publisher/transport and simulated outer release evidence, no OS/provider claim.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultWorkflows } from "../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { validateWorkflows } from "../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../../../packages/edge-worker/dist/MachineCapacity.js";
import { sha256File } from "../../../scripts/lib/binary-release.mjs";
import { prepareElectronLicenses } from "../../../scripts/lib/desktop-licenses.mjs";
import { localRepository } from "../../cli/dist/src/onboarding.js";
import { retainAppHelper } from "../src/app-helper-files.mjs";
import {
	DesktopAppLifecycle,
	processStamp,
	read,
	save,
} from "../src/app-lifecycle.mjs";
import { DesktopAppSource } from "../src/app-source.mjs";
import * as services from "../src/update-services.mjs";
import {
	nativeShellInputReceipt,
	nativeShellPlan,
} from "./native-shell-fixture.mjs";
import { appRelease, fixtureClient } from "./shell-fixture.mjs";

assert.equal(
	process.platform,
	"linux",
	"This fixture requires Linux AppImage; it does not exercise macOS per-app permission",
);
const [imageArgument, runtimeArgument, candidateArgument] =
	process.argv.slice(2);
if (!imageArgument || !runtimeArgument || !candidateArgument)
	throw Error("APPIMAGE RUNTIME_DIRECTORY CANDIDATE_JSON required");
const image = resolve(imageArgument),
	native = resolve(runtimeArgument),
	frozen = read(candidateArgument),
	plan = nativeShellPlan(frozen),
	target = `linux-${process.arch}`,
	root = mkdtempSync(join(tmpdir(), "native-shell-")),
	home = join(root, "home"),
	install = join(root, "Bob.AppImage"),
	port = 3989;
mkdirSync(home);
process.env.HOME = join(root, "os-home");
mkdirSync(process.env.HOME);
process.env.APPIMAGE_EXTRACT_AND_RUN = "1";
cpSync(image, install);
const app = resolve("apps/desktop"),
	priorOutput = join(root, "prior"),
	electronLicenses = prepareElectronLicenses(app);
// Beta is the real installed baseline and updates to synthetic stable variants.
// Nightly retains the older synthetic baseline and real input upgrade payload.
const prior = plan.baseline;
function buildVariant(record, output, file) {
	prepareElectronLicenses(app);
	cpSync(native, join(app, "runtime"), { recursive: true });
	writeFileSync(
		join(app, "desktop-identity.json"),
		JSON.stringify({
			version: record.candidate.version,
			channel: record.candidate.channel,
			commit: record.candidate.commit,
			target,
		}),
	);
	try {
		execFileSync(
			"pnpm",
			[
				"exec",
				"electron-builder",
				"--linux",
				"AppImage",
				`--${process.arch}`,
				"--publish",
				"never",
				`--config.directories.output=${output}`,
				`--config.extraMetadata.version=${record.candidate.version}`,
				`--config.artifactName=${file}`,
			],
			{
				cwd: app,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
			},
		);
	} finally {
		rmSync(join(app, "runtime"), { recursive: true, force: true });
		rmSync(join(app, "desktop-identity.json"), { force: true });
	}
}
if (plan.inputRole !== "installed-baseline") {
	buildVariant(prior, priorOutput, "previous.AppImage");
	cpSync(join(priorOutput, "previous.AppImage"), install);
}
let successfulImage = image;
if (plan.successful.digest !== frozen.digest) {
	const successfulOutput = join(root, "successful");
	buildVariant(plan.successful, successfulOutput, "successful.AppImage");
	successfulImage = join(successfulOutput, "successful.AppImage");
}
const failedCandidate = plan.failed;
const failedOutput = join(root, "failed");
buildVariant(failedCandidate, failedOutput, "failed.AppImage");
const old = appRelease(prior.candidate.channel, readFileSync(install), target, {
		frozenCandidate: prior,
		electronLicenses,
	}),
	good = appRelease(
		plan.successful.candidate.channel,
		readFileSync(successfulImage),
		target,
		{
			frozenCandidate: plan.successful,
			electronLicenses,
		},
	),
	bad = appRelease(
		failedCandidate.candidate.channel,
		readFileSync(join(failedOutput, "failed.AppImage")),
		target,
		{ frozenCandidate: failedCandidate, electronLicenses },
	);
// Prepare a genuine configured repository and a completed mocked agent checkpoint
// at a human review gate. Native startup must never execute a provider/title agent.
const repository = join(root, "project");
execFileSync("git", ["init", "-q", "-b", "main", repository]);
execFileSync("git", [
	"-C",
	repository,
	"-c",
	"user.name=Fixture",
	"-c",
	"user.email=fixture@example.invalid",
	"commit",
	"--allow-empty",
	"-qm",
	"Shell fixture",
]);
execFileSync("git", [
	"-C",
	repository,
	"remote",
	"add",
	"origin",
	"https://github.com/f1-test/shell-update",
]);
writeFileSync(
	join(home, "config.json"),
	JSON.stringify({
		repositories: [localRepository(repository, home, "fixture")],
		defaultRunner: "codex",
	}),
);
const seed = new WorkflowRuntime(home, {
	agent: async (ctx) => {
		ctx.checkpointAgent?.({
			runner: "codex",
			sessionId: "mock-native-shell-checkpoint",
			cwd: repository,
		});
		return { prepared: true, scope: "mock checkpoint only" };
	},
	script: async () => ({}),
	tool: async () => ({
		headSha: "d".repeat(40),
		url: "https://example.invalid/shell-review",
	}),
});
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		id: "fixture",
		name: "Fixture",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "prepare",
				name: "Mock completed checkpoint",
				type: "agent",
				runner: "codex",
				prompt: "Mock only",
				next: "review",
			},
			{
				id: "review",
				name: "Retained human review",
				type: "tool",
				tool: "human-review",
				next: "end",
			},
		],
	},
]).at(-1);
const run = seed.create({
	id: "native-shell-wait",
	title: "Retained shell checkpoint",
	repositoryId: "fixture",
	workspace: repository,
	input: "fixture",
	triggerOrigin: {
		type: "manual",
		workflowId: "fixture",
		at: new Date().toISOString(),
	},
	workflow,
});
run.titleGeneration = {
	...run.titleGeneration,
	state: "failed",
	error: "Fixture disables title inference",
};
run.setupComplete = true;
seed.save(run);
void seed.launch(run);
for (let n = 0; n < 100 && run.status !== "waiting"; n++)
	await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(run.status, "waiting");
await seed.shutdown();
const env = {
	...process.env,
	APPIMAGE_EXTRACT_AND_RUN: "1",
	BOBS_FACTORY_DESKTOP_HOME: home,
	BOBS_FACTORY_DESKTOP_PORT: String(port),
};
const worker = spawn(
	join(native, "bobs-factory"),
	["--home", home, "--port", String(port), "--no-open", "local"],
	{ env: { ...env, BOBS_FACTORY_DESKTOP_OWNER: "1" }, stdio: "ignore" },
);
const until = async (check) => {
	const deadline = Date.now() + 30000;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "Native shell wait timed out");
		await new Promise((r) => setTimeout(r, 100));
	}
};
await until(async () => {
	try {
		return (
			(await fetch(`http://localhost:${port}/api/version`)).ok &&
			services.workerOwner(home)
		);
	} catch {
		return false;
	}
});
const owned = services.workerOwner(home),
	directory = join(home, "desktop", "updates"),
	controlled = services,
	source = new DesktopAppSource(
		directory,
		install,
		target,
		controlled,
		fixtureClient([old, good], services),
	);
const client = new services.FactoryClient({
	home,
	port,
	requestSession: services.requestFactoryTerminalSession,
});
await until(async () => {
	try {
		return (await client.get(`/api/runs/${run.id}`)).status === "waiting";
	} catch (error) {
		if (error.status === 404) return false;
		throw error;
	}
});
save(
	join(directory, "installation.json"),
	await source.enroll({ ...old.identity, target }),
);
const bootManager = new services.UpdateManager(
	join(home, "desktop"),
	source,
	undefined,
	{ ...old.identity, target },
);
bootManager.configure({}, 0);
save(bootManager.file, {
	...read(bootManager.file),
	nextCheckAt: Date.now() + 3600000,
});
const ui = spawn(install, ["--no-sandbox"], { env, stdio: "ignore" });
await new Promise((r, j) => {
	ui.once("spawn", r);
	ui.once("error", j);
});
await until(() => existsSync(join(directory, "ui-session.json")));
const uiIdentity = read(join(directory, "ui-session.json"));
assert.equal(uiIdentity.identity.version, prior.candidate.version);
const life = new DesktopAppLifecycle(
		{
			home,
			install,
			target,
			port,
			uiPid: uiIdentity.pid,
			uiStamp: uiIdentity.stamp,
			launchArgs: ["--no-sandbox"],
		},
		controlled,
	),
	manager = new services.UpdateManager(join(home, "desktop"), source, life, {
		...old.identity,
		target,
	});
const capacity = new MachineCapacity(2, join(home, "machine-capacity"));
await capacity.ready();
let candidatePid;
try {
	manager.configure(plan.settings, manager.status().revision);
	await manager.check();
	await manager.stage();
	const lease = await capacity.acquireLease(undefined, {
		identity: "native-shell-active",
	});
	let observedBusy = false;
	const isIdle = life.isIdle.bind(life);
	life.isIdle = async () => {
		const idle = await isIdle();
		if (!idle) observedBusy = true;
		return idle;
	};
	const draining = manager.reconcile();
	draining.catch(() => {}); // Preserve rejection for the awaited result below.
	try {
		await until(() => observedBusy);
		assert.equal(manager.status().transaction.phase, "draining");
		assert.equal(services.workerOwner(home).pid, owned.pid);
		assert.equal(processStamp(uiIdentity.pid), life.uiStamp);
		assert.equal(existsSync(join(directory, "quit.json")), false);
	} finally {
		// Cancel the controlled probe; a busy observation no longer cancels an
		// automatic update. The retained external helper performs the real switch.
		manager.configure({ paused: true }, manager.status().revision);
		try {
			await draining;
		} finally {
			await lease.release();
			life.isIdle = isIdle;
		}
	}
	assert.equal(manager.status().transaction.phase, "cancelled");
	manager.configure({ paused: false }, manager.status().revision);
	// The first real maintenance admission inspected native drain under its
	// fence and deferred for the capacity lease. Startup recovery has completed;
	// freeze that waiting checkpoint before either app activation or rollback.
	const saved = readFileSync(join(home, "factory", "runs", `${run.id}.json`));
	assert.match(saved.toString(), /mock-native-shell-checkpoint/);
	// The actual main.mjs reads its exact quit ticket, exits, and the production
	// lifecycle launches/health-checks the replacement actual packaged Electron.
	const retained = join(root, "external-helper");
	retainAppHelper(join(app, "src"), retained);
	const request = join(retained, "request.json");
	save(request, {
		home,
		install,
		target,
		port,
		directory,
		identity: { ...old.identity, target },
		uiPid: uiIdentity.pid,
		uiStamp: uiIdentity.stamp,
		launchArgs: ["--no-sandbox"],
	});
	const log = openSync(join(root, "helper.log"), "a");
	const helper = spawn(
		join(app, "node_modules", "electron", "dist", "electron"),
		[join(retained, "app-helper.mjs"), request],
		{ env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", log, log] },
	);
	closeSync(log);
	const helperExit = await new Promise((r, j) => {
		helper.once("exit", r);
		helper.once("error", j);
	});
	assert.equal(helperExit, 0, readFileSync(join(root, "helper.log"), "utf8"));
	assert.equal(
		manager.status().transaction.phase,
		"succeeded",
		JSON.stringify(manager.status().transaction),
	);
	candidatePid = read(manager.status().transaction.snapshot).child.pid;
	assert.equal(services.workerOwner(home).pid, owned.pid);
	assert.equal(services.workerOwner(home).nonce, owned.nonce);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	// A separately built, newer actual shell fails health deliberately. Preserve
	// truthful installed identity and restore the retained successful UI bytes.
	life.uiPid = candidatePid;
	life.uiStamp = processStamp(candidatePid);
	source.client = fixtureClient([old, bad], services);
	life.health = async (candidate) => {
		await DesktopAppLifecycle.prototype.health.call(life, candidate);
		if (candidate.version === failedCandidate.candidate.version)
			throw Error("Controlled candidate health failure");
	};
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	assert.equal(manager.status().transaction.phase, "rolled-back");
	assert.equal(services.workerOwner(home).pid, owned.pid);
	assert.deepEqual(
		readFileSync(join(home, "factory", "runs", `${run.id}.json`)),
		saved,
	);
	assert.equal(manager.status().badCandidates.length, 1);
	console.log(
		JSON.stringify(
			{
				status: "passed",
				scope:
					"actual unsigned AppImage/Electron and native worker; controlled unsigned release and simulated outer release evidence; Xvfb --no-sandbox; no real provider or Apple signing",
				version: frozen.candidate.version,
				commit: frozen.candidate.commit,
				target,
				candidateDigest: frozen.digest,
				...nativeShellInputReceipt(
					frozen,
					plan,
					sha256File(image),
					good.manifest.desktop.artifacts[0].updateArchive.sha256,
					bad.manifest.desktop.artifacts[0].updateArchive.sha256,
				),
				workerPidUnchanged: true,
				checks: [
					"active-lease deferral",
					"actual external Electron Node-mode helper entry",
					"actual Electron exit before complete-app replacement",
					"actual candidate health identity",
					"same native worker PID/nonce",
					"waiting workflow checkpoint byte preservation",
					"actual candidate stop before rollback",
					"failed candidate suppression",
				],
			},
			null,
			2,
		),
	);
} finally {
	for (const path of [join(directory, "state.json")])
		if (existsSync(path)) {
			const t = read(path).transaction;
			if (t?.snapshot && existsSync(t.snapshot)) {
				const s = read(t.snapshot);
				if (s.child?.stamp && processStamp(s.child.pid) === s.child.stamp)
					try {
						process.kill(s.child.pid, "SIGTERM");
					} catch {}
			}
		}
	if (candidatePid)
		try {
			process.kill(candidatePid, "SIGTERM");
		} catch {}
	try {
		process.kill(ui.pid, "SIGTERM");
	} catch {}
	worker.kill("SIGTERM");
	await capacity.shutdown();
	old.cleanup();
	good.cleanup();
	bad.cleanup();
	// Retain the isolated root for receipt/failed-process inspection, never prune
	// a production home. The native process owner is stopped by this fixture only.
}
