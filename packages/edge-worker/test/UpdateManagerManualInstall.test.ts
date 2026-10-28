import {
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
	type InstalledUpdate,
	type UpdateCandidate,
	type UpdateLifecycle,
	UpdateManager,
	type UpdateSource,
} from "../src/updates/UpdateManager.js";
import { FrozenV2StateSchema } from "./fixtures/v2-supervisor/UpdateStateSchema.v2.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
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
const candidateIdentity: InstalledUpdate = {
	version: candidate.version,
	commit: candidate.commit,
	target: candidate.target,
};
// Installed by hand: newer than the candidate the history expects.
const manual: InstalledUpdate = {
	version: "1.2.0-nightly.20261020.200",
	commit: "d".repeat(40),
	target: "darwin-arm64",
};
const newer: UpdateCandidate = {
	...candidate,
	version: "1.3.0-nightly.20261025.300",
	commit: "e".repeat(40),
	manifestSha256: "f".repeat(64),
};

/** `subdirectory` "desktop" reproduces the shell updater's state home. */
function fixture(subdirectory = "") {
	const root = mkdtempSync(join(tmpdir(), "factory-manual-install-"));
	roots.push(root);
	const home = join(root, subdirectory);
	const source: UpdateSource = {
		discover: vi.fn(async () => candidate),
		stage: vi.fn(async (current) => ({
			candidate: current,
			executable: "/isolated/new",
			previousExecutable: "/isolated/old",
		})),
	};
	const lifecycle: UpdateLifecycle = {
		acquireMaintenance: vi.fn(async () => {}),
		isIdle: vi.fn(async () => true),
		preflight: vi.fn(async () => ({ stateCompatible: true })),
		snapshot: vi.fn(async () => "/isolated/snapshot"),
		stop: vi.fn(async () => {}),
		activate: vi.fn(async () => {}),
		start: vi.fn(async () => {}),
		health: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
		releaseMaintenance: vi.fn(async () => {}),
	};
	const manager = new UpdateManager(home, source, lifecycle, installed);
	return { home, manager, source, lifecycle };
}
/** A completed, acknowledged update to `candidate` with operator preferences set. */
async function completedUpdate(subdirectory = "") {
	const value = fixture(subdirectory);
	value.manager.configure({ channel: "nightly", policy: "manual" }, 0);
	await value.manager.check();
	value.manager.requestInstall(
		`nightly:${candidate.version}:${candidate.commit}:${candidate.target}:${candidate.manifestSha256}`,
		1,
	);
	await value.manager.stage();
	await value.manager.reconcile();
	const state = JSON.parse(readFileSync(value.manager.file, "utf8"));
	state.badCandidates = ["nightly:1.0.1:keep-me"];
	state.settings.paused = true;
	writeFileSync(value.manager.file, JSON.stringify(state));
	expect(value.manager.status()).toMatchObject({
		installed: candidateIdentity,
		transaction: { phase: "succeeded", release: { status: "acknowledged" } },
	});
	return value;
}
/** The state a v2 supervisor leaves mid-update: candidate expected at `phase`. */
async function inProgress(phase: "health" | "stopping") {
	const value = fixture();
	value.manager.configure({ channel: "nightly" }, 0);
	await value.manager.check();
	await value.manager.stage();
	await value.manager.reconcile();
	const state = JSON.parse(readFileSync(value.manager.file, "utf8"));
	state.installed = installed;
	state.transaction.phase = phase;
	delete state.transaction.release;
	writeFileSync(value.manager.file, JSON.stringify(state));
	return value;
}
const historyRecords = (manager: UpdateManager, prefix: string) => {
	try {
		return readdirSync(join(manager.directory, "history")).filter((name) =>
			name.startsWith(prefix),
		);
	} catch {
		return [];
	}
};
const observedRecords = (manager: UpdateManager) =>
	historyRecords(manager, "observed-");

