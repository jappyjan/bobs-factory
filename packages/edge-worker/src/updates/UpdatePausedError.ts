/** Scheduling suspension, not a failed or cancelled task. Saved work resumes
 * after the exact update transaction releases maintenance. */
export class UpdatePausedError extends Error {
	constructor() {
		super(
			"Paused for a prepared update; saved work will resume after maintenance.",
		);
	}
}

export function isUpdatePaused(error: unknown): error is UpdatePausedError {
	return error instanceof UpdatePausedError;
}
