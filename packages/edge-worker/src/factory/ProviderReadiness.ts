export type ProviderCommand = (
	exe: string,
	args: string[],
	timeout?: number,
) => Promise<string>;
export interface MergeBlocker {
	kind: string;
	message: string;
	action: "fix" | "wait" | "human";
}
export interface ProviderCheck {
	required?: boolean;
	failureLogExcerpt?: string;
	name: string;
	state: string;
	bucket: string;
	link?: string;
	failure?: {
		kind: "infrastructure" | "metadata" | "unknown";
		evidence: string;
	};
	retry?: {
		id: string;
		attempt: number;
		headSha: string;
		kind: "github-run" | "gitlab-job";
		metadataRecheck?: boolean;
		lineage?: string;
		status?:
			| "queued"
			| "in_progress"
			| "completed"
			| "waiting"
			| "pending"
			| "requested";
	};
}
export interface MergeReadiness {
	/** Metadata from the same inspection, reused by the generic PR read operation. */
	request?: import("./GitProviderContracts.js").PullRequest & {
		labels: string[];
		reviewComments: unknown[];
	};
	mergeability?: "mergeable" | "conflicting" | "unknown";
	providerMergeability?: string | null;
	mergeStateStatus?: string | null;
	reviewDecision?: string | null;
	headSha: string;
	baseSha: string;
	/** Current named provider target, when exposed by the adapter. */
	baseRefName?: string;
	url: string;
	state: string;
	isDraft: boolean;
	approved: boolean;
	reviewReady: boolean;
	fix: boolean;
	blockers: MergeBlocker[];
	checks: ProviderCheck[];
	threads: unknown[];
	comments: unknown[];
	reviews: unknown[];
	queued: boolean;
	mergeMethod: "squash" | "merge" | "rebase";
}
export function delay(signal: AbortSignal, ms = 10000): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const abort = () => {
			clearTimeout(timer);
			reject(new Error("Run terminated"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal.addEventListener("abort", abort, { once: true });
	});
}

/** Categories come from this scoped provider receipt, never a role or check name. */
