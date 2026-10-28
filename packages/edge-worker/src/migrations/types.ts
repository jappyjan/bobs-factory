import type { TouchSpec } from "./MigrationBackup.js";
import type { MigrationContext, MigrationReader } from "./MigrationContext.js";

export interface StateMigration {
	/** Immutable and never reused, e.g. "0002-run-manifest-engine-v2". */
	id: string;
	/** Contiguous: `to === from + 1`. */
	from: number;
	to: number;
	/**
	 * Oldest build format that can still read the data afterwards. Until
	 * builds from before this framework are out of use it must stay <= 1.
	 */
	minReader: number;
	/** Every file `apply` may write or remove. Enforced, and exactly what is backed up. */
	touches: readonly TouchSpec[];
	/** Extra bytes needed beyond the backup. */
	estimate?(reader: MigrationReader): number | Promise<number>;
	/** Idempotent: must be re-runnable after a crash at any line. */
	apply(ctx: MigrationContext): Promise<void>;
	/** Postcondition (ids preserved, files parse). Throwing rolls everything back. */
	verify?(reader: MigrationReader): Promise<void>;
}
