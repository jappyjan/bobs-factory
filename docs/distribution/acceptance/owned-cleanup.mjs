// Cancellation unwinds work before touching its resources. Repeated signals share
// the same finally path; callers must bound every operation in work and cleanup.
export async function withOwnedCleanup({ work, cleanup, receipt, persist }) {
	const controller = new AbortController();
	const interrupt = (signal) => {
		receipt.passed = false;
		receipt.interrupted = signal;
		controller.abort(new Error(`Interrupted: ${signal}`));
	};
	const term = () => interrupt("SIGTERM");
	const int = () => interrupt("SIGINT");
	process.on("SIGTERM", term);
	process.on("SIGINT", int);
	try {
		await work(controller.signal);
		controller.signal.throwIfAborted();
	} catch (error) {
		receipt.passed = false;
		receipt.error = error.message;
	} finally {
		try {
			await cleanup();
		} catch (error) {
			receipt.passed = false;
			receipt.cleanupError = error.message;
		}
		if (controller.signal.aborted) receipt.passed = false;
		try {
			await persist();
		} finally {
			process.off("SIGTERM", term);
			process.off("SIGINT", int);
		}
	}
	if (receipt.interrupted)
		process.exitCode = receipt.interrupted === "SIGINT" ? 130 : 143;
}
