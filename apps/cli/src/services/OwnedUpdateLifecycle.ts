import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	publishStorageJson,
	readStorageJson,
	reconcileStorageCopy,
	StorageRetentionStore,
	storageDigest,
	writeStorageIntegrity,
	writeStorageRollbackProof,
} from "bobs-factory-core";
import { requestFactoryTerminalSession } from "bobs-factory-edge-worker";
import { FactoryClient } from "../tui/client.js";
import { desktopStopped, lifecycleGuard } from "./DesktopLifecycle.js";
import {
	assertInstallationProof,
	type InstallationProof,
	installationProof,
} from "./InstallationOwnership.js";
import {
	acquireInstanceLock,
	ownerAlive,
	workerOwner,
} from "./InstanceLock.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";
import { copyUpdateStateForRetention as copyUpdateState } from "./UpdateStateSnapshot.js";

const runFile = promisify(execFile);
export interface LifecycleCandidate {
	version: string;
	commit: string;
	target: string;
}
export interface LifecycleStaged {
	candidate: LifecycleCandidate;
	executable: string;
	previousExecutable: string;
}
export interface LifecycleTransaction {
	id: string;
	staged: LifecycleStaged;
	snapshot?: string;
}
interface Drain {
	idle: boolean;
	preservationContract?: string;
	preservedStateSha256: string;
	runIds: string[];
}
interface Owner {
	kind: "service" | "desktop";
	executable: string;
}
/** External owner adapter. Never replace a running worker from its own process. */
export class OwnedUpdateLifecycle {
	private transactionId?: string;
	private preservation?: Drain;
	private staged?: LifecycleStaged;
	private readonly manager: ServiceLifecycle;
	private readonly client: FactoryClient;
	private readonly owner: Owner;
	private readonly installationOwner: InstallationProof | undefined;
	constructor(
		readonly home: string,
		port: number,
		readonly signal?: AbortSignal,
	) {
		this.manager = new ServiceLifecycle(home);
		this.home = this.manager.home;
		home = this.home;
		this.client = new FactoryClient({
			home,
			port,
			requestSession: requestFactoryTerminalSession,
		});
		const service = this.manager.record();
		const desktop = join(home, "runtime", "desktop-runtime.json");
		if (service)
			this.owner = { kind: "service", executable: service.executable };
		else if (existsSync(desktop)) {
			const record = JSON.parse(readFileSync(desktop, "utf8"));
			const link = join(
				home,
				"runtime",
				"desktop-installed",
				"bin",
				"bobs-factory",
			);
			if (
				record.schema !== 1 ||
				record.home !== realpathSync(home) ||
				record.executable !== link
			)
				throw new Error("Desktop installation ownership mismatch");
			this.owner = { kind: "desktop", executable: link };
		} else
			throw new Error(
				"Foreground/checkout/Nix/external owner: use its supported update handoff, not an owned replacement",
			);
		if (!lstatSync(this.owner.executable).isSymbolicLink())
			throw new Error(
				"Updates require the explicit owned executable link, never an app bundle/system executable",
			);
		this.installationOwner =
			service?.updateOwner ??
			(!service ? installationProof(home, this.owner.executable) : undefined);
		assertInstallationProof(
			home,
			this.owner.executable,
			this.installationOwner,
		);
		const current = workerOwner(home);
		if (current?.pid === process.pid)
			throw new Error(
				"Update supervisor must be outside the worker being replaced",
			);
	}
	get runtimeLink() {
		return this.owner.executable;
	}
	private fence() {
		return join(this.home, "runtime", "update-owner.json");
	}
	private save(value: unknown) {
		mkdirSync(dirname(this.fence()), { recursive: true, mode: 0o700 });
		writeFileSync(`${this.fence()}.tmp`, JSON.stringify(value), {
			mode: 0o600,
			flush: true,
		});
		renameSync(`${this.fence()}.tmp`, this.fence());
	}
	async acquireMaintenance(transactionId: string) {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			this.admitMaintenance(transactionId);
		} finally {
			release();
		}
		await this.beginMaintenance(transactionId);
	}
	private admitMaintenance(transactionId: string) {
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another update owns lifecycle suppression");
			this.preservation = saved.preservation;
		}
		this.transactionId = transactionId;
		this.save({ transactionId, preservation: this.preservation });
	}
	private async beginMaintenance(transactionId: string) {
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			if (!this.preservation) {
				const transaction = JSON.parse(
					readFileSync(join(this.home, "updates", "state.json"), "utf8"),
				).transaction;
				if (
					transaction?.id !== transactionId ||
					transaction.switchStarted ||
					realpathSync(this.owner.executable) !==
						realpathSync(transaction.staged.previousExecutable)
				)
					throw new Error(
						"Interrupted switch lacks a durable preservation receipt",
					);
			}
			const marker = process.env.BOBS_FACTORY_WORKER_ID;
			try {
				const release = await acquireInstanceLock(this.home);
				release();
			} finally {
				if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
				else process.env.BOBS_FACTORY_WORKER_ID = marker;
			}
			if (this.preservation) return;
			if (this.owner.kind === "desktop") await this.start();
			else {
				for (let attempt = 0; attempt < 150; attempt++) {
					const live = workerOwner(this.home);
					if (live && ownerAlive(live)) break;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "begin",
		});
	}
	async isIdle() {
		const receipt = await this.client.get<Drain>("/api/updates/drain");
		if (receipt.idle) {
			this.preservation = receipt;
			this.save({ transactionId: this.transactionId, preservation: receipt });
		}
		return receipt.idle;
	}
	private copyOwned(destination: string, purpose: "preflight" | "snapshot") {
		return copyUpdateState(this.home, destination, purpose, this.signal);
	}
	async preflight(staged: LifecycleStaged, installed: { version: string }) {
		if (
			staged.candidate.version.split(".")[0] !== installed.version.split(".")[0]
		)
			throw new Error(
				"Cross-major state migration requires an explicit reviewed adapter",
			);
		const executable = realpathSync(staged.executable),
			previous = realpathSync(staged.previousExecutable);
		if (previous !== realpathSync(this.owner.executable))
			throw new Error("Staged previous runtime does not match selected owner");
		const metadata = JSON.parse(
			readFileSync(join(dirname(executable), "build.json"), "utf8"),
		);
		const bytes = readFileSync(executable);
		if (
			metadata.product !== "bobs-factory" ||
			metadata.dirty ||
			metadata.version !== staged.candidate.version ||
			metadata.commit !== staged.candidate.commit ||
			metadata.target !== staged.candidate.target ||
			metadata.executable?.sha256 !==
				createHash("sha256").update(bytes).digest("hex") ||
			metadata.executable.size !== bytes.length
		)
			throw new Error("Staged runtime identity/integrity mismatch");
		const preparationRoot = join(this.home, "updates", "preparation");
		mkdirSync(preparationRoot, { recursive: true, mode: 0o700 });
		const isolated = mkdtempSync(join(preparationRoot, "preflight-"));
		const retention = new StorageRetentionStore(this.home);
		const preparation = await retention.register({
			category: "preparation",
			path: isolated,
			root: preparationRoot,
			producer: "OwnedUpdateLifecycle",
			operation: this.transactionId ?? staged.candidate.commit,
			dependencies: [],
			evidence: [],
		});
		// Failed or interrupted preparation remains unverified and retained.
		await this.copyOwned(isolated, "preflight");
		const { stdout } = await runFile(
			executable,
			["--home", isolated, "--no-open", "service", "validate-state"],
			{ timeout: 30000, env: { PATH: process.env.PATH, HOME: isolated } },
		);
		const result = JSON.parse(stdout);
		if (result.stateCompatible !== true)
			throw new Error("Candidate state preflight failed");
		if (result.preservationContract !== this.preservation?.preservationContract)
			throw new Error(
				"Update preservation contract changed; use an owner-managed stopped-worker upgrade for this boundary. The running worker has not been replaced.",
			);
		if (
			JSON.stringify(result.runIds) !==
			JSON.stringify(this.preservation?.runIds)
		)
			throw new Error("Preflight lost preserved workflow identities");
		const integrity = await writeStorageIntegrity(
			isolated,
			join(retention.directory, "proofs", `${preparation.id}.ndjson`),
		);
		await retention.revise(preparation.id, (record) => {
			record.evidence = [`integrity:${integrity}`];
			record.completedAt =
				record.verifiedAt =
				record.reconciledAt =
					new Date().toISOString();
		});
		// Preflight may rewrite state. Only byte-proven copies acquire an
		// authoritative replacement; changed preparation remains independently held.
		try {
			await reconcileStorageCopy(retention, preparation.id);
		} catch {
			/* Keep its original retention proof. */
		}
		this.staged = { ...staged, executable, previousExecutable: previous };
		return { stateCompatible: true as const };
	}
	async snapshot(transactionId: string) {
		if (transactionId !== this.transactionId || !this.preservation)
			throw new Error("Verified idle receipt required before snapshot");
		const path = join(this.home, "updates", "snapshots", transactionId);
		if (existsSync(path))
			throw new Error(
				"Snapshot already exists: recover the persisted transaction",
			);
		mkdirSync(path, { recursive: true, mode: 0o700 });
		const retention = new StorageRetentionStore(this.home);
		const artifact = await retention.register({
			category: "snapshot",
			rollback: "usable",
			path,
			root: join(this.home, "updates", "snapshots"),
			producer: "OwnedUpdateLifecycle",
			operation: transactionId,
			dependencies: [],
			evidence: [],
		});
		// A retained snapshot also retains the runtime it can roll back to.
		let target = dirname(
			this.staged?.previousExecutable ?? this.owner.executable,
		);
		while (target !== dirname(target)) {
			const indexed = (await readStorageJson(
				join(
					retention.directory,
					"path-records",
					`${storageDigest(target)}.json`,
				),
			)) as { id: string } | undefined;
			if (indexed) {
				await publishStorageJson(
					join(
						retention.directory,
						"dependencies",
						indexed.id,
						`${artifact.id}.json`,
					),
					{ ownerId: artifact.id },
				);
				break;
			}
			target = dirname(target);
		}
		await this.copyOwned(path, "snapshot");
		writeFileSync(
			join(path, "lifecycle-receipt.json"),
			JSON.stringify(this.preservation),
			{ mode: 0o600 },
		);
		const integrity = await writeStorageIntegrity(
			path,
			join(retention.directory, "proofs", `${artifact.id}.ndjson`),
		);
		const runtimeProof = await writeStorageRollbackProof(
			this.home,
			artifact.id,
			this.staged?.previousExecutable ?? this.owner.executable,
		);
		await retention.revise(artifact.id, (record) => {
			record.completedAt = record.verifiedAt = new Date().toISOString();
			record.evidence = [
				runtimeProof,
				`integrity:${integrity}`,
				this.staged?.previousExecutable ?? this.owner.executable,
			];
		});
		return path;
	}
	private async stopDesktopOwner() {
		const expected = workerOwner(this.home);
		if (
			!expected ||
			expected.owner !== "desktop" ||
			expected.executable !== realpathSync(this.owner.executable)
		)
			throw new Error("Desktop worker ownership mismatch");
		if (ownerAlive(expected)) {
			try {
				process.kill(expected.pid, "SIGTERM");
			} catch (error) {
				if (ownerAlive(expected)) throw error;
			}
		}
		for (let attempt = 0; attempt < 300; attempt++) {
			const current = workerOwner(this.home);
			if (!current) return;
			if (current.nonce !== expected.nonce)
				throw new Error(
					"Worker owner changed during shutdown; replacement forbidden",
				);
			if (!ownerAlive(current)) {
				const release = await acquireInstanceLock(this.home, {
					markWorker: false,
				});
				release();
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("Desktop worker still owns home; replacement forbidden");
	}
	async stop() {
		if (!this.transactionId) throw new Error("Maintenance required");
		const fresh = await this.client.get<Drain>("/api/updates/drain");
		if (
			!fresh.idle ||
			fresh.preservationContract !== this.preservation?.preservationContract ||
			fresh.preservedStateSha256 !== this.preservation?.preservedStateSha256
		)
			throw new Error("Idle/preserved state changed before stop");
		if (this.owner.kind === "service") await this.manager.action("maintenance");
		else await this.stopDesktopOwner();
	}
	private switchLink(executable: string) {
		assertInstallationProof(
			this.home,
			this.owner.executable,
			this.installationOwner,
		);
		if (workerOwner(this.home))
			throw new Error("Existing worker ownership blocks runtime activation");
		const next = `${this.owner.executable}.next-${this.transactionId}`;
		try {
			symlinkSync(executable, next);
			renameSync(next, this.owner.executable);
		} catch (error) {
			try {
				rmSync(next);
			} catch {}
			throw error;
		}
	}
	async activate(staged: LifecycleStaged) {
		if (
			!this.staged ||
			this.staged.executable !== realpathSync(staged.executable)
		)
			throw new Error("Candidate not preflighted");
		this.switchLink(this.staged.executable);
	}
	private async readyRuntime() {
		const expected = JSON.parse(
			readFileSync(
				join(dirname(realpathSync(this.owner.executable)), "build.json"),
				"utf8",
			),
		);
		const readiness = new FactoryClient({
			home: this.home,
			port: Number(new URL(this.client.origin).port),
			requestSession: requestFactoryTerminalSession,
			requestTimeoutMs: 1000,
		});
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline) {
			try {
				const { runtime } = await readiness.get<{
					runtime: LifecycleCandidate;
				}>("/api/version");
				const owner = workerOwner(this.home);
				if (
					owner &&
					ownerAlive(owner) &&
					owner.executable === realpathSync(this.owner.executable) &&
					runtime.version === expected.version &&
					runtime.commit === expected.commit &&
					runtime.target === expected.target
				)
					return;
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			"Owned worker did not become ready with the exact runtime identity",
		);
	}
	private assertMayStart() {
		if (
			desktopStopped(this.home) ||
			["stopped"].includes(this.manager.record()?.desired ?? "")
		)
			throw new Error(
				"Deliberate Stop intent blocks automatic startup/recovery",
			);
	}
	async start() {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			await this.startOwned();
		} finally {
			release();
		}
	}
	private async startOwned() {
		if (this.owner.kind === "service") {
			await this.manager.resume();
			for (let attempt = 0; attempt < 300; attempt++) {
				const current = workerOwner(this.home);
				if (
					current &&
					current.owner === "service" &&
					current.executable === realpathSync(this.owner.executable) &&
					ownerAlive(current)
				) {
					await this.readyRuntime();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Managed replacement did not acquire its worker startup fence",
			);
		} else {
			const { spawn } = await import("node:child_process");
			const log = (await import("node:fs")).openSync(
				join(this.home, "runtime", "desktop-worker.log"),
				"a",
				0o600,
			);
			const child = spawn(
				this.owner.executable,
				[
					"--home",
					this.home,
					"--port",
					String(new URL(this.client.origin).port),
					"--no-open",
					"local",
				],
				{
					detached: true,
					cwd: this.home,
					stdio: ["ignore", log, log],
					env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
				},
			);
			(await import("node:fs")).closeSync(log);
			let launchError: Error | undefined;
			child.on("error", (error) => {
				launchError = error;
			});
			child.unref();
			// A spawned process has not necessarily claimed its durable worker
			// fence yet. Never let immediate failure/rollback race that startup.
			for (let attempt = 0; attempt < 300; attempt++) {
				if (launchError) throw launchError;
				if (child.exitCode !== null || child.signalCode !== null)
					throw new Error("Owned worker exited before acquiring ownership");
				const current = workerOwner(this.home);
				if (current) {
					if (current.pid !== child.pid)
						throw new Error("Another worker acquired ownership during launch");
					if (ownerAlive(current)) {
						await this.readyRuntime();
						return;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Owned worker did not acquire its startup fence; recovery must confirm its exit",
			);
		}
	}
	async restartCrashedDesktop() {
		if (
			this.owner.kind !== "desktop" ||
			existsSync(this.fence()) ||
			existsSync(join(this.home, "runtime", "desktop-stopped.json"))
		)
			return;
		const current = workerOwner(this.home);
		if (current && ownerAlive(current)) return;
		const marker = process.env.BOBS_FACTORY_WORKER_ID;
		try {
			const release = await acquireInstanceLock(this.home);
			release();
		} finally {
			if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
			else process.env.BOBS_FACTORY_WORKER_ID = marker;
		}
		await this.start();
	}

	async health(candidate: LifecycleCandidate) {
		let failure = "Runtime did not respond";
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				const identity = await this.client.get<{ runtime: LifecycleCandidate }>(
					"/api/version",
				);
				const receipt = await this.client.get<Drain>("/api/updates/drain");
				const owner = workerOwner(this.home);
				const preservedState =
					receipt.preservationContract ===
						this.preservation?.preservationContract &&
					receipt.preservedStateSha256 ===
						this.preservation?.preservedStateSha256;
				if (
					identity.runtime.version === candidate.version &&
					identity.runtime.commit === candidate.commit &&
					identity.runtime.target === candidate.target &&
					owner &&
					ownerAlive(owner) &&
					preservedState
				)
					return;
				failure = `Observed ${identity.runtime.version}/${identity.runtime.commit}/${identity.runtime.target}; liveOwner=${Boolean(owner && ownerAlive(owner))}; preservedState=${preservedState}; preservationContract=${receipt.preservationContract ?? "legacy"}/${this.preservation?.preservationContract ?? "legacy"}`;
			} catch (error) {
				failure = (error as Error).message;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			`Replacement failed exact runtime/preserved-state health check: ${failure}`,
		);
	}
	async rollback(transaction: LifecycleTransaction) {
		if (
			!transaction.snapshot ||
			resolve(transaction.snapshot) !==
				join(resolve(this.home), "updates", "snapshots", transaction.id)
		)
			throw new Error("Rollback snapshot ownership mismatch");
		// Suppression stays active. Stop only the failed replacement, never a new external owner.
		if (workerOwner(this.home)) {
			if (this.owner.kind === "service")
				await this.manager.action("maintenance");
			else await this.stopDesktopOwner();
		}
		if (workerOwner(this.home))
			throw new Error("Replacement exit not confirmed");
		// Restore only bounded Factory-owned state after replacement exit. Keep
		// actual native stores outside this home, current auth, updates and runtime.
		const retained = join(
			this.home,
			"updates",
			"recovery-retained",
			transaction.id,
		);
		mkdirSync(retained, { recursive: true, mode: 0o700 });
		const retention = new StorageRetentionStore(this.home);
		// A retried rollback resumes its own recovery record and progress journal.
		// The journal is durable before any state moves, so a missing journal next
		// to retained state means a pre-journal rollback that needs manual review.
		const indexed = (await readStorageJson(
			join(
				retention.directory,
				"path-records",
				`${storageDigest(realpathSync(retained))}.json`,
			),
		)) as { id: string } | undefined;
		const recovery = indexed
			? await retention.record(indexed.id)
			: await retention.register({
					category: "recovery",
					path: retained,
					root: join(this.home, "updates", "recovery-retained"),
					producer: "OwnedUpdateLifecycle",
					operation: transaction.id,
					dependencies: [
						"Failure-era state needs explicit reconciliation with current authoritative state",
					],
					evidence: [],
				});
		if (
			recovery.category !== "recovery" ||
			recovery.operation !== transaction.id
		)
			throw new Error("Retained rollback state belongs to another operation");
		const journal = join(retained, "rollback-progress.json");
		const progress: { restored: string[] } = existsSync(journal)
			? JSON.parse(readFileSync(journal, "utf8"))
			: { restored: [] };
		const record = () => {
			writeFileSync(`${journal}.tmp`, JSON.stringify(progress), {
				mode: 0o600,
				flush: true,
			});
			renameSync(`${journal}.tmp`, journal);
		};
		const names = ["config.json", "state", "factory"];
		if (
			!existsSync(journal) &&
			names.some((name) => existsSync(join(retained, name)))
		)
			throw new Error(
				"Interrupted rollback requires reconciliation of retained state",
			);
		record();
		for (const name of names) {
			if (progress.restored.includes(name)) continue;
			const current = join(this.home, name),
				held = join(retained, name),
				backup = join(transaction.snapshot, name);
			if (existsSync(held)) {
				// Interrupted mid-restore. No worker starts before every entry is
				// restored, so current is only a partial snapshot copy plus moved auth.
				if (
					name === "factory" &&
					existsSync(join(current, "auth")) &&
					!existsSync(join(held, "auth"))
				)
					renameSync(join(current, "auth"), join(held, "auth"));
				rmSync(current, { recursive: true, force: true });
			} else if (existsSync(current)) renameSync(current, held);
			if (existsSync(backup))
				cpSync(backup, current, { recursive: true, verbatimSymlinks: true });
			if (name === "factory" && existsSync(join(held, "auth"))) {
				mkdirSync(current, { recursive: true, mode: 0o700 });
				renameSync(join(held, "auth"), join(current, "auth"));
			}
			progress.restored.push(name);
			record();
		}
		this.switchLink(realpathSync(transaction.staged.previousExecutable));
		await this.start();
		const old = JSON.parse(
			readFileSync(
				join(
					dirname(realpathSync(transaction.staged.previousExecutable)),
					"build.json",
				),
				"utf8",
			),
		);
		await this.health(old);
		const recoveryIntegrity = await writeStorageIntegrity(
			retained,
			join(retention.directory, "proofs", `${recovery.id}.ndjson`),
		);
		await retention.revise(recovery.id, (record) => {
			record.completedAt = record.verifiedAt = new Date().toISOString();
			record.evidence = [`integrity:${recoveryIntegrity}`];
		});
	}
	async releaseMaintenance(transactionId: string) {
		if (!this.transactionId) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			if (
				transaction?.id !== transactionId ||
				(transaction.release &&
					transaction.release.transactionId !== transactionId) ||
				(!transaction.release &&
					!["succeeded", "rolled-back", "cancelled"].includes(
						transaction.phase,
					))
			)
				throw new Error(
					"Maintenance release lacks exact durable terminal outcome",
				);
			this.transactionId = transactionId;
		}
		if (transactionId !== this.transactionId)
			throw new Error("Maintenance owner mismatch");
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another lifecycle owns maintenance");
			this.preservation = saved.preservation;
		} else if (!existsSync(join(this.home, "updates", "maintenance.json")))
			return;
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			const expected =
				(transaction.release?.outcome ?? transaction.phase) === "succeeded"
					? transaction.candidate
					: transaction.previous;
			await this.acquireMaintenance(transactionId);
			await this.start();
			await this.health(expected);
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "end",
		});
		rmSync(this.fence(), { force: true });
	}
}
