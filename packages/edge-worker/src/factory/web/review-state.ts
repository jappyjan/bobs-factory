import type { Guide, GuideChapter } from "../FactoryResults";
import type { ImpactDecision } from "../Impact";
import { accessState } from "./auth-state";
import { chaptersFor } from "./review-model";
import { roleOutput, roleOutputKey } from "./run-output";
export function signature(value: unknown) {
	let hash = 2166136261;
	for (const c of JSON.stringify(value))
		hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
	return (hash >>> 0).toString(36);
}

export function ticketTrackingPending(run: any): boolean {
	return Boolean(
		run.ticketSync?.error ||
			run.ticketSync?.receipts?.some(
				(receipt: { delivered?: boolean; superseded?: boolean }) =>
					!receipt.delivered && !receipt.superseded,
			),
	);
}

export function guideRevision(run: any) {
	const key = roleOutputKey(run, "guide");
	return key
		? (run.roleRevisions?.[key] ??
				Object.entries<any>(run.roleRevisions ?? {}).find(
					([candidate]) => candidate.split("/").at(-1) === key,
				)?.[1])
		: undefined;
}

export function reviewRevision(run: any) {
	return (
		run.reviewGate?.externalDigest ??
		run.reviewGate?.headSha ??
		guideRevision(run)?.headSha ??
		""
	);
}

/** Preserve the progress identity used by both the preview and artifact reader. */
export function reviewKey(run: any, guide: unknown) {
	const repositories = chapterRepositories(run);
	const scope = repositories.length
		? `/repositories-${signature(repositories)}`
		: "";
	return `factory-review/${run.id}/${reviewRevision(run)}${scope}/${signature(guide)}`;
}

export function guideMatchesGate(run: any) {
	if (run.reviewGate?.mode === "external")
		return (
			roleOutput(run, "guide")?.externalDigest === run.reviewGate.externalDigest
		);
	const revision = guideRevision(run);
	return !revision || revision.headSha === run.reviewGate?.headSha;
}

export type ReviewProgress = {
	page: number;
	reviewed: Record<string, boolean>;
	disclosures?: Record<string, boolean>;
	checked?: Record<string, boolean>;
	visited?: Record<string, boolean>;
};

export function readProgress(saved: unknown, pages: number): ReviewProgress {
	const value = saved as ReviewProgress | null;
	if (
		!value ||
		!Number.isInteger(value.page) ||
		value.page < 0 ||
		value.page >= pages ||
		!value.reviewed ||
		typeof value.reviewed !== "object" ||
		Array.isArray(value.reviewed)
	)
		return { page: 0, reviewed: {} };
	const booleans = (record: unknown) => {
		const result: Record<string, boolean> = {};
		if (record && typeof record === "object" && !Array.isArray(record))
			for (const [key, value] of Object.entries(record))
				if (typeof value === "boolean") result[key] = value;
		return result;
	};
	return {
		page: value.page,
		reviewed: booleans(value.reviewed),
		disclosures: booleans(value.disclosures),
		...(value.checked ? { checked: booleans(value.checked) } : {}),
		...(value.visited ? { visited: booleans(value.visited) } : {}),
	};
}

type ChapterProgress = {
	revision: string;
	repositories: { repositoryId: string; headSha: string }[];
	contexts: Record<string, string>;
	reviewed: Record<string, boolean>;
};
const chapterProgressKey = (run: any) =>
	`factory-review/${run.id}/chapter-progress`;
const chapterRepositories = (run: any): ChapterProgress["repositories"] =>
	(run.reviewGate?.repositories ?? [])
		.map(
			({ repositoryId, headSha }: ChapterProgress["repositories"][number]) => ({
				repositoryId,
				headSha,
			}),
		)
		.sort(
			(
				a: ChapterProgress["repositories"][number],
				b: ChapterProgress["repositories"][number],
			) => a.repositoryId.localeCompare(b.repositoryId),
		);
function chapterContext(guide: Guide, chapter: GuideChapter): string {
	return JSON.stringify({
		chapter,
		requirements: chapter.requirementIndexes.map((i) => guide.requirements[i]),
		parts: chapter.systemPartIds?.map((id) =>
			guide.system?.parts.find((part) => part.id === id),
		),
		connections:
			guide.system &&
			["before", "after"].map((mode) =>
				guide.system![mode as "before" | "after"].filter((edge) =>
					chapter.systemPartIds?.some(
						(id) => id === edge.source || id === edge.target,
					),
				),
			),
	});
}

