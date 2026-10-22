import { digest } from "./Delivery.js";
import type { ViewRecord, ViewSnapshot, ViewThread } from "./HumanStep.js";

export const askFailureText =
	"Ask could not complete. Private agent diagnostics were retained. Check the agent setup and retry Ask with a new request, or continue with an item action after reviewing the complete display.";

/** Native diagnostics and checkpoints never become display content, including old records. */
function publicThread(thread: ViewThread): ViewThread {
	const {
		agent: _agent,
		executionKey: _key,
		error: _error,
		...display
	} = thread;
	return {
		...display,
		...(thread.status === "failed" ? { error: askFailureText } : {}),
	};
}

export function publicViewSnapshot(snapshot: ViewSnapshot): ViewSnapshot {
	return {
		...structuredClone(snapshot),
		threads: Object.fromEntries(
			Object.entries(snapshot.threads ?? {}).map(([id, threads]) => [
				id,
				threads.map(publicThread),
			]),
		),
	};
}

export function viewRecordDigest(runId: string, record: ViewRecord): string {
	const {
		digest: _digest,
		answer: _answer,
		threads,
		...display
	} = publicViewSnapshot(record.snapshot);
	return digest({
		protocol: "human-view-v1",
		runId,
		config: record.configDigest,
		source: record.sourceDigest,
		display,
		threads,
	});
}

export function publicViewRecord(
	runId: string,
	record: ViewRecord,
): ViewSnapshot {
	return {
		...publicViewSnapshot(record.snapshot),
		// Accepted answers and their original digests stay immutable. Pending legacy
		// errors receive a new displayed digest; their raw private record is retained.
		digest: record.answer
			? record.snapshot.digest
			: viewRecordDigest(runId, record),
		...(record.answer ? { answer: structuredClone(record.answer.output) } : {}),
	};
}

export function publicViewDecision(run: {
	id: string;
	viewDecision?: ViewSnapshot;
	viewRecords?: ViewRecord[];
}): ViewSnapshot | undefined {
	if (!run.viewDecision) return;
	const record = run.viewRecords?.find(
		(record) => record.snapshot.id === run.viewDecision!.id,
	);
	if (record?.superseded) return;
	return record
		? publicViewRecord(run.id, record)
		: publicViewSnapshot(run.viewDecision);
}