it.each([
	["runtime", ""],
	["desktop shell", "desktop"],
])("#133: a verified newer manual install over a completed acknowledged %s update starts, records the audit and keeps preferences", async (_name, subdirectory) => {
	const { manager } = await completedUpdate(subdirectory);
	const before = manager.status();

	await expect(manager.observeInstalled(manual)).resolves.toBeUndefined();

	const after = manager.status();
	expect(after.installed).toEqual(manual);
	expect(after.settings).toEqual(before.settings);
	expect(after.settings).toMatchObject({
		channel: "nightly",
		overrides: { nightly: "manual" },
		paused: true,
	});
	expect(after.badCandidates).toEqual(before.badCandidates);
	expect(after.revision).toBe(before.revision);
	expect(after.transaction).toEqual(before.transaction);
	expect(after.recovery).toBeUndefined();
	const [record] = observedRecords(manager);
	expect(observedRecords(manager)).toHaveLength(1);
	expect(
		JSON.parse(
			readFileSync(join(manager.directory, "history", record), "utf8"),
		),
	).toMatchObject({
		kind: "observed-install",
		from: candidateIdentity,
		to: manual,
		reason: "manual-or-external",
	});
	// Observing the same build again changes nothing.
	await manager.observeInstalled(manual);
	expect(observedRecords(manager)).toHaveLength(1);
});

it("a manual install keeps a still-newer pending candidate but drops its stale staging", async () => {
	const { manager, source } = await completedUpdate();
	vi.mocked(source.discover).mockResolvedValueOnce(newer);
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.nextCheckAt = 0;
	writeFileSync(manager.file, JSON.stringify(state));
	await manager.check();
	await manager.stage();
	expect(manager.status().pending?.staged).toBeDefined();

	await manager.observeInstalled(manual);

	expect(manager.status().pending?.candidate.version).toBe(newer.version);
	expect(manager.status().pending?.staged).toBeUndefined();
});

it("a manual install that reaches the pending candidate's version settles it", async () => {
	const { manager, source } = await completedUpdate();
	vi.mocked(source.discover).mockResolvedValueOnce(newer);
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.nextCheckAt = 0;
	writeFileSync(manager.file, JSON.stringify(state));
	await manager.check();

	await manager.observeInstalled({
		version: newer.version,
		commit: newer.commit,
		target: newer.target,
	});

	expect(manager.status().pending).toBeUndefined();
});

it("an in-progress transaction with a foreign identity records recovery with steps, keeps state.json, refuses activation, and does not block startup", async () => {
	const { manager, source, lifecycle } = await inProgress("health");
	const before = readFileSync(manager.file, "utf8");

	await expect(manager.observeInstalled(manual)).resolves.toBeUndefined();

	expect(readFileSync(manager.file, "utf8")).toBe(before);
	const { recovery } = manager.status();
	expect(recovery).toMatchObject({
		code: "unexpected-runtime",
		phase: "health",
		observed: manual,
		expected: [candidateIdentity],
	});
	expect(recovery?.steps.join("\n")).toContain(
		"bobs-factory update recover --adopt-installed --yes",
	);
	// Installed state was not touched and nothing was audited as a clean adoption.
	expect(observedRecords(manager)).toEqual([]);
	// Activation and automatic recovery stay off.
	const checks = vi.mocked(source.discover).mock.calls.length;
	await manager.tick();
	expect(vi.mocked(source.discover).mock.calls.length).toBe(checks);
	expect(lifecycle.acquireMaintenance).toHaveBeenCalledTimes(1);
	expect(manager.activationEligible()).toBe(false);
	expect(() =>
		manager.requestInstall(
			`nightly:${candidate.version}:${candidate.commit}:${candidate.target}:${candidate.manifestSha256}`,
			manager.status().revision,
		),
	).toThrow("unexpected runtime");
	// Observing the same foreign identity again is idempotent.
	const detectedAt = manager.status().recovery?.detectedAt;
	await manager.observeInstalled(manual);
	expect(manager.status().recovery?.detectedAt).toBe(detectedAt);
});