/** Reading progress is separate from revision-bound feedback and approval. */
export function carriedChapterProgress(
	run: any,
	guide: Guide,
	previous: ChapterProgress | null,
): Record<string, boolean> {
	if (
		!previous ||
		typeof previous.revision !== "string" ||
		!previous.contexts ||
		typeof previous.contexts !== "object" ||
		Array.isArray(previous.contexts) ||
		!previous.reviewed ||
		typeof previous.reviewed !== "object" ||
		Array.isArray(previous.reviewed) ||
		!Array.isArray(previous.repositories ?? []) ||
		(previous.repositories ?? []).some(
			(repo) =>
				!repo ||
				typeof repo.repositoryId !== "string" ||
				typeof repo.headSha !== "string",
		)
	)
		return {};
	const revision = reviewRevision(run);
	const decision = (run.impactDecisions as ImpactDecision[] | undefined)?.at(
		-1,
	);
	const transition =
		decision?.status === "completed" &&
		decision.classification !== "full" &&
		!decision.uncertainty.length &&
		decision.snapshot.repositories.some((repo) => repo.headSha === revision) &&
		chapterRepositories(run).every((current) =>
			decision.snapshot.repositories.some(
				(repo) =>
					repo.repositoryId === current.repositoryId &&
					repo.headSha === current.headSha,
			),
		) &&
		(previous.repositories ?? []).every((old) =>
			decision.snapshot.repositories.some(
				(repo) =>
					repo.repositoryId === old.repositoryId &&
					repo.reviewHead === old.headSha,
			),
		) &&
		(decision.snapshot.approval?.headSha === previous.revision ||
			decision.snapshot.repositories.some(
				(repo) => repo.reviewHead === previous.revision,
			));
	const reviewed: Record<string, boolean> = {};
	for (const chapter of chaptersFor(guide)) {
		if (
			typeof previous.reviewed[chapter.id] !== "boolean" ||
			previous.contexts[chapter.id] !== chapterContext(guide, chapter)
		)
			continue;
		// Across revisions, require an independently validated reuse boundary.
		// Identical guide prose alone cannot prove unchanged source/dependencies.
		const unaffected =
			(previous.revision === revision &&
				JSON.stringify(previous.repositories ?? []) ===
					JSON.stringify(chapterRepositories(run))) ||
			(transition &&
				decision.reuseRecords.some(({ boundary, snapshotDigest }) => {
					const covers = (file: string, dependency: string) =>
						file === dependency || file.startsWith(`${dependency}/`);
					return (
						snapshotDigest === decision.snapshot.digest &&
						(boundary.areas.includes(chapter.id) || chapter.files.length > 0) &&
						chapter.files.every((file) =>
							boundary.dependencies.some((dependency) =>
								covers(file, dependency),
							),
						) &&
						chapter.requirementIndexes.every((i) => {
							const id = guide.requirements[i]?.requirementId;
							return id && boundary.requirementIds.includes(id);
						})
					);
				}));
		if (unaffected) reviewed[chapter.id] = previous.reviewed[chapter.id]!;
	}
	return reviewed;
}

export function readReviewProgress(run: any, guide: Guide, pages: number) {
	const saved = readStored<
		(ReviewProgress & { chapterProgress?: ChapterProgress }) | null
	>(reviewKey(run, guide), null);
	if (saved) {
		const progress = readProgress(saved, pages);
		// Old single-repository keys already bind the revision and complete guide.
		// Grouped progress needs an explicit scope receipt; never infer it.
		const reviewed = saved.chapterProgress
			? carriedChapterProgress(run, guide, saved.chapterProgress)
			: chapterRepositories(run).length
				? {}
				: progress.reviewed;
		return { ...progress, reviewed };
	}
	let previous = readStored<ChapterProgress | null>(
		chapterProgressKey(run),
		null,
	);
	// Upgrade existing revision-scoped progress only when the original guide
	// is still available. Never guess a chapter's old content from its ID.
	if (!previous && guide.previousHeadSha) {
		const old =
			(run.previousReviewGuide?.reviewFiles?.headSha ===
				guide.previousHeadSha && run.previousReviewGuide?.chapters
				? run.previousReviewGuide
				: undefined) ??
			(run.history
				?.slice()
				.reverse()
				.find(
					(entry: any) =>
						entry.output?.reviewFiles?.headSha === guide.previousHeadSha &&
						entry.output?.chapters,
				)?.output as Guide | undefined);
		if (old) {
			const oldRun = {
				id: run.id,
				reviewGate: { headSha: guide.previousHeadSha },
			};
			const progress = readProgress(
				readStored(reviewKey(oldRun, old), null),
				chaptersFor(old).length + 3,
			);
			previous = chapterProgress(oldRun, old, progress);
		}
	}
	return { page: 0, reviewed: carriedChapterProgress(run, guide, previous) };
}

function chapterProgress(
	run: any,
	guide: Guide,
	progress: ReviewProgress,
): ChapterProgress {
	return {
		revision: reviewRevision(run),
		repositories: chapterRepositories(run),
		contexts: Object.fromEntries(
			chaptersFor(guide).map((chapter) => [
				chapter.id,
				chapterContext(guide, chapter),
			]),
		),
		reviewed: progress.reviewed,
	};
}

export function writeReviewProgress(
	run: any,
	guide: Guide,
	progress: ReviewProgress,
) {
	const snapshot = chapterProgress(run, guide, progress);
	writeStored(reviewKey(run, guide), {
		...progress,
		chapterProgress: snapshot,
	});
	writeStored(chapterProgressKey(run), snapshot);
}

export function readTextStored(key: string, fallback: string, session = false) {
	try {
		return (session ? sessionStorage : localStorage).getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeTextStored(key: string, value: string, session = false) {
	if (
		accessState().status !== "authenticated" &&
		!["factory-theme", "factory-settled-view"].includes(key)
	)
		return;
	try {
		(session ? sessionStorage : localStorage).setItem(key, value);
	} catch {
		/* Navigation, reading and actions remain available without storage. */
	}
}
export function readStored<T>(key: string, fallback: T, session = false): T {
	try {
		return JSON.parse(readTextStored(key, "null", session)) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeStored(key: string, value: unknown, session = false) {
	writeTextStored(key, JSON.stringify(value), session);
}

export function todayContext(pathname: string, state: any) {
	const review = pathname.match(/^\/runs\/([^/]+)\/review$/);
	let id = review?.[1];
	try {
		if (id) id = decodeURIComponent(id);
	} catch {
		/* malformed direct URL */
	}
	return { focusRunId: id ?? state?.focusRunId };
}
