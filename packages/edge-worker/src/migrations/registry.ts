import type { StateMigration } from "./types.js";

/**
 * Ordered, ids immutable. Ships empty: format 1 is today's layout. The
 * first real migration is added here together with its `STATE_FORMAT` bump.
 */
export const MIGRATIONS: readonly StateMigration[] = [];
