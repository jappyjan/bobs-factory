import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	candidateKey,
	type InstalledUpdate,
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "../src/updates/UpdateManager.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const installed: InstalledUpdate = {
	version: "1.0.0",
	commit: "a".repeat(40),
	target: "darwin-arm64",
};
const candidate: UpdateCandidate = {
	version: "1.1.0-nightly.20261010.100",
	commit: "b".repeat(40),
	channel: "nightly",
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};
function fixture(value = candidate) {
	const home = mkdtempSync(join(tmpdir(), "factory-update-test-"));
	homes.push(home);
	const source: UpdateSource = {
		discover: vi.fn(async () => value),
		stage: vi.fn(async (current) => ({
			candidate: current,
			executable: "/isolated/new",
			previousExecutable: "/isolated/old",
		})),
	};
	const calls: string[] = [];
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: vi.fn(async () => {
			calls.push("maintenance");
		}),
		isIdle: vi.fn(async () => true),
		prepare: vi.fn(async () => ({})),
		stop: vi.fn(async () => {
			calls.push("stop");
		}),
		activate: vi.fn(async () => {
			calls.push("activate");
		}),
		start: vi.fn(async () => {
			calls.push("start");
		}),
		health: vi.fn(async () => {
			calls.push("health");
		}),
		rollback: vi.fn(async () => {
			calls.push("rollback");
		}),
		releaseMaintenance: vi.fn(async () => {
			calls.push("release");
		}),
	};
	const manager = new UpdateManager(home, source, lifecycle, installed);
	return { home, manager, source, lifecycle, calls };
}
it.each([
	"prepare",
] as const)("cancels a throwing %s before draining and releases operation ownership in the live supervisor", async (step) => {
	const { home, manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle[step]).mockRejectedValueOnce(
		Object.assign(new Error("ENOSPC: no space left on device"), {
			code: "ENOSPC",
		}),
	);
	await manager.reconcile();
	expect(new UpdateManager(home).status().transaction).toMatchObject({
		phase: "cancelled",
		switchStarted: false,
		error: "ENOSPC: no space left on device",
		release: { outcome: "cancelled", status: "acknowledged" },
	});
	expect(manager.status().error).toBe("ENOSPC: no space left on device");
	expect(lifecycle.stop).not.toHaveBeenCalled();
	// Prepared before maintenance: a rejected candidate never froze intake, and a
	// full disk is not the candidate's fault.
	expect(lifecycle.acquireMaintenance).not.toHaveBeenCalled();
	expect(manager.status().badCandidates).toEqual([]);
	expect(existsSync(join(home, "updates", "operation.lock"))).toBe(false);
	expect(
		readdirSync(join(home, "updates")).filter((name) =>
			name.startsWith("operation-reserve-"),
		),
	).toEqual([]);
	// Same process can inspect/check and explicitly retry; no dead-owner recovery.
	await manager.check();
	manager.requestInstall(
		candidateKey(candidate),
		manager.status().revision,
		true,
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("succeeded");
});

it.each([
	"prepare",
] as const)("records %s failure and frees its lock when the volume also refuses journal/guard writes", async (step) => {
	const { default: fs } = await import("node:fs");
	const { syncBuiltinESMExports } = await import("node:module");
	const { home, manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	const write = fs.writeFileSync,
		symlink = fs.symlinkSync,
		remove = fs.rmSync;
	let exhausted = false;
	const enospc = () =>
		Object.assign(new Error("ENOSPC: volume exhausted"), { code: "ENOSPC" });
	fs.writeFileSync = ((...args) => {
		if (exhausted) throw enospc();
		return write(...args);
	}) as typeof write;
	fs.symlinkSync = ((...args) => {
		if (exhausted) throw enospc();
		return symlink(...args);
	}) as typeof symlink;
	fs.rmSync = ((path, options) => {
		let released = 0;
		try {
			released = fs.lstatSync(path).size;
		} catch {}
		remove(path, options);
		if (released >= 1024 * 1024) exhausted = false;
	}) as typeof remove;
	syncBuiltinESMExports();
	vi.mocked(lifecycle[step]).mockImplementationOnce(async () => {
		exhausted = true;
		throw enospc();
	});
	try {
		await manager.reconcile();
		expect(exhausted).toBe(false);
		expect(manager.status().transaction).toMatchObject({
			phase: "cancelled",
			error: "ENOSPC: volume exhausted",
			release: { outcome: "cancelled", status: "acknowledged" },
		});
		expect(existsSync(join(home, "updates", "operation.lock"))).toBe(false);
		expect(existsSync(join(home, "updates", "operation.lock.reclaim"))).toBe(
			false,
		);
		await manager.check();
	} finally {
		fs.writeFileSync = write;
		fs.symlinkSync = symlink;
		fs.rmSync = remove;
		syncBuiltinESMExports();
	}
});

it("keeps ownership blocking visible across status/check and preserves consent until verified reconciliation", async () => {
	const { home, manager, lifecycle } = fixture({
		...candidate,
		channel: "stable",
	});
	await manager.check();
	await manager.stage();
	const before = manager.requestInstall(
		candidateKey({ ...candidate, channel: "stable" }),
		manager.status().revision,
	);
	manager.reportWorkerOwnership(
		"Worker ownership record is missing; the worker may still be running.",
	);
	await manager.check();
	expect(new UpdateManager(home).status().blocked).toEqual(
		manager.status().blocked,
	);
	expect((await manager.tick()).blocked?.code).toBe("worker-ownership");
	await manager.reconcile();
	expect(lifecycle.acquireMaintenance).not.toHaveBeenCalled();
	expect(manager.status().pending?.consentRevision).toBe(before.revision);
	expect(manager.status().revision).toBe(before.revision);
	manager.reportWorkerOwnership();
	await manager.tick();
	expect(manager.status().blocked).toBeUndefined();
	expect(manager.status().transaction?.phase).toBe("succeeded");
});
it("persists per-channel choices, defaults, pin and pause independently per home", () => {
	const { home, manager } = fixture();
	expect(manager.status().effectivePolicy).toBe("manual");
	manager.configure({ channel: "nightly" }, 0);
	expect(manager.status().effectivePolicy).toBe("idle-auto");
	manager.configure(
		{ policy: "manual", pin: candidate.version, paused: true },
		1,
	);
	const restarted = new UpdateManager(home);
	expect(restarted.status().settings).toEqual(manager.status().settings);
	restarted.configure({ channel: "stable", policy: "idle-auto" }, 2);
	restarted.configure({ channel: "nightly", pin: null, paused: false }, 3);
	expect(restarted.status().effectivePolicy).toBe("manual");
	expect(fixture().manager.status().settings).toEqual({
		channel: "stable",
		overrides: {},
		paused: false,
	});
});
it("nightly auto installs only after safe drain; manual stable needs candidate-bound consent", async () => {
	const { manager, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"release",
	]);
	expect(manager.status().installed.version).toBe(candidate.version);
	const stable = fixture({ ...candidate, channel: "stable", version: "1.1.0" });
	await stable.manager.check();
	await stable.manager.stage();
	await stable.manager.reconcile();
	expect(stable.calls).toEqual([]);
	const status = stable.manager.status();
	stable.manager.requestInstall(
		candidateKey(status.pending!.candidate),
		status.revision,
	);
	await stable.manager.reconcile();
	expect(stable.calls).toContain("activate");
});
it("manual nightly override, stable auto override, pause and pin share the same gate", async () => {
	for (const settings of [
		{ channel: "nightly" as const, policy: "manual" as const },
		{ channel: "nightly" as const, paused: true },
		{ channel: "nightly" as const, pin: candidate.version },
	]) {
		const { manager, calls } = fixture();
		manager.configure(settings, 0);
		await manager.check();
		await manager.stage();
		await manager.reconcile();
		expect(calls).toEqual([]);
	}
	const stable = fixture({ ...candidate, channel: "stable", version: "1.1.0" });
	stable.manager.configure({ policy: "idle-auto" }, 0);
	await stable.manager.check();
	await stable.manager.stage();
	await stable.manager.reconcile();
	expect(stable.calls).toContain("activate");
});
it("keeps one drain transaction open while busy and installs as soon as work settles", async () => {
	const { manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	await manager.stage();
	manager.requestInstall(candidateKey(candidate), 1);
	vi.mocked(lifecycle.isIdle).mockResolvedValue(false);
	const installing = manager.reconcile();
	await vi.waitFor(() => expect(lifecycle.isIdle).toHaveBeenCalled());
	expect(calls).toEqual(["maintenance"]);
	expect(manager.status().transaction?.phase).toBe("draining");
	expect(manager.status().pending?.consentRevision).toBe(1);
	vi.mocked(lifecycle.isIdle).mockResolvedValue(true);
	await installing;
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"release",
	]);
});
it("downloads and stages automatic updates before closing admission", async () => {
	const { manager, source, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	let prepared!: () => void;
	const staging = new Promise<void>((resolve) => {
		prepared = resolve;
	});
	vi.mocked(source.stage).mockImplementation(async (value) => {
		await staging;
		return {
			candidate: value,
			executable: "/isolated/new",
			previousExecutable: "/isolated/old",
		};
	});
	const updating = manager.tick();
	await vi.waitFor(() => expect(source.stage).toHaveBeenCalled());
	expect(lifecycle.acquireMaintenance).not.toHaveBeenCalled();
	expect(manager.status().transaction).toBeUndefined();
	prepared();
	await updating;
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"release",
	]);
});
it.each([
	"policy",
	"pause",
	"shutdown",
])("releases a busy drain when %s cancels authorization", async (reason) => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	const abort = new AbortController();
	lifecycle.signal = abort.signal;
	vi.mocked(lifecycle.isIdle).mockResolvedValue(false);
	const installing = manager.reconcile();
	await vi.waitFor(() => expect(lifecycle.isIdle).toHaveBeenCalled());
	if (reason === "shutdown") abort.abort();
	else
		new UpdateManager(home).configure(
			reason === "pause" ? { paused: true } : { policy: "manual" },
			1,
		);
	await installing;
	expect(calls).toEqual(["maintenance", "release"]);
	expect(manager.status().transaction?.phase).toBe("cancelled");
	expect(manager.status().badCandidates).toEqual([]);
});
it("a second process policy save during prepare cancels queued automatic activation", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.prepare).mockImplementation(async () => {
		new UpdateManager(home).configure({ policy: "manual" }, 1);
		return {};
	});
	await manager.reconcile();
	expect(calls).toEqual([]);
	expect(manager.status().transaction?.phase).toBe("cancelled");
});
it("consent cannot survive pin/pause/policy/channel changes or a newly coalesced candidate", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await manager.check();
	manager.requestInstall(candidateKey(candidate), 1);
	manager.configure({ paused: true }, 1);
	expect(manager.status().pending?.consentRevision).toBeUndefined();
	manager.configure({ paused: false }, 2);
	manager.requestInstall(candidateKey(candidate), 3);
	vi.mocked(source.discover).mockResolvedValue({
		...candidate,
		version: "1.1.0-nightly.20261010.101",
		manifestSha256: "d".repeat(64),
	});
	await manager.check();
	expect(manager.status().pending?.consentRevision).toBeUndefined();
	expect(() => manager.requestInstall(candidateKey(candidate), 3)).toThrow(
		"changed",
	);
	manager.configure({ channel: "stable" }, 3);
	expect(manager.status().pending).toBeUndefined();
});
it("serializes concurrent activation and restores the previous worker after failed trial", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.mocked(lifecycle.isIdle).mockImplementation(async () => {
		await hold;
		return true;
	});
	const active = manager.reconcile();
	await vi.waitFor(() => expect(lifecycle.isIdle).toHaveBeenCalled());
	await expect(
		new UpdateManager(home, undefined, lifecycle).reconcile(),
	).rejects.toThrow("owns");
	release();
	vi.mocked(lifecycle.health).mockImplementation(async () => {
		calls.push("health");
		throw new Error("Wrong runtime identity");
	});
	await active;
	expect(calls).toEqual([
		"maintenance",
		"stop",
		"activate",
		"start",
		"health",
		"rollback",
		"release",
	]);
	expect(manager.status().installed).toEqual(installed);
	expect(manager.status().badCandidates).toContain(candidateKey(candidate));
	await manager.reconcile();
	expect(calls.filter((call) => call === "activate")).toHaveLength(1);
});
it("failed rollback retains maintenance and durable recovery rather than starting another worker", async () => {
	const { manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.health).mockRejectedValue(new Error("health"));
	vi.mocked(lifecycle.rollback).mockRejectedValue(
		new Error("descendants alive"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	expect(calls).not.toContain("release");
	await expect(manager.reconcile()).rejects.toThrow("recovery");
});
it("reboot recovery rolls back an interrupted switch and rejects a still-live owner", async () => {
	const { home, manager, lifecycle, calls } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "starting";
	state.transaction.switchStarted = true;
	state.installed = installed;
	writeFileSync(manager.file, JSON.stringify(state));
	writeFileSync(
		join(manager.directory, "operation.lock"),
		JSON.stringify({ pid: process.pid }),
	);
	await expect(manager.recover("operation owner stopped")).rejects.toThrow(
		"still running",
	);
	rmSync(join(manager.directory, "operation.lock"));
	const restarted = new UpdateManager(home, undefined, lifecycle);
	await restarted.recover("operation owner stopped");
	expect(restarted.status().transaction?.phase).toBe("rolled-back");
	expect(calls.at(-2)).toBe("rollback");
});
it("offline backoff preserves pending and rejects partial/wrong-target releases", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	vi.mocked(source.discover).mockRejectedValue(new Error("offline"));
	await manager.check();
	expect(manager.status().pending?.candidate).toEqual(candidate);
	expect(manager.status().failures).toBe(1);
	expect(manager.status().nextCheckAt).toBeGreaterThan(Date.now());
	vi.mocked(source.discover).mockResolvedValue({
		...candidate,
		target: "linux-x64",
	});
	await manager.check();
	expect(manager.status().error).toMatch("target");
	expect(manager.status().pending?.candidate).toEqual(candidate);
});

it("returning to older stable requires intentional Install even under saved automatic policy", async () => {
	const stable = { ...candidate, channel: "stable" as const, version: "1.0.0" };
	const { home, source, lifecycle, calls } = fixture(stable);
	const manager = new UpdateManager(home, source, lifecycle, {
		...installed,
		version: candidate.version,
		commit: candidate.commit,
	});
	manager.configure({ policy: "idle-auto" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([]);
	manager.requestInstall(candidateKey(stable), 1);
	await manager.reconcile();
	expect(calls).toContain("activate");
});
it("staging failures are persisted and automatic polling cannot endlessly reinstall a bad candidate", async () => {
	const { manager, source } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	vi.mocked(source.stage).mockRejectedValue(
		new Error("Invalid publisher checksum"),
	);
	await expect(manager.stage()).rejects.toThrow("checksum");
	expect(manager.status().error).toBe("Invalid publisher checksum");
	await manager.tick();
	expect(source.stage).toHaveBeenCalledTimes(1);
});
it("maintenance acquisition uncertainty and release failures remain recoverable", async () => {
	const { manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.acquireMaintenance).mockRejectedValueOnce(
		new Error("Lost acknowledgement"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	await manager.recover("operation owner stopped");
	expect(manager.status().transaction?.phase).toBe("cancelled");
	expect(lifecycle.stop).not.toHaveBeenCalled();
	vi.mocked(lifecycle.releaseMaintenance).mockRejectedValueOnce(
		new Error("Manager suppressed"),
	);
	await manager.reconcile();
	expect(manager.status().transaction?.phase).toBe("recovery-required");
	await manager.recover("operation owner stopped");
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});

it("retries failed exact release after recovery without repeating rollback or changing owner", async () => {
	const { manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.acquireMaintenance).mockRejectedValueOnce(
		new Error("Lost acknowledgement"),
	);
	await manager.reconcile();
	const id = manager.status().transaction!.id;
	vi.mocked(lifecycle.releaseMaintenance).mockRejectedValueOnce(
		new Error("release failed"),
	);
	await expect(manager.recover("operation owner stopped")).rejects.toThrow(
		"release failed",
	);
	expect(manager.status().transaction).toMatchObject({
		id,
		phase: "recovery-required",
		release: { transactionId: id, outcome: "cancelled", status: "pending" },
	});
	await expect(manager.reconcile()).rejects.toThrow("recovery");
	await manager.recover("operation owner stopped");
	expect(lifecycle.releaseMaintenance).toHaveBeenNthCalledWith(1, id);
	expect(lifecycle.releaseMaintenance).toHaveBeenNthCalledWith(2, id);
	expect(manager.status().transaction?.release?.status).toBe("acknowledged");
	expect(lifecycle.acquireMaintenance).toHaveBeenCalledTimes(2);
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});
it.each([
	"succeeded",
	"rolled-back",
	"cancelled",
])("recovers interrupted/legacy %s release and preserves completed outcome", async (phase) => {
	const { manager, home, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	const id = state.transaction.id;
	state.transaction.phase = phase;
	delete state.transaction.release; // pre-acknowledgement schema-1 migration
	writeFileSync(manager.file, JSON.stringify(state));
	vi.mocked(lifecycle.releaseMaintenance).mockClear();
	vi.mocked(lifecycle.acquireMaintenance).mockClear();
	const restarted = new UpdateManager(home, undefined, lifecycle);
	await expect(restarted.reconcile()).rejects.toThrow("recovery");
	await restarted.recover("operation owner stopped");
	await restarted.recover("operation owner stopped");
	expect(lifecycle.releaseMaintenance).toHaveBeenCalledExactlyOnceWith(id);
	expect(lifecycle.acquireMaintenance).not.toHaveBeenCalled();
	expect(lifecycle.rollback).not.toHaveBeenCalled();
	expect(restarted.status().transaction).toMatchObject({
		phase,
		release: { transactionId: id, outcome: phase, status: "acknowledged" },
	});
});
it("recovers a lost release response by retrying only the durable release intent", async () => {
	const { manager, home, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	vi.mocked(lifecycle.releaseMaintenance).mockImplementationOnce(async (id) => {
		const state = JSON.parse(readFileSync(manager.file, "utf8"));
		expect(state.transaction.release).toEqual({
			transactionId: id,
			outcome: "succeeded",
			status: "pending",
		});
		throw new Error("acknowledgement lost after external release");
	});
	await manager.reconcile();
	await new UpdateManager(home, undefined, lifecycle).recover(
		"operation owner stopped",
	);
	expect(manager.status().transaction?.phase).toBe("succeeded");
	expect(lifecycle.stop).toHaveBeenCalledTimes(1);
	expect(lifecycle.releaseMaintenance).toHaveBeenCalledTimes(2);
	expect(lifecycle.rollback).not.toHaveBeenCalled();
});
it.each([
	{ version: "1.0.0-beta", channel: "stable" as const },
	{ version: "1.0.0-nightly.20261010.100", channel: "nightly" as const },
])("requires exact consent for same-core prerelease downgrade to $version", async ({
	version,
	channel,
}) => {
	const value = { ...candidate, version, channel };
	const { manager, calls } = fixture(value);
	manager.configure({ channel, policy: "idle-auto" }, 0);
	await manager.check();
	await manager.stage();
	await manager.reconcile();
	expect(calls).toEqual([]);
	manager.requestInstall(candidateKey(value), 1);
	await manager.reconcile();
	expect(calls).toContain("activate");
});

async function startingFixture() {
	const fixtureValue = fixture();
	fixtureValue.manager.configure({ channel: "nightly" }, 0);
	await fixtureValue.manager.check();
	await fixtureValue.manager.stage();
	await fixtureValue.manager.reconcile();
	const state = JSON.parse(readFileSync(fixtureValue.manager.file, "utf8"));
	state.installed = installed;
	state.transaction.phase = "starting";
	delete state.transaction.release;
	writeFileSync(fixtureValue.manager.file, JSON.stringify(state));
	return fixtureValue;
}
it.each([
	"starting",
	"health",
	"rollback",
])("startup observation preserves %s transaction under a live writer lock", async (phase) => {
	const { manager } = await startingFixture();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = phase;
	writeFileSync(manager.file, JSON.stringify(state));
	const before = readFileSync(manager.file, "utf8");
	const lock = join(manager.directory, "state.lock");
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	await manager.observeInstalled(phase === "rollback" ? installed : candidate);
	expect(readFileSync(manager.file, "utf8")).toBe(before);
	expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
});
it("retries transient observation contention without changing settings CAS behavior", async () => {
	const { manager } = fixture();
	manager.configure({ paused: true }, 0);
	const lock = join(manager.directory, "state.lock");
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	expect(() => manager.configure({ paused: false }, 1)).toThrow(
		"Inspect a retained state.lock",
	);
	const observation = manager.observeInstalled(candidate);
	setTimeout(() => rmSync(lock), 50);
	await observation;
	expect(manager.status().installed).toEqual({
		version: candidate.version,
		commit: candidate.commit,
		target: candidate.target,
	});
	expect(manager.status().settings.paused).toBe(true);
	expect(manager.status().revision).toBe(1);
});
it("rechecks transaction identity after contention without clobbering the supervisor", async () => {
	const { manager } = await startingFixture();
	const transactionState = readFileSync(manager.file, "utf8");
	const state = JSON.parse(transactionState);
	delete state.transaction;
	writeFileSync(manager.file, JSON.stringify(state));
	const lock = join(manager.directory, "state.lock");
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	const observation = manager.observeInstalled(candidate);
	setTimeout(() => {
		writeFileSync(manager.file, transactionState);
		rmSync(lock);
	}, 50);
	await observation;
	expect(readFileSync(manager.file, "utf8")).toBe(transactionState);
});
it("bounds retained observation contention and leaves owner inspection intact", async () => {
	const { manager } = fixture();
	manager.configure({}, 0);
	const before = readFileSync(manager.file, "utf8");
	const lock = join(manager.directory, "state.lock");
	// A live holder is never stolen from, whatever format its lock is in.
	writeFileSync(lock, String(process.pid), { flag: "wx" });
	const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		await manager.observeInstalled(candidate);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining("Inspect a retained state.lock"),
		);
		expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
		expect(readFileSync(manager.file, "utf8")).toBe(before);
	} finally {
		warning.mockRestore();
	}
});
it("rejects wrong phase identity, malformed identity and malformed state even under contention", async () => {
	const { manager } = await startingFixture();
	writeFileSync(join(manager.directory, "state.lock"), String(process.pid), {
		flag: "wx",
	});
	await expect(manager.observeInstalled(installed)).rejects.toThrow(
		"phase starting",
	);
	await expect(
		manager.observeInstalled({ ...candidate, commit: "invalid" }),
	).rejects.toThrow();
	writeFileSync(manager.file, "{}");
	await expect(manager.observeInstalled(candidate)).rejects.toThrow();
});

const previousIdentity: InstalledUpdate = installed;
const candidateIdentity: InstalledUpdate = {
	version: candidate.version,
	commit: candidate.commit,
	target: candidate.target,
};
const identityOutcomes = ["succeeded", "rolled-back", "cancelled"] as const;
const identityPhases = [
	"activating",
	"starting",
	"health",
	"rollback",
	"recovery-required",
	"succeeded",
	"rolled-back",
	"cancelled",
] as const;

it.each(
	identityPhases.flatMap((phase) =>
		identityOutcomes.map((outcome) => ({ phase, outcome })),
	),
)("uses completed $outcome receipt over transaction phase $phase", async ({
	phase,
	outcome,
}) => {
	const { manager } = await startingFixture();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = phase;
	state.transaction.release = {
		transactionId: state.transaction.id,
		outcome,
		status: "pending",
	};
	writeFileSync(manager.file, JSON.stringify(state));
	const expected =
		outcome === "succeeded" ? candidateIdentity : previousIdentity;
	const incorrect =
		outcome === "succeeded" ? previousIdentity : candidateIdentity;
	const before = readFileSync(manager.file, "utf8");

	await manager.observeInstalled(expected);
	await expect(manager.observeInstalled(incorrect)).rejects.toThrow(
		`outcome ${outcome}`,
	);
	expect(readFileSync(manager.file, "utf8")).toBe(before);
});

it.each(
	identityOutcomes,
)("retained $0 release result after failed acknowledgment resolves only its completed runtime", async (outcome) => {
	const { manager, lifecycle } = fixture();
	manager.configure({ channel: "nightly" }, 0);
	await manager.check();
	await manager.stage();
	if (outcome === "rolled-back")
		vi.mocked(lifecycle.health).mockRejectedValueOnce(
			new Error("candidate health failed"),
		);
	if (outcome === "cancelled")
		vi.mocked(lifecycle.isIdle).mockImplementationOnce(async () => {
			manager.configure({ paused: true }, 1);
			return false;
		});
	vi.mocked(lifecycle.releaseMaintenance).mockRejectedValueOnce(
		new Error("release acknowledgment lost"),
	);
	await manager.reconcile();

	const state = manager.status();
	expect(state.transaction?.phase).toBe("recovery-required");
	expect(state.transaction?.release).toMatchObject({
		outcome,
		status: "pending",
	});
	const expected =
		outcome === "succeeded" ? candidateIdentity : previousIdentity;
	const incorrect =
		outcome === "succeeded" ? previousIdentity : candidateIdentity;
	const before = readFileSync(manager.file, "utf8");

	await manager.observeInstalled(expected);
	await expect(manager.observeInstalled(incorrect)).rejects.toThrow(
		`outcome ${outcome}`,
	);
	expect(readFileSync(manager.file, "utf8")).toBe(before);
});

it("keeps phase allowances for unresolved recovery with no completed release outcome", async () => {
	const { manager } = await startingFixture();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "recovery-required";
	delete state.transaction.release;
	writeFileSync(manager.file, JSON.stringify(state));

	await expect(
		manager.observeInstalled(candidateIdentity),
	).resolves.toBeUndefined();
	await expect(
		manager.observeInstalled(previousIdentity),
	).resolves.toBeUndefined();
});

it("rejects a retained staged identity that differs from the transaction candidate", async () => {
	const { manager } = await startingFixture();
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.staged.candidate.commit = "d".repeat(40);
	writeFileSync(manager.file, JSON.stringify(state));

	await expect(manager.observeInstalled(candidateIdentity)).rejects.toThrow(
		"inconsistent staged identity",
	);
});