it("recovery clears itself when the expected build runs again", async () => {
	const { manager } = await inProgress("health");
	await manager.observeInstalled(manual);
	expect(manager.status().recovery).toBeDefined();

	await manager.observeInstalled(candidateIdentity);

	expect(manager.status().recovery).toBeUndefined();
});

it("recovery of a resolved transaction is ignored", async () => {
	const { manager } = await inProgress("health");
	await manager.observeInstalled(manual);
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "succeeded";
	state.transaction.release = {
		transactionId: state.transaction.id,
		outcome: "succeeded",
		status: "acknowledged",
	};
	writeFileSync(manager.file, JSON.stringify(state));

	expect(manager.status().recovery).toBeUndefined();
	expect(manager.activationEligible()).toBe(false);
});

it("adopt: an installed build that is not the candidate closes the update as superseded and releases maintenance", async () => {
	const { manager, lifecycle } = await inProgress("health");
	await manager.observeInstalled(manual);

	await expect(manager.adoptInstalled(candidateIdentity)).rejects.toThrow(
		"Recovery was recorded for build",
	);
	const status = await manager.adoptInstalled(manual);

	expect(status.recovery).toBeUndefined();
	expect(status.installed).toEqual(manual);
	expect(status.transaction).toMatchObject({
		phase: "cancelled",
		error: "superseded-by-manual-install",
		release: { outcome: "cancelled", status: "acknowledged" },
	});
	expect(lifecycle.releaseMaintenance).toHaveBeenCalledWith(
		status.transaction?.id,
	);
	expect(lifecycle.rollback).not.toHaveBeenCalled();
	expect(historyRecords(manager, "adopted-")).toHaveLength(1);
	expect(status.pending).toBeUndefined();
	await expect(manager.adoptInstalled(manual)).rejects.toThrow(
		"no unexpected runtime",
	);
});

it("adopt: an installed build that equals the candidate completes the update", async () => {
	const { manager } = await inProgress("stopping");
	await manager.observeInstalled(candidateIdentity);
	expect(manager.status().recovery).toBeDefined();

	const status = await manager.adoptInstalled(candidateIdentity);

	expect(status.installed).toEqual(candidateIdentity);
	expect(status.transaction).toMatchObject({
		phase: "succeeded",
		release: { outcome: "succeeded", status: "acknowledged" },
	});
	expect(status.recovery).toBeUndefined();
});

it("adopt without a lifecycle (shell updater) releases through the supplied callback", async () => {
	const { home, manager } = await inProgress("health");
	await manager.observeInstalled(manual);
	const shell = new UpdateManager(home);
	const release = vi.fn(async () => {});

	const status = await shell.adoptInstalled(manual, { release });

	expect(release).toHaveBeenCalledWith(status.transaction?.id);
	expect(status.transaction?.release?.status).toBe("acknowledged");
});

it("the frozen v2 supervisor schema round-trips every state this build writes without key loss", async () => {
	const { manager } = await completedUpdate();
	const roundTrips = () => {
		const written = JSON.parse(readFileSync(manager.file, "utf8"));
		expect(FrozenV2StateSchema.parse(written)).toEqual(written);
	};
	roundTrips();
	await manager.observeInstalled(manual);
	roundTrips();
	const active = await inProgress("health");
	await active.manager.observeInstalled(manual);
	const written = JSON.parse(readFileSync(active.manager.file, "utf8"));
	expect(FrozenV2StateSchema.parse(written)).toEqual(written);
	expect(active.manager.status().recovery).toBeDefined();

	// The old supervisor rewrites state.json with its own schema; the recovery
	// notice lives beside it and survives, and the new reader still accepts it.
	writeFileSync(
		active.manager.file,
		JSON.stringify(FrozenV2StateSchema.parse(written)),
	);
	expect(active.manager.status().recovery).toMatchObject({
		code: "unexpected-runtime",
		observed: manual,
	});
	const status = await active.manager.adoptInstalled(manual);
	expect(status.recovery).toBeUndefined();
	const resolved = JSON.parse(readFileSync(active.manager.file, "utf8"));
	expect(FrozenV2StateSchema.parse(resolved)).toEqual(resolved);
});
