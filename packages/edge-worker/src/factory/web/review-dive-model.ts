import type { BriefTourEntry } from "../ReviewBrief";
import type { ReviewFile } from "../ReviewFiles";
import { type DiffLine, isTestFile } from "./review-model";

export type FileKind = "code" | "tests" | "text";

const TEXT =
	/\.(json|jsonc|ya?ml|toml|md|mdx|txt|po|pot|csv|snap|svg|lock)$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum)$/i;

/** What a changed file mostly is, for the line breakdown and related-file labels. */
export function fileKind(path: string): FileKind {
	if (isTestFile(path)) return "tests";
	return TEXT.test(path) ? "text" : "code";
}

/** Added lines split into code, tests and text; unknown counts (binary) count as zero. */
export function lineBreakdown(files: ReviewFile[]) {
	const totals = { code: 0, tests: 0, text: 0 };
	for (const file of files) totals[fileKind(file.path)] += file.additions ?? 0;
	return totals;
}

/** The tour entry that presents a file, whether as its own entry, related or same. */
export function tourOwner(tour: BriefTourEntry[], path: string) {
	return tour.find(
		(entry) =>
			entry.file === path ||
			entry.related?.includes(path) ||
			entry.same?.includes(path),
	);
}

export type DiffBlock =
	| { kind: "line"; line: DiffLine }
	| { kind: "hunk"; line: DiffLine }
	| { kind: "reformat"; lines: DiffLine[]; count: number };

// Formatter noise: whitespace, line breaks and trailing commas.
const squash = (lines: DiffLine[]) =>
	lines
		.map((l) => l.text.replace(/\s+/g, ""))
		.join("")
		.replace(/,(?=[)\]}>])/g, "");

const changedCount = (lines: DiffLine[]) =>
	Math.max(
		lines.filter((l) => l.kind === "add").length,
		lines.filter((l) => l.kind === "remove").length,
	);

/**
 * Group a parsed patch for reading: hunks or change runs that only reformat
 * (same tokens before and after) collapse into one block.
 */
export function diffBlocks(lines: DiffLine[]): DiffBlock[] {
	const hunks: DiffLine[][] = [];
	const out: DiffBlock[] = [];
	for (const line of lines) {
		if (line.kind === "hunk" || !hunks.length) hunks.push([]);
		hunks.at(-1)!.push(line);
	}
	for (const hunk of hunks) {
		const body = hunk.filter((l) => l.kind !== "hunk" && l.kind !== "meta");
		const header = hunk[0]?.kind === "hunk" ? hunk[0] : undefined;
		if (header) out.push({ kind: "hunk", line: header });
		const changed = body.filter((l) => l.kind === "add" || l.kind === "remove");
		if (
			changed.length &&
			squash(body.filter((l) => l.kind !== "add")) ===
				squash(body.filter((l) => l.kind !== "remove"))
		) {
			out.push({ kind: "reformat", lines: body, count: changedCount(body) });
			continue;
		}
		for (let i = header ? 1 : 0; i < hunk.length; ) {
			const line = hunk[i]!;
			if (line.kind !== "add" && line.kind !== "remove") {
				out.push({ kind: "line", line });
				i++;
				continue;
			}
			const run: DiffLine[] = [];
			while (
				i < hunk.length &&
				(hunk[i]!.kind === "add" || hunk[i]!.kind === "remove")
			)
				run.push(hunk[i++]!);
			if (
				squash(run.filter((l) => l.kind === "remove")) ===
				squash(run.filter((l) => l.kind === "add"))
			)
				out.push({ kind: "reformat", lines: run, count: changedCount(run) });
			else
				for (const changedLine of run)
					out.push({ kind: "line", line: changedLine });
		}
	}
	return out;
}

/** The line a pin or code link points at: an added line first, then removed, then context. */
export function findLine(lines: DiffLine[], match: string) {
	for (const kind of ["add", "remove", "context"] as const) {
		const line = lines.find((l) => l.kind === kind && l.text.includes(match));
		if (line) return line;
	}
	return undefined;
}

/** Shared indentation of a hunk, removed so deep code still reads on a phone. */
export function commonIndent(lines: DiffLine[]) {
	let indent = Infinity;
	for (const line of lines)
		if (line.kind !== "hunk" && line.kind !== "meta" && line.text.trim())
			indent = Math.min(indent, /^\s*/.exec(line.text)![0].length);
	return Number.isFinite(indent) ? indent : 0;
}
