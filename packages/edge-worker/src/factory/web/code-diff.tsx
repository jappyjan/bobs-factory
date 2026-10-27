import { useState } from "react";
import { parsePatch, splitPatch } from "./code-diff-model";
import { Button } from "./ui";
export function DiffBody({
	patch,
	split,
	notes = [],
	renderNote,
}: {
	patch: string;
	split: boolean;
	notes?: { id: string; line: number; side?: "old" | "new"; text: string }[];
	renderNote?: (id: string) => React.ReactNode;
}) {
	const noteBody = (note: (typeof notes)[number]) => (
		<aside className="display-code-note" key={note.id}>
			<strong>Line {note.line}</strong>
			<p>{note.text}</p>
			{renderNote?.(note.id)}
		</aside>
	);
	const pinned = (old: number | undefined, next: number | undefined) =>
		notes
			.filter((note) => note.line === (note.side === "old" ? old : next))
			.map(noteBody);
	const [limit, setLimit] = useState(500);
	const lines = parsePatch(patch),
		paired = splitPatch(lines),
		isSplit = split,
		rows = isSplit ? paired : lines;
	return (
		<>
			{!lines.length && (
				<p role="status">No text hunks. This file has metadata changes only.</p>
			)}
			<section
				className={`diff-body ${isSplit ? "split" : "unified"}`}
				aria-label={`${isSplit ? "Split" : "Unified"} file diff`}
			>
				<div className="diff-grid">
					{isSplit
						? paired.slice(0, limit).map((row, i) =>
								row.kind === "hunk" || row.kind === "meta" ? (
									<div className={`diff-line ${row.kind}`} key={i}>
										<code>{row.left?.text}</code>
									</div>
								) : (
									<div className="split-row" key={i}>
										{[row.left, row.right].map((line, j) => (
											<div
												key={j}
												className={`diff-line ${line?.kind ?? "empty"}`}
											>
												<span className="gutter">
													{j === 0 ? line?.old : line?.next}
												</span>
												<span className="diff-sign">
													{line?.kind === "remove"
														? "−"
														: line?.kind === "add"
															? "+"
															: " "}
												</span>
												<code>
													{line?.text ?? ""}
													{pinned(
														j === 0 ? line?.old : undefined,
														j === 1 ? line?.next : undefined,
													)}
													{line?.note && (
														<>
															<br />
															<em>{line.note}</em>
														</>
													)}
												</code>
											</div>
										))}
									</div>
								),
							)
						: lines.slice(0, limit).map((line, i) => (
								<div key={i} className={`diff-line ${line.kind}`}>
									{!["hunk", "meta"].includes(line.kind) && (
										<>
											<span className="gutter">{line.old}</span>
											<span className="gutter">{line.next}</span>
											<span className="diff-sign">
												{line.kind === "remove"
													? "−"
													: line.kind === "add"
														? "+"
														: " "}
											</span>
										</>
									)}
									<code>{line.text}</code>
									{pinned(line.old, line.next)}
								</div>
							))}
				</div>
			</section>
			{notes
				.filter(
					(note) =>
						!lines.some(
							(line) =>
								note.line === (note.side === "old" ? line.old : line.next),
						),
				)
				.map(noteBody)}
			{rows.length > limit && (
				<Button variant="secondary" onClick={() => setLimit(rows.length)}>
					Show remaining {rows.length - limit} lines
				</Button>
			)}
		</>
	);
}
