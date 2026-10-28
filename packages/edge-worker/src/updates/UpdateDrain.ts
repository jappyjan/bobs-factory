import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { factoryRuntimeIdentity, readStateFormat } from "bobs-factory-core";
import type { WorkflowRuntime } from "../factory/WorkflowRuntime.js";
import type { CapacitySnapshot, MachineCapacity } from "../MachineCapacity.js";
import { baselineFromSummary, type DataSummary } from "./DataSummary.js";
import { preservationV2Workflow } from "./PreservationV2Workflow.js";
import { UpdateManager } from "./UpdateManager.js";

// This projection is frozen: older installed supervisors compare against it.
// Changes require a new contract and supervisor support for comparing per contract.
export const preservationContract = "factory-preservation-v2";

/** Freeze intake and slot admission once staging completes. Active steps finish
 * naturally; later steps and queued slots retain their saved progress. */
export class UpdateDrain {
	readonly file: string;
	private intake = new Set<object>();
	enter(request: object) {
		this.intake.add(request);
	}
	leave(request: object) {
		this.intake.delete(request);
	}
	constructor(
		readonly home: string,
		private readonly runtime: WorkflowRuntime,
		private readonly capacity: MachineCapacity,
		private readonly busy: () => boolean,
		private readonly resume: () => void,
		private readonly nativeSessions: () => unknown = () => [],
		private readonly freezeBackground: (active: boolean) => void = () => {},
	) {
		this.file = join(home, "updates", "maintenance.json");
		if (this.active()) this.freezeBackground(true);
	}
	active(): boolean {
		return existsSync(this.file);
	}
	private transaction() {
		const id = JSON.parse(readFileSync(this.file, "utf8")).transactionId;
		if (typeof id !== "string")
			throw new Error("Malformed update maintenance marker");
		return id;
	}
	private persistedTransaction(transactionId: string) {
		const fence = join(this.home, "runtime", "update-owner.json");
		if (existsSync(fence)) {
			const owner = JSON.parse(readFileSync(fence, "utf8"));
			if (
				owner.transactionId === transactionId &&
				owner.product === "bobs-factory-desktop"
			)
				return new UpdateManager(join(this.home, "desktop")).status()
					.transaction;
		}
		return new UpdateManager(this.home).status().transaction;
	}
	/** Identity-level view of what this worker loaded; see {@link DataSummary}. */
	dataSummary(): DataSummary {
		const ids = (values: Iterable<string>) => [...values].sort();
		const runIds = ids(this.runtime.runs.keys());
		const loaded = new Set(runIds);
		// Recipes saved by the user. Bundled ones belong to the candidate's code and
		// may be removed or renamed by a newer build.
		const workflowIds = ids(
			this.runtime.catalog.read().locals.map((workflow) => workflow.id),
		);
		const native = this.nativeSessions() as {
			sessions?: Array<{ id?: unknown }>;
		};
		const sessionIds = ids(
			(native?.sessions ?? [])
				.map((session) => session.id)
				.filter((id): id is string => typeof id === "string"),
		);
		const loadErrors: DataSummary["loadErrors"] = [];
		try {
			for (const name of readdirSync(join(this.home, "factory", "runs")))
				if (name.endsWith(".json") && !loaded.has(name.slice(0, -5)))
					loadErrors.push({
						kind: "run",
						id: name.slice(0, -5),
						message: "run file was not loaded",
					});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return {
			runtime: {
				version: factoryRuntimeIdentity.version,
				commit: factoryRuntimeIdentity.commit,
				target: factoryRuntimeIdentity.target,
			},
			stateFormat: readStateFormat(this.home),
			runs: { count: runIds.length, ids: runIds },
			workflows: { count: workflowIds.length, ids: workflowIds },
			sessions: { count: sessionIds.length, ids: sessionIds },
			loadErrors,
		};
	}
	/** Fingerprint a v2 supervisor captured before it copied the home. Echoing it
	 * keeps the v2 health rule ("the data you captured still loads") without the
	 * byte-exact comparison that any token refresh breaks. Only while that exact
	 * transaction is in flight and this worker loaded everything it recorded. */
	private echo(summarize: () => DataSummary) {
		try {
			const fence = join(this.home, "runtime", "update-owner.json");
			if (!existsSync(fence)) return;
			const owner = JSON.parse(readFileSync(fence, "utf8")) as {
				transactionId?: string;
				preservation?: {
					preservationContract?: string;
					preservedStateSha256?: string;
					runIds?: string[];
				};
			};
			const saved = owner.preservation;
			if (
				saved?.preservationContract !== preservationContract ||
				typeof saved.preservedStateSha256 !== "string"
			)
				return;
			const transaction = new UpdateManager(this.home).status().transaction;
			if (
				!transaction ||
				transaction.id !== owner.transactionId ||
				["succeeded", "rolled-back", "cancelled"].includes(transaction.phase)
			)
				return;
			const summary = summarize();
			const have = new Set(summary.runs.ids);
			if (
				summary.loadErrors.length ||
				(saved.runIds ?? []).some((id) => !have.has(id))
			)
				return;
			return {
				preservationContract: saved.preservationContract,
				preservedStateSha256: saved.preservedStateSha256,
			};
		} catch {
			return;
		}
	}
	async begin(transactionId: string) {
		const transaction = this.persistedTransaction(transactionId);
		if (
			!transaction ||
			transaction.id !== transactionId ||
			["succeeded", "rolled-back", "cancelled"].includes(transaction.phase)
		)
			throw new Error(
				"Maintenance requires the exact persisted update transaction",
			);
		if (this.active()) {
			if (this.transaction() !== transactionId)
				throw new Error("Another transaction owns maintenance");
		} else {
			mkdirSync(join(this.home, "updates"), { recursive: true, mode: 0o700 });
			this.freezeBackground(true);
			writeFileSync(this.file, JSON.stringify({ transactionId }), {
				flag: "wx",
				mode: 0o600,
				flush: true,
			});
		}
		await this.capacity.pauseAdmissionsForUpdate(transactionId);
	}
	receipt() {
		const fileDigest = (file: string) => {
			const path = join(this.home, file);
			return existsSync(path)
				? createHash("sha256").update(readFileSync(path)).digest("hex")
				: null;
		};
		const records = [...this.runtime.runs.values()]
			.map((run) => {
				// Raw legacy runs retain these fields even though the node engine no
				// longer declares them. They still belong to the v2 wire contract.
				const legacy = run as {
					answers?: unknown;
					reviewGate?: unknown;
					humanDecisions?: unknown;
					questionBatchId?: unknown;
					questions?: unknown;
					questionRecommendations?: unknown;
					delivery?: unknown;
				};
				return {
					id: run.id,
					workspace: run.workspace,
					// The old running worker held graphs after its schema parse.
					workflow: preservationV2Workflow(run.workflow),
					workflowDefinitions: run.workflowDefinitions,
					checkpoint: run.checkpoint,
					outputs: run.outputs,
					answers: legacy.answers,
					reviewGate: legacy.reviewGate,
					humanDecisions: legacy.humanDecisions,
					questionBatchId: legacy.questionBatchId,
					questions: legacy.questions,
					questionRecommendations: legacy.questionRecommendations,
					executionSnapshot: run.executionSnapshot,
					delivery: legacy.delivery,
					ticketSync: run.ticketSync,
				};
			})
			.sort((a, b) => a.id.localeCompare(b.id));
		const receipt = {
			preservationContract,
			preservedStateSha256: createHash("sha256")
				.update(
					JSON.stringify({
						records,
						nativeSessions: this.nativeSessions(),
						// Bundled graphs belong to the candidate's code identity. Protect
						// saved graphs, preferences and availability instead; hashing the
						// resolved catalog rejects every legitimate bundled prompt update.
						workflows: fileDigest("factory/workflows.json"),
						defaultWorkflow: this.runtime.catalog.preservedDefaultWorkflow(),
						titles: this.runtime.getTitleSettings(),
						executionProfiles: this.runtime.executionProfiles.read(),
						config: ["config.json", ".env"].map(fileDigest),
					}),
				)
				.digest("hex"),
			runIds: records.map((record) => record.id),
		};
		const echoed = this.echo(() => this.dataSummary());
		return echoed ? { ...receipt, ...echoed } : receipt;
	}
	/** `light` is for supervisors that compare identities, not bytes: it skips
	 * the whole-state digest and reports the data baseline instead. */
	async inspect(light = false) {
		const evidence = () =>
			light
				? { baseline: baselineFromSummary(this.dataSummary()) }
				: this.receipt();
		if (!this.active())
			throw new Error("Freeze intake before inspecting update drain");
		if (this.busy() || this.intake.size)
			return {
				idle: false,
				reason: "Accepted work is still executing",
				...evidence(),
			};
		let capacity: CapacitySnapshot;
		try {
			capacity = await this.capacity.pauseAdmissionsForUpdate(
				this.transaction(),
			);
		} catch (error) {
			return {
				idle: false,
				reason: (error as Error).message,
				...evidence(),
			};
		}
		// No more capacity leases can be admitted once this returns. In-process
		// webhook/workflow observations are checked again after the awaited barrier.
		return {
			idle:
				!this.busy() &&
				this.intake.size === 0 &&
				!capacity.error &&
				capacity.active === 0 &&
				capacity.stopping === 0,
			capacity: {
				active: capacity.active,
				stopping: capacity.stopping,
				queued: capacity.queued,
				error: capacity.error,
			},
			...evidence(),
		};
	}
	async end(transactionId: string) {
		if (!this.active()) return;
		if (this.transaction() !== transactionId)
			throw new Error("Maintenance transaction mismatch");
		const transaction = this.persistedTransaction(transactionId);
		const phase =
			transaction?.release?.status === "pending"
				? transaction.release.outcome
				: transaction?.phase;
		if (
			transaction?.id !== transactionId ||
			!phase ||
			!["succeeded", "rolled-back", "cancelled"].includes(phase)
		)
			throw new Error("Finish health/rollback before releasing maintenance");
		await this.capacity.resumeAdmissionsAfterUpdate(transactionId);
		unlinkSync(this.file);
		this.freezeBackground(false);
		this.resume();
	}
}
