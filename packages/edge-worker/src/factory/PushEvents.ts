import { createHash } from "node:crypto";

import { publicViewDecision } from "./ViewPresentation.js";
import { humanViewText } from "./ViewText.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

export type PushCategory =
	| "question"
	| "review"
	| "failure"
	| "blocker"
	| "completion"
	| "test";
export interface PushEvent {
	category: PushCategory;
	identity: string;
	destination: string;
	/** Present only for an accepted human-step snapshot's explicit privacy opt-in. */
	viewText?: string;
}
export const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("base64url");
export function runPushEvent(run: FactoryRun): PushEvent | undefined {
	const decision = publicViewDecision(run);
	const destination = `/#/runs/${encodeURIComponent(run.id)}`;
	// Ticket preparation temporarily marks restored waits as running. Unanswered
	// questions and pending gates remain authoritative until answer/decide clears them.
	const unresolved = run.status === "waiting" || run.status === "running";
	if (unresolved && decision && !decision.answer) {
		let viewText: string | undefined;
		if (decision.notifications?.push === "view-text") {
			// Bound the encoded string, including Unicode and JSON escape expansion.
			// Reformat rather than slicing away the exact batch/digest/protocol header.
			for (let maxLength = 2000; maxLength >= 1000; maxLength >>= 1) {
				const text = humanViewText(decision, {
					maxLength,
					includeProtocol: true,
				});
				if (Buffer.byteLength(JSON.stringify(text), "utf8") <= 2000) {
					viewText = text;
					break;
				}
			}
		}
		return {
			category: "question",
			identity: digest(["human-view-v1", decision.id, decision.digest]),
			destination,
			...(viewText === undefined ? {} : { viewText }),
		};
	}
	if (["failed", "interrupted"].includes(run.status))
		return {
			category: "failure",
			identity: digest([run.status, run.step, run.checkpoint?.visits]),
			destination,
		};
	if (run.status === "completed")
		return { category: "completion", identity: "completed", destination };
	return undefined;
}
export interface PushSession {
	id: string;
	status: string;
	stopped?: boolean;
	recovering?: boolean;
	pendingWork?: boolean;
}
export function sessionPushEvent(session: PushSession): PushEvent | undefined {
	if (session.stopped || session.recovering) return undefined;
	// A successful turn can leave scheduled wakeups or background tasks in flight.
	if (session.status === "complete" && session.pendingWork) return undefined;
	const category =
		session.status === "complete"
			? "completion"
			: session.status === "error"
				? "failure"
				: session.status === "awaitingInput"
					? "question"
					: undefined;
	return category
		? {
				category,
				identity: session.status,
				destination: `/#/runs/${encodeURIComponent(session.id)}`,
			}
		: undefined;
}
