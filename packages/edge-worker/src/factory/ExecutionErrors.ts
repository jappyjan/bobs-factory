/** Control failures must retain the accepted visit instead of entering error routes. */
export class NonConvergenceError extends Error {}
export class WorkflowUnavailableError extends Error {}
/** Provider state is still sending/uncertain; retain its action ID for reconciliation. */
export class EffectReconciliationError extends Error {}
