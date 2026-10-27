import type { ViewSnapshot } from "./HumanStep.js";
import { viewPlainText, viewText } from "./View.js";
import { publicViewSnapshot } from "./ViewPresentation.js";

/** The human protocol is reserved before bounded untrusted display content. */
export function humanViewText(
	snapshot: ViewSnapshot,
	options: { maxLength?: number; includeProtocol?: boolean } = {},
): string {
	snapshot = publicViewSnapshot(snapshot);
	const limit = Math.max(1000, Math.min(100000, options.maxLength ?? 100000));
	const header: string[] = [snapshot.kind];
	if (!(snapshot.kind === "display" && !snapshot.interactive)) {
		header.push(
			`Decision batch: ${snapshot.id}`,
			`Displayed digest: ${snapshot.digest}`,
		);
		if (options.includeProtocol !== false)
			header.push(
				`Reply with /view-answer {"batchId":"${snapshot.id}","digest":"${snapshot.digest}","documentDigest":"${snapshot.documentDigest}","accepted":true,"action":"…","values":{},"choices":[]} using only displayed action, field and item IDs. Omit action when no document actions are shown.`,
			);
		header.push(
			"Review the complete display, discussion and assets in the dashboard before accepted:true. A digest identifies content; it does not mean omitted content was reviewed.",
		);
	}
	const sections: string[] = [viewPlainText(snapshot.title)];
	for (const [itemId, threads] of Object.entries(snapshot.threads ?? {})) {
		for (const thread of threads)
			sections.push(
				viewPlainText(`Ask for item ${itemId} — ${thread.status}`),
				viewPlainText(`Question: ${thread.question}`),
				...(thread.answer === undefined
					? []
					: [viewPlainText(`Answer: ${thread.answer}`)]),
				...(thread.error === undefined
					? []
					: [viewPlainText(`Error: ${thread.error}`)]),
			);
	}
	sections.push(viewText(snapshot.view));
	for (const item of snapshot.items ?? [])
		sections.push(
			...[
				`${item.id}: ${item.title}`,
				item.body ?? "",
				...item.details.map((d) => `${d.label}: ${d.value}`),
			].map(viewPlainText),
		);
	const prefix = `${header.join("\n")}\n`;
	const body = sections.join("\n");
	if (prefix.length + body.length <= limit) return prefix + body;
	const notice =
		"\n[INCOMPLETE: display text truncated. Open the dashboard for the complete current display and Ask discussion before answering.]";
	return (
		prefix +
		body.slice(0, Math.max(0, limit - prefix.length - notice.length)) +
		notice
	);
}
